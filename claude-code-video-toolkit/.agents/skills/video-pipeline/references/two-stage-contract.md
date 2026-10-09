# 阶段协议 video-two-stage/1

本文件只规定文件、身份和工具适配。文本方法与制作正文分别以 text-storyboard、production-flow 为唯一来源。Worker 不接受旧执行协议；外部 HTTP schemaVersion 仍为 2。

## 服务消息与内部文件

Worker 消息使用 [task-io.md](task-io.md)，不直接接收本文件的 candidate。`task_io.py prepare` 在本任务生成内部两阶段请求，现有 Schema 继续用于制作工具；确认转换在 toolkit 内完成。HTTP schemaVersion 仍为 2。

内部请求字段由 [two-stage.schema.json](two-stage.schema.json) 定义。input 定位原稿、要求、模板和素材；confirmation 指向客户端完整 dataList 转换后的确认稿。工具返回 candidate 只表示内部检查结果；Codex 完成制作后按 task-io 的 completed/needs_input/failed 交接。

## 工具适配

Codex 直接使用原生文件、命令和看图工具，调用 stage_tts.py、stage_media.py、render_batch.py 等现有 CLI。input 只读，制作资料保存在任务目录；制作脚本位于 TOOLKIT_ROOT/tools，通用依赖使用 REMOTION_MODULES_ROOT，浏览器使用 REMOTION_BROWSER_EXECUTABLE。收费账本由 toolkit 保留，结果未知时不重发。工具报告检查问题，Codex 决定修改和再次执行；Worker 不维护 .control 或制作恢复反馈。

## 独立本地任务

本地完整任务也使用同一主干。two_stage.py init 根据显式 submission 文件冻结 scriptFile/requirementsFile/templateFile/assets/outputSpec，可设置 includeWholeVideo；每项 assets 使用 id/path/kind/description。本地模板依赖须显式列入授权集合，不扫描历史项目。

文本结果交给 two_stage.py storyboard --request <analysis/request.json> --result <文本结果.json>，由程序产生 plan 并校验。完整无人值守任务已有授权时，可用 two_stage.py confirm --request <analysis/request.json> --artifact <analysis/plan.json> --base-version <当前版本> --source <授权来源> 建立 render 请求；仅分析任务须在外部确认后再执行。服务任务改用 task_io.py prepare，不能重新初始化稳定任务目录。

本地使用 stage_tts.py --request <render请求> --script <配音清单>；其实际制作方法、交付要求和失败处理仍见 production-flow。status/checkpoint/repair 用于核对本任务证据和剩余预算，不能凭文件存在跳过校验。独立文件协议不等于服务器 OS 隔离，也不代表客户端回调已送达。


### 章节和冻结批次接口

如当前 Codex 环境支持协作，由主 Codex 自行组织章节工作，保留 production-flow 的锚点、草案、真实预览与主控检查要求；不依赖 Worker 注册章节工具。没有协作能力时串行完成。

冻结前保存分镜参数 JSON 数组，项目入口、props 与帧数均对应正式时间轴。例如：

```json
[{"sceneId":"scene_001","composition":"FinanceScene-1","props":"render/render_001/scene-01-props.json","frames":227}]
```

由 Codex 直接调用 `stage_media.py freeze-batch --request "$REQUEST" --batch approved_v1 --project project/renderer --entry project/renderer/src/index.ts --scenes render/<制作ID>/scenes.json`，再按该工具 `--help` 提供 node/modules/browser 执行 `render-batch`。示例帧数不能覆盖实测值，slots 根据可用资源选择。


失败镜不使已完成镜头丢失；恢复同批次会重新验证输入与真实产物摘要。工程、时间轴或依赖变化必须新建 batch ID，初版保守失效。工具校验保留在 toolkit 内；Codex 依据报告处理，不向 Worker 登记时间轴版本。
