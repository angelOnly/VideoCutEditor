"""Worker 桥接的只读检查与外部收费账本测试。"""
import json
import copy
from pathlib import Path
from unittest.mock import patch
from test_two_stage import Fixture
from two_stage import StageError, digest, json_digest, read, write
from stage_tts import generate
from worker_stage import check, check_timeline


class FixedEndingCheckTests(Fixture):
    def prepare(self, policy='hold-closing-then-append/v1', outro=True):
        request_path = self.render_request()
        request = read(request_path)
        snapshot = self.root/request['input']['templateSnapshot']
        template = read(snapshot); template['root'] = 'input/template'; write(snapshot, template)
        write(self.root/'input/template/renderer/renderer-manifest.json',
              {'sentenceAudioValidator': 'scripts/check.mjs', 'endingPolicy': policy})
        project = self.root/'project/renderer'
        (project/'public/template-assets').mkdir(parents=True)
        timeline = {'fps': 10, 'totalFrames': 25 if outro else 20,
                    'ending': {'closingUtteranceIds': ['closing'], 'holdFrame': 9, 'narrationEndFrame': 20}, 'scenes': []}
        if outro:
            timeline['ending']['outro'] = {'src': 'tail.mp4', 'frames': 5, 'muted': False}
        scenes = []
        for i, uid in enumerate(('body', 'closing')):
            text = self.plan['scenes'][i]['text']; frames = 15 if i == 1 and outro else 10
            audio = project/f'public/{uid}.wav'; audio.write_bytes(b'voice-'+uid.encode())
            timeline['scenes'].append({'id': f'scene_{i+1}', 'startFrame': i*10,
                'endFrameExclusive': i*10+frames, 'contentFrames': frames,
                'utterances': [{'id': uid, 'text': text, 'src': uid+'.wav',
                    'audioPath': str(audio.relative_to(self.root)), 'startFrame': 0, 'endFrameExclusive': 10}],
                'captions': [{'utteranceId': uid, 'text': text, 'startFrame': 0, 'endFrameExclusive': 10}]})
            video = self.root/f'{uid}.mp4'; video.write_bytes(b'video')
            mix = self.root/f'{uid}-mix.wav'; mix.write_bytes(b'mix')
            scenes.append({'id': f'scene_{i+1}', 'text': text, 'frames': frames, 'path': video.name,
                'audio': {'path': mix.name, 'sha256': digest(mix)}, 'usedResources': [],
                'captions': [{'text': text, 'startSeconds': 0, 'endSeconds': 1}],
                'resolvedVisualBlocks': [{'id': 'body', 'startFrame': 0, 'endFrameExclusive': 10}]})
        tail = project/'public/template-assets/tail.mp4'; tail.write_bytes(b'tail')
        media = {'path': tail, 'frames': 5, 'sha256': digest(tail), 'hasAudio': True, 'audioInfo': None}
        if outro:
            scenes[-1]['usedResources'] = [{'id': 'tail', 'kind': 'generated',
                                         'path': str(tail.relative_to(self.root)), 'sha256': digest(tail)}]
            scenes[-1]['resolvedVisualBlocks'].append({'id': 'outro', 'startFrame': 10, 'endFrameExclusive': 15})
        write(request_path.parent/'timeline.json', timeline)
        return request, {'scenes': scenes}, timeline, media

    def run_check(self, request, manifest, media, *, samples=100):
        with patch('stage_media.audio_info', return_value={'durationSeconds': 1, 'samples': samples, 'sampleRate': 100}), \
             patch('stage_media.inspect_outro', return_value=media), \
             patch('stage_media.verify_appended_outro', return_value={'passed': True}) as verify:
            result = check_timeline(self.root, request, manifest)
        return result, verify

    def test_new_policy_checks_final_media_pcm_and_keeps_no_outro_legal(self):
        request, manifest, timeline, media = self.prepare()
        result, verify = self.run_check(request, manifest, media)
        self.assertEqual(result['frames'], 25)
        verify.assert_called_once()
        self.assertEqual(verify.call_args.args[3]['appendFromFrame'], 10)
        timeline['ending'].pop('outro'); timeline['totalFrames'] = 20
        timeline['scenes'][-1].update(endFrameExclusive=20, contentFrames=10)
        write(self.root/f'render/{request["runId"]}/timeline.json', timeline)
        manifest['scenes'][-1]['frames'] = 10
        result, verify = self.run_check(request, manifest, media)
        self.assertEqual(result['frames'], 20); verify.assert_not_called()

    def test_new_policy_rejects_forged_timing_source_and_missing_tail_resource(self):
        request, manifest, timeline, media = self.prepare()
        original = copy.deepcopy(timeline)
        for change in (lambda t: t['ending'].update(holdFrame=8),
                       lambda t: t['ending'].update(narrationEndFrame=19),
                       lambda t: t['scenes'][-1].update(contentFrames=16),
                       lambda t: t['scenes'][-1].update(outro={'src': 'old.mov'})):
            bad = copy.deepcopy(original); change(bad)
            write(self.root/f'render/{request["runId"]}/timeline.json', bad)
            with self.assertRaises(StageError): self.run_check(request, manifest, media)
        write(self.root/f'render/{request["runId"]}/timeline.json', original)
        with self.assertRaises(StageError): self.run_check(request, manifest, media, samples=89)
        manifest['scenes'][-1]['usedResources'] = []
        with self.assertRaisesRegex(StageError, '未登记'): self.run_check(request, manifest, media)

    def test_new_policy_rejects_scene_outro_even_when_ending_is_absent(self):
        request, manifest, timeline, media = self.prepare(outro=False)
        timeline.pop('ending'); timeline['scenes'][-1]['outro'] = {'src': 'old.mov'}
        write(self.root/f'render/{request["runId"]}/timeline.json', timeline)
        with self.assertRaisesRegex(StageError, '正文分镜内'): self.run_check(request, manifest, media)

    def test_old_frozen_template_does_not_require_new_ending_fields(self):
        request, manifest, timeline, media = self.prepare(policy=None, outro=False)
        timeline.pop('ending')
        write(self.root/f'render/{request["runId"]}/timeline.json', timeline)
        _, verify = self.run_check(request, manifest, media)
        verify.assert_not_called()

    def test_unmanaged_check_uses_bound_render_marker_project_and_rejects_stale_marker(self):
        from stage_media import project_fingerprint
        request, manifest, timeline, media = self.prepare()
        custom = self.root/'project/custom'
        (self.root/'project/renderer').rename(custom)
        for scene in timeline['scenes']:
            for utterance in scene['utterances']:
                utterance['audioPath'] = utterance['audioPath'].replace('project/renderer/', 'project/custom/')
        source = self.root/f'render/{request["runId"]}/timeline.json'; write(source, timeline)
        media['path'] = custom/'public/template-assets/tail.mp4'
        manifest['scenes'][-1]['usedResources'][0]['path'] = str(media['path'].relative_to(self.root))
        for scene in manifest['scenes']:
            video = self.root/scene['path']; scene['sha256'] = digest(video)
            write(video.with_suffix('.render.json'), {'sha256': scene['sha256'], 'timelineHash': digest(source),
                  'project': 'project/custom', 'projectHash': json_digest(project_fingerprint(custom))})
        result, verify = self.run_check(request, manifest, media)
        self.assertEqual(result['frames'], 25); verify.assert_called_once()
        marker_path = (self.root/manifest['scenes'][-1]['path']).with_suffix('.render.json')
        marker = read(marker_path); marker['timelineHash'] = 'stale'; write(marker_path, marker)
        with self.assertRaisesRegex(StageError, '正式时间轴不一致'):
            self.run_check(request, manifest, media)

class WorkerBridgeTests(Fixture):
    def test_readonly_check_has_no_result_or_lock_side_effect(self):
        before={str(p.relative_to(self.job)):digest(p) for p in self.job.rglob('*') if p.is_file()}
        report=check(self.request,'analysis/plan.json')
        after={str(p.relative_to(self.job)):digest(p) for p in self.job.rglob('*') if p.is_file()}
        self.assertTrue(report['passed']);self.assertEqual(before,after)

    def test_trusted_cache_is_outside_workspace_and_voices_follow_role_config(self):
        request=self.render_request();script=self.job/'dialogue.json';cache=self.base/'trusted-ledger'
        cache.mkdir();audio=cache/'audio.mp3';audio.write_bytes(b'test-provider-audio')
        write(script,[{'id':'a','sceneId':'scene_1','text':'第一句。','role':'male','speaker':'male-choice'},
                      {'id':'b','sceneId':'scene_2','text':'第二句。','role':'female','speaker':'female-choice'}])
        calls=[]
        def fake(text,speaker,resource,directory):
            calls.append((text,speaker,directory))
            return {'path':str(audio),'cacheKey':speaker,'requestId':speaker,'reused':False,
                    'audio':{'sha256':digest(audio),'durationSeconds':1}}
        with patch('stage_tts.get_tts_role_voices',return_value={'male':'male-choice','female':'female-choice'}), \
             patch('stage_tts.synthesize_cached',side_effect=fake):
            result=generate(request,script,cache_root=cache)
        self.assertEqual([x[1] for x in calls],['male-choice','female-choice'])
        self.assertTrue(all(x[2]==cache for x in calls))
        self.assertTrue(all(x['path'].startswith('tool-audio/') for x in result['clips']))
        self.assertFalse((self.job/'cache/tts').exists())

    def test_analysis_or_unconfirmed_text_never_calls_provider(self):
        script=self.job/'dialogue.json'
        write(script,[{'id':'a','sceneId':'scene_1','text':'擅自改稿','speaker':'male'}])
        with patch('stage_tts.synthesize_cached') as provider:
            with self.assertRaises(StageError):generate(self.request,script,cache_root=self.base/'ledger')
            with self.assertRaises(StageError):generate(self.render_request(),script,cache_root=self.base/'ledger')
            provider.assert_not_called()
