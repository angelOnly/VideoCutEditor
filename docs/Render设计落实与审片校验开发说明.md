# Render 设计落实与审片校验开发说明

本次完成本地代码开发，插件与财经模板版本均为 1.4.0。未推送、未部署服务器、未提交收费制作任务。页面 Analysis → 确认 → Render 的外部流程保持不变。

## 实际修改

| 位置 | 改动 |
| --- | --- |
| video-worker/src/runner/prompts.ts | 强调设计先说明主体、起态、中途、接点与出口，模板类型和抽帧清单不能代替创作与实际观察 |
| directing-motion-art/SKILL.md | 导演与美术共同把演出写到可以实现的程度；主要过程不足时先补设计；按需找参考 |
| motion-design-production/SKILL.md | 将演出落实为部件、坐标关系、运动属性、路径、遮挡与收势；标签和连线跟随对象锚点；按真实语音确定接点 |
| directing-motion-art/references/local-motion-library.md | 明确需要查参考的情形，保留文字检索→候选图片→必要时视频的按需读取，以及两类案例的不同用法 |
| video-pipeline/SKILL.md、references/production-flow.md、references/motion-design.md | 明确连续自主制作、设计执行索引、试作版本记录及真实审片要求 |
| video-pipeline/references/two-stage.schema.json | 审片项增加 designIds，引用对应设计过程 |
| tools/stage_media.py | 核对设计覆盖全部口播、审片覆盖全部设计、设计与审片的 change/hold 意图一致 |
| tools/render_batch.py | freeze-batch 返回制作输入摘要；render-batch 检查代表段试作记录、文件摘要及当前版本 |
| 财经模板 renderer/src/VisualBlocks.tsx | 未知类型不再回退成引语卡；未实现正文可显示开发提示，但正式渲染报任务工程问题 |
| 财经模板 renderer/src/validateTimeline.ts、timeline.ts、timeline.example.json | 示例只保留接口骨架和未实现正文标记；保留原有模板保护和声音规则 |
| 财经模板说明、renderer/可选基础组件.md | 基础组件菜单移到按需技术说明，不作为正文设计入口；允许设计之后复用合适能力 |
| 插件版本、发布清单、模板 ZIP | 同步到 1.4.0，并生成新的内容摘要 |

以上 Skill 路径均位于 claude-code-video-toolkit/.agents/skills，工具位于 claude-code-video-toolkit/tools，财经模板位于 claude-code-video-toolkit/deliverables/财经双人对话视频生成指令。

## 调用链

1. Worker 把整个任务交给 Render，并启用现有制作、导演和美术 Skill。
2. Render 读取当前任务模板边界与原稿，共同完成章节 brief，必要时按需检索参考。
3. Render 校准实际配音，在任务副本实现演出，在正式时间轴保存 visualDesign 执行索引。
4. 单镜 render 仍可用于试作；Render 实际观察代表段并修改。
5. 当前工程稳定后 freeze-batch 返回 productionSha256，Render 将属于该版本的预览与观察记录保存到请求同目录的 preflight-review.json。
6. render-batch 检查记录与版本，再运行原批次渲染。
7. review 的 narrationChecks 引用 designIds，最终合片及交付检查设计覆盖、口播、画面证据、声音和片尾。

字段示例及执行要求只维护在 production-flow.md，避免多个文档出现不同协议。没有新增代理或程序分轮派单。

## 失败处理与代价

- 未实现正文不能导出，Render 在本期工程中补实现；未知类型不能偷偷变成文字卡。
- 缺试作、试作版本过期、漏查设计或变化/保持不一致，返回 VISUAL_REVIEW_REQUIRED；在任务内补做、修订并继续。原有执行预算、取消及连续无进展保护保留。
- 工程、props 或时间轴变化会使试作摘要失效。这是保守检查，需要复核代表段，但不要求重做未变化的收费配音。
- 旧审片记录没有 visualDesign/designIds 时需补设计对应及实际检查，不能自动伪造迁移。旧任务模板快照不被覆盖，后续新任务需要选择新模板包。
- 程序只检查文件、版本和覆盖关系，不能证明模型确实观察了画面，也不能自动判定美感。真实动效质量仍需新制作任务验证；参考库不强制采用，未预加载全部案例。

## 验证

- 讲解审片：11 项通过，覆盖设计缺失、错误引用、将变化降为保持、漏查与证据不足。
- 批次控制：20 项通过，覆盖缺试作、摘要过期、预览被修改，并回归并发、恢复及取消。
- 两阶段 Python 回归：54 项执行，52 项通过，2 项按原条件跳过。
- 插件、双类型参考库和两阶段模板冻结：6 项通过。
- 模板参数回归与 TypeScript、Worker TypeScript、三个 Skill 结构检查通过。
- 本轮没有真实任务成片，不能据此宣称动画观感已改善。
