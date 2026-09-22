# 公平渲染基准驱动

`python3 video-worker/scripts/render-benchmark.py --config /本工作树/配置.json`。
驱动不加载 `.env`，不启动 Worker、不连接数据库；每次必须使用全新输出目录。命令以参数数组执行，不经过 shell。运行前确认各媒体命令只向自己的任务目录写入，不能把原任务的绝对路径直接作为输出路径。

配置字段：

- `cwd`：当前独立工作树的执行目录；`protectedRoot`：原工作区绝对路径。
- `outputRoot`：不存在的独立基准结果目录。
- `immutableInputs`：逐文件列出的工程源码、确认稿、音频及规格；每轮前后校验 SHA256。目录需由调用者展开为文件。
- `variants`：严格四组 `old_serial`、`new_1`、`new_2`、`new_3`，对应 `slots` 为 1、1、2、3；各组包含 `stages` 数组，每阶段有 `name`、`argv`，可指定 `timeoutSeconds`。推荐分为准备、打包、渲染、混音、检查；原路径无法拆分时只记录真实总耗时，细项为不可用。
- `repetitions`：至少 3；`sampleIntervalSeconds` 默认 0.5；`maxAggregateRssKiB` 默认 10 GiB。
- `env`：可选环境变量映射；不得填入生产数据库配置或密钥。媒体命令必须实际使用传入的隔离缓存。
- `cleanupRelativePaths`：例如 `["artifacts"]`，每轮结束对这些本轮目录内的文件保存大小和摘要后删除，降低磁盘占用。日志及结果不能放入待清理目录。`cleanCacheAfterPair` 默认 true，在 cold/warm 成对完成后删除专用缓存。

参数字符串可用 `{runDir}`、`{cacheDir}`、`{slots}`、`{trial}`；所有视频及打包输出建议放在 `{runDir}/artifacts` 下。各组命令必须消费同一份冻结源码/音频/规格。old_serial 必须使用指定基线提交导出的旧工具，不能指向改后的实现冒充基线。新实现每轮重新 freeze-batch 并使用新的批次目录，warm 仅复用应用编译缓存，不允许读取上一轮已完成镜头直接当成渲染。

示例阶段对象（嵌入 variant 的 `stages` 中，实际参数由任务填写）：

```json
{
  "name": "render",
  "argv": ["python3", "/独立工作树/驱动.py", "--output", "{runDir}/artifacts", "--cache", "{cacheDir}", "--slots", "{slots}"],
  "timeoutSeconds": 7200
}
```

cold 使用全新应用缓存，warm 紧接着复用该缓存；两者都重新渲染。不能安全清除系统页缓存，报告明确记录这一限制。每轮轮换四组顺序，任何时刻只运行一个对照组。共 24 次测量。跨 `setsid` 沿父子链登记 PID、启动时间和 PGID，后代重挂父进程后继续跟踪，排除 PID 复用。保存每阶段 stdout/stderr、墙钟、采样 RSS/CPU 原始序列，汇总中位数和极差。RSS 是已确认自有后代进程 RSS 之和，可能重复计算共享页；CPU 是 `ps` 百分比积分估计，短进程可能漏采，不能写成内核精确资源记账。模型创作不属于此基准。

资源守卫只读扫描 `ps`，识别原路径命令及其后代媒体进程。原测试正在渲染时暂缓启动，等待时间单列。运行中原测试恢复媒体占用时，驱动写 `VIDEOCUT_BATCH_CANCEL_FILE`，给协调器 8 秒合作取消，再终止已登记的自有派生进程组（先 TERM，8 秒后必要时 KILL），从不向原进程发信号。该轮记为污染并终止整场基准；重新运行必须另选新输出目录，避免把已变热的失败重试伪装成冷启动。内存超限或阶段失败也停止，不强行继续 3 路。没有原路径或祖先线索的外部媒体进程无法归属，本守卫不能替代运行前的人工只读进程核对。

成功结果也可能缺少实际媒体质量检查；配置必须含独立终检阶段才能用于发布判断。`qualified` 仅表示执行矩阵完整，并不代表成片验收。驱动测试使用短 Python 进程，绝不当作真实渲染性能或真实多代理证据。

轻量验证：`python3 video-worker/tests/render-benchmark.test.py`。

## 本次 18 镜实际工程适配

主控合并章节并同步所有 props 后，使用 `render-benchmark-adapter.py --generate` 生成 settings、四组配置并从 `c68f7d0` 导出原版 tools/schema。配置生成后若修改工程，应重新生成配置与结果目录。示例（在仓库根执行）：

```sh
python3 -B video-worker/scripts/render-benchmark-adapter.py --generate \
  --settings "$PWD/claude-code-video-toolkit/projects/render-parallel-20260923/evidence/bench-final.json" \
  --source "$PWD/claude-code-video-toolkit/projects/render-parallel-20260923" \
  --output "$PWD/claude-code-video-toolkit/projects/render-parallel-20260923/benchmark-final" \
  --protected-root /Users/jiang/Documents/VideoCutEditor \
  --python /Users/jiang/Documents/VideoCutEditor/video-worker/.venv/bin/python3 \
  --node /Users/jiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --modules /Users/jiang/Documents/VideoCutEditor/claude-code-video-toolkit/examples/hello-world/node_modules \
  --browser '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

输出 `bench-final.benchmark.json` 可直接传给基准驱动。生成、准备步骤均不调用模型、TTS 或媒体渲染。每轮只复制 input、project、57 段既有配音、confirmation、时间轴及 props；重新分配 taskId 并重算确认/请求摘要，不复制预算、工作缓存、成功结果。node_modules 仅建立到已安装依赖的只读使用链接，渲染运行时写入由工具限制在独立工作目录。完整矩阵顺序执行，不并发不同组。

当前 Remotion bundle 禁用应用缓存。因此 cold/warm 在本适配中只表示首次及紧邻重复运行，**不代表可控系统冷缓存，也不代表 warm 命中应用编译缓存**；各轮都重新打包、渲染18镜4112帧并合片。新实现同一轮18镜共享一次bundle，旧实现每镜打包；旧实现打包细项为 null，不能补造精确数值。新打包耗时在 `render.json.metrics.bundleSeconds` 中。

每轮分别记录 prepare、freeze、render、assemble、check。技术合片复用正式媒体工具的混音规则，技术检查验证确认原文、全部 MP4 解码、帧数/规格/音频一致性、合片边界及全量解码像素摘要。首个旧串行建立像素参考，此后任何不同都会停止结论。它**不生成生产 review、Worker 成功账本或声称人工已看**；`technical-check.json` 明确标记未人工试听、未视觉审查。最终候选仍需主控独立视觉审查，不能把这里的像素参考当作已经审美验收。

大文件位于每轮 `artifacts`，基准驱动记录摘要后清理；各轮 `render.json`、`technical-check.json`、合片摘要、日志和资源采样保留。最终供人工审查的候选请另用同一冻结工程正常渲染保存，不能把已被清理的基准路径当交付路径。

## 原工作区遗留闲置浏览器

不能停止原测试遗留浏览器，也不能仅凭进程存在永久推断原测试仍在渲染。可设置 `idleBaselineProcesses: [{"pid": 123, "started": "ps lstart 的完整值"}]` 和 `idleBaselineEvidence` 文件路径，作严格且有证据的闲置例外。适配配置生成支持 `--idle-baseline-evidence 文件` 自动填入。

证据必须含 `observationSeconds >= 60`、真实 `maxCpuPercent <= 0.5`（保留闲置维护的 0.1% 等真实值，不能写成零）、`noActiveProducer: true`、完整 `processes` 签名、`completionEvidence: [{path,sha256}]`，以及 `observationFile`/`observationSha256`。原始观察是 `[{at: epoch秒, processes: [{pid,started,cpu,...}]}]`，驱动验证时间跨度、每次均覆盖全部签名、CPU摘要及文件摘要。完结证据与“无活跃生产者”需基于只读原状态判断，不能仅凭没有 candidate 作结论。

原观察必须覆盖浏览器全部后代，包括 GPU/网络 Helper。精确签名匹配且当前 CPU 不超过 1% 才临时忽略；任何名单进程恢复到 >1%、签名变化，或发现未知原媒体后代，仍阻挡/污染停止。绝不向这些进程发送信号。其常驻 RSS 通过 `externalIdleBaselineRssKiB` 原始采样和 `externalIdleBaselinePeakRssKiB` 单独记录，不算己方开销；报告须声明仍存在外部常驻内存，不声称机器完全独占。
