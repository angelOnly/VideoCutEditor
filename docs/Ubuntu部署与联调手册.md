# Ubuntu 部署与联调手册

本手册对应当前 `video-worker` 实现。先完成单任务端到端测试，再验证 4 并发、重试和单镜重做。下文命令在 Ubuntu 执行；部署时确认拉取的版本包含 `video-worker`、同级 toolkit 和本手册。

## 1. 准备机器与代码

使用单台 Ubuntu、Docker Engine、Docker Compose v2。没有 Docker 时按 [Docker 官方 Ubuntu 安装步骤](https://docs.docker.com/engine/install/ubuntu/)安装。以下命令假设当前用户已经能够执行 Docker；否则在 Docker 命令前加 `sudo`。

```bash
docker version
docker compose version
docker run --rm hello-world
```

本版每个执行容器默认限制 2 CPU、4 GB 内存，4 槽同时使用时预算为 8 CPU、16 GB，宿主还需给系统、数据库和控制服务留余量。这是配置预算，不是已经完成的容量压测结论。第一轮先用短稿件和小素材。

将**本次完整代码**同步到服务器，例如以下位置；不要只上传 toolkit：

```text
/home/ops/jiangzb/VideoCutEditor/
├── .dockerignore
├── video-worker/
├── claude-code-video-toolkit/
├── huibo-saas/
├── xiling-http/
└── docs/

/home/ops/jiangzb/videos/              # 原始素材和发布结果
/home/ops/jiangzb/video-worker-data/   # 独立任务目录、会话和运行缓存
```

通过现有代码发布方式同步当前版本，或在本次修改提交并推送之后拉取对应版本。不要把开发机的 `.env`、密钥、node_modules、缓存和历史视频当作部署配置上传。镜像构建不需要宿主安装 Node、Python、FFmpeg；只有下面的源码自动化测试需要额外依赖。

## 2. 填写两份配置

以下复制命令只在首次部署执行；已有配置时直接编辑，不覆盖。

```bash
cd /home/ops/jiangzb/VideoCutEditor/video-worker
cp .env.example .env
cp config/tenants.example.json config/tenants.json
mkdir -p /home/ops/jiangzb/videos/input
mkdir -p /home/ops/jiangzb/video-worker-data
chmod 600 .env config/tenants.json
```

编辑 `.env`：

```dotenv
MEDIA_ROOT=/home/ops/jiangzb/videos
DATA_ROOT=/home/ops/jiangzb/video-worker-data
POSTGRES_PASSWORD=替换为足够长的随机字母数字密码
RUNNER_IMAGE=videocut-runner:0.1.0
RUNNER_UID=1000:1000
RUNNER_CPUS=2
RUNNER_MEMORY=4g
RUNNER_NETWORK=bridge
CODEX_API_KEY=填写可用的模型调用密钥
CODEX_MODEL=
DOUBAO_TTS_API_KEY=填写豆包配音密钥
DOUBAO_TTS_RESOURCE_ID=seed-tts-2.0
TTS_VOICE=zh_female_xiaohe_uranus_bigtts
```

保留 `.env.example` 其余项目即可。Compose 会设置实际数据库服务地址；模型名可留空使用运行时默认值，或明确填写账号可用型号。首轮使用 `narration: null`，因此渲染会真实调用配音；模型分析和渲染也会真实调用模型服务。

编辑 `config/tenants.json`。如果编辑平台还没提供回调，先用以下测试配置，并在下一步启动临时接收器：

```json
[
  {
    "id": "ifeng",
    "apiKey": "替换为至少16字符的随机接口令牌",
    "inputRoot": "/home/ops/jiangzb/videos",
    "exportRoot": "/home/ops/jiangzb/videos",
    "allowedInputPrefixes": ["input"],
    "callbackBaseUrl": "http://videocut-smoke-callback:9000",
    "callbackSecret": "替换为至少16字符的随机回调签名密钥"
  }
]
```

正式对接时将 callbackBaseUrl 改成 callbacks 容器可达的编辑平台后端地址，例如 `http://实际内网IP:端口`。这里填服务根地址，程序自动追加两个 Callback 路径；不能填成文档网站地址或宿主的 `127.0.0.1`。`apiKey` 给调用方用于请求本 Worker，`callbackSecret` 与接收方约定用于验证回调签名。

## 3. 构建、初始化和启动

从 `video-worker` 目录执行，定义便于复用的函数；换终端后需重新定义：

```bash
cd /home/ops/jiangzb/VideoCutEditor/video-worker
dc() { docker compose --env-file .env -f deploy/compose.yaml "$@"; }
dc config --quiet
dc --profile build build
dc up -d postgres
dc run --rm migrate
```

任何一步报错先处理，再执行后续命令。构建会下载镜像、Node/Python 依赖和浏览器组件，服务器需要能访问对应源。

**仅当使用临时回调配置时**，在已创建的 Compose 网络中启动接收器：

```bash
docker run -d --name videocut-smoke-callback \
  --network videocut_default \
  node:22-bookworm-slim node -e '
require("node:http").createServer((req,res)=>{
  let body="";
  req.on("data",chunk=>body+=chunk);
  req.on("end",()=>{
    console.log(JSON.stringify({path:req.url,eventId:req.headers["x-event-id"],body:JSON.parse(body)}));
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({status:0,msg:"test received"}));
  });
}).listen(9000,"0.0.0.0");'
```

它只用于记录测试回调并返回成功，不验证签名，不代表编辑平台完成对接；测试结束后可 `docker rm -f videocut-smoke-callback` 删除。不要同时启动重名接收器。

```bash
dc up -d api worker callbacks
dc ps
dc logs --tail=100 api worker callbacks
curl --fail-with-body http://127.0.0.1:8080/healthz
dc exec worker docker version
```

预期健康检查返回 `{"status":0}`；三个服务不反复重启；Worker 内 Docker 命令能看到 Client 和 Server。健康检查只检查 API 和数据库，不能替代实际模型/容器测试。若 Docker 报 API 版本不兼容，需要匹配服务端/控制镜像客户端版本后重建。

API 默认只绑定宿主 127.0.0.1:8080，先在 Ubuntu 本机 curl 测试。编辑平台跨机器接入时，由现有网关反代到该端口并保留 Authorization 头。容器中生成的任务数无需手动设置，数据库固定提供 4 个执行槽。

## 4. 提交一条分析任务

把一张实际测试图片放到 `/home/ops/jiangzb/videos/input/chart.jpg`。文件必须真实存在且可读；JSON 路径是 Ubuntu 路径，不是 Mac 路径。

以下文件存到忽略目录 `.local-data/deploy-smoke`。新的一轮测试请替换 taskId/requestId，避免命中上次的幂等结果。

```bash
mkdir -p .local-data/deploy-smoke
read -r -s -p '输入 tenants.json 中的 apiKey: ' API_TOKEN
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
dc logs --tail=100 worker callbacks
docker logs --tail=10 videocut-smoke-callback
```

正式回调服务就绪时最后一条改看该服务日志。重复查询直到 `data.taskState` 为 `awaiting_editor`、`data.plan` 包含方案；成功投递后 `data.callbackState` 为 `delivered`。分析结束释放槽位，等待编辑期间不会保持运行容器。

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
| Worker 重启 | 测试任务运行中执行 `dc restart worker` | 旧容器停止后才恢复执行，槽位始终不超过 4；结果只发布一次 |
| 旧版本提交 | 使用过时 basePlanVersion 确认 | 请求被拒绝，不覆盖新方案/新结果 |

6 个真实任务会调用模型，任务太短时未必能恰好观察到 4 个同时运行；自动化队列测试覆盖确定性的 6→4+2 场景。查看数据库槽位和执行状态：

```bash
dc exec -T postgres psql -U videocut -d videocut -c 'SELECT * FROM execution_slots ORDER BY id;'
dc exec -T postgres psql -U videocut -d videocut -c 'SELECT id,stage,state,attempt FROM runs ORDER BY created_at DESC LIMIT 12;'
```

单镜重做时从查询结果的 `data.plan.dataList` 取得最新完整方案；渲染请求里的 `field_5`、templateId 与首次分析保持一致。不要拿旧版本请求只换 requestId 再发。

## 8. 不调用真实模型的自动化回归（可选）

宿主安装 Node.js 22+、pnpm 11.19.0、Python 3.11+、FFmpeg、Chromium 后，从 `video-worker` 执行。测试使用合成素材和模拟 Agent；媒体测试实际运行 Remotion/FFmpeg，但不验收真实模型质量。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
python3 -m venv .venv
.venv/bin/pip install jsonschema==4.26.0 requests==2.32.5 python-dotenv==1.2.1
cd ../claude-code-video-toolkit
../video-worker/.venv/bin/python3 -m unittest discover -s tests -p 'test_*pipeline.py'
cd templates/ifeng-scenes
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
cd ../../../video-worker
PYTHON="$PWD/.venv/bin/python3" REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:media
RUN_DOCKER_TESTS=1 RUNNER_IMAGE=videocut-runner:0.1.0 pnpm test
```

Chromium 路径以本机实际安装结果为准。Docker 隔离测试默认使用 DATA_ROOT，当前用户需要能够创建测试子目录；也可设置为自己可写的本地绝对路径。默认数据库测试是 PGlite；真实 PostgreSQL 测试可设置 `TEST_DATABASE_URL` 为专用测试库，Compose 的 PostgreSQL 默认不向宿主发布端口。完整 Ubuntu CI 配置见 `.github/workflows/video-worker.yml`。

## 9. 常见排查与后续更新

| 现象 | 先检查 |
| --- | --- |
| API 401 | Authorization 使用的是 tenants 的 apiKey，而非模型密钥 |
| HTTP 400 | 返回的字段错误；必须使用当前 v2 JSON，包含 script/requestId 等 |
| HTTP 409 | 同任务正在执行、requestId 内容冲突、方案版本过时 |
| queued 长时间不开始 | worker 日志、4 个槽位、Docker 权限、supervisor 锁是否被另一进程持有 |
| ASSET_UNAVAILABLE / 路径拒绝 | 宿主文件存在、inputRoot/allowedInputPrefixes、挂载路径和文件读取权限 |
| 模型调用失败 | CODEX_API_KEY、显式型号权限、容器网络/代理与接口地址 |
| 配音失败 | 豆包凭据、资源 ID、音色；EXTERNAL_RESULT_UNKNOWN 需要核对外部记录，不盲目重复付费 |
| ready 但没有回调 | callbackBaseUrl 容器可达；接收端必须 HTTP 2xx 且 JSON status=0；看 callback.last_error |
| 回调 dead_letter | 修复接收端后，POST `/ai_video_director/callbacks/<eventId>/retry`，带 Bearer 令牌 |

正式接入时替换临时 callbackBaseUrl，执行 `dc up -d --force-recreate api worker callbacks` 重新加载配置；选择空闲时段，避免打断测试任务。接收端还须验证 HMAC、eventId 幂等和版本顺序，规则见 Worker README。

后续发布制作代码要重新生成 runtime-manifest（Worker 目录执行 `pnpm runtime-manifest`），一起构建 control/runner 镜像；停止接收新请求、等待执行任务结束后更新。首次建库命令不要当成自动升级/回滚方案；未来数据库变更需对应迁移与备份。本版保留数据库卷、媒体目录和运行目录；不要使用 `docker compose down -v` 作为日常重启命令。
