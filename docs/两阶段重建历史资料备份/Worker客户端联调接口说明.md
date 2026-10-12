# Worker 客户端联调接口说明

> 联调环境实测日期：2026-09-20；服务提交：`997b0f8`。该实测为历史记录；本文调用约定已按两阶段适配更新，新实现尚待部署复测；字段明细以 [AI视频剪辑接口文档](AI视频剪辑接口文档.md) 为基础，并补充当前 Worker 的强制字段。

## 1. 联调地址与流程

Worker 基地址为：`http://10.20.130.251:8080`。

```text
客户端 --分析提交--> Worker --分析回调--> 客户端
客户端 --渲染提交--> Worker --视频回调--> 客户端
```

| 方向             | 用途     | 方法与地址                                                                                 |
| ---------------- | -------- | ------------------------------------------------------------------------------------------ |
| 客户端 → Worker | 分析提交 | `POST http://10.20.130.251:8080/narrate/ai_video_director/getAiVideoEditingAnalysisData` |
| Worker → 客户端 | 分析回调 | `POST http://10.20.130.250:8000/ai_video_director/getAiVideoEditingAnalysisDataCallback`        |
| 客户端 → Worker | 渲染提交 | `POST http://10.20.130.251:8080/narrate/ai_video_director/getAiVideoEditingData`         |
| Worker → 客户端 | 视频回调 | `POST http://10.20.130.250:8000/ai_video_director/getAiVideoEditingDataCallback`                |
| 客户端 → Worker | 健康检查 | `GET http://10.20.130.251:8080/healthz`                                                  |

只有两个「客户端提交给 Worker」的接口带 `/narrate` 前缀。两个回调接口不带 `/narrate` 前缀，且由客户端提供，不是 Worker 对外暴露的路由。

## 2. 请求约定

两个 Worker 提交接口均需携带下列请求头：

```http
Content-Type: application/json
```

- 当前联调 Worker 不要求 `Authorization` 鉴权头；请仅在受控内网或已配置访问限制的网关后使用。
- `healthz` 成功时返回 `{ "status": 0 }`。
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
    "planVersion": 0
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
  "otherRequirements": "横屏财经双人对话风格",
  "digitalHumanAccounId": "",
  "plugin": {
    "digitalHumanId": "",
    "templateId": "finance_dialogue_v1"
  },
  "narration": null,
  "outputSpec": {
    "width": 1920,
    "height": 1080,
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
- 后续接入定制化模板服务后，`templateId` 改传定制化模板 ID；服务端还需配置 `CUSTOM_TEMPLATE_API_BASE_URL` 后才会下载对应 ZIP。部署时按实际配置核对；本地 ZIP 不代表远程模板接口已联调。

## 4. 分析回调

### 4.1 回调地址

```http
POST http://10.20.130.250:8000/ai_video_director/getAiVideoEditingAnalysisDataCallback
```

Worker 分析完成后异步回调。成功载荷的关键结构如下，客户端保存 `planVersion` 和可编辑的完整 `dataList`，无需保存内部制作方案：

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
      "id": "scene_001",
      "content": "分镜文案",
      "dur": 3.2,
      "durationSource": "estimated",
      "production": {},
      "extraData": {
        "keywordList": [],
        "digitalHumanId": "",
        "videoInfoList": [],
        "picInfoList": []
      }
    }
  ],
  "plan": {}
}
```

Analysis 的时长固定为 `estimated`，仅用于文本列表展示；`dataInfo.previews` 为 `[]`，不生成音频、图片或制作时间轴。

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
    {"id": "scene_001", "content": "客户端确认后的分镜文案。"}
  ]
}
```

字段要点：

- `basePlanVersion` 必须等于任务当前的 `planVersion`（首次确认取分析回调，后续修改先刷新查询）；版本不一致时服务端拒绝，避免渲染过期方案。
- `templateId` 必须与分析阶段一致。
- `dataList` 必须提交完整分镜列表，即使只编辑了一条分镜，也不能只提交那一条。
- `plan` 可省略或传 `{}`；非空时只核对关联身份。制作内容以 `dataList` 为准，支持增删、改字及排序；ID 唯一且长度不超过 128。
- 每条仅需 `id/content`；`dur`、`production`、`visualPlan` 和 `extraData` 均可省略。时长由 Render 实测，未知字段不会当作技术执行指令。
- 数字人字段必须为空。素材路径仍须通过服务端授权和文件检查。

## 6. 视频回调

### 6.1 回调地址

```http
POST http://10.20.130.250:8000/ai_video_director/getAiVideoEditingDataCallback
```

成功回调与分析回调的公共字段一致，并新增 `resultVersion`。`dataInfo` 包含 `sceneCount`、`width`、`height`、`fps`；`dataList` 为完整的成片分镜及其输出信息。

```json
{
  "schemaVersion": 2,
  "eventId": "UUID",
  "requestId": "client-request-20260920-002",
  "taskId": "client-task-001",
  "runId": "UUID",
  "planVersion": 2,
  "resultVersion": 1,
  "status": 0,
  "msg": "",
  "dataInfo": {
    "templateId": "finance_dialogue_v1",
    "sceneCount": 1,
    "width": 1920,
    "height": 1080,
    "fps": 30
  },
  "dataList": [{
    "id": "scene_001",
    "content": "客户端确认后的分镜文案。",
    "dur": 3.2,
    "url": "/home/ops/jiangzb/videos/tasks/内部任务ID/results/执行版本/scene_001.mp4",
    "production": {},
    "extraData": {"keywordList": [], "digitalHumanId": "", "videoInfoList": [], "picInfoList": []}
  }]
}
```

确认 N 句，按确认顺序返回 N 条 MP4；不额外返回总片、内部 plan、工程或时间轴，素材数组为空。制作记录仍保留在服务端供续编。

## 7. 客户端回调验收规则

客户端回调接口应校验并处理下列请求头：

| 请求头                   | 含义                                                                           |
| ------------------------ | ------------------------------------------------------------------------------ |
| `x-event-id`           | 回调事件唯一 ID；客户端应按此做幂等去重。                                      |
| `x-callback-timestamp` | Unix 秒级时间戳。                                                              |
| `x-callback-signature` | `HMAC-SHA256(callbackSecret, timestamp + "." + 原始请求体)` 的十六进制结果。 |

回调接口只有同时满足以下条件才被 Worker 视为成功：HTTP `2xx`，且响应 JSON 为：

```json
{
  "status": 0,
  "msg": ""
}
```

超时为 15 秒。网络错误、非 `2xx`、非 JSON 或 `status` 非 `0` 均不会被当作成功；Worker 会保存事件并重试。明确的 4xx（HTTP `429` 除外）或明确业务失败会进入死信状态，可由服务端人工重发。

## 8. 历史联调记录与待办

下表前五项为 2026-09-20 旧服务记录，不代表此次新实现已部署或验收。

| 检查项                                     | 结果                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `GET /healthz`（服务器外部访问）         | 已通过。                                                                                              |
| 两个 Worker 提交接口的外部 TCP/HTTP 连通性 | 已通过；无鉴权请求可到达参数校验层。                                                                  |
| 两个 Worker 提交接口的参数校验             | 已到达参数校验层，路由正确。                                                                          |
| Worker 执行服务与 Codex app-server         | 已启动并运行。                                                                                        |
| 两个回调路径                               | 已与当前 Docker 测试回调接收器验证可达。                                                              |
| 真实客户端回调地址                         | 已指定 `http://10.20.130.250:8000`；部署配置 `IFENG_CALLBACK_BASE_URL` 和共享密钥后复测。 |

当前 API 已监听 `0.0.0.0:8080` 以供内网联调。由于当前业务接口不做入站鉴权，上线到可被非受信网络访问的环境前，必须增加网关或防火墙来源限制、TLS 和访问审计。
