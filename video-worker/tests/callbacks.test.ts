import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { database, config, tenant, analysis } from './helpers.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { CallbackOutbox } from '../src/infrastructure/callback-outbox.js';

test('callback retries preserve payload/event ID and require HTTP + business success', async () => {
  const db = await database();
  try {
    const repo = new TaskRepository(db),
      tasks = new Tasks(repo, config());
    const run = await tasks.analysis(tenant, analysis());
    await repo.cancel(tenant.id, run.data.runId);
    const bodies: string[] = [];
    let count = 0;
    const transport = (async (url: any, options: any) => {
      bodies.push(options.body);
      const timestamp = options.headers['x-callback-timestamp'];
      assert.equal(
        options.headers['x-callback-signature'],
        createHmac('sha256', tenant.callbackSecret)
          .update(timestamp + '.' + options.body)
          .digest('hex'),
      );
      return new Response(JSON.stringify({ status: 0 }), { status: ++count === 1 ? 503 : 200 });
    }) as typeof fetch;
    const box = new CallbackOutbox(db, [tenant], transport);
    assert.equal(await box.sendOne(), true);
    assert.equal((await db.query('SELECT state FROM callback_events')).rows[0].state, 'retrying');
    await db.query('UPDATE callback_events SET next_attempt_at=now()');
    await box.sendOne();
    assert.equal(bodies[0], bodies[1]);
    assert.equal(await box.sendOne(), false);
    assert.equal((await db.query('SELECT state FROM callback_events')).rows[0].state, 'delivered');
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM runs')).rows[0].n), 1);
  } finally {
    await db.close();
  }
});
test('nonretryable callback failures enter dead letter; tenant-scoped manual resend', async () => {
  const db = await database();
  try {
    const repo = new TaskRepository(db),
      tasks = new Tasks(repo, config()),
      r = await tasks.analysis(tenant, analysis());
    await repo.cancel(tenant.id, r.data.runId);
    const box = new CallbackOutbox(
      db,
      [tenant],
      (async () => new Response('{}', { status: 401 })) as typeof fetch,
    );
    await box.sendOne();
    const event = (await db.query('SELECT * FROM callback_events')).rows[0];
    assert.equal(event.state, 'dead_letter');
    assert.equal(await box.retry('other', event.id), null);
    assert.ok(await box.retry(tenant.id, event.id));
    assert.equal((await db.query('SELECT state FROM callback_events')).rows[0].state, 'pending');
  } finally {
    await db.close();
  }
});
