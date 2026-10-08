# Render 讲解动效与审片优化开发记录

日期：2026-10-08。范围：本地开发；本轮未部署，也未重新生成线上视频。

## 修改目的

此前网页复测中，Render 已生成本期组件，但主体动作早于对应口播完成，后续讲解长时间没有画面回应。旧审片主要核对首、中、尾画面，未覆盖完整讲解。此次落实用户确认的制作编排、真实配音驱动和讲解对应审片三项改进。

## 实际改在哪里

路径相对仓库根目录：

| 文件 | 实现 |
| --- | --- |
| `video-worker/src/runner/prompts.ts` | Render 入口指向制作、实现、审片闭环；Analysis 与交付格式不变。 |
| `claude-code-video-toolkit/.agents/skills/video-pipeline/SKILL.md` | 明确讲解推进、合理保持及完整口播审片责任。 |
| 同 Skill 的 `references/production-flow.md` | 在现有设计资料记录语义编排；从发言 ID 派生动作时间；定义实际审片、证据、修订流程。 |
| 同 Skill 的 `references/motion-design.md` | 写清各对象分别驱动、局部时间换算及实现示例，避免整张图共用入场进度。 |
| 同 Skill 的 `references/two-stage.schema.json` | review 增加 `timelineSha256`，每镜增加 `narrationChecks`；不增加公共动画协议。 |
| `claude-code-video-toolkit/tools/stage_media.py` | 检查时间轴与成片长度、完整确认口播、发言引用与覆盖、检查区间、动作前中后证据，沿用最终 MP4 重解码核对。 |
| `claude-code-video-toolkit/tools/two_stage.py`、`tools/task_io.py` | 审片缺项或未通过返回 `repair_required/task_project`，不回调成功，也不直接要求人工处理。 |
| 两阶段、审片及 Worker 合成媒体测试文件 | 覆盖完整交付、合理保持、遗漏、失效证据及错误区间。 |

共享模板源码、模板压缩包、网页和 Analysis 未改。本期组件由 Render 在当前任务 project 中生成，模板继续动态下载。

## 主要调用链

Worker Render 提示 → 制作 Skill → 设计资料 → 实测配音及 timeline → 本期组件 → 预览修订 → 批量渲染 → review 与 manifest → `task_io.complete_render` → `stage_media.assemble` / `two_stage.validate` → `stage_media.validate_delivery` → `validate_narration_review` 及真实媒体检查 → 原有交付。

审片读取当前 run 的 `render/<runId>/timeline.json`。timeline 的既有句级边界不变；review 引用发言，记录 change 或 hold、检查区间、实际动作区间、预期与观察、实际查看帧。可以合并同一含义的多句，保持画面无需伪造动作。

检查必须覆盖完整口播，避免只检查已写的动作而遗漏原文；视觉判断仍由 Render 完成。工具不会识别任意 TSX 的语义，也不会根据“静止超过几秒”判失败。

## 失败处理与代价

缺项、未通过、时间轴变化、检查区间和成片证据不符：修订本期工程或补做真实检查后重验。组件改变时重新渲染受影响分镜并更新证据、重新合片；未改的配音可复用。原有执行预算与失败次数限制保留，不引入无限重试。

新运行时的旧审片记录需要补做讲解检查；不自动填入“通过”。这是本次内部交付要求的明确变化，应在旧任务结束后部署，避免运行中更换工具。

成本是更多抽帧、解码检查和必要的局部重渲。摘要与证据只能保证检查针对正确文件；不能证明模型观察准确，也不能保证审美。实际动画质量仍须通过新任务成片验收。

## 验证

本地验证包含讲解审片单元测试、两阶段实际媒体测试、正常 task_io 合片交付和同任务修改、Worker 动态模板冻结及执行器测试、TypeScript 与 Skill 格式校验。两个依赖额外浏览器配置的 Remotion 集成测试不在本次默认运行中执行。

上线后应使用原稿复测动作与口播对应，再换不同内容和模板验证通用性。上述成片验证尚未执行，不能把本地测试通过视为视觉效果已经达标。
