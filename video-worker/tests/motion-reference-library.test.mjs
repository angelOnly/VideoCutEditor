import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, rm, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { packagePlugin } from '../scripts/package-plugin.mjs';

const exec = promisify(execFile);

test('参考库随插件迁移，检索仅返回候选且说明与媒体路径完整', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'motion-library-'));
  try {
    const release = await packagePlugin(path.join(temp, 'release'));
    const plugin = await realpath(path.join(release.root, 'plugins', release.name));
    const library = path.join(plugin, 'motion-reference-library/typemotion-tables');
    const reference = path.join(plugin, '.agents/skills/directing-motion-art/references');
    // 在安装后的目录验证相对定位，而非借用仓库或开发机路径。
    assert.equal(
      path.resolve(reference, '../../../../motion-reference-library/typemotion-tables'),
      library,
    );
    await access(path.join(reference, 'local-motion-library.md'));
    const catalog = JSON.parse(await readFile(path.join(library, 'catalog.json'), 'utf8'));
    assert.equal(catalog.length, 43);
    for (const item of catalog) {
      assert.ok(item.summary && item.purpose);
      for (const file of Object.values(item.files).flat()) await access(path.join(library, file));
      const guide = await readFile(path.join(library, item.files.guide), 'utf8');
      // 分镜重截后，说明中的本地链接也必须能在安装包内解析。
      for (const [, link] of guide.matchAll(/\]\(([^)]+)\)/g)) {
        assert.ok(!/^https?:/.test(link), '案例说明不应增加外站来源上下文');
        await access(path.resolve(path.dirname(path.join(library, item.files.guide)), link));
      }
      assert.deepEqual(
        JSON.parse(await readFile(path.join(library, 'cases', item.id, 'case.json'), 'utf8')),
        item,
      );
    }
    assert.ok(
      Object.keys(release.files).every(
        (file) =>
          !/(node_modules|\.bundle|integration-draft|gallery\.html|scripts\/render\.mjs)/.test(
            file,
          ),
      ),
    );

    const find = (...args) =>
      exec(process.execPath, [path.join(library, 'scripts/find.mjs'), ...args], { cwd: temp });
    const search = (await find('排名', '超越')).stdout;
    assert.match(search, /ranking-rise/);
    assert.ok(search.split('\n').filter((line) => line.includes(' | ')).length <= 5);
    assert.ok(!search.includes('https://'));
    const broad = (await find('比较')).stdout;
    assert.ok(broad.split('\n').filter((line) => line.includes(' | ')).length <= 5);
    const exact = JSON.parse((await find('radar-morph')).stdout);
    assert.equal(exact.id, 'radar-morph');
    assert.equal(exact.source, undefined);
    for (const frame of exact.frames) {
      assert.ok(frame.path.startsWith(library + path.sep));
      await access(frame.path);
    }
    for (const file of Object.values(exact.files).flat()) {
      assert.ok(file.startsWith(library + path.sep));
      await access(file);
    }
    assert.match((await find('不存在的参考编号')).stdout, /未找到匹配项/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
