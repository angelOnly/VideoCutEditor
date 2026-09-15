import path from 'node:path';
import { stagePath } from '../contracts/two-stage.js';
import { readJson } from './files.js';
import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import type { Lease } from '../domain/task.js';
import type { Workspace } from './workspace.js';
import type { Sandbox } from './sandbox.js';
import type { Queue } from './queue.js';
import { AppServer } from './app-server.js';
import { HostProcesses } from './host-processes.js';
import { HostCodex } from '../runner/codex-host.js';
import { command } from './process.js';
import { checkHostIsolation } from './host-preflight.js';
export class HostSandbox implements Sandbox {
  private rpc = new AppServer();
  private processes: HostProcesses;
  private codex: HostCodex;
  get healthy() {
    return this.rpc.healthy;
  }
  constructor(
    private config: Config,
    queue: Queue,
  ) {
    this.processes = new HostProcesses(config);
    this.codex = new HostCodex(config, this.rpc, queue, this.processes);
  }
  async start() {
    await this.processes.preflight();
    await this.processes.stopAll(); // Single-host flock is held; clean stale jobs before claiming any slot.
    await checkHostIsolation(this.config, this.processes);
    const version = (
      await command(this.config.codexPath, ['--version'], { timeout: 10000 })
    ).trim();
    if (version !== 'codex-cli 0.154.0')
      throw new Error('Host Worker requires the pinned Codex CLI 0.154.0; run install-host.sh');
    // Include source/runtime version in reuse hashes; a native execution is not a Docker image.
    const tools = await Promise.all([
      command('ffmpeg', ['-version']),
      command(this.config.hostBrowser, ['--version']),
      command(this.config.python, ['--version']),
      command('bwrap', ['--version']),
    ]);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          node: process.version,
          arch: process.arch,
          codex: version,
          tools: tools.map((s) => s.split('\n')[0]),
        }),
      )
      .digest('hex');
    this.config.runnerImage = `host:${this.config.runtimeVersion}:${fingerprint}`;
    try {
      await this.rpc.start(this.config);
    } catch (e) {
      await this.close();
      throw e;
    }
  }
  run(l: Lease, w: Workspace, signal: AbortSignal) {
    return this.codex.run(l, w, signal);
  }
  stop(runId: string) {
    return this.codex.stop(runId);
  }
  async tool(
    l: Lease,
    w: Workspace,
    argv: string[],
    signal: AbortSignal,
    cacheDir?: string,
    tts?: boolean,
  ) {
    return this.processes.run(
      l.run.id,
      w,
      argv.map((a, i) => (i === 0 && a === 'python3' ? this.config.python : a)),
      signal,
      'tool',
      cacheDir,
      tts,
    );
  }
  async validate(l: Lease, w: Workspace, signal: AbortSignal) {
    if (w.task.contractVersion === 'video-two-stage/1') {
      const response = await readJson(path.join(w.root, 'output/agent-response.json'));
      return JSON.parse(
        (
          await this.processes.run(
            l.run.id,
            w,
            [
              this.config.python,
              path.join(this.config.toolkitRoot, 'tools/worker_stage.py'),
              'check',
              '--request',
              path.join(w.root, stagePath(w.task)),
              '--artifact',
              response.artifact,
            ],
            signal,
            'validate',
          )
        ).trim(),
      );
    }
    const script =
      w.task.operation === 'analysis' ? 'validate_analysis.py' : 'validate_segments.py';
    const out = await this.processes.run(
      l.run.id,
      w,
      [
        this.config.python,
        path.join(this.config.toolkitRoot, '.agents/skills/video-pipeline/scripts', script),
        '--job-dir',
        w.root,
      ],
      signal,
      'validate',
    );
    return JSON.parse(out.trim());
  }
  async close() {
    await this.rpc.close();
    await this.processes.stopAll();
  }
}
