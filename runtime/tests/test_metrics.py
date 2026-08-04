import unittest

from runtime.metrics import Metrics


class MetricsTests(unittest.TestCase):
    def test_counter_and_render(self):
        m = Metrics()
        m.counter("x_total", "help x")
        m.inc("x_total", method="GET", status="200")
        m.inc("x_total", method="GET", status="200")
        m.inc("x_total", method="POST", status="500")
        out = m.render()
        self.assertIn("# TYPE x_total counter", out)
        self.assertIn('x_total{method="GET",status="200"} 2.0', out)
        self.assertIn('x_total{method="POST",status="500"} 1.0', out)

    def test_gauge_and_provider(self):
        m = Metrics()
        m.set_gauge("up", 1.0)
        m.register_provider(lambda: [("live", {"k": "v"}, 42.0)])
        out = m.render()
        self.assertIn("up 1.0", out)
        self.assertIn('# TYPE live gauge', out)
        self.assertIn('live{k="v"} 42.0', out)

    def test_uptime_present(self):
        m = Metrics()
        self.assertIn("aflow_uptime_seconds", m.render())
        self.assertGreaterEqual(m.uptime_seconds(), 0.0)

    def test_label_escaping(self):
        m = Metrics()
        m.inc("e_total", note='has "quote" and\nnewline')
        out = m.render()
        self.assertIn('\\"quote\\"', out)
        self.assertIn("\\n", out)

    def test_provider_exception_ignored(self):
        m = Metrics()

        def bad():
            raise RuntimeError("boom")

        m.register_provider(bad)
        m.set_gauge("ok", 1.0)
        self.assertIn("ok 1.0", m.render())  # render survives a broken provider


if __name__ == "__main__":
    unittest.main()
