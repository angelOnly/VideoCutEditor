---
name: "voice-clone"
description: "Codex wrapper for Claude Code `/voice-clone` in `claude-code-video-toolkit`. Use when the user wants: Record, test, and save a cloned voice to a brand profile"
---

# /voice-clone for Codex

This skill is the Codex entrypoint equivalent of the Claude Code slash command `/voice-clone`.

## Source of Truth

Before acting, read the original workflow document:

`.claude/commands/voice-clone.md`

Also use these files when relevant:

1. `CLAUDE.md`
2. `_internal/toolkit-registry.json`
3. `docs/README.md`

## Operating Rules

1. Treat `.claude/commands/voice-clone.md` as the authoritative workflow.
2. Do not rewrite or replace the original Claude resources just to satisfy Codex.
3. Reuse installed toolkit skills when they help the task.
4. If the user request maps directly to this command, follow the original command flow in Codex style.

## Related Toolkit Skills

`acestep`, `elevenlabs`, `ffmpeg`, `frontend-design`, `ideogram4`, `ltx2`, `moviepy`, `playwright-recording`, `qwen-edit`, `remotion`, `remotion-best-practices`, `runpod`
