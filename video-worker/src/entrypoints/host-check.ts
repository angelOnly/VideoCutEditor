import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { HostProcesses } from '../infrastructure/host-processes.js';
import { AppServer } from '../infrastructure/app-server.js';
import { threadConfig } from '../runner/codex-host.js';
import { Postgres } from '../infrastructure/postgres.js';
import type { Workspace } from '../infrastructure/workspace.js';
import { command } from '../infrastructure/process.js';
import { checkNativeIsolation } from '../infrastructure/native-preflight.js';
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

  await checkNativeIsolation(c, processes);
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
    ...(c.codexModel ? { model: c.codexModel } : {}),
  });
  if (response.activePermissionProfile?.id !== 'videocut')
    throw new Error('Codex did not apply the required permission profile');
  console.log(
    '通过数据库、登录和权限配置检查；尚未发送模型或配音请求，原生命令、输入只读、跨任务隔离和媒体依赖已实测；看图及真实制作仍需验收。',
  );
} finally {
  try {
    await rpc.close();
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}
