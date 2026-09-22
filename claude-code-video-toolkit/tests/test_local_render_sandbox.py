"""真实 macOS Chrome 启动及工程写隔离回归，不调用 TTS。"""
import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from stage_media import render_seatbelt_profile


@unittest.skipUnless(sys.platform == 'darwin' and os.environ.get('RUN_LOCAL_BROWSER_TESTS') == '1', '需本机真实 Chrome')
class LocalSandboxTest(unittest.TestCase):
    def test_browser_and_write_boundary(self):
        node = Path(os.environ['TEST_NODE']).resolve()
        modules = Path(os.environ['TEST_MODULES']).resolve()
        browser = Path(os.environ['TEST_BROWSER']).resolve()
        with tempfile.TemporaryDirectory(prefix='render-sandbox-test-') as folder:
            root = Path(folder).resolve()
            temp = root / 'render'
            temp.mkdir()
            reads = [str(root), str(node.parent), str(modules), str(browser.parents[2]), '/System', '/Library', '/usr', '/bin', '/sbin', '/private/etc', '/dev']
            with patch.dict(os.environ, {'VIDEOCUT_RENDER_READ_PATHS': json.dumps(reads)}):
                profile = render_seatbelt_profile(temp)
            script = """
const fs=require('fs');
fs.writeFileSync(process.argv[3]+'/ok','ok');
let denied=false;try{fs.writeFileSync(process.argv[3]+'/../control','bad')}catch(e){denied=['EPERM','EACCES'].includes(e.code)}
if(!denied)throw Error('工程写越界未阻止');
require(process.argv[1]+'/@remotion/renderer').openBrowser('chrome',{browserExecutable:process.argv[2],logLevel:'error'})
.then(async b=>{console.log('browser_opened');await b.close({silent:true});console.log('browser_ready_and_isolated')}).catch(e=>{console.error(e);process.exitCode=1});
"""
            process = subprocess.Popen(['/usr/bin/sandbox-exec', '-p', profile, str(node), '-e', script, str(modules), str(browser), str(temp)],
                                       env={**os.environ, 'HOME': str(temp), 'TMPDIR': str(temp)}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
            try:
                stdout, stderr = process.communicate(timeout=45)
                self.assertEqual(process.returncode, 0, stderr)
                self.assertIn('browser_ready_and_isolated', stdout)
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
            self.assertFalse((root/'control').exists())
