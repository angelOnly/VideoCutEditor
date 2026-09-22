import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashFile, readJson } from '../src/infrastructure/files.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRecovery } from '../src/application/render-recovery.js';
import {
  mediaArguments,
  recordMediaProgress,
  verifiedMediaProgress,
} from '../src/runner/media-tool.js';
import { bubblewrapArgs } from '../src/infrastructure/host-processes.js';
import { database, config, tenant, analysis } from './helpers.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Queue } from '../src/infrastructure/queue.js';

test('制作调整继续、共享问题接管，连续无进展有界停止', () => {
  const issue = { code: 'TIMELINE_EXTEND_REQUIRED', message: '148→149' };
  let result = decideRecovery(issue, []);
  assert.equal(result.action, 'continue');
  result = decideRecovery(issue, [], result.state);
  assert.equal(result.action, 'continue');
  result = decideRecovery(issue, [], result.state);
  assert.equal(result.action, 'wait_human');
  assert.equal(decideRecovery(issue, ['scene_013'], result.state).action, 'continue');
  assert.equal(
    decideRecovery({ code: 'RENDER_FAILED', message: '项目语法错误' }, []).action,
    'repair',
  );
  assert.equal(
    decideRecovery({ code: 'RENDER_FAILED', message: '公共依赖坏了', scope: 'shared_pipeline' }, [])
      .action,
    'wait_human',
  );
  assert.equal(
    decideRecovery({ code: 'EXTERNAL_RESULT_UNKNOWN', message: '未知收费结果' }, []).action,
    'wait_human',
  );
  assert.equal(
    decideRecovery(
      { code: 'TASK_LAYOUT_INVALID', message: '实际文字溢出', scope: 'task_project' },
      [],
    ).action,
    'repair',
  );
  assert.equal(decideRecovery({ code: 'TIMEOUT', message: '硬预算' }, []).action, 'fail');
});

test('媒体只接受白名单参数，制作shell不可写控制目录', () => {
  const c = config({ python: '/opt/worker/.venv/bin/python3' });
  const w: any = {
    root: '/jobs/current',
    task: { stage: 'render', runId: 'run', contractVersion: 'video-two-stage/1' },
  };
  const argv = mediaArguments(c, w, {
    command: 'render',
    scene: 'scene_013',
    entry: 'src/index.ts',
    composition: 'Scene',
    frames: 149,
    fixedMix: true,
  });
  assert.ok(argv.includes('--fixed-mix'));
  const extended = mediaArguments(c, w, {
    command: 'extend-timeline',
    timeline: 'render/run/timeline.json',
    output: 'render/run/timeline.json',
  });
  assert.ok(extended.includes('--timeline'));
  assert.ok(extended.includes('--output'));
  assert.throws(
    () => mediaArguments(c, w, { command: 'extend-timeline', output: 'render/run/timeline.json' }),
    /缺少必要参数：timeline/,
  );
  assert.throws(
    () => mediaArguments(c, w, { command: 'extend-timeline', scene: 'scene_013' }),
    /timeline, output/,
  );
  assert.ok(argv.includes('/jobs/current/render/run/request.json'));
  assert.throws(() => mediaArguments(c, w, { command: 'render', request: '/another/task' }));
  assert.throws(() => mediaArguments(c, w, { command: 'render', node: '/tmp/evil' }));
  const agent = bubblewrapArgs(c, w, ['/bin/bash', '-c', 'true'], 'agent');
  const tool = bubblewrapArgs(c, w, ['python3', 'stage_media.py'], 'tool');
  const writable = (args: string[], target: string) =>
    args.some((v, i) => v === '--bind' && args[i + 1] === target);
  assert.equal(writable(agent, '/jobs/current/.control'), false);
  assert.equal(writable(tool, '/jobs/current/.control'), true);
  assert.equal(agent.includes('--share-net'), false);
});

test('人工等待释放槽、不回调、不自动恢复、阻止冲突提交并允许取消', async () => {
  const db = await database();
  try {
    const repo = new TaskRepository(db),
      tasks = new Tasks(repo, config()),
      queue = new Queue(db);
    await tasks.analysis(tenant, analysis('waiting'));
    const lease = (await queue.claim('owner'))!;
    await queue.waitHuman(lease, { code: 'SHARED_PIPELINE_ERROR', message: '公共工具冲突' });
    const status = await repo.query(tenant.id, 'waiting');
    assert.equal(status.taskState, 'waiting_human');
    assert.equal(status.callbackState, null);
    assert.equal(
      (await db.query('SELECT * FROM execution_slots WHERE run_id IS NOT NULL')).rows.length,
      0,
    );
    assert.equal(await queue.claim('next'), null);
    await assert.rejects(tasks.analysis(tenant, analysis('waiting', 'new-request')), {
      code: 'TASK_BUSY',
    });
    await queue.recover('owner', async () => {
      throw Error('不应恢复等待任务');
    });
    await repo.cancel(tenant.id, lease.run.id);
    assert.equal((await repo.query(tenant.id, 'waiting')).taskState, 'cancelled');
  } finally {
    await db.close();
  }
});

test('实测制作产物的新摘要算进展，旧摘要来回切换不能无限续轮', () => {
  const issue = { code: 'TIMELINE_EXTEND_REQUIRED', message: '按完整声音延长工程' };
  let result = decideRecovery(issue, ['mix:scene:a']);
  result = decideRecovery(issue, ['mix:scene:b'], result.state);
  assert.equal(result.state.stagnant, 0);
  result = decideRecovery(issue, ['mix:scene:a'], result.state);
  result = decideRecovery(issue, ['mix:scene:b'], result.state);
  result = decideRecovery(issue, ['mix:scene:a'], result.state);
  assert.equal(result.action, 'wait_human');
  assert.throws(
    () => mediaArguments(config(), {} as any, { command: 'resolve-timeline' }),
    /白名单/,
  );
});

test('混音进展独立于成片数量，失效文件和旧时间轴不计完成', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-progress-'));
  try {
    await mkdir(path.join(root, 'render/run'), { recursive: true });
    await writeFile(path.join(root, 'render/run/timeline.json'), '{}');
    await writeFile(path.join(root, 'mix.wav'), '有效混音替身');
    const sha256 = await hashFile(path.join(root, 'mix.wav'));
    await recordMediaProgress(root, 'run', 'scene', {
      error: { code: 'TIMELINE_EXTEND_REQUIRED' },
      diagnostics: { mixPath: 'mix.wav', mixSha256: sha256 },
    });
    assert.deepEqual(await verifiedMediaProgress(root, 'run'), ['mix:scene:' + sha256]);
    await writeFile(path.join(root, 'scene.mp4'), '成片替身');
    const videoHash = await hashFile(path.join(root, 'scene.mp4'));
    await recordMediaProgress(root, 'run', 'scene', {
      path: 'scene.mp4',
      sha256: videoHash,
      timelineHash: await hashFile(path.join(root, 'render/run/timeline.json')),
    });
    assert.equal((await verifiedMediaProgress(root, 'run')).length, 2);
    await writeFile(path.join(root, 'render/run/timeline.json'), '{"frames":150}');
    assert.deepEqual(await verifiedMediaProgress(root, 'run'), ['mix:scene:' + sha256]);
    await writeFile(path.join(root, 'mix.wav'), '损坏');
    assert.deepEqual(await verifiedMediaProgress(root, 'run'), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('并发媒体登记不丢记录；旧时间轴结果不能重新盖章且失败队列可继续', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-progress-concurrent-'));
  try {
    await mkdir(path.join(root, 'render/run'), { recursive: true });
    const timeline = path.join(root, 'render/run/timeline.json');
    await writeFile(timeline, '{"version":1}');
    const timelineHash = await hashFile(timeline);
    await writeFile(path.join(root, 'scene.mp4'), '真实文件校验用替身，不是媒体测试');
    const sha256 = await hashFile(path.join(root, 'scene.mp4'));
    const value = { path: 'scene.mp4', sha256, timelineHash };
    await Promise.all(
      Array.from({ length: 32 }, (_, i) => recordMediaProgress(root, 'run', 'scene_' + i, value)),
    );
    assert.equal((await verifiedMediaProgress(root, 'run')).length, 32);
    await writeFile(timeline, '{"version":2}');
    await assert.rejects(recordMediaProgress(root, 'run', 'stale', value), /过期/);
    await assert.rejects(
      recordMediaProgress(root, 'run', 'missing', { path: 'scene.mp4', sha256 }),
      /摘要/,
    );
    const latest = { ...value, timelineHash: await hashFile(timeline) };
    const settled = await Promise.allSettled([
      recordMediaProgress(root, 'run', 'stale_again', value),
      recordMediaProgress(root, 'run', 'latest', latest),
    ]);
    assert.deepEqual(
      settled.map((s) => s.status),
      ['rejected', 'fulfilled'],
    );
    const progress = await readJson(path.join(root, '.control/progress.json'));
    assert.equal(progress.scene_0.timelineHash, timelineHash);
    assert.equal(progress.stale, undefined);
    assert.equal(progress.missing, undefined);
    assert.equal(progress.stale_again, undefined);
    assert.deepEqual(await verifiedMediaProgress(root, 'run'), ['latest:' + sha256]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
