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


import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from validation_common import Invalid, require, number, local, read, sha256, hash_stream, command


def validate(root, timeout=600):
    root = root.resolve()
    task = read(root, 'task.json')
    require(task['schemaVersion'] == 1 and task['mode'] == 'auto', 'Expected v1 auto task')
    require(isinstance(task['jobId'], str) and bool(task['jobId']), 'Missing jobId')
    local(root, task['input']['script'])
    for asset in task['input'].get('assets', []):
        if asset.get('required', False):
            local(root, asset['path'])
    spec = task['output']
    for key in ('width', 'height'):
        require(type(spec[key]) is int and spec[key] > 0 and spec[key] % 2 == 0, f'Invalid {key}')
    fps = number(spec['fps'])
    require(type(spec['requireAudio']) is bool, 'requireAudio must be boolean')
    stages = {}
    for name in ('normalized-input', 'plan', 'audio-manifest', 'project-manifest', 'timeline', 'quality-report'):
        stages[name] = read(root, name + '.json')
        require(stages[name].get('schemaVersion') == 1 and stages[name].get('jobId') == task['jobId'],
                f'Wrong identity in {name}')
    files = stages['normalized-input']['files']
    require(isinstance(files, list) and bool(files), 'Missing normalized inputs')
    require(task['input']['script'] in [item['path'] for item in files], 'Script missing from input hashes')
    for item in files:
        require(sha256(local(root, item['path'])) == item['sha256'], 'Input hash mismatch')
    clips = stages['audio-manifest']['clips']
    require(isinstance(clips, list), 'Invalid audio manifest')
    require(not spec['requireAudio'] or bool(clips), 'Missing narration evidence')
    for clip in clips:
        require(sha256(local(root, clip['path'])) == clip['sha256'], 'Audio hash mismatch')
        number(clip['durationSec'])
    timeline = stages['timeline']
    require(abs(number(timeline['fps']) - fps) < 0.001, 'Timeline FPS mismatch')
    total = timeline['totalFrames']
    require(type(total) is int and total > 0, 'Invalid totalFrames')
    duration = number(timeline['durationSec'])
    require(abs(total / fps - duration) <= 1 / fps + 0.001, 'Timeline duration mismatch')
    scenes = timeline['scenes']
    require(isinstance(scenes, list) and bool(scenes), 'Missing scenes')
    require([s['id'] for s in scenes] == [s['id'] for s in stages['plan']['scenes']], 'Plan scenes mismatch')
    require(scenes[0]['startFrame'] == 0 and scenes[-1]['endFrame'] == total, 'Scene coverage incomplete')
    for previous, current in zip(scenes, scenes[1:]):
        require(previous['startFrame'] <= current['startFrame'] <= previous['endFrame'], 'Scene gap or order mismatch')
    for group in ('scenes', 'captions', 'audio'):
        require(isinstance(timeline[group], list), f'Invalid {group}')
        for item in timeline[group]:
            start, end = item['startFrame'], item['endFrame']
            require(type(start) is int and type(end) is int and 0 <= start < end <= total, 'Invalid frame interval')
            if group == 'audio':
                local(root, item['path'])
    require(not spec['requireAudio'] or bool(timeline['audio']), 'Missing timeline audio')
    quality = stages['quality-report']
    require(quality.get('passed') is True and bool(quality.get('checks')), 'Quality checks not passed')
    require(all(c.get('passed') is True and c.get('name') and c.get('evidence') for c in quality['checks']), 'Incomplete quality checks')
    require(isinstance(quality.get('frames'), list) and bool(quality['frames']), 'Missing frame evidence')
    for frame in quality['frames']:
        local(root, frame)
    local(root, 'render.log')
    video = local(root, 'output/video.mp4')
    probe = json.loads(command(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(video)], min(timeout, 60)))
    require('mp4' in probe['format']['format_name'].split(','), 'Expected MP4 container')
    videos = [s for s in probe['streams'] if s['codec_type'] == 'video']
    audios = [s for s in probe['streams'] if s['codec_type'] == 'audio']
    require(len(videos) == 1, 'Expected one video stream')
    v = videos[0]
    require(v['codec_name'] == 'h264' and v['pix_fmt'] == 'yuv420p', 'Expected H.264 yuv420p')
    require(v['width'] == spec['width'] and v['height'] == spec['height'], 'Resolution mismatch')
    actual_fps = float(Fraction(v['avg_frame_rate']))
    require(abs(actual_fps - fps) < 0.001, 'Video FPS mismatch')
    require(not spec['requireAudio'] or bool(audios), 'Required audio stream missing')
    require(all(a['codec_name'] == 'aac' for a in audios), 'Expected AAC audio')
    if stages['project-manifest'].get('renderProfile') == 'sdr-bt709-pcm':
        require(v.get('color_range') == 'tv' and v.get('color_space') == 'bt709',
                'Expected limited-range BT.709 delivery')
        require(len(audios) == 1, 'Expected one final AAC mix')
        require(abs(number(float(audios[0].get('duration', 'nan'))) - duration) <= 0.03,
                'Final mix duration mismatch')
        delivery = read(root, 'render-delivery.json')
        require(delivery.get('passed') is True and delivery.get('jobId') == task['jobId'],
                'Shared export did not complete successfully')
        require(delivery.get('sha256') == sha256(video), 'Shared export hash mismatch')
    actual_duration = number(float(v.get('duration', probe['format']['duration'])))
    require(abs(actual_duration - duration) <= max(0.1, 2 / fps), 'Video duration mismatch')
    if v.get('nb_frames', 'N/A') != 'N/A':
        require(int(v['nb_frames']) == total, 'Rendered frame count mismatch')
    rule = task['duration']
    require(rule['mode'] in ('audio', 'hard'), 'Unsupported duration mode')
    if rule['mode'] == 'hard':
        tolerance = rule['toleranceSec']
        require(type(tolerance) in (int, float) and math.isfinite(tolerance) and tolerance >= 0, 'Invalid tolerance')
        require(abs(actual_duration - number(rule['targetSec'])) <= tolerance, 'Hard duration mismatch')
    # Force full decoding: probing headers alone can accept truncated/corrupt media.
    command(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(video), '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'], timeout)
    return {'passed': True, 'jobId': task['jobId'], 'artifact': 'output/video.mp4',
            'contentType': 'video/mp4', 'durationSec': actual_duration,
            'width': v['width'], 'height': v['height'], 'fps': actual_fps,
            'sizeBytes': video.stat().st_size, 'sha256': sha256(video),
            'taskSha256': sha256(root / 'task.json')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job-dir', type=Path, required=True)
    parser.add_argument('--timeout-sec', type=int, default=600)
    args = parser.parse_args()
    try:
        require(args.timeout_sec > 0, 'Invalid timeout')
        result = validate(args.job_dir, args.timeout_sec)
    except (ValueError, OSError, KeyError, TypeError, IndexError, AttributeError, OverflowError, ZeroDivisionError, subprocess.SubprocessError) as exc:
        result = {'passed': False, 'error': {'code': 'VALIDATION_FAILED', 'message': str(exc)}}
    # Atomic replacement never follows an existing validation.json symlink.
    if args.job_dir.is_dir():
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=args.job_dir, delete=False) as out:
            json.dump(result, out, ensure_ascii=False, indent=2)
            out.write('\n')
            name = out.name
        os.replace(name, args.job_dir / 'validation.json')
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
