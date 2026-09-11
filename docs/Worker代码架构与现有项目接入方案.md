# Worker 代码架构与现有项目接入方案

日期：2026-09-10。本文基于当前工作区实际文件梳理，目录已按用户指定的同级结构整理，Git 根为 VideoCutEditor；Worker 与 pipeline 的首版实现已落入代码，部署与测试命令见 [Worker README](../video-worker/README.md)。本文保留设计依据，实际运行边界以 README 和代码为准。

本方案补充《AI视频剪辑上下游对接方案.md》，重点回答：Worker 放哪里、现有代码如何复用、哪些文件需要修改、运行时如何衔接。

## 1. 架构决定

项目统一为 `VideoCutEditor/`，直接沿用原 toolkit 的 Git 历史与 `ifeng/VideoCutEditor` 远程。在仓库内的 `video-worker/` 开发新服务。

`video-worker` 管理业务和执行生命周期；`claude-code-video-toolkit/` 内现有的 `tools/`、`lib/`、`templates/` 和 Skills 继续提供视频制作能力。两者通过版本化的任务 JSON、候选结果 JSON、文件产物衔接，不把 Python 工具全部重写成 TypeScript，也不让每个 Remotion 工程接收业务 HTTP 请求。

首版是一个服务代码包、多种进程入口，不按每个业务模块拆微服务。现有 toolkit 内部相对路径保持不变，所有新服务与文档都位于同一个 Git 根内。

本文件的路径约定：`src/`、`deploy/`、`migrations/` 等服务路径以 `VideoCutEditor/video-worker/` 为基准；`tools/`、`lib/`、`templates/`、`.claude/`、`.agents/`、`test-cases/` 等制作路径以 `VideoCutEditor/claude-code-video-toolkit/` 为基准。根级 `docs/` 存放项目对接文档，工具库自己的说明仍在 `claude-code-video-toolkit/docs/`。

## 2. 当前项目真实结构

```text
VideoCutEditor/                         项目与 Git 根
├── claude-code-video-toolkit/          视频制作主体，内部路径保持原样
│   ├── .claude/skills/                 制作流程指令的维护源
│   ├── .agents/skills/                 生成的 Codex Skills
│   ├── tools/                         配音、字幕、FFmpeg 等 Python 工具
│   ├── lib/                           视频组件、主题、转场
│   ├── templates/                     模板工程
│   ├── examples/hello-world/          已积累的财经等视频代码
│   ├── test-cases/                     本地单任务启动及准备脚本
│   ├── tests/、scripts/、docker/       工具库测试、迁移及模型部署
│   ├── docs/                          工具库自身说明
│   └── projects/、jobs/                本地制作数据，保留忽略规则
├── video-worker/                      同级任务服务，已实现源码与部署配置
├── huibo-saas/                         百度一镜数字人 HTTP 适配器
├── xiling-http/                        数字人口播调用脚本
├── docs/                              项目接口、上下游与 Worker 架构文档
├── .github/                           仓库级工作流
└── .local-data/reference-videos/       本地输入素材，不提交
```

当前没有统一根级 `package.json` 或已实现的剪辑任务平台服务。工作台截图对应的前端源码也没有在本次本地盘点中找到，不能把前端接入文件名当成已有代码。

### 2.1 现有代码能做什么，缺什么

| 现有位置 | 核实到的能力 | 本次接入方式 |
| --- | --- | --- |
| `.claude/skills/video-pipeline/SKILL.md` | 从输入一路执行到单个 MP4 的 Agent 指令 | 增加分析/确认后渲染分支，保留旧自动模式 |
| `video-pipeline/scripts/validate_delivery.py` | 校验 v1 auto 任务、阶段证据、固定 `output/video.mp4` | 提取通用视频检查，增加分析与分镜集合校验 |
| `test-cases/deepseek-v4/prepare.py` | 复制指定模板文件，生成 task.json/prompt.txt | 参考准备流程，新增通用 workspace 模块；不直接当通用函数调用 |
| `test-cases/deepseek-v4/run.sh` | flock、超时、Codex CLI、候选校验 | 保留测试入口；生产由新的 Worker 生命周期替代 |
| `tools/voiceover.py`、`doubao_tts.py` | 已有配音入口和豆包调用能力 | 通过容器内适配器复用，不重写 provider |
| `tools/generate_dialogue_audio.py` | 每句独立 MP3、测量时长、输出时间轴 | 复用分句思路；补强内容缓存和输入验证后使用 |
| `lib/components/`、`lib/transitions/` | 可复用画面、动画、转场组件 | 新分镜模板使用其中需要的组件 |
| `lib/project/types.ts` | 本地 project.json 生命周期类型 | 不作为服务任务数据库；无需塞入队列/租约字段 |
| `huibo-saas/server.cjs` | 一镜账号登录、付费生成、查询及本机 state.json | 作为可选数字人供应商服务，经 HTTP 访问 |
| `tools/file_transfer.py` | 云 GPU 输入临时上传，可回退到公共临时站点 | 不用作生产成片发布；新存储模块负责本地/共享盘文件发布 |

`docker/` 里已有的 RunPod/Modal 代码是具体模型服务，不是运行整个 Codex 视频任务的沙箱镜像。

## 3. 建议新增的代码结构

`video-worker/` 已实现主要模块；可选数字人在线供应商适配尚未接入，首版采用预生成素材。目录按职责划分，同一职责首版可放在一个文件，不需要为每个小函数创建文件。

```text
VideoCutEditor/video-worker/    新增：业务控制与执行服务
├── package.json                      一个 TS 项目，多个入口
├── tsconfig.json
├── .env.example                      只列配置名和非敏感示例
├── src/
│   ├── entrypoints/
│   │   ├── api.ts                    接收分析/渲染，查询、取消
│   │   ├── worker.ts                 领取、启动、续租、恢复、校验、发布
│   │   ├── callbacks.ts              可靠回调发送循环
│   │   └── runner.ts                 只在任务容器内运行，调用 Codex SDK
│   ├── contracts/
│   │   ├── ifeng.ts                  上下游请求/回调运行时校验与类型
│   │   └── internal.ts               导入固定 toolkit 契约对应的类型/校验
│   ├── api/
│   │   └── routes.ts                 HTTP 路径绑定、鉴权、响应
│   ├── application/
│   │   ├── tasks.ts                  submitAnalysis/submitRender/query/cancel
│   │   ├── execute-run.ts            一次 run 的完整外部控制循环
│   │   └── results.ts                候选验收、结果版本、回调事件
│   ├── domain/
│   │   ├── task.ts                   task/run 状态、版本与允许的转换
│   │   └── scene.ts                  分镜规范化与制作输入摘要
│   ├── integrations/ifeng/
│   │   └── mapper.ts                 外部 JSON ↔ 内部制作数据
│   ├── runner/
│   │   ├── codex.ts                  start/resume/run、事件消费
│   │   └── prompts.ts                analysis/render 的服务端提示模板
│   └── infrastructure/
│       ├── postgres.ts              数据库连接与事务
│       ├── task-repository.ts        幂等、版本、状态、结果数据库操作
│       ├── queue.ts                  4 槽位事务领取、续租、执行令牌
│       ├── sandbox.ts                容器创建/停止/检查/回收
│       ├── workspace.ts              读取输入、复制快照、生成 task.json
│       ├── validation.ts             从可信镜像运行 Python 校验器
│       ├── storage.ts                本地/共享盘发布、路径映射、保留期
│       ├── callback-outbox.ts        待发送事件、重试、送达记录
│       └── avatar-client.ts          可选数字人服务 HTTP 适配
├── migrations/001_initial.sql        task/run/版本/素材/槽位/outbox
├── config/templates.json             本服务准入模板 ID 与运行镜像版本
├── tests/                            服务契约、并发、恢复和联调测试
└── deploy/
    ├── Dockerfile.control            API/Worker/回调发送器镜像
    ├── Dockerfile.runner             SDK + toolkit + 媒体依赖
    ├── compose.yaml                  首版单机部署配置
    └── runtime-manifest.json         源码快照、契约、依赖和镜像版本
```

`runner.ts` 不能导入 postgres、回调签名密钥或容器管理模块。即使同属一个代码包，打包时也只把 runner 所需模块放入执行镜像。

### 3.1 同级目录如何连接

开发时 `video-worker` 从自身项目位置解析 `../claude-code-video-toolkit`，或者读取显式的工具库路径配置，不把启动时的 cwd 当作固定根目录。模型执行/工具调用时 cwd 指向工具库，输入输出参数使用该任务的独立路径。

镜像构建从 `VideoCutEditor/` 根提供构建上下文，以便同时 COPY `video-worker/` 和经过筛选的 `claude-code-video-toolkit/`；不能仅把 video-worker 目录作为上下文后再尝试 COPY `../claude-code-video-toolkit`。构建排除 Git、凭据、本地任务和旧产物。生产容器的固定路径独立于本机文件夹命名。

## 4. 四种运行角色如何连接

```text
编辑平台
   │ POST 两个接收接口
   ▼
api.ts ──────────► PostgreSQL
                      ▲
                      │ 领取任务、续租、状态、结果
                      ▼
                  worker.ts
                      │ 创建/监督，最多 4 个活动任务环境
                      ▼
          独立容器：runner.ts → Codex SDK
                                   │ 按 operation 执行
                                   ▼
                         video-pipeline Skill
                                   │
                    Python tools + 分镜 Remotion 工程
                                   │
                              候选文件与清单
                      │
                  worker.ts → 可信校验 → 本地/共享盘目录
                      │ 事务保存结果和待回调事件
                      ▼
                 PostgreSQL → callbacks.ts → 编辑平台两个回调接口
```

- API 请求结束不影响渲染；Worker 重启不丢任务；回调端故障不重新制作视频。
- 首版可以部署一个 supervisor Worker，异步管理最多 4 个容器。API 和回调发送器各自独立进程。
- 4 个槽位是数据库全局记录，不是进程内 `Promise.all` 或 `busy` 变量；扩多个 Worker 后仍不得突破上限。
- 容器管理权限只在 supervisor 所在受控层，任务容器不持有 Docker socket。
- 校验/文件发布可继续占用原任务槽位。确认任务环境及其子进程停止后释放；回调发送不占用槽位。

## 5. 一次真实请求会经过哪些代码

### 5.1 分析请求

```text
POST /ai_video_director/getAiVideoEditingAnalysisData
  → api/routes.ts
  → contracts/ifeng.ts                 校验外部请求
  → integrations/ifeng/mapper.ts        转内部字段
  → application/tasks.ts               识别 taskId、幂等 requestId
  → task-repository.ts                 事务创建 task + analysis run
  → API 返回已受理

entrypoints/worker.ts
  → queue.ts                           原子领取 run + 槽位
  → application/execute-run.ts
  → workspace.ts                       固化稿件素材和任务描述
  → sandbox.ts                         启动固定版本运行镜像
  → entrypoints/runner.ts
  → runner/codex.ts + prompts.ts
  → video-pipeline(operation=analysis)
  → output/analysis-plan.json
  → validation.ts                      校验结构/素材引用/分镜覆盖
  → application/results.ts             保存 v1 + awaiting_editor + outbox
  → 停止容器并释放槽位

entrypoints/callbacks.ts
  → mapper.ts                          内部分镜方案 → dataInfo/dataList
  → getAiVideoEditingAnalysisDataCallback
```

分析产物不是某个代码文件里的自由文本，而是可校验、可版本化的 JSON。等待编辑确认时，业务状态在数据库，Codex 不保持阻塞会话。

### 5.2 确认后渲染请求

```text
POST /ai_video_director/getAiVideoEditingData
  → routes + contracts + mapper
  → tasks.ts                           检查基础版本和活动 run
  → task-repository.ts                 保存确认方案 v2 + render run
  → API 返回已受理

worker.ts → queue.ts → execute-run.ts
  → scene.ts                           计算哪些镜头需重做
  → workspace.ts                       写 confirmed-plan.json、复用清单
  → sandbox.ts → runner.ts → Codex SDK
  → video-pipeline(operation=render)
  → tools/ 配音、模板工程、逐镜渲染
  → output/scenes/*.mp4 + output/render-manifest.json
  → validation.ts                      校验每镜与整组映射
  → storage.ts                         将所有新增文件发布到持久化目录
  → results.ts                         保存完整结果版本 + outbox
  → 停止容器并释放槽位

callbacks.ts → mapper.ts → getAiVideoEditingDataCallback
```

上下游字段只在 `ifeng.ts/mapper.ts` 中处理。例如 `field_5` 和 `digitalHumanAccounId` 在边界映射为同一个内部 `digitalHumanAccountId`。日后外部改名，不修改每个 Python 工具和模板。

已发布 manifest 是回调的依据。回调 JSON 由确定性代码生成，不让 Codex 直接 POST 回调或自由指定最终文件路径。

## 6. 服务与工具库之间的文件协议

### 6.1 内部任务描述

内部协议与上游 schemaVersion 各自版本化。建议在 toolkit 的 pipeline references 中新增内部 JSON Schema，由 Python/Node 双方按同一文件验证；TypeScript 类型在构建时生成，避免维护两份不一致定义。

以下为内部任务的精简结构提案，不是完整 Schema：

```jsonc
{
  "schemaVersion": 2,
  "jobId": "run_render_001",
  "taskId": "task_001",
  "mode": "auto",
  "operation": "render", // analysis / render；旧 v1 走原完整制作路径
  "planVersion": 2,
  "input": {
    "script": "input/script.txt",
    "confirmedPlan": "input/confirmed-plan.json",
    "assetManifest": "input/assets.json"
  },
  "template": {
    "id": "ifeng-scenes-v1",
    "version": "template-snapshot-001",
    "path": "input/template"
  },
  "renderSelection": {
    "sceneIds": ["scene_003"],
    "reuseManifest": "input/reuse-manifest.json"
  },
  "output": { "width": 1080, "height": 1920, "fps": 30, "requireAudio": true },
  "limits": { "timeoutSec": 14400, "repairRounds": 10 }
}
```

确认快照、模板准入、复用镜头来源由服务端生成；用户无法用上传同名文件覆盖控制配置。配音配置、素材哈希、剩余预算等在完整契约中明确提供。

### 6.2 候选响应

```jsonc
{
  "jobId": "run_render_001",
  "status": "candidate",
  "operation": "render",
  "artifact": "output/render-manifest.json",
  "error": null
}
```

render-manifest 按分镜记录 MP4 相对路径、实际时间轴、素材、字幕/音频证据。analysis 对应 `output/analysis-plan.json`。这里不含最终对外文件路径、数据库状态或回调状态。

服务校验全部路径必须位于允许的产物范围，候选 ID 必须与可信 run/scene 列表相符。复用镜头由服务端可信复用清单合并，模型不能把别的任务文件标为可复用。

### 6.3 工作区与容器路径

宿主的正式任务数据放在代码仓库外，例如 `/srv/video-worker/data/<tenant-key>/<task-key>/`，内部主键由服务生成。每次重试也使用独立 attempt 工作目录，避免旧执行进程写入新一轮输入。

```text
任务持久化目录/
  inputs/                             素材快照
  plans/v1.json、v2.json               不可变方案
  sessions/                           会话快照
  runs/run_render_001/attempt_1/        本轮独立工作区
  results/r1/manifest.json             完整结果索引
```

容器中提供固定工具库根和工作目录。为了兼容现有相对路径，可以让 `/workspace/toolkit` 是该任务独占的镜像工作副本，任务挂载到其 `jobs/current/`；只包含当前任务，不含其他 jobs。工具原件/Skill/模板源保持只读，当前 `project/`、缓存、输出路径可写。镜像依赖预装，运行时不从开发者的 node_modules 跨路径借用。

为保留旧模板相对 import，模板准入阶段必须实际构建验证；相对位置不兼容的模板打包成自包含工件或做一次路径适配，不能假设复制到任意目录就能运行。

保存/恢复 Codex 本地状态以及配置的内部路径，按 thread ID 显式恢复。会话只是辅助，confirmed-plan 与产物快照才是继续制作依据。跨容器恢复需通过实测验收。

### 6.4 本地文件与共享盘的接入

媒体接口中的 `url` 保留名称，当前值为本机绝对路径，后续为共享盘挂载路径。`workspace.ts` 负责将调用方路径映射为宿主可读取路径，校验根目录和任务授权后复制输入快照；`storage.ts` 负责发布结果并映射为下游可读取的绝对路径。容器内路径不直接对外返回。

建议在 `config.ts` 中集中配置媒体根目录 `MEDIA_ROOT` 和调用方所见根目录映射。内部以相对文件标识、素材 ID 和摘要引用数据；执行数据根目录另行配置，保存会话、计划和运行工作区，不向下游暴露。服务部署在 Ubuntu，当前统一配置 `MEDIA_ROOT=/home/ops/jiangzb/videos`，后续换成共享盘挂载目录；调用方挂载点不同时配置双向映射。只修改路径配置和部署挂载，无需改接口字段或制作逻辑。迁移时保留旧映射直到在途回调完成，已持久化事件不改写。

路径解析须拒绝根目录外路径、符号链接逃逸和其他任务文件。只把当前任务的授权快照挂进沙箱，不把全部本机媒体目录或共享盘挂进容器。输入与旧结果只读，当前工作区可写。

结果由可信 Worker 复制到目标持久化目录的临时文件，校验后在同一目标文件系统内重命名并生成版本化 manifest，再提交数据库结果与 outbox。共享盘上线时验证重命名及读取一致性。文件保留期、权限和备份仍由服务管理；当前无需对象存储或远程媒体 URL。平台后端负责读取路径并提供浏览器预览。

## 7. 现有 toolkit 具体修改清单

### 7.1 pipeline 增加分支，保留旧用法

修改维护源 `.claude/skills/video-pipeline/SKILL.md`：

```text
v1 auto 或旧入口
  → 保持原有完整规划、制作、单 MP4 交付

v2 operation=analysis
  → 输入检查 → 素材理解 → 分镜方案 → 分析校验 → 结束

v2 operation=render
  → 读取确认方案 → 配音/实际时间轴 → 工程 → 画面检查
  → 渲染指定分镜 → 集合校验 → 结束
```

不新增另一个抢占流程的总入口。渲染分支明确跳过自由重新规划；人工确认是两次业务请求的间隔，不是 Skill 中的一次交互暂停。

对应 references 增加分析/渲染契约和 v2 candidate Schema，更新 task-contract、worker-contract 和 technical-routing；旧 response Schema 保留给旧调用。

`.agents/skills/video-pipeline/` 是生成副本，不作为单独维护源。通过现有 `scripts/migrate_to_codex.py` 同步。构建前比较源与生成结果；不能只改生成副本，因为下次迁移会覆盖。

### 7.2 校验代码拆出公共部分

现有 `validate_delivery.py` 在 `validate()` 中检查 `schemaVersion == 1`，并写死 `output/video.mp4`，不能仅在外面循环几个文件就声称已支持分镜。

建议在同一个 pipeline `scripts/` 下形成：

```text
validation_common.py      从现有脚本提取路径、哈希、ffprobe、完整解码等函数
validate_delivery.py      保持旧 v1 CLI 和结果兼容
validate_analysis.py      新增：分析结果 Schema、稿件/分镜和素材引用
validate_segments.py      新增：每镜媒体验证、顺序/ID/方案绑定、复用镜头一致性
```

视频校验仍留在 Python 工具库里。服务的 `validation.ts` 只是启动可信校验进程、收集报告、处理错误，不再实现另一套媒体检查。

校验在 Agent 不可修改的可信镜像/环境执行。输出快照先停止写入；不能把模型工作区里的校验脚本作为唯一验收方。

### 7.3 增加一个正式分镜模板

建议新增 `templates/ifeng-scenes/`，首版只准入这个模板。模板名为提案，不是当前已有资源。

```text
templates/ifeng-scenes/
  package.json、package-lock.json
  src/index.ts
  src/Root.tsx                   按场景清单注册本任务需要的分镜 composition
  src/Scene.tsx                  单镜完整画面、音频、动画、字幕
  src/components/                从已有组件中抽取的必要展示能力
  config.schema.json             固定输入格式
  README.md                      画幅、音色、时间与素材规则
```

可复用 `lib/components/` 与需要的财经效果，但不复制整个 `examples/hello-world/src/Root.tsx`。该文件同时注册多个历史视频与片头组合；其 package.json 默认 render 仍指向 `SprintReview`。直接运行 `npm run render` 可能渲染错视频，缺少旧音轨还会影响构建。

当前 DeepSeek `prepare.py` 已通过选取文件、重建 Root.tsx 避开旧项目依赖。这一思路应推广为模板打包/准入逻辑，而不是在生产任务里继续硬编码 DeepSeek 稿件、旧财经素材和 composition 名称。

一镜一个 composition，使用本镜从 0 开始的时间轴，输出 `output/scenes/<safe-scene-id>.mp4`。不要先生成整片再盲切，因为字幕、转场、音频边界会跨镜。第一版按确认的 N 镜完整合成，内部顺序渲染即可。

增加 `tools/render_segments.py` 作为确定性渲染命令适配器：读取受信的工程/分镜清单，用参数数组调用预装 Remotion CLI，记录退出码和日志。不执行用户上传的任意 shell 字符串。Codex 负责工程制作与修复，重试/超时总预算由 Worker 控制。

### 7.4 配音与字幕复用需要适配的点

- `voiceover.py`、`doubao_tts.py` 保留原 provider 实现，首版固定一种已配置配音渠道。
- `generate_dialogue_audio.py` 当前按 `id-role.mp3` 是否存在和文件大小判断复用；同 ID 改稿会存在复用旧音频的风险。需要增加文本/音色/参数内容摘要，或由新适配器用内容摘要隔离路径，不能直接把“文件存在”当缓存命中。
- 该脚本固定按 30fps 生成帧，且当前角色只支持 female/male。目标帧率不同需从秒值重新计算；若开放更多角色必须改配置映射。
- `align_captions.py` 专用于 `sprint-config.ts` 的 cap() 结构并依赖 Scribe，不能不加转换直接应用到新模板。首版选择每句独立音频对应句级字幕；确需逐字字幕再接入经验证的对齐适配。
- 不复制开发目录 `.env` 到镜像；工具从容器注入的任务级配置/代理读取凭据。固定配置和外部调用账本由服务控制。

## 8. huibo-saas 与 xiling-http 如何处理

`huibo-saas/server.cjs` 的 `Service` 使用本机 `.data/state.json` 和进程内 `busy` 串行提交；它约束的是一镜供应商请求，不是整条视频 pipeline 的全局并发。

因此不往这个 server 里加入四个凤凰接口，也不把它的 state.json 变成视频任务主库。新 Worker 的 `avatar-client.ts` 在需要数字人镜头时调用它的估价、生成和查询接口，把供应商 jobId 记录到自己的 run 中。

供应商并发和全局 4 个任务是两个不同限制；一镜串行不会改变我方任务库的槽位规则。正在等待数字人结果的任务首版继续持有槽位，避免把模型、渲染和外部任务拆成复杂的二次队列。

已有 README 明确一镜适配器尚未通过真实账号视频生成联调，且依赖带登录态的专用浏览器。因此不能默认它已经是可在无头 Linux 容器上线的数字人服务。首版可用预生成数字人素材，或将该服务独立部署并先完成可用性验收。

`xiling-http/数字人口播.py` 是调用脚本，不作为 Worker 入口。后续如果选择曦灵，将其协议能力封装成另一个 avatar provider，保留统一的生成/查询/结果契约即可。

## 9. 队列、状态和错误落在哪一层

| 规则 | 落点 |
| --- | --- |
| taskId 归属、requestId 去重 | routes/鉴权 + tasks.ts + 数据库唯一约束 |
| 同 task 只允许一个活动 run | task-repository 事务/约束，覆盖 queued/running/cancelling |
| 全局 4 并发 | queue.ts + execution_slots 数据表 |
| 领取和续租令牌 | queue.ts；所有结果写入检查 fencingToken |
| 超时/取消/失联 | execute-run.ts + sandbox.ts，停止全部子进程后释放槽位 |
| 人工确认版本 | tasks.ts + 不可变 plan_versions |
| 单镜复用 | scene.ts + 已发布 scene_artifacts 的制作摘要 |
| Codex 启动/恢复 | runner/codex.ts；显式 threadId，持久化会话状态 |
| 视频成败 | 可信 Python 校验 + application/results.ts |
| 最终文件地址 | storage.ts，映射本地/共享盘路径，按任务授权且不可变 |
| 回调丢失/重复/乱序 | outbox + callbacks.ts；平台按 eventId/版本去重 |

日志统一附带 taskId/runId/attempt/sceneId，密钥不写日志，敏感文件路径按需脱敏。模型事件只是制作进度，不能直接驱动业务状态为 succeeded。

## 10. 部署与版本边界

源码上在同一仓库内新增 `video-worker/` 服务包；发布上区分 control 和 runner 两个镜像。control 含 API/数据库/调度/存储，runner 含 SDK、toolkit、Python/Node 媒体依赖和已准入模板。可信校验可从固定 runner 镜像以独立校验模式启动，不执行 Agent。

构建 runner 时只复制允许的 toolkit 子树和已准入模板，排除 `.git`、`.env`、projects/jobs、旧输出、浏览器登录目录、大体积示例素材与不使用的 GPU 模型代码。发布 manifest 固定 toolkit 快照、模板版本、SDK/runtime 版本、协议版本及镜像 digest。

项目 Git 根为 `/Users/jiang/Documents/VideoCutEditor`，沿用原 toolkit 的提交历史；toolkit 文件位于 `claude-code-video-toolkit/` 子目录，子目录没有独立 `.git`；origin 为 `https://ifengdev.com/ifeng/VideoCutEditor`，upstream 仍为原开源 toolkit。原外层没有提交、没有远程的空 Git 已备份到项目外，不作为项目仓库。

后续从 VideoCutEditor 根提交，claude-code-video-toolkit、同级 video-worker/适配器以及 docs 均处于同一个远程仓库范围。生产镜像通过同一次项目提交及文件摘要固定工具与服务版本；不再要求两个仓库分别发布。当前未提交改动保留；目录移动以 Git 重命名记录，本次没有 commit/push。

部署数据存储独立于源码目录。开发 Compose 仅挂专用任务数据；生产输入、计划、音频缓存、输出、会话状态有备份和保留期。服务重启恢复不依赖开发机器目录或某个 npm 进程仍在运行。

## 11. 分批开发顺序与每批验收

### 第一批：新服务骨架，先证明链路

新增 video-worker、迁移表、接收接口、mapper、队列、4 槽位、outbox 和模拟 runner。模拟回调只发本地测试接收器，不触碰真实上下游。

验收：6 个不同 task 只有 4 个活动；分析完成释放槽位；确认请求创建新 run；重复提交不重复入队；回调中同一 task/version 的映射稳定。

### 第二批：接上真实沙箱与分析

实现 workspace/sandbox/runner，扩展 pipeline analysis 契约和校验，将真实素材理解结果返回本地工作台联调环境。

验收：task.json → Codex → analysis-plan → mapper → 回调全程可追踪；无渲染发生；容器结束后方案仍可确认。

### 第三批：接上现有制作能力和分镜输出

新增正式 ifeng-scenes 模板，复用配音/媒体工具，增加 render 分支、render_segments、validate_segments、存储发布。

验收：确认 5 镜得到恰好 5 个完整 MP4；每镜声音、动画、字幕已合成；平台后端能读取回调中的本地文件路径并提供预览；共享盘部署验证挂载点映射。历史单 MP4 pipeline 测试仍通过。

### 第四批：恢复、单镜重做和生产对接

完善摘要缓存、会话/工作区恢复、取消、超时、旧结果拒收、回调重试和媒体访问权限，再连接真实上下游地址。

验收：只改第 3 镜能复用其余镜头；杀掉 Worker 后恢复不突破 4 并发；旧 Worker 不能发布；回调故障不重新付费制作。

每批只扩展上述明确边界，不为了接 Worker 同时迁移所有历史模板、示例工程和供应商。已有大量代码的价值集中在制作执行层，本次新增代码集中在任务服务层，两者靠文件契约与固定运行镜像接合。

## 首版实现记录

- 已实现两个提交接口、查询/取消、回调重发、PostgreSQL 任务/版本/4 槽位/outbox、容器执行与可信校验，以及本地文件发布。
- 模板为 ifeng-scenes，TTS 固定豆包，任务恢复使用固化素材与独立会话；同任务素材回调指向持久化内容快照。
- 包管理使用固定版本 pnpm 和 pnpm-lock.yaml，替代结构提案中的 package-lock.json；内部类型从 task-v2.schema.json 生成。
- 实际数据库测试、媒体回归和 Ubuntu Docker 验收命令在 Worker README。未把本地模拟 Agent 测试当成真实模型/供应商/编辑平台的线上联调。
