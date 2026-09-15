"""Worker 桥接的只读检查与外部收费账本测试。"""
import json
from pathlib import Path
from unittest.mock import patch
from test_two_stage import Fixture
from two_stage import StageError, digest, read, write
from stage_tts import generate
from worker_stage import check

class WorkerBridgeTests(Fixture):
    def test_readonly_check_has_no_result_or_lock_side_effect(self):
        before={str(p.relative_to(self.job)):digest(p) for p in self.job.rglob('*') if p.is_file()}
        report=check(self.request,'analysis/plan.json')
        after={str(p.relative_to(self.job)):digest(p) for p in self.job.rglob('*') if p.is_file()}
        self.assertTrue(report['passed']);self.assertEqual(before,after)

    def test_trusted_cache_is_outside_workspace_and_role_is_not_fixed(self):
        request=self.render_request();script=self.job/'dialogue.json';cache=self.base/'trusted-ledger'
        cache.mkdir();audio=cache/'audio.mp3';audio.write_bytes(b'test-provider-audio')
        write(script,[{'id':'a','sceneId':'scene_1','text':'第一句。','speaker':'male-choice'},
                      {'id':'b','sceneId':'scene_2','text':'第二句。','speaker':'female-choice'}])
        calls=[]
        def fake(text,speaker,resource,directory):
            calls.append((text,speaker,directory))
            return {'path':str(audio),'cacheKey':speaker,'requestId':speaker,'reused':False,
                    'audio':{'sha256':digest(audio),'durationSeconds':1}}
        with patch('stage_tts.synthesize_cached',side_effect=fake):
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
