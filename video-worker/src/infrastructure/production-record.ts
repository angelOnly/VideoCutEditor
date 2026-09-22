import path from 'node:path';
import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { AppError, type Lease } from '../domain/task.js';
import type { Config } from '../config.js';
import type { Workspace } from './workspace.js';
import type { Database } from './postgres.js';
import { readJson, hashFile, safeFile, writeJson } from './files.js';
import { confirmedPlan } from './stage-workspace.js';

// 保留实际制作文件的摘要索引；回调只发布 MP4，此记录仅存在服务端。
export async function productionRecord(w: Workspace, l: Lease, manifest: any) {
  const timelinePath = `render/${l.run.id}/timeline.json`;
  const timeline = await readJson(await safeFile(w.root, timelinePath));
  if (
    timeline.fps !== w.task.outputSpec.fps ||
    !Array.isArray(timeline.scenes) ||
    timeline.scenes.length !== manifest.scenes.length
  )
    throw new AppError('PRODUCTION_RECORD_INVALID', '实际时间轴规格或场景数量不符');
  let offset = 0;
  for (const [i, scene] of manifest.scenes.entries()) {
    const actual = timeline.scenes[i];
    if (
      actual.id !== scene.id ||
      actual.startFrame !== offset ||
      actual.endFrameExclusive !== offset + scene.frames
    )
      throw new AppError('PRODUCTION_RECORD_INVALID', '实际时间轴全局偏移与成品不符');
    offset += scene.frames;
  }
  const files: Record<string, string> = {};
  async function collect(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(w.root, relative), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile()) files[name] = await hashFile(path.join(w.root, name));
      else throw new AppError('PRODUCTION_RECORD_INVALID', '制作资料不能包含链接或特殊文件');
    }
  }
  for (const dir of ['project', 'input', 'tool-audio', `render/${l.run.id}`]) await collect(dir);
  if (!Object.keys(files).some((name) => /^project\/.*\.(tsx?|jsx?|mjs|cjs)$/.test(name)))
    throw new AppError('PRODUCTION_RECORD_INVALID', '缺少可继续修改的工程源码');
  for (const scene of manifest.scenes) {
    for (const item of [scene, scene.audio, ...scene.usedResources]) {
      const file = await safeFile(w.root, item.path);
      const sha256 = await hashFile(file);
      if (sha256 !== item.sha256)
        throw new AppError('PRODUCTION_RECORD_INVALID', '制作文件摘要不符');
      files[item.path] = sha256;
    }
  }
  await writeJson(path.join(w.root, `render/${l.run.id}/manifest.json`), manifest);
  files[`render/${l.run.id}/manifest.json`] = await hashFile(
    path.join(w.root, `render/${l.run.id}/manifest.json`),
  );
  const record = {
    runId: l.run.id,
    planVersion: l.run.plan_version,
    runtimeVersion: w.taskConfig.runtimeVersion,
    hostFingerprint: w.taskConfig.hostFingerprint,
    pipelineRevision: w.taskConfig.pipelineRevision,
    inputSnapshot: w.task.snapshot,
    timeline: timelinePath,
    files,
  };
  await writeJson(path.join(w.root, 'output/production-record.json'), record);
  return record;
}

// 受控续编入口必须明确成功版本；先验证全部文件，再复制到新 run，绝不覆盖旧版本。
export async function restoreProduction(
  config: Config,
  db: Database,
  l: Lease,
  w: Workspace,
  sourceRunId: string,
  resultVersion: number,
) {
  const row = (
    await db.query(
      `SELECT r.*, rr.result FROM runs r JOIN run_results rr ON rr.run_id=r.id
    WHERE r.id=$1 AND r.task_id=$2 AND r.stage='render' AND r.state='succeeded'`,
      [sourceRunId, l.run.task_id],
    )
  ).rows[0];
  const record = row?.result?.productionRecord;
  if (!record || record.resultVersion !== resultVersion || sourceRunId === l.run.id)
    throw new AppError('PRODUCTION_RESTORE_UNAVAILABLE', '指定成功版本不存在或缺少制作资料');
  if (
    record.runtimeVersion !== w.taskConfig.runtimeVersion ||
    record.hostFingerprint !== w.taskConfig.hostFingerprint ||
    record.pipelineRevision !== w.taskConfig.pipelineRevision
  )
    throw new AppError('PRODUCTION_RESTORE_UNAVAILABLE', '制作工具版本不一致');
  const source = path.join(
    config.dataRoot,
    l.run.task_id,
    'runs',
    sourceRunId,
    `attempt_${row.attempt}`,
  );
  const current = await confirmedPlan(db, l);
  const previous = (
    await db.query(
      "SELECT plan FROM plan_versions WHERE task_id=$1 AND version=$2 AND kind='confirmed'",
      [l.run.task_id, record.planVersion],
    )
  ).rows[0]?.plan?.plan;
  if (!previous || previous.taskId !== current.taskId)
    throw new AppError('PRODUCTION_RESTORE_UNAVAILABLE', '原确认版本缺失');
  const currentTemplate = await readJson(await safeFile(w.root, 'input/template.json'));
  const oldTemplate = await readJson(await safeFile(source, 'input/template.json'));
  if (currentTemplate.archiveSha256 !== oldTemplate.archiveSha256)
    throw new AppError('PRODUCTION_RESTORE_UNAVAILABLE', '冻结模板摘要不一致');
  for (const [name, hash] of Object.entries(record.files)) {
    try {
      if ((await hashFile(await safeFile(source, name))) !== hash) throw Error('摘要不符');
    } catch {
      throw new AppError('PRODUCTION_RESTORE_UNAVAILABLE', `制作资料缺失或改变：${name}`);
    }
  }
  if ((await readdir(path.join(w.root, 'project'))).length)
    throw new AppError('PRODUCTION_RESTORE_UNAVAILABLE', '新 run 工程目录必须为空');
  for (const name of Object.keys(record.files)) {
    const destination = path.join(
      w.root,
      name.startsWith('project/') ? name : path.posix.join('history', name),
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(await safeFile(source, name), destination);
  }
  const unchanged = current.scenes
    .filter((s: any) => previous.scenes.some((p: any) => p.id === s.id && p.text === s.text))
    .map((s: any) => s.id);
  await writeJson(path.join(w.root, 'history/restore.json'), {
    sourceRunId,
    resultVersion,
    planVersion: record.planVersion,
    unchangedTextSceneIds: unchanged,
    note: '原时间轴仅供恢复参考；音色改变需重做配音，时长变化需重算字幕、音乐和后续偏移。',
  });
  return { sourceRunId, resultVersion, unchangedTextSceneIds: unchanged };
}
