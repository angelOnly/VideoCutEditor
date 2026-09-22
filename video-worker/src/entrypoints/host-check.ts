import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { HostProcesses } from '../infrastructure/host-processes.js';
import { AppServer } from '../infrastructure/app-server.js';
import { threadConfig, dynamicTools } from '../runner/codex-host.js';
import { Postgres } from '../infrastructure/postgres.js';
import type { Workspace } from '../infrastructure/workspace.js';
import { command } from '../infrastructure/process.js';
import { checkHostIsolation } from '../infrastructure/host-preflight.js';
if (process.env.VIDEOCUT_SUPERVISOR_LOCKED !== '1')
  throw new Error('Run pnpm host:check to hold the supervisor lock');
const c = loadConfig();
if (c.executor !== 'host') throw new Error('host:check requires WORKER_EXECUTOR=host');
const processes = new HostProcesses(c),
  rpc = new AppServer();
const db = new Postgres(c.databaseUrl);
await mkdir(c.dataRoot, { recursive: true });
const dir = await mkdtemp(path.join(c.dataRoot, 'preflight-'));
try {
  await processes.preflight();
  if ((await command(c.codexPath, ['--version'])).trim() !== 'codex-cli 0.154.0')
    throw new Error('Pinned Codex 0.154.0 is required');
  await db.query('SELECT id FROM execution_slots WHERE id=4');
  await db.query(
    'SELECT run_id,last_event_at,last_progress_at,current_tool_id,cleanup_state FROM host_executions LIMIT 0',
  );
  await checkHostIsolation(c, processes);
  const root = dir;
  for (const d of ['project', 'output', 'cache'])
    await mkdir(path.join(root, d), { recursive: true });
  const w = { root, task: { stage: 'render' } } as Workspace;
  await rpc.start(c);
  const response = await rpc.request('thread/start', {
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: 'never',
    permissions: 'videocut',
    config: threadConfig(c, w),
    ephemeral: true,
    dynamicTools,
    ...(c.codexModel ? { model: c.codexModel } : {}),
  });
  if (response.activePermissionProfile?.id !== 'videocut')
    throw new Error('Codex did not apply the required permission profile');
  console.log(
    'PASS: database, native task isolation, browser, ChatGPT login, app-server protocol. No model or TTS request was sent.',
  );
} finally {
  try {
    await rpc.close();
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}
