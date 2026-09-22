"""只用模拟渲染器和 sleep 进程测试退出协议，不启动 Chrome 或媒体编码。"""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools'))
import stage_media as media
from two_stage import StageError, read, active_processes, process_signature

NODE = os.environ.get('VIDEOCUT_TEST_NODE') or shutil.which('node') or '/Users/jiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def test_cancel_collects_detached_child_and_records_its_group(self):
        pid_file = self.root/'detached.pid'
        code = 'import subprocess,sys,time; from pathlib import Path; child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"],start_new_session=True);Path(sys.argv[1]).write_text(str(child.pid));time.sleep(30)'
        cancelled = threading.Event()
        timer = threading.Timer(.8, cancelled.set); timer.start()
        def check():
            if cancelled.is_set(): raise StageError('TASK_CANCELLED', '轻量取消测试')
        media._BATCH_CONTEXT.check = check
        try:
            with self.assertRaises(StageError) as error:
                media.supervise([sys.executable, '-c', code, str(pid_file)], self.root,
                    self.root/'scene.log', self.root/'done.json', 30)
            self.assertEqual(error.exception.code, 'TASK_CANCELLED')
            pid = int(pid_file.read_text())
            record = read(self.root/f'scene.owned-{pid}.process.json')
            self.assertEqual(record['state'], 'ended')
            result = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='], capture_output=True, text=True)
            self.assertTrue(result.returncode != 0 or result.stdout.strip().startswith('Z'))
        finally:
            media._BATCH_CONTEXT.check = None; timer.cancel(); timer.join()
            if pid_file.exists():
                try: os.kill(int(pid_file.read_text()), signal.SIGKILL)
                except ProcessLookupError: pass

    def test_sigkill_supervisor_leaves_detached_group_record_for_recovery(self):
        work = self.root/'render/run/work'; work.mkdir(parents=True)
        child_code = 'import subprocess,sys,time;subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"],start_new_session=True);time.sleep(30)'
        supervisor_code = 'from pathlib import Path;import sys;sys.path.insert(0,sys.argv[1]);from stage_media import supervise;work=Path(sys.argv[2]);supervise([sys.executable,"-c",sys.argv[3]],work,work/"scene.log",work/"done.json",30)'
        host = subprocess.Popen([sys.executable, '-c', supervisor_code, str(Path(media.__file__).parent), str(work), child_code], start_new_session=True)
        records = []
        try:
            deadline = time.monotonic()+5
            while time.monotonic() < deadline and not list(work.glob('scene.owned-*.process.json')): time.sleep(.02)
            self.assertTrue(list(work.glob('scene.owned-*.process.json')))
            records = [read(p) for p in work.glob('*.process.json')]
            host.kill(); host.wait(timeout=3)
            active = active_processes(self.root)
            self.assertEqual({r['pid'] for r in records}, {r['pid'] for r in active})
        finally:
            if host.poll() is None: host.kill(); host.wait()
            for record in records:
                if process_signature(record['pid']) == record['signature']:
                    try: os.kill(record['pid'], signal.SIGKILL)
                    except ProcessLookupError: pass

    def test_mixed_group_uses_only_revalidated_owned_pid(self):
        tree = media.OwnedProcessTree(900001, 'owned', self.root/'test.log')
        tree.known[900001] = {'identity': ('start',), 'pgid': 1, 'signature': 'owned'}
        owned = {'pid': 900001, 'ppid': 1, 'pgid': 1, 'identity': ('start',)}
        with patch.object(tree, 'scan', return_value=[owned]), patch('stage_media.process_signature', return_value='owned'), patch('stage_media.os.kill') as kill, patch('stage_media.os.killpg', side_effect=AssertionError('禁止整组发送')):
            tree.signal_owned(signal.SIGTERM)
        kill.assert_called_once_with(900001, signal.SIGTERM)
        with patch.object(tree, 'scan', return_value=[owned]), patch('stage_media.process_signature', return_value='reused'), patch('stage_media.os.kill') as kill:
            tree.signal_owned(signal.SIGKILL)
        kill.assert_not_called()

    def run_fake_renderer(self, opening_delay):
        modules = self.root/'modules'; events = self.root/'events'
        bundler = modules/'@remotion/bundler'; bundler.mkdir(parents=True)
        (bundler/'index.js').write_text('exports.bundle=async()=>"fake-bundle";')
        renderer = modules/'@remotion/renderer'; renderer.mkdir(parents=True)
        (renderer/'index.js').write_text('''
const fs=require('node:fs'); const events=EVENTS;
const record=(s)=>fs.appendFileSync(events,s+'\\n');
let timer; let resolveRender;
exports.openBrowser=async()=>{record('opening'); await new Promise(r=>setTimeout(r,DELAY)); record('opened'); return {close:async()=>{record('closing'); clearTimeout(timer); if(resolveRender)resolveRender(); await new Promise(r=>setTimeout(r,50));record('closed');}};};
exports.selectComposition=async()=>({durationInFrames:1,fps:1,width:1,height:1});
exports.renderMedia=()=>new Promise(r=>{resolveRender=r;timer=setTimeout(r,30000);record('rendering');});
'''.replace('EVENTS', json.dumps(str(events))).replace('DELAY', str(opening_delay)))
        config = {'modules': str(modules), 'serveUrl': 'fake-bundle', 'browser': 'unused', 'composition': 'fake',
                  'props': {}, 'frames': 1, 'spec': {'fps': 1, 'width': 1, 'height': 1}, 'done': str(self.root/'done.json')}
        config_path = self.root/'config.json'; config_path.write_text(json.dumps(config))
        child = subprocess.Popen([NODE, str(Path(media.__file__).with_name('render_scene.cjs')), str(config_path)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic()+5
            required = 'opening' if opening_delay else 'rendering'
            while time.monotonic() < deadline and (not events.exists() or required not in events.read_text()): time.sleep(.01)
            self.assertIn(required, events.read_text())
            child.send_signal(signal.SIGTERM)
            time.sleep(.01)
            if child.poll() is None: child.send_signal(signal.SIGINT)
            stdout, stderr = child.communicate(timeout=7)
            self.assertEqual(child.returncode, 130, stderr)
            self.assertFalse((self.root/'done.json').exists())
            return events.read_text().splitlines()
        finally:
            if child.poll() is None: child.kill()
            child.communicate()

    def test_signal_during_render_closes_browser_once(self):
        events = self.run_fake_renderer(0)
        self.assertEqual(events.count('closing'), 1); self.assertIn('closed', events)

    def test_signal_during_open_waits_for_browser_and_closes_once(self):
        events = self.run_fake_renderer(150)
        self.assertEqual(events.count('closing'), 1); self.assertIn('closed', events)
        self.assertNotIn('rendering', events)

    def test_hung_open_has_bounded_signal_shutdown(self):
        began = time.monotonic()
        events = self.run_fake_renderer(30000)
        self.assertLess(time.monotonic()-began, 7)
        self.assertNotIn('rendering', events)


if __name__ == '__main__': unittest.main()
