import { randomUUID } from 'node:crypto';
import type { Database, Sql } from './postgres.js';
import { lock } from './postgres.js';
import { AppError, fail, type Run, type Stage } from '../domain/task.js';
import { digest } from '../domain/scene.js';
import { accepted, callback } from '../integrations/ifeng/mapper.js';
export class TaskRepository {
  constructor(public db: Database) {}
  async submit(tenant: string, stage: Stage, input: any, config: any) {
    return this.db.tx(async (q) => {
      await lock(q);
      const hash = digest({ stage, input });
      const prior = (
        await q.query<Run>('SELECT * FROM runs WHERE tenant=$1 AND request_id=$2', [
          tenant,
          input.requestId,
        ])
      ).rows[0];
      if (prior) {
        if ((prior as any).request_hash !== hash)
          fail('IDEMPOTENCY_CONFLICT', 'requestId 已用于其他内容', 409);
        return accepted(prior);
      }
      let task = (
        await q.query('SELECT * FROM tasks WHERE tenant=$1 AND external_id=$2', [
          tenant,
          input.taskId,
        ])
      ).rows[0];
      if (!task && stage === 'render') fail('TASK_NOT_FOUND', '请先提交分析任务', 404);
      if (!task) {
        task = (
          await q.query(
            'INSERT INTO tasks(id,tenant,external_id,state,config) VALUES($1,$2,$3,$4,$5) RETURNING *',
            [randomUUID(), tenant, input.taskId, 'analysis_queued', config],
          )
        ).rows[0];
      }
      if (task.config.executionProtocol !== 'video-pipeline-io/1')
        fail('PIPELINE_REVISION_EXPIRED', '旧任务只保留记录，请使用新的任务 ID', 409);
      const version = task.plan_version + 1;
      let taskConfig = stage === 'analysis' ? config : task.config;
      if (stage === 'render') {
        const base = (
          await q.query(
            'SELECT p.plan,r.prepared FROM plan_versions p JOIN runs r ON r.id=p.run_id WHERE p.task_id=$1 AND p.version=$2',
            [task.id, input.basePlanVersion],
          )
        ).rows[0];
        if (!base) fail('STALE_PLAN', '基础方案版本不存在', 409);
        taskConfig = base.prepared?.taskConfig ?? task.config;
        if (
          input.templateId !== taskConfig.templateId ||
          input.field_5 !== taskConfig.digitalHumanAccountId
        )
          fail('CONFIG_CONFLICT', '模板或账号与任务配置不一致', 409);
      }
      const run = (
        await q.query<Run>(
          `INSERT INTO runs(id,task_id,tenant,request_id,request_hash,stage,state,input,plan_version)
    VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$8) RETURNING *`,
          [randomUUID(), task.id, tenant, input.requestId, hash, stage, input, version],
        )
      ).rows[0];
      if (stage === 'render')
        await q.query(
          "INSERT INTO plan_versions(task_id,version,run_id,kind,plan) VALUES($1,$2,$3,'confirmed',$4)",
          [
            task.id,
            version,
            run.id,
            { dataList: input.dataList, plan: input.plan ?? {}, requestId: input.requestId },
          ],
        );
      await q.query(
        'UPDATE tasks SET state=$2,config=$3,plan_version=$4,latest_run=$5,updated_at=now() WHERE id=$1',
        [task.id, `${stage}_queued`, stage === 'analysis' ? config : task.config, version, run.id],
      );
      await q.query('UPDATE runs SET prepared=$2 WHERE id=$1', [run.id, { taskConfig }]);
      const response = accepted(run);
      response.msg = '等待当前操作结束后交给 Codex';
      return response;
    });
  }
  async query(tenant: string, externalId: string) {
    const task = (
      await this.db.query('SELECT * FROM tasks WHERE tenant=$1 AND external_id=$2', [
        tenant,
        externalId,
      ])
    ).rows[0];
    if (!task) fail('TASK_NOT_FOUND', '任务不存在', 404);
    const latest = (await this.db.query('SELECT * FROM runs WHERE id=$1', [task.latest_run]))
      .rows[0];
    const event = (
      await this.db.query(
        'SELECT id,state,attempts,last_error FROM callback_events WHERE run_id=$1',
        [task.latest_run],
      )
    ).rows[0];
    const plan =
      (
        await this.db.query('SELECT plan FROM plan_versions WHERE task_id=$1 AND version=$2', [
          task.id,
          task.plan_version,
        ])
      ).rows[0]?.plan ?? null;
    const artifacts = (
      await this.db.query(
        'SELECT artifact FROM scene_artifacts WHERE task_id=$1 AND result_version=$2',
        [task.id, task.result_version],
      )
    ).rows
      .map((x) => x.artifact)
      .sort((a, b) => a.order - b.order);
    const ahead =
      latest.state === 'queued'
        ? Number(
            (
              await this.db.query(
                "SELECT count(*) AS n FROM runs WHERE state='queued' AND (created_at,id)<(SELECT created_at,id FROM runs WHERE id=$1)",
                [latest.id],
              )
            ).rows[0].n,
          ) + 1
        : null;
    const result = (
      await this.db.query('SELECT result FROM run_results WHERE run_id=$1', [latest.id])
    ).rows[0]?.result;
    const progress =
      (
        await this.db.query(
          'SELECT last_event_at,last_progress_at,current_tool_name,tool_status FROM host_executions WHERE run_id=$1',
          [latest.id],
        )
      ).rows[0] ?? null;
    return {
      taskId: externalId,
      result: result?.result ?? null,
      progress,
      taskState: task.state,
      planVersion: task.plan_version,
      resultVersion: task.result_version,
      latestRun: {
        runId: latest.id,
        stage: latest.stage,
        state: latest.state,
        progressStage: latest.progress_stage,
        attempt: latest.attempt,
        error: latest.error,
        recovery:
          latest.state === 'waiting_human'
            ? {
                revision: latest.recovery?.revision,
                message: latest.error?.message,
              }
            : null,
      },
      queuePosition: ahead,
      callbackState: event?.state ?? null,
      callback: event,
      plan: plan ?? null,
      latestResult: artifacts.map((a) => a.scene),
    };
  }
  async cancel(tenant: string, runId: string) {
    return this.db.tx(async (q) => {
      await lock(q);
      const run = (
        await q.query<Run>('SELECT * FROM runs WHERE tenant=$1 AND id=$2', [tenant, runId])
      ).rows[0];
      if (!run) fail('RUN_NOT_FOUND', '执行不存在', 404);
      if (run.state === 'queued' || run.state === 'waiting_human') {
        await this.failure(
          q,
          run,
          { code: 'CANCELLED', message: '任务已取消', retryable: false },
          'cancelled',
        );
        return { runId, state: 'cancelled' };
      }
      if (run.state === 'running')
        await q.query("UPDATE runs SET state='cancelling' WHERE id=$1", [run.id]);
      return { runId, state: run.state === 'running' ? 'cancelling' : run.state };
    });
  }
  async failure(q: Sql, run: Run, error: any, state = 'failed') {
    await q.query(
      'UPDATE runs SET state=$2,error=$3,ended_at=now(),progress_stage=$2 WHERE id=$1',
      [run.id, state, error],
    );
    const task = (
      await q.query(
        'UPDATE tasks SET state=CASE WHEN latest_run=$3 THEN $2 ELSE state END,updated_at=now() WHERE id=$1 RETURNING *',
        [run.task_id, state, run.id],
      )
    ).rows[0];
    const id = randomUUID();
    await q.query(
      'INSERT INTO callback_events(id,run_id,tenant,stage,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id) DO NOTHING',
      [id, run.id, run.tenant, run.stage, callback(id, run, task, null, error)],
    );
  }
}
