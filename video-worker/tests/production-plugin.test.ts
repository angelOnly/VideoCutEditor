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
    const script = 'tools/task_io.py';
    assert.deepEqual(
      await readFile(path.join(root, script)),
      await readFile(path.join(c.toolkitRoot, script)),
    );
    await assert.rejects(verifyProductionPlugin({ ...c, pluginSha256: 'other-version' }), {
      code: 'PRODUCTION_PLUGIN_MISMATCH',
    });
    await writeFile(path.join(root, script), '# changed');
    await assert.rejects(verifyProductionPlugin(c), { code: 'PRODUCTION_PLUGIN_MISMATCH' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
