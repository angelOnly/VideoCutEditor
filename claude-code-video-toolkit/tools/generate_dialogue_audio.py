#!/usr/bin/env python3
"""Generate a timed, multi-speaker Doubao TTS dialogue for a Remotion video.

The input is a JSON array of utterances. Each utterance needs ``id``, ``role``
and ``text``. The command creates one MP3 per turn and writes a manifest with
the real start time and duration of every line, so visual cues can use audio
timing instead of estimates.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

DEFAULT_SPEAKERS = {
    "female": "zh_female_xiaohe_uranus_bigtts",
    "male": "zh_male_m191_uranus_bigtts",
}


def build_timeline(items: list[dict[str, Any]], durations: dict[str, float]) -> list[dict[str, Any]]:
    """Attach real audio timing to an ordered dialogue script."""
    current = 0.0
    timeline: list[dict[str, Any]] = []
    for item in items:
        item_id = item["id"]
        duration = round(durations[item_id], 3)
        gap_after = float(item.get("gap_after", 0.28))
        timeline.append(
            {
                **item,
                "start_seconds": round(current, 3),
                "duration_seconds": duration,
                "start_frame": round(current * 30),
                "duration_frames": max(1, round(duration * 30)),
                "gap_after_seconds": gap_after,
            }
        )
        current += duration + gap_after
    return timeline


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--script", required=True, help="Dialogue script JSON path")
    parser.add_argument("--output-dir", required=True, help="Directory for generated MP3 clips")
    parser.add_argument("--manifest", required=True, help="Output JSON timing manifest")
    parser.add_argument("--female-speaker", default=DEFAULT_SPEAKERS["female"])
    parser.add_argument("--male-speaker", default=DEFAULT_SPEAKERS["male"])
    parser.add_argument("--force", action="store_true", help="Regenerate clips that already exist")
    return parser.parse_args()


def main() -> int:
    # Keep timing helpers testable without loading the runtime-only TTS deps.
    from doubao_tts import generate_audio
    from voiceover import get_audio_duration

    args = parse_args()
    script_path = Path(args.script)
    clips_dir = Path(args.output_dir)
    manifest_path = Path(args.manifest)
    try:
        items = json.loads(script_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Unable to read dialogue script: {exc}", file=sys.stderr)
        return 1

    if not isinstance(items, list) or not items:
        print("Dialogue script must be a non-empty JSON array", file=sys.stderr)
        return 1

    speakers = {"female": args.female_speaker, "male": args.male_speaker}
    clips_dir.mkdir(parents=True, exist_ok=True)
    durations: dict[str, float] = {}

    for item in items:
        if not all(isinstance(item.get(key), str) and item[key].strip() for key in ("id", "role", "text")):
            print(f"Invalid dialogue entry: {item!r}", file=sys.stderr)
            return 1
        role = item["role"]
        if role not in speakers:
            print(f"Unsupported role '{role}' in {item['id']}", file=sys.stderr)
            return 1

        filename = f"{item['id']}-{role}.mp3"
        output = clips_dir / filename
        item["file"] = filename
        if args.force or not output.exists() or output.stat().st_size < 1024:
            print(f"[{item['id']}] {role}: {item['text']}")
            result = generate_audio(item["text"], str(output), speaker=speakers[role])
            if not result.get("success"):
                print(f"TTS failed for {item['id']}: {result.get('error', result)}", file=sys.stderr)
                return 1

        duration = get_audio_duration(str(output))
        if not duration or duration <= 0:
            print(f"Could not read duration for {output}", file=sys.stderr)
            return 1
        durations[item["id"]] = duration

    timeline = build_timeline(items, durations)
    total_seconds = round(timeline[-1]["start_seconds"] + timeline[-1]["duration_seconds"], 3)
    result = {
        "fps": 30,
        "total_seconds": total_seconds,
        "total_frames": round(total_seconds * 30),
        "speakers": speakers,
        "utterances": timeline,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
