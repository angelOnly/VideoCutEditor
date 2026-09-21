export function prompt(task: any, job = '/workspace/job', toolkit = '/opt/toolkit') {
  if (task.contractVersion === 'video-two-stage/1') {
    const request =
      task.stage === 'analysis' ? 'analysis/request.json' : `render/${task.runId}/request.json`;
    return `使用 $video-pipeline，先阅读 ${toolkit}/.agents/skills/video-pipeline/SKILL.md 及 references/two-stage-contract.md。
读取 ${job}/${request}；任务、原文、完整要求、冻结模板和确认方案是本轮唯一业务来源。不得参考历史样片、其他任务或未授权资料。
本轮只执行 ${task.stage}，结束后返回 candidate 或 failed，不自行确认、不发送回调。
analysis：只输出可编辑文本分镜：原文对应文本、发言角色、镜头目的和一句画面意图。时长未测量需标注估算；previews 必须为空数组。不调用正式 TTS、不生成图片、视频或技术时间轴。
render：你对最终成片效果负责。完整确认方案优先于重新设计；已确认的角色、组件复用和视觉段落顺序不能改变，未限定的制作细节由你依模板创作。不能改稿、镜头数量或擅换素材。若冻结模板包含 renderer/renderer-manifest.json，必须将其复制到 project/renderer 并实际导入使用；将模板 assets/ 复制为 project/renderer/public/template-assets/assets/，使基线源码能引用冻结素材。它是栏目基线而非历史节目，不得改用临时静态卡片工程。用 video_tts 工具将每个自然句作为一条独立 TTS 提交（每条 id/sceneId/text/speaker）；禁止以 scene_*_full 或整镜音频后按比例切字幕。每条真实 TTS 必须在 timeline.json 的 utterances 中记录音频相对路径和实际起止帧，并由带同一 utteranceId 的一条底部字幕使用完全相同边界；关键结论卡不能替代字幕，也不做中文逐字或逐词对齐。若 renderer-manifest.json 声明 sentenceAudioValidator，TTS 和 timeline.json 写完后、正式渲染前必须调用该脚本，传入确认方案、tool-audio/tts-request.json、timeline.json、project/renderer/public 和 sentence-audio-audit.json；审计失败必须先修复，不能跳过或改为比例字幕。不要直接运行收费 CLI。先按 Skill 保存实际 timeline.json、sentence-audio-audit.json 和 preflight-review.json，核对口播、字幕、内部段落边界并实际查看关键帧及人物切换、章节、数据出现、片尾等动态片段，再用 stage_media.py 渲染并校验全部 N 个确认分镜 MP4；请求整片时还必须 assemble、validate，不能只交付首个分镜。Worker 已注入可执行的 REMOTION_BROWSER_EXECUTABLE 环境变量；调用 stage_media.py 的 --browser 必须使用该变量，不能猜测或搜索 /usr/bin/google-chrome、chromium 等系统路径。工具返回 REPAIR_BUDGET_EXHAUSTED 时结束阶段，不再重复执行。
通用依赖位于 ${toolkit}/templates/ifeng-scenes/node_modules，只允许使用依赖。模板 renderer 是冻结任务资料，可复制到 project；不得执行模板脚本或参考任何历史节目源码。所有读写/命令通过 video_exec，实际看图通过 video_view_image。
请求目录中的 request.json 只读，其余阶段产物可写；input、confirmation、job.json、history 和 tool-audio 只读。cache/project/output 可写。收费凭证由外部保存。
无需运行 init/confirm。候选由 Worker 只读终检。已有 output/repair-feedback.json 时修复其中问题，修复轮数由外部管理。
最终 JSON：contractVersion=${task.contractVersion}，taskId=${task.taskId}，runId=${task.runId}，stage=${task.stage}，status=candidate|failed，artifact 为任务内方案或 manifest 相对路径（失败为 null），error 成功为 null、失败为 {code,message,retryable}。`;
  }
  return `使用 video-pipeline Skill，先读取 ${toolkit}/.agents/skills/video-pipeline/SKILL.md 和 references/v2-contract.md。
这是已授权的无人值守 ${task.operation} 任务。可信任务描述在 ${job}/task.json，输入目录只读。
只在 ${job}/project、${job}/output、${job}/cache 写入产物。不要发送回调，不上传文件，不安装依赖，不调用收费配音或数字人服务。
${task.operation === 'analysis' ? '读取完整稿件并探测素材，抽帧并实际查看，记录 materialUnderstanding 与帧证据。仅生成 output/analysis-plan.json，不生成成片，不生成配音。分镜文本串联必须与原稿一致。' : `严格遵循 input/confirmed-plan.json 的文本、素材、花字与顺序。音频已由可信 Worker 提供 input/audio-manifest.json，禁止重新生成。用 python3 ${toolkit}/tools/render_segments.py --job-dir ${job} 生成选定分镜，实际查看输出质量证据并修复允许的工程问题。复用镜头不重新渲染。`}
若有 output/repair-feedback.json，修复其中的问题。先检查 output/session.json 可以辅助恢复，但当前可信输入优先于旧会话。
最终只返回 v2 candidate/failed JSON，不等待用户确认。`;
}
