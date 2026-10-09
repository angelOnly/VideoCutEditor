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
   更新版本时，只切换 `videocut-internal` 市场的目录来源，保留旧发布目录。注册新来源失败则恢复旧来源；重复安装同一版本可安全重跑。本轮已实测 1.0.0 → 1.0.1 切换及重复安装。
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

### 1.0.1 完整复测

服务器代码更新至 `f2bf4ce`，重新安装插件、通过 host-check、重建 API/回调服务并启动 Worker。健康接口返回 `status: 0`，服务启动后无重启。

网页的“重新拆条”按钮只做页面内拆分，并未触发 Worker analysis，所以没有把该操作当成分析通过。已从网页“数据解读”重新创建任务，仍选择同一财经定制化模板、同一原稿；首轮失败任务保留。

- 标题：黄仁勋与AI落地｜插件1.0.1两阶段验收｜20261009。
- 平台任务 ID：`187cd99735de4040ac134563e331c8d0`。
- Worker 任务 ID：`a5981280-d939-40af-b418-04b609819fbb`。
- analysis：`324c38f6-3b6a-48dc-b624-cdaf478a5547`。
- 插件摘要：`807727096074b7a48f0786a06488e3b77f5796689168986c454889abfb5bc4b7`。
- 实际安装路径：`/home/ops/.codex/plugins/cache/videocut-internal/videocut-production/1.0.1`。
- 已核验的首段配音缓存复制到复测任务，供相同文本和音色命中复用，避免重复付费请求；未复制其他制作结果。
- analysis 于北京时间 10:37:00 完成，18 条分镜与原稿逐字一致；render `41a8cb0c-7b99-4b71-a43d-c59e350687e8` 于 10:37:53 从网页确认提交。
- 正文 18 条配音完成并生成 audio-manifest.json；本次按完整句子配音，与首轮短分句缓存键不同，没有命中那一条恢复缓存。该缓存仍保留，没有再次提交原有未知请求。
- 18／18 段批量导出，失败数为 0；无静音片段，输出音轨与预期混音的最低相关度为 0.99929。
- 审片记录曾因检查帧超出对应区间而被合片检查拦截，制作进程修订本期记录后继续，不修改共享插件或模板，不重新配音。
- 合成文件：1920×1080、H.264/AAC、30fps，共 4196 帧、139.866667 秒；完整解码无错误。文件摘要 `7d8e122664412c069c64897604c3fbf6cdf9a497b5aa3685bbe7875edff7e67a`。
- render 于北京时间 11:38:04 完成，Worker 两阶段均为 `succeeded`。网页显示“粗片已生成”，保存后任务列表显示“粗片／第 3 步”；保留该状态供查看，没有执行最终确认交付。
- 网页实际加载了本次视频，播放器 `readyState=4`，时长 139.866667 秒，与本地检查一致。
- 服务最终检查：健康接口 `status: 0`，Worker `active`，重启次数 0。
- [本次发布视频](http://10.20.130.251:8080/media/tasks/a5981280-d939-40af-b418-04b609819fbb/results/41a8cb0c-7b99-4b71-a43d-c59e350687e8-74/video-whole.mp4)；本地副本为 `artifacts/deployment-validation/2026-10-09/plugin/video-1.0.1.mp4`。

### 成片效果的独立检查

**插件能执行制作流程，不等于成片效果全部合格。** 本轮使用原有制作要求，没有接入后续导演、美术 Skill，也没有改共享模板包。

检查依据包括实际配音清单、最终时间轴、成片参数、五层模型运动帧、正式片段审片图和结尾相邻帧。没有把模型自述的审片通过当作唯一依据；本轮独立检查未逐句人工试听整片。

1. **正文未被片尾提前覆盖。** 正文声音边界为第 4129 帧（137.633 秒），之后播放 67 帧完整片尾。137.4 秒仍保留正文最后画面和字幕，139.7 秒显示片尾 Logo；视频总长与这两个区间之和一致。
2. **固定结束语漏播，未通过。** 本次正式配音清单只有原稿 18 条，最终 `ending.closingUtteranceIds` 为空，正文之后直接接片尾。模板要求的“每天三分钟，拆解财报里的关键信号。”没有加入本期配音。不能据此宣称“正文 → 固定结束语 → 片尾”全部验收通过。
3. **图形表达仍不足。** 已观察到按顺序出现的文字条目，但五层模型和因果段落仍以文字卡片表达。文字偏多、图形组织不足的问题没有因插件化自动改善；后续导演、美术 Skill 方案仍待开发。

因此，部署与技术链路、模板执行完整性、视觉效果分别记录结论。固定结束语遗漏和图形表达不足属于本次自动制作结果的实际缺陷，保留结果供对比，不用人工补做视频掩盖这两项发现。

## 失败处理与回退

插件未安装、未启用、缺少 Skill、文件摘要不符时明确报告部署错误，不回退到仓库 Skill。先修复安装或配置，再测试；不让模型修复共享插件。

回退时停止 Worker，恢复 tag 对应代码及原部署配置，撤销本轮插件启用，重建并恢复控制服务和 Worker。模板包不变，测试数据和成片保留以便比较。tag 只保存代码，不能替代服务器配置及模板包备份。

## 已知代价

插件仍依赖服务器已有 Python、Node、FFmpeg、浏览器与固定 Remotion 版本；不宣称只安装插件就能在任意新机器上直接渲染。升级制作能力需发布插件并同步 Worker 的预期摘要，本轮不引入自动热更新。两阶段测试期间固定同一版本。

本次 render 用时约 60 分钟，包含代表片段预览、18 段正式渲染、审片和交付校验。现有校验会重复解码音轨、审片帧与整片拼接边界，合片后的校验也有明显耗时；本轮未修改这部分逻辑。
