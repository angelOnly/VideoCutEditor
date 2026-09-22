-- 租约心跳、协议事件与制作进展分别记录，便于定位失联工具。
ALTER TABLE host_executions ADD COLUMN IF NOT EXISTS last_event_at timestamptz;
ALTER TABLE host_executions ADD COLUMN IF NOT EXISTS last_progress_at timestamptz;
ALTER TABLE host_executions ADD COLUMN IF NOT EXISTS current_tool_id text;
ALTER TABLE host_executions ADD COLUMN IF NOT EXISTS current_tool_name text;
ALTER TABLE host_executions ADD COLUMN IF NOT EXISTS tool_started_at timestamptz;
ALTER TABLE host_executions ADD COLUMN IF NOT EXISTS tool_ended_at timestamptz;
ALTER TABLE host_executions ADD COLUMN IF NOT EXISTS tool_status text;
ALTER TABLE host_executions ADD COLUMN IF NOT EXISTS cleanup_state text;
