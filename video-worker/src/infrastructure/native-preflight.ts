import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import type { Config } from '../config.js';
import { AppServer } from './app-server.js';
import { threadConfig } from '../runner/codex-host.js';
import type { HostProcesses } from './host-processes.js';
import { productionRoot, productionSkill } from './production-plugin.js';
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
    await productionSkill(rpc, c, root);
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
import dotenv
import requests
import socket
import tempfile
with tempfile.TemporaryDirectory() as temporary:
 assert pathlib.Path(temporary).is_relative_to(pathlib.Path.cwd()), '临时目录必须属于当前任务'
socket.getaddrinfo('openspeech.bytedance.com', 443)
# 在真实 Codex 外层权限内验证媒体读取隔离，避免宿主可用但嵌套失败。
sys.path.insert(0, ${JSON.stringify(path.join(productionRoot(c), 'tools'))})
from render_inputs import isolated_command
import subprocess
root = pathlib.Path.cwd()
(root/'project/render-probe.txt').write_text('render-input')
(root/'work/design.json').write_text('sidecar')
probe = "import pathlib,sys; root=pathlib.Path(sys.argv[1]); assert (root/'project/render-probe.txt').read_text() == 'render-input'; (root/'cache/render-result').write_text('ok');\\ntry: (root/'work/design.json').read_text()\\nexcept PermissionError: pass\\nelse: raise RuntimeError('渲染可读取设计记录')"
command = isolated_command([sys.executable, '-c', probe, str(root)],
 os.environ['VIDEOCUT_RENDER_SANDBOX'], root, root/'project', root/'cache')
result = subprocess.run(command, capture_output=True, text=True)
assert result.returncode == 0, result.stderr
print('native isolation passed')`;
    const commands = [
      [c.python, '-c', python, forbidden, path.join(c.codexHome, 'auth.json')],
      [process.execPath, '--version'],
      ['ffmpeg', '-version'],
      ['ffprobe', '-version'],
      [c.hostBrowser, '--version'],
      [
        c.python,
        path.join(productionRoot(c), 'tools/stage_media.py'),
        'preflight',
        '--node',
        process.execPath,
        '--modules',
        c.renderModules,
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
