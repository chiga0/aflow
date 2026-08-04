"""Tiny Prometheus-compatible metrics. Stdlib only, thread-safe.

Exposes counters and gauges in the text exposition format at ``/metrics``.
Gauges that reflect store state (session counts) are computed lazily via a
registered provider so they are always fresh.
"""

from __future__ import annotations

import threading
import time
from typing import Callable


def _label_str(labels: dict[str, str]) -> str:
    if not labels:
        return ""
    parts = []
    for k, v in labels.items():
        escaped = v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        parts.append(f'{k}="{escaped}"')
    return "{" + ",".join(parts) + "}"


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        self._gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        self._counter_help: dict[str, str] = {}
        self._gauge_help: dict[str, str] = {}
        self._gauge_providers: list[Callable[[], list[tuple[str, dict[str, str], float]]]] = []
        self._start = time.time()

    # ── mutation ──────────────────────────────────────────────

    def counter(self, name: str, help_text: str) -> None:
        self._counter_help.setdefault(name, help_text)

    def gauge(self, name: str, help_text: str) -> None:
        self._gauge_help.setdefault(name, help_text)

    def inc(self, name: str, value: float = 1.0, **labels: str) -> None:
        self._counter_help.setdefault(name, name)
        key = (name, tuple(sorted(labels.items())))
        with self._lock:
            self._counters[key] = self._counters.get(key, 0.0) + value

    def set_gauge(self, name: str, value: float, **labels: str) -> None:
        self._gauge_help.setdefault(name, name)
        key = (name, tuple(sorted(labels.items())))
        with self._lock:
            self._gauges[key] = value

    def register_provider(
        self,
        fn: Callable[[], list[tuple[str, dict[str, str], float]]],
    ) -> None:
        """Register a callable returning [(name, labels, value), ...] gauges."""
        self._gauge_providers.append(fn)

    # ── exposition ────────────────────────────────────────────

    def uptime_seconds(self) -> float:
        return time.time() - self._start

    def render(self) -> str:
        lines: list[str] = []
        # live gauges from providers
        live: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        for provider in self._gauge_providers:
            try:
                for name, labels, value in provider():
                    self._gauge_help.setdefault(name, name)
                    live[(name, tuple(sorted(labels.items())))] = value
            except Exception:
                continue

        with self._lock:
            counters = dict(self._counters)
            gauges = dict(self._gauges)

        # counters
        emitted_help: set[str] = set()
        for (name, label_pairs), value in sorted(counters.items()):
            if name not in emitted_help:
                lines.append(f"# HELP {name} {self._counter_help.get(name, name)}")
                lines.append(f"# TYPE {name} counter")
                emitted_help.add(name)
            lines.append(f"{name}{_label_str(dict(label_pairs))} {value}")

        # static gauges + live gauges
        all_gauges = dict(gauges)
        all_gauges.update(live)
        emitted_help_g: set[str] = set()
        for (name, label_pairs), value in sorted(all_gauges.items()):
            if name not in emitted_help_g:
                lines.append(f"# HELP {name} {self._gauge_help.get(name, name)}")
                lines.append(f"# TYPE {name} gauge")
                emitted_help_g.add(name)
            lines.append(f"{name}{_label_str(dict(label_pairs))} {value}")

        # uptime always present
        lines.append("# HELP aflow_uptime_seconds Seconds since runtime start")
        lines.append("# TYPE aflow_uptime_seconds gauge")
        lines.append(f"aflow_uptime_seconds {self.uptime_seconds():.3f}")
        lines.append("")
        return "\n".join(lines)


# Module-level singleton
METRICS = Metrics()
METRICS.counter("aflow_http_requests_total", "Total HTTP requests by method and status")
METRICS.counter("aflow_agent_runs_total", "Total agent runs started")
METRICS.counter("aflow_agent_failures_total", "Total agent runs that failed")
METRICS.counter("aflow_auth_failures_total", "Total failed authentication attempts")
METRICS.gauge("aflow_up", "1 if runtime is up")
METRICS.gauge("aflow_qwen_up", "1 if qwen serve is reachable")
