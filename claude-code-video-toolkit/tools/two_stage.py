#!/usr/bin/env python3
"""本地两阶段文件协议；管理输入和证据，不替 Codex 作制作决策。"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

VERSION = 'video-two-stage/1'
SCHEMA = Path(__file__).resolve().parents[1] / '.agents/skills/video-pipeline/references/two-stage.schema.json'


class StageError(ValueError):
    def __init__(self, code, message, retryable=False, details=None):
        super().__init__(message)
        self.code, self.retryable = code, retryable
        self.details = details


def require(value, message, code='INVALID_CONTRACT'):
    if not value:
        raise StageError(code, message)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def json_digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('JSON 不允许 ' + value)))


def write(path, value):
    """原子替换，避免中断留下半个 JSON。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.write-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.write('\n'); f.flush(); os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def local(root, name, exists=True):
    require(isinstance(name, str) and name and not Path(name).is_absolute(), '需要任务内相对路径')
    path = (Path(root) / name).resolve()
    require(path.is_relative_to(Path(root).resolve()), '路径越出任务目录', 'PATH_ESCAPE')
    if exists:
        require(path.is_file() and path.stat().st_size > 0, f'文件不存在或为空：{name}', 'MISSING_INPUT')
    return path


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', value), '无效 ID')
    return value


def execution_path(root, request_path):
    return Path(request_path).resolve().parent / 'execution.json'


def schema(value, kind):
    import jsonschema
    document = read(SCHEMA)
    try:
        jsonschema.Draft202012Validator({**document, '$ref': '#/$defs/' + kind}).validate(value)
    except jsonschema.ValidationError as exc:
        raise StageError('INVALID_CONTRACT', f'{kind}: {exc.json_path}: {exc.message}') from exc


@contextmanager
def lock(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # 执行锁绑定工作区目录，删除空锁文件不能解除仍在运行的制作锁。
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY) if path.name == '.execution.lock' else os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise StageError('TASK_BUSY', '同一任务操作正在执行', True) from exc
        try:
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def process_signature(pid):
    # 解释器启动时可能 exec 成另一条命令，使用稳定的启动时间/属主识别同一 PID。
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'uid='], capture_output=True, text=True)
    return hashlib.sha256(result.stdout.strip().encode()).hexdigest() if result.returncode == 0 and result.stdout.strip() else None


def active_processes(root):
    active = []
    for path in (root / 'render').glob('*/work/*.process.json'):
        record = read(path)
        if record.get('state') != 'running': continue
        signature = process_signature(record['pid'])
        if signature and signature == record.get('signature'):
            active.append({'pid': record['pid'], 'record': str(path.relative_to(root))})
        elif signature is None:
            # 父进程已经退出但进程组仍在，保守阻止另起重复制作；不杀未知 PID。
            try: os.killpg(record['pid'], 0)
            except ProcessLookupError: continue
            active.append({'pid': record['pid'], 'record': str(path.relative_to(root)), 'orphanGroup': True})
    return active


def failure(request_path, step, exc):
    payload = {'status': 'failed', 'step': step, 'error': {'code': getattr(exc, 'code', 'EXECUTION_FAILED'),
               'message': str(exc), 'retryable': getattr(exc, 'retryable', False)}}
    if getattr(exc, 'details', None):
        payload['diagnostics'] = exc.details
    adjustment = getattr(exc, 'code', '') in ('TIMELINE_EXTEND_REQUIRED', 'CONTENT_TIMELINE_REQUIRED', 'MIX_REBUILD_REQUIRED')
    if adjustment:
        payload['status'] = 'adjustment_required'
        payload['nextAction'] = {'TIMELINE_EXTEND_REQUIRED':'adjust_project_coverage',
                                'CONTENT_TIMELINE_REQUIRED':'adjust_project_timing', 'MIX_REBUILD_REQUIRED':'render_new_mix'}[exc.code]
    if request_path:
        try:
            request = read(request_path); schema(request, 'request')
            payload.update(result_base(request))
            # 只有已注册输入才允许写本任务失败记录；保留此前 candidate。
            root, _ = load_request(request_path)
            write(Path(request_path).resolve().parent/('timeline-adjustment.json' if adjustment else 'failure.json'), payload)
        except (OSError, ValueError, KeyError, ImportError):
            pass
    return payload


def load_request(path, stage=None):
    path = Path(path).resolve()
    request = read(path)
    schema(request, 'request')
    root = path.parent
    while root.parent != root and not (root / 'job.json').is_file():
        root = root.parent
    require((root / 'job.json').is_file(), '缺少任务根 job.json')
    job = read(root / 'job.json')
    require(request['taskId'] == job['taskId'], '任务 ID 不匹配')
    require(digest(path) == job['requests'].get(str(path.relative_to(root))), '阶段输入已变更', 'INPUT_CHANGED')
    if stage:
        require(request['stage'] == stage, f'当前阶段禁止执行 {stage} 操作', 'STAGE_FORBIDDEN')
    for name, expected in request['snapshot'].items():
        require(digest(local(root, name)) == expected, f'输入已变更：{name}', 'INPUT_CHANGED')
    if request['stage'] == 'render':
        confirmation = read(local(root, 'confirmation/current.json'))
        require(confirmation == request['confirmation'], '确认版本已过期', 'STALE_CONFIRMATION')
        plan_file = local(root, confirmation['planFile'])
        require(digest(plan_file) == confirmation['planSha256'], '确认方案已变更', 'CONFIRMATION_CHANGED')
        validate_plan(root, request, read(plan_file), confirmed=True)
    return root, request


def validate_plan(root, request, plan, confirmed=False):
    schema(plan, 'plan')
    require(plan['taskId'] == request['taskId'], '方案任务 ID 不匹配')
    require(plan['inputDigest'] == json_digest(request['snapshot']), '方案输入快照不匹配')
    source = local(root, request['input']['scriptFile']).read_text(encoding='utf-8')
    assets = {a['id']: a for a in read(local(root, request['input']['assetsManifest']))['assets']}
    ids, intervals = set(), []
    for scene in plan['scenes']:
        require(scene['id'] not in ids, '分镜 ID 重复'); ids.add(scene['id'])
        mapped = ''
        for span in scene['sourceMapping']:
            start, end = span['start'], span['end']
            require(0 <= start < end <= len(source), '原文映射越界')
            intervals.append((start, end)); mapped += source[start:end]
        if confirmed and scene.get('editReason'):
            require(bool(scene['text'].strip()), '编辑后文本为空')
        else:
            require(mapped == scene['text'], '分镜文本与原文映射不符')
        require(all(a in assets for a in scene['assetRefs']), '未知源素材引用')
        timing = scene['timing']
        require(timing['totalSeconds'] >= timing['speechSeconds'], '总时长小于口播时长')
        if timing['kind'] == 'estimated':
            low, high = timing['totalRangeSeconds']
            require(low <= timing['totalSeconds'] <= high, '估算时长不在总时长区间内')
        else:
            audio = local(root, timing['audioFile'])
            require(digest(audio) == timing['audioSha256'], '实测音频摘要不一致')
            from stage_media import audio_info
            require(abs(audio_info(audio)['durationSeconds'] - timing['speechSeconds']) <= .05, '实测口播时长与音频不符')
        blocks = scene['production'].get('visualBlocks', [])
        block_ids = [b.get('id') for b in blocks]
        require(len(set(block_ids)) == len(block_ids) and all(block_ids), '内部视觉段落 ID 无效')
    if confirmed:
        return {'sceneCount': len(ids), 'sourceCodepoints': len(source), 'inputDigest': plan['inputDigest']}
    # 非口播部分也显式定位，不能靠删空白掩盖漏稿、重复或乱序。
    spoken = intervals[:]
    require(spoken == sorted(spoken), '口播顺序与原稿不一致')
    for part in plan['nonspoken']:
        start, end = part['start'], part['end']
        require(part['text'].isspace(), '非口播仅可记录原稿空白')
        require(0 <= start < end <= len(source) and source[start:end] == part['text'], '非口播映射错误')
        intervals.append((start, end))
    position = 0
    for start, end in sorted(intervals):
        require(start == position, '稿件存在遗漏或重复；空白也需归入映射')
        position = end
    require(position == len(source), '稿件未完整覆盖')
    for preview in plan['previews']:
        local(root, preview)
    return {'sceneCount': len(ids), 'sourceCodepoints': len(source), 'inputDigest': plan['inputDigest']}


def storyboard(request_path, result_path):
    """本地完整任务的文本结果适配；ID、源映射和展示估时由程序生成。"""
    root, request = load_request(request_path, 'analysis')
    result = read(result_path)
    require(isinstance(result, dict) and set(result) == {'status','scenes','error'}, '文本结果结构无效', 'ANALYSIS_RESULT_INVALID')
    if result['status'] == 'failed':
        error = result['error']
        require(result['scenes'] == [] and isinstance(error, dict), '失败结构无效', 'ANALYSIS_RESULT_INVALID')
        raise StageError(error['code'], error['message'], error['retryable'])
    require(result['status'] == 'candidate' and result['error'] is None and isinstance(result['scenes'], list)
            and 1 <= len(result['scenes']) <= 200, '文本分镜为空或无效', 'ANALYSIS_RESULT_INVALID')
    source = local(root, request['input']['scriptFile']).read_text(encoding='utf-8')
    position, scenes, nonspoken = 0, [], []
    def whitespace():
        nonlocal position
        start = position
        while position < len(source) and source[position].isspace(): position += 1
        if start < position: nonspoken.append({'start':start,'end':position,'text':source[start:position],'reason':'原稿空白'})
    for index, item in enumerate(result['scenes']):
        require(isinstance(item, dict) and set(item) == {'text'} and isinstance(item['text'], str), '文本结构无效', 'ANALYSIS_RESULT_INVALID')
        text = item['text'].strip()
        require(text and len(text.encode('utf-16-le'))//2 <= 4000, '文本长度无效', 'ANALYSIS_RESULT_INVALID')
        require(not re.search(r'[。！？!?][”’」』"\']*\s*[^\s。！？!?”’」』"\']', text), '一项文本包含多句口播', 'ANALYSIS_RESULT_INVALID')
        whitespace(); start = position
        require(source[start:start+len(text)] == text, '文本与原稿顺序或正文不符', 'ANALYSIS_RESULT_INVALID')
        position += len(text)
        seconds = sum(not c.isspace() for c in text)/5
        scenes.append({'id':f'scene_{index+1:03d}','text':text,
          'sourceMapping':[{'start':start,'end':position,'unit':'unicode_codepoints'}],
          'timing':{'kind':'estimated','speechSeconds':seconds,'totalSeconds':seconds,'totalRangeSeconds':[seconds,seconds],
            'basis':'每秒 5 个非空白 Unicode 字符，仅供展示'},'assetRefs':[],'production':{}})
    whitespace()
    require(position == len(source), '文本分镜遗漏原稿', 'ANALYSIS_RESULT_INVALID')
    plan = {'contractVersion':VERSION,'taskId':request['taskId'],'inputDigest':json_digest(request['snapshot']),
      'scenes':scenes,'nonspoken':nonspoken,'previews':[],'requirementsNotes':'完整要求见任务输入；本阶段仅输出文本分镜'}
    validate_plan(root, request, plan)
    file = root/'analysis/plan.json'; write(file, plan)
    return validate(request_path, file)


def save_request(root, job, request, name):
    schema(request, 'request')
    write(root / name, request)
    job['requests'][name] = digest(root / name)
    write(root / 'job.json', job)
    prompt = (f'使用 $video-pipeline，读取阶段输入 {root / name}。本轮只执行 {request["stage"]}。'
              '先阅读 video-pipeline 的 two-stage-contract.md。'
              '只使用输入快照列出的业务资料和必要通用工具；可查看冻结模板内获准参考片，不读取其他任务或未授权历史资料。'
              '按阶段协议保存结果后结束；不得从 analysis 自动进入 render。\n')
    (root / name).with_suffix('.prompt.md').write_text(prompt, encoding='utf-8')
    return {'request': str(root / name), 'prompt': str((root / name).with_suffix('.prompt.md'))}


def init_job(root, spec):
    """只复制显式白名单文件；不递归复制整个模板/历史工程。"""
    schema(spec, 'submission')
    root = Path(root).resolve()
    require(not root.exists(), '任务目录已存在；请使用 status/resume', 'TASK_EXISTS')
    files = []
    for role in ('scriptFile', 'requirementsFile', 'templateFile'):
        files.append((role, Path(spec[role]).expanduser().resolve()))
    for asset in spec['assets']:
        files.append(('asset:' + asset['id'], Path(asset['path']).expanduser().resolve()))
    require(len({a['id'] for a in spec['assets']}) == len(spec['assets']), '素材 ID 重复')
    for _, file in files:
        require(file.is_file() and file.stat().st_size, f'缺少白名单文件：{file}', 'MISSING_INPUT')
        require(file.name != '.env' and not file.name.startswith('.env.'), '不得复制凭据文件')
    root.mkdir(parents=True)
    snapshot, destinations = {}, {}
    for index, (role, file) in enumerate(files):
        name = f'input/files/{index:03d}{file.suffix}'
        target = local(root, name, exists=False); target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)
        destinations[role] = name; snapshot[name] = digest(target)
    assets = [{**a, 'sourcePath': a['path'], 'path': destinations['asset:' + a['id']], 'sha256': snapshot[destinations['asset:' + a['id']]]} for a in spec['assets']]
    write(root / 'input/assets.json', {'assets': assets})
    template = {'sourcePath': spec['templateFile'], 'document': destinations['templateFile'], 'sha256': snapshot[destinations['templateFile']], 'attachments': [a['id'] for a in assets if a['kind'] == 'reference']}
    template_dir = Path(spec['templateFile']).expanduser().resolve().parent
    if (template_dir / 'renderer/renderer-manifest.json').is_file():
        # 与 Worker 一样冻结选定模板的完整依赖，不能只保存正文路径。
        for file in sorted(template_dir.rglob('*')):
            relative = file.relative_to(template_dir)
            if any(part in ('node_modules', '.git', '__pycache__') for part in relative.parts): continue
            require(not file.is_symlink(), '模板快照不能包含符号链接')
            if not file.is_file(): continue
            require(not file.name.startswith('.env'), '模板不能包含凭据文件')
            name = 'input/template/' + relative.as_posix()
            target = local(root, name, exists=False); target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target); snapshot[name] = digest(target)
        template.update(root='input/template', document='input/template/' + Path(spec['templateFile']).name)
    write(root / 'input/template.json', template)
    for name in ('input/assets.json', 'input/template.json'):
        snapshot[name] = digest(root / name)
    job = {'contractVersion': VERSION, 'taskId': spec['taskId'], 'requests': {}, 'createdAt': time.time()}
    request = {'contractVersion': VERSION, 'taskId': spec['taskId'], 'runId': 'analysis_001', 'stage': 'analysis',
               'input': {'scriptFile': destinations['scriptFile'], 'requirementsFile': destinations['requirementsFile'],
                         'templateSnapshot': 'input/template.json', 'assetsManifest': 'input/assets.json'},
               'snapshot': snapshot, 'confirmation': None, 'previousArtifacts': None,
               'outputSpec': spec['outputSpec'], 'limits': spec.get('limits', {'executionSeconds': 14400, 'repairRounds': 10}),
               'delivery': {'kind': 'analysis_plan', 'includeWholeVideo': spec.get('includeWholeVideo', False)}}
    return save_request(root, job, request, 'analysis/request.json')


def confirm(request_path, plan_path, base_version, source):
    root, request = load_request(request_path, 'analysis')
    require(bool(source.strip()), '确认来源不能为空')
    with lock(root / '.operation.lock'):
        # 与本任务正式执行互斥；不能在配音/制作过程中改变确认。
        with lock(root / '.execution.lock'):
            require(not active_processes(root), '本任务仍有制作进程，不能更新确认', 'TASK_BUSY')
            current_path = root / 'confirmation/current.json'
            current = read(current_path) if current_path.exists() else None
            require(base_version == (current['planVersion'] if current else 0), '确认基版本过期', 'STALE_CONFIRMATION')
            require((root / 'analysis/result.json').exists(), '请先 validate 完成 analysis')
            analysis_result = read(root / 'analysis/result.json')
            require(analysis_result['status'] == 'candidate', 'analysis 尚未通过校验')
            require(digest(local(root, analysis_result['planFile'])) == analysis_result['planSha256'], '已审查 analysis 方案被修改；编辑请另存文件或重新 validate')
            plan = read(plan_path)
            validate_plan(root, request, plan, confirmed=True)
            version = base_version + 1
            name = f'confirmation/v{version}/plan.json'
            require(not (root / name).exists(), '该版本已存在')
            write(root / name, plan)
            record = {'planVersion': version, 'planFile': name, 'planSha256': digest(root / name)}
            write(root / f'confirmation/v{version}/record.json', {**record, 'source': source, 'confirmedAt': time.time(), 'analysisPlanSha256': analysis_result['planSha256']})
            write(current_path, record)
            run = f'render_{version:03d}'
            new = {**request, 'runId': run, 'stage': 'render', 'confirmation': record,
                   'delivery': {**request['delivery'], 'kind': 'scene_mp4'}}
            # 只暴露已验证的本任务旧结果，模型决定能否复用。
            previous = root / f'render/render_{base_version:03d}/result.json'
            if previous.exists():
                new['previousArtifacts'] = str(previous.relative_to(root))
            return save_request(root, read(root / 'job.json'), new, f'render/{run}/request.json')


def result_base(request):
    return {k: request[k] for k in ('contractVersion', 'taskId', 'runId', 'stage')}


def validate(request_path, artifact_path):
    root, request = load_request(request_path)
    with lock(root / '.operation.lock'):
        artifact = Path(artifact_path).resolve()
        require(artifact.is_relative_to(root), '结果必须在任务内')
        value = read(artifact)
        if request['stage'] == 'analysis':
            details = validate_plan(root, request, value)
            # 同任务后续分析允许保留此前媒体；阶段授权由当前请求决定。
            result = {**result_base(request), 'status': 'candidate', 'planFile': str(artifact.relative_to(root)), 'planSha256': digest(artifact), **details}
        else:
            from stage_media import validate_delivery
            details = validate_delivery(root, request, value)
            result = {**result_base(request), 'status': 'candidate', 'manifestFile': str(artifact.relative_to(root)), 'manifestSha256': digest(artifact), **details}
        # 长时间媒体校验结束前再次校验版本和输入。
        load_request(request_path)
        write(Path(request_path).parent / 'result.json', result)
        return result


@contextmanager
def execution(request_path, action):
    root, request = load_request(request_path, 'render')
    with lock(root / '.execution.lock'):
        root, request = load_request(request_path, 'render')
        require(not active_processes(root), '本任务仍有活跃制作进程，请先检查已有进程', 'TASK_BUSY')
        path = execution_path(root, request_path)
        state = read(path) if path.exists() else {'elapsedSeconds': 0, 'repairRounds': 0, 'operations': []}
        require(not state.get('stopReason'), state.get('stopReason', ''), 'REPAIR_BUDGET_EXHAUSTED')
        require(state['repairRounds'] == 0 or state['repairRounds'] < request['limits']['repairRounds'],
                '修复轮数已耗尽', 'REPAIR_BUDGET_EXHAUSTED')
        # 进程被杀时按剩余墙钟保守计费；正常外部等待不计入阶段预算。
        if state.get('activeSince'):
            state['elapsedSeconds'] += max(0, time.time() - state['activeSince'])
        remaining = request['limits']['executionSeconds'] - state['elapsedSeconds']
        require(remaining > 0, '阶段执行预算耗尽', 'BUDGET_EXHAUSTED')
        state['activeSince'] = time.time(); state['activeAction'] = action
        write(path, state)
        try:
            yield root, request, remaining
        except Exception as exc:
            if getattr(exc, 'code', '') == 'TASK_CANCELLED':
                # 主动取消或资源避让不是制作失败；仍由 finally 结算实际墙钟。
                state.setdefault('events', []).append({'action': action, 'code': 'TASK_CANCELLED',
                                                       'message': str(exc), 'at': time.time()})
                raise
            if getattr(exc, 'code', '') in ('TIMELINE_EXTEND_REQUIRED', 'CONTENT_TIMELINE_REQUIRED', 'MIX_REBUILD_REQUIRED'):
                # 正常时间轴协商不扣修复次数；同一混音、同一帧数不得无进展重试。
                key = json_digest({'action': action, 'details': exc.details})
                adjustments = state.setdefault('timelineAdjustments', [])
                if any(item['key'] == key for item in adjustments):
                    state['stopReason'] = '相同混音与帧数重复请求补帧，必须先修正时间轴，禁止原样重试'
                    raise StageError('TIMELINE_ADJUSTMENT_STALLED', state['stopReason'], details=exc.details) from exc
                adjustments.append({'key': key, 'action': action, 'details': exc.details, 'at': time.time()})
                raise
            # 工具内部失败也计数，不依赖模型主动调用 repair 或结束 turn。
            code = getattr(exc, 'code', 'EXECUTION_FAILED')
            previous = state.setdefault('failures', {}).get(action, {})
            count = previous.get('consecutive', 0) + 1 if previous.get('code') == code else 1
            state['failures'][action] = {'code': code, 'consecutive': count, 'message': str(exc)}
            state['repairRounds'] += 1
            state.setdefault('repairs', []).append({'action': action, 'code': code, 'reason': str(exc), 'at': time.time()})
            if count >= 3 or state['repairRounds'] >= request['limits']['repairRounds']:
                state['stopReason'] = f'{action} 连续失败 {count} 次，累计失败/修复 {state["repairRounds"]} 次；最后错误 {code}: {exc}'
                raise StageError('REPAIR_BUDGET_EXHAUSTED', state['stopReason'], details=getattr(exc, 'details', None)) from exc
            raise
        else:
            state.setdefault('failures', {}).pop(action, None)
        finally:
            state['elapsedSeconds'] += time.time() - state.pop('activeSince')
            state['operations'].append({'action': action, 'endedAt': time.time()})
            state.pop('activeAction', None); write(path, state)


def repair(request_path, reason):
    root, request = load_request(request_path, 'render')
    with lock(root / '.execution.lock'):
        path = Path(request_path).resolve().parent / 'execution.json'
        state = read(path) if path.exists() else {'elapsedSeconds': 0, 'repairRounds': 0, 'operations': []}
        require(state['repairRounds'] < request['limits']['repairRounds'], '修复轮数已耗尽', 'BUDGET_EXHAUSTED')
        state['repairRounds'] += 1
        state.setdefault('repairs', []).append({'reason': reason, 'at': time.time()})
        if state['repairRounds'] >= request['limits']['repairRounds']:
            state['stopReason'] = '手工修复已用尽阶段修复预算'
        write(path, state)
        return state


def checkpoint(request_path, step, files):
    root, request = load_request(request_path)
    identifier(step)
    with lock(root / '.operation.lock'):
        path = Path(request_path).resolve().parent / 'checkpoint.json'
        data = read(path) if path.exists() else {'requestSha256': digest(request_path), 'steps': {}}
        require(data['requestSha256'] == digest(request_path), 'checkpoint 输入不匹配')
        evidence = {name: digest(local(root, name)) for name in files}
        require(evidence, 'checkpoint 需要实际文件')
        data['steps'][step] = {'files': evidence, 'at': time.time()}
        write(path, data)
        return data


def status(request_path):
    root, request = load_request(request_path)
    path = Path(request_path).resolve().parent / 'checkpoint.json'
    data = read(path) if path.exists() else {'steps': {}}
    verified, invalid = [], []
    for step, record in data['steps'].items():
        try:
            require(all(digest(local(root, n)) == h for n, h in record['files'].items()), '产物已改变')
            verified.append(step)
        except (OSError, StageError):
            invalid.append(step)
    return {**result_base(request), 'verifiedSteps': verified, 'invalidSteps': invalid,
            'activeProcesses': active_processes(root), 'note': 'checkpoint 不代替媒体校验。'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    init = sub.add_parser('init'); init.add_argument('--job-dir', type=Path, required=True); init.add_argument('--spec', type=Path, required=True)
    for name in ('confirm', 'validate', 'status', 'checkpoint', 'repair'):
        command = sub.add_parser(name); command.add_argument('--request', type=Path, required=True)
        if name in ('confirm', 'validate'): command.add_argument('--artifact', type=Path, required=True)
        if name == 'confirm': command.add_argument('--base-version', type=int, required=True); command.add_argument('--source', required=True)
        if name == 'checkpoint': command.add_argument('--step', required=True); command.add_argument('--files', nargs='+', required=True)
        if name == 'repair': command.add_argument('--reason', required=True)
    text_result = sub.add_parser('storyboard'); text_result.add_argument('--request', type=Path, required=True); text_result.add_argument('--result', type=Path, required=True)
    a = p.parse_args()
    try:
        if a.command == 'init': result = init_job(a.job_dir, read(a.spec))
        elif a.command == 'storyboard': result = storyboard(a.request, a.result)
        elif a.command == 'confirm': result = confirm(a.request, a.artifact, a.base_version, a.source)
        elif a.command == 'validate': result = validate(a.request, a.artifact)
        elif a.command == 'checkpoint': result = checkpoint(a.request, a.step, a.files)
        elif a.command == 'repair': result = repair(a.request, a.reason)
        else: result = status(a.request)
        print(json.dumps(result, ensure_ascii=False)); return 0
    except (StageError, OSError, ValueError, KeyError, ImportError) as exc:
        print(json.dumps(failure(getattr(a, 'request', None), a.command, exc), ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
