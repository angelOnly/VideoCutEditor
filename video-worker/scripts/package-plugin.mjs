// 从唯一维护源生成可安装包，不打包模板、凭据、历史工程或运行依赖。
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, lstat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const toolkitSource = fileURLToPath(
  new URL('../../claude-code-video-toolkit/', import.meta.url),
);
export const packageEntries = [
  '.codex-plugin/plugin.json',
  // 参考资源只安装到磁盘，模型按需检索；不递归打包库的开发环境。
  ...['INDEX.md', 'catalog.json', 'shared', 'cases', 'scripts/find.mjs'].map(
    (entry) => `motion-reference-library/typemotion-tables/${entry}`,
  ),
  ...[
    'video-pipeline',
    'remotion-best-practices',
    'ffmpeg',
    'directing-motion-art',
    'motion-design-production',
  ].map((s) => `.agents/skills/${s}`),
  ...[
    'generate_dialogue_audio.py',
    'two_stage.py',
    'task_io.py',
    'stage_media.py',
    'actual_timeline.py',
    'finance_timeline.py',
    'stage_tts.py',
    'cached_tts.py',
    'render_scene.cjs',
    'render_batch.py',
    'config.py',
    'voiceover.py',
    'doubao_tts.py',
  ].map((f) => `tools/${f}`),
];
export async function pluginRelease() {
  const files = {};
  async function collect(relative) {
    const file = path.join(toolkitSource, relative),
      stat = await lstat(file);
    if (stat.isSymbolicLink()) throw Error(`插件不能包含符号链接：${relative}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(file)).sort()) {
        if (['__pycache__', '.DS_Store'].includes(name)) continue;
        await collect(`${relative}/${name}`);
      }
    } else if (stat.isFile())
      files[relative] = createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
  }
  for (const entry of packageEntries) await collect(entry);
  const ordered = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')),
  );
  const manifest = JSON.parse(
    await readFile(path.join(toolkitSource, '.codex-plugin/plugin.json'), 'utf8'),
  );
  return {
    name: manifest.name,
    version: manifest.version,
    sha256: createHash('sha256').update(JSON.stringify(ordered)).digest('hex'),
    files: ordered,
  };
}
export async function packagePlugin(destination) {
  const release = await pluginRelease(),
    root = path.resolve(destination);
  // 发布目录必须全新；不能覆盖正在被任务读取的版本。
  await mkdir(root);
  const plugin = path.join(root, 'plugins', release.name);
  for (const file of Object.keys(release.files)) {
    await mkdir(path.dirname(path.join(plugin, file)), { recursive: true });
    await copyFile(path.join(toolkitSource, file), path.join(plugin, file));
  }
  await writeFile(path.join(plugin, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  await mkdir(path.join(root, '.agents/plugins'), { recursive: true });
  await writeFile(
    path.join(root, '.agents/plugins/marketplace.json'),
    JSON.stringify(
      {
        name: 'videocut-internal',
        interface: { displayName: 'VideoCutEditor 视频制作' },
        plugins: [
          {
            name: release.name,
            source: { source: 'local', path: `./plugins/${release.name}` },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  return { root, ...release };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('需要指定全新的插件发布目录');
  const { files, ...result } = await packagePlugin(process.argv[2]);
  console.log(JSON.stringify({ ...result, fileCount: Object.keys(files).length }));
}
