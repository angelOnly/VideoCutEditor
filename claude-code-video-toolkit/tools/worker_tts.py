#!/usr/bin/env python3
"""Trusted Worker-only TTS adapter. The database caller owns deduplication."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
from doubao_tts import generate_audio


def main():
    p=argparse.ArgumentParser();p.add_argument('--request',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    request=json.loads(a.request.read_text())
    a.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=a.output.parent) as temp:
        mp3=Path(temp)/'voice.mp3'
        result=generate_audio(request['text'],str(mp3),speaker=request['voiceId'],resource_id=request['resourceId'])
        if not result.get('success'): raise RuntimeError('TTS provider did not confirm success')
        wav=Path(temp)/'voice.wav'
        subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(mp3),'-ar','48000','-ac','2',str(wav)],check=True,timeout=120)
        wav.replace(a.output)
    return 0

if __name__=='__main__': raise SystemExit(main())
