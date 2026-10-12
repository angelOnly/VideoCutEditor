"""一体化优化回归：真实媒体与浏览器可选闭环，断言实际执行次数。"""
import copy
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools'))
from test_two_stage import Fixture
from two_stage import read, write, digest, load_request, StageError
from finance_timeline import derive_timeline, scene_props
from production_contract import CONTRACT, validate_production_inputs, action_windows
from render_batch import freeze_batch, render_batch
from render_inputs import isolated_command
from stage_media import ffmpeg, extract_frames, validate_mp4, validate_delivery, assemble
from validation_context import ValidationContext, using_validation


class ProductionFixture(Fixture):
    def setUp(self):
        super().setUp()
        self.job = self.job.resolve()
        self.request = self.render_request()
        _, self.req = load_request(self.request)
        self.project = self.job/'project/renderer'
        (self.project/'src').mkdir(parents=True); (self.project/'public').mkdir()
        self.modules = Path(__file__).resolve().parents[1]/'examples/hello-world/node_modules'
        (self.project/'node_modules').symlink_to(self.modules, target_is_directory=True)
        write(self.project/'render-contract.json', {'contract': CONTRACT})
        (self.project/'src/validateTimeline.ts').write_text('export const validateTimeline = () => []; // 固定小工程的参数已由 Python 检查\n')
        # 固定小工程使用实际配音文件和逐帧画面；不调用收费服务。
        (self.project/'src/index.tsx').write_text('''import React from 'react';
import {registerRoot, Composition, getInputProps, AbsoluteFill, Audio, staticFile, useCurrentFrame} from 'remotion';
const Scene = ({scene}) => <AbsoluteFill style={{background:scene.summary, transform:`translateX(${useCurrentFrame()}px)`}}><Audio src={staticFile(scene.utterances[0].src)}/></AbsoluteFill>;
const Root = () => {const props=getInputProps();return <Composition id="FinanceScene" component={Scene} durationInFrames={props.scene.frames} fps={props.timeline.fps} width={props.timeline.width} height={props.timeline.height} defaultProps={props}/>};
registerRoot(Root);
''')
        self.timeline = {'renderInputContract': CONTRACT, 'fps': 10, 'width': 320, 'height': 240,
                         'totalFrames': 20, 'title': '固定回归', 'withBgm': False, 'chapters': [], 'scenes': []}
        self.design = {'schemaVersion': 2, 'scenes': {}}
        self.scenes = []
        for i, confirmed in enumerate(self.plan['scenes']):
            sid, uid = confirmed['id'], f'u{i}'
            voice = self.project/f'public/{uid}.wav'
            ffmpeg('-f', 'lavfi', '-i', f'sine=frequency={440+i*220}:sample_rate=48000', '-t', '1', voice)
            utterance = {'id': uid, 'text': confirmed['text'], 'src': voice.name,
                         'audioPath': str(voice.relative_to(self.job)), 'startFrame': 0, 'endFrameExclusive': 10}
            self.timeline['scenes'].append({'id': sid, 'speaker': 'female-host', 'summary': ['blue', 'red'][i],
                'startFrame': i*10, 'endFrameExclusive': (i+1)*10, 'utterances': [utterance], 'visualBlocks': [],
                'captions': [{k: v for k, v in utterance.items() if k in ('text', 'startFrame', 'endFrameExclusive')} | {'utteranceId': uid}]})
            self.design['scenes'][sid] = {'designs': [{'id': 'd', 'utteranceIds': [uid], 'mode': 'hold',
                'description': '固定背景观察', 'implementation': {'path': 'project/renderer/src/index.tsx', 'export': 'Scene'}}]}
            self.scenes.append({'sceneId': sid, 'composition': 'FinanceScene', 'frames': 10,
                                'props': str((self.request.parent/f'scene-{i+1:02d}-props.json').relative_to(self.job))})
        self.save()

    def save(self):
        write(self.request.parent/'timeline.json', self.timeline)
        write(self.request.parent/'design.json', self.design)
        write(self.request.parent/'scenes.json', self.scenes)
        derive_timeline(self.job, self.request, str((self.request.parent/'timeline.json').relative_to(self.job)), 'project/renderer')

    def inputs(self):
        return validate_production_inputs(self.job, self.req, self.timeline, self.design, self.scenes, self.project)


class ProductionContractTests(ProductionFixture):
    def test_collects_all_issues_without_media(self):
        self.design['scenes']['scene_1']['designs'] = []
        self.design['scenes']['scene_2']['designs'] = []
        self.timeline['scenes'][0]['captions'][0]['endFrameExclusive'] = 20
        with self.assertRaises(StageError) as error: self.inputs()
        issues = error.exception.details['issues']
        self.assertGreaterEqual(len(issues), 3)
        self.assertEqual({i['sceneId'] for i in issues}, {'scene_1', 'scene_2'})

    def test_malformed_design_is_a_structured_error(self):
        self.design['scenes']['scene_1'] = {'designs': [None]}
        with self.assertRaisesRegex(StageError, '设计项结构无效'): self.inputs()

    def test_scene_projection_retains_real_global_dependencies(self):
        original = [scene_props(self.timeline, s['sceneId']) for s in self.scenes]
        self.timeline['scenes'][0]['summary'] = 'green'
        changed = [scene_props(self.timeline, s['sceneId']) for s in self.scenes]
        self.assertNotEqual(original[0], changed[0]); self.assertEqual(original[1], changed[1])
        self.timeline['totalFrames'] += 1
        self.assertNotEqual(changed[1], scene_props(self.timeline, 'scene_2'))
        self.timeline['scenes'][0]['mysteryExecutionField'] = True
        with self.assertRaises(StageError): scene_props(self.timeline, 'scene_1')

    def test_plan_has_no_observation_and_uses_real_action_windows(self):
        block = {'id': 'event', 'kind': 'layers', 'startFrame': 0, 'endFrameExclusive': 10,
                 'props': {'itemFrames': [1, 5]}, 'animationFrames': 2}
        self.assertEqual(action_windows(block), [(0, 3), (1, 4), (5, 8)])
        self.timeline['scenes'][0]['visualBlocks'] = [block]
        self.design['scenes']['scene_1']['designs'][0].update(mode='change', eventRefs=['event'])
        plan = self.inputs()
        self.assertTrue({0, 1, 2, 3, 4, 5, 6, 7, 8, 9}.issubset(plan['scenes']['scene_1']['frames']))
        self.assertNotIn('passed', str(plan)); self.assertNotIn('observed', str(plan))

    @unittest.skipUnless(sys.platform == 'darwin', '真实读取隔离使用 macOS 沙箱')
    def test_build_cannot_read_sidecar_or_network(self):
        import subprocess
        temp = self.request.parent/'sandbox'; temp.mkdir()
        script = temp/'read.py'; script.write_text('import pathlib,sys; pathlib.Path(sys.argv[1]).read_bytes()')
        allowed = isolated_command([sys.executable, str(script), str(self.project/'src/index.tsx')], 'seatbelt', self.job.resolve(), self.project, temp)
        self.assertEqual(subprocess.run(allowed, capture_output=True).returncode, 0)
        denied = isolated_command([sys.executable, str(script), str(self.request.parent/'design.json')], 'seatbelt', self.job.resolve(), self.project, temp)
        self.assertNotEqual(subprocess.run(denied, capture_output=True).returncode, 0)
        network = isolated_command([sys.executable, '-c', "import socket; s=socket.socket(); s.settimeout(1); s.connect(('198.51.100.1',80))"], 'seatbelt', self.job.resolve(), self.project, temp)
        blocked = subprocess.run(network, capture_output=True)
        self.assertIn(b'Operation not permitted', blocked.stderr)


@unittest.skipUnless(os.environ.get('RUN_OPTIMIZATION_BROWSER') == '1', '需显式启用真实浏览器回归')
class RealOptimizationTests(ProductionFixture):
    def batch(self, name):
        args = SimpleNamespace(request=self.request, batch=name, project='project/renderer', entry='project/renderer/src/index.tsx',
            scenes=str((self.request.parent/'scenes.json').relative_to(self.job)), modules=str(self.modules),
            browser=os.environ.get('TEST_BROWSER', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
            node=os.environ['TEST_NODE'], slots=2)
        args.manifest = freeze_batch(args)['manifest']
        try: return render_batch(args)
        except StageError as exc:
            print(exc.details, flush=True)
            for log in self.request.parent.glob('work/*.log'): print(log.read_text()[-4000:], flush=True)
            raise

    def delivery(self, results):
        manifest = {k: self.req[k] for k in ('contractVersion', 'taskId', 'runId', 'stage')}
        manifest.update(planVersion=self.req['confirmation']['planVersion'], confirmedPlanSha256=self.req['confirmation']['planSha256'],
            wholeVideo=None, quality=str((self.request.parent/'review.json').relative_to(self.job)), scenes=[])
        review = {k: manifest[k] for k in ('contractVersion', 'taskId', 'runId', 'stage', 'confirmedPlanSha256')}
        review.update(passed=True, humanListeningPerformed=False, limitations=['合成测试记录，不表示主观审美或试听通过'],
            timelineSha256=digest(self.request.parent/'timeline.json'), designSha256=digest(self.request.parent/'design.json'), scenes=[])
        for item, source in zip(results, self.plan['scenes']):
            sid = source['id']; uid = self.timeline['scenes'][len(manifest['scenes'])]['utterances'][0]['id']
            manifest['scenes'].append({'id': sid, 'text': source['text'], 'path': item['path'], 'sha256': item['sha256'],
                'frames': 10, 'durationSeconds': 1, 'audio': {'text': source['text'], **item['mix']},
                'usedResources': [], 'resolvedVisualBlocks': [{'id': 'b', 'startFrame': 0, 'endFrameExclusive': 10}],
                'captions': [{'text': source['text'], 'startSeconds': 0, 'endSeconds': 1}], 'evidence': item['evidence']})
            review['scenes'].append({'id': sid, 'videoSha256': item['sha256'], 'viewedFrames': [0, 5, 9], 'passed': True,
                'notes': '机械回归测试记录', 'narrationChecks': [{'designIds': ['d'], 'utteranceIds': [uid], 'mode': 'hold',
                    'startFrame': 0, 'endFrameExclusive': 10, 'expected': '合成背景', 'observed': '仅供机械测试', 'viewedFrames': [0, 9], 'passed': True}]})
        write(self.job/manifest['quality'], review)
        return manifest

    def test_real_render_reuse_local_change_corruption_and_delivery(self):
        first = self.batch('cold')
        self.assertEqual(first['metrics']['browserRenderCount'], 2)
        self.design['scenes']['scene_1']['designs'][0]['description'] = '补充已有事实'
        self.save()
        second = self.batch('notes')
        self.assertEqual(second['metrics']['browserRenderCount'], 0)
        self.assertTrue(second['metrics']['bundleReused'])
        self.assertEqual(second['metrics']['newRenderedFrames'], 0)
        self.assertEqual([s['sha256'] for s in first['results']], [s['sha256'] for s in second['results']])
        self.timeline['scenes'][0]['summary'] = 'green'; self.save()
        third = self.batch('local')
        self.assertEqual(third['metrics']['browserRenderCount'], 1)
        self.assertEqual(first['results'][1]['renderInputKey'], third['results'][1]['renderInputKey'])
        self.assertNotEqual(first['results'][0]['renderInputKey'], third['results'][0]['renderInputKey'])
        (self.job/third['results'][0]['path']).write_bytes(b'damaged')
        restored = self.batch('repair')
        self.assertEqual(restored['metrics']['browserRenderCount'], 0)
        self.assertFalse(restored['results'][0]['reused'])
        self.assertTrue(restored['results'][0]['renderReused'])
        # 补证据不启动浏览器，已有帧只补缺失项。
        with patch('stage_media.ffmpeg', wraps=ffmpeg) as decoder:
            extra = extract_frames(self.job, self.req, 'scene_1', self.job/restored['results'][0]['path'], 10, [1, 4, 8])
            self.assertEqual(decoder.call_count, 1)
            extract_frames(self.job, self.req, 'scene_1', self.job/restored['results'][0]['path'], 10, [1, 4, 8])
            self.assertEqual(decoder.call_count, 1)
        manifest = self.delivery(restored['results'])
        file = self.request.parent/'manifest.json'; write(file, manifest)
        context = ValidationContext()
        with patch('stage_media.ffmpeg', wraps=ffmpeg) as decoder:
            assemble(self.request, file, validation_context=context)
            hits = context.hits
            self.assertEqual(validate_delivery(self.job, self.req, read(file), validation_context=context)['sceneCount'], 2)
            self.assertGreater(context.hits, hits)
            for scene in manifest['scenes']:
                calls = [c for c in decoder.call_args_list if 'rawvideo' in c.args and self.job/scene['path'] in c.args]
                self.assertEqual(len(calls), 1, '同一次交付的分镜证据与边界共用一次解码')
        # 当前设计变化必须使旧审片失效，哪怕媒体内容键不变。
        self.design['scenes']['scene_1']['designs'][0]['description'] = '新增未实现预期'; self.save()
        with self.assertRaisesRegex(StageError, '设计预期已变化'):
            validate_delivery(self.job, self.req, read(file), validation_context=context)
        self.design['scenes']['scene_1']['designs'][0]['description'] = '补充已有事实'; self.save()
        image = self.job/manifest['scenes'][0]['evidence'][0]['path']; image.write_bytes(b'broken-image')
        with self.assertRaises(StageError): validate_delivery(self.job, self.req, read(file), validation_context=context)


if __name__ == '__main__': unittest.main()
