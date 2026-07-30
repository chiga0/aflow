"""SQLite persistence. Three tables: sessions, messages, events."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .models import Event, Message, Session, utc_now

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'idle',
    qwen_session_id TEXT,
    workspace     TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES sessions(id),
    role          TEXT NOT NULL,
    content       TEXT NOT NULL DEFAULT '',
    tool_name     TEXT,
    tool_call_id  TEXT,
    partial       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL REFERENCES sessions(id),
    type          TEXT NOT NULL,
    data          TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, id);
"""


class Store:
    def __init__(self, db_path: str | Path = "data/aflow.db"):
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self._path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)

    # ── Sessions ──────────────────────────────────────────────

    def create_session(self, session: Session) -> Session:
        with self._lock:
            self._conn.execute(
                "INSERT INTO sessions (id, title, status, qwen_session_id, workspace, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    session.id,
                    session.title,
                    session.status,
                    session.qwen_session_id,
                    session.workspace,
                    session.created_at,
                    session.updated_at,
                ),
            )
            self._conn.commit()
        return session

    def get_session(self, session_id: str) -> Session | None:
        row = self._conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        return self._row_to_session(row) if row else None

    def list_sessions(self, limit: int = 100) -> list[Session]:
        rows = self._conn.execute(
            "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [self._row_to_session(r) for r in rows]

    def update_session(self, session: Session) -> None:
        session.touch()
        with self._lock:
            self._conn.execute(
                "UPDATE sessions SET title=?, status=?, qwen_session_id=?, workspace=?, updated_at=?"
                " WHERE id=?",
                (
                    session.title,
                    session.status,
                    session.qwen_session_id,
                    session.workspace,
                    session.updated_at,
                    session.id,
                ),
            )
            self._conn.commit()

    # ── Messages ──────────────────────────────────────────────

    def append_message(self, msg: Message) -> Message:
        with self._lock:
            self._conn.execute(
                "INSERT INTO messages (id, session_id, role, content, tool_name, tool_call_id, partial, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    msg.id,
                    msg.session_id,
                    msg.role,
                    msg.content,
                    msg.tool_name,
                    msg.tool_call_id,
                    int(msg.partial),
                    msg.created_at,
                ),
            )
            self._conn.commit()
        return msg

    def list_messages(self, session_id: str) -> list[Message]:
        rows = self._conn.execute(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at",
            (session_id,),
        ).fetchall()
        return [self._row_to_message(r) for r in rows]

    # ── Events ────────────────────────────────────────────────

    def append_event(self, session_id: str, event_type: str, data: dict[str, Any]) -> Event:
        with self._lock:
            cursor = self._conn.execute(
                "INSERT INTO events (session_id, type, data, created_at) VALUES (?, ?, ?, ?)",
                (session_id, event_type, json.dumps(data, ensure_ascii=False, default=str), utc_now()),
            )
            self._conn.commit()
            event_id = cursor.lastrowid or 0
        return Event(id=event_id, session_id=session_id, type=event_type, data=data)

    def events_since(self, session_id: str, after_id: int = 0) -> list[Event]:
        rows = self._conn.execute(
            "SELECT * FROM events WHERE session_id = ? AND id > ? ORDER BY id",
            (session_id, after_id),
        ).fetchall()
        return [self._row_to_event(r) for r in rows]

    # ── Row converters ────────────────────────────────────────

    @staticmethod
    def _row_to_session(row: sqlite3.Row) -> Session:
        return Session(
            id=row["id"],
            title=row["title"],
            status=row["status"],
            qwen_session_id=row["qwen_session_id"],
            workspace=row["workspace"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_message(row: sqlite3.Row) -> Message:
        return Message(
            id=row["id"],
            session_id=row["session_id"],
            role=row["role"],
            content=row["content"],
            tool_name=row["tool_name"],
            tool_call_id=row["tool_call_id"],
            partial=bool(row["partial"]),
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> Event:
        return Event(
            id=row["id"],
            session_id=row["session_id"],
            type=row["type"],
            data=json.loads(row["data"]),
            created_at=row["created_at"],
        )
