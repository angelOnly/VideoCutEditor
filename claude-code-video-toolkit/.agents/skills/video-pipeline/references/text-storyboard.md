# 共用文本分镜方法

读取完整原稿、完整要求、输出规格、模板身份与文字级栏目说明。保留事实、数字、引用、标点和原文顺序；按自然句组织口播，一句一项。不得把多句整段放进同一项，也不得按逗号机械拆碎；不追求固定分镜数。最多 200 项，每项非空且不超过 4000 字符。

本阶段只整理文本，不改写双人对话、不生成角色、画面意图、visualBlocks、关键词、字幕模式、素材时间或技术规划。原文非空标题也必须保留，不能擅自当非口播删掉。句间纯空白由程序记录。

Analysis 的文本中间结果格式：

```json
{"status":"candidate","scenes":[{"text":"第一句完整口播。"},{"text":"第二句完整口播。"}],"error":null}
```

明确无法完成时返回 `status=failed`、`scenes=[]`，error 为 `{code,message,retryable}`。不要包 Markdown，不计算或生成 ID、摘要、源坐标和估时，将该文本结果保存到任务 work 目录，交给 toolkit 输出转换；不调用 TTS 或渲染工具。

toolkit 的 two_stage.py 按 Unicode codepoint 顺序精确匹配原稿，生成 scene_001 等稳定 ID、源映射、空白记录和每秒 5 个非空白字符的展示估时；production={}、previews=[]。正文不匹配或 JSON 不合法由工具报告，Codex 检查并修正。展示估时不得成为 Render 制作时长。

本地完整任务同样先生成上述文本结果；toolkit 确定性工具保存内部方案后，按已授权范围接续 production-flow。文本方法不因运行位置变化。

接收 task.json 时，最终结果信封和回复按 [task-io.md](task-io.md)，上述轻量 JSON 仅作为文本工具输入。
