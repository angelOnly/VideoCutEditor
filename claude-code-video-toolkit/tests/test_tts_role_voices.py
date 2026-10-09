"""角色音色约束回归；只使用模拟供应商，不发起收费请求。"""
import copy
import base64
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_two_stage import Fixture
from two_stage import StageError, write, failure
from stage_tts import generate
from config import get_tts_role_voices
from doubao_tts import generate_audio


VOICES = {'female': 'zh_female_xiaohe_uranus_bigtts', 'male': 'zh_male_m191_uranus_bigtts'}


class RoleVoiceTests(Fixture):
    def test_entire_manifest_is_checked_before_any_paid_call(self):
        request = self.render_request()
        script = self.job/'dialogue.json'
        items = [
            {'id': 'u1', 'sceneId': 'scene_1', 'role': 'female', 'speaker': VOICES['female'], 'text': '第一句。'},
            {'id': 'u2', 'sceneId': 'scene_2', 'role': 'male', 'speaker': VOICES['male'], 'text': '第二句。'},
        ]
        cases = [
            ({'speaker': 'zh_male_yunxi_mars_bigtts'}, 'TTS_VOICE_MISMATCH'),
            ({'speaker': VOICES['female']}, 'TTS_VOICE_MISMATCH'),
            ({'role': 'male-chief'}, 'TTS_ROLE_NOT_CONFIGURED'),
            ({'role': None}, 'TTS_ROLE_NOT_CONFIGURED'),
        ]
        with patch('stage_tts.get_tts_role_voices', return_value=VOICES), \
             patch('stage_tts.synthesize_cached') as provider:
            for change, code in cases:
                with self.subTest(change=change):
                    bad = copy.deepcopy(items)
                    bad[1].update(change)
                    write(script, bad)
                    with self.assertRaises(StageError) as error:
                        generate(request, script)
                    self.assertEqual(error.exception.code, code)
                    report = failure(request, 'tts', error.exception)
                    self.assertEqual(report['status'], 'repair_required')
                    self.assertEqual(report['nextAction'], 'correct_tts_manifest')
                    if code == 'TTS_VOICE_MISMATCH':
                        self.assertIn(VOICES['male'], str(error.exception))
                    provider.assert_not_called()
            self.assertFalse((self.job/'cache/tts').exists())
            self.assertFalse((request.parent/'audio-manifest.json').exists())

    def test_missing_configuration_stops_before_supplier_call(self):
        request = self.render_request()
        script = self.job/'dialogue.json'
        write(script, [{'id': 'u1', 'sceneId': 'scene_1', 'role': 'male',
                        'speaker': VOICES['male'], 'text': '第一句。'}])
        with patch('stage_tts.get_tts_role_voices', side_effect=ValueError('缺少角色音色配置')), \
             patch('stage_tts.synthesize_cached') as provider:
            with self.assertRaises(StageError) as error:
                generate(request, script)
            self.assertEqual(error.exception.code, 'TTS_CONFIGURATION_INVALID')
            provider.assert_not_called()


class RoleVoiceConfigurationTests(unittest.TestCase):
    def test_injected_mapping_takes_priority_over_local_mapping(self):
        with patch('config.load_environment'), patch.dict(os.environ, {
            'TTS_VOICES': json.dumps({'male': 'obsolete'}),
            'VIDEOCUT_TTS_VOICES': json.dumps(VOICES),
        }, clear=True):
            self.assertEqual(get_tts_role_voices(), VOICES)
            del os.environ['VIDEOCUT_TTS_VOICES']
            self.assertEqual(get_tts_role_voices(), {'male': 'obsolete'})

    def test_invalid_injected_mapping_never_falls_back(self):
        with patch('config.load_environment'):
            for value in ['{}', '[]', 'null', 'invalid', '{"male":""}', '{"male":1}']:
                with self.subTest(value=value), patch.dict(os.environ, {
                    'VIDEOCUT_TTS_VOICES': value, 'TTS_VOICES': json.dumps(VOICES),
                }, clear=True):
                    with self.assertRaises(ValueError):
                        get_tts_role_voices()

    def test_native_provider_rejects_unconfigured_voice_without_http(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'VIDEOCUT_RENDER_SANDBOX': 'native', 'VIDEOCUT_TTS_VOICES': json.dumps(VOICES),
        }, clear=True), patch('doubao_tts.requests.post') as post:
            output = Path(directory)/'audio.mp3'
            result = generate_audio('公司概况', str(output), speaker='zh_male_yunxi_mars_bigtts', api_key='test')
            self.assertFalse(result['success'])
            self.assertFalse(result['submitted'])
            self.assertIn('不在已配置角色音色中', result['error'])
            post.assert_not_called()
            self.assertFalse(output.exists())

    def test_native_provider_allows_both_configured_voices(self):
        from unittest.mock import Mock
        response = Mock()
        wire = (json.dumps({'code': 0, 'data': base64.b64encode(b'fixture-audio').decode()}) +
                json.dumps({'code': 20000000})).encode()
        response.iter_content.side_effect = lambda **kwargs: iter([wire])
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'VIDEOCUT_RENDER_SANDBOX': 'native', 'VIDEOCUT_TTS_VOICES': json.dumps(VOICES),
        }, clear=True), patch('doubao_tts.requests.post', return_value=response) as post, \
             patch('doubao_tts._audio_result', return_value={'success': True}):
            for role, speaker in VOICES.items():
                with self.subTest(role=role):
                    output = Path(directory)/f'{role}.mp3'
                    result = generate_audio('配置音色测试。', str(output), speaker=speaker, api_key='test', verbose=False)
                    self.assertTrue(result['success'])
                    self.assertEqual(post.call_args.kwargs['json']['req_params']['speaker'], speaker)
                    self.assertEqual(output.read_bytes(), b'fixture-audio')
            self.assertEqual(post.call_count, 2)


if __name__ == '__main__':
    unittest.main()
