"""Technical gate fixtures are not production videos or end-to-end agent tests."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.claude/skills/video-pipeline'
spec = importlib.util.spec_from_file_location('gate', SOURCE / 'scripts/validate_delivery.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
class DeliveryGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        encoders = subprocess.run(['ffmpeg', '-hide_banner', '-encoders'], capture_output=True, text=True, check=True).stdout
        cls.encoder = 'libx264' if 'libx264' in encoders else 'h264_videotoolbox'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'input').mkdir()
        (self.root / 'output').mkdir()
        (self.root / 'input/script.txt').write_text('测试稿件')
        self.video = self.root / 'output/video.mp4'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=30',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1',
                        '-c:v', self.encoder, *(['-allow_sw', '1'] if self.encoder == 'h264_videotoolbox' else []), '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(self.video)], check=True)
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(self.video), '-frames:v', '1',
                        str(self.root / 'frame.png')], check=True)
        (self.root / 'render.log').write_text('test render completed')
        self.task = {'schemaVersion': 1, 'jobId': 'test', 'mode': 'auto',
                     'input': {'script': 'input/script.txt'},
                     'output': {'width': 320, 'height': 240, 'fps': 30, 'requireAudio': True},
                     'duration': {'mode': 'audio'}}
        self.write('task', self.task)
        self.write('normalized-input', {'files': [{'path': 'input/script.txt', 'sha256': gate.sha256(self.root / 'input/script.txt')}]})
        self.write('plan', {'scenes': [{'id': 'one'}]})
        self.write('audio-manifest', {'clips': [{'path': 'output/video.mp4', 'sha256': gate.sha256(self.video), 'durationSec': 1}]})
        self.write('project-manifest', {'entry': 'test fixture'})
        self.timeline = {'fps': 30, 'durationSec': 1, 'totalFrames': 30,
                         'scenes': [{'id': 'one', 'startFrame': 0, 'endFrame': 30}],
                         'captions': [], 'audio': [{'path': 'output/video.mp4', 'startFrame': 0, 'endFrame': 30}]}
        self.write('timeline', self.timeline)
        self.write('quality-report', {'passed': True, 'checks': [{'name': 'fixture', 'passed': True, 'evidence': 'Synthetic technical fixture only'}], 'frames': ['frame.png']})

    def write(self, name, value):
        value = {'schemaVersion': 1, 'jobId': 'test', **value}
        (self.root / (name + '.json')).write_text(json.dumps(value))

    def test_valid_candidate(self):
        result = gate.validate(self.root)
        self.assertTrue(result['passed'])
        self.assertEqual(result['sha256'], gate.sha256(self.video))
        self.assertEqual(result['sizeBytes'], self.video.stat().st_size)

    def test_wrong_resolution(self):
        self.task['output']['width'] = 640
        self.write('task', self.task)
        with self.assertRaisesRegex(gate.Invalid, 'Resolution'):
            gate.validate(self.root)

    def test_hard_duration(self):
        self.task['duration'] = {'mode': 'hard', 'targetSec': 10, 'toleranceSec': 0.1}
        self.write('task', self.task)
        with self.assertRaisesRegex(gate.Invalid, 'Hard duration'):
            gate.validate(self.root)

    def test_changed_input(self):
        (self.root / 'input/script.txt').write_text('changed')
        with self.assertRaisesRegex(gate.Invalid, 'hash mismatch'):
            gate.validate(self.root)

    def test_missing_evidence(self):
        (self.root / 'frame.png').unlink()
        with self.assertRaisesRegex(gate.Invalid, 'Missing or empty'):
            gate.validate(self.root)

    def test_audio_missing(self):
        silent = self.root / 'silent.mp4'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(self.video), '-an', '-c:v', 'copy', str(silent)], check=True)
        silent.replace(self.video)
        self.write('audio-manifest', {'clips': [{'path': 'output/video.mp4', 'sha256': gate.sha256(self.video), 'durationSec': 1}]})
        with self.assertRaisesRegex(gate.Invalid, 'Required audio'):
            gate.validate(self.root)

    def test_out_of_bounds_caption(self):
        self.timeline['captions'] = [{'text': 'bad', 'startFrame': 29, 'endFrame': 40}]
        self.write('timeline', self.timeline)
        with self.assertRaisesRegex(gate.Invalid, 'frame interval'):
            gate.validate(self.root)

    def test_corrupt_mp4_cli_fails_structurally(self):
        self.video.write_bytes(b'not an mp4')
        self.write('audio-manifest', {'clips': [{'path': 'output/video.mp4', 'sha256': gate.sha256(self.video), 'durationSec': 1}]})
        import sys
        result = subprocess.run([sys.executable, str(SOURCE / 'scripts/validate_delivery.py'), '--job-dir', str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(json.loads(result.stdout)['passed'])
        self.assertFalse(json.loads((self.root / 'validation.json').read_text())['passed'])

    def test_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as other:
            external = Path(other) / 'secret.txt'
            external.write_text('outside')
            (self.root / 'input/escape.txt').symlink_to(external)
            self.task['input']['script'] = 'input/escape.txt'
            self.write('task', self.task)
            with self.assertRaisesRegex(gate.Invalid, 'escapes'):
                gate.validate(self.root)


class InstallationTests(unittest.TestCase):
    def test_installed_skill_matches_source(self):
        for source in SOURCE.rglob('*'):
            if source.is_file() and '__pycache__' not in source.parts:
                installed = ROOT / '.agents/skills/video-pipeline' / source.relative_to(SOURCE)
                self.assertEqual(source.read_bytes(), installed.read_bytes(), str(source))


if __name__ == '__main__':
    unittest.main()
