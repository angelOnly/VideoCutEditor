/** 本地模板回归：无网络配音、不调用 Worker；--render 额外导出视觉样片。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {execFileSync} = require('node:child_process');
const toolkit = path.resolve(__dirname, '..');
const template = path.join(toolkit, 'deliverables/财经双人对话视频生成指令');
const deps = process.env.VIDEO_TEST_NODE_MODULES || path.join(toolkit, 'examples/hello-world/node_modules');
const req = createRequire(path.join(deps, '../package.json'));
const ts = req('typescript');

// 只给本测试加载模板 TS；正式入口仍由 Remotion 编译。
require.extensions['.tsx'] = require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, file);
const {validateTimeline, validateBlocks} = require(path.join(template, 'renderer/src/validateTimeline.ts'));
const block = (kind, props, slot = 'full', startFrame = 0, endFrameExclusive = 360) => ({id: kind, kind, props, slot, startFrame, endFrameExclusive});
const groups = [
  [block('metric', {label: '示例指标', value: '4.32%', detail: '仅用于布局回归'}, 'top'),
    block('line', {label: '示例序列', values: [2, 5, 3], labels: ['甲', '乙', '丙'], source: '测试数据，不作事实展示', revealFrame: 90}, 'bottom')],
  [block('comparison', {items: ['技术能力领先', '应用落地加速'], itemFrames: [0, 90]})],
  [block('layers', {items: ['能源', '芯片', '基础设施', '模型', '应用'], itemFrames: [0, 45, 90, 135, 180]})],
  [block('gauge', {label: '阈值示例', value: 65.6, threshold: 80, detail: '只验证动画，不作为财务数据', revealFrame: 30}, 'left'),
    block('ring', {label: '占比示例', value: 44.8, detail: '扇区展开后保留数值', revealFrame: 90}, 'right')],
  [block('labels', {items: ['定点', '资金', '营收', '转固', '准备'], itemFrames: [0, 30, 60, 90, 120]}, 'full', 0, 180),
    block('flow', {items: ['政策变化', '市场影响', '应用结果'], itemFrames: [0, 45, 90]}, 'full', 180, 360)],
  [block('quote', {label: '核心观点', text: '技术能力需要通过真实应用创造价值'}, 'top'),
    block('trend', {label: '端点示例', from: '90%', to: '0%', revealFrame: 90}, 'bottom')],
];
const labels = ['指标', '对比', '层级', '占比', '清单', '结论'];
const timeline = {fps: 30, width: 1920, height: 1080, totalFrames: 2160, title: '模板视觉回归（无配音）',
  chapters: groups.map((visualBlocks, i) => ({id: `chapter_${i}`, label: labels[i], title: `${labels[i]}组件与参考布局回归`,
    summary: '底部摘要与逐句字幕独立，进度按全片推进', from: i * 360, endFrameExclusive: (i + 1) * 360, visualBlocks})),
  scenes: Array.from({length: 12}, (_, i) => ({id: `scene_${i}`, from: i * 180, frames: 180,
    speaker: i % 2 ? 'male-chief' : 'female-host', summary: '让技术能力转化为真实应用', utterances: [],
    captions: [{utteranceId: `fixture_${i}`, text: '这是一条独立字幕，不是章节摘要。', startFrame: 0, endFrameExclusive: 180}], visualBlocks: []})),
};
// 覆盖章节转场与片尾：测试音频是本地正弦波，不冒充正式 TTS。
timeline.scenes[2].chapter = {title: '进入对比章节', frames: 36};
timeline.scenes[2].captions[0].startFrame = 36;
timeline.scenes.push({id: 'scene_outro', from: 2160, frames: 90, speaker: 'female-host', summary: '收束',
  outro: {src: 'assets/video/outro/financial-intro-logo-sfx-v3.mov', muted: false},
  utterances: [{id: 'outro-test', text: '测试音频。', src: 'audio/outro-test.wav', startFrame: 0, endFrameExclusive: 90}],
  captions: [{utteranceId: 'outro-test', text: '测试音频。', startFrame: 0, endFrameExclusive: 90}], visualBlocks: []});
timeline.totalFrames = 2250;
validateTimeline(timeline);
const bad = (edit, pattern) => {const value = structuredClone(timeline); edit(value); assert.throws(() => validateTimeline(value), pattern);};
const advice = (edit, location) => {const value = structuredClone(timeline); edit(value); assert.ok(validateTimeline(value).some((w) => w.location.includes(location)));};
advice((t) => t.scenes[0].summary = '长'.repeat(23), '观点');
advice((t) => t.scenes[0].captions[0].text = '长'.repeat(29), '字幕');
bad((t) => t.chapters = [], /章节/);
advice((t) => t.chapters[0].visualBlocks[1].slot = 'full', 'metric/line');
bad((t) => t.chapters[1].visualBlocks[0].props.itemFrames = [0, 0], /递增/);
bad((t) => t.chapters[0].visualBlocks[1].props.source = '', /出处/);
bad((t) => t.scenes[1].from = 179, /连续/);
bad((t) => {t.chapters[0].endFrameExclusive = 359; t.chapters[0].visualBlocks.forEach((b) => b.endFrameExclusive = 359);}, /覆盖/);
const fast = structuredClone(timeline); fast.scenes[0].chapter = {title: '快速切换', frames: 3}; validateTimeline(fast);
bad((t) => t.scenes[0].captions[0].endFrameExclusive = 181, /字幕越界/);
assert.throws(() => validateBlocks([block('ring', {label: '占比', value: 101, detail: '无效', revealFrame: 0})], 360), /百分比/);
console.log('模板参数回归通过：10 类动效、6 个章节、跨分镜与片尾及失败用例');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-template-regression-'));
  const renderer = path.join(temp, 'renderer');
  fs.cpSync(path.join(template, 'renderer'), renderer, {recursive: true});
  fs.symlinkSync(deps, path.join(renderer, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(renderer, 'src/timeline.ts'), `import type {FinanceTimeline} from './types';\nexport const timeline: FinanceTimeline = ${JSON.stringify(timeline, null, 2)};\n`);
  execFileSync(process.execPath, [path.join(deps, 'typescript/bin/tsc'), '--noEmit', '-p', renderer], {stdio: 'inherit'});
  console.log('模板 TypeScript 检查通过');
  if (!process.argv.includes('--render')) {fs.rmSync(temp, {recursive: true, force: true}); return;}
  fs.cpSync(path.join(template, 'assets/images'), path.join(renderer, 'public/template-assets/assets/images'), {recursive: true});
  fs.cpSync(path.join(template, 'assets/video/outro'), path.join(renderer, 'public/template-assets/assets/video/outro'), {recursive: true});
  fs.mkdirSync(path.join(renderer, 'public/audio'), {recursive: true});
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', path.join(renderer, 'public/audio/outro-test.wav')]);
  const {bundle} = req('@remotion/bundler');
  const {selectComposition, renderStill, renderMedia} = req('@remotion/renderer');
  const serveUrl = await bundle({entryPoint: path.join(renderer, 'src/index.ts'), outDir: path.join(temp, 'bundle')});
  const browserExecutable = process.env.VIDEO_TEST_BROWSER || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  const composition = await selectComposition({serveUrl, id: 'FinanceEpisode', browserExecutable});
  for (const frame of [30, 100, 160, 210, 375, 400, 460, 520, 550, 930, 1290, 1560, 1690, 2010, 2226, 2249]) {
    await renderStill({serveUrl, composition, frame, browserExecutable, output: path.join(temp, `frame-${frame}.png`)});
  }
  // 同一个绝对帧的全片与单镜输出必须逐像素一致。
  const single = await selectComposition({serveUrl, id: 'FinanceScene-4', browserExecutable});
  await renderStill({serveUrl, composition: single, frame: 10, browserExecutable, output: path.join(temp, 'single-550.png')});
  const pixelHash = (file) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'hash', '-hash', 'sha256', '-'], {encoding: 'utf8'}).trim();
  assert.equal(pixelHash(path.join(temp, 'frame-550.png')), pixelHash(path.join(temp, 'single-550.png')));
  assert.equal(pixelHash(path.join(temp, 'frame-2226.png')), pixelHash(path.join(temp, 'frame-2249.png')));
  await renderMedia({serveUrl, composition, browserExecutable, codec: 'h264', frameRange: [360, 569], concurrency: 2,
    outputLocation: path.join(temp, 'comparison-motion.mp4')});
  await renderMedia({serveUrl, composition, browserExecutable, codec: 'h264', frameRange: [2160, 2249], concurrency: 2,
    outputLocation: path.join(temp, 'outro-audio-test.mp4')});
  // 动效原声在 67 帧结束，最后半秒仍有音频才能证明收束旁白没有被分支吞掉。
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', '2.5', '-i', path.join(temp, 'outro-audio-test.mp4'), '-vn', '-ac', '1', '-f', 's16le', '-']);
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  assert.ok(peak > 100, '片尾末段缺少独立配音');
  console.log(`视觉回归输出：${temp}；单镜／全片同帧像素一致。`);
}
main().catch((error) => {console.error(error); process.exitCode = 1;});
