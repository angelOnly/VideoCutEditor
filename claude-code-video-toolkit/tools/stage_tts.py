#!/usr/bin/env python3
"""由 Codex 提交已确认口播和音色，执行本任务配音并记录实际时长。"""
import argparse
import json
from pathlib import Path
import sys
from cached_tts import synthesize_cached
from two_stage import StageError, execution, identifier, local, read, require, write, failure


def generate(request_path, script_path, cache_root=None):
    with execution(request_path, 'tts') as (root, request, remaining):
        script_path = Path(script_path).resolve()
        require(script_path.is_relative_to(root), '配音清单必须属于本任务')
        items = read(script_path)
        require(isinstance(items, list) and items, '配音清单不能为空')
        plan = read(local(root, request['confirmation']['planFile']))
        scenes = {s['id']: s for s in plan['scenes']}
        ids, texts = set(), {s: '' for s in scenes}
        for item in items:
            identifier(item['id']); require(item['id'] not in ids, '配音 ID 重复'); ids.add(item['id'])
            require(item['sceneId'] in scenes and isinstance(item['text'], str) and item['text'].strip(), '配音内容无效')
            require(isinstance(item['speaker'], str) and item['speaker'], '必须显式指定实际音色')
            texts[item['sceneId']] += item['text']
        # 支持一镜多人发言；本次清单可以只包含需要制作的镜头，但每镜必须全文。
        for scene_id in {i['sceneId'] for i in items}:
            require(texts[scene_id] == scenes[scene_id]['text'], '配音文本与确认方案不同')
        from config import get_doubao_tts_resource_id
        resource = get_doubao_tts_resource_id()
        import time
        started = time.monotonic(); clips = []
        manifest_path = Path(request_path).resolve().parent/'audio-manifest.json'
        previous = read(manifest_path) if manifest_path.exists() else {}
        stored = {c['id']: c for c in previous.get('clips', [])}
        if previous:
            require(previous['confirmedPlanSha256'] == request['confirmation']['planSha256'], '历史配音清单确认版本不符')
        for item in items:
            require(time.monotonic()-started < remaining, '阶段预算耗尽', 'BUDGET_EXHAUSTED')
            clip = synthesize_cached(item['text'], item['speaker'], resource, cache_root or root/'cache/tts')
            if cache_root is not None:
                import shutil
                target = root/'tool-audio'/Path(clip['path']).name
                target = target.with_name(clip['cacheKey'] + target.suffix)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(clip['path'], target)
                clip = {**clip, 'path': str(target)}
            clips.append({**item, 'path': str(Path(clip['path']).relative_to(root)), 'sha256': clip['audio']['sha256'],
                          'durationSeconds': clip['audio']['durationSeconds'], 'cacheKey': clip['cacheKey'],
                          'requestId': clip['requestId'], 'reused': clip['reused']})
            # 每条成功即保存，后续失败也能看到已完成项。
            stored[item['id']] = clips[-1]
            write(manifest_path, {'taskId': request['taskId'], 'runId': request['runId'],
                  'confirmedPlanSha256': request['confirmation']['planSha256'], 'clips': list(stored.values())})
        return {'clips': clips}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--request',type=Path,required=True);p.add_argument('--script',type=Path,required=True);a=p.parse_args()
    try:
        print(json.dumps(generate(a.request,a.script),ensure_ascii=False));return 0
    except (StageError,OSError,ValueError,KeyError,ImportError) as exc:
        print(json.dumps(failure(a.request, 'tts', exc),ensure_ascii=False));return 1


if __name__=='__main__':sys.exit(main())
