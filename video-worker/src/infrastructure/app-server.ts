import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { jobUnit } from './host-processes.js';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import type { Config } from '../config.js';
import { productionRoot } from './production-plugin.js';

export interface HostTaskLimits {
  memory: string;
  cpus: number;
  tasksMax: number;
}

export function taskLimits(config: Config, stage: 'analysis' | 'render'): HostTaskLimits {
  return stage === 'render'
    ? {
        memory: config.hostRenderMemory,
        cpus: config.hostRenderCpus,
        tasksMax: config.hostRenderTasksMax,
      }
    : {
        memory: config.hostAnalysisMemory,
        cpus: config.hostAnalysisCpus,
        tasksMax: config.hostAnalysisTasksMax,
      };
}

export interface Rpc {
  request(method: string, params: any): Promise<any>;
  on(event: 'notification' | 'fatal', listener: (...args: any[]) => void): this;
  off(event: 'notification' | 'fatal', listener: (...args: any[]) => void): this;
  handleRequest?: (method: string, params: any) => Promise<any>;
  healthy: boolean;
  invalidate?(error: Error): void;
}
// app-server 读取登录状态；制作工具仅继承获准供应商配置，不继承数据库或回调凭据。
export function codexEnvironment(config: Config): NodeJS.ProcessEnv {
  return {
    PATH: `${path.dirname(config.python)}:${path.dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    HOME: process.env.HOME,
    USER: process.env.USER,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    LANG: 'C.UTF-8',
    CODEX_HOME: config.codexHome,
    TOOLKIT_ROOT: productionRoot(config),
    VIDEOCUT_PYTHON: config.python,
    REMOTION_MODULES_ROOT: config.renderModules,
    REMOTION_BROWSER_EXECUTABLE: config.hostBrowser,
    PYTHONDONTWRITEBYTECODE: '1',
    // 外层任务权限允许读制作记录；媒体子进程还须隔离这些非执行数据。
    VIDEOCUT_RENDER_SANDBOX: process.platform === 'darwin' ? 'seatbelt' : 'landlock',
    VIDEOCUT_RENDER_SLOTS: String(config.renderSlots),
    VIDEOCUT_FRAME_CONCURRENCY: String(config.frameConcurrency ?? 1),
    DOUBAO_TTS_API_KEY: process.env.DOUBAO_TTS_API_KEY,
    DOUBAO_TTS_RESOURCE_ID: config.ttsResourceId,
    DOUBAO_TTS_SPEAKER: config.ttsVoice,
    VIDEOCUT_TTS_VOICES: JSON.stringify(config.ttsVoices ?? {}),
  };
}
export const codexOverrides: Record<string, unknown> = {
  // 原生工具负责制作；只传递制作所需环境，不继承数据库和回调凭据。
  features: {
    code_mode_host: true,
    shell_tool: true,
    unified_exec: true,
    view_image: true,
  },
  shell_environment_policy: {
    inherit: 'all',
    ignore_default_excludes: true,
    include_only: [
      'PATH',
      'HOME',
      'LANG',
      'TOOLKIT_ROOT',
      'VIDEOCUT_PYTHON',
      'REMOTION_MODULES_ROOT',
      'REMOTION_BROWSER_EXECUTABLE',
      'PYTHONDONTWRITEBYTECODE',
      'TMPDIR',
      'VIDEOCUT_RENDER_SANDBOX',
      'VIDEOCUT_RENDER_SLOTS',
      'VIDEOCUT_FRAME_CONCURRENCY',
      'DOUBAO_TTS_API_KEY',
      'DOUBAO_TTS_RESOURCE_ID',
      'DOUBAO_TTS_SPEAKER',
      'VIDEOCUT_TTS_VOICES',
    ],
  },
};
function toml(value: any): string {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return (
      '{' +
      Object.entries(value)
        .map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`)
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export class AppServer extends EventEmitter implements Rpc {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private id = 0;
  healthy = false;
  handleRequest?: (method: string, params: any) => Promise<any>;
  async start(
    config: Config,
    runId?: string,
    overrides: Record<string, unknown> = codexOverrides,
    limits: HostTaskLimits = taskLimits(config, 'analysis'),
  ) {
    const args = ['app-server'];
    for (const [key, value] of Object.entries(overrides)) args.push('-c', `${key}=${toml(value)}`);
    const env = codexEnvironment(config);
    // code-mode 执行器也从服务进程继承临时目录，不能只设置 shell 子进程。
    const temporary = (overrides.shell_environment_policy as any)?.set?.TMPDIR;
    if (temporary) env.TMPDIR = temporary;
    // 一条活动执行一个进程组，取消该执行不会杀死其他任务；原生沙箱由 Codex 建立。
    const launch = runId
      ? [
          '--user',
          '--wait',
          '--pipe',
          '--collect',
          '--quiet',
          '--service-type=exec',
          `--unit=${jobUnit(runId)}`,
          '--property=KillMode=control-group',
          '--property=TimeoutStopSec=15s',
          '--property=SendSIGKILL=yes',
          '--property=UMask=0077',
          '--property=NoNewPrivileges=yes',
          `--property=MemoryMax=${limits.memory}`,
          `--property=CPUQuota=${limits.cpus * 100}%`,
          `--property=TasksMax=${limits.tasksMax}`,
          '--property=PartOf=videocut-worker.service',
          ...Object.keys(env)
            .filter((k) => env[k] !== undefined)
            .map((k) => `--setenv=${k}`),
          config.codexPath,
          ...args,
        ]
      : [];
    this.child = spawn(runId ? 'systemd-run' : config.codexPath, runId ? launch : args, {
      env,
      stdio: 'pipe',
      detached: true,
    });
    this.healthy = true;
    this.child.on('error', () => this.fail(new Error('CODEX_APP_SERVER_START_FAILED')));
    this.child.on('close', () => this.fail(new Error('CODEX_APP_SERVER_CLOSED')));
    // stderr may contain account or input data; drain it without forwarding to shared logs.
    this.child.stderr.resume();
    this.child.stdin.on('error', () => this.fail(new Error('CODEX_APP_SERVER_WRITE_FAILED')));
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch {
        this.fail(new Error('CODEX_PROTOCOL_INVALID'));
      }
    });
    await this.request('initialize', {
      clientInfo: { name: 'videocut_worker', version: '0.2.0' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized' });
    const account = await this.request('account/read', { refreshToken: true });
    if (account.account?.type !== 'chatgpt')
      throw new Error('CODEX_LOGIN_REQUIRED: use codex login as the Worker service user');
  }
  private send(message: any) {
    if (!this.healthy || !this.child) throw new Error('CODEX_APP_SERVER_UNAVAILABLE');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => this.fail(new Error(`CODEX_RPC_TIMEOUT: ${method}`)), 60000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  private receive(message: any) {
    if (message.method && message.id !== undefined) {
      const reply = this.handleRequest
        ? this.handleRequest(message.method, message.params)
        : Promise.reject(new Error('Unexpected server request'));
      void reply
        .then(
          (result) => {
            if (this.healthy) this.send({ id: message.id, result });
          },
          () => {
            if (this.healthy)
              this.send({
                id: message.id,
                error: { code: -32601, message: 'Request denied by Worker' },
              });
          },
        )
        .catch(() => this.fail(new Error('CODEX_REPLY_FAILED')));
    } else if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`CODEX_RPC_ERROR: ${message.error.code}`));
      else pending.resolve(message.result);
    } else if (message.method) this.emit('notification', message.method, message.params);
  }
  invalidate(error: Error) {
    this.fail(error);
  }
  private fail(error: Error) {
    if (!this.healthy) return;
    this.healthy = false;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit('fatal', error);
    // Unknown turn/start outcome must never leave an executing server behind.
    try {
      if (this.child?.pid && this.child.exitCode === null && this.child.signalCode === null)
        process.kill(-this.child.pid, 'SIGKILL');
    } catch {}
  }
  async close() {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const done = new Promise<void>((resolve) => child.once('close', () => resolve()));
    this.fail(new Error('CODEX_APP_SERVER_STOPPED'));
    await done;
  }
}
