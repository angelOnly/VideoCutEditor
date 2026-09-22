import { Workspaces } from '../src/infrastructure/workspace.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, config, tenant, analysis } from './helpers.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Queue } from '../src/infrastructure/queue.js';
import { publishResult } from '../src/application/results.js';
import { Storage } from '../src/infrastructure/storage.js';
import { normalizeAnalysis } from '../src/domain/storyboard.js';
import { confirmedPlan } from '../src/infrastructure/stage-workspace.js';

test('省略与空 plan、增删重排均形成服务端确认版本，元数据不能锁定旧场景', async () => {
  const db = await database(),
    c = config(),
    repo = new TaskRepository(db),
    tasks = new Tasks(repo, c),
    q = new Queue(db);
  try {
    await tasks.analysis(tenant, analysis());
    const a = (await q.claim('test'))!;
    const plan = normalizeAnalysis(
      { status: 'candidate', scenes: [{ text: '第一句。' }, { text: '第二句。' }], error: null },
      analysis().script,
      a.run.task_id,
      'a'.repeat(64),
    );
    await publishResult(
      q,
      new Storage(c),
      a,
      { root: '', assets: [], task: {}, taskConfig: {}, hashes: {}, reuse: [], sceneHashes: {} },
      tenant,
      plan,
    );
    const base = {
      schemaVersion: 2,
      taskId: 'task1',
      templateId: 'finance_vertical_v1',
      field_5: '',
    };
    const dataList = [
      { id: 'scene_002', content: '编辑第二句。' },
      { id: 'added', content: '新句。' },
    ];
    const r = await tasks.render(tenant, {
      ...base,
      requestId: 'one',
      basePlanVersion: 1,
      dataList,
    });
    const l = (await q.claim('test'))!;
    const stored = await confirmedPlan(db, l);
    assert.deepEqual(
      stored.scenes.map((s: any) => [s.id, s.text]),
      dataList.map((s) => [s.id, s.content]),
    );
    assert.equal(l.run.input.plan, undefined);
    const changedConfig = config({ runtimeVersion: 'changed-runtime' });
    await assert.rejects(
      new Workspaces(changedConfig, db, new Storage(changedConfig)).prepare(l, tenant),
      { code: 'PIPELINE_REVISION_EXPIRED' },
    );
    await q.failed(l, { code: 'TEST', message: '测试', retryable: false });
    const again = await tasks.render(tenant, {
      ...base,
      requestId: 'two',
      basePlanVersion: 2,
      dataList,
      plan: {},
    });
    assert.equal(again.data.planVersion, 3);
    await repo.cancel(tenant.id, again.data.runId);
    await assert.rejects(
      tasks.render(tenant, {
        ...base,
        requestId: 'wrong',
        basePlanVersion: 3,
        dataList,
        plan: { taskId: 'wrong' },
      }),
      { code: 'CONFIG_CONFLICT' },
    );
    await tasks.render(tenant, {
      ...base,
      requestId: 'three',
      basePlanVersion: 3,
      dataList,
      plan: { taskId: a.run.task_id, inputDigest: plan.inputDigest, scenes: [] },
    });
    const view = await repo.query(tenant.id, 'task1');
    assert.deepEqual(view.plan?.plan, {});
    assert.equal(JSON.stringify(view).includes('sourceMapping'), false);
    const duplicate = await tasks.render(tenant, {
      ...base,
      requestId: 'one',
      basePlanVersion: 1,
      dataList,
    });
    assert.equal(duplicate.data.runId, r.data.runId);
  } finally {
    await db.close();
  }
});

test('旧待执行版本明确拒绝，迁移按顺序且可重复运行', async () => {
  const db = await database(),
    repo = new TaskRepository(db),
    tasks = new Tasks(repo, config()),
    q = new Queue(db);
  try {
    await tasks.analysis(tenant, analysis());
    const l = (await q.claim('test'))!;
    const changedConfig = config({ runtimeVersion: 'changed-runtime' });
    await assert.rejects(
      new Workspaces(changedConfig, db, new Storage(changedConfig)).prepare(l, tenant),
      { code: 'PIPELINE_REVISION_EXPIRED' },
    );
    await q.failed(l, { code: 'TEST', message: '测试', retryable: false });
    await db.query("UPDATE tasks SET config=config-'pipelineRevision',plan_version=1 WHERE id=$1", [
      l.run.task_id,
    ]);
    await assert.rejects(
      tasks.render(tenant, {
        schemaVersion: 2,
        taskId: 'task1',
        requestId: 'render',
        basePlanVersion: 1,
        field_5: '',
        templateId: 'finance_vertical_v1',
        dataList: [{ id: 's', content: '测试。' }],
      }),
      { code: 'PIPELINE_REVISION_EXPIRED' },
    );
    const cols = (
      await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='host_executions' AND column_name='last_progress_at'",
      )
    ).rows;
    assert.equal(cols.length, 1);
  } finally {
    await db.close();
  }
});
