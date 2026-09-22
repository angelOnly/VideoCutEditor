"""批次控制协议回归；此处不冒充真实浏览器或真实代理验收。"""
import os
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace
from unittest.mock import patch
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from test_two_stage import Fixture
from two_stage import StageError, read, write
from render_batch import freeze_batch, render_batch
import stage_media


class BatchTests(Fixture):
    def setUp(self):
        super().setUp()
        render = self.render_request()
        project = self.job/'project'; project.mkdir(); (project/'index.js').write_text('frozen')
        modules = self.base/'modules'
        for name in ('remotion', '@remotion/renderer', '@remotion/bundler'):
            write(modules/name/'package.json', {'version': 'test'})
        browser = self.base/'browser'; browser.write_text('test-browser')
        self.scenes = [{'sceneId': 'scene_1', 'composition': 'One', 'frames': 10},
                       {'sceneId': 'scene_2', 'composition': 'Two', 'frames': 20}]
        write(self.job/'scenes.json', self.scenes)
        self.args = SimpleNamespace(request=render, batch='batch_1', project='project', entry='project/index.js',
             scenes='scenes.json', modules=str(modules), browser=str(browser), node=sys.executable, slots=2)
        frozen = freeze_batch(self.args); self.args.manifest = frozen['manifest']
        self.dir = (self.job / self.args.manifest).parent

    def build(self, argv, cwd, log, done, timeout):
        config = read(Path(done).parent/'config.json')
        bundle = Path(config['bundle']); bundle.mkdir(); (bundle/'index.html').write_text('bundle')
        write(done, {'ok': True})
        return {}

    def test_out_of_order_results_have_one_writer_and_confirmed_order(self):
        active = []; peak = []; lock = threading.Lock(); barrier = threading.Barrier(2)
        def render(*args, **kwargs):
            with lock: active.append(args[1]); peak.append(len(active))
            barrier.wait(timeout=5)
            time.sleep(.08 if args[1] == 'scene_1' else .02)
            with lock: active.remove(args[1])
            return {'path': args[1] + '.mp4', 'reused': False}
        with patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', side_effect=render):
            result = render_batch(self.args)
        self.assertEqual(max(peak), 2)
        self.assertEqual([r['sceneId'] for r in result['results']], ['scene_1', 'scene_2'])
        self.assertEqual(len(list((self.dir/'results').glob('*/*.json'))), 2)
        self.assertEqual(len(read(self.dir/'progress.json')['results']), 2)

    def test_changes_invalidate_without_relabeling(self):
        (self.job/'project/index.js').write_text('new-version')
        with self.assertRaises(StageError) as error: render_batch(self.args)
        self.assertEqual(error.exception.code, 'TIMELINE_STALE')
        with self.assertRaises(StageError): freeze_batch(self.args)

    def test_single_failure_keeps_other_result_and_bundle(self):
        def render(*args, **kwargs):
            if args[1] == 'scene_2': raise StageError('RENDER_FAILED', 'injected')
            return {'path': 'scene_1.mp4', 'reused': False}
        with patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', side_effect=render):
            with self.assertRaises(StageError): render_batch(self.args)
        self.assertEqual(len(read(self.dir/'progress.json')['results']), 1)
        with patch('stage_media.supervise', side_effect=AssertionError('不能重复打包')), patch('stage_media.render_scene', return_value={'reused': True}):
            result = render_batch(self.args)
        self.assertTrue(result['metrics']['bundleReused'])

    def test_cancel_stops_real_child_process(self):
        cancel = self.base/'cancel'
        timer = threading.Timer(.15, lambda: cancel.touch()); timer.start()
        def render(*args, **kwargs):
            return stage_media.command([sys.executable, '-c', 'import time; time.sleep(30)'])
        began = time.monotonic()
        try:
            with patch.dict(os.environ, {'VIDEOCUT_BATCH_CANCEL_FILE': str(cancel)}), patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', side_effect=render):
                with self.assertRaises(StageError): render_batch(self.args)
        finally: timer.join()
        self.assertLess(time.monotonic()-began, 3)

    def test_duplicate_scene_rejected(self):
        write(self.job/'scenes.json', [self.scenes[0], self.scenes[0]])
        with self.assertRaises(StageError): freeze_batch(self.args)


if __name__ == '__main__': unittest.main()
