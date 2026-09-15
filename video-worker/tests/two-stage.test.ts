import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { database, config, tenant, analysis } from './helpers.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Queue } from '../src/infrastructure/queue.js';
import { Workspaces } from '../src/infrastructure/workspace.js';
import { Storage } from '../src/infrastructure/storage.js';
import { writeJson, readJson } from '../src/infrastructure/files.js';
import { snapshotDigest } from '../src/infrastructure/stage-workspace.js';
import { stagePath } from '../src/contracts/two-stage.js';
import { publishResult } from '../src/application/results.js';
import { command } from '../src/infrastructure/process.js';
import { bubblewrapArgs } from '../src/infrastructure/host-processes.js';
import { validate } from '../src/infrastructure/validation.js';

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worker-stages-'));
  const db = await database();
  const c = config({
    executor: 'host',
    executionProtocol: 'video-two-stage/1',
    dataRoot: path.join(root, 'data'),
    mediaRoot: path.join(root, 'media'),
  });
  const t = { ...tenant, inputRoot: c.mediaRoot, exportRoot: c.mediaRoot };
  c.tenants = [t];
  const q = new Queue(db),
    repo = new TaskRepository(db),
    tasks = new Tasks(repo, c),
    storage = new Storage(c),
    workspaces = new Workspaces(c, db, storage);
  return {
    root,
    db,
    c,
    t,
    q,
    repo,
    tasks,
    storage,
    workspaces,
    close: async () => {
      await db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
function plan(w: any) {
  return {
    contractVersion: 'video-two-stage/1',
    taskId: w.task.taskId,
    inputDigest: snapshotDigest(w.task.snapshot),
    scenes: ['第一句。', '第二句。'].map((text, i) => ({
      id: `s${i}`,
      text,
      sourceMapping: [{ start: i * 4, end: (i + 1) * 4, unit: 'unicode_codepoints' }],
      timing: {
        kind: 'estimated',
        speechSeconds: 1,
        totalSeconds: 1,
        totalRangeSeconds: [0.5, 2],
        basis: '未正式配音',
      },
      assetRefs: [],
      production: {
        speakers: ['male', 'female'],
        layout: { custom: '双主持人' },
        visualBlocks: [{ id: 'block' }],
      },
    })),
    nonspoken: [],
    previews: [],
    requirementsNotes: '仅参考当前模板',
  };
}
async function check(h: any, l: any, w: any, p: any) {
  await writeJson(path.join(w.root, 'analysis/plan.json'), p);
  await writeJson(path.join(w.root, 'output/agent-response.json'), {
    contractVersion: w.task.contractVersion,
    taskId: w.task.taskId,
    runId: l.run.id,
    stage: l.run.stage,
    status: 'candidate',
    artifact: 'analysis/plan.json',
    error: null,
  });
  const python = process.env.STAGE_TEST_PYTHON;
  if (!python) return;
  const sandbox: any = {
    validate: async () =>
      JSON.parse(
        await command(python, [
          path.join(h.c.toolkitRoot, 'tools/worker_stage.py'),
          'check',
          '--request',
          path.join(w.root, stagePath(w.task)),
          '--artifact',
          'analysis/plan.json',
        ]),
      ),
  };
  await validate(sandbox, l, w, new AbortController().signal);
}
test('两阶段请求、完整确认、模板冻结、数据库版本和估算回调往返', async () => {
  const h = await setup();
  try {
    await h.tasks.analysis(h.t, analysis());
    const l = (await h.q.claim('worker'))!;
    const w = await h.workspaces.prepare(l, h.t),
      p = plan(w);
    assert.equal(w.task.runId, l.run.id);
    assert.equal(w.task.taskId, l.run.task_id);
    assert.equal(w.task.renderSelection, undefined);
    assert.equal(w.task.tts, undefined);
    await check(h, l, w, p);
    await publishResult(h.q, h.storage, l, w, h.t, p);
    const status = await h.repo.query(h.t.id, 'task1');
    assert.equal(status.taskState, 'awaiting_editor');
    const event = (
      await h.db.query('SELECT payload FROM callback_events WHERE run_id=$1', [l.run.id])
    ).rows[0].payload;
    assert.equal(event.dataInfo.durationMode, 'estimated');
    assert.deepEqual(event.plan, p);
    await assert.rejects(
      h.tasks.render(h.t, {
        schemaVersion: 2,
        taskId: 'task1',
        requestId: 'bad',
        basePlanVersion: 1,
        field_5: 'account1',
        templateId: 'finance_vertical_v1',
        dataList: [],
      }),
      /./,
    );
    const edited = structuredClone(p);
    edited.scenes[0].production.layout.custom = '上下分区';
    await h.tasks.render(h.t, {
      schemaVersion: 2,
      taskId: 'task1',
      requestId: 'render',
      basePlanVersion: 1,
      field_5: 'account1',
      templateId: 'finance_vertical_v1',
      plan: edited,
      dataList: event.dataList.map((s: any, i: number) => ({
        ...s,
        production: edited.scenes[i].production,
      })),
    });
    const r = (await h.q.claim('worker'))!,
      rw = await h.workspaces.prepare(r, h.t);
    const confirmed = await readJson(path.join(rw.root, rw.task.confirmation.planFile));
    assert.equal(confirmed.scenes[0].production.layout.custom, '上下分区');
    assert.equal(
      await readFile(path.join(w.root, 'input/template.md'), 'utf8'),
      await readFile(path.join(rw.root, 'input/template.md'), 'utf8'),
    );
    if (process.env.STAGE_TEST_PYTHON) {
      const out = await command(process.env.STAGE_TEST_PYTHON, [
        '-c',
        `import sys;sys.path.insert(0,sys.argv[1]);from two_stage import load_request;load_request(sys.argv[2],'render');print('ok')`,
        path.join(h.c.toolkitRoot, 'tools'),
        path.join(rw.root, stagePath(rw.task)),
      ]);
      assert.equal(out.trim(), 'ok');
    }
    const args = bubblewrapArgs({ ...h.c, python: '/opt/venv/bin/python3' }, rw, ['bash'], 'agent');
    const request = path.join(rw.root, stagePath(rw.task));
    assert.equal(args[args.lastIndexOf(request) - 2], '--ro-bind');
    assert.ok(!args.includes('--share-net'));
    assert.ok(!args.includes(path.join(h.c.dataRoot, r.run.task_id, 'tool-cache')));
    assert.ok(
      !bubblewrapArgs(
        { ...h.c, python: '/opt/venv/bin/python3' },
        rw,
        ['bash'],
        'validate',
      ).includes('--bind'),
    );
    await h.repo.cancel(h.t.id, r.run.id);
    await assert.rejects(publishResult(h.q, h.storage, r, rw, h.t, { scenes: [] }), /./);
  } finally {
    await h.close();
  }
});

test('只读终检拒绝乱序与伪造输入；analysis 不生成配音文件', async () => {
  const h = await setup();
  try {
    await h.tasks.analysis(h.t, analysis());
    const l = (await h.q.claim('worker'))!,
      w = await h.workspaces.prepare(l, h.t);
    const p = plan(w);
    await check(h, l, w, p);
    if (process.env.STAGE_TEST_PYTHON) {
      p.scenes.reverse();
      await assert.rejects(check(h, l, w, p), /原稿|原文/);
    }
    await assert.rejects(readFile(path.join(w.root, 'input/audio-manifest.json')), {
      code: 'ENOENT',
    });
    const registry = await readJson(path.join(w.root, 'job.json'));
    assert.equal(Object.keys(registry.requests).length, 1);
  } finally {
    await h.close();
  }
});

test(
  '真实短媒体经过可信终检、N 分镜发布、生成资源扩展名及完整回调',
  { skip: !process.env.RUN_STAGE_MEDIA },
  async () => {
    const h = await setup();
    try {
      await h.tasks.analysis(h.t, analysis());
      const a = (await h.q.claim('worker'))!,
        aw = await h.workspaces.prepare(a, h.t),
        p = plan(aw);
      await check(h, a, aw, p);
      const analysisResult = await publishResult(h.q, h.storage, a, aw, h.t, p);
      await h.tasks.render(h.t, {
        schemaVersion: 2,
        taskId: 'task1',
        requestId: 'render',
        basePlanVersion: 1,
        field_5: 'account1',
        templateId: 'finance_vertical_v1',
        plan: p,
        dataList: analysisResult.dataList,
      });
      const l = (await h.q.claim('worker'))!,
        w = await h.workspaces.prepare(l, h.t),
        python = process.env.STAGE_TEST_PYTHON!;
      await command(
        python,
        [
          path.resolve('tests/stage-media-fixture.py'),
          path.join(h.c.toolkitRoot, 'tools'),
          path.join(w.root, stagePath(w.task)),
        ],
        { timeout: 60000, env: process.env },
      );
      await writeJson(path.join(w.root, 'output/agent-response.json'), {
        contractVersion: w.task.contractVersion,
        taskId: w.task.taskId,
        runId: l.run.id,
        stage: 'render',
        status: 'candidate',
        artifact: 'output/manifest.json',
        error: null,
      });
      const sandbox: any = {
        validate: async () =>
          JSON.parse(
            await command(
              python,
              [
                path.join(h.c.toolkitRoot, 'tools/worker_stage.py'),
                'check',
                '--request',
                path.join(w.root, stagePath(w.task)),
                '--artifact',
                'output/manifest.json',
              ],
              { timeout: 60000, env: process.env },
            ),
          ),
      };
      const candidate = await validate(sandbox, l, w, new AbortController().signal);
      const result = await publishResult(h.q, h.storage, l, w, h.t, candidate);
      assert.equal(result.dataList.length, 2);
      for (const s of result.dataList) {
        assert.ok(s.url.endsWith('.mp4'));
        assert.ok(s.extraData.resources[0].url.endsWith('.wav'));
        await readFile(s.url);
        await readFile(s.extraData.resources[0].url);
      }
      const events = (
        await h.db.query('SELECT payload FROM callback_events WHERE run_id=$1', [l.run.id])
      ).rows;
      assert.equal(events[0].payload.dataInfo.sceneCount, 2);
      assert.equal((await h.repo.query(h.t.id, 'task1')).taskState, 'ready');
    } finally {
      await h.close();
    }
  },
);

test('替换素材保持冻结模板和原稿，允许新素材并重新绑定可信摘要', async () => {
  const h = await setup();
  try {
    await mkdir(path.join(h.c.mediaRoot, 'input'), { recursive: true });
    const source = path.join(h.c.mediaRoot, 'input/new.png');
    await writeFile(source, 'current-test-image');
    await h.tasks.analysis(h.t, analysis());
    const a = (await h.q.claim('worker'))!,
      aw = await h.workspaces.prepare(a, h.t),
      p = plan(aw);
    await check(h, a, aw, p);
    const result = await publishResult(h.q, h.storage, a, aw, h.t, p);
    const edited = structuredClone(p);
    edited.scenes[0].assetRefs = ['new'];
    const dataList = result.dataList.map((s: any, i: number) => ({
      ...s,
      extraData: { ...s.extraData, picInfoList: i === 0 ? [{ assetId: 'new', url: source }] : [] },
    }));
    await h.tasks.render(h.t, {
      schemaVersion: 2,
      taskId: 'task1',
      requestId: 'replace',
      basePlanVersion: 1,
      field_5: 'account1',
      templateId: 'finance_vertical_v1',
      plan: edited,
      dataList,
    });
    const l = (await h.q.claim('worker'))!,
      w = await h.workspaces.prepare(l, h.t);
    const manifest = await readJson(path.join(w.root, 'input/assets.json'));
    assert.equal(manifest.assets[0].id, 'new');
    assert.equal(
      await readFile(path.join(w.root, manifest.assets[0].path), 'utf8'),
      'current-test-image',
    );
    if (process.env.STAGE_TEST_PYTHON)
      await command(process.env.STAGE_TEST_PYTHON, [
        '-c',
        `import sys;sys.path.insert(0,sys.argv[1]);from two_stage import load_request;load_request(sys.argv[2],'render')`,
        path.join(h.c.toolkitRoot, 'tools'),
        path.join(w.root, stagePath(w.task)),
      ]);
  } finally {
    await h.close();
  }
});

test('模板适配器支持动态正文；错误模板 ID 不进入执行', async () => {
  const { createServer } = await import('node:http');
  const { TemplateProvider } = await import('../src/infrastructure/template-provider.js');
  const server = createServer((req, res) => {
    const id = new URL(req.url!, 'http://localhost').searchParams.get('templateId');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: id === 'wrong' ? 'other' : id,
        version: '2',
        content: id === 'dialogue' ? '双主持人自由布局' : '地图与数据图解',
        attachments: [],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as any).port;
    const provider = new TemplateProvider(
      config({ templateApiUrl: `http://127.0.0.1:${port}/template` }),
    );
    assert.equal((await provider.read('dialogue')).content, '双主持人自由布局');
    assert.equal((await provider.read('map')).content, '地图与数据图解');
    await assert.rejects(provider.read('wrong'), { code: 'TEMPLATE_MISMATCH' });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

test('执行失败保留原因，身份不符仍拒绝', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worker-response-'));
  try {
    await mkdir(path.join(root, 'output'));
    const response = {
      contractVersion: 'video-two-stage/1',
      taskId: 'task',
      runId: 'run',
      stage: 'analysis',
      status: 'failed',
      artifact: null,
      error: { code: 'EXECUTION_HOST_DISABLED', message: '执行主机已禁用', retryable: true },
    };
    const w: any = { root, assets: [], task: { contractVersion: response.contractVersion } };
    const l: any = { run: { task_id: 'task', id: 'run', stage: 'analysis' } };
    await writeJson(path.join(root, 'output/agent-response.json'), response);
    await assert.rejects(
      validate({} as any, l, w, new AbortController().signal),
      /EXECUTION_HOST_DISABLED: 执行主机已禁用/,
    );
    await writeJson(path.join(root, 'output/agent-response.json'), {
      ...response,
      taskId: 'other',
    });
    await assert.rejects(
      validate({} as any, l, w, new AbortController().signal),
      /候选协议或执行身份不符/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
