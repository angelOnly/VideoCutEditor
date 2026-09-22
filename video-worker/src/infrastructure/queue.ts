import type { Database, Sql } from './postgres.js';
import { lock } from './postgres.js';
import { AppError, type Run, type Lease } from '../domain/task.js';
import { TaskRepository } from './task-repository.js';
export class Queue {
  constructor(
    public db: Database,
    public leaseSeconds = 60,
    public timeoutSeconds = 14400,
  ) {}
  async claim(owner: string): Promise<Lease | null> {
    return this.db.tx(async (q) => {
      await lock(q);
      const slot = (
        await q.query(
          'SELECT * FROM execution_slots WHERE run_id IS NULL ORDER BY id LIMIT 1 FOR UPDATE',
        )
      ).rows[0];
      if (!slot) return null;
      const run = (
        await q.query<Run>(
          "SELECT * FROM runs WHERE state='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE",
        )
      ).rows[0];
      if (!run) return null;
      const token = slot.fencing_token + 1;
      await q.query(
        "UPDATE execution_slots SET run_id=$2,owner=$3,fencing_token=$4,lease_expires_at=now()+($5 * interval '1 second') WHERE id=$1",
        [slot.id, run.id, owner, token, this.leaseSeconds],
      );
      const updated = (
        await q.query<Run>(
          "UPDATE runs SET state='running',attempt=attempt+1,fencing_token=$2,started_at=coalesce(started_at,now()),deadline=coalesce(deadline,now()+($3 * interval '1 second')),progress_stage='preparing' WHERE id=$1 RETURNING *",
          [
            run.id,
            token,
            run.stage === 'analysis' ? Math.min(600, this.timeoutSeconds) : this.timeoutSeconds,
          ],
        )
      ).rows[0];
      await q.query('UPDATE tasks SET state=$2 WHERE id=$1', [
        run.task_id,
        run.stage === 'analysis' ? 'analyzing' : 'rendering',
      ]);
      return { slot: slot.id, owner, token, run: updated };
    });
  }
  async guard(q: Sql, l: Lease, allowCancelling = false): Promise<Run> {
    const row = (
      await q.query(
        'SELECT * FROM execution_slots WHERE id=$1 AND run_id=$2 AND owner=$3 AND fencing_token=$4 AND lease_expires_at>now() FOR UPDATE',
        [l.slot, l.run.id, l.owner, l.token],
      )
    ).rows[0];
    if (!row) throw new AppError('LEASE_LOST', '执行租约已失效', 409);
    const run = (await q.query<Run>('SELECT * FROM runs WHERE id=$1 FOR UPDATE', [l.run.id]))
      .rows[0];
    if (run.state !== 'running' && !(allowCancelling && run.state === 'cancelling'))
      throw new AppError(
        run.state === 'cancelling' ? 'CANCELLED' : 'RUN_NOT_ACTIVE',
        '执行已取消或结束',
        409,
      );
    return run;
  }
  async withLease<T>(l: Lease, fn: (q: Sql, r: Run) => Promise<T>, allowCancelling = false) {
    return this.db.tx(async (q) => {
      await lock(q);
      const r = await this.guard(q, l, allowCancelling);
      return fn(q, r);
    });
  }
  async heartbeat(l: Lease, progress?: string) {
    return this.withLease(l, async (q, r) => {
      await q.query(
        "UPDATE execution_slots SET lease_expires_at=now()+($2 * interval '1 second') WHERE id=$1",
        [l.slot, this.leaseSeconds],
      );
      if (progress)
        await q.query('UPDATE runs SET progress_stage=$2 WHERE id=$1', [r.id, progress]);
      return r;
    });
  }
  async consumeRepair(l: Lease, max: number) {
    return this.withLease(l, async (q, r) => {
      if (r.repair_rounds >= max) throw new AppError('REPAIR_BUDGET_EXHAUSTED', '修复次数已用尽');
      return (
        await q.query<Run>(
          'UPDATE runs SET repair_rounds=repair_rounds+1 WHERE id=$1 RETURNING *',
          [r.id],
        )
      ).rows[0];
    });
  }
  async release(q: Sql, l: Lease) {
    await q.query(
      'UPDATE execution_slots SET run_id=NULL,owner=NULL,lease_expires_at=NULL WHERE id=$1 AND fencing_token=$2',
      [l.slot, l.token],
    );
  }
  async failed(l: Lease, error: any) {
    return this.withLease(
      l,
      async (q, r) => {
        await new TaskRepository(this.db).failure(
          q,
          r,
          error,
          r.state === 'cancelling' || error.code === 'CANCELLED' ? 'cancelled' : 'failed',
        );
        await this.release(q, l);
      },
      true,
    );
  }
  // The caller MUST hold the single-host supervisor lock. Keep the slot occupied until stop succeeds.
  async recover(
    owner: string,
    stop: (runId: string) => Promise<void>,
    maxAttempts = 3,
    activeIds: Set<string> = new Set(),
  ) {
    const expired = (
      await this.db.query(
        'SELECT * FROM execution_slots WHERE run_id IS NOT NULL AND lease_expires_at<=now()',
      )
    ).rows;
    for (const s of expired) {
      if (activeIds.has(s.run_id)) continue;
      const recovery = await this.db.tx(async (q) => {
        await lock(q);
        const current = (
          await q.query(
            'SELECT * FROM execution_slots WHERE id=$1 AND run_id=$2 AND lease_expires_at<=now() FOR UPDATE',
            [s.id, s.run_id],
          )
        ).rows[0];
        if (!current) return null;
        await q.query(
          "UPDATE execution_slots SET owner=$2,fencing_token=fencing_token+1,lease_expires_at=now()+($3 * interval '1 second') WHERE id=$1",
          [s.id, owner, this.leaseSeconds],
        );
        return { token: current.fencing_token + 1 };
      });
      if (!recovery) continue;
      await stop(s.run_id); // Errors retain the slot; never claim the next run on an unconfirmed host.
      await this.db.tx(async (q) => {
        await lock(q);
        const cur = (
          await q.query(
            'SELECT * FROM execution_slots WHERE id=$1 AND owner=$2 AND fencing_token=$3 FOR UPDATE',
            [s.id, owner, recovery.token],
          )
        ).rows[0];
        if (!cur) return;
        const r = (await q.query<Run>('SELECT * FROM runs WHERE id=$1', [s.run_id])).rows[0];
        if (
          r.state === 'running' &&
          r.attempt < maxAttempts &&
          r.deadline &&
          new Date(r.deadline).getTime() > Date.now()
        ) {
          await q.query("UPDATE runs SET state='queued',progress_stage='recovered' WHERE id=$1", [
            r.id,
          ]);
          await q.query('UPDATE tasks SET state=$2 WHERE id=$1', [r.task_id, `${r.stage}_queued`]);
        } else if (r.state === 'running' || r.state === 'cancelling')
          await new TaskRepository(this.db).failure(
            q,
            r,
            {
              code: r.state === 'cancelling' ? 'CANCELLED' : 'EXECUTION_EXPIRED',
              message: '旧执行已停止，任务终止',
              retryable: false,
            },
            r.state === 'cancelling' ? 'cancelled' : 'failed',
          );
        await q.query(
          'UPDATE execution_slots SET run_id=NULL,owner=NULL,lease_expires_at=NULL WHERE id=$1',
          [s.id],
        );
      });
    }
  }
}
