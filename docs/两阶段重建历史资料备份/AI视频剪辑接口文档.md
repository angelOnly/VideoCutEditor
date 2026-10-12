# AI 视频剪辑接口文档

> 根据用户提供的 YApi 截图和接口示例整理，AI 视频剪辑接口整理日期：2026-09-10，基础资源接口整理日期：2026-09-18。
> 本文记录截图中的接口定义，不代表已联调或已上线。原有 4 个 AI 视频剪辑接口以及本次补充的 5 个基础资源接口在截图中均标记为「未完成」。
> 媒体路径说明已按用户后续澄清补充：`url` 当前为本机文件路径，后续为共享盘路径。

## 1. 文档范围与通用约定

| 序号 | 接口名称 | 请求方式 | 接口路径 | 截图来源 |
| --- | --- | --- | --- | --- |
| 1 | 获取ai剪辑视频分析数据 | POST | `/ai_video_director/getAiVideoEditingAnalysisData` | 截图 1 |
| 2 | 获取ai剪辑视频分析数据回调 | POST | `/ai_video_director/getAiVideoEditingAnalysisDataCallback` | 截图 2；截图 3 为请求体展开补充 |
| 3 | 获取ai剪辑视频数据 | POST | `/ai_video_director/getAiVideoEditingData` | 截图 4 |
| 4 | 获取ai剪辑视频数据回调 | POST | `/ai_video_director/getAiVideoEditingDataCallback` | 截图 5 |
| 5 | 获取数字人详情 | GET | `/api/digital-humans/{hid}` | 本次截图 1 |
| 6 | 获取模板详情 | GET | `/api/templates/{tid}` | 本次截图 2 |
| 7 | 获取素材详情 | GET | `/api/materials/{mid}` | 本次截图 4 |
| 8 | 下载素材文件 | GET | `/api/materials/{mid}/file` | 本次截图 3 |
| 9 | 获取定制化模板详情 | GET | `/api/custom-templates/{id}` | 本次截图 5 |

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

## 6. 基础资源查询接口

本节记录本次补充的数字人、模板和素材查询接口。与前文 AI 视频剪辑接口不同，这 5 个接口均为 GET 请求，截图只展示了路径参数，没有展示请求体或统一请求头配置。

### 6.1 通用约定

- 路径中的 `{hid}`、`{tid}`、`{mid}` 为路径参数，实际请求时替换为具体数字 ID，不要保留大括号。
- 数字人详情、模板详情和素材详情接口使用统一的 JSON 响应外层结构：`code`、`message`、`data`。
- 示例中 `code = 0`、`message = "success"` 表示成功；其他错误码、错误信息格式和 HTTP 状态码未在截图中提供。
- 本节中的 `created_at` 为带时区的 ISO 8601 时间字符串，示例时区为 `+08:00`。
- 截图只提供成功返回示例，未说明鉴权方式、分页、缓存、限流、超时和失败重试规则。

### 6.2 获取数字人详情

#### 6.2.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 接口名称 | 获取数字人详情 |
| 请求方式 | GET |
| 接口路径 | `/api/digital-humans/{hid}` |
| 状态 | 未完成 |
| 创建人 | zhangjt |
| 更新时间 | 2026-09-15 09:32:15 |
| Mock 地址 | [YApi Mock](http://api.ifengcloud.ifeng.com/mock/2482/api/digital-humans/{hid}) |

#### 6.2.2 路径参数

| 参数名 | 类型 | 示例 | 必须 | 说明 |
| --- | --- | --- | --- | --- |
| `hid` | number | `1` | 是 | 本平台数字人 ID |

示例请求：

```http
GET /api/digital-humans/1
```

#### 6.2.3 返回数据

```jsonc
{
  "code": 0, // number；示例中 0 表示成功
  "message": "success", // string；响应消息
  "data": {
    "id": 1, // number；数字人记录 ID
    "group_id": 4, // number；所属分组 ID
    "group_name": "凤凰科技", // string；所属分组名称
    "owner_id": 16, // number；所属用户或所有者 ID
    "account_id": 5, // number；关联账号 ID
    "name": "小熙-常杀人", // string；数字人实例名称
    "figure_id": "3840278", // string；数字人形象 ID
    "figure_name": "小熙", // string；数字人形象名称
    "figure_type": null, // string | null；数字人形象类型，示例为空
    "gender": "FEMALE", // string；性别枚举，示例为女性
    "voice_id": "LMV_10578", // string；关联音色 ID
    "voice_name": "长沙妹子", // string；关联音色名称
    "source": "public", // string；数字人来源，示例为公共资源
    "thumbnail": "https://star-light-lite.cdn.bcebos.com/figure/video/fig-sbeqrgwzndcrs9i920260205_144805main.png", // string；缩略图地址
    "status": "ready", // string；数字人状态，示例为已就绪
    "params": {}, // object；扩展参数，示例为空对象
    "note": null, // string | null；备注，示例为空
    "created_at": "2026-09-10T17:30:58.228566+08:00" // string；创建时间
  }
}
```

#### 6.2.4 字段说明

| 字段路径 | 类型 | 示例 | 说明 |
| --- | --- | --- | --- |
| `code` | number | `0` | 业务返回码；成功码为 `0` 仅依据示例记录 |
| `message` | string | `success` | 业务返回消息 |
| `data` | object | - | 数字人详情对象 |
| `data.id` | number | `1` | 数字人记录 ID |
| `data.group_id` | number | `4` | 分组 ID |
| `data.group_name` | string | `凤凰科技` | 分组名称 |
| `data.owner_id` | number | `16` | 所有者 ID |
| `data.account_id` | number | `5` | 关联账号 ID |
| `data.name` | string | `小熙-常杀人` | 数字人名称 |
| `data.figure_id` | string | `3840278` | 形象 ID |
| `data.figure_name` | string | `小熙` | 形象名称 |
| `data.figure_type` | string \| null | `null` | 形象类型；示例为空 |
| `data.gender` | string | `FEMALE` | 性别字段；可见示例值为 `FEMALE` |
| `data.voice_id` | string | `LMV_10578` | 音色 ID |
| `data.voice_name` | string | `长沙妹子` | 音色名称 |
| `data.source` | string | `public` | 来源；示例值为公共资源 |
| `data.thumbnail` | string | URL | 缩略图地址 |
| `data.status` | string | `ready` | 数字人状态；示例值为已就绪 |
| `data.params` | object | `{}` | 扩展参数；具体键值未提供 |
| `data.note` | string \| null | `null` | 备注 |
| `data.created_at` | string | ISO 8601 | 创建时间 |

字段是否必填、`gender`、`source`、`status` 的完整枚举，以及 `params` 的扩展字段未在截图中说明。

### 6.3 获取模板详情

#### 6.3.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 接口名称 | 获取模板详情 |
| 请求方式 | GET |
| 接口路径 | `/api/templates/{tid}` |
| 状态 | 未完成 |
| 创建人 | zhangjt |
| 更新时间 | 2026-09-15 09:38:08 |
| Mock 地址 | [YApi Mock](http://api.ifengcloud.ifeng.com/mock/2482/api/templates/{tid}) |

#### 6.3.2 路径参数

| 参数名 | 类型 | 示例 | 必须 | 说明 |
| --- | --- | --- | --- | --- |
| `tid` | number | `5` | 是 | 模板 ID |

示例请求：

```http
GET /api/templates/5
```

#### 6.3.3 返回数据

```jsonc
{
  "code": 0, // number；示例中 0 表示成功
  "message": "success", // string；响应消息
  "data": {
    "id": 5, // number；模板记录 ID
    "group_id": 4, // number；所属分组 ID
    "group_name": "凤凰科技", // string；所属分组名称
    "owner_id": 16, // number；所属用户或所有者 ID
    "type": "cover", // string；模板类型
    "name": "ssssss", // string；模板名称
    "description": "", // string；模板描述
    "tags": [], // string[]；模板标签
    "note": "", // string；备注
    "data": {
      "els": {
        "bg": {
          "x": 0, // number；元素横向位置
          "y": 0, // number；元素纵向位置
          "w": 100, // number；元素宽度
          "h": 100, // number；元素高度
          "op": 100, // number；元素透明度或不透明度配置
          "z": 10 // number；元素层级
        },
        "logo": {
          "x": 4,
          "y": 3,
          "w": 22,
          "h": 7,
          "op": 100,
          "z": 2
        },
        "title": {
          "x": 7,
          "y": 21,
          "w": 86,
          "h": 14,
          "op": 100,
          "z": 3
        },
        "biz": {
          "x": 68,
          "y": 3,
          "w": 28,
          "h": 6,
          "op": 90,
          "z": 1
        },
        "sub": {
          "x": 7,
          "y": 76,
          "w": 86,
          "h": 9,
          "op": 100,
          "z": 4
        }
      },
      "on": {
        "bg": true, // boolean；是否启用背景元素
        "logo": true, // boolean；是否启用 Logo 元素
        "title": true, // boolean；是否启用标题元素
        "biz": true, // boolean；是否启用业务信息元素
        "sub": false // boolean；是否启用副标题元素
      },
      "mats": {
        "bg": null, // object | null；背景素材绑定
        "logo": null, // object | null；Logo 素材绑定
        "title": null, // object | null；标题素材绑定
        "biz": null, // object | null；业务信息素材绑定
        "sub": null // object | null；副标题素材绑定
      }
    },
    "created_at": "2026-09-11T12:22:41.660319+08:00", // string；创建时间
    "updated_at": "2026-09-11T12:22:41.660319+08:00" // string；更新时间
  }
}
```

#### 6.3.4 字段说明

| 字段路径 | 类型 | 示例 | 说明 |
| --- | --- | --- | --- |
| `data.id` | number | `5` | 模板记录 ID |
| `data.group_id` | number | `4` | 分组 ID |
| `data.group_name` | string | `凤凰科技` | 分组名称 |
| `data.owner_id` | number | `16` | 所有者 ID |
| `data.type` | string | `cover` | 模板类型 |
| `data.name` | string | `ssssss` | 模板名称 |
| `data.description` | string | 空字符串 | 模板描述 |
| `data.tags` | string[] | `[]` | 模板标签列表 |
| `data.note` | string | 空字符串 | 模板备注 |
| `data.data.els` | object | - | 模板元素布局配置 |
| `data.data.els.{element}.x/y` | number | - | 元素位置；坐标单位未提供 |
| `data.data.els.{element}.w/h` | number | - | 元素宽高；单位未提供 |
| `data.data.els.{element}.op` | number | - | 元素透明度相关配置；具体取值规则未提供 |
| `data.data.els.{element}.z` | number | - | 元素层级，数值越大是否越靠前未明确 |
| `data.data.on` | object | - | 各模板元素的启用状态 |
| `data.data.on.{element}` | boolean | `true` | 对应元素是否启用 |
| `data.data.mats` | object | - | 各模板元素的素材绑定信息 |
| `data.data.mats.{element}` | object \| null | `null` | 对应元素的素材绑定；示例均为空 |
| `data.created_at` | string | ISO 8601 | 创建时间 |
| `data.updated_at` | string | ISO 8601 | 更新时间 |

模板元素名 `bg`、`logo`、`title`、`biz`、`sub` 来自当前示例。截图未说明 `x/y/w/h` 的坐标系、`op` 的精确定义、`mats` 非空时的对象结构，以及模板类型和标签的完整枚举。

### 6.4 获取定制化模板详情

#### 6.4.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 接口名称 | 获取定制化模板详情 |
| 请求方式 | GET |
| 接口路径 | `/api/custom-templates/{id}` |
| 状态 | 未完成 |
| 创建人 | zhangjt |
| 更新时间 | 2026-09-18 18:08:26 |
| Mock 地址 | [YApi Mock](http://api.ifengcloud.ifeng.com/mock/2482/api/custom-templates/{id}) |

#### 6.4.2 路径参数

| 参数名 | 类型 | 示例 | 必须 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | number | `1` | 是 | 定制化模板 ID |

示例请求：

```http
GET /api/custom-templates/1
```

#### 6.4.3 返回数据

```jsonc
{
  "code": 0, // number；示例中 0 表示成功
  "message": "success", // string；响应消息
  "data": {
    "id": 1, // number；定制化模板记录 ID
    "group_id": 4, // number；所属分组 ID
    "group_name": "凤凰科技", // string；所属分组名称
    "owner_id": 1, // number；所有者 ID
    "owner_name": "初始管理员", // string；所有者名称
    "name": "鹤梳室", // string；定制化模板名称
    "description": "11111111", // string；模板描述
    "cover_name": "fig-sbeqrgwzndcrs9i920260205_144805main.png", // string；封面文件名
    "package_name": "财经双人对话视频生成指令.zip", // string；模板压缩包文件名
    "cover_url": "http://10.20.12.43:8000/api/custom-templates/1/cover", // string；封面访问地址
    "package_url": "http://10.20.12.43:8000/api/custom-templates/1/package", // string；模板压缩包访问地址
    "created_at": "2026-09-18T17:44:41.051980+08:00", // string；创建时间
    "updated_at": "2026-09-18T17:44:41.051980+08:00" // string；更新时间
  }
}
```

#### 6.4.4 字段说明

| 字段路径 | 类型 | 示例 | 说明 |
| --- | --- | --- | --- |
| `code` | number | `0` | 业务返回码；成功码为 `0` 仅依据示例记录 |
| `message` | string | `success` | 业务返回消息 |
| `data` | object | - | 定制化模板详情对象 |
| `data.id` | number | `1` | 定制化模板记录 ID |
| `data.group_id` | number | `4` | 分组 ID |
| `data.group_name` | string | `凤凰科技` | 分组名称 |
| `data.owner_id` | number | `1` | 所有者 ID |
| `data.owner_name` | string | `初始管理员` | 所有者名称 |
| `data.name` | string | `鹤梳室` | 定制化模板名称 |
| `data.description` | string | `11111111` | 模板描述 |
| `data.cover_name` | string | 文件名 | 封面文件名 |
| `data.package_name` | string | `财经双人对话视频生成指令.zip` | 模板压缩包文件名 |
| `data.cover_url` | string | URL | 模板封面访问地址 |
| `data.package_url` | string | URL | 模板压缩包访问地址 |
| `data.created_at` | string | ISO 8601 | 创建时间 |
| `data.updated_at` | string | ISO 8601 | 更新时间 |

补充说明：

- `cover_url` 和 `package_url` 当前示例为内网 HTTP 地址，实际部署环境的域名、端口、鉴权和访问权限未在截图中说明。
- `cover_name` 仅表示封面文件名；`cover_url` 为封面访问地址，两者不能混用。
- `package_name` 表示定制化模板压缩包文件名；`package_url` 为压缩包访问地址。压缩包内部目录结构、版本号和解压使用方式未提供。
- `created_at` 与 `updated_at` 的示例时间相同，不代表接口始终保证二者相同。

### 6.5 获取素材详情

#### 6.5.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 接口名称 | 获取素材详情 |
| 请求方式 | GET |
| 接口路径 | `/api/materials/{mid}` |
| 状态 | 未完成 |
| 创建人 | zhangjt |
| 更新时间 | 2026-09-15 09:35:22 |
| Mock 地址 | [YApi Mock](http://api.ifengcloud.ifeng.com/mock/2482/api/materials/{mid}) |

#### 6.5.2 路径参数

| 参数名 | 类型 | 示例 | 必须 | 说明 |
| --- | --- | --- | --- | --- |
| `mid` | number | `42` | 是 | 素材 ID |

示例请求：

```http
GET /api/materials/42
```

#### 6.5.3 返回数据

```jsonc
{
  "code": 0, // number；示例中 0 表示成功
  "message": "success", // string；响应消息
  "data": {
    "id": 42, // number；素材记录 ID
    "group_id": 4, // number；所属分组 ID
    "group_name": "凤凰科技", // string；所属分组名称
    "owner_id": 16, // number；所属用户或所有者 ID
    "category": "brand", // string；素材分类
    "name": "s", // string；素材名称
    "size": 212888, // number；素材大小，单位未在截图中说明
    "mime_type": "image/png", // string；媒体类型
    "tags": [], // string[]；素材标签
    "meta": null, // object | null；扩展元数据，示例为空
    "license": "pending", // string；授权状态
    "created_at": "2026-09-11T12:23:26.342462+08:00", // string；创建时间
    "file_url": "/api/materials/42/file" // string；素材文件接口相对路径
  }
}
```

#### 6.5.4 字段说明

| 字段路径 | 类型 | 示例 | 说明 |
| --- | --- | --- | --- |
| `code` | number | `0` | 业务返回码；成功码为 `0` 仅依据示例记录 |
| `message` | string | `success` | 业务返回消息 |
| `data` | object | - | 素材详情对象 |
| `data.id` | number | `42` | 素材记录 ID |
| `data.group_id` | number | `4` | 分组 ID |
| `data.group_name` | string | `凤凰科技` | 分组名称 |
| `data.owner_id` | number | `16` | 所有者 ID |
| `data.category` | string | `brand` | 素材分类 |
| `data.name` | string | `s` | 素材名称 |
| `data.size` | number | `212888` | 素材大小；单位未提供，通常需与接口方确认是否为字节 |
| `data.mime_type` | string | `image/png` | MIME 类型 |
| `data.tags` | string[] | `[]` | 素材标签列表 |
| `data.meta` | object \| null | `null` | 素材扩展元数据；结构未提供 |
| `data.license` | string | `pending` | 授权状态 |
| `data.created_at` | string | ISO 8601 | 创建时间 |
| `data.file_url` | string | `/api/materials/42/file` | 素材文件访问路径 |

`file_url` 当前示例为相对 API 路径，不应按前文视频剪辑接口中的媒体文件系统路径处理。实际拼接 Base URL、鉴权方式和是否需要签名参数，需以服务端约定为准。

### 6.6 下载素材文件

#### 6.6.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 接口名称 | 下载素材文件 |
| 请求方式 | GET |
| 接口路径 | `/api/materials/{mid}/file` |
| 状态 | 未完成 |
| 创建人 | zhangjt |
| 更新时间 | 2026-09-15 09:35:22 |
| Mock 地址 | [YApi Mock](http://api.ifengcloud.ifeng.com/mock/2482/api/materials/{mid}/file) |

#### 6.6.2 路径参数

| 参数名 | 类型 | 示例 | 必须 | 说明 |
| --- | --- | --- | --- | --- |
| `mid` | number | `42` | 是 | 素材 ID |

示例请求：

```http
GET /api/materials/42/file
```

#### 6.6.3 返回数据说明

截图只展示了“返回数据”标题，没有展示响应体示例或响应头，因此当前仅记录接口用途和已知路径，不虚构具体返回结构：

- 该接口与素材详情中的 `file_url` 对应，用于访问或下载指定素材文件。
- 响应体可能是文件二进制流，也可能由网关返回重定向或 JSON 错误信息；截图未说明，待接口方确认。
- `Content-Type`、`Content-Disposition`、缓存策略、断点续传、鉴权和文件不存在时的错误响应均未提供。
- 是否支持图片、视频等不同 MIME 类型，及文件访问地址是否长期有效，也需要在联调前确认。

## 7. 对接前待确认项

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
