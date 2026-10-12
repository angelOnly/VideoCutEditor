"""当前财经模板的格式适配；不决定时长、角色或音乐选择。"""
import json
from copy import deepcopy
from production_contract import CONTRACT
from pathlib import Path
from two_stage import local, require, read, write, digest
from actual_timeline import check_fixed_ending

# 新契约采用明确字段表；扩展执行字段时必须同步适配器，不能静默丢弃。
TOP_FIELDS = {'renderInputContract', 'fps', 'width', 'height', 'totalFrames', 'title', 'chapters', 'bgm', 'ending', 'scenes', 'withBgm'}
SCENE_FIELDS = {'id', 'startFrame', 'endFrameExclusive', 'contentFrames', 'speaker', 'summary', 'chapter', 'intro', 'utterances', 'captions', 'captionTiming', 'visualBlocks', 'sfx'}


def project_timeline(timeline):
    value = deepcopy(timeline)
    isolated = value.get('renderInputContract') == CONTRACT
    if isolated:
        def no_records(item):
            if isinstance(item, dict):
                require(not ({'visualDesign', 'design', 'review', 'observed', 'viewedFrames', 'passed'} & item.keys()), '执行输入不能携带设计或审片记录')
                for child in item.values(): no_records(child)
            elif isinstance(item, list):
                for child in item: no_records(child)
        no_records(value)
        require(not (set(value)-TOP_FIELDS), '财经执行时间轴有未声明字段：'+str(sorted(set(value)-TOP_FIELDS)))
        for scene in value['scenes']:
            require(not (set(scene)-SCENE_FIELDS), '财经分镜有未声明执行字段：'+str(sorted(set(scene)-SCENE_FIELDS)))
        value.pop('renderInputContract')
    for scene in value['scenes']:
        scene['from'] = scene.pop('startFrame')
        scene['frames'] = scene.pop('endFrameExclusive') - scene['from']
        for utterance in scene['utterances']:
            utterance.pop('audioPath', None)
    return value


def scene_props(timeline, scene_id):
    value = project_timeline(timeline)
    scene = next(s for s in value['scenes'] if s['id'] == scene_id)
    if timeline.get('renderInputContract') == CONTRACT:
        # 导航保留全局标签；只有当前及保持画面使用的章节携带图解数据。
        sources = [scene]
        ending = value.get('ending')
        if ending and scene['from'] + scene['frames'] > ending.get('holdFrame', ending['narrationEndFrame']-1):
            hold = ending.get('holdFrame', ending['narrationEndFrame']-1)
            held = next(s for s in value['scenes'] if s['from'] <= hold < s['from']+s['frames'])
            if held['id'] != scene_id: sources.append(held)
        value['scenes'] = sources
        for chapter in value['chapters']:
            if not any(s['from'] < chapter['endFrameExclusive'] and s['from']+s['frames'] > chapter['from'] for s in sources):
                chapter['visualBlocks'] = []
    return {'scene': scene, 'timeline': value, 'withBgm': value['withBgm']}


def derive_timeline(root, request_path, timeline_name, project_name):
    """财经模板派生适配：保留正式记录，其他模板仍在自己的工程内适配数据。"""
    source = local(root, timeline_name)
    require(source == Path(request_path).resolve().parent / 'timeline.json', '派生必须读取当前 run 正式时间轴')
    project = local(root, project_name, exists=False)
    require(project.is_dir(), '工程目录不存在', 'MISSING_INPUT')
    require(project.is_relative_to(root/'project'), '派生仅能写当前任务工程')
    official = read(source)
    derived = deepcopy(official)
    # 收尾字段原样透传；派生只校验，不增加片尾或改写任何正式边界。
    check_fixed_ending(derived)
    require(type(derived.get('withBgm')) is bool, '财经适配需明确 withBgm，保留本任务音乐选择')
    offset = 0
    for scene in derived['scenes']:
        require(scene['startFrame'] == offset and scene['endFrameExclusive'] > offset, '正式时间轴边界无效')
        scene['from'] = offset; scene['frames'] = scene['endFrameExclusive'] - offset
        # 保留明确声音窗口；延长画面不能隐式延长音乐再触发下一轮补帧。
        if 'contentFrames' in scene:
            require(type(scene['contentFrames']) is int and 0 < scene['contentFrames'] <= scene['frames'], '声音窗口无效')
        offset = scene['endFrameExclusive']
        for u in scene['utterances']:
            require(digest(local(root, u['audioPath'])) == digest(local(project/'public', u['src'])), '正式音频与工程来源不一致')
            # 模板类型不接收溯源字段；仅从派生副本移除，绝不回写正式 JSON。
            u.pop('audioPath')
        scene.pop('startFrame'); scene.pop('endFrameExclusive')
    require(offset == derived['totalFrames'], '时间轴总帧数不一致')
    isolated = official.get('renderInputContract') == CONTRACT
    if isolated:
        require((project/'render-contract.json').is_file() and read(project/'render-contract.json').get('contract') == CONTRACT,
                '工程未适配 finance-scene/v2，不得静默迁移旧任务')
        require(not (project/'src/timeline.ts').exists(), '新契约不允许将全片数据写入共同源码，请显式迁移工程入口')
    else:
        target = local(project, 'src/timeline.ts', exists=False)
        target.write_text("import type { FinanceTimeline } from './types';\nexport const timeline = " + json.dumps(derived, ensure_ascii=False) + " as FinanceTimeline;\n", encoding='utf-8')
    for index, scene in enumerate(official['scenes'], 1):
        props = scene_props(official, scene['id'])
        write(local(root, str((source.parent/f'scene-{index:02d}-props.json').relative_to(root)), exists=False), props)
    return {'status':'ok', 'timelineHash':digest(source), 'scenes':len(derived['scenes']),
            'reuseMode': CONTRACT if isolated else 'legacy-conservative'}
