/** 独立输入入口：直接连接 Codex 原生工具，不启动 Worker、队列或制作修复器。 */
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { AppServer } from '../src/infrastructure/app-server.js';
import { threadConfig } from '../src/runner/codex-host.js';
import { readJson, writeJson, safeFile } from '../src/infrastructure/files.js';
import {
  finalReference,
  finalReferenceSchema,
  matchIdentity,
} from '../src/contracts/pipeline-io.js';
import { prompt } from '../src/runner/prompts.js';
import type { Config } from '../src/config.js';
import { productionSkill } from '../src/infrastructure/production-plugin.js';
const { values: v } = parseArgs({
  options: Object.fromEntries(
    ['request', 'python', 'modules', 'browser', 'codex', 'model', 'effort', 'plugin'].map((k) => [
      k,
      { type: 'string' as const },
    ]),
  ),
});
if (!v.request || !v.python || !v.browser || !v.codex || !v.plugin)
  throw Error(
    '需要 --request task.json --python 路径 --browser 路径 --codex 路径 --plugin 已安装插件路径；可选 --modules --model --effort',
  );
const file = await realpath(v.request),
  root = path.resolve(file, '../../..');
const task = { ...(await readJson(file)), entryFile: path.relative(root, file) };
if (task.protocol !== 'video-pipeline-io/1')
  throw Error('独立入口只接受 video-pipeline-io/1，不回退旧动态工具');
const config = {
  // 保留虚拟环境入口，否则解析符号链接后会丢失其 site-packages。
  python: path.resolve(v.python),
  toolkitRoot: await realpath(path.resolve('../claude-code-video-toolkit')),
  pluginRoot: await realpath(v.plugin),
  pluginSha256: (await readJson(path.resolve('config/plugin-release.json'))).sha256,
  renderModules: await realpath(
    v.modules ?? path.resolve('../claude-code-video-toolkit/templates/ifeng-scenes/node_modules'),
  ),
  hostBrowser: await realpath(v.browser),
  codexPath: await realpath(v.codex),
  codexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  ttsVoice:
    process.env.TTS_VOICE || process.env.DOUBAO_TTS_SPEAKER || 'zh_female_xiaohe_uranus_bigtts',
  ttsVoices: process.env.TTS_VOICES ? JSON.parse(process.env.TTS_VOICES) : {},
  ttsResourceId: process.env.DOUBAO_TTS_RESOURCE_ID || 'seed-tts-2.0',
  codexReasoningEffort: v.effort,
} as Config;
for (const dir of ['project', 'work', 'output', 'cache'])
  await mkdir(path.join(root, dir), { recursive: true });
const lock = path.join(root, 'work/local-controller.lock');
await mkdir(lock); // 保守互斥，异常退出后需核实旧进程再清理锁。
const rpc = new AppServer();
let threadId: string | undefined,
  turnId: string | undefined,
  ended = false,
  final = '';
let resolve!: () => void, reject!: (error: Error) => void;
const done = new Promise<void>((a, b) => {
  resolve = a;
  reject = b;
});
void done.catch(() => {});
const interrupt = () => {
  if (threadId && turnId) void rpc.request('turn/interrupt', { threadId, turnId }).catch(reject);
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
rpc.on('fatal', reject);
rpc.on('notification', (method, p) => {
  if (p.threadId !== threadId) return;
  const id = p.turnId ?? p.turn?.id;
  if (method === 'turn/started' && !turnId) turnId = id;
  if (!turnId || id !== turnId) return;
  if (method === 'item/completed' && p.item?.type === 'agentMessage') final = p.item.text;
  if (method === 'turn/completed') {
    ended = true;
    p.turn.status === 'completed' ? resolve() : reject(Error('Codex 执行未完成'));
  }
});
try {
  const configuration = threadConfig(config, { root, task } as any);
  if (v.modules) configuration.permissions.videocut.filesystem[await realpath(v.modules)] = 'read';
  await rpc.start(config, undefined, configuration);
  const plugin = await productionSkill(rpc, config, root, task.stage);
  const sessionFile = path.join(root, 'work/local-session.json');
  let previous: any;
  try {
    previous = await readJson(sessionFile);
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (previous && previous.taskId !== task.taskId) throw Error('会话不属于当前任务');
  const args = {
    cwd: root,
    runtimeWorkspaceRoots: [root],
    permissions: 'videocut',
    approvalPolicy: 'never',
    config: configuration,
    ...(v.model ? { model: v.model } : {}),
  };
  const started = await rpc.request(previous ? 'thread/resume' : 'thread/start', {
    ...args,
    ...(previous ? { threadId: previous.threadId } : {}),
  });
  if (started.activePermissionProfile?.id !== 'videocut') throw Error('未应用任务权限配置');
  threadId = started.thread.id;
  await writeJson(sessionFile, { taskId: task.taskId, threadId });
  const turn = await rpc.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: prompt(task, root, config.pluginRoot) }, ...plugin.inputs],
    outputSchema: finalReferenceSchema,
    ...(v.effort ? { effort: v.effort } : {}),
  });
  if (turnId && turnId !== turn.turn.id) throw Error('执行身份不符');
  turnId = turn.turn.id;
  await done;
  const reference = finalReference.parse(JSON.parse(final));
  matchIdentity(reference, task);
  if (reference.resultFile !== task.resultFile) throw Error('结果引用不是当前消息');
  await safeFile(root, reference.resultFile);
  console.log(JSON.stringify(reference));
} finally {
  if (!ended) interrupt();
  await rpc.close();
  await rm(lock, { recursive: true });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
