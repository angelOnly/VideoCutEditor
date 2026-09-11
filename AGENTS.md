# VideoCutEditor

## Repository layout

The Git root is VideoCutEditor. Preserve these sibling directories:

- claude-code-video-toolkit/: video production tools, templates, components and Skills.
- video-worker/: task API, PostgreSQL queue, Codex container supervisor and callbacks.
- huibo-saas/: existing digital-human HTTP adapter.
- xiling-http/: existing local digital-human client scripts.
- docs/: shared API and architecture documents.

Do not flatten the toolkit into this root or move the sibling services under a services/ directory. Do not create nested Git repositories.

Read claude-code-video-toolkit/AGENTS.md before changing toolkit files. Run toolkit commands from its directory so its existing relative paths remain valid. Maintain Skill sources under claude-code-video-toolkit/.claude/skills and synchronize generated .agents copies only when needed.

Worker implementation and deployment instructions are in video-worker/README.md. Run its TypeScript tests and the relevant toolkit regression tests when changing the pipeline. Local media, credentials, generated tasks and outputs must retain their ignore rules.
