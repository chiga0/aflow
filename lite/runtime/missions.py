"""Lightweight server-side mission orchestration (sequential only).

A *mission* is a goal executed as an ordered list of steps (default:
plan → code → review). Each step runs as its own qwen session via
``relay.collect_turn``; the previous step's output is fed into the next step's
prompt so the chain stays coherent without any shared memory. The text each
step produces is persisted as ``result_text`` — that *is* the step's artifact
(the WebShell already renders artifacts, and the API exposes them on
``GET /api/missions/:id``).

This deliberately supports only the ``sequential`` strategy. Fan-out / DAG
orchestration is out of scope for aflow-lite; the point of this module is to
prove the multi-step loop on top of ``collect_turn``, not to rebuild the old
mission engine.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any
from urllib.parse import unquote

from .adapter import QwenAdapter
from .auth import AuthConfig
from .models import new_id, utc_now
from .relay import collect_turn
from .store import Store
from . import titles

logger = logging.getLogger("aflow_lite.missions")

DEFAULT_STEP_TIMEOUT = 300.0

DEFAULT_SEQUENTIAL_STEPS: list[dict[str, str]] = [
    {
        "role": "planner",
        "title": "规划",
        "prompt": (
            "阅读任务目标，产出一份简洁的执行计划：要做的步骤、关键风险、验收标准。"
            "本步只做规划，不要修改任何文件。"
        ),
    },
    {
        "role": "coder",
        "title": "实现",
        "prompt": (
            "严格依据上一步的规划，在隔离工作区实现变更。完成后说明：改了哪些文件、"
            "为什么这样改、如何验证。"
        ),
    },
    {
        "role": "reviewer",
        "title": "审查",
        "prompt": (
            "审查上一步的实现与残留风险，给出明确结论。回复的最后一行必须是且仅是 "
            '一个 JSON 对象：{"decision":"pass|warn|block","reason":"简短理由"}。'
        ),
    },
]

# Runtime-only bookkeeping (not persisted): cancellation flags and the qwen
# session currently executing a mission, so cancel can interrupt it.
_cancelled: set[str] = set()
_active_qwen: dict[str, str] = {}
_rt_lock = threading.Lock()


# ── prompt composition ──────────────────────────────────────


def _compose_prompt(mission: dict[str, Any], step: dict[str, Any], prev: str) -> str:
    parts = [
        f"# 任务目标\n{mission.get('goal') or ''}",
        f"\n## 当前步骤（{step.get('role') or 'worker'} · {step.get('title') or ''}）",
        f"\n{step.get('prompt') or '完成本步骤并产出结论。'}",
    ]
    if prev.strip():
        parts.append(f"\n## 上一步产出（供参考，必要时据此调整）\n{prev[:4000]}")
    if (step.get("role") or "").lower() == "reviewer":
        parts.append(
            "\n## 输出约束\n最后一行必须是且仅是一个 JSON 对象，形如 "
            '{"decision":"pass|warn|block","reason":"..."}。'
        )
    return "\n".join(parts)


# ── runner ──────────────────────────────────────────────────


def run_mission(store: Store, adapter: QwenAdapter, mission_id: str) -> None:
    mission = store.get_mission(mission_id)
    if not mission:
        return
    steps = store.list_mission_steps(mission_id)
    _mark_mission(store, mission_id, "running")

    prev = ""
    aborted = False
    for step in steps:
        if mission_id in _cancelled:
            aborted = True
            _mark_step(store, step["id"], status="cancelled", completed_at=utc_now())
            continue
        if aborted:
            _mark_step(store, step["id"], status="cancelled", completed_at=utc_now())
            continue

        _mark_step(store, step["id"], status="running", started_at=utc_now())
        composed = _compose_prompt(mission, step, prev)
        sid: str | None = None
        try:
            sid = adapter.create_session(cwd=mission.get("cwd"))
            _mark_step(store, step["id"], qwen_session_id=sid)
            with _rt_lock:
                _active_qwen[mission_id] = sid
            adapter.send_prompt(sid, composed)
            result = collect_turn(adapter, sid, timeout=DEFAULT_STEP_TIMEOUT)
            _mark_step(
                store,
                step["id"],
                status="completed" if result.ok else "failed",
                result_text=result.text,
                error=result.error,
                completed_at=utc_now(),
            )
            prev = result.text
            if not result.ok:
                _mark_mission(store, mission_id, "failed")
                return
        except Exception as exc:  # noqa: BLE001 — surface adapter failure as step failure
            logger.exception("mission %s step %s failed", mission_id, step["id"])
            _mark_step(
                store,
                step["id"],
                status="failed",
                error=str(exc),
                completed_at=utc_now(),
            )
            _mark_mission(store, mission_id, "failed")
            return
        finally:
            with _rt_lock:
                _active_qwen.pop(mission_id, None)

    final = "cancelled" if (mission_id in _cancelled or aborted) else "completed"
    _mark_mission(store, mission_id, final)
    _cancelled.discard(mission_id)


def _mark_mission(store: Store, mission_id: str, status: str) -> None:
    m = store.get_mission(mission_id)
    if not m:
        return
    m["status"] = status
    m["updated_at"] = utc_now()
    store.upsert_mission(m)


def _mark_step(store: Store, step_id: str, **fields: Any) -> None:
    store.update_mission_step(step_id, **fields)


# ── HTTP routes (mounted via routes_extra) ──────────────────


def _parts(path: str) -> list[str]:
    return [unquote(p) for p in path.split("/") if p]


def handle_get(handler: Any, path: str, store: Store, adapter: QwenAdapter, auth: AuthConfig) -> bool:
    parts = _parts(path)
    if parts == ["api", "missions"]:
        handler.json({"missions": store.list_missions()})
        return True
    if len(parts) == 3 and parts[:2] == ["api", "missions"]:
        mission = store.get_mission(parts[2])
        if not mission:
            handler.error(__import__("http").HTTPStatus.NOT_FOUND, "mission not found")
            return True
        handler.json({"mission": mission, "steps": store.list_mission_steps(parts[2])})
        return True
    return False


def handle_post(
    handler: Any,
    path: str,
    body: dict[str, Any],
    raw: bytes,
    store: Store,
    adapter: QwenAdapter,
    auth: AuthConfig,
) -> bool:
    parts = _parts(path)
    if parts == ["api", "missions"]:
        return _create(handler, body, store, adapter)
    if len(parts) == 4 and parts[:2] == ["api", "missions"] and parts[3] == "cancel":
        return _cancel(handler, parts[2], store, adapter)
    return False


def _create(handler: Any, body: dict[str, Any], store: Store, adapter: QwenAdapter) -> bool:
    from http import HTTPStatus

    goal = str(body.get("goal") or "").strip()
    if not goal:
        handler.error(HTTPStatus.BAD_REQUEST, "goal is required")
        return True
    strategy = str(body.get("strategy") or "sequential").strip().lower()
    if strategy != "sequential":
        handler.error(HTTPStatus.BAD_REQUEST, "only 'sequential' strategy is supported")
        return True

    raw_steps = body.get("steps")
    if raw_steps is None:
        steps_def = [dict(s) for s in DEFAULT_SEQUENTIAL_STEPS]
    elif isinstance(raw_steps, list) and raw_steps:
        steps_def = []
        for i, s in enumerate(raw_steps):
            if not isinstance(s, dict) or not str(s.get("prompt") or "").strip():
                handler.error(HTTPStatus.BAD_REQUEST, f"steps[{i}] needs a non-empty prompt")
                return True
            steps_def.append({
                "role": str(s.get("role") or "worker"),
                "title": str(s.get("title") or s.get("role") or f"step {i + 1}"),
                "prompt": str(s.get("prompt")).strip(),
            })
    else:
        handler.error(HTTPStatus.BAD_REQUEST, "steps must be a non-empty list")
        return True

    now = utc_now()
    mission_id = new_id("ms")
    cwd = body.get("cwd")
    store.upsert_mission({
        "id": mission_id,
        "title": titles.rule_title(goal),
        "goal": goal,
        "strategy": strategy,
        "status": "pending",
        "cwd": cwd if isinstance(cwd, str) else None,
        "created_at": now,
        "updated_at": now,
        "metadata": {},
    })
    for i, sd in enumerate(steps_def):
        store.add_mission_step({
            "id": new_id("st"),
            "mission_id": mission_id,
            "ord": i,
            "role": sd["role"],
            "title": sd["title"],
            "prompt": sd["prompt"],
            "qwen_session_id": None,
            "status": "pending",
            "result_text": "",
            "error": None,
            "started_at": None,
            "completed_at": None,
            "created_at": now,
            "updated_at": now,
        })

    threading.Thread(target=run_mission, args=(store, adapter, mission_id), daemon=True).start()
    handler.json(store.get_mission(mission_id), status=HTTPStatus.CREATED)
    return True


def _cancel(handler: Any, mission_id: str, store: Store, adapter: QwenAdapter) -> bool:
    from http import HTTPStatus

    mission = store.get_mission(mission_id)
    if not mission:
        handler.error(HTTPStatus.NOT_FOUND, "mission not found")
        return True
    _cancelled.add(mission_id)
    with _rt_lock:
        sid = _active_qwen.get(mission_id)
    if sid:
        try:
            adapter.cancel(sid, reason="mission cancelled")
        except Exception:
            logger.debug("cancel qwen session %s failed", sid, exc_info=True)
    if mission["status"] in ("pending", "running"):
        _mark_mission(store, mission_id, "cancelled")
    handler.json(store.get_mission(mission_id))
    return True
