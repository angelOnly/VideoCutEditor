# Render 回调整片视频交付优化方案

## 1. 目标

Render 成功回调向客户端交付两类视频：

1. `dataList[0]`：完整成片，用于粗片预览与交付页播放；
2. `dataList[1..n]`：按确认稿原顺序排列的分镜视频，用于逐条编辑和“仅本段”预览。

所有媒体地址必须是浏览器可访问的公开 URL，禁止向客户端返回 Worker 服务器的本地文件路径。

## 2. 当前问题

Worker 会在服务器媒体目录生成并发布 MP4。文件系统路径例如：

```text
/home/ops/jiangzb/videos/tasks/<taskId>/results/<runId>/video-scene_001.mp4
```

该路径不能被浏览器直接访问。若将其放入回调，客户端会把它视为自身站点的相对地址，导致视频加载失败。

当前 Render 结果只将分镜写入 `dataList`。虽然制作链路已生成完整成片，但整片未进入交付文件清单和回调，因此客户端只能预览当前分镜，并可能错误地将分镜时长展示为整片时长。

## 3. 回调协议

回调中的 `dataList` 固定采用以下顺序：

```text
dataList[0]       完整成片
dataList[1..n]    分镜，顺序与确认稿完全一致
```

完整成片建议采用以下结构：

```json
{
  "id": "whole-video",
  "content": "全文口播稿",
  "dur": 150.033,
  "durationSource": "measured",
  "url": "http://10.20.130.251:8080/media/tasks/<taskId>/results/<runId>-<token>/video-whole.mp4",
  "extraData": {
    "kind": "wholeVideo",
    "sceneCount": 18,
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "sha256": "<sha256>"
  }
}
```

字段约束：

- `id` 固定为 `whole-video`，避免与分镜 ID 冲突；
- `content` 为按分镜顺序拼接的全文口播稿；
- `dur` 使用合片后实测时长，而不是估算时长；
- `url` 必须是公开媒体 URL；
- 分镜保留既有字段和顺序，只是整体后移一位；
- `extraData.kind` 用于客户端显式区分整片与分镜，不能仅依赖数组下标推断。

## 4. Worker 改动

### 4.1 合片成为 Render 成功的前置步骤

复用现有 `stage_media.assemble()`，不新增另一套合片实现。

合片流程：

1. 按确认稿中的 scene ID 顺序读取分镜，禁止按目录枚举顺序拼接；
2. 校验每段视频的分辨率、帧率、编码、时间戳和音频；
3. 视频按顺序拼接，音频按真实帧数归一化后合并；
4. 对整片执行 `ffprobe` 与音视频边界校验；
5. 写入 `manifest.wholeVideo`，包含路径、摘要、总帧数和实测时长。

若任一分镜缺失、顺序不符、编码不符或整片校验失败，Render 不得发布成功回调。

### 4.2 将整片纳入交付结果

调整 `task_io.complete_render()`：

1. 从 `manifest.wholeVideo` 读取经过校验的整片；
2. 在交付文件清单第一个加入 `video-whole`；
3. 在结果 `dataList` 第一个加入完整成片元素，其余元素保持原分镜顺序；
4. 通过既有 `artifactRef` 替换机制，将 `video-whole` 和各分镜文件替换为发布后的 URL。

不能仅在回调层手工拼接第 0 项；整片必须和分镜一样经过文件摘要校验、原子发布与交付记录。

### 4.3 公开媒体地址

发布文件仍使用 Worker 的原子写入、哈希校验和只读权限控制。当前不新增媒体服务，直接由 Worker 服务提供媒体访问；对外 URL 由统一配置生成：

```text
MEDIA_PUBLIC_BASE_URL=http://10.20.130.251:8080
```

Worker 发布 key：

```text
tasks/<taskId>/results/<runId>-<token>/<fileId>.mp4
```

Worker 回调 URL：

```text
http://10.20.130.251:8080/media/<发布 key>
```

该地址是 Worker 服务地址，不是 Worker 服务器本地文件路径。只要客户端所在网络可访问 `10.20.130.251:8080`，浏览器即可直接播放该 URL。

Worker 的媒体路由至少应支持：

- `Content-Type: video/mp4`；
- `Content-Length`；
- `Accept-Ranges: bytes` 与 `206 Partial Content`；
- 如前端与 Worker 不同源，则配置允许播放器读取的 CORS。

## 5. 客户端改动

客户端在 Render 回调后按下列规则保存并展示：

| 场景 | 使用的数据 | 行为 |
|---|---|---|
| 粗片预览、交付页 | `dataList[0]` | 播放完整成片，展示实测整片时长 |
| 分镜编辑区 | `dataList[1..n]` | 选中某条时播放对应分镜 |
| 顶部总时长 | `dataList[0].dur` | 不得使用当前分镜时长 |
| 分镜列表 | `dataList[1..n]` | 保持确认稿顺序与文本映射 |

前端还应增加：

1. 整片/仅本段两个明确的播放入口；
2. 视频加载失败时展示 URL、HTTP 状态和重试入口；
3. 收到以 `/home/`、`/Users/` 开头的路径时拒绝设置 `<video src>`，并上报协议错误；
4. 不以数组下标作为唯一判断条件，同时识别 `extraData.kind === "wholeVideo"`。

## 6. 历史任务迁移

已发布的历史任务不能重新渲染。迁移步骤：

1. 读取已有 artifact 的媒体 key 与整片校验结果；
2. 生成公开 URL；
3. 补充第 0 项整片数据；
4. 保留原 run、文件摘要和迁移记录；
5. 重新投递成功回调。

如果历史任务没有完整成片或无法通过校验，只能标记为需要重新 Render，不能伪造整片成功记录。

## 7. 验收标准

1. Render 成功回调共有 `n + 1` 项，且第 0 项为完整成片；
2. 第 1 至第 n 项与原分镜文本、顺序和时长映射一致；
3. 整片总帧数等于所有分镜帧数之和；
4. 整片 `dur` 等于 `ffprobe` 实测时长；
5. 整片和每个分镜 URL 均可从浏览器获得 `200` 或 `206`；
6. 浏览器可播放整片、拖动进度条，并可独立播放任一分镜；
7. 回调中不得出现服务器本地绝对路径；
8. 重复投递同一回调不会创建重复媒体或破坏结果顺序。

## 8. 实施顺序

1. 补充整片 artifact 与 `dataList[0]` 的 Worker 协议实现及单元测试；
2. 配置 `MEDIA_PUBLIC_BASE_URL=http://10.20.130.251:8080` 并验证 Worker 媒体路由的 Range 支持；
3. 修改 `.250` 前端播放器和总时长计算；
4. 在测试环境执行完整 Render，校验回调、分镜播放、整片播放和回调重试；
5. 迁移可恢复的历史任务并复验；
6. 灰度部署后再切换生产流量。
