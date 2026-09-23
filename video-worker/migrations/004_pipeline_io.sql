-- 消息可排队，同任务仅允许一个活动执行；交付重试不重新制作。
DROP INDEX IF EXISTS one_active_run_per_task;
CREATE UNIQUE INDEX one_active_run_per_task ON runs(task_id) WHERE state IN ('running','cancelling');
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_state_check;
ALTER TABLE runs ADD CONSTRAINT runs_state_check CHECK(state IN ('queued','running','cancelling','waiting_human','needs_input','succeeded','failed','cancelled'));
ALTER TABLE runs ADD COLUMN IF NOT EXISTS delivery_next_attempt_at timestamptz;
