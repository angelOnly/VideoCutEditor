import type { Database } from '../infrastructure/postgres.js';
import type { Config } from '../config.js';
import { AppError } from '../domain/task.js';
export interface ResumeInput {
  runId: string;
  requestId: string;
  revision: number;
  note: string;
  actor: string;
  runtimeVersion: string;
  pipelineRevision: string;
}
// 新协议以追加消息继续制作；历史制作恢复记录只读，不能回退旧工具。
export async function resumeRun(
  _db: Database,
  _config: Config,
  _input: ResumeInput,
  _stop: (id: string) => Promise<void>,
) {
  throw new AppError(
    'NEW_MESSAGE_REQUIRED',
    '旧制作恢复入口已停用，请提交新的客户端消息；任务资料会保留',
  );
}
