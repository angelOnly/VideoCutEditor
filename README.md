# VideoCutEditor

凤凰 AI 视频剪辑项目。视频制作工具库与任务服务保持同级目录，整个项目由根目录的 Git 仓库统一管理。

```text
VideoCutEditor/
├── .env                        Worker 与 toolkit 共用的部署配置
├── docker-compose.yml          根目录直接启动全部服务
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

全项目实际配置统一为根目录 `.env`，已随代码提供，不需要复制；子目录 `.env.example` 如有保留，仅为原工具的可选参数参考。数据库密码、接口令牌和回调签名密钥已生成，原豆包配置已迁入。`CODEX_API_KEY` 仍需填写实际服务端密钥；`IFENG_CALLBACK_BASE_URL` 默认指向测试回调接收器，正式对接时改为编辑平台地址。

Docker 部署：填写根目录 `.env` 中的 `CODEX_API_KEY` 后，在本目录执行 `docker compose up -d --build`。数据库初始化和镜像准备自动完成。检查 `docker compose ps -a`、`docker compose logs --tail=100 worker`；详细步骤见 [Ubuntu 部署与联调手册](docs/Ubuntu部署与联调手册.md)。
