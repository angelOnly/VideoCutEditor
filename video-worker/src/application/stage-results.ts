import { productionRecord } from '../infrastructure/production-record.js';
import { confirmedPlan } from '../infrastructure/stage-workspace.js';
import { publicScene } from '../domain/storyboard.js';
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
  const plan = l.run.stage === 'analysis' ? candidate : await confirmedPlan(queue.db, l);
  if (
    l.run.stage === 'render' &&
    (candidate.scenes.length !== plan.scenes.length ||
      plan.scenes.some((s: any) => candidate.scenes.filter((x: any) => x.id === s.id).length !== 1))
  )
    throw new AppError('VALIDATION_FAILED', '成品未完整覆盖确认列表');
  const production = l.run.stage === 'render' ? await productionRecord(w, l, candidate) : undefined;
  for (const [order, s] of plan.scenes.entries()) {
    const produced =
      l.run.stage === 'render' ? candidate.scenes.find((x: any) => x.id === s.id) : null;
    const item: any = publicScene({
      ...s,
      dur: produced?.durationSeconds ?? s.timing.totalSeconds,
      durationSource: produced ? 'measured' : s.timing.kind,
    });
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
  const result = { dataList, ...(l.run.stage === 'analysis' ? { plan: candidate } : {}) };
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
      {
        ...result,
        candidate,
        ...(production
          ? { productionRecord: { ...production, resultVersion: task.result_version } }
          : {}),
      },
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
