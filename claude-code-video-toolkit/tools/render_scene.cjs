#!/usr/bin/env node
// 只承载通用渲染；工程内容、Composition 和输入由 Codex 按确认方案提供。
const fs = require('node:fs');
const path = require('node:path');
const c = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const {bundle} = require(path.join(c.modules, '@remotion/bundler'));
const {selectComposition, renderMedia, openBrowser} = require(path.join(c.modules, '@remotion/renderer'));
(async () => {
  const serveUrl = await bundle({entryPoint: c.entry, outDir: c.bundle,
    publicDir: path.join(c.project, 'public'), webpackOverride: config => ({...config, cache: false})});
  const browser = await openBrowser('chrome', {browserExecutable: c.browser, logLevel: 'error'});
  try {
    const composition = await selectComposition({serveUrl, id: c.composition, inputProps: c.props,
      puppeteerInstance: browser, browserExecutable: c.browser});
    if (composition.durationInFrames !== c.frames || composition.fps !== c.spec.fps ||
        composition.width !== c.spec.width || composition.height !== c.spec.height) {
      throw new Error('Composition 与确认的输出规格或实际时间轴不一致');
    }
    await renderMedia({composition, serveUrl, inputProps: c.props, outputLocation: c.output,
      puppeteerInstance: browser, browserExecutable: c.browser, codec: 'h264', pixelFormat: 'yuv420p',
      // 保留 Remotion 的完整混音，避免 ADTS 中间文件丢失 AAC 编码延迟信息。
      audioCodec: 'pcm-16', separateAudioTo: c.audio, imageFormat: 'png', concurrency: 1,
      // PCM 会使 Remotion 默认选 MKV 中间容器（毫秒时间基），损失 30fps 的精确时间戳。
      // 预编码阶段只有 H.264 画面，明确使用 MP4；PCM 仍单独保存在 WAV。
      ffmpegOverride: ({type, args}) => type === 'pre-stitcher'
        ? [...args.slice(0, -1), '-f', 'mp4', args.at(-1)] : args,
      forSeamlessAacConcatenation: false, enforceAudioTrack: true, logLevel: 'error',
      onProgress: p => console.log(JSON.stringify({progress: p.progress}))});
    // 完成标记在关闭浏览器之前写入；父进程仍须独立验证 MP4。
    fs.writeFileSync(c.done + '.tmp', JSON.stringify({frames: c.frames, completedAt: Date.now()}));
    fs.renameSync(c.done + '.tmp', c.done);
  } finally {
    await browser.close({silent: true});
  }
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
