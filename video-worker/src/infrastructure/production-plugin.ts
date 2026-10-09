import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import type { Rpc } from './app-server.js';
import { AppError } from '../domain/task.js';

export function productionRoot(config: Config) {
  if (!config.pluginRoot || !path.isAbsolute(config.pluginRoot))
    throw new AppError(
      'PRODUCTION_PLUGIN_UNAVAILABLE',
      '需要配置已安装插件的绝对路径 VIDEO_PLUGIN_ROOT',
    );
  return config.pluginRoot;
}

// 插件更新必须随发布进行；缺失或版本不符不能静默回退到仓库源码。
export async function verifyProductionPlugin(config: Config) {
  const root = productionRoot(config);
  const release = JSON.parse(await readFile(path.join(root, 'release.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  if (
    manifest.name !== 'videocut-production' ||
    release.name !== manifest.name ||
    release.version !== manifest.version ||
    release.sha256 !== config.pluginSha256 ||
    createHash('sha256').update(JSON.stringify(release.files)).digest('hex') !== release.sha256
  )
    throw new AppError('PRODUCTION_PLUGIN_MISMATCH', '制作插件版本与当前 Worker 发布不一致');
  const canonical = await realpath(root);
  for (const [relative, expected] of Object.entries(release.files)) {
    const file = path.resolve(root, relative);
    if (
      !file.startsWith(root + path.sep) ||
      !(await realpath(file)).startsWith(canonical + path.sep) ||
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex') !== expected
    )
      throw new AppError('PRODUCTION_PLUGIN_MISMATCH', `制作插件文件发生变化：${relative}`);
  }
  return { name: release.name, version: release.version, sha256: release.sha256, root };
}

export async function productionSkill(
  rpc: Rpc,
  config: Config,
  cwd: string,
  stage: 'analysis' | 'render' = 'analysis',
) {
  const release = await verifyProductionPlugin(config);
  const result = await rpc.request('skills/list', { cwds: [cwd], forceReload: true });
  const skills = result.data?.find((item: any) => item.cwd === cwd)?.skills ?? [];
  // 使用 Codex 实际发现的插件 Skill，不能把“可以读文件”当成“插件已经加载”。
  const names = [
    'video-pipeline',
    'remotion-best-practices',
    'ffmpeg',
    'directing-motion-art',
    'motion-design-production',
  ];
  const loaded = names.map((name) =>
    skills.find(
      (item: any) =>
        item.path === path.join(release.root, `.agents/skills/${name}/SKILL.md`) &&
        item.pluginId === 'videocut-production@videocut-internal' &&
        item.enabled === true,
    ),
  );
  if (loaded.some((item) => !item))
    throw new AppError('PRODUCTION_PLUGIN_NOT_LOADED', 'Codex 未完整加载指定制作插件的五个 Skill');
  // 同一个制作代理按阶段启用；Analysis 不注入正文创作指令。
  const selected = stage === 'render' ? [loaded[0], loaded[3], loaded[4]] : [loaded[0]];
  return {
    release,
    inputs: selected.map((skill) => ({
      type: 'skill' as const,
      name: skill.name,
      path: skill.path,
    })),
  };
}
