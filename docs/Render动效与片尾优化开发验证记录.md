# Render动效与片尾优化开发验证记录

日期：2026-10-08。依据：[最终方案](Render动效创作与片尾时序优化完整方案.md)。

本次完成本地源码、Skills、回归测试、财经模板1.3.0压缩包与Worker运行时摘要。尚未提交、推送或部署，服务器上的历史任务不会自动改变。

## 1. 现在怎样运行

### 正文动效

Render先理解口播需要解释的关系，查具体参考案例，画出构图和连续状态，再编写本期图解。每个主要视觉段落需要写清对象、位置、图形关系、动作起止状态、口播触发、阅读保持和短长音频适配，不能只填“流程图、层级图”等名称。

先用语义安排动作，配音完成后按真实声音分配具体帧数。短窗口合并动作，长窗口保留读图，不为装饰动画增加等待。真实数据驱动数字和几何，缺少数据时做关系示意，不能编造曲线和数值。

本期组件保存在任务工程，通过已有`visualExtensions`接入。栏目人物、字体、配色、字幕、导航继续复用。没有新增行业图标菜单，没有把本期案例的构图固化成公共组件。扩展组件自行控制入场，模板外层不再叠加一轮淡入和移动。

### 片尾

最终顺序是：

**正文动效与解说完成 → 保持正文最终画面，结束语声音和字幕继续 → 全部口播结束 → 完整片尾视频与原声。**

正文视觉与字幕、音频分开。保持只作用于正文视觉，包括人物、图解、背景和导航；字幕按句切换，配音正常播放。结束语跨分镜时，也能找到前一镜的正文最终状态，单镜导出与整片预览使用同一状态。

片尾先保存到本期工程、标准化并实测。正式时间轴提前计入完整片尾长度，最后一个已确认分镜承载片尾，不增加交付分镜、不修改确认口播。

Remotion先输出完整预计长度，口播后的片尾区间为静态无声占位。共享`render_scene`在封装前用完整本地片尾替换占位，并将片尾原声接入最终PCM混音。交付的末镜MP4已经包含片尾；`assemble`只拼接已完成的分镜，不重复追加。

**直接导出Remotion的占位视频不能当作正式交付。必须经过共享渲染合成工具。**

## 2. 修改文件与职责

以下路径相对仓库根目录。

| 文件或目录 | 实际修改 |
| --- | --- |
| `claude-code-video-toolkit/.agents/skills/video-pipeline/SKILL.md` | 正文创作入口与收尾规则，要求设计、实现、带声音预览和修改 |
| 同Skill的`references/production-flow.md` | 写出完整制作步骤、真实时间轴、保持与追加、标准化命令、冻结和交付流程 |
| `references/motion-design.md` | 新增可执行设计方法，包括构图、状态转换、具体运动、阅读阶段和不同声音窗口适配 |
| `references/motion-reference-cases.md` | 新增Onda、RemotionLab、Jitter、Mixkit的具体案例链接及借鉴和适配方法 |
| `references/technical-routing.md` | 区分引用、关系、数据、文字及本期自定义组件的技术路径 |
| `claude-code-video-toolkit/.agents/skills/remotion-best-practices/` | 增补数据、关系、排印、预览规则；纠正字幕合同、裁切单位和受管环境安装约束 |
| 该Skill的`rules/assets/narrative-motion-examples*.tsx` | 新增可实际渲染的参数化教学示例：数值与几何同步、连接与方向、同一对象连续重排 |
| `claude-code-video-toolkit/tools/actual_timeline.py` | 校验全局收尾记录；补帧时平移后续全局坐标，避免将补帧算成口播或重复加片尾 |
| `tools/finance_timeline.py` | 校验并原样透传收尾字段；只生成模板TS及各镜props，不修改正式时间轴 |
| `tools/stage_media.py` | 复核正式派生参数、素材实际长度与声音窗口；末镜追加、缓存复用、封装和片尾独立校验 |
| `tools/worker_stage.py` | 最终交付复核实际声音、片尾来源和帧数、资源记录及真实成片；支持可信marker记录的自定义工程目录 |
| `tools/render_batch.py` | 将两个时间轴适配工具纳入批次冻结摘要，工具变化使旧批次失效 |
| `deliverables/财经双人对话视频生成指令/renderer/` | 升级1.3.0；视觉、字幕、声音分层；保持正文；删除`scene.outro`；校验新字段；修正扩展重复入场及折线图区域高度 |
| 模板两份Markdown与TS/JSON示例 | 同步本期创作、串行收尾及素材准备规则 |
| `deliverables/财经双人对话视频生成指令.zip` | 已由当前源码重新打包，42个文件，包含1.3.0清单和原有素材 |
| `video-worker/scripts/runtime-manifest.mjs` | 将Remotion技术Skill纳入运行时摘要 |
| `video-worker/config/runtime-version.json`、`deploy/runtime-manifest.json` | 重新生成本地运行时摘要，包含新工具、Skills与ZIP |
| toolkit的`tests/`与`_internal/ROADMAP.md` | 新增及更新行为回归、真实媒体回归和实施记录 |

仓库原有的其他未提交修改保留。本次没有修改网页接口、确认协议或增加新的动画描述语言。

## 3. 主要调用链

1. Analysis保留原有职责，用户确认口播及分镜。
2. Render读取新Skill，设计并实现本期正文图解，取得独立短句的实际音频。
3. 在本期工程保存片尾副本，按输出尺寸、恒定帧率、BT.709有限范围及PCM原声整理，实测完整音画。
4. 保存正式`timeline.json`：`closingUtteranceIds`、正文末帧`holdFrame`、全部口播结束边界`narrationEndFrame`、可选本地`outro`。
5. `derive-timeline` → `finance_timeline.derive_timeline` → 校验并生成TS和每镜props。
6. 模板`FinanceScene` → `BodyVisual`／`HeldBody`，字幕与`SceneAudio`继续独立运行；口播结束后保持无声占位。
7. 冻结批次 → `render_scene` → 复核正式参数与源素材 → Remotion输出 → 末镜`append_scene_outro` → `mux_scene` → `verify_appended_outro`。
8. `worker_stage.check`复核真实交付 → `assemble`拼接，不再次添加片尾。

新行为只由可信冻结模板的`endingPolicy: hold-closing-then-append/v1`启用。旧冻结任务继续使用原合同；需要新行为的任务使用新模板重新创建，不能给旧任务篡改版本号冒充升级。

## 4. 失败时怎样处理

- 片尾变化、声明帧数与实测不符，或props不再对应正式时间轴：返回`TIMELINE_STALE`，重新生成正式记录并冻结，禁止给旧缓存换标签。
- 片尾尺寸、颜色、时间戳或帧率不符合输出规格：返回媒体错误，先整理本地副本，再实测。
- 正文声音越过口播结束边界、片尾原声比视频长：返回`CONTENT_TIMELINE_REQUIRED`，修正安排或补足素材画面，不通过截掉声音求成功。
- 独立片尾抽帧或原声比对失败：不发布该分镜；其他完成分镜可继续保留。
- 封装重试复用已验证的原始渲染及完整混音，固定混音不再重复追加片尾原声。
- 用户禁用片尾时，不追加视频；固定结束语仍可保持正文。无固定结束语时，不冻结正文，直接在全部正文口播结束后追加片尾。

校验负责时间、来源、覆盖和真实媒体一致性；画面美感仍由Render对照参考、播放样片并修改，不能用脚本通过替代审片。

## 5. 验证与样片

本次不调用收费TTS。测试声音为本地合成信号，不能当作正式口播试听。

- 模板参数与TypeScript检查通过；真实渲染验证同镜及跨镜保持、显式帧与内部时钟、单镜和整片同帧一致、两句字幕变化、配音不重复、片尾占位无声。
- 自适应模板真实回归通过：11张静帧、6段视频，覆盖不同章节数量、长字幕、本期扩展、不同动画窗口、叠层、遮挡和溢出负例、长音效。
- 新增真实FFmpeg测试覆盖完整画面与PCM追加、静音和无音轨片尾、素材变化、正文尾音、固定混音、缓存复用、正式参数篡改和占位冒充。
- Python合并回归共120项，首轮117项通过、2项真实浏览器用例跳过、1项历史预算失败。随后指定本机依赖和浏览器，单独补跑这2项并全部通过；最终120个不同用例中119项通过、1项历史失败，无导入或执行错误。详细名称见`python-tests.json`。
- 真实模板与共享媒体工具完整连接通过：前三秒保持正文并依次显示两句字幕，随后播放完整67帧片尾，总计157帧／5.233333秒。口播右边界后的原始PCM完全静音；片尾首、中、末帧比对通过，片尾PCM与来源相关系数为1.0，最终MP4与混音相关系数约0.99933。
- 两个Skill结构校验通过；教学组件严格编译及数值／几何、路径、布局端点检查通过；短版54帧和长版162帧实际渲染并检查抽帧。
- 独立前向检查使用无可靠量化数据的城市积水题材，确认Skill能引导真实关系图解、跨镜结束语和本地片尾流程；这是只读制作推演，未宣称完成该题材成片。
- Worker TypeScript检查通过；交付与句级音频Node测试5项通过，另一个旧版整套多帧率媒体用例未运行。当前共享渲染入口的2项真实Remotion回归已单独通过，包含缓存复用、声音同步、封装重试及补帧。

最终Python汇总、端到端片尾数据及本地样片保存在[验证目录](../artifacts/render-optimization-validation/2026-10-08/)。其中`python-tests.json`记录通过、失败及跳过情况，`ending-validation.json`记录真实模板连接完整片尾的帧数和原声比对。

- [完整片尾连接验证视频](../artifacts/render-optimization-validation/2026-10-08/ending-final.mp4)
- [片尾连接抽帧](../artifacts/render-optimization-validation/2026-10-08/ending-contact.png)
- [教学动效短窗口样片](../artifacts/render-optimization-validation/2026-10-08/narrative-short.mp4)与[长窗口样片](../artifacts/render-optimization-validation/2026-10-08/narrative-long.mp4)：用于验证运动方法和不同窗口适配，不作为本期正式图解。

存在一项已确认的历史失败：`test_managed_tools_only_record_events_and_do_not_double_charge`预期受Worker管理的连续错误只记录事件，但现有`two_stage.execution`第三次失败仍触发`REPAIR_BUDGET_EXHAUSTED`。已在独立目录提取Git HEAD旧源码复现同一失败，属于本次改动前的问题；本次没有扩展修改预算系统，不能称全套测试全绿。

## 6. 已知代价与发布边界

- 为保持现有分镜交付协议，Remotion仍生成末镜的静态占位，末镜再经历一次视频编码；其他分镜不增加这一步。
- 新规则提高每期设计、预览和修改的要求，不能保证一次生成就达到参考作品的美感。
- 片尾必须在冻结前下载、整理并实测；远程网页临时资源不能直接进入正式渲染。
- 本地模板ZIP和运行时清单已更新。服务器仍需使用该版本工具、Skills及模板包后，新任务才会采用新流程；本次未部署、未重跑历史生产任务。
