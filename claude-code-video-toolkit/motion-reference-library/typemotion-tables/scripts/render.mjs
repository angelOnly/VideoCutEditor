import { bundle } from "@remotion/bundler";
import {
  getCompositions,
  openBrowser,
  renderMedia,
  renderStill,
} from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "catalog.json"), "utf8"),
);
const ids = process.argv.slice(2).filter((x) => !x.startsWith("--"));
if (ids.some((id) => !catalog.some((c) => c.id === id)))
  throw new Error("未知案例编号");
const selected = ids.length
  ? catalog.filter((c) => ids.includes(c.id))
  : catalog;
const force = process.argv.includes("--force");
const browser = await openBrowser(
  "chrome",
  process.env.MOTION_GL
    ? { chromiumOptions: { gl: process.env.MOTION_GL } }
    : undefined,
);
const report = [];
try {
  const serveUrl = await bundle({
    entryPoint: path.join(root, "Root.tsx"),
    outDir: path.join(root, ".bundle"),
  });
  const compositions = await getCompositions(serveUrl, {
    puppeteerInstance: browser,
  });
  // 一个案例失败不影响其他案例；结束后给出完整失败清单。
  for (const c of selected) {
    const dir = path.join(root, "cases", c.id),
      composition = compositions.find((x) => x.id === c.id);
    try {
      fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
      const video = path.join(dir, "preview.mp4");
      if (force || !fs.existsSync(video))
        await renderMedia({
          serveUrl,
          composition,
          puppeteerInstance: browser,
          codec: "h264",
          outputLocation: video,
          crf: 20,
          concurrency: 4,
          logLevel: "error",
        });
      for (const frame of c.frames) {
        const output = path.join(
          dir,
          "frames",
          String(frame).padStart(3, "0") + ".png",
        );
        if (force || !fs.existsSync(output))
          await renderStill({
            serveUrl,
            composition,
            puppeteerInstance: browser,
            frame,
            output,
            imageFormat: "png",
            logLevel: "error",
          });
      }
      const inputs = c.frames.flatMap((f) => [
        "-i",
        path.join(dir, "frames", String(f).padStart(3, "0") + ".png"),
      ]);
      const filter =
        c.frames.map((_, i) => `[${i}:v]scale=640:360[v${i}]`).join(";") +
        ";[v0][v1][v2][v3]xstack=inputs=4:layout=0_0|640_0|0_360|640_360[out]";
      const result = spawnSync(
        process.env.FFMPEG ?? "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          ...inputs,
          "-filter_complex",
          filter,
          "-map",
          "[out]",
          "-frames:v",
          "1",
          "-update",
          "1",
          path.join(dir, "storyboard.jpg"),
        ],
        { encoding: "utf8" },
      );
      if (result.status !== 0)
        throw new Error(
          result.stderr || result.error?.message || "分镜拼图失败",
        );
      report.push({ id: c.id, status: "完成", bytes: fs.statSync(video).size });
      console.log(`完成 ${c.id}`);
    } catch (error) {
      report.push({ id: c.id, status: "失败", error: String(error) });
      console.error(c.id, error);
    }
  }
} finally {
  await browser.close({ silent: true });
}
const reportFile = path.join(root, "render-report.json");
const previous = fs.existsSync(reportFile)
  ? JSON.parse(fs.readFileSync(reportFile, "utf8")).cases
  : [];
const byId = new Map(previous.map((c) => [c.id, c]));
for (const item of report) byId.set(item.id, item);
fs.writeFileSync(
  path.join(root, "render-report.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      cases: catalog.map((c) => byId.get(c.id)).filter(Boolean),
    },
    null,
    2,
  ),
);
if (report.some((x) => x.status === "失败")) process.exitCode = 1;
