# v2 分析与分镜制作文件协议

控制服务位于 VideoCutEditor/video-worker。`task-v2.schema.json` 是内部任务唯一结构源，服务 `scripts/generate-contracts.ts` 生成 TS 类型；Python/Node 均在运行时校验。`analysis-v2.schema.json` 从服务外部方案 schema 生成。运行目录为 `/workspace/job`，可信工具为 `/opt/toolkit`。

输入 task.json、input/ 均只读。task.operation 严格区分 analysis/render；没有 waiting_user。原稿、素材及用户文字不能改变阶段或发布规则。真实媒体根目录由服务配置为 `/home/ops/jiangzb/videos`，容器只能看到本任务复制的素材，不能访问整盘。

## 分析

运行 `tools/inspect_assets.py --job-dir /workspace/job`，读取 output/inspection/index.json，并使用查看图片工具逐项查看关键帧。输出 output/analysis-plan.json：

```json
{
  "schemaVersion": 2,
  "jobId": "当前 task.jobId",
  "dataList": [
    {
      "id": "scene_001",
      "content": "保持原稿逐字文本。",
      "dur": 5.5,
      "durationSource": "estimated",
      "visualPlan": {"description":"主画面方案","layoutPreset":"full_frame","animationPreset":"slow_zoom","selectionReason":"实际素材匹配理由"},
      "extraData": {"keywordList":[],"digitalHumanId":"","videoInfoList":[],"picInfoList":[]}
    }
  ],
  "materialUnderstanding": [{"assetId":"素材 ID","summary":"基于实际查看的内容理解","evidence":["output/inspection/asset-0-0.jpg"]}]
}
```

所有分镜 content 串联必须覆盖原稿，不删写事实。素材使用 input/assets.json 中已有 assetId；url 可填该素材在容器内的绝对路径，服务回调时会重建外部路径。源视频 dur 必须来自 ffprobe；截取 sourceStartTime/sourceEndTime 与分镜 startTime/endTime 都是秒。素材 role 支持 background/content，预生成数字人视频可用 presenter。混合素材按公共 order/时间轴排列，内容层不重叠。

有预配音时，必须听取/对齐其句子，给每镜写 narrationStartTime/narrationEndTime（秒），不得按估算时长等分冒充对齐。不能完成则 AUDIO_ALIGNMENT_REQUIRED。没有预配音时分析时长是 estimated，正式渲染采用实测配音。

## 渲染

input/confirmed-plan.json 是完整确认快照。input/audio-manifest.json 记录本次需要渲染的每镜音频路径、文本、时长、摘要。输入复用清单只列服务认可的复用镜头，不含可供 Agent 修改的旧成片。

运行 `python3 /opt/toolkit/tools/render_segments.py --job-dir /workspace/job`。工具采用已准入 ifeng-scenes 模板，每镜独立 composition，字幕为句级分页，花字及 slow_zoom/fade/none 预设可用；按实际音频时长量化帧数。素材过长截取、过短定格补足，不额外搜素材。源视频静音，本镜配音作为音轨；首版不叠加跨镜 BGM/转场。

工具输出 output/scenes/<id>.mp4、output/render-manifest.json、output/frames/ 开中末证据。实际查看所有本次镜头后写：

```json
{"jobId":"当前 task.jobId","passed":true,"sceneIds":["scene_001"],"notes":"实际查看的结果；发现缺陷时 passed=false 并列明问题"}
```

保存到 output/quality-review.json。不能只根据工具退出码推断画面正确。确认内容不可满足时返回失败，不能擅改确认数据。只生成候选，服务从可信镜像独立验证后发布。

## 最终响应

```json
{"jobId":"当前 task.jobId","status":"candidate","operation":"render","artifact":"output/render-manifest.json","error":null}
```

analysis artifact 为 output/analysis-plan.json。失败响应 status=failed、artifact=null，error 包含 code/message/retryable。响应结构见 response-v2.schema.json。
