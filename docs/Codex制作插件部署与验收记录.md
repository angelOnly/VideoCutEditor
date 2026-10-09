# Codex 制作插件部署与验收记录

## 本轮范围

将当前制作能力部署为 `videocut-production 1.0.1`（首轮为 1.0.0），保持既有制作要求、音频同步、片尾流程及定制化模板不变。暂不接入新的导演、美术动效 Skill。代码回退基线为 `render-narration-baseline-20261009`（`c3bb796`）。

## 实际调用链

网页创建数据解读任务 → Worker 准备输入及冻结模板 → Codex app-server 查询插件 Skills → 校验插件身份、实际安装路径和发布摘要 → `turn/start` 明确传入插件 `video-pipeline` Skill → analysis 返回文本分镜 → 网页确认 → 同任务 render 使用同一插件和冻结模板 → 原有脚本配音、渲染、审片、合片和交付 → 网页显示成片。

每个阶段在 `output/<runId>/plugin-runtime.json` 记录实际插件名称、版本、摘要和安装位置。该文件是运行来源证据，不以模型自述代替加载检查。

## 文件与目录

- `claude-code-video-toolkit/.codex-plugin/plugin.json`：插件身份及 Skill 目录。
- `video-worker/scripts/package-plugin.mjs`：从唯一源码生成发布包，只包含三个既有 Skill、参考文件及十三个制作脚本。保持内部相对目录，不复制模板、历史任务、凭据或 node_modules。
- `video-worker/deploy/install-plugin.mjs`：部署时安装内部目录源及插件，校验安装副本后写入本机配置。
- `video-worker/config/plugin-release.json`：随代码发布的预期插件摘要。
- `video-worker/config/installed-plugin.json`：安装器生成的本机绝对路径，不提交 Git；可通过 VIDEO_PLUGIN_ROOT 显式覆盖。
- `video-worker/src/infrastructure/production-plugin.ts`：发布完整性和实际 Skill 加载检查。
- `config.ts`、`app-server.ts`、`host-processes.ts`、`native-preflight.ts`、`codex-host.ts`：独立传递制作插件、渲染依赖和模板来源，调整只读权限并明确调用插件 Skill。
- `scripts/local-render.ts`：独立制作入口增加必填 `--plugin`，执行相同的插件检查。
- `scripts/runtime-manifest.mjs`：将插件文件和 FFmpeg Skill 纳入发布记录。

服务器注入的 `TOOLKIT_ROOT` 现在指向插件安装副本；`REMOTION_MODULES_ROOT` 指向现有 Remotion 依赖。Worker 配置中的 toolkitRoot 继续用于本地模板备用来源，不再交给制作代理读取仓库。网页定制模板仍从接口下载到每个任务的冻结目录。

## 部署步骤

使用 Worker 的服务用户和 Python 环境执行。先确认无活动制作任务，再停止 Worker，备份现有代码提交、环境配置和 Codex 插件配置。不要中途更换正在运行任务的插件。

1. 推送并拉取已验证代码，保持原有依赖版本。
2. 在 `video-worker` 目录运行 `node scripts/runtime-manifest.mjs`、`pnpm build`。
3. 运行 `node deploy/install-plugin.mjs <全新的发布目录>`。安装器采用当前用户、当前 Worker Codex 二进制及 CODEX_HOME；通过官方 CLI 注册内部目录源并安装。发布目录已存在时必须与当前摘要一致，不能覆盖旧发布文件。
4. 安装器校验 Codex 返回的实际安装位置，写入本机 installed-plugin.json。
5. 执行 `deploy/start-worker.sh host-check`，验证插件发现、数据库、登录、原生权限和媒体运行依赖。
6. 重建 API、回调服务，使控制服务与 Worker 使用相同 runtimeVersion；启动 Worker。
7. 在正常网页创建新的测试任务，不通过直接插入数据库或后台接口伪造网页提交。

首次完整服务器安装时，`deploy/install-host.sh` 在构建后调用插件安装器。

## 测试标准与本轮记录

- 本地类型检查通过。
- 本地 Worker 回归：37 项通过，1 项仅 Linux 隔离测试在 macOS 跳过。
- 新增测试覆盖：插件未启用、错误插件身份、旧源码路径、缺失插件配置、版本不符、文件篡改，以及任务使用明确的插件 Skill 输入。
- 服务器已通过 CLI 安装，app-server 实际发现三个带 `videocut-production@videocut-internal` 身份的 Skill。
- 服务器 host-check 通过：插件发现、数据库、登录、原生命令、只读输入、跨任务隔离及媒体依赖。
- Linux 隔离集成测试 1 项通过，验证取消能回收脱离子进程且不影响另一个任务。
- 使用安装副本中的 render_scene.cjs，在实际任务权限下生成 60 帧、2 秒的带声短片：H.264/AAC、640×360、30fps。
- 三个 Skill 的格式检查全部通过。
- 网页 analysis 已完成，返回 18 条分镜；拼接文本与原稿逐字一致（忽略原稿段落换行）。首轮 render 因系统 Python 缺少 dotenv 停止，修复明确的解释器入口后重新验收。

网页测试使用先前同一黄仁勋稿件及同一财经定制化模板，保持模型、音色和输出规格。核对原文、分镜顺序、口播同步、栏目元素、固定结束语后的完整片尾、媒体格式与网页交付。重新生成不能要求逐帧一致；本轮验证插件化未破坏既有能力，不把艺术质量提高作为迁移成功的证明。

### 本次网页任务

- 标题：黄仁勋与AI落地｜Codex插件部署验收｜20261009。
- 平台任务 ID：`6530602366a047ccb7a2a92d0f97665c`。
- Worker 任务 ID：`6cd604f9-4b0b-489f-83b7-3bc6479bf7ef`。
- analysis：`1232fb03-3cd7-45ac-83b8-9d8ff461d70a`，北京时间 10:15:50 开始、10:18:28 完成。
- render：`08558ff3-64da-4804-8733-a402153ac56a`，北京时间 10:19:29 开始。
- 插件摘要：`811cae01e39f7367652c6af44405356641506842eba6936caa913104eda894b9`。
- 模板 ID 为 5，包摘要 `2c4815f0ff71190ff62be2c2fd794a7af8f163aa4cdc77a50a9c80fc5fe13173`，与上一版测试一致。
- 实际安装路径：`/home/ops/.codex/plugins/cache/videocut-internal/videocut-production/1.0.0`。
- 本地测试证据：`artifacts/deployment-validation/2026-10-09/plugin/`。

### 首轮发现与修复

首轮 render 显式调用 `/usr/bin/python3`，未使用已经安装依赖的虚拟环境。供应商音频已成功结束并保存到 audio.partial.mp3，但客户端随后导入 voiceover 中的 dotenv 失败，缓存保守保留 pending，重试被判为 EXTERNAL_RESULT_UNKNOWN。

本轮修复限于部署环境适配：Worker 注入 VIDEOCUT_PYTHON，提示和插件命令示例统一使用该解释器；启动检查补充导入 dotenv 和 requests。插件版本递增到 1.0.1，配音、动画、片尾算法不变。修复相关 9 项回归通过。

已核对客户端写盘位置仅在供应商成功结束后执行，并完整解码该音频。原 pending 记录保存为 request.before-recovery.json；将已有 2.832 秒音频恢复为完成缓存，摘要 b267eaea66cfcfc90fa179f5c3fda0b3c938b7c0e230c3335fad9de9f9b1c3e7，未重发该请求。

## 失败处理与回退

插件未安装、未启用、缺少 Skill、文件摘要不符时明确报告部署错误，不回退到仓库 Skill。先修复安装或配置，再测试；不让模型修复共享插件。

回退时停止 Worker，恢复 tag 对应代码及原部署配置，撤销本轮插件启用，重建并恢复控制服务和 Worker。模板包不变，测试数据和成片保留以便比较。tag 只保存代码，不能替代服务器配置及模板包备份。

## 已知代价

插件仍依赖服务器已有 Python、Node、FFmpeg、浏览器与固定 Remotion 版本；不宣称只安装插件就能在任意新机器上直接渲染。升级制作能力需发布插件并同步 Worker 的预期摘要，本轮不引入自动热更新。两阶段测试期间固定同一版本。
