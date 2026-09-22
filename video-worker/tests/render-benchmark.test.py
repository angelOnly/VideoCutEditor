"""不启动渲染或连接数据库的基准驱动回归。"""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location('benchmark', Path(__file__).parents[1] / 'scripts/render-benchmark.py')
bench = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bench)


class BenchmarkTest(unittest.TestCase):
    def test_cleanup_mixed_group_and_pgid_one_use_only_verified_pids(self):
        rows = [dict(pid=10, ppid=2, pgid=10, started='a'),
                dict(pid=11, ppid=10, pgid=1, started='b'),
                dict(pid=99, ppid=1, pgid=10, started='unrelated'),
                dict(pid=1, ppid=0, pgid=1, started='system')]
        proc = Mock(pid=10)
        def kill(pid, sig):
            rows[:] = [p for p in rows if p['pid'] != pid]
        with patch.object(bench, 'processes', side_effect=lambda: list(rows)), \
             patch.object(bench.os, 'getpgrp', return_value=9999), \
             patch.object(bench.os, 'killpg') as group_signal, \
             patch.object(bench.os, 'kill', side_effect=kill) as pid_signal:
            result = bench.stop_group(proc)
        self.assertTrue(result['complete'])
        group_signal.assert_not_called()
        self.assertEqual({c.args[0] for c in pid_signal.call_args_list}, {10, 11})
        self.assertEqual({p['pid'] for p in rows}, {1, 99})

    def test_cleanup_permission_error_preserves_residue_and_continues_other_groups(self):
        rows = [dict(pid=30, ppid=2, pgid=30, started='a'), dict(pid=40, ppid=30, pgid=40, started='b')]
        clock = [0.0]
        proc = Mock(pid=30)
        def killpg(pgid, sig):
            if pgid == 30:
                raise PermissionError(1, 'mock denied')
            rows[:] = [p for p in rows if p['pgid'] != pgid]
        def sleep(seconds):
            clock[0] += seconds
        with patch.object(bench, 'processes', side_effect=lambda: list(rows)), \
             patch.object(bench.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(bench.time, 'sleep', side_effect=sleep), \
             patch.object(bench.os, 'getpgrp', return_value=9999), \
             patch.object(bench.os, 'killpg', side_effect=killpg) as signals:
            result = bench.stop_group(proc)
        self.assertFalse(result['complete'])
        self.assertEqual([p['pid'] for p in result['remainingProcesses']], [30])
        self.assertEqual([e['errno'] for e in result['errors']], [1, 1])
        self.assertIn(40, [call.args[0] for call in signals.call_args_list])

    def test_execute_persists_samples_even_if_cleanup_unexpectedly_raises(self):
        import json
        proc = Mock(pid=100, returncode=None)
        proc.poll.return_value = None
        rows = [dict(pid=100, ppid=2, pgid=100, started='ours', rssKiB=2048, cpu=2, command='python ours'),
                dict(pid=200, ppid=1, pgid=200, started='external', rssKiB=1024, cpu=10, command='ffmpeg /original/task')]
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            with patch.object(bench.subprocess, 'Popen', return_value=proc), \
                 patch.object(bench, 'processes', return_value=rows), \
                 patch.object(bench, 'stop_group', side_effect=PermissionError(1, 'mock cleanup error')):
                result = bench.execute(['mock'], directory, {}, folder, '/original', 10, .1, 10000)
            saved = json.loads((folder/'metrics.json').read_text())
            self.assertEqual(result['reason'], 'external_media_contention')
            self.assertFalse(saved['cleanup']['complete'])
            self.assertIsNone(saved['cleanup']['remainingProcesses'])
            self.assertEqual(len(saved['samples']), 1)
            self.assertEqual(saved['blockingProcesses'][0]['pid'], 200)
            self.assertEqual(saved['cleanup']['lastKnownSignatures'][0]['pid'], 100)

    def test_successful_command_with_residue_is_not_a_successful_measurement(self):
        proc = Mock(pid=100, returncode=0)
        proc.poll.return_value = 0
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(bench.subprocess, 'Popen', return_value=proc), \
                 patch.object(bench, 'stop_group', return_value={'complete': False, 'remainingProcesses': [{'pid': 101}], 'errors': [], 'signals': []}):
                result = bench.execute(['mock'], directory, {}, Path(directory), '/original', 10, .1, 10000)
            self.assertEqual(result['reason'], 'cleanup_failed')
            self.assertEqual(result['exitCode'], 0)

    def test_quiet_window_resets_when_original_render_resumes(self):
        clock = [0.0]
        producer = dict(pid=1, ppid=0, pgid=1, command='ffmpeg /original/task')
        def sleep(seconds):
            clock[0] += seconds
        with patch.object(bench.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(bench.time, 'sleep', side_effect=sleep), \
             patch.object(bench, 'processes', side_effect=lambda: [producer] if clock[0] in (0, 3) else []):
            self.assertEqual(bench.wait_for_quiet('/original', quiet_seconds=2, timeout=10), 6)

    def test_quiet_default_is_immediate_and_busy_timeout_is_bounded(self):
        clock = [0.0]
        def sleep(seconds):
            clock[0] += seconds
        with patch.object(bench.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(bench.time, 'sleep', side_effect=sleep), \
             patch.object(bench, 'processes', return_value=[]) as processes:
            self.assertEqual(bench.wait_for_quiet('/original'), 0)
            processes.return_value = [dict(pid=1, ppid=0, pgid=1, command='ffmpeg /original/task')]
            with self.assertRaises(TimeoutError):
                bench.wait_for_quiet('/original', quiet_seconds=2, timeout=3)
            self.assertEqual(clock[0], 3)
            with self.assertRaises(ValueError):
                bench.wait_for_quiet('/original', quiet_seconds=-1)

    def test_guard_tracks_original_descendants_but_excludes_own(self):
        rows = [dict(pid=1, ppid=0, pgid=1, command='worker /original/task'),
                dict(pid=2, ppid=1, pgid=1, command='ffmpeg -i input'),
                dict(pid=3, ppid=0, pgid=3, command='remotion /original/node_modules')]
        self.assertEqual([p['pid'] for p in bench.blockers(rows, '/original', 3)], [2])

    def test_idle_baseline_requires_signature_and_stops_when_cpu_returns(self):
        baseline = [dict(pid=20, started='original')]
        idle = dict(pid=20, ppid=1, pgid=20, started='original', cpu=0, command='Chrome /original/task')
        self.assertEqual(bench.blockers([idle], '/original', idle_baseline=baseline), [])
        for change in [dict(started='reused'), dict(cpu=1.1)]:
            self.assertEqual(len(bench.blockers([{**idle, **change}], '/original', idle_baseline=baseline)), 1)
        child = dict(pid=21, ppid=20, pgid=20, started='new', cpu=0, command='Chrome --type=gpu-process')
        self.assertEqual([p['pid'] for p in bench.blockers([idle, child], '/original', idle_baseline=baseline)], [21])

    def test_idle_baseline_rejects_unproven_exception(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            done = root / 'complete.json'
            done.write_text('{}')
            observations = root / 'observations.json'
            observations.write_text(json.dumps([dict(at=t, processes=[dict(pid=20, started='original', cpu=.1)]) for t in [0, 65]]))
            evidence = dict(observationFile=str(observations), observationSha256=bench.sha256(observations), observationSeconds=65, maxCpuPercent=.1, noActiveProducer=True,
                            processes=[dict(pid=20, started='original')],
                            completionEvidence=[dict(path=str(done), sha256=bench.sha256(done))])
            path = root / 'evidence.json'
            path.write_text(json.dumps(evidence))
            config = dict(idleBaselineProcesses=evidence['processes'], idleBaselineEvidence=str(path))
            self.assertEqual(bench.validate_idle_baseline(config), evidence['processes'])
            evidence['observationSeconds'] = 59
            path.write_text(json.dumps(evidence))
            with self.assertRaises(ValueError):
                bench.validate_idle_baseline(config)

    def test_summary_excludes_contaminated_and_failed(self):
        def item(status, wall):
            return dict(variant='new_2', condition='cold', status=status, wallSeconds=wall,
                        peakAggregateRssKiB=10, sampledCpuSecondsEstimate=2)
        summary = bench.summarize([item('passed', n) for n in [1, 3, 5]] +
                                  [item('failed', 100), item('external_media_contention', 200)])['new_2/cold']
        self.assertEqual(summary['wallSeconds']['median'], 3)
        self.assertEqual(summary['failed'], 1)
        self.assertEqual(summary['interrupted'], 1)
        self.assertTrue(summary['qualified'])

    def test_detached_descendants_remain_owned_after_reparenting(self):
        rows = [dict(pid=10, ppid=1, pgid=10, started='a'),
                dict(pid=11, ppid=10, pgid=11, started='b')]
        known = {}
        self.assertEqual(len(bench.track_owned(rows, 10, known)), 2)
        rows = [dict(pid=11, ppid=1, pgid=11, started='b'),
                dict(pid=10, ppid=1, pgid=10, started='new-unrelated')]
        self.assertEqual([p['pid'] for p in bench.track_owned(rows, 10, known)], [11])

    def test_real_detached_child_is_sampled_and_cancelled(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            child = "import time; a=bytearray(24*1024*1024); time.sleep(30)"
            code = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1]], start_new_session=True); time.sleep(30)"
            result = bench.execute([sys.executable, '-c', code, child], directory,
                                   os.environ.copy(), folder, '/unrelated-protected-path', 2, .02, 1000000)
            self.assertEqual(result['reason'], 'timeout')
            self.assertGreater(result['peakAggregateRssKiB'], 24000)
            self.assertNotEqual(result['exitCode'], 0)

    def test_cleanup_records_hash_and_rejects_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'artifacts').mkdir()
            (folder / 'artifacts/result.mp4').write_bytes(b'test-output')
            records = bench.cleanup_outputs(folder, ['artifacts'])
            self.assertEqual(records[0]['size'], 11)
            self.assertFalse((folder / 'artifacts').exists())
            with self.assertRaises(ValueError):
                bench.cleanup_outputs(folder, ['../outside'])

    def test_timeout_terminates_own_group(self):
        with tempfile.TemporaryDirectory() as folder:
            result = bench.execute([sys.executable, '-c', 'import time; time.sleep(30)'], folder,
                                   os.environ.copy(), Path(folder), '/unrelated-protected-path', .1, .02, 1000000)
            self.assertEqual(result['reason'], 'timeout')
            self.assertNotEqual(result['exitCode'], 0)

    def test_full_matrix_uses_new_outputs_and_paired_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            frozen = root / 'input.json'
            frozen.write_text('{}')
            config = dict(outputRoot=str(root / 'results'), protectedRoot='/never-original', cwd=folder,
                          immutableInputs=[str(frozen)], sampleIntervalSeconds=.01, cacheCondition='应用缓存明确关闭', env={'HOME': '/must-not-use-shared-home'},
                          variants=[dict(name=name, slots=slots, stages=[dict(name='render', argv=[sys.executable,
                            '-c', 'import os,pathlib,sys; h=pathlib.Path(os.environ["HOME"]); assert h.is_dir() and h.parent==pathlib.Path(sys.argv[1]).parent; pathlib.Path(sys.argv[1]).write_text(sys.argv[2])',
                            '{runDir}/output.txt', '{cacheDir}'])])
                            for name, slots in [('old_serial', 1), ('new_1', 1), ('new_2', 2), ('new_3', 3)]])
            result = bench.run(config)
            self.assertEqual(len(result['runs']), 24)
            self.assertTrue(result['qualified'])
            self.assertIn('应用缓存明确关闭', result['measurementNotes'])
            self.assertEqual(len(result['externalWaits']), 24)
            self.assertEqual((root/'results/old_serial-1-cold/output.txt').read_text(),
                             (root/'results/old_serial-1-warm/output.txt').read_text())
            with self.assertRaises(ValueError):
                bench.run(config)


if __name__ == '__main__':
    unittest.main()
