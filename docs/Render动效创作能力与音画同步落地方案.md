# Render 动效创作能力与音画同步落地方案

> 当前结论：本长方案已被后续确认的简化方案取代，不作为本轮开发清单。实际修改与验证见[《Render 制作指令优化开发记录》](Render制作指令优化开发记录.md)：明确制作需求、消除模板指令冲突、落实已有预览修订流程。下文保留讨论历史，其中新增事件协议、审查接口、工具及模板 1.4.0 的提案均未实施。日期：2026-10-08。
>
> 本文对应最近一次两阶段测试后暴露的正文动效问题，承接用户确认的方向：Render 本身应具备通用动效设计和音画对应能力，参考片只是辅助。本文只提出开发规格和 Skills 替换稿，不代表代码已修改或效果已验证。
>
> 本文替代[上一版完整方案](Render动效创作与片尾时序优化完整方案.md)中正文动效的后续开发安排。已经实现的片尾顺序和合片时间基修复继续保留，历史部署结果见[部署及网页验收记录](Render动效与片尾优化部署及网页验收记录.md)。

## 阅读指引

- 先读第 1～3 节：为什么上一轮改过 Skills，视频仍没有明显改善；这轮究竟改变什么。
- 第 4～6 节：Render 实际怎样设计，口播怎样驱动画面，工程代码怎样接收。
- 第 7～9 节：怎样真正看见效果、退回修改，以及具体改哪些文件。
- 第 10 节：可直接用于后续实施的 Skills 替换文本，供逐段审阅。
- 第 11～14 节：模板文字、验收用例、开发发布顺序、失败处理与代价。

全文中的示例稿件、数字、事件名称和动作速度只用于说明接口与方法，不成为以后任务的固定模板。

## 1. 先用大白话说明这次要开发什么

Render 要完成的是一项连续的制作工作：读懂讲解，决定怎样让观众看懂，把这些决定画成画面，安排画面随讲解推进，看到实际效果后再修改。

这次开发围绕四个结果展开：

1. **先形成真实画面设计。** 每个主要讲解段要有清楚的视觉表达和可渲染的关键状态。不能只在文档写“关系逐步建立”，然后直接批量导出。
2. **动作与真实口播共用时间依据。** 组件使用的动作时间和审阅时看的位置，都从同一组口播事件得到。换了配音时长，相关动作跟着重新定位。
3. **Render 能实际观察自己的作品。** 提供关键状态图、围绕动作的连续帧、对应口播和段落概览。导出一个 MP4 文件不等于模型已经看过或听过。
4. **发现问题后继续改作品。** 设计和表达不合格时回到当前工程修改。技术检查通过不能把已知视觉问题变成“已完成”。

参考财经视频、参考外站、复用组件都服务于这四件事。增加参考数量、删掉文字卡或强制每段多少个动作，均不作为这次优化的主方案。

### 1.1 预期的实际体验

用户仍然提交稿件、确认 Analysis 的文字结果，再执行 Render。网页没有增加人工逐段审批步骤。

Render 内部先做小范围候选画面并检查；图形表达不合适就自己修改；设计与动作确认有效后再批量导出。最终仍返回一个整片和原来的 N 个分镜，不增加交付分镜、不改变确认文本。

### 1.2 本文明确的能力边界

- 本轮基础同步目标是**真实短句或语义句段级同步**。现有 TTS 的独立音频边界足以支撑它。
- 长句中任意词的准确发音时刻，并非现有链路已经具备的数据。首版不按字数估算，也不默认新增付费对齐服务。新配音可在自然语义停顿处拆分；已有有效音频优先复用。
- 如果验收明确要求长句内部的词级触发，需要另行确定真实时间戳或声学对齐方案。不能把这个能力缺口藏在“跟随口播”四个字里。
- 当前 Worker 已确认具有原生命令与看图能力。本文可直接落地的自动观察是连续帧、原稿和真实时间的联合核对；是否能直接输入连续视频和音频，需要实际能力验证。未完成该验证前，不宣称自动完成全片试听或完整动态观感验收。
- 构图、美感与表达仍由 Render 判断。程序可以检查时间、证据和版本，不能以字段齐全或像素变化量证明作品好看。

这些是本方案的实施取舍，供本次文档审阅；尚未据此进行开发。

### 1.3 共用能力与首批接入范围

创作方法属于共用 Render Skill，不依赖财经行业、参考片或某个固定组件。时间解析和观察工具也不包含行业对象。

本轮首先为财经模板 1.4.0 接入具体数据合同。冻结模板的 renderer-manifest.json 增加 narrativeMotionVersion: 1，表示该模板支持本文的 utterance、visualCues 与制作审查接口。公共工具从 request.input.templateSnapshot 指向的原始冻结清单读取该能力，不能从 Render 可修改的工程副本决定是否跳过。

其他模板可以按同一事件合同适配，但本轮不把财经 chapters/visualBlocks 强塞给普通素材剪辑。未声明该接口的旧模板继续使用原媒体合同，并执行适用的共用创作指导；不能宣称它们已经通过本轮新能力验收。使用新财经模板时，缺失 cue 派生或必要审查是待修复问题，不自动降回旧流程。

## 2. 事实、根因与不能直接下的结论

### 2.1 本轮分析的是哪个结果

| 项目 | 对应内容 |
| --- | --- |
| 网页任务 | 225aa0a7a92847aebef9059462b1e0cf |
| Worker 任务 | b2c08fc1-9c47-4a7e-861f-a8a3f403f9a4 |
| 最终成功 Render | a35c90e5-d3fd-4c02-b61d-9c1bfe56196c |
| 实际生成正文工程的 Render | a79952a2-4034-4340-8417-45b2f6ac4507；最后一次继续执行复用了其分镜 |
| 现有验收结论 | 技术交付、文本顺序和片尾检查通过；正文动效视觉验收未通过 |
| 本地证据 | artifacts/deployment-validation/2026-10-08/huang-ai/review-findings.json |

当前成片的主体组件主要在进入图解后的 24 帧内完成淡入或柱形生长；之后的长段讲解没有对应的主体变化。实际短句时间存在，但组件没有用它来组织主要动作。这是结果证据，不是需要写进共享模板的特例规则。

### 2.2 财经参考片没有换成其他视频

模板指定的参考片是 assets/video/reference/financial-report-dialogue-v3-final-cut-preview.mp4。原始实现位于 examples/hello-world/src/FinancialReportDialogueV3.tsx；hello-world 是工程目录名。

模板中的参考视频与该工程输出的视频 SHA-256 相同：cc243cd7b4c8841101ac7e5ebc8b8c3cb1f51965cc516839f34dcdeb937455aa。

参考片展示了不同图形、分批加入、曲线绘制、时间轴和指标切换；但部分章内动作仍采用固定偏移，也存在早于相关口播出现的情况。学习其设计方法，不复制历史正文、数值和固定时间表。

### 2.3 已证实的链路缺口

| 事实 | 源码位置 | 对方案的影响 |
| --- | --- | --- |
| 创作方法已经写得较完整，还有可运行的数据和关系动画示例 | .agents/skills/video-pipeline/references/motion-design.md；remotion-best-practices/rules/assets/narrative-motion-examples.tsx | 不能把“再多写几条技巧”当作主要开发成果 |
| 制作流程要求预览修订，但批次冻结不消费设计或预审结果 | tools/render_batch.py::freeze_batch、inputs | 补上预审结果与当前工程版本的联系 |
| 模板要求优先复用动效组件，默认把图解放到章节 | renderer/renderer-manifest.json 的 rules；动效组件与内容适配说明.md | 澄清：章节是组织范围，内部可以有多个视觉推进；基础组件是可选实现 |
| 组件参数是自由 props，自定义组件可完全不用口播时间 | renderer/src/visualExtensions.tsx、VisualBlocks.tsx | 提供一致的事件输入与时间换算，实际是否正确使用仍要看成片 |
| 最终检查主要核对文件、声音、字幕和首中尾抽帧 | tools/stage_media.py::validate_delivery、extract_frames | 增加围绕讲解与动作的证据，保留原技术检查 |
| 最终 review 要求 passed 为 true，缺陷可能只被写进备注 | references/two-stage.schema.json 的 review | 制作中的待修订记录与最终合格声明应分清；不能只把 const true 改成 boolean 就认为解决了 |
| Worker 配置明确提供命令和看图工具 | video-worker/src/infrastructure/app-server.ts；runner/codex-host.ts | 先落实可被模型实际消费的画面观察，不假定存在完整视听输入 |

上表路径除 video-worker 外，均相对 claude-code-video-toolkit。

### 2.4 根因判断

已经存在的创作知识没有形成可靠的执行与反馈过程：设计意图可以不落实到真实画面，动作可以不使用语音事件，成片也可能在没有充分视觉修订的情况下通过交付检查。

模板的默认组织方式会诱导粗粒度设计，但并没有强制每章只能一张图。不能把本次静态结果全部归因于模板。

现有证据也不能证明模型本身没有设计能力、预算一定不足或只要换一个模型就能解决。应先完成本方案的观察和修订过程，再用真实任务评估能力是否稳定。

## 3. 新旧方案、保留内容与明确删除的逻辑

| 项目 | 当前或上一条建议 | 本轮确定的改法 |
| --- | --- | --- |
| 参考资料 | 把补参考源码当成主要改善手段 | 参考降为辅助，创作过程在无专门参考时也能执行 |
| 图解组织 | 容易以章节选一个图解并覆盖长段 | 在同一章节内按含义推进多个状态；可以保留同一对象，也可以切换表达 |
| 文字卡 | 上条建议删除若干类型的默认分支 | 不为解决个案批量删除组件；准确说明能力，按本期设计决定使用或新增 |
| 动作时间 | 模型在说明、props、代码中各自写数值 | 正式时间轴保存语音锚点；公共函数派生时间；组件与取证共用派生结果 |
| 构图设计 | 文字说明即可继续 | 关键状态必须由实际组件渲染出来，供 Render 看图后修订 |
| 预览 | 导出文件、记录看过的帧 | 提供真实画面和原稿对照；检查缺失的视觉解释，不能只检查已声明动作 |
| 不合格结果 | 可能备注不足后仍 passed | 正常返回 revision_required，继续制作；最终只接受当前版本的 ready 结果 |
| 成功定义 | 机械检查通过，生成了成片 | 机械检查与制作审查均完成；实测验证通用生成能力 |

保留：Analysis → 确认文本 → Render、已有 utterance/caption、完整音轨、固定结束语保持、串行追加片尾、合片时间基归一化、任务内 visualExtensions、素材下载和本地引用。

拟删除或替换的实际内容：

- 模板中“优先填既有动效内容”“章节图解等同一张主体图”的引导；后者是要澄清的误用，不删除 chapters 结构。
- Skill 中把“已导出动态片段”默认当作“模型已经观看”的表述。
- 将视觉设计问题仅记为 limitations 但仍默认通过的制作行为。
- task-io.md 中“可直接生成结果”可能被理解为可省略共用制作检查的表述；规范出口统一走 task_io.py render。
- 任意自定义数值帧靠补帧工具猜字段平移的预期；新事件始终从语音引用重新派生。

不建立动画描述语言、行业图标菜单、自动审美评分器或新的 Worker 业务阶段。设计状态说明是供 Render 使用的制作资料；形状、坐标、样式和运动仍写成普通 TSX。

## 4. Render 每次实际怎样工作

### 4.1 按讲解推进组织设计

Render 先读完整确认稿，再组织视觉段落，保存到现有 direction.json 的 visualUnits。每个视觉段落可包含多条 utterance，也可只解释一条 utterance 的一个主要含义。

视觉段落和章节、交付分镜分别承担不同作用：

- chapters 管标题、导航、章节摘要。
- scenes 保持用户确认的 ID、文本、顺序和 N 个 MP4。
- visualUnits 记录视觉目标、构图和连续状态。
- visualBlocks 是实际承载组件的显示区间，可在一章内有多个。
- visualCues 记录动作关联的真实配音与期望动作时长。

一个对象连续讲解时保留同一 block 和稳定对象 ID。进入不适合共用图形的新含义时可切换 block。不会为了“一句一个分镜”重播动画，也不为“一章一个主题”强行保留同一张图。

### 4.2 设计时必须做出的决定

| 决定 | 需要写清的具体内容 | 如何进入后续工作 |
| --- | --- | --- |
| 讲解目标 | 观众应该看懂哪种变化、差异或关系；有哪些关键事实不能误读 | 审阅从原稿检查是否实现 |
| 视觉表达 | 哪些对象、图形或素材承担解释；数据尺度和关系方向的依据 | 组件的真实图形与参数 |
| 构图 | 主体、辅助说明、结论的位置关系；阅读顺序；需要保留的空白 | 实际 TSX 布局和关键状态图 |
| 连续状态 | 开始、推进、结束时哪些对象存在；各自位置、尺寸、重点如何改变 | 同一组件在不同时间的真实状态 |
| 运动 | 哪个对象改变什么属性；运动路径、起止状态、先后或并行关系 | 组件使用 cue 进度计算几何和样式 |
| 口播联系 | 哪条 utterance 触发哪次状态变化；当前句继续解释时保留什么 | 正式 visualCues |

这不是“填完六个字段就算设计合格”。字段用于保存决定；是否清楚、合理、好看，要看实际关键状态和过程。纯引文、观点文字可以用文字设计，不强行改造成图表。

### 4.3 先用真实组件画关键状态

Render 在本期工程实现初版组件，包含完整可读状态和关键转折状态。先稳定构图、层级和关系，再完善运动。

新增可信 stills 入口，从同一个工程、同一个 Composition 和实际 props 中抽指定帧，输出 PNG。调用示意见第 7 节。不能另画一个漂亮静态稿，却让实际组件采用另一套布局。

此步骤在真实配音时间已确定后执行，避免为草图制造一份假音频时间轴。配音前可以写草案、画草图；草案不进入正式时间合同。

Render 实际查看图片后，处理主体太小、文字太细、比例不清、连接错误、留白失衡等问题。关键状态可读，再做主要运动的连续预览。

### 4.4 实现运动时的具体设计要求

- 同一个对象延续解释时，保留对象身份，改变其位置、大小、形状或重点，而不是删除后重新出现。
- 数值表达由同一当前值驱动数字和几何，尺度、单位、零点保持一致；不能给原文没有的数字或中间历史点。
- 连线按真实关系绘制，节点和标签跟随布局移动；并列不自动画成有方向的因果链。
- 强调先服务于当前讲解主体。辅助标签可以短暂延后，主结论不能已经讲完才出现。
- 过渡由内容决定。需要比较时保留前态；需要进入局部时重排或放大；需要建立整体时可以先给轮廓再补信息。
- 完成状态继续有解释价值时可以停留。没有“每几秒必须动一下”的要求。
- 动作窗口缩短时，先省略装饰、合并次要步骤；仍不足则用清楚的直接状态。不得延迟口播、增加静音或把动作挤成闪动。

### 4.5 从原稿和画面两头审查

每次审阅做两遍不同的核对：

1. 从原稿出发：这段新增了什么意思？画面有没有回应？有没有错误地表达成另外一种关系？有没有没被 visualCues 覆盖的重要推进？
2. 从画面出发：这次变化对应哪句讲解？方向是否正确？中间状态是否清楚？结束后是否能继续阅读？

不能只检查 Render 自己列出的动作，否则“只声明一个淡入事件”仍可能全部通过。覆盖原稿不等于每句话都必须运动；连续解释同一图形时可以记录保持理由并查看该状态。

### 4.6 不满意怎样继续

问题写入现有 preflight-review.json 或最终 review.json，说明实际观察、对应区间、修改目标和需要改的层次：含义、构图、动作、时序或排印。

Render 修当前工程后，重新派生和预览受影响片段。口播未改时复用有效 TTS。当前版本达到可交付标准后才批量或提交，不增加用户逐段审批。

## 5. 制作资料与时间数据：具体放在哪里

### 5.1 继续使用现有目录

~~~text
任务根/
  project/renderer/                 本期 TSX、字体和本地素材
    src/timeline.ts                派生结果，含 resolvedVisualCues
    src/visualExtensions.tsx        本期组件注册
    src/本期组件.tsx                具体画面和运动实现
  render/<runId>/
    direction.json                 视觉段落与语义设计；保留 ending
    chapters/<chapterId>/brief.json 可选的章节工作展开；不再复制数值时间
    timeline.json                  唯一正式音频/画面时间轴与 visualCues
    scene-XX-props.json             工具派生
    scenes.json                    复用批量导出的有序作业列表
    previews/                      关键状态图、候选副本、连续帧和索引
    preflight-review.json          批量前的真实审阅、问题及修订结果
    review.json                    最终成片审阅
    manifest.json                  原交付清单，仍通过 quality 指向 review
~~~

预览和审查放在 render 下。现有 project_fingerprint 会扫描整个工程；如果把不断增加的审查图片写进 project，会导致输入摘要变化和无意义的重复渲染。

scenes.json 复用现有 freeze-batch --scenes 的数组结构，每项记录 sceneId、composition、frames、props 和可选 fixedMix。新合同将其固定保存在当前 run 的这个位置，第一次预览前就准备完整列表，不新增另一份镜头规划。它用于所有入口计算相同的执行配置摘要。单镜 render/stills 的入参须与其中对应作业一致；正式批次仍按原 --scenes 接口读取该文件。

### 5.2 direction.json 增补结构

保留现有全局安排、章节和 ending，仅增加 visualUnits。以下是一个示意记录，文本内容可充分展开，不限定状态和动作数量：

~~~json
{
  "visualUnits": [
    {
      "id": "unit-application-flow",
      "chapterId": "chapter-02",
      "utteranceIds": ["u101", "u102", "u103"],
      "intent": "区分已齐全与待补充，并说明补齐后可回到办理流程",
      "facts": ["总量100", "齐全60", "待补充40", "补齐是条件，不代表已经完成"],
      "composition": "等尺度整体在左，办理入口在右，待补充部分保留为条件分支",
      "states": [
        {"id": "whole", "description": "整体100可读，尚未暗示处理结果"},
        {"id": "split", "description": "同一整体按真实60/40比例分开，标签说明两种状态"},
        {"id": "conditional", "description": "保留待补充分支，以条件路径说明补齐后去向"}
      ],
      "actions": [
        {"cueId": "split-status", "description": "原整体分区并分离，保持相同尺度，标签跟随区域"},
        {"cueId": "show-condition", "description": "从待补充分支描出到办理入口的条件路径，不让40份直接变成已办结"}
      ],
      "blockIds": ["application-explanation"],
      "reference": null
    }
  ]
}
~~~

配音前草案使用确认 sceneId 和原文片段定位；配音生成后填实际 utteranceIds。原文片段须来自确认文本，不能用估计时间代替。

设计字段保存创作意图，不由工具解释成动画。TSX 决定形状、坐标、颜色、运动曲线。reference 可以为空；缺少专门参考不阻止创作。

### 5.3 正式时间轴新增 visualCues

在现有 timeline.json 顶层增加 visualCues。每条事件只负责把一个已设计动作绑定到真实声音，不描述通用动画语言：

~~~ts
type SpeechAnchor = {
  utteranceId: string;
  edge: 'start' | 'end';
};

type VisualCue = {
  id: string;
  blockId: string;
  anchor: SpeechAnchor;
  durationSeconds: number;
  finishBefore?: SpeechAnchor;
};
~~~

示例：

~~~json
{
  "visualCues": [
    {
      "id": "split-status",
      "blockId": "application-explanation",
      "anchor": {"utteranceId": "u102", "edge": "start"},
      "durationSeconds": 0.8,
      "finishBefore": {"utteranceId": "u103", "edge": "start"}
    }
  ]
}
~~~

0.8 秒是这一次设计采用的动作速度，不是所有视频的固定配置。Render 可以根据实际预览调整。durationSeconds 为 0 表示有意的即时变化；不能生成起止相同的插值区间。

blockId 在本期全部章节和分镜图解中唯一。多个动作可同一时刻开始，不强制递增或轮流入场。没有运动的视觉段落允许 visualCues 为空，但 direction 和审阅中要说明稳定画面承担的解释。

finishBefore 用于表达必须在下一个讲解点之前完成的动作。省略时受 block 可见区间和正文结束位置约束；这不意味着把整个剩余区间都用作动画时长。

### 5.4 派生结果与精确换算

在 tools/actual_timeline.py 新增纯函数 resolve_visual_cues(timeline)，同时识别正式 scenes.startFrame 和已核对一致的 from 别名。它不读 Analysis 估时、不改变场景长度、不决定图形、不调用配音。

计算步骤：

1. 索引真实 utteranceId，得到全局起止帧：scene.startFrame + utterance.startFrame/endFrameExclusive。
2. 索引所有 block，得到全局起点和右开终点；章节 block 加 chapter.from，分镜 block 加 scene.startFrame。
3. 从 anchor 取全局 startFrame。
4. deadlineExclusive 取 block 的右开终点与显式 finishBefore 的较早值。存在正文保持时，还不得越过 holdFrame + 1。
5. requestedFrames = floor(durationSeconds × fps + 0.5)，明确采用非负数四舍五入，避免不同语言的舍入差异。
6. completeFrame = min(startFrame + requestedFrames, deadlineExclusive - 1)。completeFrame 是完成状态第一次可见的帧，属于区间内。
7. 局部起止分别减去 block 的全局起点。

若 startFrame 不在 block 内、deadlineExclusive 不大于 startFrame、ID 缺失/重复或时长非法，返回明确的当前工程问题，不能把事件悄悄移到第 0 帧。

有效窗口很短导致动作压缩时返回建议，并列出原期望时长和实际可用时长；Render 根据画面决定简化或重排。工具裁边界只保证计算有效，不能代替设计判断。正时长被压到即时切换时也必须明确报告，不能悄悄省略动画。

输出结构：

~~~ts
type ResolvedVisualCue = {
  id: string;
  blockId: string;
  utteranceId: string;
  startFrame: number;          // 全局触发帧
  completeFrame: number;       // 全局完成帧，包含在可见区间
  localStartFrame: number;     // 相对 block 起点
  localCompleteFrame: number;
};
~~~

纯函数完整返回值为 {resolvedVisualCues, recommendations}。每条压缩建议包含 cueId、requestedFrames、availableFrames、resolvedFrames 和中文说明；availableFrames 指最后可见帧减起点的距离，允许为 0。derive 的工具返回同时提供 recommendations，预审记录压缩后的实际表现是否仍清楚。

正式 timeline 只保存 visualCues 原始引用；finance_timeline.py::derive_timeline 调用纯函数，在派生副本和各镜 props 中加入 resolvedVisualCues。不要把数值副本回写成第二份可编辑源。

### 5.5 补帧、音频替换与跨镜处理

- extend_timeline 保留新 visualCues 的 ID 引用，不给它们添加字段名特判。后续重新 derive，即可从平移后的 utterance 重算事件。
- 现有 itemFrames/revealFrame 的旧组件适配暂时保留；新叙事动作优先使用 cue。无需为废弃旧字段而强行迁移已经交付的视频。
- TTS 或实际音频内容改变，先验证文本与音频摘要，再重建真实音频时间轴并派生；预览、审查和冻结版本随之失效。
- 跨镜动画继续使用 block 局部时间；逐镜输出的每个全局帧应与整片 Composition 对应帧一致，接缝按同一连续时钟推进。事件不能仅因下一条 MP4 开始而重置。
- 事件来源在 block 之前、但设计希望初始显示已有状态时，应将该状态写为组件初始状态；不要制造越界事件并在工具里自动修正。
- 固定结束语开始后不再安排新的正文动作。正文末态保持、字幕和声音继续、口播后完整片尾，沿用现有 ending 行为。

## 6. 模板和组件具体怎么接

本节路径相对 claude-code-video-toolkit/deliverables/财经双人对话视频生成指令/renderer/src。

### 6.1 types.ts 与 visualExtensions.tsx

types.ts 增加上节三种类型；FinanceTimeline 的派生输入包含 visualCues 和 resolvedVisualCues。普通文本图解可以没有事件，不对所有段落强行要求动态效果。

扩展组件输入改为：

~~~ts
type VisualContext = {
  block: VisualBlock;
  frame: number; // 保持现有含义：block 局部帧
  cues: Readonly<Record<string, ResolvedVisualCue>>;
};
~~~

注册入口仍使用已有 component 与 validate。本期组件从 cues 取得自己的事件，不自行遍历字符串猜说到了哪句话。现有只读取 block/frame 的组件仍可按原样工作；是否需要重做由本期设计判断。

### 6.2 FinancialDialogue.tsx 与 VisualBlocks.tsx

BodyVisual 已经计算 absolute = scene.from + frame。继续使用该时间计算章节或分镜 block 的局部帧，并把 timeline.resolvedVisualCues 传入 VisualBlocks。

VisualBlocks 按 block.id 筛出相关事件，以事件 ID 建成 cues 传给扩展。外层继续只负责定位，不叠加一个统一主动画。

HeldBody 沿用已实现的 Freeze/Sequence 时间恢复。它会在正文 holdFrame 计算同一个组件的完成状态；新增事件不得绕过这个保持时间使用真实墙钟。

### 6.3 motion.ts 增加一个小型公共辅助函数

保留 motionFrames；新增 cueProgress，只负责由已绑定的局部时间计算 0～1 进度。缓动由本期组件选择，不把图形或行业业务写进工具。

~~~ts
export function cueProgress(frame: number, cue: ResolvedVisualCue): number {
  const start = cue.localStartFrame;
  const end = cue.localCompleteFrame;
  if (end === start) return frame < start ? 0 : 1;
  return Math.max(0, Math.min(1, (frame - start) / (end - start)));
}
~~~

本期组件调用示例：

~~~tsx
const cue = cues['split-status'];
if (!cue) throw new Error('缺少本期分区动作的口播事件');
const progress = cueProgress(frame, cue);
// 这里的起止坐标来自本期构图；公共工具只提供时间进度。
const left = initialLeft + (targetLeft - initialLeft) * progress;
~~~

数值图形使用不越过真实端点的进度；装饰曲线可以另选，但不能使数据短暂显示错误数值。

### 6.4 validateTimeline.ts 的职责

检查 cue ID/block ID/utterance ID、区间、派生值与坐标一致；检查全局和局部时钟的关系；检查正文动作完成位置没有落入保持或片尾。

还要按 BodyVisual 的实际选择顺序核对可见性：片头、章节卡或 scene.visualBlocks 可能覆盖章节 block。仅落在 block 的声明区间内不代表可见。针对事件开始与动作区间按这些有限边界拆段检查；遇到覆盖就指出遮挡来源，让 Render 调整所属 block 或编排，不在解析函数中悄悄移动时间。单纯文字或已完成状态的有意延续，在审阅中说明。

权威解析算法在 Python 中只有一份。TypeScript 侧验证已派生的数值与现有 block、utterance 边界，不再实现另一套自动排程。

字段合法不能证明组件确实使用了事件。开发测试通过移动事件并比较真实渲染状态验证绑定；生产中的表达是否正确依靠实际画面审阅。

### 6.5 字体与视觉层级

具体修改如下，字体资源与加载代码均随新模板一次发布：

1. 以已在渲染环境核实存在的 Noto Sans CJK SC Regular/Bold 为字形基础。开发打包阶段取得对应字体文件，输出模板 assets/fonts/NotoSansSC-Regular.woff2 与 NotoSansSC-Bold.woff2，并保留原字体随附说明。文件名是拟新增产物，不表示当前包中已经存在；转换只在开发打包时进行，Worker 不临时下载或安装字体。
2. 新增 renderer/src/typography.ts，导出 family='FinanceChinese'、normal=400、strong=700，以及 title、label、note、number 四组样式。1920×1080 默认字号分别为 42、34、28、48，行高分别为 1.2、1.3、1.4、1.1；这只是栏目起点，本期组件可按构图调整，不能缩小主标签去迁就拥挤布局。数字与对应单位共用对齐基线。
3. 同文件提供幂等 loadFinanceFonts()，使用 FontFace 加载两种真实字重并加入 document.fonts；路径使用 staticFile('template-assets/assets/fonts/...')。加载 Promise 只创建一次。渲染入口等待加载完成后再测量文字并放行帧输出，使用当前 Remotion 的 delayRender/continueRender 机制；字体加载失败保留具体文件错误，修复资源后重试，不能悄悄以另一种字体生成通过截图。
4. FinancialDialogue.tsx 的根容器使用该 family；VisualBlocks 及本期组件引用排印角色。栏目主体只使用已有的 400/700，不请求不存在的字重。人物、品牌 Logo 和字幕位置继续沿用栏目规范，检查字体替换是否改变其换行。
5. 用主标题、两行长标签、数字单位、红色辅助说明分别渲染真实静帧，再检查实际网页缩小尺寸。红色承担强调，不以细小红字承载整段主关系；需要因果或条件表达时，仍由真正的节点与连接承担。

排印是每个关键状态的检查项目，不能用统一缩小字号修复所有溢出。实际字体、行距、布局变化后，预览摘要必须失效并重验。

## 7. 预览和取证工具：具体新增什么

### 7.1 新增 stills 子命令，不另建渲染器

修改 tools/stage_media.py 和 tools/render_scene.cjs，增加静帧模式。当前可信执行器没有独立 stills 模式，不能在方案中假定已存在。

~~~bash
python3 "$TOOLKIT_ROOT/tools/stage_media.py" stills \
  --request "$REQUEST" --scene scene_002 \
  --project project/renderer --entry project/renderer/src/index.ts \
  --composition FinanceScene-2 --props "$RUN_DIR/scene-02-props.json" \
  --frames "$SCENE_FRAMES" --at-frames "$PREVIEW_FRAMES" \
  --node "$NODE" --modules "$MODULES" --browser "$BROWSER"
~~~

新增行为：

- RUN_DIR 是当前 run 相对任务根目录的路径；SCENE_FRAMES 取实际时间轴；PREVIEW_FRAMES 是逗号分隔的镜内整数帧号。上述变量必须先从本次实际资料取得，示例不是固定时间配置。
- Python 复用当前任务校验、执行锁、预算、版本摘要、沙箱与子进程清理。
- Node 根据 mode=stills 使用同一 bundle、Composition、props 调用 renderStill；批量导出指定帧，不能生成另一套“预览专用画面”。
- Composition 的完整 duration、fps、width、height 必须与正式分镜一致；选取帧号不能改变 Composition 时长。执行前后重算输入摘要一致后才登记预览 receipt，生成中修改工程不得记录为成功。
- 校验帧号去重后仍位于 0～scene.frames-1；图像只写 render/<runId>/previews/stills/<输入摘要>/。
- 不生成或替换正式 MP4，不混音，不调用 TTS，不写正式场景成功 marker。
- 返回图片路径、帧号、摘要和工程输入摘要。Render 还必须用看图工具查看图片。
- 复用执行器的超时、取消和进程清理。不能为静帧另开不受管理的后台浏览器。

第一版不新增局部 frameRange 视频导出。真实配音候选仍通过已有单镜 render 完整导出，跨镜运动导出相关的多条分镜。其代价见第 14 节。

### 7.2 新增 motion-evidence 子命令

作用是把实际 MP4 展开为便于审阅的画面序列，而不是判断美感。

~~~bash
python3 "$TOOLKIT_ROOT/tools/stage_media.py" motion-evidence \
  --request "$REQUEST" --project project/renderer \
  --entry project/renderer/src/index.ts \
  --purpose candidate --unit-ids "$PREVIEW_UNIT_IDS" \
  --media-index "$RUN_DIR/previews/media-index.json" \
  --modules "$MODULES" --browser "$BROWSER"
~~~

purpose 必填，只有 candidate/final 两种。candidate 要求 unit-ids 是当前 direction 中选出的视觉段落 ID，逗号分隔；取证覆盖所选段落涉及的全部口播、动作和跨镜边界。缺少其中任何分镜时返回 incomplete 及 missingSceneIds，不生成可用于 ready 的完整证据。未选的其他段落不因此判失败。final 不接受 unit-ids，自动覆盖全部正文视觉段落、实际正文口播及已启用的 ending；此时 media-index 必须包含全部交付分镜。PREVIEW_UNIT_IDS 由本次设计选择，不能写成公共固定名单。

media-index 是轻量路径索引，不是另一份交付 manifest：

~~~json
{
  "project": "project/renderer",
  "scenes": [
    {"sceneId": "scene_002", "path": "output/<runId>/scenes/scene_002.mp4"}
  ]
}
~~~

工具按 mp4Path.with_suffix('.render.json') 寻找已有 render marker，核对视频摘要、工程摘要、正式时间轴和实际帧数；不能仅接受模型声明的来源。新合同的 render marker 增加 sceneId、inputDigest、executionConfig 和源请求标识，与实际视频一同落盘。executionConfig 由渲染工具记录实际 project、entry、modules、browser 参数，不由 Render 手写。取证使用当前 run 的 scenes.json、CLI 的实际入口/依赖/浏览器参数重新计算 inputDigest，不能单独接受 marker 自称有效。

用于批量前预审的候选，必须将核对后的视频与来源记录复制到 previews/candidates/<摘要>/，证据引用该不可覆盖副本。否则批量渲染重写同路径 MP4 时，会把自己的预审依据弄失效。最终取证使用最终交付 MP4，绑定最终 manifest 中的摘要。复制旧候选时不能把它的源工程摘要改成当前摘要。

数据输入只从当前 run 的 direction.json、timeline.json 和真实场景文件读取。事件使用 resolve_visual_cues 同一结果，不能让 Render 再手工传一份抽帧时间表。

成功返回 status='evidence_ready'、purpose、inputDigest、unitIds、evidenceIndex 和 evidenceSha256。evidence_ready 只表示本次所需证据已完整生成，制作是否 ready 仍由实际审阅决定。未覆盖的正文口播必须在最终索引中单独列出，并由 Render 补设计或说明其稳定画面用途；不得因 direction 漏填而从取证消失。

证据目录采用 previews/evidence/<purpose>/<输入摘要>/<媒体与采样摘要>/，index.json 与图片不覆盖旧组。媒体与采样摘要包含实际视频摘要、有序 unitIds、默认采样规则版本和附加采样；最终取证不能覆盖候选索引，增加采样也不能悄悄替换已有审查依据。

### 7.3 取哪些帧，为什么取这些帧

对每个实际动作，采样触发前最后可见帧、触发帧、动作中间若干帧、完成帧和紧随其后的稳定状态。默认在动作进度 1/4、1/2、3/4 处取中间帧；零时长或极短动作去重。长路径、遮挡风险或疑似跳变时增加相邻帧，不把默认采样数当作质量标准。

需要追加观察时使用可选 --extra-global-frames，传逗号分隔的全局整数帧号；只能落在本次所选段落和可用视频范围内。工具校验后加入默认采样，不能用它替换语音事件采样或缩小正文覆盖。它是对疑点的补看位置，不是第二份动画时间表。

同时围绕每个正文 utterance 的开始、中间、结束取段落概览，防止只检查已声明动作而漏掉未设计的讲解。取样根据真实句段长度，避免把字幕和进度条变化误认为主体图解变化。

输出包括：

- 原尺寸单帧；需要时附主体图解区域放大图，完整画面始终保留。
- 分页画面序列，每页显示帧号和时间；对应口播放入同序 JSON/Markdown 索引。
- 单镜和全局坐标、cueId、utteranceId、原视频摘要、工程/时间轴摘要。
- 还缺哪些场景视频，哪些视觉段落尚不能检查。

启用 ending 时，最终取证另外包含正文 holdFrame、固定结束语开始/结束附近、片尾起点、片尾中间和最后有效帧，供末尾衔接审查；不要求把 ending 伪装成正文 visualUnit。

采样跨越 scene 边界时，按全局帧找到相应 MP4，再换算镜内帧；不能把另一镜的同名局部帧当作连续画面。

FFmpeg 对同一视频合并提取所需帧，避免每张图重新解码整段。预览文件放 render 下，不进入 project 输入摘要。

### 7.4 工具不能替代的判断

工具不以事件数量、像素差、图片数量或文字长度决定“好看”。它只让 Render 有机会看见真实结果，并保证记录对应当前文件。

看图调用只证明图像输入发生过，不能自动证明判断正确。审查仍应给出原稿含义与实际画面的对应结论。无法实际听看时如实记录能力范围，不把 FFmpeg 解码成功写成“已试听”。

## 8. 制作审查、版本与交付控制

### 8.1 沿用两个现有审查文件

preflight-review.json 保存批量前审查，review.json 保存最终审查。给它们增加相同的 motion 字段，不再增加单独的“审美评分报告”。

~~~json
{
  "motion": {
    "status": "revision_required",
    "inputDigest": "当前制作输入的工具计算摘要",
    "evidenceIndex": "render/<runId>/previews/evidence/index.json",
    "evidenceSha256": "实际索引摘要",
    "selectedUnitIds": ["unit-application-flow"],
    "selectionReason": "本段同时验证整体拆分、对象连续性和条件关系",
    "reviewedUnits": [
      {
        "unitId": "unit-application-flow",
        "viewedEvidenceIds": ["e-001", "e-002"],
        "meaning": "条件路径被画成已经完成，需修正",
        "timing": "分区与短句边界对应",
        "layout": "待补充标签可读",
        "decision": "revise"
      }
    ],
    "issues": [
      {
        "id": "issue-01",
        "unitId": "unit-application-flow",
        "cueIds": ["show-condition"],
        "observed": "待补充对象直接进入完成区",
        "expected": "表达补齐后的可能路径，保留条件",
        "fixLayer": "meaning",
        "status": "open",
        "resolutionEvidenceIds": []
      }
    ],
    "observation": {
      "frameSequencesViewed": true,
      "audioActuallyHeard": false,
      "continuousVideoActuallyViewed": false
    }
  }
}
~~~

status 仅使用 ready 或 revision_required；它们是制作资料内的结论，不增加网页业务状态。最终已知的问题不能只写进 limitations 后继续通过。issues 可以为空，但不能为凑数制造问题。

decision 枚举为 accept/revise；issue.status 为 open/resolved；fixLayer 为 meaning/layout/motion/timing/typography。ready 必须满足已选审阅项全部 accept、所有已登记问题均 resolved、解决记录引用当前证据。无法进行的视听检查写入 observation 和 limitations，不虚构通过记录；如果缺失的是用户明确要求的验收能力，则不能将该项计为已经完成。

预审 selectedUnitIds 是需要先验证的代表范围；最终 selectedUnitIds 必须覆盖全部正文视觉段落。工具核对 ID、来源和记录完整性，不自动判断“这些样本足够代表全部设计”。代表选择是否遗漏新的表达方式，仍属于 Render 对照全稿的审阅职责。

最终 ready 还要求正文 utterance 覆盖完整：正式 timeline 中除 ending.closingUtteranceIds 外的每条 utterance，都至少出现在一个 visualUnit.utteranceIds 中。稳定画面也归入对应段落，在 states/intent 和审阅结论说明用途。取证索引里的 unassignedUtteranceIds 必须为空；补填归属后 direction 摘要改变，需要重新生成当前证据。该检查只防遗漏记录，是否实际解释得好仍由看图判断。

最终 review.motion 还增加 endingReview：{status, evidenceIds, notes}。只有 timeline 启用 ending 时要求存在；notes 分别说明正文末态保持、结束语字幕继续、口播后片尾开始和完整结束的实际观察。证据复用最终末段 MP4 及原有逐镜 evidence；片尾音轨完整性继续由既有声音检查负责。未启用 ending 时该字段为 null。

### 8.2 inputDigest 怎么计算

由工具对以下实际输入计算摘要：确认稿、direction、正式 timeline、工程文件、实际音频/素材、输出规格及执行器版本。工程摘要已经覆盖复制进 public 的资源；工程外实际音频按 timeline 的 audioPath 单独核对。

具体新增 stage_media.py::production_input_digest，纳入工程入口、每镜 Composition 和派生 props 的有序映射、锁定依赖及浏览器摘要；stills、取证、预审核对与冻结共用该函数。它不包含 batchVersion、审查文件或预览输出。freeze 的 inputs 可以再包含 preflightReviewSha256，但不能反过来用整个冻结摘要计算预审输入，否则产生循环依赖。现有 projectHash 或 timelineHash 单独都不足以替代 inputDigest。

fixedMix=true 时，继续纳入并核对现有 work/<sceneId>.adjustment.json 的实际内容、audioContract，以及 mixPath 所指 PCM 的实际摘要与 mixSha256；不能只记录 scenes.json 中的布尔开关。这样混音恢复来源变化同样会令审查失效，保留现有完整音轨保护。

最终入口的参数来源也统一规定：motion-evidence 将经实际 render marker 核对的 executionConfig 写入证据 index。validate_delivery 从 review.motion.evidenceIndex 读取该配置，检查归属当前任务、project/entry 位于任务工程、modules/browser 属于当前允许的运行依赖，并与所有最终分镜 marker 的执行配置核对。随后读取当前 scenes.json、工程、实际音频和依赖，重新调用 production_input_digest；不能直接拿索引中的 inputDigest 当作“当前值”。这样 task_io.py render 仍只需要现有 task/manifest 参数，不再要求模型在交付时重复传另一套运行路径。

审阅文字和预览文件不计入制作输入摘要，避免写审阅结果就使自己过期。证据索引和图片另有摘要。

同一个音频路径下换了文件、只改了字体、只改了组件、改变了 cue 或章节边界，都必须令受影响审查失效。首版沿用现有全工程保守失效策略，不新增复杂组件依赖图。

### 8.3 批量前检查在哪里执行

render_batch.py::freeze_batch 在 inputs 得到当前制作摘要后，按冻结模板的 narrativeMotionVersion 调用 stage_media 的共用制作就绪检查，读取当前 run 的 preflight-review.json。

检查：版本一致；预览视频/图片真实存在且匹配；代表片段覆盖本期不同关键表现；已知问题已解决；原稿重要推进有审阅结论。代表范围由 Render 根据设计决定，不硬编码“一至两个镜头”，也不允许只挑最简单片段代表复杂动作。

工程尚需修订时，返回正常结果：

~~~json
{
  "status": "revision_required",
  "scope": "task_project",
  "review": "render/<runId>/preflight-review.json",
  "next": "修改列出的当前工程问题，重新预览后再冻结"
}
~~~

此时不创建冻结清单，不调用批量渲染，不写任务失败或 completed。返回值不能伪装成带 manifest 的成功冻结。

### 8.4 最终检查在哪里执行

最终 review 的 motion 必须覆盖全部正文 visualUnits，以及固定结束语与片尾的实际衔接。批量前候选审查不能直接冒充最终成片审查。

stage_media.py::validate_delivery 保留音视频、字幕、资源和首中尾验证，再调用同一制作就绪检查核对最终 motion 与实际最终 MP4 摘要。two_stage.py::validate、assemble、task_io.py::complete_render 必须正确传播 revision_required。

各层提前返回行为明确为：

- assemble 收到 validate_delivery 的 revision_required 时，不开始 FFmpeg 合片，原样返回制作意见。
- two_stage.validate 收到 revision_required 时，不写 status=candidate 的 result.json。
- complete_render 分别检查 assemble 和 validate 的返回值；任一步待修订都不构造完成信封。
- freeze_batch 待修订时没有 manifest；render_batch 不能接受一个待修订返回对象作为清单路径。
- stage_media.main 和 task_io.main 对该状态返回 JSON、退出码 0；调用方必须检查 status，而非只检查进程退出码。

task_io.py 收到待修订结果时，返回制作指引并继续当前 Render，不写 resultFile 为 completed。最终都通过后才生成交付信封。

收窄通用 finish：Render completed 只能由 complete_render 验证后调用内部写入函数构造；通用 finish 继续处理 analysis、needs_input、failed，不允许把未验证的 Render result 直接包装为完成。CLI 保持 task_io.py render。异常输出保留已有 code/message，并透传 status、scope、details 和 next，避免丢失继续制作的指示。

review schema 中 passed 从只能为 true 改为布尔值，允许保存未通过的制作记录；最终交付函数显式要求顶层和逐镜 passed 为 true，并在启用本合同的任务要求 motion.status 为 ready 且无未解决问题。**这个布尔修改只是配合保存流程，不能证明视觉质量。**

所有新增抽帧、候选副本与证据生成通过 motion-evidence 的 execution 上下文记录实际耗时并响应取消。最终 validate 读取和核对这些记录及摘要，不在未登记的路径偷偷重复整段取证。原有音视频终检继续保留。

### 8.5 不把创作意见当成程序故障

revision_required 通过普通返回值传递，不抛入 two_stage.execution 的技术异常计数。仍计入实际耗时，仍遵守取消和总预算。

数据损坏、非法路径、未知 ID、组件编译错误等属于真实工程错误，继续走现有定位和修复机制；不能把所有异常都转换为普通审美意见来绕开预算。

同一输入和同一问题原样重试不能算修订。Render 应改变设计或实现，并记录解决证据；耗尽执行预算时保留候选与问题，按原协议如实结束，不能虚报成功。

### 8.6 控制边界：不能承诺不可绕过的审美保证

规范制作链统一走上述检查，Skills 不再允许省略检查后手写完成结果。Worker 继续负责信封、发布与回调，不增加另一个美学决策者。

当前任务进程可写制作资料，Worker 不独立验证模型是否真正理解了画面。本方案的摘要和审查记录属于一致性检查，不能被描述成防伪的强安全证明。提升效果依赖实际创作、观察和修订，并由第 12 节的自动生成样片验证；不以“无法绕过的质量门禁”作不实承诺。

### 8.7 一次正常任务的完整调用顺序

以下由同一个 Render 执行，不增加新的服务阶段：

| 顺序 | 谁执行什么 | 产生什么，接着做什么 |
| --- | --- | --- |
| 1 | task_io.py prepare 读取服务消息与冻结模板 | 得到当前 request、确认稿与能力版本 |
| 2 | Render 读稿、准备 direction 草案，调用现有 TTS | 得到真实音频、utterance 与 timeline；不改变已确认的口播 |
| 3 | Render 完成 visualUnits、visualCues 和本期 TSX | 动作引用真实短句；调用 derive-timeline 生成 timeline.ts/props |
| 4 | Render 写完整 scenes.json，调用 stills 并实际看图 | 调整真实关键状态；改工程或时间后重新派生、预览 |
| 5 | Render 通过现有 render 导出代表范围，再调用 motion-evidence candidate | 得到不可覆盖的候选和变化序列；实际审阅后保存 preflight-review |
| 6 | freeze-batch 检查当前预审 | ready 才冻结；revision_required 回第 3～5 步，保留有效配音 |
| 7 | render-batch 按冻结清单导出全部分镜 | 得到最终 N 个视频、音轨与来源记录；按现有规则生成交付 manifest |
| 8 | motion-evidence final 读取最终全部分镜；Render 实际审阅 | review 覆盖全文、过程与结尾；有问题修改并重走受影响制作步骤 |
| 9 | task_io.py render → assemble → validate_delivery / two_stage.validate | 技术与制作检查均通过后合片、生成完成信封并交给 Worker；中途待修订不写完成 |

共用制作检查拟命名 check_motion_ready(root, request, project, review_path, purpose, current_input_digest, media_index)，由 freeze 和 validate_delivery 调用；返回 ready 或带 scope/review/details/next 的 revision_required。它只检查数据、证据、版本和已记录问题的处理状态，不产生美学结论。purpose 与前述 candidate/final 一致；最终还要求 review 顶层和逐镜技术检查通过。

制作修订的关键是回到图形和运动代码，而不是把 review 的 false 改成 true。代码、时间或字体改变后旧证据失效，重新生成相应候选并实际看图；首版全工程摘要采取保守失效，可能需要重新冻结和导出更多镜头。

## 9. 逐文件开发清单

除显式 video-worker、docs 外，下表均位于 claude-code-video-toolkit。新增命令和字段仅在实施后可用。

| 文件 | 操作 | 具体实现与完成条件 |
| --- | --- | --- |
| .agents/skills/video-pipeline/SKILL.md | 替换正文图解段 | 入口明确独立创作、事件输入、真实观察与修订；详细方法路由到 supporting references |
| 同 Skill/references/production-flow.md | 替换正文创作、预审、最终审查相关段 | 按第 10 节操作稿；统一 revision_required 行为，删除相互矛盾的旧句 |
| 同 Skill/references/motion-design.md | 替换正文方法，保留片尾段 | 加入设计判断、实际关键状态、完整工作例与反例，不把行业写进固定菜单 |
| 同 Skill/references/motion-reference-cases.md | 调整开头与案例用途 | 财经参考说明对应关系；外站按需查阅，无参考也可完成设计 |
| 同 Skill/references/technical-routing.md、task-io.md | 更新路由与返回处理 | 声明 stills/motion-evidence；真实观察范围；统一通过 task_io.py render 交付 |
| 同 Skill/references/two-stage-contract.md | 增加正文动效制作合同 | 将第 10.9 节完整字段、坐标、命令与返回约定提供给运行中的 Render |
| 同 Skill/references/two-stage.schema.json | 修改 review，增加 motion 定义 | 能保存未通过记录；交付显式检查通过；不改变网页协议 |
| .agents/skills/remotion-best-practices/SKILL.md | 修改动画与预览段 | 说明 cues、单一局部时钟、真实状态图与证据；不混入业务发布流程 |
| 同 Skill/rules/data-animation.md、diagram-animation.md、text-animations.md | 精确补充/替换相关段 | 使用统一事件输入；保持原有数学与排版方法，避免复制业务流程 |
| 同 Skill/rules/assets/narrative-motion-examples.tsx 及 .entry.tsx | 调整教学输入 | 演示同一设计接入两组真实边界；事件可平移，零时长与跨镜仍正确；不得作为固定成片模板 |
| tools/actual_timeline.py | 新增 resolve_visual_cues | 纯时间派生；对未知引用、越界、零时长和补帧有明确行为 |
| tools/finance_timeline.py | derive 调用解析器 | 源 timeline 不回写；派生 timeline/props 统一输出 resolvedVisualCues |
| tools/stage_media.py | 增加 stills、motion-evidence、production_input_digest 与就绪检查 | 从冻结清单识别能力版本；复用受控执行；实际媒体取证；输出待修订不误报通过 |
| tools/render_scene.cjs | 新增 mode=stills | 同入口和 props 调用 renderStill；不改正式 MP4/混音；复用浏览器清理 |
| tools/render_batch.py | freeze/verify 消费当前预审 | 冻结前检查；清单保存预审摘要，执行前复核；旧审查不能批准新工程 |
| tools/two_stage.py | validate 传播待修订 | 待修订不写 candidate 成功；execution 不把普通质量意见计技术异常 |
| tools/task_io.py | complete_render/finish 调整 | assemble/validate 非完成时不写完成信封；正常出口统一检查 |
| 模板 renderer/src/types.ts、visualExtensions.tsx | 增加 cue 类型与输入 | 组件获得已派生事件；仍通过本期注册入口扩展 |
| 模板 renderer/src/motion.ts | 增加 cueProgress | 局部帧计算，零时长安全；不决定业务画面 |
| 模板 renderer/src/VisualBlocks.tsx、FinancialDialogue.tsx | 传递 cue 数据 | 跨镜时钟连续；保持与片尾不回归；不取消文字卡 |
| 模板 renderer/src/validateTimeline.ts | 新事件检查 | 检查引用/边界/局部全局一致，不作审美判断 |
| 模板 renderer/src/typography.ts（新增）、字体资源及加载入口 | 统一排印基础 | 字体实际加载、字重存在、测量与缩小预览一致 |
| 模板 renderer/timeline.example.json、src/timeline.ts 示例 | 更新示例 | 能展示一章内多次含义推进，时间样例不当作业务默认 |
| 模板文档、renderer-manifest.json、package.json、同名 ZIP | 更新能力说明和版本 | 计划发布 1.4.0，声明 narrativeMotionVersion: 1；含新公共支持和字体；不含本期专属业务图解 |
| video-worker/src/runner/prompts.ts | 精简增补 | 指向新操作流程；明确待修订继续，不在主 prompt 复制整套方法 |
| video-worker/src/infrastructure/host-processes.ts | 核对，通常无需修改 | 新能力位于已开放的工具文件；不为参考放开整个历史工程 |
| video-worker/scripts/runtime-manifest.mjs | 核对覆盖清单 | 当前已有文件会被纳入；若实施拆出新工具模块才增加清单和只读路径 |
| tests 与 video-worker/tests | 新增/调整有效回归 | 详见第 12 节；不能只测试字段和提示词出现 |

以上清单描述后续开发范围，本次没有修改其中任何运行代码或 Skills。

## 10. Skills 具体替换文本

本节内容在文档审阅通过后的开发阶段写入对应文件。未提及的权限、配音、素材、字幕、片尾及交付契约继续保留。不得把本节原样追加到旧指令末尾造成两套要求并存。

### 10.1 video-pipeline/SKILL.md：替换“正文图解制作”整节

其后的“权限与输入”及其现有规则保留。以下为实施时写入的完整替换文本；stills、motion-evidence、visualCues 和 revision_required 依赖第 5～8 节计划开发的能力，本次仅提供方案。

~~~markdown
## 正文视觉创作

Render 对本期画面的解释效果负责。先阅读完整原稿和确认口播，
再按 references/motion-design.md 完成视觉设计、实际画面、运动编排和修订。

视觉创作方法适用于当前任务。以下 visualCues、stills、motion-evidence 和审查字段的具体接口，
用于冻结模板声明 narrativeMotionVersion: 1 的任务，格式见 references/two-stage-contract.md。
能力声明从原始冻结模板读取，不能在任务副本删除后跳过。
其他模板使用自己的实际时间和预览接口，不能套用不存在的财经字段。

章节用于组织内容，逐句 MP4 用于交付，二者都不决定一张图应该保持多久。
根据讲解含义的变化组织连续画面：介绍新对象、建立比较、解释原因、
进入局部、改变数量或得出结论时，判断画面需要怎样回应。
口播仍在解释同一个结果时，可以稳定保留画面。

栏目人物、字体、配色、字幕、导航和品牌资产继续复用。
正文的对象、图形、构图及运动由本期内容决定。
现有组件准确适合时使用；不适合时在本期工程实现，通过 visualExtensions 接入。
不能把选择组件名称、写完设计描述或生成可播放视频当作完成设计。

参考片和 references/motion-reference-cases.md 提供可借鉴的方法。
先形成基于本期内容的设计判断，再查阅对当前难点有帮助的案例。
没有适用参考时，继续用内容关系、栏目风格和已有渲染能力完成设计。
不得为了套用参考而补出不存在的数据、关系、对象或剧情。

配音前保存设计草案，不制造正式帧时间。
配音实测并建立正式时间轴后，使用 timeline.visualCues 将动作绑定到真实口播，
由 derive-timeline 派生 resolvedVisualCues，供组件和预览检查共用。
本轮按实际短句边界同步，不按字数或句长比例推算词级位置。

关键画面必须由本期实际组件、正式时间轴及实际 props 渲染，
不能只交文字分镜或另外制作的示意图。
用 stills 生成关键状态，实际查看构图后再完善运动；
用现有单镜 render 生成真实候选，用 motion-evidence 展开变化过程，
实际查看图片与原稿对照后修订。

批量导出前，检查本期尚未验证的表达方法和重要转折。
检查既要对照设计查看执行是否正确，也要回到原稿查看解释是否遗漏。
不能只检查自己已经写出的动作，从而漏掉根本没有设计的讲解阶段。

发现表达、构图或节奏问题时，在现有审查记录中使用 revision_required，
继续修改当前工程并复查受影响区间，不写任务完成或失败终态。
有效音频、素材和已通过的段落优先复用。
只有共享能力缺陷、授权、未知收费结果或既有预算边界阻止任务继续时，
才按原失败处理规则结束。

记录实际检查方式：关键帧、连续帧、视频观看和试听分别说明。
读取视频文件或解码音频不等于实际观看和试听。
程序检查文件、时间与版本；Render 依据原稿和实际画面判断表达质量。
~~~

### 10.2 production-flow.md：替换创作、预审和最终审查的相关段落

先替换“正文图解创作”整节；其后的模板自适应、配音和已部署片尾流程保留。

~~~markdown
### 正文视觉设计、实现与修订

先读取 references/motion-design.md，按照以下顺序推进本期制作。
各步骤结果写入已有 direction.json、章节 brief、本期工程和审查资料，
不另建一套业务阶段协议。

以下具体接口面向冻结模板声明 narrativeMotionVersion: 1 的任务。
先读 references/two-stage-contract.md 的“正文动效制作合同”，准备当前 run 的 scenes.json。
它复用现有批量作业数组；单镜预览、取证和冻结使用同一作业配置与输入摘要。
未接入此合同的模板继续采用自身时间与预览接口，仍执行适用的设计和修订原则。

#### 理解讲解推进

从完整原稿理解上下文，以确认稿作为实际口播。
按观众理解过程组织视觉段落，标出每次新增的含义：
当前在介绍什么、接着解释什么、观众最后需要记住什么。

一个视觉段落可以跨多个确认分镜；一个章节也可以包含多个视觉段落。
不要默认一章只设计一幅图，也不要默认每句话都清空画面换图。
给每个有用的画面变化找到对应口播；给每段重要讲解找到视觉解释。
单纯复述上一结果的句子可以共用同一完整画面。

在 direction.visualUnits 和需要展开的章节 brief 中记录设计决策及依据，
不要只写“关系逐步建立”等笼统语句。
若某段保持静态，说明它正在帮助观众阅读或理解什么；
若增加运动，说明运动揭示了什么关系或变化。

配音前使用确认 sceneId 和原文片段定位，只保存设计草案。
配音实测后绑定实际 utteranceId，建立正式 timeline 和 visualCues。
不要为了先渲染关键状态而创建假音频时间轴。

#### 绑定真实配音，完成可渲染关键画面

使用本次真实 utteranceId、音频摘要及起止窗口编排时间轴。
visualCues 的 anchor 指向真实短句的 start 或 end；
durationSeconds 表示本次设计期望的动作速度，
需要在下一语义事件前完成时通过 finishBefore 表达。
derive-timeline 调用统一解析方法生成 resolvedVisualCues，
派生结果进入工程和各镜 props，不回写正式源 timeline。

先在本期实际组件内实现关键状态，包括进入时、重要转折后、最终可读的状态。
关键状态数量取决于讲解，不设固定配额。
组件接收 block 局部 frame 和属于本 block 的 cues，
从 cueProgress 得到进度，再决定实际图形与样式。
关键状态、运动预览与正式成片使用同一份状态计算。

根据真实正文区域、字体和栏目保留元素计算布局。
使用 stage_media.py stills，从正式 Composition、实际 props 和有效镜内帧渲染图片。
图片保存在 render/<runId>/previews，不能另画一张与正式实现无关的图来代替。

实际查看图片，检查视觉主次、对象身份、数据尺度、阅读顺序、
标签关系、字幕与人物留区，以及常见播放尺寸下是否可读。
画面拥挤时先减同屏信息或拆开解释；图意不清时先改图形；
不要直接通过缩小全部字号或增加装饰掩盖问题。

构图改变后同步修改后续状态，检查同一对象怎样连续进入新位置。
关键状态成立后，再完善连接这些状态的运动。

#### 把设计落实为具体动作

每个承担解释的动作要说清：触发它的口播含义、参与对象、
起止状态、变化属性、先后或并行关系、完成后的保留状态，
以及它与下一讲解阶段的衔接。

“关系逐步建立”“增强科技感”“突出重点”不能作为最终动作说明。
说明要足以直接实现：哪条路径从哪里画到哪里，哪个对象移到哪里，
哪些数值控制长度，哪些标签跟随，当前重点改变时旧内容如何保留。

同一时刻的动作围绕一个明确的主要关注点组织。
相关对象可以同步变化，不要求按固定间隔逐个入场。
装饰动作不得拖延信息出现，也不得挤占理解结果所需的时间。

本轮使用真实短句边界，不开展未经接入和验证的词级对齐。
新配音可沿自然语义停顿拆短句，所有短句顺序拼合仍须等于确认文本。
已有有效音频优先复用；只有句级记录时采用句级可以准确表达的编排，
不得按字数、字幕宽度或句长比例冒充词级同步。

本期组件使用已派生的 cues，不在组件中重新搜索句子或估计时间。
修改配音、声音覆盖或全局时间轴后，重新 derive 并更新全部派生 props。
不能只移动 timeline，却继续使用组件内部保存的旧时间。

工具因窗口变短而压缩动作时，会返回实际时长信息。
Render 应看画面决定是否去除装饰、合并步骤、缩短移动距离或直接呈现结果，
不能把有效数值误当成效果已经合格。
窗口较长时，展开稿件已有的后续解释，或保留当前可读结果；
不把一次入场拉长到整句话，不无意义循环。
不能为了动画增添静音、推迟口播或改动确认稿。

#### 用实际结果检查并修订

从本期尚未验证的关键设计中选择候选预览区间。
选择依据是要验证的问题，例如数值方向、对象重排、条件关系、
跨分镜连续性或新的文字密度，不以固定的一个或两个样片结束检查。

使用现有单镜 render 从真实工程、props 和音频导出完整候选分镜；
跨镜运动导出相关的多条分镜。本轮不假定已有局部 frameRange 导出接口。
准备轻量 media-index，调用 stage_media.py motion-evidence。
工具从正式 timeline 和实际 MP4 取得事件前、中、后画面及口播概览，
输出到 render/<runId>/previews；Render 必须继续实际查看这些图片与索引。

按两个方向检查：
从原稿出发，看每个重要含义是否得到准确解释，
有没有新的讲解已经开始而画面仍停在上一意思；
从实际动作出发，看方向、状态、连接、布局和触发是否符合设计。

写下具体观察及修改决定，不使用“整体较好”“已优化动效”作为结论。
说明哪句对应的结果提前出现、哪条连接误表达先后、
哪个中间状态文字重叠、哪个对象在跨分镜时重新播放。

有问题时，将 preflight-review.json 或 review.json 的 motion.status
记为 revision_required，说明观察、期望、修改层次和待解决问题。
继续修改本期设计或组件，重新派生受影响参数并渲染相关区间。
不要为修改画面无条件重做收费配音。

完成必要修订后，将通过的预览、当前 inputDigest 和审查结果关联起来，
设置 motion.status 为 ready。后续制作输入变化后，旧结果不得批准新版本。
预览和审查文件放在 render 下，不写入会被工程摘要扫描的 project 目录。

连续帧能够检查状态变化和语义对应，但不能冒充完整视频观看或试听。
真正使用媒体输入后再记录对应检查，未实施的检查如实写明。

#### 批量导出与最终复查

freeze-batch 检查当前 preflight-review 及对应证据。
返回 revision_required 时，继续修订；该返回不是冻结成功，
不继续调用 render-batch，不写任务失败或完成终态。
得到有效冻结清单后，再按现有批次调度、锁和版本规则导出。

批量完成后对最终 MP4 重新生成需要的 motion-evidence，
检查全部正文 visualUnits、关键动作、分镜连接、字幕和结尾。
预览合格不能自动证明最终合成文件与预览一致。
review.json 的 motion 必须指向当前成片证据；通过前置预览的记录不能直接冒充最终审查。

正常的设计修订不立即终止任务，也不绕过已有任务锁、预算或取消规则。
共享工具缺陷等确实阻止继续时，保存证据并按既有错误处理返回。
~~~

在“主控编排与章节并行”中，将“主 Render 分三步验收……”所在段落替换为：

~~~markdown
主 Render 先检查章节设计能否解释原稿，再查看由候选组件实际渲染的关键状态，
随后检查绑定真实口播的变化过程，最后合并已通过修订的候选。
章节自己标记通过不能替代主控检查。

章节 brief 保留要解释的原稿含义和关键状态，
使主控能够发现候选根本没有实现的讲解阶段。
主控不能只核对章节提交的动作列表，因为动作列表本身可能遗漏内容。

预览由主控统一派发时，章节提交真实待检区间和检查目的。
主控读取实际产物后记录观察；未查看的素材不得登记为已审查。
过期版本只作为历史资料，不能覆盖当前版本的结果。

章节边界和逐句输出边界都要检查对象连续性，
不因重新进入另一条 MP4 而重复播放已经完成的动作。
发现问题后主控组织当前工程修订，不把章节的 revision_required 当成整个任务故障。
~~~

在“渲染前检查”中保留输入、声音、字幕、素材复用的硬要求；将实际静帧、动态检查及不通过处理三条替换为以下段落：

~~~markdown
使用当前实际时间轴和派生 props，经 stage_media.py stills 生成关键状态图，
实际查看文字、人物、字幕、图形与转折状态。
候选分镜经现有 render 导出，再经 motion-evidence 形成变化序列及口播索引。
依赖继续使用当前环境 modules，不另找历史工程或安装软件。

preflight-review.json 的 motion 记录本次实际检查的 inputDigest、
evidenceIndex、真实查看的证据、原稿对应、检查方式、问题和修订结果。
字段含义服从当前制作资料格式，不手填另一份估计抽帧时间。

检查范围同时来自原稿中的重要讲解阶段和实际组件动作。
首中尾用于总体覆盖，不能代替发生在两次抽帧之间的动作检查。
围绕关键事件查看开始前、变化中和完成后的画面，
必要时增加中间采样以判断路径、重排或遮挡。

发现错误关系、错误数值方向、遗漏讲解或明显不可读时，
保存 revision_required 并继续修复，完成后重验；
不得写进 limitations 后同时标为 ready。
没有开放问题且当前证据足以支持结论时才设置 ready，
不为凑检查数量制造问题，也不以图片数量代替判断。

程序核对证据文件、版本和时间的一致性。
Render 负责依据原稿和实际画面判断表达，不能用字段齐全代替判断。
音轨仍须独立测量、解码并核对总时长；测量不等于试听。
~~~

在“最终候选与确定性检查”中，替换“同时写视觉审查 JSON……”段及“通过后输出……”段；其他 manifest、整片合成和调用格式保留：

~~~markdown
同时写 review.json：保留任务、run、阶段、确认摘要、逐镜视频摘要、
真实看过的帧号、检查结论、备注和局限，并按当前 schema 写入 motion。
最终审查覆盖全部正文 visualUnits，以及正文、固定结束语和片尾的实际衔接。
实际查看最终 MP4 的证据，不能用候选预览直接冒充最终成片检查。

制作中允许保存 passed 为 false、motion.status 为 revision_required 的记录。
发现问题后继续修当前工程，不写 completed；
已知问题不能仅记为 limitations 后仍宣布通过。
最终交付显式要求顶层及逐镜 passed 为 true、motion.status 为 ready、没有未解决问题，
并通过原有音视频、字幕、资源和技术验证。

assemble、validate 或 task_io.py render 返回 revision_required 时，
按其 scope、review 和 next 继续修订，不把该正常返回当成技术异常或交付完成。
真实异常仍按原错误码、定位、重试和预算规则处理。

所有检查通过后，使用 task_io.py render 生成当前消息的交付结果，
再返回其结果引用。不手写完成信封绕开共用制作检查。
这表示本地制作完成，上传与回调仍由 Worker 处理。
~~~

### 10.3 motion-design.md：替换正文方法，保留已有片尾整节

替换从文件开头到“正文最终状态、固定结束语与片尾”之前的内容。该片尾整节原文保留。

~~~markdown
# 正文视觉设计与运动编排

本文件指导 Render 独立完成本期正文视觉创作。
参考案例帮助发现方法，内容理解、构图、运动决策及修订由 Render 自己完成。
没有合适参考时，仍应继续完成设计。

栏目包装规定节目身份：人物、字体、配色、字幕、导航与品牌资产。
正文设计负责解释本期内容，栏目统一不意味着所有章节使用相同文字框。

## 一、先决定观众需要看懂什么

阅读完整段落及上下文，找出观众理解的推进：
先知道哪个事实，接着需要哪种解释，最后形成什么认识。

区分内容中的关系：前后数值、整体与部分、同维度对比、空间位置、
先后步骤、原因与结果、条件与分支、依赖关系以及观点论证。
这些关系可以组合，不是必须从菜单中选择的固定类型。

逐句检查新增含义，而不是每句固定增加一个动作。
重复说明同一结果时可以保持完成状态；
进入新的解释时，判断是否需要新对象、局部展开、重排、连接或重点转移。

设计目标描述观众将看懂的内容，
例如“看清总量没有变化，但两部分进入了不同处理路径”。
“增强科技感”“丰富动画”“突出重点”不能代替解释目标。

保留数据和语义边界。
两个真实端点不自动构成历史趋势；并列对象不自动构成流程；
可能发生的条件不能画成已经完成的事实；没有数值时不编出比例填图。

## 二、选择表现方式并说明理由

根据解释目标考虑图表、结构示意、图片局部、空间关系、动态文字或组合画面。
选择依据是观众能否直接看懂关系，而不是现有组件名称。

数量由共同尺度上的长度、面积、角度或位置表达。
组成由整体和部分之间的对应表达。
对比必须有共同维度，差异与结论可分步出现。
因果要有可信方向；条件要体现未满足与已满足的区别。
论点或引文可以使用排印，但不要把整段旁白复制进卡片充当解释。

当一个表现方式存在明显语义风险时，记录并改用更合适方式。
不要求每段准备固定数量的候选，也不为证明思考过程堆积无用方案。

参考资料只解决当前设计中的具体问题。
可借鉴如何保持对象、从整体进入局部、建立路径或重排构图。
不能照搬原作数据、行业对象、对象数量或固定时间。
找不到合适参考时，直接用已有图形与排版能力实现自己的设计。

## 三、把关键画面真正画出来

配音前只保存构图和状态草案。
真实配音、正式 timeline 和派生 props 已确定后，
在本期实际组件中实现关键状态，再使用 stills 渲染对应有效帧。
不要为草图另造一份正式音频时间轴。

先确定正文区域的实际尺寸和栏目保留区域。
给主图足够空间，明确第一眼看的对象以及继续阅读的方向。
不要习惯性增加一层大容器，再把所有内容塞进多个小框。

关键状态说明进入时建立什么、讲解转折后改变什么、完成时留下什么。
同一对象在这些状态中保持身份，标签、颜色和数据含义保持稳定。
关键状态和运动都由同一实际组件计算；单独画出的示意稿不能代替检查。

使用模板实际加载的中文字体检查标题、图中标签、数字和说明。
以实际文字和正文区域测量，不依赖英文短标签示例。
主体标签与辅助说明有清楚层级，重要信息不能靠极细字体和低对比颜色表达。
按常见播放尺寸检查，原尺寸可读不等于缩小播放后可读。

完整状态不好读时，先改信息数量、布局、标签和阶段安排。
空间不够时分阶段呈现或重排，不无限缩小文字。
同时检查转折中间状态，对象移动经过的位置也不能遮挡关键文字。

## 四、为状态变化编排动作

每次动作有明确对象和目的。
写清对象从什么状态变到什么状态，改变哪些属性，哪些对象同步，
当前重点如何建立，完成后保留什么。

可用属性包括位置、尺寸、角度、裁切范围、路径长度、连接端点、
数值、颜色、字重和透明度。按表达需要组合，不为展示技术堆叠。

长度变化表达数量变化时，数字与几何使用同一进度；
结构展开时，部分从可识别的整体或连接位置进入；
关系建立时，路径从正确对象出发，不提前泄露尚未讲到的结论；
对象重排时，使用同一对象连续移动，连接点随之更新；
重点转移时，旧信息保留必要可读性，使观众能回看关系。

透明度可以辅助出现，但不能把所有对象同步淡入当作完整讲解动画。
背景光效、粒子、浮动只用于栏目氛围，不承担正文解释。

运动的轻重与内容一致。
数值几何不得越过真实端点，严肃事实不默认使用弹跳；
需要观众读取的标签在运动完成后保持稳定。

## 五、将动作绑定到真实口播

规划时引用口播含义，配音后绑定实际 utteranceId 和真实音频窗口。
正式 timeline.visualCues 保存语音引用和本次期望动作时长，
derive-timeline 通过 resolve_visual_cues 派生 resolvedVisualCues。
组件与 motion-evidence 使用同一派生时间，不各自维护时间表。

本轮使用短句的真实 start 或 end 边界，不按章节长度平均分配。
没有句内准确位置时采用短句级能准确表达的编排，
不得用字数比例、字幕进度或阅读速度估计后宣称逐词同步。
可靠词级定位属于另行接入的能力，不在当前工程中自行假定存在。

设计决定改变什么；公共派生负责将真实口播位置变成执行时间；
组件从 cues 和局部 frame 计算进度，再决定图形与布局。
不要在每个组件里各写一套句子搜索或时间估计逻辑。

确定动作可用窗口时，考虑下一语义重点、图形可见区间及实际阅读需要。
需要在下一讲解点前完成时使用 finishBefore。
MP4 边界切开但图形连续存在时，不因边界强制结束或重启动作。

completeFrame 是完成状态第一次可见的帧，位于右开可见区间内。
局部 completeFrame 等于局部 startFrame 时是即时变化，
直接显示起点前或完成后的对应状态，不构造除零插值。

动作建立时间与结果读图时间分开安排。
可从短语揭示约 0.25～0.6 秒、路径建立约 0.4～1 秒、
数值变化约 0.5～1.5 秒、布局重排约 0.4～0.9 秒开始试做。
这些只是初始感受，不是最低时长、固定时长或验收标准。

短窗口时，先删装饰、缩短移动距离、合并相关动作，
必要时使用更直接的状态变化，避免连续步骤挤成闪动。
工具自动裁到有效边界后，也要检查压缩后的动作是否清楚。
长窗口时，继续解释稿件已有内容，或稳定保留结果；
不重复播放同一次变化，不把简单入场拖满整个窗口。
不得增加静音、推迟口播或延长无意义尾部来满足建议时长。

## 六、完整教学示例：总量拆分后进入不同路径

以下是虚构教学稿，只说明设计方法，不是生产模板。
以后的视频不要求采用这些对象、颜色、数量、构图或动作时间。

口播 A：“今天收到 100 份申请。”
口播 B：“其中 60 份资料齐全，另外 40 份还需要补充。”
口播 C：“资料齐全的先进入办理，待补材料暂时保留。”
口播 D：“补齐后，也会回到同一办理流程。”

### 1. 设计判断

观众需要理解总量、组成和条件分流。
只画四张文字卡会让观众自己记住 100、60、40 的关系；
连续递增柱图又会误说总量发生增长。

本例选择先显示整体、再拆分同一条形、最后展开处理路径。
100 份是整体；60 和 40 是同一整体的部分。
资料齐全与待补充不是好坏评分，颜色用于区分状态。
D 是条件说明，没有证明 40 份已经全部补齐，不画“已完成 40 份”的结果。

### 2. 关键画面

状态 A：
正文中心是一条表示 100 份的整体条形，
条形外显示“申请总量 100 份”，不提前显示处理结论。
条形宽度按正文有效区域计算，左右留出标签安全空间。

状态 B：
同一条形在 60% 位置形成分界，
左段表示“资料齐全 60”，右段表示“待补充 40”。
数字、分界位置与共同尺度一致，总宽度保持不变。
右段使用栏目协调的辅助色，避免红叉等“失败”暗示。

状态 C：
保留两部分身份与数量。
左段向办理区域移动，并用实线连接到“办理”；
右段保持在待补区域，标签随对象移动。
两个区域保持共同来源，不画成先后步骤。
构图由“一个整体”转成“同一来源的两条路径”。

状态 D：
从待补区域建立通向同一办理区域的条件路径，
路径旁标注“补齐材料后”。
条件路径与已经发生的实线路径区分，待补的 40 份仍保留原状态。
最终同时看见总量来源、分流及回到同一流程的条件。

这些状态先作为配音前草案。
实际配音完成后为 A、B、C、D 建立真实时间及所需 visualCues，
用同一组件在各状态对应的有效帧渲染图片，再检查和调整构图。

### 3. 具体运动

A：
整体条形和名称形成一个阅读组，主信息先可读。
不让数字从零慢慢增长而造成“申请正持续到达”的额外含义。

B：
分界从条形内部显现，标签分别定位到两部分。
总宽不变，只改变分段与强调；确认两部分关系后稳定停留。
避免两段从零独立增长导致丢失整体关系。

C：
左段连续移到办理区域；右段同时移到待补区域，为路径腾出空间。
先计算两个完整布局，再对对象位置插值。
数量标签与所属部分一起移动，连线端点由当前对象位置计算。
实线在移动接近完成时建立，避免穿过移动中的标签。
窗口很短时，重排与连接合并为一次动作，不先后排队。

D：
条件路径从待补区域向办理区域绘制，条件说明随当前路径形成。
不让 40 份全部滑入办理区，也不把待补数字动画到零。
重点转向条件路径，已有办理路径降低强调但保持可读。
完成后保留整个逻辑关系。

### 4. 短音频与长音频

使用 B 到 C 的本次真实间隔安排拆分与读图，不写死 B 的绝对时间。
若间隔仅约 0.7 秒，可以用约 0.35 秒完成分界与标签建立，
省略辅助括号和额外强调，随后保留结果。
若间隔约 3 秒，可以用约 0.6 秒完成相同变化，
其余时间稳定显示 60/40，不把拆分拖到 3 秒结束。
这些秒数只示范两次实测情况的设计决定，不进入共享模板默认值。

C 的窗口短时，重排和实线建立同步；
较长时，可先完成重排，再让视线沿实线进入办理区域。
无论实际配音怎样变化，C 都锚定到 C 的真实口播，D 都锚定到 D，
不能根据整段时长平均分为四份。
更换真实音频后重新 derive，查看同一设计的节奏，必要时调整本期动作速度。

### 5. 查看结果后修改

第一版预览可能暴露以下问题。

问题一：待补区域使用红叉，观众容易以为申请失败。
修改：改为中性待补状态，删除红叉，保留条件说明。

问题二：D 开始后 40 份全部移入办理区。
这把“补齐后会进入”画成“已经全部补齐”。
修改：保留待补数量，只建立有条件的回流路径。

问题三：两个部分移动时标签重叠。
修改：调整两个终态间距和移动路径，缩短图中标签；
重新看移动中间状态，不能只看最终排版。

问题四：B 的拆分在 A 期间已经完成。
修改：检查 visualCues 锚点、派生结果和组件取用的 cue；
B 之前保持整体状态，B 发生后才执行拆分。

问题五：C、D 口播期间画面一直停在 60/40 条形。
修改：这不是调整淡入速度能解决的问题。
补上处理路径和条件回流这两个讲解状态，再实现对应动作。

将实际发现的问题保存为 revision_required，继续修订。
修改后重新渲染候选，经 motion-evidence 取得事件前、中、后画面，
对照原稿检查，记录解决证据；不能因新增几条连接就自动标记 ready。

## 七、实现与检查

在本期工程编写真实组件，通过 visualExtensions 注册。
关键状态、预览与正式视频使用同一组件、同一数据和同一状态计算。

所有状态由传入帧确定，不使用实时钟、CSS animation 或 CSS transition。
扩展收到 block 局部 frame 时，不能再减一次 block.startFrame。
cueProgress 使用同一局部坐标的 localStartFrame、localCompleteFrame。
跨分镜持续存在的图形不得在每条 MP4 开头重置。

数字、路径、位置和标签从共同进度或状态计算；
同一对象使用稳定身份，不用反复删建模拟连续重排。
数值插值夹紧到真实端点，零时长有明确完成状态。

审阅从两边进行：
从原稿逐段检查重要含义是否被解释；
从实际画面逐动作检查错误信息、错位触发、遮挡或重复播放。

实际查看关键状态、转折的连续帧和整段概览。
有真实视听输入时，再看完整运动并试听；
每种检查能证明什么就记录什么，不能把抽帧称作已播放。

失败的构图要重排，错误关系要重画，缺失解释要补状态，
触发错误才调整时间。不要把所有问题都归结为“动画不够多”。

完成设计的依据是本期内容得到清楚、连贯、准确的表达，
不是动作数量、动效种类数量、字段数量或自动美学分数。
~~~

### 10.4 remotion-best-practices/SKILL.md：替换动画与预览两节

保留现有技术路由与其他规则。将“设计与实现动画”的中文段落替换为：

~~~markdown
## 设计与实现动画

技术实现接收明确的视觉目标、关键状态和真实口播事件。
正式音频时间轴确定后，用实际组件、正式 props 渲染关键状态，
再完善状态间运动。静帧、预览和正式视频使用同一实现。

关键状态不构成另一个动画解释器。
本期组件直接计算图形、对象位置、连接和标签；
公共能力负责时间派生、坐标约定与确定性渲染。

数据变化读取 rules/data-animation.md；
节点关系、结构展开和布局重排读取 rules/diagram-animation.md；
排印与文字揭示读取 rules/text-animations.md；
按需继续读取 timing、sequencing、transitions、measuring-text。

接入 video-pipeline 正文动效合同的任务，本期扩展接收 block、block 局部 frame 和 cues。
cues 来自 timeline.visualCues 的统一派生结果 resolvedVisualCues。
组件使用 cueProgress 取得进度，再映射到自身几何与样式。
不均分章节，不在组件内按文字长度推算词级位置。
同一图形跨交付分镜时继续使用其连续时间，不重新播放。

所有动画由当前帧确定，使用 interpolate、spring 或其他确定性计算。
上层传入局部 frame 时直接使用，不再减一次组件起点。
零时长变化单独处理，数值插值两端夹紧到正确状态。

同一对象的数字、几何、标签和连接点使用共同状态计算。
数值动画不得越过真实端点，位置重排检查中间路径。
上层已有入场时，不再无意叠加第二层淡入或位移。

帧率读取当前 Composition 与输出规格，不在本期组件内另写固定帧率。
声音和时间轴改变后重新 derive；不得只移动时间轴却保留旧数值时间。

不使用 CSS animation、CSS transition 或依赖实时钟的动画。
资源目录和引用继续遵循当前工程约定。
~~~

将“预览与修订”整节替换为：

~~~markdown
## 预览与修订

接入正文动效合同的无人值守 video-pipeline 使用真实入口、Composition、props 和音频生成预览，
不要求启动 Studio 或安装额外软件。
关键状态使用 stage_media.py stills；候选仍通过现有单镜 render 生成，
motion-evidence 从实际 MP4 和同一口播事件取得连续帧及索引。
输出放 render/<runId>/previews，不写进正式工程目录。
未接入该合同的项目用自身现有预览工具落实以下检查，不调用尚未提供的接口。

检查关键状态的构图与可读性；
围绕口播事件检查动作前、过程中、完成后的画面；
从原稿检查未被设计覆盖的新含义；
检查连续分镜边界，避免对象重置或重复入场。

布局重排查看对象最可能交叉的中间状态；
数值变化查看前值、方向、终值和共同尺度；
路径建立查看起点、连接对象、方向及提前出现的标签；
条件关系查看是否把可能发生误画成已经发生。

发现问题后改变对应设计或实现，再预览受影响区间。
数据方向错误不能靠缓动修好，语义遗漏不能靠背景运动补齐，
构图拥挤不能靠统一缩小字号解决。

记录实际检查方式和局限。
连续帧能帮助判断状态与语义，不等于完整视频观看或试听。
真正使用媒体输入后再记录视听结果。

先解决已发现问题，再批量渲染。
video-pipeline 使用 revision_required 继续当前工程修订；
其他项目服从自己的既有流程，不由本技术 Skill 决定发布或任务终态。
共享依赖或工具缺陷按所属流程报告，不能删除检查或修改通过状态求交付。
~~~

### 10.5 数据、关系与文字规则：精确补充和替换

在 rules/data-animation.md 的“运动”之前增加：

~~~markdown
## 从讲解阶段到数据状态

先确认口播在讲当前值、前后变化、组成还是比较。
不同含义使用不同状态，不能把所有数值都做成从零增长。

讲前值时保留前值，讲到变化后才向后值移动。
讲整体时建立共同尺度；讲组成时让部分与整体有连续关系。
前后值来自同一对象时，保持对象身份和单位，
必要时保留弱化前值轮廓，但不得增加无依据的历史走势。

接入 video-pipeline 正文动效合同时，实际触发使用扩展输入 cues 中的派生事件，
从 cueProgress 取得进度，数字与几何使用同一当前值。
预览查看触发前是否泄露后值、方向是否正确、
数字与几何是否一致，以及最终结果是否有可读时间。
~~~

在 rules/diagram-animation.md 的“运动时间与实现”之前增加：

~~~markdown
## 语义先于路径样式

先判断两对象间是先后、因果、并列、包含、依赖还是条件。
内容确实存在方向时才使用方向箭头。
多个并列应用不因为排在一行就连接成流程。

条件分支保留条件；尚未发生的结果不能用对象全部转移、
计数清零等方式画成已完成。
对象、标签、连接和颜色共同表达含义，不能只检查线是否连上。

结构展开要让观众看得出新对象从哪部分而来；
布局重排保留原对象，使前后关系可追踪。
接入 video-pipeline 正文动效合同时，状态变化从 cues 取得派生时间；
其他工程使用自身已核对的时间输入。几何与关系仍由本期组件决定。
完整画面与变化中间状态由同一组件渲染后检查。
~~~

将 rules/text-animations.md 的“字体与检查”整节替换为：

~~~markdown
## 字体、层级与实际预览

使用当前模板已经加载的本地字体和排印样式；财经模板可引用 typography。
测量文字前等待真实字体加载完成，确认需要的字重存在；
只改 font-family 名称不代表该字体已经可用。

标题、主要图中标签、数字、单位和辅助说明分别建立层级。
主要信息保持清楚字重与对比；辅助说明减弱强调但仍可读。
字号随当前正文区域决定，不把教学示例的字号作为通用限制。
不要用一列细小文字与换行箭头代替本应由关系图表达的结构。

中文按实际文字、行宽和字体测量，按 measuring-text 处理。
字体替换或字重改变后重验换行、连接位置和遮挡，
不能沿用旧字体生成的通过截图。

揭示与强调绑定相关口播时间；接入正文动效合同时使用 cue，完成后保持稳定可读。
同一行文字移动或裁切时，先确定最终排版，再改变遮罩或位置，
避免运动过程中重新换行。

通过正式组件的关键状态和实际变化序列检查；接入该合同时用 motion-evidence：
完整状态、中间状态、揭示边缘裁字、标签跟随、
对比层级和读取结果的时间；同时以常见网页播放尺寸查看。
原尺寸可读不代表缩小播放后可读。

文字太多时先调整展示标签、布局和阶段；
图中说明可以提炼，完整口播和字幕不能删改。
字幕继续按模板和真实短句边界独立显示。
~~~

### 10.6 motion-reference-cases.md：调整用途与新增栏目参考条目

替换文件开头说明，并在现有外站条目之前增加“当前栏目参考”段落。原有具体外站来源保留，开发时再按实际查看的材料补深拆解，不凭记忆伪造作者的设计过程。

~~~markdown
# 正文动效参考案例

本文件是设计方法的辅助资料，不是每期视频的组件菜单。
先理解本期内容并形成初步设计，再选择能解决当前具体问题的案例。
没有适用案例时，按 motion-design.md 独立完成设计。

参考当前栏目所选视频，学习字号层级、线条、留白、对象保持与解释节奏。
参考片自身的不足不自动成为本期要求。
外部案例用于补充表现方法，不要求每期查阅或采用。

使用案例时写清本期遇到什么问题、原作怎样处理、自己借鉴哪一部分，
以及因本期语义和真实配音改变了什么。
来源名称、截图或关键词不能代替设计判断。

## 当前栏目参考

财经模板的参考片为冻结包中的
assets/video/reference/financial-report-dialogue-v3-final-cut-preview.mp4。
它对应原始工程 FinancialReportDialogueV3.tsx；examples/hello-world 是原工程目录名。

参考片采用不同图形表达不同内容，并展示分批加入、曲线绘制、
时间轨道和指标切换。可学习同一对象保持、不同内容采用不同主图，
以及先建立焦点、再补充解释的组织方式。

其中部分章内动作采用固定偏移，可能早于相应口播出现。
本期动作仍使用自己的 visualCues 与真实配音，不复制原作帧表。
不沿用原作正文、历史数据和配音。

只使用任务可读范围内的参考文件。
原工程目录不在当前只读输入范围时，不把该路径当作已读取实现，
也不为此停止创作；继续查看获准参考片并根据内容独立实现。

## 查阅案例时的拆解方法

先描述完整画面承担什么解释，再记录关键状态如何连接。
看清对象怎样保持身份、主次如何改变、文字怎样配合图形，
以及完成状态怎样承接下一句话。

若查看源码，区分数据映射、布局和时间控制。
源码中出现某个动画 API 不等于理解了原作设计，也不等于本期必须使用它。
原作数字和帧数仅用于理解原作，本期使用真实数据与实际音频重新设计。

记录哪些方法不适用于当前内容，避免为套效果改变语义。
公开示例代码按当前工程整理和编译验证；读到源码不等于已经运行成功。
~~~

### 10.7 technical-routing.md：完整替换文本

保留工具和业务职责边界，显式声明新接口。以下文本应与第 7 节待开发工具同时发布，不能先把尚未实现的命令放到运行中的 Skill。

~~~markdown
# 技术路由

visualCues 与新制作审查合同首先接入声明 narrativeMotionVersion: 1 的冻结模板。
实际字段、工具参数和返回见 references/two-stage-contract.md 的“正文动效制作合同”。
其他模板先确认自己的接口，不把财经数据结构作为所有工程的前提。

本地完整制作和 Worker Render 共用下列方法。
先确定当前需求，再读取对应资料，不默认加载全部参考。

| 需求 | 共用入口 | Worker 适配 |
| --- | --- | --- |
| 正文设计与连续讲解 | video-pipeline/references/motion-design.md | 根据本期含义设计关键状态、构图与运动 |
| 参考表现方法 | references/motion-reference-cases.md 与冻结栏目参考片 | 按当前问题选用，无专门参考也继续创作 |
| Remotion 工程、时间与转场 | remotion-best-practices/SKILL.md，按需 timing、sequencing、transitions、audio | 使用当前依赖，不启动 Studio、不安装软件 |
| 数据图与数值变化 | remotion-best-practices/rules/data-animation.md | 真实数据决定几何，派生 cue 决定时间 |
| 关系、结构与重排 | remotion-best-practices/rules/diagram-animation.md | 本期工程实现，经 visualExtensions 接入 |
| 中文标题与关键词 | remotion-best-practices/rules/text-animations.md、measuring-text.md、local-fonts.md | 使用模板实际字体与字重，字幕独立 |
| 栏目人物与字幕骨架 | 冻结模板 renderer 与 renderer-manifest.json | 复制到 project 后实际导入复用 |
| 配音 | production-flow 的短句配音步骤、stage_tts.py | 保持确认文本，复用有效音频 |
| 正式时间与事件派生 | actual_timeline.py 的 resolve_visual_cues、derive-timeline | 由 visualCues 和真实 utterance 派生，不回写源 |
| 关键状态静帧 | stage_media.py stills、render_scene.cjs 的 stills 模式 | 正式工程和 props 渲染，输出到 render 下的 previews |
| 候选分镜与正式渲染 | stage_media.py render、render_scene.cjs | 使用真实工程、Composition、props 和实际帧数 |
| 讲解与动作连续帧 | stage_media.py motion-evidence | 从当前 MP4、timeline 和 direction 生成画面及口播索引 |
| 探测、混音、解码、拼接 | ffmpeg/SKILL.md、stage_media.py、FFprobe/FFmpeg | 走现有受控执行、预算和清理流程 |
| 制作修订与交付检查 | preflight-review、review、freeze-batch、validate、task_io.py render | revision_required 继续修改，ready 后再推进 |
| 固定结束语与片尾 | 实测时间轴 → derive-timeline → render_scene 末镜最终合成 | 正文末态保持到口播结束，随后追加完整本地片尾 |
| 封装覆盖恢复 | extend-timeline → derive-timeline | 仅补画面覆盖；新 cue 保留引用并重新派生 |

stills 使用实际时间轴中的有效帧，不为预览另造假时间轴。
motion-evidence 只提取并组织真实媒体证据，不选择图解、不生成美学评分。
Render 必须实际查看图片和对应原稿，工具返回路径不等于已经审阅。
连续帧检查不能冒充完整视频观看或试听。

本轮财经口播与动作使用真实短句边界。
不按字数猜词级时间，新配音可按自然停顿拆短句，已有有效音频优先复用。
实际 fps 与时间坐标取当前任务，不套用教学示例帧数。

新动作使用 visualCues；derive 输出 resolvedVisualCues。
组件收到 block 局部 frame 与 cues，使用 cueProgress，
不重复减起点，不在跨 MP4 时重启动画。
extend 或声音变化后重新 derive，不复制第二份数值事件表手工维护。

当前工程的动画、数据、布局和时间问题在任务内修复。
revision_required 是正常制作反馈，不是新的网页状态，也不是技术异常。
真实工具、依赖或协议缺陷按既有流程只读诊断，不能修改公共工具求通过。
所有修订仍服从现有任务锁、取消、收费与总预算。

技术示例位于已允许读取的 Skill 目录。
未挂载的公共 lib 或历史工程不属于可用依赖，
不能只给 Worker 一个不可读的原始 examples 路径。
参考只辅助设计，不成为扩大任务权限或必须访问其他工程的理由。

浏览器沿用 REMOTION_BROWSER_EXECUTABLE。
模板允许的只读 sentenceAudioValidator 仅用于句级检查，
不因此执行任意模板脚本。依赖保持当前环境锁定版本。

固定结束语与片尾按 production-flow 执行。
先建立真实口播时间轴和正文保持位置，计入完整本地片尾长度，
再 derive、预览、冻结和渲染。
render_scene 在末镜 mux 前完成片尾追加，返回最终 MP4 与完整 PCM；
assemble 按原顺序合片，不在正文 scene.outro 播放片尾。

技术检查不替代构图、运动和内容判断。
最终规范出口统一通过 task_io.py render，不启用另一条默认交付入口。
~~~

### 10.8 task-io.md：替换 Render 转换说明与终态处理

保留读取入口、prepare、Analysis 命令、结果格式和 Worker 发布边界。将 Render 命令后的“此转换器显式调用……也可……直接生成结果”整段替换为：

~~~markdown
此转换器显式调用 toolkit 的技术与制作检查，再生成客户端 dataList。
Render 规范出口统一通过 task_io.py render，不手写 completed 结果绕过检查。
Worker 继续处理任务信封、交接、上传和回调，不接管本期创作判断。

完成前，按 production-flow 保存当前版本的 preflight-review 和 review，
实际检查本期画面、口播对应及结尾，并解决已发现的问题。
review 必须与当前工程、真实音频、timeline、MP4 及证据摘要一致。

task_io.py render 或其调用的 assemble、validate 返回 revision_required 时，
表示当前工程仍有制作工作，不表示任务完成或任务失败。
读取返回的 scope、review 和 next，继续修改本期工程、重新派生与预览，
更新审查后再调用相同规范出口。
该返回不会写 completed 交付信封；不得根据一次工具返回就结束本轮。

技术错误仍依据实际错误码定位和处理，不把所有异常改成普通修订意见。
共享缺陷、授权、未知收费结果及预算边界继续使用原处理规则。
有效音频、素材和其他合格产物保留，不能为一次画面修订清空缓存或收费记录。
~~~

将“完成用 completed……仍有可执行制作步骤时继续……”段替换为：

~~~markdown
完成用 completed；明确需客户端或管理端处理用 needs_input；无法完成用 failed。
后两者 error 必须含 code、message，result 可为 null，files 可为空。
可用 task_io.py needs_input/failed 保存真实终态。

revision_required 只存在于内部制作返回和审查记录中，不写成客户端业务终态。
仍有可执行的设计、实现、预览或修订步骤时，继续当前 Render；
不得把正常创作反馈记成 failed，也不得在已知问题未解决时写 completed。
不能通过另起 run、重置记录或伪造 ready 绕过现有任务锁与预算。

最终 task_io.py render 已通过全部检查并生成结果引用后，
才返回本节规定的 resultFile 引用并停止写交付文件。
未经实际执行的观看或试听不得写成已完成检查。
~~~


### 10.9 two-stage-contract.md：新增“正文动效制作合同”整节

在现有“章节和冻结批次接口”之后增加以下全文。保留已有任务身份、确认、锁和收费规则。该资源随 Skill 部署，运行中的 Render 不需要访问本方案文档才能知道接口。

~~~markdown
## 正文动效制作合同

本节适用于 request.input.templateSnapshot 对应冻结模板声明
narrativeMotionVersion: 1 的任务。能力判断由工具读取原始清单，
不得通过修改任务工程清单退出合同。其他模板按自身已支持的接口制作。

创作方法见 motion-design.md，执行顺序见 production-flow.md。
本节只规定实际数据和调用边界。当前 run 指 request 对应的 render/<runId>。

### 1. 输入与输出位置

- direction.json 保留原有栏目和 ending，增加 visualUnits。
- timeline.json 是唯一正式时间源，保存真实音频边界与 visualCues。
- project/renderer/src/timeline.ts 和各镜 props 是 derive 的产物。
- scenes.json 在首次预览前准备完整有序数组，复用 freeze-batch --scenes 结构。
- previews/ 保存静帧、候选副本、过程图片和证据索引，不能写入 project。
- preflight-review.json 保存代表范围审查；review.json 保存最终全部内容审查。
- manifest.json 和最终结果仍使用原交付格式，不增加网页业务状态。

### 2. 设计字段

visualUnits 每项包含：
id、chapterId、utteranceIds、intent、facts、composition、states、actions、blockIds、reference。

id 在本期唯一；utteranceIds 与 blockIds 使用真实引用。
intent 说明观众要看懂什么；facts 列出必须正确表达的事实；
composition 描述主体、辅助信息及阅读顺序。
states 为 {id, description} 数组；actions 为 {cueId, description} 数组。
reference 可为 null，缺少参考不阻止创作。
字段不限制文字长度与状态数量，也不由程序解释成图形。

配音前草案用确认 sceneId 与原文片段定位，正式预览前换成实际 utteranceIds。
全部正文 utterance 均需有视觉用途：新的表达或继续解释已有状态。
固定结束语由 ending 管理，不要求伪装成正文 visualUnit。

### 3. 口播事件与派生时间

timeline.visualCues 是数组，每项字段为：

- id：事件唯一 ID。
- blockId：本期全局唯一的实际 visualBlock ID。
- anchor：{utteranceId, edge}，edge 只取 start/end。
- durationSeconds：有限非负数；0 表示有意即时切换。
- finishBefore：可选的 {utteranceId, edge}，限定最晚完成边界。

没有运动的稳定图形可以不声明事件，但要说明其解释作用。
不写固定章节偏移，不用字数比例猜长句内部的词级时间。
新配音可在自然语义停顿处拆为短句，不改变确认稿与交付分镜。

derive-timeline 通过 resolve_visual_cues 生成 resolvedVisualCues，
每项含 id、blockId、utteranceId、startFrame、completeFrame、
localStartFrame、localCompleteFrame。
start/complete 为全局帧，local 为相对 block 起点的帧；
complete 是完成状态首次可见帧，必须在显示区间以内。
计算采用 floor(durationSeconds × fps + 0.5)，不扩展镜头或音频。
最晚完成受 block 右开终点、finishBefore 和正文 holdFrame + 1 共同约束。

源 timeline 不保存可编辑的数值副本。extend 后或音频替换后重新 derive。
压缩动作时工具返回 recommendations：cueId、requestedFrames、
availableFrames、resolvedFrames 与原因；Render 查看实际画面决定简化或调整。
未知引用、非法时长、不可见事件和越界不得静默修正。

扩展组件接收 {block, frame, cues}；frame 已经是 block 局部帧。
cues 是当前 block 的事件映射，使用 cueProgress 后实现具体几何与样式。
不得重复减起点；跨交付分镜不能重置同一图形的连续时间。

### 4. 作业与真实预览

scenes.json 每项使用 {sceneId, composition, frames, props, fixedMix?}。
frames 与 props 必须来自实际时间轴；所有确认分镜按原顺序列出。
单镜 render 与 stills 的实际参数必须与该条记录一致。
固定该列表是为了所有工具计算相同输入摘要，不代表批次已经冻结。

stage_media.py stills 接收 request、scene、project、entry、composition、
props、frames、at-frames、node、modules、browser。
at-frames 为逗号分隔的有效镜内整数帧号。
使用真实 Composition 完整时长和正式 props，只输出 PNG 与来源记录，
不混音、不替换 MP4、不改变正式渲染成功 marker。
Render 收到图片路径后必须实际调用看图工具；导出成功不等于看过。

候选动态片段仍调用现有 stage_media.py render 完整导出有关分镜。
stage_media.py motion-evidence 接收 request、project、entry、
purpose、media-index、modules、browser；candidate 另需 unit-ids。
可选 extra-global-frames 为本次范围内需要补看的全局整数帧列表，逗号分隔；
它只增加采样，不能替代或删减默认语义采样。
media-index 为 {project, scenes:[{sceneId,path}]}。
工具核对实际 MP4 及同名 .render.json 来源记录，不接受手工声明替代核对。

purpose=candidate：unit-ids 是逗号分隔的实际视觉段落 ID；
需要这些段落涉及的全部分镜，包含跨镜部分。
工具保存不可覆盖的候选副本，再生成对应口播及动作的帧序列。
purpose=final：不传 unit-ids，覆盖全部正文口播、视觉段落及已启用 ending；
media-index 必须包含全部最终分镜，候选证据不能代替最终证据。

完整输出 status=evidence_ready、purpose、inputDigest、unitIds、
evidenceIndex、evidenceSha256。
证据索引与图片分组保存到 previews/evidence/<purpose>/<输入摘要>/<媒体与采样摘要>/，
增加采样或最终取证不能覆盖候选已引用的证据。
缺视频时返回 status=incomplete、missingSceneIds 与待补范围；
这不是任务终态，继续完成缺少的视频后重试。
evidence_ready 只说明证据生成完成，不说明画面设计已通过。

证据围绕事件开始、中间、完成、稳定状态采样，
还包含真实正文 utterance 的概览，避免只审查自行声明的动作。
最终索引保留尚未分配视觉用途的正文口播，不能因设计遗漏而跳过。

### 5. 审查字段

preflight-review 与最终 review 增加 motion 对象：
status、inputDigest、evidenceIndex、evidenceSha256、selectedUnitIds、
selectionReason、reviewedUnits、issues、observation。

status 只取 ready/revision_required。
reviewedUnits 每项含 unitId、viewedEvidenceIds、meaning、timing、layout、decision。
decision 只取 accept/revise；说明实际看见的含义、时间和构图。
issues 每项含 id、unitId、cueIds、observed、expected、fixLayer、status、resolutionEvidenceIds。
fixLayer 只取 meaning/layout/motion/timing/typography；status 只取 open/resolved。
issues 可以为空，不为满足格式虚构问题。
observation 包含 frameSequencesViewed、audioActuallyHeard、continuousVideoActuallyViewed，
均按真实执行填写；连续帧不等于听过或连续看过视频。

候选 selectedUnitIds 与证据的选择范围相同，selectionReason 说明代表性。
最终 selectedUnitIds 覆盖全部正文 visualUnits。
正式 timeline 除 ending.closingUtteranceIds 外的每条口播，
都至少归入一个 visualUnit.utteranceIds；稳定画面也要说明用途。
证据索引中的 unassignedUtteranceIds 为空才允许最终 ready，不能只备注遗漏后通过。
启用 ending 时，最终 motion 还包含 endingReview={status,evidenceIds,notes}，
status 同样只取 ready/revision_required；否则为 null。
notes 记录正文末态保持、结束语字幕、片尾开始和完整结束。
不据此伪造音频试听，音轨完整性继续走既有技术检查。

ready 要求所选各项 accept、已登记问题全部 resolved、解决证据属于当前版本。
最终仍要求原 review 顶层和逐镜 passed=true。
制作中允许 passed=false；修改该字段本身不能代替修复和重验。

### 6. 摘要与继续制作

inputDigest 由工具按确认稿、direction、timeline、工程、实际音频、
完整 scenes.json 执行参数、输出规格、依赖、浏览器及工具版本计算。
fixedMix=true 时同时核对 adjustment 内容、audioContract 与实际 PCM 摘要。
渲染 marker 和证据索引记录工具取得的 executionConfig：project、entry、modules、browser。
最终检查核对其任务归属与允许路径，并与实际分镜来源记录匹配，
再重新读取当前文件计算摘要；不能只相信证据保存的旧 inputDigest。
审查和 previews 不计入制作输入；其自身另有证据摘要。
冻结输入可以加入预审摘要，预审摘要不反过来依赖冻结版本。
修改组件、字体、声音、事件或边界后，旧审查不得批准新输入。

freeze-batch 只有当前候选审查 ready 才产生冻结清单。
render-batch 使用该清单；完成后重新对最终分镜取证和审查。
规范交付通过 task_io.py render；工具内部调用 assemble 和 validate。

未就绪返回 status=revision_required，并提供 scope、review、details、next。
该返回的 CLI 退出码为 0，但不代表完成；必须读取 status。
没有可用的冻结 manifest 时不能继续批量；待修订时不能写 completed。
根据问题修改当前工程、重新派生、预览、看图和记录，再调用原入口。
正常设计修订不增加技术故障次数；实际耗时、锁、取消和总预算继续生效。
真正的编译、非法数据、依赖或工具异常按既有错误处理，不伪装为普通制作意见。
~~~

## 11. 模板与 Worker 提示的具体文字调整

### 11.1 renderer-manifest.json 的 rules 替换

顶层增加 narrativeMotionVersion: 1。这只声明支持本文的运行数据接口，图形和题材仍由 Render 创作。

将“必须复用……字幕和动效组件；优先填本期内容与配音时间……”替换为：

> 复用栏目人物、观点卡、中央面板、导航、进度条和字幕骨架。正文图解由 Render 根据本期讲解设计；基础组件是可用实现，不是创作菜单。允许复用、组合或在任务副本编写本期组件，并通过 visualExtensions 注册和校验。

将“默认使用章节 visualBlocks，scene.visualBlocks 留空”所在规则改为：

> chapters 组织导航和摘要；一个章节可以包含多个视觉段落和多个连续状态。跨句延续的图解优先放章节 visualBlocks，单镜专用表达可用 scene.visualBlocks。选择依据是对象连续性和讲解含义，不能把一章默认处理为一张静态图。单镜与全片均传入完整 timeline。

增加：

> 正式 timeline.visualCues 使用真实 utteranceId 绑定动作；derive 生成 resolvedVisualCues。组件使用统一派生时间。关键状态由同一真实组件预览，审查覆盖讲解推进和动作过程；字段合法与导出成功不能代替效果判断。

### 11.2 两份模板 Markdown

《动效组件与内容适配说明.md》同步上述边界；“已有基础实现及适用范围”保留真实说明，不再把 flow 的文字编号称为已经具备真实因果图能力。

《财经双人对话视频生成指令.md》将正文制作与验收段替换为：

> Render 根据完整确认稿独立设计本期正文。先确定视觉目标、构图和连续状态，再决定复用或编写哪些组件。参考片用于理解栏目语言和借鉴表现，缺少专门案例不阻止创作。
>
> 按实际短句音频绑定动作，导出关键状态和代表过程，实际查看后修订。持续解释同一结果可保留画面；出现新的重要含义时，检查画面是否给予合适回应。最终交付前完成当前版本的制作审查和技术检查。

片尾、固定结束语、下载和本地素材规则保留，避免在正文优化时重新引入收尾重叠。

### 11.3 prompts.ts 最小增补

在现有 Render 交付说明之前加入：

> 本次 Render 执行 production-flow 的设计、真实配音绑定、关键状态预览和制作修订。参考是辅助，正文表达由当前稿件决定。媒体工具返回 revision_required 表示当前工程尚需修改：继续修订和复验，不写 completed，也不把正常创作意见当作技术故障。最终仍通过 task_io.py render 交付。

主 prompt 不展开数学公式和图形方法；这些放在对应 Skill 资源，降低重复指令相互冲突的风险。

## 12. 验证方案：怎样证明能力真的改善

### 12.1 确定性代码测试

| 测试 | 输入变化 | 必须观察到的结果 |
| --- | --- | --- |
| 事件定位 | 同一 utterance 改变实际开始时间 | 对应 start/complete 与局部帧正确变化 |
| 跨镜延续 | 同一 block 跨两个 scene 导出 | 边界状态连续，与全片同全局帧一致 |
| 补帧 | 前镜增加封装覆盖 | 后续事件重新定位；当前句音频不被拉伸 |
| 短窗口 | 正常时长、极短、零时长动作 | 无除零、越界、空白尾部；返回必要建议 |
| 引用错误 | 不存在的 utterance/block、重复 cue | 定位明确的工程问题，不能静默落在第 0 帧 |
| 绑定生效 | 把事件后移，保持图形内容不变 | 真实渲染的该动作相应后移；忽略 cues 的测试组件被识别为不符合预期 |
| 预览隔离 | 连续生成状态 PNG | 不覆盖 MP4/混音，不改变项目输入摘要 |
| 审查过期 | 改组件、字体、音频或 timeline | 旧 ready 不能批准新版本 |
| 正常修订 | 多轮 revision_required | 不增加技术 repairRounds，不写终态；耗时仍记录 |
| 最终一致性 | 预览通过但最终文件被替换 | 最终摘要/证据核对不通过，不假定预览等于成片 |
| 片尾回归 | 有/无结束语、有/无片尾、跨镜结束语 | 保持正文、字幕声音继续、完整片尾只追加一次 |
| 合片回归 | 不同 MP4 时间基 | 输出时间连续、目标 fps 和真实帧数保持正确 |

计划新增 tests/test_motion_timeline.py；扩展已存在的 tests/test_actual_timeline.py、tests/test_render_batch.py、tests/test_two_stage.py、tests/test_task_io.py、tests/test_finance_adaptive.cjs 和真实渲染测试。不复制一套同义用例。

### 12.2 通用创作验收样本

至少覆盖以下不同含义，使用未写入教学组件的新稿。开发人员只准备稿件、必要数据和统一评价问题，不预先手写样本的场景组件。

1. 有真实前后数值的变化：检查共同尺度、变化方向和语音触发。
2. 没有数字的原因与结果：检查是否能用关系和状态解释，而不是编造统计图。
3. 并列比较：检查是否误画成先后或因果。
4. 整体与部分、条件分支：检查层级、对象保持与条件含义。
5. 以引文和观点为主：检查是否会选择清楚的文字设计，而不是为了“丰富”强行加图表。
6. 同一图解跨多句且语速不同：检查同步、连续性、阅读停留和时间重新绑定。

参考缺省的测试同样必须能完成设计。另保留有财经参考的视频任务，核对栏目一致性。不能只修本次黄仁勋工程后宣布通用能力完成。

### 12.3 比较方式与通过条件

保留当前链路的基线输出；新链路使用相同稿件、相同模板栏目和可复用的真实配音，减少比较干扰。新的不同语速样本单独记录音频来源与真实时间，不靠修改 JSON 假装有新配音。

逐段比较：讲解是否得到视觉解释、数据/关系是否正确、重点是否随讲解推进、画面是否可读、运动中间状态是否清楚、是否存在无意义等待。

通过必须同时满足：没有影响理解的事实或关系错误；重点推进可观察且与实际短句对应；已发现问题有修订结果；技术回归通过；新主题能够通过同一自动流程生成。审美结论保留具体画面证据，不能用一个无依据的 90 分替代。

若仍只有淡入文字而无解释能力，视为本轮创作能力验收未通过。保留执行记录，继续判断是设计决策、提示执行、模型能力还是观察不足；不以增加规则数量结项。

### 12.4 当前不声称的验证

本次只编写方案，未运行以上新增接口、未生成新样片、未完成新一轮视听验收。已有技术测试通过不能充当本轮能力的验证结果。

## 13. 开发与发布顺序

1. **统一数据与返回行为。** 落实 cue 类型、纯解析、派生、revision_required；先用无付费配音的真实媒体夹具验证边界和恢复。
2. **接入本期组件。** 实现事件传递和 progress，修排印基础；通过事件平移、跨镜和片尾测试。
3. **补实际观察入口。** 实现 stills 与 motion-evidence，验证同源画面、版本失效、预览不污染工程与任务预算。
4. **落实审阅与继续制作。** 连接预审、冻结和最终交付；检查没有数据、错误记录、旧证据和待修订时的行为。
5. **替换 Skills 和模板文字。** 使用第 10～11 节文本，删除旧的冲突句，不叠加两套执行要求。
6. **运行完整自动任务验收。** 使用第 12 节不同新稿，比较真实输出；完成能力验收后才发布，不能仅凭单元测试更新生产。
7. **统一发布。** 更新源码和同名模板 ZIP，计划模板版本 1.4.0；重新计算 runtime manifest；按既有流程部署 Worker 和上传网页模板。部署时等待活动任务完成，避免运行中切换工具语义。
8. **网页两阶段验证。** 新建使用新模板的任务，执行 Analysis 与 Render，跟踪到交付，检查正文动效、结束语、片尾、整片和逐句结果。

历史已完成视频和冻结模板不覆盖。旧任务继续使用原冻结包及原合同；修改其工程副本不能启用由新模板声明的能力。要验证新版，须新建绑定 1.4.0 冻结包的任务；仅在既有来源、文本、音频摘要校验均满足时复用旧配音，不复制旧审查结论，也不把旧视频登记成新效果。

## 14. 失败处理、代价和交付完成定义

| 情况 | 处理 |
| --- | --- |
| 画面不好看、关系不清、重点不跟讲解 | 返回待修订，改当前工程，复查受影响范围 |
| 缺少某类外站参考 | 用内容关系和现有能力继续设计，不报障停工 |
| 当前素材不合适 | 更换表现或使用本地可用素材继续；不把一条搜索失败当系统故障 |
| 短句内不能精确到某个词 | 保持真实短句边界，调整表现；若明确要求词级精度，说明所需时间来源与能力缺口 |
| 编译、坐标、真实音频窗口错误 | 按定位修本期工程，遵守原技术修复与预算机制 |
| 共享工具缺陷或运行依赖故障 | 保存证据，按原协议报告；生产 Render 不修改公共工具求通过 |
| 审查文件或证据过期 | 重新预览/审查当前版本，不复制通过结论 |
| 预算耗尽或取消 | 保存候选和问题，按原有终态处理，不能宣称完成或绕过账本 |

主要代价：

- 会增加关键帧预览、代表片段渲染和实际看图的时间与模型输入。只对受影响内容做创作修订，但首版工程指纹仍保守失效，可能导致更多重新渲染。
- 首版真实视频候选仍按完整确认分镜导出。比新增局部视频渲染更简单，但很长的分镜预览成本较高；先实测，不预先增加第二套视频时间处理。
- 新配音按自然语义短句组织可能增加 TTS 请求数；已有音频有效时优先复用。不能为了更多动作把口播切得支离破碎。
- 模板需要一次公共能力与字体的版本发布；以后每期的图形和动作仍保存在任务工程，无需每次上传共享模板。
- 时间和结构可以确定性验证，审美仍有判断误差；必须以不同新稿的实际自动产出证明改善。

本轮开发完成的交付物应包括：代码与 Skills 实际修改、模板包、代码回归结果、自动生成的多类型样片、原稿与画面的审阅证据、发现问题后的修订记录、部署记录，以及如实列出的视听能力限制。只交文档、只跑通一个技术示例或只修好本期视频，均不代表本轮开发完成。
