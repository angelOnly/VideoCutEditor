#!/usr/bin/env python3
"""Trusted scene-set validation against immutable task/plan/audio snapshots."""
from pathlib import Path
import sys
from validation_common import require, read, local, sha256, validate_schema, validate_mp4, validate_narration, validate_materials, cli
sys.path.insert(0,str(Path(__file__).resolve().parents[4]/'tools'))
from render_segments import normalized_scene


def validate(root):
    root=root.resolve()
    task=read(root,'task.json');validate_schema(root,task);require(task['operation']=='render','Expected render')
    manifest=read(root,'output/render-manifest.json')
    require(manifest['jobId']==task['jobId'] and manifest['planVersion']==task['planVersion'],'Wrong run/plan version')
    plan=read(root,task['input']['confirmedPlan'])['dataList'];selected=task['renderSelection']['sceneIds']
    expected=[s for s in plan if s['id'] in selected];actual=manifest['scenes']
    validate_materials(root,expected,read(root,task['input']['assetManifest'])['assets'])
    require([s['id'] for s in actual]==[s['id'] for s in expected],'Scene set/order mismatch')
    clips={a['id']:a for a in read(root,'input/audio-manifest.json')['clips']}
    quality=read(root,'output/quality-review.json')
    require(quality['jobId']==task['jobId'] and quality['passed'] is True,'Missing visual review')
    require(quality['sceneIds']==selected,'Visual review did not cover selected scenes')
    for confirmed,produced in zip(expected,actual):
        audio=clips[confirmed['id']];require(audio['text']==confirmed['content'],'Narration text mismatch')
        require(sha256(local(root,audio['path']))==audio['sha256'],'Audio hash mismatch')
        normalized,frames=normalized_scene(confirmed,audio['durationSec'],task['output']['fps'])
        require(produced['frames']==frames and abs(produced['durationSec']-frames/task['output']['fps'])<.001,'Wrong audio-driven timeline')
        require(produced['content']==confirmed['content'] and produced['extraData']==normalized['extraData'],'Confirmed content/materials changed')
        require(produced['audio']==audio,'Wrong narration evidence')
        artifact=local(root,produced['path']);require(produced['path']==f"output/scenes/{confirmed['id']}.mp4",'Unexpected scene path')
        require(sha256(artifact)==produced['sha256'],'Output hash mismatch')
        validate_mp4(artifact,task['output'],frames)
        validate_narration(artifact,local(root,audio['path']))
        require(len(produced['evidence'])>=3,'Missing beginning/middle/end frame evidence')
        for frame in produced['evidence']:local(root,frame)
    return {'jobId':task['jobId'],'sceneCount':len(actual)}

if __name__=='__main__':raise SystemExit(cli(validate))
