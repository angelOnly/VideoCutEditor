import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('..');
const files = [];
async function collect(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (['node_modules', '__pycache__', 'dist'].includes(entry.name)) continue;
    const p = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await collect(p);
    else if (entry.isFile()) files.push(p);
  }
}
for (const directory of [
  'video-worker/src',
  'claude-code-video-toolkit/templates/ifeng-scenes',
  'claude-code-video-toolkit/.claude/skills/video-pipeline',
])
  await collect(directory);
for (const f of [
  'render_segments.py',
  'inspect_assets.py',
  'worker_tts.py',
  'doubao_tts.py',
  'voiceover.py',
  'config.py',
])
  files.push('claude-code-video-toolkit/tools/' + f);
files.push('video-worker/pnpm-lock.yaml', 'video-worker/deploy/runner-runtime/pnpm-lock.yaml');
const hashes = {};
for (const f of files.sort())
  hashes[f] = createHash('sha256')
    .update(await readFile(path.join(root, f)))
    .digest('hex');
const version = createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
await writeFile('config/runtime-version.json', JSON.stringify({ version }, null, 2) + '\n');
await writeFile(
  'deploy/runtime-manifest.json',
  JSON.stringify(
    {
      protocolVersion: 2,
      sdkVersion: '0.154.0',
      codexCliVersion: '0.154.0',
      defaultExecutor: 'host-app-server',
      taskIsolation: 'bubblewrap-systemd-user',
      remotionVersion: '4.0.425',
      runtimeSourceSha256: version,
      files: hashes,
    },
    null,
    2,
  ) + '\n',
);
