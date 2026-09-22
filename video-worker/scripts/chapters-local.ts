/** 真实章节会话验收驱动：复用正式章节核心，不启动数据库或 Worker。 */
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { appendFile, mkdir, rmdir } from 'node:fs/promises';
import { AppServer } from '../src/infrastructure/app-server.js';
import { Chapters } from '../src/runner/chapters.js';
import { readJson, writeJson } from '../src/infrastructure/files.js';
import type { Config } from '../src/config.js';
const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    codex: { type: 'string' },
    model: { type: 'string' },
    effort: { type: 'string' },
    chapter: { type: 'string' },
  },
});
if (!values.root || !values.codex) throw Error('需要 --root 独立任务根 --codex 可执行路径');
const root = path.resolve(values.root),
  request = await readJson(path.join(root, 'render/render_001/request.json'));
const evidence = path.join(root, 'evidence');
await mkdir(evidence, { recursive: true });
const stamp = Date.now(),
  log = path.join(evidence, `chapter-runtime-${stamp}.jsonl`);
const rpc = new AppServer(),
  abort = new AbortController();
const config = {
  codexPath: path.resolve(values.codex),
  codexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  codexModel: values.model ?? 'gpt-6-astra',
  codexReasoningEffort: values.effort ?? 'medium',
} as Config;
const control = path.join(root, '.control');
await mkdir(control, { recursive: true });
const lock = path.join(control, 'chapters-local.lock');
await mkdir(lock);
const budgetPath = path.join(control, 'chapters-local-budget.json');
let prior = 0;
try {
  prior = (await readJson(budgetPath)).elapsedSeconds;
} catch (e: any) {
  if (e.code !== 'ENOENT') throw e;
}
let started = Date.now(),
  manager: Chapters | undefined;
let writes = Promise.resolve();
function record(value: any) {
  writes = writes.then(() =>
    appendFile(log, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'),
  );
}
process.on('SIGTERM', () => abort.abort());
process.on('SIGINT', () => abort.abort());
const ids: any[] = [];
try {
  await rpc.start(config);
  manager = new Chapters(rpc, config, {
    root,
    runId: request.runId,
    token: `local-${stamp}`,
    signal: abort.signal,
    check: async () => {
      if (prior + (Date.now() - started) / 1000 > Math.min(1800, request.limits.executionSeconds))
        throw Error('章节父墙钟预算耗尽');
    },
  });
  rpc.handleRequest = async (method, p) => {
    record({
      kind: 'tool-request',
      method,
      threadId: p.threadId,
      turnId: p.turnId,
      tool: p.tool,
      operation: p.arguments?.operation,
      path: p.arguments?.path,
    });
    const result = await manager!.handleRequest(method, p);
    record({ kind: 'tool-result', threadId: p.threadId, success: result.success });
    return result;
  };
  rpc.on('notification', (method, p) => {
    if (['turn/started', 'turn/completed', 'thread/tokenUsage/updated'].includes(method))
      record({ kind: 'notification', method, ...p });
  });
  const chosen = values.chapter ? [values.chapter] : ['chapter_01', 'chapter_02', 'chapter_03'];
  for (const chapterId of chosen) {
    const result = await manager.operate({
      operation: 'dispatch',
      chapterId,
      brief: `render/${request.runId}/chapters/${chapterId}/brief.json`,
    });
    ids.push(result);
    record({ kind: 'dispatch', chapterId, ...result });
    console.log(JSON.stringify({ chapterId, ...result }));
  }
  while (true) {
    const statuses = await Promise.all(
      ids.map((x) => manager!.operate({ operation: 'status', executionId: x.executionId })),
    );
    await writeJson(path.join(evidence, `chapter-status-${stamp}.json`), {
      model: config.codexModel,
      effort: config.codexReasoningEffort,
      wallSeconds: (Date.now() - started) / 1000,
      statuses,
    });
    if (statuses.some((x) => /usage.limit|quota|用量/i.test(x.error ?? ''))) {
      abort.abort();
      throw Error('账户额度已耗尽，停止其他章节模型调用');
    }
    if (statuses.every((x) => ['candidate', 'failed', 'cancelled'].includes(x.status))) {
      console.log(
        JSON.stringify(
          statuses.map((x) => ({
            chapterId: x.chapterId,
            status: x.status,
            error: x.error,
            workspace: x.workspace,
          })),
        ),
      );
      if (statuses.some((x) => x.status !== 'candidate')) process.exitCode = 1;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
} catch (e) {
  record({ kind: 'failure', error: String(e) });
  console.error(String(e));
  process.exitCode = 1;
} finally {
  try {
    await manager?.close();
  } finally {
    await rpc.close();
    await writes;
    await writeJson(budgetPath, {
      elapsedSeconds: prior + (Date.now() - started) / 1000,
      limitSeconds: Math.min(1800, request.limits.executionSeconds),
    });
    await rmdir(lock);
  }
}
