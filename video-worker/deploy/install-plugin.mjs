// 在部署阶段安装固定插件；运行任务不执行安装或更新。
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { packagePlugin } from '../scripts/package-plugin.mjs';
import { loadConfig } from '../dist/config.js';
import { command } from '../dist/infrastructure/process.js';
import { verifyProductionPlugin } from '../dist/infrastructure/production-plugin.js';
import { writeJson } from '../dist/infrastructure/files.js';

const service = fileURLToPath(new URL('../', import.meta.url));
const config = loadConfig();
const destination = path.resolve(
  process.argv[2] ?? path.join(service, '../.local-data/plugins', config.pluginSha256),
);
const packagedRoot = path.join(destination, 'plugins/videocut-production');
await mkdir(path.dirname(destination), { recursive: true });
if (!existsSync(destination)) await packagePlugin(destination);
await verifyProductionPlugin({ ...config, pluginRoot: packagedRoot });
const env = { ...process.env, CODEX_HOME: config.codexHome };
await command(config.codexPath, ['plugin', 'marketplace', 'add', destination, '--json'], { env });
const installed = JSON.parse(
  await command(
    config.codexPath,
    ['plugin', 'add', 'videocut-production@videocut-internal', '--json'],
    { env },
  ),
);
if (!installed.installedPath) throw Error('Codex 未返回插件安装位置');
const checked = await verifyProductionPlugin({ ...config, pluginRoot: installed.installedPath });
await writeJson(path.join(service, 'config/installed-plugin.json'), checked);
console.log(JSON.stringify(checked));
