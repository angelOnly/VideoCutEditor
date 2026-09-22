import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'sentence-audio-validator-'));
const validator = fileURLToPath(new URL('../deliverables/财经双人对话视频生成指令/renderer/scripts/verify-sentence-audio.mjs', import.meta.url));
const json = (name, value) => {
  const path = join(root, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};

try {
  mkdirSync(join(root, 'public/audio'), {recursive: true});
  for (const name of ['one.wav', 'two.wav']) {
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', join(root, 'public/audio', name)]);
  }
  const plan = json('plan.json', {scenes: [{id: 'scene_001', text: '第一句。第二句。'}]});
  const tts = json('tts.json', [
    {id: 'scene_001_sentence_01', sceneId: 'scene_001', text: '第一句。'},
    {id: 'scene_001_sentence_02', sceneId: 'scene_001', text: '第二句。'},
  ]);
  const timeline = json('timeline.json', {
    fps: 30,
    scenes: [{
      id: 'scene_001', frames: 60,
      utterances: [
        {id: 'scene_001_sentence_01', text: '第一句。', src: 'audio/one.wav', startFrame: 0, endFrameExclusive: 30},
        {id: 'scene_001_sentence_02', text: '第二句。', src: 'audio/two.wav', startFrame: 30, endFrameExclusive: 60},
      ],
      captions: [
        {utteranceId: 'scene_001_sentence_01', text: '第一句。', startFrame: 0, endFrameExclusive: 30},
        {utteranceId: 'scene_001_sentence_02', text: '第二句。', startFrame: 30, endFrameExclusive: 60},
      ],
    }],
  });
  const audit = join(root, 'audit.json');
  execFileSync(process.execPath, [validator, '--plan', plan, '--tts', tts, '--timeline', timeline,
    '--public-dir', join(root, 'public'), '--audit', audit]);
  assert.equal(JSON.parse(readFileSync(audit)).scenes[0].sentenceCount, 2);

  const invalidTts = json('invalid-tts.json', [{id: 'scene_001_full', sceneId: 'scene_001', text: '第一句。第二句。'}]);
  const failure = spawnSync(process.execPath, [validator, '--plan', plan, '--tts', invalidTts, '--timeline', timeline,
    '--public-dir', join(root, 'public'), '--audit', join(root, 'invalid-audit.json')], {encoding: 'utf8'});
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /短句 TTS/);

  // 长自然句允许在逗号处分段；每段仍绑定独立真实音频。
  const shortPlan = json('short-plan.json', {scenes: [{id: 'scene_001', text: '第一部分，第二部分。'}]});
  const shortTts = JSON.parse(readFileSync(tts));
  const shortTimeline = JSON.parse(readFileSync(timeline));
  ['第一部分，', '第二部分。'].forEach((text, i) => {
    shortTts[i].text = text;
    shortTimeline.scenes[0].utterances[i].text = text;
    shortTimeline.scenes[0].captions[i].text = text;
  });
  const shortTtsPath = json('short-tts.json', shortTts);
  const shortTimelinePath = json('short-timeline.json', shortTimeline);
  execFileSync(process.execPath, [validator, '--plan', shortPlan, '--tts', shortTtsPath, '--timeline', shortTimelinePath,
    '--public-dir', join(root, 'public'), '--audit', audit]);
  shortTts[1].text = '被改写的部分。';
  const rewritten = spawnSync(process.execPath, [validator, '--plan', shortPlan, '--tts', json('rewritten.json', shortTts), '--timeline', shortTimelinePath,
    '--public-dir', join(root, 'public'), '--audit', audit], {encoding: 'utf8'});
  assert.notEqual(rewritten.status, 0);
  assert.match(rewritten.stderr, /拼接后必须等于确认原稿/);
  const {auditSentenceAudio} = await import(validator);
  const current = JSON.parse(readFileSync(timeline));
  const pages = current.scenes[0].captions;
  pages.splice(0, 1, {utteranceId:'scene_001_sentence_01',text:'第一',startFrame:0,endFrameExclusive:15}, {utteranceId:'scene_001_sentence_01',text:'句。',startFrame:15,endFrameExclusive:30});
  const args = {plan:JSON.parse(readFileSync(plan)),tts:JSON.parse(readFileSync(tts)),timeline:current,publicDirectory:join(root,'public')};
  assert.throws(()=>auditSentenceAudio(args),/对齐记录/);
  const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const evidence = {method:'provider_timestamps',utterances:{}};
  for(const u of current.scenes[0].utterances) evidence.utterances[u.id]={audioSha256:hash(join(root,'public',u.src)),captions:pages.filter(c=>c.utteranceId===u.id).map(({text,startFrame,endFrameExclusive})=>({text,startFrame,endFrameExclusive}))};
  const evidenceFile=json('public/alignment.json',evidence);
  current.scenes[0].captionTiming={src:'alignment.json',path:'project/public/alignment.json',sha256:hash(evidenceFile)};
  auditSentenceAudio(args);
  evidence.method='character_ratio';json('public/alignment.json',evidence);current.scenes[0].captionTiming.sha256=hash(evidenceFile);
  assert.throws(()=>auditSentenceAudio(args),/可靠时间/);
  evidence.method='provider_timestamps';evidence.utterances.scene_001_sentence_01.audioSha256='wrong';json('public/alignment.json',evidence);current.scenes[0].captionTiming.sha256=hash(evidenceFile);
  assert.throws(()=>auditSentenceAudio(args),/不属于当前音频/);
  const truncated=JSON.parse(readFileSync(timeline));truncated.scenes[0].utterances[0].endFrameExclusive=29;truncated.scenes[0].captions[0].endFrameExclusive=29;
  assert.throws(()=>auditSentenceAudio({...args,timeline:truncated}),/实际/);
  const missing=JSON.parse(readFileSync(timeline));missing.scenes[0].captions[0].text='第一';
  assert.throws(()=>auditSentenceAudio({...args,timeline:missing}),/丢字/);
  console.log('sentence audio validator: ok');
} finally {
  rmSync(root, {recursive: true, force: true});
}
