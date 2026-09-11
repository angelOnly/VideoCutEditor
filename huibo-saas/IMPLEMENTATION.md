# 来源和验证边界

公开网页：https://huibo.baidu.com/video

检查到的构建号：`huibo-2026-09-07-e38a799`。

公开 JS 来源：

- `https://huibo-static.cdn.bcebos.com/huibo/aianchor/fe/scripts/huibo.index.6b918a1b.js`
- 同一构建的 `lp-route-videoPlatformCustomVideo`、`lp-route-video-works`、chunk 3352。

主包模块 7746 是 POSTJSON 请求序列化与签名；模块 21178 定义口播类型 2、视频状态；模块 82177 定义视频平台头为 1。3352 中模块 45944 定义口播参数与按 benefits_id=1014 的费用估算。视频作品模块按 `{ids: [Number(id)], version: 4}` 查询状态。

已通过浏览器检查：登录账户的个人形象页面可见 5 条记录，可进入“视频工具 → 数字人视频”。尚未获得这些记录的实际 vis_figure_id/音色配置，也未提交实际生成。旧聊天标签页曾反复出现控制超时，因此服务采用独立浏览器会话。

生成参数中 `figure_info.type=1`、文案标注结构及返回字段仍需要真实账户联调。若该账户数字人类型不匹配，需要依据实际形象记录调整，不能以源码推断替代验证。
