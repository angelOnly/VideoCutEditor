/** 超默认值与真实布局回归；只使用本地素材和合成测试音频。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createRequire} = require('node:module');
const {execFileSync} = require('node:child_process');
const kit = path.resolve(__dirname, '..');
const template = path.join(kit, 'deliverables/财经双人对话视频生成指令');
const deps = path.join(kit, 'examples/hello-world/node_modules');
const req = createRequire(path.join(deps, '../package.json'));
const ts = req('typescript');
require.extensions['.tsx'] = require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX}}).outputText, f);
const {validateTimeline, validateBlocks} = require(path.join(template, 'renderer/src/validateTimeline.ts'));
const {motionFrames} = require(path.join(template, 'renderer/src/motion.ts'));
const flow = {id: 'six-steps', kind: 'flow', startFrame: 0, endFrameExclusive: 90, props: {items: ['识别问题', '采集数据', '模型分析', '制定方案', '落实应用', '检验结果'], itemFrames: [0, 10, 20, 30, 40, 50]}};
const quote = {id: 'quote', kind: 'quote', startFrame: 0, endFrameExclusive: 90, props: {label: '检查', text: '默认范围不是内容上限'}};
const title = '这是用于验证超出默认文字建议后仍然能够自然分行而不会被机械终止的完整章节标题，再检查第二行是否完整显示';
const subtitle = '这条字幕超过默认二十八字，但仍保留完整文字并使用同一段真实时间窗口，不按字数猜测时间。换行不能删掉后半句，也不能缩小字号。';
const timeline = {fps: 30, width: 1920, height: 1080, totalFrames: 630, title: '自适应回归', chapters: Array.from({length: 7}, (_, i) => ({id: `c${i}`, label: `主题${i+1}`, title: i===0 ? title : `第${i+1}个主题`, summary: '章节导航与全片进度保持连续', from: i*90, endFrameExclusive: (i+1)*90, visualBlocks: [structuredClone(i===0?flow:quote)]})), scenes: [{id:'all',from:0,frames:630,contentFrames:600,speaker:'female-host',summary:'超出默认范围后调整呈现',utterances:[],captions:[{utteranceId:'test',text:subtitle,startFrame:0,endFrameExclusive:630}],visualBlocks:[]}]};
const warnings=validateTimeline(timeline);
assert.ok(warnings.some(w=>w.location==='chapters'));
assert.ok(warnings.some(w=>w.location==='six-steps'));
// 同一分镜镜内切章；合理多次延长无需触碰声音和字幕边界。
const extended=structuredClone(timeline);extended.scenes[0].frames+=60;extended.totalFrames+=60;extended.chapters.at(-1).endFrameExclusive+=60;validateTimeline(extended);
extended.scenes[0].frames+=90;extended.totalFrames+=90;extended.chapters.at(-1).endFrameExclusive+=90;validateTimeline(extended);
for(const frames of [1,3,10,90]) assert.ok(motionFrames(frames,undefined,45)<=frames-1);
assert.equal(motionFrames(100,70,13),70);
const short=structuredClone(quote);short.endFrameExclusive=3;assert.ok(validateBlocks([short],3).length);
assert.throws(()=>validateBlocks([{...quote,kind:'unimplemented'}],90),/注册/);
const bad=structuredClone(timeline);bad.scenes[0].captions[0].endFrameExclusive=631;assert.throws(()=>validateTimeline(bad),/字幕越界/);
const overlap=[{...quote,id:'a'}, {...quote,id:'b',intentionalOverlap:true}];assert.ok(validateBlocks(overlap,90).some(w=>w.location==='a/b'));
console.log('参数回归通过：七章、镜内切章、六步、长文、可调动画、叠层提示、多次延长及反向边界');
async function main(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-adaptive-'));const project=path.join(temp,'renderer');
 fs.cpSync(path.join(template,'renderer'),project,{recursive:true});fs.symlinkSync(deps,path.join(project,'node_modules'),'dir');
 fs.cpSync(path.join(template,'assets/images'),path.join(project,'public/template-assets/assets/images'),{recursive:true});
 // 测试任务新增真实组件，不向公共模板加入无关业务类型。
 fs.writeFileSync(path.join(project,'src/visualExtensions.tsx'),`import type {ComponentType} from 'react';import type {VisualBlock} from './types';\nexport const visualExtensions: Record<string,{component:ComponentType<{block:VisualBlock;frame:number}>;validate:(block:VisualBlock)=>void}>={pulse:{component:({block,frame})=><div data-custom-motion style={{color:'#49c7df',fontSize:48,background:block.props.note?'#142a3b':undefined,border:block.props.note?'2px solid #49c7df':undefined,padding:block.props.note?12:0,width:block.props.note?240:undefined,marginLeft:block.props.note?'auto':undefined,transform:block.props.note?'translateY(-72px)':\`scale(\${.8+Math.min(frame/20,1)*.2})\`}}>{String(block.props.text)}</div>,validate:(b)=>{if(typeof b.props.text!=='string')throw Error('自定义参数无效')}}};`);
 const t=structuredClone(timeline);t.chapters[1].visualBlocks=[{...quote,kind:'pulse',props:{text:'任务内新动效'}}];
 t.chapters[2].visualBlocks=[{...quote,id:'base'}, {...quote,id:'annotation',kind:'pulse',intentionalOverlap:true,props:{text:'核对依据',note:true}}];
 t.chapters[3].visualBlocks=[{...flow,animationFrames:2}];t.chapters[4].visualBlocks=[{...flow,animationFrames:35,props:{...flow.props,itemFrames:[0,2,4,6,8,10]}}];
 fs.mkdirSync(path.join(project,'public/template-assets/assets/audio/sfx'),{recursive:true});
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','5',path.join(project,'public/template-assets/assets/audio/sfx/long.wav')]);
 t.scenes[0].sfx=[{src:'assets/audio/sfx/long.wav',frame:0}];
 fs.writeFileSync(path.join(project,'src/timeline.ts'),`import type {FinanceTimeline} from './types';export const timeline:FinanceTimeline=${JSON.stringify(t)};`);
 // 测试入口允许提供不同布局，触发实际 DOM 检查后在同一副本修正。
 fs.writeFileSync(path.join(project,'src/TestRoot.tsx'),`import {Composition,registerRoot} from 'remotion';import {FinanceScene} from './FinancialDialogue';import {timeline} from './timeline';import {validateTimeline} from './validateTimeline';validateTimeline(timeline);registerRoot(()=> <Composition id="Adaptive" component={FinanceScene} width={1920} height={1080} fps={30} durationInFrames={630} defaultProps={{scene:timeline.scenes[0],timeline,withBgm:false}}/>);`);
 execFileSync(process.execPath,[path.join(deps,'typescript/bin/tsc'),'--noEmit','-p',project],{stdio:'inherit'});
 if(!process.argv.includes('--render')){console.log('扩展组件 TypeScript 通过');return;}
 const {bundle}=req('@remotion/bundler');const {selectComposition,renderStill,renderMedia,openBrowser}=req('@remotion/renderer');
 const serveUrl=await bundle({entryPoint:path.join(project,'src/TestRoot.tsx'),outDir:path.join(temp,'bundle')});
 const browserExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const puppeteerInstance=await openBrowser('chrome',{browserExecutable});
 try {
 const composition=await selectComposition({serveUrl,id:'Adaptive',browserExecutable,puppeteerInstance});
 if(!process.argv.includes('--sfx-only')) {
 for(const frame of [65,90,100,115,150,220,335,425,515,605])await renderStill({serveUrl,composition,frame,browserExecutable,puppeteerInstance,output:path.join(temp,`frame-${frame}.png`)});
 const wrong=structuredClone(t);wrong.chapters[2].visualBlocks[1]={...quote,id:'blocking-card',props:{label:'错误覆盖',text:'这张卡片不应该挡住原内容'}};
 await assert.rejects(renderStill({serveUrl,composition:{...composition,props:{scene:wrong.scenes[0],timeline:wrong,withBgm:false}},inputProps:{scene:wrong.scenes[0],timeline:wrong,withBgm:false},frame:220,browserExecutable,puppeteerInstance,output:path.join(temp,'wrong.png')}),/TASK_LAYOUT_INVALID/);
 wrong.chapters[2].visualBlocks[0].slot='top';wrong.chapters[2].visualBlocks[1].slot='bottom';
 await renderStill({serveUrl,composition:{...composition,props:{scene:wrong.scenes[0],timeline:wrong,withBgm:false}},inputProps:{scene:wrong.scenes[0],timeline:wrong,withBgm:false},frame:220,browserExecutable,puppeteerInstance,output:path.join(temp,'overlap-repaired.png')});
 const overflow=structuredClone(t);overflow.scenes[0].captions[0].text='超长字幕'.repeat(40);
 await assert.rejects(renderStill({serveUrl,composition:{...composition,props:{scene:overflow.scenes[0],timeline:overflow,withBgm:false}},inputProps:{scene:overflow.scenes[0],timeline:overflow,withBgm:false},frame:65,browserExecutable,puppeteerInstance,output:path.join(temp,'overflow.png')}),/TASK_LAYOUT_INVALID/);
 for(const [name,range] of [['new-motion',[90,120]],['short-motion',[270,300]],['long-motion',[360,405]],['chapter-switch',[80,100]],['overlay',[190,220]]])await renderMedia({serveUrl,composition,browserExecutable,puppeteerInstance,codec:'h264',concurrency:1,frameRange:range,outputLocation:path.join(temp,name+'.mp4')});
 }
 await renderMedia({serveUrl,composition,browserExecutable,puppeteerInstance,codec:'h264',concurrency:1,frameRange:[0,164],outputLocation:path.join(temp,'long-sfx.mp4')});
 const pcm=execFileSync('ffmpeg',['-v','error','-ss','4.5','-i',path.join(temp,'long-sfx.mp4'),'-vn','-ac','1','-f','s16le','-']);
 let peak=0;for(let i=0;i+1<pcm.length;i+=2)peak=Math.max(peak,Math.abs(pcm.readInt16LE(i)));assert.ok(peak>100,'长于三秒的音效被意外截断');
 fs.writeFileSync(path.join(temp,'result.json'),JSON.stringify({passed:true,recommendations:warnings,checks:['七章导航','六步流程','镜内切章','任务内扩展','短/长动画','有意叠层','实际遮挡拦截及任务内修复','文字溢出拦截','长标题/字幕换行'],humanListeningPerformed:false},null,2));
 console.log('自适应真实渲染结果：'+temp);
 } finally {await puppeteerInstance.close({silent:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
