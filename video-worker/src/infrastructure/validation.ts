import { Ajv } from 'ajv';
import { AppError } from '../domain/task.js';
import type { Lease } from '../domain/task.js';
import type { Workspace } from './workspace.js';
import type { Sandbox } from './sandbox.js';
import { planSchema } from '../contracts/ifeng.js';
import { readJson, safeFile, hashFile } from './files.js';
import path from 'node:path';
export async function validate(sandbox: Sandbox, l: Lease, w: Workspace, signal: AbortSignal) {
  for (const a of w.assets)
    if ((await hashFile(await safeFile(w.root, a.path))) !== a.sha256)
      throw new AppError('INPUT_CHANGED', '任务输入快照被修改');
  const response = await readJson(await safeFile(w.root, 'output/agent-response.json'));
  if (w.task.contractVersion === 'video-two-stage/1') {
    if (
      response.contractVersion !== w.task.contractVersion ||
      response.taskId !== l.run.task_id ||
      response.runId !== l.run.id ||
      response.stage !== l.run.stage ||
      response.status !== 'candidate'
    )
      throw new AppError('VALIDATION_FAILED', '候选协议或执行身份不符');
    const file = await safeFile(w.root, response.artifact);
    const report = await sandbox.validate(l, w, signal);
    if (!report.passed)
      throw new AppError('VALIDATION_FAILED', report.error?.message ?? '候选未通过终检');
    if ((await hashFile(file)) !== report.artifactSha256)
      throw new AppError('VALIDATION_FAILED', '终检后候选发生变化');
    return readJson(file);
  }
  const responseSchema = await readJson(
    path.join(
      process.env.TOOLKIT_ROOT ??
        new URL('../../../claude-code-video-toolkit', import.meta.url).pathname,
      '.agents/skills/video-pipeline/references/response-v2.schema.json',
    ),
  );
  const check = new Ajv({ strict: false }).compile<any>(responseSchema);
  if (
    !check(response) ||
    response.jobId !== l.run.id ||
    response.operation !== l.run.stage ||
    response.status !== 'candidate' ||
    response.artifact !==
      (l.run.stage === 'analysis' ? 'output/analysis-plan.json' : 'output/render-manifest.json')
  )
    throw new AppError('VALIDATION_FAILED', '缺少正确的候选响应');
  const report = await sandbox.validate(l, w, signal);
  if (!report.passed)
    throw new AppError('VALIDATION_FAILED', report.error?.message ?? '候选未通过可信校验');
  if (w.task.operation === 'analysis')
    return planSchema.parse(await readJson(await safeFile(w.root, 'output/analysis-plan.json')));
  return readJson(await safeFile(w.root, 'output/render-manifest.json'));
}
