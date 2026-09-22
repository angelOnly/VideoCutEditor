#!/usr/bin/env python3
"""Worker 可信桥接：只读终检与收费配音；不承担制作决策。"""
import argparse
import json
from pathlib import Path
import shutil
from two_stage import load_request, read, local, digest, require, validate_plan


def check(request_path, artifact):
    root, request = load_request(request_path)
    file = local(root, artifact)
    value = read(file)
    if request['stage'] == 'analysis':
        details = validate_plan(root, request, value)
        require(not any(p for d in ('output','project','cache','analysis') for p in (root/d).rglob('*.mp4')), 'analysis 本轮产生 MP4')
        require(not any((root/'cache').rglob('request.json')), 'analysis 本轮产生 TTS 记录')
    else:
        from stage_media import validate_delivery
        details = validate_delivery(root, request, value)
        details['timeline'] = check_timeline(root, request, value)
    load_request(request_path)
    return {'passed': True, 'artifactSha256': digest(file), 'details': details}


def check_timeline(root, request, manifest):
    """独立测量句级音频与字幕边界，不信任模型自报审查通过。"""
    from stage_media import audio_info
    timeline = read(local(root, f'render/{request["runId"]}/timeline.json'))
    fps = request['outputSpec']['fps']
    require(timeline.get('fps') == fps, '实际时间轴 fps 不符')
    scenes = timeline.get('scenes', [])
    require([s['id'] for s in scenes] == [s['id'] for s in manifest['scenes']], '实际时间轴分镜不符')
    offset = 0
    for actual, produced in zip(scenes, manifest['scenes']):
        require(actual.get('startFrame') == offset and actual.get('endFrameExclusive') == offset + produced['frames'], '全局时间轴偏移不符')
        offset += produced['frames']
        utterances, captions = actual.get('utterances', []), actual.get('captions', [])
        require(utterances and len(utterances) == len(captions), '缺少句级音频或对应字幕', 'CAPTION_MISSING')
        require(''.join(u['text'] for u in utterances) == produced['text'], '句级音频文本与确认不符')
        require(len({u['id'] for u in utterances}) == len(utterances), '句级音频 ID 重复')
        end = 0
        for u, c in zip(utterances, captions):
            start, stop = u['startFrame'], u['endFrameExclusive']
            require(type(start) is int and type(stop) is int and end <= start < stop <= produced['frames'], '句级音频边界无效')
            end = stop
            require(c.get('utteranceId') == u['id'] and c['text'] == u['text'] and c['startFrame'] == start and c['endFrameExclusive'] == stop, '字幕未跟随实际句级音频')
            # audioPath 从任务根定位；src 留给工程 public 目录内引用。
            audio = local(root, u.get('audioPath', u['src']))
            seconds = audio_info(audio)['durationSeconds']
            require(abs(seconds - (stop - start) / fps) <= 1 / fps + .02, '句级音频被截断或使用估算时长')
        require(len(produced['captions']) == len(captions), '成品字幕清单与时间轴不符')
        for c, p in zip(captions, produced['captions']):
            require(c['text'] == p['text'] and abs(c['startFrame']/fps-p['startSeconds']) < 1e-5 and abs(c['endFrameExclusive']/fps-p['endSeconds']) < 1e-5, '成品字幕未使用实际时间轴')
    return {'frames': offset, 'sceneCount': len(scenes)}


def tts(request_path, script_path, cache):
    # 外部账本目录由 Worker 固定传入，不接受模型自定义缓存或供应商地址。
    from stage_tts import generate
    return generate(request_path, script_path, cache_root=Path(cache))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['check', 'tts']); p.add_argument('--request', required=True, type=Path)
    p.add_argument('--artifact'); p.add_argument('--script', type=Path); p.add_argument('--cache', type=Path)
    a=p.parse_args()
    try:
        value=check(a.request,a.artifact) if a.action=='check' else tts(a.request,a.script,a.cache)
        print(json.dumps(value,ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'passed':False,'error':{'code':getattr(exc,'code','EXECUTION_FAILED'),'message':str(exc),'retryable':getattr(exc,'retryable',False)}},ensure_ascii=False))

if __name__=='__main__': main()
