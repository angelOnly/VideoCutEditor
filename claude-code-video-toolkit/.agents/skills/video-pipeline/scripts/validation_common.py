#!/usr/bin/env python3
"""Local candidate gate. No API publishing or claim of perceptual correctness."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
from fractions import Fraction


class Invalid(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Invalid(message)


def number(value):
    require(type(value) in (int, float) and math.isfinite(value) and value > 0,
            'Expected a finite positive number')
    return value


def local(root, name):
    require(isinstance(name, str) and name and not Path(name).is_absolute(), 'Invalid relative path')
    path = (root / name).resolve()
    require(path.is_relative_to(root), 'Path escapes job directory')
    require(path.is_file() and path.stat().st_size > 0, f'Missing or empty file: {name}')
    return path


def read(root, name):
    value = json.loads(local(root, name).read_text(encoding='utf-8'))
    require(isinstance(value, dict), f'{name} must be an object')
    return value


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else hash_stream(stream)


def hash_stream(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()


def command(argv, timeout):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=True)
    except subprocess.CalledProcessError as exc:
        raise Invalid((exc.stderr or exc.stdout or str(exc))[-6000:]) from exc
    return result.stdout



def probe(path):
    return json.loads(command(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(path)],60))


def validate_mp4(path, spec, frames):
    data=probe(path)
    require('mp4' in data['format']['format_name'].split(','),'Expected MP4')
    videos=[s for s in data['streams'] if s['codec_type']=='video']
    audios=[s for s in data['streams'] if s['codec_type']=='audio']
    require(len(videos)==1,'Expected one video stream')
    v=videos[0]
    require(v['codec_name']=='h264' and v['pix_fmt']=='yuv420p','Expected H264/yuv420p')
    require(v['width']==spec['width'] and v['height']==spec['height'],'Resolution mismatch')
    require(abs(float(Fraction(v['avg_frame_rate']))-spec['fps'])<0.001,'FPS mismatch')
    require(audios and all(a['codec_name']=='aac' for a in audios),'AAC narration required')
    require(abs(float(v.get('duration',data['format']['duration']))-frames/spec['fps'])<=max(.1,2/spec['fps']),'Duration mismatch')
    if v.get('nb_frames','N/A')!='N/A':require(int(v['nb_frames'])==frames,'Frame count mismatch')
    command(['ffmpeg','-nostdin','-v','error','-xerror','-i',str(path),'-map','0:v:0','-map','0:a:0','-f','null','-'],600)
    return {'sha256':sha256(path),'sizeBytes':path.stat().st_size}


def cli(validate):
    parser=argparse.ArgumentParser();parser.add_argument('--job-dir',type=Path,required=True);args=parser.parse_args()
    try:
        result=validate(args.job_dir.resolve())
        print(json.dumps({'passed':True,**result},ensure_ascii=False));return 0
    except Exception as exc:
        print(json.dumps({'passed':False,'error':{'code':'VALIDATION_FAILED','message':str(exc)}},ensure_ascii=False));return 1


def validate_narration(video, reference):
    """Check that the delivered audio matches the supplied narration, allowing AAC loss/delay."""
    from array import array
    def pcm(file):
        raw=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(file),'-map','0:a:0','-ac','1','-ar','8000','-f','s16le','-'],capture_output=True,check=True,timeout=120).stdout
        values=array('h');values.frombytes(raw);return values
    a,b=pcm(reference),pcm(video)
    require(len(b)>=len(a)-160,'Narration truncated')
    require(a and max(abs(x) for x in a)>32,'Narration is silent')
    n=min(len(a),len(b));margin=min(256,n//8)
    step=max(1,(n-2*margin)//4000)
    indexes=list(range(margin,n-margin,step));require(indexes,'Audio too short')
    aa=sum(a[i]*a[i] for i in indexes)
    best=0.0
    for shift in range(-margin,margin+1,2):
        ab=sum(a[i]*b[i+shift] for i in indexes)
        bb=sum(b[i+shift]*b[i+shift] for i in indexes)
        if aa and bb:best=max(best,ab/(aa*bb)**.5)
    require(best>.90,'Rendered audio does not match narration')


def validate_materials(root, scenes, assets):
    registry={a['assetId']:a for a in assets}
    metadata={}
    for scene in scenes:
        for group in ('videoInfoList','picInfoList'):
            for item in scene['extraData'][group]:
                require(item['assetId'] in registry,'Unknown material')
                source=registry[item['assetId']]
                require(source['kind']==('video' if group=='videoInfoList' else 'image'),'Wrong material type')
                if item['assetId'] not in metadata:metadata[item['assetId']]=probe(local(root,source['path']))
                data=metadata[item['assetId']]
                if group=='videoInfoList':
                    duration=float(data['format']['duration'])
                    require(abs(duration-item['dur'])<.15,'Incorrect source video duration')
                    require(0<=item['sourceStartTime']<item['sourceEndTime']<=duration+.05,'Source interval outside media')
                else:
                    stream=next(s for s in data['streams'] if s['codec_type']=='video')
                    require(item['w']==stream['width'] and item['h']==stream['height'],'Incorrect source image dimensions')
