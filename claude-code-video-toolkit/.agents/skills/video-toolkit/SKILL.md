---
name: "video-toolkit"
description: "Codex entry skill for `claude-code-video-toolkit`. Use when working in this repository and you need the Codex equivalents of the toolkit's Claude commands and skills."
---

# Video Toolkit

This skill helps Codex operate inside `claude-code-video-toolkit` without modifying the original Claude-specific resources.

## Source of Truth

1. `README.md`
2. `CLAUDE.md`
3. `_internal/toolkit-registry.json`
4. `.claude/commands/*`
5. `.claude/skills/*`

## Command Equivalents

Generated command-wrapper skills are available for:

`/brand`, `/contribute`, `/design`, `/generate-voiceover`, `/publish`, `/record-demo`, `/redub`, `/scene-review`, `/setup`, `/skills`, `/template`, `/versions`, `/video`, `/voice-clone`

## Toolkit Skills

Installed toolkit skills include:

`acestep`, `elevenlabs`, `ffmpeg`, `frontend-design`, `ideogram4`, `ltx2`, `moviepy`, `playwright-recording`, `qwen-edit`, `remotion`, `remotion-best-practices`, `runpod`, `video-pipeline`

## Usage Rule

For explicitly unattended video production or trusted `mode: auto` tasks, use
`video-pipeline` first and follow its stage contracts. Do not route those tasks
through interactive command wrappers.
For other requests mapping closely to a command above, prefer that command entrypoint.
