#!/usr/bin/env python3
"""两阶段通用媒体执行与验证，不包含模板布局或角色决策。"""
from __future__ import annotations

import argparse
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


def command(argv, timeout=120):
    try:
        p = subprocess.run(argv, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise StageError('TOOL_TIMEOUT', '媒体工具超时', True) from exc
    require(p.returncode == 0, p.stderr.decode(errors='replace')[-3000:], 'MEDIA_INVALID')
    return p.stdout


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
    ffmpeg('-xerror', '-i', path, '-map', '0:a:0', '-f', 'null', '-')
    return {'durationSeconds': duration, 'sha256': digest(path), 'sampleRate': int(audios[0]['sample_rate'])}


def pcm(path):
    raw = ffmpeg('-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-')
    values = array('h'); values.frombytes(raw)
    if sys.byteorder != 'little': values.byteswap()
    return values


def compare_audio(media, reference, allow_silence=False):
    return compare_samples(pcm(reference), pcm(media), allow_silence)


def compare_samples(a, b, allow_silence=False):
    require(a and b, '混音或成片音轨为空', 'AUDIO_MISMATCH')
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


def validate_delivery(root, request, manifest):
    schema(manifest, 'manifest')
    for key in ('taskId', 'runId', 'stage', 'contractVersion'):
        require(manifest[key] == request[key], f'结果 {key} 不匹配')
    confirmation = request['confirmation']
    require(manifest['planVersion'] == confirmation['planVersion'] and manifest['confirmedPlanSha256'] == confirmation['planSha256'], '结果确认版本不符')
    plan = read(local(root, confirmation['planFile']))
    require([s['id'] for s in manifest['scenes']] == [s['id'] for s in plan['scenes']], '镜头缺失、重复或乱序')
    assets = {a['id']: a for a in read(local(root, request['input']['assetsManifest']))['assets']}
    review = read(local(root, manifest['quality'])); schema(review, 'review')
    for key in ('taskId', 'runId', 'stage', 'contractVersion', 'confirmedPlanSha256'):
        require(review[key] == manifest[key], '视觉审查版本不符')
    require([s['id'] for s in review['scenes']] == [s['id'] for s in plan['scenes']], '视觉审查未覆盖全部镜头')
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
        report['audio'] = compare_audio(path, audio, allow_silence=not actual['text'].strip())
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
            compare_samples(pcm(local(root, scene['audio']['path'])), whole_pcm[start:end], allow_silence=not scene['text'].strip())
            offset += scene['frames']
    return {'sceneCount': len(reports), 'frames': total, 'sceneChecks': reports,
            'humanListeningPerformed': review['humanListeningPerformed'], 'limitations': review['limitations']}


def supervise(argv, cwd, log, done_file, timeout, close_timeout=10):
    """独立进程组；完成标记之后仍需由调用方验证实际文件。"""
    started, closing = time.monotonic(), None
    with Path(log).open('wb') as output:
        child = subprocess.Popen(argv, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        process_record = Path(log).with_suffix('.process.json')
        record = {'state': 'running', 'pid': child.pid, 'signature': process_signature(child.pid), 'startedAt': time.time()}
        write(process_record, record)
        try:
            while child.poll() is None:
                now = time.monotonic()
                if Path(done_file).exists() and closing is None: closing = now
                if closing is not None and now - closing > close_timeout:
                    return {'closeTimedOut': True, 'pid': child.pid}
                if now - started > timeout:
                    raise StageError('RENDER_TIMEOUT', '本次渲染进程超时', True)
                time.sleep(.1)
            require(child.returncode == 0 and Path(done_file).is_file(), f'渲染失败，查看 {log}', 'RENDER_FAILED')
            return {'closeTimedOut': False, 'pid': child.pid}
        finally:
            # 根进程退出也可能留下浏览器，只回收自己创建的进程组。
            try: os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError: pass
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


def mux_scene(video, mix, output, spec, frames, timeout=600):
    """只封装画面和已完成的全量混音，不改写口播、音效或业务时间轴。"""
    seconds = frames / spec['fps']
    info = audio_info(mix)
    # Remotion 的 adelay 将非整毫秒入场时间取整；尾部 padding 因而可能偏差不足 1ms。
    # 只归一化这一量级的静音边界，绝不截掉有效声音来强行匹配画面。
    sample_rate = info['sampleRate']
    delta_samples = round((info['durationSeconds'] - seconds) * sample_rate)
    if abs(delta_samples) > math.ceil(sample_rate / 1000):
        details = {'step': 'mix', 'expectedSeconds': seconds, 'mixSeconds': info['durationSeconds']}
        raise StageError('AUDIO_MISMATCH', f'无损混音与实际时间轴不等长：{details}', details=details)
    if delta_samples > 0:
        tail = ffmpeg('-i', mix, '-map', '0:a:0', '-af', f'atrim=start_sample={round(seconds * sample_rate)}',
                      '-c:a', 'pcm_s16le', '-f', 's16le', '-')
        require(not any(tail), '无损混音超出时间轴的尾部包含有效声音，不能截断', 'AUDIO_MISMATCH')
    samples = round(seconds * 48000)
    ffmpeg('-y', '-copyts', '-i', video, '-i', mix, '-map', '0:v:0', '-map', '1:a:0',
           '-c:v', 'copy', '-af', f'aresample=48000,apad,atrim=end_sample={samples},asetpts=PTS-STARTPTS',
           '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output, timeout=timeout)
    report = validate_mp4(output, spec, frames)
    report['audioCheck'] = compare_audio(output, mix, allow_silence=True)
    report['mixBoundaryAdjustmentSamples'] = delta_samples
    return report


def render_scene(request_path, scene_id, project_name, entry_name, composition, props_name, frames, node, modules, browser):
    identifier(scene_id)
    with execution(request_path, 'render:' + scene_id) as (root, request, budget):
        plan = read(local(root, request['confirmation']['planFile']))
        require(scene_id in [s['id'] for s in plan['scenes']], '未确认的分镜')
        require(type(frames) is int and frames > 0, '需要实际总帧数')
        project = local(root, project_name, exists=False)
        require(project.is_dir() and project != root, '需要独立项目目录')
        entry = local(root, entry_name); require(entry.is_relative_to(project), '入口不在项目目录')
        props = read(local(root, props_name)) if props_name else {}
        out_dir = root / 'output' / request['runId'] / 'scenes'; out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / (scene_id + '.mp4'); marker = out.with_suffix('.render.json')
        modules = Path(modules).resolve()
        packages = {n: digest(modules / n / 'package.json') for n in ('remotion', '@remotion/renderer', '@remotion/bundler')}
        fingerprint = json_digest({'project': project_fingerprint(project), 'entry': str(entry), 'composition': composition,
                                   'props': props, 'spec': request['outputSpec'], 'frames': frames, 'packages': packages,
                                   'confirmedPlanSha256': request['confirmation']['planSha256'], 'renderer': digest(Path(__file__).with_name('render_scene.cjs'))})
        if marker.exists() and out.exists():
            old = read(marker)
            if old['fingerprint'] == fingerprint and old['sha256'] == digest(out):
                return {**validate_mp4(out, request['outputSpec'], frames), 'path': str(out.relative_to(root)),
                        'mix': old.get('mix'), 'evidence': extract_frames(root, request, scene_id, out, frames), 'reused': True}
        work = Path(request_path).resolve().parent / 'work'; work.mkdir(exist_ok=True)
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
                video, mix = temp / 'video.mp4', temp / 'mix.wav'
                config = {'entry': str(entry), 'project': str(project), 'composition': composition, 'props': props, 'modules': str(modules),
                          'browser': browser, 'output': str(video), 'audio': str(mix), 'done': str(done), 'bundle': str(temp/'bundle'),
                          'spec': request['outputSpec'], 'frames': frames}
                write(temp / 'config.json', config)
                recovery = supervise([node, str(Path(__file__).with_name('render_scene.cjs')), str(temp/'config.json')],
                                     project, work / (scene_id+'.log'), done, budget)
                write(raw_marker, {'fingerprint': fingerprint, 'video': str(video.relative_to(root)),
                                   'mix': str(mix.relative_to(root)), 'videoSha256': digest(video),
                                   'mixSha256': digest(mix), 'recovery': recovery})
            info = mux_scene(video, mix, target, request['outputSpec'], frames, budget)
            load_request(request_path, 'render')
            publish_file(target, out)
            mixed = {'path': str(mix.relative_to(root)), 'sha256': digest(mix)}
            write(marker, {'fingerprint': fingerprint, 'mix': mixed, **info, **recovery})
        except BaseException:
            # 失败媒体和配置保留在本次 work 中，供检查原故障区间。
            raise
        else:
            # 保留画面和混音用于封装修复，体积较大的临时网页可删除。
            if (temp / 'bundle').exists(): shutil.rmtree(temp / 'bundle')
        evidence = extract_frames(root, request, scene_id, out, frames)
        return {**info, 'path': str(out.relative_to(root)), 'mix': mixed, 'evidence': evidence,
                'reused': False, 'renderReused': raw_reused}


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
                (temp / f'{i}.mp4').symlink_to(local(root, scene['path']))
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
    for name in ('preflight', 'render'):
        a = s.add_parser(name); a.add_argument('--node', default='node'); a.add_argument('--modules', required=True); a.add_argument('--browser', required=True)
        if name == 'render':
            a.add_argument('--request', type=Path, required=True); a.add_argument('--scene', required=True)
            a.add_argument('--project', default='project'); a.add_argument('--entry', required=True); a.add_argument('--composition', required=True)
            a.add_argument('--props'); a.add_argument('--frames', type=int, required=True)
    assemble_parser = s.add_parser('assemble'); assemble_parser.add_argument('--request', type=Path, required=True); assemble_parser.add_argument('--manifest', type=Path, required=True)
    a = p.parse_args()
    try:
        if a.command == 'preflight': result = preflight(a.node, a.modules, a.browser)
        elif a.command == 'assemble': result = assemble(a.request, a.manifest)
        else: result = render_scene(a.request, a.scene, a.project, a.entry, a.composition, a.props, a.frames, a.node, a.modules, a.browser)
        print(json.dumps(result, ensure_ascii=False)); return 0
    except (StageError, OSError, ValueError, KeyError) as exc:
        print(json.dumps(failure(getattr(a, 'request', None), a.command, exc), ensure_ascii=False)); return 1


if __name__ == '__main__': sys.exit(main())
