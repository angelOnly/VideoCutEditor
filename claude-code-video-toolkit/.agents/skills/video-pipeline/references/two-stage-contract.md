# 两阶段协议 video-two-stage/1

仅在请求的 `contractVersion` 为 `video-two-stage/1` 时读取。旧 `schemaVersion: 1/2` 保持旧路由。相同协议支持独立本地任务和 Worker 执行：Worker 提供只读请求、确认快照、任务隔离及动态工具，负责队列和回调；Codex 负责按模板完成当前阶段，不自行发布或确认。文件协议本身不等于 OS 隔离。

Worker 模式直接读取提供的 request，不运行下文的 init/confirm。所有命令使用 `video_exec`、看图使用 `video_view_image`、配音使用 `video_tts`；不运行收费 CLI、不读取 .env。下文 CLI 配音示例仅用于独立本地模式，不能覆盖 Worker 的工具约定。

## 1. 创建与识别任务

`TOOLKIT_ROOT` 指本工具库，`JOB_DIR` 为本次新任务目录，不能复用历史正文项目。运行环境需要 Python 3.10+、`jsonschema`、TTS 所需 `requests/python-dotenv`，媒体阶段需 FFmpeg/FFprobe。Remotion 使用已安装且版本一致的 `remotion/@remotion/renderer/@remotion/bundler`、Node 和浏览器。不要打印密钥。

根据用户明确输入准备提交 JSON，路径必须为实际文件。只列出允许使用的文件，不递归扫描样片、旧工程或日志来找灵感。

```json
{
  "taskId": "video_001",
  "scriptFile": "/absolute/current/script.md",
  "requirementsFile": "/absolute/current/requirements.md",
  "templateFile": "/absolute/current/template.md",
  "assets": [
    {"id": "template_image_1", "path": "/absolute/current/layout.png", "kind": "reference", "description": "模板直接嵌入且允许参考的图片"},
    {"id": "sfx_1", "path": "/absolute/current/tick.wav", "kind": "audio", "description": "允许使用的独立音效"}
  ],
  "outputSpec": {"width": 1920, "height": 1080, "fps": 30},
  "includeWholeVideo": true,
  "limits": {"executionSeconds": 14400, "repairRounds": 10}
}
```

完整制作要求和参考限制写入 `requirementsFile`。头像、Logo、获准片头源码、字体、模板图片等都须明确列入 assets；`kind` 可为 `image/video/audio/source/reference/font`。模板中其他链接不自动成为允许引用范围。模板文件与附件复制为快照，原始路径只作来源记录；制作只读取任务内快照。

```bash
python3 "$TOOLKIT_ROOT/tools/two_stage.py" init --job-dir "$JOB_DIR" --spec /absolute/current/submission.json
```

输出 `analysis/request.json` 和对应 `.prompt.md`，使用该请求开始 analysis。`job.json` 记录请求摘要；不要自行改写阶段请求。不同模板使用同一入口，不以项目名、模板名决定制作分支。

模板在本地是文档及显式附件，不假装从远程 API 取得。执行器需要的 Skills 和通用工具是技术依赖，可以按需读取；历史业务作品不属于技术依赖。允许复用组件时只复制获准源码，不载入历史工程入口。

## 2. analysis：输出完整方案后结束

1. 读请求和输入快照，先核对 `two_stage.py status --request ...`。理解允许素材，按模板确定角色、发言、分镜、素材、布局、字幕及动效。明确每个交付镜头与内部视觉段落的区别；不能把片头/章节卡擅自变成多余交付项。
2. 保存 `analysis/plan.json` 及阅读版、必要静态预览。JSON 结构由 [two-stage.schema.json](two-stage.schema.json) 的 `$defs.plan` 定义。制作细节完整保留在 `production`，它是开放对象，不受固定布局/音色枚举限制。
3. 使用 `two_stage.py validate` 校验。通过后返回 `analysis/result.json` 路径并结束 turn。正式 TTS/MP4 工具需要 render 请求，本轮不得调用。等待、确认和下一次提交在外部处理。

方案必须包含：

- `contractVersion`、`taskId`、`inputDigest`（`tools/two_stage.py` 的 `json_digest(request.snapshot)`）。
- 有序 `scenes`：每镜 `id/text/sourceMapping/timing/assetRefs/production`。
- `nonspoken`：标题、换行和非口播注记的原文范围、文本和原因。原文坐标采用 Python 字符串的 Unicode codepoint，下标从 0 开始，结束位置不包含；所有位置恰好覆盖一次，不能遗漏、重复、乱序。口播不得擅改。
- `previews`：任务内静态图路径；`requirementsNotes`：关键约束和无法满足的条件。

```json
{
  "id": "scene_001",
  "text": "第一句。",
  "sourceMapping": [{"start": 0, "end": 4, "unit": "unicode_codepoints"}],
  "timing": {"kind": "estimated", "speechSeconds": 2, "totalSeconds": 3, "totalRangeSeconds": [2.5, 4], "basis": "口播估算加内部画面；未调用 TTS"},
  "assetRefs": [],
  "production": {
    "speaker": "host",
    "voice": "任务确认的实际音色",
    "layout": {"description": "按模板自行设计"},
    "captions": {"description": "原文分页，render 使用实际声学时标"},
    "visualBlocks": [{"id": "block_001", "description": "本镜口播与图解"}]
  }
}
```

`assetRefs` 是本镜将实际使用的源素材 ID；模板示意图只作参考则不需宣称它出现在成片。生成图解与音频在 render 中另记。多个角色可以在同一镜中发言，制作描述明确文本归属。

无实际配音时 `timing.kind` 为 `estimated`，区分口播秒数和含内部片头等段落的总秒数；区间对应总秒数且必须包含估算值。提供实际音频则可用 `measured`，需 `audioFile/audioSha256`，在分析中实测，不能把估算伪称实测。

```bash
python3 "$TOOLKIT_ROOT/tools/two_stage.py" validate --request "$JOB_DIR/analysis/request.json" --artifact "$JOB_DIR/analysis/plan.json"
```

## 3. 外部确认与新 render 请求

只有收到用户或明确获授权协调者的确认才能执行 `confirm`。不能因为 analysis 通过而自行确认。首次 `base-version` 是 0，以后使用当前确认版本。修改后的完整 JSON 可以放在本任务新文件；改口播需给该镜 `editReason`，保留源文映射。未变的制作字段必须完整带回。

```bash
python3 "$TOOLKIT_ROOT/tools/two_stage.py" confirm \
  --request "$JOB_DIR/analysis/request.json" \
  --artifact "$JOB_DIR/analysis/plan.json" --base-version 0 --source "用户本次确认"
```

命令保存 `confirmation/v1/plan.json` 和来源记录，创建 `render/render_001/request.json` 及新提示词。旧确认请求失效时工具拒绝执行。编辑确认与正式制作通过本任务锁互斥；新确认不会改写旧结果。文件和摘要是本地协议保护，不是防恶意修改的可信服务器签名。

## 4. render：Codex 组织制作

读取 render 请求、原输入、同一模板快照、完整确认方案及本任务已有资料。先检查环境、字体、字幕对齐工具，再调用收费服务。不要照搬 analysis 估算秒数，不删稿、换未确认素材或改变交付镜头来适配时长。

### 配音

Codex 决定角色与音色，调用通用配音工具；初版提供现有豆包 CLI，无需先开发 MCP。按确认文本准备任务内清单：

```json
[
  {"id": "utterance_001", "sceneId": "scene_001", "role": "host", "speaker": "实际已确认音色 ID", "text": "第一句。"}
]
```

同一镜可有多条发言，按顺序拼合必须等于该镜确认文本。可只提交本次需要制作的镜头，但每个提交镜头都必须包含其完整口播。

```bash
python3 "$TOOLKIT_ROOT/tools/stage_tts.py" --request "$REQUEST" --script "$JOB_DIR/render/dialogue.json"
```

可信底层工具加载项目根 `.env`，不复制凭据。缓存按精确文本、实际音色、资源模型及生成格式匹配，成功音频还需校验摘要和解码。请求状态保存在 `cache/tts/<key>/request.json`，结果未知会返回 `EXTERNAL_RESULT_UNKNOWN`；不得删账本或另换 ID 来盲目重发。普通任务恢复只读本任务缓存。已有供应商之外的能力，仍需按部署授权使用，不自动购买新服务。

### 时间轴、工程与渲染

根据真实音频安排画面和字幕。声学对齐工具由 Codex 按现有可用能力选择；不能用字数比例代替声学对齐。保留低置信度、零时长和专有名词的问题证据；没有实际试听时不得声称人耳验收。

在工程编程和正式渲染之前确认声学对齐能力可用。`silencedetect` 只能提供静音区间，不能证明某句、某字在该时刻开始；“静音检测＋标点推断”不构成已验证的字幕对齐。任务要求声学时标而当前没有可用工具或可验证时标时，返回 `CAPABILITY_MISSING`，明确缺少字幕对齐能力，不用手填时间轴继续制作。保留已匹配的 TTS 缓存，不能为获取时标自行更换收费服务。

检查工程真正用于烧录的字幕分页，将这些分页的文本顺序拼接后与确认全文逐字比较，必须完全相同。画面中的摘要、关键词卡不能代替原文字幕；在审查 JSON 写一个 `fullText` 或 `burned: true` 不能证明工程实际渲染了全文。检查记录须引用实际字幕数据及核对结果，不能只复制确认方案作为执行证据。

在 `project/` 创建独立正文工程。可以使用获准通用组件或源码；允许执行当前新工程，不固定 `templates/ifeng-scenes`。工程的依赖可链接受信的 node_modules，业务资源复制进本任务；不要链接历史正文目录。

### 渲染前检查

先在当前 `render/<runId>/` 保存 `timeline.json` 和 `preflight-review.json`，再正式渲染。它们是本任务制作资料，不需要引入新的上游协议或固定布局 Schema：

- 从完整确认方案提取本任务的硬性要求，逐项记录对应镜头、实现位置和检查证据。已确认的角色/音色、文本、素材、组件复用要求和视觉段落先后关系必须保留；模板只用于补齐确认方案未限定的制作细节。
- 时间轴列出每镜实际总帧数、每段发言的音频来源和实际起止帧、字幕声学时标及每个已确认视觉段落的起止帧。区分口播长度与镜头总长度。要求“口播结束后出现”的段落应锚定口播结束，不能用“本镜倒数若干帧”覆盖尚未结束的口播。
- 必须复用的源码应从获准快照导入或复制后实际调用，记录原素材 ID 与工程位置；仅列入素材清单或另写外观相似的组件不算复用。
- 使用当前工程的 Remotion `renderStill` 等现有能力生成低成本关键帧，实际查看文字、人物、字幕和段落切换前后；在 `preflight-review.json` 记录看过的图片、帧号、检查结果及限制。技术依赖取 Worker 提供的 modules，不另找历史工程。静态图不能证明声音对齐，音轨还须独立测量与校验。
- 若检查不通过，先修工程或时间轴；不得以“后续再调整”为由批量正式渲染。缺少实际字幕对齐能力时明确报告，不用手填等分时间冒充声学对齐。

同一次技术恢复继续以完整确认方案为准。旧失败工程可作本任务恢复材料，但不能覆盖确认要求；不得为绕过媒体错误改短已确认片头或改用其他组件。

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

## 5. 最终候选与确定性检查

保存 manifest，字段详见 Schema `$defs.manifest`。每个确认镜头必须返回：

- ID、完整确认文本、实际 MP4 相对路径、摘要、帧数和秒数。
- `usedResources`：实际源素材与生成资源列表，含 ID、类型、路径和摘要；源素材必须与 `assetRefs` 一致，生成图解、音频不能假称来源素材。
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

## 6. 恢复与限制

```bash
python3 "$TOOLKIT_ROOT/tools/two_stage.py" checkpoint --request "$REQUEST" \
  --step timeline --files render/render_001/timeline.json
python3 "$TOOLKIT_ROOT/tools/two_stage.py" status --request "$REQUEST"
python3 "$TOOLKIT_ROOT/tools/two_stage.py" repair --request "$REQUEST" --reason "本轮具体技术问题"
```

checkpoint 保存输入与产物摘要；status 重新核对文件。镜头复用由 Codex 依据确认版本、实际素材与工程判断；通用执行器还会核对项目内容、props、依赖版本和产物。文件存在不等于可复用。

工具为同任务正式执行加锁；重复启动返回 `TASK_BUSY`，不并行覆盖。正式工具内部失败自动登记并消耗修复预算，同一操作同类错误连续三次或总预算耗尽即停止，不能靠换参数或不结束 turn 绕过。成功清除该操作的连续失败计数，但不返还已消耗预算。`repair` 仅登记未被正式工具记录的手工修复，不对同一次失败重复登记。执行耗时和预算跨恢复累计，等待编辑不计入；Worker 另负责整个阶段的墙钟时限，并在工具返回后检查停止状态。

模型 turn 因网络中断时，由调用者或 Worker 管理恢复，不在 Skill 内常驻重启会话。恢复前先检查旧制作进程是否仍活着，再使用 status 核对本任务资料。不得清空执行预算或付费请求账本来绕过停止条件和未知付费结果。

只能在确认约束内修复；超过预算、能力缺失、硬性时长无法满足或必须改稿/换镜时，返回失败与原因，由外部重新编辑确认。不能把失败悄悄降级为短预览或占位视频。
