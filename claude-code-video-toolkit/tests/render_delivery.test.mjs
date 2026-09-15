import test from "node:test";
import assert from "node:assert/strict";
import { correlate, assertDelivery } from "../tools/media_delivery.mjs";
import { validateSpec } from "../tools/render_delivery.mjs";

function signal(n) {
  let s = 123;
  return Float32Array.from({ length: n }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 2 ** 32 - 0.5) * 0.2;
  });
}
test("correlation detects 43ms delay, rather than accepting stream timestamps", () => {
  const ref = signal(4000),
    window = new Float32Array(5280);
  window.set(ref, 640 + 344);
  const r = correlate(ref, window, 640);
  assert.equal(r.offsetMs, 43);
  assert.ok(r.correlation > 0.99);
});
test("silence is not reported as measured alignment", () =>
  assert.equal(
    correlate(new Float32Array(50), new Float32Array(100), 10).status,
    "silent",
  ));
test("SDR gate rejects full range and wrong duration", () => {
  const spec = { width: 320, height: 180, fps: 30, totalFrames: 90 };
  const m = {
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        pix_fmt: "yuv420p",
        color_range: "tv",
        color_space: "bt709",
        width: 320,
        height: 180,
        avg_frame_rate: "30/1",
        nb_frames: "90",
        duration: "3",
      },
      { codec_type: "audio", codec_name: "aac", duration: "3" },
    ],
  };
  assert.doesNotThrow(() => assertDelivery(m, spec));
  m.streams[0].color_range = "pc";
  assert.throws(() => assertDelivery(m, spec), /limited/);
  m.streams[0].color_range = "tv";
  m.streams[1].duration = "3.05";
  assert.throws(() => assertDelivery(m, spec), /Audio duration/);
});
test("uses task fps, rejects v2 and composition mismatch", () => {
  const t = {
    schemaVersion: 1,
    mode: "auto",
    output: { width: 320, height: 180, fps: 25, requireAudio: true },
  };
  const line = { fps: 25, totalFrames: 100, durationSec: 4 };
  assert.equal(validateSpec(t, line).totalFrames, 100);
  assert.throws(() => validateSpec({ ...t, schemaVersion: 2 }, line), /v1/);
  assert.throws(
    () =>
      validateSpec(t, line, {
        width: 320,
        height: 180,
        fps: 30,
        durationInFrames: 100,
      }),
    /Composition/,
  );
});
