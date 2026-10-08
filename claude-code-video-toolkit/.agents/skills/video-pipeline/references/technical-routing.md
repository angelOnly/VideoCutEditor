# 技术路由

本地完整制作和Worker Render共用下列方法。
先确定当前需求，再读取对应资料，不默认加载全部参考。

| 需求 | 共用入口 | Worker适配 |
| --- | --- | --- |
| 正文构图与连续讲解 | video-pipeline/references/motion-design.md及motion-reference-cases.md | 根据本期内容创作，不以组件名称代替设计 |
| Remotion工程、时间与转场 | remotion-best-practices/SKILL.md，按需timing、sequencing、transitions、audio | 使用当前依赖，不启动Studio、不安装软件 |
| 数据图与数值变化 | remotion-best-practices/rules/data-animation.md | 使用本期数据、实际音频窗口和当前依赖 |
| 关系、结构与布局重排 | remotion-best-practices/rules/diagram-animation.md | 在任务工程实现，通过visualExtensions接入 |
| 中文标题与关键词强调 | remotion-best-practices/rules/text-animations.md、measuring-text.md | 使用当前中文字体，字幕独立 |
| 栏目人物与字幕骨架 | 冻结模板renderer及renderer-manifest.json | 复制到project后实际导入复用 |
| 探测、混音、解码 | ffmpeg/SKILL.md、FFprobe/FFmpeg | 通过原生命令工具，按实际时长制作 |
| 配音 | 共用制作流程的句级配音步骤 | 直接调用stage_tts.py |
| 渲染、抽帧、拼接 | tools/stage_media.py、tools/render_scene.cjs | 提供工程、Composition、Props和实测帧数 |
| 正文时间轴与格式派生 | 本任务实测编排；财经使用derive-timeline | derive只转换正式数据，不暗改时长 |
| 固定结束语与片尾 | 实测时间轴 → derive-timeline → render_scene末镜最终合成 | 正文最终画面保持到结束语说完，随后追加本地完整片尾；步骤见production-flow |
| 封装覆盖恢复 | extend-timeline → derive-timeline | 仅补画面覆盖，声音契约有效时使用fixedMix |
| 实际看图与过程检查 | 当前工程静帧、带音频分镜及成片抽帧 | 真实记录检查范围，静帧不冒充播放 |

当前工程的动画、数据、布局和时间问题在任务内修复。
共享工具或依赖错误按现有流程只读诊断，不能修改公共工具求通过。

财经字幕跟随真实句段音频；不按字数猜时间，不把逐词对齐当成默认前提。
新配音可按自然语义停顿拆短句，已有有效音频优先复用。
实际fps与时间坐标取当前任务，不套用教学示例帧数。

技术示例位于已允许读取的Skill目录。
未挂载公共lib或历史工程不属于可用依赖；
不能仅给Worker一个不可读的原始examples路径。

浏览器沿用当前环境REMOTION_BROWSER_EXECUTABLE配置。
模板清单允许的只读sentenceAudioValidator只用于句级检查，
不因此执行任意模板脚本。锁定依赖继续使用当前环境提供的版本。

检查工具不替代构图、运动与声音判断，不证明人工全片听看已经完成。
导出继续通过stage_media.py，不启用另一条默认业务入口。

固定结束语与片尾按production-flow执行。
先建立真实口播时间轴和正文保持位置，计入完整本地片尾长度，
再derive-timeline、预览、冻结与渲染。
stage_media.py::render_scene在末镜mux前完成片尾追加，
返回最终MP4和完整PCM；assemble继续按原顺序合片。
不新增resolve-ending，不在正文scene.outro中播放片尾。
