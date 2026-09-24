-- 六个工作流名额中最多四个可处于 Render 阶段；阶段上限由 Queue 的同一事务领取逻辑执行。
ALTER TABLE execution_slots DROP CONSTRAINT IF EXISTS execution_slots_id_check;
ALTER TABLE execution_slots
  ADD CONSTRAINT execution_slots_id_check CHECK (id BETWEEN 1 AND 6);
INSERT INTO execution_slots(id) VALUES (5),(6) ON CONFLICT DO NOTHING;
