from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any

from .events import RuntimeEvent
from .models import PermissionNotification, RunState


@dataclass(frozen=True)
class PermissionNotificationConfig:
    channels: tuple[str, ...] = ("log",)
    targets: tuple[str, ...] = ("operator",)
    public_base_url: str | None = None
    webhook_url: str | None = None
    webhook_token: str | None = None
    webhook_timeout_seconds: float = 5.0

    @classmethod
    def from_env(cls) -> "PermissionNotificationConfig":
        channels = tuple(
            item
            for item in split_csv(os.environ.get("RUN_MANAGER_PERMISSION_NOTIFY_CHANNELS"))
            if item
        ) or ("log",)
        targets = tuple(
            item
            for item in split_csv(os.environ.get("RUN_MANAGER_PERMISSION_NOTIFY_TARGETS"))
            if item
        ) or ("operator",)
        return cls(
            channels=channels,
            targets=targets,
            public_base_url=empty_to_none(os.environ.get("RUN_MANAGER_PUBLIC_BASE_URL")),
            webhook_url=empty_to_none(os.environ.get("RUN_MANAGER_PERMISSION_WEBHOOK_URL")),
            webhook_token=empty_to_none(os.environ.get("RUN_MANAGER_PERMISSION_WEBHOOK_TOKEN")),
            webhook_timeout_seconds=env_float(
                "RUN_MANAGER_PERMISSION_WEBHOOK_TIMEOUT_SECONDS",
                5.0,
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if data.get("webhook_token"):
            data["webhook_token"] = "configured"
        return data


@dataclass(frozen=True)
class DeliveryResult:
    status: str
    delivery_ref: str | None = None
    error: str | None = None


class PermissionNotifier:
    def __init__(self, config: PermissionNotificationConfig | None = None):
        self.config = config or PermissionNotificationConfig.from_env()

    def notifications_for(
        self,
        *,
        run: RunState,
        permission_id: str,
        event: RuntimeEvent,
    ) -> list[PermissionNotification]:
        message = permission_message(run, permission_id, event)
        action_url = permission_action_url(self.config.public_base_url, run.run_id)
        notifications: list[PermissionNotification] = []
        for channel in self.config.channels:
            for target in self.config.targets:
                notifications.append(
                    PermissionNotification.create(
                        run_id=run.run_id,
                        permission_id=permission_id,
                        channel=channel,
                        target=target,
                        message=message,
                        action_url=action_url,
                        metadata={
                            "event_id": event.id,
                            "event_sequence": event.sequence,
                            "event_type": event.type,
                        },
                    )
                )
        return notifications

    def deliver(
        self,
        notification: PermissionNotification,
        *,
        run: RunState,
        event: RuntimeEvent,
    ) -> DeliveryResult:
        if notification.channel == "log":
            return DeliveryResult(
                status="sent",
                delivery_ref=f"log:{notification.notification_id}",
            )
        if notification.channel == "webhook":
            return self._deliver_webhook(notification, run=run, event=event)
        return DeliveryResult(
            status="failed",
            error=f"unsupported permission notification channel: {notification.channel}",
        )

    def _deliver_webhook(
        self,
        notification: PermissionNotification,
        *,
        run: RunState,
        event: RuntimeEvent,
    ) -> DeliveryResult:
        if not self.config.webhook_url:
            return DeliveryResult(status="failed", error="webhook url is not configured")
        body = json.dumps(
            {
                "type": "permission.requested",
                "notification": notification.to_dict(),
                "run": run.to_dict(),
                "event": event.to_dict(),
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            self.config.webhook_url,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "user-agent": "agentflow-permission-notifier/1",
            },
        )
        if self.config.webhook_token:
            request.add_header("authorization", f"Bearer {self.config.webhook_token}")
        try:
            with urllib.request.urlopen(
                request,
                timeout=self.config.webhook_timeout_seconds,
            ) as response:
                response_body = response.read(1024).decode("utf-8", errors="replace")
                return DeliveryResult(
                    status="sent",
                    delivery_ref=f"webhook:{response.status}:{response_body[:120]}",
                )
        except urllib.error.HTTPError as exc:
            detail = exc.read(512).decode("utf-8", errors="replace")
            return DeliveryResult(status="failed", error=f"http {exc.code}: {detail}")
        except Exception as exc:  # noqa: BLE001 - preserve delivery failure for audit
            return DeliveryResult(status="failed", error=str(exc))


def permission_message(run: RunState, permission_id: str, event: RuntimeEvent) -> str:
    prompt = event.data.get("prompt")
    tool = event.data.get("tool")
    raw = event.data.get("raw")
    if not prompt and isinstance(raw, dict):
        raw_data = raw.get("data")
        if isinstance(raw_data, dict):
            prompt = raw_data.get("prompt")
            tool = tool or raw_data.get("tool")
    title = prompt if isinstance(prompt, str) and prompt.strip() else "Permission required"
    tool_suffix = f" tool={tool}" if isinstance(tool, str) and tool else ""
    return f"{title} run={run.run_id} permission={permission_id}{tool_suffix}"


def permission_action_url(public_base_url: str | None, run_id: str) -> str:
    if not public_base_url:
        return f"/runs/{run_id}"
    return f"{public_base_url.rstrip('/')}/#/runs/{run_id}"


def split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def empty_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return max(0.1, float(raw))
    except ValueError:
        return default
