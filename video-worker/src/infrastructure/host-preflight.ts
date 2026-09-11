import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import type { Config } from '../config.js';
import type { Workspace } from './workspace.js';
import type { HostProcesses } from './host-processes.js';
export async function checkHostIsolation(c: Config, processes: HostProcesses) {
  await mkdir(c.dataRoot, { recursive: true });
  const dir = await mkdtemp(path.join(c.dataRoot, 'preflight-'));
  const id = randomUUID();
  try {
    const root = path.join(dir, 'task');
    for (const d of ['input', 'output', 'project', 'cache'])
      await mkdir(path.join(root, d), { recursive: true });
    const other = path.join(dir, 'other-task.txt');
    await writeFile(other, 'private-sentinel');
    await writeFile(path.join(root, 'input/source.txt'), 'readonly-input');
    const w = { root } as Workspace;
    const code = `import os,pathlib,sys
root=pathlib.Path(sys.argv[1]); forbidden=pathlib.Path(sys.argv[2]); assert not forbidden.exists()
assert not pathlib.Path(sys.argv[3]).exists()
assert not pathlib.Path('/var/run/docker.sock').exists()
assert not os.environ.get('POSTGRES_PASSWORD') and not os.environ.get('DOUBAO_TTS_API_KEY')
try: (root/'input/source.txt').write_text('changed')
except OSError: pass
else: raise RuntimeError('readonly input was writable')
(root/'output/ok.txt').write_text('ok'); print('isolation passed')`;
    await processes.run(
      id,
      w,
      [c.python, '-c', code, root, other, c.codexHome],
      new AbortController().signal,
      'agent',
    );
    await processes.run(
      id,
      w,
      [c.hostBrowser, '--no-sandbox', '--version'],
      new AbortController().signal,
      'agent',
    );
  } finally {
    try {
      await processes.stop(id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
