import type {FinanceTimeline, VisualBlock} from './types';

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`模板视觉校验失败：${message}`);
}
const integer = (n: number) => Number.isInteger(n) && n >= 0;
const short = (value: unknown, max: number, field: string) => {
  check(typeof value === 'string' && value.trim() && Array.from(value).length <= max, `${field} 须为 1–${max} 字`);
};
const listKinds = ['comparison', 'flow', 'layers', 'labels'];
const kinds = ['metric', ...listKinds, 'quote', 'trend', 'line', 'gauge', 'ring'];
const regions: Record<string, number[]> = {
  full: [0, 0, 1, 1], top: [0, 0, 1, .46], bottom: [0, .54, 1, 1], left: [0, 0, .48, 1], right: [.52, 0, 1, 1],
};

export function validateBlocks(blocks: VisualBlock[], frames: number) {
  const ids = new Set<string>();
  for (const b of blocks) {
    check(b.id && !ids.has(b.id), '图解 id 为空或重复'); ids.add(b.id);
    check(kinds.includes(b.kind), `${b.id} 不支持的动效类型`);
    check(integer(b.startFrame) && integer(b.endFrameExclusive) && b.endFrameExclusive <= frames && b.endFrameExclusive - b.startFrame >= 14, `${b.id} 时间越界或不足 14 帧`);
    check(regions[b.slot ?? 'full'], `${b.id} 区域无效`);
    const p = b.props;
    if (listKinds.includes(b.kind)) {
      check(Array.isArray(p.items) && p.items.length >= 2 && p.items.length <= (b.kind === 'comparison' ? 2 : b.kind === 'flow' ? 4 : 5), `${b.id} 项目数量越界`);
      p.items.forEach((v) => short(v, b.kind === 'layers' ? 22 : 18, `${b.id}.items`));
      check(Array.isArray(p.itemFrames) && p.itemFrames.length === p.items.length, `${b.id} 必须为每项绑定入场帧`);
      p.itemFrames.forEach((n, i, all) => check(integer(n) && n + 13 < b.endFrameExclusive - b.startFrame && (i === 0 || n > all[i - 1]), `${b.id} 入场帧须递增且留足动画时间`));
      check(b.kind !== 'layers' || (b.slot ?? 'full') === 'full', '层级组件须占完整区域');
      if (b.kind === 'labels' && ['top', 'bottom'].includes(b.slot ?? 'full')) check(p.items.length <= 4, '半高区域清单最多 4 项');
    } else {
      short(p.label, 24, `${b.id}.label`);
    }
    if (b.kind === 'metric') {short(p.value, 12, `${b.id}.value`); short(p.detail, 28, `${b.id}.detail`);}
    if (b.kind === 'quote') short(p.text, 40, `${b.id}.text`);
    if (['trend', 'line', 'gauge', 'ring'].includes(b.kind)) {
      check(typeof p.revealFrame === 'number' && integer(p.revealFrame) && p.revealFrame + 45 < b.endFrameExclusive - b.startFrame, `${b.id} 缺少有效 revealFrame 或动画时间不足`);
    }
    if (b.kind === 'trend' || b.kind === 'line') check(!['left', 'right'].includes(b.slot ?? 'full'), `${b.id} 横向图解须用完整宽度区域`);
    if (b.kind === 'trend') {short(p.from, 12, `${b.id}.from`); short(p.to, 12, `${b.id}.to`);}
    if (b.kind === 'line') {
      check(Array.isArray(p.values) && p.values.length >= 2 && p.values.length <= 6 && p.values.every((n) => typeof n === 'number' && Number.isFinite(n)), `${b.id} 须为 2–6 个真实数值`);
      check(Array.isArray(p.labels) && p.labels.length === p.values.length, `${b.id} 数值与标签数量不同`);
      p.labels.forEach((v) => short(v, 8, `${b.id}.labels`));
      check(typeof p.source === 'string' && p.source.trim(), `${b.id} 必须标明数据出处，不得捏造曲线`);
    }
    if (b.kind === 'ring' || b.kind === 'gauge') {
      if (b.kind === 'ring') check(!['top', 'bottom'].includes(b.slot ?? 'full'), '环形组件须用完整高度区域');
      check(typeof p.value === 'number' && Number.isFinite(p.value) && p.value >= 0 && p.value <= 100, `${b.id} 百分比无效`);
      short(p.detail, 28, `${b.id}.detail`);
      if (b.kind === 'gauge') check(typeof p.threshold === 'number' && Number.isFinite(p.threshold) && p.threshold >= 0 && p.threshold <= 100, `${b.id} 风险阈值无效`);
    }
  }
  // 同时段只能使用互不相交的区域；禁止叠放后用 overflow 隐藏问题。
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = blocks[i], b = blocks[j];
    if (a.endFrameExclusive <= b.startFrame || b.endFrameExclusive <= a.startFrame) continue;
    const r = regions[a.slot ?? 'full'], s = regions[b.slot ?? 'full'];
    check(!(r[0] < s[2] && s[0] < r[2] && r[1] < s[3] && s[1] < r[3]), `${a.id} 与 ${b.id} 同时占用重叠区域`);
  }
}

export function validateTimeline(t: FinanceTimeline) {
  check(t.width === 1920 && t.height === 1080 && t.fps === 30, '模板固定为 1920×1080 / 30fps');
  check(integer(t.totalFrames) && t.totalFrames > 0, '总帧数无效');
  check(t.chapters?.length >= 1 && t.chapters.length <= 6, '必须有 1–6 个逻辑章节');
  const chapterIds = new Set<string>();
  let previous = -1;
  for (const c of t.chapters) {
    check(c.id && !chapterIds.has(c.id), '章节 id 为空或重复'); chapterIds.add(c.id);
    short(c.label, 8, '章节小标题'); short(c.title, 32, '面板标题'); short(c.summary, 40, '章节摘要');
    check(integer(c.from) && integer(c.endFrameExclusive) && c.from >= previous && c.endFrameExclusive > c.from && c.endFrameExclusive <= t.totalFrames, '章节范围无效或重叠');
    previous = c.endFrameExclusive;
    validateBlocks(c.visualBlocks, c.endFrameExclusive - c.from);
  }
  let end = 0;
  const sceneIds = new Set<string>();
  for (const s of t.scenes) {
    check(s.id && !sceneIds.has(s.id), '分镜 id 为空或重复'); sceneIds.add(s.id);
    check(s.from === end && integer(s.frames) && s.frames > 0, `${s.id} 分镜必须连续且帧数有效`); end += s.frames;
    const contentFrames = s.contentFrames ?? s.frames;
    check(integer(contentFrames) && contentFrames > 0 && contentFrames <= s.frames && s.frames - contentFrames <= 1, `${s.id} 内容长度或封装补帧无效`);
    for (const media of [s.intro, s.outro]) if (media) check(typeof media.muted === 'boolean', `${s.id} 视频素材须显式指定 muted`);
    check(s.speaker === 'male-chief' || s.speaker === 'female-host', `${s.id} 发言者无效`);
    if (s.chapter) check(integer(s.chapter.frames) && s.chapter.frames >= 24 && s.chapter.frames < s.frames, `${s.id} 章节转场须至少 24 帧且短于分镜`);
    check(!(s.intro && s.outro), `${s.id} 不能同时片头和片尾`);
    if (!s.intro && !s.outro) {
      short(s.summary, 22, '人物观点短句');
      const c = t.chapters.find((c) => s.from + (s.chapter?.frames ?? 0) >= c.from && end <= c.endFrameExclusive);
      check(c, `${s.id} 正文必须被一个章节完整覆盖`);
      check(s.visualBlocks.length || c.visualBlocks.length, `${s.id} 缺少图解`);
    }
    validateBlocks(s.visualBlocks, s.frames);
    for (const caption of s.captions) short(caption.text, 28, `${s.id} 字幕；请拆成独立配音短句`);
    let utteranceEnd = s.chapter?.frames ?? 0;
    for (const u of s.utterances) {
      check(integer(u.startFrame) && integer(u.endFrameExclusive) && u.startFrame >= utteranceEnd && u.endFrameExclusive > u.startFrame && u.endFrameExclusive <= contentFrames, `${s.id} 配音越界、重叠或与标题同屏`);
      utteranceEnd = u.endFrameExclusive;
    }
    if (s.outro) check(s.utterances.length && s.utterances[0].startFrame === 0 && utteranceEnd <= contentFrames, '片尾必须完整容纳收束旁白；素材尾音与封装补帧不延长字幕');
    for (const cue of s.sfx ?? []) check(integer(cue.frame) && cue.frame < contentFrames && (cue.durationFrames === undefined || (integer(cue.durationFrames) && cue.durationFrames > 0 && cue.frame + cue.durationFrames <= contentFrames)), `${s.id} 音效帧越界`);
  }
  check(t.scenes.length && end === t.totalFrames, '总帧数与分镜不一致');
}
