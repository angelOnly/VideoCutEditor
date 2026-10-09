"""启动本地参考库，明确文本编码，避免中文说明乱码。"""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class LibraryHandler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        # 浏览器直接打开说明和源码时，也应按 UTF-8 读取。
        suffix = Path(path).suffix.lower()
        if suffix in {".md", ".tsx", ".ts", ".py"}:
            return "text/plain; charset=utf-8"
        content_type = super().guess_type(path)
        if content_type.startswith("text/") or suffix in {".json", ".js", ".mjs"}:
            return f"{content_type}; charset=utf-8"
        return content_type


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    handler = partial(LibraryHandler, directory=str(root))
    with ThreadingHTTPServer(("127.0.0.1", 8768), handler) as server:
        print("参考库：http://127.0.0.1:8768/gallery.html", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
