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
// 覆盖章节转场与串行片尾：测试音频是本地正弦波，不冒充正式 TTS。
timeline.scenes[2].chapter = {title: '进入对比章节', frames: 36};
timeline.scenes[2].captions[0].startFrame = 36;
timeline.scenes[11].utterances = [{id: 'body-final', text: '正文最后结论。', src: 'audio/body-test.wav', startFrame: 0, endFrameExclusive: 180}];
timeline.scenes.push({id: 'scene_closing', from: 2160, frames: 135, contentFrames: 135, speaker: 'female-host', summary: '固定结束语',
  utterances: [
    {id: 'closing-one', text: '每天三分钟，', src: 'audio/closing-one.wav', startFrame: 0, endFrameExclusive: 45},
    {id: 'closing-two', text: '拆解财报里的关键信号。', src: 'audio/closing-two.wav', startFrame: 45, endFrameExclusive: 90},
  ],
  captions: [
    {utteranceId: 'closing-one', text: '每天三分钟，', startFrame: 0, endFrameExclusive: 45},
    {utteranceId: 'closing-two', text: '拆解财报里的关键信号。', startFrame: 45, endFrameExclusive: 90},
  ], visualBlocks: []});
timeline.totalFrames = 2295;
timeline.ending = {closingUtteranceIds: ['closing-one', 'closing-two'], holdFrame: 2159, narrationEndFrame: 2250,
  outro: {src: 'assets/video/outro/normalized-test.mp4', frames: 45, muted: false}};
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
bad((t) => t.ending.closingUtteranceIds = ['closing-two', 'closing-one'], /末尾连续/);
bad((t) => t.ending.closingUtteranceIds = ['body-final'], /末尾连续/);
bad((t) => t.ending.holdFrame = 2158, /最后一帧/);
bad((t) => t.ending.narrationEndFrame = 2251, /实际配音/);
bad((t) => t.ending.outro.frames = 46, /内容长度/);
bad((t) => t.scenes[12].outro = {src:'old.mov', muted:false}, /scene.outro/);
bad((t) => t.scenes[11].utterances[0].id = 'closing-one', /id 为空或重复/);
bad((t) => t.scenes[12].sfx = [{src:'late.wav',frame:89,durationFrames:2}], /音效越过/);
bad((t) => t.scenes[12].captions[1].endFrameExclusive = 91, /字幕越界/);
bad((t) => t.chapters[5].visualBlocks.forEach((b) => b.endFrameExclusive = 359), /保持帧/);
bad((t) => t.chapters[4].visualBlocks[1].startFrame = 181, /图解覆盖/);
bad((t) => t.scenes[11].intro = {src:'intro.mov',muted:true}, /来自完整正文/);
const noOutro = structuredClone(timeline); delete noOutro.ending.outro; noOutro.scenes[12].frames = noOutro.scenes[12].contentFrames = 90; noOutro.totalFrames = 2250; validateTimeline(noOutro);
const noClosing = structuredClone(timeline); noClosing.ending.closingUtteranceIds = []; delete noClosing.ending.holdFrame;
noClosing.chapters[5].endFrameExclusive = 2250; noClosing.chapters[5].visualBlocks.forEach((b) => b.endFrameExclusive = 450); validateTimeline(noClosing);
const sameScene = structuredClone(timeline); sameScene.scenes.pop(); sameScene.scenes[11].frames = sameScene.scenes[11].contentFrames = 315;
sameScene.scenes[11].utterances.push(...timeline.scenes[12].utterances.map((u) => ({...u,startFrame:u.startFrame+180,endFrameExclusive:u.endFrameExclusive+180})));
sameScene.scenes[11].captions.push(...timeline.scenes[12].captions.map((c) => ({...c,startFrame:c.startFrame+180,endFrameExclusive:c.endFrameExclusive+180}))); validateTimeline(sameScene);
const multiScene = structuredClone(timeline); const closing = multiScene.scenes.pop();
multiScene.scenes.push({...closing,id:'closing-a',frames:45,contentFrames:45,utterances:[closing.utterances[0]],captions:[closing.captions[0]]},
  {...closing,id:'closing-b',from:2205,frames:90,contentFrames:90,utterances:[{...closing.utterances[1],startFrame:0,endFrameExclusive:45}],captions:[{...closing.captions[1],startFrame:0,endFrameExclusive:45}]}); validateTimeline(multiScene);
const padded = structuredClone(timeline); padded.totalFrames += 2; padded.scenes[12].frames += 2; validateTimeline(padded);
const noEnding = structuredClone(timeline); delete noEnding.ending; noEnding.scenes.pop(); noEnding.totalFrames = 2160; validateTimeline(noEnding);
const example = JSON.parse(fs.readFileSync(path.join(template,'renderer/timeline.example.json'),'utf8')); validateTimeline(example);
console.log('模板参数回归通过：10 类动效、正文保持、同镜/跨镜结束语、独立片尾、禁用路径与失败用例');

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
  fs.mkdirSync(path.join(renderer, 'public/audio'), {recursive: true});
  for (const [name,frequency,seconds] of [['body-test',440,6],['closing-one',660,1.5],['closing-two',880,1.5]])
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000`, '-t', String(seconds), path.join(renderer, `public/audio/${name}.wav`)]);
  // 同时依赖显式 frame 和 useCurrentFrame，验证保持层的两套时间都停止。
  fs.writeFileSync(path.join(renderer,'src/visualExtensions.tsx'), `import {useCurrentFrame} from 'remotion';import type {VisualExtension} from './visualExtensions';
export const visualExtensions:Record<string,VisualExtension>={frameProbe:{component:({frame})=><div style={{fontSize:64,color:'#49c7df'}}>正文完成状态：{frame} / {useCurrentFrame()}</div>,validate:()=>{}}};`.replace("import type {VisualExtension} from './visualExtensions';", "import type {ComponentType} from 'react';import type {VisualBlock} from './types';type VisualExtension={component:ComponentType<{block:VisualBlock;frame:number}>;validate:(b:VisualBlock)=>void};"));
  const actual = structuredClone(timeline);
  fs.mkdirSync(path.join(renderer,'public/template-assets/assets/audio'),{recursive:true});
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','2',path.join(renderer,'public/template-assets/assets/audio/bgm-test.wav')]);
  actual.bgm={src:'assets/audio/bgm-test.wav',volume:.11};
  actual.scenes[11].visualBlocks = [{id:'frame-probe',kind:'frameProbe',startFrame:0,endFrameExclusive:180,props:{}}];
  fs.writeFileSync(path.join(renderer, 'src/timeline.ts'), `import type {FinanceTimeline} from './types';\nexport const timeline: FinanceTimeline = ${JSON.stringify(actual, null, 2)};\n`);
  const {bundle} = req('@remotion/bundler');
  const {selectComposition, renderStill, renderMedia, openBrowser} = req('@remotion/renderer');
  const serveUrl = await bundle({entryPoint: path.join(renderer, 'src/index.ts'), outDir: path.join(temp, 'bundle')});
  const browserExecutable = process.env.VIDEO_TEST_BROWSER || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  const puppeteerInstance = await openBrowser('chrome',{browserExecutable});
  try {
  const composition = await selectComposition({serveUrl, id: 'FinanceEpisode', browserExecutable, puppeteerInstance});
  const frames = process.argv.includes('--ending-only') ? [550,1980,2159,2180,2226,2250,2294] : [30,100,160,210,375,400,460,520,550,930,1290,1560,1690,1980,2010,2159,2180,2226,2250,2294];
  for (const frame of frames) {
    await renderStill({serveUrl, composition, frame, browserExecutable, puppeteerInstance, output: path.join(temp, `frame-${frame}.png`)});
  }
  // 同一个绝对帧的全片与单镜输出必须逐像素一致。
  const single = await selectComposition({serveUrl, id: 'FinanceScene-4', browserExecutable, puppeteerInstance});
  await renderStill({serveUrl, composition: single, frame: 10, browserExecutable, puppeteerInstance, output: path.join(temp, 'single-550.png')});
  const pixelHash = (file) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'hash', '-hash', 'sha256', '-'], {encoding: 'utf8'}).trim();
  assert.equal(pixelHash(path.join(temp, 'frame-550.png')), pixelHash(path.join(temp, 'single-550.png')));
  const extensionPixels = execFileSync('ffmpeg',['-v','error','-i',path.join(temp,'frame-1980.png'),'-vf','crop=1500:130:127:590','-pix_fmt','rgb24','-f','rawvideo','-']);
  let cyanPixels=0; for(let i=0;i<extensionPixels.length;i+=3) if(extensionPixels[i]<110 && extensionPixels[i+1]>150 && extensionPixels[i+2]>150) cyanPixels++;
  assert.ok(cyanPixels>100,'扩展首帧被外层重复入场隐藏');
  const bodyHash = (file) => execFileSync('ffmpeg', ['-v','error','-i',file,'-vf','drawbox=x=0:y=890:w=iw:h=90:color=black:t=fill','-f','hash','-hash','sha256','-'],{encoding:'utf8'}).trim();
  for (const frame of [2180,2226,2250,2294]) assert.equal(bodyHash(path.join(temp,'frame-2159.png')),bodyHash(path.join(temp,`frame-${frame}.png`)), '正文视觉/导航/内部时钟没有保持');
  assert.notEqual(pixelHash(path.join(temp,'frame-2180.png')),pixelHash(path.join(temp,'frame-2226.png')),'结束语字幕未更新');
  assert.equal(pixelHash(path.join(temp,'frame-2250.png')),pixelHash(path.join(temp,'frame-2294.png')),'片尾占位未保持静态');
  const closingSingle = await selectComposition({serveUrl,id:'FinanceScene-13',browserExecutable,puppeteerInstance});
  await renderStill({serveUrl,composition:closingSingle,frame:66,browserExecutable,puppeteerInstance,output:path.join(temp,'single-2226.png')});
  assert.equal(pixelHash(path.join(temp,'single-2226.png')),pixelHash(path.join(temp,'frame-2226.png')));
  if(!process.argv.includes('--ending-only')) await renderMedia({serveUrl, composition, browserExecutable, puppeteerInstance, codec: 'h264', frameRange: [360, 569], concurrency: 2,
    outputLocation: path.join(temp, 'comparison-motion.mp4')});
  await renderMedia({serveUrl, composition: closingSingle, browserExecutable, puppeteerInstance, codec: 'h264', concurrency: 2,
    outputLocation: path.join(temp, 'closing-hold-and-placeholder.mp4')});
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(temp, 'closing-hold-and-placeholder.mp4'), '-vn', '-ac', '1', '-ar','48000','-f', 's16le', '-']);
  const rms = (from,to) => {let sum=0,count=0;for(let i=Math.floor(from*48000)*2;i<Math.min(pcm.length,Math.floor(to*48000)*2);i+=2){sum+=pcm.readInt16LE(i)**2;count++;}return Math.sqrt(sum/Math.max(1,count));};
  const toneAmplitude = (from,to,frequency) => {let re=0,im=0,count=0;for(let sample=Math.floor(from*48000);sample<Math.min(pcm.length/2,Math.floor(to*48000));sample++){const v=pcm.readInt16LE(sample*2);const phase=2*Math.PI*frequency*sample/48000;re+=v*Math.cos(phase);im+=v*Math.sin(phase);count++;}return 2*Math.hypot(re,im)/Math.max(1,count);};
  assert.ok(toneAmplitude(.2,1.2,660)>1000 && toneAmplitude(1.7,2.7,880)>1000,'固定结束语配音被保持层吞掉或顺序错误');
  assert.ok(toneAmplitude(1.7,2.7,660)<100,'第一句固定结束语重复播放');
  assert.ok(rms(3.2,4.3)<5,'口播结束后的片尾占位仍有正文声音');
  console.log(`视觉回归输出：${temp}；单镜／全片同帧像素一致。`);
  } finally {await puppeteerInstance.close({silent:true});}
}
main().catch((error) => {console.error(error); process.exitCode = 1;});
