import { setTimeout } from 'node:timers/promises';
import { loadConfig } from '../config.js';
import { Postgres } from '../infrastructure/postgres.js';
import { CallbackOutbox } from '../infrastructure/callback-outbox.js';
const config = loadConfig(),
  db = new Postgres(config.databaseUrl),
  outbox = new CallbackOutbox(db, config.tenants);
let stop = false;
for (const s of ['SIGINT', 'SIGTERM'])
  process.on(s, () => {
    stop = true;
  });
try {
  while (!stop) {
    try {
      if (!(await outbox.sendOne())) await setTimeout(1000);
    } catch (e) {
      console.error(e);
      await setTimeout(2000);
    }
  }
} finally {
  await db.close();
}
