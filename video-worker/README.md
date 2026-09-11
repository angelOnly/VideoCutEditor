# video-worker

VideoCutEditor 的任务服务。提供稿件/素材分析、编辑确认后的分镜渲染、任务查询/取消、4 个全局执行槽位、版本化文件发布和可靠回调。源码位于 `video-worker/`，制作工具及模板继续位于同级 `claude-code-video-toolkit/`。

## 接入入口

所有业务请求使用 `Authorization: Bearer <调用方 apiKey>` 和 `Content-Type: application/json`。

| 方法与路径（前缀 `/ai_video_director`） | 作用 |
| --- | --- |
| `POST /getAiVideoEditingAnalysisData` | 接收完整 `script` 和素材，返回 HTTP 202、taskId/runId/queued |
| `POST /getAiVideoEditingData` | 接收相同 taskId、basePlanVersion 和完整 dataList，创建渲染执行 |
| `GET /tasks/:taskId` | 查询任务、排队位置、最新方案/可用结果及回调状态 |
| `POST /runs/:runId/cancel` | 取消 queued 执行；running 执行先停止容器再释放槽位 |
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

首次部署和逐步验收请按 [Ubuntu 部署与联调手册](../docs/Ubuntu部署与联调手册.md) 操作，包含临时回调接收器、分析/确认 curl 请求、文件检查及 4 并发测试。

需要 Ubuntu 上的 Docker Engine、Compose v2，以及能访问模型与已配置配音服务的网络。媒体根目录为 `/home/ops/jiangzb/videos`，运行数据根目录为 `/home/ops/jiangzb/video-worker-data`。两者均为宿主持久化目录，不放在代码库里。

从 `video-worker/` 执行：

```bash
cp .env.example .env
cp config/tenants.example.json config/tenants.json
# 编辑上述两个文件：设置数据库密码、调用方令牌、实际回调服务地址、签名密钥及 Codex/豆包凭据。
mkdir -p /home/ops/jiangzb/videos/input /home/ops/jiangzb/video-worker-data

docker compose --env-file .env -f deploy/compose.yaml --profile build build
docker compose --env-file .env -f deploy/compose.yaml up -d postgres
docker compose --env-file .env -f deploy/compose.yaml run --rm migrate
docker compose --env-file .env -f deploy/compose.yaml up -d api worker callbacks
```

API 默认绑定宿主 `127.0.0.1:8080`，由现有网关反代给编辑平台。`callbackBaseUrl` 必须是 callbacks 容器可达的编辑平台后端地址；容器里的 `127.0.0.1` 是容器自身。Runner 镜像构建包含 Chromium、FFmpeg、字体、固定版本模板和 SDK，不需要运行时安装依赖。

`DATA_ROOT` 在 control 容器与宿主保持**相同绝对路径**，因为 Docker daemon 解析的是宿主的 bind source。仅 Worker 控制进程挂载 Docker socket；任务容器只挂载本次工作区，input 和 task.json 只读。部署脚本通过宿主共享的 `flock` 锁保证单宿主只有一个 supervisor；恢复时先停止旧容器，再释放数据库槽位。不要绕过 `deploy/start-worker.sh` 直接启动生产 Worker。建议为运行数据配置独立磁盘/配额和备份，按真实任务压测调整 CPU/内存；不将 DATA_ROOT 指向其他机器的共享 supervisor 锁文件。

Worker 启动时将 Runner 标签解析为本地镜像 ID，本次进程固定使用该镜像。`deploy/runtime-manifest.json` 记录制作源码摘要，修改制作代码后运行 `pnpm runtime-manifest` 并一起发布 control/runner 两个镜像。摘要和执行镜像参与分镜缓存键。

## 媒体文件与任务隔离

`url` 保留字段名，含义是文件系统绝对路径。`MEDIA_ROOT` 是 Worker 读取的根目录；调用方的 `inputRoot/exportRoot` 分别对应传入、返回路径所见根目录。共享盘部署时修改这些映射和挂载即可。

`allowedInputPrefixes` 限定调用方可提交的原始素材子目录。多调用方应使用各自目录，例如 `input/team-a`。分析时复制并散列输入，任务恢复继续使用同一份快照；新业务执行可以使用编辑替换的新文件。服务回调中的素材路径指向 `tasks/<内部任务主键>/inputs/<内容摘要>.<扩展名>` 的持久化快照，防止原路径覆盖后素材与成片不一致。再次确认时，只允许引用**本任务登记过**的快照，不能通过猜测路径引用其他任务文件。

成片写入 `tasks/<内部任务主键>/results/<runId>-<执行令牌>/<sceneId>.mp4`。同一任务内部主键稳定，独立于用户 taskId；不覆盖已发布成片。每镜包含本地配音、画面、动画与字幕，确认 N 镜返回 N 项，第 0 项就是第一镜。浏览器预览由编辑平台后端读取文件后提供。

## 执行、配音与回调

- PostgreSQL 原子控制 requestId 幂等、同 task 互斥、4 个槽位和版本检查。等待编辑和等待回调不占槽位。run 首次开始后总期限为 4 小时，最多恢复 3 次执行尝试、10 轮修复，重启不重置计数。
- Codex SDK 的 `startThread/resumeThread/runStreamed` 只在任务容器中执行；每任务保存独立会话快照，按精确 threadId 恢复。缺少本地会话文件时从确认快照创建新会话。原始 SDK 事件不直接决定任务成功。[官方 SDK 文档](https://learn.chatgpt.com/docs/codex-sdk)
- 首版固定豆包 TTS；服务先保存外部调用记录，再在可信工具容器中生成音频，按文本/音色/版本缓存。结果未知时返回 `EXTERNAL_RESULT_UNKNOWN`，不自动再付费。需要人工核对供应商记录和缓存后处理，不可直接删调用记录重跑。
- 使用预配音时，每镜必须有 `narrationStartTime/narrationEndTime`。分析阶段不能对齐就明确失败；改动已有配音的口播文本需重新提交匹配音频进行分析。句级字幕按实际音频量化时长，长句分页，不宣称逐字对齐。
- 数字人首版使用与该镜口播匹配的**预生成视频**：设置 `digitalHumanId`，并在 videoInfoList 提供一条 `role: "presenter"` 素材。不会默认调用尚未完成 Ubuntu 联调的一镜/曦灵服务。模板支持 full_frame/presenter_pip、none/slow_zoom/fade，跨镜音乐/转场交给下游。
- 候选停止写入后，在无网络、只读任务挂载的可信容器校验 Schema、分镜集合、确认内容、源素材、MP4 全量解码、帧数、AAC 配音一致性和画面证据。模型提交的 `passed` 本身不是成功依据。
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
# 先构建 Runner；此项无模型调用，验证镜像依赖与目录隔离。
RUN_DOCKER_TESTS=1 RUNNER_IMAGE=videocut-runner:0.1.0 pnpm test
```

真实 Codex/豆包、Ubuntu Docker 运行及编辑平台真实回调仍需使用部署配置进行联调；当前开发机的本地测试不声称已完成这些外部环境验收。
