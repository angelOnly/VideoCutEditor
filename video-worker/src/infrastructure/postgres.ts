import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export interface Sql {
  query<T = any>(sql: string, values?: any[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}
export interface Database extends Sql {
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export class Postgres implements Database {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 12 });
  }
  async query<T = any>(sql: string, values?: any[]) {
    return (await this.pool.query(sql, values)) as unknown as { rows: T[]; rowCount: number };
  }
  async tx<T>(fn: (q: Sql) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const value = await fn(c);
      await c.query('COMMIT');
      return value;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
export async function migrate(db: Database) {
  // 明确顺序；每份迁移幂等，可在升级与首次安装时共用。
  for (const name of [
    '001_initial.sql',
    '002_pipeline_liveness.sql',
    '003_render_recovery.sql',
    '004_pipeline_io.sql',
    '005_execution_capacity.sql',
  ]) {
    const sql = await readFile(
      fileURLToPath(new URL('../../migrations/' + name, import.meta.url)),
      'utf8',
    );
    await db.tx(async (q) => {
      await q.query(sql);
    });
  }
}
export async function lock(q: Sql) {
  await q.query('SELECT id FROM scheduler_lock WHERE id=1 FOR UPDATE');
}
