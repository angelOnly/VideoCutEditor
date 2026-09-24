import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / 'tools' / 'stage_media.py'


class RenderSlotsTests(unittest.TestCase):
    def invoke(self, slots, configured=None):
        env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
        if configured is not None:
            env['VIDEOCUT_RENDER_SLOTS'] = str(configured)
        else:
            env.pop('VIDEOCUT_RENDER_SLOTS', None)
        command = [
            sys.executable,
            str(TOOL),
            'render-batch',
            '--request',
            '/tmp/request.json',
            '--modules',
            '/tmp/modules',
            '--browser',
            '/tmp/browser',
            '--manifest',
            'manifest.json',
        ]
        if slots is not None:
            command.extend(['--slots', str(slots)])
        return subprocess.run(command, env=env, text=True, capture_output=True, check=False)

    def test_accepts_five_slots(self):
        result = self.invoke(5)
        self.assertNotIn('invalid choice', result.stderr)

    def test_rejects_more_than_five_slots(self):
        result = self.invoke(6)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('invalid choice', result.stderr)

    def test_worker_slot_configuration_rejects_mismatched_argument(self):
        result = self.invoke(4, configured=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)['error']['code'], 'RENDER_SLOT_CONFIG_INVALID')

    def test_worker_slot_configuration_rejects_out_of_range_value(self):
        result = self.invoke(None, configured=6)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)['error']['code'], 'RENDER_SLOT_CONFIG_INVALID')


if __name__ == '__main__':
    unittest.main()
