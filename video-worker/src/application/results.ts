import { randomUUID } from 'node:crypto';
import type { Lease } from '../domain/task.js';
import type { Tenant } from '../config.js';
import type { Workspace } from '../infrastructure/workspace.js';
import { Queue } from '../infrastructure/queue.js';
import { Storage } from '../infrastructure/storage.js';
import { safeFile } from '../infrastructure/files.js';
import { callback } from '../integrations/ifeng/mapper.js';
export async function publishResult(
  queue: Queue,
  storage: Storage,
  l: Lease,
  w: Workspace,
  tenant: Tenant,
  candidate: any,
) {
  let artifacts: any[] = [];
  if (l.run.stage === 'render') {
    for (const [order, confirmed] of l.run.input.dataList.entries()) {
      const reuse = w.reuse.find((a) => a.scene.id === confirmed.id);
      if (reuse) {
        for (const a of [
          ...reuse.scene.extraData.videoInfoList,
          ...reuse.scene.extraData.picInfoList,
        ])
          a.url = storage.export(tenant, w.assets.find((x) => x.assetId === a.assetId).sourceKey);
        artifacts.push({
          ...reuse,
          order,
          scene: { ...reuse.scene, url: storage.export(tenant, reuse.key) },
        });
        continue;
      }
      const produced = candidate.scenes.find((s: any) => s.id === confirmed.id);
      const published = await storage.publish(
        tenant,
        l.run.task_id,
        l.run.id,
        l.token,
        confirmed.id,
        await safeFile(w.root, produced.path),
      );
      for (const a of [...produced.extraData.videoInfoList, ...produced.extraData.picInfoList])
        a.url = storage.export(tenant, w.assets.find((x) => x.assetId === a.assetId).sourceKey);
      const scene = {
        id: confirmed.id,
        content: confirmed.content,
        dur: produced.durationSec,
        url: published.url,
        extraData: produced.extraData,
      };
      artifacts.push({ ...published, order, inputHash: w.sceneHashes[confirmed.id], scene });
    }
  }
  return queue.withLease(l, async (q, r) => {
    let task = (await q.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [r.task_id])).rows[0];
    if (r.stage === 'analysis') {
      const version = task.plan_version + 1;
      // The model references only asset IDs/local snapshots. Export paths come from our captured registry.
      for (const s of candidate.dataList)
        for (const a of [...s.extraData.videoInfoList, ...s.extraData.picInfoList])
          a.url = storage.export(tenant, w.assets.find((x) => x.assetId === a.assetId).sourceKey);
      await q.query(
        "INSERT INTO plan_versions(task_id,version,run_id,kind,plan) VALUES($1,$2,$3,'analysis',$4)",
        [r.task_id, version, r.id, candidate],
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
    const result = {
      dataList: r.stage === 'analysis' ? candidate.dataList : artifacts.map((a) => a.scene),
    };
    await q.query('INSERT INTO run_results(run_id,result) VALUES($1,$2)', [r.id, result]);
    await q.query(
      "UPDATE runs SET state='succeeded',progress_stage='published',ended_at=now() WHERE id=$1",
      [r.id],
    );
    const id = randomUUID();
    await q.query(
      'INSERT INTO callback_events(id,run_id,tenant,stage,payload) VALUES($1,$2,$3,$4,$5)',
      [id, r.id, r.tenant, r.stage, callback(id, r, task, result)],
    );
    await queue.release(q, l);
    return result;
  });
}
