import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('one root env configures Worker without tenants.json; injected values and explicit tenants override it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'videocut-config-'));
  const envFile = path.join(dir, '.env');
  const tenantFile = path.join(dir, 'tenants.json');
  const service = fileURLToPath(new URL('../', import.meta.url));
  try {
    await writeFile(
      envFile,
      [
        'MEDIA_ROOT=/shared/videos',
        'POSTGRES_PASSWORD=test_database_password',
        'IFENG_API_KEY=test-interface-token-123',
        'IFENG_CALLBACK_SECRET=test-callback-secret-123',
        'IFENG_CALLBACK_BASE_URL=http://callback:9000',
        'IFENG_ALLOWED_INPUT_PREFIXES=input/a, input/b',
        'DOUBAO_TTS_SPEAKER=test_speaker',
        'CODEX_MODEL=',
        'CODEX_BASE_URL=',
      ].join('\n'),
    );
    const code = `import {loadConfig} from './src/config.ts';
      const c=loadConfig(${JSON.stringify(envFile)});
      console.log(JSON.stringify({tenant:c.tenants[0],voice:c.ttsVoice,db:c.databaseUrl,model:c.codexModel,base:c.codexBaseUrl}));`;
    const read = (env: Record<string, string> = {}) =>
      JSON.parse(
        execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
          cwd: service,
          env: { PATH: process.env.PATH, ...env },
          encoding: 'utf8',
        }),
      );
    const config = read();
    assert.equal(config.tenant.inputRoot, '/shared/videos');
    assert.deepEqual(config.tenant.allowedInputPrefixes, ['input/a', 'input/b']);
    assert.equal(config.voice, 'test_speaker');
    assert.match(config.db, /test_database_password@127\.0\.0\.1:15432/);
    assert.match(read({ POSTGRES_HOST_PORT: '15433' }).db, /:15433\/videocut$/);
    assert.equal(config.model, undefined);
    assert.equal(config.base, undefined);
    const overridden = read({
      IFENG_API_KEY: 'injected-interface-token',
      DATABASE_URL: 'postgresql://injected/test',
    });
    assert.equal(overridden.tenant.apiKey, 'injected-interface-token');
    assert.equal(overridden.db, 'postgresql://injected/test');
    await writeFile(tenantFile, JSON.stringify([{ ...config.tenant, id: 'explicit' }]));
    assert.equal(read({ TENANTS_FILE: tenantFile }).tenant.id, 'explicit');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
