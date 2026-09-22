import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { readJson } from '../infrastructure/files.js';

const fields = [
  'totalTokens',
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
] as const;
/** 只汇总运行时累计 total；last 是其中一部分，不能重复相加。 */
export async function chapterUsageSummary(root: string, runId: string) {
  const directory = path.join(root, '.control/chapters');
  const executions: Record<string, any> = {};
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
    names = [];
  }
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const record = await readJson(path.join(directory, name));
    if (
      record.parentRunId !== runId ||
      typeof record.executionId !== 'string' ||
      name !== record.executionId + '.json'
    )
      continue;
    const total = record.usage?.total;
    executions[record.executionId] = {
      chapterId: record.chapterId,
      attemptId: record.attemptId,
      status: record.status,
      threadId: record.threadId ?? null,
      turnId: record.turnId ?? null,
      total: Object.fromEntries(
        fields.map((field) => [
          field,
          Number.isSafeInteger(total?.[field]) && total[field] >= 0 ? total[field] : null,
        ]),
      ),
    };
  }
  const rows = Object.entries(executions);
  const missingByField = Object.fromEntries(
    fields.map((field) => [
      field,
      rows.filter(([, r]) => r.total[field] === null).map(([id]) => id),
    ]),
  );
  const knownTotals = Object.fromEntries(
    fields.map((field) => {
      const values = rows.map(([, r]) => r.total[field]).filter((v) => v !== null);
      return [field, values.length ? values.reduce((sum, n) => sum + n, 0) : null];
    }),
  );
  return {
    parentRunId: runId,
    source: 'app-server tokenUsage.total',
    updatedAt: new Date().toISOString(),
    executionCount: rows.length,
    complete: rows.length > 0 && missingByField.totalTokens.length === 0,
    knownTotals,
    missingByField,
    executions,
  };
}
