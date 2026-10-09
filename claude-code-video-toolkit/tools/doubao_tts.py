#!/usr/bin/env python3
"""Doubao Seed TTS V3 client for the video-toolkit voiceover pipeline.

This client uses the Volcengine new-console API-key endpoint.  The endpoint
returns HTTP-chunked, adjacent JSON objects: audio chunks have ``code: 0`` and
the final successful event has ``code: 20000000``.
"""
from __future__ import annotations

import base64
import json
import os
import uuid
from collections.abc import Iterable
from pathlib import Path

import requests

from config import get_doubao_tts_api_key, get_doubao_tts_resource_id, get_doubao_tts_speaker, get_tts_role_voices


TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
DEFAULT_RESOURCE_ID = "seed-tts-2.0"
DEFAULT_SPEAKER = "zh_female_xiaohe_uranus_bigtts"


def build_request(
    text: str,
    api_key: str,
    resource_id: str = DEFAULT_RESOURCE_ID,
    speaker: str = DEFAULT_SPEAKER,
    user_id: str = "claude-code-video-toolkit",
    request_id: str | None = None,
) -> tuple[dict, dict]:
    """Build one authenticated request for the Doubao TTS V3 API."""
    headers = {
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
        "X-Api-Resource-Id": resource_id,
        "X-Api-Request-Id": request_id or str(uuid.uuid4()),
    }
    payload = {
        "user": {"uid": user_id},
        "req_params": {
            "text": text,
            "speaker": speaker,
            "audio_params": {"format": "mp3", "sample_rate": 24000},
        },
    }
    return headers, payload


def iter_json_objects(chunks: Iterable[bytes]) -> Iterable[dict]:
    """Yield adjacent JSON values from the endpoint's HTTP-chunked response."""
    decoder = json.JSONDecoder()
    buffer = ""

    for chunk in chunks:
        buffer += chunk.decode("utf-8")
        while buffer:
            buffer = buffer.lstrip()
            try:
                value, offset = decoder.raw_decode(buffer)
            except json.JSONDecodeError:
                break
            if not isinstance(value, dict):
                raise ValueError(f"Expected a JSON object, got {type(value).__name__}")
            yield value
            buffer = buffer[offset:]

    if buffer.strip():
        raise ValueError(f"Incomplete JSON response: {buffer[:200]!r}")


def decode_audio(events: Iterable[dict]) -> bytes:
    """Collect base64 MP3 chunks and turn provider errors into a clear exception."""
    audio = bytearray()
    errors: list[str] = []
    finished = False

    for event in events:
        code = event.get("code")
        if str(code) == "0":
            # The stream can emit an initial success/status event without data.
            # Only data-bearing success events carry an MP3 frame.
            if event.get("data"):
                try:
                    audio.extend(base64.b64decode(event["data"], validate=True))
                except (ValueError, TypeError) as exc:
                    raise ValueError("Doubao TTS returned invalid base64 audio") from exc
        elif str(code) == "20000000":
            finished = True
        elif code is not None:
            errors.append(f"code={code}, message={event.get('message', 'unknown error')}")

    if errors:
        raise RuntimeError("Doubao TTS rejected the request: " + "; ".join(errors))
    if not finished:
        raise RuntimeError("Doubao TTS stream ended without its success event")
    if not audio:
        raise RuntimeError("Doubao TTS returned no audio frames")
    return bytes(audio)


def _audio_result(output_path: Path, script: str, speaker: str, resource_id: str) -> dict:
    """Return standard toolkit metadata after an MP3 was written."""
    from voiceover import get_audio_duration

    duration = get_audio_duration(str(output_path))
    result = {
        "success": True,
        "output": str(output_path),
        "script_chars": len(script),
        "speaker": speaker,
        "resource_id": resource_id,
    }
    if duration:
        result["duration_seconds"] = round(duration, 2)
        result["duration_frames_30fps"] = int(duration * 30)
    return result


def generate_audio(
    text: str,
    output_path: str,
    speaker: str | None = None,
    resource_id: str | None = None,
    api_key: str | None = None,
    timeout: tuple[int, int] = (10, 90),
    verbose: bool = True,
    request_id: str | None = None,
) -> dict:
    """Synthesize *text* to an MP3, returning the common toolkit result shape."""
    text = text.strip()
    if not text:
        return {"success": False, "submitted": False, "error": "Cannot synthesize empty text"}

    api_key = api_key or get_doubao_tts_api_key()
    resource_id = resource_id or get_doubao_tts_resource_id() or DEFAULT_RESOURCE_ID
    speaker = speaker or get_doubao_tts_speaker() or DEFAULT_SPEAKER
    if os.getenv('VIDEOCUT_RENDER_SANDBOX') == 'native':
        # 原生制作的其他配音入口也不能绕过已配置音色，在 HTTP 调用前拒绝。
        try:
            voices = get_tts_role_voices()
        except ValueError as exc:
            return {'success': False, 'submitted': False, 'error': str(exc)}
        if speaker not in voices.values():
            return {'success': False, 'submitted': False,
                    'error': f'音色 {speaker} 不在已配置角色音色中，禁止调用 TTS；请按角色配置修正'}
    if not api_key:
        return {
            "success": False,
            "submitted": False,
            "error": "No Doubao API key found. Add DOUBAO_TTS_API_KEY to .env.",
        }

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    headers, payload = build_request(text, api_key, resource_id, speaker, request_id=request_id)

    try:
        response = requests.post(
            TTS_ENDPOINT,
            headers=headers,
            json=payload,
            stream=True,
            timeout=timeout,
        )
        try:
            response.raise_for_status()
            audio = decode_audio(iter_json_objects(response.iter_content(chunk_size=8192)))
        finally:
            response.close()
    except (requests.RequestException, RuntimeError, ValueError, UnicodeDecodeError) as exc:
        return {"success": False, "submitted": True, "request_id": headers["X-Api-Request-Id"], "error": str(exc)}

    path.write_bytes(audio)
    if verbose:
        print(f"Saved Doubao TTS audio to: {path}")
    return {**_audio_result(path, text, speaker, resource_id), "submitted": True, "request_id": headers["X-Api-Request-Id"]}
