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
const kinds = ['episode-unimplemented', 'metric', ...listKinds, 'quote', 'trend', 'line', 'gauge', 'ring'];
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
    if (b.kind === 'episode-unimplemented') {
      recommend(warnings, false, b.id, '本期正文尚未实现；此标记仅供开发预览，不可交付');
      continue;
    }
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
  const utterances = t.scenes.flatMap((scene) => scene.utterances.map((utterance) => ({scene, utterance})));
  const utteranceIds = utterances.map(({utterance}) => utterance.id);
  check(utteranceIds.every((id) => typeof id === 'string' && id.trim()) && new Set(utteranceIds).size === utteranceIds.length, '配音 id 为空或重复');
  let bodyEnd = t.totalFrames;
  if (t.ending) {
    const e = t.ending;
    check(Array.isArray(e.closingUtteranceIds) && new Set(e.closingUtteranceIds).size === e.closingUtteranceIds.length, '固定结束语 id 无效或重复');
    check(utterances.length > 0, '结束记录缺少实际口播');
    check(e.closingUtteranceIds.length <= utterances.length && e.closingUtteranceIds.every((id, index) => id === utteranceIds[utteranceIds.length - e.closingUtteranceIds.length + index]), '固定结束语必须对应末尾连续口播');
    const last = utterances[utterances.length - 1];
    check(integer(e.narrationEndFrame) && e.narrationEndFrame === last.scene.from + last.utterance.endFrameExclusive, '全部口播结束帧与实际配音不一致');
    bodyEnd = e.narrationEndFrame;
    if (e.closingUtteranceIds.length) {
      const body = utterances[utterances.length - e.closingUtteranceIds.length - 1];
      check(body, '固定结束语之前必须有正文');
      check(e.holdFrame !== undefined && integer(e.holdFrame) && e.holdFrame === body.scene.from + body.utterance.endFrameExclusive - 1, '保持帧必须是结束语之前正文的最后一帧');
      bodyEnd = e.holdFrame + 1;
      const source = t.scenes.find((scene) => e.holdFrame! >= scene.from && e.holdFrame! < scene.from + scene.frames);
      check(source && !source.intro && e.holdFrame >= source.from + (source.chapter?.frames ?? 0), '保持帧必须来自完整正文，不能来自片头或章节转场');
      const chapter = t.chapters.find((c) => e.holdFrame! >= c.from && e.holdFrame! < c.endFrameExclusive);
      check(chapter, '保持帧没有对应正文章节');
      const blocks = source.visualBlocks.length ? source.visualBlocks : chapter.visualBlocks;
      const local = e.holdFrame - (source.visualBlocks.length ? source.from : chapter.from);
      check(blocks.some((b) => local >= b.startFrame && local < b.endFrameExclusive), '保持帧没有可显示的正文图解');
    } else {
      check(e.holdFrame === undefined, '没有固定结束语时不应指定保持帧');
    }
    if (e.outro) check(typeof e.outro.src === 'string' && e.outro.src.trim() && integer(e.outro.frames) && e.outro.frames > 0 && typeof e.outro.muted === 'boolean', '独立片尾须有本地路径、完整帧数及 muted');
    const finalScene = t.scenes[t.scenes.length - 1];
    const finalEnd = e.narrationEndFrame + (e.outro?.frames ?? 0);
    check(finalScene && e.narrationEndFrame > finalScene.from && (finalScene.contentFrames ?? finalScene.frames) === finalEnd - finalScene.from && finalScene.from + finalScene.frames >= finalEnd, '末镜内容长度必须等于完整口播加片尾；仅允许封装补帧');
  }
  let end = 0;
  const sceneIds = new Set<string>();
  for (const s of t.scenes) {
    check(s.id && !sceneIds.has(s.id), '分镜 id 为空或重复'); sceneIds.add(s.id);
    check(s.from === end && integer(s.frames) && s.frames > 0, `${s.id} 分镜必须连续且帧数有效`); end += s.frames;
    const contentFrames = s.contentFrames ?? s.frames;
    check(integer(contentFrames) && contentFrames > 0 && contentFrames <= s.frames, `${s.id} 内容长度或封装补帧无效`);
    check(!('outro' in s), `${s.id} 不再接受 scene.outro；片尾必须在全部口播后独立追加`);
    if (s.intro) check(typeof s.intro.muted === 'boolean', `${s.id} 视频素材须显式指定 muted`);
    check(s.speaker === 'male-chief' || s.speaker === 'female-host', `${s.id} 发言者无效`);
    if (s.chapter) check(integer(s.chapter.frames) && s.chapter.frames > 0 && s.chapter.frames < s.frames, `${s.id} 章节转场须为正且短于分镜`);
    const bodyUntil = Math.min(end, bodyEnd);
    if (!s.intro && s.from < bodyUntil) {
      short(s.summary, 22, '人物观点短句', warnings);
      let covered = s.from + (s.chapter?.frames ?? 0);
      for (const c of t.chapters.filter((c) => c.endFrameExclusive > covered && c.from < bodyUntil)) {
        check(c.from <= covered, `${s.id} 正文章节覆盖有空隙`);
        check(s.visualBlocks.length || c.visualBlocks.length, `${s.id} 缺少图解`);
        if (t.ending) {
          // 只检查真实正文，结束语保持区间复用已验证的完成状态。
          const origin = s.visualBlocks.length ? s.from : c.from;
          const blocks = s.visualBlocks.length ? s.visualBlocks : c.visualBlocks;
          let visualEnd = covered;
          for (const block of [...blocks].sort((a, b) => a.startFrame - b.startFrame)) {
            if (origin + block.endFrameExclusive <= visualEnd || origin + block.startFrame >= Math.min(c.endFrameExclusive, bodyUntil)) continue;
            check(origin + block.startFrame <= visualEnd, `${s.id} 正文图解覆盖有空隙`);
            visualEnd = Math.max(visualEnd, origin + block.endFrameExclusive);
          }
          check(visualEnd >= Math.min(c.endFrameExclusive, bodyUntil), `${s.id} 正文图解覆盖不完整`);
        }
        covered = c.endFrameExclusive;
      }
      check(covered >= bodyUntil, `${s.id} 正文章节覆盖不完整`);
    }
    validateBlocks(s.visualBlocks, s.frames, warnings);
    let captionEnd = 0;
    for (const caption of s.captions) {
      short(caption.text, 28, `${s.id} 字幕`, warnings);
      check(integer(caption.startFrame) && integer(caption.endFrameExclusive) && caption.startFrame >= captionEnd && caption.endFrameExclusive > caption.startFrame && caption.endFrameExclusive <= s.frames && (!t.ending || s.from + caption.endFrameExclusive <= t.ending.narrationEndFrame), `${s.id} 字幕越界或重叠`);
      captionEnd = caption.endFrameExclusive;
    }
    let utteranceEnd = s.chapter?.frames ?? 0;
    for (const u of s.utterances) {
      check(integer(u.startFrame) && integer(u.endFrameExclusive) && u.startFrame >= utteranceEnd && u.endFrameExclusive > u.startFrame && u.endFrameExclusive <= contentFrames, `${s.id} 配音越界、重叠或与标题同屏`);
      utteranceEnd = u.endFrameExclusive;
    }
    const soundFrames = Math.min(contentFrames, (t.ending?.narrationEndFrame ?? t.totalFrames) - s.from);
    for (const cue of s.sfx ?? []) check(integer(cue.frame) && cue.frame < soundFrames && (cue.durationFrames === undefined || (integer(cue.durationFrames) && cue.durationFrames > 0 && cue.frame + cue.durationFrames <= soundFrames)), `${s.id} 音效越过口播或内容边界`);
  }
  check(t.scenes.length && end === t.totalFrames, '总帧数与分镜不一致');
  return warnings;
}
