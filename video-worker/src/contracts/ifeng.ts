import { z } from 'zod';
import { createHash } from 'node:crypto';
import { fail } from '../domain/task.js';
const id = z.string().min(1).max(128);
const file = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => v.startsWith('/') && !v.includes('\0'), '需要文件绝对路径');
export const outputSpec = z
  .object({
    width: z.number().int().min(64).max(3840).multipleOf(2),
    height: z.number().int().min(64).max(3840).multipleOf(2),
    fps: z.number().int().min(1).max(60),
  })
  .strict();
export const asset = z.object({ assetId: id, url: file }).strict();
const base = { schemaVersion: z.literal(2), requestId: id, taskId: id };
export const analysisRequest = z
  .object({
    ...base,
    script: z
      .string()
      .min(1)
      .max(50000)
      .refine((v) => v.trim().length > 0, '稿件不能为空'),
    otherRequirements: z.string().max(10000),
    digitalHumanAccounId: z.string().max(128),
    plugin: z.object({ digitalHumanId: z.string().max(128), templateId: id }).strict(),
    narration: asset.nullable().default(null),
    outputSpec: outputSpec.default({ width: 1080, height: 1920, fps: 30 }),
    otherMaterial: z
      .object({ picInfoList: z.array(asset).max(200), videoInfoList: z.array(asset).max(200) })
      .strict(),
  })
  .strict()
  .superRefine((r, c) => {
    const a = [
      ...r.otherMaterial.picInfoList,
      ...r.otherMaterial.videoInfoList,
      ...(r.narration ? [r.narration] : []),
    ];
    if (new Set(a.map((x) => x.assetId)).size !== a.length)
      c.addIssue({ code: 'custom', message: '素材 assetId 重复' });
  });

/*
 * 网页工作台的下游协议仍使用 content/customTemplateId，和 Worker 的 v2
 * 请求字段不同。这里仅在入口处归一化，后续两阶段执行始终使用 v2 协议。
 */
const webAnalysisRequest = z
  .object({
    taskId: id,
    content: z.string().min(1).max(50000),
    otherRequirements: z.string().max(10000).optional().default(''),
    plugin: z
      .object({
        digitalHumanId: z.string().max(128).optional().default(''),
        templateId: z.string().max(128).optional().default(''),
        customTemplateId: z.string().max(128).optional().default(''),
      })
      .strict(),
    otherMaterial: z
      .object({
        picInfoList: z.array(z.object({ url: z.string() }).strict()).max(200),
        videoInfoList: z.array(z.object({ url: z.string() }).strict()).max(200),
      })
      .strict(),
  })
  .strict();

export function normalizeAnalysisRequest(body: unknown) {
  const canonical = analysisRequest.safeParse(body);
  if (canonical.success) return { input: canonical.data, source: body };

  const web = webAnalysisRequest.parse(body);
  if (web.otherMaterial.picInfoList.length || web.otherMaterial.videoInfoList.length)
    fail('ASSET_MAPPING_REQUIRED', '网页补充素材尚未映射到 Worker 的受控文件目录');
  const templateId = web.plugin.customTemplateId || web.plugin.templateId;
  if (!templateId) fail('TEMPLATE_REQUIRED', '网页任务未选择模板');
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({ content: web.content, requirements: web.otherRequirements, templateId }),
    )
    .digest('hex')
    .slice(0, 16);
  return {
    input: analysisRequest.parse({
      schemaVersion: 2,
      requestId: `web-v2-${web.taskId}-analysis-${fingerprint}`,
      taskId: web.taskId,
      script: web.content,
      otherRequirements: web.otherRequirements,
      digitalHumanAccounId: '',
      plugin: { digitalHumanId: web.plugin.digitalHumanId, templateId },
      narration: null,
      // 定制模板的时间线固定为 1920×1080 / 30fps。
      outputSpec: web.plugin.customTemplateId
        ? { width: 1920, height: 1080, fps: 30 }
        : { width: 1080, height: 1920, fps: 30 },
      otherMaterial: { picInfoList: [], videoInfoList: [] },
    }),
    source: body,
  };
}
export const renderRequest = z
  .object({
    ...base,
    basePlanVersion: z.number().int().positive(),
    field_5: z.string().max(128),
    templateId: id,
    dataList: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
    // 可选关联信息；最终制作文本以 dataList 为准。
    plan: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const webRenderRequest = z
  .object({
    taskId: id,
    templateId: z.string().max(128).optional().default(''),
    introUrl: z.string().max(4096).optional().default(''),
    introIndex: z.number().int().nonnegative().optional().default(0),
    outroUrl: z.string().max(4096).optional().default(''),
    outroIndex: z.number().int().nonnegative().optional().default(0),
    dataList: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
  })
  .strict();

export function normalizeRenderRequest(
  body: unknown,
  current: { planVersion: number; templateId: string; digitalHumanAccountId: string },
) {
  const canonical = renderRequest.safeParse(body);
  if (canonical.success) return { input: canonical.data, source: body };

  const web = webRenderRequest.parse(body);
  if (web.templateId && web.templateId !== current.templateId)
    fail('CONFIG_CONFLICT', '网页渲染模板与已确认分析模板不一致', 409);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ dataList: web.dataList, templateId: current.templateId }))
    .digest('hex')
    .slice(0, 16);
  return {
    input: renderRequest.parse({
      schemaVersion: 2,
      requestId: `web-v1-${web.taskId}-render-${fingerprint}`,
      taskId: web.taskId,
      basePlanVersion: current.planVersion,
      field_5: current.digitalHumanAccountId,
      templateId: current.templateId,
      dataList: web.dataList,
      plan: { sourceRequest: body },
    }),
    source: body,
  };
}
export type AnalysisRequest = z.infer<typeof analysisRequest>;
export type RenderRequest = z.infer<typeof renderRequest>;
