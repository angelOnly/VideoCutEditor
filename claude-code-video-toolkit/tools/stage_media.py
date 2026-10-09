#!/usr/bin/env python3
"""两阶段通用媒体执行与验证，不包含模板布局或角色决策。"""
from __future__ import annotations

import argparse
from contextlib import nullcontext
import threading
import uuid
from array import array
import errno
from fractions import Fraction
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

from two_stage import (StageError, digest, execution, identifier, json_digest, load_request,
                       local, read, require, schema, write, process_signature, failure)
from finance_timeline import derive_timeline
from actual_timeline import sample_frames, extend_timeline, check_fixed_ending


_BATCH_CONTEXT = threading.local()

def check_batch():
    check = getattr(_BATCH_CONTEXT, "check", None)
    if check: check()


def _cgroup_value(path):
    """读取 cgroup 单值；内核或运行环境未提供时保守地返回 None。"""
    try:
        value = Path(path).read_text(encoding='utf-8').strip()
    except OSError:
        return None
    if not value or value == 'max': return None
    try:
        return int(value)
    except ValueError:
        return None


def _cgroup_events(path):
    try:
        rows = Path(path).read_text(encoding='utf-8').splitlines()
    except OSError:
        return {}
    events = {}
    for row in rows:
        parts = row.split()
        if len(parts) != 2: continue
        try: events[parts[0]] = int(parts[1])
        except ValueError: continue
    return events


def cgroup_metrics(cgroup_root=Path('/sys/fs/cgroup'), process_cgroup=Path('/proc/self/cgroup')):
    """返回当前 Linux cgroup v2 的轻量资源快照，非 Linux 或不可见时不影响渲染。"""
    if sys.platform != 'linux': return None
    try:
        relative = None
        for row in Path(process_cgroup).read_text(encoding='utf-8').splitlines():
            hierarchy, controllers, value = row.split(':', 2)
            if hierarchy == '0' and not controllers:
                relative = Path(value.lstrip('/'))
                break
        if relative is None or '..' in relative.parts: return None
        directory = Path(cgroup_root) / relative
        if not directory.is_dir(): return None
    except (OSError, ValueError):
        return None
    return {
        'pids': {
            'current': _cgroup_value(directory / 'pids.current'),
            'max': _cgroup_value(directory / 'pids.max'),
            'peak': _cgroup_value(directory / 'pids.peak'),
        },
        'pidsEvents': _cgroup_events(directory / 'pids.events'),
        'memory': {
            'current': _cgroup_value(directory / 'memory.current'),
            'peak': _cgroup_value(directory / 'memory.peak'),
        },
    }


class CgroupUsage:
    """在一个渲染子进程生命周期内累计 cgroup 峰值和 PID 拒绝事件。"""
    def __init__(self, cgroup_root=Path('/sys/fs/cgroup'), process_cgroup=Path('/proc/self/cgroup')):
        self.cgroup_root, self.process_cgroup = cgroup_root, process_cgroup
        self.before = cgroup_metrics(cgroup_root, process_cgroup)
        self.latest = self.before
        self.peaks = {'pidsCurrent': None, 'memoryCurrent': None}
        self.observe()

    def observe(self):
        snapshot = cgroup_metrics(self.cgroup_root, self.process_cgroup)
        if snapshot is None: return None
        self.latest = snapshot
        for source, target in (('pids', 'pidsCurrent'), ('memory', 'memoryCurrent')):
            value = snapshot[source]['current']
            if value is not None and (self.peaks[target] is None or value > self.peaks[target]):
                self.peaks[target] = value
        return snapshot

    def process_limit_exceeded(self):
        if not self.before or not self.latest: return False
        return self.latest['pidsEvents'].get('max', 0) > self.before['pidsEvents'].get('max', 0)

    def diagnostics(self):
        if not self.latest: return None
        return {
            'pids': {
                **self.latest['pids'],
                'currentPeakObserved': self.peaks['pidsCurrent'],
                'eventsBefore': self.before['pidsEvents'] if self.before else {},
                'eventsAfter': self.latest['pidsEvents'],
            },
            'memory': {
                **self.latest['memory'],
                'currentPeakObserved': self.peaks['memoryCurrent'],
            },
        }


def process_limit_error(usage):
    return StageError(
        'PROCESS_LIMIT_EXCEEDED',
        '当前渲染任务触达进程或线程上限，已停止继续派发新分镜',
        details={'resourceMetrics': usage.diagnostics()},
    )


def render_failure_code(tail, usage):
    """优先归因 cgroup；仅将明显的公共浏览器启动故障视为批次级故障。"""
    if usage.process_limit_exceeded(): return 'PROCESS_LIMIT_EXCEEDED'
    if 'TASK_LAYOUT_INVALID' in tail: return 'TASK_LAYOUT_INVALID'
    lowered = tail.lower()
    browser_failures = (
        'could not find browser',
        'failed to launch the browser process',
        'failed to launch browser',
        'browser has disconnected',
        'browser is not open',
    )
    if any(value in lowered for value in browser_failures): return 'BROWSER_UNAVAILABLE'
    return 'RENDER_FAILED'


def command(argv, timeout=120):
    check_batch()
    started = time.monotonic()
    child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    process_dir = getattr(_BATCH_CONTEXT, 'process_dir', None)
    process_record = Path(process_dir) / ('batch-media-' + uuid.uuid4().hex + '.process.json') if process_dir else None
    record = {'state': 'running', 'pid': child.pid, 'signature': process_signature(child.pid), 'startedAt': time.time()}
    if process_record: write(process_record, record)
    try:
        while True:
            check_batch()
            try:
                output, error = child.communicate(timeout=min(.2, max(.01, timeout)))
                break
            except subprocess.TimeoutExpired:
                if time.monotonic() - started >= timeout:
                    raise StageError('TOOL_TIMEOUT', '媒体工具超时', True)
        require(child.returncode == 0, error.decode(errors='replace')[-3000:], 'MEDIA_INVALID')
        return output
    finally:
        try: os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        child.wait()
        if child.stdout: child.stdout.close()
        if child.stderr: child.stderr.close()
        if process_record: write(process_record, {**record, 'state': 'ended', 'endedAt': time.time()})



def probe(path):
    return json.loads(command([os.environ.get('FFPROBE', 'ffprobe'), '-v', 'error', '-count_frames',
                               '-show_streams', '-show_format', '-of', 'json', str(path)]))


def ffmpeg(*args, timeout=600):
    return command([os.environ.get('FFMPEG', 'ffmpeg'), '-nostdin', '-v', 'error', *map(str, args)], timeout)


def publish_file(source, destination):
    """发布媒体；跨挂载点时先在目标目录完整复制，再原子替换。"""
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.replace(source, destination)
        return
    except OSError as exc:
        if exc.errno != errno.EXDEV:
            raise

    # Worker 的 render 与 output 目录可能分别被隔离挂载，不能直接 rename。
    fd, temporary_name = tempfile.mkstemp(dir=destination.parent, prefix='.publish-', suffix=destination.suffix)
    temporary = Path(temporary_name)
    try:
        with source.open('rb') as original, os.fdopen(fd, 'wb') as copied:
            shutil.copyfileobj(original, copied)
            copied.flush()
            os.fsync(copied.fileno())
        require(digest(temporary) == digest(source), '跨挂载发布后的媒体摘要不一致', 'MEDIA_INVALID')
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def audio_info(path):
    data = probe(path)
    audios = [s for s in data['streams'] if s['codec_type'] == 'audio']
    require(len(audios) == 1, '需要单一音轨', 'AUDIO_INVALID')
    duration = float(audios[0].get('duration') or data['format']['duration'])
    require(math.isfinite(duration) and duration > 0, '音频时长无效', 'AUDIO_INVALID')
    sample_rate = int(audios[0]['sample_rate'])
    raw = ffmpeg('-xerror', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', sample_rate,
                 '-c:a', 'pcm_s16le', '-f', 's16le', '-')
    samples = len(raw) // 2
    require(samples > 0, '音频解码为空', 'AUDIO_INVALID')
    return {'durationSeconds': samples / sample_rate, 'sha256': digest(path),
            'sampleRate': sample_rate, 'samples': samples}


def pcm(path):
    raw = ffmpeg('-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-')
    values = array('h'); values.frombytes(raw)
    if sys.byteorder != 'little': values.byteswap()
    return values


def compare_audio(media, reference, allow_silence=False, frame_padding=0):
    return compare_samples(pcm(reference), pcm(media), allow_silence, frame_padding)


def compare_samples(a, b, allow_silence=False, frame_padding=0):
    require(a and b, '混音或成片音轨为空', 'AUDIO_MISMATCH')
    # 封装向上取整只允许补不足一帧静音；补零参与相关性检查，不掩盖尾部错轨。
    if frame_padding and len(b) > len(a):
        # 一帧画面补零与 AAC 自身编码尾垫是两种边界，分别核验。
        a = array('h', a); a.extend([0] * min(frame_padding, len(b) - len(a)))
    details = {'referenceSamples8000Hz': len(a), 'decodedSamples8000Hz': len(b),
               'lengthDeltaMs': (len(b) - len(a)) / 8}
    require(max(abs(v) for v in b) < 32767, '音频可能削波', 'AUDIO_CLIPPING')
    if max(abs(v) for v in a) < 32:
        require(abs(len(a) - len(b)) <= 400, f'混音与成片音轨长度不符：{details}', 'AUDIO_MISMATCH')
        require(allow_silence and max(abs(v) for v in b) < 32, '口播镜头不能交付静音', 'SILENT_AUDIO')
        return {'correlation': None, 'silent': True}
    n = min(len(a), len(b)); step = max(1, n // 16000)
    indexes = range(0, n, step)
    aa = sum(a[i] ** 2 for i in indexes); bb = sum(b[i] ** 2 for i in indexes)
    correlation = sum(a[i] * b[i] for i in indexes) / math.sqrt(max(1, aa * bb))
    # 不搜索最佳延迟：补偿后相关并不能证明实际交付同步。
    if abs(len(a) - len(b)) > 400 or correlation <= .90:
        details['correlationAtZero'] = correlation
        # 延迟搜索仅供诊断，绝不补偿后放行不同步的成片。
        details.update(audio_offset(a, b))
        raise StageError('AUDIO_MISMATCH', f'实际音轨与混音不同步或长度不符：{details}', details=details)
    return {'correlation': correlation, 'silent': False}


def audio_offset(a, b):
    # 取能量最高的短窗口，避开片头静音；限制运算量。
    width = min(len(a), 16000)
    start = max(range(0, max(1, len(a) - width + 1), 8000),
                key=lambda k: sum(a[i] ** 2 for i in range(k, k + width, 16)))
    def score(shift):
        indexes = range(max(start, -shift), min(start + width, len(b) - shift), 8)
        aa = sum(a[i] ** 2 for i in indexes); bb = sum(b[i + shift] ** 2 for i in indexes)
        return sum(a[i] * b[i + shift] for i in indexes) / math.sqrt(max(1, aa * bb))
    _, coarse = max((score(s), s) for s in range(-800, 801, 8))
    value, shift = max((score(s), s) for s in range(coarse - 7, coarse + 8))
    return {'estimatedOffsetMs': shift / 8, 'diagnosticCorrelation': value}


def validate_mp4(path, spec, frames):
    data = probe(path)
    videos = [s for s in data['streams'] if s['codec_type'] == 'video']
    audios = [s for s in data['streams'] if s['codec_type'] == 'audio']
    require('mp4' in data['format']['format_name'].split(','), '不是 MP4', 'MEDIA_INVALID')
    require(len(videos) == len(audios) == 1, '需要一个视频轨和一个音轨', 'MEDIA_INVALID')
    v, a = videos[0], audios[0]
    require(v['codec_name'] == 'h264' and v['pix_fmt'] == 'yuv420p' and a['codec_name'] == 'aac', '编码规格不符', 'MEDIA_INVALID')
    require(v.get('color_space') == 'bt709' and v.get('color_range') == 'tv', '需要 SDR BT.709 有限范围画面', 'MEDIA_INVALID')
    require((v['width'], v['height']) == (spec['width'], spec['height']), '分辨率不符', 'MEDIA_INVALID')
    require(abs(float(Fraction(v['avg_frame_rate'])) - spec['fps']) < .001,
            f'帧率不符：预期 {spec["fps"]}，实际 {v["avg_frame_rate"]}', 'MEDIA_INVALID')
    require(int(v['nb_read_frames']) == frames, '实际解码帧数不符', 'MEDIA_INVALID')
    require(abs(float(v['duration']) - frames / spec['fps']) <= 1 / spec['fps'], '视频时长不符', 'MEDIA_INVALID')
    for stream in (v, a):
        require(abs(float(stream.get('start_time', 999))) <= .001, '音视频起点不是 0', 'TIMESTAMP_OFFSET')
    expected = frames / spec['fps']
    if abs(float(a['duration']) - expected) > max(.05, 1 / spec['fps']):
        details = {'expectedSeconds': expected, 'audioSeconds': float(a['duration']),
                   'deltaMs': (float(a['duration']) - expected) * 1000, 'step': 'mux'}
        raise StageError('AUDIO_MISMATCH', f'音轨覆盖不足或超长：{details}', details=details)
    ffmpeg('-xerror', '-i', path, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-')
    return {'sha256': digest(path), 'frames': frames, 'durationSeconds': frames / spec['fps']}


def frame_rgb(path, index):
    return ffmpeg('-i', path, '-vf', f'select=eq(n\\,{index}),scale=320:180',
                  '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-')


def validate_narration_review(timeline, request, manifest, review):
    """核对讲解覆盖与成片证据；不以记录齐全冒充审美或音画语义通过。"""
    def check(value, message):
        require(value, message + '；修订本期工程或审片记录后重验', 'VISUAL_REVIEW_REQUIRED')

    check(isinstance(timeline, dict), '审片时间轴无效')
    check(timeline.get('fps') == request['outputSpec']['fps'], '审片时间轴帧率不符')
    scenes = timeline.get('scenes', [])
    check(isinstance(scenes, list) and all(isinstance(s, dict) for s in scenes), '审片镜头列表无效')
    check([s.get('id') for s in scenes] == [s['id'] for s in manifest['scenes']], '审片时间轴镜头不符')
    offset = 0
    for source, actual, viewed in zip(scenes, manifest['scenes'], review['scenes']):
        frames = actual['frames']
        check(source.get('startFrame') == offset and source.get('endFrameExclusive') == offset + frames,
              f"{actual['id']} 时间轴与成片长度不符")
        offset += frames
        utterances = source.get('utterances', [])
        check(isinstance(utterances, list), '发言列表无效')
        by_id, end = {}, 0
        for utterance in utterances:
            check(isinstance(utterance, dict), '发言记录无效')
            uid = utterance.get('id')
            start, stop = utterance.get('startFrame'), utterance.get('endFrameExclusive')
            check(isinstance(uid, str) and uid and uid not in by_id, '发言 ID 缺失或重复')
            check(type(start) is int and type(stop) is int and end <= start < stop <= frames,
                  f'{uid} 发言边界无效')
            check(isinstance(utterance.get('text'), str), f'{uid} 发言文本缺失')
            by_id[uid] = utterance
            end = stop
        normalize = lambda value: ''.join(value.split())
        check(normalize(''.join(u['text'] for u in utterances)) == normalize(actual['text']),
              f"{actual['id']} 审片时间轴未覆盖确认口播")
        # 设计是独立的制作意图，审片不能自行把所有过程降级为保持。
        designs = source.get('visualDesign')
        check(isinstance(designs, list) and (designs or not utterances), '缺少 visualDesign 设计执行索引')
        design_by_id = {}
        for design in designs:
            check(isinstance(design, dict), '设计项无效')
            did = design.get('id')
            check(isinstance(did, str) and did.strip() and did not in design_by_id, '设计 ID 为空或重复')
            check(design.get('mode') in ('change', 'hold'), '设计 mode 无效')
            check(all(isinstance(design.get(k), str) and design[k].strip()
                      for k in ('description', 'implementation')), '设计缺少演出说明或实现位置')
            ids = design.get('utteranceIds')
            check(isinstance(ids, list) and ids and all(isinstance(u, str) and u in by_id for u in ids),
                  '设计引用不存在的口播')
            design_by_id[did] = design
        check({u for d in designs for u in d['utteranceIds']} == set(by_id), '设计未覆盖全部讲解')
        reviewed_designs = set()
        covered = set()
        evidence = {item['frame'] for item in actual['evidence']}
        for item in viewed['narrationChecks']:
            design_ids = item.get('designIds')
            check(isinstance(design_ids, list) and design_ids and
                  all(isinstance(d, str) and d in design_by_id for d in design_ids), '审片缺少有效设计引用')
            for did in design_ids:
                design = design_by_id[did]
                check(item['mode'] == design['mode'], '审片与设计的变化/保持意图不符')
                check(set(design['utteranceIds']).issubset(item['utteranceIds']), '审片未覆盖所引用设计的口播')
            reviewed_designs.update(design_ids)
            ids = item['utteranceIds']
            check(set(ids).issubset(by_id), '审片引用不存在的发言')
            start, stop = item['startFrame'], item['endFrameExclusive']
            check(0 <= start < stop <= frames, '讲解检查区间越界')
            check(all(start <= by_id[uid]['startFrame'] and by_id[uid]['endFrameExclusive'] <= stop for uid in ids),
                  '检查区间未覆盖所引用的完整发言')
            check(item['passed'], '仍有未解决的讲解画面问题')
            check(all(item[key].strip() for key in ('expected', 'observed')), '讲解检查说明为空')
            samples = item['viewedFrames']
            check(all(start <= f < stop for f in samples), '讲解检查帧超出检查区间')
            check(set(samples).issubset(evidence) and set(samples).issubset(viewed['viewedFrames']),
                  '缺少讲解检查对应的成片抽帧')
            # 保持画面也要检查区间两端，不能只用一张图证明整段效果。
            needed = {start, stop - 1}
            if item['mode'] == 'change':
                action_start, action_end = item['changeStartFrame'], item['changeEndFrameExclusive']
                check(start <= action_start < action_end <= stop, '动作区间不在讲解检查范围内')
                needed.update({max(start, action_start - 1), action_start,
                               (action_start + action_end - 1) // 2, action_end - 1,
                               min(stop - 1, action_end)})
            check(needed.issubset(samples), '缺少讲解区间边界或动作前中后画面')
            covered.update(ids)
        check(reviewed_designs == set(design_by_id), '存在未检查的设计过程')
        check(covered == set(by_id), f"{actual['id']} 存在未检查的口播；可合并同一语义并说明保持理由")


def validate_delivery(root, request, manifest):
    schema(manifest, 'manifest')
    for key in ('taskId', 'runId', 'stage', 'contractVersion'):
        require(manifest[key] == request[key], f'结果 {key} 不匹配')
    confirmation = request['confirmation']
    require(manifest['planVersion'] == confirmation['planVersion'] and manifest['confirmedPlanSha256'] == confirmation['planSha256'], '结果确认版本不符')
    plan = read(local(root, confirmation['planFile']))
    require([s['id'] for s in manifest['scenes']] == [s['id'] for s in plan['scenes']], '镜头缺失、重复或乱序')
    assets = {a['id']: a for a in read(local(root, request['input']['assetsManifest']))['assets']}
    review = read(local(root, manifest['quality']))
    try:
        schema(review, 'review')
    except StageError as exc:
        raise StageError('VISUAL_REVIEW_REQUIRED', f'补齐或修订本期审片记录后重验：{exc}') from exc
    for key in ('taskId', 'runId', 'stage', 'contractVersion', 'confirmedPlanSha256'):
        require(review[key] == manifest[key], '视觉审查版本不符')
    require([s['id'] for s in review['scenes']] == [s['id'] for s in plan['scenes']], '视觉审查未覆盖全部镜头')
    timeline_path = local(root, f"render/{request['runId']}/timeline.json")
    require(digest(timeline_path) == review['timelineSha256'], '时间轴已变化，请重新检查讲解对应', 'VISUAL_REVIEW_REQUIRED')
    validate_narration_review(read(timeline_path), request, manifest, review)
    reports, paths, total = [], set(), 0
    for expected, actual, viewed in zip(plan['scenes'], manifest['scenes'], review['scenes']):
        require(expected['text'] == actual['text'] == actual['audio']['text'], '正文/音频文本与确认不一致')
        path = local(root, actual['path']); require(path not in paths, '不同镜头引用同一 MP4'); paths.add(path)
        report = validate_mp4(path, request['outputSpec'], actual['frames'])
        require(report['sha256'] == actual['sha256'] == viewed['videoSha256'], 'MP4 或审查摘要已改变')
        require(abs(report['durationSeconds'] - actual['durationSeconds']) < 1e-5, '清单时长不等于实际帧数')
        source_ids = set()
        for resource in actual['usedResources']:
            resource_file = local(root, resource['path'])
            require(digest(resource_file) == resource['sha256'], '实际素材摘要不符')
            if resource['kind'] == 'source':
                require(resource['id'] in assets, '未授权源素材')
                registered = assets[resource['id']]
                require(resource['path'] == registered['path'] and resource['sha256'] == registered['sha256'], '源素材引用不符')
                source_ids.add(resource['id'])
        require(set(expected['assetRefs']).issubset(source_ids), '遗漏客户端明确指定的素材')
        blocks = actual['resolvedVisualBlocks']
        end = 0
        for block in blocks:
            require(block['startFrame'] == end < block['endFrameExclusive'], '内部视觉段落缺帧、重叠或乱序')
            end = block['endFrameExclusive']
        require(end == actual['frames'], '内部视觉段落未覆盖全镜')
        audio = local(root, actual['audio']['path'])
        require(digest(audio) == actual['audio']['sha256'], '混音摘要不符')
        report['audio'] = compare_audio(path, audio, allow_silence=not actual['text'].strip(),
                                       frame_padding=math.ceil(8000 / request['outputSpec']['fps']))
        # 完整确认稿已由 actual['audio']['text'] 与 expected['text'] 校验；字幕可按模板做结论或句级展示。
        captions = actual['captions']; end = 0
        require(captions or not actual['text'].strip(), '口播镜头缺少字幕', 'CAPTION_MISSING')
        for caption in captions:
            require(end <= caption['startSeconds'] < caption['endSeconds'] <= report['durationSeconds'], '字幕边界无效')
            end = caption['endSeconds']
        needed = {0, actual['frames'] // 2, actual['frames'] - 1}
        evidence = {e['frame']: e for e in actual['evidence']}
        require(needed.issubset(evidence) and needed.issubset(viewed['viewedFrames']), '缺少成片首、中、尾画面审查')
        for index, item in evidence.items():
            require(0 <= index < actual['frames'], '审查帧越界')
            image = local(root, item['path']); require(digest(image) == item['sha256'], '审查图片已改变')
            # 从实际交付 MP4 重解码比对，防止拿预览帧冒充成片帧。
            a, b = frame_rgb(path, index), frame_rgb(image, 0)
            require(len(a) == len(b) == 320 * 180 * 3, '帧图无法解码')
            require(sum(abs(x-y) for x, y in zip(a, b)) / len(a) < 4, '审查图与实际成片不符')
        total += actual['frames']; reports.append({'id': actual['id'], **report})
    whole = manifest['wholeVideo']
    require(not request['delivery']['includeWholeVideo'] or whole is not None, '缺少请求的整片')
    if whole:
        path = local(root, whole['path']); require(path not in paths, '整片不能充当分镜')
        report = validate_mp4(path, request['outputSpec'], total)
        require(whole['frames'] == total and whole['sha256'] == report['sha256'], '整片帧数/摘要不符')
        require(abs(whole['durationSeconds'] - report['durationSeconds']) < 1e-5, '整片清单时长不符')
        offset = 0
        whole_pcm = pcm(path)
        require(abs(len(whole_pcm) - round(total / request['outputSpec']['fps'] * 8000)) <= 400, '整片音频时长不符')
        for scene in manifest['scenes']:
            for index in (0, scene['frames'] - 1):
                require(frame_rgb(path, offset+index) == frame_rgb(local(root, scene['path']), index), '整片拼接边界画面不符')
            start = round(offset / request['outputSpec']['fps'] * 8000)
            end = round((offset + scene['frames']) / request['outputSpec']['fps'] * 8000)
            compare_samples(pcm(local(root, scene['audio']['path'])), whole_pcm[start:end], allow_silence=not scene['text'].strip(),
                            frame_padding=math.ceil(8000 / request['outputSpec']['fps']))
            offset += scene['frames']
    return {'sceneCount': len(reports), 'frames': total, 'sceneChecks': reports,
            'humanListeningPerformed': review['humanListeningPerformed'], 'limitations': review['limitations']}


class OwnedProcessTree:
    """登记自有后代；脱离父组或被重新收养后仍按启动身份核验。"""
    def __init__(self, pid, signature, log):
        self.pid, self.signature, self.log = pid, signature, Path(log)
        self.known, self.records = {}, {}

    def snapshot(self):
        result = subprocess.run(['ps', '-axo', 'pid=,ppid=,pgid=,lstart=,uid=,stat='],
                                capture_output=True, text=True, timeout=3)
        require(result.returncode == 0, '无法核验自有媒体进程', 'PROCESS_CLEANUP_FAILED')
        rows = {}
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) != 10 or parts[-1].startswith('Z'): continue
            pid, ppid, pgid = map(int, parts[:3])
            rows[pid] = {'pid': pid, 'ppid': ppid, 'pgid': pgid, 'identity': tuple(parts[3:9])}
        return rows

    def scan(self):
        rows = self.snapshot()
        live = {pid for pid, old in self.known.items()
                if pid in rows and rows[pid]['identity'] == old['identity'] and rows[pid]['pgid'] == old['pgid']}
        if self.pid not in self.known and self.pid in rows and process_signature(self.pid) == self.signature:
            live.add(self.pid)
        while True:
            children = {pid for pid, row in rows.items() if row['ppid'] in live}
            if children <= live: break
            live |= children
        for pid in live:
            row = rows[pid]
            if pid not in self.known:
                row['signature'] = process_signature(pid)
                self.known[pid] = row
                # 独立浏览器组另存记录，强杀协调器后不会漏过活跃制作检查。
                if pid == row['pgid'] and pid != self.pid and row['signature']:
                    record = {'state': 'running', 'pid': pid, 'signature': row['signature'],
                              'parentPid': self.pid, 'startedAt': time.time()}
                    path = self.log.with_name(self.log.stem + '.owned-' + str(pid) + '.process.json')
                    self.records[pid] = (path, record)
                    write(path, record)
        for pid, (path, record) in self.records.items():
            if not any(rows[p]['pgid'] == pid for p in live):
                write(path, {**record, 'state': 'ended', 'endedAt': time.time()})
        return [rows[pid] for pid in live]

    def signal_owned(self, sig, *, root_only=False):
        # 逐 PID 回收而非 killpg，避免混合组或 PGID 1 伤及非任务进程。
        rows = self.scan()
        for row in rows:
            pid = row['pid']
            if root_only and pid != self.pid: continue
            if pid <= 1 or pid == os.getpid(): continue
            signature = self.known[pid]['signature']
            if not signature or process_signature(pid) != signature: continue
            try: os.kill(pid, sig)
            except ProcessLookupError: pass
            except PermissionError as exc:
                raise StageError('PROCESS_CLEANUP_FAILED', '无权回收已核验的自有媒体进程') from exc

    def close(self, child, grace):
        self.scan()
        if child.poll() is None:
            self.signal_owned(signal.SIGTERM, root_only=True)
            deadline = time.monotonic() + grace
            while time.monotonic() < deadline:
                child.poll()
                if not self.scan(): return
                if child.returncode is not None: break
                time.sleep(.1)
        # 优雅关闭之后仍存活的 detached 后代必须单独回收。
        self.signal_owned(signal.SIGTERM)
        deadline = time.monotonic() + .5
        while time.monotonic() < deadline:
            child.poll()
            if not self.scan(): return
            time.sleep(.1)
        self.signal_owned(signal.SIGKILL)
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            child.poll()
            if not self.scan(): return
            time.sleep(.1)
        require(not self.scan(), '仍有自有媒体后代未退出，禁止继续派发', 'PROCESS_CLEANUP_FAILED')


def supervise(argv, cwd, log, done_file, timeout, close_timeout=10):
    """独立进程组；完成标记之后仍需由调用方验证实际文件。"""
    started, closing = time.monotonic(), None
    usage = CgroupUsage()
    with Path(log).open('wb') as output:
        try:
            child = subprocess.Popen(argv, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as exc:
            usage.observe()
            if usage.process_limit_exceeded(): raise process_limit_error(usage) from exc
            raise
        process_record = Path(log).with_suffix('.process.json')
        record = {'state': 'running', 'pid': child.pid, 'signature': process_signature(child.pid), 'startedAt': time.time()}
        write(process_record, record)
        owned = OwnedProcessTree(child.pid, record['signature'], log)
        last_scan = 0
        try:
            while child.poll() is None:
                check_batch()
                now = time.monotonic()
                usage.observe()
                if now - last_scan >= .5:
                    owned.scan(); last_scan = now
                if Path(done_file).exists() and closing is None: closing = now
                if closing is not None and now - closing > close_timeout:
                    return {'closeTimedOut': True, 'pid': child.pid, 'resourceMetrics': usage.diagnostics()}
                if now - started > timeout:
                    if usage.process_limit_exceeded(): raise process_limit_error(usage)
                    raise StageError('RENDER_TIMEOUT', '本次渲染进程超时', True)
                time.sleep(.1)
            usage.observe()
            if child.returncode != 0 or not Path(done_file).is_file():
                tail = Path(log).read_text(encoding='utf-8', errors='replace')[-4000:]
                code = render_failure_code(tail, usage)
                messages = {
                    'PROCESS_LIMIT_EXCEEDED': '当前渲染任务触达进程或线程上限，已停止继续派发新分镜',
                    'BROWSER_UNAVAILABLE': '公共浏览器运行环境不可用，已停止继续派发新分镜',
                }
                raise StageError(code, messages.get(code, f'当前工程需调整，查看 {log}'), details={
                    'log': str(log), 'exitCode': child.returncode,
                    'logTail': tail, 'resourceMetrics': usage.diagnostics()})
            return {'closeTimedOut': False, 'pid': child.pid, 'recommendations': read(done_file).get('recommendations', []),
                    'resourceMetrics': usage.diagnostics()}
        finally:
            # 先让 Node 执行 browser.close；之后仅清理已核验自有后代。
            try:
                owned.close(child, min(6, close_timeout))
            except BaseException:
                # 进程表核验失败也先停掉自己创建的根进程，保留 running 记录供恢复核查。
                if child.poll() is None:
                    child.terminate()
                    try: child.wait(timeout=6)
                    except subprocess.TimeoutExpired: child.kill(); child.wait()
                raise
            child.wait()
            write(process_record, {**record, 'state': 'ended', 'endedAt': time.time()})


def project_fingerprint(project):
    entries = {}
    for parent, dirs, names in os.walk(project, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in ('node_modules', '.git'))
        for directory in dirs:
            require(not (Path(parent) / directory).is_symlink(), '项目目录中不允许指向外部资源的链接')
        for name in sorted(names):
            p = Path(parent) / name
            require(p.resolve().is_relative_to(project), '项目资源越界')
            entries[str(p.relative_to(project))] = digest(p)
    return entries


def zero_mix_tail(mix, start_sample):
    """只识别画面边界后的精确零样本；不以音量阈值裁掉轻声或尾音。"""
    # 保留全部声道和浮点精度，防止反相声道抵消或量化舍入被误判为静音。
    raw = ffmpeg('-xerror', '-i', mix, '-map', '0:a:0', '-af', f'atrim=start_sample={start_sample}',
                 '-c:a', 'pcm_f64le', '-f', 'f64le', '-')
    values = array('d'); values.frombytes(raw)
    if sys.byteorder != 'little': values.byteswap()
    return bool(values) and all(value == 0 for value in values)


def mux_scene(video, mix, output, spec, frames, timeout=600):
    """只封装画面和已完成的全量混音，不改写口播、音效或业务时间轴。"""
    seconds = frames / spec['fps']
    info = audio_info(mix)
    # 读取实际样本数；仅画面外的精确零填充可归一化，任何非零尾音仍要求补帧。
    sample_rate = info['sampleRate']
    covered_samples = math.floor(Fraction(frames) / Fraction(str(spec['fps'])) * sample_rate)
    delta_samples = info['samples'] - covered_samples
    required = sample_frames(info['samples'], sample_rate, spec['fps'])
    zero_padding = required > frames and zero_mix_tail(mix, covered_samples)
    if required > frames and not zero_padding:
        details = {'step': 'mix', 'currentFrames': frames, 'requiredFrames': required,
                   'mixSeconds': info['durationSeconds'], 'mixSamples': info['samples'],
                   'sampleRate': sample_rate, 'mixSha256': info['sha256']}
        raise StageError('TIMELINE_EXTEND_REQUIRED', '完整混音需要更多画面覆盖；固定混音后调整时间轴，禁止原帧数重试', details=details)
    samples = math.ceil(Fraction(frames) / Fraction(str(spec['fps'])) * 48000)
    ffmpeg('-y', '-copyts', '-i', video, '-i', mix, '-map', '0:v:0', '-map', '1:a:0',
           '-c:v', 'copy', '-af', f'aresample=48000,apad,atrim=end_sample={samples},asetpts=PTS-STARTPTS',
           '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output, timeout=timeout)
    report = validate_mp4(output, spec, frames)
    report['audioCheck'] = compare_audio(output, mix, allow_silence=True, frame_padding=math.ceil(8000 / spec['fps']))
    report['mixBoundaryAdjustmentSamples'] = delta_samples
    report['zeroTailPaddingSamples'] = max(0, delta_samples) if zero_padding else 0
    return report


def scene_audio_contract(project, props):
    """固定混音仅允许修改画面覆盖，不能携带已经改变的配音或音效。"""
    scene = props.get('scene')
    if not isinstance(scene, dict):
        return json_digest({'props': {k: v for k, v in props.items() if k != 'frames'},
                            'sources': project_fingerprint(project/'public')})
    contract = {k: scene.get(k) for k in ('id', 'utterances', 'sfx', 'intro', 'outro', 'contentFrames')}
    contract['bgm'] = props.get('timeline', {}).get('bgm')
    contract['withBgm'] = props.get('withBgm')
    # BGM 使用全局起点；前镜补帧后不能把旧起点的混音冒充未改变。
    if contract['bgm'] and contract['withBgm']:
        contract['bgmStartFrame'] = scene.get('from', scene.get('startFrame', 0))
    sources = [u['src'] for u in scene.get('utterances', [])]
    sources += ['template-assets/' + cue['src'] for cue in scene.get('sfx', [])]
    sources += ['template-assets/' + scene[k]['src'] for k in ('intro', 'outro') if scene.get(k)]
    if contract['bgm']:
        sources.append('template-assets/' + contract['bgm']['src'])
    ending = props.get('timeline', {}).get('ending')
    if ending:
        # 片尾在可信合成层追加；其来源与起点同样属于固定混音合同。
        contract['ending'] = ending
        if ending.get('outro'):
            sources.append('template-assets/' + ending['outro']['src'])
    contract['sources'] = {src: digest(local(project/'public', src)) for src in sources}
    return json_digest(contract)


def check_speech_coverage(project, props, frames, fps, ending_bounds=None):
    """渲染前验证源音频窗口，防止先截音再得到等长混音的假通过。"""
    scene = props.get('scene')
    if not isinstance(scene, dict):
        return
    require(scene['frames'] == frames, 'props 与实际帧数不一致')
    previous = 0
    scene_from = scene.get('from', scene.get('startFrame', 0))
    speech_limit = min(frames, ending_bounds['narrationEndFrame'] - scene_from) if ending_bounds else frames
    for utterance in scene.get('utterances', []):
        info = audio_info(local(project/'public', utterance['src']))
        start, end = utterance['startFrame'], utterance['endFrameExclusive']
        needed = sample_frames(info['samples'], info['sampleRate'], fps)
        require(type(start) is int and type(end) is int and previous <= start < end <= speech_limit,
                '配音边界重叠或超出场景', 'CONTENT_TIMELINE_REQUIRED')
        require(end - start >= needed, f'{utterance["id"]} 真实音频需要 {needed} 帧，当前仅 {end-start} 帧；先按实测音频重建时间轴', 'CONTENT_TIMELINE_REQUIRED')
        if ending_bounds:
            require(end - start == needed, '固定结束语及片尾必须采用当前实测配音边界', 'CONTENT_TIMELINE_REQUIRED')
        previous = end
    # 未显式剪辑的音效必须完整容纳；不再以默认三秒截断素材。
    for cue in scene.get('sfx', []):
        info = audio_info(local(project/'public', 'template-assets/' + cue['src']))
        needed = cue.get('durationFrames', sample_frames(info['samples'], info['sampleRate'], fps))
        require(type(needed) is int and needed > 0 and cue['frame'] + needed <= scene.get('contentFrames', frames),
                f'音效 {cue["src"]} 超出声音窗口；依据实测时长延长或明确剪辑', 'CONTENT_TIMELINE_REQUIRED')
        if ending_bounds:
            require(cue['frame'] + needed <= speech_limit, '正文音效尚未结束，不能在追加片尾时截断', 'CONTENT_TIMELINE_REQUIRED')


def fixed_ending_policy(root, request):
    """只读取可信冻结模板，任务副本不能自行开启新的合成合同。"""
    template = read(local(root, request['input']['templateSnapshot']))
    folder = template.get('root')
    declaration = local(root, folder + '/renderer/renderer-manifest.json', exists=False) if folder else None
    return read(declaration).get('endingPolicy') if declaration and declaration.is_file() else None


def inspect_outro(project, ending, spec):
    """复核冻结前整理的片尾副本；不在渲染末端偷偷改变长度。"""
    outro = ending.get('outro')
    if not outro:
        return None
    require(isinstance(outro.get('src'), str) and type(outro.get('muted')) is bool,
            '片尾需明确本地路径和是否保留原声')
    path = local(project / 'public' / 'template-assets', outro['src'])
    data = probe(path)
    videos = [s for s in data['streams'] if s['codec_type'] == 'video']
    audios = [s for s in data['streams'] if s['codec_type'] == 'audio']
    require(len(videos) == 1, '片尾需要唯一视频轨；先整理本地素材', 'MEDIA_INVALID')
    video = videos[0]
    frames = int(video.get('nb_read_frames') or 0)
    require(type(outro.get('frames')) is int and frames == outro['frames'] and frames > 0,
            '片尾实测长度已变化，重建正式时间轴并重新冻结', 'TIMELINE_STALE')
    fps = Fraction(str(spec['fps']))
    require((video['width'], video['height']) == (spec['width'], spec['height'])
            and abs(float(Fraction(video['avg_frame_rate']) - fps)) < .001
            and abs(float(Fraction(video['r_frame_rate']) - fps)) < .001
            and video.get('pix_fmt') == 'yuv420p',
            '片尾尚未按输出尺寸、恒定帧率与yuv420p整理；请在冻结前准备副本', 'MEDIA_INVALID')
    require(video.get('color_space') == 'bt709' and video.get('color_range') == 'tv',
            '片尾需先整理为BT.709有限范围，避免拼接后颜色突变', 'MEDIA_INVALID')
    timestamps = json.loads(command([os.environ.get('FFPROBE', 'ffprobe'), '-v', 'error', '-select_streams', 'v:0',
                                    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(path)]))['frames']
    require(len(timestamps) == frames and all(abs(float(f['best_effort_timestamp_time']) - i / float(fps)) < .002
            for i, f in enumerate(timestamps)), '片尾不是从0开始的恒定帧率素材，请先整理副本', 'MEDIA_INVALID')
    info = None
    if not outro['muted'] and audios:
        require(len(audios) == 1, '片尾多音轨需先整理为明确保留的一轨', 'AUDIO_INVALID')
        require(abs(float(audios[0].get('start_time', 0))) <= .001,
                '片尾声音起点不为0，请在冻结前整理副本', 'TIMESTAMP_OFFSET')
        info = audio_info(path)
        require(sample_frames(info['samples'], info['sampleRate'], spec['fps']) <= frames,
                '片尾原声比画面长，请先补足素材末态再实测；禁止截尾', 'CONTENT_TIMELINE_REQUIRED')
    return {'path': path, 'frames': frames, 'sha256': digest(path), 'hasAudio': info is not None, 'audioInfo': info}


def fixed_ending_context(root, request, request_path, project, props):
    policy = fixed_ending_policy(root, request)
    timeline = props.get('timeline', {})
    if policy != 'hold-closing-then-append/v1':
        require(not timeline.get('ending'), '当前冻结模板不支持新的片尾合同，请使用匹配版本', 'INVALID_CONTRACT')
        return None, None
    official = read(local(root, str((Path(request_path).resolve().parent / 'timeline.json').relative_to(root))))
    require(not any(s.get('outro') for s in official['scenes']), '新模板不能在正文scene.outro中播放片尾')
    # 派生只改变坐标别名和音频溯源字段；禁止用另一份props更换合成素材。
    expected = json.loads(json.dumps(official))
    for item in expected['scenes']:
        item['from'] = item.pop('startFrame')
        item['frames'] = item.pop('endFrameExclusive') - item['from']
        for utterance in item['utterances']:
            utterance.pop('audioPath', None)
    require(timeline == expected and props.get('scene') in timeline['scenes'],
            '渲染props不是当前正式时间轴派生结果', 'TIMELINE_STALE')
    require(type(official.get('withBgm')) is bool and props.get('withBgm') is official['withBgm'],
            '渲染音乐选择与正式时间轴不一致', 'TIMELINE_STALE')
    bounds = check_fixed_ending(official)
    media = inspect_outro(project, official['ending'], request['outputSpec']) if bounds and props['scene']['id'] == bounds['lastSceneId'] else None
    return bounds, media


def append_scene_outro(video, mix, outro, bounds, spec, frames, folder, timeout=600, fixed_audio=False):
    """只在末镜封装前追加一次；保留原始输出，固定混音不重复追加声音。"""
    prefix, count = bounds['appendFromFrame'], outro['frames']
    require(0 < prefix and prefix + count <= frames, '正文与完整片尾不能容纳在正式末镜中')
    fps = Fraction(str(spec['fps']))
    output_video, output_mix = folder / 'appended-video.mp4', folder / 'appended-mix.wav'
    extra = frames - prefix - count
    filters = (f'[0:v]trim=end_frame={prefix},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[body];'
               f'[1:v]trim=end_frame={count},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[tail];'
               f'[body][tail]concat=n=2:v=1:a=0,tpad=stop_mode=clone:stop_duration={extra / float(fps)},'
               f'trim=end_frame={frames},setpts=PTS-STARTPTS[out]')
    ffmpeg('-y', '-i', video, '-i', outro['path'], '-filter_complex', filters, '-map', '[out]', '-an',
           '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(spec['fps']),
           '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
           output_video, timeout=timeout)
    if fixed_audio:
        return output_video, mix
    original = audio_info(mix)
    boundary = math.ceil(Fraction(prefix) / fps * original['sampleRate'])
    require(original['samples'] <= boundary or zero_mix_tail(mix, boundary),
            '全部口播结束后仍有正文声音，先修正声音安排，禁止裁掉尾音', 'CONTENT_TIMELINE_REQUIRED')
    head_samples = math.ceil(Fraction(prefix) / fps * 48000)
    tail_samples = math.ceil(Fraction(count) / fps * 48000)
    inputs = ['-i', mix]
    if outro['hasAudio']:
        inputs += ['-i', outro['path']]
    else:
        inputs += ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
    audio_filters = (f'[0:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=end_sample={head_samples},asetpts=PTS-STARTPTS[body];'
                     f'[1:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=end_sample={tail_samples},asetpts=PTS-STARTPTS[tail];'
                     '[body][tail]concat=n=2:v=0:a=1[out]')
    ffmpeg('-y', *inputs, '-filter_complex', audio_filters, '-map', '[out]', '-c:a', 'pcm_s16le', output_mix, timeout=timeout)
    return output_video, output_mix


def verify_appended_outro(video, mix, outro, bounds, spec):
    """独立抽查真实片尾帧与原声，防止静态占位或旧PCM冒充追加成功。"""
    prefix, count = bounds['appendFromFrame'], outro['frames']
    errors = []
    for index in sorted({0, count // 2, count - 1}):
        source, actual = frame_rgb(outro['path'], index), frame_rgb(video, prefix + index)
        require(source and len(source) == len(actual), '最终片尾抽帧失败', 'MEDIA_INVALID')
        error = math.sqrt(sum((a - b) ** 2 for a, b in zip(source, actual)) / len(source))
        require(error < 20, f'最终视频片尾与实际素材不符，帧{index}，像素误差{error:.2f}', 'MEDIA_INVALID')
        errors.append(error)
    fps = Fraction(str(spec['fps']))
    samples = math.ceil(Fraction(count) / fps * 8000)
    rate = audio_info(mix)['sampleRate']
    head = math.ceil(Fraction(prefix) / fps * rate)
    stop = math.ceil(Fraction(prefix + count) / fps * rate)
    # 先在源采样率截取，再降采样；避免前一句声音的重采样滤波泄入静音片尾。
    actual_raw = ffmpeg('-i', mix, '-ac', '1', '-af', f'atrim=start_sample={head}:end_sample={stop},asetpts=PTS-STARTPTS,aresample=8000',
                        '-c:a', 'pcm_s16le', '-f', 's16le', '-')
    if outro['hasAudio']:
        expected_raw = ffmpeg('-i', outro['path'], '-ac', '1', '-af', f'aresample=8000,apad,atrim=end_sample={samples}',
                             '-c:a', 'pcm_s16le', '-f', 's16le', '-')
    else:
        expected_raw = bytes(samples * 2)
    expected, actual = array('h'), array('h')
    expected.frombytes(expected_raw); actual.frombytes(actual_raw)
    if sys.byteorder != 'little': expected.byteswap(); actual.byteswap()
    audio_check = compare_samples(expected, actual, allow_silence=True)
    return {'framesChecked': sorted({0, count // 2, count - 1}), 'pixelErrors': errors, 'audio': audio_check}


def render_scene(request_path, scene_id, project_name, entry_name, composition, props_name, frames, node, modules, browser, fixed_mix=False, *, batch_context=None):
    scene_started = time.monotonic()
    timings = {}
    identifier(scene_id)
    context = nullcontext(batch_context["execution"]) if batch_context else execution(request_path, "render:" + scene_id)
    with context as (root, request, budget):
        plan = read(local(root, request['confirmation']['planFile']))
        require(scene_id in [s['id'] for s in plan['scenes']], '未确认的分镜')
        require(type(frames) is int and frames > 0, '需要实际总帧数')
        project = local(root, project_name, exists=False)
        require(project.is_dir() and project != root, '需要独立项目目录')
        entry = local(root, entry_name); require(entry.is_relative_to(project), '入口不在项目目录')
        props = read(local(root, props_name)) if props_name else {}
        ending_bounds, outro = fixed_ending_context(root, request, request_path, project, props)
        if ending_bounds:
            require(props['scene']['id'] == scene_id, 'props分镜与当前导出ID不符')
        check_speech_coverage(project, props, frames, request['outputSpec']['fps'], ending_bounds)
        audio_contract = scene_audio_contract(project, props)
        official_path = Path(request_path).resolve().parent / 'timeline.json'
        timeline_hash = digest(official_path) if official_path.exists() else None
        work = Path(request_path).resolve().parent / 'work'; work.mkdir(exist_ok=True)
        adjustment_path = work / (scene_id + '.adjustment.json')
        fixed = read(adjustment_path) if fixed_mix else None
        if fixed:
            require(frames >= fixed['requiredFrames'], '画面必须覆盖完整混音的 requiredFrames', 'TIMELINE_EXTEND_REQUIRED')
            require(fixed['audioContract'] == audio_contract, '声音编排或音频依赖已变：保留旧混音，取消 fixedMix，按当前素材重新混音后检查', 'MIX_REBUILD_REQUIRED')
            fixed_path = local(root, fixed['mixPath'])
            require(digest(fixed_path) == fixed['mixSha256'], '固定混音缓存摘要已改变，需核查有效副本', 'CACHE_CORRUPT')
        out_dir = root / 'output' / request['runId'] / 'scenes'; out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / (scene_id + '.mp4'); marker = out.with_suffix('.render.json')
        modules = Path(modules).resolve()
        packages = {n: digest(modules / n / 'package.json') for n in ('remotion', '@remotion/renderer', '@remotion/bundler')}
        project_entries = project_fingerprint(project)
        receipt = {'project': str(project.relative_to(root)), 'projectHash': json_digest(project_entries), 'timelineHash': timeline_hash}
        fingerprint = json_digest({'project': project_entries, 'entry': str(entry), 'composition': composition,
                                   'props': props, 'spec': request['outputSpec'], 'frames': frames, 'packages': packages,
                                   'confirmedPlanSha256': request['confirmation']['planSha256'],
                                   'fixedMix': fixed, 'timelineHash': timeline_hash, 'mediaTool': digest(Path(__file__)),
                                   'renderer': digest(Path(__file__).with_name('render_scene.cjs')),
                                   'batchVersion': batch_context['version'] if batch_context else None})
        if marker.exists() and out.exists():
            old = read(marker)
            mix_valid = False
            try:
                saved_mix = old['mix']
                mix_valid = digest(local(root, saved_mix['path'])) == saved_mix['sha256']
            except (OSError, ValueError, KeyError, TypeError):
                pass
            if mix_valid and old['fingerprint'] == fingerprint and old.get('timelineHash') == timeline_hash and old['sha256'] == digest(out):
                return {**receipt, **validate_mp4(out, request['outputSpec'], frames), 'path': str(out.relative_to(root)),
                        'mix': old.get('mix'), 'evidence': extract_frames(root, request, scene_id, out, frames), 'reused': True}
        # 编码和封装分开缓存：只修封装时复用原画面及 PCM，不再次启动浏览器。
        raw_marker = work / (scene_id + '.raw.json')
        raw = read(raw_marker) if raw_marker.exists() else None
        raw_reused = False
        if raw and raw.get('fingerprint') == fingerprint:
            try:
                video = local(root, raw['video']); mix = local(root, raw['mix'])
                raw_reused = digest(video) == raw['videoSha256'] and digest(mix) == raw['mixSha256']
            except (OSError, ValueError, KeyError):
                pass
        temp = video.parent if raw_reused else Path(tempfile.mkdtemp(prefix=scene_id+'-', dir=work))
        try:
            done = temp / 'done.json'; target = temp / 'scene.mp4'
            recovery = raw.get('recovery', {}) if raw_reused else {}
            if not raw_reused:
                video, mix = temp / 'video.mp4', fixed_path if fixed else temp / 'mix.wav'
                config = {'entry': str(entry), 'project': str(project), 'composition': composition, 'props': props, 'modules': str(modules),
                          'browser': browser, 'output': str(video), 'audio': str(mix), 'done': str(done), 'bundle': str(temp/'bundle'),
                          'spec': request['outputSpec'], 'frames': frames, 'fixedAudio': bool(fixed)}
                if batch_context: config['serveUrl'] = batch_context['bundle']
                write(temp / 'config.json', config)
                scratch = temp/'runtime'; scratch.mkdir(exist_ok=True)
                render_command = ['/usr/bin/env', 'TMPDIR='+str(scratch), 'HOME='+str(scratch), node,
                                  str(Path(__file__).with_name('render_scene.cjs')), str(temp/'config.json')]
                sandbox = os.environ.get('VIDEOCUT_RENDER_SANDBOX')
                if batch_context and not sandbox: sandbox = 'seatbelt' if sys.platform == 'darwin' else 'bwrap'
                if sandbox == 'bwrap':
                    # 工程 JS 只可写本次渲染临时目录；不能继承可信工具的预算写权限。
                    render_command = ['bwrap', '--die-with-parent', '--unshare-pid', '--ro-bind', '/', '/',
                                      '--bind', str(temp), str(temp),
                                      '--dev-bind', '/dev', '/dev', '--proc', '/proc', '--', *render_command]
                elif sandbox == 'seatbelt':
                    render_command = ['/usr/bin/sandbox-exec', '-p', render_seatbelt_profile(temp), *render_command]
                phase_started = time.monotonic()
                recovery = supervise(render_command,
                                     project, work / (scene_id+'.log'), done, budget)
                timings['renderSeconds'] = time.monotonic() - phase_started
                if outro:
                    phase_started = time.monotonic()
                    video, mix = append_scene_outro(video, mix, outro, ending_bounds, request['outputSpec'],
                                                   frames, temp, budget, fixed_audio=bool(fixed))
                    timings['outroAppendSeconds'] = time.monotonic() - phase_started
                write(raw_marker, {'fingerprint': fingerprint, 'video': str(video.relative_to(root)),
                                   'mix': str(mix.relative_to(root)), 'videoSha256': digest(video),
                                   'mixSha256': digest(mix), 'recovery': recovery})
            # Render 可安排口播后的画面停留；补静音到明确帧长，完整原混音另存不覆盖。
            if audio_info(mix)['durationSeconds'] < frames / request['outputSpec']['fps'] - 1 / request['outputSpec']['fps']:
                padded = temp / 'covered-mix.wav'
                samples = math.ceil(Fraction(frames) / Fraction(str(request['outputSpec']['fps'])) * 48000)
                ffmpeg('-y', '-i', mix, '-af', f'aresample=48000,apad,atrim=end_sample={samples}', '-c:a', 'pcm_s16le', padded)
                mix = padded
            try:
                phase_started = time.monotonic()
                info = mux_scene(video, mix, target, request['outputSpec'], frames, budget)
                timings['mixAndValidationSeconds'] = time.monotonic() - phase_started
                if outro:
                    info['outroCheck'] = verify_appended_outro(target, mix, outro, ending_bounds, request['outputSpec'])
            except StageError as exc:
                if exc.code == 'TIMELINE_EXTEND_REQUIRED':
                    details = {**exc.details, 'sceneId': scene_id, 'mixPath': str(mix.relative_to(root)),
                               'audioContract': audio_contract}
                    write(adjustment_path, details)
                    raise StageError(exc.code, str(exc), details=details) from exc
                raise
            check_batch()
            if batch_context: batch_context['validate']()
            load_request(request_path, 'render')
            if outro:
                require(digest(outro['path']) == outro['sha256'], '片尾源文件在合成期间发生变化', 'TIMELINE_STALE')
            publish_file(target, out)
            mixed = {'path': str(mix.relative_to(root)), 'sha256': digest(mix)}
            write(marker, {'fingerprint': fingerprint, 'mix': mixed, **receipt, **info, **recovery})
        except BaseException:
            # 失败媒体和配置保留在本次 work 中，供检查原故障区间。
            raise
        else:
            # 保留画面和混音用于封装修复，体积较大的临时网页可删除。
            if (temp / 'bundle').exists(): shutil.rmtree(temp / 'bundle')
        phase_started = time.monotonic()
        evidence = extract_frames(root, request, scene_id, out, frames)
        timings['evidenceSeconds'] = time.monotonic() - phase_started
        timings['wallSeconds'] = time.monotonic() - scene_started
        return {**receipt, **info, 'path': str(out.relative_to(root)), 'mix': mixed, 'evidence': evidence,
                'reused': False, 'timings': timings, 'renderReused': raw_reused,
                'recommendations': recovery.get('recommendations', []),
                'resourceMetrics': recovery.get('resourceMetrics')}


def extract_frames(root, request, scene_id, path, frames):
    result = []
    folder = root / 'render' / request['runId'] / 'frames'; folder.mkdir(parents=True, exist_ok=True)
    for index in sorted({0, frames//2, frames-1}):
        target = folder / f'{scene_id}-{index}.png'
        ffmpeg('-y', '-i', path, '-vf', f'select=eq(n\\,{index})', '-frames:v', '1', target)
        result.append({'frame': index, 'path': str(target.relative_to(root)), 'sha256': digest(target)})
    return result


def assemble(request_path, manifest_path):
    """按确认镜头顺序合片；视频直拷，逐镜原混音 PCM 拼接后仅编码一次 AAC。"""
    with execution(request_path, 'assemble') as (root, request, budget):
        manifest_path = Path(manifest_path).resolve()
        require(manifest_path.is_relative_to(root), '清单必须属于本任务')
        manifest = read(manifest_path)
        # 先独立验证所有分镜和审查记录，整片暂时缺省。
        validate_delivery(root, {**request, 'delivery': {**request['delivery'], 'includeWholeVideo': False}}, {**manifest, 'wholeVideo': None})
        folder = root / 'output' / request['runId']; folder.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='assemble-', dir=folder) as t:
            temp = Path(t); lines = []; audio_lines = []
            for i, scene in enumerate(manifest['scenes']):
                # 正文与片尾可能使用不同MP4时间基；只重封装视频，避免直拼后时间戳错位。
                ffmpeg('-i', local(root, scene['path']), '-map', '0:v:0', '-an', '-c:v', 'copy',
                       '-video_track_timescale', '90000', temp / f'{i}.mp4', timeout=budget)
                lines.append(f"file '{i}.mp4'")
                # 按确认镜头的实际帧数归一化采样数，避免累积 AAC 编码填充。
                samples = round(scene['frames'] / request['outputSpec']['fps'] * 48000)
                ffmpeg('-i', local(root, scene['audio']['path']), '-af', f'aresample=48000,apad,atrim=end_sample={samples},asetpts=PTS-STARTPTS',
                       '-ac', '2', '-c:a', 'pcm_s16le', temp / f'{i}.wav', timeout=budget)
                audio_lines.append(f"file '{i}.wav'")
            (temp/'video.txt').write_text('\n'.join(lines)+'\n')
            (temp/'audio.txt').write_text('\n'.join(audio_lines)+'\n')
            ffmpeg('-f', 'concat', '-safe', '0', '-i', temp/'audio.txt', '-c:a', 'pcm_s16le', temp/'mix.wav', timeout=budget)
            ffmpeg('-copyts', '-f', 'concat', '-safe', '0', '-i', temp/'video.txt', '-i', temp/'mix.wav',
                   '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temp/'whole.mp4', timeout=budget)
            frames = sum(s['frames'] for s in manifest['scenes'])
            info = validate_mp4(temp/'whole.mp4', request['outputSpec'], frames)
            compare_audio(temp/'whole.mp4', temp/'mix.wav', allow_silence=all(not s['text'].strip() for s in manifest['scenes']))
            load_request(request_path, 'render')
            output = folder/'video.mp4'; publish_file(temp/'whole.mp4', output)
            manifest['wholeVideo'] = {'path': str(output.relative_to(root)), **info}
            write(manifest_path, manifest)
        return manifest['wholeVideo']


def render_seatbelt_profile(temp):
    """可信管理器在启动工程子进程前施加独立沙箱，供真实启动回归复用。"""
    temp = Path(temp).resolve()
    darwin_temp = command(['/usr/bin/getconf', 'DARWIN_USER_TEMP_DIR']).decode().strip()
    import re
    sockets = [re.escape(str(Path(darwin_temp).resolve())) + r'/\.?com\.google\.Chrome\.[^/]+(/.*)?$',
               re.escape(darwin_temp.rstrip('/')) + r'/\.?com\.google\.Chrome\.[^/]+(/.*)?$']
    profile = '(version 1)(allow default)(deny file-write*)(allow file-write* (subpath ' + json.dumps(str(temp)) + ') (literal "/dev/null") ' + ' '.join('(regex '+json.dumps('^'+p)+')' for p in sockets) + ')'
    read_paths = json.loads(os.environ.get('VIDEOCUT_RENDER_READ_PATHS', 'null'))
    if read_paths is not None:
        require(isinstance(read_paths, list) and read_paths and all(isinstance(p, str) and Path(p).is_absolute() and p != '/' for p in read_paths), '渲染读取范围配置无效', 'CAPABILITY_MISSING')
        profile = '(version 1)(deny default)(allow process*)(allow sysctl-read)(allow mach-lookup)(allow file-read-metadata)(allow file-read-data (literal "/"))'
        profile += '(allow file-read* ' + ' '.join('(subpath '+json.dumps(p)+')' for p in read_paths) + ')'
        profile += '(allow file-write* (subpath '+json.dumps(str(temp))+') (literal "/dev/null"))'
        profile += '(allow file-read* file-write* ' + ' '.join('(regex '+json.dumps('^'+p)+')' for p in sockets) + ')'
        profile += '(allow network* (local ip "localhost:*") (remote ip "localhost:*"))'
        # Chrome 的单实例锁通过本机 Unix socket 通信，不能只放行 TCP 回环。
        profile += '(allow network* (local unix-socket) (remote unix-socket))'
        profile += '(allow ipc-posix-shm-read-data)(allow user-preference-read)(allow iokit-open (iokit-user-client-class "RootDomainUserClient"))'
        profile += '(allow file-read* (subpath "/private/var/db/timezone"))'
        profile += '(allow mach-register (global-name-prefix "com.google.Chrome."))'
        profile += '(allow iokit-open (iokit-user-client-class "IOSurfaceRootUserClient") (iokit-user-client-class-regex "^IGAccel"))'
        profile += '(allow signal (target children))'
    return profile


def preflight(node, modules, browser):
    # 无网络、无 TTS；输出版本和可用编码能力，不读取凭据。
    encoders = command([os.environ.get('FFMPEG', 'ffmpeg'), '-hide_banner', '-encoders']).decode()
    require('aac' in encoders, 'FFmpeg 缺少 AAC 编码器', 'CAPABILITY_MISSING')
    modules = Path(modules)
    versions = {n: read(modules / n / 'package.json')['version'] for n in ('remotion', '@remotion/renderer', '@remotion/bundler')}
    require(len(set(versions.values())) == 1, 'Remotion 包版本不一致', 'CAPABILITY_MISSING')
    require(Path(browser).is_file() and os.access(browser, os.X_OK), '浏览器路径不可执行', 'CAPABILITY_MISSING')
    return {'node': command([node, '--version']).decode().strip(), 'packages': versions,
            'browser': command([browser, '--version']).decode().strip(), 'ffmpeg': command([os.environ.get('FFMPEG','ffmpeg'), '-version']).decode().splitlines()[0],
            'ffprobe': command([os.environ.get('FFPROBE','ffprobe'), '-version']).decode().splitlines()[0],
            'libx264': 'libx264' in encoders, 'ttsAuthenticationChecked': False,
            'note': '另需按本任务字幕工具检查其依赖；预检不代表成片或配音鉴权通过。'}


def main():
    p = argparse.ArgumentParser(description=__doc__); s = p.add_subparsers(dest='command', required=True)
    configured_slots = os.environ.get('VIDEOCUT_RENDER_SLOTS')
    if configured_slots is not None:
        try:
            configured_slots = int(configured_slots)
            require(configured_slots in (1, 2, 3, 4, 5), 'VIDEOCUT_RENDER_SLOTS 只支持 1 至 5')
        except (ValueError, StageError) as exc:
            print(json.dumps({'error': {'code': 'RENDER_SLOT_CONFIG_INVALID', 'message': str(exc)}}, ensure_ascii=False)); return 1
    for name in ('freeze-batch', 'render-batch'):
        a = s.add_parser(name)
        a.add_argument('--request', type=Path, required=True)
        a.add_argument('--node', default='node'); a.add_argument('--modules', required=True); a.add_argument('--browser', required=True)
        if name == 'freeze-batch':
            a.add_argument('--batch', required=True); a.add_argument('--project', required=True); a.add_argument('--entry', required=True); a.add_argument('--scenes', required=True)
        else:
            a.add_argument('--manifest', required=True); a.add_argument('--slots', type=int, choices=(1, 2, 3, 4, 5), default=configured_slots or 5)
    for name in ('preflight', 'render'):
        a = s.add_parser(name); a.add_argument('--node', default='node'); a.add_argument('--modules', required=True); a.add_argument('--browser', required=True)
        if name == 'render':
            a.add_argument('--request', type=Path, required=True); a.add_argument('--scene', required=True)
            a.add_argument('--project', default='project'); a.add_argument('--entry', required=True); a.add_argument('--composition', required=True)
            a.add_argument('--props'); a.add_argument('--frames', type=int, required=True)
            a.add_argument('--fixed-mix', action='store_true', help='复用本镜调整记录中的固定混音，只渲染画面')
    for name in ('extend-timeline', 'derive-timeline'):
        a = s.add_parser(name)
        a.add_argument('--request', type=Path, required=True)
        a.add_argument('--timeline', required=True)
        if name != 'derive-timeline': a.add_argument('--output', required=True)
        if name != 'extend-timeline': a.add_argument('--project', required=True)
    assemble_parser = s.add_parser('assemble'); assemble_parser.add_argument('--request', type=Path, required=True); assemble_parser.add_argument('--manifest', type=Path, required=True)
    a = p.parse_args()
    try:
        if a.command in ('freeze-batch', 'render-batch'):
            if a.command == 'render-batch' and configured_slots is not None:
                require(a.slots == configured_slots, '当前任务的渲染槽位由 Worker 固定', 'RENDER_SLOT_CONFIG_INVALID')
            from render_batch import freeze_batch, render_batch
            result = freeze_batch(a) if a.command == 'freeze-batch' else render_batch(a)
        elif a.command == 'preflight': result = preflight(a.node, a.modules, a.browser)
        elif a.command == 'assemble': result = assemble(a.request, a.manifest)
        elif a.command == 'derive-timeline':
            with execution(a.request, a.command) as (root, request, budget):
                result = derive_timeline(root, a.request, a.timeline, a.project)
        elif a.command == 'extend-timeline':
            with execution(a.request, a.command) as (root, request, budget):
                source = local(root, a.timeline)
                output = local(root, a.output, exists=False)
                require(output.is_relative_to(Path(a.request).resolve().parent), '时间轴结果必须写在当前 Render 目录')
                timeline = read(source)
                require(timeline['fps'] == request['outputSpec']['fps'], '时间轴帧率与输出规格不一致')
                plan = read(local(root, request['confirmation']['planFile']))
                require([s['id'] for s in timeline['scenes']] == [s['id'] for s in plan['scenes']], '时间轴必须覆盖确认分镜')
                for scene, confirmed in zip(timeline['scenes'], plan['scenes']):
                    require(''.join(u['text'] for u in scene['utterances']) == confirmed['text'], '时间轴口播不能改变确认文本')
                extensions = {}
                for scene in timeline['scenes']:
                    record = Path(a.request).resolve().parent/'work'/(scene['id']+'.adjustment.json')
                    if not record.exists(): continue
                    change = read(record)
                    require(digest(local(root, change['mixPath'])) == change['mixSha256'], '补帧对应混音已改变')
                    # 已由 Render 延长的区间绝不能被旧补帧记录缩回。
                    current_frames = scene['frames'] if 'frames' in scene else scene['endFrameExclusive'] - scene['startFrame']
                    extensions[scene['id']] = max(current_frames, change['requiredFrames'])
                resolved = extend_timeline(timeline, extensions)
                write(output, resolved)
                result = {'status': 'resolved', 'timeline': str(output.relative_to(root)), 'frames': resolved['totalFrames'],
                          'next': '更新工程中受影响的全局时间引用后渲染；声音编排未变时可复用固定混音。'}
        else: result = render_scene(a.request, a.scene, a.project, a.entry, a.composition, a.props, a.frames, a.node, a.modules, a.browser, a.fixed_mix)
        # 媒体步骤结果独立于模型 candidate；调用方必须同时检查 status 和产物。
        if result.get('status') in (None, 'resolved'):
            result['status'] = 'ok'
        print(json.dumps(result, ensure_ascii=False)); return 0
    except (StageError, OSError, ValueError, KeyError) as exc:
        result = failure(getattr(a, 'request', None), a.command, exc)
        if result['status'] != 'adjustment_required':
            current_project = {'RENDER_BATCH_FAILED', 'TASK_LAYOUT_INVALID', 'RENDER_FAILED', 'RENDER_TIMEOUT', 'MEDIA_INVALID', 'AUDIO_MISMATCH',
                               'CAPTION_MISSING', 'INVALID_CONTRACT', 'MISSING_INPUT', 'TIMELINE_STALE', 'VISUAL_REVIEW_REQUIRED'}
            result['status'] = 'repair_required' if result['error']['code'] in current_project else 'human_required'
            result['scope'] = 'task_project' if result['status'] == 'repair_required' else 'shared_pipeline'
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result['status'] == 'adjustment_required' else 1


if __name__ == '__main__': sys.exit(main())
