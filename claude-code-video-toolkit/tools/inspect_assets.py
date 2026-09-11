#!/usr/bin/env python3
"""Create probe and visual evidence for Codex to inspect. No semantic claims."""
import argparse
import json
from pathlib import Path
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.agents/skills/video-pipeline/scripts'))
from validation_common import read,local,probe,command


def inspect(root):
    assets=read(root,'input/assets.json')['assets'];folder=root/'output/inspection';folder.mkdir(parents=True,exist_ok=True);results=[]
    for i,asset in enumerate(assets):
        source=local(root,asset['path']);data=probe(source);evidence=[]
        if asset['kind']=='video':
            duration=float(data['format']['duration'])
            for n,t in enumerate([0,duration/2,max(0,duration-.2)]):
                name=f'output/inspection/asset-{i}-{n}.jpg'
                command(['ffmpeg','-nostdin','-v','error','-y','-ss',str(t),'-i',str(source),'-frames:v','1',str(root/name)],120);evidence.append(name)
        elif asset['kind']=='image':
            name=f'output/inspection/asset-{i}{source.suffix}';shutil.copyfile(source,root/name);evidence.append(name)
        name=f'output/inspection/asset-{i}.json';(root/name).write_text(json.dumps(data,ensure_ascii=False,indent=2));evidence.append(name)
        results.append({'assetId':asset['assetId'],'kind':asset['kind'],'evidence':evidence,'metadata':data})
    (folder/'index.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));return results

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--job-dir',type=Path,required=True);a=p.parse_args();print(json.dumps(inspect(a.job_dir.resolve()),ensure_ascii=False))
