from __future__ import annotations

import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = REPO_ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from generate_dialogue_audio import build_timeline  # noqa: E402


class DialogueTimelineTest(unittest.TestCase):
    def test_real_audio_durations_and_gaps_are_converted_to_frames(self) -> None:
        timeline = build_timeline(
            [
                {"id": "01", "role": "female", "text": "第一句", "gap_after": 0.2},
                {"id": "02", "role": "male", "text": "第二句", "gap_after": 0.3},
            ],
            {"01": 1.25, "02": 2.0},
        )

        self.assertEqual(timeline[0]["start_seconds"], 0.0)
        self.assertEqual(timeline[0]["duration_frames"], 38)
        self.assertEqual(timeline[1]["start_seconds"], 1.45)
        self.assertEqual(timeline[1]["start_frame"], 44)
        self.assertEqual(timeline[1]["duration_frames"], 60)


if __name__ == "__main__":
    unittest.main()
