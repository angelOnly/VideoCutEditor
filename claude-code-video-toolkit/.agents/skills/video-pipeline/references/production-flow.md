# 共用视频制作流程

本地完整制作与 Worker Render 都执行本文件。读取可信任务、原输入、同一模板快照、确认文本和明确业务要求及本任务已有资料。Render 是本期最终创作阶段：先检查环境、字体和模板所需依赖，再调用收费服务；负责制作质量而不是只负责导出成功。不要照搬 Analysis 估算秒数，不删稿、使用未授权素材或改变交付镜头来适配时长。

### 配音

Codex 决定角色与音色，调用通用配音工具；Worker 必须调用 video_tts；独立本地任务使用下面的 stage_tts.py。按确认文本准备任务内清单：

```json
[
  {"id": "utterance_001", "sceneId": "scene_001", "role": "host", "speaker": "实际已确认音色 ID", "text": "第一句。"}
]
```

同一镜可有多条发言，按顺序拼合必须等于该镜确认文本。财经双人模板每个自然句或自然短句生成一条独立 TTS：一条 TTS 只能对应一条句级字幕，禁止用 `scene_*_full` 整镜音频后按字数或比例切字幕。这个要求避免依赖中文逐词对齐；每个提交镜头都必须包含其完整口播。

```bash
python3 "$TOOLKIT_ROOT/tools/stage_tts.py" --request "$REQUEST" --script "$JOB_DIR/render/dialogue.json"
```

可信底层工具加载项目根 `.env`，不复制凭据。缓存按精确文本、实际音色、资源模型及生成格式匹配，成功音频还需校验摘要和解码。请求状态保存在 `cache/tts/<key>/request.json`，结果未知会返回 `EXTERNAL_RESULT_UNKNOWN`；不得删账本或另换 ID 来盲目重发。普通任务恢复只读本任务缓存。已有供应商之外的能力，仍需按部署授权使用，不自动购买新服务。

### 时间轴、工程与渲染

根据真实音频安排画面和字幕。TTS 成功后，使用音频清单和 `ffprobe` 读取每段音频的实际时长；同一镜的多段发言按确认顺序累加，得到实际起止帧。不得用 analysis 估算值或字数比例推算镜头总时长。当前协议不要求声学逐字或逐词时间戳，不检查或安装对齐工具；未配置对齐服务不得返回 `CAPABILITY_MISSING`。保留零时长、解码失败和音画总时长不一致等问题证据；没有实际试听时不得声称人耳验收。

字幕的样式、文字范围和分页服从模板。财经双人模板必须同时具有句级底部字幕和简短关键结论卡：结论卡不能替代字幕。每条句级字幕的起止时间取相应独立 TTS 的真实边界，不要求中文逐字或逐词对齐。`render/<runId>/timeline.json` 必须逐句记录 `id/text/src/startFrame/endFrameExclusive`，字幕以 `utteranceId` 一对一引用同一边界。检查记录须引用工程实际使用的字幕数据及核对结果，不能只复制确认方案作为执行证据。

在 `project/` 创建独立正文工程。若冻结模板含 `renderer/renderer-manifest.json`，先读取清单，将 `renderer/` 复制到 `project/renderer/`，并将模板 `assets/` 复制到 `project/renderer/public/template-assets/assets/`，再实际导入并复用人物舞台、句级字幕、章节、音频和图解基线组件；不得只另写外观相似的临时页面。基线组件固定栏目语言，本期图解、数据、动画参数和专属场景由 Codex 围绕当前稿件创作。若清单声明 `sentenceAudioValidator`，可且只能通过 Node 执行该只读审计脚本；它读取确认方案、TTS 清单、时间轴和实际音频，失败时必须修复，不能跳过。工程的依赖可链接受信的 node_modules，业务资源复制进本任务；不得执行其他模板脚本、安装依赖或链接历史正文目录。

### 渲染前检查

先在当前 `render/<runId>/` 保存 `timeline.json` 和 `preflight-review.json`，再正式渲染。它们是本任务制作资料，不需要引入新的上游协议或固定布局 Schema：

- 从确认文本和明确业务要求提取本任务的硬性要求，逐项记录对应镜头、实现位置和检查证据。用户明确指定的角色/音色、文本、素材、组件复用要求必须保留；Analysis 不提供必须沿用的视觉段落；模板只用于补齐确认方案未限定的制作细节。
- 时间轴列出每镜实际总帧数、每段发言的音频来源和按实际时长计算的起止帧、模板要求的字幕分页及其起止帧、实际视觉段落的起止帧。区分口播长度与镜头总长度。财经双人模板在正式渲染前运行 `sentenceAudioValidator`，生成 `sentence-audio-audit.json`；该审计必须通过，且不以中文逐字或逐词对齐作为能力前提。要求“口播结束后出现”的段落应锚定口播结束，不能用“本镜倒数若干帧”覆盖尚未结束的口播。
- 必须复用的源码应从获准快照导入或复制后实际调用，记录原素材 ID 与工程位置；仅列入素材清单或另写外观相似的组件不算复用。
- 使用当前工程的 Remotion `renderStill` 等现有能力生成低成本关键帧，实际查看文字、人物、字幕和段落切换前后；在 `preflight-review.json` 记录看过的图片、帧号、检查结果及限制。技术依赖取 Worker 提供的 modules，不另找历史工程。静态图不能证明实际播放，音轨还须独立测量、解码并核对总时长。
- 正式渲染后还必须审查人物切换、章节进退、至少一组连续句级字幕、关键数据出现和片尾收束的动态片段；发现静态 PPT 式画面、字幕缺失或节奏不符时，修工程后重渲染受影响镜头。
- 若检查不通过，先修工程或时间轴；不得以“后续再调整”为由批量正式渲染。字幕显示效果、音频解码或音画总时长校验不通过时明确报告。

同一次技术恢复继续以确认文本和明确业务要求为准。旧失败工程可作本任务恢复材料，但不能覆盖确认要求；不得为绕过媒体错误改短已确认片头或改用其他组件。

通用 Remotion 执行器接受 Codex 选定的入口、Composition、props 和实测总帧数，PNG、单并发为当前保守默认。它不会生成图解、选择角色或重新切分分镜。

```bash
python3 "$TOOLKIT_ROOT/tools/stage_media.py" preflight --node /absolute/node \
  --modules /absolute/node_modules --browser /absolute/chrome

python3 "$TOOLKIT_ROOT/tools/stage_media.py" render --request "$REQUEST" \
  --scene scene_001 --project project --entry project/src/index.tsx \
  --composition Scene001 --props render/scene-001-props.json --frames 90 \
  --node /absolute/node --modules /absolute/node_modules --browser /absolute/chrome
```

这里 `--frames 90` 仅为示例，必须使用当前实际时间轴。指定的 Composition 规格/帧数不匹配会失败。执行器写临时视频，验证通过才替换成片，提供实际 MP4 的首中尾抽帧；必须调用图像工具真正查看它们及转场关键帧。浏览器关闭超时只回收自身进程组，非零退出不能直接当成成功。

执行器先保存无声画面和完整 PCM 混音，再统一编码 AAC 并封装 MP4，保留所有配音、音效和静音段。返回的 `mix.path/sha256` 是实际混音，可用于清单中的 `audio`（另补确认全文）；不要用裸 TTS 替代混音。封装失败后，在工程/props/依赖未变时重试相同命令会复用原画面和混音，`renderReused: true` 表示没有重开浏览器。先阅读错误中的实际时长/偏移量；不要通过增加帧数、固定裁掉某个毫秒数或覆盖通用工具来掩盖编码延迟。`REPAIR_BUDGET_EXHAUSTED` 必须结束当前阶段并返回失败。

最终编码损坏时检查原故障连续区间，不只看一张 PNG。根据模板处理片头/章节卡/片尾的内部时间；不存在通用的固定 16 镜或固定末尾静音裁剪量。必要字幕不可省略，必需旁白不可静音替代。无旁白的确认镜头可有静音音轨。

## 最终候选与确定性检查

保存 manifest，字段详见 Schema `$defs.manifest`。每个确认镜头必须返回：

- ID、完整确认文本、实际 MP4 相对路径、摘要、帧数和秒数。
- `usedResources`：实际源素材与生成资源列表，含 ID、类型、路径和摘要；实际源素材必须属于冻结授权集合，并包含客户端明确指定的 `assetRefs`；可以自行择用其他已授权素材，生成图解、音频不能假称来源素材。
- `resolvedVisualBlocks`：实际数值 `startFrame/endFrameExclusive`，连续覆盖本镜；不用计划表达式代替数值。
- `audio`：本镜完整混音源文件、摘要、完整文本。用于与编码后的声音比对，需包含内部静音、音效等，不能传未混音的裸 TTS 去比较混音成片。
- `captions`：原文字幕分页和实际起止秒数；无口播镜可为空。
- `evidence`：实际成片抽帧的帧号、路径和摘要，至少首中尾；渲染器返回这些字段。

同时写视觉审查 JSON（`$defs.review`）：任务/run/阶段/确认摘要，逐镜视频摘要、真实看过的帧号、检查结论、备注和局限。字幕是否确实烧录、画面是否符合模板须实际查看，JSON 字段不能自动证明审美合格。

`wholeVideo` 默认 `null`；请求要求整片时使用通用拼接入口（先准备全部分镜清单和视觉审查）：

```bash
python3 "$TOOLKIT_ROOT/tools/stage_media.py" assemble --request "$REQUEST" --manifest "$JOB_DIR/render/render_001/manifest.json"
```

拼接工具逐镜检查后保留视频编码，按本镜帧长归一化原始混音 PCM、拼接并只编码一次 AAC，写回 `wholeVideo`。整片不能占分镜列表第 0 项。所有  N 镜的音轨须全部包含，拼接后重新校验音视频时间戳、整片声音和边界。结果提供全部确认镜头，不只提供重做子集。

```bash
python3 "$TOOLKIT_ROOT/tools/two_stage.py" validate --request "$REQUEST" --artifact "$JOB_DIR/render/render_001/manifest.json"
```

通过后输出该 run 的 `result.json`。这是本地候选，不是 `delivered`、回调成功或服务端发布成功。失败返回明确阶段/错误码，保留此前合格产物。技术工具不自动证明所有业务描述已满足；Codex 的视觉审查与固定技术验证都要完成。


## 逐句交付与制作资料保存

一句确认口播对应一个 sceneId 和一个音画合成 MP4。N 句必须交付 N 个 MP4，不能让客户端再拼字幕、音频或多个视觉片段；句内可以切换多个图解与动画。统一设计整片工程，BGM 按全局偏移衔接，不能每句从头播放。片头归入首句、片尾归入末句，不新增无口播交付项。

在 `render/<runId>/timeline.json` 保存 `fps` 与有序 `scenes`。每镜 `id/startFrame/endFrameExclusive` 是全局帧区间，首镜从 0 开始，后镜连续接上前镜；每镜区间长度等于实际 MP4 帧数。镜内 `utterances/captions` 使用局部帧，均不能超出该镜帧数。utterance 含 `id/text/src/audioPath/startFrame/endFrameExclusive`：`src` 是工程 public 目录内路径，`audioPath` 是同一音频相对任务根的路径。caption 含 `utteranceId/text/startFrame/endFrameExclusive`，边界和文本必须与对应句级音频一致。模板审计接收工程 public 路径；Worker 根据 audioPath 独立检查音频。

实际视觉、转场、BGM/SFX 的区间、工程入口、Composition、Props 及素材引用也记录到时间轴；它们描述本次效果，不禁止以后优化。manifest 的 captions 秒数必须等于局部字幕帧除以 fps。工程源码保存在 project，真实音频保存在 tool-audio 或任务内素材副本，保留全部相对依赖；node_modules 可链接可信锁定依赖，业务文件不能用外部符号链接代替。

候选 manifest 保存为 `render/<runId>/manifest.json`。Worker 技术终检后记录工程、时间轴、模板、音频和素材摘要到服务端 productionRecord；回调只投影文字和最终 MP4，不能因此删除制作资料。

## 失败、恢复与预算

首次成功即停止检查；修改后重验受影响范围。Analysis 估时不决定成片长度，不引入 ASR、中文逐字或逐词声学对齐。素材不足、输出规格冲突或缺少必需能力必须明确失败，不能静音、占位或改稿求成功。

工具失败受剩余修复轮数和阶段时间限制；REPAIR_BUDGET_EXHAUSTED、EXTERNAL_RESULT_UNKNOWN 必须结束，不换 ID 或清账本绕过限制。正常恢复前确认旧进程已经停止；同 run 重试只能恢复本任务资料。

后续优化须明确成功 run/resultVersion；受控恢复器先核对确认版本、模板和工具版本、文件摘要，再复制到新 run。旧工程和旧成片不覆盖；未改口播且音色一致才复用验证过的 TTS，时长变化重算后续全局偏移、字幕、转场和音乐。资料缺失报告不能恢复，不伪称已经恢复，也不自动从任意历史 run 取工程。
