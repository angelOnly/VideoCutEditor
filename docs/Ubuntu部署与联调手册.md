# Ubuntu 部署与联调手册

当前部署为 Docker 控制服务 + Ubuntu 本机 Worker。只用根目录 `.env`；素材和返回文件的根目录保持 `/home/ops/jiangzb/videos`。以下以已通过 `codex login` 登录 ChatGPT 的 `ops` 用户为例。

## 1. 部署结构与准备

```text
/home/ops/jiangzb/VideoCutEditor/
├── .env
├── docker-compose.yml
├── video-worker/
├── claude-code-video-toolkit/
├── huibo-saas/
├── xiling-http/
└── docs/

/home/ops/jiangzb/videos/             原始素材和发布结果
/home/ops/jiangzb/video-worker-data/  工作区、快照、缓存、supervisor.lock
/home/ops/.codex/                    codex login 的认证和会话，由 Codex 管理
```

Ubuntu 需要 Docker Engine 和 Compose v2；安装方式见 [Docker 官方文档](https://docs.docker.com/engine/install/ubuntu/)。Worker 安装脚本会安装其余本机依赖。默认每个执行任务限制 2 CPU、4 GB、256 个进程，最多四任务；这属于配置上限，实际机器容量仍须压测，并为系统、数据库和 Codex 留余量。

不要只部署 toolkit，也不要复制开发机的 node_modules、视频缓存或 Codex 登录文件。已经在服务器登录的账号继续使用原 CODEX_HOME。

## 2. 一份配置

根目录 `.env` 已随代码提供，保留原豆包配置及现有数据库密码、接口令牌和回调签名密钥；不用执行 `cp .env.example .env`。

| 配置 | 当前用途 |
| --- | --- |
| WORKER_EXECUTOR | host，本机执行 |
| POSTGRES_PASSWORD | Docker 与本机 Worker 共用同一数据库密码 |
| POSTGRES_HOST_PORT | 默认 15432，只绑定宿主 127.0.0.1 |
| CODEX_HOME | /home/ops/.codex，与登录用户一致 |
| CODEX_PATH | 可选；默认使用项目安装的 Codex 0.154.0 |
| CODEX_MODEL | 可选；留空使用 Codex 默认模型 |
| HOST_TASK_CPUS / HOST_TASK_MEMORY / HOST_TASK_PIDS | 2 / 4G / 256 |
| MEDIA_ROOT / DATA_ROOT | 上述媒体根和任务数据根 |
| IFENG_API_KEY / IFENG_CALLBACK_SECRET | 请求鉴权、回调签名 |
| IFENG_CALLBACK_BASE_URL | 默认 http://videocut-smoke-callback:9000，测试用途 |
| DOUBAO_TTS_* | 原有豆包配置，只有可信配音步骤使用 |

本机模式不要求 CODEX_API_KEY。旧 RUNNER_* 和 CODEX_API_KEY 仅为旧 Docker 执行器保留，不影响当前部署。根目录不要设置指向 Docker 服务名的 DATABASE_URL；Compose 为容器覆盖为 postgres:5432，本机配置自动使用 127.0.0.1:POSTGRES_HOST_PORT。

正式对接时修改 IFENG_CALLBACK_BASE_URL 为 callbacks 容器可达的编辑平台后端地址，不是接口文档地址。回调端需要实际实现两个 Callback 路径。媒体 url 仍为文件路径，浏览器预览由编辑平台后端提供。

## 3. 安装与启动

```bash
cd /home/ops/jiangzb/VideoCutEditor
mkdir -p /home/ops/jiangzb/videos/input /home/ops/jiangzb/video-worker-data
chmod 600 .env
docker compose config --quiet
docker compose up -d --build --remove-orphans
bash video-worker/deploy/install-host.sh
```

**用 ops 用户执行安装脚本，不要在脚本前加 sudo。** 脚本内部仅在安装 OS 依赖和启用 linger 时使用 sudo。它安装固定 Codex/Remotion 版本、浏览器与 Python 虚拟环境，生成 `~/.config/systemd/user/videocut-worker.service`，检查环境后启动服务。

安装检查包含：数据库表、Bubblewrap 文件读取/写入隔离、浏览器可执行、ChatGPT 登录、Codex 权限和工具协议。检查不发起模型制作或收费 TTS 请求；失败时不会退回无隔离执行。Ubuntu 若限制非特权 user namespace，需要运维为发行版 Bubblewrap 配置允许的 AppArmor 策略，再重新检查；不要关闭全机安全限制来绕过检查。

安装过程中会停止已有本机 Worker 后检查，避免第二个 app-server 并发操作同一登录缓存。若从旧 Docker 版本升级，`--remove-orphans` 先停止旧 Worker；安装脚本检查旧 supervisor 已停止后，清理带 `videocut.run` 标签的旧任务容器，不删除数据库、输入或成片。

```bash
dc() { docker compose "$@"; }
dc ps -a
dc logs --tail=100 api callbacks
systemctl --user status videocut-worker
journalctl --user -u videocut-worker -n 100 --no-pager
curl --fail-with-body http://127.0.0.1:8080/healthz
```

Compose 只有 postgres、migrate、api、callbacks、callback-mock。migrate 的 Exited(0) 正常；没有 worker 和 runner-image 服务，不挂 Docker socket。Ubuntu Worker 主动从数据库领取任务，无需新增容器到 Worker 的 HTTP 端口。

健康检查只验证 API/数据库，不代表模型制作已通过。API 默认监听 127.0.0.1:8080，编辑平台跨机器访问时通过现有网关反代并保留 Authorization。callback-mock 仅用于查看回调，不验证签名，也不代替正式编辑平台。

安装成功后退出 SSH 不影响 Worker；systemd 用户服务已启用 linger。常用管理命令：

```bash
systemctl --user restart videocut-worker
systemctl --user stop videocut-worker
journalctl --user -u videocut-worker -f
# 单独重做环境检查：先停止 Worker，检查结束再启动
systemctl --user stop videocut-worker
cd /home/ops/jiangzb/VideoCutEditor/video-worker
npm run host:check
systemctl --user start videocut-worker
```

账号失效时先停止 Worker，以同一用户执行 `codex login`，然后重启服务。不要为四个任务复制四份 auth.json。四并发调度上限不保证账号始终有足够额度，实际模型并行、限流和认证刷新仍要在服务器联调。

## 4. 提交一条分析任务

把一张实际测试图片放到 `/home/ops/jiangzb/videos/input/chart.jpg`。文件必须真实存在且可读；JSON 路径是 Ubuntu 路径，不是 Mac 路径。

以下文件存到忽略目录 `.local-data/deploy-smoke`。新的一轮测试请替换 taskId/requestId，避免命中上次的幂等结果。

```bash
mkdir -p .local-data/deploy-smoke
read -r -s -p '输入根目录 .env 中的 IFENG_API_KEY: ' API_TOKEN
export API_TOKEN
cat > .local-data/deploy-smoke/analysis.json <<'JSON'
{
  "schemaVersion": 2,
  "requestId": "deploy_analysis_001",
  "taskId": "deploy_task_001",
  "script": "这是第一句测试口播。这是第二句测试口播。",
  "otherRequirements": "严格按两句话制作两个分镜，使用提供的图片，添加字幕，不使用数字人。",
  "digitalHumanAccounId": "test_account",
  "plugin": {"digitalHumanId": "", "templateId": "finance_vertical_v1"},
  "narration": null,
  "outputSpec": {"width": 1080, "height": 1920, "fps": 30},
  "otherMaterial": {
    "picInfoList": [{"assetId": "chart_001", "url": "/home/ops/jiangzb/videos/input/chart.jpg"}],
    "videoInfoList": []
  }
}
JSON
curl --fail-with-body -i \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @.local-data/deploy-smoke/analysis.json \
  http://127.0.0.1:8080/ai_video_director/getAiVideoEditingAnalysisData
```

HTTP 202 + status 0 表示已经接收，不代表分析完成。查看进展：

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $API_TOKEN" \
  http://127.0.0.1:8080/ai_video_director/tasks/deploy_task_001 \
  -o .local-data/deploy-smoke/task.json
cat .local-data/deploy-smoke/task.json
journalctl --user -u videocut-worker -n 100 --no-pager
dc logs --tail=100 callbacks
dc logs --tail=10 callback-mock
```

正式回调服务就绪时最后一条改看该服务日志。重复查询直到 `data.taskState` 为 `awaiting_editor`、`data.plan` 包含方案；成功投递后 `data.callbackState` 为 `delivered`。分析结束释放槽位，等待编辑期间不会占用制作槽位。

## 5. 模拟编辑确认，触发渲染

先查看上一节保存的 `task.json` 中 `data.plan.dataList`，确认两句话、素材和分镜合理。以下命令根据已返回的方案生成**完整确认请求**，不手写丢字段的简化分镜：

```bash
python3 - <<'PY'
import json
from pathlib import Path
p = Path('.local-data/deploy-smoke')
s = json.loads((p / 'task.json').read_text())['data']
assert s['taskState'] == 'awaiting_editor', '先等待分析完成并重新查询'
assert len(s['plan']['dataList']) == 2, '先检查分析分镜数量'
request = {
    'schemaVersion': 2,
    'requestId': 'deploy_render_001',
    'taskId': s['taskId'],
    'basePlanVersion': s['planVersion'],
    'field_5': 'test_account',
    'templateId': 'finance_vertical_v1',
    'dataList': s['plan']['dataList'],
}
(p / 'render.json').write_text(json.dumps(request, ensure_ascii=False, indent=2))
PY
curl --fail-with-body -i \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @.local-data/deploy-smoke/render.json \
  http://127.0.0.1:8080/ai_video_director/getAiVideoEditingData
```

需要替换素材/花字时，先修改 render.json，再提交；始终提交完整 dataList。继续用上一节查询命令刷新 task.json，直到 `taskState=ready`、`latestRun.state=succeeded`，以及最终 `callbackState=delivered`。失败时查看 `latestRun.error`，不要把 HTTP 202 当成制作成功。

## 6. 检查真正交付的文件

```bash
python3 - <<'PY'
import json
from pathlib import Path
s = json.loads(Path('.local-data/deploy-smoke/task.json').read_text())['data']
assert s['taskState'] == 'ready', s['latestRun']
assert len(s['latestResult']) == 2
for scene in s['latestResult']:
    p = Path(scene['url'])
    assert p.is_file() and p.stat().st_size > 0, p
    print(scene['id'], scene['dur'], p)
print('callback:', s['callbackState'])
PY
```

分别播放输出的两个 MP4：每镜必须有匹配口播、画面、动画和字幕；检查顺序、中文字体和声音。两个片段应在 `latestResult` 和最终回调 dataList 中一一对应，不额外包含总片。浏览器不能直接访问 Ubuntu 文件路径，预览需要编辑平台后端读取这些文件提供播放。

只有“文件正常 + 内容正确 + 接收端收到成功回调”同时成立，才算该用例通过。技术校验不能代替编辑对模型理解和剪辑内容的验收。

## 7. 再验证队列、重做与恢复

| 测试 | 操作 | 通过标准 |
| --- | --- | --- |
| 幂等 | 重发完全相同 analysis/render 请求 | 返回同一 runId，不重复创建执行 |
| 4 并发 | 测试环境连续提交 6 个不同 taskId/requestId 的分析任务 | 同一时刻槽位占用不超过 4；剩余排队，有槽释放后先进先出开始 |
| 等待编辑 | 暂不确认已完成分析的任务 | awaiting_editor 不占槽位，后续任务可以执行 |
| 单镜重做 | ready 后刷新查询结果，用最新 planVersion、新 requestId，完整提交 dataList，只改第 2 镜关键词/素材 | 仅第 2 镜产生新 MP4，第 1 镜 URL 保持一致，回调仍包含 2 镜 |
| 回调中断 | 用临时接收器时，在测试任务完成前停止接收器；随后再启动 | 文件与结果保留，通知恢复后补送，不因回调失败重新渲染 |
| Worker 重启 | 测试任务运行中执行 `systemctl --user restart videocut-worker` | 旧任务进程停止后才恢复执行，槽位始终不超过 4；结果只发布一次 |
| 旧版本提交 | 使用过时 basePlanVersion 确认 | 请求被拒绝，不覆盖新方案/新结果 |

6 个真实任务会调用模型，任务太短时未必能恰好观察到 4 个同时运行；自动化队列测试覆盖确定性的 6→4+2 场景。查看数据库槽位和执行状态：

```bash
dc exec -T postgres psql -U videocut -d videocut -c 'SELECT * FROM execution_slots ORDER BY id;'
dc exec -T postgres psql -U videocut -d videocut -c 'SELECT id,stage,state,attempt FROM runs ORDER BY created_at DESC LIMIT 12;'
```

单镜重做时从查询结果的 `data.plan.dataList` 取得最新完整方案；渲染请求里的 `field_5`、templateId 与首次分析保持一致。不要拿旧版本请求只换 requestId 再发。

## 8. 不调用真实模型的自动化回归（可选）

宿主安装 Node.js 22+、pnpm 11.19.0、Python 3.11+、FFmpeg、Chromium 后，从 `video-worker` 执行（此节先 `cd /home/ops/jiangzb/VideoCutEditor/video-worker`）。测试使用合成素材和模拟 Agent；媒体测试实际运行 Remotion/FFmpeg，但不验收真实模型质量。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
python3 -m venv .venv
.venv/bin/pip install jsonschema==4.26.0 requests==2.32.5 python-dotenv==1.2.1
cd ../claude-code-video-toolkit
../video-worker/.venv/bin/python3 -m unittest discover -s tests -p 'test_*pipeline.py'
../video-worker/.venv/bin/python3 -m unittest discover -s tests -p 'test_shared_environment.py'
cd templates/ifeng-scenes
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
cd ../../../video-worker
PYTHON="$PWD/.venv/bin/python3" REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:media
# 本机真实环境检查（先停止 Worker，结束后启动）
systemctl --user stop videocut-worker
pnpm host:check
systemctl --user start videocut-worker
```

Chromium 路径以本机实际安装结果为准。本机隔离检查使用 DATA_ROOT，当前用户必须可写；使用 `npm run host:check`，检查期间需停止 Worker。默认数据库测试是 PGlite；真实 PostgreSQL 测试可设置 `TEST_DATABASE_URL` 为专用测试库，Compose 的 PostgreSQL 仅向宿主 127.0.0.1:15432 发布端口。完整 Ubuntu CI 配置见 `.github/workflows/video-worker.yml`。

## 9. 常见排查与后续更新

| 现象 | 先检查 |
| --- | --- |
| API 401 | Authorization 使用根目录 .env 的 IFENG_API_KEY，而非模型密钥 |
| HTTP 400 | 返回的字段错误；必须使用当前 v2 JSON，包含 script/requestId 等 |
| HTTP 409 | 同任务正在执行、requestId 内容冲突、方案版本过时 |
| queued 长时间不开始 | worker 日志、4 个槽位、systemd 用户服务/Bubblewrap、supervisor 锁是否被另一进程持有 |
| ASSET_UNAVAILABLE / 路径拒绝 | 宿主文件存在、inputRoot/allowedInputPrefixes、挂载路径和文件读取权限 |
| 模型调用失败 | 同一用户的 codex login 状态、账号额度、显式模型权限和 Ubuntu 网络 |
| 配音失败 | 豆包凭据、资源 ID、音色；EXTERNAL_RESULT_UNKNOWN 需要核对外部记录，不盲目重复付费 |
| ready 但没有回调 | callbackBaseUrl 容器可达；接收端必须 HTTP 2xx 且 JSON status=0；看 callback.last_error |
| 回调 dead_letter | 修复接收端后，POST `/ai_video_director/callbacks/<eventId>/retry`，带 Bearer 令牌 |

正式接入时在根目录 .env 替换 IFENG_CALLBACK_BASE_URL，执行 `dc up -d --force-recreate api callbacks` 重新加载配置；选择空闲时段，避免打断测试任务。接收端还须验证 HMAC、eventId 幂等和版本顺序，规则见 Worker README。

后续发布制作代码要重新生成 runtime-manifest（Worker 目录执行 `pnpm runtime-manifest`），重建 control 镜像，并重新运行 `bash video-worker/deploy/install-host.sh` 更新本机依赖/Worker；停止接收新请求、等待执行任务结束后更新。首次建库命令不要当成自动升级/回滚方案；未来数据库变更需对应迁移与备份。本版保留数据库卷、媒体目录和运行目录；不要使用 `docker compose down -v` 作为日常重启命令。
