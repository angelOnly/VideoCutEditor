import { z } from 'zod';
const id = z.string().min(1).max(128);
const safeId = id.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const file = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => v.startsWith('/') && !v.includes('\0'), '需要文件绝对路径');
const nonnegative = z.number().finite().nonnegative();
export const outputSpec = z
  .object({
    width: z.number().int().min(64).max(3840).multipleOf(2),
    height: z.number().int().min(64).max(3840).multipleOf(2),
    fps: z.number().int().min(1).max(60),
  })
  .strict();
export const asset = z.object({ assetId: id, url: file }).strict();
const placement = {
  assetId: id,
  url: file,
  startTime: nonnegative,
  endTime: z.number().positive(),
  role: z.enum(['background', 'content', 'presenter']).default('content'),
  order: z.number().int().nonnegative(),
  playbackRate: z.number().positive().max(4).optional(),
  freezeLastFrame: z.boolean().optional(),
};
export const video = z
  .object({
    ...placement,
    dur: z.number().positive(),
    sourceStartTime: nonnegative,
    sourceEndTime: z.number().positive(),
  })
  .strict();
export const picture = z
  .object({ ...placement, w: z.number().int().positive(), h: z.number().int().positive() })
  .strict();
export const scene = z
  .object({
    id: safeId,
    content: z.string().trim().min(1).max(4000),
    dur: z.number().positive().max(600),
    durationSource: z.enum(['estimated', 'measured']).optional(),
    narrationStartTime: nonnegative.optional(),
    narrationEndTime: z.number().positive().optional(),
    visualPlan: z
      .object({
        description: z.string().max(4000),
        layoutPreset: z.enum(['full_frame', 'presenter_pip']),
        animationPreset: z.enum(['none', 'slow_zoom', 'fade']),
        selectionReason: z.string().max(4000).optional(),
      })
      .strict(),
    extraData: z
      .object({
        keywordList: z.array(z.string().max(120)).max(8),
        digitalHumanId: z.string().max(128),
        videoInfoList: z.array(video).max(12),
        picInfoList: z.array(picture).max(12),
      })
      .strict(),
  })
  .strict()
  .superRefine((s, c) => {
    const all = [...s.extraData.videoInfoList, ...s.extraData.picInfoList];
    if (s.extraData.picInfoList.some((a) => a.role === 'presenter'))
      c.addIssue({ code: 'custom', message: '数字人必须使用视频素材' });
    if (
      s.extraData.digitalHumanId &&
      s.extraData.videoInfoList.filter((a) => a.role === 'presenter').length !== 1
    )
      c.addIssue({
        code: 'custom',
        message: '数字人镜头需提供一个匹配口播的预生成视频，role=presenter',
      });
    if (!s.extraData.digitalHumanId && all.some((a) => a.role === 'presenter'))
      c.addIssue({ code: 'custom', message: '数字人素材需声明 digitalHumanId' });
    for (const a of all)
      if (a.endTime <= a.startTime || a.endTime > s.dur + 0.05)
        c.addIssue({ code: 'custom', message: '素材分镜区间越界' });
    for (const v of s.extraData.videoInfoList)
      if (v.sourceEndTime <= v.sourceStartTime || v.sourceEndTime > v.dur + 0.05)
        c.addIssue({ code: 'custom', message: '源视频截取区间越界' });
    if (
      (s.narrationStartTime === undefined) !== (s.narrationEndTime === undefined) ||
      (s.narrationEndTime !== undefined && s.narrationEndTime <= (s.narrationStartTime ?? 0))
    )
      c.addIssue({ code: 'custom', message: '配音需完整且有效的对齐区间' });
    const contents = all
      .filter((a) => a.role === 'content')
      .sort((a, b) => a.startTime - b.startTime);
    if (new Set(contents.map((a) => a.order)).size !== contents.length)
      c.addIssue({ code: 'custom', message: '内容素材 order 必须唯一' });
    for (let i = 1; i < contents.length; i++)
      if (contents[i].startTime < contents[i - 1].endTime - 0.001)
        c.addIssue({ code: 'custom', message: '内容素材不能重叠' });
  });
export const scenes = z
  .array(scene)
  .min(1)
  .max(200)
  .superRefine((s, c) => {
    if (new Set(s.map((x) => x.id)).size !== s.length)
      c.addIssue({ code: 'custom', message: '分镜 ID 重复' });
  });
const base = { schemaVersion: z.literal(2), requestId: id, taskId: id };
export const analysisRequest = z
  .object({
    ...base,
    script: z.string().trim().min(1).max(50000),
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
    dataList: scenes,
  })
  .strict();
export type Scene = z.infer<typeof scene>;
export type AnalysisRequest = z.infer<typeof analysisRequest>;
export type RenderRequest = z.infer<typeof renderRequest>;
export const planSchema = z
  .object({
    schemaVersion: z.literal(2),
    jobId: z.string(),
    dataList: scenes,
    materialUnderstanding: z
      .array(
        z
          .object({ assetId: id, summary: z.string().min(1), evidence: z.array(z.string()).min(1) })
          .strict(),
      )
      .default([]),
  })
  .strict();
