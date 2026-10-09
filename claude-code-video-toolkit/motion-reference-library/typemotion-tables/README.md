# Tables 本地动画参考库

整理日期：2026-10-09。

这里保存 43 个独立重写的动画案例：可运行的 React / SVG / Remotion 源码、按动作长度导出的 MP4、4 张 PNG 分镜及一张分镜拼图。不是原站源码，也不声称逐像素一致。所有数值为演示数据。

**先打开 [本地画廊](gallery.html)**，按趋势、占比、关系、排序等关键词筛选，先读文字检索所需动效，再看候选案例的分镜图，需要确认运动细节时再播放视频。画廊只加载选中案例的视频，不自动播放全库。

## 放在哪里，为什么

库放在 `motion-reference-library/typemotion-tables/`，与 `.agents/skills/`、任务工程和栏目模板分开。

- Skill 保存查找与采用方法，避免几十份案例占满上下文。
- 参考库保存可复用的案例及媒体，不绑定财经或任何其他栏目。
- 本期工程保存导演选用后改写的组件，不回写共享模板。
- 本地导演与美术 Skill 已接入按需参考方法，插件打包器已包含必要资源；服务器需另行部署新版本后生效。

## 按需读取

1. 输入表达关系，使用统一入口：`node ../scripts/find.mjs 趋势 比较`。默认返回 3 项，最多 5 项；不输出全库。
2. 选定编号：`node ../scripts/find.mjs typemotion-tables/radar-morph`。仅返回该项文件位置。
3. 先读该项 README 确认适用条件，再看分镜拼图，必要时放大单张分镜；需要确认运动细节才看视频。选中后按需读取入口、对应绘制文件和 `core.tsx`。其他 42 项不加载。
4. 将适合的运动移入本期工程，改数据、尺寸、视觉风格及真实口播落点；在完整模板里试作。

没有匹配项时继续独立设计或寻找其他参考，不能为了使用库而把内容硬塞进不合适的图表。

## 源码结构

`cases/<编号>/Scene.tsx` 是每项独立入口；`shared/` 按图表家族共享绘制与时间工具。同族配色变体共用几何和运动，不重复维护。案例说明列出了实际依赖。

每项目录包含：

- `Scene.tsx`、`case.json`、`README.md`：入口、适用条件、动作拆解和依赖。
- `preview.mp4`：1280×720、30fps、按各案例动作长度导出、无声参考样片。
- `frames/*.png`（具体帧号见案例清单）：动作中途及稳定状态。
- `storyboard.jpg`：以上四帧的 2×2 拼图。

这些是示例工程，不是任意输入都能自动正确布局的图表 SDK。增加类别、输入负值、替换长标签后，需要对应调整布局与检查。例中的 30fps 和演示时长仅用于本库预览，不作为业务任务限制。

## 运行

需要 Node.js、FFmpeg。安装 `package.json` 中的依赖后：

```bash
npm install
npm run check
npm run render -- line-trend
npm run render
```

有输出会跳过；重生成用 `npm run render -- line-trend --force`。一个案例失败会记录并继续其余案例，最终以失败退出码提示，详情保存在 `render-report.json`。中途打断后的对应案例使用 `--force` 重生成。画廊可直接双击打开，也可 `python3 scripts/serve.py` 后访问 http://127.0.0.1:8768/gallery.html 。该服务为案例说明与源码明确指定 UTF-8 编码，避免浏览器直接打开时中文乱码；说明以 Markdown 原文显示。

本机为了复用已有依赖，`node_modules` 是指向 `../../examples/hello-world/node_modules` 的忽略目录链接。打包和迁移不应包含此链接或 `.bundle`；在新机器安装依赖即可。

## 检查输出

运行 `python3 scripts/verify.py` 检查文件齐全、视频完整解码、帧率时长和分镜尺寸，结果写入 `verification.json`。运行 `python3 scripts/overview.py` 更新全库总览。技术检查不等于美术评价；参考时先读文字并检索，再看分镜图；需要确认运动细节时才看视频。

本次验证：TypeScript 检查通过；43 个 MP4 全部完整解码；172 张 PNG 和 43 张拼图齐全。已检查全库终态总览及代表案例的中途分镜，并在画廊播放验证折线与雷达样片。没有进行与原站逐像素、逐帧一致性认证。

## Skill 接入

正式指令见 [导演 Skill](../../.agents/skills/directing-motion-art/SKILL.md)、[美术动效 Skill](../../.agents/skills/motion-design-production/SKILL.md) 和 [按需参考方法](../../.agents/skills/directing-motion-art/references/local-motion-library.md)。采用前由两个创作视角共同判断；参考资源按需读取，不自动注入全库。

调用链：Render 加载两个 Skill → 文字检索候选 → 读说明与看图 → 必要时看视频或局部源码 → 共同确定本期设计 → 适配源码并预览。缺少案例或没有匹配时继续设计；插件文件损坏仍由现有完整性检查处理。

发布资源通过 `video-worker/scripts/package-plugin.mjs` 的明确清单加入；不包含本库的依赖环境、构建缓存和接入草案。源码样例不是自适应图表 SDK，本期数据变化仍需美术评估和布局修正。
