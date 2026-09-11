import { loadConfig } from '../config.js';
import { Postgres } from '../infrastructure/postgres.js';
import { createApi } from '../api/routes.js';
const config = loadConfig(),
  db = new Postgres(config.databaseUrl),
  api = createApi(db, config);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void api.close().then(() => db.close());
  });
await api.listen({ host: '0.0.0.0', port: config.port });
