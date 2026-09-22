import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { AppError } from '../domain/task.js';
import type { Config } from '../config.js';
import type { Workspace } from '../infrastructure/workspace.js';
import { readJson, writeJson, hashFile, safeFile } from '../infrastructure/files.js';
import { stagePath } from '../contracts/two-stage.js';

/** 只构建白名单 argv，不让模型提供可执行文件、环境变量或 shell。 */
export function mediaArguments(config: Config, w: Workspace, input: any): string[] {
  const command = input?.command;
  const fields: Record<string, string[]> = {
    render: ['scene', 'project', 'entry', 'composition', 'props', 'frames', 'fixedMix'],
    'freeze-batch': ['batch', 'project', 'entry', 'scenes'],
    'render-batch': ['manifest', 'slots'],
    'extend-timeline': ['timeline', 'output'],
    'derive-timeline': ['timeline', 'project'],
    assemble: ['manifest'],
    preflight: [],
  };
  if (
    !fields[command] ||
    Object.keys(input).some((k) => k !== 'command' && !fields[command].includes(k))
  )
    throw new AppError(
      'INVALID_CONTRACT',
      `媒体命令或参数不在白名单；${fields[command] ? `${command} 仅允许 command 和这些参数：${fields[command].join(', ') || '无'}` : `可用命令：${Object.keys(fields).join(', ')}`}`,
    );
  const required: Record<string, string[]> = {
    render: ['scene', 'entry', 'composition', 'frames'],
    'freeze-batch': ['batch', 'project', 'entry', 'scenes'],
    'render-batch': ['manifest'],
    'extend-timeline': ['timeline', 'output'],
    'derive-timeline': ['timeline', 'project'],
    assemble: ['manifest'],
    preflight: [],
  };
  if (required[command].some((k) => input[k] === undefined))
    throw new AppError(
      'INVALID_CONTRACT',
      `媒体命令 ${command} 缺少必要参数：${required[command].filter((k) => input[k] === undefined).join(', ')}；请补齐后重试`,
    );
  const argv = [config.python, path.join(config.toolkitRoot, 'tools/stage_media.py'), command];
  if (command !== 'preflight') argv.push('--request', path.join(w.root, stagePath(w.task)));
  for (const key of fields[command]) {
    const value = input[key];
    if (value === undefined) continue;
    if (key === 'fixedMix') {
      if (typeof value !== 'boolean')
        throw new AppError('INVALID_CONTRACT', 'fixedMix 必须是布尔值');
      if (value) argv.push('--fixed-mix');
      continue;
    }
    if (
      key === 'frames' || key === 'slots'
        ? !Number.isSafeInteger(value) || value <= 0 || (key === 'slots' && value > 3)
        : typeof value !== 'string' || !value || value.startsWith('-')
    )
      throw new AppError('INVALID_CONTRACT', `媒体参数无效：${key}`);
    argv.push('--' + key, String(value));
  }
  if (['render', 'preflight', 'freeze-batch', 'render-batch'].includes(command))
    argv.push(
      '--node',
      process.execPath,
      '--modules',
      path.join(config.toolkitRoot, 'templates/ifeng-scenes/node_modules'),
      '--browser',
      config.hostBrowser,
    );
  return argv;
}

const progressWrites = new Map<string, Promise<void>>();
/** 同一登记文件只允许一个读改写；失败不阻塞后续独立结果。 */
export async function recordMediaProgress(root: string, runId: string, scene: string, value: any) {
  root = await realpath(root);
  const registry = path.join(root, '.control/progress.json');
  const pending = (progressWrites.get(registry) ?? Promise.resolve())
    .catch(() => {})
    .then(() => writeMediaProgress(root, runId, scene, value, registry));
  progressWrites.set(registry, pending);
  try {
    await pending;
  } finally {
    if (progressWrites.get(registry) === pending) progressWrites.delete(registry);
  }
}
/** 只采用渲染时的版本凭据，禁止把旧结果重新盖成当前时间轴。 */
async function writeMediaProgress(
  root: string,
  runId: string,
  scene: string,
  value: any,
  registry: string,
) {
  const complete = !value.error && value.path && value.sha256;
  const timeline = path.join(root, 'render', runId, 'timeline.json');
  const assertVersion = async () => {
    if (
      complete &&
      (typeof value.timelineHash !== 'string' || value.timelineHash !== (await hashFile(timeline)))
    )
      throw new AppError('STALE_MEDIA_RESULT', '媒体结果缺少渲染时的时间轴摘要或已过期，拒绝登记');
  };
  await assertVersion();
  let progress: Record<string, any> = {};
  try {
    progress = await readJson(registry);
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
  const mix =
    value.mix ??
    (value.diagnostics?.mixPath
      ? {
          path: value.diagnostics.mixPath,
          sha256: value.diagnostics.mixSha256,
        }
      : null);
  if (mix?.path && mix.sha256 && (await hashFile(await safeFile(root, mix.path))) === mix.sha256)
    progress['mix:' + scene] = { ...mix, kind: 'mix' };
  if (
    !value.error &&
    value.path &&
    value.sha256 &&
    (await hashFile(await safeFile(root, value.path))) === value.sha256
  ) {
    progress[scene] = {
      path: value.path,
      sha256: value.sha256,
      project: value.project,
      projectHash: value.projectHash,
      timelineHash: value.timelineHash,
    };
  }
  await assertVersion();
  await writeJson(registry, progress);
}

export async function verifiedMediaProgress(root: string, runId: string): Promise<string[]> {
  const completed: string[] = [];
  let progress: Record<string, any>;
  try {
    progress = await readJson(path.join(root, '.control/progress.json'));
  } catch {
    return completed;
  }
  let timeline: string | undefined;
  try {
    timeline = await hashFile(path.join(root, 'render', runId, 'timeline.json'));
  } catch {}
  for (const [id, entry] of Object.entries(progress)) {
    try {
      if ((await hashFile(await safeFile(root, entry.path))) !== entry.sha256) continue;
      if (entry.kind === 'mix') completed.push(id + ':' + entry.sha256);
      else if (timeline && entry.timelineHash === timeline) completed.push(id + ':' + entry.sha256);
    } catch {
      /* 丢失或损坏的文件不能计作进展。 */
    }
  }
  return completed;
}
