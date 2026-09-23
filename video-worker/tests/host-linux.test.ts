import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from './helpers.js';
import { HostProcesses } from '../src/infrastructure/host-processes.js';
import { AppServer } from '../src/infrastructure/app-server.js';
import { checkNativeIsolation } from '../src/infrastructure/native-preflight.js';
import { threadConfig } from '../src/runner/codex-host.js';
test(
  'Linux 原生权限与 cgroup：取消回收脱离子进程且不影响其他任务',
  { skip: process.env.RUN_HOST_TESTS !== '1', timeout: 120000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'native-cgroup-'));
    const c = config({
      dataRoot: root,
      python: path.resolve('.venv/bin/python3'),
      codexPath: path.resolve('node_modules/.bin/codex'),
      codexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
      hostBrowser: process.env.REMOTION_BROWSER_EXECUTABLE ?? '/usr/bin/chromium',
    });
    const processes = new HostProcesses(c),
      one = new AppServer(),
      two = new AppServer(),
      id1 = randomUUID(),
      id2 = randomUUID();
    try {
      await processes.preflight();
      await checkNativeIsolation(c, processes);
      const first = path.join(root, 'one'),
        second = path.join(root, 'two');
      for (const r of [first, second])
        for (const d of ['input', 'output', 'cache'])
          await mkdir(path.join(r, d), { recursive: true });
      await one.start(c, id1, threadConfig(c, { root: first, task: {} } as any));
      await two.start(c, id2, threadConfig(c, { root: second, task: {} } as any));
      const running = one.request('command/exec', {
        command: [
          '/bin/bash',
          '-c',
          "setsid /bin/bash -c 'sleep 3; echo escaped > output/escaped' & echo ready > output/ready; sleep 60",
        ],
        cwd: first,
        permissionProfile: 'videocut',
        timeoutMs: 60000,
      });
      void running.catch(() => {});
      for (let i = 0; i < 100; i++) {
        try {
          await access(path.join(first, 'output/ready'));
          break;
        } catch {
          await setTimeout(50);
        }
      }
      await access(path.join(first, 'output/ready'));
      await processes.stop(id1);
      await assert.rejects(running);
      const live = await two.request('command/exec', {
        command: ['/bin/echo', 'still-running'],
        cwd: second,
        permissionProfile: 'videocut',
        timeoutMs: 10000,
      });
      assert.equal(live.exitCode, 0);
      await setTimeout(3500);
      await assert.rejects(access(path.join(first, 'output/escaped')));
    } finally {
      await one.close();
      await two.close();
      await processes.stop(id1);
      await processes.stop(id2);
      await rm(root, { recursive: true, force: true });
    }
  },
);
