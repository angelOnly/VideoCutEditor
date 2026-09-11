import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import type { Config } from '../config.js';

export interface Rpc {
  request(method: string, params: any): Promise<any>;
  on(event: 'notification' | 'fatal', listener: (...args: any[]) => void): this;
  off(event: 'notification' | 'fatal', listener: (...args: any[]) => void): this;
  handleRequest?: (method: string, params: any) => Promise<any>;
  healthy: boolean;
  invalidate?(error: Error): void;
}
// Only the controller sees OAuth credentials. Never inherit database/TTS/API secrets.
export function codexEnvironment(config: Config): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    LANG: 'C.UTF-8',
    CODEX_HOME: config.codexHome,
  };
}
export const disabledFeatures = [
  'shell_tool',
  'unified_exec',
  'view_image',
  'multi_agent',
  'multi_agent_v2',
  'apps',
  'plugins',
  'hooks',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'image_generation',
  'code_mode',
  'code_mode_host',
  'memories',
  'shell_snapshot',
  'workspace_dependencies',
  'skill_mcp_dependency_install',
  'skill_search',
  'goals',
];
export const codexOverrides: Record<string, unknown> = {
  features: Object.fromEntries(disabledFeatures.map((name) => [name, false])),
  mcp_servers: {},
  web_search: 'disabled',
  shell_environment_policy: { inherit: 'none' },
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
  async start(config: Config) {
    const args = ['app-server'];
    for (const [key, value] of Object.entries(codexOverrides))
      args.push('-c', `${key}=${toml(value)}`);
    this.child = spawn(config.codexPath, args, {
      env: codexEnvironment(config),
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
