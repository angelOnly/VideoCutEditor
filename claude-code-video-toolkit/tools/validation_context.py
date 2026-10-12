"""仅在一次可信交付调用内复用技术事实，不读取任务提交的通过标记。"""
from contextvars import ContextVar
from contextlib import contextmanager
from copy import deepcopy
from functools import wraps
from pathlib import Path
import os
import shutil
from two_stage import digest, json_digest, require

_current = ContextVar('media_validation', default=None)


class ValidationContext:
    def __init__(self):
        self._facts = {}
        self._files = {}
        self.hits = 0
        self.misses = 0

    def check_stable(self):
        for path, expected in self._files.items():
            require(digest(Path(path)) == expected, '交付过程中媒体发生变化', 'MEDIA_INVALID')

    def observe(self, path):
        path = str(Path(path).resolve())
        value = digest(Path(path))
        self._files[path] = value
        return value


@contextmanager
def using_validation(context):
    context = context or _current.get() or ValidationContext()
    token = _current.set(context)
    try:
        yield context
        context.check_stable()
    finally:
        _current.reset(token)


def technical_fact(function):
    """缓存键绑定实际字节、参数与本次加载的检查实现；每次命中仍重新读摘要。"""
    @wraps(function)
    def wrapped(path, *args, **kwargs):
        context = _current.get()
        if context is None: return function(path, *args, **kwargs)
        before = context.observe(path)
        key = json_digest({'check': function.__name__, 'implementation': digest(Path(function.__code__.co_filename)),
                           'contextRules': digest(Path(__file__)),
                           'decoders': {name: digest(Path(shutil.which(os.environ.get(name, name.lower())))) for name in ('FFMPEG', 'FFPROBE')},
                           'media': before, 'args': args, 'kwargs': kwargs})
        if key in context._facts:
            context.hits += 1
            return deepcopy(context._facts[key])
        result = function(path, *args, **kwargs)
        require(digest(Path(path)) == before, '技术检查期间媒体发生变化', 'MEDIA_INVALID')
        context._facts[key] = deepcopy(result); context.misses += 1
        return result
    return wrapped


def delivery_scope(function):
    @wraps(function)
    def wrapped(*args, validation_context=None, **kwargs):
        with using_validation(validation_context):
            return function(*args, **kwargs)
    return wrapped
