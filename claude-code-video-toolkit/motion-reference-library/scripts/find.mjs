import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const libraries = ["typemotion-tables", "selected-mechanisms"];
const args = process.argv.slice(2);
const help =
  "用法：node scripts/find.mjs <动作或关系关键词> [--limit 1到5] [--kind source|mechanism]\n精确定位：node scripts/find.mjs <库名/案例编号>\n仅返回少量文字候选；精确定位只返回该项说明和媒体路径，不读取正文、图片、视频或源码。";
const output = (value) => console.log(JSON.stringify(value, null, 2));

function main() {
  // 无查询时只给用法，不能默认列出全库并占用模型上下文。
  if (!args.length || args.includes("--help")) return console.log(help);
  let limit = 3,
    kind;
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      limit = Number(args[++i]);
      if (!Number.isInteger(limit) || limit < 1 || limit > 5)
        throw Error("limit 必须为 1 到 5");
    } else if (args[i] === "--kind") {
      kind = args[++i];
      if (!["source", "mechanism"].includes(kind))
        throw Error("kind 只能为 source 或 mechanism");
    } else if (args[i].startsWith("--")) throw Error(`未知参数：${args[i]}`);
    else words.push(args[i]);
  }
  const query = words.join(" ").trim().toLowerCase();
  if (!query) return console.log(help);
  const exact = query.includes("/");
  const namespace = exact ? query.split("/")[0] : null;
  if (
    exact &&
    (!libraries.includes(namespace) || query.split("/").length !== 2)
  )
    throw Error(
      "精确编号须为 typemotion-tables/案例编号 或 selected-mechanisms/机制编号",
    );
  const warnings = [],
    items = [];
  for (const library of libraries) {
    const itemKind = library === "typemotion-tables" ? "source" : "mechanism";
    if ((namespace && namespace !== library) || (kind && kind !== itemKind))
      continue;
    try {
      // 脚本内部只读清单；完整清单与来源元数据不输出到模型上下文。
      const catalogue = JSON.parse(
        fs.readFileSync(path.join(root, library, "catalog.json"), "utf8"),
      );
      const entries = itemKind === "source" ? catalogue : catalogue.mechanisms;
      for (const entry of entries)
        items.push({
          library,
          kind: itemKind,
          entry,
          id: `${library}/${entry.id}`,
        });
    } catch {
      warnings.push(`${library} 清单不可用；可使用其他参考或继续自主设计。`);
    }
  }
  const absolute = (item, relative) => {
    const base = path.join(root, item.library),
      file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep)) throw Error("案例路径超出参考库");
    return file;
  };
  const summary = (item) => ({
    id: item.id,
    kind: item.kind,
    title: item.entry.title,
    summary: item.entry.summary,
    purpose: item.entry.purpose,
    guide: absolute(
      item,
      item.kind === "source" ? item.entry.files.guide : item.entry.document,
    ),
  });
  if (exact) {
    const item = items.find((candidate) => candidate.id === query);
    if (!item)
      return output({
        item: null,
        warnings,
        message: "未找到该编号；请确认库名和编号，不要假设案例已存在。",
      });
    const e = item.entry;
    const files =
      item.kind === "source"
        ? e.files
        : {
            guide: e.document,
            storyboard: e.storyboard,
            video: e.video,
          };
    const resolved = Object.fromEntries(
      Object.entries(files).map(([key, value]) => [
        key,
        Array.isArray(value)
          ? value.map((v) => absolute(item, v))
          : absolute(item, value),
      ]),
    );
    const frames =
      item.kind === "source"
        ? e.frames.map((frame) => ({
            seconds: frame / e.fps,
            path: absolute(
              item,
              `cases/${e.id}/frames/${String(frame).padStart(3, "0")}.png`,
            ),
          }))
        : undefined;
    const missing = [
      ...Object.values(resolved).flat(),
      ...(frames ?? []).map((f) => f.path),
    ].filter((file) => !fs.existsSync(file));
    return output({
      ...summary(item),
      hasSource: item.kind === "source",
      relation: e.relation,
      startState: e.start_state,
      endState: e.end_state,
      beats: e.beats,
      limit: e.limit,
      files: resolved,
      frames,
      missing,
      warnings,
      usage:
        item.kind === "source"
          ? "先读说明和分镜，评估采用后按需读取入口与依赖；演示时长不作为本期时长。"
          : "这是动作观察拆解，没有作者源码；先读说明和分镜，需确认运动细节时再看原片，并编写本期实现。",
    });
  }
  const tokens = query.split(/[\s，、,；;]+/).filter(Boolean);
  const ranked = items
    .map((item) => {
      const e = item.entry;
      const tags = [
        ...(e.tags ?? []),
        ...Object.values(e.retrieval ?? {}).flat(),
      ];
      const text = JSON.stringify([
        e.id,
        e.title,
        e.summary,
        e.purpose,
        e.relation,
        e.start_state,
        e.end_state,
        e.beats,
        tags,
      ]).toLowerCase();
      const score = tokens.reduce(
        (n, word) =>
          n + (tags.includes(word) ? 4 : text.includes(word) ? 1 : 0),
        0,
      );
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  output({
    candidates: ranked.slice(0, limit).map(({ item }) => summary(item)),
    warnings,
    message: ranked.length
      ? "先比较文字候选，仅精确定位入围项；按需读说明、看图，需确认运动细节才看视频。"
      : "没有匹配项。可拆分运动阶段、改用动作关键词，或继续自主设计；不要全量读取案例。",
  });
}

try {
  main();
} catch (error) {
  output({ error: error.message });
  process.exitCode = 1;
}
