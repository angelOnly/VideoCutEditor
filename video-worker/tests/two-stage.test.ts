import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm, readFile, chmod, readdir } from 'node:fs/promises';
import { database, config, tenant, analysis } from './helpers.js';
import { Tasks } from '../src/application/tasks.js';
import { TaskRepository } from '../src/infrastructure/task-repository.js';
import { Queue } from '../src/infrastructure/queue.js';
import { Workspaces } from '../src/infrastructure/workspace.js';
import { Storage } from '../src/infrastructure/storage.js';
import { writeJson, readJson } from '../src/infrastructure/files.js';
import { publishResult } from '../src/application/results.js';
import { command } from '../src/infrastructure/process.js';
import { validate } from '../src/infrastructure/validation.js';
import { executeRun } from '../src/application/execute-run.js';
import { resumeRun } from '../src/application/resume-run.js';
import yazl from 'yazl';

async function zipFixture(files: Record<string, string>) {
  const zip = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
  for (const [name, body] of Object.entries(files)) zip.addBuffer(Buffer.from(body), name);
  zip.end();
  return done;
}
async function makeWritable(root: string): Promise<void> {
  for (const child of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, child.name);
    if (child.isDirectory()) await makeWritable(target);
    else await chmod(target, 0o600);
  }
  await chmod(root, 0o700);
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worker-stages-'));
  const db = await database();
  const c = config({
    executor: 'host',
    executionProtocol: 'video-two-stage/1',
    dataRoot: path.join(root, 'data'),
    mediaRoot: path.join(root, 'media'),
  });
  const t = { ...tenant, inputRoot: c.mediaRoot, exportRoot: c.mediaRoot };
  c.tenants = [t];
  const q = new Queue(db),
    repo = new TaskRepository(db),
    tasks = new Tasks(repo, c),
    storage = new Storage(c),
    workspaces = new Workspaces(c, db, storage);
  return {
    root,
    db,
    c,
    t,
    q,
    repo,
    tasks,
    storage,
    workspaces,
    close: async () => {
      await db.close();
      await makeWritable(root);
      await rm(root, { recursive: true, force: true });
    },
  };
}
test('定制化模板详情下载 ZIP，冻结目录在 render 阶段原样复用', async () => {
  const h = await setup();
  const archive = await zipFixture({
    '财经模板/财经模板.md': '# 财经模板\n![示意](assets/guide.txt)\n',
    '财经模板/assets/guide.txt': '布局示意',
  });
  let details = 0;
  let downloads = 0;
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    if (req.url === '/api/custom-templates/1') {
      details++;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            id: 1,
            name: '财经模板',
            description: '测试模板',
            package_name: 'finance.zip',
            package_url: `http://127.0.0.1:${(server.address() as any).port}/package/1`,
            updated_at: '2026-09-20T00:00:00+08:00',
          },
        }),
      );
      return;
    }
    if (req.url === '/api/custom-templates/2') {
      details++;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            id: 2,
            name: '越权模板',
            description: '',
            package_name: 'foreign.zip',
            package_url: 'https://untrusted.example/foreign.zip',
          },
        }),
      );
      return;
    }
    if (req.url === '/package/1') {
      downloads++;
      res.setHeader('Content-Type', 'application/zip');
      res.end(archive);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    h.c.customTemplateApiBaseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    await h.tasks.analysis(h.t, {
      ...analysis(),
      plugin: { templateId: '1', digitalHumanId: '' },
    });
    const analysisLease = (await h.q.claim('worker'))!;
    const analysisWorkspace = await h.workspaces.prepare(analysisLease, h.t);
    const template = (
      await readJson(path.join(analysisWorkspace.root, analysisWorkspace.task.attachmentsFile))
    ).template;
    assert.equal(template.source, 'custom_template_api');
    assert.equal(
      template.document,
      `input/message-${analysisLease.run.id}/template/财经模板/财经模板.md`,
    );
    assert.equal(template.root, `input/message-${analysisLease.run.id}/template/财经模板`);
    assert.match(template.archiveSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      await readFile(
        path.join(analysisWorkspace.root, template.root + '/assets/guide.txt'),
        'utf8',
      ),
      '布局示意',
    );
    const p = {};
    const delivery = {
      outcome: {
        status: 'completed',
        result: { dataList: [{ id: 's', content: '第一句。' }] },
        error: null,
      },
      files: [],
    };
    const analysisResult = await publishResult(
      h.q,
      h.storage,
      analysisLease,
      analysisWorkspace,
      h.t,
      delivery,
    );
    await h.tasks.render(h.t, {
      schemaVersion: 2,
      taskId: 'task1',
      requestId: 'custom-template-render',
      basePlanVersion: 1,
      field_5: '',
      templateId: '1',
      plan: p,
      dataList: analysisResult.dataList,
    });
    const renderLease = (await h.q.claim('worker'))!;
    const renderWorkspace = await h.workspaces.prepare(renderLease, h.t);
    assert.equal(details, 1);
    assert.equal(downloads, 1);
    assert.equal(
      await readFile(path.join(renderWorkspace.root, template.root + '/assets/guide.txt'), 'utf8'),
      '布局示意',
    );
    const { TemplateProvider } = await import('../src/infrastructure/template-provider.js');
    await assert.rejects(
      new TemplateProvider(h.c).read('2', path.join(h.root, 'foreign-template')),
      { code: 'TEMPLATE_INVALID' },
    );
    assert.equal(details, 2);
    assert.equal(downloads, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await h.close();
  }
});

test('本机财经 ZIP 作为显式测试模板时保留入口和相对资源目录', async () => {
  const h = await setup();
  try {
    h.c.templates = {
      finance_dialogue_v1: {
        archivePath: 'deliverables/财经双人对话视频生成指令.zip',
        document: '财经双人对话视频生成指令/财经双人对话视频生成指令.md',
      },
    };
    await h.tasks.analysis(h.t, {
      ...analysis(),
      plugin: { templateId: 'finance_dialogue_v1', digitalHumanId: '' },
    });
    const lease = (await h.q.claim('worker'))!;
    const workspace = await h.workspaces.prepare(lease, h.t);
    const template = (await readJson(path.join(workspace.root, workspace.task.attachmentsFile)))
      .template;
    assert.equal(template.source, 'local_zip');
    assert.ok(template.document.endsWith('.md'));
    assert.ok(
      template.files.some((file: any) =>
        file.path.endsWith('assets/video/intro/financial-intro-portrait-sfx-v1.mov'),
      ),
    );
    const rendererManifest = template.files.find((file: any) =>
      file.path.endsWith('renderer/renderer-manifest.json'),
    );
    assert.ok(rendererManifest);
    assert.ok(
      template.files.some((file: any) =>
        file.path.endsWith('renderer/scripts/verify-sentence-audio.mjs'),
      ),
    );
    assert.match(
      await readFile(path.join(workspace.root, template.document), 'utf8'),
      /财报揭秘室/,
    );
    assert.match(
      await readFile(
        path.join(workspace.root, `input/message-${lease.run.id}/template`, rendererManifest.path),
        'utf8',
      ),
      /FinanceEpisode/,
    );
  } finally {
    await h.close();
  }
});
