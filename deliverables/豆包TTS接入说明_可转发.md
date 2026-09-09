# 豆包 Seed TTS 接入说明（可转发）

适用项目：`claude-code-video-toolkit`。本文说明如何使用项目中已接入的 **豆包 Seed TTS** 生成 MP3 配音。

> 安全说明：请不要把任何真实 API Key 写进文档、聊天记录、Git 仓库或视频项目文件。API Key 等同于可调用和计费权限。本文只写配置变量和获取方式；每位使用者应创建并使用自己的 Key。若 Key 曾被公开发送，请立刻在火山引擎控制台禁用/轮换。

---

## 1. 这套接入使用什么凭证？

本项目使用的是豆包 **新控制台 API Key** 方式：

| 项目变量 | 是否必填 | 用途 |
| --- | --- | --- |
| `DOUBAO_TTS_API_KEY` | 是 | 火山引擎新控制台创建的 API Key，用于请求鉴权 |
| `DOUBAO_TTS_RESOURCE_ID` | 建议填写 | 已开通的 TTS 资源 ID；项目默认值为 `seed-tts-2.0` |
| `DOUBAO_TTS_SPEAKER` | 建议填写 | 已为该资源/账号开通的音色 ID；可按命令临时覆盖 |

**不需要 `APPID`，也不需要旧版 `AccessToken`。** 本项目的实现调用的是新控制台 API-Key 接口；旧版文档中常见的 AppID / AccessToken 不是这条链路的配置项。

官方参考：

- [豆包语音合成 API 文档](https://docs.volcengine.com/docs/6561/2532486?lang=zh)
- [音色列表 API（ListSpeakers）](https://api.volcengine.com/api-docs/view?action=ListSpeakers&serviceCode=speech_saas_prod&version=2025-05-20)

---

## 2. 在火山引擎侧需要完成什么

1. 使用自己的火山引擎账号开通豆包/语音合成相关服务，并确认账户有对应 TTS 资源的调用权限。
2. 在火山引擎**新控制台**创建 API Key，复制一次并安全保存。控制台界面可能调整，以官方文档中的“创建 API Key”入口为准。
3. 确认可用的 `resource_id` 和音色 `speaker`。音色 ID 必须在当前账号、资源和权限范围内可用。
4. 不要把 API Key 发给他人；朋友需要使用时，应让对方重复以上步骤，创建自己的 Key。

如果你只拿到了 AppID，说明你看到的很可能是旧版接口/旧控制台的凭证区域；本项目接入的不是那套方式。请改为创建新控制台 API Key。

---

## 3. 本地配置

### 安装依赖

在项目根目录执行：

```bash
cd /path/to/claude-code-video-toolkit
python3 -m pip install -r tools/requirements.txt
```

### 创建 `.env`

复制模板后填写**自己的**值：

```bash
cp .env.example .env
```

在 `.env` 中加入或修改以下三行：

```
# Local-only credentials for the Doubao TTS smoke test. This file is git-ignored.
DOUBAO_TTS_API_KEY=your_api_key_here
DOUBAO_TTS_RESOURCE_ID=seed-tts-2.0
DOUBAO_TTS_SPEAKER=zh_female_xiaohe_uranus_bigtts
```

`.env` 已被项目的 `.gitignore` 排除。不要把 `.env` 上传到 GitHub、网盘公开链接或发给朋友。

---

## 4. 最快的生成方式

准备一个 UTF-8 文本文件，例如 `script.txt`：

```text
你好，这是一段豆包 TTS 试听音频。
```

在项目根目录执行：

```bash
python3 tools/voiceover.py \
  --provider doubao \
  --script script.txt \
  --output out/doubao-test.mp3 \
  --json
```

成功后会得到 `out/doubao-test.mp3`，并输出 JSON 结果，其中包括实际音频时长和 30fps 对应帧数，便于将动画与旁白同步。

### 临时切换音色或资源

不修改 `.env` 也可以临时覆盖：

```bash
python3 tools/voiceover.py \
  --provider doubao \
  --doubao-speaker "替换为本次试听的音色_ID" \
  --doubao-resource-id "seed-tts-2.0" \
  --script script.txt \
  --output out/doubao-voice-preview.mp3 \
  --json
```

优先把确认后的默认音色写到 `.env`；仅在试听/对比时通过命令参数覆盖。

### 按分镜逐条生成

当每个分镜有一个 `.txt` 文件时：

```bash
python3 tools/voiceover.py \
  --provider doubao \
  --scene-dir public/audio/scenes \
  --json
```

工具会为每个场景脚本生成独立 MP3。做 Remotion 视频时，应该使用这些 MP3 的**真实时长**安排动画，而不是按文字字数估时。

---

## 5. 项目里到底是怎么调用 API 的

入口是：[tools/voiceover.py](/Users/jiang/Documents/remotion动画/claude-code-video-toolkit/tools/voiceover.py)。当传入 `--provider doubao` 时，它会：

1. 从 `.env` 读取 `DOUBAO_TTS_API_KEY`、资源 ID 和默认音色；
2. 调用 [tools/doubao_tts.py](/Users/jiang/Documents/remotion动画/claude-code-video-toolkit/tools/doubao_tts.py)；
3. 向以下地址发起 `POST` 请求：

```text
https://openspeech.bytedance.com/api/v3/tts/unidirectional
```

请求头：

```text
Content-Type: application/json
X-Api-Key: <你的 API Key>
X-Api-Resource-Id: <你的 resource ID>
X-Api-Request-Id: <每次请求新生成的 UUID>
```

请求体结构：

```json
{
  "user": {"uid": "claude-code-video-toolkit"},
  "req_params": {
    "text": "需要合成的文本",
    "speaker": "已开通的音色 ID",
    "audio_params": {
      "format": "mp3",
      "sample_rate": 24000
    }
  }
}
```

返回是流式的多个相邻 JSON 对象，而不是一个可直接保存的 MP3 响应。项目代码会：

- 收集 `code: 0` 且带有 `data` 字段的 Base64 音频片段；
- 等待最终成功事件 `code: 20000000`；
- 拼接、解码后写入 MP3 文件。

因此，日常使用应优先调用 `tools/voiceover.py`，不要直接把 API 原始响应保存成 `.mp3`。

---

## 6. 测试与排错

### 不消耗 API 的单元测试

下面两项只验证请求结构和流式音频解析，不会联网：

```bash
python3 -m unittest \
  tests.test_doubao_tts_smoke.DoubaoTTSProviderTest.test_build_request_for_new_console \
  tests.test_doubao_tts_smoke.DoubaoTTSProviderTest.test_chunked_json_and_audio_decoder
```

### 真实 API 冒烟测试

在 `.env` 已填写自己的 Key、资源和可用音色后：

```bash
python3 -m unittest \
  tests.test_doubao_tts_smoke.DoubaoTTSProviderTest.test_live_voiceover_cli_generates_female_mp3
```

这会生成一个实际 MP3，并使用 `ffprobe` 检查文件大小和时长。测试输出位于项目的 `out/` 目录。

### 常见问题

| 现象 | 排查方式 |
| --- | --- |
| `No Doubao API key found` | 确认在项目根目录执行命令；`.env` 文件存在；变量名是 `DOUBAO_TTS_API_KEY`，不是 `APPID` 或旧版 `AccessToken` |
| 请求被拒绝 / 没有音频 | 检查 API Key 是否有效、TTS 资源是否开通、`resource_id` 是否正确、音色是否有权限 |
| 指定音色失败 | 用官方音色列表接口确认该 ID 在你的账号和资源下可用；先不传 `--doubao-speaker`，再逐个尝试已授权音色 |
| 生成出来但视频不同步 | 以生成 MP3 的真实时长写入 timeline；不要按文案字数或预估语速安排动画 |
| Key 泄露 | 立即在火山引擎控制台禁用或轮换 Key；更新本机 `.env`，不要继续使用泄露的 Key |

---

## 7. 转发给朋友时，请一并说明

- 这份文档说明的是接入方法，不包含也不应包含任何人的真实 API Key。
- 朋友必须使用自己的火山引擎账号、自己的 API Key、自己的已授权资源和音色。
- `.env` 是本机私密配置；视频源代码、Markdown 文档、`.env.example` 可以分享，`.env` 不可以分享。
- 若要更换音色，只需先做试听，再更新 `DOUBAO_TTS_SPEAKER` 或传入 `--doubao-speaker`；不需要改动 TTS 接入代码。
