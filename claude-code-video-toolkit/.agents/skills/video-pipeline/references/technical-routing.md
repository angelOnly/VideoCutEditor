# 技术路由

本地完整制作和 Worker Render 共用下列技术方法。按需读取，不能因此扩大阶段授权或加载历史正文。

| 需求 | 共用入口 | Worker 适配 |
| --- | --- | --- |
| Remotion 工程、动画与时间轴 | `.agents/skills/remotion-best-practices/SKILL.md`，按需 timing、sequencing、transitions、audio、measuring-text 规则 | 锁定依赖，不启动 Studio、不安装软件 |
| 栏目人物、图解、字幕 | 冻结模板 renderer 及 renderer-manifest.json | 复制到 project 后实际导入，允许创作本期专属组件 |
| 探测、混音、解码 | `.agents/skills/ffmpeg/SKILL.md`、FFprobe/FFmpeg | 通过 video_exec，按实际时长制作 |
| 配音 | 共用制作流程的句级配音步骤 | video_tts；本地完整任务使用 stage_tts.py |
| 渲染、抽帧、拼接 | tools/stage_media.py、tools/render_scene.cjs | Codex 提供工程入口、Composition、Props、实测帧数；浏览器取 REMOTION_BROWSER_EXECUTABLE |
| 实际看图 | 模板关键帧与成片抽帧 | video_view_image；未查看不能写已审查 |

字幕跟随独立句级 TTS，保留原稿文字，不引入 ASR 或中文逐字逐词声学对齐。转场重叠、音频起止和全局偏移使用实际 fps；不套用固定 30fps 时间字段。

没有挂载的公共 lib、remotion-official 或历史工程不属于可用依赖。模板允许的只读 sentenceAudioValidator 只用于句级检查，不能执行任意模板脚本。检查工具不替代 Codex 的布局、动态图解和声音判断，也不证明人工全片听看已经完成。

已有普通 SDR 本地工程可继续使用 tools/render_delivery.mjs 与 scripts/validate_delivery.py 做整片技术导出，它们只是共用制作流程下的导出适配；字段参考 task-contract.md。不能从该工具启动另一套 Worker 协议或固定布局流程。
