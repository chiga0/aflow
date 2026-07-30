"""SQLite persistence for the control plane's own state.

In the WebShell-driven architecture qwen owns the live transcript, so we do not
store sessions/messages/events here. We persist only what the control plane
itself owns:

* ``auth_sessions``  — browser login sessions (so a restart keeps you logged in)
* ``missions`` / ``mission_steps`` — server-side multi-step orchestration
* ``channels``       — inbound chat channel (DingTalk / Feishu / webhook) config

Schema migrations are handled with ``CREATE TABLE IF NOT EXISTS`` plus additive
``ALTER TABLE`` guarded by ``PRAGMA table_info`` so an existing DB upgrades
in place without data loss.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .models import utc_now

SCHEMA = """
CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id   TEXT PRIMARY KEY,
    email        TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS missions (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL DEFAULT '',
    goal         TEXT NOT NULL DEFAULT '',
    strategy     TEXT NOT NULL DEFAULT 'sequential',
    status       TEXT NOT NULL DEFAULT 'pending',
    cwd          TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    metadata     TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS mission_steps (
    id              TEXT PRIMARY KEY,
    mission_id      TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    ord             INTEGER NOT NULL,
    role            TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    prompt          TEXT NOT NULL DEFAULT '',
    qwen_session_id TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    result_text     TEXT NOT NULL DEFAULT '',
    error           TEXT,
    started_at      TEXT,
    completed_at    TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_mission ON mission_steps(mission_id, ord);

CREATE TABLE IF NOT EXISTS channels (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    webhook_url TEXT NOT NULL DEFAULT '',
    secret      TEXT NOT NULL DEFAULT '',
    reply_url   TEXT NOT NULL DEFAULT '',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    metadata    TEXT NOT NULL DEFAULT '{}'
);
"""


class Store:
    def __init__(self, db_path: str | Path = "data/aflow.db") -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self._path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(SCHEMA)

    # ── Auth sessions ─────────────────────────────────────────

    def create_auth_session(self, session_id: str, email: str, expires_at: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO auth_sessions (session_id, email, created_at, expires_at)"
                " VALUES (?, ?, ?, ?)",
                (session_id, email, utc_now(), expires_at),
            )
            self._conn.commit()

    def get_auth_session(self, session_id: str) -> dict[str, str] | None:
        row = self._conn.execute(
            "SELECT session_id, email, expires_at FROM auth_sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] < utc_now():
            self.delete_auth_session(session_id)
            return None
        return {
            "session_id": row["session_id"],
            "email": row["email"],
            "expires_at": row["expires_at"],
        }

    def delete_auth_session(self, session_id: str) -> None:
        with self._lock:
            self._conn.execute(
                "DELETE FROM auth_sessions WHERE session_id = ?", (session_id,)
            )
            self._conn.commit()

    def purge_expired_auth_sessions(self) -> int:
        with self._lock:
            cursor = self._conn.execute(
                "DELETE FROM auth_sessions WHERE expires_at < ?", (utc_now(),)
            )
            self._conn.commit()
            return cursor.rowcount or 0

    # ── Missions ──────────────────────────────────────────────

    def upsert_mission(self, mission: dict[str, Any]) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO missions (id, title, goal, strategy, status, cwd, created_at, updated_at, metadata)"
                " VALUES (:id, :title, :goal, :strategy, :status, :cwd, :created_at, :updated_at, :metadata)"
                " ON CONFLICT(id) DO UPDATE SET"
                " title=excluded.title, goal=excluded.goal, strategy=excluded.strategy,"
                " status=excluded.status, cwd=excluded.cwd, updated_at=excluded.updated_at,"
                " metadata=excluded.metadata",
                {**mission, "metadata": json.dumps(mission.get("metadata") or {}, ensure_ascii=False)},
            )
            self._conn.commit()

    def get_mission(self, mission_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM missions WHERE id = ?", (mission_id,)
        ).fetchone()
        return self._row_to_mission(row) if row else None

    def list_missions(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM missions ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [self._row_to_mission(r) for r in rows]

    def add_mission_step(self, step: dict[str, Any]) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO mission_steps (id, mission_id, ord, role, title, prompt,"
                " qwen_session_id, status, result_text, error, started_at, completed_at,"
                " created_at, updated_at)"
                " VALUES (:id, :mission_id, :ord, :role, :title, :prompt, :qwen_session_id,"
                " :status, :result_text, :error, :started_at, :completed_at, :created_at, :updated_at)",
                step,
            )
            self._conn.commit()

    def update_mission_step(self, step_id: str, **fields: Any) -> None:
        if not fields:
            return
        fields["updated_at"] = utc_now()
        sets = ", ".join(f"{k} = ?" for k in fields)
        with self._lock:
            self._conn.execute(
                f"UPDATE mission_steps SET {sets} WHERE id = ?",
                (*fields.values(), step_id),
            )
            self._conn.commit()

    def list_mission_steps(self, mission_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM mission_steps WHERE mission_id = ? ORDER BY ord",
            (mission_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Channels ──────────────────────────────────────────────

    def upsert_channel(self, channel: dict[str, Any]) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO channels (id, type, name, webhook_url, secret, reply_url,"
                " enabled, created_at, updated_at, metadata)"
                " VALUES (:id, :type, :name, :webhook_url, :secret, :reply_url, :enabled,"
                " :created_at, :updated_at, :metadata)"
                " ON CONFLICT(id) DO UPDATE SET type=excluded.type, name=excluded.name,"
                " webhook_url=excluded.webhook_url, secret=excluded.secret,"
                " reply_url=excluded.reply_url, enabled=excluded.enabled,"
                " updated_at=excluded.updated_at, metadata=excluded.metadata",
                {
                    **channel,
                    "enabled": int(bool(channel.get("enabled", True))),
                    "metadata": json.dumps(channel.get("metadata") or {}, ensure_ascii=False),
                },
            )
            self._conn.commit()

    def get_channel(self, channel_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM channels WHERE id = ?", (channel_id,)
        ).fetchone()
        return self._row_to_channel(row) if row else None

    def list_channels(self) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM channels ORDER BY created_at"
        ).fetchall()
        return [self._row_to_channel(r) for r in rows]

    def delete_channel(self, channel_id: str) -> bool:
        with self._lock:
            cursor = self._conn.execute(
                "DELETE FROM channels WHERE id = ?", (channel_id,)
            )
            self._conn.commit()
            return bool(cursor.rowcount)

    # ── Row converters ────────────────────────────────────────

    @staticmethod
    def _row_to_mission(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        d["metadata"] = json.loads(d.get("metadata") or "{}")
        return d

    @staticmethod
    def _row_to_channel(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        d["enabled"] = bool(d.get("enabled"))
        d["metadata"] = json.loads(d.get("metadata") or "{}")
        return d
