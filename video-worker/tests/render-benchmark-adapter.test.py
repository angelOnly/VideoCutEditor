"""仅检查隔离准备与原版导出，不启动模型或媒体。"""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('adapter', Path(__file__).parents[1]/'scripts/render-benchmark-adapter.py')
a = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(a)


class AdapterTest(unittest.TestCase):
    def test_prepare_renews_identity_and_drops_success_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root/'source'
            for folder in ['input', 'project/renderer/public', 'cache/tts', 'confirmation/v1', 'render/render_001/work']:
                (source/folder).mkdir(parents=True)
            a.write(source/'confirmation/v1/plan.json', {'taskId': 'original'})
            a.write(source/'render/render_001/request.json', {'taskId': 'original', 'contractVersion': 'video-two-stage/1',
                'previousArtifacts': {'old': True}, 'confirmation': {'planFile': 'confirmation/v1/plan.json', 'planSha256': 'old'}})
            scenes = [{'id': f'scene_{index+1:03d}', 'frames': 228 if index < 17 else 236} for index in range(18)]
            timeline = {'scenes': scenes, 'chapters': [], 'totalFrames': 4112}
            a.write(source/'render/render_001/timeline.json', timeline)
            a.write(source/'render/render_001/work/success.json', {'passed': True})
            for index, scene in enumerate(scenes):
                a.write(source/f'render/render_001/scene-{index+1:02d}-props.json', {'scene': scene, 'timeline': timeline})
            output = root/'run'
            a.prepare({'source': str(source), 'modules': str(root/'modules'), 'cacheCondition': 'no_app_cache'}, output)
            task = output/'artifacts/task'
            request = a.read(task/'render/render_001/request.json')
            self.assertNotEqual(request['taskId'], 'original')
            self.assertIsNone(request['previousArtifacts'])
            self.assertFalse((task/'render/render_001/work').exists())
            self.assertEqual(request['confirmation']['planSha256'], a.digest(task/'confirmation/v1/plan.json'))
            self.assertEqual(a.read(task/'job.json')['requests']['render/render_001/request.json'], a.digest(task/'render/render_001/request.json'))

    def test_export_is_exact_committed_baseline(self):
        repo = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'baseline'
            a.export_baseline(repo, target)
            expected = subprocess.check_output(['git', 'show', f'{a.BASELINE}:claude-code-video-toolkit/tools/stage_media.py'], cwd=repo)
            self.assertEqual((target/'tools/stage_media.py').read_bytes(), expected)
            self.assertTrue((target/'.agents/skills/video-pipeline/references/two-stage.schema.json').exists())


if __name__ == '__main__':
    unittest.main()
