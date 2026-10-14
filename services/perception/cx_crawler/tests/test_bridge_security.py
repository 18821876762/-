# -*- coding: utf-8 -*-
"""Bridge security acceptance with synthetic files and ephemeral loopback servers.

No live platform, cookie store, configured data directory or existing service is used.
"""
import contextlib
import http.client
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest import mock
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bridge

ORIGIN = "https://mooc1.chaoxing.com"
TOKEN = "synthetic-bridge-test-token"


class _BridgeFixture:
    auth_token = None
    extra_origins = ()

    def setUp(self):
        self.files = tempfile.TemporaryDirectory()
        self.playlist = {"courseid": 12345678, "chapters": [{"knowledgeId": "fixture-chapter", "completed": False}]}
        for filename, data in (("playlist_12345678.json", self.playlist),
                               ("playlist_index.json", {"courses": [{"courseid": 12345678}]}),
                               ("cookies.json", {"synthetic_only": True})):
            with open(os.path.join(self.files.name, filename), "w", encoding="utf-8") as file:
                json.dump(data, file)
        self.output_patch = mock.patch.object(bridge, "OUTPUT_DIR", self.files.name)
        self.output_patch.start()
        self.server = bridge._make_server("127.0.0.1", 0, self.auth_token, self.extra_origins)
        self.worker = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=2)
        self.output_patch.stop()
        self.files.cleanup()

    def request(self, path="/playlist/12345678", method="GET", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=3)
        try:
            connection.putrequest(method, path)
            for name, value in (headers or []):
                connection.putheader(name, value)
            connection.endheaders()
            response = connection.getresponse()
            body = response.read()
            return response.status, dict(response.getheaders()), json.loads(body) if body else None
        finally:
            connection.close()


class BridgeHTTPTests(_BridgeFixture, unittest.TestCase):
    def test_https_chaoxing_object_playlist_readable(self):
        status, headers, body = self.request(headers=[("Origin", ORIGIN)])
        self.assertEqual((status, body), (200, self.playlist))
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Vary"], "Origin")
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_default_domain_and_standard_https_port(self):
        for origin in ("https://chaoxing.com", "https://mooc2-ans.chaoxing.com", "https://mooc1.chaoxing.com:443"):
            with self.subTest(origin=origin):
                status, headers, _ = self.request("/ping", headers=[("Origin", origin)])
                self.assertEqual(status, 200)
                self.assertEqual(headers["Access-Control-Allow-Origin"], origin)

    def test_cli_without_origin_has_no_wildcard(self):
        status, headers, body = self.request()
        self.assertEqual((status, body), (200, self.playlist))
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(headers["Vary"], "Origin")

    def test_index_retains_object_format(self):
        status, _, body = self.request("/playlist/index", headers=[("Origin", ORIGIN)])
        self.assertEqual((status, body), (200, {"courses": [{"courseid": 12345678}]}))

    def test_rejected_origin_never_reads_playlist(self):
        with mock.patch.object(bridge._Handler, "_send_file", side_effect=AssertionError("unexpected file read")):
            status, headers, body = self.request(headers=[("Origin", "https://attacker.example")])
        self.assertEqual((status, body), (403, {"error": "origin forbidden"}))
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(headers["Vary"], "Origin")

    def test_null_opaque_and_multiple_origins_rejected(self):
        for origin in ("null", "", "file://", "https://mooc1.chaoxing.com https://attacker.example"):
            with self.subTest(origin=origin):
                status, headers, _ = self.request(headers=[("Origin", origin)])
                self.assertEqual(status, 403)
                self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_duplicate_origin_headers_rejected(self):
        status, headers, _ = self.request(headers=[("Origin", ORIGIN), ("Origin", ORIGIN)])
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_spoofed_domain_and_userinfo_rejected(self):
        for origin in ("https://chaoxing.com.attacker.example", "https://evilchaoxing.com",
                       "https://mooc1.chaoxing.com@attacker.example", "https://attacker.example@mooc1.chaoxing.com",
                       "https://mooc1.chaoxing.com.", "https://mooc1%2echaoxing.com"):
            with self.subTest(origin=origin):
                status, headers, _ = self.request(headers=[("Origin", origin)])
                self.assertEqual(status, 403)
                self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_http_nonstandard_and_ambiguous_ports_rejected(self):
        for origin in ("http://mooc1.chaoxing.com", "https://mooc1.chaoxing.com:8443",
                       "https://mooc1.chaoxing.com:0443", "https://mooc1.chaoxing.com:",
                       "https://mooc1.chaoxing.com:0", "https://mooc1.chaoxing.com:65536"):
            with self.subTest(origin=origin):
                self.assertEqual(self.request(headers=[("Origin", origin)])[0], 403)

    def test_non_origin_urls_rejected(self):
        for origin in (ORIGIN + "/", ORIGIN + "/page", ORIGIN + "?", ORIGIN + "#", ORIGIN + "?x=1",
                       ORIGIN + "#fragment", ORIGIN + "\\attacker.example"):
            with self.subTest(origin=origin):
                self.assertEqual(self.request(headers=[("Origin", origin)])[0], 403)

    def test_path_traversal_and_sensitive_routes_rejected(self):
        for path in ("/cookies.json", "/playlist/../cookies.json", "/playlist/%2e%2e/cookies.json",
                     "/playlist/12345678/../../cookies.json", "/playlist/1234567", "/playlist/1234567890123",
                     "/playlist/１２３４５６７８", "/output/playlist_12345678.json"):
            with self.subTest(path=path):
                # HTTP targets use ASCII percent encoding for non-ASCII identifiers.
                path = quote(path, safe="/%")
                status, _, body = self.request(path, headers=[("Origin", ORIGIN)])
                self.assertEqual((status, body), (404, {"error": "not found"}))

    def test_missing_playlist_returns_404_without_cookie_data(self):
        status, headers, body = self.request("/playlist/99999999", headers=[("Origin", ORIGIN)])
        self.assertEqual(status, 404)
        self.assertNotIn("synthetic_only", json.dumps(body))
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)

    def test_bad_json_returns_generic_error(self):
        with open(os.path.join(self.files.name, "playlist_12345678.json"), "w", encoding="utf-8") as file:
            file.write("not json")
        status, _, body = self.request(headers=[("Origin", ORIGIN)])
        self.assertEqual((status, body), (500, {"error": "read failed"}))
        self.assertNotIn(self.files.name, json.dumps(body))

    def test_authorization_preflight_allows_only_get_and_known_header(self):
        status, headers, body = self.request(method="OPTIONS", headers=[("Origin", ORIGIN),
            ("Access-Control-Request-Method", "GET"), ("Access-Control-Request-Headers", "aUtHoRiZaTiOn")])
        self.assertEqual((status, body), (204, None))
        self.assertEqual(headers["Access-Control-Allow-Methods"], "GET")
        self.assertEqual(headers["Access-Control-Allow-Headers"], "Authorization")
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Vary"], "Origin")

    def test_preflight_rejects_untrusted_origin(self):
        status, headers, _ = self.request(method="OPTIONS", headers=[("Origin", "https://attacker.example"),
            ("Access-Control-Request-Method", "GET")])
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertNotIn("Access-Control-Allow-Headers", headers)

    def test_preflight_requires_origin_and_get(self):
        for headers in ([('Access-Control-Request-Method', 'GET')], [("Origin", ORIGIN)],
                        [("Origin", ORIGIN), ("Access-Control-Request-Method", "POST")]):
            with self.subTest(headers=headers):
                status, result, _ = self.request(method="OPTIONS", headers=headers)
                self.assertIn(status, (403, 405))
                self.assertNotIn("Access-Control-Allow-Methods", result)

    def test_preflight_rejects_unknown_or_duplicate_headers(self):
        for requested in ([('Access-Control-Request-Headers', 'Authorization, X-Secret')],
                          [('Access-Control-Request-Headers', 'Authorization'), ('Access-Control-Request-Headers', 'Authorization')]):
            status, headers, _ = self.request(method="OPTIONS", headers=[("Origin", ORIGIN),
                ("Access-Control-Request-Method", "GET")] + requested)
            self.assertEqual(status, 403)
            self.assertNotIn("Access-Control-Allow-Headers", headers)


class BridgeTokenTests(_BridgeFixture, unittest.TestCase):
    auth_token = TOKEN

    def test_bearer_header_authorizes_and_query_token_does_not(self):
        status, _, body = self.request(headers=[("Origin", ORIGIN), ("Authorization", f"Bearer {TOKEN}")])
        self.assertEqual((status, body), (200, self.playlist))
        for path in ("/playlist/12345678", f"/playlist/12345678?token={TOKEN}", "/ping"):
            status, _, body = self.request(path, headers=[("Origin", ORIGIN)])
            self.assertEqual((status, body), (401, {"error": "unauthorized"}))

    def test_wrong_or_duplicate_authorization_is_denied(self):
        for values in ([f"Bearer {TOKEN}-wrong"], [TOKEN], [f"Bearer {TOKEN}", f"Bearer {TOKEN}"]):
            status, _, body = self.request(headers=[("Authorization", value) for value in values])
            self.assertEqual((status, body), (401, {"error": "unauthorized"}))

    def test_token_never_bypasses_origin_policy(self):
        status, headers, body = self.request(headers=[("Origin", "null"), ("Authorization", f"Bearer {TOKEN}")])
        self.assertEqual((status, body), (403, {"error": "origin forbidden"}))
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_preflight_does_not_grant_token_access(self):
        status, _, _ = self.request(method="OPTIONS", headers=[("Origin", ORIGIN),
            ("Access-Control-Request-Method", "GET"), ("Access-Control-Request-Headers", "authorization")])
        self.assertEqual(status, 204)
        self.assertEqual(self.request(headers=[("Origin", ORIGIN)])[0], 401)

    def test_token_cli_still_uses_header(self):
        status, headers, body = self.request(headers=[("Authorization", f"Bearer {TOKEN}")])
        self.assertEqual((status, body), (200, self.playlist))
        self.assertNotIn("Access-Control-Allow-Origin", headers)


class BridgeExtraOriginTests(_BridgeFixture, unittest.TestCase):
    auth_token = None
    extra_origins = ("https://learn.school.example:8443",)

    def test_explicit_school_origin_is_exact_and_additive(self):
        for origin in (self.extra_origins[0], ORIGIN):
            self.assertEqual(self.request(headers=[("Origin", origin)])[0], 200)
        for origin in ("https://learn.school.example", "http://learn.school.example:8443",
                       "https://sub.learn.school.example:8443", "https://learn.school.example.attacker:8443"):
            self.assertEqual(self.request(headers=[("Origin", origin)])[0], 403)


class BridgeConfigTests(unittest.TestCase):
    def setUp(self):
        self.files = tempfile.TemporaryDirectory()
        self.default_path = os.path.join(self.files.name, "default.json")
        self.explicit_path = os.path.join(self.files.name, "explicit.json")
        self.default_patch = mock.patch.object(bridge, "_DEFAULT_CONFIG", self.default_path)
        self.env_patch = mock.patch.dict(os.environ, {}, clear=True)
        self.default_patch.start()
        self.env_patch.start()

    def tearDown(self):
        self.env_patch.stop()
        self.default_patch.stop()
        self.files.cleanup()

    def write(self, path, data):
        with open(path, "w", encoding="utf-8") as file:
            json.dump(data, file)

    def layers(self):
        self.write(self.default_path, {"host": "127.0.0.2", "port": 11001, "auth_token": "synthetic-default",
                                      "allowed_origins": ["https://default.school.example"]})
        os.environ.update(CX_BRIDGE_HOST="127.0.0.3", CX_BRIDGE_PORT="11002",
                          CX_BRIDGE_AUTH_TOKEN="synthetic-env", CX_BRIDGE_ALLOW_ORIGINS="https://env.school.example")
        self.write(self.explicit_path, {"host": "127.0.0.4", "port": 11003, "auth_token": "synthetic-explicit",
                                       "allowed_origins": ["https://explicit.school.example"]})

    def test_cli_wins_over_explicit_configuration(self):
        self.layers()
        result = bridge._resolve_args(["--config", self.explicit_path, "--host", "127.0.0.5", "--port", "11004",
                                       "--auth-token", "synthetic-cli", "--allow-origin", "https://cli.school.example"])
        self.assertEqual(result, ("127.0.0.5", 11004, "synthetic-cli", ("https://cli.school.example",)))

    def test_explicit_configuration_wins_over_environment(self):
        self.layers()
        self.assertEqual(bridge._resolve_args(["--config", self.explicit_path]),
                         ("127.0.0.4", 11003, "synthetic-explicit", ("https://explicit.school.example",)))

    def test_environment_wins_over_default_configuration(self):
        self.layers()
        self.assertEqual(bridge._resolve_args([]),
                         ("127.0.0.3", 11002, "synthetic-env", ("https://env.school.example",)))

    def test_default_configuration_loads_token_and_origins(self):
        self.write(self.default_path, {"auth_token": TOKEN, "allowed_origins": [ORIGIN + ":443"]})
        self.assertEqual(bridge._resolve_args([]), ("127.0.0.1", 7531, TOKEN, (ORIGIN,)))

    def test_missing_configuration_uses_safe_defaults(self):
        self.assertEqual(bridge._resolve_args([]), ("127.0.0.1", 7531, None, ()))

    def test_precedence_is_per_field(self):
        self.layers()
        self.write(self.explicit_path, {"port": 11003})
        self.assertEqual(bridge._resolve_args(["--config", self.explicit_path, "--host", "127.0.0.5"]),
                         ("127.0.0.5", 11003, "synthetic-env", ("https://env.school.example",)))

    def test_empty_token_disables_auth_only_on_loopback(self):
        self.write(self.default_path, {"auth_token": TOKEN})
        for empty_token in ("", " ", "\t", " \n "):
            with self.subTest(empty_type=repr(empty_token)):
                self.assertIsNone(bridge._resolve_args(["--auth-token", empty_token])[2])
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    bridge._resolve_args(["--host", "0.0.0.0", "--auth-token", empty_token])

    def test_nonloopback_without_token_exits_before_any_socket_operation(self):
        with mock.patch.object(bridge, "_port_in_use") as probe, mock.patch.object(bridge, "_make_server") as create, \
             mock.patch.object(sys, "argv", ["bridge.py", "--host", "0.0.0.0"]), \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            bridge.main()
        probe.assert_not_called()
        create.assert_not_called()

    def test_factory_rejects_nonloopback_without_token(self):
        with mock.patch.object(bridge, "ThreadingHTTPServer") as constructor:
            for host in ("0.0.0.0", "192.0.2.1", "::", "host.example"):
                with self.subTest(host=host), self.assertRaises(ValueError):
                    bridge._make_server(host, 0, "")
        constructor.assert_not_called()

    def test_factory_allows_explicit_nonloopback_token(self):
        with mock.patch.object(bridge, "ThreadingHTTPServer") as constructor:
            bridge._make_server("0.0.0.0", 12345, TOKEN)
        constructor.assert_called_once()
        self.assertEqual(constructor.call_args.args[1].auth_token, TOKEN)

    def test_invalid_configuration_fails_closed_without_secret_output(self):
        for data in ({"allowed_origins": ["null"], "auth_token": TOKEN},
                     {"allowed_origins": "*", "auth_token": TOKEN}, {"port": 65536, "auth_token": TOKEN}):
            with self.subTest(data_type=type(data).__name__):
                self.write(self.default_path, data)
                captured = io.StringIO()
                with contextlib.redirect_stderr(captured), self.assertRaises(SystemExit):
                    bridge._resolve_args([])
                self.assertNotIn(TOKEN, captured.getvalue())

    def test_missing_or_malformed_explicit_configuration_fails_closed(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            bridge._resolve_args(["--config", self.explicit_path])
        self.write(self.explicit_path, ["not an object"])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            bridge._resolve_args(["--config", self.explicit_path])

    def test_invalid_port_or_token_cannot_silently_fall_back(self):
        for data in ({"port": True}, {"port": 1.5}, {"auth_token": 123}, {"auth_token": "bad\nheader"}):
            self.write(self.default_path, data)
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                bridge._resolve_args([])

    def test_origin_control_characters_never_parse(self):
        for value in ("\x00" + ORIGIN, ORIGIN + "\n", ORIGIN + "\x7f", "*", "null"):
            self.assertIsNone(bridge._parse_origin(value))

    def test_each_server_keeps_its_own_token(self):
        first = bridge._make_server("127.0.0.1", 0, "synthetic-first")
        second = bridge._make_server("127.0.0.1", 0, "synthetic-second")
        try:
            self.assertEqual(first.RequestHandlerClass.auth_token, "synthetic-first")
            self.assertEqual(second.RequestHandlerClass.auth_token, "synthetic-second")
            self.assertIsNone(bridge._Handler.auth_token)
        finally:
            first.server_close()
            second.server_close()


if __name__ == "__main__":
    unittest.main()
