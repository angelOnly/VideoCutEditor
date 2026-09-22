/** 不启动模型或 Worker：真实文件代理负测，协议输送使用显式测试桩。 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { command } from '../src/infrastructure/process.js';
import { writeJson } from '../src/infrastructure/files.js';
const { values } = parseArgs({ options: { output: { type: 'string' } } });
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const start = Date.now();
let report: Record<string, unknown>;
try {
  const output = await command(
    process.execPath,
    [
      '--import',
      'tsx',
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern=章节',
      'tests/chapters.test.ts',
    ],
    { cwd, timeout: 60000 },
  );
  report = {
    passed: true,
    at: new Date().toISOString(),
    elapsedSeconds: (Date.now() - start) / 1000,
    runtime: process.version,
    platform: process.platform,
    scope:
      '实际磁盘文件代理：路径越界、符号链接、无命令/TTS工具、旧租约、父取消、确认范围与真实文件摘要、重启拒绝旧执行。',
    limitations:
      'RPC 是测试桩，不调用模型、不启动生产 Worker；不是 app-server 权限配置或 Linux cgroup 的真实验收。',
    output,
  };
} catch (e: any) {
  report = {
    passed: false,
    at: new Date().toISOString(),
    elapsedSeconds: (Date.now() - start) / 1000,
    error: e.message,
    output: e.stdout ?? '',
  };
  process.exitCode = 1;
}
if (values.output) await writeJson(path.resolve(values.output), report);
console.log(JSON.stringify(report, null, 2));
