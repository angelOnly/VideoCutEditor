import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeTtsItems } from '../src/runner/codex-host.js';

test('可信 TTS 层使用服务器音色，不透传模型角色标签', () => {
  const items = authorizeTtsItems(
    [{ id: 'utterance_001', sceneId: 'scene_001', text: '测试。', speaker: 'female-host' }],
    'zh_female_xiaohe_uranus_bigtts',
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
