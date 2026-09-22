import { writable } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { database, config, tenant, analysis } from './helpers.js';
import { Storage } from '../src/infrastructure/storage.js';
import { Workspaces } from '../src/infrastructure/workspace.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Queue } from '../src/infrastructure/queue.js';
import { hashFile } from '../src/infrastructure/files.js';

test('authorized roots reject traversal, cross-tenant links and container-only paths', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'videocut-paths-'));
  try {
    for (const d of ['input/one', 'input/two'])
      await mkdir(path.join(temp, d), { recursive: true });
    await writeFile(path.join(temp, 'input/one/a.jpg'), 'a');
    await writeFile(path.join(temp, 'input/two/b.jpg'), 'b');
    await symlink(path.join(temp, 'input/two/b.jpg'), path.join(temp, 'input/one/link.jpg'));
    const t = { ...tenant, inputRoot: temp, exportRoot: temp, allowedInputPrefixes: ['input/one'] };
    const store = new Storage(config({ mediaRoot: temp }));
    assert.ok((await store.input(t, temp + '/input/one/a.jpg')).file.endsWith('a.jpg'));
    await assert.rejects(store.input(t, temp + '/input/one/link.jpg'), { code: 'PATH_FORBIDDEN' });
    await assert.rejects(store.input(t, temp + '/input/one/../../secret'), {
      code: 'PATH_FORBIDDEN',
    });
    await assert.rejects(store.input(t, '/workspace/job/out.mp4'), { code: 'PATH_FORBIDDEN' });
  } finally {
    await writable(temp);
    await rm(temp, { recursive: true, force: true });
  }
});
test('recovered run reads frozen input, a new run detects changed source bytes', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'videocut-snapshot-')),
    db = await database();
  try {
    const media = path.join(temp, 'media'),
      data = path.join(temp, 'data');
    await mkdir(path.join(media, 'input'), { recursive: true });
    const source = path.join(media, 'input/a.jpg');
    await writeFile(source, 'first-version');
    const t = { ...tenant, inputRoot: media, exportRoot: media },
      c = config({ mediaRoot: media, dataRoot: data, tenants: [t] });
    const tasks = new Tasks(new TaskRepository(db), c),
      queue = new Queue(db),
      work = new Workspaces(c, db, new Storage(c));
    await tasks.analysis(t, {
      ...analysis(),
      otherMaterial: { picInfoList: [{ assetId: 'pic', url: source }], videoInfoList: [] },
    });
    const first = (await queue.claim('old'))!,
      w1 = await work.prepare(first, t);
    await writeFile(source, 'second-version');
    await db.query("UPDATE execution_slots SET lease_expires_at=now()-interval '1 second'");
    await queue.recover('new', async () => {});
    const second = (await queue.claim('new'))!,
      w2 = await work.prepare(second, t);
    assert.equal(w1.hashes.pic, w2.hashes.pic);
    assert.notEqual(w2.hashes.pic, await hashFile(source));
  } finally {
    await db.close();
    await writable(temp);
    await rm(temp, { recursive: true, force: true });
  }
});
