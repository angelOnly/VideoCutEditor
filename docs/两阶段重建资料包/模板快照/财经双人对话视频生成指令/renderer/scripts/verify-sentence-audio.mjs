#!/usr/bin/env node
/**
 * 句级音频审计：验证每句字幕都对应一条独立 TTS 的真实时长。
 * 不做中文逐字或逐词对齐，也不参与镜头、动效或素材创作。
 */
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
    const value = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path,
    ], {encoding: 'utf8'}).trim();
    const seconds = Number(value);
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
  const report = {fps: timeline.fps, scenes: []};

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
    require(rendered.captions.length === requested.length,
      `${scene.id} 的 captions 数量不等于短句 TTS 数量`);

    const captionsByUtterance = new Map(rendered.captions.map((caption) => [caption.utteranceId, caption]));
    const usedCaptions = new Set();
    let previousEnd = -1;
    for (let index = 0; index < requested.length; index += 1) {
      const item = requested[index];
      const utterance = rendered.utterances[index];
      require(typeof item.id === 'string' && item.id && !ttsIds.has(item.id), `${scene.id} 的 TTS id 重复或为空`);
      require(!/_full$/iu.test(item.id), `${scene.id} 不允许以整镜 _full TTS 代替句级音频`);
      ttsIds.add(item.id);
      require(normalized(item.text).length > 0 && Array.from(String(item.text)).length <= 28,
        `${scene.id} 第 ${index + 1} 条 TTS 须为不超过 28 字的语义短句`);
      require(splitNaturalSentences(item.text).length === 1, `${scene.id} 不得把多个自然句合成一条 TTS`);
      require(utterance.id === item.id && normalized(utterance.text) === normalized(item.text),
        `${scene.id} 第 ${index + 1} 条 timeline utterance 与 TTS 清单不一致`);
      const start = integer(utterance.startFrame, `${scene.id} 第 ${index + 1} 条音频起帧无效`);
      const end = integer(utterance.endFrameExclusive, `${scene.id} 第 ${index + 1} 条音频止帧无效`);
      require(start < end && start >= previousEnd, `${scene.id} 的句级音频边界重叠或倒序`);
      previousEnd = end;
      const caption = captionsByUtterance.get(item.id);
      require(caption && !usedCaptions.has(item.id), `${scene.id} 第 ${index + 1} 条 TTS 缺少一一对应字幕`);
      usedCaptions.add(item.id);
      require(normalized(caption.text) === normalized(item.text), `${scene.id} 第 ${index + 1} 条字幕文本与 TTS 不一致`);
      require(caption.startFrame === start && caption.endFrameExclusive === end,
        `${scene.id} 第 ${index + 1} 条字幕没有使用该句音频边界`);
      const seconds = audioSeconds(taskFile(publicDirectory, utterance.src));
      const frameSeconds = (end - start) / timeline.fps;
      require(Math.abs(seconds - frameSeconds) <= 1 / timeline.fps + 0.02,
        `${scene.id} 第 ${index + 1} 条音频实际 ${seconds.toFixed(3)} 秒，与时间轴 ${frameSeconds.toFixed(3)} 秒不符`);
    }
    require(captionsByUtterance.size === usedCaptions.size, `${scene.id} 存在未绑定 TTS 的字幕`);
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
