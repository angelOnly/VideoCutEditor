import type { Config } from '../config.js';
import type { Lease } from '../domain/task.js';
import type { Workspace } from './workspace.js';
import type { Sandbox } from './sandbox.js';
import type { Queue } from './queue.js';
import { AppServer, taskLimits } from './app-server.js';
import { HostProcesses } from './host-processes.js';
import { checkNativeIsolation } from './native-preflight.js';
import { HostCodex, threadConfig } from '../runner/codex-host.js';
import { command } from './process.js';
export class HostSandbox implements Sandbox {
  private processes: HostProcesses;
  private sessions = new Map<string, { rpc: AppServer; codex: HostCodex }>();
  private started = false;
  get healthy() {
    return this.started;
  }
  constructor(
    private config: Config,
    private queue: Queue,
  ) {
    this.processes = new HostProcesses(config);
  }
  async start() {
    await this.processes.preflight();
    await this.processes.stopAll();
    const version = (
      await command(this.config.codexPath, ['--version'], { timeout: 10000 })
    ).trim();
    if (version !== 'codex-cli 0.154.0') throw new Error('需要已固定的 Codex CLI 0.154.0');
    const rpc = new AppServer();
    try {
      await rpc.start(this.config);
    } finally {
      await rpc.close();
    }
    await checkNativeIsolation(this.config, this.processes);
    this.started = true;
  }
  async run(l: Lease, w: Workspace, signal: AbortSignal) {
    const rpc = new AppServer();
    const codex = new HostCodex(this.config, rpc, this.queue, this.processes);
    this.sessions.set(l.run.id, { rpc, codex });
    try {
      await rpc.start(
        this.config,
        l.run.id,
        threadConfig(this.config, w),
        taskLimits(this.config, l.run.stage),
      );
      signal.throwIfAborted();
      await codex.run(l, w, signal);
    } finally {
      await this.stop(l.run.id);
    }
  }
  async stop(runId: string) {
    const session = this.sessions.get(runId);
    try {
      if (session) await session.codex.stop(runId);
    } finally {
      if (session) await session.rpc.close();
      await this.processes.stop(runId);
      this.sessions.delete(runId);
    }
  }
  async close() {
    this.started = false;
    for (const runId of this.sessions.keys()) await this.stop(runId);
    await this.processes.stopAll();
  }
}
