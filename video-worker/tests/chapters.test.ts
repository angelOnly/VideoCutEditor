import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, symlink, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Chapters } from '../src/runner/chapters.js';
import { MediaSlots } from '../src/runner/media-slots.js';
import { writeJson, hashFile } from '../src/infrastructure/files.js';
import { chapterUsageSummary } from '../src/runner/chapter-usage.js';
import { validateChapterBrief } from '../src/runner/chapter-contract.js';
import { mediaArguments } from '../src/runner/media-tool.js';
import type { Config } from '../src/config.js';

// 这里只测试协议和安全边界；不把模拟 RPC 当作真实模型验收。
class TestRpc extends EventEmitter {
  healthy = true;
  calls: { method: string; params: any }[] = [];
  n = 0;
  async request(method: string, params: any) {
    this.calls.push({ method, params });
    if (method === 'thread/start')
      return {
        thread: { id: `t${++this.n}` },
        activePermissionProfile: { id: 'videocut-chapter' },
      };
    if (method === 'turn/start') return { turn: { id: 'turn-' + params.threadId } };
    if (method === 'turn/interrupt')
      this.emit('notification', 'turn/completed', {
        threadId: params.threadId,
        turn: { id: params.turnId, status: 'interrupted' },
      });
    return {};
  }
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chapters-test-'));
  const rpc = new TestRpc(),
    abort = new AbortController();
  let valid = true;
  const manager = new Chapters(rpc, {} as Config, {
    root,
    runId: 'r1',
    token: 7,
    signal: abort.signal,
    check: async () => {
      if (!valid) throw Error('租约已过期');
    },
  });
  await writeJson(path.join(root, 'confirmation/plan.json'), {
    scenes: [{ id: 's1', text: '原文。' }],
  });
  const confirmationSha256 = await hashFile(path.join(root, 'confirmation/plan.json'));
  await writeJson(path.join(root, 'render/r1/request.json'), {
    runId: 'r1',
    stage: 'render',
    confirmation: { planFile: 'confirmation/plan.json', planSha256: confirmationSha256 },
  });
  await writeJson(path.join(root, 'audio.json'), { actual: true });
  const audioSha256 = await hashFile(path.join(root, 'audio.json'));
  await writeJson(path.join(root, 'render/r1/timeline.json'), {
    scenes: [
      {
        id: 's1',
        startFrame: 0,
        frames: 30,
        utterances: [
          {
            id: 'u1',
            text: '原文。',
            startFrame: 0,
            endFrameExclusive: 30,
            audioPath: 'audio.json',
          },
        ],
      },
    ],
  });
  await writeJson(path.join(root, 'render/r1/direction.json'), {
    directionVersion: 1,
    confirmationSha256,
    sceneOrder: ['s1'],
    chapters: [{ chapterId: 'c1', sceneIds: ['s1'] }],
  });
  const brief = {
    chapterId: 'c1',
    directionVersion: 1,
    sceneIds: ['s1'],
    audioAnchors: [
      {
        utteranceId: 'u1',
        sceneId: 's1',
        text: '原文。',
        startFrame: 0,
        endFrameExclusive: 30,
        globalStartFrame: 0,
        globalEndFrameExclusive: 30,
        audioSha256,
      },
    ],
  };
  await writeJson(path.join(root, 'render/r1/chapters/c1/brief.json'), brief);
  const dispatch = () =>
    manager.operate({
      operation: 'dispatch',
      chapterId: 'c1',
      brief: 'render/r1/chapters/c1/brief.json',
    });
  return {
    root,
    rpc,
    abort,
    manager,
    brief,
    dispatch,
    expire: () => {
      valid = false;
    },
    close: async () => {
      await manager.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
test('章节真实文件代理限制写入、符号链接、未注册工具；会话没有 shell 和 TTS', async () => {
  const f = await fixture();
  try {
    const c = await f.dispatch();
    const start = f.rpc.calls.find((x) => x.method === 'thread/start')!.params;
    assert.deepEqual(
      start.dynamicTools.map((t: any) => t.name),
      ['video_chapter_files'],
    );
    assert.equal(start.config.permissions['videocut-chapter'].filesystem[f.root], 'read');
    const call = (arguments_: any, tool = 'video_chapter_files') =>
      f.manager.handleRequest('item/tool/call', {
        threadId: c.threadId,
        turnId: 'turn-' + c.threadId,
        tool,
        arguments: arguments_,
      });
    assert.equal(
      (await call({ operation: 'write', path: 'component.json', text: '{"ok":true}' })).success,
      true,
    );
    for (const target of ['../../../../timeline.json', '/tmp/outside-chapter'])
      assert.equal((await call({ operation: 'write', path: target, text: '{}' })).success, false);
    await symlink(path.join(f.root, 'render/r1'), path.join(f.root, c.workspace, 'escape'));
    assert.equal(
      (await call({ operation: 'write', path: 'escape/direction.json', text: '{}' })).success,
      false,
    );
    await assert.rejects(call({ command: 'echo' }, 'video_exec'));
    await assert.rejects(call({}, 'video_tts'));
    await assert.rejects(f.dispatch(), /同章已有/);
  } finally {
    await f.close();
  }
});
test('章节候选校验实际摘要、确认范围及编排版本，主控预览仍是必需', async () => {
  const f = await fixture();
  try {
    const c = await f.dispatch(),
      workspace = path.join(f.root, c.workspace);
    await writeJson(path.join(workspace, 'draft.json'), { events: [] });
    await writeJson(path.join(workspace, 'result.json'), {
      chapterId: 'c1',
      attemptId: c.attemptId,
      directionVersion: 1,
      briefHash: await hashFile(path.join(f.root, 'render/r1/chapters/c1/brief.json')),
      sceneIds: ['s1'],
      audioAnchors: f.brief.audioAnchors,
      files: [{ path: 'draft.json', sha256: await hashFile(path.join(workspace, 'draft.json')) }],
    });
    f.rpc.emit('notification', 'turn/completed', {
      threadId: c.threadId,
      turn: { id: 'turn-' + c.threadId, status: 'completed' },
    });
    let status: any = await f.manager.operate({ operation: 'status', executionId: c.executionId });
    assert.equal(status.status, 'candidate');
    assert.equal(status.result.previewVerified, false);
    assert.equal(status.result.reviewRequired, true);
    await writeJson(path.join(f.root, 'render/r1/direction.json'), { directionVersion: 2 });
    status = await f.manager.operate({ operation: 'status', executionId: c.executionId });
    assert.equal(status.status, 'failed');
    assert.match(status.error, /过期/);
  } finally {
    await f.close();
  }
});
test('父取消中断全部章节，租约过期拒绝继续读写', async () => {
  const f = await fixture();
  try {
    const c = await f.dispatch();
    f.expire();
    await assert.rejects(
      f.manager.handleRequest('item/tool/call', {
        threadId: c.threadId,
        turnId: 'turn-' + c.threadId,
        tool: 'video_chapter_files',
        arguments: { operation: 'read', path: 'render/r1/direction.json' },
      }),
      /租约/,
    );
    f.abort.abort();
    await f.manager.close();
    assert.equal(f.rpc.calls.filter((x) => x.method === 'turn/interrupt').length, 1);
    const record = JSON.parse(
      await readFile(path.join(f.root, '.control/chapters', c.executionId + '.json'), 'utf8'),
    );
    assert.equal(record.status, 'cancelled');
    assert.equal(record.fencingToken, 7);
  } finally {
    await f.close();
  }
});
test('宿主槽整批分配、FIFO 和排队取消不漏槽', async () => {
  const slots = new MediaSlots(2),
    abort = new AbortController(),
    cancel = new AbortController();
  let finish!: () => void,
    entered = false;
  const first = slots.run(
    2,
    abort.signal,
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  await new Promise((r) => setImmediate(r));
  const removed = slots.run(1, cancel.signal, async () => assert.fail('已取消任务不应执行'));
  cancel.abort();
  await assert.rejects(removed);
  const last = slots.run(2, abort.signal, async () => {
    entered = true;
  });
  assert.equal(entered, false);
  finish();
  await Promise.all([first, last]);
  assert.equal(entered, true);
  await assert.rejects(
    slots.run(3, abort.signal, async () => {}),
    /上限/,
  );
});
test('批次媒体参数是白名单且渲染槽严格校验', () => {
  const config = { python: '/python', toolkitRoot: '/toolkit', hostBrowser: '/chrome' } as Config;
  const w = { root: '/task', task: { stage: 'render', runId: 'r1' } } as any;
  const argv = mediaArguments(config, w, {
    command: 'render-batch',
    manifest: 'render/r1/batches/b1/manifest.json',
    slots: 2,
  });
  assert.ok(argv.includes('--slots'));
  assert.ok(argv.includes('--modules'));
  assert.throws(() =>
    mediaArguments(config, w, { command: 'render-batch', manifest: 'm', slots: 4 }),
  );
  assert.throws(() =>
    mediaArguments(config, w, { command: 'render-batch', manifest: 'm', shell: 'bad' }),
  );
});

test('章节约定绑定确认稿、互斥分章及实际音频摘要，重启不接管旧执行', async () => {
  const f = await fixture();
  try {
    await validateChapterBrief(f.root, 'r1', f.brief);
    await assert.rejects(
      validateChapterBrief(f.root, 'r1', { ...f.brief, sceneIds: ['other'] }),
      /范围/,
    );
    await assert.rejects(
      validateChapterBrief(f.root, 'r1', {
        ...f.brief,
        audioAnchors: [{ ...f.brief.audioAnchors[0], startFrame: 1 }],
      }),
      /音频锚点/,
    );
    const directionFile = path.join(f.root, 'render/r1/direction.json');
    const direction = JSON.parse(await readFile(directionFile, 'utf8'));
    await writeJson(directionFile, {
      ...direction,
      chapters: [...direction.chapters, { chapterId: 'c2', sceneIds: ['s1'] }],
    });
    await assert.rejects(f.dispatch(), /交叉/);
    await writeJson(directionFile, direction);
    const execution = await f.dispatch();
    const other = new Chapters(new TestRpc(), {} as Config, {
      root: f.root,
      runId: 'r1',
      token: 8,
      signal: new AbortController().signal,
      check: async () => {},
    });
    try {
      await assert.rejects(
        other.operate({ operation: 'status', executionId: execution.executionId }),
        /旧进程/,
      );
    } finally {
      await other.close();
    }
    await writeJson(path.join(f.root, 'audio.json'), { actual: false });
    await assert.rejects(validateChapterBrief(f.root, 'r1', f.brief), /音频锚点/);
  } finally {
    await f.close();
  }
});

test('章节累计 total 幂等汇总；新控制器保留取消 attempt 用量，缺失不计零', async () => {
  const f = await fixture();
  try {
    const c = await f.dispatch();
    const notification = {
      threadId: c.threadId,
      tokenUsage: {
        total: { totalTokens: 150, inputTokens: 100, outputTokens: 50 },
        last: { totalTokens: 99 },
      },
    };
    f.rpc.emit('notification', 'thread/tokenUsage/updated', notification);
    f.rpc.emit('notification', 'thread/tokenUsage/updated', notification);
    await f.manager.close();
    let summary = await chapterUsageSummary(f.root, 'r1');
    assert.equal(summary.knownTotals.totalTokens, 150);
    assert.equal(summary.executions[c.executionId].status, 'cancelled');
    assert.equal(summary.knownTotals.cachedInputTokens, null);
    const rpc = new TestRpc();
    const next = new Chapters(rpc, {} as Config, {
      root: f.root,
      runId: 'r1',
      token: 8,
      signal: new AbortController().signal,
      check: async () => {},
    });
    try {
      const c2 = await next.operate({
        operation: 'dispatch',
        chapterId: 'c1',
        brief: 'render/r1/chapters/c1/brief.json',
      });
      summary = await chapterUsageSummary(f.root, 'r1');
      assert.equal(summary.knownTotals.totalTokens, 150);
      assert.equal(summary.complete, false);
      assert.deepEqual(summary.missingByField.totalTokens, [c2.executionId]);
      rpc.emit('notification', 'thread/tokenUsage/updated', {
        threadId: c2.threadId,
        tokenUsage: {
          total: { totalTokens: 25, inputTokens: 20, outputTokens: 5 },
          last: { totalTokens: 20 },
        },
      });
      await next.close();
      summary = await chapterUsageSummary(f.root, 'r1');
      assert.equal(summary.executionCount, 2);
      assert.equal(summary.complete, true);
      assert.equal(summary.knownTotals.totalTokens, 175);
      const saved = JSON.parse(
        await readFile(path.join(f.root, '.control/chapter-usage.json'), 'utf8'),
      );
      assert.equal(saved.knownTotals.totalTokens, 175);
      assert.equal(saved.executions[c.executionId].status, 'cancelled');
    } finally {
      await next.close();
    }
  } finally {
    await f.close();
  }
});
