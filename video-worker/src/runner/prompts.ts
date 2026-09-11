export function prompt(task: any) {
  return `使用 video-pipeline Skill，先读取 /opt/toolkit/.agents/skills/video-pipeline/SKILL.md 和 references/v2-contract.md。
这是已授权的无人值守 ${task.operation} 任务。可信任务描述在 /workspace/job/task.json，输入目录只读。
只在 /workspace/job/project、output、cache 写入产物。不要发送回调，不上传文件，不安装依赖，不调用收费配音或数字人服务。
${task.operation === 'analysis' ? '读取完整稿件并探测素材，抽帧并实际查看，记录 materialUnderstanding 与帧证据。仅生成 output/analysis-plan.json，不生成成片，不生成配音。分镜文本串联必须与原稿一致。' : '严格遵循 input/confirmed-plan.json 的文本、素材、花字与顺序。音频已由可信 Worker 提供 input/audio-manifest.json，禁止重新生成。用 tools/render_segments.py --job-dir /workspace/job 生成选定分镜，实际查看输出质量证据并修复允许的工程问题。复用镜头不重新渲染。'}
若有 output/repair-feedback.json，修复其中的问题。先检查 output/session.json 可以辅助恢复，但当前可信输入优先于旧会话。
最终只返回 v2 candidate/failed JSON，不等待用户确认。`;
}
