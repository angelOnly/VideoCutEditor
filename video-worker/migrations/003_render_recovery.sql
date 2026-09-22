ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_state_check;
ALTER TABLE runs ADD CONSTRAINT runs_state_check CHECK(state IN ('queued','running','cancelling','waiting_human','succeeded','failed','cancelled'));
ALTER TABLE runs ADD COLUMN IF NOT EXISTS recovery jsonb NOT NULL DEFAULT '{}';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS remaining_seconds double precision;
DROP INDEX IF EXISTS one_active_run_per_task;
CREATE UNIQUE INDEX one_active_run_per_task ON runs(task_id) WHERE state IN ('queued','running','cancelling','waiting_human');
CREATE TABLE IF NOT EXISTS run_resumptions (
 run_id uuid NOT NULL REFERENCES runs(id), request_id text NOT NULL,
 request_hash text NOT NULL, actor text NOT NULL, note text NOT NULL,
 approved_version jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,request_id)
);
