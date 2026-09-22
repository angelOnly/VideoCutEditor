import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeTtsItems } from '../src/runner/codex-host.js';

test('可信 TTS 层使用服务器音色，不透传模型角色标签', () => {
  const items = authorizeTtsItems(
    [{ id: 'utterance_001', sceneId: 'scene_001', text: '测试。', speaker: 'female-host' }],
    'zh_female_xiaohe_uranus_bigtts',
    { 'female-host': 'zh_female_xiaohe_uranus_bigtts' },
  );
  assert.deepEqual(items, [
    {
      id: 'utterance_001',
      sceneId: 'scene_001',
      text: '测试。',
      speaker: 'zh_female_xiaohe_uranus_bigtts',
    },
  ]);
  assert.throws(() => authorizeTtsItems([], ''));
});

test('双主持按明确授权保留不同声音，缺少角色映射不静默替换', () => {
  const items = [
    { id: 'a', sceneId: 'one', text: '女声。', speaker: 'female-host' },
    { id: 'b', sceneId: 'two', text: '男声。', speaker: 'male-chief' },
  ];
  assert.throws(() => authorizeTtsItems(items, 'female'), { code: 'CAPABILITY_MISSING' });
  assert.deepEqual(
    authorizeTtsItems(items, 'female', { 'female-host': 'female', 'male-chief': 'male' }).map(
      (i) => i.speaker,
    ),
    ['female', 'male'],
  );
  assert.equal(
    authorizeTtsItems([{ ...items[0], speaker: 'female' }], 'female')[0].speaker,
    'female',
  );
});
