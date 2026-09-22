import { z } from 'zod';
import { AppError } from './task.js';
import { protocol } from '../contracts/two-stage.js';

export const pipelineRevision = 'text-storyboard/1';
const error = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict();
export const analysisResult = z
  .object({
    status: z.enum(['candidate', 'failed']),
    scenes: z.array(z.object({ text: z.string().trim().min(1).max(4000) }).strict()).max(200),
    error: error.nullable(),
  })
  .strict();
export const analysisResponseSchema = z.toJSONSchema(analysisResult);

export function estimatedTiming(text: string) {
  const seconds = Array.from(text).filter((c) => !/\s/u.test(c)).length / 5;
  return {
    kind: 'estimated',
    speechSeconds: seconds,
    totalSeconds: seconds,
    totalRangeSeconds: [seconds, seconds],
    basis: '每秒 5 个非空白 Unicode 字符，仅供展示',
  };
}

// 按 codepoint 游标顺序匹配，重复句子与 emoji 都不能改变源位置。
export function normalizeAnalysis(
  value: unknown,
  script: string,
  taskId: string,
  inputDigest: string,
) {
  const parsed = analysisResult.safeParse(value);
  if (!parsed.success) throw new AppError('ANALYSIS_RESULT_INVALID', '文本分镜 JSON 结构无效');
  const result = parsed.data;
  if (result.status === 'failed') {
    if (!result.error || result.scenes.length)
      throw new AppError('ANALYSIS_RESULT_INVALID', '失败结果结构无效');
    throw new AppError(result.error.code, result.error.message, 400, result.error.retryable);
  }
  if (result.error || !result.scenes.length)
    throw new AppError('ANALYSIS_RESULT_INVALID', '文本分镜为空或包含错误');
  const source = Array.from(script);
  let cursor = 0;
  const nonspoken: any[] = [];
  function whitespace() {
    const start = cursor;
    while (cursor < source.length && /\s/u.test(source[cursor])) cursor++;
    if (cursor > start)
      nonspoken.push({
        start,
        end: cursor,
        text: source.slice(start, cursor).join(''),
        reason: '原稿空白',
      });
  }
  const scenes = result.scenes.map(({ text }, i) => {
    if (/[。！？!?][”’」』"']*\s*[^\s。！？!?”’」』"']/u.test(text))
      throw new AppError('ANALYSIS_RESULT_INVALID', '一项文本包含多句口播');
    whitespace();
    const start = cursor,
      length = Array.from(text).length;
    if (source.slice(start, start + length).join('') !== text)
      throw new AppError('ANALYSIS_RESULT_INVALID', '文本分镜与原稿顺序或正文不一致');
    cursor += length;
    return {
      id: `scene_${String(i + 1).padStart(3, '0')}`,
      text,
      sourceMapping: [{ start, end: cursor, unit: 'unicode_codepoints' }],
      timing: estimatedTiming(text),
      assetRefs: [],
      production: {},
    };
  });
  whitespace();
  if (cursor !== source.length) throw new AppError('ANALYSIS_RESULT_INVALID', '文本分镜遗漏原稿');
  return {
    contractVersion: protocol,
    taskId,
    inputDigest,
    scenes,
    nonspoken,
    previews: [],
    requirementsNotes: '完整要求见任务输入；本阶段仅输出文本分镜',
  };
}

const number = z.number().finite().nonnegative();
const placement = z
  .object({
    assetId: z.string().min(1).max(128),
    url: z
      .string()
      .min(1)
      .max(4096)
      .refine((v) => v.startsWith('/') && !v.includes('\0')),
    startTime: number.optional(),
    endTime: z.number().finite().positive().optional(),
    sourceStartTime: number.optional(),
    sourceEndTime: z.number().finite().positive().optional(),
    dur: z.number().finite().positive().optional(),
    order: z.number().int().nonnegative().optional(),
    w: z.number().int().positive().optional(),
    h: z.number().int().positive().optional(),
    playbackRate: z.number().finite().positive().max(4).optional(),
    freezeLastFrame: z.boolean().optional(),
    role: z.enum(['background', 'content', 'presenter']).optional(),
  })
  .strip()
  .superRefine((a, c) => {
    for (const [start, end] of [
      [a.startTime, a.endTime],
      [a.sourceStartTime, a.sourceEndTime],
    ])
      if (start !== undefined && end !== undefined && end <= start)
        c.addIssue({ code: 'custom', message: '素材区间无效' });
  });
const confirmedScene = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    content: z.string().trim().min(1).max(4000),
    dur: z.number().finite().positive().max(600).optional(),
    durationSource: z.enum(['estimated', 'measured']).optional(),
    production: z.record(z.string(), z.unknown()).default({}),
    visualPlan: z
      .object({
        description: z.string().max(4000).optional(),
        layoutPreset: z.string().max(128).optional(),
        animationPreset: z.string().max(128).optional(),
        selectionReason: z.string().max(4000).optional(),
      })
      .strip()
      .optional(),
    extraData: z
      .object({
        keywordList: z.array(z.string().max(120)).max(8).default([]),
        digitalHumanId: z.string().max(128).default(''),
        videoInfoList: z.array(placement).max(12).default([]),
        picInfoList: z.array(placement).max(12).default([]),
      })
      .strip()
      .default({ keywordList: [], digitalHumanId: '', videoInfoList: [], picInfoList: [] }),
  })
  .strip();
export function normalizeConfirmedScenes(value: unknown) {
  const scenes = z.array(confirmedScene).min(1).max(200).parse(value);
  if (new Set(scenes.map((s) => s.id)).size !== scenes.length)
    throw new AppError('INVALID_REQUEST', '分镜 ID 重复');
  if (scenes.some((s) => s.extraData.digitalHumanId))
    throw new AppError('DIGITAL_HUMAN_UNSUPPORTED', '当前制作链路不支持数字人');
  return scenes;
}

// production 是业务数据；命令、工具和宿主路径不作为制作授权转交。
function businessProduction(value: unknown): any {
  if (Array.isArray(value)) return value.map(businessProduction);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/^(commands?|argv|exec|shell|tools?|toolCalls|paths?|cwd|env|credentials|permissions|network|uploadUrl)$/i.test(
              key,
            ),
        )
        .map(([key, item]) => [key, businessProduction(item)]),
    );
  return value;
}

export function confirmPlan(previous: any, dataList: ReturnType<typeof normalizeConfirmedScenes>) {
  return {
    ...previous,
    previews: [],
    scenes: dataList.map((s) => ({
      id: s.id,
      text: s.content,
      sourceMapping: [],
      timing: estimatedTiming(s.content),
      assetRefs: [
        ...new Set(
          [...s.extraData.picInfoList, ...s.extraData.videoInfoList].map((a) => a.assetId),
        ),
      ],
      production: {
        ...businessProduction(s.production),
        ...(s.visualPlan ? { visualPlan: s.visualPlan } : {}),
        ...(s.extraData.keywordList.length ? { keywordList: s.extraData.keywordList } : {}),
        ...([...s.extraData.picInfoList, ...s.extraData.videoInfoList].length
          ? { materials: [...s.extraData.picInfoList, ...s.extraData.videoInfoList] }
          : {}),
      },
      editReason: '服务端记录客户端完整确认列表',
    })),
  };
}
export function publicScene(s: any) {
  return {
    id: s.id,
    content: s.content ?? s.text,
    dur: s.dur ?? s.timing?.totalSeconds,
    durationSource: s.durationSource ?? s.timing?.kind ?? 'estimated',
    production: {},
    extraData: {
      keywordList: [],
      digitalHumanId: '',
      videoInfoList: [],
      picInfoList: [],
      resources: [],
    },
    ...(s.url ? { url: s.url } : {}),
  };
}
