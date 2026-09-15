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
    if (c.executionProtocol === 'video-two-stage/1') {
      const stage = {
        ...w,
        task: { contractVersion: 'video-two-stage/1', stage: 'analysis', runId: id },
      } as Workspace;
      await mkdir(path.join(root, 'analysis/work'), { recursive: true });
      await mkdir(path.join(root, 'tool-audio'), { recursive: true });
      for (const f of ['analysis/request.json', '.execution.lock', '.operation.lock'])
        await writeFile(path.join(root, f), '{}');
      await processes.run(
        id,
        stage,
        [
          c.python,
          '-c',
          `import pathlib,sys;sys.path.insert(0,sys.argv[2]);import worker_stage,two_stage,jsonschema
r=pathlib.Path(sys.argv[1]); assert two_stage.SCHEMA.is_file()
(r/'analysis/result.json').write_text('{}')
try: (r/'analysis/request.json').write_text('changed')
except OSError: pass
else: raise RuntimeError('阶段请求可写')
print('two-stage isolation passed')`,
          root,
          path.join(c.toolkitRoot, 'tools'),
        ],
        new AbortController().signal,
        'agent',
      );
    }
    await processes.run(
      id,
      w,
      [c.hostBrowser, '--no-sandbox', '--version'],
      new AbortController().signal,
      'agent',
    );
    for (const binary of ['ffmpeg', 'ffprobe'])
      await processes.run(id, w, [binary, '-version'], new AbortController().signal, 'agent');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (
      /Failed RTM_NEWADDR|No permissions to create new namespace|Creating new namespace failed/.test(
        message,
      )
    ) {
      throw new Error(
        'HOST_NAMESPACE_DENIED: Ubuntu rejected Bubblewrap namespace setup. Worker was not started. ' +
          'Check AppArmor/kernel denials with: sudo journalctl -k --since "30 minutes ago" --no-pager. ' +
          'Configure the distribution Bubblewrap policy if the audit log confirms a denial; keep task isolation enabled.\n' +
          message,
        { cause },
      );
    }
    throw cause;
  } finally {
    try {
      await processes.stop(id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
