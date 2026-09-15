/** Deterministic checks for the SDR H.264 + AAC delivery profile. */
import { execFileSync } from "node:child_process";

export function command(bin, args, options = {}) {
  return execFileSync(bin, args, {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 600000,
    ...options,
  });
}

export function probe(file) {
  return JSON.parse(
    command("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ]),
  );
}

export function assertDelivery(metadata, spec) {
  const videos = metadata.streams.filter((s) => s.codec_type === "video");
  const audios = metadata.streams.filter((s) => s.codec_type === "audio");
  const v = videos[0];
  if (
    videos.length !== 1 ||
    v.codec_name !== "h264" ||
    v.pix_fmt !== "yuv420p" ||
    v.color_range !== "tv" ||
    v.color_space !== "bt709"
  )
    throw new Error("Expected H.264 yuv420p, limited-range BT.709");
  if (v.width !== spec.width || v.height !== spec.height)
    throw new Error("Resolution mismatch");
  const [n, d] = v.avg_frame_rate.split("/").map(Number);
  if (!Number.isFinite(n / d) || Math.abs(n / d - spec.fps) > 0.001)
    throw new Error("Frame rate mismatch");
  if (Number(v.nb_frames) !== spec.totalFrames)
    throw new Error("Frame count mismatch");
  const expected = spec.totalFrames / spec.fps;
  if (
    !Number.isFinite(Number(v.duration)) ||
    Math.abs(Number(v.duration) - expected) > Math.max(0.002, 1 / spec.fps)
  )
    throw new Error("Video duration mismatch");
  if (audios.length !== 1 || audios[0].codec_name !== "aac")
    throw new Error("Expected one AAC mix");
  if (
    !Number.isFinite(Number(audios[0].duration)) ||
    Math.abs(Number(audios[0].duration) - expected) > 0.03
  )
    throw new Error("Audio duration mismatch");
}

function samples(file, start, duration) {
  const raw = command("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-ss",
    String(start),
    "-i",
    file,
    "-t",
    String(duration),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "8000",
    "-f",
    "f32le",
    "-",
  ]);
  return Float32Array.from({ length: raw.length / 4 }, (_, i) =>
    raw.readFloatLE(i * 4),
  );
}

/** Compare a bounded reference window against +/-80ms; do not load a whole film. */
export function correlate(reference, decoded, expectedIndex) {
  let refEnergy = 0;
  for (const x of reference) refEnergy += x * x;
  if (refEnergy / reference.length < 1e-8) return { status: "silent" };
  const energy = new Float64Array(decoded.length + 1);
  for (let i = 0; i < decoded.length; i++)
    energy[i + 1] = energy[i] + decoded[i] ** 2;
  let best = -Infinity,
    bestIndex = 0;
  for (let k = 0; k + reference.length <= decoded.length; k++) {
    let dot = 0;
    for (let i = 0; i < reference.length; i++)
      dot += reference[i] * decoded[k + i];
    const score =
      dot /
      Math.sqrt(
        refEnergy * Math.max(1e-20, energy[k + reference.length] - energy[k]),
      );
    if (score > best) {
      best = score;
      bestIndex = k;
    }
  }
  return {
    status: "measured",
    correlation: best,
    offsetMs: (bestIndex - expectedIndex) / 8,
  };
}

export function verifyMix(
  video,
  reference,
  duration,
  audioIntervals = [],
  requireAudio = true,
) {
  const width = Math.min(0.5, duration / 3);
  const starts = [
    duration * 0.15,
    duration * 0.5,
    duration * 0.85,
    ...audioIntervals.map(([start, end]) => (start + end) / 2),
  ];
  // Spread a bounded sample over the entire timeline, including late dialogue.
  const unique = [
    ...new Set(
      starts.map(
        (s) =>
          Math.round(
            Math.max(0, Math.min(duration - width, s - width / 2)) * 8000,
          ) / 8000,
      ),
    ),
  ].sort((a, b) => a - b);
  const selected =
    unique.length <= 12
      ? unique
      : Array.from(
          { length: 12 },
          (_, i) => unique[Math.round((i * (unique.length - 1)) / 11)],
        );
  const windows = selected.map((start) => {
    const left = Math.max(0, start - 0.08);
    const right = Math.min(duration, start + width + 0.08);
    const result = correlate(
      samples(reference, start, width),
      samples(video, left, right - left),
      Math.round((start - left) * 8000),
    );
    return { startSec: start, ...result };
  });
  const measured = windows.filter((w) => w.status === "measured");
  if (measured.some((w) => w.correlation < 0.9 || Math.abs(w.offsetMs) > 2))
    throw new Error(`Audio alignment failed: ${JSON.stringify(windows)}`);
  if (!measured.length && requireAudio)
    throw new Error("Audio alignment inconclusive: sampled mix is silent");
  return {
    status: measured.length ? "passed" : "silent",
    sampleRate: 8000,
    toleranceMs: 2,
    windows,
  };
}
