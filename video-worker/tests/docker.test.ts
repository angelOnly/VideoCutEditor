import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './helpers.js';
import { DockerSandbox } from '../src/infrastructure/sandbox.js';

test(
  'Ubuntu runner image: dependencies, read-only toolkit and per-task filesystem isolation',
  { skip: process.env.RUN_DOCKER_TESTS !== '1', timeout: 60000 },
  async () => {
    const parent = process.env.DATA_ROOT ?? '/home/ops/jiangzb/video-worker-data';
    await mkdir(parent, { recursive: true });
    const dir = await mkdtemp(path.join(parent, 'docker-test-'));
    await chmod(dir, 0o755);
    const a = path.join(dir, 'a'),
      b = path.join(dir, 'b');
    await mkdir(a);
    await mkdir(b);
    await writeFile(path.join(b, 'secret'), 'not-visible');
    const sandbox = new DockerSandbox(
      config({
        runnerImage: process.env.RUNNER_IMAGE ?? 'videocut-runner:0.1.0',
        dockerUid: process.env.RUNNER_UID ?? '1000:1000',
      }),
    );
    const l: any = { run: { id: randomUUID(), attempt: 1, repair_rounds: 0 } },
      w: any = { root: a };
    try {
      const output = await sandbox.tool(
        l,
        w,
        [
          'python3',
          '-c',
          `import os,jsonschema,requests,subprocess; assert not os.path.exists('${b}/secret'); assert not os.path.exists('/var/run/docker.sock'); assert not os.access('/opt/toolkit/tools/render_segments.py',os.W_OK); assert 'libx264' in subprocess.check_output(['ffmpeg','-encoders'],stderr=subprocess.DEVNULL,text=True); print('isolated')`,
        ],
        new AbortController().signal,
      );
      assert.equal(output.trim(), 'isolated');
    } finally {
      await sandbox.stop(l.run.id);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
