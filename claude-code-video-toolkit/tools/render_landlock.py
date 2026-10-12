"""Linux 渲染文件隔离：无需创建命名空间，网络权限沿用外层 Worker。"""
import ctypes
import os
from pathlib import Path
import sys


def restrict_files(root, readable, writable):
    # Landlock 限制只会叠加，不能扩大 Codex 外层已经授予的权限。
    libc = ctypes.CDLL(None, use_errno=True)
    abi = libc.syscall(444, 0, 0, 1)
    if abi < 3:
        raise RuntimeError('渲染文件隔离需要 Landlock ABI 3 或更新版本')
    execute, write, read, listdir = 1, 2, 4, 8
    handled = (1 << 15) - 1  # ABI 3：包含重命名及 truncate。

    class Ruleset(ctypes.Structure):
        _fields_ = [('handled_access_fs', ctypes.c_uint64)]

    class PathRule(ctypes.Structure):
        _pack_ = 1
        _fields_ = [('allowed_access', ctypes.c_uint64), ('parent_fd', ctypes.c_int32)]

    def checked(result):
        if result < 0:
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error))
        return result

    attr = Ruleset(handled)
    ruleset = checked(libc.syscall(444, ctypes.byref(attr), ctypes.sizeof(attr), 0))

    def allow(path, access):
        fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
        try:
            # 普通文件不接受目录操作权限。
            if not Path(path).is_dir():
                access &= execute | write | read | (1 << 14)
            rule = PathRule(access, fd)
            checked(libc.syscall(445, ruleset, 1, ctypes.byref(rule), 0))
        finally:
            os.close(fd)

    try:
        root = Path(root).resolve(strict=True)
        if root == Path('/'):
            raise ValueError('任务根目录不能是文件系统根目录')
        # 目录名可见不代表文件内容可读。沿任务祖先逐层开放兄弟路径，
        # 不开放任务根本身，避免把 sidecar 通过祖先规则重新放进来。
        allow('/', listdir)
        ancestors = list(reversed(root.parents)) + [root]
        for parent, child in zip(ancestors, ancestors[1:]):
            for sibling in parent.iterdir():
                if sibling == child or sibling.is_symlink():
                    continue
                try:
                    allow(sibling, execute | read | listdir)
                except PermissionError:
                    pass  # 外层已禁止的路径无需再次开放。
        for path in readable:
            allow(Path(path).resolve(strict=True), execute | read | listdir)
        for path in writable:
            allow(Path(path).resolve(strict=True), handled)
        # 浏览器需要设备节点；仍受外层设备和文件权限约束。
        allow('/dev', handled)
        checked(libc.prctl(38, 1, 0, 0, 0))  # PR_SET_NO_NEW_PRIVS
        checked(libc.syscall(446, ruleset, 0))
    finally:
        os.close(ruleset)


if __name__ == '__main__':
    import json
    try:
        config = json.loads(sys.argv[1])
        restrict_files(config['root'], config['readable'], config['writable'])
        os.execvpe(sys.argv[2], sys.argv[2:], os.environ)
    except Exception as error:
        sys.exit('渲染文件隔离失败：' + str(error))
