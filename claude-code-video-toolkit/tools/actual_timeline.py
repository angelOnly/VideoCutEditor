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


def check_fixed_ending(timeline, required=False):
    """只检查串行收尾合同；真实素材长度由调用方独立测量。"""
    ending = timeline.get('ending')
    if ending is None:
        require(not required, '新模板缺少固定结束语与片尾记录')
        return None
    require(isinstance(ending, dict), 'ending 必须是对象')
    scenes = timeline.get('scenes', [])
    require(isinstance(scenes, list) and scenes, '收尾缺少正文分镜')
    offset, utterances = 0, []
    for scene in scenes:
        start = scene.get('startFrame', scene.get('from'))
        frames = scene.get('frames')
        if frames is None:
            require(type(start) is int and type(scene.get('endFrameExclusive')) is int, '收尾分镜缺少实际边界')
            frames = scene['endFrameExclusive'] - start
        require(type(start) is int and type(frames) is int and frames > 0 and start == offset,
                '收尾时间轴分镜不连续')
        require(scene.get('from', start) == start and scene.get('endFrameExclusive', start + frames) == start + frames,
                '收尾时间轴坐标别名不一致')
        require(not scene.get('outro'), '新模板片尾只能由最终合成追加，不能放在正文分镜中')
        previous = 0
        for u in scene.get('utterances', []):
            begin, end = u.get('startFrame'), u.get('endFrameExclusive')
            require(type(begin) is int and type(end) is int and previous <= begin < end <= frames,
                    '收尾口播窗口无效')
            require(isinstance(u.get('id'), str) and u['id'], '收尾口播缺少稳定 ID')
            utterances.append((u['id'], start + begin, start + end))
            previous = end
        offset += frames
    require(utterances and len({u[0] for u in utterances}) == len(utterances), '收尾口播 ID 缺失或重复')
    require(type(timeline.get('totalFrames')) is int and timeline['totalFrames'] == offset,
            '收尾总帧数与分镜不一致')
    closing = ending.get('closingUtteranceIds')
    require(isinstance(closing, list) and all(isinstance(u, str) and u for u in closing)
            and len(set(closing)) == len(closing), '固定结束语 ID 列表无效')
    require(not closing or (len(closing) < len(utterances) and closing == [u[0] for u in utterances[-len(closing):]]),
            '固定结束语必须是确认口播末尾连续的 ID，且之前有正文')
    hold = ending.get('holdFrame')
    if closing:
        expected_hold = utterances[-len(closing)-1][2] - 1
        require(type(hold) is int and hold == expected_hold, '保持帧必须来自结束语之前最后一条正文配音的末帧')
    else:
        require(hold is None, '无固定结束语时不能冻结正文画面')
    narration_end = ending.get('narrationEndFrame')
    require(type(narration_end) is int and narration_end == utterances[-1][2],
            '全部口播结束帧与真实口播窗口不一致')
    outro = ending.get('outro')
    outro_frames = 0
    if outro is not None:
        require(isinstance(outro, dict) and isinstance(outro.get('src'), str) and outro['src']
                and type(outro.get('frames')) is int and outro['frames'] > 0 and type(outro.get('muted')) is bool,
                '片尾需要本地来源、完整帧数和明确静音选择')
        outro_frames = outro['frames']
    last = scenes[-1]
    last_from = last.get('startFrame', last.get('from'))
    last_frames = offset - last_from
    content = narration_end + outro_frames - last_from
    require(narration_end > last_from and content > 0, '最后交付分镜须包含口播，片尾追加在该镜口播之后')
    # 封装补帧可延长画面，但不能移动口播或把补帧冒充片尾内容。
    require(type(last.get('contentFrames')) is int and last['contentFrames'] == content and last_frames >= content,
            '最后分镜声音窗口必须等于完整口播加完整片尾')
    return {'holdFrame': hold, 'narrationEndFrame': narration_end, 'outroFrames': outro_frames,
            'lastSceneId': last['id'], 'lastSceneFrom': last_from, 'appendFromFrame': narration_end - last_from,
            'totalFrames': offset, 'closingUtteranceIds': list(closing)}


def extend_timeline(timeline, extensions):
    """仅延长封装覆盖，不拉伸配音/字幕；同步章节坐标与图解触发点。"""
    # 正式记录使用全局起止帧；旧工程的from/frames别名仍可读。
    timeline = deepcopy(timeline)
    for scene in timeline['scenes']:
        start = scene.get('startFrame', scene.get('from'))
        require(type(start) is int, '原时间轴缺少分镜起点')
        frames = scene.get('frames')
        if frames is None:
            require(type(scene.get('endFrameExclusive')) is int, '原时间轴缺少分镜终点')
            frames = scene['endFrameExclusive'] - start
        require(scene.get('from', start) == start and type(frames) is int
                and scene.get('endFrameExclusive', start + frames) == start + frames, '原时间轴坐标别名不一致')
        scene['from'], scene['frames'] = start, frames
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
    if timeline.get('ending') is not None:
        # 全局口播右边界跟随其所在分镜，不能把该镜末尾的封装补帧算进配音。
        def speech_boundary(frame):
            return frame + sum(changes[s['id']] for s in timeline['scenes'] if s['from'] < frame and s['from'] + s['frames'] < frame)
        result['ending']['narrationEndFrame'] = speech_boundary(timeline['ending']['narrationEndFrame'])
        if 'holdFrame' in timeline['ending']:
            result['ending']['holdFrame'] = absolute(timeline['ending']['holdFrame'])
        check_fixed_ending(result)
    return result
