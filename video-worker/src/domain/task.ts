export type Stage = 'analysis' | 'render';
export type RunState =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'needs_input'
  | 'waiting_human'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400,
    public retryable = false,
    // 仅保存可向同一任务调用方展示的诊断字段，不能放入原始输入或账号信息。
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export const fail = (code: string, message: string, status = 400): never => {
  throw new AppError(code, message, status);
};
export interface Run {
  id: string;
  task_id: string;
  tenant: string;
  request_id: string;
  stage: Stage;
  state: RunState;
  input: any;
  prepared?: any;
  plan_version: number;
  attempt: number;
  repair_rounds: number;
  fencing_token: number;
  deadline: Date | string | null;
  progress_stage: string;
  recovery?: any;
  remaining_seconds?: number | null;
}
export interface Lease {
  slot: number;
  owner: string;
  token: number;
  run: Run;
}
export function publicError(e: unknown) {
  if (!(e instanceof AppError))
    return { code: 'INTERNAL_ERROR', message: '任务执行失败，详情见服务日志', retryable: false };
  return {
    code: e.code,
    message: e.message,
    retryable: e.retryable,
    ...(e.details ? { details: e.details } : {}),
  };
}
