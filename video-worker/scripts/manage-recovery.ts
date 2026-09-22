import os from 'node:os';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { Postgres } from '../src/infrastructure/postgres.js';
import { HostProcesses } from '../src/infrastructure/host-processes.js';
import { resumeRun } from '../src/application/resume-run.js';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: 'string' },
    request: { type: 'string' },
    revision: { type: 'string' },
    note: { type: 'string' },
    runtime: { type: 'string' },
    pipeline: { type: 'string' },
  },
});
if (!['show', 'resume'].includes(positionals[0]) || !values.run)
  throw Error(
    '用法：manage-recovery show|resume --run UUID；resume 还需 --request ID --revision N --note 说明 --runtime 版本 --pipeline 版本',
  );
const config = loadConfig();
const db = new Postgres(config.databaseUrl);
try {
  if (positionals[0] === 'show')
    console.log(
      JSON.stringify(
        (
          await db.query(
            'SELECT id,state,recovery,remaining_seconds,repair_rounds FROM runs WHERE id=$1',
            [values.run],
          )
        ).rows[0] ?? null,
        null,
        2,
      ),
    );
  else
    console.log(
      JSON.stringify(
        await resumeRun(
          db,
          config,
          {
            runId: values.run,
            requestId: values.request ?? '',
            revision: Number(values.revision),
            note: values.note ?? '',
            actor: os.userInfo().username,
            runtimeVersion: values.runtime ?? '',
            pipelineRevision: values.pipeline ?? '',
          },
          (id) => new HostProcesses(config).stop(id),
        ),
        null,
        2,
      ),
    );
} finally {
  await db.close();
}
