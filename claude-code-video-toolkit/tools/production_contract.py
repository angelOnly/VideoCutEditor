"""制作前的确定性检查与审片位置规则；不生成观察或通过结论。"""
from copy import deepcopy
from two_stage import StageError, read, local, require, digest

CONTRACT = 'finance-scene/v2'


def review_frames(start, stop, action=None):
    frames = {start, stop - 1}
    if action:
        a, b = action
        require(start <= a < b <= stop, '动作区间超出讲解范围', 'VISUAL_REVIEW_REQUIRED')
        frames.update((max(start, a-1), a, (a+b-1)//2, b-1, min(stop-1, b)))
    return frames


def action_windows(block):
    """与财经模板 motionFrames/arrive 的实际参数一致，逐动作保留收束位置。"""
    start, end = block['startFrame'], block['endFrameExclusive']
    kind, props = block.get('kind'), block.get('props', {})
    if kind in ('comparison', 'flow', 'layers', 'labels'):
        events = [(n, 13) for n in props.get('itemFrames', [])]
    elif kind in ('trend', 'line', 'gauge', 'ring'):
        events = [(props.get('revealFrame', 0), {'trend': 28, 'line': 45, 'gauge': 26, 'ring': 26}[kind])]
    elif kind in ('metric', 'quote'):
        # 默认组件外层仍有一次淡入，须覆盖其真实收束。
        events = [(0, 13)]
    else:
        require(type(block.get('animationFrames')) is int, '扩展组件须声明并消费实际 animationFrames', 'VISUAL_REVIEW_REQUIRED')
        events = [(0, block['animationFrames'])]
    if kind in ('comparison', 'flow', 'layers', 'labels', 'trend', 'line', 'gauge', 'ring'):
        events = [(0, 13), *events]
    windows = []
    for relative, fallback in events:
        require(type(relative) is int and 0 <= relative < end-start, '组件动作起点无效', 'VISUAL_REVIEW_REQUIRED')
        duration = max(0, min(end-start-relative-1, block.get('animationFrames', fallback)))
        windows.append((start+relative, start+relative+duration+1))
    return windows


def scene_blocks(timeline, scene):
    # 本镜图解替代章节图解；不能把当前组件未使用的章节动作算作执行依据。
    if scene.get('visualBlocks'):
        return {b['id']: b for b in scene['visualBlocks']}
    result = {}
    for chapter in timeline.get('chapters', []):
        if chapter['from'] < scene['endFrameExclusive'] and chapter['endFrameExclusive'] > scene['startFrame']:
            for block in chapter.get('visualBlocks', []):
                require(block['id'] not in result, '跨章动作 ID 重复，请使用唯一 ID', 'VISUAL_REVIEW_REQUIRED')
                result[block['id']] = {**block, 'startFrame': chapter['from']+block['startFrame']-scene['startFrame'],
                                      'endFrameExclusive': chapter['from']+block['endFrameExclusive']-scene['startFrame']}
    return result


def with_design(timeline, design):
    result = deepcopy(timeline)
    if design is not None:
        require(isinstance(design, dict) and design.get('schemaVersion') == 2 and isinstance(design.get('scenes'), dict), '设计索引结构无效')
        require(all(isinstance(value, dict) for value in design['scenes'].values()), '分镜设计结构无效')
        for scene in result['scenes']:
            scene['visualDesign'] = design['scenes'].get(scene['id'], {}).get('designs', [])
            require(isinstance(scene['visualDesign'], list) and all(isinstance(d, dict) for d in scene['visualDesign']), '设计项结构无效')
            for item in scene['visualDesign']:
                if isinstance(item.get('implementation'), dict):
                    item['implementation'] = item['implementation'].get('path', '')
    return result


def validate_production_inputs(root, request, timeline, design, runtime_inputs, project):
    """结构根错误立即返回，其余能独立定位的问题汇总返回。"""
    require(isinstance(timeline, dict) and isinstance(timeline.get('scenes'), list) and
            all(isinstance(s, dict) for s in timeline['scenes']), '正式时间轴结构无效')
    plan = read(local(root, request['confirmation']['planFile']))
    issues = []
    def check(ok, scene, pointer, message, file='timeline.json'):
        if not ok:
            issues.append({'sceneId': scene, 'file': f"render/{request['runId']}/{file}", 'pointer': pointer, 'message': message})
        return bool(ok)
    if timeline.get('renderInputContract') == CONTRACT:
        for field in ('width', 'height'):
            check(timeline.get(field) == request['outputSpec'][field], None, '/'+field, '时间轴输出尺寸不符')
    check(timeline.get('fps') == request['outputSpec']['fps'], None, '/fps', '时间轴帧率与输出规格不符')
    check([s.get('id') for s in timeline['scenes']] == [s['id'] for s in plan['scenes']], None, '/scenes', '分镜及顺序必须与确认稿一致')
    authored = with_design(timeline, design)
    confirmed = {s['id']: s for s in plan['scenes']}
    plans, offset = {}, 0
    for i, scene in enumerate(authored['scenes']):
        sid = scene.get('id'); pointer = f'/scenes/{i}'
        start, stop = scene.get('startFrame'), scene.get('endFrameExclusive')
        if not check(type(start) is int and type(stop) is int and start == offset < stop, sid, pointer, '全局分镜边界必须连续且非空'):
            continue
        frames = stop-start; offset = stop
        needed = {0, frames//2, frames-1}; checks = []
        utterances = scene.get('utterances')
        if not check(isinstance(utterances, list) and all(isinstance(u, dict) for u in utterances), sid, pointer+'/utterances', '发言列表无效'):
            continue
        by_id, previous = {}, 0
        for j, u in enumerate(utterances):
            up = pointer+f'/utterances/{j}'; uid = u.get('id')
            if not check(isinstance(uid, str) and uid and uid not in by_id, sid, up+'/id', '发言 ID 缺失或重复'): continue
            by_id[uid] = u
            a, b = u.get('startFrame'), u.get('endFrameExclusive')
            if check(type(a) is int and type(b) is int and previous <= a < b <= frames, sid, up, '发言边界重叠或越界'):
                previous = b; needed.update((a, b-1))
            check(isinstance(u.get('text'), str), sid, up+'/text', '缺少口播文本')
            try:
                require(digest(local(root, u['audioPath'])) == digest(local(project/'public', u['src'])), '正式音频与工程来源不一致')
            except (ValueError, OSError, KeyError, TypeError) as exc:
                check(False, sid, up+'/audioPath', str(exc))
        normalize = lambda text: ''.join(text.split())
        check(normalize(''.join(u.get('text', '') for u in utterances if isinstance(u.get('text'), str))) == normalize(confirmed.get(sid, {}).get('text', '')), sid, pointer+'/utterances', '发言未覆盖确认口播')
        captions = scene.get('captions', [])
        if check(isinstance(captions, list), sid, pointer+'/captions', '字幕列表无效'):
            previous = 0
            check(bool(captions) or not utterances, sid, pointer+'/captions', '口播镜头缺少字幕')
            for j, caption in enumerate(captions):
                if not check(isinstance(caption, dict), sid, pointer+f'/captions/{j}', '字幕结构无效'): continue
                a, b = caption.get('startFrame'), caption.get('endFrameExclusive')
                if check(type(a) is int and type(b) is int and previous <= a < b <= frames, sid, pointer+f'/captions/{j}', '字幕边界重叠或越界'):
                    previous = b; needed.update((a, b-1))
                if timeline.get('renderInputContract') == CONTRACT:
                    u = by_id.get(caption.get('utteranceId'))
                    check(u is not None, sid, pointer+f'/captions/{j}/utteranceId', '字幕引用不存在的发言')
                    if u and not scene.get('captionTiming'):
                        check((a, b, caption.get('text')) == (u.get('startFrame'), u.get('endFrameExclusive'), u.get('text')), sid, pointer+f'/captions/{j}', '句级字幕须匹配实际发言边界及文本')
        designs = scene.get('visualDesign'); seen, covered = set(), set()
        file = 'design.json' if design is not None else 'timeline.json'
        dp = f'/scenes/{sid}/designs' if design is not None else pointer+'/visualDesign'
        if check(isinstance(designs, list) and (bool(designs) or not utterances), sid, dp, '缺少设计执行索引', file):
            blocks = scene_blocks(timeline, scene)
            for j, d in enumerate(designs):
                p = dp+f'/{j}'
                if not check(isinstance(d, dict), sid, p, '设计项结构无效', file): continue
                did = d.get('id'); ids = d.get('utteranceIds')
                if check(isinstance(did, str) and bool(did) and did not in seen, sid, p+'/id', '设计 ID 缺失或重复', file): seen.add(did)
                check(d.get('mode') in ('hold', 'change'), sid, p+'/mode', '设计模式无效', file)
                check(isinstance(d.get('description'), str) and bool(d['description'].strip()), sid, p+'/description', '设计说明缺失', file)
                try: local(root, d['implementation'])
                except (ValueError, OSError, KeyError, TypeError): check(False, sid, p+'/implementation', '实现引用不存在或越界', file)
                if not check(isinstance(ids, list) and ids and all(isinstance(uid, str) and uid in by_id for uid in ids), sid, p+'/utteranceIds', '设计引用不存在的发言', file): continue
                covered.update(ids)
                windows = [(by_id[u].get('startFrame'), by_id[u].get('endFrameExclusive')) for u in ids]
                if not all(type(a) is int and type(b) is int and 0 <= a < b <= frames for a, b in windows): continue
                a, b = min(v[0] for v in windows), max(v[1] for v in windows)
                actions = []
                refs = d.get('eventRefs', [])
                if not check(isinstance(refs, list) and all(isinstance(ref, str) for ref in refs), sid, p+'/eventRefs', '动作引用必须为 ID 列表', file): continue
                for ref in refs:
                    block = blocks.get(ref) if isinstance(ref, str) else None
                    if not check(block is not None, sid, p+'/eventRefs', '动作引用不是实际 visualBlocks 事件', file): continue
                    try:
                        for x, y in action_windows(block):
                            x, y = max(0, x), min(frames, y)
                            if x < y: actions.append((x, y))
                    except (StageError, TypeError, KeyError) as exc:
                        check(False, sid, p+'/eventRefs', str(exc), file)
                if d.get('mode') == 'change' and timeline.get('renderInputContract') == CONTRACT:
                    check(bool(actions), sid, p+'/eventRefs', '变化设计必须绑定组件使用的动作窗口', file)
                action = (min(x for x, _ in actions), max(y for _, y in actions)) if actions else None
                if action: a, b = min(a, max(0, action[0]-1)), max(b, min(frames, action[1]+1))
                needed.update(review_frames(a, b, action))
                for window in actions: needed.update(review_frames(a, b, window))
                item = {'designIds': [did], 'utteranceIds': ids, 'mode': d.get('mode'), 'startFrame': a, 'endFrameExclusive': b}
                if action: item.update(changeStartFrame=action[0], changeEndFrameExclusive=action[1])
                checks.append(item)
            check(covered == set(by_id), sid, dp, '设计未覆盖全部讲解', file)
        plans[sid] = {'frames': sorted(needed), 'checks': checks}
    if 'totalFrames' in timeline: check(timeline['totalFrames'] == offset, None, '/totalFrames', '总帧数不一致')
    for runtime in runtime_inputs:
        sid = runtime['sceneId']; source = next((s for s in timeline['scenes'] if s.get('id') == sid), None)
        if source and type(source.get('endFrameExclusive')) is int and type(source.get('startFrame')) is int:
            check(runtime['frames'] == source['endFrameExclusive']-source['startFrame'], sid, '/frames', '执行帧数与正式时间轴不符')
    if issues:
        raise StageError('VISUAL_REVIEW_REQUIRED', f'制作输入有 {len(issues)} 项需修正', details={'category': 'production_input', 'issues': issues})
    return {'schemaVersion': 1, 'scenes': plans}
