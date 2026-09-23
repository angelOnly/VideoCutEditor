import path from 'node:path';
import { mkdir, rename, stat } from 'node:fs/promises';
import type { Config } from '../config.js';
import type { Lease } from '../domain/task.js';
import { AppError } from '../domain/task.js';
import type { Database } from './postgres.js';
import type { Workspace } from './workspace.js';
import { writeJson, copyTree } from './files.js';
import { ioProtocol } from '../contracts/pipeline-io.js';
export async function prepareStage(
  config: Config,
  db: Database,
  l: Lease,
  root: string,
  task: any,
  assets: any[],
): Promise<Workspace> {
  const directory = `input/message-${l.run.id}`;
  await mkdir(path.join(root, directory), { recursive: true });
  const prepared = (await db.query('SELECT prepared FROM runs WHERE id=$1', [l.run.id])).rows[0]
    ?.prepared;
  let template = prepared?.template;
  if (template) {
    const expected = path.join(config.dataRoot, task.id, 'inputs', 'templates', l.run.id);
    if (template.frozenPath !== expected)
      throw new AppError('INPUT_SNAPSHOT_INVALID', '模板目录不匹配');
    const target = path.join(root, directory, 'template');
    try {
      await stat(target);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      const staging = `${target}.staging-${l.token}`;
      await copyTree(expected, staging);
      await rename(staging, target);
    }
    template = {
      ...template,
      frozenPath: undefined,
      root: `${directory}/template/${template.rootDirectory}`,
      document: `${directory}/template/${template.document}`,
    };
  }
  // 每条消息单独保存；原文和确认 dataList 不做制作转换。
  const entry = {
    protocol: ioProtocol,
    taskId: task.id,
    requestId: l.run.request_id,
    stage: l.run.stage,
    requestFile: `${directory}/request.json`,
    attachmentsFile: `${directory}/attachments.json`,
    resultFile: `output/${l.run.id}/result.json`,
  };
  await writeJson(path.join(root, entry.requestFile), l.run.input);
  const previous = (
    await db.query(
      "SELECT r.id FROM plan_versions p JOIN runs r ON r.id=p.run_id WHERE p.task_id=$1 AND p.kind='analysis' AND p.version<=$2 AND r.state='succeeded' ORDER BY p.version DESC LIMIT 1",
      [task.id, l.run.input.basePlanVersion ?? l.run.plan_version],
    )
  ).rows[0];
  await writeJson(path.join(root, entry.attachmentsFile), {
    template: template ?? null,
    assets: assets.map((a) => ({ id: a.assetId, path: a.path, kind: a.kind, sha256: a.sha256 })),
    previousAnalysis: previous ? `input/message-${previous.id}/task.json` : null,
  });
  const entryFile = `${directory}/task.json`;
  await writeJson(path.join(root, entryFile), entry);
  await mkdir(path.dirname(path.join(root, entry.resultFile)), { recursive: true });
  return {
    root,
    task: { ...entry, entryFile },
    taskConfig: task.config,
    assets,
    hashes: Object.fromEntries(assets.map((a) => [a.assetId, a.sha256])),
    reuse: [],
    sceneHashes: {},
  };
}
