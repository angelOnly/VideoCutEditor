#!/usr/bin/env python3
"""Worker 可信桥接：只读终检与收费配音；不承担制作决策。"""
import argparse
import json
from pathlib import Path
import shutil
from two_stage import load_request, read, local, digest, json_digest, require, validate_plan


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
    from stage_media import audio_info, project_fingerprint
    timeline = read(local(root, f'render/{request["runId"]}/timeline.json'))
    fps = request['outputSpec']['fps']
    require(timeline.get('fps') == fps, '实际时间轴 fps 不符')
    scenes = timeline.get('scenes', [])
    require([s['id'] for s in scenes] == [s['id'] for s in manifest['scenes']], '实际时间轴分镜不符')
    # 句级一对一属于冻结模板声明，不由通用协议强加。
    template = read(local(root, request['input']['templateSnapshot']))
    template_root = template.get('root')
    declaration = local(root, template_root + '/renderer/renderer-manifest.json', exists=False) if template_root else None
    sentence_audio = bool(declaration and declaration.is_file() and read(declaration).get('sentenceAudioValidator'))
    offset = 0
    project_hashes = {}
    for actual, produced in zip(scenes, manifest['scenes']):
        if (root / '.control/policy.json').exists():
            registry = root / '.control/progress.json'
            receipt = read(registry).get(actual['id'], {}) if registry.exists() else {}
            require(receipt.get('timelineHash') == digest(local(root, f'render/{request["runId"]}/timeline.json'))
                    and receipt.get('path') == produced['path']
                    and receipt.get('sha256') == digest(local(root, produced['path'])),
                    '画面不是基于最终时间轴生成，需要更新受影响镜头', 'TIMELINE_STALE')
            project = receipt.get('project')
            if project and project not in project_hashes:
                project_hashes[project] = json_digest(project_fingerprint(local(root, project, exists=False)))
            require(project and receipt.get('projectHash') == project_hashes[project],
                    '工程已经改变，需要重渲受影响画面', 'TIMELINE_STALE')
        require(actual.get('startFrame') == offset and actual.get('endFrameExclusive') == offset + produced['frames'], '全局时间轴偏移不符')
        offset += produced['frames']
        utterances, captions = actual.get('utterances', []), actual.get('captions', [])
        require(utterances or not produced['text'].strip(), '缺少实际口播来源', 'AUDIO_MISMATCH')
        alignment = None
        if sentence_audio and actual.get('captionTiming'):
            reference = actual['captionTiming']
            alignment_file = local(root, reference['path'])
            require(digest(alignment_file) == reference['sha256'], '字幕对齐记录摘要不符')
            alignment = read(alignment_file)
            require(alignment.get('method') in ('provider_timestamps', 'forced_alignment', 'reviewed_timestamps'), '字幕分页缺少可靠时间依据')
        if sentence_audio:
            require(''.join(c['text'] for c in captions) == produced['text'], '字幕丢字或顺序不符', 'CAPTION_MISSING')
            require(all(c.get('utteranceId') in {u['id'] for u in utterances} for c in captions), '字幕没有绑定实际音频')
            if not alignment:
                require(len(utterances) == len(captions), '多页字幕须提供音频绑定的对齐记录', 'CAPTION_MISSING')
        require(''.join(u['text'] for u in utterances) == produced['text'], '句级音频文本与确认不符')
        require(len({u['id'] for u in utterances}) == len(utterances), '句级音频 ID 重复')
        end = 0
        for index, u in enumerate(utterances):
            start, stop = u['startFrame'], u['endFrameExclusive']
            require(type(start) is int and type(stop) is int and end <= start < stop <= produced['frames'], '句级音频边界无效')
            end = stop
            if sentence_audio:
                pages = [c for c in captions if c.get('utteranceId') == u['id']]
                require(''.join(c['text'] for c in pages) == u['text'] and all(start <= c['startFrame'] < c['endFrameExclusive'] <= stop for c in pages), '字幕未跟随实际音频')
                if not alignment:
                    require(len(pages) == 1 and pages[0]['startFrame'] == start and pages[0]['endFrameExclusive'] == stop, '字幕未跟随实际句级音频')
            # audioPath 从任务根定位；src 留给工程 public 目录内引用。
            audio = local(root, u.get('audioPath', u['src']))
            if alignment:
                evidence = alignment.get('utterances', {}).get(u['id'], {})
                require(evidence.get('audioSha256') == digest(audio), '字幕对齐记录音频不符')
                require(evidence.get('captions') == [{k:c[k] for k in ('text','startFrame','endFrameExclusive')} for c in pages], '字幕分页与可靠时间记录不符')
            seconds = audio_info(audio)['durationSeconds']
            require(seconds <= (stop - start) / fps + 1e-6, '实际口播窗口截断音频')
            if sentence_audio:
                require((stop - start) / fps - seconds <= 1 / fps + .02, '模板句级字幕未使用真实音频边界')
        require(len(produced['captions']) == len(captions), '成品字幕清单与时间轴不符')
        caption_end = 0
        for c, p in zip(captions, produced['captions']):
            require(type(c['startFrame']) is int and type(c['endFrameExclusive']) is int and caption_end <= c['startFrame'] < c['endFrameExclusive'] <= produced['frames'], '字幕越界或重叠')
            caption_end = c['endFrameExclusive']
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
