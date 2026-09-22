import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, copyFile, chmod, readdir } from 'node:fs/promises';
import type { Config } from '../config.js';
import type { Lease } from '../domain/task.js';
import { AppError } from '../domain/task.js';
import type { Database } from './postgres.js';
import type { Workspace } from './workspace.js';
import { writeJson, readJson, hashFile, copyTree, safeFile } from './files.js';
import { protocol, assertStage, stagePath } from '../contracts/two-stage.js';
import { Queue } from './queue.js';

async function freezeInputTree(root: string): Promise<void> {
  for (const child of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, child.name);
    if (child.isDirectory()) await freezeInputTree(target);
    else if (child.isFile()) await chmod(target, 0o444);
    else throw new AppError('INPUT_SNAPSHOT_INVALID', '输入快照包含非普通文件');
  }
  await chmod(root, 0o555);
}
async function snapshotInput(root: string) {
  const snapshot: Record<string, string> = {};
  async function visit(relative: string): Promise<void> {
    const directory = path.join(root, relative);
    for (const child of await readdir(directory, { withFileTypes: true })) {
      const name = path.posix.join(relative, child.name);
      if (child.isDirectory()) await visit(name);
      else if (child.isFile()) snapshot[name] = await hashFile(await safeFile(root, name));
      else throw new AppError('INPUT_SNAPSHOT_INVALID', '输入快照包含非普通文件');
    }
  }
  await visit('input');
  return snapshot;
}
async function verifySnapshot(base: string, snapshot: Record<string, string>) {
  for (const [name, hash] of Object.entries(snapshot)) {
    if (!name.startsWith('input/'))
      throw new AppError('INPUT_SNAPSHOT_INVALID', '输入快照路径无效');
    let current: string;
    try {
      current = await hashFile(await safeFile(base, name.slice(6)));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('INPUT_SNAPSHOT_INVALID', '原始输入快照缺失');
    }
    if (current !== hash) throw new AppError('INPUT_SNAPSHOT_INVALID', '原始输入快照损坏');
  }
}
// 与 Python json_digest 的排序、分隔符一致；snapshot 只包含字符串映射。
export function snapshotDigest(snapshot: Record<string, string>) {
  const value =
    '{' +
    Object.keys(snapshot)
      .sort()
      .map((k) => JSON.stringify(k) + ': ' + JSON.stringify(snapshot[k]))
      .join(', ') +
    '}';
  return createHash('sha256').update(value).digest('hex');
}
export async function prepareStage(
  config: Config,
  db: Database,
  l: Lease,
  root: string,
  task: any,
  assets: any[],
): Promise<Workspace> {
  if (config.executor !== 'host')
    throw new AppError('EXECUTOR_UNSUPPORTED', '两阶段执行需使用 Ubuntu host Worker');
  const queue = new Queue(db);
  const base = path.join(
    config.dataRoot,
    task.id,
    'inputs',
    'protocol',
    l.run.stage === 'analysis' ? l.run.id : (task.config.analysisRunId ?? 'missing'),
  );
  if (l.run.stage === 'analysis') {
    const prepared = (await db.query('SELECT prepared FROM runs WHERE id=$1', [l.run.id])).rows[0]
      .prepared;
    if (prepared.stageSnapshot) {
      // 重试直接恢复首次冻结输入，不能重新读取模板或覆盖不可变快照。
      await verifySnapshot(base, prepared.stageSnapshot);
      await copyTree(base, path.join(root, 'input'));
    } else {
      await mkdir(base, { recursive: true });
      await writeFile(path.join(root, 'input/script.txt'), task.config.script);
      await writeJson(path.join(root, 'input/requirements.json'), {
        requirements: task.config.requirements,
        plugin: { digitalHumanId: task.config.digitalHumanId },
        narration: task.config.narration,
      });
      const template = (await db.query('SELECT prepared FROM runs WHERE id=$1', [l.run.id])).rows[0]
        .prepared.template;
      if (template.frozenPath) {
        const expected = path.join(config.dataRoot, task.id, 'inputs', 'templates', l.run.id);
        if (template.frozenPath !== expected)
          throw new AppError('INPUT_SNAPSHOT_INVALID', '模板冻结目录不匹配');
        await copyTree(expected, path.join(root, 'input/template'));
        await writeJson(path.join(root, 'input/template.json'), {
          id: template.id,
          version: template.version,
          source: template.source,
          archiveSha256: template.archiveSha256,
          name: template.name,
          description: template.description,
          updatedAt: template.updatedAt,
          packageName: template.packageName,
          root: `input/template/${template.rootDirectory}`,
          document: `input/template/${template.document}`,
          files: template.files,
        });
      } else {
        throw new AppError('INPUT_SNAPSHOT_INVALID', '缺少冻结 ZIP 模板');
      }
      await writeJson(path.join(root, 'input/assets.json'), {
        assets: assets.map((a) => ({
          id: a.assetId,
          path: a.path,
          kind: a.kind,
          sha256: a.sha256,
        })),
      });
      // 快照只在可信准备阶段写入，同 run 重试从已冻结模板和素材恢复。
      await copyTree(path.join(root, 'input'), base);
      await freezeInputTree(base);
      await queue.withLease(l, async (q) => {
        await q.query('UPDATE tasks SET config=$2 WHERE id=$1', [
          task.id,
          { ...task.config, analysisRunId: l.run.id },
        ]);
      });
    }
  } else {
    // 先恢复原始稿件/模板及素材，再加入编辑明确替换的新素材。
    const replacements = assets.map((a) => ({ ...a }));
    for (const a of replacements) {
      a.path = `input/replacement_${createHash('sha256').update(a.assetId).digest('hex')}${path.extname(a.path)}`;
      await copyFile(
        path.join(root, assets.find((x) => x.assetId === a.assetId).path),
        path.join(root, a.path),
      );
    }
    const originalPrepared = (
      await db.query('SELECT prepared FROM runs WHERE id=$1', [task.config.analysisRunId])
    ).rows[0]?.prepared;
    if (!originalPrepared?.stageSnapshot)
      throw new AppError('INPUT_SNAPSHOT_INVALID', '缺少分析快照登记');
    await verifySnapshot(base, originalPrepared.stageSnapshot);
    for (const file of await readdir(path.join(root, 'input')))
      await chmod(path.join(root, 'input', file), 0o600);
    await copyTree(base, path.join(root, 'input'));
    const manifest = await readJson(path.join(root, 'input/assets.json'));
    for (const a of replacements) {
      const index = manifest.assets.findIndex((x: any) => x.id === a.assetId);
      const entry = { id: a.assetId, path: a.path, kind: a.kind, sha256: a.sha256 };
      if (index < 0) manifest.assets.push(entry);
      else manifest.assets[index] = entry;
    }
    await writeJson(path.join(root, 'input/assets.json'), manifest);
    for (const a of assets) a.path = replacements.find((x) => x.assetId === a.assetId).path;
  }
  const snapshot = await snapshotInput(root);
  if (l.run.stage === 'analysis')
    await queue.withLease(l, async (q) => {
      const prepared = (await q.query('SELECT prepared FROM runs WHERE id=$1', [l.run.id])).rows[0]
        .prepared;
      if (
        prepared.stageSnapshot &&
        snapshotDigest(prepared.stageSnapshot) !== snapshotDigest(snapshot)
      )
        throw new AppError('INPUT_SNAPSHOT_INVALID', '重试输入快照变化');
      await q.query('UPDATE runs SET prepared=$2 WHERE id=$1', [
        l.run.id,
        { ...prepared, stageSnapshot: snapshot },
      ]);
    });
  const request: any = {
    contractVersion: protocol,
    taskId: task.id,
    runId: l.run.id,
    stage: l.run.stage,
    input: {
      scriptFile: 'input/script.txt',
      requirementsFile: 'input/requirements.json',
      templateSnapshot: 'input/template.json',
      assetsManifest: 'input/assets.json',
    },
    snapshot,
    confirmation: null,
    previousArtifacts: null,
    outputSpec: task.config.outputSpec,
    limits: {
      executionSeconds: Math.max(1, (new Date(l.run.deadline!).getTime() - Date.now()) / 1000),
      repairRounds: config.repairRounds - l.run.repair_rounds,
    },
    delivery: {
      kind: l.run.stage === 'analysis' ? 'analysis_plan' : 'scene_mp4',
      includeWholeVideo: false,
    },
  };
  if (l.run.stage === 'render') {
    const plan = structuredClone(await confirmedPlan(db, l));
    // 编辑新增素材后，以本次可信输入登记重新绑定；不改变任何制作决定。
    plan.inputDigest = snapshotDigest(snapshot);
    const name = `confirmation/v${l.run.plan_version}/plan.json`;
    await writeJson(path.join(root, name), plan);
    request.confirmation = {
      planVersion: l.run.plan_version,
      planFile: name,
      planSha256: await hashFile(path.join(root, name)),
    };
    await writeJson(path.join(root, 'confirmation/current.json'), request.confirmation);
  }
  const priorRoot =
    l.run.attempt > 1 ? path.join(path.dirname(root), `attempt_${l.run.attempt - 1}`) : null;
  if (priorRoot && l.run.stage === 'render') {
    // 仅恢复本任务资料；进程记录留在只读历史目录，不作为新 namespace 的活跃 PID。
    for (const directory of [
      'input',
      'output',
      'analysis',
      'render',
      'project',
      'tool-audio',
      '.control',
    ]) {
      try {
        await copyTree(path.join(priorRoot, directory), path.join(root, 'history', directory));
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    await copyTree(path.join(priorRoot, 'project'), path.join(root, 'project'));
    // 恢复同一业务 run 的制作资料；新请求和控制账本由可信准备层重建。
    for (const directory of ['output', 'render', 'tool-audio', 'cache']) {
      try {
        await copyTree(path.join(priorRoot, directory), path.join(root, directory));
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    const work = path.join(root, 'render', l.run.id, 'work');
    try {
      for (const file of await readdir(work)) {
        if (!file.endsWith('.process.json')) continue;
        const record = await readJson(path.join(work, file));
        await writeJson(path.join(work, file), {
          ...record,
          state: 'archived',
          note: '旧进程已由恢复管理器确认停止，不作为新执行的活跃 PID',
        });
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    request.previousArtifacts = 'history/output/agent-response.json';
    try {
      await safeFile(root, request.previousArtifacts);
    } catch {
      request.previousArtifacts = null;
    }
  }
  await mkdir(path.join(root, 'tool-audio'), { recursive: true });
  await mkdir(path.join(root, '.control'), { recursive: true, mode: 0o700 });
  await writeJson(path.join(root, '.control/policy.json'), { budgetOwner: 'worker' });
  if (l.run.recovery?.approvedVersion)
    await writeJson(path.join(root, '.control/feedback.json'), {
      runId: l.run.id,
      action: 'resume_after_human',
      previousIssue: l.run.recovery.issue,
      approvedVersion: l.run.recovery.approvedVersion,
      instruction:
        '人工已批准恢复。核对当前工具和制作资料，保留有效配音，重验或重渲受影响产物；不要重跑 Analysis。',
    });
  const relative = stagePath(request);
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await mkdir(path.join(path.dirname(path.join(root, relative)), 'work'), { recursive: true });
  for (const f of ['.execution.lock', '.operation.lock']) await writeFile(path.join(root, f), '');
  assertStage(config.toolkitRoot, 'request', request);
  await writeJson(path.join(root, relative), request);
  await writeJson(path.join(root, 'job.json'), {
    contractVersion: protocol,
    taskId: task.id,
    requests: { [relative]: await hashFile(path.join(root, relative)) },
  });
  return {
    root,
    task: request,
    taskConfig: { ...task.config, hostFingerprint: config.hostFingerprint },
    assets,
    hashes: Object.fromEntries(assets.map((a) => [a.assetId, a.sha256])),
    reuse: [],
    sceneHashes: {},
  };
}

// 执行与发布始终读取本 run 绑定的确认版本，不依赖客户端 plan。
export async function confirmedPlan(db: Database, l: Lease) {
  const stored = (
    await db.query(
      "SELECT plan FROM plan_versions WHERE task_id=$1 AND version=$2 AND kind='confirmed' AND run_id=$3",
      [l.run.task_id, l.run.plan_version, l.run.id],
    )
  ).rows[0]?.plan?.plan;
  if (!stored || stored.taskId !== l.run.task_id || stored.contractVersion !== protocol)
    throw new AppError('CONFIRMED_PLAN_MISSING', '服务端确认快照缺失或身份不符');
  return stored;
}
