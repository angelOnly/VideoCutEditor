import { analysisRequest } from '../src/contracts/ifeng.js';
import { analysis } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnalysis,
  normalizeConfirmedScenes,
  confirmPlan,
  publicScene,
} from '../src/domain/storyboard.js';
import { assertStage } from '../src/contracts/two-stage.js';

const normalize = (script: string, texts: string[]) =>
  normalizeAnalysis(
    { status: 'candidate', scenes: texts.map((text) => ({ text })), error: null },
    script,
    'task',
    'a'.repeat(64),
  );
test('文本分镜按 Unicode 与顺序映射重复句，空白显式保存，估时仅用于展示', () => {
  const p = normalize(' 😀涨了。\n😀涨了。  ', ['😀涨了。', '😀涨了。']);
  assert.deepEqual(
    p.scenes.map((s) => s.sourceMapping[0]),
    [
      { start: 1, end: 5, unit: 'unicode_codepoints' },
      { start: 6, end: 10, unit: 'unicode_codepoints' },
    ],
  );
  assert.equal(p.scenes[0].timing.totalSeconds, 0.8);
  assert.deepEqual(p.scenes[0].production, {});
  assert.equal(p.nonspoken.map((s) => s.text).join(''), ' \n  ');
  assertStage(new URL('../../claude-code-video-toolkit', import.meta.url).pathname, 'plan', p);
});
test('文本遗漏、改数字、换顺序、空列表与错误外壳直接失败', () => {
  for (const [source, texts] of [
    ['一。二。', ['一。二。']],
    ['一。二。', ['二。', '一。']],
    ['一。二。', ['一。']],
    ['增长10%。', ['增长11%。']],
    ['一。', []],
  ] as [string, string[]][])
    assert.throws(() => normalize(source, texts), { code: 'ANALYSIS_RESULT_INVALID' });
  assert.throws(
    () =>
      normalizeAnalysis(
        {
          status: 'candidate',
          scenes: [{ text: '一。' }],
          error: { code: 'bad', message: 'bad', retryable: false },
        },
        '一。',
        'task',
        'a'.repeat(64),
      ),
    { code: 'ANALYSIS_RESULT_INVALID' },
  );
});
test('长稿每句规范化；不要求模型计算摘要、源位置或时长', () => {
  const texts = Array.from({ length: 200 }, (_, i) => `第${i}句话，保留逗号。`);
  assert.equal(normalize(texts.join('\n'), texts).scenes.length, 200);
  assert.throws(() => normalize('x'.repeat(4001), ['x'.repeat(4001)]));
});
test('确认支持最小字段、完整重排、增删与不带区间的明确素材', () => {
  const p = normalize('一。二。', ['一。', '二。']);
  const list = normalizeConfirmedScenes([
    {
      id: 'new',
      content: ' 新句。 ',
      extraData: { picInfoList: [{ assetId: 'a', url: '/input/a.png' }] },
    },
    { id: 'scene_001', content: '一。' },
  ]);
  const confirmed = confirmPlan(p, list);
  assert.deepEqual(
    confirmed.scenes.map((s) => s.text),
    ['新句。', '一。'],
  );
  assert.deepEqual(confirmed.scenes[0].assetRefs, ['a']);
  assert.deepEqual(confirmed.scenes[1].production, {});
  assert.deepEqual(publicScene(confirmed.scenes[0]).production, {});
  assert.deepEqual(publicScene(confirmed.scenes[0]).extraData.resources, []);
});
test('确认仍拒绝重复身份、无效时长、非绝对素材路径和数字人', () => {
  const s = { id: 's', content: '一句。' };
  for (const list of [
    [s, s],
    [{ ...s, dur: -1 }],
    [{ ...s, id: '../x' }],
    [{ ...s, extraData: { digitalHumanId: 'human' } }],
    [{ ...s, extraData: { picInfoList: [{ assetId: 'a', url: 'https://example.com/a' }] } }],
  ])
    assert.throws(() => normalizeConfirmedScenes(list));
});

test('业务制作要求可扩展，命令与工具元数据不扩大权限', () => {
  const p = normalize('一句。', ['一句。']);
  const result = confirmPlan(
    p,
    normalizeConfirmedScenes([
      {
        id: 's',
        content: '一句。',
        production: {
          speaker: '主持人',
          command: 'run',
          nested: { path: '/secret', chart: '柱状图' },
        },
      },
    ]),
  );
  assert.deepEqual(result.scenes[0].production, { speaker: '主持人', nested: { chart: '柱状图' } });
});

test('接口保留原稿首尾空白，拒绝全空白稿件', () => {
  assert.equal(
    analysisRequest.parse({ ...analysis(), script: '  第一段。\n' }).script,
    '  第一段。\n',
  );
  assert.throws(() => analysisRequest.parse({ ...analysis(), script: ' \n' }));
});
