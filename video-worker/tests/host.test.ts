import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { config, database, analysis, tenant } from './helpers.js';
import {
  AppServer,
  codexEnvironment,
  codexOverrides,
  type Rpc,
} from '../src/infrastructure/app-server.js';
import { HostProcesses, bubblewrapArgs, jobUnit } from '../src/infrastructure/host-processes.js';
import { HostCodex, threadConfig } from '../src/runner/codex-host.js';
import { Workspaces } from '../src/infrastructure/workspace.js';
import { Storage } from '../src/infrastructure/storage.js';
import { Queue } from '../src/infrastructure/queue.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { prompt } from '../src/runner/prompts.js';

test('动态工具保留执行宿主，同时关闭内置命令和外部工具', () => {
  const features = codexOverrides.features as Record<string, boolean>;
  assert.equal(features.code_mode_host, true);
  for (const name of ['shell_tool', 'unified_exec', 'apps', 'plugins'])
    assert.equal(features[name], false);
  assert.deepEqual(codexOverrides.mcp_servers, {});
});

class FakeRpc extends EventEmitter implements Rpc {
  healthy = true;
  handleRequest?: (method: string, params: any) => Promise<any>;
  turns = new Map<string, string>();
  calls: any[] = [];
  complete(threadId: string, status = 'completed') {
    const turnId = this.turns.get(threadId)!;
    this.emit('notification', 'item/completed', {
      threadId,
      turnId,
      item: {
        type: 'agentMessage',
        text: JSON.stringify({ status: 'candidate', marker: threadId }),
      },
    });
    this.emit('notification', 'turn/completed', { threadId, turn: { id: turnId, status } });
  }
  async request(method: string, params: any) {
    this.calls.push({ method, params });
    if (method === 'thread/start' || method === 'thread/resume')
      return {
        thread: { id: params.threadId ?? randomUUID() },
        activePermissionProfile: { id: 'videocut' },
      };
    if (method === 'turn/start') {
      const id = randomUUID();
      this.turns.set(params.threadId, id);
      // Notifications can precede the RPC response.
      this.emit('notification', 'turn/started', { threadId: params.threadId, turn: { id } });
      return { turn: { id } };
    }
    if (method === 'turn/interrupt') {
      this.complete(params.threadId, 'interrupted');
      return {};
    }
    throw new Error('Unexpected RPC method');
  }
}
async function until(fn: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await setTimeout(10);
  }
  throw new Error('Timed out waiting for test condition');
}

test('host namespace hides shared roots, login and env; trusted tools alone may use network', () => {
  const c = config({ executor: 'host', python: '/opt/python/bin/python3' });
  const w: any = { root: '/jobs/task-a' };
  const args = bubblewrapArgs(c, w, ['bash'], 'agent');
  assert.ok(args.includes('--unshare-all'));
  assert.ok(args.includes('--proc'));
  assert.ok(!args.includes('--share-net'));
  assert.ok(!args.includes(c.codexHome));
  assert.ok(!args.includes(c.mediaRoot));
  assert.ok(!args.includes('/var/run/docker.sock'));
  assert.ok(!args.includes(path.dirname(c.toolkitRoot)));
  assert.equal(args[args.indexOf(w.root) - 1], '--ro-bind');
  assert.ok(args.includes(path.join(w.root, 'output')));
  const readonly = bubblewrapArgs(c, w, ['python3'], 'validate');
  assert.ok(!readonly.includes('--bind'));
  const env = codexEnvironment(c);
  assert.deepEqual(Object.keys(env).sort(), [
    'CODEX_HOME',
    'DBUS_SESSION_BUS_ADDRESS',
    'HOME',
    'LANG',
    'PATH',
    'USER',
    'XDG_RUNTIME_DIR',
  ]);
  const policy: any = threadConfig(c, w);
  assert.equal(policy.permissions.videocut.filesystem[w.root], 'read');
  assert.equal(policy.permissions.videocut.filesystem[path.join(w.root, 'render', 'run-a')], undefined);
  assert.equal(policy.features.shell_tool, false);
  assert.equal(policy.features.plugins, false);
  assert.ok(!prompt({ operation: 'render' }, w.root, c.toolkitRoot).includes('${job}'));
});

test('两阶段渲染只授权当前 run 的 render 目录写入', () => {
  const c = config({ executor: 'host' });
  const root = '/jobs/task-a';
  const policy: any = threadConfig(c, {
    root,
    task: {
      contractVersion: 'video-two-stage/1',
      stage: 'render',
      runId: '0af7a560-79fb-49f2-8789-9ebda42d9981',
    },
  } as any);
  const files = policy.permissions.videocut.filesystem;
  assert.equal(files[path.join(root, 'render', '0af7a560-79fb-49f2-8789-9ebda42d9981')], 'write');
  assert.equal(files[path.join(root, 'render')], undefined);
  assert.equal(files[path.join(root, 'render', 'another-run')], undefined);
});

test('native process completion is checked with systemd and stop failures propagate', async () => {
  const c = config({ executor: 'host', python: '/opt/python/bin/python3' });
  const calls: any[] = [];
  const exec: any = async (file: string, args: string[], opts: any) => {
    const payload =
      file === 'systemd-run' ? JSON.parse(await readFile(args.at(-1)!, 'utf8')) : null;
    calls.push({ file, args, opts, payload });
    return file === 'systemd-run' ? 'ok' : '';
  };
  const processes = new HostProcesses(c, exec),
    id = randomUUID();
  assert.equal(
    await processes.run(
      id,
      { root: '/jobs/a' } as any,
      ['/bin/bash', '-c', 'printf "%s" "$JOB_DIR"'],
      new AbortController().signal,
      'agent',
    ),
    'ok',
  );
  const run = calls.find((c) => c.file === 'systemd-run');
  assert.ok(run.args.includes('--property=KillMode=control-group'));
  assert.ok(run.payload.at(-1).includes('$JOB_DIR'));
  assert.ok(!run.args.join(' ').includes('$JOB_DIR'));
  assert.ok(run.args.includes(`--unit=${jobUnit(id)}`));
  assert.ok(!JSON.stringify(run.opts.env).includes('DATABASE_URL'));
  assert.ok(calls.some((c) => c.args.includes('--state=active,activating,deactivating')));
  const failing = new HostProcesses(c, async () => {
    throw new Error('manager unavailable');
  });
  await assert.rejects(failing.stop(id), /manager unavailable/);
});

test('four native Codex tasks route by thread/turn, persist identity, resume, and cancellation releases only after cleanup', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'host-routing-')),
    db = await database();
  const c = config({
      executor: 'host',
      dataRoot: dir,
      mediaRoot: dir,
      codexModel: 'gpt-6-astra',
      codexReasoningEffort: 'low',
    }),
    queue = new Queue(db);
  const tasks = new Tasks(new TaskRepository(db), c),
    workspace = new Workspaces(c, db, new Storage(c));
  const rpc = new FakeRpc(),
    commands: any[] = [],
    stopped: string[] = [];
  const processes: any = {
    run: async (id: string, w: any) => {
      commands.push({ id, root: w.root });
      return 'ok';
    },
    stop: async (id: string) => {
      stopped.push(id);
    },
  };
  const codex = new HostCodex(c, rpc, queue, processes);
  const running: Promise<void>[] = [];
  try {
    for (let i = 0; i < 5; i++) await tasks.analysis(tenant, analysis('task' + i));
    const leases = [];
    const ws = [];
    const aborts = [];
    for (let i = 0; i < 4; i++) {
      const lease = (await queue.claim('test-owner'))!;
      leases.push(lease);
      const w = await workspace.prepare(lease, tenant);
      ws.push(w);
      assert.equal(w.task.template.path, path.join(c.toolkitRoot, 'templates/ifeng-scenes'));
      await assert.rejects(readFile(path.join(w.root, 'codex-home/auth.json')));
      const abort = new AbortController();
      aborts.push(abort);
      const p = codex.run(lease, w, abort.signal);
      void p.catch(() => {});
      running.push(p);
    }
    assert.equal(await queue.claim('test-owner'), null);
    await until(
      async () =>
        (await db.query('SELECT * FROM host_executions WHERE turn_id IS NOT NULL')).rows.length ===
        4,
    );
    for (const call of rpc.calls.filter((x) => x.method === 'thread/start')) {
      assert.equal(call.params.model, 'gpt-6-astra');
      assert.equal(call.params.config.model_reasoning_effort, 'low');
    }
    for (const call of rpc.calls.filter((x) => x.method === 'turn/start'))
      assert.equal(call.params.effort, 'low');
    const contexts = (await db.query('SELECT * FROM host_executions')).rows;
    assert.equal(new Set(contexts.map((x) => x.thread_id)).size, 4);
    for (const ctx of contexts) {
      const result = await rpc.handleRequest!('item/tool/call', {
        threadId: ctx.thread_id,
        turnId: ctx.turn_id,
        tool: 'video_exec',
        arguments: { command: 'echo ok' },
      });
      assert.equal(result.success, true);
      assert.ok(commands.some((x) => x.id === ctx.run_id && x.root === ctx.workspace));
    }
    await assert.rejects(
      rpc.handleRequest!('item/tool/call', {
        threadId: contexts[0].thread_id,
        turnId: 'old-turn',
        tool: 'video_exec',
        arguments: { command: 'bad' },
      }),
      /Stale/,
    );
    // Cancelling one active run does not interrupt the other three.
    aborts[0].abort();
    await assert.rejects(running[0]);
    assert.ok(stopped.includes(leases[0].run.id));
    assert.equal(rpc.calls.filter((c) => c.method === 'turn/interrupt').length, 1);
    await queue.failed(leases[0], { code: 'CANCELLED', message: 'test' });
    assert.ok(await queue.claim('test-owner'));
    for (let i = 1; i < 4; i++) {
      const ctx = contexts.find((x) => x.run_id === leases[i].run.id)!;
      rpc.complete(ctx.thread_id);
      await running[i];
      const candidate = JSON.parse(
        await readFile(path.join(ws[i].root, 'output/agent-response.json'), 'utf8'),
      );
      assert.equal(candidate.marker, ctx.thread_id);
    }
    // A repair round resumes the persisted thread; output/session.json cannot choose another task.
    await writeFile(
      path.join(ws[1].root, 'output/session.json'),
      JSON.stringify({ threadId: 'attacker-thread' }),
    );
    const again = codex.run(leases[1], ws[1], new AbortController().signal);
    void again.catch(() => {});
    await until(() => rpc.calls.some((x) => x.method === 'thread/resume'));
    const resumed = rpc.calls.find((x) => x.method === 'thread/resume');
    assert.notEqual(resumed.params.threadId, 'attacker-thread');
    const previous = contexts.find((x) => x.run_id === leases[1].run.id)!;
    await until(() => rpc.turns.get(previous.thread_id) !== previous.turn_id);
    rpc.complete(previous.thread_id);
    await again;
  } finally {
    for (const thread of rpc.turns.keys()) rpc.complete(thread);
    await Promise.allSettled(running);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('阶段工具耗尽预算后中断当前 turn 并清理执行进程', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'host-budget-')),
    db = await database();
  const c = config({ executor: 'host', dataRoot: dir, mediaRoot: dir }),
    queue = new Queue(db);
  const tasks = new Tasks(new TaskRepository(db), c),
    rpc = new FakeRpc();
  const stopped: string[] = [];
  let running: Promise<void> | undefined;
  try {
    await tasks.analysis(tenant, analysis('budget-task'));
    const lease = (await queue.claim('test'))!;
    const w = await new Workspaces(c, db, new Storage(c)).prepare(lease, tenant);
    // 这里只测试执行器对阶段预算的处理，媒体工具由桩模拟。
    lease.run.stage = 'render';
    w.task = {
      ...w.task,
      contractVersion: 'video-two-stage/1',
      taskId: lease.run.task_id,
      runId: lease.run.id,
      stage: 'render',
    };
    const processes: any = {
      run: async () => {
        const folder = path.join(w.root, 'render', lease.run.id);
        await mkdir(folder, { recursive: true });
        await writeFile(
          path.join(folder, 'execution.json'),
          JSON.stringify({ stopReason: '同一媒体错误连续三次', repairRounds: 3 }),
        );
        // 即使命令以 0 退出或吞掉错误，预算仍必须执行。
        return 'failed';
      },
      stop: async (id: string) => {
        stopped.push(id);
      },
    };
    const host = new HostCodex(c, rpc, queue, processes);
    running = host.run(lease, w, new AbortController().signal);
    void running.catch(() => {});
    await until(async () =>
      Boolean(
        (await db.query('SELECT turn_id FROM host_executions WHERE run_id=$1', [lease.run.id]))
          .rows[0]?.turn_id,
      ),
    );
    const ctx = (await db.query('SELECT * FROM host_executions WHERE run_id=$1', [lease.run.id]))
      .rows[0];
    await rpc.handleRequest!('item/tool/call', {
      threadId: ctx.thread_id,
      turnId: ctx.turn_id,
      tool: 'video_exec',
      arguments: { command: 'render' },
    });
    await assert.rejects(running, /同一媒体错误连续三次/);
    assert.ok(rpc.calls.some((x) => x.method === 'turn/interrupt'));
    assert.ok(stopped.includes(lease.run.id));
    // 此处不提前释放队列名额，由外层在确认进程清理后更新终态。
    assert.equal(
      (
        await db.query('SELECT count(*)::int n FROM execution_slots WHERE run_id=$1', [
          lease.run.id,
        ])
      ).rows[0].n,
      1,
    );
  } finally {
    for (const thread of rpc.turns.keys()) rpc.complete(thread);
    await Promise.allSettled(running ? [running] : []);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('app-server stdio initializes once, checks ChatGPT login and rejects in-flight requests when server exits', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'host-rpc-'));
  const executable = path.join(dir, 'codex');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const r=require('readline').createInterface({input:process.stdin});
r.on('line',line=>{const m=JSON.parse(line); if(!m.id)return;
if(m.method==='die')process.exit(0);
if(m.method==='hang')return;
const result=m.method==='account/read'?{account:{type:'chatgpt'}}:{ok:true};
process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');});`,
    { mode: 0o700 },
  );
  const server = new AppServer();
  try {
    await server.start(config({ codexPath: executable, codexHome: dir }));
    const pending = server.request('hang', {});
    void pending.catch(() => {});
    await assert.rejects(server.request('die', {}), /CLOSED/);
    await assert.rejects(pending, /CLOSED/);
    assert.equal(server.healthy, false);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
