#!/usr/bin/env python3
"""Trusted v2 analysis gate. Does not render or publish."""
import json
import re
from pathlib import Path
from validation_common import require, read, local, probe, validate_schema, validate_materials, cli


def validate(root):
    root=root.resolve()
    import jsonschema
    task=read(root,'task.json');validate_schema(root,task)
    require(task['operation']=='analysis','Expected analysis')
    plan=read(root,'output/analysis-plan.json')
    schema=json.loads((Path(__file__).resolve().parent.parent/'references/analysis-v2.schema.json').read_text())
    jsonschema.validate(plan,schema)
    require(plan['jobId']==task['jobId'],'Wrong job ID')
    scenes=plan['dataList'];require(scenes and len({s['id'] for s in scenes})==len(scenes),'Duplicate or missing scenes')
    normalize=lambda text:re.sub(r'\s+','',text)
    require(normalize(''.join(s['content'] for s in scenes))==normalize(local(root,task['input']['script']).read_text()),'Script coverage/text changed')
    assets={a['assetId']:a for a in read(root,task['input']['assetManifest'])['assets']}
    validate_materials(root,scenes,list(assets.values()))
    understanding={a['assetId']:a for a in plan.get('materialUnderstanding',[])}
    for key,asset in assets.items():
        require(key in understanding,'Missing material understanding')
        for evidence in understanding[key]['evidence']:local(root,evidence)
    for scene in scenes:
        for group in ('videoInfoList','picInfoList'):
            for a in scene['extraData'][group]:
                require(a['assetId'] in assets,'Unknown asset ID')
                require(0<=a['startTime']<a['endTime']<=scene['dur']+.05,'Invalid placement')
                source=assets[a['assetId']]
                require(source['kind']==('video' if group=='videoInfoList' else 'image'),'Asset type mismatch')
                if group=='videoInfoList':
                    duration=float(probe(local(root,source['path']))['format']['duration'])
                    require(abs(duration-a['dur'])<.15,'Source duration incorrect')
                    require(0<=a['sourceStartTime']<a['sourceEndTime']<=duration+.05,'Source range invalid')
        if task['input']['narrationAssetId']:
            source=assets[task['input']['narrationAssetId']]
            duration=float(probe(local(root,source['path']))['format']['duration'])
            require(0<=scene.get('narrationStartTime',-1)<scene.get('narrationEndTime',-1)<=duration+.05,'Narration alignment missing or invalid')
    return {'jobId':task['jobId'],'sceneCount':len(scenes)}

if __name__=='__main__':raise SystemExit(cli(validate))
