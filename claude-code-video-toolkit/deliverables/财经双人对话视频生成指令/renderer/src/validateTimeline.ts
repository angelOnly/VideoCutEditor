import type {FinanceTimeline, VisualBlock} from './types';
import {visualExtensions} from './visualExtensions';
export type Recommendation = {code: string; location: string; message: string};
const recommend = (out: Recommendation[], condition: unknown, location: string, message: string) => {
  if (!condition) out.push({code: 'TEMPLATE_RECOMMENDATION', location, message});
};

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`模板视觉校验失败：${message}`);
}
const integer = (n: number) => Number.isInteger(n) && n >= 0;
const short = (value: unknown, max: number, field: string, out: Recommendation[]) => {
  check(typeof value === 'string' && value.trim(), `${field} 不能为空`);
  recommend(out, Array.from(value).length <= max, field, `建议不超过 ${max} 字；检查换行、可读性和安全区`);
};
const listKinds = ['comparison', 'flow', 'layers', 'labels'];
const kinds = ['metric', ...listKinds, 'quote', 'trend', 'line', 'gauge', 'ring'];
const regions: Record<string, number[]> = {
  full: [0, 0, 1, 1], top: [0, 0, 1, .46], bottom: [0, .54, 1, 1], left: [0, 0, .48, 1], right: [.52, 0, 1, 1],
};

export function validateBlocks(blocks: VisualBlock[], frames: number, warnings: Recommendation[] = []) {
  const ids = new Set<string>();
  for (const b of blocks) {
    check(b.id && !ids.has(b.id), '图解 id 为空或重复'); ids.add(b.id);
    const extension = visualExtensions[b.kind];
    check(kinds.includes(b.kind) || (extension && typeof extension.component === 'function' && typeof extension.validate === 'function'), `${b.id} 新类型须注册渲染实现及参数检查`);
    check(integer(b.startFrame) && integer(b.endFrameExclusive) && b.endFrameExclusive <= frames && b.endFrameExclusive > b.startFrame, `${b.id} 时间越界或为空`);
    check(regions[b.slot ?? 'full'], `${b.id} 区域无效`);
    if (b.animationFrames !== undefined) check(integer(b.animationFrames), `${b.id} 动画参数无效`);
    recommend(warnings, b.endFrameExclusive - b.startFrame >= 14, b.id, '展示较短，检查动画完成度及阅读时间');
    if (extension) { extension.validate(b); continue; }
    const p = b.props;
    if (p.columns !== undefined) check(typeof p.columns === 'number' && integer(p.columns) && p.columns > 0, `${b.id} 列数须为正整数`);
    if (listKinds.includes(b.kind)) {
      check(Array.isArray(p.items) && p.items.length >= 1, `${b.id} 项目数量越界`);
      recommend(warnings, p.items.length <= (b.kind === 'comparison' ? 2 : b.kind === 'flow' ? 4 : 5), b.id, '项目超出默认容量；分行、分批或任务内适配');
      p.items.forEach((v) => short(v, b.kind === 'layers' ? 22 : 18, `${b.id}.items`, warnings));
      check(Array.isArray(p.itemFrames) && p.itemFrames.length === p.items.length, `${b.id} 必须为每项绑定入场帧`);
      p.itemFrames.forEach((n, i, all) => check(integer(n) && n < b.endFrameExclusive - b.startFrame && (i === 0 || n > all[i - 1]), `${b.id} 入场帧须递增并位于展示区间`));
      recommend(warnings, b.kind !== 'layers' || (b.slot ?? 'full') === 'full', b.id, '层级图建议完整区域，检查实际边界');
      if (b.kind === 'labels' && ['top', 'bottom'].includes(b.slot ?? 'full')) recommend(warnings, p.items.length <= 4, b.id, '半高清单建议不超过四项，检查实际布局');
    } else {
      short(p.label, 24, `${b.id}.label`, warnings);
    }
    if (b.kind === 'metric') {short(p.value, 12, `${b.id}.value`, warnings); short(p.detail, 28, `${b.id}.detail`, warnings);}
    if (b.kind === 'quote') short(p.text, 40, `${b.id}.text`, warnings);
    if (['trend', 'line', 'gauge', 'ring'].includes(b.kind)) {
      check(typeof p.revealFrame === 'number' && integer(p.revealFrame) && p.revealFrame < b.endFrameExclusive - b.startFrame, `${b.id} 缺少区间内的有效 revealFrame`);
    }
    if (b.kind === 'trend' || b.kind === 'line') recommend(warnings, !['left', 'right'].includes(b.slot ?? 'full'), b.id, '横向图解建议完整宽度；检查实际可读性');
    if (b.kind === 'trend') {short(p.from, 12, `${b.id}.from`, warnings); short(p.to, 12, `${b.id}.to`, warnings);}
    if (b.kind === 'line') {
      check(Array.isArray(p.values) && p.values.length >= 2 && p.values.every((n) => typeof n === 'number' && Number.isFinite(n)), `${b.id} 须至少包含两个真实数值`);
      check(Array.isArray(p.labels) && p.labels.length === p.values.length, `${b.id} 数值与标签数量不同`);
      p.labels.forEach((v) => short(v, 8, `${b.id}.labels`, warnings));
      check(typeof p.source === 'string' && p.source.trim(), `${b.id} 必须标明数据出处，不得捏造曲线`);
    }
    if (b.kind === 'ring' || b.kind === 'gauge') {
      if (b.kind === 'ring') recommend(warnings, !['top', 'bottom'].includes(b.slot ?? 'full'), b.id, '环形组件建议完整高度；检查实际边界');
      check(typeof p.value === 'number' && Number.isFinite(p.value) && p.value >= 0 && p.value <= 100, `${b.id} 百分比无效`);
      short(p.detail, 28, `${b.id}.detail`, warnings);
      if (b.kind === 'gauge') check(typeof p.threshold === 'number' && Number.isFinite(p.threshold) && p.threshold >= 0 && p.threshold <= 100, `${b.id} 风险阈值无效`);
    }
  }
  // 区域相交只提示风险；实际错误遮挡由布局检查与审片判定。
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = blocks[i], b = blocks[j];
    if (a.endFrameExclusive <= b.startFrame || b.endFrameExclusive <= a.startFrame) continue;
    const r = regions[a.slot ?? 'full'], s = regions[b.slot ?? 'full'];
    recommend(warnings, !(r[0] < s[2] && s[0] < r[2] && r[1] < s[3] && s[1] < r[3]), `${a.id}/${b.id}`, '区域相交：检查错误遮挡；有意叠层须审查前中后动态画面');
  }
  return warnings;
}

export function validateTimeline(t: FinanceTimeline) {
  const warnings: Recommendation[] = [];
  check(t.width === 1920 && t.height === 1080 && t.fps === 30, '模板固定为 1920×1080 / 30fps');
  check(integer(t.totalFrames) && t.totalFrames > 0, '总帧数无效');
  check(t.chapters?.length >= 1, '必须有逻辑章节');
  recommend(warnings, t.chapters.length <= 6, 'chapters', '建议 1–6 章；导航将显示当前章节及相邻章节');
  const chapterIds = new Set<string>();
  let previous = -1;
  for (const c of t.chapters) {
    check(c.id && !chapterIds.has(c.id), '章节 id 为空或重复'); chapterIds.add(c.id);
    short(c.label, 8, '章节小标题', warnings); short(c.title, 32, '面板标题', warnings); short(c.summary, 40, '章节摘要', warnings);
    check(integer(c.from) && integer(c.endFrameExclusive) && c.from >= previous && c.endFrameExclusive > c.from && c.endFrameExclusive <= t.totalFrames, '章节范围无效或重叠');
    previous = c.endFrameExclusive;
    validateBlocks(c.visualBlocks, c.endFrameExclusive - c.from, warnings);
  }
  let end = 0;
  const sceneIds = new Set<string>();
  for (const s of t.scenes) {
    check(s.id && !sceneIds.has(s.id), '分镜 id 为空或重复'); sceneIds.add(s.id);
    check(s.from === end && integer(s.frames) && s.frames > 0, `${s.id} 分镜必须连续且帧数有效`); end += s.frames;
    const contentFrames = s.contentFrames ?? s.frames;
    check(integer(contentFrames) && contentFrames > 0 && contentFrames <= s.frames, `${s.id} 内容长度或封装补帧无效`);
    for (const media of [s.intro, s.outro]) if (media) check(typeof media.muted === 'boolean', `${s.id} 视频素材须显式指定 muted`);
    check(s.speaker === 'male-chief' || s.speaker === 'female-host', `${s.id} 发言者无效`);
    if (s.chapter) check(integer(s.chapter.frames) && s.chapter.frames > 0 && s.chapter.frames < s.frames, `${s.id} 章节转场须为正且短于分镜`);
    check(!(s.intro && s.outro), `${s.id} 不能同时片头和片尾`);
    if (!s.intro && !s.outro) {
      short(s.summary, 22, '人物观点短句', warnings);
      let covered = s.from + (s.chapter?.frames ?? 0);
      for (const c of t.chapters.filter((c) => c.endFrameExclusive > covered && c.from < end)) {
        check(c.from <= covered, `${s.id} 正文章节覆盖有空隙`);
        check(s.visualBlocks.length || c.visualBlocks.length, `${s.id} 缺少图解`);
        covered = c.endFrameExclusive;
      }
      check(covered >= end, `${s.id} 正文章节覆盖不完整`);
    }
    validateBlocks(s.visualBlocks, s.frames, warnings);
    let captionEnd = 0;
    for (const caption of s.captions) {
      short(caption.text, 28, `${s.id} 字幕`, warnings);
      check(integer(caption.startFrame) && integer(caption.endFrameExclusive) && caption.startFrame >= captionEnd && caption.endFrameExclusive > caption.startFrame && caption.endFrameExclusive <= s.frames, `${s.id} 字幕越界或重叠`);
      captionEnd = caption.endFrameExclusive;
    }
    let utteranceEnd = s.chapter?.frames ?? 0;
    for (const u of s.utterances) {
      check(integer(u.startFrame) && integer(u.endFrameExclusive) && u.startFrame >= utteranceEnd && u.endFrameExclusive > u.startFrame && u.endFrameExclusive <= contentFrames, `${s.id} 配音越界、重叠或与标题同屏`);
      utteranceEnd = u.endFrameExclusive;
    }
    if (s.outro) check(s.utterances.length && s.utterances[0].startFrame === 0 && utteranceEnd <= contentFrames, '片尾必须完整容纳收束旁白；素材尾音与封装补帧不延长字幕');
    for (const cue of s.sfx ?? []) check(integer(cue.frame) && cue.frame < contentFrames && (cue.durationFrames === undefined || (integer(cue.durationFrames) && cue.durationFrames > 0 && cue.frame + cue.durationFrames <= contentFrames)), `${s.id} 音效帧越界`);
  }
  check(t.scenes.length && end === t.totalFrames, '总帧数与分镜不一致');
  return warnings;
}
