import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { HostProcesses } from '../src/infrastructure/host-processes.js';
import { config } from './helpers.js';

test(
  'Ubuntu native cgroup: readonly input, hidden sibling/credentials, no detached children and confirmed cancellation',
  {
    skip: process.env.RUN_HOST_TESTS !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'videocut-native-'));
    const c = config({
      executor: 'host',
      python: path.resolve('.venv/bin/python3'),
      hostBrowser: '/usr/bin/true',
    });
    const processes = new HostProcesses(c);
    const w: any = { root: path.join(root, 'one') },
      id = randomUUID();
    try {
      await processes.preflight();
      for (const d of ['input', 'output', 'project', 'cache'])
        await mkdir(path.join(w.root, d), { recursive: true });
      await writeFile(path.join(w.root, 'input/source.txt'), 'original');
      const other = path.join(root, 'another-task');
      await writeFile(other, 'private');
      const out = await processes.run(
        id,
        w,
        [
          c.python,
          '-c',
          `import pathlib,sys,os
assert not pathlib.Path(sys.argv[1]).exists()
assert not pathlib.Path('/run/user').exists()
assert not os.environ.get('POSTGRES_PASSWORD')
try: pathlib.Path('input/source.txt').write_text('changed')
except OSError: pass
else: raise RuntimeError('input writable')
pathlib.Path('output/probe').write_text('passed')
print('ok')`,
          other,
        ],
        new AbortController().signal,
        'agent',
      );
      assert.match(out, /ok/);
      await processes.run(
        id,
        w,
        [
          '/bin/bash',
          '-c',
          "setsid /bin/bash -c 'sleep 2; echo escaped > output/escaped' >/dev/null 2>&1 & echo finished",
        ],
        new AbortController().signal,
        'agent',
      );
      await setTimeout(2500);
      await assert.rejects(access(path.join(w.root, 'output/escaped')));
      const abort = new AbortController();
      const running = processes.run(
        id,
        w,
        ['/bin/bash', '-c', 'echo started > output/started; sleep 60'],
        abort.signal,
        'agent',
      );
      void running.catch(() => {});
      for (let i = 0; i < 100; i++) {
        try {
          await access(path.join(w.root, 'output/started'));
          break;
        } catch {
          await setTimeout(50);
        }
      }
      await access(path.join(w.root, 'output/started'));
      abort.abort();
      await assert.rejects(running);
      await processes.stop(id);
    } finally {
      await processes.stop(id);
      await rm(root, { recursive: true, force: true });
    }
  },
);
