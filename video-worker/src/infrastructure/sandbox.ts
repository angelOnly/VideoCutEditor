import type { Lease } from '../domain/task.js';
import type { Workspace } from './workspace.js';
export interface Sandbox {
  run(l: Lease, w: Workspace, signal: AbortSignal): Promise<void>;
  stop(runId: string): Promise<void>;
}
