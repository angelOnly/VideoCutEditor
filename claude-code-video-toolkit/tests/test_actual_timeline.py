"""实测时间轴、采样边界与调整预算回归；不调用收费 TTS。"""
import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools'))
from actual_timeline import sample_frames, resolve_speech, content_frames, extend_timeline, check_fixed_ending
from two_stage import StageError, execution, read, write
from stage_media import check_speech_coverage, derive_timeline, scene_audio_contract
from test_two_stage import Fixture


class ActualTimelineTests(unittest.TestCase):
    @staticmethod
    def ending_timeline(outro=True):
        result = {'fps': 30, 'withBgm': False, 'totalFrames': 75 if outro else 65, 'scenes': [
            {'id': 'body', 'from': 0, 'frames': 30, 'contentFrames': 30,
             'utterances': [{'id': 'body-u', 'startFrame': 0, 'endFrameExclusive': 30}]},
            {'id': 'closing-a', 'from': 30, 'frames': 20, 'contentFrames': 20,
             'utterances': [{'id': 'closing-u1', 'startFrame': 0, 'endFrameExclusive': 20}]},
            {'id': 'closing-b', 'from': 50, 'frames': 25 if outro else 15, 'contentFrames': 25 if outro else 15,
             'utterances': [{'id': 'closing-u2', 'startFrame': 0, 'endFrameExclusive': 15}]}],
            'ending': {'closingUtteranceIds': ['closing-u1', 'closing-u2'], 'holdFrame': 29, 'narrationEndFrame': 65}}
        if outro:
            result['ending']['outro'] = {'src': 'outro.mp4', 'frames': 10, 'muted': False}
        return result

    def test_serial_ending_uses_body_frame_and_all_narration_before_outro(self):
        timeline = self.ending_timeline()
        before = copy.deepcopy(timeline)
        bounds = check_fixed_ending(timeline)
        self.assertEqual(bounds['holdFrame'], 29)
        self.assertEqual(bounds['appendFromFrame'], 15)
        self.assertEqual(bounds['outroFrames'], 10)
        self.assertEqual(bounds['lastSceneId'], 'closing-b')
        self.assertEqual(timeline, before)
        self.assertEqual(check_fixed_ending(self.ending_timeline(False))['outroFrames'], 0)

    def test_ending_handles_no_closing_without_freezing_body(self):
        timeline = self.ending_timeline()
        timeline['ending']['closingUtteranceIds'] = []
        timeline['ending'].pop('holdFrame')
        self.assertIsNone(check_fixed_ending(timeline)['holdFrame'])
        timeline['ending']['holdFrame'] = 29
        with self.assertRaisesRegex(StageError, '不能冻结'):
            check_fixed_ending(timeline)
        self.assertIsNone(check_fixed_ending({'scenes': []}))
        with self.assertRaises(StageError):
            check_fixed_ending({}, required=True)

    def test_same_scene_closing_includes_natural_pause_but_never_retimes_speech(self):
        timeline = self.ending_timeline()
        scene = {'id': 'all', 'startFrame': 0, 'endFrameExclusive': 75, 'contentFrames': 75,
                 'utterances': [{'id': 'body-u', 'startFrame': 0, 'endFrameExclusive': 30},
                                {'id': 'closing-u1', 'startFrame': 35, 'endFrameExclusive': 50},
                                {'id': 'closing-u2', 'startFrame': 50, 'endFrameExclusive': 65}]}
        timeline['scenes'] = [scene]
        before = copy.deepcopy(timeline)
        bounds = check_fixed_ending(timeline)
        self.assertEqual(bounds['holdFrame'], 29)
        self.assertEqual(bounds['appendFromFrame'], 65)
        self.assertEqual(timeline, before)

    def test_ending_rejects_wrong_ids_coordinates_and_old_scene_outro(self):
        mutations = [
            lambda t: t['ending'].update(closingUtteranceIds=['closing-u2', 'closing-u1']),
            lambda t: t['ending'].update(closingUtteranceIds=['closing-u1']),
            lambda t: t['ending'].update(closingUtteranceIds=['missing']),
            lambda t: t['ending'].update(holdFrame=20),
            lambda t: t['ending'].update(narrationEndFrame=64),
            lambda t: t['scenes'][-1].update(contentFrames=26),
            lambda t: t['scenes'][0].update(outro={'src': 'old.mov'}),
            lambda t: t['scenes'][-1]['utterances'][0].update(id='body-u'),
            lambda t: t['ending']['outro'].update(frames=True),
        ]
        for change in mutations:
            with self.subTest(change=change):
                timeline = self.ending_timeline()
                change(timeline)
                with self.assertRaises(StageError):
                    check_fixed_ending(timeline)

    def test_extension_moves_global_ending_but_does_not_reappend_tail(self):
        timeline = self.ending_timeline()
        result = extend_timeline(timeline, {'body': 32, 'closing-a': 23, 'closing-b': 30})
        self.assertEqual(result['ending']['holdFrame'], 29)
        self.assertEqual(result['ending']['narrationEndFrame'], 70)
        self.assertEqual(result['ending']['outro']['frames'], 10)
        self.assertEqual(result['scenes'][-1]['contentFrames'], 25)
        self.assertEqual(result['totalFrames'], 85)
        self.assertEqual(check_fixed_ending(result)['appendFromFrame'], 15)
        self.assertEqual(extend_timeline(result, {'closing-b': 30}), result)

    def test_extension_at_exact_voice_end_is_only_packaging_padding(self):
        timeline = self.ending_timeline(False)
        result = extend_timeline(timeline, {'closing-b': 18})
        self.assertEqual(result['ending']['narrationEndFrame'], 65)
        self.assertEqual(result['totalFrames'], 68)
        self.assertEqual(result['scenes'][-1]['contentFrames'], 15)

    def test_extension_accepts_canonical_coordinates_and_syncs_aliases(self):
        timeline = self.ending_timeline()
        for scene in timeline['scenes']:
            scene['startFrame'] = scene.pop('from')
            scene['endFrameExclusive'] = scene['startFrame'] + scene.pop('frames')
        original = copy.deepcopy(timeline)
        result = extend_timeline(timeline, {'body': 32})
        self.assertEqual(timeline, original)
        self.assertEqual(result['ending']['narrationEndFrame'], 67)
        self.assertEqual(result['scenes'][-1]['from'], 52)
        self.assertEqual(result['scenes'][-1]['endFrameExclusive'], 77)
        self.assertEqual(check_fixed_ending(result)['outroFrames'], 10)

    def test_source_audio_must_fit_before_remotion_can_mix_it(self):
        scene={'frames':327,'utterances':[{'id':'u','src':'voice.wav','startFrame':0,'endFrameExclusive':327}]}
        with patch('stage_media.local',return_value=Path('voice.wav')), patch('stage_media.audio_info',return_value={'samples':523216,'sampleRate':48000}):
            with self.assertRaises(StageError) as error:check_speech_coverage(Path('.'),{'scene':scene},327,30)
            self.assertEqual(error.exception.code,'CONTENT_TIMELINE_REQUIRED')
            scene['frames']=328;scene['utterances'][0]['endFrameExclusive']=328
            check_speech_coverage(Path('.'),{'scene':scene},328,30)

    def test_untrimmed_sfx_requires_full_measured_window(self):
        scene={'frames':180,'contentFrames':150,'utterances':[], 'sfx':[{'src':'long.wav','frame':30}]}
        with patch('stage_media.local',return_value=Path('long.wav')), patch('stage_media.audio_info',return_value={'samples':240000,'sampleRate':48000}):
            with self.assertRaises(StageError):check_speech_coverage(Path('.'),{'scene':scene},180,30)
            scene['contentFrames']=180
            check_speech_coverage(Path('.'),{'scene':scene},180,30)
            scene['contentFrames']=60;scene['sfx'][0]['durationFrames']=30
            check_speech_coverage(Path('.'),{'scene':scene},180,30)

    def test_integer_samples_do_not_add_frame_at_exact_boundary(self):
        self.assertEqual(sample_frames(521856,48000,30),327)
        self.assertEqual(sample_frames(523200,48000,30),327)
        self.assertEqual(sample_frames(523216,48000,30),328)

    def test_estimates_and_old_frame_windows_never_decide_speech(self):
        for estimate in (1,100,1000):
            utterances=[{'id':'a','text':'原稿。','timing':{'kind':'estimated','totalSeconds':estimate},
                         'startFrame':0,'endFrameExclusive':estimate*30}]
            resolved=resolve_speech(utterances,{'a':{'samples':521856,'sampleRate':48000}},30)
            self.assertEqual(resolved['speechEndFrame'],327)
            self.assertEqual(resolved['captions'][0]['endFrameExclusive'],327)

    def test_parallel_media_maximum_and_explicit_gaps(self):
        resolved=resolve_speech([{'id':'a','text':'甲','gapBeforeFrames':5},{'id':'b','text':'乙'}],
                                {'a':{'samples':48000,'sampleRate':48000},'b':{'samples':48000,'sampleRate':48000}},30,10)
        self.assertEqual(resolved['speechEndFrame'],75)
        self.assertEqual(content_frames(75,[{'from':0,'frames':67}]),75)
        with self.assertRaises(StageError):content_frames(75,[{'from':0,'frames':100,'loop':True}])

    def test_extension_shifts_chapter_anchors_not_captions(self):
        caption={'utteranceId':'u','text':'原文','startFrame':0,'endFrameExclusive':327}
        t={'totalFrames':357,'scenes':[{'id':'a','from':0,'frames':327,'captions':[caption]},
                                      {'id':'b','from':327,'frames':30}],
           'chapters':[{'from':0,'endFrameExclusive':357,'visualBlocks':[{'startFrame':0,'endFrameExclusive':357,
            'props':{'itemFrames':[0,327],'revealFrame':327}}]}]}
        original=copy.deepcopy(t);result=extend_timeline(t,{'a':328})
        self.assertEqual(t,original)
        self.assertEqual(result['totalFrames'],358)
        self.assertEqual(result['scenes'][0]['contentFrames'],327)
        self.assertEqual(result['scenes'][0]['captions'],[caption])
        self.assertEqual(result['scenes'][1]['from'],328)
        block=result['chapters'][0]['visualBlocks'][0]
        self.assertEqual(block['endFrameExclusive'],358)
        self.assertEqual(block['props']['itemFrames'],[0,328])
        self.assertEqual(block['props']['revealFrame'],328)
        self.assertEqual(extend_timeline(t,{'a':340})['scenes'][1]['from'],340)
        again=extend_timeline(result,{'a':329})
        self.assertEqual(again['scenes'][0]['frames'],329)
        self.assertEqual(again['scenes'][0]['captions'],[caption])
        self.assertEqual(extend_timeline(again,{'a':329}),again)


class AdjustmentBudgetTests(Fixture):
    def test_derive_preserves_ending_and_never_adds_outro_twice(self):
        request = self.render_request()
        project = self.root/'project/renderer'
        (project/'src').mkdir(parents=True)
        (project/'public').mkdir()
        audio = project/'public/a.wav'; audio.write_bytes(b'fixture')
        timeline = ActualTimelineTests.ending_timeline()
        for scene in timeline['scenes']:
            scene['startFrame'] = scene['from']
            scene['endFrameExclusive'] = scene['from'] + scene['frames']
            for u in scene['utterances']:
                u.update(src='a.wav', audioPath='project/renderer/public/a.wav')
        source = request.parent/'timeline.json'; write(source, timeline)
        before = source.read_bytes()
        for _ in range(2):
            derive_timeline(self.root, request, str(source.relative_to(self.root)), 'project/renderer')
            self.assertEqual(source.read_bytes(), before)
            props = read(request.parent/'scene-03-props.json')
            self.assertEqual(props['timeline']['ending'], timeline['ending'])
            self.assertEqual(props['timeline']['totalFrames'], 75)
            self.assertEqual(props['scene']['frames'], 25)

    def test_derived_template_input_never_rewrites_canonical_timeline(self):
        request=self.render_request()
        project=self.root/'project/renderer'
        (project/'src').mkdir(parents=True)
        (project/'public').mkdir()
        (project/'public/a.wav').write_bytes(b'fixture')
        timeline={'withBgm':False,'totalFrames':30,'scenes':[{'id':'scene_1','startFrame':0,'endFrameExclusive':30,
            'contentFrames':20,'utterances':[{'id':'u','src':'a.wav','audioPath':'project/renderer/public/a.wav'}]}]}
        source=request.parent/'timeline.json'
        write(source,timeline)
        before=source.read_bytes()
        derive_timeline(self.root,request,str(source.relative_to(self.root)),'project/renderer')
        self.assertEqual(source.read_bytes(),before)
        props=read(request.parent/'scene-01-props.json')
        self.assertEqual(props['scene']['frames'],30)
        self.assertEqual(props['scene']['contentFrames'],20)
        self.assertIs(props['withBgm'],False)
        self.assertNotIn('audioPath',props['scene']['utterances'][0])
        self.assertEqual(read(source)['scenes'][0]['utterances'][0]['audioPath'],'project/renderer/public/a.wav')

    def test_managed_tools_only_record_events_and_do_not_double_charge(self):
        request=self.render_request()
        root=request.parents[2]
        write(root/'.control/policy.json', {'budgetOwner':'worker'})
        for _ in range(4):
            with self.assertRaises(StageError) as error:
                with execution(request,'render:scene_1'):
                    raise StageError('RENDER_FAILED','当前工程语法错误')
            self.assertEqual(error.exception.code,'RENDER_FAILED')
        state=read(root/'.control/execution.json')
        self.assertEqual(state['repairRounds'],0)
        self.assertEqual(len(state['events']),4)
        self.assertNotIn('stopReason',state)

    def test_adjustment_does_not_spend_repairs_and_repetition_stops(self):
        request=self.render_request()
        details={'currentFrames':327,'requiredFrames':328,'mixSha256':'fixture'}
        with self.assertRaises(StageError):
            with execution(request,'render:scene_1'):
                raise StageError('TIMELINE_EXTEND_REQUIRED','补帧',details=details)
        state=read(request.parent/'execution.json')
        self.assertEqual(state['repairRounds'],0)
        self.assertEqual(len(state['timelineAdjustments']),1)
        with self.assertRaises(StageError) as error:
            with execution(request,'render:scene_1'):
                raise StageError('TIMELINE_EXTEND_REQUIRED','补帧',details=details)
        self.assertEqual(error.exception.code,'TIMELINE_ADJUSTMENT_STALLED')

    def test_successful_adjustment_can_continue_without_spending_repairs(self):
        request=self.render_request()
        with self.assertRaises(StageError):
            with execution(request,'render:scene_1'):
                raise StageError('TIMELINE_EXTEND_REQUIRED','补帧',details={'requiredFrames':328})
        with execution(request,'render:scene_1'):pass
        self.assertEqual(read(request.parent/'execution.json')['repairRounds'],0)


if __name__=='__main__':unittest.main()

class TemplateBoundaryTests(Fixture):
    def prepare_timeline(self, sentence_audio=False):
        request=self.render_request()
        timeline={'fps':10,'scenes':[{'id':'scene_1','startFrame':0,'endFrameExclusive':10,
            'utterances':[{'id':'u','text':'第一句。','src':'voice.wav','startFrame':0,'endFrameExclusive':10}],
            'captions':[{'text':'第一','startFrame':0,'endFrameExclusive':5},
                        {'text':'句。','startFrame':5,'endFrameExclusive':10}]}]}
        write(request.parent/'timeline.json',timeline)
        (self.root/'voice.wav').write_bytes(b'fixture')
        req=read(request)
        if sentence_audio:
            template=read(self.root/req['input']['templateSnapshot'])
            template['root']='input/template'
            write(self.root/req['input']['templateSnapshot'],template)
            write(self.root/'input/template/renderer/renderer-manifest.json',{'sentenceAudioValidator':'scripts/verify.mjs'})
        manifest={'scenes':[{'id':'scene_1','text':'第一句。','frames':10,
                  'captions':[{'text':'第一','startSeconds':0,'endSeconds':.5},{'text':'句。','startSeconds':.5,'endSeconds':1}]}]}
        return req,manifest

    def test_generic_template_allows_multiple_caption_pages(self):
        from worker_stage import check_timeline
        request,manifest=self.prepare_timeline()
        with patch('stage_media.audio_info',return_value={'durationSeconds':1}):
            self.assertEqual(check_timeline(self.root,request,manifest)['frames'],10)

    def test_declared_sentence_template_keeps_strict_boundary(self):
        from worker_stage import check_timeline
        request,manifest=self.prepare_timeline(True)
        with self.assertRaises(StageError), patch('stage_media.audio_info',return_value={'durationSeconds':1}):
            check_timeline(self.root,request,manifest)

    def test_declared_template_accepts_audio_bound_alignment_and_rejects_tampering(self):
        from worker_stage import check_timeline
        from two_stage import digest
        request,manifest=self.prepare_timeline(True)
        file=self.root/f'render/{request["runId"]}/timeline.json'
        timeline=read(file)
        scene=timeline['scenes'][0]
        for c in scene['captions']:c['utteranceId']='u'
        evidence={'method':'forced_alignment','utterances':{'u':{'audioSha256':digest(self.root/'voice.wav'),
            'captions':[{k:c[k] for k in ('text','startFrame','endFrameExclusive')} for c in scene['captions']]}}}
        alignment=self.root/'project/alignment.json';write(alignment,evidence)
        scene['captionTiming']={'path':'project/alignment.json','src':'alignment.json','sha256':digest(alignment)}
        write(file,timeline)
        with patch('stage_media.audio_info',return_value={'durationSeconds':1}):
            self.assertEqual(check_timeline(self.root,request,manifest)['frames'],10)
            evidence['utterances']['u']['audioSha256']='wrong';write(alignment,evidence)
            scene['captionTiming']['sha256']=digest(alignment);write(file,timeline)
            with self.assertRaisesRegex(StageError,'音频不符'):check_timeline(self.root,request,manifest)
