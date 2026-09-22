import path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { Database } from '../infrastructure/postgres.js';
import { lock } from '../infrastructure/postgres.js';
import type { Config } from '../config.js';
import { AppError } from '../domain/task.js';
import { digest } from '../domain/scene.js';
import { readJson, safeFile, hashFile } from '../infrastructure/files.js';
import { pipelineRevision } from '../domain/storyboard.js';
import { command } from '../infrastructure/process.js';

export interface ResumeInput {
  runId: string;
  requestId: string;
  revision: number;
  note: string;
  actor: string;
  runtimeVersion: string;
  pipelineRevision: string;
}
/** 仅本地受控管理命令调用；网络租户接口不导出此能力。 */
export async function resumeRun(
  db: Database,
  config: Config,
  input: ResumeInput,
  stop: (id: string) => Promise<void>,
) {
  if (
    !input.requestId?.trim() ||
    !input.note?.trim() ||
    !input.actor?.trim() ||
    !Number.isSafeInteger(input.revision)
  )
    throw new AppError('INVALID_REQUEST', '恢复需提供幂等ID、暂停版本、修复说明和操作身份');
  const requestHash = digest(input);
  // 即使并发恢复，也必须先确认旧进程停止，再在事务中复查状态。
  const existing = (
    await db.query('SELECT * FROM run_resumptions WHERE run_id=$1 AND request_id=$2', [
      input.runId,
      input.requestId,
    ])
  ).rows[0];
  if (existing) {
    if (existing.request_hash !== requestHash)
      throw new AppError('IDEMPOTENCY_CONFLICT', '恢复请求ID已用于其他参数');
    return { runId: input.runId, resumed: true, reused: true };
  }
  const run = (await db.query('SELECT * FROM runs WHERE id=$1', [input.runId])).rows[0];
  if (run?.state !== 'waiting_human') throw new AppError('RUN_NOT_WAITING', '任务不在人工等待状态');
  await stop(input.runId);
  const task = (await db.query('SELECT * FROM tasks WHERE id=$1', [run.task_id])).rows[0];
  if (task.plan_version !== run.plan_version)
    throw new AppError('STALE_CONFIRMATION', '确认版本已经改变');
  if (input.runtimeVersion !== config.runtimeVersion || input.pipelineRevision !== pipelineRevision)
    throw new AppError('PIPELINE_REVISION_EXPIRED', '批准版本与当前安装版本不符');
  const root = path.join(config.dataRoot, run.task_id, 'runs', run.id, `attempt_${run.attempt}`);
  const request = await readJson(await safeFile(root, `render/${run.id}/request.json`));
  const plan = request.confirmation;
  if (
    plan.planVersion !== run.plan_version ||
    (await hashFile(await safeFile(root, plan.planFile))) !== plan.planSha256
  )
    throw new AppError('CONFIRMATION_CHANGED', '确认文件损坏或改变');
  for (const [file, hash] of Object.entries(request.snapshot))
    if ((await hashFile(await safeFile(root, file))) !== hash)
      throw new AppError('INPUT_CHANGED', '冻结输入改变');
  // 让固定 Python 入口核对登记摘要；不执行项目提供的脚本。
  await command(
    config.python,
    [
      '-c',
      'import sys;sys.path.insert(0,sys.argv[1]);from two_stage import load_request;load_request(sys.argv[2],"render")',
      path.join(config.toolkitRoot, 'tools'),
      path.join(root, `render/${run.id}/request.json`),
    ],
    { timeout: 30000 },
  );
  async function verifyCache(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (e: any) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new AppError('CACHE_CORRUPT', '收费缓存不允许符号链接');
      if (entry.isDirectory()) await verifyCache(file);
      else if (entry.name === 'request.json') {
        const record = await readJson(file);
        if (!['completed', 'not_submitted'].includes(record.state))
          throw new AppError('EXTERNAL_RESULT_UNKNOWN', '收费结果仍未核实，禁止自动重发');
        if (
          record.state === 'completed' &&
          (await hashFile(path.join(directory, 'audio.mp3'))) !== record.audio?.sha256
        )
          throw new AppError('CACHE_CORRUPT', '已完成收费音频摘要不符');
        if (record.state === 'completed') {
          try {
            await command(
              'ffmpeg',
              ['-v', 'error', '-i', path.join(directory, 'audio.mp3'), '-f', 'null', '-'],
              { timeout: 30000 },
            );
          } catch {
            throw new AppError('CACHE_CORRUPT', '已完成收费音频无法完整解码');
          }
        }
      }
    }
  }
  await verifyCache(path.join(config.dataRoot, run.task_id, 'tool-cache'));
  return db.tx(async (q) => {
    await lock(q);
    const prior = (
      await q.query('SELECT * FROM run_resumptions WHERE run_id=$1 AND request_id=$2', [
        run.id,
        input.requestId,
      ])
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash)
        throw new AppError('IDEMPOTENCY_CONFLICT', '恢复请求参数冲突');
      return { runId: run.id, resumed: true, reused: true };
    }
    const current = (await q.query('SELECT * FROM runs WHERE id=$1 FOR UPDATE', [run.id])).rows[0];
    const currentTask = (await q.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [run.task_id]))
      .rows[0];
    if (
      current.state !== 'waiting_human' ||
      current.recovery.revision !== input.revision ||
      currentTask.plan_version !== run.plan_version
    )
      throw new AppError('STALE_RECOVERY', '暂停记录或确认版本已改变');
    if (!(current.remaining_seconds > 0))
      throw new AppError('BUDGET_EXHAUSTED', '剩余执行时间已用尽');
    if ((await q.query('SELECT id FROM execution_slots WHERE run_id=$1', [run.id])).rows.length)
      throw new AppError('TASK_BUSY', '执行槽尚未释放');
    const approved = {
      runtimeVersion: input.runtimeVersion,
      pipelineRevision: input.pipelineRevision,
    };
    // 只允许原始制作契约仍可读取的兼容恢复；未知格式不得绕过校验。
    await q.query(
      'INSERT INTO run_resumptions(run_id,request_id,request_hash,actor,note,approved_version) VALUES($1,$2,$3,$4,$5,$6)',
      [run.id, input.requestId, requestHash, input.actor, input.note, approved],
    );
    await q.query(
      "UPDATE runs SET state='queued',error=NULL,deadline=NULL,progress_stage='resuming',recovery=$2 WHERE id=$1",
      [
        run.id,
        {
          ...current.recovery,
          approvedVersion: approved,
          resumedAt: new Date().toISOString(),
          loop: undefined,
        },
      ],
    );
    await q.query("UPDATE tasks SET state='render_queued',config=$2,updated_at=now() WHERE id=$1", [
      run.task_id,
      { ...currentTask.config, ...approved },
    ]);
    return { runId: run.id, resumed: true, reused: false };
  });
}
