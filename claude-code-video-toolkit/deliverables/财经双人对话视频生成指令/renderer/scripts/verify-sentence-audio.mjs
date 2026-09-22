#!/usr/bin/env node
/**
 * 句级音频审计：验证每句字幕都对应一条独立 TTS 的真实时长。
 * 不做中文逐字或逐词对齐，也不参与镜头、动效或素材创作。
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

function fail(message) {
  throw new Error(`句级音频审计失败：${message}`);
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) fail(`缺少参数 ${name}`);
  return process.argv[index + 1];
}

function json(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`无法读取 JSON ${path}：${error.message}`);
  }
}

function normalized(text) {
  return String(text || '').replace(/\s+/gu, '');
}

/** 以中文和常见英文句末标点切句，保留紧随其后的引号或括号。 */
export function splitNaturalSentences(text) {
  const closing = new Set(['”', '’', '」', '』', '）', ')', ']', '】']);
  const endings = new Set(['。', '！', '？', '!', '?', '；', ';']);
  const sentences = [];
  let current = '';
  const chars = Array.from(String(text || ''));
  for (let index = 0; index < chars.length; index += 1) {
    current += chars[index];
    if (!endings.has(chars[index])) continue;
    while (index + 1 < chars.length && closing.has(chars[index + 1])) {
      current += chars[++index];
    }
    if (normalized(current)) sentences.push(current.trim());
    current = '';
  }
  if (normalized(current)) sentences.push(current.trim());
  return sentences;
}

function require(value, message) {
  if (!value) fail(message);
}

function integer(value, message) {
  require(Number.isInteger(value) && value >= 0, message);
  return value;
}

function audioSeconds(path) {
  try {
    // 使用解码采样数，避免 MP3 容器填充被误当成有效声音。
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], {maxBuffer: 64 * 1024 * 1024});
    const seconds = pcm.length / 2 / 48000;
    require(Number.isFinite(seconds) && seconds > 0, `${path} 的时长无效`);
    return seconds;
  } catch (error) {
    fail(`无法探测句级音频 ${path}：${error.message}`);
  }
}

function taskFile(publicDirectory, source) {
  require(typeof source === 'string' && source && !source.startsWith('/'), '音频 src 必须是 renderer/public 内相对路径');
  const root = resolve(publicDirectory);
  const file = resolve(root, source);
  require(file.startsWith(`${root}/`) || file === root, `音频越出 renderer/public：${source}`);
  try {
    require(statSync(file).isFile() && statSync(file).size > 0, `缺少句级音频：${source}`);
  } catch {
    fail(`缺少句级音频：${source}`);
  }
  return file;
}

export function auditSentenceAudio({plan, tts, timeline, publicDirectory}) {
  require(Array.isArray(plan.scenes) && plan.scenes.length > 0, '确认方案没有分镜');
  require(Array.isArray(tts), 'TTS 清单必须为数组');
  require(Number.isFinite(timeline.fps) && timeline.fps > 0, 'timeline.fps 无效');
  require(Array.isArray(timeline.scenes), 'timeline.scenes 必须为数组');

  const timelineByScene = new Map(timeline.scenes.map((scene) => [scene.id, scene]));
  const ttsIds = new Set();
  const report = {fps: timeline.fps, scenes: [], recommendations: []};

  for (const scene of plan.scenes) {
    const expectedText = normalized(scene.text);
    require(expectedText.length > 0, `${scene.id} 没有可配音句子`);
    const requested = tts.filter((item) => item.sceneId === scene.id);
    // 一个确认分镜可拆成多条短句，但原稿文字、标点及顺序不能改变。
    require(requested.length > 0 && requested.map((item) => normalized(item.text)).join('') === expectedText,
      `${scene.id} 短句 TTS 拼接后必须等于确认原稿`);
    const rendered = timelineByScene.get(scene.id);
    require(rendered, `${scene.id} 缺少 timeline 场景`);
    require(Array.isArray(rendered.utterances), `${scene.id} 缺少 utterances`);
    require(Array.isArray(rendered.captions), `${scene.id} 缺少 captions`);
    require(rendered.utterances.length === requested.length,
      `${scene.id} 的 utterances 数量不等于短句 TTS 数量`);
    const timing = rendered.captionTiming;
    let aligned;
    if (timing) {
      const file = taskFile(publicDirectory, timing.src);
      require(createHash('sha256').update(readFileSync(file)).digest('hex') === timing.sha256, `${scene.id} 对齐记录摘要不符`);
      aligned = json(file);
      require(['provider_timestamps', 'forced_alignment', 'reviewed_timestamps'].includes(aligned.method), '分页必须提供可靠时间依据，不能按字数比例切分');
    } else require(rendered.captions.length === requested.length, `${scene.id} 多页字幕须提供音频绑定的对齐记录`);

    require(rendered.captions.map((c) => normalized(c.text)).join('') === expectedText, `${scene.id} 字幕丢字或顺序不符`);
    let captionEnd = 0;
    for (const c of rendered.captions) {
      require(Number.isInteger(c.startFrame) && Number.isInteger(c.endFrameExclusive) && c.startFrame >= captionEnd && c.endFrameExclusive > c.startFrame && c.endFrameExclusive <= rendered.frames, `${scene.id} 字幕越界或重叠`);
      captionEnd = c.endFrameExclusive;
    }
    const usedCaptions = new Set();
    let previousEnd = -1;
    for (let index = 0; index < requested.length; index += 1) {
      const item = requested[index];
      const utterance = rendered.utterances[index];
      require(typeof item.id === 'string' && item.id && !ttsIds.has(item.id), `${scene.id} 的 TTS id 重复或为空`);

      ttsIds.add(item.id);
      require(normalized(item.text).length > 0, `${scene.id} 配音文本为空`);
      if (Array.from(String(item.text)).length > 28 || splitNaturalSentences(item.text).length > 1)
        report.recommendations.push({sceneId: scene.id, utteranceId: item.id, message: '建议短句字幕；复用音频，检查换行或按可靠对齐记录分页'});
      require(utterance.id === item.id && normalized(utterance.text) === normalized(item.text),
        `${scene.id} 第 ${index + 1} 条 timeline utterance 与 TTS 清单不一致`);
      const start = integer(utterance.startFrame, `${scene.id} 第 ${index + 1} 条音频起帧无效`);
      const end = integer(utterance.endFrameExclusive, `${scene.id} 第 ${index + 1} 条音频止帧无效`);
      require(start < end && start >= previousEnd, `${scene.id} 的句级音频边界重叠或倒序`);
      previousEnd = end;
      const pages = rendered.captions.filter((c) => c.utteranceId === item.id);
      require(pages.length && pages.map((c) => normalized(c.text)).join('') === normalized(item.text), `${scene.id} 配音对应字幕不完整`);
      for (const c of pages) { require(c.startFrame >= start && c.endFrameExclusive <= end, `${scene.id} 字幕超出音频窗口`); usedCaptions.add(c); }
      if (aligned) {
        const evidence = aligned.utterances?.[item.id];
        const hash = createHash('sha256').update(readFileSync(taskFile(publicDirectory, utterance.src))).digest('hex');
        require(evidence?.audioSha256 === hash, `${scene.id} 对齐记录不属于当前音频`);
        require(JSON.stringify(evidence.captions) === JSON.stringify(pages.map(({text, startFrame, endFrameExclusive}) => ({text, startFrame, endFrameExclusive}))), `${scene.id} 分页未使用对齐记录`);
      } else require(pages.length === 1 && pages[0].startFrame === start && pages[0].endFrameExclusive === end, `${scene.id} 字幕没有使用该句音频边界`);
      const seconds = audioSeconds(taskFile(publicDirectory, utterance.src));
      const frameSeconds = (end - start) / timeline.fps;
      require(seconds <= frameSeconds + 1e-6 && frameSeconds - seconds <= 1 / timeline.fps + 0.02,
        `${scene.id} 第 ${index + 1} 条音频实际 ${seconds.toFixed(3)} 秒，与时间轴 ${frameSeconds.toFixed(3)} 秒不符`);
    }
    require(rendered.captions.length === usedCaptions.size, `${scene.id} 存在未绑定 TTS 的字幕`);
    report.scenes.push({id: scene.id, sentenceCount: requested.length});
  }
  require(timelineByScene.size === plan.scenes.length, 'timeline 场景与确认方案数量不一致');
  require(ttsIds.size === tts.length, 'TTS 清单存在未绑定分镜的条目');
  return report;
}

function main() {
  const report = auditSentenceAudio({
    plan: json(option('--plan')),
    tts: json(option('--tts')),
    timeline: json(option('--timeline')),
    publicDirectory: option('--public-dir'),
  });
  const auditPath = option('--audit');
  mkdirSync(dirname(auditPath), {recursive: true});
  writeFileSync(auditPath, `${JSON.stringify({checkedAt: new Date().toISOString(), ...report}, null, 2)}\n`);
  process.stdout.write(`句级音频审计通过：${report.scenes.length} 个分镜\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
