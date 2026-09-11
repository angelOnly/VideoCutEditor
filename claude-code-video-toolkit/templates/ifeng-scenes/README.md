# ifeng-scenes

Worker 准入的分镜模板；不要直接使用示例 scenes.json 交付视频。`tools/render_segments.py` 从可信确认快照和音频清单生成每任务独立工程，通过 `src/Root.tsx` 为本次选中的每镜注册 composition。

输出：H.264 / yuv420p / BT.709 + AAC，每镜独立 MP4，素材/字幕时间轴从 0 开始。视频源音轨静音，仅使用本镜已提供配音。支持图片与视频主画面、背景、预生成数字人画中画、花字、句级分页字幕，以及 none/slow_zoom/fade 预设。视频过长截取、过短定格补足。

容器内依赖固定在本模板的 node_modules，运行时不安装包；输入通过明确的 `--public-dir` 指向本任务工程。画面质量仍需 Agent 查看关键帧、编辑预览，技术校验不是审美保证。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
```
