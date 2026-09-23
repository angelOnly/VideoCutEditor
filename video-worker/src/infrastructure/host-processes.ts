import path from 'node:path';
import { access, realpath } from 'node:fs/promises';
import type { Config } from '../config.js';
import { command } from './process.js';

const unitPrefix = 'videocut-job-';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function jobUnit(runId: string) {
  if (!uuid.test(runId)) throw new Error('Invalid internal run ID');
  return `${unitPrefix}${runId}.service`;
}
// 原生权限只开放制作工具目录，不开放仓库根目录和登录凭据。
export const admittedToolkit = [
  '.agents/skills/video-pipeline',
  '.agents/skills/remotion-best-practices',
  '.agents/skills/ffmpeg',
  'templates/ifeng-scenes/node_modules',
  ...[
    'generate_dialogue_audio.py',
    'two_stage.py',
    'task_io.py',
    'stage_media.py',
    'actual_timeline.py',
    'finance_timeline.py',
    'stage_tts.py',
    'cached_tts.py',
    'render_scene.cjs',
    'render_batch.py',
    'config.py',
    'voiceover.py',
    'doubao_tts.py',
  ].map((f) => `tools/${f}`),
];
export class HostProcesses {
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
