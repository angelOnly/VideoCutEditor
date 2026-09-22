import { randomUUID } from 'node:crypto';
import { Postgres, migrate } from '../src/infrastructure/postgres.js';
import { PGlite } from '@electric-sql/pglite';
import { readFile, chmod, readdir } from 'node:fs/promises';
import type { Database, Sql } from '../src/infrastructure/postgres.js';
import type { Config } from '../src/config.js';
export async function database() {
  if (process.env.TEST_DATABASE_URL) {
    const admin = new Postgres(process.env.TEST_DATABASE_URL),
      schema = 'test_' + randomUUID().replaceAll('-', '');
    await admin.query('CREATE SCHEMA ' + schema);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', '-c search_path=' + schema);
    const db = new Postgres(url.toString());
    await migrate(db);
    return {
      ...{ query: db.query.bind(db), tx: db.tx.bind(db) },
      close: async () => {
        await db.close();
        await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
        await admin.close();
      },
    };
  }

  const pg = new PGlite();
  const adapt = (q: any): Sql => ({
    query: async <T = any>(sql: string, args?: any[]) => (await q.query(sql, args)) as any,
  });
  for (const name of ['001_initial.sql', '002_pipeline_liveness.sql', '003_render_recovery.sql'])
    await pg.exec(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  const db: Database = {
    ...adapt(pg),
    tx: (fn) => pg.transaction((t) => fn(adapt(t))),
    close: () => pg.close(),
  };
  return db;
}
export const tenant = {
  id: 'ifeng',
  inputRoot: '/home/ops/jiangzb/videos',
  exportRoot: '/home/ops/jiangzb/videos',
  allowedInputPrefixes: ['input'],
  callbackBaseUrl: 'http://127.0.0.1:9988',
  callbackSecret: 'test-callback-secret-only',
};
export function config(overrides: Partial<Config> = {}): Config {
  return {
    executor: 'host',
    codexPath: 'codex',
    codexHome: '/tmp/test-codex-home',
    hostBrowser: '/usr/bin/chromium',
    hostMemory: '1G',
    hostCpus: 1,
    hostTasksMax: 128,
    databaseUrl: 'unused',
    port: 0,
    mediaRoot: tenant.inputRoot,
    dataRoot: '/tmp/video-worker-test',
    toolkitRoot: new URL('../../claude-code-video-toolkit', import.meta.url).pathname,
    tenants: [tenant],
    leaseSeconds: 60,
    timeoutSeconds: 14400,
    maxAttempts: 3,
    repairRounds: 1,
    hostFingerprint: 'test-host',
    customTemplatePackageOrigins: [],
    ttsVoice: 'test',
    ttsResourceId: 'seed-tts-2.0',
    python: process.env.PYTHON ?? 'python3',
    templates: {
      finance_vertical_v1: {
        archivePath: 'deliverables/财经双人对话视频生成指令.zip',
        document: '财经双人对话视频生成指令/财经双人对话视频生成指令.md',
      },
    },
    runtimeVersion: 'test',
    ...overrides,
  };
}
export function analysis(taskId = 'task1', requestId = 'analysis-' + taskId) {
  return {
    schemaVersion: 2,
    taskId,
    requestId,
    script: '第一句。第二句。',
    otherRequirements: '财经',
    digitalHumanAccounId: '',
    plugin: { templateId: 'finance_vertical_v1', digitalHumanId: '' },
    narration: null,
    outputSpec: { width: 320, height: 240, fps: 10 },
    otherMaterial: { picInfoList: [], videoInfoList: [] },
  };
}
export function scene(id = 'scene_001', content = '第一句。') {
  return {
    id,
    content,
    dur: 1,
    visualPlan: {
      description: '文字背景',
      layoutPreset: 'full_frame' as const,
      animationPreset: 'slow_zoom' as const,
    },
    extraData: { keywordList: ['重点'], digitalHumanId: '', videoInfoList: [], picInfoList: [] },
  };
}

export async function writable(root: string): Promise<void> {
  await chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = root + '/' + entry.name;
    if (entry.isDirectory()) await writable(name);
    else if (entry.isFile()) await chmod(name, 0o600);
  }
}
