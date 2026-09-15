import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Queue } from '../infrastructure/queue.js';
import type { Storage } from '../infrastructure/storage.js';
import type { Lease } from '../domain/task.js';
import { AppError } from '../domain/task.js';
import type { Workspace } from '../infrastructure/workspace.js';
import type { Tenant } from '../config.js';
import { safeFile } from '../infrastructure/files.js';
import { callback } from '../integrations/ifeng/mapper.js';
import { digest } from '../domain/scene.js';
export async function publishStage(
  queue: Queue,
  storage: Storage,
  l: Lease,
  w: Workspace,
  tenant: Tenant,
  candidate: any,
) {
  const dataList: any[] = [],
    artifacts: any[] = [];
  const plan = l.run.stage === 'analysis' ? candidate : l.run.input.plan;
  for (const [order, s] of plan.scenes.entries()) {
    const produced =
      l.run.stage === 'render' ? candidate.scenes.find((x: any) => x.id === s.id) : null;
    const resources: any[] = [];
    if (produced) {
      for (const [index, resource] of produced.usedResources.entries()) {
        const file = await safeFile(w.root, resource.path);
        const published = await storage.publish(
          tenant,
          l.run.task_id,
          l.run.id,
          l.token,
          `${s.id}_resource_${index}`,
          file,
          path.extname(file) || '.bin',
        );
        const kind =
          resource.kind === 'source'
            ? w.assets.find((a) => a.assetId === resource.id)?.kind
            : /\.(mp4|mov)$/i.test(file)
              ? 'video'
              : /\.(png|jpe?g|webp)$/i.test(file)
                ? 'image'
                : /\.(wav|mp3|aac|m4a)$/i.test(file)
                  ? 'audio'
                  : 'other';
        resources.push({
          ...resource,
          origin: resource.kind,
          kind,
          assetId: resource.id,
          path: undefined,
          url: published.url,
        });
      }
    } else {
      for (const id of s.assetRefs) {
        const a = w.assets.find((x) => x.assetId === id);
        if (!a) throw new AppError('ASSET_UNAVAILABLE', '方案引用未登记素材');
        resources.push({
          assetId: id,
          kind: a.kind,
          sha256: a.sha256,
          url: storage.export(tenant, a.sourceKey),
        });
      }
    }
    const item: any = {
      id: s.id,
      content: s.text,
      dur: produced?.durationSeconds ?? s.timing.totalSeconds,
      durationSource: produced ? 'measured' : s.timing.kind,
      production: s.production,
      extraData: {
        keywordList: [],
        digitalHumanId: '',
        videoInfoList: resources.filter((x) => x.kind === 'video'),
        picInfoList: resources.filter((x) => x.kind === 'image'),
        resources,
      },
    };
    if (produced) {
      const published = await storage.publish(
        tenant,
        l.run.task_id,
        l.run.id,
        l.token,
        s.id,
        await safeFile(w.root, produced.path),
      );
      item.url = published.url;
      artifacts.push({
        ...published,
        order,
        inputHash: digest({ confirmation: w.task.confirmation, sceneId: s.id }),
        scene: item,
      });
    }
    dataList.push(item);
  }
  const previews: any[] = [];
  if (l.run.stage === 'analysis')
    for (const [index, name] of candidate.previews.entries()) {
      const file = await safeFile(w.root, name);
      previews.push({
        path: name,
        ...(await storage.publish(
          tenant,
          l.run.task_id,
          l.run.id,
          l.token,
          `preview_${index}`,
          file,
          path.extname(file),
        )),
      });
    }
  const result = {
    dataList,
    ...(previews.length ? { previews: previews.map(({ key, ...p }) => p) } : {}),
    ...(l.run.stage === 'analysis' ? { plan: candidate } : {}),
  };
  return queue.withLease(l, async (q, r) => {
    let task = (await q.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [r.task_id])).rows[0];
    if (task.latest_run !== r.id || (r.stage === 'render' && task.plan_version !== r.plan_version))
      throw new AppError('STALE_PLAN', '执行版本已过期', 409);
    if (r.stage === 'analysis') {
      const version = task.plan_version + 1;
      await q.query(
        "INSERT INTO plan_versions(task_id,version,run_id,kind,plan) VALUES($1,$2,$3,'analysis',$4)",
        [r.task_id, version, r.id, result],
      );
      await q.query('UPDATE runs SET plan_version=$2 WHERE id=$1', [r.id, version]);
      r.plan_version = version;
      task = (
        await q.query(
          "UPDATE tasks SET plan_version=$2,state='awaiting_editor',updated_at=now() WHERE id=$1 RETURNING *",
          [r.task_id, version],
        )
      ).rows[0];
    } else {
      const version = task.result_version + 1;
      for (const a of artifacts)
        await q.query(
          'INSERT INTO scene_artifacts(task_id,result_version,scene_id,input_hash,artifact) VALUES($1,$2,$3,$4,$5)',
          [r.task_id, version, a.scene.id, a.inputHash, a],
        );
      task = (
        await q.query(
          "UPDATE tasks SET result_version=$2,state='ready',updated_at=now() WHERE id=$1 RETURNING *",
          [r.task_id, version],
        )
      ).rows[0];
    }
    // 完整候选留在数据库审计记录中，不只保存被平台 DTO 投影过的字段。
    await q.query('INSERT INTO run_results(run_id,result) VALUES($1,$2)', [
      r.id,
      { ...result, candidate },
    ]);
    await q.query(
      "UPDATE runs SET state='succeeded',progress_stage='published',ended_at=now() WHERE id=$1",
      [r.id],
    );
    const eventId = randomUUID();
    await q.query(
      'INSERT INTO callback_events(id,run_id,tenant,stage,payload) VALUES($1,$2,$3,$4,$5)',
      [eventId, r.id, r.tenant, r.stage, callback(eventId, r, task, result)],
    );
    await queue.release(q, l);
    return result;
  });
}
