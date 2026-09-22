/** 制作故障可修当前工程；公共链路和收费风险不能交给制作模型修改。 */
export type RecoveryAction = 'continue' | 'repair' | 'wait_human' | 'fail';
export interface RecoveryIssue {
  code: string;
  message: string;
  scope?: 'task_project' | 'shared_pipeline' | 'external';
  sceneIds?: string[];
  evidence?: unknown;
}
export interface RecoveryState {
  iteration: number;
  stagnant: number;
  completed: string[];
  seen?: string[];
  issueKey: string;
}
const terminal = new Set(['CANCELLED', 'TIMEOUT', 'BUDGET_EXHAUSTED', 'REPAIR_BUDGET_EXHAUSTED']);
const human = new Set([
  'EXTERNAL_RESULT_UNKNOWN',
  'CACHE_CORRUPT',
  'CAPABILITY_MISSING',
  'INPUT_CHANGED',
  'INPUT_SNAPSHOT_INVALID',
  'CONFIRMATION_CHANGED',
  'STALE_CONFIRMATION',
  'PIPELINE_REVISION_EXPIRED',
  'PATH_ESCAPE',
  'SHARED_PIPELINE_ERROR',
  'TIMELINE_ADJUSTMENT_STALLED',
]);
const adjustment = new Set([
  'TIMELINE_EXTEND_REQUIRED',
  'CONTENT_TIMELINE_REQUIRED',
  'MIX_REBUILD_REQUIRED',
  'PRODUCTION_INCOMPLETE',
  'TIMELINE_STALE',
]);
const repair = new Set([
  'TASK_LAYOUT_INVALID',
  'VALIDATION_FAILED',
  'RENDER_RESULT_MISSING',
  'RENDER_RESULT_INVALID',
  'RENDER_FAILED',
  'RENDER_TIMEOUT',
  'TOOL_TIMEOUT',
  'MEDIA_INVALID',
  'AUDIO_MISMATCH',
  'AUDIO_CLIPPING',
  'CAPTION_MISSING',
  'SILENT_AUDIO',
  'INVALID_CONTRACT',
  'MISSING_INPUT',
]);

export function decideRecovery(
  issue: RecoveryIssue,
  completed: string[],
  previous?: RecoveryState,
) {
  const current = [...new Set(completed)].sort();
  const issueKey = JSON.stringify([
    issue.code,
    issue.scope ?? '',
    [...(issue.sceneIds ?? [])].sort(),
  ]);
  // 实测混音或成片的新摘要算进展；重复使用曾见摘要不重置停滞计数。
  const old = previous?.seen ?? previous?.completed ?? [];
  const progress = current.some((id) => !old.includes(id));
  const state: RecoveryState = {
    iteration: (previous?.iteration ?? 0) + 1,
    stagnant: progress ? 0 : (previous?.stagnant ?? 0) + 1,
    completed: current,
    seen: [...new Set([...old, ...current])],
    issueKey,
  };
  let action: RecoveryAction;
  if (terminal.has(issue.code)) action = 'fail';
  else if (human.has(issue.code) || issue.scope === 'shared_pipeline' || issue.scope === 'external')
    action = 'wait_human';
  else if (state.stagnant >= 3) action = 'wait_human';
  else if (adjustment.has(issue.code)) action = 'continue';
  else if (repair.has(issue.code)) action = 'repair';
  else action = 'wait_human';
  return {
    action,
    state,
    issue:
      state.stagnant >= 3 && action === 'wait_human' && !human.has(issue.code)
        ? { ...issue, message: `连续三个周期没有可验证进展：${issue.message}` }
        : issue,
  };
}
