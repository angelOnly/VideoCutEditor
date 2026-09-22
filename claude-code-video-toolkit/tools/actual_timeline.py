"""实际素材驱动的帧计算；不读取 Analysis 的任何估时字段。"""
from copy import deepcopy
from fractions import Fraction
from two_stage import require


def sample_frames(samples, sample_rate, fps):
    require(type(samples) is int and samples > 0 and type(sample_rate) is int and sample_rate > 0,
            '音频样本数或采样率无效', 'AUDIO_INVALID')
    rate = Fraction(str(fps))
    require(rate > 0, '帧率无效')
    value = Fraction(samples, sample_rate) * rate
    return (value.numerator + value.denominator - 1) // value.denominator


def resolve_speech(utterances, measurements, fps, lead_frames=0):
    """显式首部/句间停顿加实测音频；不接收旧 frames 或 Analysis timing。"""
    require(type(lead_frames) is int and lead_frames >= 0, '首部停顿帧无效')
    result, captions, cursor = [], [], lead_frames
    for item in utterances:
        gap = item.get('gapBeforeFrames', 0)
        require(type(gap) is int and gap >= 0, '句间停顿帧无效')
        info = measurements[item['id']]
        start = cursor + gap
        cursor = start + sample_frames(info['samples'], info['sampleRate'], fps)
        result.append({**item, 'startFrame': start, 'endFrameExclusive': cursor})
        captions.append({'utteranceId': item['id'], 'text': item['text'],
                         'startFrame': start, 'endFrameExclusive': cursor})
    return {'utterances': result, 'captions': captions, 'speechEndFrame': cursor}


def content_frames(speech_end, retained_media=()):
    """并行素材取结束位置最大值；循环 BGM 必须由内容边界约束。"""
    ends = [speech_end]
    for media in retained_media:
        require(not media.get('loop'), '循环素材不能决定节目时长')
        require(type(media['from']) is int and media['from'] >= 0 and
                type(media['frames']) is int and media['frames'] > 0, '素材时间无效')
        ends.append(media['from'] + media['frames'])
    end = max(ends)
    require(end > 0, '内容时间轴不能为空')
    return end


def extend_timeline(timeline, extensions):
    """仅延长封装覆盖，不拉伸配音/字幕；同步章节坐标与图解触发点。"""
    result = deepcopy(timeline)
    changes = {}
    offset = 0
    scene_ids = {s['id'] for s in timeline['scenes']}
    require(set(extensions) <= scene_ids, '补帧指向不存在的分镜')
    for scene, old in zip(result['scenes'], timeline['scenes']):
        require(old['from'] == offset, '原时间轴分镜不连续')
        offset += old['frames']
        new_frames = extensions.get(old['id'], old['frames'])
        require(type(new_frames) is int and new_frames >= old['frames'], '补帧不能缩短内容')
        # 延长量由制作方决定；这里只平移后续坐标，不改配音或字幕。
        changes[old['id']] = new_frames - old['frames']
        if new_frames != old['frames']:
            scene['contentFrames'] = old.get('contentFrames', old['frames'])
            scene['frames'] = new_frames
            for block in scene.get('visualBlocks', []):
                if block['endFrameExclusive'] == old['frames']:
                    block['endFrameExclusive'] = new_frames

    require(offset == timeline['totalFrames'], '原时间轴总帧数错误')
    def absolute(frame):
        return frame + sum(changes[s['id']] for s in timeline['scenes'] if s['from'] + s['frames'] <= frame)

    for scene, old in zip(result['scenes'], timeline['scenes']):
        scene['from'] = absolute(old['from'])
        scene['startFrame'] = scene['from']
        scene['endFrameExclusive'] = scene['from'] + scene['frames']
    for chapter, old in zip(result.get('chapters', []), timeline.get('chapters', [])):
        start = old['from']
        chapter['from'] = absolute(start)
        chapter['endFrameExclusive'] = absolute(old['endFrameExclusive'])
        for block, previous in zip(chapter.get('visualBlocks', []), old.get('visualBlocks', [])):
            old_start = start + previous['startFrame']
            new_start = absolute(old_start)
            block['startFrame'] = new_start - chapter['from']
            block['endFrameExclusive'] = absolute(start + previous['endFrameExclusive']) - chapter['from']
            props = block.get('props', {})
            if 'itemFrames' in props:
                props['itemFrames'] = [absolute(old_start + n) - new_start for n in previous['props']['itemFrames']]
            if 'revealFrame' in props:
                props['revealFrame'] = absolute(old_start + previous['props']['revealFrame']) - new_start
    result['totalFrames'] = absolute(timeline['totalFrames'])
    return result
