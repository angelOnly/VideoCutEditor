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

cold 使用全新应用缓存，warm 紧接着复用该缓存；两者都重新渲染。不能安全清除系统页缓存，报告明确记录这一限制。每轮轮换四组顺序，任何时刻只运行一个对照组。共 24 次测量。保存每阶段 stdout/stderr、墙钟、采样 RSS/CPU 原始序列，汇总中位数和极差。RSS 是进程组 RSS 之和，可能重复计算共享页；CPU 是 `ps` 百分比积分估计，短进程可能漏采，不能写成内核精确资源记账。模型创作不属于此基准。

资源守卫只读扫描 `ps`，识别原路径命令及其后代媒体进程。原测试正在渲染时暂缓启动，等待时间单列。运行中原测试恢复媒体占用时，驱动写 `VIDEOCUT_BATCH_CANCEL_FILE`，终止自有独立进程组（先 TERM，8 秒后必要时 KILL），从不向原进程发信号。该轮记为污染并终止整场基准；重新运行必须另选新输出目录，避免把已变热的失败重试伪装成冷启动。内存超限或阶段失败也停止，不强行继续 3 路。没有原路径或祖先线索的外部媒体进程无法归属，本守卫不能替代运行前的人工只读进程核对。

成功结果也可能缺少实际媒体质量检查；配置必须含独立终检阶段才能用于发布判断。`qualified` 仅表示执行矩阵完整，并不代表成片验收。驱动测试使用短 Python 进程，绝不当作真实渲染性能或真实多代理证据。

轻量验证：`python3 video-worker/tests/render-benchmark.test.py`。
