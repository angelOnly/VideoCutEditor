import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, copyFile, readFile, access, chmod } from 'node:fs/promises';
import type { Config, Tenant } from '../config.js';
import type { Database } from './postgres.js';
import type { Lease } from '../domain/task.js';
import { AppError } from '../domain/task.js';
import { Storage } from './storage.js';
import { hashFile, writeJson, readJson, copyTree, safeFile, ownTree } from './files.js';
import { assertInternalTask } from '../contracts/internal.js';
import { Queue } from './queue.js';
import { sceneHash } from '../domain/scene.js';
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
    const root = path.join(
      this.config.dataRoot,
      task.id,
      'runs',
      l.run.id,
      `attempt_${l.run.attempt}`,
    );
    await mkdir(root, { recursive: true });
    await chmod(root, 0o755);
    for (const d of ['input', 'output', 'project', 'cache', 'codex-home']) {
      await mkdir(path.join(root, d), { recursive: true });
      await chmod(path.join(root, d), 0o777);
    }
    const refs =
      l.run.stage === 'analysis'
        ? [
            ...l.run.input.otherMaterial.picInfoList.map((x: any) => ({ ...x, kind: 'image' })),
            ...l.run.input.otherMaterial.videoInfoList.map((x: any) => ({ ...x, kind: 'video' })),
          ]
        : l.run.input.dataList.flatMap((s: any) => [
            ...s.extraData.picInfoList.map((x: any) => ({ ...x, kind: 'image' })),
            ...s.extraData.videoInfoList.map((x: any) => ({ ...x, kind: 'video' })),
          ]);
    if (task.config.narration) refs.push({ ...task.config.narration, kind: 'audio' });
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
      const frozen = prepared?.assets.find((a: any) => a.assetId === ref.assetId);
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
      const local = `input/asset_${assets.length}${path
        .extname(file)
        .toLowerCase()
        .replace(/[^.a-z0-9]/g, '')}`;
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
    if (!prepared)
      await new Queue(this.db).withLease(l, async (q) => {
        await q.query('UPDATE runs SET prepared=$2 WHERE id=$1 AND prepared IS NULL', [
          l.run.id,
          { assets },
        ]);
      });
    const hashes = Object.fromEntries(assets.map((a) => [a.assetId, a.sha256]));
    const reuse: any[] = [];
    const sceneHashes: Record<string, string> = {};
    if (l.run.stage === 'render') {
      const candidates = (
        await this.db.query(
          'SELECT * FROM scene_artifacts WHERE task_id=$1 ORDER BY result_version DESC',
          [task.id],
        )
      ).rows;
      for (const scene of l.run.input.dataList) {
        const hash = sceneHash(scene, hashes, {
          ...task.config,
          executionImage: this.config.runnerImage,
          narration: task.config.narration ? hashes[task.config.narration.assetId] : null,
          script: undefined,
        });
        sceneHashes[scene.id] = hash;
        const prior = candidates.find((a) => a.scene_id === scene.id && a.input_hash === hash);
        if (prior) {
          const source = path.join(this.config.mediaRoot, prior.artifact.key);
          try {
            if ((await hashFile(source)) === prior.artifact.sha256)
              reuse.push({ ...prior.artifact, inputHash: hash });
          } catch {
            /* Missing old files are rebuilt. */
          }
        }
      }
    }
    // Recover only this task's persisted state. Never mount another task's CODEX_HOME.
    const previousAttempt = path.join(
      this.config.dataRoot,
      task.id,
      'runs',
      l.run.id,
      `attempt_${l.run.attempt - 1}`,
    );
    const state = l.run.attempt > 1 ? path.join(previousAttempt, 'codex-home') : task.session_path;
    try {
      if (!state) throw Object.assign(new Error('No session'), { code: 'ENOENT' });
      await access(state);
      await copyTree(state, path.join(root, 'codex-home'));
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (l.run.attempt > 1) {
      for (const d of ['cache', 'project'])
        try {
          await copyTree(path.join(previousAttempt, d), path.join(root, d));
        } catch (e: any) {
          if (e.code !== 'ENOENT') throw e;
        }
      try {
        await copyFile(
          path.join(previousAttempt, 'output/session.json'),
          path.join(root, 'output/session.json'),
        );
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    const internal = {
      schemaVersion: 2,
      jobId: l.run.id,
      taskId: l.run.input.taskId,
      mode: 'auto',
      operation: l.run.stage,
      planVersion: l.run.plan_version,
      input: {
        script: 'input/script.txt',
        assetManifest: 'input/assets.json',
        confirmedPlan: l.run.stage === 'render' ? 'input/confirmed-plan.json' : null,
        narrationAssetId: task.config.narration?.assetId ?? null,
      },
      template: {
        id: task.config.templateId,
        version: task.config.templateVersion,
        path: '/opt/toolkit/' + task.config.templatePath,
      },
      renderSelection: {
        sceneIds:
          l.run.stage === 'render'
            ? l.run.input.dataList
                .filter((s: any) => !reuse.some((a) => a.scene.id === s.id))
                .map((s: any) => s.id)
            : [],
        reuseManifest: 'input/reuse-manifest.json',
      },
      output: { ...task.config.outputSpec, requireAudio: true },
      limits: {
        deadline: new Date(l.run.deadline!).toISOString(),
        repairRounds: this.config.repairRounds - l.run.repair_rounds,
      },
      tts: task.config.tts,
      threadId: task.thread_id ?? null,
      requirements: l.run.input.otherRequirements ?? '',
      digitalHumanId: task.config.digitalHumanId ?? '',
    };
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(root, 'input/script.txt'), task.config.script, { mode: 0o444 });
    await writeJson(path.join(root, 'input/assets.json'), {
      assets: assets.map(({ snapshotPath, ...a }) => a),
    });
    await writeJson(path.join(root, 'input/reuse-manifest.json'), {
      scenes: reuse.map((a) => ({ id: a.scene.id, inputHash: a.inputHash })),
    });
    if (l.run.stage === 'render')
      await writeJson(path.join(root, 'input/confirmed-plan.json'), {
        dataList: l.run.input.dataList,
      });
    assertInternalTask(this.config.toolkitRoot, internal);
    await writeJson(path.join(root, 'task.json'), internal);
    await chmod(path.join(root, 'task.json'), 0o444);
    for (const file of [
      'input/assets.json',
      'input/reuse-manifest.json',
      ...(l.run.stage === 'render' ? ['input/confirmed-plan.json'] : []),
    ])
      await chmod(path.join(root, file), 0o444);
    for (const d of ['codex-home', 'project', 'cache', 'output'])
      await ownTree(path.join(root, d), this.config.dockerUid);
    return { root, task: internal, taskConfig: task.config, assets, hashes, reuse, sceneHashes };
  }
  async saveSession(l: Lease, w: Workspace) {
    // Called only after the container and all children have stopped.
    const sessionPath = path.join(
      this.config.dataRoot,
      l.run.task_id,
      'sessions',
      `${l.run.id}-${l.run.attempt}-${l.run.repair_rounds}`,
    );
    await copyTree(path.join(w.root, 'codex-home'), sessionPath);
    try {
      const session = await readJson(path.join(w.root, 'output/session.json'));
      if (typeof session.threadId === 'string')
        await new Queue(this.db).withLease(l, async (q) => {
          await q.query('UPDATE tasks SET thread_id=$2,session_path=$3 WHERE id=$1', [
            l.run.task_id,
            session.threadId,
            sessionPath,
          ]);
        });
    } catch {
      /* A failed first turn may not have a session. */
    }
  }
}
