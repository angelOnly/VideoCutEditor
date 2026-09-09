---
name: "record-demo"
description: "Codex wrapper for Claude Code `/record-demo` in `claude-code-video-toolkit`. Use when the user wants: Guided Playwright recording with interactive or script mode"
---

# /record-demo for Codex

This skill is the Codex entrypoint equivalent of the Claude Code slash command `/record-demo`.

## Source of Truth

Before acting, read the original workflow document:

`.claude/commands/record-demo.md`

Also use these files when relevant:

1. `CLAUDE.md`
2. `_internal/toolkit-registry.json`
3. `docs/README.md`

## Operating Rules

1. Treat `.claude/commands/record-demo.md` as the authoritative workflow.
2. Do not rewrite or replace the original Claude resources just to satisfy Codex.
3. Reuse installed toolkit skills when they help the task.
4. If the user request maps directly to this command, follow the original command flow in Codex style.

## Related Toolkit Skills

`acestep`, `elevenlabs`, `ffmpeg`, `frontend-design`, `ideogram4`, `ltx2`, `moviepy`, `playwright-recording`, `qwen-edit`, `remotion`, `remotion-best-practices`, `runpod`
