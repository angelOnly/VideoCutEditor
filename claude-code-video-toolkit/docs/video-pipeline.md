# 视频制作共用流程

唯一入口和维护源为 `.agents/skills/video-pipeline/SKILL.md`；迁移脚本跳过该 Skill，不再从 `.claude` 同步。

完整制作和 Worker 两阶段任务共用 `references/production-flow.md`。Analysis 只按 `text-storyboard.md` 生成自然句文字；本地入口通过 `tools/two_stage.py storyboard` 校验保真并生成映射与估时。Worker 的相同适配由服务程序执行，无需给 Analysis 开放制作工具。

两阶段任务在客户端确认文字后进入 Render；本地明确授权完整制作的任务由调用方显式确认后继续。制作中不再等待试听或静帧确认。TTS、实测时间轴、工程、看图与媒体检查均在 Render 完成。服务端接口、文件协议与工具调用见 `references/two-stage-contract.md`。

Worker 实现在同级 `../video-worker/`，提供任务幂等、四槽队列、租约、确认版本、可信工具、校验发布和回调。它发布共享文件路径，不提供上传或 Range 下载服务；网页播放由编辑平台完成。详见 [Worker 说明](../../video-worker/README.md) 和 [客户端接口](../../docs/Worker客户端联调接口说明.md)。

本地原有整片导出格式见 `references/task-contract.md`，其校验器 `scripts/validate_delivery.py` 继续保留；该数据格式不是另一套 Worker 制作规则。合成媒体测试只验证技术边界，真实模型、付费 TTS 与 Ubuntu 运行仍需部署验收。
