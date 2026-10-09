"""核对参考库文件、解码与尺寸；不把技术通过当作美术通过。"""
from pathlib import Path
from fractions import Fraction
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parents[1]
catalog = json.loads((root / 'catalog.json').read_text())
results = []
for case in catalog:
    folder = root / 'cases' / case['id']
    failures = []
    required = ['Scene.tsx', 'README.md', 'case.json', 'preview.mp4', 'storyboard.jpg']
    required += [f'frames/{f:03}.png' for f in case['frames']]
    for name in required:
        if not (folder / name).is_file():
            failures.append('缺少 ' + name)
    if not failures:
        try:
            info = json.loads(subprocess.check_output([
                'ffprobe', '-v', 'error', '-select_streams', 'v:0',
                '-show_entries', 'stream=width,height,avg_frame_rate,duration,nb_frames',
                '-of', 'json', str(folder / 'preview.mp4')]))['streams'][0]
            assert (info['width'], info['height']) == (1280, 720), info
            assert Fraction(info['avg_frame_rate']) == 30, info
            assert abs(float(info['duration']) - case['duration']) < .05, info
            assert int(info['nb_frames']) == case['durationInFrames'], info
            decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(folder / 'preview.mp4'),
                                      '-f', 'null', '-'], capture_output=True, text=True)
            assert decoded.returncode == 0 and not decoded.stderr, decoded.stderr
            digests = set()
            for f in case['frames']:
                data = (folder / f'frames/{f:03}.png').read_bytes()
                assert data[:8] == b'\x89PNG\r\n\x1a\n'
                assert (int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')) == (1280, 720)
                digests.add(hashlib.sha256(data).hexdigest())
            assert len(digests) >= 2, '抽帧完全相同，需确认动画是否执行'
        except Exception as error:
            failures.append(str(error))
    results.append({'id': case['id'], '通过': not failures, '问题': failures})

passed = sum(r['通过'] for r in results)
report = {'总数': len(catalog), '技术检查通过': passed,
          '检查范围': '文件齐全、720p/30fps/按案例清单核对时长与帧数、完整解码、分镜尺寸与变化；不自动评判美感',
          'cases': results}
(root / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'总数': len(catalog), '通过': passed, '失败': [r for r in results if not r['通过']]}, ensure_ascii=False))
raise SystemExit(0 if passed == len(catalog) else 1)
