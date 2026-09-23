# 独立任务输入输出：video-pipeline-io/1

本协议只适配输入和输出，analysis 使用 text-storyboard，render 使用 production-flow；不另设制作流程。Worker 不注册制作工具，也不做制作验收或修复。

## 读取当前消息

从提示中的 `input/message-<内部ID>/task.json` 读取 protocol、taskId、requestId、stage、requestFile、attachmentsFile、resultFile。所有路径相对当前任务根目录。完整阅读原始 request.json；attachments.json 只定位模板、素材和 previousAnalysis。正文、标点、确认 dataList 及其他要求不能由旧会话猜测。Render 的 previousAnalysis 指向同任务的原稿、要求、模板和分析资料。

使用原生文件、命令及看图工具。Python、Node、Remotion、FFmpeg 均直接调用；长命令返回句柄时继续等待同一命令。配音工具从授权环境取得供应商配置，默认音色用 DOUBAO_TTS_SPEAKER，角色映射用 VIDEOCUT_TTS_VOICES；不要输出凭据或读取 .env。`VIDEOCUT_RENDER_SANDBOX=native` 表示已由 Codex 沙箱限制任务权限，脚本不再套第二层沙箱。

## 复用现有工具

`TOOLKIT_ROOT` 指向只读 toolkit。输入目录只读，工程、音频和工具记录保存在当前任务目录；本任务后续修改沿用资料，不能清空音频或收费记录。

```bash
python3 "$TOOLKIT_ROOT/tools/task_io.py" prepare --task input/message-<内部ID>/task.json
```

该命令返回内部两阶段 `request` 路径，供 stage_tts.py、stage_media.py、render_batch.py 等现有工具使用。转换和文本检查在 toolkit 内完成，Worker 不加工正文。重试同一消息使用已保存的内部请求；后续消息建立新请求，但沿用 project 和 cache/tts。

Analysis 按 text-storyboard 生成文本结果文件（如 `work/text-result.json`），再执行：

```bash
python3 "$TOOLKIT_ROOT/tools/task_io.py" analysis --task input/message-<内部ID>/task.json --result work/text-result.json
```

Render 按 production-flow 完成全部确认分镜、检查和修改，再执行：

```bash
python3 "$TOOLKIT_ROOT/tools/task_io.py" render --task input/message-<内部ID>/task.json --manifest render/<内部制作ID>/manifest.json
```

此转换器显式调用 toolkit 的制作检查，再生成客户端 dataList；检查报错由 Codex 判断和处理，Worker 不调用它。也可由 Codex 按同一字段约定直接生成结果，但不能跳过 production-flow 的制作检查。

## 返回结果

在入口指定的 resultFile 写入：

```json
{"protocol":"video-pipeline-io/1","taskId":"内部任务ID","requestId":"客户端消息ID","stage":"render","status":"completed","result":{"dataList":[{"id":"scene_001","content":"确认正文","dur":3.2,"durationSource":"measured","artifactRef":"video-001"}]},"files":[{"id":"video-001","path":"output/当前消息/scene-001.mp4"}],"error":null}
```

result 保持客户端字段；analysis 的 dataList 含 ID、原文和估时，render 提供确认列表和实际时长。文件 ID 唯一；artifactRef 引用 files.id，Worker 只将该字段替换为 url。不要同时填写 artifactRef 和 url。files 仅列需要交付的普通文件，路径必须属于任务目录。工程与中间资料保留原位，不要求全部上传。

完成用 completed；明确需客户端或管理端处理用 needs_input；无法完成用 failed。后两者 error 必须含 code、message，result 可为 null，files 可为空。可用 `task_io.py needs_input/failed --task ... --code ... --message ...` 保存。仍有可执行制作步骤时继续当前 turn，不能以一次工具返回为由结束。

最终回复必须是以下 JSON，身份及 resultFile 与当前入口完全一致（上述命令成功后会输出该引用）：

```json
{"protocol":"video-pipeline-io/1","taskId":"内部任务ID","requestId":"客户端消息ID","stage":"render","resultFile":"output/当前消息/result.json"}
```

提交后停止写入交付文件。Worker 接受本轮明确引用的结果，负责交接、上传和回调；completed 表示制作已完成，不代表回调已送达。上传失败不重新制作。
