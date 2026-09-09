# Ubuntu 24.04：DeepSeek V4 无人值守剪辑测试

测试稿已保存为 script.md。沿用双主持人布局，保留原稿顺序和内容，以固定豆包男女音色朗读，1920×1080/30fps。原稿不是已核实新闻；“黄仁勋原采访”没有对应素材，引语用普通合成旁白并标注，不伪装成原声。背景音乐省略，音效复用已有文件，旧片头从源码重建。

这是一轮真实 Codex 制作测试：首次准备不调用模型/TTS；run.sh 会实际产生 Codex 和豆包用量。默认最长 60 分钟，Skill 内最多两轮修复；没有生产 Worker 的自动续轮、精确费用上限、重启恢复或 HTTP 下载接口。测试结果需实际在目标机器验证。

## 1. 进入仓库和持久终端

```bash
cd ~/VideoCutEditor
git pull --ff-only origin main
sudo apt update
sudo apt install -y git ffmpeg fonts-noto-cjk python3-venv python3-pip nodejs npm tmux \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64

tmux new -s deepseek-video
```

后续命令在 tmux 内执行。已创建该会话时用 `tmux attach -t deepseek-video`。按 Ctrl+B 再按 D 可断开会话，服务器继续执行。无需 GPU；浏览器和 TTS/API 需要可访问对应网络。

## 2. Python 和 Codex

```bash
cd ~/VideoCutEditor
source ~/codex-env/bin/activate
python3 -m pip install requests python-dotenv elevenlabs
node --version
npm --version
codex --version
codex login status
```

若没有 codex 命令，可用用户目录安装，不需要 sudo npm：

```bash
npm install --prefix "$HOME/.local" -g @openai/codex
export PATH="$HOME/.local/bin:$PATH"
codex login --device-auth
```

若原有 codex 可用但未登录，只执行 `codex login --device-auth`，按终端提示在浏览器授权。已有公司 API/代理配置则沿用，不覆盖。登录是环境的一次性准备，开始任务后不再等待人工确认。

## 3. 配置本次豆包配音

使用对 Seed TTS 2.0 有权限的真实 API Key，首次配置执行：

```bash
python3 test-cases/deepseek-v4/configure_tts.py
```

输入不回显，保存在仓库根目录 `.env`，权限 600，Git 已忽略。run.sh 每次自动加载，无需每次 export。已导出的非空环境变量优先于文件；若本终端仍保留旧 Key，先 `unset DOUBAO_TTS_API_KEY DOUBAO_TTS_RESOURCE_ID`。密钥是否失效以控制台有效期、禁用和权限为准。

固定女声 `zh_female_xiaohe_uranus_bigtts`、男声 `zh_male_m191_uranus_bigtts`，需在该账号可用。收到鉴权/音色不可用时修正配置，不生成多轮试听。使用豆包语音新控制台的 API Key 管理，不是聊天产品账号密码。

早期接入文档曾误含真实凭据。文档已替换占位符，但历史提交仍可能读取旧值；请禁用旧 Key 并配置新 Key。不要复用 Git 历史中的值。

## 4. 准备任务及渲染依赖

```bash
cd ~/VideoCutEditor
python3 test-cases/deepseek-v4/prepare.py
cd projects/deepseek-v4-test/project
npm ci
npx remotion browser ensure
cd ~/VideoCutEditor
```

任务初始化会复制稿件、头像、Logo、音效、参考截图和选定 TSX 到 `projects/deepseek-v4-test/`。原始示例不改动。目录存在时拒绝覆盖；先检查既有任务，不要无意重复付费。需要全新测试时 `prepare.py --job-id deepseek-v4-test-02`，安装对应 project 的 npm 依赖，再将该 ID 传给 run.sh。

## 5. 启动自动制作

```bash
cd ~/VideoCutEditor
bash test-cases/deepseek-v4/run.sh
```

run.sh 使用 [Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)，加载 video-pipeline 和任务 prompt，自动处理配音、适配、新时间轴、关键帧与完整 MP4。最终响应必须是本任务 candidate，然后再从工具库运行独立校验。60分钟超时会终止进程组，日志保留。不要把 shell 退出 0 或一句“完成”当成制作成功。

另开 SSH 连接查看进度：

```bash
tail -f ~/VideoCutEditor/projects/deepseek-v4-test/events.jsonl
```

若失败，先看以下文件（它们按执行进度生成，早期失败可能尚不存在）：

```bash
cat ~/VideoCutEditor/projects/deepseek-v4-test/codex.stderr.log
cat ~/VideoCutEditor/projects/deepseek-v4-test/agent-response.json
cat ~/VideoCutEditor/projects/deepseek-v4-test/validation.json
```

run.started 防止直接重复执行已开始的任务。失败后应根据已生成音频和具体错误决定恢复，不能直接删目录重做。该测试脚本不承诺自动恢复未知付费请求。

## 6. 检查与下载

终端出现 `Local candidate validated` 才表示本地基础技术门禁通过。检查 validation.json 的 passed 为 true，并看 quality/ 关键帧：人物切换、章节和片尾是否符合参考。

成片：`~/VideoCutEditor/projects/deepseek-v4-test/output/video.mp4`。

在 Mac 的新终端（不是服务器终端）下载：

```bash
scp ops@10.20.130.251:~/VideoCutEditor/projects/deepseek-v4-test/output/video.mp4 ~/Downloads/deepseek-v4-test.mp4
```

当前本地已检查：准备脚本生成正确任务与文件、未混入旧旁白/时间轴、Shell 语法、成片校验器10项测试。没有冒充已在 Ubuntu 上完成真实 Codex/TTS/渲染验收。
