import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import type { Config } from '../config.js';
import { AppServer } from './app-server.js';
import { threadConfig } from '../runner/codex-host.js';
import type { HostProcesses } from './host-processes.js';
// 直接走 app-server 的原生命令权限；不再用旧 video_exec 沙箱冒充验证。
export async function checkNativeIsolation(c: Config, processes?: HostProcesses) {
  await mkdir(c.dataRoot, { recursive: true });
  const dir = await mkdtemp(path.join(c.dataRoot, 'native-check-'));
  const root = path.join(dir, 'task'),
    id = randomUUID(),
    rpc = new AppServer();
  try {
    for (const d of ['input', 'output', 'project', 'work', 'cache'])
      await mkdir(path.join(root, d), { recursive: true });
    const forbidden = path.join(dir, 'other-task.txt');
    await writeFile(forbidden, 'private-sentinel');
    await writeFile(path.join(root, 'input/source.txt'), 'immutable');
    const w: any = { root, task: { stage: 'render' } };
    await rpc.start(c, processes ? id : undefined, threadConfig(c, w));
    const python = `import os,pathlib,sys
assert not os.environ.get('POSTGRES_PASSWORD') and not os.environ.get('DATABASE_URL')
for name in sys.argv[1:]:
 try: pathlib.Path(name).read_text()
 except OSError: pass
 else: raise RuntimeError('禁止路径可读')
try: pathlib.Path('input/source.txt').write_text('changed')
except OSError: pass
else: raise RuntimeError('输入目录可写')
pathlib.Path('output/probe').write_text('ok')
import jsonschema
import socket
import tempfile
with tempfile.TemporaryDirectory() as temporary:
 assert pathlib.Path(temporary).is_relative_to(pathlib.Path.cwd()), '临时目录必须属于当前任务'
socket.getaddrinfo('openspeech.bytedance.com', 443)
print('native isolation passed')`;
    const commands = [
      [c.python, '-c', python, forbidden, path.join(c.codexHome, 'auth.json')],
      [process.execPath, '--version'],
      ['ffmpeg', '-version'],
      ['ffprobe', '-version'],
      [c.hostBrowser, '--version'],
      [
        c.python,
        path.join(c.toolkitRoot, 'tools/stage_media.py'),
        'preflight',
        '--node',
        process.execPath,
        '--modules',
        path.join(c.toolkitRoot, 'templates/ifeng-scenes/node_modules'),
        '--browser',
        c.hostBrowser,
      ],
    ];
    for (const command of commands) {
      const result = await rpc.request('command/exec', {
        command,
        cwd: root,
        permissionProfile: 'videocut',
        timeoutMs: 45000,
        outputBytesCap: 10000,
      });
      if (result.exitCode !== 0)
        throw Error(
          `NATIVE_PREFLIGHT_FAILED: ${path.basename(command[0])}: ${result.stderr ?? result.stdout ?? ''}`,
        );
    }
  } finally {
    await rpc.close();
    if (processes) await processes.stop(id);
    await rm(dir, { recursive: true, force: true });
  }
}
