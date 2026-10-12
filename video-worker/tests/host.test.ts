import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { config, database, analysis, tenant, writable, pluginSkills } from './helpers.js';
import {
  AppServer,
  codexEnvironment,
  codexOverrides,
  taskLimits,
  type Rpc,
} from '../src/infrastructure/app-server.js';
import { HostCodex, threadConfig } from '../src/runner/codex-host.js';
import { prompt } from '../src/runner/prompts.js';
import { Workspaces } from '../src/infrastructure/workspace.js';
import { Storage } from '../src/infrastructure/storage.js';
import { Queue } from '../src/infrastructure/queue.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { readJson } from '../src/infrastructure/files.js';
class FakeRpc extends EventEmitter implements Rpc {
  healthy = true;
  calls: any[] = [];
  handleRequest?: Rpc['handleRequest'];
  turn = 0;
  async request(method: string, params: any): Promise<any> {
    this.calls.push({ method, params });
    if (method === 'skills/list') return pluginSkills(params.cwds[0]);
    if (method.startsWith('thread/'))
      return { thread: { id: 'thread' }, activePermissionProfile: { id: 'videocut' } };
    if (method === 'turn/start') {
      const id = 'turn-' + ++this.turn;
      this.emit('notification', 'turn/started', { threadId: 'thread', turn: { id } });
      return { turn: { id } };
    }
    if (method === 'turn/interrupt') {
      this.emit('notification', 'turn/completed', {
        threadId: 'thread',
        turn: { id: params.turnId, status: 'interrupted' },
      });
    }
    return {};
  }
  event(method: string, turnId: string, item: any) {
    this.emit('notification', method, { threadId: 'thread', turnId, item });
  }
  complete(turnId: string) {
    this.emit('notification', 'turn/completed', {
      threadId: 'thread',
      turn: { id: turnId, status: 'completed' },
    });
  }
  fail(turnId: string, error: any) {
    this.emit('notification', 'turn/completed', {
      threadId: 'thread',
      turn: { id: turnId, status: 'failed', error },
    });
  }
}
async function until(fn: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await setTimeout(10);
  }
  throw Error('等待超时');
}
test('原生命令和看图可用，文件限定任务和只读工具，环境无数据库凭据', () => {
  const c = config({ python: '/opt/venv/bin/python3' }),
    w: any = { root: '/tmp/task', task: { stage: 'render' } };
  const features = codexOverrides.features as any;
  for (const key of ['shell_tool', 'unified_exec', 'view_image']) assert.equal(features[key], true);
  const profile = threadConfig(c, w).permissions.videocut;
  assert.equal(profile.filesystem[w.root], 'write');
  assert.equal(profile.filesystem[path.join(w.root, 'input')], 'read');
  assert.equal(profile.filesystem['/'], undefined);
  assert.equal(profile.filesystem[path.dirname(c.toolkitRoot)], undefined);
  const env = codexEnvironment(c);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.POSTGRES_PASSWORD, undefined);
  assert.equal(env.IFENG_CALLBACK_SECRET, undefined);
  assert.equal(env.VIDEOCUT_RENDER_SANDBOX, process.platform === 'darwin' ? 'seatbelt' : 'bwrap');
  assert.equal(env.VIDEOCUT_FRAME_CONCURRENCY, '1');
  assert.equal(codexEnvironment({...c, frameConcurrency: 2}).VIDEOCUT_FRAME_CONCURRENCY, '2');
  assert.equal(env.VIDEOCUT_RENDER_SLOTS, '5');
  assert.equal(env.VIDEOCUT_PYTHON, '/opt/venv/bin/python3');
});
test('Analysis 与 Render 使用独立的 systemd 资源档位', () => {
  const c = config({
    hostAnalysisMemory: '3G',
    hostAnalysisCpus: 2,
    hostAnalysisTasksMax: 300,
    hostRenderMemory: '16G',
    hostRenderCpus: 11,
    hostRenderTasksMax: 1536,
  });
  assert.deepEqual(taskLimits(c, 'analysis'), { memory: '3G', cpus: 2, tasksMax: 300 });
  assert.deepEqual(taskLimits(c, 'render'), { memory: '16G', cpus: 11, tasksMax: 1536 });
});
test('Render 提示禁止将批量渲染转入后台', () => {
  const value = prompt({ stage: 'render', entryFile: 'input/task.json' });
  assert.match(value, /严禁使用 nohup、&、disown 或 setsid/);
  assert.match(value, /必须以前台命令执行并等待正常退出/);
});
test('仅收当前 turn 最终回复，接受原生事件、复用 thread，取消先确认停止', async () => {
  const db = await database(),
    dir = await mkdtemp(path.join(os.tmpdir(), 'host-native-'));
  const c = config({ dataRoot: path.join(dir, 'data'), mediaRoot: path.join(dir, 'media') }),
    rpc = new FakeRpc(),
    queue = new Queue(db),
    repo = new TaskRepository(db),
    tasks = new Tasks(repo, c);
  const stopped: string[] = [];
  const host = new HostCodex(c, rpc, queue, {
    stop: async (id: string) => {
      stopped.push(id);
    },
  } as any);
  let running: Promise<void> | undefined;
  try {
    await tasks.analysis(tenant, analysis());
    const l = (await queue.claim('w'))!,
      w = await new Workspaces(c, db, new Storage(c)).prepare(l, tenant);
    running = host.run(l, w, new AbortController().signal);
    void running.catch(() => {});
    await until(() => rpc.turn === 1);
    rpc.event('item/started', 'turn-1', { type: 'commandExecution', id: 'cmd' });
    rpc.event('item/completed', 'old', { type: 'agentMessage', text: '旧输出' });
    const reference = {
      protocol: w.task.protocol,
      taskId: w.task.taskId,
      requestId: w.task.requestId,
      stage: w.task.stage,
      resultFile: w.task.resultFile,
    };
    rpc.event('item/completed', 'turn-1', {
      type: 'agentMessage',
      text: JSON.stringify(reference),
    });
    rpc.complete('turn-1');
    await running;
    assert.deepEqual(
      await readJson(path.join(w.root, `output/${l.run.id}/agent-response.json`)),
      reference,
    );
    assert.equal(rpc.calls.find((x) => x.method === 'thread/start').params.dynamicTools, undefined);
    const skillInput = rpc.calls.find((x) => x.method === 'turn/start').params.input[1];
    assert.equal(skillInput.name, 'videocut-production:video-pipeline');
    assert.ok(skillInput.path.startsWith(c.pluginRoot!));
    assert.equal(threadConfig(c, w).permissions.videocut.filesystem[c.toolkitRoot], undefined);
    await assert.rejects(rpc.handleRequest!('item/tool/call', { tool: 'video_exec' }));
    const abort = new AbortController();
    running = host.run(
      { ...l, run: { ...l.run, stage: 'render' } },
      { ...w, task: { ...w.task, stage: 'render' } },
      abort.signal,
    );
    void running.catch(() => {});
    await until(() => rpc.turn === 2);
    assert.deepEqual(
      rpc.calls
        .filter((x) => x.method === 'turn/start')[1]
        .params.input.filter((item: any) => item.type === 'skill')
        .map((item: any) => item.name),
      [
        'videocut-production:video-pipeline',
        'videocut-production:directing-motion-art',
        'videocut-production:motion-design-production',
      ],
    );
    abort.abort();
    await assert.rejects(running, { code: 'CANCELLED' });
    assert.ok(
      rpc.calls.some((x) => x.method === 'thread/resume' && x.params.threadId === 'thread'),
    );
    assert.ok(rpc.calls.some((x) => x.method === 'turn/interrupt'));
    assert.ok(stopped.includes(l.run.id));
  } finally {
    rpc.complete('turn-' + rpc.turn);
    await Promise.allSettled(running ? [running] : []);
    await db.close();
    await writable(dir);
    await rm(dir, { recursive: true, force: true });
  }
});
test('模型容量不足保留原始诊断，只有未启动工具的回合可重试', async () => {
  const db = await database(),
    dir = await mkdtemp(path.join(os.tmpdir(), 'host-capacity-'));
  const c = config({ dataRoot: path.join(dir, 'data'), mediaRoot: path.join(dir, 'media') }),
    rpc = new FakeRpc(),
    queue = new Queue(db),
    repo = new TaskRepository(db),
    tasks = new Tasks(repo, c);
  const host = new HostCodex(c, rpc, queue, { stop: async () => {} } as any);
  let running: Promise<void> | undefined;
  const capacityError = {
    codex_error_info: 'server_overloaded',
    message: 'Selected model is at capacity. Please try a different model.',
  };
  try {
    await tasks.analysis(tenant, analysis());
    const l = (await queue.claim('w'))!,
      w = await new Workspaces(c, db, new Storage(c)).prepare(l, tenant);
    running = host.run(l, w, new AbortController().signal);
    void running.catch(() => {});
    await until(() => rpc.turn === 1);
    rpc.fail('turn-1', capacityError);
    await assert.rejects(running, (error: any) => {
      assert.equal(error.code, 'CODEX_MODEL_OVERLOADED');
      assert.equal(error.retryable, true);
      assert.deepEqual(error.details, {
        turnStatus: 'failed',
        providerCode: 'server_overloaded',
        providerMessage: capacityError.message,
        lastTool: null,
      });
      return true;
    });
    running = host.run(l, w, new AbortController().signal);
    void running.catch(() => {});
    await until(() => rpc.turn === 2);
    rpc.event('item/started', 'turn-2', { type: 'commandExecution', id: 'cmd-1' });
    rpc.fail('turn-2', capacityError);
    await assert.rejects(running, (error: any) => {
      assert.equal(error.code, 'CODEX_MODEL_OVERLOADED');
      assert.equal(error.retryable, false);
      assert.deepEqual(error.details.lastTool, { type: 'commandExecution', id: 'cmd-1' });
      return true;
    });
  } finally {
    await Promise.allSettled(running ? [running] : []);
    await db.close();
    await writable(dir);
    await rm(dir, { recursive: true, force: true });
  }
});
test('app-server 退出拒绝未决请求，连接初始化核对登录', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'host-rpc-')),
    executable = path.join(dir, 'codex');
  await writeFile(
    executable,
    `#!${process.execPath}\nconst r=require('readline').createInterface({input:process.stdin});r.on('line',line=>{const m=JSON.parse(line);if(!m.id)return;if(m.method==='die')process.exit(0);if(m.method==='hang')return;console.log(JSON.stringify({id:m.id,result:m.method==='account/read'?{account:{type:'chatgpt'}}:{ok:true}}));});`,
    { mode: 0o700 },
  );
  const server = new AppServer();
  try {
    await server.start(config({ codexPath: executable, codexHome: dir }));
    const pending = server.request('hang', {});
    void pending.catch(() => {});
    await assert.rejects(server.request('die', {}), /CLOSED/);
    await assert.rejects(pending, /CLOSED/);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
