# 百度一镜 SaaS → HTTP（非官方适配器）

状态：已经实现本地接口、请求签名、报价、串行提交、持久化及轮询；**尚未通过真实账户的视频生成联调，不能视为已可用于生产。**

本项目访问 `huibo.baidu.com` 网页所用的内部接口，使用 SaaS 账户的登录态及原有权益，不依赖曦灵 PaaS 的 App ID/Key。个人数字人是否允许由这些请求生成，仍以该账户实际返回为准。

## 在当前 Mac 上启动

双击 `start.command`，或在终端中运行它。默认地址 `http://127.0.0.1:8788`。

启动会打开一个**服务专用 Chrome 窗口**，请在那个窗口中正常登录百度一镜。它不读取或复制日常 Chrome 的 Cookie。该窗口使用独立配置目录，登录态保存在本机 `.data/browser-profile`，不要提交或分享 `.data`。

`start.command` 使用当前电脑自带的 Codex Node/Playwright 运行时。迁移到其他电脑时，安装 Node.js 20+、Chrome，在本目录执行 `npm install`，再执行 `npm start -- --login`。浏览器保持运行，HTTP 请求通过其独立 Cookie 会话发往一镜。

## 调用步骤

接口均需要 `Authorization: Bearer <API Key>`，Key 由服务首次启动自动生成，位于 `.data/api-key`。`GET /health` 只表示服务进程存活，登录状态请用 `GET /session`。

当前电脑可以用下列命令前缀调用附带客户端，客户端会在本地读取 Key，无需复制到聊天：

```bash
NODE=/Users/jiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" client.cjs GET /session
"$NODE" client.cjs GET '/avatars?screen=9:16&page=1'
```

`/avatars` 暂时保留上游原始 `list` 与分页字段，不假造 figureId。列表每页 10 条。生成参数需要的是记录中的 `vis_figure_id`，不要把形象名字、列表序号或 PaaS figureId 当作它。音色 `voice` 使用该形象实际可用的 `voice_list` 中的参数；若没有音色数据，需继续联调后补充，不能猜测。

1. `POST /quotes` 估价。以下内容保存为 `quote-input.json`，替换实际 ID/音色参数：

```json
{
  "avatar_id": "实际 vis_figure_id",
  "voice": {"tts_mid": "实际音色 ID", "tts_speed": 5},
  "text": "大家好，这是一段数字人口播测试。",
  "screen": "9:16",
  "subtitles": true,
  "background_music": false
}
```

```bash
"$NODE" client.cjs POST /quotes quote-input.json
```

返回 `quote_id`、`coins`、`quota` 和平台原始 `cost`。报价不验证形象与音色是否兼容，也不生成视频；报价有效期 5 分钟。

2. `POST /videos` 实际生成，**会消耗 SaaS 额度或星币**。保存 `submit-input.json`：

```json
{"quote_id":"上一步返回的 quote_id","max_coins":0,"max_quota":1}
```

```bash
"$NODE" client.cjs POST /videos submit-input.json my-unique-request-0001
```

最后一个参数是 `Idempotency-Key`。`max_coins` 和 `max_quota` 必须按自己接受的最大消耗填写；服务在提交前再次估价，超出上限则停止。不要机械复制示例额度。

3. 用响应中的 `status_url` 查询：

```bash
"$NODE" client.cjs GET /tasks/实际本地任务ID
```

服务每 15 秒查询一次上游任务。成功时返回 `video_url` 和上游记录；若没有地址，返回 `null`，不会伪造下载成功。

等价 HTTP 调用：

```bash
HUIBO_API_KEY="$(cat .data/api-key)"
curl -H "Authorization: Bearer $HUIBO_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @quote-input.json http://127.0.0.1:8788/quotes
```

## 接口

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | /health | 本地进程存活 |
| POST | /session/open | 打开专用登录浏览器，请求体 `{}` |
| GET | /session | 实际尝试读取形象，检查登录及接口状态 |
| GET | /avatars?screen=9:16&page=1 | 读取个人形象 |
| POST | /quotes | 根据文案与语速估价 |
| POST | /videos | 消耗额度提交，需要 Idempotency-Key |
| GET | /tasks/:id | 查询持久化任务与上游状态 |

`unknown` 表示上游可能已收到生成请求，但本地无法确认：必须在百度一镜“视频作品”中核对，不能直接换一个 Key 重试。进程重启时，不会自动重发中断中的生成请求。登录过期、人机验证或权限拒绝均返回错误，不自动绕过验证。

目前只实现文字口播（video_type=2），默认保留平台水印。未实现音频上传驱动、混剪、多人物、回调、公网部署。请求结构来自 2026-09-07 的公开网页构建；它不是稳定的官方 API，网站更新后需要维护。

## 验证

`node --test test.cjs` 使用模拟上游，覆盖费用上限、重复提交、响应丢失、重启恢复及 HTTP 鉴权。模拟测试通过不等于真实视频生成通过。

实测记录及接口来源见 `IMPLEMENTATION.md`。持久化浏览器会话使用 [Playwright launchPersistentContext](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)。
