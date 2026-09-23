import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, config, tenant, analysis } from './helpers.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Queue } from '../src/infrastructure/queue.js';
import { publishResult } from '../src/application/results.js';
import { Storage } from '../src/infrastructure/storage.js';
test('完整确认列表原样保存，允许同任务新消息排队并保持幂等', async () => {
  const db = await database();
  try {
    const c = config(),
      repo = new TaskRepository(db),
      tasks = new Tasks(repo, c),
      q = new Queue(db);
    await tasks.analysis(tenant, analysis());
    const a = (await q.claim('w'))!;
    await publishResult(q, new Storage(c), a, {} as any, tenant, {
      outcome: {
        status: 'completed',
        result: { dataList: [{ id: 's', content: '原稿' }] },
        error: null,
      },
      files: [],
    });
    const dataList = [
      {
        id: 'new',
        content: '  修改后，保留标点！？  ',
        production: { custom: '要求' },
        custom: '扩展字段',
      },
    ];
    const body = {
      schemaVersion: 2,
      taskId: 'task1',
      requestId: 'one',
      templateId: 'finance_vertical_v1',
      field_5: '',
      basePlanVersion: 1,
      dataList,
    };
    const accepted = await tasks.render(tenant, body),
      again = await tasks.render(tenant, body);
    assert.equal(accepted.data.runId, again.data.runId);
    const l = (await q.claim('w'))!;
    assert.deepEqual(l.run.input, body);
    const row = (await db.query('SELECT plan FROM plan_versions WHERE run_id=$1', [l.run.id]))
      .rows[0].plan;
    assert.deepEqual(row.dataList, dataList);
    assert.deepEqual(row.plan, {});
    const next = await tasks.render(tenant, { ...body, requestId: 'two', plan: {} });
    assert.equal(next.data.state, 'queued');
    assert.equal(await q.claim('other'), null);
    await repo.cancel(tenant.id, next.data.runId);
    assert.equal(
      (await db.query('SELECT state FROM runs WHERE id=$1', [l.run.id])).rows[0].state,
      'running',
    );
  } finally {
    await db.close();
  }
});
test('旧协议任务只保留记录，不静默回退制作机制', async () => {
  const db = await database();
  try {
    const repo = new TaskRepository(db),
      tasks = new Tasks(repo, config());
    await tasks.analysis(tenant, analysis());
    await db.query(
      "UPDATE tasks SET config=jsonb_set(config,'{executionProtocol}','\"video-two-stage/1\"')",
    );
    await assert.rejects(tasks.analysis(tenant, analysis('task1', 'new')), {
      code: 'PIPELINE_REVISION_EXPIRED',
    });
  } finally {
    await db.close();
  }
});
