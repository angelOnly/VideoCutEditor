"""Linux 实测文件隔离、子进程继承与网络权限保留。"""
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == 'linux', '需要 Linux Landlock')
class LandlockTests(unittest.TestCase):
    def test_files_children_and_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            project, scratch = root/'project', root/'scratch'
            project.mkdir(); scratch.mkdir()
            (project/'input.txt').write_text('允许读取')
            (root/'design.json').write_text('不能参与画面')
            (project/'bypass').symlink_to(root/'design.json')
            server = socket.socket()
            self.addCleanup(server.close)
            server.bind(('127.0.0.1', 0)); server.listen()
            # 子进程也必须继承限制；网络保留原有权限。
            script = scratch/'check.py'
            script.write_text('''import pathlib, socket, subprocess, sys
root = pathlib.Path(sys.argv[1])
assert (root/'project/input.txt').read_text() == '允许读取'
(root/'scratch/result').write_text('正常输出')
for path, mode in [('design.json','r'), ('project/bypass','r'), ('project/input.txt','w')]:
    try:
        with (root/path).open(mode): pass
    except PermissionError: pass
    else: raise AssertionError('未隔离：'+path)
child = subprocess.run([sys.executable, '-c', 'open(sys.argv[1]).read()', str(root/'design.json')], capture_output=True)
assert child.returncode != 0
with socket.create_connection(('127.0.0.1', int(sys.argv[2])), timeout=3): pass
''')
            helper = Path(__file__).resolve().parents[1]/'tools/render_landlock.py'
            config = {'root': str(root), 'readable': [str(project), str(scratch)], 'writable': [str(scratch)]}
            result = subprocess.run([sys.executable, str(helper), json.dumps(config), sys.executable,
                                     str(script), str(root), str(server.getsockname()[1])], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((scratch/'result').read_text(), '正常输出')


if __name__ == '__main__':
    unittest.main()
