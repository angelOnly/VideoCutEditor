# Worker 服务适配索引

现行文件协议与阶段适配统一见 [two-stage-contract.md](two-stage-contract.md)，制作规则统一见 [production-flow.md](production-flow.md)。不再提供独立的 exec/SDK 制作流程。

实际服务位于仓库 `video-worker/`。HTTP 接口以 `docs/Worker客户端联调接口说明.md` 为准；部署与升级以 `docs/Ubuntu部署与联调手册.md` 为准。服务返回共享文件路径，客户端负责播放；没有独立下载或上传接口。
