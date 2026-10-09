import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "catalog.json"), "utf8"),
);
const query = process.argv.slice(2).join(" ").trim().toLowerCase();
if (!query) {
  console.log(
    "用法：node scripts/find.mjs 趋势 比较\n只返回最多5个候选；输入完整案例编号查看文件路径。",
  );
  process.exit(0);
}
const exact = catalog.find((c) => c.id === query);
if (exact) {
  console.log(
    JSON.stringify(
      {
        id: exact.id,
        title: exact.title,
        summary: exact.summary,
        purpose: exact.purpose,
        beats: exact.beats,
        limit: exact.limit,
        duration: exact.duration,
        files: Object.fromEntries(
          Object.entries(exact.files).map(([k, v]) => [
            k,
            Array.isArray(v)
              ? v.map((x) => path.join(root, x))
              : path.join(root, v),
          ]),
        ),
        frames: exact.frames.map((frame) => ({
          seconds: frame / exact.fps,
          path: path.join(root, 'cases', exact.id, 'frames', `${String(frame).padStart(3, '0')}.png`),
        })),
      },
      null,
      2,
    ),
  );
} else {
  const words = query.split(/\s+/),
    ranked = catalog
      .map((c) => ({
        c,
        score: words.reduce(
          (n, w) =>
            n +
            (c.tags.includes(w)
              ? 4
              : JSON.stringify([c.title, c.id, c.tags, c.summary, c.purpose, c.beats])
                    .toLowerCase()
                    .includes(w)
                ? 1
                : 0),
          0,
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  console.log(
    ranked.length
      ? ranked
          .map(({ c }) => `${c.id} | ${c.title} | ${c.tags.join("、")} | ${c.summary}\n说明：${path.join(root, c.files.guide)}`)
          .join("\n")
      : "未找到匹配项。查看 INDEX.md 的表达类别，或独立设计；不需要强行套用案例。",
  );
}
