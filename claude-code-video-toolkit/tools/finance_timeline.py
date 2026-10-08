"""当前财经模板的格式适配；不决定时长、角色或音乐选择。"""
import json
from pathlib import Path
from two_stage import local, require, read, write, digest
from actual_timeline import check_fixed_ending

def derive_timeline(root, request_path, timeline_name, project_name):
    """财经模板派生适配：保留正式记录，其他模板仍在自己的工程内适配数据。"""
    source = local(root, timeline_name)
    require(source == Path(request_path).resolve().parent / 'timeline.json', '派生必须读取当前 run 正式时间轴')
    project = local(root, project_name, exists=False)
    require(project.is_dir(), '工程目录不存在', 'MISSING_INPUT')
    require(project.is_relative_to(root/'project'), '派生仅能写当前任务工程')
    derived = read(source)
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
    target = local(project, 'src/timeline.ts', exists=False)
    # JSON 编码保证数据不会被拼接成可执行指令，目标路径仍需阻止符号链接逃逸。
    target.write_text("import type { FinanceTimeline } from './types';\nexport const timeline = " + json.dumps(derived, ensure_ascii=False) + " as FinanceTimeline;\n", encoding='utf-8')
    for index, scene in enumerate(derived['scenes'], 1):
        write(local(root, str((source.parent/f'scene-{index:02d}-props.json').relative_to(root)), exists=False),
              {'scene':scene, 'timeline':derived, 'withBgm':derived['withBgm']})
    return {'status':'ok', 'timelineHash':digest(source), 'scenes':len(derived['scenes'])}
