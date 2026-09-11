#!/usr/bin/env python3
"""Render only confirmed scenes through the admitted Remotion template; no TTS calls."""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

SCRIPTS=Path(__file__).resolve().parents[1]/'.agents/skills/video-pipeline/scripts'
sys.path.insert(0,str(SCRIPTS))
from validation_common import read, local, require, sha256, command, probe


def normalized_scene(scene, audio_duration, fps):
    """The authoritative deterministic timing rule, also used by the trusted validator."""
    result=copy.deepcopy(scene)
    frames=max(1,math.ceil(audio_duration*fps))
    duration=frames/fps
    ratio=duration/scene['dur']
    for group in ('videoInfoList','picInfoList'):
        for a in result['extraData'][group]:
            start=max(0,round(a['startTime']*ratio*fps));end=min(frames,round(a['endTime']*ratio*fps))
            require(end>start,'Asset shorter than one output frame')
            a['startTime']=start/fps;a['endTime']=end/fps
            if group=='videoInfoList':
                rate=a.get('playbackRate',1)
                available=a['sourceEndTime']-a['sourceStartTime'];needed=(end-start)/fps*rate
                a['sourceEndTime']=a['sourceStartTime']+min(available,needed)
                a['playbackRate']=rate;a['freezeLastFrame']=available<needed-0.001
    result['dur']=duration
    return result,frames


def render(root,browser=None):
    task=read(root,'task.json');require(task['operation']=='render','Expected render task')
    plan=read(root,task['input']['confirmedPlan']);audio=read(root,'input/audio-manifest.json')['clips'];assets=read(root,task['input']['assetManifest'])['assets']
    selected=task['renderSelection']['sceneIds'];fps=task['output']['fps']
    template=Path(__file__).resolve().parents[1]/'templates/ifeng-scenes'
    project=root/'project';project.mkdir(exist_ok=True)
    # Every run uses admitted code. Agent edits cannot replace the fixed renderer or entry point.
    shutil.copytree(template/'src',project/'src',dirs_exist_ok=True)
    for file in ('package.json','tsconfig.json'): shutil.copyfile(template/file,project/file)
    modules=project/'node_modules'
    if not modules.exists():modules.symlink_to(template/'node_modules',target_is_directory=True)
    public=project/'public';public.mkdir(exist_ok=True)
    out=root/'output';(out/'scenes').mkdir(parents=True,exist_ok=True);(out/'frames').mkdir(exist_ok=True)
    compositions=[];rendered=[]
    for scene in plan['dataList']:
        if scene['id'] not in selected:continue
        clip=next(c for c in audio if c['id']==scene['id'])
        require(clip['text']==scene['content'],'Audio text mismatch')
        normalized,frames=normalized_scene(scene,clip['durationSec'],fps)
        audio_file=scene['id']+'.wav';shutil.copyfile(local(root,clip['path']),public/audio_file)
        placements=[]
        if scene['extraData']['digitalHumanId']:
            require(any(a['role']=='presenter' for a in scene['extraData']['videoInfoList']),'AVATAR_ASSET_REQUIRED: use a pre-generated matching presenter clip')
        items=[(a,'image') for a in normalized['extraData']['picInfoList']]+[(a,'video') for a in normalized['extraData']['videoInfoList']]
        items.sort(key=lambda pair:({'background':0,'content':1,'presenter':2}[pair[0]['role']],pair[0]['order']))
        for index,(a,kind) in enumerate(items):
            source=next(x for x in assets if x['assetId']==a['assetId'])
            input_path=local(root,source['path']);start=round(a['startTime']*fps);count=round((a['endTime']-a['startTime'])*fps)
            if kind=='video':
                filename=f"{scene['id']}_{index}.mp4"
                source_duration=a['sourceEndTime']-a['sourceStartTime'];rate=a.get('playbackRate',1)
                # Normalize source speed and freeze extension before placing on the Remotion timeline.
                filters=f"setpts=(PTS-STARTPTS)/{rate},scale={task['output']['width']}:{task['output']['height']}:force_original_aspect_ratio=increase,crop={task['output']['width']}:{task['output']['height']},fps={fps},tpad=stop_mode=clone:stop_duration={count/fps},format=yuv420p"
                command(['ffmpeg','-nostdin','-v','error','-y','-ss',str(a['sourceStartTime']),'-t',str(source_duration),'-i',str(input_path),'-an','-vf',filters,'-frames:v',str(count),'-c:v','libx264','-preset','veryfast',str(public/filename)],600)
            else:
                filename=f"{scene['id']}_{index}{input_path.suffix}";shutil.copyfile(input_path,public/filename)
            placements.append({'kind':kind,'file':filename,'startFrame':start,'frames':count,'role':a['role']})
        compositions.append({'id':scene['id'],'content':scene['content'],'frames':frames,'audio':audio_file,'animationPreset':scene['visualPlan']['animationPreset'],'layoutPreset':scene['visualPlan']['layoutPreset'],'keywords':scene['extraData']['keywordList'],'assets':placements})
        rendered.append({'id':scene['id'],'path':f"output/scenes/{scene['id']}.mp4",'content':scene['content'],'durationSec':frames/fps,'frames':frames,'extraData':normalized['extraData'],'audio':clip,'evidence':[]})
    (project/'src/scenes.json').write_text(json.dumps({**{k:task['output'][k] for k in ('width','height','fps')},'scenes':compositions},ensure_ascii=False))
    cli=template/'node_modules/@remotion/cli/remotion-cli.js'
    require(cli.is_file(),'Remotion is not installed in admitted template')
    for index,item in enumerate(rendered):
        argv=['node',str(cli),'render',str(project/'src/index.tsx'),f'scene-{index}',str(root/item['path']),'--codec=h264','--color-space=bt709','--pixel-format=yuv420p','--audio-codec=aac','--concurrency=1','--log=error','--public-dir='+str(public)]
        if browser:argv.append('--browser-executable='+browser)
        log=command(argv,3600);(out/'render.log').write_text(log)
        for n,frame in enumerate([0,item['frames']//2,item['frames']-1]):
            target=f"output/frames/{item['id']}-{n}.jpg"
            command(['ffmpeg','-nostdin','-v','error','-y','-i',str(root/item['path']),'-vf',f'select=eq(n\\,{frame})','-frames:v','1',str(root/target)],120)
            item['evidence'].append(target)
        item['sha256']=sha256(root/item['path'])
    manifest={'schemaVersion':2,'jobId':task['jobId'],'planVersion':task['planVersion'],'scenes':rendered}
    (out/'render-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--job-dir',required=True,type=Path);p.add_argument('--browser-executable',default=os.environ.get('REMOTION_BROWSER_EXECUTABLE'));a=p.parse_args()
    print(json.dumps(render(a.job_dir.resolve(),a.browser_executable),ensure_ascii=False))
