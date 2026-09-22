# 技术路由

本地完整制作和 Worker Render 共用下列技术方法。按需读取，不能因此扩大阶段授权或加载历史正文。

| 需求 | 共用入口 | Worker 适配 |
| --- | --- | --- |
| Remotion 工程、动画与时间轴 | `.agents/skills/remotion-best-practices/SKILL.md`，按需 timing、sequencing、transitions、audio、measuring-text 规则 | 锁定依赖，不启动 Studio、不安装软件 |
| 栏目人物、图解、字幕 | 冻结模板 renderer 及 renderer-manifest.json | 复制到 project 后实际导入，允许创作本期专属组件 |
| 探测、混音、解码 | `.agents/skills/ffmpeg/SKILL.md`、FFprobe/FFmpeg | 通过 video_exec，按实际时长制作 |
| 配音 | 共用制作流程的句级配音步骤 | video_tts；本地完整任务使用 stage_tts.py |
| 渲染、抽帧、拼接 | tools/stage_media.py、tools/render_scene.cjs | Codex 提供工程入口、Composition、Props、实测帧数；浏览器取 REMOTION_BROWSER_EXECUTABLE |
| 实际时间轴与模板适配 | Render 在本任务编写编排；财经可选 derive-timeline，单纯尾部延长可选 extend-timeline | 适配使用 video_media；不重算制作决定，声音未变可用 fixedMix=true |
| 实际看图 | 模板关键帧与成片抽帧 | video_view_image；未查看不能写已审查 |

当前工程动画与数据错误可自行修复；共享工具或依赖错误只读诊断并请求人工，不能修改公共工具或校验程序。补帧通知属于制作过程，尚未生成通过校验的 MP4 时不能跳过该镜。

财经模板字幕跟随独立句级 TTS，保留确认稿文字，不引入 ASR 或中文逐字逐词声学对齐。转场重叠、音频起止和全局偏移使用实际 fps；不套用固定 30fps 时间字段。

没有挂载的公共 lib、remotion-official 或历史工程不属于可用依赖。模板允许的只读 sentenceAudioValidator 只用于句级检查，不能执行任意模板脚本。检查工具不替代 Codex 的布局、动态图解和声音判断，也不证明人工全片听看已经完成。

本次两阶段及本地完整任务统一经 stage_media.py 导出。旧 render_delivery.mjs 的色彩与音频修复仅作技术对照，不是另一条默认业务入口。
