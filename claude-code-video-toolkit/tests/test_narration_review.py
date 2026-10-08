"""讲解审片核验：合理保持可通过，遗漏、失效和伪造区间需修订。"""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from stage_media import validate_narration_review
from two_stage import StageError, schema, failure


class NarrationReviewTests(unittest.TestCase):
    def setUp(self):
        self.timeline = {'fps': 30, 'scenes': [{'id': 's1', 'startFrame': 0, 'endFrameExclusive': 100,
            'utterances': [
                {'id': 'u1', 'text': '现状。', 'startFrame': 10, 'endFrameExclusive': 40},
                {'id': 'u2', 'text': '变化。', 'startFrame': 40, 'endFrameExclusive': 80}]}]}
        self.request = {'outputSpec': {'fps': 30}}
        self.manifest = {'scenes': [{'id': 's1', 'frames': 100, 'text': '现状。变化。',
                                    'evidence': [{'frame': i} for i in range(100)]}]}
        self.hold = {'utteranceIds': ['u1'], 'mode': 'hold', 'startFrame': 10, 'endFrameExclusive': 40,
                     'expected': '保持现状供阅读', 'observed': '背景及对象保持可读',
                     'viewedFrames': [10, 39], 'passed': True}
        self.change = {'utteranceIds': ['u2'], 'mode': 'change', 'startFrame': 39, 'endFrameExclusive': 80,
                       'changeStartFrame': 40, 'changeEndFrameExclusive': 60,
                       'expected': '随转折改变主体', 'observed': '转折处开始变化并保留结果',
                       'viewedFrames': [39, 40, 49, 59, 60, 79], 'passed': True}
        self.review = {'scenes': [{'viewedFrames': list(range(100)), 'narrationChecks': [self.hold, self.change]}]}

    def validate(self):
        for item in self.review['scenes'][0]['narrationChecks']:
            schema(item, 'narrationCheck')
        validate_narration_review(self.timeline, self.request, self.manifest, self.review)

    def test_hold_change_intro_and_outro(self):
        self.validate()  # 片头和片尾不强制伪造口播，也不要求全程运动。

    def test_grouped_hold_and_silent_scene(self):
        self.hold.update(utteranceIds=['u1', 'u2'], endFrameExclusive=80, viewedFrames=[10, 79])
        self.review['scenes'][0]['narrationChecks'] = [self.hold]
        self.validate()
        self.timeline['scenes'][0]['utterances'] = []
        self.manifest['scenes'][0]['text'] = ''
        self.review['scenes'][0]['narrationChecks'] = []
        self.validate()

    def test_missing_unknown_or_unresolved_check(self):
        for update in ({'utteranceIds': ['missing']}, {'passed': False}, {'observed': '   '},
                       {'startFrame': 41}, {'endFrameExclusive': 101}, {'changeEndFrameExclusive': 90},
                       {'viewedFrames': [39, 40, 59, 60, 79]}):
            with self.subTest(update=update):
                saved = copy.deepcopy(self.change)
                self.change.update(update)
                with self.assertRaises(StageError): self.validate()
                self.change.clear(); self.change.update(saved)
        self.review['scenes'][0]['narrationChecks'] = [self.hold]
        with self.assertRaisesRegex(StageError, '未检查'): self.validate()

    def test_actual_evidence_and_viewing_are_both_required(self):
        self.manifest['scenes'][0]['evidence'] = [{'frame': 0}, {'frame': 50}, {'frame': 99}]
        with self.assertRaisesRegex(StageError, '成片抽帧'): self.validate()
        self.manifest['scenes'][0]['evidence'] = [{'frame': i} for i in range(100)]
        self.review['scenes'][0]['viewedFrames'] = [0, 50, 99]
        with self.assertRaisesRegex(StageError, '成片抽帧'): self.validate()

    def test_bad_timeline_cannot_hide_narration(self):
        for update in ({'text': '改写'}, {'id': 'u1'}, {'startFrame': 20}, {'endFrameExclusive': 101}):
            with self.subTest(update=update):
                u = self.timeline['scenes'][0]['utterances'][1]
                saved = dict(u); u.update(update)
                with self.assertRaises(StageError): self.validate()
                u.clear(); u.update(saved)

    def test_timebase_or_scene_length_mismatch(self):
        self.timeline['fps'] = 25
        with self.assertRaisesRegex(StageError, '帧率'): self.validate()
        self.timeline['fps'] = 30
        self.timeline['scenes'][0]['startFrame'] = 1
        with self.assertRaisesRegex(StageError, '长度'): self.validate()

    def test_change_fields_required_only_for_change(self):
        del self.change['changeStartFrame']
        with self.assertRaises(StageError): self.validate()
        self.review['scenes'][0]['narrationChecks'] = [dict(self.hold, changeStartFrame=10)]
        with self.assertRaises(StageError): self.validate()

    def test_review_failure_is_project_repair(self):
        result = failure(None, 'validate', StageError('VISUAL_REVIEW_REQUIRED', '需重新检查'))
        self.assertEqual(result['status'], 'repair_required')
        self.assertEqual(result['scope'], 'task_project')

    def test_malformed_timeline_is_actionable(self):
        self.timeline['scenes'][0]['utterances'] = [None]
        with self.assertRaisesRegex(StageError, '发言记录无效'): self.validate()


if __name__ == '__main__':
    unittest.main()
