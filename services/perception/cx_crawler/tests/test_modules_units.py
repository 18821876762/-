# -*- coding: utf-8 -*-
"""单元测试（第二批）：覆盖 session / api_client / config 的健壮性核心逻辑。

仅测试纯函数与本地 IO，不触达网络、Playwright 或浏览器。与 test_crawler_units.py 互补：
  - test_crawler_units.py 覆盖 config._to_int / atomic_write_json / chapters 解析
  - 本文件覆盖：
      session.load_cookies（三种格式 + 容错）、session.save_cookies（list/dict 合并）
      api_client._should_save（落盘判定）、config.with_retry（退避重试）
      config.RunLock（跨进程运行锁）、config.throttle（限速）
      config._load_active_course_ids / _load_bridge_config（环境变量优先于 JSON）

运行：
    python -m unittest discover -s perception/cx_crawler/tests -p "test_*.py"
"""
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

# 与 test_crawler_units.py 一致：把 perception/cx_crawler/ 加入 sys.path，
# 使测试与运行时 CWD 无关。
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from session import load_cookies, save_cookies
from api_client import _should_save


class _FakeCookie:
    def __init__(self, name, value):
        self.name = name
        self.value = value


class _FakeSession:
    def __init__(self, cookies):
        self.cookies = cookies


class TestLoadCookies(unittest.TestCase):
    def _write(self, d, payload):
        p = os.path.join(d, "cookies.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        return p

    def test_list_format(self):
        with tempfile.TemporaryDirectory() as d:
            p = self._write(d, [{"name": "UID", "value": "1"}, {"name": "_d", "value": "x"}])
            self.assertEqual(load_cookies(p), {"UID": "1", "_d": "x"})

    def test_dict_format(self):
        with tempfile.TemporaryDirectory() as d:
            p = self._write(d, {"UID": "1", "_d": "x"})
            self.assertEqual(load_cookies(p), {"UID": "1", "_d": "x"})

    def test_str_format(self):
        with tempfile.TemporaryDirectory() as d:
            p = self._write(d, "UID=1; _d=x; foo=bar")
            self.assertEqual(load_cookies(p), {"UID": "1", "_d": "x", "foo": "bar"})

    def test_malformed_list_items_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            p = self._write(d, [
                {"name": "UID", "value": "1"},
                "not-a-dict",
                {"name": "no_value"},
                {"value": "no_name"},
            ])
            self.assertEqual(load_cookies(p), {"UID": "1"})

    def test_missing_file_raises(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(FileNotFoundError):
                load_cookies(os.path.join(d, "nope.json"))


class TestSaveCookies(unittest.TestCase):
    def test_merge_into_list_format(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "cookies.json")
            original = [{"name": "UID", "value": "old", "domain": "", "path": "/"},
                       {"name": "_d", "value": "keep"}]
            with open(p, "w", encoding="utf-8") as f:
                json.dump(original, f)
            sess = _FakeSession([_FakeCookie("UID", "new"), _FakeCookie("rose", "fresh")])
            save_cookies(sess, p)
            with open(p, "r", encoding="utf-8") as f:
                out = json.load(f)
            by_name = {c["name"]: c["value"] for c in out if isinstance(c, dict)}
            self.assertEqual(by_name["UID"], "new")      # 已存在项被更新
            self.assertEqual(by_name["_d"], "keep")      # 未涉及项保留
            self.assertEqual(by_name["rose"], "fresh")   # 新增项被追加

    def test_merge_into_dict_format(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "cookies.json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump({"UID": "old"}, f)
            sess = _FakeSession([_FakeCookie("UID", "new"), _FakeCookie("rose", "r")])
            save_cookies(sess, p)
            with open(p, "r", encoding="utf-8") as f:
                out = json.load(f)
            self.assertEqual(out["UID"], "new")
            self.assertEqual(out["rose"], "r")

    def test_fresh_file_when_missing(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "missing.json")
            sess = _FakeSession([_FakeCookie("UID", "1")])
            save_cookies(sess, p)
            self.assertTrue(os.path.isfile(p))
            with open(p, "r", encoding="utf-8") as f:
                self.assertEqual(json.load(f), {"UID": "1"})


class TestShouldSave(unittest.TestCase):
    def setUp(self):
        self._orig = api_client_SAVE_ALL_RAW()
        # 通过模块全局切换 SAVE_ALL_RAW（api_client 内 from config import ... SAVE_ALL_RAW）

    def tearDown(self):
        set_api_client_SAVE_ALL_RAW(self._orig)

    def test_none_never_saves(self):
        set_api_client_SAVE_ALL_RAW(False)
        self.assertFalse(_should_save(None))

    def test_key_prefix_always_saves_when_off(self):
        set_api_client_SAVE_ALL_RAW(False)
        self.assertTrue(_should_save("01_courses_raw.json"))
        self.assertTrue(_should_save("03_tasks_123.json"))
        self.assertFalse(_should_save("02_other.json"))

    def test_all_raw_on(self):
        set_api_client_SAVE_ALL_RAW(True)
        self.assertTrue(_should_save("anything.json"))


def api_client_SAVE_ALL_RAW():
    return __import__("api_client").SAVE_ALL_RAW


def set_api_client_SAVE_ALL_RAW(v):
    __import__("api_client").SAVE_ALL_RAW = v


class TestWithRetry(unittest.TestCase):
    def test_retries_transient_then_raises(self):
        @config.with_retry(max_attempts=3, base_delay=0.001)
        def flaky():
            flaky.calls += 1
            raise OSError("x")
        flaky.calls = 0
        with self.assertRaises(OSError):
            flaky()
        self.assertEqual(flaky.calls, 3)

    def test_non_transient_not_retried(self):
        @config.with_retry()
        def boom():
            boom.calls += 1
            raise TypeError("bug")
        boom.calls = 0
        with self.assertRaises(TypeError):
            boom()
        self.assertEqual(boom.calls, 1)

    def test_success_no_retry(self):
        @config.with_retry()
        def ok():
            ok.calls += 1
            return 42
        ok.calls = 0
        self.assertEqual(ok(), 42)
        self.assertEqual(ok.calls, 1)


class TestRunLock(unittest.TestCase):
    def test_acquire_release_cycle(self):
        with tempfile.TemporaryDirectory() as d:
            lp = os.path.join(d, "cx_crawler.lock")
            lock = config.RunLock(lp)
            lock.acquire()
            self.assertTrue(os.path.exists(lp))
            # 已有实例运行时，再次 acquire 应抛 RuntimeError
            with self.assertRaises(RuntimeError):
                config.RunLock(lp).acquire()
            lock.release()
            self.assertFalse(os.path.exists(lp))

    def test_context_manager(self):
        with tempfile.TemporaryDirectory() as d:
            lp = os.path.join(d, "cx.lock")
            with config.RunLock(lp):
                self.assertTrue(os.path.exists(lp))
            self.assertFalse(os.path.exists(lp))


class TestThrottle(unittest.TestCase):
    def test_enforces_min_interval(self):
        config.MIN_INTERVAL = 0.05
        start = time.monotonic()
        config.throttle(0.05)
        config.throttle(0.05)
        elapsed = time.monotonic() - start
        self.assertGreaterEqual(elapsed, 0.05)
        config.MIN_INTERVAL = 1.0  # 还原默认


class TestEnvPriority(unittest.TestCase):
    """环境变量应优先于 JSON 配置文件（吸收评审 R3 / #4）。"""

    def test_course_ids_env_over_json(self):
        # 让 JSON 配置探测返回 False（不读取真实 courses.json）
        with mock.patch.dict(os.environ, {"CX_COURSE_IDS": "111, 222, abc"}), \
             mock.patch("config.os.path.isfile", return_value=False):
            ids = config._load_active_course_ids()
        self.assertEqual(ids, {111, 222})  # 非数字被忽略

    def test_course_ids_empty_without_env(self):
        with mock.patch.dict(os.environ, {}, clear=False), \
             mock.patch("config.os.path.isfile", return_value=False):
            os.environ.pop("CX_COURSE_IDS", None)
            ids = config._load_active_course_ids()
        self.assertEqual(ids, set())

    def test_bridge_env_overrides(self):
        with mock.patch.dict(os.environ, {"CX_BRIDGE_HOST": "0.0.0.0", "CX_BRIDGE_PORT": "9000"}), \
             mock.patch("config.os.path.isfile", return_value=False):
            host, port = config._load_bridge_config()
        self.assertEqual(host, "0.0.0.0")
        self.assertEqual(port, 9000)

    def test_bridge_default_when_no_env(self):
        with mock.patch.dict(os.environ, {}, clear=False), \
             mock.patch("config.os.path.isfile", return_value=False):
            os.environ.pop("CX_BRIDGE_HOST", None)
            os.environ.pop("CX_BRIDGE_PORT", None)
            host, port = config._load_bridge_config()
        self.assertEqual(host, config._BRIDGE_DEFAULT_HOST)
        self.assertEqual(port, config._BRIDGE_DEFAULT_PORT)


if __name__ == "__main__":
    unittest.main()
