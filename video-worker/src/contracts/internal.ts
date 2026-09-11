import { Ajv } from 'ajv';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { InternalTask } from './internal.generated.js';
export function assertInternalTask(
  toolkitRoot: string,
  value: unknown,
): asserts value is InternalTask {
  const schema = JSON.parse(
    readFileSync(
      path.join(toolkitRoot, '.agents/skills/video-pipeline/references/task-v2.schema.json'),
      'utf8',
    ),
  );
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (!validate(value))
    throw new Error('Invalid internal task: ' + JSON.stringify(validate.errors));
}
