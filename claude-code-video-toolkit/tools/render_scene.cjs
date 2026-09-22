#!/usr/bin/env node
// 只承载通用渲染；工程内容、Composition 和输入由 Codex 按确认方案提供。
const fs = require('node:fs');
const path = require('node:path');
const c = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
// Chrome 自己建立进程组；信号必须先关闭浏览器，不能只杀 Node 组。
let browserPromise = null;
let closePromise = null;
let cancelled = false;
let shutdownTimer = null;
const closeBrowser = () => {
  if (!browserPromise) return Promise.resolve();
  if (!closePromise) closePromise = (async () => {
    let browser;
    try { browser = await browserPromise; } catch { return; }
    await browser.close({silent: true});
  })();
  return closePromise;
};
const stop = () => {
  if (cancelled) return;
  cancelled = true;
  process.exitCode = 130;
  // openBrowser 未返回或 close 卡住时也有上限；正常 exit 仍触发 Remotion 清理钩子。
  shutdownTimer = setTimeout(() => process.exit(130), 5000);
  shutdownTimer.unref();
  closeBrowser().then(() => process.exit(130), () => process.exit(130));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
const checkCancelled = () => { if (cancelled) throw new Error('TASK_CANCELLED'); };
const {bundle} = require(path.join(c.modules, '@remotion/bundler'));
const {selectComposition, renderMedia, openBrowser} = require(path.join(c.modules, '@remotion/renderer'));
(async () => {
  const started = Date.now();
  const serveUrl = c.serveUrl || await bundle({entryPoint: c.entry, outDir: c.bundle, enableCaching: false,
    publicDir: path.join(c.project, 'public'), webpackOverride: config => ({...config, cache: false})});
  checkCancelled();
  if (c.bundleOnly) {
    fs.writeFileSync(c.done, JSON.stringify({bundle: serveUrl, bundleSeconds: (Date.now() - started) / 1000}));
    return;
  }
  browserPromise = openBrowser('chrome', {browserExecutable: c.browser, logLevel: 'error'});
  try {
    const browser = await browserPromise;
    checkCancelled();
    const recommendations = new Map();
    const onBrowserLog = (entry) => {
      try {
        const value = JSON.parse(entry.text);
        if (value.status === 'recommendation') for (const issue of value.issues) recommendations.set(JSON.stringify(issue), issue);
      } catch {}
    };
    const composition = await selectComposition({serveUrl, id: c.composition, inputProps: c.props, onBrowserLog,
      puppeteerInstance: browser, browserExecutable: c.browser});
    if (composition.durationInFrames !== c.frames || composition.fps !== c.spec.fps ||
        composition.width !== c.spec.width || composition.height !== c.spec.height) {
      throw new Error('Composition 与确认的输出规格或实际时间轴不一致');
    }
    await renderMedia({composition, serveUrl, inputProps: c.props, onBrowserLog, outputLocation: c.output,
      puppeteerInstance: browser, browserExecutable: c.browser, codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709',
      // 保留 Remotion 的完整混音，避免 ADTS 中间文件丢失 AAC 编码延迟信息。
      ...(c.fixedAudio ? {muted: true} : {audioCodec: 'pcm-16', separateAudioTo: c.audio}),
      imageFormat: 'png', concurrency: 1,
      // PCM 会使 Remotion 默认选 MKV 中间容器（毫秒时间基），损失 30fps 的精确时间戳。
      // 预编码阶段只有 H.264 画面，明确使用 MP4；PCM 仍单独保存在 WAV。
      ffmpegOverride: ({type, args}) => type === 'pre-stitcher'
        ? [...args.slice(0, -1), '-f', 'mp4', args.at(-1)] : args,
      forSeamlessAacConcatenation: false, enforceAudioTrack: !c.fixedAudio, logLevel: 'error',
      onProgress: p => console.log(JSON.stringify({progress: p.progress}))});
    checkCancelled();
    // 完成标记在关闭浏览器之前写入；父进程仍须独立验证 MP4。
    fs.writeFileSync(c.done + '.tmp', JSON.stringify({frames: c.frames, completedAt: Date.now(), recommendations: [...recommendations.values()]}));
    fs.renameSync(c.done + '.tmp', c.done);
  } finally {
    await closeBrowser();
  }
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
