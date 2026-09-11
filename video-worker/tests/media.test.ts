import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { database, config, tenant, analysis, scene } from './helpers.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Queue } from '../src/infrastructure/queue.js';
import { executeRun } from '../src/application/execute-run.js';
import { command } from '../src/infrastructure/process.js';
import { readJson, writeJson } from '../src/infrastructure/files.js';
import type { Sandbox } from '../src/infrastructure/sandbox.js';
import type { Lease } from '../src/domain/task.js';
import type { Workspace } from '../src/infrastructure/workspace.js';

test(
  'real media: analysis → five MP4s → edit only scene 3 → full five-item callback',
  { skip: process.env.RUN_MEDIA_TESTS !== '1', timeout: 240000 },
  async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'videocut-media-')),
      db = await database();
    const media = path.join(temp, 'media'),
      data = path.join(temp, 'data');
    await mkdir(path.join(media, 'input'), { recursive: true });
    const t = { ...tenant, inputRoot: media, exportRoot: media };
    const c = config({ mediaRoot: media, dataRoot: data, tenants: [t] });
    const root = c.toolkitRoot;
    try {
      await command('ffmpeg', [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '2.5',
        path.join(media, 'input/narration.wav'),
      ]);
      const repo = new TaskRepository(db),
        tasks = new Tasks(repo, c),
        queue = new Queue(db);
      const counts: number[] = [];
      const list: any[] = Array.from({ length: 5 }, (_, i) => ({
        ...scene('scene_00' + (i + 1), `第${i + 1}句。`),
        dur: 0.5,
        narrationStartTime: i * 0.5,
        narrationEndTime: (i + 1) * 0.5,
      }));
      await command('ffmpeg', [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x240:rate=10',
        '-t',
        '2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        path.join(media, 'input/source.mp4'),
      ]);
      for (const [name, color] of [
        ['chart', 'green'],
        ['replacement', 'orange'],
      ])
        await command('ffmpeg', [
          '-nostdin',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `color=c=${color}:s=320x240`,
          '-frames:v',
          '1',
          path.join(media, `input/${name}.png`),
        ]);
      for (const [i, item] of list.entries())
        item.extraData.videoInfoList = [
          {
            assetId: 'video',
            url: path.join(media, 'input/source.mp4'),
            dur: 2,
            sourceStartTime: 0,
            sourceEndTime: i === 0 ? 0.2 : 1,
            startTime: 0,
            endTime: 0.5,
            role: 'content',
            order: 0,
          },
        ];
      list[2].extraData.videoInfoList = [];
      list[2].extraData.picInfoList = [
        {
          assetId: 'chart',
          url: path.join(media, 'input/chart.png'),
          w: 320,
          h: 240,
          startTime: 0,
          endTime: 0.5,
          role: 'content',
          order: 0,
        },
      ];
      const apiInput = {
        ...analysis(),
        otherMaterial: {
          picInfoList: [{ assetId: 'chart', url: path.join(media, 'input/chart.png') }],
          videoInfoList: [{ assetId: 'video', url: path.join(media, 'input/source.mp4') }],
        },
        script: list.map((s) => s.content).join(''),
        narration: { assetId: 'voice', url: path.join(media, 'input/narration.wav') },
      };
      const candidate = async (w: Workspace) =>
        writeJson(path.join(w.root, 'output/agent-response.json'), {
          jobId: w.task.jobId,
          status: 'candidate',
          operation: w.task.operation,
          artifact:
            w.task.operation === 'analysis'
              ? 'output/analysis-plan.json'
              : 'output/render-manifest.json',
          error: null,
        });
      // Deterministic test-only agent. Media and validators are the actual production tools.
      const sandbox: Sandbox = {
        async stop() {},
        async run(l, w, signal) {
          if (l.run.stage === 'analysis') {
            await writeJson(path.join(w.root, 'output/voice-evidence.json'), { testFixture: true });
            await writeJson(path.join(w.root, 'output/analysis-plan.json'), {
              schemaVersion: 2,
              jobId: l.run.id,
              dataList: list,
              materialUnderstanding: ['voice', 'chart', 'video'].map((assetId) => ({
                assetId,
                summary: 'Synthetic test fixture; no semantic model test',
                evidence: ['output/voice-evidence.json'],
              })),
            });
          } else {
            counts.push(w.task.renderSelection.sceneIds.length);
            const args = [path.join(root, 'tools/render_segments.py'), '--job-dir', w.root];
            if (process.env.REMOTION_BROWSER_EXECUTABLE)
              args.push('--browser-executable', process.env.REMOTION_BROWSER_EXECUTABLE);
            await command(c.python, args, { cwd: root, signal, timeout: 180000 });
            await writeJson(path.join(w.root, 'output/quality-review.json'), {
              jobId: l.run.id,
              passed: true,
              sceneIds: w.task.renderSelection.sceneIds,
              notes: 'Test fixture, no model perceptual claim',
            });
          }
          await candidate(w);
        },
        async validate(l, w, signal) {
          return JSON.parse(
            await command(
              c.python,
              [
                path.join(
                  root,
                  '.agents/skills/video-pipeline/scripts',
                  l.run.stage === 'analysis' ? 'validate_analysis.py' : 'validate_segments.py',
                ),
                '--job-dir',
                w.root,
              ],
              { cwd: root, signal },
            ),
          );
        },
        async tool(l, w, argv, signal) {
          return command(
            argv[0],
            argv.slice(1).map((s) => s.replace('/workspace/job', w.root)),
            { signal },
          );
        },
      };
      const a = await tasks.analysis(t, apiInput);
      await executeRun(c, queue, sandbox, (await queue.claim('local-test'))!);
      let view = await repo.query(t.id, 'task1');
      assert.equal(view.taskState, 'awaiting_editor', JSON.stringify(view.latestRun));
      const request = {
        schemaVersion: 2,
        taskId: 'task1',
        requestId: 'r1',
        basePlanVersion: view.planVersion,
        field_5: 'account1',
        templateId: 'finance_vertical_v1',
        dataList: view.plan.dataList,
      };
      await tasks.render(t, request);
      await executeRun(c, queue, sandbox, (await queue.claim('local-test'))!);
      view = await repo.query(t.id, 'task1');
      assert.equal(view.taskState, 'ready', JSON.stringify(view.latestRun));
      assert.equal(view.latestResult.length, 5);
      const before = view.latestResult.map((s: any) => s.url);
      for (const file of before) assert.ok(file.startsWith(media + '/tasks/'));
      const edited = structuredClone(request.dataList);
      edited[2].extraData.keywordList = ['修改花字'];
      edited[2].extraData.picInfoList[0].assetId = 'replacement';
      edited[2].extraData.picInfoList[0].url = path.join(media, 'input/replacement.png');
      await tasks.render(t, {
        ...request,
        requestId: 'r2',
        basePlanVersion: view.planVersion,
        dataList: edited,
      });
      await executeRun(c, queue, sandbox, (await queue.claim('local-test'))!);
      view = await repo.query(t.id, 'task1');
      assert.equal(view.taskState, 'ready', JSON.stringify(view.latestRun));
      assert.deepEqual(counts, [5, 1]);
      const after = view.latestResult.map((s: any) => s.url);
      for (let i = 0; i < 5; i++) assert.equal(before[i] === after[i], i !== 2);
      const event = (
        await db.query('SELECT payload FROM callback_events WHERE run_id=$1', [
          view.latestRun.runId,
        ])
      ).rows[0].payload;
      assert.equal(event.dataList.length, 5);
      assert.equal(event.dataInfo.sceneCount, 5);
      assert.equal(event.dataList[0].id, 'scene_001');
      assert.equal(
        (await db.query('SELECT * FROM execution_slots WHERE run_id IS NOT NULL')).rows.length,
        0,
      );
    } finally {
      await db.close();
      if (process.env.KEEP_MEDIA_FIXTURE === '1') console.log('MEDIA_FIXTURE=' + temp);
      else await rm(temp, { recursive: true, force: true });
    }
  },
);
