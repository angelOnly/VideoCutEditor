import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { database, config, tenant, analysis, scene } from './helpers.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Tasks } from '../src/application/tasks.js';
import { Queue } from '../src/infrastructure/queue.js';
import { Storage } from '../src/infrastructure/storage.js';
import { publishResult } from '../src/application/results.js';
import { prepareAudio } from '../src/infrastructure/audio.js';

test('paid TTS is cached by content and voice; uncertain requests are never automatically repeated', async () => {
  const db = await database(),
    temp = await mkdtemp(path.join(os.tmpdir(), 'videocut-audio-'));
  const oldKey = process.env.DOUBAO_TTS_API_KEY;
  process.env.DOUBAO_TTS_API_KEY = 'test-only';
  try {
    const c = config({ dataRoot: temp }),
      tasks = new Tasks(new TaskRepository(db), c),
      q = new Queue(db);
    await tasks.analysis(tenant, analysis());
    const a = (await q.claim('test'))!;
    await publishResult(q, new Storage(c), a, { assets: [] } as any, tenant, {
      dataList: [scene()],
    });
    await tasks.render(tenant, {
      schemaVersion: 2,
      taskId: 'task1',
      requestId: 'render1',
      basePlanVersion: 1,
      field_5: 'account1',
      templateId: 'finance_vertical_v1',
      dataList: [scene()],
    });
    const l = (await q.claim('test'))!;
    const root = path.join(temp, 'working');
    await mkdir(path.join(root, 'input'), { recursive: true });
    const w: any = {
      root,
      task: { renderSelection: { sceneIds: ['scene_001'] } },
      taskConfig: {
        narration: null,
        tts: { provider: 'doubao', voiceId: 'voice-a', resourceId: 'seed-tts-2.0' },
      },
    };
    let calls = 0,
      uncertain = false;
    const sandbox: any = {
      tool: async (_l: any, _w: any, argv: string[], _s: any, cache: string) => {
        if (argv[0] === 'ffprobe') return JSON.stringify({ format: { duration: 1 } });
        calls++;
        if (uncertain) throw Error('response lost');
        await writeFile(
          path.join(cache, path.basename(argv[argv.length - 1])),
          'synthetic ledger fixture, not media',
        );
        return '';
      },
    };
    await prepareAudio(c, q, l, w, new AbortController().signal, sandbox);
    // A fresh attempt directory simulates recovery; cached audio is copied, not charged again.
    w.root = path.join(temp, 'again');
    await prepareAudio(c, q, l, w, new AbortController().signal, sandbox);
    assert.equal(calls, 1);
    w.taskConfig.tts.voiceId = 'voice-b';
    w.root = path.join(temp, 'voice-change');
    await prepareAudio(c, q, l, w, new AbortController().signal, sandbox);
    assert.equal(calls, 2);
    uncertain = true;
    w.taskConfig.tts.voiceId = 'voice-c';
    w.root = path.join(temp, 'uncertain');
    await assert.rejects(prepareAudio(c, q, l, w, new AbortController().signal, sandbox), {
      code: 'EXTERNAL_RESULT_UNKNOWN',
    });
    w.root = path.join(temp, 'retry-uncertain');
    await assert.rejects(prepareAudio(c, q, l, w, new AbortController().signal, sandbox), {
      code: 'EXTERNAL_RESULT_UNKNOWN',
    });
    assert.equal(calls, 3);
  } finally {
    if (oldKey === undefined) delete process.env.DOUBAO_TTS_API_KEY;
    else process.env.DOUBAO_TTS_API_KEY = oldKey;
    await db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
