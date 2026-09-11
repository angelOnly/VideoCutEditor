# AI 视频剪辑接口文档

> 根据用户提供的 5 张 YApi 截图整理，整理日期：2026-09-10。
> 本文记录截图中的接口定义，不代表已联调或已上线。4 个接口在截图中均标记为「未完成」。
> 媒体路径说明已按用户后续澄清补充：`url` 当前为本机文件路径，后续为共享盘路径。

## 1. 文档范围与通用约定

| 序号 | 接口名称 | 请求方式 | 接口路径 | 截图来源 |
| --- | --- | --- | --- | --- |
| 1 | 获取ai剪辑视频分析数据 | POST | `/ai_video_director/getAiVideoEditingAnalysisData` | 截图 1 |
| 2 | 获取ai剪辑视频分析数据回调 | POST | `/ai_video_director/getAiVideoEditingAnalysisDataCallback` | 截图 2；截图 3 为请求体展开补充 |
| 3 | 获取ai剪辑视频数据 | POST | `/ai_video_director/getAiVideoEditingData` | 截图 4 |
| 4 | 获取ai剪辑视频数据回调 | POST | `/ai_video_director/getAiVideoEditingDataCallback` | 截图 5 |

文档平台项目 ID 为 `2482`。用户提供的[视频数据回调文档链接](http://api.ifengcloud.ifeng.com/project/2482/interface/api/49567)对应接口 4。

### 1.1 请求头

4 个接口均要求以下请求头：

| 参数名 | 参数值 | 必须 |
| --- | --- | --- |
| `Content-Type` | `application/json` | 是 |

### 1.2 通用返回结构

4 个接口的「返回数据」均为：

```jsonc
{
  "status": 0, // number，必填；0 成功，其他失败
  "msg": "string" // string，必填；error信息
}
```

回调接口请求体中的 `status`、`msg` 与本节响应字段分别记录，不能混为同一个字段。

### 1.3 记法与未提供的信息

- 请求体与返回数据使用嵌套 JSON 结构展示，采用 `jsonc` 代码块承载字段注释；实际发送 JSON 时须去掉注释。
- 所有具名字段的必填性按截图记录。字段必填不代表数组必须非空，截图未给出数组长度限制。
- 结构中的 `"string"`、`0`、`["string"]` 仅表示字段类型和嵌套关系，不是默认值或真实业务示例。`status` 的 `0` 表示成功。
- 未展开的对象数组用 `[{}]` 展示结构并加注释，不代表空对象符合实际接口要求。
- 生产/测试服务 Base URL、鉴权方式、HTTP 状态码、失败码枚举、超时和回调重试规则均未提供。
- 以下 Mock 地址仅为截图中的 YApi Mock 地址，不作为实际业务服务地址。

### 1.4 媒体 `url` 字段的路径含义

按用户后续澄清，媒体 `url` 是文件系统绝对路径，当前指向本机文件，后续改为共享盘挂载后的文件路径；保留字段名称，不使用远程媒体 URL 或 `file://`。此约定适用于全部素材引用及成片路径，HTTP 接口路径和 YApi Mock 地址不受影响。

服务部署在 Ubuntu，媒体根目录为 `/home/ops/jiangzb/videos`，统一由 `MEDIA_ROOT` 配置管理。下文该根目录下的文件名仅为占位示例。迁移共享盘时调整根目录映射、挂载和访问权限，无需修改字段结构。输入路径须能被 Worker 读取，回调路径须能被编辑平台后端读取；不能返回仅在执行容器内有效的临时路径。浏览器预览由编辑平台后端读取文件后提供。具体映射及发布流程见 [上下游对接方案](AI视频剪辑上下游对接方案.md)。

## 2. 获取ai剪辑视频分析数据

### 2.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 请求方式 | POST |
| 接口路径 | `/ai_video_director/getAiVideoEditingAnalysisData` |
| 状态 | 未完成 |
| 创建人 | hanjing5 |
| 更新时间 | 2026-09-10 09:58:35 |
| Mock 地址 | [YApi Mock](http://api.ifengcloud.ifeng.com/mock/2482/ai_video_director/getAiVideoEditingAnalysisData) |

### 2.2 请求体

```jsonc
{
  "taskId": "string", // string，必填；任务id
  "otherRequirements": "string", // string，必填；需求描述
  "digitalHumanAccounId": "string", // string，必填；数字人账号id
  "plugin": {
    "digitalHumanId": "string", // string，数字人id，必填
    "templateId": "string" // string，必填；模板
  }, // object，必填；插件
  "otherMaterial": {
    "picInfoList": [
      {
        "url": "/home/ops/jiangzb/videos/input/chart.jpg" // string，必填
      }
    ], // object[]，必填；图片数据
    "videoInfoList": [
      {
        "url": "/home/ops/jiangzb/videos/input/market.mp4" // string，必填
      }
    ] // object[]，必填；视频数据
  } // object，必填；补充素材
}
```

注：截图中的账号字段按 `digitalHumanAccounId` 转录，`Accoun` 后未见 `t`；对接前需确认是否为原文命名笔误，不应自行改名。

### 2.3 返回数据

```jsonc
{
  "status": 0, // number，必填；0 成功，其他失败
  "msg": "string" // string，必填；error信息
}
```

## 3. 获取ai剪辑视频分析数据回调

### 3.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 请求方式 | POST |
| 接口路径 | `/ai_video_director/getAiVideoEditingAnalysisDataCallback` |
| 状态 | 未完成 |
| 创建人 | hanjing5 |
| 更新时间 | 2026-09-10 09:55:53 |
| Mock 地址 | [YApi Mock](http://api.ifengcloud.ifeng.com/mock/2482/ai_video_director/getAiVideoEditingAnalysisDataCallback) |

### 3.2 请求体

以下结构合并截图 2 与截图 3。截图 3 没有接口标题，根据字段结构作为截图 2 的展开补充整理。

```jsonc
{
  "status": 0, // number，必填；0 成功，其他失败
  "taskId": "string", // string，必填；任务id
  "dataInfo": {
    "templateId": "string" // string，必填；模板id
  }, // object，必填
  "dataList": [
    {
      "id": "string", // string，必填；内容id
      "content": "string", // string，必填；文字
      "dur": 0, // number，必填；时长
      "extraData": {
        "keywordList": ["string"], // string[]，必填；花字
        "videoInfoList": [
          {
            "url": "/home/ops/jiangzb/videos/input/market.mp4", // string，必填
            "dur": 0, // number，必填；时长
            "startTime": 0, // number，必填
            "endTime": 0 // number，必填
          }
        ], // object[]，必填；视频数据
        "picInfoList": [
          {
            "w": 0, // number，必填
            "h": 0, // number，必填
            "url": "/home/ops/jiangzb/videos/input/chart.jpg", // string，必填
            "startTime": 0, // number，必填
            "endTime": 0 // number，必填
          }
        ], // object[]，必填；图片数据
        "digitalHumanId": "string" // string，必填；数字人id
      } // object，必填
    }
  ], // object[]，必填
  "msg": "string" // string，必填；error信息
}
```

补充说明：

- 根据截图缩进，`dataInfo` 与 `dataList` 是根级同级字段；`dataList` 不属于 `dataInfo`。
- 截图 3 展开 `keywordList` 后有一行无字段名、标为「非必须」的数组元素行。保留数组类型为 `string[]`，不将该行新增为业务字段。
- `dur`、`startTime`、`endTime` 的时间单位、时间参照系以及区间边界规则未说明。
- `w`、`h` 的含义及单位未填写，不在本文自行确定。

### 3.3 返回数据

```jsonc
{
  "status": 0, // number，必填；0 成功，其他失败
  "msg": "string" // string，必填；error信息
}
```

## 4. 获取ai剪辑视频数据

### 4.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 请求方式 | POST |
| 接口路径 | `/ai_video_director/getAiVideoEditingData` |
| 状态 | 未完成 |
| 创建人 | hanjing5 |
| 更新时间 | 2026-09-10 09:58:05 |
| Mock 地址 | [YApi Mock](http://api.ifengcloud.ifeng.com/mock/2482/ai_video_director/getAiVideoEditingData) |

### 4.2 请求体

```jsonc
{
  "taskId": "string", // string，必填；任务id
  "field_5": "string", // string，必填；数字人账号id
  "templateId": "string", // string，必填；模板id
  "dataList": [
    {
      "id": "string", // string，必填；内容id
      "content": "string", // string，必填；文字
      "dur": 0, // number，必填；时长
      "extraData": {
        "keywordList": ["string"], // string[]，必填；花字
        "videoInfoList": [
          {

          }
        ], // object[]，必填；视频数据；元素字段截图未展开，{} 仅作占位
        "picInfoList": [
          {

          }
        ], // object[]，必填；图片数据；元素字段截图未展开，{} 仅作占位
        "digitalHumanId": "string" // string，必填；数字人id
      } // object，必填
    }
  ] // object[]，必填
}
```

补充说明：

- `field_5` 是截图原始字段名，保留原样。虽然备注同为「数字人账号id」，不能直接认定它与接口 1 的 `digitalHumanAccounId` 可互换。
- 截图 4 中 `videoInfoList`、`picInfoList` 未展开，数组元素内部字段未展示。不直接套用接口 2 的元素定义。
- `dur` 的时间单位未说明。

### 4.3 返回数据

```jsonc
{
  "status": 0, // number，必填；0 成功，其他失败
  "msg": "string" // string，必填；error信息
}
```

## 5. 获取ai剪辑视频数据回调

### 5.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 请求方式 | POST |
| 接口路径 | `/ai_video_director/getAiVideoEditingDataCallback` |
| 状态 | 未完成 |
| 创建人 | 截图未展示 |
| 更新时间 | 2026-09-10 09:56:53 |
| Mock 地址 | [YApi Mock](http://api.ifengcloud.ifeng.com/mock/2482/ai_video_director/getAiVideoEditingDataCallback) |
| YApi 文档 | [接口 49567](http://api.ifengcloud.ifeng.com/project/2482/interface/api/49567) |

### 5.2 请求体

```jsonc
{
  "status": 0, // number，必填；0 成功，其他失败
  "taskId": "string", // string，必填；任务id
  "dataInfo": {
    "templateId": "string" // string，必填；模板id
  }, // object，必填
  "dataList": [
    {
      "id": "string", // string，必填；内容id
      "content": "string", // string，必填；文字
      "dur": 0, // number，必填；时长
      "url": "/home/ops/jiangzb/videos/tasks/task_001/results/r1/scene_001.mp4", // string，必填
      "extraData": {
        "keywordList": ["string"], // string[]，必填；花字
        "videoInfoList": [
          {

          }
        ], // object[]，必填；视频数据；元素字段截图未展开，{} 仅作占位
        "picInfoList": [
          {

          }
        ], // object[]，必填；图片数据；元素字段截图未展开，{} 仅作占位
        "digitalHumanId": "string" // string，必填；数字人id
      } // object，必填
    }
  ], // object[]，必填；第0个元素是整体数据，剩下的是按照顺序的分段数据
  "msg": "string" // string，必填；error信息
}
```

补充说明：

- `dataInfo` 与 `dataList` 是根级同级字段。
- 此接口明确规定 `dataList[0]` 为整体数据，`dataList[1]` 起为依次排列的分段数据。其他接口截图没有这条说明，不自动扩展到其他接口。
- 相比分析数据回调，此接口的 `dataList[]` 多出 `url` 字段；按用户后续澄清，该字段承载分镜 MP4 的本机文件路径，后续改为共享盘路径；具体保留期和访问权限仍需约定。
- 截图 5 中 `videoInfoList`、`picInfoList` 未展开，元素内部结构待补充。
- `dur` 的时间单位未说明。

### 5.3 返回数据

```jsonc
{
  "status": 0, // number，必填；0 成功，其他失败
  "msg": "string" // string，必填；error信息
}
```

## 6. 对接前待确认项

以下是截图信息缺口，不是新增接口要求：

| 待确认项 | 当前记录 |
| --- | --- |
| 数字人账号字段名 | 接口 1 为 `digitalHumanAccounId`；接口 3 为 `field_5`，是否统一待确认 |
| 素材数组元素结构 | 接口 2 有展开定义，接口 3、4 未展开，是否一致待确认 |
| 时间及尺寸单位 | `dur`、`startTime`、`endTime`、`w`、`h` 未明确单位和语义 |
| 任务 ID 规则 | 仅说明为任务id；生成方、唯一性范围、重复提交和后续修改规则未提供 |
| 必填与失败场景 | 截图将回调数据字段标为必须，但失败回调是否允许省略数据字段未说明 |
| 调用方向与回调配置 | 各接口的服务提供方、调用方及回调地址配置方式未提供 |
| 状态含义 | 仅有业务状态 `0` 成功、其他失败；受理成功与制作完成的关系、失败码枚举未提供 |
| 运行与访问规则 | 实际 HTTP Base URL、鉴权、超时、回调重试、去重，以及媒体根目录映射、共享盘挂载、文件权限和保留期仍需约定 |
