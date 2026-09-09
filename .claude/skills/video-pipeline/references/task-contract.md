# 任务与阶段产物契约 v1

Worker 将上传包安全解包到独立目录，再生成 `task.json`。此文件是服务端解析后的任务，不直接使用上传包内同名文件。拒绝绝对路径、`..`、符号链接逃逸、超限压缩包。task.json 以外的制作文件不能修改控制参数。

目录：`input/` 为输入，`project/` 为模板副本，`output/video.mp4` 为候选，阶段 JSON、`checkpoint.json`、`render.log`、`validation.json` 放在任务目录根；截图放 `quality/`。输入引用均相对任务目录，不能越界。

```json
{
  "schemaVersion": 1,
  "jobId": "job_001",
  "mode": "auto",
  "input": {
    "script": "input/script.txt",
    "narration": "input/narration.wav",
    "assets": [{"path": "input/logo.png", "role": "logo", "required": true}]
  },
  "template": {"id": "approved-template-v1", "version": "1", "path": "input/template"},
  "output": {"width": 1920, "height": 1080, "fps": 30, "requireAudio": true},
  "duration": {"mode": "audio", "targetSec": null, "toleranceSec": 0.1},
  "tts": null,
  "limits": {"repairRounds": 2, "externalAttempts": 3, "timeoutSec": 3600}
}
```

这不是声称存在名为 approved-template-v1 的模板；由服务器模板注册表解析成实际模板。`input.script` 为必需的 UTF-8 全文；旁白路径可为 null，此时 `tts` 必须提供已配置 provider、voice 或 `roles` 映射。若产品明确允许无旁白视频，可 `requireAudio=false`。`template.path` 必须是服务器已审核可执行的模板副本，不是参考图或未审核上传代码。任务显式 templateId 优先；未指定时只能采用素材包中已准入的模板 ID。不能准入则失败，不静默换模板。

`output` 为 Worker 完成三层默认值合并后的值。width/height 为正偶数，fps 为正数。`duration.mode` 为 `audio` 或 `hard`；hard 必须带正 targetSec。模型不得改变硬时长、输出规格、limits。费用上限由 Worker/供应商代理执行；Skill 只接收剩余额度，不能承诺自行精确计费。

## 产物最低字段

所有阶段 JSON 为对象，含 `schemaVersion: 1` 和 `jobId`；所有文件路径相对任务目录。

- normalized-input：`files` 数组，每项 path/sha256/role；`resolvedConfig`、`configSources`、`templateVersion`。
- plan：`scenes` 数组，每项 id/text/assets/layout；全文顺序映射，不遗漏段落。
- audio-manifest：`clips` 数组，每项 path/sha256/text/role/durationSec；预配整轨也要记录句段对应关系。明确无音轨时 clips 为空。
- project-manifest：`entry`、`compositionId`（Python 可 null）、`renderArgv`（参数数组）、`templateVersion`、`projectPath`。
- timeline：`fps`、`durationSec`、`totalFrames`、`scenes`（id/startFrame/endFrame，区间左闭右开）、`captions`（text/startFrame/endFrame）、`audio`（path/startFrame/endFrame）。应覆盖所有计划场景；总帧数取整，音频不能超出总时长。旁白重叠仅限明确的对话设计。
- quality-report：`passed` 布尔值、非空 `checks` 数组，每项 name/passed/evidence；evidence 是实际检查描述；`frames` 为非空截图路径数组。每场及转场都应有证据。任何关键失败必须先修复。人工审美不能写成自动保证。

`validation.json` 由确定性脚本生成，不能手写通过结果。脚本检查的是基础文件/参数/解码/时间轴一致性；内容覆盖、图像真实观感、字幕测量、原稿事实完整性由制作检查与服务端扩展检查负责。

## 错误码

| code | 场景 | 通常可重试 |
|---|---|---|
| INPUT_MISSING / INPUT_INVALID | 必需输入缺失、非法参数或路径 | 否 |
| TEMPLATE_UNSUPPORTED | 未准入或缺入口 | 否 |
| DEPENDENCY_MISSING / AUTH_REQUIRED | 缺工具、字体、服务权限 | 否 |
| TTS_FAILED / ALIGNMENT_FAILED | 配音、字幕对齐失败 | 临时网络故障才是 |
| EXTERNAL_RESULT_UNKNOWN | 收费调用结果不明，无法安全恢复 | 否 |
| DURATION_CONFLICT | 无法满足硬时长 | 否 |
| RENDER_FAILED / VALIDATION_FAILED | 工程、成片或证据错误 | 剩余修复轮内是 |
| DEADLINE_EXCEEDED / BUDGET_EXCEEDED | 控制预算耗尽 | 否 |
| INCOMPLETE_OUTPUT | 只回答、请求确认、未留下足够产物 | 剩余修复轮内是 |

candidate 示例：
```json
{"jobId":"job_001","status":"candidate","stage":"delivery_check","artifact":"output/video.mp4","error":null}
```
失败示例：
```json
{"jobId":"job_001","status":"failed","stage":"input_check","artifact":null,"error":{"code":"INPUT_MISSING","message":"input/script.txt 不存在","retryable":false}}
```
