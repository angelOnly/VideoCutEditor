export type Stage = 'analysis' | 'render';
export type RunState =
  'queued' | 'running' | 'cancelling' | 'waiting_human' | 'succeeded' | 'failed' | 'cancelled';
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400,
    public retryable = false,
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
  return e instanceof AppError
    ? { code: e.code, message: e.message, retryable: e.retryable }
    : { code: 'INTERNAL_ERROR', message: '任务执行失败，详情见服务日志', retryable: false };
}
