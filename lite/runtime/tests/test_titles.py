import unittest

from lite.runtime.titles import refine_title, rule_title


class RuleTitleTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(rule_title(""), "新会话")
        self.assertEqual(rule_title("   \n  "), "新会话")

    def test_chinese_first_sentence(self):
        self.assertEqual(rule_title("审计当前项目的部署链路，输出风险与修复顺序"), "审计当前项目的部署链路")

    def test_strips_fence(self):
        self.assertEqual(rule_title("```python\nprint(1)\n```\n然后总结结果"), "然后总结结果")

    def test_command_kept(self):
        self.assertTrue(rule_title("git status && git diff").startswith("git status"))
        self.assertTrue(rule_title("ls -la /tmp").startswith("ls -la"))

    def test_strips_heading_and_emphasis(self):
        self.assertEqual(rule_title("# 重构登录模块\n\n细节说明"), "重构登录模块")
        self.assertEqual(rule_title("**加粗** 的标题行"), "加粗 的标题行")

    def test_truncation(self):
        long_text = "这是一段非常非常长的任务描述文字用于测试截断逻辑是否正常工作并且加上省略号"
        title = rule_title(long_text)
        self.assertLessEqual(len(title), 25)
        self.assertTrue(title.endswith("…"))


class RefineTitleTests(unittest.TestCase):
    def test_strips_label_and_quotes(self):
        self.assertEqual(refine_title('标题："部署审计"', "fb"), "部署审计")

    def test_first_line_only(self):
        self.assertEqual(refine_title("简洁标题\n后面是解释说明", "fb"), "简洁标题")

    def test_fallback_on_empty(self):
        self.assertEqual(refine_title("", "fb"), "fb")
        self.assertEqual(refine_title("   ", "fb"), "fb")

    def test_fallback_on_too_long(self):
        self.assertEqual(refine_title("x" * 80, "fb"), "fb")

    def test_fallback_on_control_chars(self):
        self.assertEqual(refine_title("bad\x00title", "fb"), "fb")


if __name__ == "__main__":
    unittest.main()
