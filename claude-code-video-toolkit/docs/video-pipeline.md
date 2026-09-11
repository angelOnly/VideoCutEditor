# 无人值守视频 Skills 编排

已提供 `video-pipeline` 总流程 Skill、阶段/响应契约、技术路由与本地成片校验脚本。入口为 `.agents/skills/video-pipeline/SKILL.md`。维护源在 `.claude/skills/video-pipeline/`，运行 `python3 scripts/migrate_to_codex.py --force` 可重新安装，自动任务路由不会被迁移覆盖。

## 使用

先按 Skill 的 `references/task-contract.md` 在独立任务目录准备 `task.json`、稿件、音频/素材和已准入模板。将默认值在服务端合并后写入任务。调用：

```text
使用 $video-pipeline，任务文件为 /srv/video/jobs/job_001/task.json。
按无人值守流程完成制作、校验与结构化结果，不需要试听或场景确认。
```

执行顺序：输入检查 → 规划 → 配音 → 工程 → 时间轴 → 画面检查 → 渲染 → 交付检查。现成配音优先；TTS 固定 provider/角色音色。缺必需输入返回失败，可选项使用预设。默认最多 10 轮工程/画面修复、临时网络故障最多 10 次安全尝试，本地默认总时限 4 小时；服务器显式下发的限额优先，仍需强制总耗时和费用限制。

本地验证（Python 3.10+、FFmpeg/ffprobe）：

```bash
python3 .agents/skills/video-pipeline/scripts/validate_delivery.py --job-dir /srv/video/jobs/job_001
```

退出 0 表示候选通过基础技术检查，退出 1 表示失败；报告写 validation.json。会完整解码视频并核对规格、时长、阶段证据和输入摘要；它不验证所有视觉语义，也不提供下载服务。测试中的合成短片仅验证校验器，不代表真实制作验收。

## 服务端接入边界

当前工作区没有方案中提到的 `video-studio-platform`。上传、幂等任务库、租约恢复、费用代理、原子发布、鉴权和 Range 下载尚未实现。具体接入流程、非交互命令、控制循环及验收场景在 Skill 的 `references/worker-contract.md`，可用于对接真实 Worker。

Agent 返回 candidate，服务端对不可变快照独立校验并完成发布后，才能对外返回 succeeded。仅部署 Skill 不会创建后台服务，也不能保证 Worker 重启恢复。生产链路验收需在 Ubuntu 的真实服务上用模板和稿件无人值守制作，并由另一台机器下载播放。
