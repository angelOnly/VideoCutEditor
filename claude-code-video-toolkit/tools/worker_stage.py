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
    load_request(request_path)
    return {'passed': True, 'artifactSha256': digest(file), 'details': details}


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
