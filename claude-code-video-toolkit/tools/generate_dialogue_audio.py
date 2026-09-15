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
import shutil
import uuid
import math
from pathlib import Path
from typing import Any

DEFAULT_SPEAKERS = {
    "female": "zh_female_xiaohe_uranus_bigtts",
    "male": "zh_male_m191_uranus_bigtts",
}


def build_timeline(items: list[dict[str, Any]], durations: dict[str, float], fps: float = 30) -> list[dict[str, Any]]:
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
                "start_frame": round(current * fps),
                "duration_frames": max(1, round(duration * fps)),
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
    parser.add_argument("--fps", type=float, default=30)
    parser.add_argument("--force", action="store_true", help="Regenerate clips that already exist")
    return parser.parse_args()


def main() -> int:
    # Keep timing helpers testable without loading the runtime-only TTS deps.
    from cached_tts import synthesize_cached
    from config import get_doubao_tts_resource_id
    from two_stage import identifier, require, write

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

    require(math.isfinite(args.fps) and args.fps > 0, "帧率必须大于 0")
    require(all(isinstance(item, dict) for item in items), "配音条目必须是对象")
    require(len({item.get("id") for item in items}) == len(items), "配音 ID 重复")
    for item in items:
        identifier(item.get("id"))
        if not all(isinstance(item.get(key), str) and item[key].strip() for key in ("id", "role", "text")):
            print(f"Invalid dialogue entry: {item!r}", file=sys.stderr)
            return 1
        role = item["role"]
        if role not in speakers:
            print(f"Unsupported role '{role}' in {item['id']}", file=sys.stderr)
            return 1

        require(math.isfinite(float(item.get("gap_after", .28))) and float(item.get("gap_after", .28)) >= 0, "停顿时长无效")
        filename = f"{item['id']}-{role}.mp3"
        output = clips_dir / filename
        if output.exists() and not output.with_suffix('.receipt.json').exists() and not args.force:
            raise ValueError("旧配音缺少文本/音色摘要，不能确认复用；核对后使用 --force 明确重新生成")

    for item in items:
        role = item["role"]
        filename = f"{item['id']}-{role}.mp3"
        output = clips_dir / filename
        item["file"] = filename
        cache = clips_dir / ".tts-cache"
        if args.force:
            # 显式 force 才创建新逻辑请求；不会删除旧成功缓存。
            cache = cache / ("forced-" + str(uuid.uuid4()))
        clip = synthesize_cached(item["text"], speakers[role], get_doubao_tts_resource_id(), cache)
        # 验证成功后才替换兼容文件名；缓存原件始终保留。
        temporary = output.with_suffix('.partial.mp3')
        shutil.copyfile(clip["path"], temporary)
        temporary.replace(output)
        write(output.with_suffix('.receipt.json'), {"cacheKey": clip["cacheKey"], "text": item["text"],
              "speaker": speakers[role], "sha256": clip["audio"]["sha256"]})
        durations[item["id"]] = clip["audio"]["durationSeconds"]
        item["speaker"] = speakers[role]
        item["sha256"] = clip["audio"]["sha256"]
        item["request_id"] = clip["requestId"]

    timeline = build_timeline(items, durations, args.fps)
    total_seconds = round(timeline[-1]["start_seconds"] + timeline[-1]["duration_seconds"], 3)
    result = {
        "fps": args.fps,
        "total_seconds": total_seconds,
        "total_frames": round(total_seconds * args.fps),
        "speakers": speakers,
        "utterances": timeline,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError) as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
