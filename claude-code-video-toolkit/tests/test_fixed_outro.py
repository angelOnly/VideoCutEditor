"""串行片尾真实媒体回归：本地合成信号，不调用收费配音。"""
from pathlib import Path
from copy import deepcopy
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from actual_timeline import check_fixed_ending
from finance_timeline import derive_timeline
from stage_media import (append_scene_outro, audio_info, check_speech_coverage, ffmpeg, frame_rgb, inspect_outro,
                         mux_scene, render_scene, verify_appended_outro)
from two_stage import StageError, digest, init_job, json_digest, load_request, read, write
from test_two_stage import Fixture


SPEC = {'width': 320, 'height': 240, 'fps': 10}
COLOR_ARGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']


def make_outro(path, with_audio=True, duration=.5):
    args = ['-y', '-f', 'lavfi', '-i', f'color=c=red:s=320x240:r=10:d={duration}']
    if with_audio:
        args += ['-f', 'lavfi', '-i', f'anoisesrc=color=white:amplitude=0.08:r=48000:d={duration}:seed=53']
    args += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', *COLOR_ARGS]
    if with_audio:
        args += ['-ac', '2', '-c:a', 'pcm_s16le']
    ffmpeg(*args, path)


def make_body(video, mix, prefix=10, frames=15):
    ffmpeg('-y', '-f', 'lavfi', '-i', f'color=c=blue:s=320x240:r=10:d={frames / 10}',
           '-c:v', 'libx264', '-pix_fmt', 'yuv420p', *COLOR_ARGS, video)
    ffmpeg('-y', '-f', 'lavfi', '-i', f'anoisesrc=color=pink:amplitude=0.08:r=48000:d={prefix / 10}:seed=17',
           '-af', f'apad,atrim=end_sample={frames * 4800}', '-ac', '2', '-c:a', 'pcm_s16le', mix)


class AppendMediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / 'project'
        self.assets = self.project / 'public/template-assets'; self.assets.mkdir(parents=True)
        self.source = self.assets / 'outro.mov'; make_outro(self.source)
        self.ending = {'outro': {'src': 'outro.mov', 'muted': False, 'frames': 5}}
        self.video, self.mix = self.root / 'raw.mp4', self.root / 'raw.wav'
        make_body(self.video, self.mix)
        self.bounds = {'appendFromFrame': 10}

    def test_real_video_and_full_pcm_are_appended_once(self):
        outro = inspect_outro(self.project, self.ending, SPEC)
        video, mix = append_scene_outro(self.video, self.mix, outro, self.bounds, SPEC, 15, self.root)
        target = self.root / 'final.mp4'
        report = mux_scene(video, mix, target, SPEC, 15)
        checked = verify_appended_outro(target, mix, outro, self.bounds, SPEC)
        self.assertEqual(report['frames'], 15)
        self.assertEqual(audio_info(mix)['samples'], 72000)
        self.assertGreater(checked['audio']['correlation'], .99)
        self.assertNotEqual(frame_rgb(target, 9), frame_rgb(target, 10))
        # 原始缓存保持不变，重跑仍从原始输出构造相同尾段。
        original = digest(self.video)
        video2, mix2 = append_scene_outro(self.video, self.mix, outro, self.bounds, SPEC, 15, self.root)
        self.assertEqual(digest(self.video), original)
        self.assertEqual(audio_info(mix2)['samples'], 72000)
        verify_appended_outro(video2, mix2, outro, self.bounds, SPEC)

    def test_muted_and_absent_audio_use_silence(self):
        for no_audio in (False, True):
            if no_audio:
                make_outro(self.source, with_audio=False)
            self.ending['outro']['muted'] = not no_audio
            outro = inspect_outro(self.project, self.ending, SPEC)
            self.assertFalse(outro['hasAudio'])
            video, mix = append_scene_outro(self.video, self.mix, outro, self.bounds, SPEC, 15, self.root)
            self.assertTrue(verify_appended_outro(video, mix, outro, self.bounds, SPEC)['audio']['silent'])

    def test_source_change_and_nonzero_body_tail_are_rejected(self):
        self.ending['outro']['frames'] = 6
        with self.assertRaises(StageError) as error:
            inspect_outro(self.project, self.ending, SPEC)
        self.assertEqual(error.exception.code, 'TIMELINE_STALE')
        self.ending['outro']['frames'] = 5
        outro = inspect_outro(self.project, self.ending, SPEC)
        make_body(self.video, self.mix, prefix=15)
        with self.assertRaises(StageError) as error:
            append_scene_outro(self.video, self.mix, outro, self.bounds, SPEC, 15, self.root)
        self.assertEqual(error.exception.code, 'CONTENT_TIMELINE_REQUIRED')

    def test_canonical_scene_offset_does_not_let_body_sfx_leak_into_outro(self):
        scene = {'startFrame': 6, 'frames': 9, 'contentFrames': 9, 'utterances': [],
                 'sfx': [{'src': 'outro.mov', 'frame': 0}]}
        with self.assertRaises(StageError) as error:
            check_speech_coverage(self.project, {'scene': scene}, 9, 10, {'narrationEndFrame': 10})
        self.assertEqual(error.exception.code, 'CONTENT_TIMELINE_REQUIRED')

    def test_fixed_mix_is_not_appended_a_second_time(self):
        outro = inspect_outro(self.project, self.ending, SPEC)
        _, final_mix = append_scene_outro(self.video, self.mix, outro, self.bounds, SPEC, 15, self.root)
        saved = self.root / 'fixed.wav'; shutil.copyfile(final_mix, saved)
        video, reused = append_scene_outro(self.video, saved, outro, self.bounds, SPEC, 15, self.root, fixed_audio=True)
        self.assertEqual(reused, saved)
        self.assertEqual(audio_info(reused)['samples'], 72000)
        verify_appended_outro(video, reused, outro, self.bounds, SPEC)

    def test_placeholder_or_wrong_pcm_cannot_pass_independent_check(self):
        outro = inspect_outro(self.project, self.ending, SPEC)
        with self.assertRaises(StageError):
            verify_appended_outro(self.video, self.mix, outro, self.bounds, SPEC)
        video, _ = append_scene_outro(self.video, self.mix, outro, self.bounds, SPEC, 15, self.root)
        with self.assertRaises(StageError):
            verify_appended_outro(video, self.mix, outro, self.bounds, SPEC)


class RenderSceneAppendTests(Fixture):
    def setUp(self):
        super().setUp()
        template = self.base / 'template-v13'
        (template / 'renderer').mkdir(parents=True)
        (template / 'template.md').write_text('串行片尾测试模板')
        write(template / 'renderer/renderer-manifest.json', {'endingPolicy': 'hold-closing-then-append/v1'})
        self.spec['templateFile'] = str(template / 'template.md')
        self.job = (self.base / 'serial-job').resolve()
        self.request = Path(init_job(self.job, self.spec)['request'])
        self.root, self.r = load_request(self.request)
        self.plan['inputDigest'] = json_digest(self.r['snapshot'])
        self.plan_path = self.job / 'analysis/plan.json'; write(self.plan_path, self.plan)
        self.request = self.render_request()
        self.project = self.job / 'project/renderer'
        (self.project / 'public/template-assets').mkdir(parents=True)
        (self.project / 'src').mkdir()
        (self.project / 'src/index.ts').write_text('// 测试入口由本地合成输出替代浏览器。')
        self.outro = self.project / 'public/template-assets/outro.mov'; make_outro(self.outro)
        scenes = []
        for index, (start, duration, frames) in enumerate(((0, 6, 6), (6, 4, 9)), 1):
            voice = self.project / f'public/voice-{index}.wav'
            ffmpeg('-y', '-f', 'lavfi', '-i', f'anoisesrc=color=pink:amplitude=.08:r=48000:d={duration / 10}:seed={index}',
                   '-ac', '2', '-c:a', 'pcm_s16le', voice)
            text = self.plan['scenes'][index - 1]['text']
            u = {'id': f'u{index}', 'text': text, 'audioPath': str(voice.relative_to(self.job)), 'src': voice.name,
                 'startFrame': 0, 'endFrameExclusive': duration}
            scenes.append({'id': f'scene_{index}', 'startFrame': start, 'endFrameExclusive': start + frames,
                           'contentFrames': frames, 'utterances': [u], 'captions': [{'utteranceId': u['id'], 'text': text,
                           'startFrame': 0, 'endFrameExclusive': duration}], 'visualBlocks': []})
        self.timeline = {'fps': 10, 'width': 320, 'height': 240, 'withBgm': False, 'scenes': scenes, 'totalFrames': 15,
                         'ending': {'closingUtteranceIds': ['u2'], 'holdFrame': 5, 'narrationEndFrame': 10,
                                    'outro': {'src': 'outro.mov', 'frames': 5, 'muted': False}}}
        self.timeline_path = self.request.parent / 'timeline.json'; write(self.timeline_path, self.timeline)
        derive_timeline(self.job, self.request, str(self.timeline_path.relative_to(self.job)), 'project/renderer')
        self.props = self.request.parent / 'scene-02-props.json'
        self.modules = self.base / 'modules'
        for name in ('remotion', '@remotion/renderer', '@remotion/bundler'):
            write(self.modules / name / 'package.json', {'version': 'test'})
        self.browser = self.base / 'browser'; self.browser.write_text('测试浏览器占位')
        self.raw_video, self.raw_mix = self.base / 'raw.mp4', self.base / 'raw.wav'
        make_body(self.raw_video, self.raw_mix, prefix=4, frames=9)

    def synthetic_render(self, argv, cwd, log, done, timeout):
        config = read(Path(done).parent / 'config.json')
        shutil.copyfile(self.raw_video, config['output'])
        if not config['fixedAudio']:
            shutil.copyfile(self.raw_mix, config['audio'])
        write(done, {'frames': config['frames']})
        return {}

    def run_scene(self):
        return render_scene(self.request, 'scene_2', 'project/renderer', 'project/renderer/src/index.ts', 'FinanceScene-2',
                            str(self.props.relative_to(self.job)), 9, sys.executable, str(self.modules), str(self.browser))

    def test_normal_entry_publishes_final_mp4_pcm_and_reuses_without_duplication(self):
        with patch('stage_media.supervise', side_effect=self.synthetic_render) as renderer:
            result = self.run_scene()
            self.assertEqual(result['frames'], 9)
            self.assertEqual(audio_info(self.job / result['mix']['path'])['samples'], 43200)
            self.assertIn('outroCheck', result)
            reused = self.run_scene()
            self.assertTrue(reused['reused'])
            self.assertEqual(renderer.call_count, 1)
        bounds = check_fixed_ending(self.timeline)
        outro = inspect_outro(self.project, self.timeline['ending'], SPEC)
        verify_appended_outro(self.job / reused['path'], self.job / reused['mix']['path'], outro, bounds, SPEC)

    def test_props_cannot_swap_end_time_or_bgm(self):
        original = read(self.props)
        for field in ('narrationEndFrame', 'withBgm'):
            with self.subTest(field=field):
                props = deepcopy(original)
                if field == 'withBgm':
                    props['withBgm'] = True
                else:
                    props['timeline']['ending'][field] = 9
                write(self.props, props)
                with self.assertRaises(StageError) as error:
                    self.run_scene()
                self.assertEqual(error.exception.code, 'TIMELINE_STALE')


if __name__ == '__main__':
    unittest.main()
