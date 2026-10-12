"""冻结批次与单写协调器：公共工程变化保守失效，成功分镜可独立恢复。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import os
from pathlib import Path
import signal
import sys
import threading
import time
import uuid

import stage_media as media
from render_inputs import production_inputs, isolated_command, frame_concurrency
from production_contract import CONTRACT
from two_stage import StageError, digest, execution, identifier, json_digest, load_request, local, read, require, write


def package_fingerprint(modules):
    """有界实际运行时代码摘要；不在取消轮询中扫描依赖。"""
    modules = Path(modules).resolve()
    values = {}
    for name in ('@remotion', 'remotion', 'react', 'react-dom', 'scheduler', 'webpack', '.package-lock.json'):
        path = modules / name
        if path.is_file(): values[name] = digest(path)
        elif path.is_dir():
            for file in sorted(path.rglob('*')):
                if file.is_file(): values[str(file.relative_to(modules))] = digest(file)
    for name in ('remotion', '@remotion/renderer', '@remotion/bundler'):
        require((modules/name/'package.json').is_file(), '缺少渲染依赖：' + name, 'CAPABILITY_MISSING')
    return values


def validate_scenes(root, request, scenes):
    require(isinstance(scenes, list) and scenes, '分镜批次不能为空')
    require(all(isinstance(s, dict) and {'sceneId', 'composition', 'frames'} <= s.keys() for s in scenes), '分镜参数缺失')
    ids = [s['sceneId'] for s in scenes]
    require(all(isinstance(s, str) for s in ids), '分镜 ID 必须为字符串')
    require(len(ids) == len(set(ids)), '批次不能重复分镜')
    confirmed = [s['id'] for s in read(local(root, request['confirmation']['planFile']))['scenes']]
    require(all(s in confirmed for s in ids), '批次包含未确认分镜')
    for scene in scenes:
        identifier(scene['sceneId'])
        require(type(scene['frames']) is int and scene['frames'] > 0, '分镜帧数无效')
        require(isinstance(scene['composition'], str) and scene['composition'], '缺少 Composition')
        require(type(scene.get('fixedMix', False)) is bool, 'fixedMix 必须为布尔值')
    return confirmed


def inputs(root, request_path, request, project, entry, scenes, modules, browser):
    project_path = local(root, project, exists=False)
    require(project_path.is_dir() and project_path != root, '需要独立工程目录')
    require(local(root, entry).is_relative_to(project_path), '入口必须属于冻结工程')
    packages = package_fingerprint(modules)
    # 公共工具和组件也属于输入；不尝试推测复杂跨章依赖。
    toolkit = Path(__file__).resolve().parent.parent
    shared = {str(p.relative_to(toolkit)): digest(p) for directory in ('lib',)
              for p in (toolkit / directory).rglob('*') if p.is_file()}
    timeline = Path(request_path).resolve().parent / 'timeline.json'
    return {'projectFiles': media.project_fingerprint(project_path), 'sharedFiles': shared,
            'props': {s['sceneId']: read(local(root, s['props'])) if s.get('props') else {} for s in scenes},
            'timelineHash': digest(timeline) if timeline.exists() else None,
            'fixedMix': {s['sceneId']: read(Path(request_path).resolve().parent / 'work' / (s['sceneId'] + '.adjustment.json'))
                         for s in scenes if s.get('fixedMix')},
            'planHash': request['confirmation']['planSha256'], 'spec': request['outputSpec'],
            'packages': packages, 'browser': digest(Path(browser)),
            'tools': {name: digest(Path(__file__).with_name(name)) for name in ('render_batch.py', 'stage_media.py', 'render_scene.cjs', 'two_stage.py', 'actual_timeline.py', 'finance_timeline.py', 'production_contract.py', 'render_inputs.py', 'render_landlock.py')},
            'frameConcurrency': frame_concurrency(),
            'designHash': digest(timeline.with_name('design.json')) if timeline.with_name('design.json').exists() else None}


def freeze_batch(args):
    identifier(args.batch)
    with execution(args.request, 'freeze-batch') as (root, request, _budget):
        scenes = read(local(root, args.scenes))
        confirmed = validate_scenes(root, request, scenes)
        ids = [s['sceneId'] for s in scenes]
        scenes.sort(key=lambda s: confirmed.index(s['sceneId']))
        began = time.monotonic()
        review_plan, mode = production_inputs(root, args.request, request, args.project, scenes, args.modules, args.node)
        input_seconds = time.monotonic()-began
        began = time.monotonic()
        write(Path(args.request).resolve().parent/'review-plan.json', review_plan)
        frozen = inputs(root, args.request, request, args.project, args.entry, scenes, args.modules, args.browser)
        contract = {'schemaVersion': 1, 'runId': request['runId'], 'project': args.project,
                    'entry': args.entry, 'scenes': scenes, 'inputs': frozen}
        manifest = {**contract, 'version': json_digest(contract)}
        path = Path(args.request).resolve().parent / 'batches' / args.batch / 'manifest.json'
        if path.exists(): require(read(path) == manifest, '已有批次不可覆盖，请使用新 batch ID', 'TIMELINE_STALE')
        else: write(path, manifest)
        return {'manifest': str(path.relative_to(root)), 'version': manifest['version'], 'scenes': ids,
                'reuseMode': mode, 'inputValidationSeconds': input_seconds,
                'fingerprintSeconds': time.monotonic()-began}


def verify_manifest(root, request_path, request, manifest, modules, browser):
    require(isinstance(manifest, dict) and manifest.get('schemaVersion') == 1, '不支持的批次版本')
    require({'schemaVersion', 'runId', 'project', 'entry', 'scenes', 'inputs', 'version'} == manifest.keys(), '批次字段不完整')
    confirmed = validate_scenes(root, request, manifest['scenes'])
    require([s['sceneId'] for s in manifest['scenes']] == sorted([s['sceneId'] for s in manifest['scenes']], key=confirmed.index), '批次顺序须遵守确认稿')
    contract = {k: v for k, v in manifest.items() if k != 'version'}
    require(manifest['version'] == json_digest(contract), '冻结清单摘要不匹配', 'TIMELINE_STALE')
    require(manifest['runId'] == request['runId'], '批次归属不匹配')
    current = inputs(root, request_path, request, manifest['project'], manifest['entry'], manifest['scenes'], modules, browser)
    require(current == manifest['inputs'], '冻结输入已变化，必须建立新批次', 'TIMELINE_STALE')


def render_batch(args):
    started = time.monotonic()
    with execution(args.request, 'render-batch') as context:
        root, request, budget = context
        manifest_path = local(root, args.manifest)
        batch_dir = manifest_path.parent
        require(batch_dir.parent == Path(args.request).resolve().parent / 'batches', '批次路径必须属于当前 Render')
        manifest = read(manifest_path)
        require(args.slots in (1, 2, 3, 4, 5), '只支持 1 至 5 个渲染槽')
        verify_manifest(root, args.request, request, manifest, args.modules, args.browser)
        fingerprint_seconds = time.monotonic()-started
        input_started = time.monotonic()
        review_plan, mode = production_inputs(root, args.request, request, manifest['project'], manifest['scenes'], args.modules, args.node)
        input_seconds = time.monotonic()-input_started
        write(Path(args.request).resolve().parent/'review-plan.json', review_plan)
        require(os.environ.get('VIDEOCUT_RENDER_SANDBOX', 'seatbelt' if sys.platform == 'darwin' else 'landlock') in ('seatbelt', 'bwrap', 'native'),
                '批次必须使用只读输入沙箱', 'CAPABILITY_MISSING')
        usage = media.CgroupUsage()
        stop = threading.Event()
        deadline = started + budget
        cancel = os.environ.get('VIDEOCUT_BATCH_CANCEL_FILE')
        pause = os.environ.get('VIDEOCUT_BATCH_PAUSE_FILE')
        previous_handlers = {}
        def on_signal(_signum, _frame): stop.set()
        for sig in (signal.SIGTERM, signal.SIGINT):
            previous_handlers[sig] = signal.signal(sig, on_signal)
        parent_check_lock = threading.Lock()
        last_parent_check = [0.0]
        def check():
            require(not stop.is_set() and not (cancel and Path(cancel).exists()), '批次已取消', 'TASK_CANCELLED')
            require(time.monotonic() < deadline, '批次总墙钟预算耗尽', 'BUDGET_EXHAUSTED')
            if getattr(media._BATCH_CONTEXT, 'checking_parent', False): return
            with parent_check_lock:
                if time.monotonic() - last_parent_check[0] >= 1:
                    usage.observe()
                    media._BATCH_CONTEXT.checking_parent = True
                    try:
                        load_request(args.request, 'render')
                        last_parent_check[0] = time.monotonic()
                    finally: media._BATCH_CONTEXT.checking_parent = False
        def validate():
            require(read(manifest_path) == manifest, '运行中的冻结清单已变化', 'TIMELINE_STALE')
            check()
            load_request(args.request, 'render')
            verify_manifest(root, args.request, request, manifest, args.modules, args.browser)
        results, failures, scene_seconds, scene_resources = {}, [], {}, {}
        metrics = {'slots': args.slots, 'bundleSeconds': 0, 'bundleReused': False,
                   'sceneSeconds': scene_seconds, 'sceneResourceMetrics': scene_resources,
                   'reuseMode': mode, 'frameConcurrency': frame_concurrency(),
                   'inputValidationSeconds': input_seconds, 'fingerprintSeconds': fingerprint_seconds}
        # bundle 仅由构建输入决定；换批次、补说明或只改 props 不需要重新打包。
        bundle_key = json_digest({k: manifest['inputs'][k] for k in ('projectFiles', 'sharedFiles', 'packages', 'tools')})
        bundle_root = Path(args.request).resolve().parent/'bundles'/bundle_key
        bundle_root.mkdir(parents=True, exist_ok=True)
        bundle_dir = bundle_root/'bundle'
        bundle_marker = bundle_root/'bundle.json'
        attempt = uuid.uuid4().hex
        work_dir = Path(args.request).resolve().parent / 'work'; work_dir.mkdir(exist_ok=True)
        def snapshot():
            usage.observe()
            metrics['batchResources'] = usage.diagnostics()
            write(batch_dir / 'progress.json', {'version': manifest['version'], 'attemptId': attempt,
                  'results': [results[s['sceneId']] for s in manifest['scenes'] if s['sceneId'] in results],
                  'failures': failures, 'metrics': {**metrics, 'wallSeconds': time.monotonic() - started}})
        try:
            media._BATCH_CONTEXT.check = check
            media._BATCH_CONTEXT.process_dir = work_dir
            reuse = bundle_marker.exists() and bundle_dir.exists()
            if reuse:
                saved = read(bundle_marker)
                reuse = saved.get('bundleKey') == bundle_key and saved.get('files') == media.project_fingerprint(bundle_dir)
            if not reuse:
                if bundle_dir.exists():
                    import shutil
                    shutil.rmtree(bundle_dir)
                build = batch_dir / ('build-' + attempt); build.mkdir()
                config = {'modules': str(Path(args.modules).resolve()), 'project': str(local(root, manifest['project'], exists=False)),
                          'entry': str(local(root, manifest['entry'])), 'bundle': str(build / 'bundle'),
                          'bundleOnly': True, 'done': str(build / 'done.json')}
                write(build / 'config.json', config)
                build_start = time.monotonic()
                scratch = build / 'runtime'; scratch.mkdir()
                argv = ['/usr/bin/env', 'TMPDIR='+str(scratch), 'HOME='+str(scratch), args.node,
                        str(Path(__file__).with_name('render_scene.cjs')), str(build / 'config.json')]
                sandbox = os.environ.get('VIDEOCUT_RENDER_SANDBOX') or ('seatbelt' if sys.platform == 'darwin' else 'landlock')
                require(sandbox in ('bwrap', 'seatbelt', 'landlock', 'native'), '批次必须使用只读输入沙箱', 'CAPABILITY_MISSING')
                if mode == CONTRACT:
                    argv = isolated_command(argv, sandbox, root, local(root, manifest['project'], exists=False), build)
                elif sandbox == 'landlock':
                    argv = isolated_command(argv, sandbox, root, root, build)
                elif sandbox == 'bwrap':
                    argv = ['bwrap', '--die-with-parent', '--unshare-pid', '--ro-bind', '/', '/',
                            '--bind', str(build), str(build), '--dev-bind', '/dev', '/dev', '--proc', '/proc', '--', *argv]
                elif sandbox == 'seatbelt':
                    argv = ['/usr/bin/sandbox-exec', '-p', media.render_seatbelt_profile(build), *argv]
                media.supervise(argv, local(root, manifest['project'], exists=False), work_dir / ('bundle-' + attempt + '.log'), build / 'done.json', max(.01, deadline-time.monotonic()))
                (build / 'bundle').rename(bundle_dir)
                validate()
                write(bundle_marker, {'bundleKey': bundle_key, 'files': media.project_fingerprint(bundle_dir)})
                metrics['bundleSeconds'] = time.monotonic() - build_start
            metrics['bundleReused'] = reuse
            bundle_files = read(bundle_marker)['files']
            def validate_render():
                validate()
                require(media.project_fingerprint(bundle_dir) == bundle_files, '共享 bundle 已变化', 'CACHE_CORRUPT')
            def job(scene):
                media._BATCH_CONTEXT.check = check
                media._BATCH_CONTEXT.process_dir = work_dir
                began = time.monotonic()
                try:
                    value = media.render_scene(args.request, scene['sceneId'], manifest['project'], manifest['entry'],
                        scene['composition'], scene.get('props'), scene['frames'], args.node, args.modules, args.browser,
                        scene.get('fixedMix', False), batch_context={'execution': (root, request, max(.01, deadline-time.monotonic())),
                            'version': manifest['version'], 'bundle': str(bundle_dir), 'validate': validate_render,
                            'identity': {k: manifest['inputs'][k] for k in ('sharedFiles', 'packages', 'browser', 'tools')},
                            'reuseMode': mode, 'reviewFrames': review_plan['scenes'][scene['sceneId']]['frames']})
                    return value, time.monotonic() - began
                finally:
                    media._BATCH_CONTEXT.check = None
                    media._BATCH_CONTEXT.process_dir = None
            # 按长镜头优先领取，交付结果仍按确认顺序。
            pending = sorted(manifest['scenes'], key=lambda s: -s['frames'])
            with ThreadPoolExecutor(max_workers=args.slots) as pool:
                active = {}
                fatal_error = None
                try:
                    while pending or active:
                        check()
                        # 资源边界失效后不再新增分镜，但已启动分镜继续收敛并写入成功结果。
                        while (not fatal_error and pending and len(active) < args.slots
                               and not (pause and Path(pause).exists())):
                            check()
                            scene = pending.pop(0)
                            active[pool.submit(job, scene)] = scene
                        if not active:
                            if fatal_error: break
                            time.sleep(.2); continue
                        done, _ = wait(active, timeout=.2, return_when=FIRST_COMPLETED)
                        for future in done:
                            scene = active.pop(future); scene_id = scene['sceneId']
                            try:
                                result, seconds = future.result()
                                validate_render()
                                results[scene_id] = {'sceneId': scene_id, **result}
                                scene_seconds[scene_id] = seconds
                                if result.get('resourceMetrics') is not None:
                                    scene_resources[scene_id] = result['resourceMetrics']
                                write(batch_dir / 'results' / scene_id / (attempt + '.json'),
                                      {'version': manifest['version'], 'attemptId': attempt, 'result': results[scene_id], 'seconds': seconds})
                            except Exception as exc:
                                error = {'sceneId': scene_id, 'code': getattr(exc, 'code', 'RENDER_FAILED'),
                                         'message': str(exc), 'details': getattr(exc, 'details', None)}
                                failures.append(error)
                                write(batch_dir / 'results' / scene_id / (attempt + '.json'),
                                      {'version': manifest['version'], 'attemptId': attempt, 'error': error})
                                if error['code'] in ('PROCESS_LIMIT_EXCEEDED', 'PROCESS_CLEANUP_FAILED', 'BROWSER_UNAVAILABLE'):
                                    # 不设置 stop：其余已启动的线程需要自行结束，成功产物要进入批次结果。
                                    fatal_error = fatal_error or exc
                                elif error['code'] in ('TASK_CANCELLED', 'BUDGET_EXHAUSTED', 'TIMELINE_STALE',
                                                       'STALE_CONFIRMATION', 'INPUT_CHANGED', 'CONFIRMATION_CHANGED', 'CACHE_CORRUPT'):
                                    stop.set()
                                    raise
                            snapshot()
                except BaseException:
                    stop.set()
                    raise
            if fatal_error: raise fatal_error
            validate_render()
            metrics.update({'wallSeconds': time.monotonic()-started, 'reused': sum(bool(r.get('reused')) for r in results.values()),
                            'failures': len(failures),
                            'browserRenderCount': sum(r.get('browserRenderCount', 0) for r in results.values()),
                            'newRenderedFrames': sum(r.get('newRenderedFrames', 0) for r in results.values())})
            snapshot()
            if failures:
                raise StageError('RENDER_BATCH_FAILED', '部分分镜失败，成功分镜已保留；修复后恢复同一批次', True,
                                 details={'failures': failures, 'progress': str((batch_dir/'progress.json').relative_to(root))})
            return {'version': manifest['version'], 'results': [results[s['sceneId']] for s in manifest['scenes']], 'metrics': metrics}
        finally:
            stop.set()
            media._BATCH_CONTEXT.check = None
            media._BATCH_CONTEXT.process_dir = None
            for sig, handler in previous_handlers.items(): signal.signal(sig, handler)
            snapshot()
