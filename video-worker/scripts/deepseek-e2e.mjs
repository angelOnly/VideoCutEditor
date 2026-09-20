#!/usr/bin/env node
// 真实 HTTP 集成测试客户端：不启动 Codex、不直接访问数据库、不替 Worker 制作视频。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, realpath } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const toolkit = path.join(project, 'claude-code-video-toolkit');
const templateId = 'deepseek_finance_dialogue_e2e';
const templateFile = 'deliverables/财经双人对话视频生成指令.md';
const scriptFile = 'test-cases/deepseek-v4/script.md';
export const specs = [
  ...['01_hook', '02_intro', '03_active-speaker', '04_chapter-card', '05_outro'].map((name, i) => ({
    id: `template_image_${i + 1}`,
    kind: 'reference',
    file: `deliverables/video-generation-guide-assets/${name}.png`,
  })),
  ...['male-chief', 'female-host', 'logo-dark', 'title-card'].map((name) => ({
    id: name.replaceAll('-', '_'),
    kind: 'image',
    file: `examples/hello-world/public/assets/financial-dialogue/${name}.png`,
  })),
  ...[
    'headline-land',
    'section-tech-sweep',
    'number-counter-fast',
    'data-tick-crisp',
    'bearish-drop-short',
    'closing-resolve',
    'risk-alert',
    'data-tick-soft',
  ].map((name) => ({
    id: 'sfx_' + name.replaceAll('-', '_'),
    kind: 'audio',
    file: `examples/hello-world/public/audio/financial-dialogue-v3/sfx/${name}.wav`,
  })),
  { id: 'intro_source', kind: 'source', file: 'examples/hello-world/src/FinancialIntros.tsx' },
];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
};
const requireValue = (ok, message) => {
  if (!ok) throw Error(message);
};
function settings() {
  loadEnvFile(path.join(project, '.env'));
  const media = process.env.MEDIA_ROOT || '/home/ops/jiangzb/videos';
  return {
    media,
    state: path.join(media, 'e2e-client/deepseek'),
    base: process.env.E2E_API_BASE_URL || `http://127.0.0.1:${process.env.API_PORT || 8080}`,
    key: process.env.IFENG_API_KEY,
  };
}
function requirements() {
  return `真实 Worker 两阶段 DeepSeek V4 测试。1920×1080，30fps；按财经双主持人模板制作，谁说话谁高亮。
保留原稿内容和顺序，不改写、压缩稿件，不编造观点或数据。标题、空白及原采访标注等非口播内容使用 nonspoken 明确映射。
未提供采访原声，引语使用普通合成旁白并标注，不能冒充真实采访。
固定女声 zh_female_xiaohe_uranus_bigtts、男声 zh_male_m191_uranus_bigtts，不生成试听候选。
模板仅参考布局和剪辑节奏。模板中的改写稿件、寻找参考视频、音色试听、旧交互审核要求不适用；保留 analysis 后外部编辑确认这一阶段边界。
analysis 只产出完整可编辑方案，未配音时长写 estimated，不生成正式 TTS/MP4；预览图存 analysis/ 下。
render 严格使用已确认稿件和镜头，自己组织配音、测量时长、画面编程、字幕与修复；一条确认分镜返回一条包含画面、声音、动画、字幕的完整 MP4。无需整片，不把片头片尾当作额外未确认镜头。
正文分镜、布局、图解、动效、时间线必须重新设计。只有下面白名单文件可作业务资料；模板里的历史 MOV/MP4 链接均禁止打开。不得打开其他视频、旧项目 Episode.tsx、FinancialReportDialogueV3.tsx、plan/timeline、审计报告、日志或优化建议。禁止从历史成片提取音轨或画面；只复用本任务的已验证 TTS 缓存。
允许读 video-pipeline 及必要通用技能/工具/依赖配置。FinancialIntros.tsx 只用于片头片尾，允许适配资源路径与实际时长，不参考其他历史源码。
参考图只用于理解视觉布局，不作为正文贴图。头像、Logo、片头标题资产、音效按需引用，并在每镜 assetRefs 中列出实际使用的源文件 ID。
明确素材不足时失败，不自行扩大参考范围。豆包凭据只由可信 video_tts 工具使用，不读取或打印 .env。
白名单资产 ID 与原文件对应关系（实际文件以 input/assets.json 的 path 为准）：
${specs.map((a) => `${a.id}: ${a.file}`).join('\n')}`;
}
async function prepare(c) {
  requireValue(
    process.env.WORKER_PROTOCOL === 'video-two-stage/1',
    '根 .env 需要 WORKER_PROTOCOL=video-two-stage/1',
  );
  requireValue(process.env.WORKER_EXECUTOR === 'host', '需要 WORKER_EXECUTOR=host');
  requireValue(
    !process.env.TEMPLATE_API_URL,
    '此测试使用本地模板 fixture；当前配置了 TEMPLATE_API_URL，请先明确切换模板来源后再准备。',
  );
  requireValue(
    !process.env.TENANTS_FILE,
    '此入口读取 IFENG_* 配置；TENANTS_FILE 多租户部署需要单独指定测试租户。',
  );
  requireValue(
    (process.env.IFENG_INPUT_ROOT || c.media) === c.media,
    '本测试要求 IFENG_INPUT_ROOT 与 MEDIA_ROOT 相同',
  );
  requireValue(
    (process.env.IFENG_ALLOWED_INPUT_PREFIXES || 'input')
      .split(',')
      .map((x) => x.trim())
      .includes('input'),
    '需要允许 input 素材目录',
  );
  const files = await Promise.all(
    [{ file: templateFile }, { file: scriptFile }, ...specs].map(async (a) => {
      const source = path.join(toolkit, a.file);
      requireValue((await stat(source)).isFile(), `缺少白名单文件：${a.file}`);
      return { ...a, bytes: await readFile(source) };
    }),
  );
  const fingerprint = sha(
    Buffer.from(files.map((a) => a.file + ':' + sha(a.bytes)).join('\n') + '\n' + requirements()),
  );
  const assetsRoot = path.join(c.media, 'input/deepseek-worker-e2e', fingerprint.slice(0, 16));
  await mkdir(assetsRoot, { recursive: true });
  const attachments = [];
  for (const a of files.slice(2)) {
    const target = path.join(assetsRoot, a.id + path.extname(a.file));
    // 只复制固定白名单，不递归复制历史工程或成片。
    await writeFile(target, a.bytes);
    attachments.push({ assetId: a.id, url: target, kind: a.kind });
  }
  const configPath = path.join(project, 'video-worker/config/templates.json');
  const templates = await readJson(configPath);
  templates[templateId] = {
    path: templateFile,
    version: 'e2e-' + fingerprint.slice(0, 16),
    attachments,
  };
  await save(configPath, templates);
  await save(path.join(c.state, 'prepared.json'), {
    fingerprint,
    templateId,
    assetsRoot,
    requirements: requirements(),
  });
  console.log(`已准备稿件、财经双人模板及 ${attachments.length} 项白名单附件。没有提交任务。`);
  console.log(`模型：${process.env.CODEX_MODEL} / ${process.env.CODEX_REASONING_EFFORT}`);
  console.log(
    '下一步：在项目根目录执行 docker compose up -d --build --remove-orphans，然后 systemctl --user restart videocut-worker',
  );
}
async function api(c, method, route, body) {
  requireValue(c.key, '缺少 IFENG_API_KEY');
  const response = await fetch(new URL(route, c.base), {
    method,
    headers: { authorization: 'Bearer ' + c.key, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const value = await response.json();
  requireValue(
    response.ok && value.status === 0,
    `HTTP ${response.status}: ${JSON.stringify(value)}`,
  );
  return value.data;
}
const workerEndpoint = '/narrate/ai_video_director/';
const managementEndpoint = '/ai_video_director/';
async function state(c) {
  return readJson(path.join(c.state, 'current.json'));
}
async function query(c, s) {
  return api(c, 'GET', managementEndpoint + 'tasks/' + encodeURIComponent(s.taskId));
}
async function analysis(c, args) {
  const prepared = await readJson(path.join(c.state, 'prepared.json'));
  let s;
  try {
    s = await state(c);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (!s || args.includes('--new')) {
    const taskId = 'deepseek-e2e-' + randomUUID();
    s = {
      taskId,
      analysis: {
        schemaVersion: 2,
        requestId: 'analysis-' + randomUUID(),
        taskId,
        script: await readFile(path.join(toolkit, scriptFile), 'utf8'),
        otherRequirements: prepared.requirements,
        digitalHumanAccounId: '',
        plugin: { digitalHumanId: '', templateId },
        narration: null,
        outputSpec: { width: 1920, height: 1080, fps: 30 },
        otherMaterial: { picInfoList: [], videoInfoList: [] },
      },
    };
    // 先保存 requestId，网络结果不明时重跑同一命令不会重复提交。
    await save(path.join(c.state, 'current.json'), s);
    await save(path.join(c.state, s.taskId, 'analysis-request.json'), s.analysis);
  }
  const accepted = await api(
    c,
    'POST',
    workerEndpoint + 'getAiVideoEditingAnalysisData',
    s.analysis,
  );
  console.log(JSON.stringify(accepted, null, 2));
  console.log('已提交 analysis。使用 status --wait 查看结果；此阶段不会自动提交 render。');
}
async function status(c, args) {
  const s = await state(c);
  let last = '';
  for (;;) {
    const q = await query(c, s);
    const summary = {
      taskId: q.taskId,
      taskState: q.taskState,
      latestRun: q.latestRun,
      planVersion: q.planVersion,
      callbackState: q.callbackState,
      queuePosition: q.queuePosition,
    };
    const text = JSON.stringify(summary, null, 2);
    if (text !== last) {
      console.log(text);
      last = text;
    }
    const folder = path.join(c.state, s.taskId);
    await save(path.join(folder, 'status.json'), q);
    if (q.plan?.plan) await save(path.join(folder, 'plan.json'), q.plan.plan);
    if (q.latestResult?.length) {
      await save(path.join(folder, 'result.json'), q.latestResult);
      console.log('分镜结果：' + path.join(folder, 'result.json'));
    }
    if (q.taskState === 'awaiting_editor')
      console.log(
        '完整方案：' + path.join(folder, 'plan.json') + '\n确认后执行 render --confirm。',
      );
    if (['failed', 'cancelled'].includes(q.taskState)) {
      process.exitCode = 1;
      return;
    }
    if (!args.includes('--wait') || ['awaiting_editor', 'ready', 'delivered'].includes(q.taskState))
      return;
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
async function render(c, args) {
  requireValue(
    args.includes('--confirm'),
    'render 需显式 --confirm，表示接受当前分析方案；这会调用真实 Codex，并可能产生配音费用。',
  );
  const s = await state(c);
  const q = await query(c, s);
  if (!s.render) {
    requireValue(q.taskState === 'awaiting_editor' && q.plan?.plan, '任务尚未返回完整分析方案');
    s.render = {
      schemaVersion: 2,
      requestId: 'render-' + randomUUID(),
      taskId: s.taskId,
      basePlanVersion: q.planVersion,
      field_5: s.analysis.digitalHumanAccounId,
      templateId: s.analysis.plugin.templateId,
      plan: q.plan.plan,
      dataList: q.plan.dataList,
    };
    await save(path.join(c.state, 'current.json'), s);
    await save(path.join(c.state, s.taskId, 'render-request.json'), s.render);
  }
  console.log(
    JSON.stringify(
      await api(c, 'POST', workerEndpoint + 'getAiVideoEditingData', s.render),
      null,
      2,
    ),
  );
  console.log('已由外部客户端确认方案并提交 render；真正的 Codex 执行仍由 Worker 调度。');
}
async function verify(c) {
  const s = await state(c),
    q = await query(c, s);
  requireValue(s.render, '尚未提交 render');
  requireValue(['ready', 'delivered'].includes(q.taskState), 'render 尚未成功，请先 status --wait');
  requireValue(
    q.latestRun.stage === 'render' && q.latestRun.state === 'succeeded',
    'Worker 未记录 render 成功',
  );
  const expected = s.render.plan.scenes,
    actual = q.latestResult;
  requireValue(actual.length === expected.length, '分镜数量不符');
  for (const [i, a] of actual.entries()) {
    requireValue(a.id === expected[i].id && a.content === expected[i].text, '分镜顺序或文本不符');
    requireValue(path.isAbsolute(a.url) && a.url.endsWith('.mp4'), '缺少发布 MP4 路径');
    requireValue((await stat(a.url)).size > 0, '发布文件为空');
    console.log(`${a.id}: ${a.dur}s ${a.url}`);
  }
  const report = {
    taskId: s.taskId,
    runId: q.latestRun.runId,
    workerAccepted: true,
    sceneCount: actual.length,
    callbackState: q.callbackState,
    callback: q.callback,
  };
  await save(path.join(c.state, s.taskId, 'verification.json'), report);
  console.log(JSON.stringify(report, null, 2));
  if (q.callbackState !== 'delivered') {
    console.log(
      'Worker 已收结果，但回调尚未送达。检查 callbacks / callback-mock 日志后再次 verify。',
    );
    process.exitCode = 2;
  } else
    console.log(
      'Worker 已接收并发布全部分镜，回调已送达；请实际播放 MP4 检查双人布局、字幕和音画效果。',
    );
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === '--help' || !action) {
    console.log(
      '用法：node video-worker/scripts/deepseek-e2e.mjs prepare|analysis [--new]|status [--wait]|render --confirm|verify\n此入口使用真实 HTTP API；analysis 使用真实 Codex，render 使用真实配音。重复 analysis/render 保留 requestId。',
    );
    return;
  }
  const c = settings();
  const actions = { prepare, analysis, status, render, verify };
  requireValue(actions[action], '未知操作');
  await actions[action](c, args);
}
if (
  process.argv[1] &&
  (await realpath(process.argv[1])) === (await realpath(fileURLToPath(import.meta.url)))
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
