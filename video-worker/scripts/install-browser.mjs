import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const service = fileURLToPath(new URL('../', import.meta.url));
const template = path.resolve(service, '../claude-code-video-toolkit/templates/ifeng-scenes');
process.chdir(template);
const templateRequire = createRequire(path.join(template, 'package.json'));
const cliRequire = createRequire(templateRequire.resolve('@remotion/cli/package.json'));
const { ensureBrowser } = await import(
  pathToFileURL(cliRequire.resolve('@remotion/renderer')).href
);
const browser = await ensureBrowser({ logLevel: 'error' });
if (!('path' in browser)) throw new Error('Remotion browser is unavailable');
await writeFile(
  path.join(service, 'config/host-runtime.json'),
  JSON.stringify({ browser: browser.path }, null, 2) + '\n',
);
console.log('Pinned Remotion browser prepared.');
