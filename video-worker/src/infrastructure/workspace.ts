import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, copyFile, chmod } from 'node:fs/promises';
import type { Config, Tenant } from '../config.js';
import type { Database } from './postgres.js';
import type { Lease } from '../domain/task.js';
import { AppError } from '../domain/task.js';
import { Storage } from './storage.js';
import { hashFile, safeFile, readJson } from './files.js';
import { Queue } from './queue.js';
import { prepareStage } from './stage-workspace.js';
import { TemplateProvider } from './template-provider.js';
export interface Workspace {
  root: string;
  task: any;
  taskConfig: any;
  hashes: Record<string, string>;
  assets: any[];
  reuse: any[];
  sceneHashes: Record<string, string>;
}
export class Workspaces {
  constructor(
    private config: Config,
    private db: Database,
    private storage: Storage,
  ) {}
  async prepare(l: Lease, tenant: Tenant): Promise<Workspace> {
    const task = (await this.db.query('SELECT * FROM tasks WHERE id=$1', [l.run.task_id])).rows[0];
    task.config = l.run.prepared?.taskConfig ?? task.config;
    if (task.config.executionProtocol !== 'video-pipeline-io/1')
      throw new AppError('PIPELINE_REVISION_EXPIRED', '旧任务只保留记录，请重新提交任务');
    const root = path.join(this.config.dataRoot, task.id, 'workspace');
    await mkdir(root, { recursive: true });
    await chmod(root, 0o700);
    for (const d of ['input', 'output', 'project', 'work', 'cache']) {
      await mkdir(path.join(root, d), { recursive: true });
      await chmod(path.join(root, d), 0o700);
    }
    const entryFile = `input/message-${l.run.id}/task.json`;
    let entry: any;
    try {
      entry = await readJson(await safeFile(root, entryFile));
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (entry) {
      const request = await readJson(await safeFile(root, entry.requestFile));
      if (
        entry.taskId !== task.id ||
        entry.requestId !== l.run.request_id ||
        JSON.stringify(request) !== JSON.stringify(l.run.input)
      )
        throw new AppError('INPUT_SNAPSHOT_INVALID', '已登记的消息输入改变');
      const attachments = await readJson(await safeFile(root, entry.attachmentsFile));
      const assets = attachments.assets.map((a: any) => ({ ...a, assetId: a.id }));
      for (const asset of assets)
        if ((await hashFile(await safeFile(root, asset.path))) !== asset.sha256)
          throw new AppError('INPUT_SNAPSHOT_INVALID', '已登记的素材损坏');
      return {
        root,
        task: { ...entry, entryFile },
        taskConfig: task.config,
        assets,
        hashes: Object.fromEntries(assets.map((a: any) => [a.id, a.sha256])),
        reuse: [],
        sceneHashes: {},
      };
    }
    const isStage = task.config.executionProtocol === 'video-pipeline-io/1';
    let frozenTemplate: any;
    if (isStage && l.run.stage === 'analysis') {
      const existing = (await this.db.query('SELECT prepared FROM runs WHERE id=$1', [l.run.id]))
        .rows[0].prepared;
      const frozenPath = path.join(this.config.dataRoot, task.id, 'inputs', 'templates', l.run.id);
      frozenTemplate =
        existing?.template ??
        (await new TemplateProvider(this.config).read(task.config.templateId, frozenPath));
      if (!existing?.template)
        await new Queue(this.db).withLease(l, async (q) => {
          await q.query('UPDATE runs SET prepared=$2 WHERE id=$1', [
            l.run.id,
            { ...existing, template: frozenTemplate },
          ]);
        });
    }
    const refs =
      l.run.stage === 'analysis'
        ? [
            ...l.run.input.otherMaterial.picInfoList.map((x: any) => ({ ...x, kind: 'image' })),
            ...l.run.input.otherMaterial.videoInfoList.map((x: any) => ({ ...x, kind: 'video' })),
          ]
        : l.run.input.dataList.flatMap((s: any) => [
            ...(s.extraData?.picInfoList ?? []).map((x: any) => ({ ...x, kind: 'image' })),
            ...(s.extraData?.videoInfoList ?? []).map((x: any) => ({ ...x, kind: 'video' })),
          ]);
    if (frozenTemplate) refs.push(...frozenTemplate.attachments);
    if (l.run.stage === 'analysis' && task.config.narration)
      refs.push({ ...task.config.narration, kind: 'audio' });
    const prepared = (await this.db.query('SELECT prepared FROM runs WHERE id=$1', [l.run.id]))
      .rows[0].prepared;
    const assets: any[] = [];
    const seen = new Map<string, string>();
    for (const ref of refs) {
      if (seen.has(ref.assetId)) {
        if (seen.get(ref.assetId) !== ref.url)
          throw new AppError('ASSET_ID_CONFLICT', '同一素材 ID 指向不同文件');
        continue;
      }
      seen.set(ref.assetId, ref.url);
      const frozen = prepared?.assets?.find((a: any) => a.assetId === ref.assetId);
      let resolved: { file: string; relative: string };
      if (frozen) resolved = { file: frozen.snapshotPath, relative: frozen.sourceKey };
      else {
        const previous = (
          await this.db.query('SELECT * FROM asset_snapshots WHERE task_id=$1 AND asset_id=$2', [
            task.id,
            ref.assetId,
          ])
        ).rows;
        const owned = previous.find((a: any) => {
          const key = path.posix.join(
            'tasks',
            task.id,
            'inputs',
            a.sha256 + path.extname(a.snapshot_path),
          );
          return (
            ref.url === this.storage.export(tenant, key) ||
            ref.url === path.join(tenant.inputRoot, key)
          );
        });
        resolved = owned
          ? {
              file: await safeFile(
                this.config.dataRoot,
                path.relative(this.config.dataRoot, owned.snapshot_path),
              ),
              relative: owned.source_path,
            }
          : await this.storage.input(tenant, ref.url);
      }
      const { file, relative } = resolved;
      // Copy first, then hash the exact bytes supplied to the task.
      const local = `input/message-${l.run.id}/asset_${assets.length}${path
        .extname(file)
        .toLowerCase()
        .replace(/[^.a-z0-9]/g, '')}`;
      await mkdir(path.dirname(path.join(root, local)), { recursive: true });
      try {
        await chmod(path.join(root, local), 0o600);
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
      await copyFile(file, path.join(root, local));
      const sha256 = await hashFile(path.join(root, local));
      await chmod(path.join(root, local), 0o444);
      const snapshotDir = path.join(this.config.dataRoot, task.id, 'inputs');
      await mkdir(snapshotDir, { recursive: true });
      const snapshot = path.join(snapshotDir, sha256 + path.extname(local));
      try {
        await copyFile(path.join(root, local), snapshot, constants.COPYFILE_EXCL);
        await chmod(snapshot, 0o444);
      } catch (e: any) {
        if (e.code !== 'EEXIST' || (await hashFile(snapshot)) !== sha256) throw e;
      }
      await this.db.query(
        'INSERT INTO asset_snapshots(task_id,asset_id,source_path,sha256,snapshot_path,kind) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [task.id, ref.assetId, relative, sha256, snapshot, ref.kind],
      );
      if (frozen && sha256 !== frozen.sha256)
        throw new AppError('INPUT_SNAPSHOT_INVALID', '已固化素材快照损坏');
      const publishedKey = path.posix.join(
        'tasks',
        task.id,
        'inputs',
        sha256 + path.extname(local),
      );
      const publishedInput = path.join(this.config.mediaRoot, publishedKey);
      await mkdir(path.dirname(publishedInput), { recursive: true });
      try {
        await copyFile(snapshot, publishedInput, constants.COPYFILE_EXCL);
        await chmod(publishedInput, 0o444);
      } catch (e: any) {
        if (e.code !== 'EEXIST' || (await hashFile(publishedInput)) !== sha256) throw e;
      }
      assets.push({
        assetId: ref.assetId,
        path: local,
        sourceKey: publishedKey,
        sha256,
        kind: ref.kind,
        snapshotPath: snapshot,
      });
    }
    if (!prepared?.assets)
      await new Queue(this.db).withLease(l, async (q) => {
        await q.query('UPDATE runs SET prepared=$2 WHERE id=$1', [
          l.run.id,
          { ...prepared, assets },
        ]);
      });
    return prepareStage(this.config, this.db, l, root, task, assets);
  }
  async saveSession(_l: Lease, _w: Workspace) {
    // app-server 身份已在租约内持久保存，不复制登录会话。
  }
}
