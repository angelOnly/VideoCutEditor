import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { database, config, tenant, analysis, writable } from './helpers.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Queue } from '../src/infrastructure/queue.js';
import { Workspaces } from '../src/infrastructure/workspace.js';
import { Storage } from '../src/infrastructure/storage.js';
import { command } from '../src/infrastructure/process.js';
import { readJson } from '../src/infrastructure/files.js';
import { normalizeAnalysis } from '../src/domain/storyboard.js';
import { snapshotDigest, confirmedPlan } from '../src/infrastructure/stage-workspace.js';
import { publishResult } from '../src/application/results.js';
import { restoreProduction } from '../src/infrastructure/production-record.js';

test(
  '五句独立 MP4、私有工程持久保存、明确成功版本续编且旧产物不变',
  { skip: process.env.RUN_MEDIA_TESTS !== '1', timeout: 240000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pipeline-media-'));
    const db = await database();
    const c = config({ dataRoot: path.join(root, 'data'), mediaRoot: path.join(root, 'media') });
    const t = { ...tenant, inputRoot: c.mediaRoot, exportRoot: c.mediaRoot };
    const tasks = new Tasks(new TaskRepository(db), c),
      queue = new Queue(db),
      storage = new Storage(c);
    const work = new Workspaces(c, db, storage);
    try {
      const texts = Array.from({ length: 5 }, (_, i) => `第${i + 1}句。`);
      await tasks.analysis(t, { ...analysis(), script: texts.join('') });
      const a = (await queue.claim('test'))!,
        aw = await work.prepare(a, t);
      const plan = normalizeAnalysis(
        { status: 'candidate', scenes: texts.map((text) => ({ text })), error: null },
        texts.join(''),
        a.run.task_id,
        snapshotDigest(aw.task.snapshot),
      );
      await publishResult(queue, storage, a, aw, t, plan);
      const input = {
        schemaVersion: 2,
        taskId: 'task1',
        requestId: 'render1',
        basePlanVersion: 1,
        field_5: '',
        templateId: 'finance_vertical_v1',
        dataList: plan.scenes.map((s) => ({ id: s.id, content: s.text })),
      };
      await tasks.render(t, input);
      const r = (await queue.claim('test'))!,
        w = await work.prepare(r, t);
      await command(
        process.env.STAGE_TEST_PYTHON ?? c.python,
        [
          new URL('./stage-media-fixture.py', import.meta.url).pathname,
          path.join(c.toolkitRoot, 'tools'),
          path.join(w.root, `render/${r.run.id}/request.json`),
        ],
        { timeout: 120000, env: process.env },
      );
      const candidate = await readJson(path.join(w.root, 'output/manifest.json'));
      const out = await command(
        process.env.STAGE_TEST_PYTHON ?? c.python,
        [
          path.join(c.toolkitRoot, 'tools/worker_stage.py'),
          'check',
          '--request',
          path.join(w.root, `render/${r.run.id}/request.json`),
          '--artifact',
          'output/manifest.json',
        ],
        { timeout: 120000, env: process.env },
      );
      assert.equal(JSON.parse(out).passed, true, out);
      const result = await publishResult(queue, storage, r, w, t, candidate);
      assert.equal(result.dataList.length, 5);
      const before = await Promise.all(result.dataList.map((s) => readFile(s.url)));
      assert.ok(result.dataList.every((s) => s.extraData.resources.length === 0));
      const saved = (await db.query('SELECT result FROM run_results WHERE run_id=$1', [r.run.id]))
        .rows[0].result;
      assert.ok(saved.productionRecord.files['project/fixture.ts']);
      await tasks.render(t, {
        ...input,
        requestId: 'render2',
        basePlanVersion: 2,
        plan: {},
        dataList: input.dataList.map((s, i) =>
          i === 2 ? { ...s, production: { description: '改变画面' } } : s,
        ),
      });
      const next = (await queue.claim('test'))!,
        nw = await work.prepare(next, t);
      await assert.rejects(restoreProduction(c, db, next, nw, r.run.id, 99), {
        code: 'PRODUCTION_RESTORE_UNAVAILABLE',
      });
      await assert.rejects(
        restoreProduction(
          c,
          db,
          next,
          { ...nw, taskConfig: { ...nw.taskConfig, hostFingerprint: '不同宿主工具版本' } },
          r.run.id,
          1,
        ),
        {
          code: 'PRODUCTION_RESTORE_UNAVAILABLE',
        },
      );
      const restored = await restoreProduction(c, db, next, nw, r.run.id, 1);
      assert.equal(restored.unchangedTextSceneIds.length, 5);
      await writeFile(path.join(nw.root, 'project/fixture.ts'), '// 修改新 run 工程\n');
      assert.match(await readFile(path.join(w.root, 'project/fixture.ts'), 'utf8'), /合成媒体/);
      assert.equal((await confirmedPlan(db, next)).scenes.length, 5);
      for (let i = 0; i < before.length; i++)
        assert.deepEqual(await readFile(result.dataList[i].url), before[i]);
    } finally {
      await db.close();
      await writable(root);
      await rm(root, { recursive: true, force: true });
    }
  },
);
