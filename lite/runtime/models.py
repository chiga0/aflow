"""Data models. Three concepts: Session, Message, Event."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


@dataclass
class Session:
    id: str
    title: str = ""
    status: str = "idle"  # idle | running | completed | failed | cancelled
    qwen_session_id: str | None = None
    workspace: str | None = None
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    @classmethod
    def create(cls, title: str = "", workspace: str | None = None) -> Session:
        return cls(id=new_id("s"), title=title, workspace=workspace)

    def touch(self) -> None:
        self.updated_at = utc_now()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Message:
    id: str
    session_id: str
    role: str  # user | assistant | tool | system
    content: str = ""
    tool_name: str | None = None
    tool_call_id: str | None = None
    partial: bool = False
    created_at: str = field(default_factory=utc_now)

    @classmethod
    def create(
        cls,
        session_id: str,
        role: str,
        content: str = "",
        *,
        tool_name: str | None = None,
        tool_call_id: str | None = None,
        partial: bool = False,
    ) -> Message:
        return cls(
            id=new_id("m"),
            session_id=session_id,
            role=role,
            content=content,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            partial=partial,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Event:
    id: int  # auto-increment, used as SSE id
    session_id: str
    type: str  # message.delta | tool.start | tool.update | tool.end |
               # permission.request | status.change | error | done
    data: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
