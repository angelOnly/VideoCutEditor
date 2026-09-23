import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { database, config, analysis, tenant, writable } from './helpers.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Queue } from '../src/infrastructure/queue.js';
import { Workspaces } from '../src/infrastructure/workspace.js';
import { Storage } from '../src/infrastructure/storage.js';
import { executeRun } from '../src/application/execute-run.js';
import { validate } from '../src/infrastructure/validation.js';
import { productionRecord } from '../src/infrastructure/production-record.js';
import { writeJson, readJson } from '../src/infrastructure/files.js';
import { replaceArtifactRefs, ioProtocol } from '../src/contracts/pipeline-io.js';
async function fixture() {
  const db = await database(),
    directory = await mkdtemp(path.join(os.tmpdir(), 'pipeline-io-'));
  const c = config({
    dataRoot: path.join(directory, 'data'),
    mediaRoot: path.join(directory, 'media'),
  });
  const queue = new Queue(db),
    repo = new TaskRepository(db);
  return {
    db,
    directory,
    c,
    queue,
    repo,
    tasks: new Tasks(repo, c),
    close: async () => {
      await db.close();
      await writable(directory);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
function outcome(w: any, status = 'completed'): any {
  return {
    protocol: ioProtocol,
    taskId: w.task.taskId,
    requestId: w.task.requestId,
    stage: w.task.stage,
    status,
    result:
      status === 'completed'
        ? { dataList: [{ id: 'a', content: '  原样文本。\n', dur: 123.456, custom: '保留' }] }
        : null,
    files: [],
    error: status === 'completed' ? null : { code: 'INPUT_NEEDED', message: '需要补充音色' },
  };
}
async function response(l: any, w: any, value: any) {
  await writeJson(path.join(w.root, w.task.resultFile), value);
  await writeJson(path.join(w.root, `output/${l.run.id}/agent-response.json`), {
    protocol: ioProtocol,
    taskId: w.task.taskId,
    requestId: w.task.requestId,
    stage: w.task.stage,
    resultFile: w.task.resultFile,
  });
}
function sandbox(onRun?: (l: any, w: any) => Promise<void>) {
  return {
    calls: 0,
    run: async function (l: any, w: any) {
      this.calls++;
      await onRun?.(l, w);
    },
    stop: async () => {},
    validate: async () => {
      throw Error('不得执行制作终检');
    },
    tool: async () => {
      throw Error('不得调用制作工具');
    },
  };
}
test('原始输入保真、稳定工程、同任务串行和无制作门禁交付', async () => {
  const f = await fixture();
  try {
    const body: any = analysis();
    delete body.outputSpec;
    delete body.narration;
    body.script = '  标点！？\n末尾  ';
    await f.tasks.analysis(tenant, body);
    const a = (await f.queue.claim('w'))!;
    await executeRun(
      f.c,
      f.queue,
      sandbox(async (l, w) => {
        assert.deepEqual(await readJson(path.join(w.root, w.task.requestFile)), body);
        await writeFile(path.join(w.root, 'project/keep'), '保留');
        await response(l, w, outcome(w));
      }),
      a,
    );
    const saved = await f.repo.query(tenant.id, body.taskId);
    assert.equal(saved.latestRun.state, 'succeeded');
    assert.equal(saved.plan.dataList[0].content, '  原样文本。\n');
    assert.equal(saved.plan.dataList[0].custom, '保留');
    const input = {
      schemaVersion: 2,
      taskId: body.taskId,
      requestId: 'r1',
      basePlanVersion: saved.planVersion,
      field_5: '',
      templateId: body.plugin.templateId,
      dataList: [{ id: 'a', content: '  确认  ', custom: 1 }],
    };
    await f.tasks.render(tenant, input);
    const r = (await f.queue.claim('w'))!;
    const next = await f.tasks.render(tenant, { ...input, requestId: 'r2' });
    assert.match(next.msg, /等待当前操作/);
    assert.equal(await f.queue.claim('other'), null);
    await executeRun(
      f.c,
      f.queue,
      sandbox(async (l, w) => {
        assert.equal(await readFile(path.join(w.root, 'project/keep'), 'utf8'), '保留');
        assert.deepEqual(await readJson(path.join(w.root, w.task.requestFile)), input);
        assert.deepEqual(
          await readJson(path.join(w.root, `input/message-${a.run.id}/request.json`)),
          body,
        );
        await writeFile(path.join(w.root, 'output/file.bin'), '不是视频也能交接');
        const result = outcome(w);
        result.files = [{ id: 'artifact', path: 'output/file.bin' }];
        result.result.dataList[0].artifactRef = 'artifact';
        await response(l, w, result);
      }),
      r,
    );
    const result = (await f.db.query('SELECT result FROM run_results WHERE run_id=$1', [r.run.id]))
      .rows[0].result;
    assert.match(result.result.dataList[0].url, /artifact.bin$/);
    assert.equal(result.result.dataList[0].artifactRef, undefined);
    assert.equal((await f.queue.claim('next'))!.run.id, next.data.runId);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM callback_events')).rows[0].n, 2);
  } finally {
    await f.close();
  }
});
test('拒绝旧回复、错配身份、目录逃逸和未知文件引用', async () => {
  const f = await fixture();
  try {
    await f.tasks.analysis(tenant, analysis());
    const l = (await f.queue.claim('w'))!;
    const w = await new Workspaces(f.c, f.db, new Storage(f.c)).prepare(l, tenant),
      s = sandbox(),
      signal = new AbortController().signal;
    await writeJson(path.join(w.root, 'output/agent-response.json'), outcome(w));
    await assert.rejects(validate(s, l, w, signal));
    await response(l, w, { ...outcome(w), requestId: 'old' });
    await assert.rejects(validate(s, l, w, signal), { code: 'RESULT_PROTOCOL_INVALID' });
    await writeFile(path.join(f.directory, 'secret'), 'outside');
    await symlink(path.join(f.directory, 'secret'), path.join(w.root, 'output/escape'));
    await response(l, w, { ...outcome(w), files: [{ id: 'f', path: 'output/escape' }] });
    await assert.rejects(validate(s, l, w, signal), { code: 'PATH_FORBIDDEN' });
    assert.throws(() => replaceArtifactRefs({ artifactRef: 'unknown' }, new Map()), {
      code: 'RESULT_PROTOCOL_INVALID',
    });
    await response(l, w, outcome(w));
    assert.deepEqual(await validate(s, l, w, signal), outcome(w));
  } finally {
    await f.close();
  }
});
test('交接后上传失败只重试传输，制作超时不阻断交付重试', async () => {
  const f = await fixture();
  try {
    await f.tasks.analysis(tenant, analysis());
    const l = (await f.queue.claim('w'))!;
    const s = sandbox(async (lease, w) => {
      await writeFile(path.join(w.root, 'output/file.bin'), '交接内容');
      const value = outcome(w);
      value.files = [{ id: 'f', path: 'output/file.bin' }];
      value.result.dataList[0].artifactRef = 'f';
      await response(lease, w, value);
    });
    await writeFile(f.c.mediaRoot, '存储不可用');
    await executeRun(f.c, f.queue, s, l);
    let run = (await f.db.query('SELECT * FROM runs WHERE id=$1', [l.run.id])).rows[0];
    assert.equal(run.progress_stage, 'delivery_retry');
    assert.ok(run.prepared.delivery);
    await rm(f.c.mediaRoot);
    await f.db.query(
      "UPDATE runs SET delivery_next_attempt_at=now(),deadline=now()-interval '1 second' WHERE id=$1",
      [l.run.id],
    );
    await executeRun(f.c, f.queue, s, (await f.queue.claim('w'))!);
    run = (await f.db.query('SELECT * FROM runs WHERE id=$1', [l.run.id])).rows[0];
    assert.equal(run.state, 'succeeded');
    assert.equal(s.calls, 1);
  } finally {
    await f.close();
  }
});
test('needs_input 持久保存并回调，交接副本不受后续工程写入影响', async () => {
  const f = await fixture();
  try {
    await f.tasks.analysis(tenant, analysis());
    const l = (await f.queue.claim('w'))!;
    await executeRun(
      f.c,
      f.queue,
      sandbox(async (lease, w) => response(lease, w, outcome(w, 'needs_input'))),
      l,
    );
    const q = await f.repo.query(tenant.id, 'task1');
    assert.equal(q.latestRun.state, 'needs_input');
    assert.equal(q.latestRun.error.message, '需要补充音色');
    const root = path.join(f.directory, 'workspace');
    await mkdir(root);
    await writeFile(path.join(root, 'file.txt'), 'one');
    const receipt = await productionRecord({ root } as any, l, {
      files: [{ id: 'one', path: 'file.txt' }],
    });
    await writeFile(path.join(root, 'file.txt'), 'two');
    assert.equal(await readFile(receipt.files[0].source, 'utf8'), 'one');
  } finally {
    await f.close();
  }
});
