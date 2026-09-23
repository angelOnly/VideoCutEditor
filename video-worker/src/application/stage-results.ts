import { randomUUID } from 'node:crypto';
import type { Queue } from '../infrastructure/queue.js';
import type { Storage } from '../infrastructure/storage.js';
import type { Lease } from '../domain/task.js';
import { AppError } from '../domain/task.js';
import type { Workspace } from '../infrastructure/workspace.js';
import type { Tenant } from '../config.js';
import { hashFile } from '../infrastructure/files.js';
import { callback } from '../integrations/ifeng/mapper.js';
import { replaceArtifactRefs } from '../contracts/pipeline-io.js';
export async function publishStage(
  queue: Queue,
  storage: Storage,
  l: Lease,
  _w: Workspace,
  tenant: Tenant,
  delivery: any,
) {
  const urls = new Map<string, string>();
  const artifacts: any[] = [];
  for (const file of delivery.files) {
    if ((await hashFile(file.source)) !== file.sha256)
      throw new AppError('FILE_HANDOFF_FAILED', '已交接文件损坏');
    const published = await storage.publish(
      tenant,
      l.run.task_id,
      l.run.id,
      l.token,
      file.id,
      file.source,
      file.extension,
    );
    urls.set(file.id, published.url);
    artifacts.push({ id: file.id, ...published });
  }
  const outcome = delivery.outcome;
  const result = replaceArtifactRefs(outcome.result, urls);
  return queue.withLease(l, async (q, r) => {
    let task = (await q.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [r.task_id])).rows[0];
    const state =
      outcome.status === 'completed'
        ? 'succeeded'
        : outcome.status === 'needs_input'
          ? 'needs_input'
          : 'failed';
    if (state === 'succeeded' && r.stage === 'analysis') {
      await q.query(
        "INSERT INTO plan_versions(task_id,version,run_id,kind,plan) VALUES($1,$2,$3,'analysis',$4)",
        [r.task_id, r.plan_version, r.id, result],
      );
    }
    if (state === 'succeeded' && r.stage === 'render') {
      const version = task.result_version + 1;
      for (const [order, scene] of result.dataList.entries())
        await q.query(
          'INSERT INTO scene_artifacts(task_id,result_version,scene_id,input_hash,artifact) VALUES($1,$2,$3,$4,$5)',
          [r.task_id, version, String(order), '', { order, scene }],
        );
      task = (
        await q.query('UPDATE tasks SET result_version=$2 WHERE id=$1 RETURNING *', [
          r.task_id,
          version,
        ])
      ).rows[0];
    }
    const taskState =
      state === 'succeeded' ? (r.stage === 'analysis' ? 'awaiting_editor' : 'ready') : state;
    await q.query(
      'UPDATE tasks SET state=CASE WHEN latest_run=$3 THEN $2 ELSE state END,updated_at=now() WHERE id=$1',
      [r.task_id, taskState, r.id],
    );
    await q.query('INSERT INTO run_results(run_id,result) VALUES($1,$2)', [
      r.id,
      { ...outcome, result, artifacts },
    ]);
    await q.query(
      'UPDATE runs SET state=$2,progress_stage=$3,error=$4,ended_at=now(),delivery_next_attempt_at=NULL WHERE id=$1',
      [r.id, state, state === 'succeeded' ? 'published' : state, outcome.error],
    );
    const eventId = randomUUID();
    await q.query(
      'INSERT INTO callback_events(id,run_id,tenant,stage,payload) VALUES($1,$2,$3,$4,$5)',
      [eventId, r.id, r.tenant, r.stage, callback(eventId, r, task, result, outcome.error)],
    );
    await queue.release(q, l);
    return result;
  });
}
