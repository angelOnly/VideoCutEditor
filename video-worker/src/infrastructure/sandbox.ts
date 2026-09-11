import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import type { Lease } from '../domain/task.js';
import type { Workspace } from './workspace.js';
import { command } from './process.js';
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
export class DockerSandbox implements Sandbox {
  constructor(
    private config: Config,
    private exec = command,
  ) {}
  private name(l: Lease, suffix = 'agent') {
    return `videocut-${l.run.id}-${l.run.attempt}-${l.run.repair_rounds}-${suffix}`;
  }
  private mounts(w: Workspace) {
    return [
      '--mount',
      `type=bind,src=${w.root},dst=/workspace/job`,
      '--mount',
      `type=bind,src=${w.root}/input,dst=/workspace/job/input,readonly`,
      '--mount',
      `type=bind,src=${w.root}/task.json,dst=/workspace/job/task.json,readonly`,
    ];
  }
  async run(l: Lease, w: Workspace, signal: AbortSignal) {
    const env = Object.fromEntries(
      Object.entries({
        PATH: process.env.PATH,
        CODEX_API_KEY: this.config.codexApiKey,
        CODEX_MODEL: this.config.codexModel,
        CODEX_REASONING_EFFORT: this.config.codexReasoningEffort,
        CODEX_BASE_URL: this.config.codexBaseUrl,
      }).filter(([, v]) => v !== undefined),
    );
    const args = [
      'create',
      '--name',
      this.name(l),
      '--label',
      `videocut.run=${l.run.id}`,
      '--init',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user',
      this.config.dockerUid,
      '--pids-limit',
      '256',
      '--memory',
      this.config.dockerMemory,
      '--cpus',
      this.config.dockerCpus,
      '--network',
      this.config.dockerNetwork,
      '--tmpfs',
      '/tmp:rw,nosuid,size=1024m',
      '--shm-size',
      '512m',
      ...this.mounts(w),
      '-e',
      'CODEX_HOME=/workspace/job/codex-home',
      '-e',
      'HOME=/workspace/job',
      '-e',
      'CODEX_API_KEY',
      '-e',
      'CODEX_MODEL',
      '-e',
      'CODEX_REASONING_EFFORT',
      '-e',
      'CODEX_BASE_URL',
      this.config.runnerImage,
      'node',
      '/opt/runner/runner.mjs',
    ];
    const id = (await this.exec('docker', args, { env, signal, timeout: 30000 })).trim();
    try {
      await this.exec('docker', ['start', id], { signal, timeout: 30000 });
      const exit = await this.exec('docker', ['wait', id], {
        signal,
        timeout: Math.max(1, new Date(l.run.deadline!).getTime() - Date.now()),
      });
      if (exit.trim() !== '0') {
        let log = await this.exec('docker', ['logs', '--tail', '50', id], { timeout: 30000 }).catch(
          () => 'Runner logs unavailable',
        );
        if (this.config.codexApiKey) log = log.split(this.config.codexApiKey).join('[redacted]');
        await writeFile(path.join(w.root, 'output/runner-error.log'), log.slice(-16000), {
          mode: 0o600,
        });
        throw Error(`Runner exited ${exit.trim()}: ${log.slice(-2000)}`);
      }
    } finally {
      await this.stop(l.run.id);
    }
  }
  async stop(runId: string) {
    const ids = (
      await this.exec('docker', ['ps', '-aq', '--filter', `label=videocut.run=${runId}`], {
        timeout: 30000,
      })
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    // rm -f waits for the daemon to stop container processes; failure leaves the database slot occupied.
    for (const id of ids) await this.exec('docker', ['rm', '-f', id], { timeout: 30000 });
  }
  async tool(
    l: Lease,
    w: Workspace,
    argv: string[],
    signal: AbortSignal,
    cacheDir?: string,
    tts = false,
  ) {
    const env = { ...process.env };
    const args = [
      'create',
      '--name',
      this.name(l, 'tool-' + randomUUID().slice(0, 8)),
      '--label',
      `videocut.run=${l.run.id}`,
      '--init',
      '--read-only',
      '--network',
      tts ? this.config.dockerNetwork : 'none',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user',
      this.config.dockerUid,
      '--memory',
      '1g',
      '--cpus',
      '1',
      '--pids-limit',
      '64',
      '--tmpfs',
      '/tmp:rw,nosuid,size=256m',
      '--mount',
      `type=bind,src=${w.root},dst=/workspace/job`,
    ];
    if (cacheDir) args.push('--mount', `type=bind,src=${cacheDir},dst=/audio-cache`);
    if (tts) args.push('-e', 'DOUBAO_TTS_API_KEY', '-e', 'DOUBAO_TTS_RESOURCE_ID');
    const id = (
      await this.exec('docker', [...args, this.config.runnerImage, ...argv], {
        env,
        signal,
        timeout: 30000,
      })
    ).trim();
    try {
      return await this.exec('docker', ['start', '-a', id], { signal, timeout: 180000 });
    } finally {
      await this.stop(l.run.id);
    }
  }
  async validate(l: Lease, w: Workspace, signal: AbortSignal) {
    const script =
      w.task.operation === 'analysis' ? 'validate_analysis.py' : 'validate_segments.py';
    const id = (
      await this.exec(
        'docker',
        [
          'create',
          '--name',
          this.name(l, 'validate'),
          '--label',
          `videocut.run=${l.run.id}`,
          '--read-only',
          '--network',
          'none',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--user',
          this.config.dockerUid,
          '--memory',
          '1g',
          '--cpus',
          '1',
          '--pids-limit',
          '64',
          '--mount',
          `type=bind,src=${w.root},dst=/workspace/job,readonly`,
          this.config.runnerImage,
          'python3',
          `/opt/toolkit/.agents/skills/video-pipeline/scripts/${script}`,
          '--job-dir',
          '/workspace/job',
        ],
        { signal, timeout: 30000 },
      )
    ).trim();
    try {
      const out = await this.exec('docker', ['start', '-a', id], { signal, timeout: 600000 });
      return JSON.parse(out.trim());
    } finally {
      await this.stop(l.run.id);
    }
  }
}
