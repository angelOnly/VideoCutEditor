#!/usr/bin/env python3
"""独立 video-pipeline 输入输出适配；Worker 不参与文本和制作结果转换。"""
from __future__ import annotations
import argparse
from copy import deepcopy
from pathlib import Path
import sys
import json
import hashlib
from two_stage import (VERSION, StageError, read, write, local, require, identifier, digest,
                       json_digest, schema, storyboard, validate, validate_plan, active_execution,
                       active_processes)

PROTOCOL = 'video-pipeline-io/1'


def load(entry_path):
    entry_path = Path(entry_path).resolve()
    root = entry_path.parents[2]
    entry = read(entry_path)
    require(entry.get('protocol') == PROTOCOL and entry.get('stage') in ('analysis', 'render'), '任务信封无效')
    require(local(root, entry['requestFile']).parent == entry_path.parent, '请求不属于当前消息')
    local(root, entry['attachmentsFile'])
    local(root, entry['resultFile'], exists=False)
    return root, entry, read(local(root, entry['requestFile'])), read(local(root, entry['attachmentsFile']))


def binding(root, entry_path):
    return root/'work/io'/Path(entry_path).parent.name/'binding.json'


def ensure_render_is_idle(root, entry_path, entry):
    """媒体仍在运行时不允许写任何终态，避免 Worker 清理掉后台批渲染。"""
    if entry['stage'] != 'render': return
    saved_path = binding(root, entry_path)
    if not saved_path.exists(): return
    request_path = local(root, read(saved_path)['request'])
    active = []
    owner = active_execution(request_path)
    if owner: active.append(owner)
    work_prefix = str(request_path.parent.relative_to(root) / 'work') + '/'
    active.extend(item for item in active_processes(root) if item['record'].startswith(work_prefix))
    if active:
        details = '、'.join(f"{item.get('action', '媒体进程')}（PID {item['pid']}）" for item in active)
        require(False, f'当前 Render 仍有活跃制作进程：{details}；请等待当前批次完成', 'TASK_BUSY')


def prepare(entry_path):
    root, entry, raw, attachments = load(entry_path)
    target = binding(root, entry_path)
    if target.exists():
        saved = read(target)
        require(saved['requestHash'] == digest(local(root, entry['requestFile'])), '原始请求发生变化')
        return saved
    message = identifier(Path(entry_path).parent.name)
    directory = root/'work/io'/message
    directory.mkdir(parents=True, exist_ok=True)
    if entry['stage'] == 'analysis':
        script = directory/'script.txt'; script.write_text(raw['script'], encoding='utf-8')
        requirements = directory/'requirements.json'
        write(requirements, {'requirements': raw['otherRequirements'], 'plugin': raw['plugin'], 'narration': raw.get('narration')})
        template = attachments.get('template')
        require(template and template.get('document'), '缺少模板文件', 'MISSING_INPUT')
        local(root, template['document'])
        output_spec = raw.get('outputSpec', {'width': 1080, 'height': 1920, 'fps': 30})
        assets = attachments['assets']
        plan = None
    else:
        previous = attachments.get('previousAnalysis')
        require(previous, '缺少本任务分析入口', 'MISSING_INPUT')
        old_root, old_entry, old_raw, old_attachments = load(local(root, previous))
        require(old_root == root and old_entry['taskId'] == entry['taskId'], '分析身份不符')
        # Render 以原始输入和当前确认列表为准；不要求上次 Codex 使用过同一转换器。
        script = directory/'script.txt'; script.write_text(old_raw['script'], encoding='utf-8')
        requirements = directory/'requirements.json'
        write(requirements, {'requirements': old_raw['otherRequirements'], 'plugin': old_raw['plugin'], 'narration': old_raw.get('narration')})
        template = old_attachments.get('template')
        require(template and template.get('document'), '缺少原任务模板', 'MISSING_INPUT')
        local(root, template['document'])
        output_spec = old_raw.get('outputSpec', {'width': 1080, 'height': 1920, 'fps': 30})
        assets = list({a['id']: a for a in [*old_attachments['assets'], *attachments['assets']]}.values())
        plan = {'contractVersion': VERSION, 'taskId': entry['taskId'], 'inputDigest': '',
                'scenes': [], 'nonspoken': [], 'previews': [], 'requirementsNotes': '完整要求见原始输入，口播服从当前确认列表'}
        scenes = []
        for item in raw['dataList']:
            require(item['id'] not in ('whole', 'whole-video'), '分镜 ID 与整片保留 ID 冲突')
            identifier(item['id']); text = item['content']
            require(isinstance(text, str) and text.strip(), '确认口播不能为空')
            extra = item.get('extraData') or {}
            materials = [*extra.get('picInfoList', []), *extra.get('videoInfoList', [])]
            seconds = sum(not c.isspace() for c in text)/5
            production = deepcopy(item.get('production') or {})
            if item.get('visualPlan'): production['visualPlan'] = deepcopy(item['visualPlan'])
            if extra.get('keywordList'): production['keywordList'] = extra['keywordList']
            if materials: production['materials'] = materials
            scenes.append({'id': item['id'], 'text': text, 'sourceMapping': [], 'assetRefs': list(dict.fromkeys(a['assetId'] for a in materials)),
                           'production': production, 'editReason': '客户端完整确认列表',
                           'timing': {'kind': 'estimated', 'speechSeconds': seconds, 'totalSeconds': seconds,
                                      'totalRangeSeconds': [seconds, seconds], 'basis': '每秒 5 个非空白字符，仅供展示'}})
        plan.update(scenes=scenes, previews=[])
    # 模板内资源也是明确提供的源素材；登记原路径与摘要，供现有终检如实核对。
    assets = deepcopy(assets)
    template_root = local(root, template['root'], exists=False) if template.get('root') else None
    if template_root: require(template_root.is_dir(), '模板目录不存在', 'MISSING_INPUT')
    template_files = sorted(template_root.rglob('*')) if template_root else [local(root, template['document'])]
    known_paths = {a['path'] for a in assets}
    known_ids = {a['id'] for a in assets}
    for file in template_files:
        require(not file.is_symlink(), '模板不得包含外部链接')
        if not file.is_file(): continue
        relative_file = str(file.relative_to(root))
        if relative_file in known_paths: continue
        name = str(file.relative_to(template_root)) if template_root else file.name
        asset_id = 'template-' + hashlib.sha256(name.encode()).hexdigest()
        require(asset_id not in known_ids, '模板素材 ID 与输入素材冲突')
        known_ids.add(asset_id)
        assets.append({'id': asset_id, 'path': relative_file, 'kind': 'source', 'sha256': digest(file)})
    template_file = directory/'template.json'; write(template_file, template)
    assets_file = directory/'assets.json'; write(assets_file, {'assets': assets})
    def relative(p): return str(p.relative_to(root))
    snapshot = {relative(p): digest(p) for p in [script, requirements, template_file, assets_file]}
    for asset in assets: snapshot[asset['path']] = digest(local(root, asset['path']))
    request = {'contractVersion': VERSION, 'taskId': entry['taskId'], 'runId': message, 'stage': entry['stage'],
               'input': {'scriptFile': relative(script), 'requirementsFile': relative(requirements),
                         'templateSnapshot': relative(template_file), 'assetsManifest': relative(assets_file)},
               'snapshot': snapshot, 'confirmation': None, 'previousArtifacts': None, 'outputSpec': output_spec,
               'limits': {'executionSeconds': 14400, 'repairRounds': 10},
               'delivery': {'kind': 'analysis_plan' if entry['stage'] == 'analysis' else 'scene_mp4', 'includeWholeVideo': entry['stage'] == 'render'}}
    if plan is not None:
        plan['inputDigest'] = json_digest(snapshot)
        plan_file = directory/'confirmed.json'; write(plan_file, plan)
        current = root/'confirmation/current.json'
        version = read(current)['planVersion']+1 if current.exists() else 1
        request['confirmation'] = {'planVersion': version, 'planFile': relative(plan_file), 'planSha256': digest(plan_file)}
        validate_plan(root, request, plan, confirmed=True)
        write(current, request['confirmation'])
    request_file = (directory if entry['stage'] == 'analysis' else root/'render'/message)/'request.json'
    schema(request, 'request'); write(request_file, request)
    job = read(root/'job.json') if (root/'job.json').exists() else {'contractVersion': VERSION, 'taskId': entry['taskId'], 'requests': {}}
    require(job['taskId'] == entry['taskId'], '任务根身份不符')
    job['requests'][relative(request_file)] = digest(request_file); write(root/'job.json', job)
    saved = {'request': relative(request_file), 'requestHash': digest(local(root, entry['requestFile'])), 'plan': relative(directory/'plan.json')}
    write(target, saved)
    return saved


def finish(entry_path, status, result=None, files=None, error=None):
    root, entry, _, _ = load(entry_path)
    require(status in ('completed', 'needs_input', 'failed'), '状态无效')
    require((status == 'completed' and result is not None and error is None) or (status != 'completed' and error), '结果状态不一致')
    ensure_render_is_idle(root, entry_path, entry)
    files = files or []
    require(len({f['id'] for f in files}) == len(files), '文件 ID 重复')
    for file in files: identifier(file['id']); local(root, file['path'])
    identity = {k: entry[k] for k in ('protocol', 'taskId', 'requestId', 'stage')}
    write(local(root, entry['resultFile'], exists=False), {**identity, 'status': status, 'result': result, 'files': files, 'error': error})
    return {**identity, 'resultFile': entry['resultFile']}


def complete_analysis(entry_path, text_result):
    root, entry, _, _ = load(entry_path)
    require(entry['stage'] == 'analysis', '当前不是分析阶段')
    saved = prepare(entry_path)
    storyboard(local(root, saved['request']), local(root, text_result))
    plan = read(root/'analysis/plan.json'); write(root/saved['plan'], plan)
    data = [{'id': s['id'], 'content': s['text'], 'dur': s['timing']['totalSeconds'], 'durationSource': 'estimated',
             'production': {}, 'extraData': {'keywordList': [], 'digitalHumanId': '', 'videoInfoList': [], 'picInfoList': [], 'resources': []}} for s in plan['scenes']]
    return finish(entry_path, 'completed', {'dataList': data, 'plan': plan})


def complete_render(entry_path, manifest_path):
    root, entry, raw, _ = load(entry_path)
    require(entry['stage'] == 'render', '当前不是制作阶段')
    ensure_render_is_idle(root, entry_path, entry)
    saved = read(binding(root, entry_path))
    request_path = local(root, saved['request'])
    manifest_file = local(root, manifest_path)
    # 交付入口兜底合片；已有整片只做终检，损坏时禁止静默替换或回调成功。
    if read(manifest_file).get('wholeVideo') is None:
        from stage_media import assemble
        assemble(request_path, manifest_file)
    # 制作终检属于 toolkit，由 Codex 显式调用；Worker 不运行此函数。
    validate(request_path, manifest_file)
    manifest = read(manifest_file)
    whole = manifest['wholeVideo']
    spec = read(request_path)['outputSpec']
    require(all(item['id'] not in ('whole', 'whole-video') for item in raw['dataList']), '分镜 ID 与整片保留 ID 冲突')
    data = [{'id': 'whole-video', 'content': '\n'.join(item['content'] for item in raw['dataList']),
             'dur': whole['durationSeconds'], 'durationSource': 'measured', 'artifactRef': 'video-whole',
             'extraData': {'kind': 'wholeVideo', 'sceneCount': len(manifest['scenes']),
                           **spec, 'sha256': whole['sha256']}}]
    files = [{'id': 'video-whole', 'path': whole['path']}]
    for item in raw['dataList']:
        scene = next(s for s in manifest['scenes'] if s['id'] == item['id'])
        ref = 'video-' + identifier(item['id'])
        data.append({**deepcopy(item), 'dur': scene['durationSeconds'], 'durationSource': 'measured', 'artifactRef': ref})
        data[-1].pop('url', None)
        files.append({'id': ref, 'path': scene['path']})
    return finish(entry_path, 'completed', {'dataList': data}, files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'analysis', 'render', 'needs_input', 'failed'])
    parser.add_argument('--task', type=Path, required=True)
    parser.add_argument('--result'); parser.add_argument('--manifest'); parser.add_argument('--code'); parser.add_argument('--message')
    args = parser.parse_args()
    try:
        if args.command == 'prepare': value = prepare(args.task)
        elif args.command == 'analysis': value = complete_analysis(args.task, args.result)
        elif args.command == 'render': value = complete_render(args.task, args.manifest)
        else:
            require(args.code and args.message, '失败或等待输入需填写 code/message')
            value = finish(args.task, args.command, error={'code': args.code, 'message': args.message})
        print(json.dumps(value, ensure_ascii=False)); return 0
    except (StageError, OSError, ValueError, KeyError, TypeError, ImportError) as exc:
        print(json.dumps({'error': {'code': getattr(exc, 'code', 'TASK_IO_ERROR'), 'message': str(exc)}}, ensure_ascii=False)); return 1


if __name__ == '__main__': sys.exit(main())
