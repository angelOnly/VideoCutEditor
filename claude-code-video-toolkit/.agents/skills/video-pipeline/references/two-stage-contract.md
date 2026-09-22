# 阶段协议 video-two-stage/1

本文件只规定文件、身份和工具适配。文本方法与制作正文分别以 text-storyboard、production-flow 为唯一来源。Worker 不接受旧执行协议；外部 HTTP schemaVersion 仍为 2。

## Worker 输入与输出

Worker 提供只读 analysis/request.json 或 render/<runId>/request.json。字段由 [two-stage.schema.json](two-stage.schema.json) 定义：contractVersion/taskId/runId/stage/input/snapshot/confirmation/previousArtifacts/outputSpec/limits/delivery。input 定位原稿、完整要求、冻结模板与素材；snapshot 登记摘要。

Analysis 直接接收 Worker 加载的文字输入与 Skill，不调用制作工具，最终按 text-storyboard 返回轻量 JSON。Worker 保存规范化 analysis/plan.json、内部标准 candidate 和分析版本，回调 plan={}。Analysis 完成后释放槽位，等待客户端确认。

Render 的 confirmation 含 planVersion/planFile/planSha256。它由 Worker 从数据库当前 run 绑定的 confirmed 版本恢复，不能由客户端空 plan 或模型历史替代。客户端完整 dataList 决定最终 ID、顺序、文本和明确要求；技术制作方式自行决定。确认文件中的 editReason、源映射和展示估时由服务端维护。

Render 返回：

```json
{"contractVersion":"video-two-stage/1","taskId":"内部任务ID","runId":"内部执行ID","stage":"render","status":"candidate","artifact":"render/内部执行ID/manifest.json","error":null}
```

失败时 status=failed、artifact=null、error={code,message,retryable}。不得自行标记 ready、发布文件或调用客户端回调。manifest/review 的实际字段见 Schema；Worker 独立验证全部 N 句后统一发布并回调。

## 工具适配

Worker 仅 Render 注册 video_exec、video_view_image、video_tts。命令与文件操作通过 video_exec，看图通过 video_view_image，收费配音通过 video_tts。收费工具保管供应商凭据与任务缓存，模型不得直接调用收费 CLI、读取 .env 或改账本。

request、input、confirmation、history、tool-audio 只读；仅本次 render/<runId> 的制作文件及 project/output/cache 可写。通用依赖在 toolkit/templates/ifeng-scenes/node_modules，浏览器使用注入的 REMOTION_BROWSER_EXECUTABLE；不得在线安装或搜索其他任务依赖。工具返回前进程结束，不启动后台任务。

## 独立本地任务

本地完整任务也使用同一主干。two_stage.py init 根据显式 submission 文件冻结 scriptFile/requirementsFile/templateFile/assets/outputSpec，可设置 includeWholeVideo；每项 assets 使用 id/path/kind/description。本地模板依赖须显式列入授权集合，不扫描历史项目。

文本结果交给 two_stage.py storyboard --request <analysis/request.json> --result <文本结果.json>，由程序产生 plan 并校验。完整无人值守任务已有授权时，可用 two_stage.py confirm --request <analysis/request.json> --artifact <analysis/plan.json> --base-version <当前版本> --source <授权来源> 建立 render 请求；仅分析任务须在外部确认后再执行。Worker 模式禁止自行 init/confirm。

本地使用 stage_tts.py --request <render请求> --script <配音清单>；其实际制作方法、交付要求和失败处理仍见 production-flow。status/checkpoint/repair 用于核对本任务证据和剩余预算，不能凭文件存在跳过校验。独立文件协议不等于服务器 OS 隔离，也不代表客户端回调已送达。
