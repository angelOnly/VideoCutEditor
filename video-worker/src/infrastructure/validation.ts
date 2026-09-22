import { AppError } from '../domain/task.js';
import type { Lease } from '../domain/task.js';
import type { Workspace } from './workspace.js';
import type { Sandbox } from './sandbox.js';
import { readJson, safeFile, hashFile } from './files.js';
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
      response.stage !== l.run.stage
    )
      throw new AppError('VALIDATION_FAILED', '候选协议或执行身份不符');
    // 缺少执行能力需外部补齐环境；重新启动同一模型 turn 不会恢复能力。
    if (response.status === 'failed' && response.error?.code === 'CAPABILITY_MISSING')
      throw new AppError('CAPABILITY_MISSING', response.error?.message ?? '执行环境缺少必需能力');
    if (response.status === 'human_required')
      throw new AppError('HUMAN_REVIEW_REQUESTED', response.error?.message ?? '模型请求人工检查');
    if (response.status === 'continue_required')
      throw new AppError('PRODUCTION_INCOMPLETE', response.error?.message ?? '制作尚未完成');
    if (response.status === 'failed')
      throw new AppError(
        'VALIDATION_FAILED',
        `${response.error?.code ?? 'AGENT_FAILED'}: ${response.error?.message ?? 'Agent 返回失败'}`,
      );
    if (response.status !== 'candidate') throw new AppError('VALIDATION_FAILED', '缺少候选响应');
    const file = await safeFile(w.root, response.artifact);
    const report = await sandbox.validate(l, w, signal);
    if (!report.passed)
      throw new AppError(
        report.error?.code ?? 'VALIDATION_FAILED',
        report.error?.message ?? '候选未通过终检',
      );
    if ((await hashFile(file)) !== report.artifactSha256)
      throw new AppError('VALIDATION_FAILED', '终检后候选发生变化');
    return readJson(file);
  }
  throw new AppError('PIPELINE_REVISION_EXPIRED', '不支持旧执行协议');
}
