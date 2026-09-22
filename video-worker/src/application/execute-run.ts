import path from 'node:path';
import { chmod } from 'node:fs/promises';
import type { Config } from '../config.js';
import { AppError, publicError, type Lease } from '../domain/task.js';
import { Queue } from '../infrastructure/queue.js';
import { Workspaces, type Workspace } from '../infrastructure/workspace.js';
import { Storage } from '../infrastructure/storage.js';
import type { Sandbox } from '../infrastructure/sandbox.js';
import { validate } from '../infrastructure/validation.js';
import { readJson, writeJson } from '../infrastructure/files.js';
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
  const deadline = setTimeout(
    () => {
      pulseError = new AppError('TIMEOUT', '任务总时限已到');
      abort.abort();
    },
    Math.max(1, new Date(l.run.deadline!).getTime() - Date.now()),
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
    w = await workspaces.prepare(l, tenant);
    for (;;) {
      if (abort.signal.aborted) throw pulseError ?? new AppError('WORKER_STOPPED', 'Worker 停止');
      await queue.heartbeat(l, 'codex');
      try {
        await sandbox.run(l, w, abort.signal);
        await sandbox.stop(l.run.id);
        await queue.heartbeat(l, 'validating');
        const result = await validate(sandbox, l, w, abort.signal);
        await sandbox.stop(l.run.id);
        await queue.heartbeat(l, 'publishing');
        await workspaces.saveSession(l, w);
        await publishResult(queue, storage, l, w, tenant, result);
        break;
      } catch (e) {
        await sandbox.stop(l.run.id);
        if (abort.signal.aborted) throw pulseError ?? e;
        let response: any;
        try {
          response = await readJson(path.join(w.root, 'output/agent-response.json'));
        } catch {}
        if (
          (response?.jobId ?? response?.runId) === l.run.id &&
          (response?.operation ?? response?.stage) === l.run.stage &&
          response?.status === 'failed' &&
          !response.error?.retryable
        )
          throw new AppError(
            String(response.error?.code ?? 'AGENT_FAILED'),
            String(response.error?.message ?? 'Agent 返回失败'),
          );
        if (l.run.stage === 'analysis') throw e;
        if (e instanceof AppError && e.code !== 'VALIDATION_FAILED') throw e;
        console.error(
          JSON.stringify({
            runId: l.run.id,
            validationError: e instanceof Error ? e.message : String(e),
          }),
        );
        l.run = await queue.consumeRepair(l, config.repairRounds);
        await writeJson(path.join(w.root, 'output/repair-feedback.json'), {
          round: l.run.repair_rounds,
          error: e instanceof Error ? e.message : 'Candidate invalid',
        });
        await chmod(path.join(w.root, 'output/repair-feedback.json'), 0o644);
      }
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
