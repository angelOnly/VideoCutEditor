"""Environment discovery uses the repository root, without reading real credentials."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import config


class SharedEnvironmentTests(unittest.TestCase):
    def test_root_config_and_injected_environment_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / 'claude-code-video-toolkit' / 'tools'
            tools.mkdir(parents=True)
            (root / '.env').write_text('DOUBAO_TTS_API_KEY=root-fixture-key\n')
            (tools.parent / '.env').write_text('DOUBAO_TTS_API_KEY=obsolete-child-key\n')
            with patch.object(config, '__file__', str(tools / 'config.py')):
                with patch.dict(os.environ, {}, clear=True):
                    self.assertEqual(config.get_doubao_tts_api_key(), 'root-fixture-key')
                with patch.dict(os.environ, {'DOUBAO_TTS_API_KEY': 'injected-key'}, clear=True):
                    self.assertEqual(config.get_doubao_tts_api_key(), 'injected-key')


if __name__ == '__main__':
    unittest.main()
