# Worker 代码架构与现有项目接入方案

本文件对应当前混合部署实现：Docker 管数据库、任务 API 和回调，Ubuntu 本机 Worker 管制作、隔离与 Codex ChatGPT 会话。接口字段和业务调用顺序见 [上下游对接方案](AI视频剪辑上下游对接方案.md)，可执行部署步骤见 [Ubuntu 部署与联调手册](Ubuntu部署与联调手册.md)。

## 1. 仓库边界

Git 根目录是 VideoCutEditor，以下同级目录一起提交和发布；不把 Worker 嵌进 toolkit，也不移动原视频组件。

```text
VideoCutEditor/
├── .env                              全项目唯一实际配置
├── docker-compose.yml                PostgreSQL / API / callbacks / migrate / callback-mock
├── claude-code-video-toolkit/         制作能力主体
│   ├── .claude/skills/                Skill 维护源
│   ├── .agents/skills/                同步生成的 Codex Skills
│   ├── tools/                        Python 配音、探测、渲染工具
│   ├── lib/                          原有组件、主题、转场
│   ├── templates/ifeng-scenes/        当前准入的分镜模板
│   ├── examples/hello-world/          原有视频代码保留
│   └── test-cases/                    原本地单任务准备脚本保留
├── video-worker/                      新链路的控制与执行服务
├── huibo-saas/                        原数字人 HTTP 适配器
├── xiling-http/                       原数字人口播脚本
└── docs/
```

工具库保持原来的制作职责。新增接口、队列、认证、版本、发布和回调集中在 video-worker，原本地脚本不会直接变成线上接口。

## 2. 模块和调用关系

```text
video-worker/
├── src/
│   ├── entrypoints/
│   │   ├── api.ts                    Docker HTTP 服务
│   │   ├── callbacks.ts              Docker 回调发送器
│   │   ├── migrate.ts                Docker 一次性建表/迁移
│   │   ├── worker.ts                 Ubuntu 单实例调度循环
│   │   ├── host-check.ts             部署检查，不发起制作/收费配音
│   │   └── runner.ts                 保留的旧 Docker Runner 入口
│   ├── application/
│   │   ├── tasks.ts                  分析/确认提交
│   │   ├── execute-run.ts            准备→配音→Codex→校验→发布
│   │   └── results.ts                版本结果、完整分镜清单和 outbox
│   ├── infrastructure/
│   │   ├── task-repository.ts        幂等、任务状态和方案版本
│   │   ├── queue.ts                  四槽位、租约、执行令牌、恢复
│   │   ├── workspace.ts              输入快照与本次独立目录
│   │   ├── runtime-paths.ts          本机/旧容器路径适配
│   │   ├── audio.ts                  可信配音、缓存与外部调用账本
│   │   ├── app-server.ts             单进程 JSON-RPC、认证、事件分发
│   │   ├── host-sandbox.ts           本机执行器总入口
│   │   ├── host-processes.ts         Bubblewrap + systemd 任务进程
│   │   ├── sandbox.ts                旧 DockerSandbox，保留回归用途
│   │   ├── validation.ts             可信结果校验
│   │   ├── storage.ts                文件路径授权与不可变发布
│   │   └── callback-outbox.ts        回调签名、投递和重试
│   ├── runner/
│   │   ├── codex-host.ts             thread/turn 路由与受控制作工具
│   │   ├── codex.ts                  旧 SDK 容器适配器
│   │   └── prompts.ts                阶段指令，路径由 Worker 提供
│   └── config.ts                     根目录 .env 和运行时配置
├── deploy/
│   ├── install-host.sh               Ubuntu 依赖、用户服务、检查和启动
│   ├── start-worker.sh               共享 flock，启动 Worker 或 host-check
│   ├── Dockerfile.control            API/回调/迁移镜像，无 Docker CLI
│   ├── Dockerfile.runner             旧执行器回归镜像，当前 Compose 不构建
│   └── runtime-manifest.json         制作源码和依赖版本摘要
├── scripts/install-browser.mjs       安装准入模板使用的浏览器
└── tests/                            队列、版本、回调、路由、隔离与媒体回归
```

完整执行路径：

```text
编辑平台 → Docker API → PostgreSQL 排队
                              ↓
Ubuntu Worker 领取租约 → 素材快照 → 必要配音 → Codex app-server
                                                ↓
                              video_exec / video_view_image
                                                ↓
                            当前任务的 Bubblewrap + systemd 服务
                                                ↓
                               可信校验 → 发布文件 → 数据库结果 + outbox
                                                                    ↓
                                                         Docker callbacks → 编辑平台
```

## 3. 分析和渲染边界

分析提交包含稿件、需求和素材。Worker 固化素材后，Codex 实际探测与看图、形成分镜方案，可信校验通过后调用分析回调。此阶段不生成正式成片，等待编辑期间释放执行名额。

编辑确认传入同 taskId、basePlanVersion 和完整分镜列表。Worker 检查版本与素材归属，准备逐镜配音，再按确认内容渲染。Codex 不自行修改已确认口播、替换素材或再次拆镜。

每条分镜输出已包含画面、声音、动画和字幕的 MP4。确认 5 镜就返回 5 项，第 0 项是第一镜，不插入整体视频项。修改第 3 镜时按输入摘要重做受影响内容，回调仍返回完整有序的 5 镜清单，旧结果在新结果成功前保持可用。

原 huibo-saas、xiling-http 暂不纳入无人值守主链路；数字人使用与口播匹配的预生成素材。不能把原适配器当作已经通过 Ubuntu 真实账号联调的服务。

## 4. 任务和会话如何对应

| 标识 | 来源和作用 |
| --- | --- |
| taskId | 上游业务任务 ID，后续编辑指令继续使用 |
| tasks.id | 内部 UUID，用于目录与数据归属 |
| requestId | 单次提交幂等，同 ID 不同内容拒绝 |
| runId | 一次分析或渲染执行 |
| threadId | app-server 返回的会话 ID，保存到 tasks 表 |
| turnId | 本次指令 ID，与 run/attempt/令牌一起保存到 host_executions |
| fencingToken | 执行接管时递增，防止旧执行提交结果 |

上游不用传 Codex threadId。会话路由只读取数据库的可信映射，不读取模型写入的 session.json 来选择任务。恢复已有任务时使用 thread/resume；无法恢复则显式失败，保留输入和业务记录，不假装旧会话恢复成功。

一个常驻 app-server 复用 Ubuntu 用户的 ChatGPT 登录，负责认证刷新和会话文件；不为四任务复制 auth.json，不把 CODEX_HOME 挂进沙箱。当前锁定 Codex 0.154.0，实验协议在部署时验证，升级版本必须重新验收工具和权限行为。[官方协议](https://learn.chatgpt.com/docs/app-server)

## 5. 队列、取消和崩溃恢复

PostgreSQL 存四个 execution_slots，事务锁控制领取。同任务同一时刻最多一个活跃 run，全局最多四个；第五个请求正常入队等待。排队包含 analysis/render 执行，等待编辑和回调不占位。

本机同一任务同一时刻只接受一条制作命令，每条命令由独立 systemd transient service 管理全部后代进程。默认 CPUQuota=200%、MemoryMax=4G、TasksMax=256，每条命令最多 30 分钟；run 总期限仍是 4 小时，最多 3 次恢复尝试、10 轮修复，重启不清空计数。

取消流程：阻止后续工具调用 → turn/interrupt → 等待 turn/completed → 停止任务 systemd 服务并确认无活动进程 → 更新数据库和释放槽位。确认失败保留占位，不能仅凭租约过期就启动替代任务。

app-server 崩溃时停止领新任务，终止当前工具执行并由 systemd 重启 Worker。新 Worker 必须持有同一个本机 flock，先停止遗留的 videocut-job 服务，再按数据库租约接管或失败处理。单个共享 app-server 的崩溃可能影响四个执行，恢复流程必须覆盖该情况。

## 6. 本机沙箱与文件权限

当前 Ubuntu 任务工作区为：

```text
DATA_ROOT/<内部任务 UUID>/runs/<run UUID>/attempt_<N>/
  task.json     可信描述，只读
  input/        稿件、素材、确认方案、配音，只读
  project/      可写工程
  output/       可写候选与证据
  cache/        可写本次缓存
```

Bubblewrap 只挂当前任务和明确准入的工具、Skills、模板、Python/Node 依赖；不挂共享媒体根、其他任务目录、业务 .env、登录缓存或 Docker socket。使用私有 PID、文件系统和网络命名空间，隐藏宿主进程与控制接口；命令环境不继承数据库、回调或模型凭据。

模型内置命令/浏览器/插件等入口关闭，制作和看图通过 Worker 的两种工具路由。Codex 自身使用明确的任务权限 profile；该版本不支持的 readOnlyAccess 示例不会被当作已经生效的隔离配置。

可信配音步骤可以写 input/audio，只有固定的 worker_tts.py 获得必要 TTS 凭据和外网。Agent 制作命令无外网，但可以在自己的网络命名空间内启动 Remotion 本地服务。校验步骤无网络、只读工作区。systemd 负责 CPU/内存/进程上限及全部后代清理，不依赖 shell 后台 PID 的自报信息。

模型生成的 passed 不代表成功。停止写入后，可信验证器检查协议、稿件覆盖、分镜顺序、源素材、全量解码、帧数、音轨和画面证据。审核全部通过才发布。

## 7. 结果与上下游数据

MEDIA_ROOT 默认为 `/home/ops/jiangzb/videos`；请求/回调 url 是服务器绝对文件路径，后续换共享盘只改根目录和调用方路径映射。输入路径经过授权前缀和 realpath 校验后固化，返回的素材路径指向本任务持久化快照。

发布结果写入 `tasks/<内部任务 UUID>/results/<runId>-<token>/<sceneId>.mp4`，临时复制和校验后重命名为不可变结果。数据库在同一事务中保存版本结果、成功状态和 outbox。

callbacks 单独读取 outbox，失败只重发通知、不重新制作、不占槽位。接收端同时返回 HTTP 2xx 与 status=0 才视为投递成功，按 eventId 去重、按版本拒绝旧结果覆盖。HMAC 签名格式见 Worker README。

## 8. 部署和验证边界

Compose 保留 postgres、migrate、api、callbacks、callback-mock，取消 worker/runner-image 与 Docker socket。容器内通过 postgres:5432 访问数据库，本机 Worker 通过 127.0.0.1:15432 访问同一数据库；无需新增 Worker HTTP 服务。

install-host.sh 用当前登录用户安装依赖并生成用户 systemd 服务，启用 linger 保证 SSH 退出后持续运行。主配置仍是一份根目录 .env。host-runtime.json 仅记录安装时解析出的浏览器路径，属于忽略的机器运行数据，不是第二份业务配置。

默认测试使用 PostgreSQL/PGlite、模拟 app-server 验证四并发路由、令牌和取消；媒体测试使用模拟 Agent 和合成音频，实际渲染五镜、修改第三镜、返回完整五项。部署检查验证真实 Ubuntu 沙箱、浏览器、登录与协议，不消耗模型/TTS 调用。

真实素材理解、四个真实模型 turn 并发、账号限流与刷新、Ubuntu 进程清理、豆包与编辑平台回调仍需在部署服务器端到端验收。不要把本地模拟测试当作已完成这些外部环境验证。
