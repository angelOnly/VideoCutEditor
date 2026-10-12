#!/usr/bin/env python3
"""18 镜固定工程基准适配：只生成本地技术证据，不伪造人工审查。"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

BASELINE = 'c68f7d0ef9e898894049c28682e15068f0d708fe'
RENDER = Path('render/render_001')


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()


def export_baseline(repo, target):
    prefixes = ['claude-code-video-toolkit/tools', 'claude-code-video-toolkit/.agents/skills/video-pipeline/references']
    files = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', BASELINE, '--', *prefixes], cwd=repo, text=True).splitlines()
    target.mkdir(parents=True, exist_ok=False)
    for name in files:
        destination = target / Path(name).relative_to('claude-code-video-toolkit')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(subprocess.check_output(['git', 'show', f'{BASELINE}:{name}'], cwd=repo))
    write(target/'baseline.json', {'commit': BASELINE, 'files': {str(p.relative_to(target)): digest(p) for p in target.rglob('*') if p.is_file()}})


def generate(args):
    repo = Path(__file__).resolve().parents[2]
    source = Path(args.source).resolve(strict=True)
    settings_file = Path(args.settings).resolve()
    if settings_file.exists():
        raise ValueError('配置必须使用新路径，避免覆盖既有证据')
    baseline = settings_file.parent / (settings_file.stem + '-baseline')
    export_baseline(repo, baseline)
    settings = {'source': str(source), 'toolkit': str(repo/'claude-code-video-toolkit'), 'baseline': str(baseline),
                'python': args.python, 'node': args.node, 'modules': args.modules, 'browser': args.browser,
                'referenceFile': str(settings_file.with_suffix('.pixels.json')),
                'cacheCondition': 'enableCaching=false；cold/warm 是首次/紧邻重复，系统页缓存不受控；无跨轮 bundle 或成片复用。'}
    write(settings_file, settings)
    frozen = []
    for relative in ['input', 'project', 'cache/tts', 'confirmation']:
        frozen.extend(str(p) for p in (source/relative).rglob('*') if p.is_file() and 'node_modules' not in p.parts)
    frozen += [str(p) for p in (source/RENDER).glob('*.json') if p.name in ['timeline.json', 'request.json', 'design.json'] or p.name.endswith('-props.json')]
    frozen += [str(p) for folder in ['tools', 'lib'] for p in (repo/'claude-code-video-toolkit'/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
    frozen += [str(Path(__file__).resolve()), str(Path(__file__).with_name('render-benchmark.py'))]
    frozen += [str(settings_file)] + [str(p) for p in baseline.rglob('*') if p.is_file()]
    variants = []
    matrix = [('new_5x1', 5, 1), ('new_3x2', 3, 2), ('new_4x2', 4, 2), ('new_5x2', 5, 2)] if getattr(args, 'frame_matrix', False) else [('old_serial', 1, 1), ('new_1', 1, 1), ('new_2', 2, 1), ('new_3', 3, 1)]
    for name, slots, frames in matrix:
        common = [args.python, '-B', str(Path(__file__).resolve()), '--settings', str(settings_file), '--run-dir', '{runDir}', '--variant', name, '--slots', str(slots), '--frame-concurrency', str(frames)]
        variants.append({'name': name, 'slots': slots, 'frameConcurrency': frames, 'stages': [{'name': step, 'argv': common + ['--step', step]} for step in ['prepare', 'freeze', 'render', 'assemble', 'check']]})
    config = {'cwd': str(repo/'claude-code-video-toolkit'), 'outputRoot': str(Path(args.output).resolve()),
              'protectedRoot': args.protected_root, 'immutableInputs': frozen, 'variants': variants, 'repetitions': 3,
              'cleanupRelativePaths': ['artifacts'], 'sampleIntervalSeconds': .5, 'quietSeconds': 180,
              'env': {'PYTHONDONTWRITEBYTECODE': '1'}, 'cacheCondition': settings['cacheCondition']}
    if args.idle_baseline_evidence:
        evidence_path = Path(args.idle_baseline_evidence).resolve(strict=True)
        config['idleBaselineProcesses'] = read(evidence_path)['processes']
        config['idleBaselineEvidence'] = str(evidence_path)
    write(settings_file.with_suffix('.benchmark.json'), config)
    print(settings_file.with_suffix('.benchmark.json'))


def prepare(settings, run_dir):
    source = Path(settings['source'])
    task = run_dir/'artifacts/task'
    task.mkdir(parents=True, exist_ok=False)
    for name in ['input', 'project', 'cache/tts', 'confirmation']:
        shutil.copytree(source/name, task/name, ignore=shutil.ignore_patterns('node_modules', '__pycache__', '.cache'))
    (task/'project/renderer/node_modules').symlink_to(Path(settings['modules']).resolve(), target_is_directory=True)
    render = task/RENDER
    render.mkdir(parents=True)
    for path in (source/RENDER).glob('*.json'):
        if path.name in ['timeline.json', 'request.json', 'design.json'] or path.name.endswith('-props.json'):
            shutil.copy2(path, render/path.name)
    request = read(render/'request.json')
    task_id = 'bench_' + uuid.uuid4().hex
    request['taskId'] = task_id
    request['previousArtifacts'] = None
    plan_path = task/request['confirmation']['planFile']
    plan = read(plan_path)
    plan['taskId'] = task_id
    write(plan_path, plan)
    request['confirmation']['planSha256'] = digest(plan_path)
    write(task/'confirmation/current.json', request['confirmation'])
    write(render/'request.json', request)
    write(task/'job.json', {'contractVersion': request['contractVersion'], 'taskId': task_id,
                           'requests': {str(RENDER/'request.json'): digest(render/'request.json')}, 'createdAt': time.time()})
    timeline = read(render/'timeline.json')
    assert len(timeline['scenes']) == 18 and timeline['totalFrames'] > 0
    isolated = timeline.get('renderInputContract') == 'finance-scene/v2'
    scenes = [{'sceneId': s['id'], 'composition': 'FinanceScene' if isolated else f'FinanceScene-{i+1}', 'props': str(RENDER/f'scene-{i+1:02d}-props.json'), 'frames': s.get('frames', s.get('endFrameExclusive', 0)-s.get('startFrame', 0))}
              for i, s in enumerate(timeline['scenes'])]
    for scene in scenes:
        props = read(task/scene['props'])
        assert props['scene']['id'] == scene['sceneId'] and props['scene']['frames'] == scene['frames']
        assert isolated or props['timeline']['chapters'] == timeline['chapters'], '合并后的正式时间轴与 props 不一致'
    write(render/'scenes.json', scenes)
    write(run_dir/'preparation.json', {'taskId': task_id, 'scenes': 18, 'frames': timeline['totalFrames'],
          'copiedSuccessLedgers': False, 'sourceTimelineSha256': digest(source/RENDER/'timeline.json'),
          'cacheCondition': settings['cacheCondition']})


def cli(settings, task, old, command):
    toolkit = Path(settings['baseline'] if old else settings['toolkit'])
    argv = [settings['python'], '-B', str(toolkit/'tools/stage_media.py'), *command]
    completed = subprocess.run(argv, cwd=settings['toolkit'], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode:
        raise RuntimeError(completed.stdout + '\n' + completed.stderr)
    lines = completed.stdout.strip().splitlines()
    result = json.loads(lines[-1])
    if result.get('status') != 'ok':
        raise RuntimeError(json.dumps(result, ensure_ascii=False))
    return result


def freeze(settings, task, old, run_dir):
    if old:
        write(run_dir/'freeze.json', {'bundleSeconds': None, 'reason': '旧实现逐镜打包，包含在 render 时间中'})
        return
    result = cli(settings, task, False, ['freeze-batch', '--request', str(task/RENDER/'request.json'), '--batch', 'benchmark',
        '--project', 'project/renderer', '--entry', 'project/renderer/src/index.ts', '--scenes', str(RENDER/'scenes.json'),
        '--node', settings['node'], '--modules', settings['modules'], '--browser', settings['browser']])
    write(run_dir/'freeze.json', result)


def render(settings, task, old, slots, run_dir):
    args = ['--request', str(task/RENDER/'request.json'), '--node', settings['node'], '--modules', settings['modules'], '--browser', settings['browser']]
    if old:
        results = []
        for scene in read(task/RENDER/'scenes.json'):
            started = time.monotonic()
            result = cli(settings, task, True, ['render', *args, '--scene', scene['sceneId'], '--project', 'project/renderer',
                '--entry', 'project/renderer/src/index.ts', '--composition', scene['composition'], '--props', scene['props'], '--frames', str(scene['frames'])])
            results.append({'sceneId': scene['sceneId'], **result, 'benchmarkWallSeconds': time.monotonic()-started})
            write(run_dir/'render.json', {'results': results, 'metrics': {'bundleSeconds': None, 'slots': 1}})
    else:
        result = cli(settings, task, False, ['render-batch', *args, '--manifest', read(run_dir/'freeze.json')['manifest'], '--slots', str(slots)])
        assert not result['metrics']['reused'], '基准禁止复用已完成镜头'
        write(run_dir/'render.json', result)


def media_module(settings):
    sys.path.insert(0, str(Path(settings['toolkit'])/'tools'))
    import stage_media
    return stage_media


def assemble(settings, task, run_dir):
    media = media_module(settings)
    results = read(run_dir/'render.json')['results']
    spec = read(task/RENDER/'request.json')['outputSpec']
    folder = task/'benchmark-assembly'
    folder.mkdir()
    video_lines, audio_lines = [], []
    for index, scene in enumerate(results):
        (folder/f'{index}.mp4').symlink_to(task/scene['path'])
        video_lines.append(f"file '{index}.mp4'")
        samples = round(scene['frames']/spec['fps']*48000)
        media.ffmpeg('-i', task/scene['mix']['path'], '-af', f'aresample=48000,apad,atrim=end_sample={samples},asetpts=PTS-STARTPTS', '-ac', '2', '-c:a', 'pcm_s16le', folder/f'{index}.wav')
        audio_lines.append(f"file '{index}.wav'")
    (folder/'video.txt').write_text('\n'.join(video_lines)+'\n')
    (folder/'audio.txt').write_text('\n'.join(audio_lines)+'\n')
    media.ffmpeg('-f', 'concat', '-safe', '0', '-i', folder/'audio.txt', '-c:a', 'pcm_s16le', folder/'mix.wav')
    media.ffmpeg('-copyts', '-f', 'concat', '-safe', '0', '-i', folder/'video.txt', '-i', folder/'mix.wav', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', folder/'video.mp4')
    write(run_dir/'assembly.json', {'path': str((folder/'video.mp4').relative_to(task)), 'mix': str((folder/'mix.wav').relative_to(task)), 'visualReviewPerformed': False})


def pixel_hash(media_path):
    # 对全量解码像素逐帧散列，编码后 MP4 文件摘要不能代替此对照。
    data = subprocess.check_output(['/usr/local/bin/ffmpeg', '-v', 'error', '-i', str(media_path), '-map', '0:v:0', '-an', '-f', 'framemd5', '-'])
    rows = [line.split(b',')[-1].strip() for line in data.splitlines() if line and not line.startswith(b'#')]
    return {'frames': len(rows), 'decodedFrameHashesSha256': hashlib.sha256(b'\n'.join(rows)).hexdigest()}


def check(settings, task, run_dir, old):
    media = media_module(settings)
    from two_stage import load_request
    _, request = load_request(task/RENDER/'request.json', 'render')
    plan = read(task/request['confirmation']['planFile'])
    timeline = read(task/RENDER/'timeline.json')
    results = read(run_dir/'render.json')['results']
    assert [s['sceneId'] for s in results] == [s['id'] for s in plan['scenes']]
    checks, pixels = [], {}
    for scene, expected, resolved in zip(results, plan['scenes'], timeline['scenes']):
        assert ''.join(u['text'] for u in resolved['utterances']) == expected['text']
        assert scene['sha256'] == digest(task/scene['path'])
        info = media.validate_mp4(task/scene['path'], request['outputSpec'], resolved['frames'])
        info['audio'] = media.compare_audio(task/scene['path'], task/scene['mix']['path'], frame_padding=math.ceil(8000/request['outputSpec']['fps']))
        checks.append({'id': scene['sceneId'], **info})
        pixels[scene['sceneId']] = pixel_hash(task/scene['path'])
    assembly = read(run_dir/'assembly.json')
    whole = task/assembly['path']
    whole_info = media.validate_mp4(whole, request['outputSpec'], 4112)
    whole_info['audio'] = media.compare_audio(whole, task/assembly['mix'])
    offset = 0
    for scene in results:
        for index in [0, scene['frames']-1]:
            assert media.frame_rgb(whole, offset+index) == media.frame_rgb(task/scene['path'], index), '合片边界不一致'
        offset += scene['frames']
    pixels['whole'] = pixel_hash(whole)
    reference_file = Path(settings['referenceFile'])
    if reference_file.exists():
        assert read(reference_file)['pixels'] == pixels, '与首轮旧串行全量解码像素不同，停止性能结论'
        comparison = 'matched_first_old_serial'
    else:
        assert old, '首个技术像素基准必须来自旧串行'
        write(reference_file, {'pixels': pixels, 'referenceRun': str(run_dir), 'visualReviewPerformed': False})
        comparison = 'established_first_old_serial'
    load_request(task/RENDER/'request.json', 'render')
    write(run_dir/'technical-check.json', {'passed': True, 'sceneCount': 18, 'frames': 4112, 'checks': checks,
        'whole': whole_info, 'pixelComparison': comparison, 'pixels': pixels, 'humanListeningPerformed': False,
        'visualReviewPerformed': False, 'workerSuccess': False, 'limitations': ['仅技术基准；主控需对最终候选另行静帧及动态审查。']})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generate', action='store_true')
    parser.add_argument('--frame-matrix', action='store_true', help='测量 5×1、3×2、4×2、5×2 的受控帧并发组合')
    parser.add_argument('--frame-concurrency', type=int, choices=[1, 2], default=1)
    parser.add_argument('--settings', required=True)
    parser.add_argument('--idle-baseline-evidence'); parser.add_argument('--source'); parser.add_argument('--output'); parser.add_argument('--protected-root')
    parser.add_argument('--python'); parser.add_argument('--node'); parser.add_argument('--modules'); parser.add_argument('--browser')
    parser.add_argument('--run-dir'); parser.add_argument('--variant'); parser.add_argument('--slots', type=int)
    parser.add_argument('--step', choices=['prepare', 'freeze', 'render', 'assemble', 'check'])
    args = parser.parse_args()
    if args.generate:
        generate(args)
        return
    os.environ['VIDEOCUT_FRAME_CONCURRENCY'] = str(args.frame_concurrency)
    settings = read(args.settings)
    run_dir = Path(args.run_dir).resolve()
    task = run_dir/'artifacts/task'
    old = args.variant == 'old_serial'
    if args.step == 'prepare': prepare(settings, run_dir)
    elif args.step == 'freeze': freeze(settings, task, old, run_dir)
    elif args.step == 'render': render(settings, task, old, args.slots, run_dir)
    elif args.step == 'assemble': assemble(settings, task, run_dir)
    elif args.step == 'check': check(settings, task, run_dir, old)
    else: parser.error('需要 --step 或 --generate')


if __name__ == '__main__':
    main()
