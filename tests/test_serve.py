"""Raw-socket tests for the loopback server. Run: python -m unittest discover -s tests -p "test_*.py" """

import pathlib
import socket
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import serve  # noqa: E402


class FastHandler(serve.Handler):
    io_timeout = 0.4
    header_deadline = 0.8


class SmallServer(serve.Server):
    max_connections = 4


class ServerCase(unittest.TestCase):
    server_class = serve.Server
    handler_class = FastHandler

    def setUp(self):
        self.server = self.server_class(0, self.handler_class)
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def connect(self):
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        self.addCleanup(sock.close)
        return sock

    def raw(self, data):
        sock = self.connect()
        sock.sendall(data)
        chunks = []
        while True:
            try:
                chunk = sock.recv(65536)
            except (ConnectionResetError, ConnectionAbortedError):
                break
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks)

    def get(self, path=b"/", host=None, extra=b"", method=b"GET", version=b"HTTP/1.1"):
        host = host if host is not None else f"127.0.0.1:{self.port}".encode()
        request = method + b" " + path + b" " + version + b"\r\nHost: " + host + b"\r\n" + extra + b"\r\n"
        return self.raw(request)

    @staticmethod
    def status(response):
        line = response.split(b"\r\n", 1)[0]
        return int(line.split()[1]) if line.startswith(b"HTTP/") else None

    @staticmethod
    def headers(response):
        head = response.split(b"\r\n\r\n", 1)[0].split(b"\r\n")[1:]
        return {k.strip().lower(): v.strip() for k, v in (line.split(b":", 1) for line in head)}


class AllowlistTests(ServerCase):
    def test_index_with_security_headers_and_no_server_banner(self):
        response = self.get(b"/")
        self.assertEqual(self.status(response), 200)
        headers = self.headers(response)
        self.assertIn(b"default-src 'none'", headers[b"content-security-policy"])
        self.assertIn(b"frame-ancestors 'none'", headers[b"content-security-policy"])
        self.assertEqual(headers[b"x-content-type-options"], b"nosniff")
        self.assertEqual(headers[b"x-frame-options"], b"DENY")
        self.assertEqual(headers[b"cross-origin-opener-policy"], b"same-origin")
        self.assertEqual(headers[b"referrer-policy"], b"no-referrer")
        self.assertIn(b"microphone=()", headers[b"permissions-policy"])
        self.assertNotIn(b"server", headers)
        self.assertIn(b"Barricade Defense", response)

    def test_every_listed_file_serves_with_its_type(self):
        for path, (name, kind) in serve.FILES.items():
            response = self.get(path.encode())
            self.assertEqual(self.status(response), 200, path)
            self.assertEqual(self.headers(response)[b"content-type"], kind.encode(), path)
            self.assertTrue(response.endswith((ROOT / name).read_bytes()), path)

    def test_allowlist_matches_shipped_static_files(self):
        listed = {name for name, _ in serve.FILES.values()}
        shipped = {p.relative_to(ROOT).as_posix() for p in (ROOT / "src").glob("*.js")}
        shipped |= {"index.html", "styles.css", "favicon.svg"}
        self.assertEqual(listed, shipped)

    def test_query_is_ignored_but_fragment_and_absolute_form_are_refused(self):
        self.assertEqual(self.status(self.get(b"/?seed=42")), 200)
        self.assertEqual(self.status(self.get(b"/#top")), 404)
        absolute = f"http://127.0.0.1:{self.port}/".encode()
        self.assertEqual(self.status(self.get(absolute)), 404)

    def test_head_has_headers_but_no_body(self):
        response = self.get(b"/styles.css", method=b"HEAD")
        self.assertEqual(self.status(response), 200)
        self.assertNotEqual(self.headers(response)[b"content-length"], b"0")
        self.assertEqual(response.split(b"\r\n\r\n", 1)[1], b"")

    def test_traversal_and_unlisted_paths_are_not_found(self):
        for path in [b"/serve.py", b"/../serve.py", b"/src/../serve.py", b"/%2e%2e/serve.py", b"/src/%2e%2e/serve.py",
                     b"/src\\..\\serve.py", b"//etc/passwd", b"/C:/Windows/win.ini", b"/tests/test_serve.py",
                     b"/tools/bots.js", b"/work/", b"/src/", b"/src", b"/src/app.js/", b"/SRC/APP.JS",
                     b"/index.html%00.js", b"/.git/config", b"/package.json"]:
            self.assertEqual(self.status(self.get(path)), 404, path)


class RequestValidationTests(ServerCase):
    def test_default_http_port_accepts_browser_normalized_host(self):
        # Keep the owned socket on its ephemeral port; simulate the configured
        # listener identity without binding a privileged or occupied port 80.
        with patch.object(self.server, "server_port", 80):
            for host in (b"127.0.0.1", b"localhost"):
                for suffix in (b"", b":80"):
                    self.assertEqual(self.status(self.get(host=host + suffix)), 200)
                    for origin_suffix in (b"", b":80"):
                        origin = b"Origin: http://" + host + origin_suffix + b"\r\n"
                        self.assertEqual(self.status(self.get(host=host + suffix, extra=origin)), 200)
            for origin in (b"http://localhost", b"https://127.0.0.1", b"http://127.0.0.1:8080"):
                self.assertEqual(self.status(self.get(host=b"127.0.0.1", extra=b"Origin: " + origin + b"\r\n")), 403)
            self.assertEqual(self.status(self.get(host=b"attacker.invalid")), 403)

    def test_host_must_be_this_loopback_address_and_port(self):
        good = [f"127.0.0.1:{self.port}", f"localhost:{self.port}"]
        bad = ["evil.example", "127.0.0.1", f"127.0.0.1:{self.port + 1}", f"evil.example:{self.port}", f"[::1]:{self.port}", ""]
        for host in good:
            self.assertEqual(self.status(self.get(host=host.encode())), 200, host)
        for host in bad:
            self.assertEqual(self.status(self.get(host=host.encode())), 403, host)
        no_host = self.raw(b"GET / HTTP/1.1\r\n\r\n")
        self.assertEqual(self.status(no_host), 403)
        doubled = self.get(extra=f"Host: 127.0.0.1:{self.port}\r\n".encode())
        self.assertEqual(self.status(doubled), 400)

    def test_cross_origin_requests_are_refused(self):
        same = f"Origin: http://127.0.0.1:{self.port}\r\n".encode()
        self.assertEqual(self.status(self.get(extra=same)), 200)
        for extra in [b"Origin: http://evil.example\r\n", b"Origin: null\r\n", b"Sec-Fetch-Site: cross-site\r\n",
                      b"Sec-Fetch-Site: same-site\r\n"]:
            self.assertEqual(self.status(self.get(extra=extra)), 403, extra)

    def test_unsupported_methods_get_405_with_allow(self):
        for method in [b"POST", b"PUT", b"DELETE", b"PATCH", b"OPTIONS", b"TRACE", b"CONNECT", b"get", b"PROPFIND"]:
            response = self.get(method=method, extra=b"Content-Length: 4\r\n")
            self.assertEqual(self.status(response), 405, method)
            self.assertEqual(self.headers(response)[b"allow"], b"GET, HEAD")

    def test_versionless_and_unknown_versions_are_rejected(self):
        self.assertEqual(self.status(self.raw(b"GET /\r\n\r\n")), 400)
        self.assertEqual(self.status(self.raw(b"GET / HTTP/0.9\r\n\r\n")), 400)
        self.assertIn(self.status(self.get(version=b"HTTP/2.0")), (400, 505))
        self.assertEqual(self.status(self.get(version=b"FOO/1.1")), 400)
        self.assertEqual(self.status(self.raw(b"\r\n\r\n")), None)

    def test_oversized_requests_are_refused(self):
        many = b"".join(b"X-Filler-%d: a\r\n" % i for i in range(40))
        self.assertEqual(self.status(self.get(extra=many)), 431)
        big = b"X-Big: " + b"a" * 9000 + b"\r\n"
        self.assertEqual(self.status(self.get(extra=big)), 431)
        self.assertEqual(self.status(self.get(path=b"/" + b"a" * 2000)), 431)

    def test_responses_never_reflect_request_input(self):
        marker = b"zq<qzx>reflect"
        probes = [self.get(path=b"/" + marker), self.get(method=b"MARKERzq"), self.get(host=marker),
                  self.get(extra=b"Origin: http://" + marker + b"\r\n"), self.get(version=b"HTTP/" + marker),
                  self.raw(marker + b"\r\n\r\n")]
        for response in probes:
            self.assertNotIn(b"zq", response.lower())
            self.assertNotIn(b"qzx", response.lower())


class DeadlineTests(ServerCase):
    def test_idle_connection_is_closed_by_the_header_deadline(self):
        sock = self.connect()
        start = time.monotonic()
        self.assertEqual(sock.recv(1024), b"")
        self.assertLess(time.monotonic() - start, 3)

    def test_slow_trickle_cannot_outlive_the_total_header_deadline(self):
        sock = self.connect()
        start = time.monotonic()
        closed = False
        payload = b"GET / HTTP/1.1\r\nX-Slow: " + b"a" * 200
        for byte in payload:
            try:
                sock.send(bytes([byte]))
            except OSError:
                closed = True
                break
            time.sleep(0.1)  # each byte arrives well inside io_timeout
            if time.monotonic() - start > 4:
                break
        if not closed:
            sock.settimeout(2)
            try:
                closed = sock.recv(1024) == b""
            except OSError:
                closed = True
        self.assertTrue(closed)
        self.assertLess(time.monotonic() - start, 3, "the deadline is total, not per byte")

    def test_header_timers_are_cleaned_up(self):
        for _ in range(25):
            self.assertEqual(self.status(self.get(b"/favicon.svg")), 200)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            timers = [t for t in threading.enumerate() if isinstance(t, threading.Timer) and t.is_alive()]
            if not timers:
                break
            time.sleep(0.05)
        self.assertEqual(timers, [])


class DeadlineBoundaryTests(unittest.TestCase):
    @staticmethod
    def handler():
        # Only the lifecycle boundary is needed; sockets are covered above.
        handler = serve.Handler.__new__(serve.Handler)
        handler.deadline_lock = threading.Lock()
        handler.pending = threading.Event()
        handler.pending.set()
        handler.timer = Mock()
        handler.connection = Mock()
        handler.request_version = "HTTP/1.1"
        return handler

    def test_callback_after_successful_parse_cannot_expire_the_response(self):
        handler = self.handler()
        with patch.object(serve.BaseHTTPRequestHandler, "parse_request", return_value=True):
            self.assertTrue(handler.parse_request())
        handler.expire()  # Timer.cancel cannot prevent an already-started callback.
        handler.connection.shutdown.assert_not_called()
        self.assertFalse(handler.pending.is_set())

    def test_a_claimed_timeout_finishes_before_parse_cancellation_returns(self):
        handler = self.handler()
        shutdown_started = threading.Event()
        finish_shutdown = threading.Event()
        base_parsed = threading.Event()
        parse_returned = threading.Event()
        errors = []

        def shutdown(_):
            shutdown_started.set()
            if not finish_shutdown.wait(2):
                raise AssertionError("The fixture did not release socket shutdown.")

        def parsed(_):
            base_parsed.set()
            return True

        def parse():
            try:
                handler.parse_request()
            except BaseException as error:
                errors.append(error)
            finally:
                parse_returned.set()

        handler.connection.shutdown.side_effect = shutdown
        expiry = threading.Thread(target=handler.expire, daemon=True)
        parsing = threading.Thread(target=parse, daemon=True)
        with patch.object(serve.BaseHTTPRequestHandler, "parse_request", parsed):
            expiry.start()
            try:
                self.assertTrue(shutdown_started.wait(1))
                parsing.start()
                self.assertTrue(base_parsed.wait(1))
                self.assertFalse(parse_returned.wait(0.05), "cancellation must wait for the claimed timeout")
            finally:
                finish_shutdown.set()
                expiry.join(2)
                if parsing.ident is not None:
                    parsing.join(2)
        self.assertFalse(expiry.is_alive())
        self.assertFalse(parsing.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(parse_returned.is_set())


class ConnectionCapTests(ServerCase):
    server_class = SmallServer

    def test_connections_beyond_the_cap_are_dropped_then_slots_recover(self):
        held = [self.connect() for _ in range(SmallServer.max_connections)]
        time.sleep(0.2)
        extra = self.connect()
        extra.settimeout(0.6)
        request = f"GET / HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n\r\n".encode()
        try:
            extra.sendall(request)
            refused = extra.recv(1024) == b""
        except OSError:
            refused = True
        self.assertTrue(refused, "a connection beyond the cap should get no response")
        for sock in held:
            sock.close()
        time.sleep(1.2)  # held sockets were idle; their deadlines release the slots
        self.assertEqual(self.status(self.get()), 200)


class CommandLineTests(unittest.TestCase):
    def test_binds_loopback_only(self):
        server = serve.Server(0)
        try:
            self.assertEqual(server.server_address[0], "127.0.0.1")
        finally:
            server.server_close()

    def test_an_occupied_port_is_exclusive_and_cli_exits_cleanly(self):
        with serve.Server(0) as first:
            port = first.server_port
            with self.assertRaises(OSError):
                duplicate = serve.Server(port)
                duplicate.server_close()
            result = subprocess.run(
                [sys.executable, str(ROOT / "serve.py"), "--port", str(port)],
                cwd=ROOT, capture_output=True, text=True, timeout=5,
            )
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertEqual(result.stderr, "The local game server could not start. Try another port.\n")


if __name__ == "__main__":
    unittest.main()
