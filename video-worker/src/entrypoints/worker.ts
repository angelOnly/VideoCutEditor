import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { loadConfig } from '../config.js';
import { Postgres } from '../infrastructure/postgres.js';
import { Queue } from '../infrastructure/queue.js';
import { HostSandbox } from '../infrastructure/host-sandbox.js';
import { executeRun } from '../application/execute-run.js';
if (process.env.VIDEOCUT_SUPERVISOR_LOCKED !== '1')
  throw Error('Start via deploy/start-worker.sh to hold the single-host supervisor lock');
const config = loadConfig();
const db = new Postgres(config.databaseUrl),
  queue = new Queue(db, config.leaseSeconds, config.timeoutSeconds),
  sandbox = new HostSandbox(config, queue),
  owner = randomUUID(),
  abort = new AbortController();
const active = new Set<Promise<void>>(),
  activeIds = new Set<string>();
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => abort.abort());
try {
  await sandbox.start();
  while (!abort.signal.aborted) {
    if (sandbox instanceof HostSandbox && !sandbox.healthy) {
      abort.abort();
      throw Error('Codex app-server stopped; systemd will restart Worker');
    }
    try {
      await queue.recover(owner, (id) => sandbox.stop(id), config.maxAttempts, activeIds);
      while (active.size < 4 && !abort.signal.aborted) {
        if (sandbox instanceof HostSandbox && !sandbox.healthy) break;
        const l = await queue.claim(owner);
        if (!l) break;
        activeIds.add(l.run.id);
        const p = executeRun(config, queue, sandbox, l, abort.signal)
          .catch(console.error)
          .finally(() => {
            active.delete(p);
            activeIds.delete(l.run.id);
          });
        active.add(p);
      }
    } catch (e) {
      console.error(e);
    }
    await setTimeout(1000);
  }
  await Promise.allSettled([...active]);
} finally {
  abort.abort();
  await Promise.allSettled([...active]);
  try {
    if (sandbox instanceof HostSandbox) await sandbox.close();
  } finally {
    await db.close();
  }
}
