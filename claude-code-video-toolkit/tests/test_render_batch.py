"""批次控制协议回归；此处不冒充真实浏览器或真实代理验收。"""
import os
from pathlib import Path
import sys
import signal
import subprocess
import threading
import time
from types import SimpleNamespace
from unittest.mock import patch
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from test_two_stage import Fixture
from two_stage import StageError, read, write, json_digest, active_processes, digest
from render_batch import freeze_batch, render_batch
import stage_media
import render_batch as batch_module


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
        (project/'public').mkdir()
        (project/'public/audio.wav').write_bytes(b'test-audio-source')
        timeline = {'fps': 10, 'scenes': []}
        offset = 0
        for scene, confirmed in zip(self.scenes, self.plan['scenes']):
            count = scene['frames']
            timeline['scenes'].append({'id': scene['sceneId'], 'startFrame': offset, 'endFrameExclusive': offset+count,
                'utterances': [{'id': 'u', 'text': confirmed['text'], 'startFrame': 0, 'endFrameExclusive': count,
                    'audioPath': 'project/public/audio.wav', 'src': 'audio.wav'}],
                'captions': [{'text': confirmed['text'], 'startFrame': 0, 'endFrameExclusive': count}],
                'visualDesign': [{'id': 'd', 'utteranceIds': ['u'], 'mode': 'hold', 'description': '测试保持', 'implementation': 'project/index.js'}]})
            offset += count
        write(render.parent/'timeline.json', timeline)
        frozen = freeze_batch(self.args); self.args.manifest = frozen['manifest']
        self.dir = (self.job / self.args.manifest).parent

    def test_no_preview_required(self):
        self.assertFalse((self.args.request.parent/'preflight-review.json').exists())
        with patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', return_value={'reused': False}):
            self.assertEqual(len(render_batch(self.args)['results']), 2)

    def test_landlock_reaches_batch_build(self):
        # 覆盖批次入口的模式检查，不能只验证冻结步骤或隔离辅助函数。
        with patch.dict(os.environ, {'VIDEOCUT_RENDER_SANDBOX': 'landlock'}), patch('stage_media.supervise', side_effect=self.build) as build, patch('stage_media.render_scene', return_value={'reused': False}):
            self.assertEqual(len(render_batch(self.args)['results']), 2)
            self.assertTrue(build.called)
            self.assertIn('render_landlock.py', build.call_args.args[0][1])

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
            return stage_media.command([sys.executable, '-c', 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"]); time.sleep(30)'])
        began = time.monotonic()
        try:
            with patch.dict(os.environ, {'VIDEOCUT_BATCH_CANCEL_FILE': str(cancel), 'VIDEOCUT_RENDER_SANDBOX': 'native'}), patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', side_effect=render):
                with self.assertRaises(StageError): render_batch(self.args)
        finally: timer.join()
        self.assertLess(time.monotonic()-began, 3)
        records = [read(p) for p in (self.args.request.parent/'work').glob('batch-media-*.process.json')]
        self.assertTrue(records)
        self.assertTrue(all(r['state'] == 'ended' for r in records))
        groups = {r['pid'] for r in records}
        rows = subprocess.check_output(['ps', '-axo', 'pgid=,stat='], text=True).splitlines()
        self.assertFalse(any(int(row.split()[0]) in groups and not row.split()[1].startswith('Z') for row in rows if row.strip()))

    def test_input_change_during_render_is_not_published(self):
        def render(*args, **kwargs):
            (self.job/'project/index.js').write_text('changed-during-render')
            return {'path': 'untrusted.mp4', 'reused': False}
        self.args.slots = 1
        with patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', side_effect=render):
            with self.assertRaises(StageError) as error: render_batch(self.args)
        self.assertEqual(error.exception.code, 'TIMELINE_STALE')
        self.assertEqual(read(self.dir/'progress.json')['results'], [])

    def test_self_hashed_invalid_manifest_cannot_bypass_freeze(self):
        original = read(self.job/self.args.manifest)
        for scenes in ([self.scenes[0], self.scenes[0]],
                       [{**self.scenes[0], 'sceneId': 'scene_unknown'}], list(reversed(self.scenes))):
            tampered = {**original, 'scenes': scenes}
            tampered['version'] = json_digest({k: v for k, v in tampered.items() if k != 'version'})
            write(self.job/self.args.manifest, tampered)
            with self.assertRaises(StageError): render_batch(self.args)

    def test_runtime_code_change_with_same_package_version_invalidates(self):
        (Path(self.args.modules)/'remotion/runtime.js').write_text('modified-with-same-version')
        with self.assertRaises(StageError) as error: render_batch(self.args)
        self.assertEqual(error.exception.code, 'TIMELINE_STALE')

    def test_timeline_adapters_are_part_of_frozen_tool_inputs(self):
        tools = self.base / 'toolkit/tools'; tools.mkdir(parents=True)
        names = ('render_batch.py', 'stage_media.py', 'render_scene.cjs', 'two_stage.py', 'actual_timeline.py', 'finance_timeline.py', 'production_contract.py', 'render_inputs.py', 'render_landlock.py')
        for name in names:
            (tools / name).write_text('固定版本')
        # 用隔离副本模拟工具发布，不改正在并行开发的实际共享文件。
        with patch.object(batch_module, '__file__', str(tools / 'render_batch.py')):
            for index, name in enumerate(('actual_timeline.py', 'finance_timeline.py')):
                self.args.batch = f'adapter_{index}'
                frozen = freeze_batch(self.args)
                manifest = read(self.job / frozen['manifest'])
                (tools / name).write_text('新版本')
                with self.assertRaises(StageError) as error:
                    batch_module.verify_manifest(self.job, self.args.request, read(self.args.request), manifest,
                                                 self.args.modules, self.args.browser)
                self.assertEqual(error.exception.code, 'TIMELINE_STALE')

    def test_sigkill_parent_keeps_live_group_visible_for_recovery(self):
        work = self.args.request.parent/'work'; work.mkdir(exist_ok=True)
        script = "from pathlib import Path; import sys; sys.path.insert(0, sys.argv[1]); from stage_media import supervise; supervise([sys.executable,'-c','import time; time.sleep(30)'],Path(sys.argv[2]),Path(sys.argv[2])/'orphan.log',Path(sys.argv[2])/'done',60)"
        parent = subprocess.Popen([sys.executable, '-c', script, str(Path(stage_media.__file__).parent), str(work)], start_new_session=True)
        record = work/'orphan.process.json'
        pid = None
        try:
            deadline = time.monotonic()+5
            while not record.exists() and time.monotonic() < deadline: time.sleep(.02)
            pid = read(record)['pid']
            parent.kill(); parent.wait(timeout=5)
            self.assertIn(pid, [p['pid'] for p in active_processes(self.job)])
        finally:
            if parent.poll() is None: parent.kill(); parent.wait()
            if pid:
                try: os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError: pass

    @unittest.skipUnless(sys.platform == 'darwin', '本项验证真实 macOS Seatbelt')
    def test_bundle_and_source_are_read_only_in_real_sandbox(self):
        scratch = self.base/'sandbox'; scratch.mkdir()
        bundle = self.base/'readonly-bundle'; bundle.mkdir(); (bundle/'index.html').write_text('frozen')
        code = "from pathlib import Path; import sys; failures=0\nfor name in sys.argv[1:3]:\n try: Path(name).write_text('forbidden')\n except PermissionError: failures+=1\nPath(sys.argv[3]).write_text(str(failures))\nassert failures==2"
        completed = subprocess.run(['/usr/bin/sandbox-exec', '-p', stage_media.render_seatbelt_profile(scratch),
             sys.executable, '-c', code, str(self.job/'project/index.js'), str(bundle/'index.html'), str(scratch/'result')], capture_output=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual((scratch/'result').read_text(), '2')
        self.assertEqual((bundle/'index.html').read_text(), 'frozen')

    def test_parent_validation_can_invoke_nested_audio_probe(self):
        original = batch_module.load_request
        def validate(*args, **kwargs):
            # 实测音频方案会在 load_request 内调用媒体工具；取消检查不能死锁。
            stage_media.check_batch()
            return original(*args, **kwargs)
        with patch('render_batch.load_request', side_effect=validate), patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', return_value={'reused': False}):
            result = render_batch(self.args)
        self.assertEqual(len(result['results']), 2)

    def test_warm_bundle_rejects_new_timeline_without_scene_dispatch(self):
        with patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', return_value={'reused': False}):
            render_batch(self.args)
        write(self.args.request.parent/'timeline.json', {'changed': True})
        with patch('stage_media.render_scene', side_effect=AssertionError('不允许派发旧版本')):
            with self.assertRaises(StageError) as error: render_batch(self.args)
        self.assertEqual(error.exception.code, 'TIMELINE_STALE')

    def render_with_fake_media(self):
        """只验证缓存决策，不启动 FFmpeg/Chrome，不作为媒体验收。"""
        from contextlib import ExitStack
        stack = ExitStack(); self.addCleanup(stack.close)
        def supervise(argv, cwd, log, done, timeout):
            config = read(Path(done).parent/'config.json')
            Path(config['output']).write_bytes(b'raw-video')
            Path(config['audio']).write_bytes(b'original-mix')
            write(done, {'ok': True})
            return {}
        def mux(video, mix, target, *args):
            Path(target).write_bytes(b'encoded-video')
            return {'sha256': digest(target)}
        supervisor = stack.enter_context(patch('stage_media.supervise', side_effect=supervise))
        stack.enter_context(patch('stage_media.check_speech_coverage'))
        stack.enter_context(patch('stage_media.scene_audio_contract', return_value={}))
        stack.enter_context(patch('stage_media.audio_info', return_value={'durationSeconds': 1}))
        stack.enter_context(patch('stage_media.mux_scene', side_effect=mux))
        stack.enter_context(patch('stage_media.validate_mp4', side_effect=lambda path, *args: {'sha256': digest(path)}))
        stack.enter_context(patch('stage_media.extract_frames', return_value=[]))
        def render():
            return stage_media.render_scene(self.args.request, 'scene_1', 'project', 'project/index.js',
                'One', None, 10, self.args.node, self.args.modules, self.args.browser)
        return render, supervisor

    def test_single_scene_raw_cache_cannot_be_relabelled_to_new_timeline(self):
        render, supervisor = self.render_with_fake_media()
        first = render()
        write(self.args.request.parent/'timeline.json', {'newGlobalTiming': True})
        second = render()
        self.assertNotEqual(first['timelineHash'], second['timelineHash'])
        self.assertFalse(second['renderReused'])
        self.assertEqual(supervisor.call_count, 2)

    def test_single_scene_cached_delivery_rechecks_mix_bytes(self):
        render, supervisor = self.render_with_fake_media()
        first = render()
        self.assertTrue(render()['reused'])
        (self.job/first['mix']['path']).write_bytes(b'corrupted-mix')
        repaired = render()
        self.assertFalse(repaired['reused'])
        self.assertEqual(supervisor.call_count, 2)
        self.assertEqual(digest(self.job/repaired['mix']['path']), repaired['mix']['sha256'])

    def test_cleanup_failure_stops_dispatching_remaining_scenes(self):
        self.args.slots = 1
        with patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', side_effect=StageError('PROCESS_CLEANUP_FAILED', '仍有自有进程')) as render:
            with self.assertRaises(StageError) as error: render_batch(self.args)
        self.assertEqual(error.exception.code, 'PROCESS_CLEANUP_FAILED')
        self.assertEqual(render.call_count, 1)
        self.assertEqual(read(self.dir/'progress.json')['failures'][0]['code'], 'PROCESS_CLEANUP_FAILED')

    def test_process_limit_preserves_started_scene(self):
        """资源故障发生时，已启动的分镜必须等到结果已落盘。"""
        self.args.slots = 2
        started = threading.Barrier(2)
        dispatched = []
        def render(*call_args, **_kwargs):
            scene_id = call_args[1]; dispatched.append(scene_id)
            started.wait(timeout=5)
            if scene_id == 'scene_2':
                raise StageError('PROCESS_LIMIT_EXCEEDED', 'PID 配额已满', details={'resourceMetrics': {'pids': {'max': 1024}}})
            time.sleep(.05)
            return {'path': 'scene_1.mp4', 'reused': False, 'resourceMetrics': {'pids': {'max': 2048}}}
        with patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', side_effect=render):
            with self.assertRaises(StageError) as error: render_batch(self.args)
        self.assertEqual(error.exception.code, 'PROCESS_LIMIT_EXCEEDED')
        self.assertEqual(set(dispatched), {'scene_1', 'scene_2'})
        progress = read(self.dir/'progress.json')
        self.assertEqual([item['sceneId'] for item in progress['results']], ['scene_1'])
        self.assertEqual(progress['failures'][0]['code'], 'PROCESS_LIMIT_EXCEEDED')
        self.assertEqual(progress['metrics']['sceneResourceMetrics']['scene_1']['pids']['max'], 2048)

    def test_process_limit_stops_pending_dispatch(self):
        self.args.slots = 1
        with patch('stage_media.supervise', side_effect=self.build), patch('stage_media.render_scene', side_effect=StageError('PROCESS_LIMIT_EXCEEDED', 'PID 配额已满')) as render:
            with self.assertRaises(StageError) as error: render_batch(self.args)
        self.assertEqual(error.exception.code, 'PROCESS_LIMIT_EXCEEDED')
        self.assertEqual(render.call_count, 1)

    def test_cgroup_metrics_marks_new_pid_rejection_as_process_limit(self):
        root = self.base/'cgroup'; directory = root/'system.slice'/'videocut.service'; directory.mkdir(parents=True)
        process = self.base/'proc-self-cgroup'
        process.write_text('0::/system.slice/videocut.service\n')
        for name, value in {
            'pids.current': '100\n', 'pids.max': '1024\n', 'pids.peak': '101\n',
            'pids.events': 'max 2\n', 'memory.current': '4096\n', 'memory.peak': '8192\n',
        }.items():
            (directory/name).write_text(value)
        with patch.object(stage_media.sys, 'platform', 'linux'):
            usage = stage_media.CgroupUsage(root, process)
            (directory/'pids.current').write_text('1024\n')
            (directory/'pids.events').write_text('max 3\n')
            usage.observe()
        self.assertTrue(usage.process_limit_exceeded())
        self.assertEqual(usage.diagnostics()['pids']['max'], 1024)
        self.assertEqual(usage.diagnostics()['pids']['currentPeakObserved'], 1024)
        self.assertEqual(stage_media.render_failure_code('write EPIPE', usage), 'PROCESS_LIMIT_EXCEEDED')

    def test_duplicate_scene_rejected(self):
        write(self.job/'scenes.json', [self.scenes[0], self.scenes[0]])
        with self.assertRaises(StageError): freeze_batch(self.args)


if __name__ == '__main__': unittest.main()
