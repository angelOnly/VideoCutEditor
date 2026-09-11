import { loadConfig } from '../config.js';
import { Postgres, migrate } from '../infrastructure/postgres.js';
const db = new Postgres(loadConfig().databaseUrl);
try {
  await migrate(db);
} finally {
  await db.close();
}
