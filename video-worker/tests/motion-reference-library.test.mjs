import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, rm, realpath, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { packagePlugin } from '../scripts/package-plugin.mjs';

const exec = promisify(execFile);

test('两类参考随插件迁移，查询分层返回且不会预读案例内容', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'motion-library-'));
  try {
    const release = await packagePlugin(path.join(temp, 'release'));
    const plugin = await realpath(path.join(release.root, 'plugins', release.name));
    const root = path.join(plugin, 'motion-reference-library');
    const library = path.join(root, 'typemotion-tables');
    const mechanisms = path.join(root, 'selected-mechanisms');
    const reference = path.join(plugin, '.agents/skills/directing-motion-art/references');
    const script = path.join(root, 'scripts/find.mjs');
    assert.equal(
      path.resolve(reference, '../../../../motion-reference-library/scripts/find.mjs'),
      script,
    );
    await access(path.join(reference, 'local-motion-library.md'));
    const catalog = JSON.parse(await readFile(path.join(library, 'catalog.json'), 'utf8'));
    assert.equal(catalog.length, 43);
    for (const item of catalog) {
      for (const file of Object.values(item.files).flat()) await access(path.join(library, file));
      const guide = await readFile(path.join(library, item.files.guide), 'utf8');
      for (const [, link] of guide.matchAll(/\]\(([^)]+)\)/g)) {
        assert.ok(!/^https?:/.test(link), '案例说明不应增加外站来源上下文');
        await access(path.resolve(path.dirname(path.join(library, item.files.guide)), link));
      }
      assert.deepEqual(
        JSON.parse(await readFile(path.join(library, 'cases', item.id, 'case.json'), 'utf8')),
        item,
      );
    }
    const selected = JSON.parse(await readFile(path.join(mechanisms, 'catalog.json'), 'utf8'));
    assert.equal(selected.mechanisms.length, 23);
    assert.equal(new Set(selected.mechanisms.map((m) => m.video)).size, 20);
    assert.ok(selected.excluded_ids.every((id) => !selected.mechanisms.some((m) => m.id === id)));
    // 按资料包的原始摘要验字节，防止导入时遗漏或损坏图片、视频与机制正文。
    for (const file of selected.files) {
      const data = await readFile(path.join(mechanisms, file.path));
      assert.equal(data.length, file.bytes);
      assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256);
    }
    for (const item of selected.mechanisms) {
      for (const key of ['document', 'storyboard', 'video'])
        await access(path.join(mechanisms, item[key]));
      const guide = await readFile(path.join(mechanisms, item.document), 'utf8');
      assert.ok(guide.includes(`id: "${item.id}"`));
      for (const [, link] of guide.matchAll(/\]\(([^)]+)\)/g)) {
        assert.ok(!/^https?:/.test(link));
        await access(path.resolve(path.dirname(path.join(mechanisms, item.document)), link));
      }
    }
    assert.ok(
      Object.keys(release.files).every(
        (file) =>
          !/(node_modules|\.bundle|integration-draft|gallery\.html|scripts\/render\.mjs|迁移方案|迁移指南)/.test(
            file,
          ),
      ),
    );

    // 查询运行时若尝试读案例正文、图片或源码，直接报错；只允许读取两份清单。
    const guard = path.join(temp, 'guard.mjs');
    await writeFile(
      guard,
      `import fs from 'node:fs';
const original = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  if (String(file).includes('/cases/')) throw Error('检索不应读取案例内容');
  return original.call(this, file, ...args);
};\n`,
    );
    const find = (...args) =>
      exec(process.execPath, ['--import', guard, script, ...args], { cwd: temp });
    const query = async (...args) => JSON.parse((await find(...args)).stdout);
    const help = (await find()).stdout;
    assert.ok(help.length < 400 && !help.includes('056-m01'));
    const broad = await query('变化');
    assert.equal(broad.candidates.length, 3);
    const mixed = await query('逐词强调', '排名');
    assert.equal(new Set(mixed.candidates.map((c) => c.kind)).size, 2);
    for (const candidate of broad.candidates) {
      assert.deepEqual(
        Object.keys(candidate).sort(),
        ['id', 'kind', 'title', 'summary', 'purpose', 'guide'].sort(),
      );
      assert.ok(candidate.id.includes('/'));
    }
    const bounded = (await find('变化', '--limit', '5')).stdout;
    assert.equal(JSON.parse(bounded).candidates.length, 5);
    assert.ok(Buffer.byteLength(bounded) < 8000);
    assert.ok(!bounded.includes('https://') && !bounded.includes('source_url'));
    const ranking = await query('排名', '超越', '--kind', 'source');
    assert.ok(ranking.candidates.some((c) => c.id === 'typemotion-tables/ranking-rise'));
    assert.ok(ranking.candidates.every((c) => c.kind === 'source'));
    const layers = await query('分层分离', '--kind', 'mechanism');
    assert.equal(layers.candidates[0].id, 'selected-mechanisms/094-m04');
    const emphasis = await query('逐词强调');
    assert.ok(emphasis.candidates.some((c) => c.id === 'selected-mechanisms/006-m03'));

    const source = await query('typemotion-tables/radar-morph');
    assert.equal(source.hasSource, true);
    assert.ok(source.files.source.endsWith('/Scene.tsx'));
    assert.ok(source.files.dependencies.length > 0);
    assert.deepEqual(source.missing, []);
    for (const frame of source.frames) await access(frame.path);
    const mechanism = await query('selected-mechanisms/094-m04');
    assert.equal(mechanism.hasSource, false);
    assert.equal(mechanism.files.source, undefined);
    assert.equal(mechanism.frames, undefined);
    assert.ok(mechanism.startState && mechanism.endState);
    assert.deepEqual(mechanism.missing, []);
    for (const file of Object.values(mechanism.files)) await access(file);
    assert.equal(mechanism.source_url, undefined);
    assert.equal((await query('selected-mechanisms/不存在')).item, null);
    assert.deepEqual((await query('无匹配关键词xyz')).candidates, []);
    for (const args of [
      ['变化', '--limit', '99'],
      ['变化', '--kind', 'all'],
      ['--all'],
      ['../secret'],
    ]) {
      await assert.rejects(
        find(...args),
        (error) => error.code === 1 && Boolean(JSON.parse(error.stdout).error),
      );
    }
    await rm(mechanism.files.storyboard);
    assert.deepEqual((await query(mechanism.id)).missing, [mechanism.files.storyboard]);
    // 一库不可用仍可检索另一库；无查询连清单也不需要。
    const index = path.join(mechanisms, 'catalog.json');
    await rename(index, index + '.disabled');
    const fallback = await query('排名');
    assert.ok(fallback.candidates.length > 0 && fallback.warnings.length === 1);
    await writeFile(path.join(library, 'catalog.json'), '损坏的清单');
    assert.equal((await find()).stdout, help);
    assert.equal((await query('排名')).warnings.length, 2);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
