> v2 分析/分镜任务优先使用 [v2 文件协议](v2-contract.md)。以下旧单视频契约仅用于 schemaVersion=1；v2 服务位于同级 video-worker，媒体交付为本地文件路径。

# 技术路由

相对工具路径从工具库根目录运行；输入输出参数使用绝对任务路径。先检查本地命令 `--help`，不要把示例当作所有模板共用命令。

| 需要 | 读取/执行 | 无人值守适配 |
|---|---|---|
| 模板识别 | `_internal/toolkit-registry.json`、指定模板 README 与 package.json | 注册表存在不等于已做服务端准入；检查依赖、入口、配置格式和素材约束 |
| Remotion | `.agents/skills/remotion/SKILL.md`；按需读 `remotion-best-practices` 的 audio、sequencing、subtitles、measuring-text、calculate-metadata 规则 | 不启动 Studio 等人操作；用 CLI still/render 生成证据和完整视频 |
| Python 模板 | `.agents/skills/moviepy/SKILL.md`、模板自身 build.py | 尊重模板实际 MoviePy 版本与配置格式 |
| 探测、混音、转码 | `.agents/skills/ffmpeg/SKILL.md` | ffprobe 实测，混音 ducking、避免削波；全片解码检查 |
| 单人配音 | `tools/voiceover.py` | 固定 provider 和音色，传 `--script`/`--output`/`--json`，不得省略稿件参数而等待 stdin；不读交互式 generate-voiceover wrapper |
| 豆包双人 | `tools/generate_dialogue_audio.py` | JSON 数组 id/role/text，role 当前只支持 female/male；提供固定 speakers；不传 --force 重做已验证音频 |
| 字幕对齐 | 模板支持的对齐工具；`tools/align_captions.py` 或 concept-explainer-short 的 gen_captions.py | 前者专用于 sprint-config.ts 的 cap() 结构且使用 ElevenLabs Scribe，不是通用 SRT 对齐器。服务未配置则用已配置替代，否则失败 |
| 视觉优化 | `.agents/skills/frontend-design/SKILL.md` | 基于关键帧自动修复可读性，禁止进入 scene-review 对话 |

## 时间码陷阱

`generate_dialogue_audio.py` 的 start_frame/duration_frames 固定按 30fps 生成。目标非 30fps 时以 start_seconds/duration_seconds 为事实重新计算帧，不能直接复用 frame 字段。旁白起止应按同一绝对秒时间轴取整，避免逐段四舍五入积累。timeline 的 fps 必须与 composition 一致。

`sync_timing.py --apply` 仅用于其支持的配置结构。未经检查直接应用可能破坏模板。Remotion 的转场重叠会缩短总帧数，最终 totalFrames 需使用实际 composition 结果。

## 自动画面检查

逐场生成首个可见稳定帧、中间帧、尾帧以及转场交叠帧。查看实际图像；用 DOM/字体测量验证字幕边界与安全区。检查素材是否显示、文本是否完整、是否遗留占位符。报告绑定当前时间轴和渲染输入的哈希；修复后重做受影响截图。

若运行环境没有图像查看能力，不把“截图存在”写成“视觉检查通过”；按模板要求用确定性布局检测补足，仍无法验证的必需检查返回 VALIDATION_FAILED。开发色块视频只用于测试校验器，不能作为生产模板回退。
