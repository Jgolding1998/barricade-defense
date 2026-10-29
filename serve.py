"""Serve the game's fixed static files on loopback. No uploads or application API."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
import threading
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
    "/src/app.js": ("src/app.js", "text/javascript; charset=utf-8"),
    "/src/audio.js": ("src/audio.js", "text/javascript; charset=utf-8"),
    "/src/game.js": ("src/game.js", "text/javascript; charset=utf-8"),
    "/src/terrain.js": ("src/terrain.js", "text/javascript; charset=utf-8"),
    "/src/preview.js": ("src/preview.js", "text/javascript; charset=utf-8"),
    "/src/keys.js": ("src/keys.js", "text/javascript; charset=utf-8"),
}
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    io_timeout = 3  # seconds per socket read or write
    header_deadline = 5  # seconds to deliver the full request line and headers

    def log_message(self, *_):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(self.io_timeout)
        self.deadline_lock = threading.Lock()
        self.pending = threading.Event()
        self.pending.set()
        self.timer = threading.Timer(self.header_deadline, self.expire)
        self.timer.daemon = True
        self.timer.start()

    def expire(self):
        with self.deadline_lock:
            if self.pending.is_set():
                self.pending.clear()
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def cancel_deadline(self):
        # A callback that already claimed the deadline must finish before the
        # request proceeds, so it cannot later interrupt the response.
        with self.deadline_lock:
            self.pending.clear()
            self.timer.cancel()

    def parse_request(self):
        try:
            accepted = super().parse_request()
        finally:
            self.cancel_deadline()
        if accepted and self.request_version not in {"HTTP/1.0", "HTTP/1.1"}:
            self.send_error(400)
            return False
        return accepted

    def finish(self):
        self.cancel_deadline()
        try:
            super().finish()
        except OSError:
            pass

    def reply(self, code, body=b"", kind="text/plain; charset=utf-8"):
        self.close_connection = True
        if getattr(self, "request_version", "HTTP/0.9") == "HTTP/0.9":
            self.request_version = "HTTP/1.0"
        self.send_response_only(code)
        for name, value in (("Content-Type", kind), ("Content-Length", str(len(body))),
                            ("Content-Security-Policy", CSP), ("Cache-Control", "no-store"),
                            ("X-Content-Type-Options", "nosniff"), ("Referrer-Policy", "no-referrer"),
                            ("Cross-Origin-Resource-Policy", "same-origin"), ("X-Frame-Options", "DENY"),
                            ("Permissions-Policy", "camera=(), microphone=(), geolocation=()"),
                            ("Cross-Origin-Opener-Policy", "same-origin"),
                            ("Connection", "close")):
            self.send_header(name, value)
        if code == 405:
            self.send_header("Allow", "GET, HEAD")
        self.end_headers()
        if getattr(self, "command", None) != "HEAD":
            self.wfile.write(body)

    def send_error(self, code, message=None, explain=None):
        self.reply(405 if code == 501 else code, b"Request rejected.")

    def do_GET(self):
        if len(self.path) > 1024 or len(self.headers) > 32 or sum(len(key) + len(value) for key, value in self.headers.items()) > 8192:
            self.reply(431, b"Request exceeds the limit.")
            return
        if any(len(self.headers.get_all(name, [])) > 1 for name in ("Host", "Origin", "Sec-Fetch-Site", "Content-Length", "Content-Type")):
            self.reply(400, b"Ambiguous request headers.")
            return
        host = self.headers.get("Host", "")
        hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if self.server.server_port == 80:
            hosts.update({"127.0.0.1", "localhost"})
        origin = self.headers.get("Origin")
        origins = {"http://" + host}
        if self.server.server_port == 80:
            base = "http://" + host.removesuffix(":80")
            origins = {base, base + ":80"}
        if host not in hosts or (origin is not None and origin not in origins) or self.headers.get("Sec-Fetch-Site", "none") not in {"none", "same-origin"}:
            self.reply(403, b"Open the local game address directly.")
            return
        try:
            target = urlsplit(self.path)
        except ValueError:
            self.reply(400, b"Invalid address.")
            return
        if target.scheme or target.netloc or target.fragment or target.path not in FILES:
            self.reply(404, b"Not found.")
            return
        name, kind = FILES[target.path]
        path = ROOT / name
        try:
            if path.is_symlink() or any(part.is_symlink() for part in path.parents if part != ROOT.parent) or not path.resolve().is_relative_to(ROOT):
                self.reply(404, b"Not found.")
                return
            self.reply(200, path.read_bytes(), kind)
        except OSError:
            self.reply(404, b"Not found.")

    do_HEAD = do_GET


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8
    max_connections = 16

    def __init__(self, port, handler=Handler):
        self.connections = threading.BoundedSemaphore(self.max_connections)
        super().__init__(("127.0.0.1", port), handler)

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def process_request(self, request, address):
        if not self.connections.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.connections.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.connections.release()

    def handle_error(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser(description="Play Barricade Defense locally.")
    parser.add_argument("--port", type=int, default=8792)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("Choose a port from 0 to 65535.")
    try:
        with Server(args.port) as server:
            print(f"Barricade Defense: http://127.0.0.1:{server.server_port}", flush=True)
            print("Press Ctrl+C to stop. No packages or accounts are needed.", flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    except OSError:
        parser.exit(1, "The local game server could not start. Try another port.\n")


if __name__ == "__main__":
    main()
