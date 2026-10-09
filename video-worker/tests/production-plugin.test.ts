import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config, pluginSkills } from './helpers.js';
import { packagePlugin } from '../scripts/package-plugin.mjs';
import {
  productionSkill,
  verifyProductionPlugin,
} from '../src/infrastructure/production-plugin.js';

test('插件已安装但未启用或来源错误时拒绝执行，不回退源目录', async () => {
  const c = config(),
    cwd = '/tmp/plugin-task';
  for (const change of [
    (skills: any[]) => skills.splice(0, 1),
    (skills: any[]) => skills.splice(3, 1),
    (skills: any[]) => {
      skills[4].enabled = false;
    },
    (skills: any[]) => {
      skills[0].enabled = false;
    },
    (skills: any[]) => {
      skills[0].pluginId = null;
    },
    (skills: any[]) => {
      skills[0].path = path.join(c.toolkitRoot, '.agents/skills/video-pipeline/SKILL.md');
    },
  ]) {
    const response = pluginSkills(cwd);
    change(response.data[0].skills);
    await assert.rejects(productionSkill({ request: async () => response } as any, c, cwd), {
      code: 'PRODUCTION_PLUGIN_NOT_LOADED',
    });
  }
  await assert.rejects(verifyProductionPlugin({ ...c, pluginRoot: undefined }), {
    code: 'PRODUCTION_PLUGIN_UNAVAILABLE',
  });
});

test('Render 明确启用两个创作 Skill，Analysis 仅启用制作入口', async () => {
  const c = config(),
    cwd = '/tmp/plugin-stage-task';
  const response = pluginSkills(cwd);
  // 使用实际发现的名称，避免将展示名或缓存路径写死。
  response.data[0].skills[3].name = 'actual-directing-name';
  const rpc = { request: async () => response } as any;
  const analysis = await productionSkill(rpc, c, cwd, 'analysis');
  const render = await productionSkill(rpc, c, cwd, 'render');
  assert.deepEqual(
    analysis.inputs.map((s) => s.name),
    ['videocut-production:video-pipeline'],
  );
  assert.deepEqual(
    render.inputs.map((s) => s.name),
    [
      'videocut-production:video-pipeline',
      'actual-directing-name',
      'videocut-production:motion-design-production',
    ],
  );
  for (const input of render.inputs) {
    assert.equal(input.type, 'skill');
    assert.ok((await readFile(input.path, 'utf8')).startsWith('---\n'));
  }
});

test('发布包保留源码字节，文件篡改和发布版本不匹配均拒绝运行', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'plugin-integrity-'));
  try {
    const release = await packagePlugin(path.join(dir, 'marketplace'));
    const root = path.join(release.root, 'plugins', release.name),
      c = config({ pluginRoot: root });
    await verifyProductionPlugin(c);
    assert.ok(
      Object.keys(release.files).every((p) => !/^(templates|projects|deliverables)\//.test(p)),
    );
    for (const name of ['directing-motion-art', 'motion-design-production']) {
      const relative = `.agents/skills/${name}/SKILL.md`;
      assert.deepEqual(
        await readFile(path.join(root, relative)),
        await readFile(path.join(c.toolkitRoot, relative)),
      );
    }
    const script = 'tools/task_io.py';
    assert.deepEqual(
      await readFile(path.join(root, script)),
      await readFile(path.join(c.toolkitRoot, script)),
    );
    await assert.rejects(verifyProductionPlugin({ ...c, pluginSha256: 'other-version' }), {
      code: 'PRODUCTION_PLUGIN_MISMATCH',
    });
    // 参考媒体与指令一样进入发布哈希，损坏不能作为有效插件使用。
    const media = path.join(
      root,
      'motion-reference-library/typemotion-tables/cases/chord-retro/preview.mp4',
    );
    const originalMedia = await readFile(media);
    await writeFile(media, '损坏的参考视频');
    await assert.rejects(verifyProductionPlugin(c), { code: 'PRODUCTION_PLUGIN_MISMATCH' });
    await writeFile(media, originalMedia);
    await writeFile(path.join(root, script), '# changed');
    await assert.rejects(verifyProductionPlugin(c), { code: 'PRODUCTION_PLUGIN_MISMATCH' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
