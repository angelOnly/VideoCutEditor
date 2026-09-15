#!/usr/bin/env python3
"""本任务内容寻址配音缓存；收费结果未知时停止而不是重发。"""
from __future__ import annotations

from pathlib import Path
import time
import uuid
from two_stage import StageError, digest, json_digest, lock, read, require, write


def synthesize_cached(text, speaker, resource_id, cache_dir, generate=None, inspect=None):
    from stage_media import audio_info
    if generate is None:
        from doubao_tts import generate_audio
        generate = generate_audio
    inspect = inspect or audio_info
    require(text.strip() and speaker and resource_id, '文本、音色和资源模型不能为空')
    # 对应豆包当前真实请求格式；不将未生效参数假装加入缓存。
    parameters = {'provider': 'doubao', 'text': text, 'speaker': speaker, 'resourceId': resource_id,
                  'audio': {'format': 'mp3', 'sample_rate': 24000}, 'protocol': 1}
    key = json_digest(parameters); folder = Path(cache_dir) / key
    folder.mkdir(parents=True, exist_ok=True)
    record_file, audio = folder / 'request.json', folder / 'audio.mp3'
    with lock(folder / '.lock'):
        previous = read(record_file) if record_file.exists() else None
        if previous:
            require(previous['parameters'] == parameters, '缓存参数不匹配', 'CACHE_CORRUPT')
            if previous['state'] == 'completed':
                require(audio.is_file() and digest(audio) == previous['audio']['sha256'], '成功缓存损坏；请核查原产物，不自动重复收费', 'CACHE_CORRUPT')
                verified = inspect(audio)
                return {**previous, 'path': str(audio), 'reused': True, 'audio': verified}
            require(previous['state'] == 'not_submitted', '收费请求结果未知，请核对供应商记录', 'EXTERNAL_RESULT_UNKNOWN')
        attempts = (previous.get('attempts', 0) if previous else 0) + 1
        require(attempts <= 10, '配音请求尝试次数耗尽', 'BUDGET_EXHAUSTED')
        request_id = str(uuid.uuid4())
        record = {'parameters': parameters, 'cacheKey': key, 'state': 'pending', 'requestId': request_id,
                  'attempts': attempts, 'startedAt': time.time()}
        write(record_file, record)
        temporary = folder / 'audio.partial.mp3'
        try:
            result = generate(text, str(temporary), speaker=speaker, resource_id=resource_id,
                              request_id=request_id, verbose=False)
            if not result.get('success'):
                # 只有供应商调用前明确拒绝才可重试；网络/响应不明保守停止。
                record['state'] = 'not_submitted' if result.get('submitted') is False else 'unknown'
                record['error'] = result.get('error', '供应商未返回成功')
                write(record_file, record)
                raise StageError('TTS_NOT_SUBMITTED' if record['state'] == 'not_submitted' else 'EXTERNAL_RESULT_UNKNOWN', record['error'])
            verified = inspect(temporary)
            temporary.replace(audio)
            record.update(state='completed', completedAt=time.time(), audio=verified)
            write(record_file, record)
            return {**record, 'path': str(audio), 'reused': False}
        except BaseException:
            # pending 持久保留；中断重启不能把落盘的半成品当成成功。
            raise
