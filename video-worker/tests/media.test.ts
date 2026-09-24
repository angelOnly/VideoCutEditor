import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config, tenant } from './helpers.js';
import { createApi } from '../src/api/routes.js';
import { Storage } from '../src/infrastructure/storage.js';

test('媒体支持完整播放、拖动、HEAD、跨域及无效范围，并隔离非发布文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worker-media-'));
  const api = createApi({} as any, config({ mediaRoot: root }));
  const key = 'tasks/task/results/run-1/video-whole.mp4';
  const url = '/media/' + key;
  try {
    await mkdir(path.dirname(path.join(root, key)), { recursive: true });
    await writeFile(path.join(root, key), '0123456789');
    await writeFile(path.join(root, 'secret'), '秘密');
    await symlink('/etc/hosts', path.join(root, 'tasks/task/results/run-1/link.mp4'));
    let response = await api.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, '0123456789');
    assert.equal(response.headers['content-type'], 'video/mp4');
    assert.equal(response.headers['content-length'], '10');
    assert.equal(response.headers['accept-ranges'], 'bytes');
    assert.equal(response.headers['access-control-allow-origin'], '*');
    for (const [range, body, contentRange] of [
      ['bytes=2-5', '2345', 'bytes 2-5/10'],
      ['bytes=7-', '789', 'bytes 7-9/10'],
      ['bytes=-3', '789', 'bytes 7-9/10'],
      ['bytes=8-99', '89', 'bytes 8-9/10'],
    ]) {
      response = await api.inject({ method: 'GET', url, headers: { range } });
      assert.equal(response.statusCode, 206);
      assert.equal(response.body, body);
      assert.equal(response.headers['content-range'], contentRange);
      assert.equal(Number(response.headers['content-length']), body.length);
    }
    for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0']) {
      response = await api.inject({ method: 'GET', url, headers: { range } });
      assert.equal(response.statusCode, 416);
      assert.equal(response.headers['content-range'], 'bytes */10');
    }
    response = await api.inject({ method: 'HEAD', url });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, '');
    assert.equal(response.headers['content-length'], '10');
    assert.equal((await api.inject({ method: 'OPTIONS', url })).statusCode, 204);
    for (const absent of [
      '/media/secret',
      '/media/tasks/task/results/run-1/missing.mp4',
      '/media/tasks/task/results/run-1/link.mp4',
    ])
      assert.equal((await api.inject({ method: 'GET', url: absent })).statusCode, 404);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('回调地址来自 Worker 服务配置，缺省或本机地址禁止交付', () => {
  const key = 'tasks/task/results/run-1/video-whole.mp4';
  assert.equal(new Storage(config()).export(tenant, key), 'http://10.20.130.251:8080/media/' + key);
  assert.throws(() => new Storage(config({ mediaPublicBaseUrl: undefined })).export(tenant, key), {
    code: 'MEDIA_URL_NOT_CONFIGURED',
  });
  for (const mediaPublicBaseUrl of [
    'file:///tmp',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ])
    assert.throws(() => new Storage(config({ mediaPublicBaseUrl })).export(tenant, key), {
      code: 'MEDIA_URL_INVALID',
    });
});
