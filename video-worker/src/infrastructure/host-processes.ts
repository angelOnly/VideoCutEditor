import path from 'node:path';
import { access, realpath, mkdir, chmod, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { stagePath } from '../contracts/two-stage.js';
import { writeJson } from './files.js';
import type { Config } from '../config.js';
import type { Workspace } from './workspace.js';
import { command } from './process.js';

const unitPrefix = 'videocut-job-';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function jobUnit(runId: string) {
  if (!uuid.test(runId)) throw new Error('Invalid internal run ID');
  return `${unitPrefix}${runId}.service`;
}
// Paths admitted into the namespace; the repository root and CODEX_HOME are never mounted.
export const admittedToolkit = [
  '.agents/skills/video-pipeline',
  '.agents/skills/remotion-best-practices',
  '.agents/skills/remotion',
  '.agents/skills/ffmpeg',
  'templates/ifeng-scenes/node_modules',
  '.claude/skills/video-pipeline/references/two-stage.schema.json',
  ...[
    'generate_dialogue_audio.py',
    'two_stage.py',
    'stage_media.py',
    'stage_tts.py',
    'cached_tts.py',
    'worker_stage.py',
    'render_scene.cjs',
    'config.py',
    'voiceover.py',
    'doubao_tts.py',
    'worker_tts.py',
    'render_segments.py',
    'inspect_assets.py',
  ].map((f) => `tools/${f}`),
];
export function bubblewrapArgs(
  config: Config,
  w: Workspace,
  argv: string[],
  mode: 'agent' | 'tool' | 'validate',
  cache?: string,
  tts = false,
) {
  const args = ['--die-with-parent', '--new-session', '--unshare-all'];
  if (tts) args.push('--share-net'); // Only the fixed trusted TTS adapter receives network access.
  for (const directory of ['/usr', '/bin', '/lib', '/lib64'])
    args.push('--ro-bind-try', directory, directory);
  for (const file of [
    '/etc/ld.so.cache',
    // Ubuntu 的 BLAS/LAPACK 等库通过 alternatives 链接，FFmpeg 运行时需要解析。
    '/etc/alternatives',
    '/etc/fonts',
    '/etc/ssl/certs',
    '/etc/resolv.conf',
    '/etc/nsswitch.conf',
    '/etc/hosts',
    '/etc/passwd',
    '/etc/group',
  ])
    args.push('--ro-bind-try', file, file);
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/dev/shm');
  for (const relative of [
    ...admittedToolkit,
    ...(w.task?.contractVersion === 'video-two-stage/1' ? [] : ['templates/ifeng-scenes']),
  ]) {
    const source = path.join(config.toolkitRoot, relative);
    args.push('--ro-bind', source, source);
  }
  const pythonRoot = path.resolve(path.dirname(config.python), '..');
  if (!path.isAbsolute(config.python) || pythonRoot === '/')
    throw new Error('Host PYTHON must point to the installed virtualenv');
  args.push('--ro-bind', pythonRoot, pythonRoot);
  args.push('--ro-bind', process.execPath, process.execPath);
  args.push('--ro-bind', w.root, w.root);
  if (mode !== 'validate') {
    for (const directory of ['project', 'output', 'cache']) {
      const p = path.join(w.root, directory);
      args.push('--bind', p, p);
    }
  }
  if (w.task?.contractVersion === 'video-two-stage/1' && mode !== 'validate') {
    const request = path.join(w.root, stagePath(w.task));
    const phase = path.dirname(request);
    args.push('--bind', phase, phase, '--ro-bind', request, request);
    for (const name of ['.operation.lock', '.execution.lock'])
      args.push('--bind', path.join(w.root, name), path.join(w.root, name));
    if (tts) {
      const audio = path.join(w.root, 'tool-audio');
      args.push('--bind', audio, audio);
    }
  }
  if (mode === 'tool' && w.task?.contractVersion !== 'video-two-stage/1') {
    const audio = path.join(w.root, 'input/audio');
    args.push('--bind', audio, audio);
  }
  if (cache) args.push('--bind', cache, cache);
  args.push(
    '--clearenv',
    '--setenv',
    'PATH',
    `${path.dirname(config.python)}:${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    '--setenv',
    'HOME',
    '/tmp',
    '--setenv',
    'TMPDIR',
    '/tmp',
    '--setenv',
    'LANG',
    'C.UTF-8',
    '--setenv',
    'JOB_DIR',
    w.root,
    '--setenv',
    'TOOLKIT_ROOT',
    config.toolkitRoot,
    '--setenv',
    'PYTHONDONTWRITEBYTECODE',
    '1',
    '--setenv',
    'REMOTION_BROWSER_EXECUTABLE',
    config.hostBrowser,
  );
  // Values are inherited by bwrap from systemd; never include secrets in its argv.
  if (tts) {
    // --clearenv removed them: the trusted Python launcher copies just these before exec.
    args.splice(args.indexOf('--clearenv'), 1);
  }
  args.push('--chdir', w.root, '--', ...argv);
  return args;
}
export class HostProcesses {
  private busy = new Set<string>();
  private running = new Map<string, Promise<string>>();
  constructor(
    private config: Config,
    private exec = command,
  ) {}
  async stop(runId: string) {
    const unit = jobUnit(runId);
    // A missing unit is success; manager errors must propagate and keep the slot occupied.
    const units = await this.exec(
      'systemctl',
      ['--user', 'list-units', '--all', '--plain', '--no-legend', unit],
      { timeout: 15000 },
    );
    if (units.trim()) await this.exec('systemctl', ['--user', 'stop', unit], { timeout: 45000 });
    const pending = this.running.get(runId);
    if (pending) await pending.catch(() => {});
    const remaining = await this.exec(
      'systemctl',
      [
        '--user',
        'list-units',
        '--state=active,activating,deactivating',
        '--plain',
        '--no-legend',
        unit,
      ],
      { timeout: 15000 },
    );
    if (remaining.trim()) throw new Error('HOST_PROCESS_STOP_UNCONFIRMED');
  }
  async stopAll() {
    const out = await this.exec(
      'systemctl',
      ['--user', 'list-units', '--all', '--plain', '--no-legend', `${unitPrefix}*.service`],
      { timeout: 15000 },
    );
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const unit = line.trim().split(/\s+/)[0];
      const id = unit.slice(unitPrefix.length, -'.service'.length);
      if (jobUnit(id) !== unit) throw new Error('Unexpected job unit');
      await this.stop(id);
    }
  }
  async run(
    runId: string,
    w: Workspace,
    argv: string[],
    signal: AbortSignal,
    mode: 'agent' | 'tool' | 'validate',
    cache?: string,
    tts = false,
  ) {
    signal.throwIfAborted();
    if (this.busy.has(runId)) throw new Error('One command at a time per task');
    if (
      tts &&
      (mode !== 'tool' ||
        !['worker_tts.py', 'worker_stage.py'].some(
          (f) => argv[1] === path.join(this.config.toolkitRoot, 'tools', f),
        ))
    )
      throw new Error('Network is only available to the trusted TTS adapter');
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    };
    const args = [
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
      `--property=MemoryMax=${this.config.hostMemory}`,
      `--property=CPUQuota=${this.config.hostCpus * 100}%`,
      `--property=TasksMax=${this.config.hostTasksMax}`,
      '--property=RuntimeMaxSec=1800',
      '--property=PartOf=videocut-worker.service',
    ];
    if (tts)
      for (const key of ['DOUBAO_TTS_API_KEY', 'DOUBAO_TTS_RESOURCE_ID']) {
        if (process.env[key]) {
          env[key] = process.env[key];
          args.push(`--setenv=${key}`);
        }
      }
    // Do not send shell text through systemd's ExecStart variable expansion. A private
    // JSON payload preserves $, %, quotes and newlines on Ubuntu 22.04 and 24.04 alike.
    const payload = path.join(this.config.dataRoot, '.host-commands', randomUUID() + '.json');
    this.busy.add(runId);
    let abortTimer: NodeJS.Timeout | undefined;
    const stopCommand = () => {
      void this.exec('systemctl', ['--user', 'stop', jobUnit(runId)], { timeout: 45000 }).catch(
        () => {},
      );
    };
    const abort = () => {
      stopCommand();
      abortTimer ??= setInterval(stopCommand, 250);
    };
    try {
      await mkdir(path.dirname(payload), { recursive: true, mode: 0o700 });
      await chmod(path.dirname(payload), 0o700);
      await writeJson(payload, bubblewrapArgs(this.config, w, argv, mode, cache, tts));
      args.push(
        '/usr/bin/python3',
        '-c',
        'import json,os,sys; a=json.load(open(sys.argv[1])); e={k:os.environ[k] for k in ("DOUBAO_TTS_API_KEY","DOUBAO_TTS_RESOURCE_ID") if k in os.environ}; os.execve("/usr/bin/bwrap",["bwrap"]+a,e)',
        payload,
      );
      signal.throwIfAborted();
      // Do not kill systemd-run on abort: wait for the task cgroup to finish.
      const promise = this.exec('systemd-run', args, { env, timeout: 1900000 });
      this.running.set(runId, promise);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      const out = await promise;
      signal.throwIfAborted();
      return out;
    } finally {
      if (abortTimer) clearInterval(abortTimer);
      signal.removeEventListener('abort', abort);
      this.running.delete(runId);
      try {
        await this.stop(runId);
      } finally {
        this.busy.delete(runId);
        await rm(payload, { force: true });
      }
    }
  }
  async preflight() {
    if (process.platform !== 'linux') throw new Error('Host Worker requires Ubuntu/Linux');
    await this.exec('systemctl', ['--user', 'show-environment'], { timeout: 10000 });
    for (const p of ['/usr/bin/bwrap', this.config.hostBrowser, this.config.python])
      await access(p);
    for (const relative of admittedToolkit) {
      const p = path.join(this.config.toolkitRoot, relative);
      if ((await realpath(p)) !== p)
        throw new Error(`Admitted toolkit path must not be a symlink: ${relative}`);
    }
  }
}
