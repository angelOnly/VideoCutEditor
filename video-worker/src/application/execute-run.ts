import path from 'node:path';
import { rm } from 'node:fs/promises';
import { productionRecord } from '../infrastructure/production-record.js';
import type { Config } from '../config.js';
import { AppError, publicError, type Lease } from '../domain/task.js';
import { Queue } from '../infrastructure/queue.js';
import { Workspaces, type Workspace } from '../infrastructure/workspace.js';
import { Storage } from '../infrastructure/storage.js';
import type { Sandbox } from '../infrastructure/sandbox.js';
import { validate } from '../infrastructure/validation.js';
import { publishResult } from './results.js';
export async function executeRun(
  config: Config,
  queue: Queue,
  sandbox: Sandbox,
  l: Lease,
  shutdown?: AbortSignal,
) {
  const abort = new AbortController();
  const stop = () => abort.abort();
  shutdown?.addEventListener('abort', stop, { once: true });
  if (shutdown?.aborted) stop();
  let busy = false;
  let pulseError: unknown;
  let timer: NodeJS.Timeout | undefined;
  let w: Workspace | undefined;
  let delivery = l.run.prepared?.delivery;
  const deadline = setTimeout(
    () => {
      pulseError = new AppError('TIMEOUT', '任务总时限已到');
      abort.abort();
    },
    delivery ? 300000 : Math.max(1, new Date(l.run.deadline!).getTime() - Date.now()),
  );
  const storage = new Storage(config);
  const workspaces = new Workspaces(config, queue.db, storage);
  try {
    timer = setInterval(
      async () => {
        if (busy) return;
        busy = true;
        try {
          await queue.heartbeat(l);
        } catch (e) {
          pulseError = e;
          abort.abort();
        } finally {
          busy = false;
        }
      },
      Math.max(500, (config.leaseSeconds * 1000) / 3),
    );
    const tenant = config.tenants.find((t) => t.id === l.run.tenant);
    if (!tenant) throw new AppError('TENANT_UNAVAILABLE', '调用方配置不存在');
    if (!delivery) {
      w = await workspaces.prepare(l, tenant);
      await rm(path.join(w.root, `output/${l.run.id}/agent-response.json`), { force: true });
      await queue.heartbeat(l, 'codex');
      await sandbox.run(l, w, abort.signal);
      await sandbox.stop(l.run.id);
      const outcome = await validate(sandbox, l, w, abort.signal);
      delivery = await productionRecord(w, l, outcome);
      await queue.withLease(l, async (q, r) => {
        await q.query('UPDATE runs SET prepared=$2 WHERE id=$1', [
          r.id,
          { ...r.prepared, delivery },
        ]);
      });
    }
    abort.signal.throwIfAborted();
    await queue.heartbeat(l, 'publishing');
    try {
      await publishResult(queue, storage, l, w!, tenant, delivery);
    } catch (error) {
      if (
        error instanceof AppError &&
        [
          'CANCELLED',
          'LEASE_LOST',
          'RUN_NOT_ACTIVE',
          'FILE_HANDOFF_FAILED',
          'RESULT_PROTOCOL_INVALID',
        ].includes(error.code)
      )
        throw error;
      // 交付故障只重试持久交接文件，绝不再次调用 Codex。
      await queue.deferDelivery(l, {
        code: 'DELIVERY_RETRY',
        message: '交付传输暂时失败，等待重试',
        retryable: true,
      });
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        runId: l.run.id,
        attempt: l.run.attempt,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    // If the daemon cannot confirm termination, throw without releasing the slot.
    await sandbox.stop(l.run.id);
    try {
      await queue.failed(l, publicError(pulseError ?? e));
    } catch (err) {
      if (!(err instanceof AppError) || !['LEASE_LOST', 'RUN_NOT_ACTIVE'].includes(err.code))
        throw err;
    }
  } finally {
    clearTimeout(deadline);
    if (timer) clearInterval(timer);
    shutdown?.removeEventListener('abort', stop);
  }
}
