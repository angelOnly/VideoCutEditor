"""受控分镜输入边界；旧工程保守失效，新工程禁止从任务记录旁路读取。"""
import json
import os
from pathlib import Path
import sys
from two_stage import read, local, require
from production_contract import CONTRACT, validate_production_inputs
from finance_timeline import scene_props, project_timeline


def production_inputs(root, request_path, request, project_name, scenes, modules=None, node=None):
    folder = Path(request_path).resolve().parent
    timeline_path = folder/'timeline.json'
    require(timeline_path.is_file(), '正式渲染前需要 timeline.json', 'VISUAL_REVIEW_REQUIRED')
    timeline = read(timeline_path)
    require(isinstance(timeline, dict), '正式时间轴结构无效')
    require(timeline.get('renderInputContract') in (None, CONTRACT), '未知执行输入合同，不能静默降级')
    isolated = timeline.get('renderInputContract') == CONTRACT
    design = read(folder/'design.json') if (folder/'design.json').exists() else None
    if isolated: require(design is not None, '新契约需要独立 design.json', 'VISUAL_REVIEW_REQUIRED')
    project = local(root, project_name, exists=False)
    plan = validate_production_inputs(root, request, timeline, design, scenes, project)
    if isolated:
        require(read(project/'render-contract.json').get('contract') == CONTRACT, '工程未声明新执行契约')
        require(not (project/'src/timeline.ts').exists(), '新契约禁止共同源码固化全片时间轴')
        for parent, directories, names in os.walk(project):
            directories[:] = [name for name in directories if name not in ('node_modules', '.git')]
            require(not (set(names) & {'design.json', 'review.json', 'review-plan.json', 'timeline.json'}), '记录不能复制进渲染工程')
        for scene in scenes:
            require(scene.get('props') and read(local(root, scene['props'])) == scene_props(timeline, scene['sceneId']),
                    '执行参数不是当前模板投影，请重新派生', 'TIMELINE_STALE')
            require(scene['composition'] == 'FinanceScene', '新财经契约使用 FinanceScene Composition')
    # 音频实测与现有声音覆盖规则共用，必须早于打包和浏览器派发。
    from stage_media import check_speech_coverage, fixed_ending_context
    for scene in scenes:
        if scene.get('props'):
            props = read(local(root, scene['props']))
            bounds, _ = fixed_ending_context(root, request, request_path, project, props)
            check_speech_coverage(project, props, scene['frames'], request['outputSpec']['fps'], bounds)
    if isolated:
        require(modules and node, '新契约检查需要当前 Node 与模板依赖', 'CAPABILITY_MISSING')
        import tempfile
        from stage_media import command
        from two_stage import write
        with tempfile.TemporaryDirectory(prefix='validate-', dir=folder) as name:
            temp = Path(name)
            write(temp/'config.json', {'validateOnly': True, 'modules': str(Path(modules).resolve()),
                'project': str(project), 'timeline': project_timeline(timeline), 'done': str(temp/'done.json')})
            argv = ['/usr/bin/env', 'HOME='+str(temp), 'TMPDIR='+str(temp), node,
                    str(Path(__file__).with_name('render_scene.cjs')), str(temp/'config.json')]
            sandbox = os.environ.get('VIDEOCUT_RENDER_SANDBOX', 'seatbelt' if sys.platform == 'darwin' else 'landlock')
            command(isolated_command(argv, sandbox, root, project, temp))
    return plan, CONTRACT if isolated else 'legacy-conservative'


def isolated_command(argv, sandbox, root, project, temp, bundle=None):
    """隐藏整个任务目录，仅挂回固定工程和执行目录；构建和浏览器使用同一边界。"""
    from stage_media import render_seatbelt_profile
    paths = [Path(project).resolve(), Path(temp).resolve()]
    if bundle: paths.append(Path(bundle).resolve())
    require(sandbox in ('seatbelt', 'bwrap', 'landlock'), '新输入契约必须使用具有读取隔离的沙箱', 'CAPABILITY_MISSING')
    if sandbox == 'landlock':
        return [sys.executable, str(Path(__file__).with_name('render_landlock.py')),
                json.dumps({'root': str(Path(root).resolve()), 'readable': [str(p) for p in paths],
                            'writable': [str(Path(temp).resolve())]}), *argv]
    if sandbox == 'bwrap':
        result = ['bwrap', '--die-with-parent', '--unshare-pid', '--ro-bind', '/', '/', '--tmpfs', str(root)]
        for path in paths:
            result += ['--bind' if path == Path(temp).resolve() else '--ro-bind', str(path), str(path)]
        return [*result, '--dev-bind', '/dev', '/dev', '--proc', '/proc', '--', *argv]
    profile = render_seatbelt_profile(temp)
    # deny 的例外只包含本次白名单，不能用只读整个任务目录代替读取隔离。
    exceptions = ' '.join('(require-not (subpath '+json.dumps(str(p))+'))' for p in paths)
    profile += '(deny file-read-data (require-all (subpath '+json.dumps(str(root))+') '+exceptions+'))'
    return ['/usr/bin/sandbox-exec', '-p', profile, *argv]


def frame_concurrency():
    try: value = int(os.environ.get('VIDEOCUT_FRAME_CONCURRENCY', '1'))
    except ValueError: value = 0
    require(value in (1, 2), '帧并发只支持受控配置 1 或 2', 'RENDER_SLOT_CONFIG_INVALID')
    return value
