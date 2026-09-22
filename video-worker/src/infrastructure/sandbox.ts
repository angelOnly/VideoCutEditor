import type { Lease } from '../domain/task.js';
import type { Workspace } from './workspace.js';
export interface Sandbox {
  run(l: Lease, w: Workspace, signal: AbortSignal): Promise<void>;
  stop(runId: string): Promise<void>;
  validate(l: Lease, w: Workspace, signal: AbortSignal): Promise<any>;
  tool(
    l: Lease,
    w: Workspace,
    argv: string[],
    signal: AbortSignal,
    cacheDir?: string,
    tts?: boolean,
  ): Promise<string>;
}
