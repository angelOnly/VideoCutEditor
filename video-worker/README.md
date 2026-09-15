# video-worker

VideoCutEditor 的任务服务。提供稿件/素材分析、编辑确认后的分镜渲染、任务查询/取消、4 个全局执行槽位、版本化文件发布和可靠回调。源码位于 `video-worker/`，制作工具及模板继续位于同级 `claude-code-video-toolkit/`。

## 接入入口

所有业务请求使用 `Authorization: Bearer <调用方 apiKey>` 和 `Content-Type: application/json`。

| 方法与路径（前缀 `/ai_video_director`） | 作用 |
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
  "digitalHumanAccounId": "account_001",
  "plugin": {"digitalHumanId": "", "templateId": "finance_vertical_v1"},
  "narration": null,
  "outputSpec": {"width": 1080, "height": 1920, "fps": 30},
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

Compose 中 `migrate` 执行成功后退出是正常现象；没有 worker 或 runner-image 服务，不再挂载 Docker socket。API 使用 `postgres:5432`，Ubuntu Worker 使用 `127.0.0.1:15432`，连接同一个数据库。`POSTGRES_HOST_PORT` 可以调整后者。API 仍默认绑定 `127.0.0.1:8080`。默认测试回调接收器为 `callback-mock`，真实联调时修改根目录 `IFENG_CALLBACK_BASE_URL` 并重建 callbacks 服务。

资源限制由 `HOST_TASK_CPUS=2`、`HOST_TASK_MEMORY=4G`、`HOST_TASK_PIDS=256` 控制；四个执行槽位仍由数据库固定限制。`WORKER_EXECUTOR=host` 为默认值。旧 DockerSandbox 和 Runner Dockerfile 保留用于旧执行器回归，不属于当前 Compose 部署；其 API Key 配置不用于本机 ChatGPT 模式。

完整首次部署、升级和 curl 验收见 [Ubuntu 部署与联调手册](../docs/Ubuntu部署与联调手册.md)。

## 媒体文件与任务隔离

`url` 保留字段名，含义是文件系统绝对路径。`MEDIA_ROOT` 是 Worker 读取的根目录；调用方的 `inputRoot/exportRoot` 分别对应传入、返回路径所见根目录。共享盘部署时修改这些映射和挂载即可。

`allowedInputPrefixes` 限定调用方可提交的原始素材子目录。多调用方应使用各自目录，例如 `input/team-a`。分析时复制并散列输入，任务恢复继续使用同一份快照；新业务执行可以使用编辑替换的新文件。服务回调中的素材路径指向 `tasks/<内部任务主键>/inputs/<内容摘要>.<扩展名>` 的持久化快照，防止原路径覆盖后素材与成片不一致。再次确认时，只允许引用**本任务登记过**的快照，不能通过猜测路径引用其他任务文件。

成片写入 `tasks/<内部任务主键>/results/<runId>-<执行令牌>/<sceneId>.mp4`。同一任务内部主键稳定，独立于用户 taskId；不覆盖已发布成片。每镜包含本地配音、画面、动画与字幕，确认 N 镜返回 N 项，第 0 项就是第一镜。浏览器预览由编辑平台后端读取文件后提供。

## 执行、配音与回调

- PostgreSQL 原子控制 requestId 幂等、同 task 互斥、4 个槽位和版本检查。等待编辑和等待回调不占槽位。run 首次开始后总期限为 4 小时，最多恢复 3 次执行尝试、10 轮修复，重启不重置计数。
- 一个 app-server 管理登录与多任务会话，业务 taskId 对应数据库内部任务主键和 threadId；host_executions 保存 runId、attempt、fencingToken、threadId、turnId 和工作目录。会话恢复读取数据库，不信任模型写入的 session.json；不复制 auth.json 或 CODEX_HOME。锁定版本的实验协议通过启动检查后才领取任务。[官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)
- Codex 的命令/看图使用 video_exec、video_view_image，由本机 Worker 路由到对应任务。制作命令在 Bubblewrap 私有文件系统、PID 和网络命名空间中运行，每个任务同一时刻最多一条命令；systemd transient service 限制资源并清理全部子进程。命令结束不会留下后台进程，Remotion 内部本地预览服务器可以在同一条制作命令期间运行。
- 模型执行不继承业务凭据；不挂载整个媒体根、运行数据根、CODEX_HOME、根目录 .env 或 Docker socket。模板/工具/输入只读，仅当前 project/output/cache 可写。可信音频准备允许写 input/audio；仅固定 TTS 适配器获得配音凭据和外网权限。校验器使用无网络、只读工作区。
- 取消先拒绝后续工具调用，等待 turn/interrupt 完成通知，再停止并确认对应 systemd 服务。app-server 崩溃时停止接新任务，由 systemd 重启整个 Worker；启动先清理旧任务进程，随后按数据库租约恢复。没有终止确认不释放槽位。
- 首版固定豆包 TTS；服务先保存外部调用记录，再在可信本机工具沙箱中生成音频，按文本/音色/版本缓存。结果未知时返回 `EXTERNAL_RESULT_UNKNOWN`，不自动再付费。需要人工核对供应商记录和缓存后处理，不可直接删调用记录重跑。
- 使用预配音时，每镜必须有 `narrationStartTime/narrationEndTime`。分析阶段不能对齐就明确失败；改动已有配音的口播文本需重新提交匹配音频进行分析。句级字幕按实际音频量化时长，长句分页，不宣称逐字对齐。
- 数字人首版使用与该镜口播匹配的**预生成视频**：设置 `digitalHumanId`，并在 videoInfoList 提供一条 `role: "presenter"` 素材。不会默认调用尚未完成 Ubuntu 联调的一镜/曦灵服务。模板支持 full_frame/presenter_pip、none/slow_zoom/fade，跨镜音乐/转场交给下游。
- 候选停止写入后，在无网络、只读任务挂载的可信本机沙箱校验 Schema、分镜集合、确认内容、源素材、MP4 全量解码、帧数、AAC 配音一致性和画面证据。模型提交的 `passed` 本身不是成功依据。
- 发布文件后，数据库同一事务保存结果和 outbox。回调失败只重发通知。接收端必须同时返回 HTTP 2xx 和 `{"status":0}` 才标记 delivered；4xx（429 除外）或明确业务失败进入 dead_letter。

回调头包含 `X-Event-Id`、`X-Callback-Timestamp`（Unix 秒）和 `X-Callback-Signature`。签名为 `HMAC-SHA256(callbackSecret, timestamp + "." + 原始请求体)` 的十六进制值。接收端验证签名及时间窗口、按 eventId 去重，并用 taskId/runId/planVersion/resultVersion 拒绝旧结果覆盖新结果。延迟重试保持相同事件内容，签名时间重新生成。

任务/结果保留期由部署运维约定；当前不会自动删除素材、会话或成片。清理时需排除 queued/running/cancelling、待回调和未完成编辑的任务，并先备份数据库及两个数据根目录。

## 开发与验收

Node.js 22+、pnpm 11.19.0；本地媒体测试另需 FFmpeg（含 libx264）、Python 3.11+ 和 Chromium/Chrome。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm contracts
# 从 toolkit 目录同步维护源：python3 scripts/migrate_to_codex.py --force
pnpm runtime-manifest
pnpm build
pnpm test

python3 -m venv .venv
.venv/bin/pip install jsonschema==4.26.0 requests==2.32.5 python-dotenv==1.2.1
PYTHON="$PWD/.venv/bin/python3" REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:media
```

默认服务测试使用 PGlite 执行 PostgreSQL SQL，不需要真实模型或付费配音。媒体测试使用明确标记的模拟 Agent 与合成音频/素材，真实运行 Remotion/FFmpeg、可信校验和发布，验证 5 镜完整输出及改第 3 镜只渲染 1 镜。它不代替真实 Codex 的素材理解质量验收。

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

## 模板驱动两阶段执行（2026-09-15）

新链路使用 toolkit 的 `video-two-stage/1`。Worker 不预配音、不选择重做镜头、不使用固定布局渲染器；Codex 读取冻结模板、完整要求与阶段请求，执行分析或制作。现有数据库、4 个执行槽位、租约、取消和回调 outbox 继续使用。

为避免未经 Ubuntu 验收自动切换线上任务，默认仍是 `legacy`。在根 `.env` 中显式设置以下两项可启用新提交任务；不用复制新的 `.env`：

```dotenv
WORKER_EXECUTOR=host
WORKER_PROTOCOL=video-two-stage/1
```

已存在任务沿用提交时记录的协议，新旧任务不会在 render 时混用。双人财经无需专用 Worker 分支，但模板、头像、Logo、音效和允许复用源码必须显式配置为本次资料；未提供的资料不会自动从历史项目补齐。

### 模板来源

未设置 `TEMPLATE_API_URL` 时，Worker 按 `config/templates.json` 读取本地模板，快照标注 `source=fixture`。`path` 指向 toolkit 内的 Markdown 文件；旧目录配置暂按其中的 README.md 读取，这只是联调资料，不代表已配置财经双人模板。允许为条目添加 `attachments`，每项为 `assetId/url/kind`；`url` 必须为获准媒体根下的文件路径，`kind` 为 `image/video/audio/reference/source/font`。

设置 `TEMPLATE_API_URL` 后，适配器以 GET 查询参数 `templateId` 读取以下标准化响应。目前尚未接入实际平台模板接口；若其报文不同，只调整 `TemplateProvider`，不要在 Worker 增加布局分支。

```json
{
  "id": "finance_dialogue",
  "version": "1",
  "content": "1920×1080，双主持人布局，谁说话谁高亮。正文按确认稿件制作……",
  "attachments": [
    {"assetId": "logo", "url": "/home/ops/jiangzb/videos/input/logo.png", "kind": "image"}
  ]
}
```

模板在领取 analysis 时固化，重试和 render 使用同一快照。不会在 render 时重新读取远端模板。原稿、制作要求及素材也绑定文件摘要。

### 提交与确认

分析提交沿用 `getAiVideoEditingAnalysisData`。返回分析回调与任务查询中的 `plan` 为完整内部方案，`dataList` 为平台展示投影。未配音的时长标记为 `estimated`。

任务查询响应中 `data.plan.plan` 是完整方案，`data.plan.dataList` 是分镜列表。编辑确认提交到 `getAiVideoEditingData`：

```json
{
  "schemaVersion": 2,
  "requestId": "render_confirm_001",
  "taskId": "业务任务ID",
  "basePlanVersion": 1,
  "field_5": "原数字人账号ID",
  "templateId": "finance_dialogue",
  "plan": {"说明": "此处必须提交查询得到的完整 plan 对象，保留全部字段；本示例不直接用于请求"},
  "dataList": [{"说明": "此处提交与 plan 对应的完整分镜列表"}]
}
```

`plan.taskId` 是内部任务 UUID，不要改成业务 `taskId`。编辑文本、制作信息时，同步更新对应 `dataList.content/production`；改稿需在该镜的 `editReason` 写明理由，并保留原稿映射。素材替换在 `dataList.extraData` 提交 `assetId/url`，同步调整 `plan.scenes[].assetRefs/production`。Worker 验证输入快照与确认版本，保存完整确认；不会猜测缺失的制作字段。无完整方案、版本过期或两个表示冲突时拒绝提交。

Codex 制作时通过 `video_tts` 提交口播与实际音色；可信通道校验文本并调用现有豆包工具。普通 `video_exec` 无网络、凭据或收费账本访问权限。通用渲染使用 `stage_media.py`，只读终检使用 `worker_stage.py check`。成功后发布 N 条分镜 MP4 与实际素材路径，回调重送不重新制作。

### 本地机械测试与 Ubuntu 验收

```bash
cd /home/ops/jiangzb/VideoCutEditor/video-worker
pnpm build
pnpm test
pnpm test:stages
```

本轮本机验证：Worker 24 项通过、3 项环境相关集成测试跳过；两阶段工具 32 项和可信桥接 3 项通过，共 59 项通过。包含新建短 Remotion 工程渲染及两条合成 MP4 的终检、发布测试；TypeScript 构建通过。未执行真实付费 TTS 或 Ubuntu 业务验收。

`test:stages` 需要安装脚本创建的 `.venv`、FFmpeg/ffprobe。它创建合成色块与音频，测试数据库→analysis→外部确认→render 请求→真实 MP4 终检→发布→回调数据；不访问 Codex 或付费 TTS，不代表财经视频主观效果通过。

启用根 `.env` 的新协议后，部署仍执行：

```bash
cd /home/ops/jiangzb/VideoCutEditor
bash video-worker/deploy/install-host.sh
docker compose up -d --build --remove-orphans
systemctl --user status videocut-worker --no-pager -l
journalctl --user -u videocut-worker -f
```

安装预检增加了两阶段 Schema/工具可见性、阶段目录可写及请求文件只读检查。仍需在 Ubuntu 完成真实双人财经任务和另一种模板测试、4 并发/第 5～6 个排队、运行中取消，以及实际模板 API、编辑页面和回调服务联调。

### 失败、恢复和边界

- 无效方案在可信终检失败；Worker 的修复次数统计一次“候选被拒绝后重新提交”，由数据库统一计数。阶段总时限覆盖模型与工具调用，重试不重置数据库 deadline。
- 收费请求的 pending/unknown 状态放在任务级 `tool-cache`，进程中断后仍保留；结果未知时不会自动再次收费，需核查供应商结果。
- 重试/新 render 读取本任务历史资料和工程，旧进程记录只作历史证据；不会按跨 namespace 的旧 PID 杀进程。停止及释放槽位仍由 systemd/cgroup 与租约控制。
- analysis 不恢复旧 render 产物到当前输出，避免将历史 MP4 误判为本轮副作用。跨阶段预览和实测音频证据需放在 `analysis/` 或 `input/`。
- 新方案的角色/布局/动效信息保存在开放的 `production` 中；完整方案往返需要编辑端支持。此处已实现服务端契约，未宣称外部编辑端已适配。
- 当前受控能力是 shell、看图和豆包 TTS；未开放任意 MCP、其他供应商或网络。新增能力按独立工具适配，不放入 Worker 制作逻辑。
