import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/infrastructure/postgres.js';
test('重复部署迁移保留 needs_input 和同任务排队消息', async () => {
  const pg = new PGlite();
  const db: any = {
    tx: (fn: any) =>
      pg.transaction((t) =>
        fn({
          query: async (sql: string) => {
            await t.exec(sql);
            return { rows: [] };
          },
        }),
      ),
  };
  try {
    await migrate(db);
    await pg.exec(`INSERT INTO tasks(id,tenant,external_id,state,config) VALUES ('00000000-0000-0000-0000-000000000001','test','test','needs_input','{}');
      INSERT INTO runs(id,task_id,tenant,request_id,request_hash,stage,state,input)
      SELECT ('00000000-0000-0000-0000-00000000000' || n)::uuid,'00000000-0000-0000-0000-000000000001','test',n::text,'hash','analysis',CASE WHEN n=2 THEN 'needs_input' ELSE 'queued' END,'{}' FROM generate_series(2,4) n;`);
    await migrate(db);
    assert.equal((await pg.query('SELECT * FROM runs')).rows.length, 3);
  } finally {
    await pg.close();
  }
});
