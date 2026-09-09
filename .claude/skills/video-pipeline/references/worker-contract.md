# Worker 接入协议（服务端待实现）

当前仓库提供 Skill 和本地校验器，不包含 video-studio-platform、上传 API、持久化队列、租约或下载服务器。以下是接入契约，不能当成已有服务能力。

## 非交互执行

服务端为每个任务准备独立工具库副本/容器及 job 目录，固定可信 Skill 版本。启动前配置认证、字体、Node/Python/FFmpeg、浏览器和 TTS。不能依赖桌面、Studio 或临时安装服务。网络权限由运行环境配置，权限失败退出而非申请交互授权。

在任务独立工具库根目录运行，job 目录位于其可写范围内。以下命令应由 Worker 以 argv 数组启动，stdin 提供服务端生成的 prompt；路径来自服务端，不拼接用户 shell 文本：

```bash
codex -a never exec --sandbox workspace-write --json \
  --output-schema .agents/skills/video-pipeline/references/response.schema.json \
  -o jobs/job_001/agent-response.json - < jobs/job_001/prompt.txt
```

prompt.txt 的服务端模板：

```text
使用 $video-pipeline，并先读取 .agents/skills/video-pipeline/SKILL.md。
本任务已授权无人值守制作，task.json 为 jobs/job_001/task.json。
只能修改该任务目录。完整执行各阶段；不要进入交互式 video/scene-review/generate-voiceover。
可选信息按任务契约默认；必需条件无法补救返回 failed JSON。
只能产出 candidate，由 Worker 校验并发布后决定 succeeded。
```

官方依据：[非交互运行](https://learn.chatgpt.com/docs/non-interactive-mode)。`--json` 提供事件流，`--output-schema` 约束最终响应；两者都不证明成片成功。可替换为 [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) 的单任务线程，但必须保留下述外部控制。

## 控制循环

1. `requestId` 在租户内唯一，数据库保存请求规范化摘要；同 ID 同内容返回原 jobId，同 ID 不同内容返回 409。上传引用先验证所有权和保留期。
2. 原子领取 queued/过期 running 任务，写 owner/leaseExpiresAt/递增 fencingToken。Worker 定期续租。所有 checkpoint、失败、发布操作须校验 token，旧 Worker 不能提交结果。
3. 在数据库持久化 deadline、已用修复次数、外部调用幂等键/状态、费用累计。重启不重置预算。模型只接收可信快照。
4. 以进程组启动 Codex，持续消费事件、更新 stage/心跳；总超时、预算耗尽或失去租约，终止整个进程组，包括渲染子进程。外部付费操作经代理检查预算/幂等，prompt 中写费用上限不能替代代理。
5. 每次退出读取结构化响应。`failed` 且不可重试直接结束；缺响应、要求确认、候选缺失、校验失败视为 INCOMPLETE_OUTPUT/VALIDATION_FAILED。还有预算时将具体错误写入 repair-feedback.json，重新显式调用同一 Skill，最多两轮修复（初次 + 两轮）。不要用 `resume --last` 混用别的任务；可以按已保存 sessionId 续跑或新会话读取同任务 checkpoint。
6. 每轮都从可信工具部署对任务目录运行 validate_delivery.py。缺证据也失败。检查结果与输入哈希绑定。任务内的验证脚本/validation.json/agent-response.json 都不是可信成功标记。
7. 修复和重启优先复用验证过的阶段产物。TTS 返回不明先核对供应商，不能单凭文件不存在再次付费。超过预算写结构化失败，始终没有 waiting_user。

## 发布与下载

Agent 只能写候选目录。Worker 停止写入后将 MP4 复制至不可由 Agent 修改的同文件系统临时发布目录，对该快照重新校验并计算 sha256；fsync 后原子 rename 到持久化产物目录，再事务写结果与 succeeded。事务前崩溃可依据 jobId/fencingToken/摘要恢复，不重新制作。跨盘用复制 + 目标盘原子 rename，不能假设跨盘 rename 原子。

API 与 Worker 挂载同一持久化目录。API 从数据库定位产物，禁止按请求字符串直接拼文件路径；按租户鉴权。使用流式文件响应，支持 GET/HEAD、Content-Length、Content-Type、ETag、Content-Disposition、Accept-Ranges、单段 Range 的 206/无效范围 416。未成功返回 409，过期返回 410，未知任务 404。结果返回 videoUrl/durationSec/width/height/fps/sizeBytes/sha256/expiresAt。

状态仅 queued → running → succeeded/failed，stage 是细分进度。服务器自检已发布文件可读取、长度与摘要一致后才开放下载；部署验收从另一台机器鉴权下载、比对 sha256 并解码。回调后续增加时仅重试通知。

## 必做服务端验收

- 提交真实模板、完整稿件、素材和音效，全程无人回复，下载完整 MP4。
- 只有稿件时使用固定 TTS；预配音不产生 TTS 调用；未知付费结果不重复扣费。
- 重复提交返回同一 jobId；输入摘要冲突返回 409。
- 渲染期间 kill Worker，租约接管后旧进程不可发布；恢复不重置预算。
- Agent 只说“请确认”、返回 0 但无视频、损坏视频、错误时长、缺必需音轨、校验报告伪造均不能成功。
- 从另一台机器验证鉴权、Range/HEAD、并发大文件下载、过期清理；清理不删除运行任务。
