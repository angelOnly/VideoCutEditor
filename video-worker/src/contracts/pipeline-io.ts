import { z } from 'zod';
import { AppError } from '../domain/task.js';
export const ioProtocol = 'video-pipeline-io/1';
const identity = {
  protocol: z.literal(ioProtocol),
  taskId: z.string().min(1),
  requestId: z.string().min(1),
  stage: z.enum(['analysis', 'render']),
};
export const finalReference = z.object({ ...identity, resultFile: z.string().min(1) }).strict();
export const finalReferenceSchema = z.toJSONSchema(finalReference);
export const outcomeSchema = z
  .object({
    ...identity,
    status: z.enum(['completed', 'needs_input', 'failed']),
    result: z.record(z.string(), z.unknown()).nullable(),
    files: z.array(
      z
        .object({
          id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
          path: z.string().min(1),
        })
        .strict(),
    ),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        retryable: z.boolean().optional(),
      })
      .passthrough()
      .nullable(),
  })
  .strict();
export function matchIdentity(value: any, task: any) {
  if (['protocol', 'taskId', 'requestId', 'stage'].some((k) => value[k] !== task[k]))
    throw new AppError('RESULT_PROTOCOL_INVALID', '结果不属于当前任务消息');
}
// 只检查交付协议；合片和音画终检仍由 toolkit 完成。
export function validateRenderResult(outcome: any, input: any) {
  if (outcome.stage !== 'render' || outcome.status !== 'completed') return;
  const data = outcome.result?.dataList;
  const whole = data?.[0];
  const scenes = input.dataList;
  const files = new Map(outcome.files.map((file: any) => [file.id, file.path]));
  if (
    !Array.isArray(data) ||
    !Array.isArray(scenes) ||
    data.length !== scenes.length + 1 ||
    whole?.id !== 'whole-video' ||
    whole.extraData?.kind !== 'wholeVideo' ||
    whole.artifactRef !== 'video-whole' ||
    whole.extraData.sceneCount !== scenes.length ||
    !/^[a-f0-9]{64}$/.test(whole.extraData.sha256 ?? '') ||
    data.some(
      (item: any) =>
        !item ||
        !Number.isFinite(item.dur) ||
        item.dur <= 0 ||
        item.durationSource !== 'measured' ||
        'url' in item ||
        !String(files.get(item.artifactRef) ?? '').endsWith('.mp4'),
    ) ||
    scenes.some(
      (scene: any, i: number) =>
        data[i + 1].id !== scene.id ||
        data[i + 1].content !== scene.content ||
        data[i + 1].extraData?.kind === 'wholeVideo',
    ) ||
    new Set(data.map((item: any) => item.artifactRef)).size !== data.length
  )
    throw new AppError(
      'RESULT_PROTOCOL_INVALID',
      'Render 必须交付第 0 项整片和按确认顺序排列的分镜 MP4',
    );
}
// 只映射明确文件引用，不推导分镜、时长或正文。
export function replaceArtifactRefs(value: any, urls: Map<string, string>): any {
  if (Array.isArray(value)) return value.map((v) => replaceArtifactRefs(v, urls));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'artifactRef') {
      if (typeof child !== 'string' || !urls.has(child) || 'url' in value)
        throw new AppError('RESULT_PROTOCOL_INVALID', '文件引用不存在或同时指定了 URL');
      result.url = urls.get(child);
    } else
      Object.defineProperty(result, key, {
        value: replaceArtifactRefs(child, urls),
        enumerable: true,
        writable: true,
      });
  }
  return result;
}
