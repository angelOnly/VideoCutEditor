"""新两阶段协议的行为测试；仅使用新建合成素材，不读取历史视频。"""
import copy
import errno
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
ENCODER='libx264' if 'libx264' in subprocess.check_output(['ffmpeg','-hide_banner','-encoders'],stderr=subprocess.DEVNULL,text=True) else 'h264_videotoolbox'
sys.path.insert(0,str(ROOT/'tools'))
from two_stage import (StageError, checkpoint, confirm, digest, init_job, json_digest, load_request,
                       local, read, repair, status, validate, write, execution, storyboard)
from cached_tts import synthesize_cached
from stage_media import supervise, ffmpeg, validate_mp4, extract_frames, validate_delivery, compare_audio, compare_samples, assemble, render_scene, mux_scene, publish_file


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.job=self.base/'job'
        for name,text in [('script.md','第一句。第二句。'),('requirements.md','保留原稿。'),('template.md','角色与布局由模板决定。')]:
            (self.base/name).write_text(text)
        self.spec={'taskId':'task_001','scriptFile':str(self.base/'script.md'),'requirementsFile':str(self.base/'requirements.md'),
                   'templateFile':str(self.base/'template.md'),'assets':[], 'outputSpec':{'width':320,'height':240,'fps':10}}
        self.request=Path(init_job(self.job,self.spec)['request'])
        self.root,self.r=load_request(self.request)
        self.plan={'contractVersion':'video-two-stage/1','taskId':'task_001','inputDigest':json_digest(self.r['snapshot']),
                   'scenes':[], 'nonspoken':[], 'previews':[], 'requirementsNotes':'保留全文，按实际音频制作。'}
        for i,text in enumerate(['第一句。','第二句。']):
            self.plan['scenes'].append({'id':f'scene_{i+1}','text':text,'sourceMapping':[{'start':i*4,'end':(i+1)*4,'unit':'unicode_codepoints'}],
                'timing':{'kind':'estimated','speechSeconds':1,'totalSeconds':1,'totalRangeSeconds':[.5,2],'basis':'尚未配音'},
                'assetRefs':[], 'production':{'speaker':f'host_{i}', 'visualBlocks':[{'id':'block_1','description':'当前分镜'}],
                'customTemplateData':{'something':[True,0,{'layout':'any'}]}}})
        self.plan_path=self.job/'analysis/plan.json';write(self.plan_path,self.plan)

    def render_request(self):
        validate(self.request,self.plan_path)
        return Path(confirm(self.request,self.plan_path,0,'测试外部确认')['request'])


class ContractTests(Fixture):
    def test_local_storyboard_preserves_text_and_stops(self):
        result_path=self.base/'text-result.json'
        write(result_path, {'status':'candidate','scenes':[{'text':'第一句。'},{'text':'第二句。'}],'error':None})
        result=storyboard(self.request,result_path)
        plan=read(self.plan_path)
        self.assertEqual(result['stage'],'analysis')
        self.assertEqual([s['id'] for s in plan['scenes']],['scene_001','scene_002'])
        self.assertTrue(all(s['production']=={} and s['assetRefs']==[] for s in plan['scenes']))
        self.assertFalse((self.job/'render').exists())
        for texts in (['第二句。','第一句。'],['第一句。'],['第一句。第二句。'],['改写。','第二句。']):
            write(result_path, {'status':'candidate','scenes':[{'text':t} for t in texts],'error':None})
            with self.assertRaises(StageError): storyboard(self.request,result_path)

    def test_analysis_ends_without_render_request(self):
        result=validate(self.request,self.plan_path)
        self.assertEqual(result['stage'],'analysis'); self.assertEqual(result['sceneCount'],2)
        self.assertFalse((self.job/'render').exists());self.assertFalse((self.job/'cache').exists())

    def test_render_requires_confirmation_and_frozen_input(self):
        with self.assertRaisesRegex(StageError,'禁止'):
            load_request(self.request,'render')
        render=self.render_request();root,r=load_request(render,'render')
        self.assertEqual(read(root/r['confirmation']['planFile']),self.plan)
        local(root,r['input']['scriptFile']).write_text('其他稿件')
        with self.assertRaises(StageError):load_request(render)

    def test_unknown_version_cannot_use_new_entry(self):
        data=read(self.request);data['contractVersion']='other';write(self.request,data)
        with self.assertRaises(StageError):load_request(self.request)

    def test_edit_confirm_keeps_template_fields_and_invalidates_old_run(self):
        first=self.render_request()
        changed=copy.deepcopy(self.plan);changed['scenes'][0]['text']='编辑改稿。';changed['scenes'][0]['editReason']='用户确认改稿'
        edited=self.job/'edited.json';write(edited,changed)
        second=Path(confirm(self.request,edited,1,'编辑确认第二版')['request'])
        _,r=load_request(second)
        self.assertEqual(read(self.job/r['confirmation']['planFile']),changed)
        with self.assertRaises(StageError) as error:load_request(first)
        self.assertEqual(error.exception.code,'STALE_CONFIRMATION')
        with self.assertRaises(StageError):confirm(self.request,edited,1,'重复旧确认')

    def test_confirmation_serializes_with_execution(self):
        render=self.render_request()
        with execution(render,'test'):
            with self.assertRaises(StageError) as error:confirm(self.request,self.plan_path,1,'冲突确认')
            self.assertEqual(error.exception.code,'TASK_BUSY')

    def test_no_confirmation_before_analysis_validation(self):
        with self.assertRaises(StageError):confirm(self.request,self.plan_path,0,'不能跳过分析')

    def test_plan_mutations_fail(self):
        mutations=[lambda p:p['scenes'].reverse(),lambda p:p['scenes'].pop(),lambda p:p['scenes'][0].update(text='擅改'),
                   lambda p:p['scenes'][0]['timing'].update(totalSeconds=3),
                   lambda p:p['scenes'][0]['assetRefs'].append('not_authorized'),
                   lambda p:p['scenes'][1].update(id='scene_1')]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                plan=copy.deepcopy(self.plan);mutate(plan);write(self.plan_path,plan)
                with self.assertRaises(StageError):validate(self.request,self.plan_path)

    def test_empty_production_is_valid(self):
        for scene in self.plan['scenes']: scene['production'] = {}
        write(self.plan_path,self.plan)
        self.assertEqual(validate(self.request,self.plan_path)['sceneCount'],2)

    def test_nonspoken_must_be_whitespace(self):
        self.plan['scenes']=self.plan['scenes'][:1]
        self.plan['nonspoken']=[{'start':4,'end':8,'text':'第二句。','reason':'不能删除口播'}]
        write(self.plan_path,self.plan)
        with self.assertRaises(StageError): validate(self.request,self.plan_path)

    def test_symlink_escape_and_request_tamper_fail(self):
        (self.job/'escape').symlink_to(self.base/'script.md')
        with self.assertRaises(StageError):local(self.job,'escape')
        modified=read(self.request);modified['stage']='render';write(self.request,modified)
        with self.assertRaises(StageError):load_request(self.request)

    def test_checkpoint_rechecks_actual_artifacts(self):
        checkpoint(self.request,'plan',['analysis/plan.json'])
        self.assertEqual(status(self.request)['verifiedSteps'],['plan'])
        self.plan_path.write_text('{}')
        self.assertEqual(status(self.request)['invalidSteps'],['plan'])

    def test_orphan_active_process_blocks_duplicate_execution(self):
        from two_stage import process_signature
        import signal
        render=self.render_request()
        child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True)
        try:
            write(render.parent/'work/current.process.json',{'state':'running','pid':child.pid,'signature':process_signature(child.pid)})
            self.assertEqual(status(render)['activeProcesses'][0]['pid'],child.pid)
            with self.assertRaises(StageError):
                with execution(render,'duplicate'):pass
        finally:
            os.killpg(child.pid,signal.SIGKILL);child.wait()

    def test_limits_persist_across_resume(self):
        render=self.render_request()
        with execution(render,'one'):pass
        before=read(render.parent/'execution.json')['elapsedSeconds']
        with execution(render,'two'):pass
        self.assertGreaterEqual(read(render.parent/'execution.json')['elapsedSeconds'],before)
        for _ in range(10):repair(render,'实际修复')
        with self.assertRaises(StageError):repair(render,'不能重置预算')
        with self.assertRaises(StageError):
            with execution(render,'不能绕过修复预算'):pass

    def test_tool_failures_stop_same_turn_without_explicit_repair(self):
        render=self.render_request()
        for i in range(3):
            with self.assertRaises(StageError) as error:
                with execution(render,'render:scene_1'):
                    raise StageError('AUDIO_MISMATCH','音频不同步',details={'deltaMs':42})
            self.assertEqual(error.exception.code,'REPAIR_BUDGET_EXHAUSTED' if i==2 else 'AUDIO_MISMATCH')
        state=read(render.parent/'execution.json')
        self.assertEqual(state['repairRounds'],3);self.assertTrue(state['stopReason'])
        with self.assertRaises(StageError):
            with execution(render,'render:scene_2'):self.fail('预算耗尽后仍执行')
        self.assertEqual(len(read(render.parent/'execution.json')['operations']),3)

    def test_success_resets_consecutive_failures_but_not_total_budget(self):
        render=self.render_request()
        for _ in range(2):
            with self.assertRaises(StageError):
                with execution(render,'render:scene_1'):raise StageError('MEDIA_INVALID','失败')
        with execution(render,'render:scene_1'):pass
        with self.assertRaises(StageError):
            with execution(render,'render:scene_1'):raise StageError('MEDIA_INVALID','新失败')
        state=read(render.parent/'execution.json')
        self.assertEqual(state['repairRounds'],3)
        self.assertEqual(state['failures']['render:scene_1']['consecutive'],1)
        self.assertNotIn('stopReason',state)

    def test_zero_retry_budget_allows_initial_work_but_no_retry(self):
        self.spec['limits']={'executionSeconds':60,'repairRounds':0}
        self.request=Path(init_job(self.base/'no-retry',self.spec)['request']);self.job=self.request.parent.parent
        self.plan_path=self.job/'analysis/plan.json';write(self.plan_path,self.plan)
        render=self.render_request()
        with execution(render,'render:scene_1'):pass
        with self.assertRaises(StageError):
            with execution(render,'render:scene_2'):raise StageError('MEDIA_INVALID','首次失败')
        with self.assertRaises(StageError):
            with execution(render,'render:scene_2'):self.fail('零修复预算仍重试')

    def test_formal_tts_rejects_analysis_before_any_provider_call(self):
        from stage_tts import generate
        with patch('stage_tts.synthesize_cached') as paid:
            with self.assertRaises(StageError):generate(self.request,self.job/'missing.json')
            paid.assert_not_called()

    def test_analysis_rejects_tts_ledger(self):
        write(self.job/'cache/tts/whatever/request.json',{'state':'pending'})
        with self.assertRaises(StageError):validate(self.request,self.plan_path)


class TTSCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.calls=[]
    def fake(self,text,path,**kwargs):
        self.calls.append((text,kwargs));Path(path).write_bytes(text.encode()+b'audio');return {'success':True}
    def inspect(self,path):return {'sha256':digest(path),'durationSeconds':1,'sampleRate':24000}
    def call(self,text='原文',speaker='female',generate=None):
        return synthesize_cached(text,speaker,'model',self.root,generate or self.fake,self.inspect)
    def test_exact_cache_hits_and_parameter_changes_miss(self):
        first=self.call();second=self.call();self.call('新文本');self.call(speaker='male')
        self.assertFalse(first['reused']);self.assertTrue(second['reused']);self.assertEqual(len(self.calls),3)
        self.assertEqual(first['requestId'],second['requestId'])
    def test_pending_request_never_retries(self):
        def interrupted(*args,**kwargs):raise RuntimeError('连接中断')
        with self.assertRaises(RuntimeError):self.call(generate=interrupted)
        with self.assertRaises(StageError) as error:self.call()
        self.assertEqual(error.exception.code,'EXTERNAL_RESULT_UNKNOWN');self.assertEqual(len(self.calls),0)
    def test_corrupt_success_does_not_charge_again(self):
        result=self.call();Path(result['path']).write_bytes(b'corrupt')
        with self.assertRaises(StageError):self.call()
        self.assertEqual(len(self.calls),1)
    def test_provider_unknown_is_not_retryable(self):
        with self.assertRaises(StageError):self.call(generate=lambda *a,**kw:{'success':False,'submitted':True,'error':'timeout'})
        with self.assertRaises(StageError):self.call()
        self.assertEqual(len(self.calls),0)
    def test_not_submitted_can_be_retried(self):
        with self.assertRaises(StageError):self.call(generate=lambda *a,**kw:{'success':False,'submitted':False,'error':'no credential'})
        self.assertEqual(self.call()['attempts'],2)


class DialogueCompatibilityTests(unittest.TestCase):
    def test_invalid_later_entry_fails_before_first_paid_request(self):
        import generate_dialogue_audio as dialogue
        from argparse import Namespace
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);script=root/'dialogue.json'
            write(script,[{'id':'a','role':'female','text':'第一句'}, {'id':'b','role':'unsupported','text':'第二句'}])
            args=Namespace(script=str(script),output_dir=str(root/'audio'),manifest=str(root/'manifest.json'),
                           female_speaker='female',male_speaker='male',fps=30,force=False)
            with patch.object(dialogue,'parse_args',return_value=args), patch('cached_tts.synthesize_cached') as paid:
                self.assertEqual(dialogue.main(),1);paid.assert_not_called()

    def test_unverified_legacy_clip_does_not_silently_regenerate(self):
        import generate_dialogue_audio as dialogue
        from argparse import Namespace
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'audio').mkdir();(root/'audio/a-female.mp3').write_bytes(b'old')
            (root/'audio/.tts-cache').mkdir()
            write(root/'dialogue.json',[{'id':'a','role':'female','text':'第一句'}])
            args=Namespace(script=str(root/'dialogue.json'),output_dir=str(root/'audio'),manifest=str(root/'manifest.json'),
                           female_speaker='female',male_speaker='male',fps=30,force=False)
            with patch.object(dialogue,'parse_args',return_value=args), patch('cached_tts.synthesize_cached') as paid:
                with self.assertRaises(ValueError):dialogue.main()
                paid.assert_not_called()


class SupervisorTests(unittest.TestCase):
    def test_closing_timeout_reclaims_only_own_process_group(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);done=p/'done.json'
            code='import pathlib,time;pathlib.Path('+repr(str(done))+').write_text("{}");time.sleep(20)'
            result=supervise([sys.executable,'-c',code],p,p/'log',done,timeout=5,close_timeout=.15)
            self.assertTrue(result['closeTimedOut'])
            with self.assertRaises(ProcessLookupError):os.kill(result['pid'],0)
    def test_no_done_marker_cannot_be_success(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)
            with self.assertRaises(StageError):supervise([sys.executable,'-c','pass'],p,p/'log',p/'none',1)
    def test_timeout_reclaims_process(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)
            with self.assertRaises(StageError) as error:supervise([sys.executable,'-c','import time; time.sleep(20)'],p,p/'log',p/'none',.2)
            self.assertEqual(error.exception.code,'RENDER_TIMEOUT')


class AudioDiagnosticsTests(unittest.TestCase):
    def test_delay_is_reported_but_never_compensated_to_pass(self):
        import random
        rng=random.Random(7); values=[]; previous=0
        for _ in range(16000):
            previous=round(.92*previous+.08*rng.randint(-12000,12000));values.append(previous)
        shifted=[0]*341+values
        with self.assertRaises(StageError) as error:compare_samples(values,shifted)
        self.assertEqual(error.exception.code,'AUDIO_MISMATCH')
        self.assertAlmostEqual(error.exception.details['estimatedOffsetMs'],42.625,delta=.2)
        self.assertLess(error.exception.details['correlationAtZero'],.9)


class PublishFileTests(unittest.TestCase):
    def test_cross_device_publish_copies_then_replaces(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); source=root/'render'/'scene.mp4'; destination=root/'output'/'scene.mp4'
            source.parent.mkdir();source.write_bytes(b'completed-media')
            real_replace=os.replace
            calls=0
            def replace_once_cross_device(current, target):
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise OSError(errno.EXDEV, '跨设备链接')
                real_replace(current,target)
            with patch('stage_media.os.replace', side_effect=replace_once_cross_device) as replace:
                publish_file(source,destination)
            self.assertEqual(destination.read_bytes(),b'completed-media')
            self.assertEqual(replace.call_count,2)


class MediaTests(Fixture):
    def setUp(self):
        super().setUp()
        self.render=self.render_request();self.root,self.req=load_request(self.render)
        self.manifest={k:self.req[k] for k in ('contractVersion','taskId','runId','stage')}
        self.manifest.update(confirmedPlanSha256=self.req['confirmation']['planSha256'],planVersion=1,scenes=[],wholeVideo=None,quality='render/render_001/review.json')
        self.review={**{k:self.manifest[k] for k in ('contractVersion','taskId','runId','stage','confirmedPlanSha256')},
                     'passed':True,'humanListeningPerformed':False,'limitations':['测试合成媒体不表示主观效果通过'],'scenes':[]}
        folder=self.job/'output/render_001/scenes';folder.mkdir(parents=True)
        for i,scene in enumerate(self.plan['scenes']):
            wav=folder/(scene['id']+'.wav');video=folder/(scene['id']+'.mp4')
            ffmpeg('-f','lavfi','-i',f'sine=frequency={440+i*220}:sample_rate=48000','-t','1',wav)
            ffmpeg('-f','lavfi','-i',f'color=c={"blue" if i==0 else "red"}:s=320x240:r=10','-i',wav,'-t','1',
                   '-c:v',ENCODER,*(['-allow_sw','1'] if ENCODER == 'h264_videotoolbox' else []),'-pix_fmt','yuv420p','-c:a','aac',video)
            evidence=extract_frames(self.job,self.req,scene['id'],video,10)
            self.manifest['scenes'].append({'id':scene['id'],'text':scene['text'],'path':str(video.relative_to(self.job)),
                'sha256':digest(video),'frames':10,'durationSeconds':1,'usedResources':[],
                'resolvedVisualBlocks':[{'id':'block_1','startFrame':0,'endFrameExclusive':10}],
                'audio':{'text':scene['text'],'path':str(wav.relative_to(self.job)),'sha256':digest(wav)},
                'captions':[{'text':scene['text'],'startSeconds':0,'endSeconds':1}], 'evidence':evidence})
            self.review['scenes'].append({'id':scene['id'],'videoSha256':digest(video),'viewedFrames':[0,5,9],
                                         'passed':True,'notes':'仅用于机械校验的测试审查记录，不是人眼验收'})
        write(self.job/self.manifest['quality'],self.review)
    def test_complete_manifest_checks_real_media(self):
        result=validate_delivery(self.job,self.req,self.manifest)
        self.assertEqual(result['sceneCount'],2);self.assertEqual(result['frames'],20)
    def test_whole_video_preserves_scene_boundaries_and_audio(self):
        manifest_path=self.render.parent/'manifest.json';write(manifest_path,self.manifest)
        whole=assemble(self.render,manifest_path)
        self.assertEqual(whole['frames'],20)
        report=validate(self.render,manifest_path)
        self.assertEqual(report['status'],'candidate')

    def test_creation_blocks_can_change(self):
        self.manifest['scenes'][0]['resolvedVisualBlocks'][0]['id'] = 'new_creative_block'
        self.assertEqual(validate_delivery(self.job,self.req,self.manifest)['sceneCount'],2)

    def test_authorized_assets_are_optional_but_explicit_assets_are_required(self):
        audio=self.manifest['scenes'][0]['audio']
        resource={'id':'optional','kind':'source','path':audio['path'],'sha256':audio['sha256']}
        write(self.job/self.req['input']['assetsManifest'], {'assets':[{'id':'optional','path':audio['path'],'sha256':audio['sha256']}]})
        self.manifest['scenes'][0]['usedResources']=[resource]
        self.assertEqual(validate_delivery(self.job,self.req,self.manifest)['sceneCount'],2)
        resource['id']='unauthorized'
        with self.assertRaises(StageError):validate_delivery(self.job,self.req,self.manifest)
        resource['id']='optional'
        plan=read(self.job/self.req['confirmation']['planFile']);plan['scenes'][1]['assetRefs']=['optional']
        write(self.job/self.req['confirmation']['planFile'],plan)
        with self.assertRaisesRegex(StageError,'遗漏'):validate_delivery(self.job,self.req,self.manifest)

    def test_wrong_identity_text_review_and_path_are_rejected(self):
        mutations = [lambda m:m.update(runId='wrong'),
          lambda m:m['scenes'][0].update(id='wrong'), lambda m:m['scenes'][0].update(text='擅改'),
          lambda m:m['scenes'][0].update(path='../../escape.mp4')]
        for mutate in mutations:
            m=copy.deepcopy(self.manifest);mutate(m)
            with self.assertRaises(StageError):validate_delivery(self.job,self.req,m)
        changed=copy.deepcopy(self.review);changed['passed']=False
        write(self.job/self.manifest['quality'],changed)
        with self.assertRaises(StageError):validate_delivery(self.job,self.req,self.manifest)

    def test_wrong_order_missing_caption_or_block_rejected(self):
        for mutate in (lambda m:m['scenes'].reverse(),lambda m:m['scenes'][0]['captions'].clear(),
                       lambda m:m['scenes'][0]['resolvedVisualBlocks'][0].update(endFrameExclusive=9)):
            with self.subTest(mutation=mutate):
                m=copy.deepcopy(self.manifest);mutate(m)
                with self.assertRaises(StageError):validate_delivery(self.job,self.req,m)
    def test_fake_preview_cannot_replace_encoded_evidence(self):
        item=self.manifest['scenes'][0]['evidence'][0];other=self.manifest['scenes'][1]['evidence'][0]
        item.update(path=other['path'],sha256=other['sha256'])
        with self.assertRaisesRegex(StageError,'审查图'):validate_delivery(self.job,self.req,self.manifest)
    def test_wrong_audio_rejected(self):
        a=self.manifest['scenes'][0];b=self.manifest['scenes'][1]
        with self.assertRaises(StageError):compare_audio(self.job/a['path'],self.job/b['audio']['path'])
    def test_timestamp_offset_rejected(self):
        source=self.job/self.manifest['scenes'][0]['path'];target=source.with_name('offset.mp4')
        ffmpeg('-i',source,'-c','copy','-output_ts_offset','0.1',target)
        with self.assertRaises(StageError):validate_mp4(target,self.req['outputSpec'],10)
    def test_corrupt_media_rejected(self):
        path=self.job/self.manifest['scenes'][0]['path'];path.write_bytes(b'bad')
        with self.assertRaises(StageError):validate_mp4(path,self.req['outputSpec'],10)

    def test_mux_cannot_silently_cut_audio_to_fit_video(self):
        video=self.job/self.manifest['scenes'][0]['path'];mix=video.with_name('long.wav')
        ffmpeg('-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.1',mix)
        target=video.with_name('must-not-exist.mp4')
        with self.assertRaises(StageError) as error:mux_scene(video,mix,target,self.req['outputSpec'],10)
        self.assertEqual(error.exception.details['step'],'mix')
        self.assertFalse(target.exists())

    def test_mux_normalizes_only_submillisecond_silent_padding(self):
        import wave
        video=self.job/self.manifest['scenes'][0]['path']
        for delta,tail,allowed in [(16,b'\x00\x00',True),(-16,b'',True),
                                    (16,b'\x01\x00',False),(96,b'\x00\x00',False)]:
            with self.subTest(delta=delta,tail=tail):
                mix=video.with_name('boundary.wav');target=video.with_name('boundary.mp4')
                with wave.open(str(mix),'wb') as audio:
                    audio.setparams((1,2,48000,0,'NONE','not compressed'))
                    audio.writeframes(b'\x00\x00'*(48000+min(0,delta))+tail*max(0,delta))
                if allowed:
                    report=mux_scene(video,mix,target,self.req['outputSpec'],10)
                    self.assertEqual(report['mixBoundaryAdjustmentSamples'],delta)
                else:
                    with self.assertRaises(StageError) as error:mux_scene(video,mix,target,self.req['outputSpec'],10)
                    self.assertEqual(error.exception.code,'AUDIO_MISMATCH')


@unittest.skipUnless(os.environ.get('VIDEOCUT_TEST_MODULES') and os.environ.get('VIDEOCUT_TEST_BROWSER'), '指定本机 Remotion 依赖与浏览器才运行真实渲染')
class RemotionTests(Fixture):
    def test_fresh_composition_renders_and_reuses_verified_output(self):
        render=self.render_request()
        project=self.job/'project';(project/'src').mkdir(parents=True);(project/'public').mkdir()
        modules=Path(os.environ['VIDEOCUT_TEST_MODULES']).resolve()
        (project/'node_modules').symlink_to(modules,target_is_directory=True)
        write(project/'package.json',{'name':'two-stage-mechanical-test','private':True})
        ffmpeg('-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1',project/'public/voice.wav')
        (project/'src/index.tsx').write_text("""
import React from 'react';
import {registerRoot, Composition, AbsoluteFill, Audio, staticFile, useCurrentFrame} from 'remotion';
const Frame=()=>{const frame=useCurrentFrame();return <AbsoluteFill style={{background:'#123456',color:'white',fontSize:28,justifyContent:'center',alignItems:'center'}}>Stage test {frame}<Audio src={staticFile('voice.wav')}/></AbsoluteFill>};
registerRoot(()=> <Composition id="SceneOne" component={Frame} durationInFrames={10} fps={10} width={320} height={240}/>);
""")
        options=(render,'scene_1','project','project/src/index.tsx','SceneOne',None,10,
                 os.environ.get('VIDEOCUT_TEST_NODE','node'),str(modules),os.environ['VIDEOCUT_TEST_BROWSER'])
        first=render_scene(*options);second=render_scene(*options)
        self.assertFalse(first['reused']);self.assertTrue(second['reused']);self.assertEqual(first['sha256'],second['sha256'])
        self.assertEqual({e['frame'] for e in first['evidence']},{0,5,9})
        with self.assertRaises(StageError):render_scene(*((*options[:6],11,*options[7:])))

    def test_actual_remotion_audio_stays_synchronous_and_mux_retry_reuses_frames(self):
        # 覆盖线上失败的非整秒边界；真实 Remotion 混音含延迟音效，不用 FFmpeg 色块替代。
        self.spec['outputSpec']['fps']=30
        self.request=Path(init_job(self.base/'other-job',self.spec)['request'])
        self.job=self.request.parent.parent
        _,req=load_request(self.request);self.plan['inputDigest']=json_digest(req['snapshot'])
        self.plan_path=self.job/'analysis/plan.json';write(self.plan_path,self.plan)
        render=self.render_request()
        project=self.job/'project';(project/'src').mkdir(parents=True);(project/'public').mkdir()
        modules=Path(os.environ['VIDEOCUT_TEST_MODULES']).resolve()
        (project/'node_modules').symlink_to(modules,target_is_directory=True)
        write(project/'package.json',{'name':'media-sync-test','private':True})
        ffmpeg('-f','lavfi','-i','sine=frequency=431:sample_rate=48000','-t','5.8',project/'public/voice.wav')
        ffmpeg('-f','lavfi','-i','sine=frequency=723:sample_rate=48000','-t','0.3',project/'public/effect.wav')
        (project/'src/index.tsx').write_text("""
import React from 'react';
import {registerRoot,Composition,AbsoluteFill,Audio,Sequence,staticFile} from 'remotion';
const Frame=()=> <AbsoluteFill style={{background:'#123456'}}><Audio src={staticFile('voice.wav')} volume={0.6}/><Sequence from={20} durationInFrames={9}><Audio src={staticFile('effect.wav')} volume={0.2}/></Sequence></AbsoluteFill>;
registerRoot(()=> <Composition id="Sync" component={Frame} durationInFrames={170} fps={30} width={320} height={240} calculateMetadata={({props})=>({durationInFrames:props.frames})} defaultProps={{frames:170}}/>);
""")
        for frames in (170,171,236):
            write(project/'props.json',{'frames':frames})
            options=(render,'scene_1','project','project/src/index.tsx','Sync','project/props.json',frames,
                     os.environ.get('VIDEOCUT_TEST_NODE','node'),str(modules),os.environ['VIDEOCUT_TEST_BROWSER'])
            if frames==170:
                with patch('stage_media.mux_scene',side_effect=StageError('AUDIO_MISMATCH','模拟封装失败')):
                    with self.assertRaises(StageError):render_scene(*options)
                with patch('stage_media.supervise',side_effect=AssertionError('不能重渲染')):
                    result=render_scene(*options)
                self.assertTrue(result['renderReused'])
            else:result=render_scene(*options)
            self.assertGreater(result['audioCheck']['correlation'],.90)
            self.assertEqual(result['frames'],frames)
            mixed=self.job/result['mix']['path']
            self.assertEqual(digest(mixed),result['mix']['sha256'])
            # 不能只换回裸 TTS：Remotion 混音中的音量与音效必须保留。
            self.assertNotEqual(digest(mixed),digest(project/'public/voice.wav'))


if __name__=='__main__':unittest.main()
