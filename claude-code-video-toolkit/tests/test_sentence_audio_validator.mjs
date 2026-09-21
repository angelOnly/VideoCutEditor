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
      id: 'scene_001',
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
  assert.match(failure.stderr, /自然句 TTS/);
  console.log('sentence audio validator: ok');
} finally {
  rmSync(root, {recursive: true, force: true});
}
