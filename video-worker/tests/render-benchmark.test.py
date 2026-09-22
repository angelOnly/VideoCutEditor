"""不启动渲染或连接数据库的基准驱动回归。"""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('benchmark', Path(__file__).parents[1] / 'scripts/render-benchmark.py')
bench = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bench)


class BenchmarkTest(unittest.TestCase):
    def test_guard_tracks_original_descendants_but_excludes_own(self):
        rows = [dict(pid=1, ppid=0, pgid=1, command='worker /original/task'),
                dict(pid=2, ppid=1, pgid=1, command='ffmpeg -i input'),
                dict(pid=3, ppid=0, pgid=3, command='remotion /original/node_modules')]
        self.assertEqual([p['pid'] for p in bench.blockers(rows, '/original', 3)], [2])

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
                          immutableInputs=[str(frozen)], sampleIntervalSeconds=.01,
                          variants=[dict(name=name, slots=slots, stages=[dict(name='render', argv=[sys.executable,
                            '-c', 'import pathlib,sys; pathlib.Path(sys.argv[1]).write_text(sys.argv[2])',
                            '{runDir}/output.txt', '{cacheDir}'])])
                            for name, slots in [('old_serial', 1), ('new_1', 1), ('new_2', 2), ('new_3', 3)]])
            result = bench.run(config)
            self.assertEqual(len(result['runs']), 24)
            self.assertTrue(result['qualified'])
            self.assertEqual((root/'results/old_serial-1-cold/output.txt').read_text(),
                             (root/'results/old_serial-1-warm/output.txt').read_text())
            with self.assertRaises(ValueError):
                bench.run(config)


if __name__ == '__main__':
    unittest.main()
