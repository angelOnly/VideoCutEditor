import { access, realpath } from 'node:fs/promises';
import type { Config } from '../config.js';
import { command } from './process.js';
import { productionRoot, verifyProductionPlugin } from './production-plugin.js';

const unitPrefix = 'videocut-job-';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function jobUnit(runId: string) {
  if (!uuid.test(runId)) throw new Error('Invalid internal run ID');
  return `${unitPrefix}${runId}.service`;
}
// 原生权限只开放制作工具目录，不开放仓库根目录和登录凭据。
export const productionPaths = (config: Config) => [productionRoot(config), config.renderModules];
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
    await verifyProductionPlugin(this.config);
    for (const p of productionPaths(this.config)) {
      if ((await realpath(p)) !== p) throw new Error(`制作目录必须使用真实路径：${p}`);
    }
  }
}
