---
name: subtitles
description: subtitles and caption rules
metadata:
  tags: subtitles, captions, remotion, json
---

## 字幕数据格式与入口约束

已有模板或受管video-pipeline任务遵守其冻结字幕合同，不强制迁移到`Caption`。
例如财经模板使用`utteranceId/text/startFrame/endFrameExclusive`和真实句级音频边界，
保留确认文案、既有字幕层及时间坐标，不为套用本页新增转写或逐词对齐。

通用新字幕工程采用JSON组织数据；使用`@remotion/captions`时可采用其`Caption`类型：

```ts
import type { Caption } from "@remotion/captions";
```

该类型的数据结构如下：

```ts
type Caption = {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
};
```

## Generating captions

仅任务需要转写现有音视频时，读取[转写说明](./transcribe-captions.md)。
已有确认文案和句级TTS时直接沿用真实音频边界，不自动增加ASR步骤。

## Displaying captions

To display captions in your video, load the [./display-captions.md](./display-captions.md) file for more instructions.

## Importing captions

To import captions from a .srt file, load the [./import-srt-captions.md](./import-srt-captions.md) file for more instructions.
