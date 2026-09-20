# Worker 客户端联调接口说明

> 联调环境实测日期：2026-09-20；服务提交：`997b0f8`。本文只说明当前 Worker 的实际访问地址、鉴权和调用约定；字段明细以 [AI视频剪辑接口文档](AI视频剪辑接口文档.md) 为基础，并补充当前 Worker 的强制字段。

## 1. 联调地址与流程

Worker 基地址为：`http://10.20.130.251:8080`。

```text
客户端 --分析提交--> Worker --分析回调--> 客户端
客户端 --渲染提交--> Worker --视频回调--> 客户端
```

| 方向 | 用途 | 方法与地址 |
| --- | --- | --- |
| 客户端 → Worker | 分析提交 | `POST http://10.20.130.251:8080/narrate/ai_video_director/getAiVideoEditingAnalysisData` |
| Worker → 客户端 | 分析回调 | `POST {客户端回调基地址}/ai_video_director/getAiVideoEditingAnalysisDataCallback` |
| 客户端 → Worker | 渲染提交 | `POST http://10.20.130.251:8080/narrate/ai_video_director/getAiVideoEditingData` |
| Worker → 客户端 | 视频回调 | `POST {客户端回调基地址}/ai_video_director/getAiVideoEditingDataCallback` |
| 客户端 → Worker | 健康检查 | `GET http://10.20.130.251:8080/healthz` |

只有两个「客户端提交给 Worker」的接口带 `/narrate` 前缀。两个回调接口不带 `/narrate` 前缀，且由客户端提供，不是 Worker 对外暴露的路由。

## 2. 鉴权与请求约定

两个 Worker 提交接口均需携带下列请求头：

```http
Authorization: Bearer <联调分配的 API Key>
Content-Type: application/json
```

- API Key 由服务端单独分配，不能写入接口文档、前端代码或日志。
- `healthz` 不需要鉴权，成功时返回 `{ "status": 0 }`。
- 没有或错误的鉴权会返回 HTTP `401` 和 `{ "status": 1, "msg": "UNAUTHORIZED" }`。
- 请求格式错误会返回 HTTP `400` 和 `msg: "INVALID_REQUEST"`；业务任务接收成功返回 HTTP `202`。
- 素材 `url` 是 Worker 可读取的文件绝对路径，不是浏览器本机路径，也不是 `file://` URL。联调环境请使用已挂载到 Worker 的共享目录，例如 `/home/ops/jiangzb/videos/input/...`。

Worker 接收成功时的统一响应如下：

```jsonc
{
  "status": 0,
  "msg": "accepted",
  "data": {
    "taskId": "client-task-001",
    "runId": "UUID",
    "state": "queued",
    "stage": "analysis",
    "planVersion": 1
  }
}
```

`runId` 用于服务端运行追踪；客户端后续渲染提交应以分析回调中的 `planVersion` 为准，而不是只依赖接收响应。

## 3. 分析提交

### 3.1 请求地址

```http
POST /narrate/ai_video_director/getAiVideoEditingAnalysisData
```

当前 Worker 使用协议版本 `2`。没有数字人的本次流程仍须保留历史兼容字段 `digitalHumanAccounId`、`plugin.digitalHumanId`，其值传空字符串即可；不要传 `null` 或删除字段。

```json
{
  "schemaVersion": 2,
  "requestId": "client-request-20260920-001",
  "taskId": "client-task-001",
  "script": "待剪辑的完整文案",
  "otherRequirements": "竖屏财经双人对话风格",
  "digitalHumanAccounId": "",
  "plugin": {
    "digitalHumanId": "",
    "templateId": "finance_dialogue_v1"
  },
  "narration": null,
  "outputSpec": {
    "width": 1080,
    "height": 1920,
    "fps": 30
  },
  "otherMaterial": {
    "picInfoList": [
      {
        "assetId": "image-001",
        "url": "/home/ops/jiangzb/videos/input/client-task-001/chart.jpg"
      }
    ],
    "videoInfoList": [
      {
        "assetId": "video-001",
        "url": "/home/ops/jiangzb/videos/input/client-task-001/market.mp4"
      }
    ]
  }
}
```

字段要点：

- `requestId` 是客户端幂等键；同一请求不可复用为不同任务。
- `taskId` 是客户端任务标识，分析和渲染必须保持一致。
- `script`、`otherRequirements`、`otherMaterial` 为必填字段；图片和视频数组可以为空。
- 每个素材的 `assetId` 必填且在同一请求内唯一。
- 当前服务器的测试模板为 `finance_dialogue_v1`，其内容来自本机已打包的财经模板 ZIP。
- 后续接入定制化模板服务后，`templateId` 改传定制化模板 ID；服务端还需配置 `CUSTOM_TEMPLATE_API_BASE_URL` 后才会下载对应 ZIP。该地址当前未配置，不应以数字模板 ID 发起本轮测试。

## 4. 分析回调

### 4.1 回调地址

```http
POST {客户端回调基地址}/ai_video_director/getAiVideoEditingAnalysisDataCallback
```

Worker 分析完成后异步回调。成功载荷的关键结构如下，`dataList` 和 `plan` 必须由客户端原样保存，用于下一步渲染确认：

```jsonc
{
  "schemaVersion": 2,
  "eventId": "UUID",
  "requestId": "client-request-20260920-001",
  "taskId": "client-task-001",
  "runId": "UUID",
  "planVersion": 1,
  "status": 0,
  "msg": "",
  "dataInfo": {
    "templateId": "finance_dialogue_v1",
    "durationMode": "estimated"
  },
  "dataList": [
    {
      "id": "scene-001",
      "content": "分镜文案",
      "dur": 3.2,
      "visualPlan": {
        "description": "全屏展示财经图表",
        "layoutPreset": "full_frame",
        "animationPreset": "slow_zoom"
      },
      "extraData": {
        "keywordList": ["财经"],
        "digitalHumanId": "",
        "videoInfoList": [],
        "picInfoList": []
      }
    }
  ],
  "plan": {
    // 此处必须是分析回调携带的完整 plan 对象，客户端原样保存、原样回传；不能按本示例自行构造。
  }
}
```

`durationMode` 为 `audio` 表示时长来自已测量音频；为 `estimated` 表示预估时长。`previews` 可能额外出现在 `dataInfo` 内。

分析失败时仍会回调，顶层 `status` 为 `1`，并包含 `error` 对象；客户端应记录该失败而非继续提交渲染。

## 5. 渲染提交

### 5.1 请求地址

```http
POST /narrate/ai_video_director/getAiVideoEditingData
```

客户端确认或编辑分析结果后，提交完整的 `dataList`。本次流程没有数字人时，兼容字段 `field_5` 传空字符串。

```jsonc
{
  "schemaVersion": 2,
  "requestId": "client-request-20260920-002",
  "taskId": "client-task-001",
  "basePlanVersion": 1,
  "field_5": "",
  "templateId": "finance_dialogue_v1",
  "dataList": [
    {
      "id": "scene-001",
      "content": "客户端确认后的分镜文案",
      "dur": 3.2,
      "visualPlan": {
        "description": "全屏展示财经图表",
        "layoutPreset": "full_frame",
        "animationPreset": "slow_zoom"
      },
      "extraData": {
        "keywordList": ["财经"],
        "digitalHumanId": "",
        "videoInfoList": [],
        "picInfoList": []
      }
    }
  ],
  "plan": {
    // 此处必须是分析回调携带的完整 plan 对象，客户端原样回传；实际发送时删除本注释。
  }
}
```

字段要点：

- `basePlanVersion` 必须等于分析回调的 `planVersion`；版本不一致时服务端拒绝，避免渲染过期方案。
- `templateId` 必须与分析阶段一致。
- `dataList` 必须提交完整分镜列表，即使只编辑了一条分镜，也不能只提交那一条。
- 应同时原样回传分析回调中的 `plan`；这能保留模板制作信息。

## 6. 视频回调

### 6.1 回调地址

```http
POST {客户端回调基地址}/ai_video_director/getAiVideoEditingDataCallback
```

成功回调与分析回调的公共字段一致，并新增 `resultVersion`。`dataInfo` 包含 `sceneCount`、`width`、`height`、`fps`；`dataList` 为完整的成片分镜及其输出信息。

```json
{
  "schemaVersion": 2,
  "eventId": "UUID",
  "requestId": "client-request-20260920-002",
  "taskId": "client-task-001",
  "runId": "UUID",
  "planVersion": 1,
  "resultVersion": 1,
  "status": 0,
  "msg": "",
  "dataInfo": {
    "templateId": "finance_dialogue_v1",
    "sceneCount": 1,
    "width": 1080,
    "height": 1920,
    "fps": 30
  },
  "dataList": []
}
```

## 7. 客户端回调验收规则

客户端回调接口应校验并处理下列请求头：

| 请求头 | 含义 |
| --- | --- |
| `x-event-id` | 回调事件唯一 ID；客户端应按此做幂等去重。 |
| `x-callback-timestamp` | Unix 秒级时间戳。 |
| `x-callback-signature` | `HMAC-SHA256(callbackSecret, timestamp + "." + 原始请求体)` 的十六进制结果。 |

回调接口只有同时满足以下条件才被 Worker 视为成功：HTTP `2xx`，且响应 JSON 为：

```json
{
  "status": 0,
  "msg": ""
}
```

超时为 15 秒。网络错误、非 `2xx`、非 JSON 或 `status` 非 `0` 均不会被当作成功；Worker 会保存事件并重试。明确的 4xx（HTTP `429` 除外）或明确业务失败会进入死信状态，可由服务端人工重发。

## 8. 当前联调验证结果与待办

| 检查项 | 结果 |
| --- | --- |
| `GET /healthz`（服务器外部访问） | 已通过。 |
| 两个 Worker 提交接口的外部 TCP/HTTP 连通性 | 已通过；缺失凭证时均返回预期 `401`。 |
| 带有效服务端凭证的两个 Worker 提交接口 | 已到达参数校验层，路由正确。 |
| Worker 执行服务与 Codex app-server | 已启动并运行。 |
| 两个回调路径 | 已与当前 Docker 测试回调接收器验证可达。 |
| 真实客户端回调地址 | 待客户端提供可访问地址，并配置 `IFENG_CALLBACK_BASE_URL` 与共享的 `IFENG_CALLBACK_SECRET` 后复测。 |

当前 API 已监听 `0.0.0.0:8080` 以供内网联调。上线到可被非受信网络访问的环境前，应增加网关或防火墙来源限制、TLS 和访问审计，不能仅依赖 Bearer Key。
