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
const marketplaces = JSON.parse(
  await command(config.codexPath, ['plugin', 'marketplace', 'list', '--json'], { env }),
);
const previous = marketplaces.marketplaces.find((item) => item.name === 'videocut-internal');
const previousSource = previous?.marketplaceSource;
// 同名市场切换到新版本目录前先解除注册，旧版本目录保留用于回退。
if (previous && previousSource?.source !== destination) {
  if (previousSource?.sourceType !== 'local') throw Error('内部插件市场不是本地来源，无法自动切换');
  await command(config.codexPath, ['plugin', 'marketplace', 'remove', 'videocut-internal', '--json'], { env });
}
try {
  await command(config.codexPath, ['plugin', 'marketplace', 'add', destination, '--json'], { env });
} catch (error) {
  if (previousSource?.sourceType === 'local' && previousSource.source !== destination) {
    await command(config.codexPath, ['plugin', 'marketplace', 'add', previousSource.source, '--json'], { env });
  }
  throw error;
}
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
