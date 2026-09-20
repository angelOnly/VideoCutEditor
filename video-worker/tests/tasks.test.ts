import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, config, tenant, analysis, scene } from './helpers.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Queue } from '../src/infrastructure/queue.js';
import { publishResult } from '../src/application/results.js';
import { Storage } from '../src/infrastructure/storage.js';
import { createApi } from '../src/api/routes.js';
import { sceneHash } from '../src/domain/scene.js';

test('six tasks share four persistent slots; releases admit FIFO successors', async () => {
  const db = await database();
  try {
    const tasks = new Tasks(new TaskRepository(db), config()),
      q = new Queue(db);
    const submitted = [];
    for (let i = 0; i < 6; i++) submitted.push(await tasks.analysis(tenant, analysis('task' + i)));
    const leases = await Promise.all(Array.from({ length: 6 }, (_, i) => q.claim('owner' + i)));
    assert.equal(leases.filter(Boolean).length, 4);
    assert.equal(
      (await db.query('SELECT * FROM execution_slots WHERE run_id IS NOT NULL')).rows.length,
      4,
    );
    await q.failed(leases[0]!, { code: 'TEST', message: 'done', retryable: false });
    const next = await q.claim('owner6');
    assert.equal(next!.run.id, submitted[4].data.runId);
  } finally {
    await db.close();
  }
});
test('request idempotency, tenant ownership, active-run exclusion and stale versions', async () => {
  const db = await database();
  try {
    const c = config(),
      repo = new TaskRepository(db),
      tasks = new Tasks(repo, c),
      q = new Queue(db);
    const input = analysis();
    const [first, duplicate] = await Promise.all([
      tasks.analysis(tenant, input),
      tasks.analysis(tenant, input),
    ]);
    assert.equal(first.data.runId, duplicate.data.runId);
    await assert.rejects(tasks.analysis(tenant, { ...input, script: 'changed' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await assert.rejects(tasks.analysis(tenant, { ...input, requestId: 'different' }), {
      code: 'TASK_BUSY',
    });
    await assert.rejects(repo.query('other', input.taskId), { code: 'TASK_NOT_FOUND' });
    const l = (await q.claim('worker'))!;
    await publishResult(
      q,
      new Storage(c),
      l,
      { assets: [], taskConfig: {}, root: '', task: {}, hashes: {}, reuse: [], sceneHashes: {} },
      tenant,
      { dataList: [scene()] },
    );
    const view = await repo.query(tenant.id, input.taskId);
    assert.equal(view.taskState, 'awaiting_editor');
    assert.equal(view.planVersion, 1);
    assert.equal(view.callbackState, 'pending');
    assert.equal(
      (await db.query('SELECT * FROM execution_slots WHERE run_id IS NOT NULL')).rows.length,
      0,
    );
    const render = {
      schemaVersion: 2,
      taskId: input.taskId,
      requestId: 'render1',
      basePlanVersion: 1,
      field_5: 'account1',
      templateId: 'finance_vertical_v1',
      dataList: [scene()],
    };
    const accepted = await tasks.render(tenant, render);
    assert.equal(accepted.data.planVersion, 2);
    await repo.cancel(tenant.id, accepted.data.runId);
    await assert.rejects(tasks.render(tenant, { ...render, requestId: 'render2' }), {
      code: 'STALE_PLAN',
    });
    assert.equal((await repo.query(tenant.id, input.taskId)).planVersion, 2);
  } finally {
    await db.close();
  }
});
test('expired lease cannot publish; unconfirmed container stop retains occupied slot', async () => {
  const db = await database();
  try {
    const tasks = new Tasks(new TaskRepository(db), config()),
      q = new Queue(db);
    await tasks.analysis(tenant, analysis());
    const old = (await q.claim('old'))!;
    await db.query(
      "UPDATE execution_slots SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [old.slot],
    );
    await assert.rejects(q.heartbeat(old), { code: 'LEASE_LOST' });
    await assert.rejects(
      q.recover('new', async () => {
        throw Error('daemon down');
      }),
    );
    assert.equal(
      (await db.query('SELECT * FROM execution_slots WHERE run_id IS NOT NULL')).rows.length,
      1,
    );
    await db.query("UPDATE execution_slots SET lease_expires_at=now()-interval '1 second'");
    let stopped = 0;
    await q.recover('new', async () => {
      stopped++;
    });
    assert.equal(stopped, 1);
    const resumed = (await q.claim('new'))!;
    assert.equal(resumed.run.id, old.run.id);
    assert.equal(resumed.run.attempt, 2);
    assert.equal(new Date(resumed.run.deadline!).getTime(), new Date(old.run.deadline!).getTime());
    await assert.rejects(q.failed(old, { code: 'stale' }), { code: 'LEASE_LOST' });
  } finally {
    await db.close();
  }
});
test('cancelling prevents success, repair budget survives recovery', async () => {
  const db = await database();
  try {
    const repo = new TaskRepository(db),
      tasks = new Tasks(repo, config()),
      q = new Queue(db);
    await tasks.analysis(tenant, analysis());
    const l = (await q.claim('w'))!;
    assert.equal((await q.consumeRepair(l, 1)).repair_rounds, 1);
    await assert.rejects(q.consumeRepair(l, 1), { code: 'REPAIR_BUDGET_EXHAUSTED' });
    await repo.cancel(tenant.id, l.run.id);
    await assert.rejects(q.heartbeat(l), { code: 'CANCELLED' });
    await q.failed(l, { code: 'CANCELLED', message: 'cancelled', retryable: false });
    assert.equal((await repo.query(tenant.id, 'task1')).latestRun.state, 'cancelled');
  } finally {
    await db.close();
  }
});
test('HTTP authentication and malformed contracts are rejected before queue writes', async () => {
  const db = await database(),
    api = createApi(db, config());
  try {
    const route = '/narrate/ai_video_director/getAiVideoEditingAnalysisData';
    assert.equal(
      (await api.inject({ method: 'POST', url: route, payload: analysis() })).statusCode,
      401,
    );
    const headers = { authorization: 'Bearer ' + tenant.apiKey };
    assert.equal(
      (
        await api.inject({
          method: 'POST',
          url: route,
          headers,
          payload: { ...analysis(), script: '' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await api.inject({ method: 'POST', url: route, headers, payload: analysis() })).statusCode,
      202,
    );
    assert.equal(
      (
        await api.inject({
          method: 'POST',
          url: '/ai_video_director/getAiVideoEditingAnalysisData',
          headers,
          payload: analysis('old-route'),
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await api.inject({
          method: 'POST',
          url: '/narrate/ai_video_director/getAiVideoEditingData',
          headers,
          payload: {},
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await api.inject({
          method: 'POST',
          url: '/ai_video_director/getAiVideoEditingData',
          headers,
          payload: {},
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await api.inject({ url: '/ai_video_director/tasks/task1', headers })).json().data.latestRun
        .state,
      'queued',
    );
    assert.equal((await db.query('SELECT * FROM runs')).rows.length, 1);
  } finally {
    await api.close();
    await db.close();
  }
});
test('scene hashes invalidate text, source bytes and voice; ignore root paths', () => {
  const a = scene(),
    b = structuredClone(a);
  b.content = '修改口播';
  assert.notEqual(sceneHash(a, {}, {}), sceneHash(b, {}, {}));
  assert.notEqual(sceneHash(a, {}, { voice: 'a' }), sceneHash(a, {}, { voice: 'b' }));
});
