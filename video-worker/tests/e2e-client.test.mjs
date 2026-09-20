import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { specs } from '../scripts/deepseek-e2e.mjs';

// 假 HTTP 服务仅验证客户端请求及幂等性，不假称真正运行过 Codex。
test('真实接口客户端：准备白名单、重复提交同一 requestId、外部确认及结果查询', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'videocut-client-'));
  const script = path.join(root, 'video-worker/scripts/deepseek-e2e.mjs');
  let current, renderBody;
  const submissions = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    assert.equal(req.headers.authorization, 'Bearer test-client-key');
    let data;
    if (
      req.method === 'POST' &&
      req.url === '/narrate/ai_video_director/getAiVideoEditingAnalysisData'
    ) {
      submissions.push(body);
      data = { taskId: body.taskId, runId: 'analysis-run', state: 'queued', stage: 'analysis' };
      current = {
        taskId: body.taskId,
        taskState: 'awaiting_editor',
        planVersion: 1,
        latestRun: { runId: 'analysis-run', stage: 'analysis', state: 'succeeded' },
        callbackState: 'delivered',
        plan: {
          plan: { taskId: 'internal-task', scenes: [{ id: 's1', text: '第一句。' }] },
          dataList: [{ id: 's1', content: '第一句。' }],
        },
      };
    } else if (
      req.method === 'POST' &&
      req.url === '/narrate/ai_video_director/getAiVideoEditingData'
    ) {
      renderBody = body;
      data = { taskId: body.taskId, runId: 'render-run', state: 'queued', stage: 'render' };
      current = {
        ...current,
        taskState: 'ready',
        latestRun: { runId: 'render-run', stage: 'render', state: 'succeeded' },
        latestResult: [
          { id: 's1', content: '第一句。', dur: 1, url: path.join(root, 'media/scene.mp4') },
        ],
      };
    } else if (req.method === 'GET' && req.url?.startsWith('/ai_video_director/tasks/'))
      data = current;
    else {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 0, data }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await mkdir(path.dirname(script), { recursive: true });
    await copyFile(new URL('../scripts/deepseek-e2e.mjs', import.meta.url), script);
    const tk = path.join(root, 'claude-code-video-toolkit');
    for (const rel of [
      'test-cases/deepseek-v4/script.md',
      'deliverables/财经双人对话视频生成指令.md',
      ...specs.map((a) => a.file),
    ]) {
      const file = path.join(tk, rel);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, '第一句。');
    }
    await mkdir(path.join(root, 'video-worker/config'));
    await writeFile(path.join(root, 'video-worker/config/templates.json'), '{}');
    await writeFile(path.join(root, '.env'), '# 测试不包含真实凭据\n');
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      WORKER_PROTOCOL: 'video-two-stage/1',
      WORKER_EXECUTOR: 'host',
      MEDIA_ROOT: path.join(root, 'media'),
      IFENG_API_KEY: 'test-client-key',
      E2E_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    };
    const run = (...args) =>
      new Promise((resolve) => {
        const p = spawn(process.execPath, [script, ...args], { env });
        let out = '';
        p.stdout.on('data', (x) => (out += x));
        p.stderr.on('data', (x) => (out += x));
        p.on('exit', (code) => resolve({ code, out }));
      });
    assert.equal((await run('prepare')).code, 0);
    assert.equal((await run('analysis')).code, 0);
    assert.equal((await run('analysis')).code, 0);
    assert.equal(submissions[0].requestId, submissions[1].requestId);
    assert.equal(submissions[0].taskId, submissions[1].taskId);
    assert.match(submissions[0].otherRequirements, /禁止从历史成片/);
    assert.equal((await run('status', '--wait')).code, 0);
    assert.equal((await run('render')).code, 1);
    assert.equal(renderBody, undefined);
    assert.equal((await run('render', '--confirm')).code, 0);
    assert.equal(renderBody.plan.taskId, 'internal-task');
    assert.equal(renderBody.basePlanVersion, 1);
    await writeFile(path.join(root, 'media/scene.mp4'), 'fixture: 只验证文件存在，不冒充编码验收');
    assert.equal((await run('verify')).code, 0);
    const config = JSON.parse(
      await readFile(path.join(root, 'video-worker/config/templates.json'), 'utf8'),
    );
    assert.equal(config.deepseek_finance_dialogue_e2e.attachments.length, specs.length);
    assert.ok(
      config.deepseek_finance_dialogue_e2e.attachments.every((a) =>
        a.url.startsWith(path.join(root, 'media/input')),
      ),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
