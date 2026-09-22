# video-worker

VideoCutEditor 的任务服务。提供稿件/素材分析、编辑确认后的分镜渲染、任务查询/取消、4 个全局执行槽位、版本化文件发布和可靠回调。源码位于 `video-worker/`，制作工具及模板继续位于同级 `claude-code-video-toolkit/`。

## 接入入口

当前单租户联调模式不要求 `Authorization`；提交 JSON 时使用 `Content-Type: application/json`。

| 方法与路径（提交前缀 `/narrate/ai_video_director`，管理前缀 `/ai_video_director`） | 作用 |
| --- | --- |
| `POST /getAiVideoEditingAnalysisData` | 接收完整 `script` 和素材，返回 HTTP 202、taskId/runId/queued |
| `POST /getAiVideoEditingData` | 接收相同 taskId、basePlanVersion 和完整 dataList，创建渲染执行 |
| `GET /tasks/:taskId` | 查询任务、排队位置、最新方案/可用结果及回调状态 |
| `POST /runs/:runId/cancel` | 取消 queued 执行；running 执行先停止本机任务进程再释放槽位 |
| `POST /callbacks/:eventId/retry` | 将本调用方的 dead_letter 事件重新投递，eventId/内容保持不变 |

两个 `...Callback` 接口由编辑平台提供，Worker 只调用它们，不在本服务重复接收。业务 JSON 采用已确认的 v2 契约；准确字段见 `src/contracts/ifeng.ts`，可运行的完整链路示例见 `tests/media.test.ts`。

输入示例：

```json
{
  "schemaVersion": 2,
  "requestId": "analysis_001",
  "taskId": "task_001",
  "script": "第一句口播。第二句口播。",
  "otherRequirements": "财经解说，保留全文，按句分镜",
  "digitalHumanAccounId": "",
  "plugin": {"digitalHumanId": "", "templateId": "finance_dialogue_v1"},
  "narration": null,
  "outputSpec": {"width": 1920, "height": 1080, "fps": 30},
  "otherMaterial": {
    "picInfoList": [{"assetId": "chart_001", "url": "/home/ops/jiangzb/videos/input/chart.jpg"}],
    "videoInfoList": []
  }
}
```

## Ubuntu 部署

默认采用混合部署：Docker 运行 PostgreSQL、API、回调发送器；Ubuntu 用户服务运行 Worker 和一个常驻 Codex app-server。全项目仍只使用根目录 `.env`，不用复制模板，也不用填写 CODEX_API_KEY。Codex 使用同一 Ubuntu 用户完成的 `codex login` ChatGPT 登录。

以 `ops` 用户执行，不要用 sudo 启动安装脚本（脚本仅在安装系统依赖时使用 sudo）：

```bash
cd /home/ops/jiangzb/VideoCutEditor
mkdir -p /home/ops/jiangzb/videos/input /home/ops/jiangzb/video-worker-data
docker compose up -d --build --remove-orphans
bash video-worker/deploy/install-host.sh
systemctl --user status videocut-worker
journalctl --user -u videocut-worker -f
```

安装脚本安装 Node 22（已有 22+ 时复用）、Python 虚拟环境、FFmpeg、字体、Bubblewrap、固定版本 Codex 0.154.0、Remotion 和浏览器；生成 systemd 用户服务并启用 linger，因此退出 SSH 后仍运行。安装末尾检查数据库、沙箱、浏览器、ChatGPT 登录和协议，不会调用模型制作视频或调用 TTS。登录失效时，使用 `ops` 用户重新 `codex login` 后再次运行安装脚本。

Compose 中 `migrate` 执行成功后退出是正常现象；没有 worker 或 runner-image 服务，不再挂载 Docker socket。API 使用 `postgres:5432`，Ubuntu Worker 使用 `127.0.0.1:15432`，连接同一个数据库。`POSTGRES_HOST_PORT` 可以调整后者。API 仍默认绑定 `127.0.0.1:8080`。真实客户端回调基地址为 `http://10.20.130.250:8000`；配置根目录 `IFENG_CALLBACK_BASE_URL` 并重建 callbacks 服务。`callback-mock` 仅用于测试。

资源限制由 `HOST_TASK_CPUS=2`、`HOST_TASK_MEMORY=4G`、`HOST_TASK_PIDS=256` 控制；四个执行槽位仍由数据库固定限制。`WORKER_EXECUTOR=host` 为默认值。旧 Docker 执行器及 legacy 协议已移除。

完整首次部署、升级和 curl 验收见 [Ubuntu 部署与联调手册](../docs/Ubuntu部署与联调手册.md)。

## 媒体文件与任务隔离

`url` 保留字段名，含义是文件系统绝对路径。`MEDIA_ROOT` 是 Worker 读取的根目录；调用方的 `inputRoot/exportRoot` 分别对应传入、返回路径所见根目录。共享盘部署时修改这些映射和挂载即可。

`allowedInputPrefixes` 限定调用方可提交的原始素材子目录。多调用方应使用各自目录，例如 `input/team-a`。分析时复制并散列输入，任务恢复继续使用同一份快照；新业务执行可以使用编辑替换的新文件。服务回调中的素材路径指向 `tasks/<内部任务主键>/inputs/<内容摘要>.<扩展名>` 的持久化快照，防止原路径覆盖后素材与成片不一致。再次确认时，只允许引用**本任务登记过**的快照，不能通过猜测路径引用其他任务文件。

成片写入 `tasks/<内部任务主键>/results/<runId>-<执行令牌>/<sceneId>.mp4`。同一任务内部主键稳定，独立于用户 taskId；不覆盖已发布成片。每镜包含本地配音、画面、动画与字幕，确认 N 镜返回 N 项，第 0 项就是第一镜。浏览器预览由编辑平台后端读取文件后提供。

## 执行、配音与回调

- PostgreSQL 原子控制 requestId 幂等、同 task 互斥、4 个槽位和版本检查。等待编辑和等待回调不占槽位。Analysis 首次开始后总期限为 600 秒，Render 为 4 小时，最多恢复 3 次执行尝试、10 轮修复，重启不重置计数。
- 一个 app-server 管理登录与多任务会话，业务 taskId 对应数据库内部任务主键和 threadId；host_executions 保存 runId、attempt、fencingToken、threadId、turnId 和工作目录。每次执行创建新会话，从数据库确认快照恢复上下文，不依赖聊天记忆或模型写入的 session.json；不复制 auth.json 或 CODEX_HOME。锁定版本的实验协议通过启动检查后才领取任务。[官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)
- Codex 的命令/看图使用 video_exec、video_view_image，由本机 Worker 路由到对应任务。制作命令在 Bubblewrap 私有文件系统、PID 和网络命名空间中运行，每个任务同一时刻最多一条命令；systemd transient service 限制资源并清理全部子进程。命令结束不会留下后台进程，Remotion 内部本地预览服务器可以在同一条制作命令期间运行。
- 模型执行不继承业务凭据；不挂载整个媒体根、运行数据根、CODEX_HOME、根目录 .env 或 Docker socket。模板/工具/输入只读，仅当前 project/output/cache 可写。可信音频工具允许写 tool-audio；仅固定 TTS 适配器获得配音凭据和外网权限。校验器使用无网络、只读工作区。
- 取消先拒绝后续工具调用，等待 turn/interrupt 完成通知，再停止并确认对应 systemd 服务。app-server 崩溃时停止接新任务，由 systemd 重启整个 Worker；启动先清理旧任务进程，随后按数据库租约恢复。没有终止确认不释放槽位。
- 首版固定豆包 TTS；服务先保存外部调用记录，再在可信本机工具沙箱中生成音频，按文本/音色/版本缓存。结果未知时返回 `EXTERNAL_RESULT_UNKNOWN`，不自动再付费。需要人工核对供应商记录和缓存后处理，不可直接删调用记录重跑。
- Analysis 仅按原文自然句生成文字列表与预估时长，不使用配音或制作工具。Render 由 Codex 发起逐句 TTS 或使用获准配音，测量真实时长后制作时间轴和字幕。
- 当前不接入数字人服务，历史账号和数字人字段必须为空；非空请求明确拒绝。
- 候选停止写入后，在无网络、只读任务挂载的可信本机沙箱校验 Schema、分镜集合、确认内容、源素材、MP4 全量解码、帧数、AAC 配音一致性和画面证据。模型提交的 `passed` 本身不是成功依据。
- 发布文件后，数据库同一事务保存结果和 outbox。回调失败只重发通知。接收端必须同时返回 HTTP 2xx 和 `{"status":0}` 才标记 delivered；4xx（429 除外）或明确业务失败进入 dead_letter。

回调头包含 `X-Event-Id`、`X-Callback-Timestamp`（Unix 秒）和 `X-Callback-Signature`。签名为 `HMAC-SHA256(callbackSecret, timestamp + "." + 原始请求体)` 的十六进制值。接收端验证签名及时间窗口、按 eventId 去重，并用 taskId/runId/planVersion/resultVersion 拒绝旧结果覆盖新结果。延迟重试保持相同事件内容，签名时间重新生成。

任务/结果保留期由部署运维约定；当前不会自动删除素材、会话或成片。清理时需排除 queued/running/cancelling、待回调和未完成编辑的任务，并先备份数据库及两个数据根目录。

## 开发与验收

Node.js 22+、pnpm 11.19.0；本地媒体测试另需 FFmpeg（含 libx264）、Python 3.11+ 和 Chromium/Chrome。

```bash
pnpm install --frozen-lockfile --ignore-scripts
# video-pipeline 唯一维护目录为 .agents，迁移脚本跳过该 Skill。
pnpm runtime-manifest
pnpm build
pnpm test

python3 -m venv .venv
.venv/bin/pip install jsonschema==4.26.0 requests==2.32.5 python-dotenv==1.2.1
PYTHON="$PWD/.venv/bin/python3" REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:media
```

默认服务测试使用 PGlite 执行 PostgreSQL SQL，不需要真实模型或付费配音。媒体测试使用明确标记的模拟 Agent 与合成音频/素材，真实运行 Remotion/FFmpeg、可信校验和发布，验证 5 镜完整输出、工程记录与明确成功版本的受控恢复。它不代替真实 Codex 的素材理解质量验收。

Ubuntu 上可以追加真实基础设施验收：

```bash
# 使用专门测试库；测试只创建/删除随机命名的独立 schema。
TEST_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/test_db pnpm test
# 检查真实本机运行环境，不调用模型/TTS；与正在运行的 Worker 互斥。
systemctl --user stop videocut-worker
pnpm host:check
systemctl --user start videocut-worker
```

真实 Codex 四任务并行/登录刷新、豆包、Ubuntu 本机隔离和编辑平台真实回调仍需使用部署配置进行联调；当前开发机的本地测试不声称已完成这些外部环境验收。

## 统一两阶段执行

服务只接受 `WORKER_EXECUTOR=host` 和 `WORKER_PROTOCOL=video-two-stage/1`，任务记录 `pipelineRevision=text-storyboard/1`；不兼容的历史任务明确失败，不自动切回旧实现。

唯一 Skill 位于 `claude-code-video-toolkit/.agents/skills/video-pipeline/`。`text-storyboard.md` 定义文字拆句，`production-flow.md` 定义共用制作方法，`two-stage-contract.md` 只说明阶段文件与服务适配。加载文件摘要随执行保存。

### 模板来源

只支持 `CUSTOM_TEMPLATE_API_BASE_URL` 定制化 ZIP 接口和 `config/templates.json` 显式本地 ZIP。旧 `TEMPLATE_API_URL` 配置会失败，不做 README/Markdown 或远端失败回退。本地联调模板为 `finance_dialogue_v1`。完整相对目录与素材随 ZIP 冻结，Render 恢复同一快照，不重新获取模板。

### 提交与确认

Analysis 只返回自然句文字、稳定 ID、`estimated` 预估时长；`plan`、`production` 为 `{}`，预览和素材数组为空。原文映射与模板摘要只保存在服务端。

```json
{
  "schemaVersion": 2,
  "requestId": "render_confirm_001",
  "taskId": "业务任务ID",
  "basePlanVersion": 1,
  "field_5": "",
  "templateId": "finance_dialogue_v1",
  "dataList": [{"id": "scene_001", "content": "确认后的完整句子。"}]
}
```

`plan` 可以省略或传 `{}`；非空时只核对已提供的关联身份。`dataList` 是本次完整确认列表，支持改字、增删与排序，不需要客户端传回技术方案。`dur` 可省略且不作为制作时长依据。Worker 从 DB 保存原分析、确认前后文本与版本，Render 的准备和发布均读取该 confirmed 快照。

Codex 在 Render 中通过可信 `video_tts` 发起逐句配音，随后制作工程、实测时间轴、渲染与看图检查。确认 N 句，发布 N 条 MP4；回调与查询只投影文字、实际时长和成品路径，制作资源数组为空。工程、音频、timeline、manifest、工具版本及文件摘要保留在服务端。

### 失败与恢复

- Analysis 缺响应、拆句不保真、工具调用或总时限耗尽直接按阶段失败，不进入制作修复循环。
- `host_executions` 记录最后事件/进展、当前工具、开始/结束及清理状态；租约续期和 token 更新不等于制作进展。长时间安静写告警，不再以 60 秒静默杀死正常制作。
- Render 候选不满足文本、来源、帧数、音频、字幕、时间轴或工程留存要求时进入有限修复；最终失败保留原因。收费结果未知不能自动重付。
- 取消与超时先停止执行并确认进程清理，再释放槽位。回调失败只重送事件。
- 同 run 重试只恢复本次资料。后续续编必须明确成功 run/resultVersion，由 `restoreProduction()` 校验确认版本、模板、工具版本及全部文件摘要后复制新工作副本；旧结果不覆盖。不自动选择上一轮工程，不承诺自动增量渲染。
- 制作资料当前不自动回收，会增加磁盘占用；清理前须区分缓存与续编必需文件。

### 验证与升级

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:stages
```

本地合成素材测试不代表真实 Codex、付费 TTS、Ubuntu 隔离和客户端回调已验收。服务器步骤以 [部署手册](../docs/Ubuntu部署与联调手册.md) 为准：停止接收并排空任务、备份、按顺序执行 001/002 迁移、更新运行清单与服务、停 Worker 做 host-check 后恢复。不能删库或删除任务目录升级。

### Render 章节会话与媒体批次

`video_chapters` 是 Render 内部工具：`dispatch` 指定 `chapterId` 和当前 run 下的 `chapters/<chapterId>/brief.json`；`status`、`cancel` 指定返回的 `executionId`。派发前主 Render 必须写 `direction.json`，brief 的 `directionVersion`、`chapterId`、有序 `sceneIds` 和真实 `audioAnchors` 固定本章范围。最多同时创作三章，单章不重复派发。候选绑定 attempt、brief 摘要、编排版本和实际文件摘要；主 Render 收取时再次校验，旧回复不能覆盖新编排。

宿主和 `scripts/local-render.ts` 共用 `runner/chapters.ts`。每章创建独立 app-server 线程，仅开放 `video_chapter_files` 的文本读取、目录列举和本章 workspace 写入；关闭原生命令、网络、收费配音和交付工具。写入由可信文件代理检查路径和链接，模型权限配置也只允许只读文件。章节不拥有 shell 或 Chrome，生成的组件和预览要求先交主 Render；主 Render 经统一媒体入口实际渲染预览、反馈修复并决定合并。章节返回 `candidate` 只说明版本和文件可核验，不代表动态预览或节奏验收通过。

父预算、取消和租约覆盖全部章节。内部记录位于 `.control/chapters/`，含真实线程、turn、父令牌、时间与运行时提供的 token 使用信息。重启不把旧运行记录恢复为成功；重新派发新 attempt，并由主 Render 决定是否采用经核验的旧候选。收到明确额度耗尽错误后该管理器拒绝新章节派发，不消费重置信用。

`video_media` 增加 `freeze-batch`（`batch`、`project`、`entry`、`scenes`）和 `render-batch`（`manifest`、可选 `slots`）。scenes 是任务相对 JSON 文件，批次结果逐镜返回，宿主在重新核对租约后串行登记进度。所有任务的受控媒体调用共享宿主 FIFO 槽，整批申请避免资源互等；每镜帧并发仍由媒体层固定为 1。`HOST_RENDER_SLOTS` 可设 1 至 3，默认保守为 1；目标机测得稳定收益后再显式设为 2，3 路只用于验证后启用。章节创作三路和渲染槽是独立限制。Linux 进程控制组验收仍需在专用 Ubuntu 环境执行，普通单元测试不代表已验证该外部环境。
