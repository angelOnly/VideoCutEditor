CREATE TABLE IF NOT EXISTS scheduler_lock (id integer PRIMARY KEY CHECK (id=1));
INSERT INTO scheduler_lock VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS tasks (
 id uuid PRIMARY KEY, tenant text NOT NULL, external_id text NOT NULL,
 state text NOT NULL, config jsonb NOT NULL, plan_version integer NOT NULL DEFAULT 0,
 result_version integer NOT NULL DEFAULT 0, thread_id text, session_path text, latest_run uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant,external_id)
);
CREATE TABLE IF NOT EXISTS runs (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), tenant text NOT NULL,
 request_id text NOT NULL, request_hash text NOT NULL, stage text NOT NULL CHECK(stage IN ('analysis','render')),
 state text NOT NULL CHECK(state IN ('queued','running','cancelling','succeeded','failed','cancelled')),
 input jsonb NOT NULL, prepared jsonb, plan_version integer NOT NULL DEFAULT 0, attempt integer NOT NULL DEFAULT 0,
 repair_rounds integer NOT NULL DEFAULT 0, fencing_token integer NOT NULL DEFAULT 0,
 progress_stage text NOT NULL DEFAULT 'queued', deadline timestamptz, error jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, ended_at timestamptz,
 UNIQUE(tenant,request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run_per_task ON runs(task_id) WHERE state IN ('queued','running','cancelling');
CREATE INDEX IF NOT EXISTS run_fifo ON runs(created_at,id) WHERE state='queued';
CREATE TABLE IF NOT EXISTS plan_versions (
 task_id uuid NOT NULL REFERENCES tasks(id), version integer NOT NULL, run_id uuid NOT NULL REFERENCES runs(id),
 kind text NOT NULL CHECK(kind IN ('analysis','confirmed')), plan jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(task_id,version)
);
CREATE TABLE IF NOT EXISTS execution_slots (
 id integer PRIMARY KEY CHECK(id BETWEEN 1 AND 4), run_id uuid UNIQUE REFERENCES runs(id),
 owner text, lease_expires_at timestamptz, fencing_token integer NOT NULL DEFAULT 0
);
INSERT INTO execution_slots(id) VALUES (1),(2),(3),(4) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS scene_artifacts (
 task_id uuid NOT NULL REFERENCES tasks(id), result_version integer NOT NULL, scene_id text NOT NULL,
 input_hash text NOT NULL, artifact jsonb NOT NULL, PRIMARY KEY(task_id,result_version,scene_id)
);
CREATE TABLE IF NOT EXISTS run_results (
 run_id uuid PRIMARY KEY REFERENCES runs(id), result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS asset_snapshots (
 task_id uuid NOT NULL REFERENCES tasks(id), asset_id text NOT NULL, source_path text NOT NULL,
 sha256 text NOT NULL, snapshot_path text NOT NULL, kind text NOT NULL,
 PRIMARY KEY(task_id,asset_id,sha256)
);
CREATE TABLE IF NOT EXISTS callback_events (
 id uuid PRIMARY KEY, run_id uuid NOT NULL UNIQUE REFERENCES runs(id), tenant text NOT NULL,
 stage text NOT NULL, payload jsonb NOT NULL, state text NOT NULL DEFAULT 'pending'
 CHECK(state IN ('pending','retrying','delivered','dead_letter')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_owner uuid, lease_until timestamptz, last_error text, delivered_at timestamptz
);
CREATE TABLE IF NOT EXISTS external_calls (
 task_id uuid NOT NULL REFERENCES tasks(id), input_hash text NOT NULL, run_id uuid NOT NULL REFERENCES runs(id),
 state text NOT NULL CHECK(state IN ('pending','succeeded','unknown')), result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(task_id,input_hash)
);

-- Internal native execution identity; never supplied by callers or the model.
CREATE TABLE IF NOT EXISTS host_executions (
 run_id uuid PRIMARY KEY REFERENCES runs(id), attempt integer NOT NULL, fencing_token integer NOT NULL,
 thread_id text NOT NULL, turn_id text, workspace text NOT NULL
);
