import { AppError } from '../domain/task.js';
import type { Lease } from '../domain/task.js';
import type { Workspace } from './workspace.js';
import type { Sandbox } from './sandbox.js';
import { readJson, safeFile } from './files.js';
import {
  finalReference,
  outcomeSchema,
  matchIdentity,
  replaceArtifactRefs,
  validateRenderResult,
} from '../contracts/pipeline-io.js';
export async function validate(_sandbox: Sandbox, l: Lease, w: Workspace, signal: AbortSignal) {
  signal.throwIfAborted();
  // 此回复由当前 turn 的事件写入；禁止扫描 output 寻找历史结果。
  const reference = parseProtocol(
    finalReference,
    await readJson(await safeFile(w.root, `output/${l.run.id}/agent-response.json`)),
  );
  matchIdentity(reference, w.task);
  if (reference.resultFile !== w.task.resultFile)
    throw new AppError('RESULT_PROTOCOL_INVALID', '最终回复引用了非当前消息的结果');
  const result = parseProtocol(
    outcomeSchema,
    await readJson(await safeFile(w.root, reference.resultFile)),
  );
  matchIdentity(result, w.task);
  if (new Set(result.files.map((f: any) => f.id)).size !== result.files.length)
    throw new AppError('RESULT_PROTOCOL_INVALID', '交付文件 ID 重复');
  if (
    result.status === 'completed'
      ? result.error !== null || !result.result || !Array.isArray(result.result.dataList)
      : !result.error
  )
    throw new AppError('RESULT_PROTOCOL_INVALID', '状态与结果或错误字段不一致');
  for (const file of result.files) await safeFile(w.root, file.path);
  validateRenderResult(result, l.run.input);
  replaceArtifactRefs(result.result, new Map(result.files.map((f: any) => [f.id, f.path])));
  return result;
}

function parseProtocol(schema: { safeParse(value: unknown): any }, value: unknown): any {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('RESULT_PROTOCOL_INVALID', '结果信封或最终回复格式不符');
  return parsed.data;
}
