/** Opt-in real Remotion/FFmpeg regression; all inputs synthesized locally, no TTS. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { renderDelivery } from "../tools/render_delivery.mjs";
import { command, probe, verifyMix } from "../tools/media_delivery.mjs";

const enabled = process.env.RUN_REMOTION_MEDIA_TESTS === "1";
const deps = process.env.REMOTION_TEST_NODE_MODULES;
const browserExecutable = process.env.REMOTION_TEST_BROWSER;

test(
  "real exports retain color, frame count, trims, fades and mixed audio at different rates",
  { skip: !enabled, timeout: 600000 },
  async () => {
    assert.ok(
      deps,
      "Set REMOTION_TEST_NODE_MODULES to installed Remotion dependencies",
    );
    const root = fs.mkdtempSync(
      path.join(
        process.env.REMOTION_TEST_TMPDIR || os.tmpdir(),
        "delivery-regression-",
      ),
    );
    console.log(`Test artifacts: ${root}`);
    for (const [fps, sampleRate, frames] of [
      [24, 24000, 72],
      [25, 44100, 75],
      [30, 48000, 90],
      [30000 / 1001, 24000, 90],
      [30, 48000, 1860],
    ]) {
      const job = path.join(root, `${fps}-${sampleRate}-${frames}`),
        project = path.join(job, "project");
      fs.mkdirSync(path.join(project, "public"), { recursive: true });
      fs.mkdirSync(path.join(project, "src"));
      fs.symlinkSync(
        path.resolve(deps),
        path.join(project, "node_modules"),
        "dir",
      );
      fs.writeFileSync(path.join(project, "package.json"), "{}");
      // Broadband, changing signal makes a fixed delay detectable (unlike a pure sine).
      command("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=color=pink:amplitude=0.1:sample_rate=${sampleRate}:duration=5:seed=713`,
        "-ac",
        "2",
        path.join(project, "public", "voice.wav"),
      ]);
      command("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=color=white:amplitude=0.05:sample_rate=44100:duration=5:seed=47`,
        "-ac",
        "1",
        path.join(project, "public", "effect.wav"),
      ]);
      const source = `import React from 'react';import {registerRoot,Composition,AbsoluteFill,Sequence,Audio,staticFile,useCurrentFrame} from 'remotion';
const Film=()=>{const f=useCurrentFrame();return <AbsoluteFill style={{background:f<30?'#124b80':'#a34716'}}><Sequence from={5}><Audio src={staticFile('voice.wav')} trimBefore={3} volume={f=>Math.min(.8,f/12)}/></Sequence><Sequence from={20}><Audio src={staticFile('effect.wav')} volume={.25}/></Sequence><Sequence from={${frames - 30}}><Audio src={staticFile('effect.wav')} volume={.3}/></Sequence></AbsoluteFill>};
registerRoot(()=> <Composition id="Regression" component={Film} width={320} height={180} fps={${fps}} durationInFrames={${frames}}/>);`;
      fs.writeFileSync(path.join(project, "src", "index.tsx"), source);
      const identity = { schemaVersion: 1, jobId: "regression" };
      fs.writeFileSync(
        path.join(job, "task.json"),
        JSON.stringify({
          ...identity,
          mode: "auto",
          output: { width: 320, height: 180, fps, requireAudio: true },
        }),
      );
      fs.writeFileSync(
        path.join(job, "timeline.json"),
        JSON.stringify({
          ...identity,
          fps,
          totalFrames: frames,
          durationSec: frames / fps,
          audio: [
            { startFrame: 5, endFrame: Math.min(frames, 140) },
            { startFrame: frames - 30, endFrame: frames },
          ],
        }),
      );
      fs.writeFileSync(
        path.join(job, "project-manifest.json"),
        JSON.stringify({
          ...identity,
          projectPath: "project",
          entry: "project/src/index.tsx",
          compositionId: "Regression",
          renderProfile: "sdr-bt709-pcm",
        }),
      );
      const result = await renderDelivery({
        jobDir: job,
        browserExecutable,
        concurrency: 2,
      });
      assert.ok(result.passed);
      assert.equal(result.audioAlignment.status, "passed");
      const final = path.join(job, "output/video.mp4");
      assert.equal(probe(final).streams[0].nb_frames, String(frames));
      // A second mux from the saved mix must not silently pass a 43ms offset.
      if (fps === 30) {
        const delayed = path.join(job, "delayed.mp4"),
          mix = path.join(job, result.workDirectory, "mix.wav");
        command("ffmpeg", [
          "-nostdin",
          "-v",
          "error",
          "-i",
          final,
          "-i",
          mix,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "copy",
          "-af",
          "adelay=43:all=1",
          "-c:a",
          "aac",
          "-t",
          String(frames / fps),
          delayed,
        ]);
        assert.throws(
          () => verifyMix(delayed, mix, frames / fps, [[0.5, 2.5]], true),
          /Audio alignment/,
        );
        // Mismatched replacement must fail and preserve the prior good candidate.
        const before = fs.readFileSync(final);
        const task = JSON.parse(fs.readFileSync(path.join(job, "task.json")));
        task.output.width = 322;
        fs.writeFileSync(path.join(job, "task.json"), JSON.stringify(task));
        await assert.rejects(
          renderDelivery({ jobDir: job, browserExecutable, concurrency: 2 }),
          /Composition/,
        );
        assert.deepEqual(fs.readFileSync(final), before);
      }
      console.log(
        `PASS fps=${fps} inputSampleRate=${sampleRate} frames=${frames}`,
      );
    }
  },
);
