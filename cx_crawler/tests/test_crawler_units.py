# -*- coding: utf-8 -*-
"""单元测试：仅覆盖纯函数 / 解析逻辑，不触达网络、Playwright 或浏览器。

运行方式（在 cx_crawler 父目录）：
    python -m unittest discover -s cx_crawler/tests -p "test_*.py"
或
    python -m unittest cx_crawler.tests.test_crawler_units -v
"""
import json
import os
import sys
import tempfile
import unittest

# 测试文件位于 cx_crawler/tests/，而被测模块（config.py / chapters.py 等）在
# cx_crawler/ 顶层。unittest discover 只会把 tests/ 目录加入 sys.path，
# 导致 `from config import ...` 找不到模块。这里把 cx_crawler/ 加入路径，
# 使测试与运行时的当前工作目录（CWD）无关、可直接 `python -m unittest` 运行。
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import _to_int, atomic_write_json
from chapters import (
    extract_knowledge_ids,
    extract_seed_chapter_id,
    parse_chapter_tasks,
)


class TestToInt(unittest.TestCase):
    def test_int_passthrough(self):
        self.assertEqual(_to_int(42), 42)
        self.assertEqual(_to_int(-7), -7)

    def test_numeric_str(self):
        self.assertEqual(_to_int("123"), 123)
        self.assertEqual(_to_int("  456  "), 456)

    def test_invalid_returns_none(self):
        self.assertIsNone(_to_int(None))
        self.assertIsNone(_to_int("abc"))
        self.assertIsNone(_to_int([1, 2]))
        self.assertIsNone(_to_int({"a": 1}))
        self.assertIsNone(_to_int("12.3"))


class TestAtomicWriteJson(unittest.TestCase):
    def test_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "sub", "out.json")
            payload = {"name": "测试", "ids": [1, 2, 3]}
            atomic_write_json(p, payload)
            self.assertTrue(os.path.isfile(p))
            with open(p, "r", encoding="utf-8") as f:
                # ensure_ascii=False → 中文原样保留
                self.assertIn("测试", f.read())
            with open(p, "r", encoding="utf-8") as f:
                self.assertEqual(json.load(f), payload)


class TestExtractKnowledgeIds(unittest.TestCase):
    def test_first_layer_and_to_old(self):
        html = (
            '<div class="firstLayer" id="234567"></div>'
            '<a onclick="toOld(12345, 987654, 678)">x</a>'
        )
        ids = extract_knowledge_ids(html)
        self.assertIn("234567", ids)
        self.assertIn("987654", ids)

    def test_empty(self):
        self.assertEqual(extract_knowledge_ids(""), set())


class TestExtractSeedChapterId(unittest.TestCase):
    def test_first_layer(self):
        html = '<div class="firstLayer" id="234567"><span></span></div>'
        self.assertEqual(extract_seed_chapter_id(html), "234567")

    def test_missing(self):
        self.assertIsNone(extract_seed_chapter_id("<div></div>"))


class TestParseChapterTasks(unittest.TestCase):
    def test_empty_html_returns_list(self):
        # 空/无节点片段不应抛错，返回空列表
        self.assertEqual(parse_chapter_tasks("", 1, 2, 3), [])

    def test_simple_task_node(self):
        html = (
            '<li id="cur123456">'
            '<a>第1章</a>'
            '<input name="jobUnfinishCount" value="2">'
            '<span class="icon_Completed"></span>'
            "</li>"
        )
        tasks = parse_chapter_tasks(html, 111, 222, 333)
        self.assertIsInstance(tasks, list)
        self.assertEqual(len(tasks), 1)
        t = tasks[0]
        self.assertEqual(t["knowledgeId"], "123456")
        # 修复 M2 后：显式 icon_Completed 应判为已完成
        self.assertTrue(t["completed"])


if __name__ == "__main__":
    unittest.main()
