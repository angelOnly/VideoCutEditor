import { z } from 'zod';
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
export type AnalysisRequest = z.infer<typeof analysisRequest>;
export type RenderRequest = z.infer<typeof renderRequest>;
