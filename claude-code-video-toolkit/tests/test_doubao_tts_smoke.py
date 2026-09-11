"""Unit and opt-in integration coverage for the formal Doubao TTS provider."""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

from dotenv import load_dotenv


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = REPO_ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from doubao_tts import (  # noqa: E402
    DEFAULT_RESOURCE_ID,
    DEFAULT_SPEAKER,
    build_request,
    decode_audio,
    iter_json_objects,
)


class DoubaoTTSProviderTest(unittest.TestCase):
    MALE_SPEAKER = "zh_male_m191_uranus_bigtts"

    @classmethod
    def setUpClass(cls) -> None:
        load_dotenv(REPO_ROOT / ".env")
        cls.api_key = os.getenv("DOUBAO_TTS_API_KEY", "")
        cls.resource_id = os.getenv("DOUBAO_TTS_RESOURCE_ID", DEFAULT_RESOURCE_ID)
        cls.speaker = os.getenv("DOUBAO_TTS_SPEAKER", DEFAULT_SPEAKER)

    def test_build_request_for_new_console(self) -> None:
        headers, payload = build_request(
            "测试文本", "test-api-key", "seed-tts-2.0", DEFAULT_SPEAKER
        )

        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(headers["X-Api-Key"], "test-api-key")
        self.assertEqual(headers["X-Api-Resource-Id"], "seed-tts-2.0")
        self.assertTrue(uuid.UUID(headers["X-Api-Request-Id"]))
        self.assertEqual(payload["req_params"]["audio_params"]["format"], "mp3")
        self.assertEqual(payload["req_params"]["speaker"], DEFAULT_SPEAKER)

    def test_chunked_json_and_audio_decoder(self) -> None:
        expected_audio = b"ID3test-mp3-frame"
        wire = (
            json.dumps({"code": 0})
            + json.dumps({"code": 0, "data": base64.b64encode(expected_audio).decode()})
            + json.dumps({"code": 20000000})
        ).encode()
        chunks = (wire[:13], wire[13:31], wire[31:])

        self.assertEqual(decode_audio(iter_json_objects(chunks)), expected_audio)

    def _generate_and_assert(self, speaker: str, output_name: str, script: str) -> None:
        """Run the formal CLI and validate the resulting MP3 with ffprobe."""
        if not self.api_key:
            self.skipTest("Set DOUBAO_TTS_API_KEY in .env to run the live smoke test")

        output_path = REPO_ROOT / "out" / output_name
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", encoding="utf-8") as script_file:
            script_file.write(script)
            script_file.flush()
            command = [
                sys.executable,
                str(TOOLS_DIR / "voiceover.py"),
                "--provider",
                "doubao",
                "--doubao-speaker",
                speaker,
                "--script",
                script_file.name,
                "--output",
                str(output_path),
                "--json",
            ]
            completed = subprocess.run(
                command,
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertTrue(result["success"], result)
        self.assertEqual(result["provider"], "doubao")
        self.assertEqual(result["speaker"], speaker)
        self.assertEqual(result["resource_id"], self.resource_id)
        self.assertEqual(Path(result["output"]), output_path)
        self.assertGreater(output_path.stat().st_size, 1024)

        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                str(output_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(probe.returncode, 0, probe.stderr)
        self.assertGreater(float(probe.stdout.strip()), 0)

    def test_live_voiceover_cli_generates_female_mp3(self) -> None:
        """Exercise the female default through ``voiceover.py --provider doubao``."""
        self._generate_and_assert(
            self.speaker,
            "doubao-female-smoke.mp3",
            "你好，这是一段豆包女声试听音频。"
            "财报揭秘室，带你拆解财报里的关键信号，关注收入增长，也关注现金流质量。",
        )

    def test_live_voiceover_cli_generates_male_mp3(self) -> None:
        """Exercise the Yunzhou 2.0 male voice through the formal CLI."""
        self._generate_and_assert(
            self.MALE_SPEAKER,
            "doubao-male-smoke.mp3",
            "你好，这是一段豆包男声试听音频。"
            "财报揭秘室，带你拆解财报里的关键信号，关注收入增长，也关注现金流质量。",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
