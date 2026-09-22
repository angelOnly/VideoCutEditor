"""实测时间轴、采样边界与调整预算回归；不调用收费 TTS。"""
import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools'))
from actual_timeline import sample_frames, resolve_speech, content_frames, extend_timeline
from two_stage import StageError, execution, read, write
from stage_media import check_speech_coverage, derive_timeline, scene_audio_contract
from tests.test_two_stage import Fixture


class ActualTimelineTests(unittest.TestCase):
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
