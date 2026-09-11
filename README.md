# VideoCutEditor

凤凰 AI 视频剪辑项目。视频制作工具库与任务服务保持同级目录，整个项目由根目录的 Git 仓库统一管理。

```text
VideoCutEditor/
├── claude-code-video-toolkit/   已有视频制作主体，保留内部结构
├── video-worker/                任务 API、4 并发队列、Codex 容器与可靠回调
├── huibo-saas/                  百度一镜数字人 HTTP 适配器
├── xiling-http/                 数字人口播调用脚本
└── docs/                        项目接口、上下游与代码架构文档
```

- [Worker 开发、部署与验收](video-worker/README.md)
- [Worker 代码架构与接入方案](docs/Worker代码架构与现有项目接入方案.md)
- [上下游对接方案](docs/AI视频剪辑上下游对接方案.md)
- [接口文档](docs/AI视频剪辑接口文档.md)
- [视频工具库使用说明](claude-code-video-toolkit/README.md)

`origin` 沿用 `https://ifengdev.com/ifeng/VideoCutEditor`。在本目录统一提交工具库、Worker、适配器和文档，不在子目录新增 Git 仓库。

工具库的 Python/Remotion 命令仍从 `claude-code-video-toolkit/` 或对应模板目录执行。项目根目前没有统一的 npm 启动命令。

本地输入素材在 `.local-data/`；任务数据和登录配置继续沿用各目录的忽略规则，不作为代码提交。
