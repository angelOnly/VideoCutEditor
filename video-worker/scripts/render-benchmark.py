#!/usr/bin/env python3
"""固定输入、隔离缓存、顺序对照的本地渲染基准；不接触 Worker 队列。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import statistics
import subprocess
import time

MEDIA = re.compile(r'ffmpeg|ffprobe|remotion|render[_-](?:scene|batch)|chrome|chromium', re.I)


def processes():
    output = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,rss=,%cpu=,lstart=,command='], text=True)
    result = []
    for line in output.splitlines():
        parts = line.split(None, 10)
        if len(parts) == 11:
            result.append(dict(pid=int(parts[0]), ppid=int(parts[1]), pgid=int(parts[2]),
                               rssKiB=int(parts[3]), cpu=float(parts[4]), started=' '.join(parts[5:10]), command=parts[10]))
    return result


def descendants(rows, seeds):
    ids = set(seeds)
    while True:
        newer = ids | {p['pid'] for p in rows if p['ppid'] in ids}
        if newer == ids:
            return ids
        ids = newer


def blockers(rows, protected_root, own_group=None, own_pids=(), idle_baseline=()):
    # 原工作区命令及其子孙中的媒体进程；永远不向这些 PID 发信号。
    idle = {(p['pid'], p['started']) for p in idle_baseline}
    roots = {p['pid'] for p in rows if protected_root in p['command'] and p['pgid'] != own_group and p['pid'] not in own_pids}
    roots |= {p['pid'] for p in rows if (p['pid'], p.get('started')) in idle}
    protected = descendants(rows, roots)
    return [p for p in rows if p['pid'] in protected and p['pgid'] != own_group and p['pid'] not in own_pids and MEDIA.search(p['command'])
            and not ((p['pid'], p.get('started')) in idle and p.get('cpu', 0) <= 1)]


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def fingerprint(paths):
    result = {}
    for value in paths:
        path = Path(value).resolve(strict=True)
        if not path.is_file():
            raise ValueError(f'冻结输入必须逐文件列出: {path}')
        result[str(path)] = sha256(path)
    return result


def persist(path, data):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(path)


def track_owned(rows, root_pid, known):
    # 渲染监督器会 setsid；跨进程组沿父子链登记 PID + 启动时间，避免漏算或误杀重用 PID。
    live = {p['pid'] for p in rows if known.get(p['pid']) == (p.get('started'), p['pgid'])}
    ids = descendants(rows, live | ({root_pid} if root_pid not in known else set()))
    own = [p for p in rows if p['pid'] in ids]
    for process in own:
        known[process['pid']] = (process.get('started'), process['pgid'])
    return own


def stop_group(proc, known=None, cooperative=False):
    known = known if known is not None else {}
    if cooperative:
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            proc.poll()
            if not track_owned(processes(), proc.pid, known):
                return
            time.sleep(.1)
    for sig, seconds in [(signal.SIGTERM, 8), (signal.SIGKILL, 2)]:
        rows = track_owned(processes(), proc.pid, known)
        for pgid in {p['pgid'] for p in rows}:
            if pgid == os.getpgrp():
                continue
            try:
                os.killpg(pgid, sig)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            proc.poll()
            if not track_owned(processes(), proc.pid, known):
                return
            time.sleep(.1)
    proc.wait(timeout=2)


def execute(argv, cwd, env, folder, protected_root, timeout, interval, max_rss_kib, idle_baseline=()):
    start = time.monotonic()
    peak_rss = peak_cpu = cpu_integral = external_peak_rss = 0
    last = start
    samples = []
    reason = None
    blocking_processes = []
    known = {}
    with (folder / 'stdout.log').open('w') as out, (folder / 'stderr.log').open('w') as err:
        proc = subprocess.Popen(argv, cwd=cwd, env=env, stdout=out, stderr=err, start_new_session=True)
        try:
            while proc.poll() is None:
                rows = processes()
                own = track_owned(rows, proc.pid, known)
                rss = sum(p['rssKiB'] for p in own)
                cpu = sum(p['cpu'] for p in own)
                now = time.monotonic()
                cpu_integral += cpu / 100 * (now - last)
                last = now
                peak_rss, peak_cpu = max(peak_rss, rss), max(peak_cpu, cpu)
                idle_signatures = {(p['pid'], p['started']) for p in idle_baseline}
                external_rss = sum(p['rssKiB'] for p in rows if (p['pid'], p.get('started')) in idle_signatures)
                external_peak_rss = max(external_peak_rss, external_rss)
                samples.append({'seconds': now-start, 'rssKiB': rss, 'cpuPercent': cpu, 'externalIdleBaselineRssKiB': external_rss})
                busy = blockers(rows, protected_root, proc.pid, {p['pid'] for p in own}, idle_baseline)
                if busy:
                    reason = 'external_media_contention'
                    blocking_processes = [{k: p.get(k) for k in ('pid', 'ppid', 'pgid', 'started', 'cpu', 'rssKiB')}
                                          | {'command': p['command'][:2048]} for p in busy]
                    persist(folder / 'blocking-processes.json', {'observedAt': time.time(), 'processes': blocking_processes})
                elif now-start > timeout:
                    reason = 'timeout'
                elif rss > max_rss_kib:
                    reason = 'memory_limit'
                if reason:
                    cancel = env.get('VIDEOCUT_BATCH_CANCEL_FILE')
                    if cancel:
                        Path(cancel).write_text(reason + '\n')
                    stop_group(proc, known, cooperative=bool(cancel))
                    break
                time.sleep(interval)
        finally:
            # 包括 Ctrl-C、异常和正常父进程退出后留下的自有子进程。
            stop_group(proc, known)
    return {'argv': argv, 'exitCode': proc.returncode, 'reason': reason,
            'wallSeconds': time.monotonic()-start, 'blockingProcesses': blocking_processes, 'peakAggregateRssKiB': peak_rss,
            'peakCpuPercent': peak_cpu, 'externalIdleBaselinePeakRssKiB': external_peak_rss, 'sampledCpuSecondsEstimate': cpu_integral, 'samples': samples}


def cleanup_outputs(folder, relative_paths):
    folder = folder.resolve()
    records = []
    for relative in relative_paths:
        path = (folder / relative).resolve()
        if path == folder.resolve() or folder.resolve() not in path.parents:
            raise ValueError('清理目标必须位于本轮目录内部')
        files = sorted(path.rglob('*')) if path.is_dir() else [path]
        records.extend({'path': str(p.relative_to(folder)), 'size': p.stat().st_size,
                        'sha256': sha256(p)} for p in files if p.is_file())
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    return records


def summarize(runs):
    result = {}
    for run in runs:
        key = run['variant'] + '/' + run['condition']
        result.setdefault(key, {'valid': [], 'failed': 0, 'interrupted': 0})
        group = result[key]
        if run['status'] == 'passed':
            group['valid'].append(run)
        elif run['status'] == 'external_media_contention':
            group['interrupted'] += 1
        else:
            group['failed'] += 1
    for group in result.values():
        valid = group.pop('valid')
        group['successfulTrials'] = len(valid)
        group['qualified'] = len(valid) >= 3
        for field in ['wallSeconds', 'peakAggregateRssKiB', 'sampledCpuSecondsEstimate']:
            values = [r[field] for r in valid]
            group[field] = {'median': statistics.median(values), 'min': min(values), 'max': max(values)} if values else None
    return result


def validate_idle_baseline(config):
    baseline = config.get('idleBaselineProcesses', [])
    if not baseline:
        return []
    evidence = json.loads(Path(config['idleBaselineEvidence']).read_text())
    if evidence.get('observationSeconds', 0) < 60 or not 0 <= evidence.get('maxCpuPercent', 999) <= .5 or evidence.get('noActiveProducer') is not True:
        raise ValueError('闲置豁免必须有至少60秒CPU不超过0.5%且无原Node/ffmpeg生产者的只读证据')
    signatures = {(p['pid'], p['started']) for p in baseline}
    if signatures != {(p['pid'], p['started']) for p in evidence['processes']}:
        raise ValueError('豁免签名与观察证据不一致')
    observation = evidence.get('observationFile')
    if not observation or sha256(Path(observation)) != evidence.get('observationSha256'):
        raise ValueError('闲置豁免必须绑定原始观察文件及摘要')
    samples = json.loads(Path(observation).read_text())
    if not samples or samples[-1]['at'] - samples[0]['at'] < 60:
        raise ValueError('原始观察不足60秒')
    measured_max = 0
    for sample in samples:
        present = {(p['pid'], p['started']) for p in sample['processes']}
        if not signatures.issubset(present):
            raise ValueError('原始观察未持续覆盖全部豁免签名')
        measured_max = max(measured_max, max(p['cpu'] for p in sample['processes'] if (p['pid'], p['started']) in signatures))
    if measured_max > .5 or abs(measured_max - evidence['maxCpuPercent']) > .00001:
        raise ValueError('CPU摘要与原始观察不符或超过0.5%')
    completions = evidence.get('completionEvidence', [])
    if not completions or any(sha256(Path(p['path'])) != p['sha256'] for p in completions):
        raise ValueError('缺少旧任务已完结证据或证据摘要改变')
    return baseline


def run(config):
    root = Path(config['outputRoot']).resolve()
    protected = str(Path(config['protectedRoot']).resolve())
    cwd = Path(config['cwd']).resolve(strict=True)
    if root == Path(protected) or Path(protected) in root.parents or cwd == Path(protected) or Path(protected) in cwd.parents:
        raise ValueError('基准输出及命令工作目录不得位于原工作区')
    if root.exists():
        raise ValueError('outputRoot 必须是全新目录；防止误用成功账本或覆盖旧证据')
    if config.get('repetitions', 3) < 3:
        raise ValueError('每种条件至少三次')
    expected = {'old_serial': 1, 'new_1': 1, 'new_2': 2, 'new_3': 3}
    if {v['name']: v['slots'] for v in config['variants']} != expected:
        raise ValueError('variants 必须包含 old_serial/new_1/new_2/new_3 及正确槽数')
    if any(not v.get('stages') for v in config['variants']):
        raise ValueError('每组至少一个阶段命令')
    if not config.get('immutableInputs'):
        raise ValueError('必须列出确认稿、工程、音频与输出规格的冻结输入')
    idle_baseline = validate_idle_baseline(config)
    root.mkdir(parents=True)
    frozen = fingerprint(config['immutableInputs'])
    report = {'schemaVersion': 1, 'config': config, 'frozenInputs': frozen, 'runs': [], 'externalWaitSeconds': 0,
              'idleBaselineEvidence': json.loads(Path(config['idleBaselineEvidence']).read_text()) if idle_baseline else None,
              'measurementNotes': ['显式闲置浏览器仍占用外部常驻内存，本基准不假设机器完全独占。', 'RSS 为采样时自有后代进程 RSS 之和（共享页可能重复），不是系统精确峰值。',
                                   'CPU 为 ps 百分比积分估计，短进程可能漏采；所有组采用相同采样。',
                                   'cold 表示新建应用缓存；不清除系统页缓存。warm 复用紧邻 cold 缓存，但必须重渲而非复用成片。']}
    def save():
        report['summary'] = summarize(report['runs'])
        persist(root / 'results.json', report)
    try:
        for trial in range(1, config.get('repetitions', 3)+1):
            # 轮换组顺序，降低持续运行导致的温度/页缓存顺序偏差。
            variants = config['variants']
            variants = variants[(trial-1) % 4:] + variants[:(trial-1) % 4]
            for variant in variants:
                cache = root / f'cache-{variant["name"]}-{trial}'
                cache.mkdir()
                for condition in ['cold', 'warm']:
                    wait_start = time.monotonic()
                    while blockers(processes(), protected, idle_baseline=idle_baseline):
                        if time.monotonic()-wait_start > config.get('externalWaitTimeoutSeconds', 43200):
                            raise TimeoutError('原测试持续占用；保留原始记录，退出基准')
                        time.sleep(config.get('guardIntervalSeconds', 1))
                    report['externalWaitSeconds'] += time.monotonic()-wait_start
                    if fingerprint(config['immutableInputs']) != frozen:
                        raise ValueError('冻结输入发生变化；停止对比')
                    folder = root / f'{variant["name"]}-{trial}-{condition}'
                    folder.mkdir()
                    (folder / 'tmp').mkdir()
                    replace = {'runDir': str(folder), 'cacheDir': str(cache), 'slots': str(variant['slots']), 'trial': str(trial)}
                    def expand(value):
                        for key, replacement in replace.items():
                            value = value.replace('{' + key + '}', replacement)
                        return value
                    env = os.environ.copy()
                    # 不读取 .env；应用需显式消费自己的 cacheDir，不能写共享依赖。
                    env.update({'XDG_CACHE_HOME': str(cache), 'TMPDIR': str(folder / 'tmp'), 'BENCHMARK_CACHE_DIR': str(cache),
                                'VIDEOCUT_BATCH_CANCEL_FILE': str(folder / 'cancel')})
                    env.update({k: expand(v) for k, v in config.get('env', {}).items()})
                    measurement = {'variant': variant['name'], 'condition': condition, 'trial': trial,
                                   'stages': [], 'status': 'passed'}
                    started = time.monotonic()
                    for index, stage in enumerate(variant['stages']):
                        stage_dir = folder / f'{index:02d}-{stage["name"]}'
                        stage_dir.mkdir()
                        item = execute([expand(s) for s in stage['argv']], cwd, env, stage_dir, protected,
                                       stage.get('timeoutSeconds', 7200), config.get('sampleIntervalSeconds', .5),
                                       config.get('maxAggregateRssKiB', 10 * 1024 * 1024), idle_baseline)
                        item['name'] = stage['name']
                        measurement['stages'].append(item)
                        if item['reason'] or item['exitCode'] != 0:
                            measurement['status'] = item['reason'] or 'failed'
                            break
                    measurement.update(wallSeconds=time.monotonic()-started,
                        peakAggregateRssKiB=max(s['peakAggregateRssKiB'] for s in measurement['stages']),
                        sampledCpuSecondsEstimate=sum(s['sampledCpuSecondsEstimate'] for s in measurement['stages']))
                    report['runs'].append(measurement)
                    save()
                    measurement['removedArtifacts'] = cleanup_outputs(folder, config.get('cleanupRelativePaths', []))
                    save()
                    if measurement['status'] != 'passed':
                        # 不把中断后的热缓存重试伪装成冷启动，也不在 3 路失败后继续增加资源压力。
                        raise RuntimeError(f'基准中止: {measurement["status"]}；修复后用新 outputRoot 重跑，禁止纳入有效对照')
                    if fingerprint(config['immutableInputs']) != frozen:
                        raise ValueError('运行改动了冻结输入；全部对照失效')
                if config.get('cleanCacheAfterPair', True):
                    shutil.rmtree(cache)
    except BaseException as error:
        report['abort'] = str(error)
        report['qualified'] = False
        save()
        raise
    report['qualified'] = all(g['qualified'] for g in summarize(report['runs']).values())
    save()
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    run(json.loads(Path(args.config).read_text()))
