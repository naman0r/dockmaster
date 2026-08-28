import json
from pathlib import Path
import plistlib
from types import SimpleNamespace
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import port_authority as pa


class ParsingTests(unittest.TestCase):
    def test_parse_listener_output_collapses_addresses_per_port(self):
        output = "\n".join(
            [
                "p42",
                "cnode",
                "Lalice",
                "f10",
                "n*:3000",
                "f11",
                "n127.0.0.1:3000",
                "f12",
                "n[::1]:5173",
                "p99",
                "cpython3",
                "f4",
                "n127.0.0.1:8080",
            ]
        )

        parsed = pa.parse_listener_output(output)

        self.assertEqual(parsed[42]["command"], "node")
        self.assertEqual(parsed[42]["user"], "alice")
        self.assertEqual(parsed[42]["ports"][3000], {"*", "127.0.0.1"})
        self.assertEqual(parsed[42]["ports"][5173], {"::1"})
        self.assertEqual(parsed[99]["ports"][8080], {"127.0.0.1"})

    def test_parse_address_rejects_invalid_names(self):
        self.assertEqual(pa.parse_address("[::]:9494"), ("::", 9494))
        self.assertEqual(
            pa.parse_address("127.0.0.1:3000 (LISTEN)"), ("127.0.0.1", 3000)
        )
        self.assertIsNone(pa.parse_address("not-a-socket"))
        self.assertIsNone(pa.parse_address("*:70000"))

    def test_parse_process_details_preserves_full_command(self):
        output = (
            "  4821  4700  501 Fri Aug 28 16:01:02 2026     alice "
            "node /tmp/a project/node_modules/.bin/vite --host\n"
        )

        parsed = pa.parse_process_details(output)[4821]

        self.assertEqual(parsed["ppid"], 4700)
        self.assertEqual(parsed["uid"], 501)
        self.assertEqual(parsed["user"], "alice")
        self.assertEqual(
            parsed["argv"], "node /tmp/a project/node_modules/.bin/vite --host"
        )
        self.assertIn("2026-08-28T16:01:02", parsed["started_at"])

    def test_parse_cwd_output(self):
        output = "p42\nfcwd\nn/Users/alice/Developer/demo\np99\nfcwd\nn/\n"
        self.assertEqual(
            pa.parse_cwd_output(output),
            {42: "/Users/alice/Developer/demo", 99: "/"},
        )


class ShapingTests(unittest.TestCase):
    def test_find_project_uses_nearest_git_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "demo"
            child = root / "apps" / "web"
            child.mkdir(parents=True)
            (root / ".git").mkdir()
            self.assertEqual(pa.find_project(str(child)), "demo")

    def test_classification_and_scope(self):
        self.assertEqual(
            pa.classify("node /tmp/demo/node_modules/.bin/vite")[0], "Vite"
        )
        self.assertEqual(pa.classify("/usr/local/bin/ollama serve")[0], "Ollama")
        self.assertTrue(pa.is_loopback_address("127.0.0.1"))
        self.assertTrue(pa.is_loopback_address("::1"))
        self.assertFalse(pa.is_loopback_address("*"))
        self.assertFalse(pa.is_loopback_address("192.168.1.20"))

    def test_background_rules_keep_known_dev_tools_visible(self):
        self.assertFalse(
            pa.is_background_process(
                501,
                "/Applications/OrbStack.app/Contents/MacOS/OrbStack",
                "/",
                True,
            )
        )
        self.assertTrue(
            pa.is_background_process(
                501,
                "/Applications/Spotify.app/Contents/MacOS/Spotify",
                "/",
                False,
            )
        )
        self.assertTrue(
            pa.is_background_process(
                0, "/opt/homebrew/bin/postgres", "/tmp/project", True
            )
        )
        self.assertFalse(
            pa.is_background_process(
                501,
                "/Library/Frameworks/Python.framework/Versions/3.12/Resources/"
                "Python.app/Contents/MacOS/Python server.py",
                "/Users/alice/Developer/demo",
                False,
            )
        )

    def test_descendants_are_deepest_first(self):
        table = {
            10: (1, 501),
            11: (10, 501),
            12: (10, 501),
            13: (11, 501),
            20: (1, 501),
        }
        order = pa.descendant_order(10, table)
        self.assertEqual(order[-1], 10)
        self.assertLess(order.index(13), order.index(11))
        self.assertEqual(set(order), {10, 11, 12, 13})
        self.assertEqual(pa.ancestor_chain(13, table), {1, 10, 11, 13})

    def test_inherited_listener_is_collapsed_under_parent(self):
        listeners = {
            10: {"ports": {8080: {"127.0.0.1"}}},
            11: {"ports": {8080: {"127.0.0.1"}}},
            12: {"ports": {8080: {"127.0.0.1"}}},
        }
        details = {
            10: {"ppid": 1},
            11: {"ppid": 10},
            12: {"ppid": 99},
        }
        self.assertTrue(pa.has_listening_ancestor(11, 8080, listeners, details))
        self.assertFalse(pa.has_listening_ancestor(12, 8080, listeners, details))

    def test_stop_payload_rejects_bools_and_invalid_mode(self):
        with self.assertRaises(pa.StopError):
            pa.Stopper._validated_payload(
                {"pid": True, "port": 3000, "started_at": "now", "mode": "term"}
            )
        with self.assertRaises(pa.StopError):
            pa.Stopper._validated_payload(
                {"pid": 20, "port": 3000, "started_at": "now", "mode": "boom"}
            )


class FakeScanner:
    def __init__(self):
        self.calls = 0

    def snapshot(self, force=False):
        self.calls += 1
        return {
            "generated_at": "2026-08-28T08:00:00.000Z",
            "scan_ms": 1.2,
            "services": [],
        }


class FakeStopper:
    def __init__(self):
        self.payload = None

    def stop(self, payload):
        self.payload = payload
        return {"ok": True, "still_listening": False, "signaled": []}


class LaunchAgentTests(unittest.TestCase):
    def test_install_writes_resolved_launch_agent_configuration(self):
        calls = []

        def fake_run(argv, **_kwargs):
            calls.append(argv)
            return SimpleNamespace(returncode=0, stderr="")

        with tempfile.TemporaryDirectory() as directory:
            fake_home = Path(directory)
            with patch.object(pa.Path, "home", return_value=fake_home):
                with patch.object(pa.sys, "platform", "darwin"):
                    with patch.object(pa.subprocess, "run", side_effect=fake_run):
                        pa.install_launch_agent(9595)

            plist_path = (
                fake_home
                / "Library"
                / "LaunchAgents"
                / (pa.LAUNCH_AGENT_LABEL + ".plist")
            )
            with plist_path.open("rb") as handle:
                payload = plistlib.load(handle)

        self.assertEqual(payload["Label"], pa.LAUNCH_AGENT_LABEL)
        self.assertEqual(payload["ProgramArguments"][-2:], ["--port", "9595"])
        self.assertTrue(Path(payload["ProgramArguments"][0]).is_absolute())
        self.assertTrue(Path(payload["ProgramArguments"][1]).is_absolute())
        self.assertEqual(payload["ProcessType"], "Background")
        self.assertTrue(payload["KeepAlive"])
        self.assertEqual(calls[-1][0:2], [pa.LAUNCHCTL, "bootstrap"])


class HttpSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scanner = FakeScanner()
        cls.stopper = FakeStopper()
        cls.server = pa.PortAuthorityServer(
            ("127.0.0.1", 0), cls.scanner, cls.stopper
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:" + str(cls.server.listen_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, path, *, headers=None, data=None, method=None):
        request = Request(
            self.base + path,
            headers=headers or {},
            data=data,
            method=method,
        )
        try:
            with urlopen(request, timeout=2) as response:
                return response.status, response.headers, response.read()
        except HTTPError as error:
            return error.code, error.headers, error.read()

    def test_root_embeds_token_and_security_headers(self):
        status, headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(self.server.auth_token.encode(), body)
        self.assertNotIn(b"__TOKEN_JSON__", body)
        self.assertEqual(headers["X-Frame-Options"], "DENY")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])

    def test_api_requires_token(self):
        status, _headers, body = self.request("/api/services")
        self.assertEqual(status, 403)
        self.assertIn(b"token", body)

        status, _headers, body = self.request(
            "/api/services",
            headers={pa.AUTH_HEADER: self.server.auth_token},
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["services"], [])

    def test_wrong_host_and_cross_origin_are_rejected(self):
        status, _headers, _body = self.request(
            "/", headers={"Host": "attacker.test"}
        )
        self.assertEqual(status, 403)

        status, _headers, _body = self.request(
            "/api/services",
            headers={
                pa.AUTH_HEADER: self.server.auth_token,
                "Origin": "http://attacker.test",
            },
        )
        self.assertEqual(status, 403)

    def test_preflight_is_rejected_without_cors_headers(self):
        status, headers, _body = self.request("/api/stop", method="OPTIONS")
        self.assertEqual(status, 405)
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))

    def test_valid_stop_request_reaches_stopper(self):
        payload = {
            "pid": 123,
            "port": 3000,
            "started_at": "2026-08-28T08:00:00+00:00",
            "mode": "term",
        }
        status, _headers, body = self.request(
            "/api/stop",
            headers={
                pa.AUTH_HEADER: self.server.auth_token,
                "Content-Type": "application/json",
            },
            data=json.dumps(payload).encode(),
            method="POST",
        )
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])
        self.assertEqual(self.stopper.payload, payload)


if __name__ == "__main__":
    unittest.main()
