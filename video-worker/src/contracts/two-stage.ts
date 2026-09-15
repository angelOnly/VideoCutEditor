import path from 'node:path';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { AppError } from '../domain/task.js';
export const protocol = 'video-two-stage/1';
export function assertStage(toolkit: string, kind: string, value: unknown) {
  const schema = JSON.parse(
    readFileSync(
      path.join(toolkit, '.agents/skills/video-pipeline/references/two-stage.schema.json'),
      'utf8',
    ),
  );
  const check = new Ajv2020({ strict: false }).compile({ ...schema, $ref: '#/$defs/' + kind });
  if (!check(value)) throw new AppError('INVALID_CONTRACT', JSON.stringify(check.errors));
}
export function stagePath(task: any) {
  return task.stage === 'analysis' ? 'analysis/request.json' : `render/${task.runId}/request.json`;
}
export const stageResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    contractVersion: { type: 'string', enum: [protocol] },
    taskId: { type: 'string' },
    runId: { type: 'string' },
    stage: { type: 'string', enum: ['analysis', 'render'] },
    status: { type: 'string', enum: ['candidate', 'failed'] },
    artifact: { type: ['string', 'null'] },
    error: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            retryable: { type: 'boolean' },
          },
          required: ['code', 'message', 'retryable'],
        },
      ],
    },
  },
  required: ['contractVersion', 'taskId', 'runId', 'stage', 'status', 'artifact', 'error'],
};
