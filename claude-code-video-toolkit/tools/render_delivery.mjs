#!/usr/bin/env node
/** Full v1 Remotion delivery. Visual design and mixing remain in the composition. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  command,
  probe,
  assertDelivery,
  verifyMix,
} from "./media_delivery.mjs";

function local(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative))
    throw new Error("Expected job-relative path");
  const resolved = fs.realpathSync(path.resolve(root, relative));
  if (resolved !== root && !resolved.startsWith(root + path.sep))
    throw new Error("Path escapes job directory");
  return resolved;
}

export function validateSpec(task, timeline, composition) {
  if (task.schemaVersion !== 1 || task.mode !== "auto")
    throw new Error(
      "Expected v1 auto task; v2 segment rendering is not supported",
    );
  const s = { ...task.output, totalFrames: timeline.totalFrames };
  if (
    !Number.isFinite(s.fps) ||
    s.fps <= 0 ||
    !Number.isInteger(s.totalFrames) ||
    s.totalFrames <= 0 ||
    !Number.isInteger(s.width) ||
    s.width <= 0 ||
    s.width % 2 ||
    !Number.isInteger(s.height) ||
    s.height <= 0 ||
    s.height % 2 ||
    typeof s.requireAudio !== "boolean"
  )
    throw new Error("Invalid output specification");
  if (
    (s.colorSpace && s.colorSpace !== "bt709") ||
    (s.pixelFormat && s.pixelFormat !== "yuv420p")
  )
    throw new Error("This exporter supports SDR BT.709/yuv420p only");
  if (
    !Number.isFinite(timeline.durationSec) ||
    Math.abs(timeline.fps - s.fps) > 0.000001 ||
    Math.abs(timeline.durationSec - s.totalFrames / s.fps) > 1 / s.fps + 0.001
  )
    throw new Error("Task/timeline mismatch");
  if (
    composition &&
    (composition.width !== s.width ||
      composition.height !== s.height ||
      Math.abs(composition.fps - s.fps) > 0.000001 ||
      composition.durationInFrames !== s.totalFrames)
  )
    throw new Error("Composition/task mismatch");
  return s;
}

export async function renderDelivery({
  jobDir,
  browserExecutable,
  concurrency = 4,
}) {
  const job = fs.realpathSync(jobDir);
  const read = (p) => JSON.parse(fs.readFileSync(local(job, p), "utf8"));
  const task = read("task.json"),
    timeline = read("timeline.json"),
    manifest = read("project-manifest.json");
  const spec = validateSpec(task, timeline);
  if (timeline.jobId !== task.jobId || manifest.jobId !== task.jobId)
    throw new Error("Task identity mismatch");
  const project = local(job, manifest.projectPath),
    entry = local(job, manifest.entry);
  if (typeof manifest.compositionId !== "string" || !manifest.compositionId)
    throw new Error("Missing compositionId");
  const props = manifest.inputPropsPath ? read(manifest.inputPropsPath) : {};
  const require = createRequire(path.join(project, "package.json"));
  const { bundle } = require("@remotion/bundler");
  const {
    openBrowser,
    selectComposition,
    renderMedia,
  } = require("@remotion/renderer");
  const output = path.join(job, "output");
  fs.mkdirSync(output, { recursive: true });
  if (fs.realpathSync(output) !== output)
    throw new Error("Output directory may not be a symlink");
  // Exclusive lock prevents two exporters racing to replace the same candidate.
  const lock = fs.openSync(path.join(output, ".render-delivery.lock"), "wx");
  let work, browser;
  const previousCwd = process.cwd();
  const record = {
    schemaVersion: 1,
    jobId: task.jobId,
    profile: "sdr-bt709-pcm",
    passed: false,
    startedAt: new Date().toISOString(),
  };
  const log = (s) =>
    fs.appendFileSync(
      path.join(job, "render.log"),
      `${new Date().toISOString()} ${s}\n`,
    );
  try {
    work = fs.mkdtempSync(path.join(output, ".render-delivery-"));
    record.workDirectory = path.relative(job, work);
    process.chdir(project);
    log("render_delivery started");
    const serveUrl = await bundle({
      entryPoint: entry,
      outDir: path.join(work, "bundle"),
      publicDir: local(
        job,
        manifest.publicPath || path.relative(job, path.join(project, "public")),
      ),
      webpackOverride: (c) => ({ ...c, cache: false }),
    });
    browser = await openBrowser("chrome", {
      browserExecutable,
      chromiumOptions: { gl: "angle" },
    });
    const composition = await selectComposition({
      serveUrl,
      id: manifest.compositionId,
      inputProps: props,
      puppeteerInstance: browser,
    });
    validateSpec(task, timeline, composition);
    const common = {
      serveUrl,
      composition,
      inputProps: props,
      puppeteerInstance: browser,
      concurrency,
      ffmpegOverride: ({ args, type }) => {
        fs.appendFileSync(
          path.join(work, "ffmpeg-argv.jsonl"),
          JSON.stringify({ type, args }) + "\n",
        );
        return args;
      },
    };
    const picture = path.join(work, "picture.mp4"),
      mix = path.join(work, "mix.wav"),
      candidate = path.join(work, "video.mp4");
    let last = -1;
    await renderMedia({
      ...common,
      codec: "h264",
      pixelFormat: "yuv420p",
      colorSpace: "bt709",
      audioCodec: "aac",
      crf: 18,
      outputLocation: picture,
      onProgress: (p) => {
        const percent = Math.floor(p.progress * 10) * 10;
        if (percent > last) {
          last = percent;
          log(`video ${percent}%`);
        }
      },
    });
    // Audio-only render uses the same composition, assets, volume curves and trims.
    // Do not use separateAudioTo with PCM for the picture pass: that path can
    // select an intermediate MKV timebase and perturb timestamps on re-mux.
    await renderMedia({
      ...common,
      codec: "wav",
      audioCodec: "pcm-16",
      enforceAudioTrack: true,
      outputLocation: mix,
    });
    const duration = spec.totalFrames / spec.fps;
    const args = [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-i",
      picture,
      "-i",
      mix,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-video_track_timescale",
      "90000",
      "-t",
      String(duration),
      "-movflags",
      "+faststart",
      candidate,
    ];
    fs.writeFileSync(
      path.join(work, "mux-argv.json"),
      JSON.stringify(args, null, 2),
    );
    command("ffmpeg", args);
    const metadata = probe(candidate);
    assertDelivery(metadata, spec);
    command("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      "-i",
      candidate,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-f",
      "null",
      "-",
    ]);
    const intervals = (timeline.audio || []).map((c) => [
      c.startFrame / spec.fps,
      c.endFrame / spec.fps,
    ]);
    record.audioAlignment = verifyMix(
      candidate,
      mix,
      duration,
      intervals,
      spec.requireAudio,
    );
    record.metadata = metadata;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(candidate)) hash.update(chunk);
    record.sha256 = hash.digest("hex");
    // Keep the previous deliverable intact until all checks have passed.
    fs.renameSync(candidate, path.join(output, "video.mp4"));
    record.passed = true;
    log("render_delivery passed");
    return record;
  } catch (e) {
    record.error = e.message;
    log(`render_delivery failed: ${e.message}`);
    throw e;
  } finally {
    try {
      if (browser) await browser.close({ silent: true });
    } finally {
      process.chdir(previousCwd);
      record.completedAt = new Date().toISOString();
      const report = path.join(output, ".render-delivery-report.tmp");
      fs.writeFileSync(report, JSON.stringify(record, null, 2));
      fs.renameSync(report, path.join(job, "render-delivery.json"));
      fs.closeSync(lock);
      fs.unlinkSync(path.join(output, ".render-delivery.lock"));
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "job-dir": { type: "string" },
        "browser-executable": { type: "string" },
        concurrency: { type: "string", default: "4" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      console.log(
        "node tools/render_delivery.mjs --job-dir JOB [--browser-executable PATH] [--concurrency 4]\nFull v1 SDR Remotion export; reads project-manifest.json and task/timeline.json. No TTS.",
      );
    } else {
      const concurrency = Number(values.concurrency);
      if (
        !values["job-dir"] ||
        !Number.isInteger(concurrency) ||
        concurrency < 1
      )
        throw new Error("Provide --job-dir and positive integer concurrency");
      const r = await renderDelivery({
        jobDir: values["job-dir"],
        browserExecutable: values["browser-executable"],
        concurrency,
      });
      console.log(
        JSON.stringify({
          passed: r.passed,
          artifact: "output/video.mp4",
          sha256: r.sha256,
        }),
      );
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
