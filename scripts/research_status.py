#!/usr/bin/env python3
"""Scan docs/research/ and generate a status dashboard for MkDocs.

Usage:
    python scripts/research_status.py          # writes docs/research/dashboard.md
    python scripts/research_status.py --check   # print only, no write
"""

from __future__ import annotations

import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_DIR = REPO_ROOT / "docs" / "research"
OUTPUT_FILE = RESEARCH_DIR / "dashboard.md"

STATUS_EMOJI = {
    "draft": "📝",
    "active": "🔬",
    "concluded": "✅",
    "archived": "📦",
}

STALE_DAYS = {"draft": 60, "active": 30, "concluded": 180, "archived": 9999}


def parse_frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    meta: dict = {}
    for line in m.group(1).splitlines():
        kv = re.match(r"^(\w+):\s*(.+)$", line)
        if kv:
            meta[kv.group(1)] = kv.group(2).strip().strip('"').strip("'")
    return meta


def git_last_modified(path: Path) -> datetime | None:
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%aI", "--", str(path)],
            cwd=REPO_ROOT,
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        return datetime.fromisoformat(out) if out else None
    except Exception:
        return None


def collect_items() -> list[dict]:
    items: list[dict] = []
    for entry in sorted(RESEARCH_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith((".", "_")):
            continue
        readme = entry / "README.md"
        if not readme.exists():
            continue
        meta = parse_frontmatter(readme)
        mod = git_last_modified(readme)
        if mod is None:
            mod = datetime.fromtimestamp(readme.stat().st_mtime, tz=timezone.utc)
        age_days = (datetime.now(timezone.utc) - mod).days
        status = meta.get("status", "draft")
        stale = age_days > STALE_DAYS.get(status, 60)
        items.append(
            {
                "slug": entry.name,
                "title": meta.get("title", entry.name),
                "status": status,
                "created": meta.get("created", "—"),
                "updated": mod.strftime("%Y-%m-%d"),
                "age_days": age_days,
                "stale": stale,
            }
        )
    return items


def render(items: list[dict]) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# 研究状态看板",
        "",
        f"> 由 `scripts/research_status.py` 自动生成，最后更新：{now}。**请勿手动编辑。**",
        "",
    ]

    if not items:
        lines.append("暂无研究条目。")
        return "\n".join(lines) + "\n"

    lines += [
        "| 状态 | 课题 | 创建 | 最后更新 | 天数 | 提醒 |",
        "|------|------|------|----------|------|------|",
    ]
    for it in items:
        emoji = STATUS_EMOJI.get(it["status"], "❓")
        link = f"[{it['title']}]({it['slug']}/README.md)"
        flag = "⚠️ 超期未更新" if it["stale"] else "—"
        lines.append(
            f"| {emoji} {it['status']} | {link} | {it['created']} | {it['updated']} | {it['age_days']}d | {flag} |"
        )

    counts: dict[str, int] = {}
    for it in items:
        counts[it["status"]] = counts.get(it["status"], 0) + 1
    summary = " · ".join(f"{STATUS_EMOJI.get(s, '')} {s}: {n}" for s, n in sorted(counts.items()))
    stale_n = sum(1 for it in items if it["stale"])

    lines += [
        "",
        f"**共 {len(items)} 项**（{summary}）",
        "",
    ]
    if stale_n:
        lines.append(f"⚠️ **{stale_n} 项超期未更新**，请检查是否仍有效或标记为 archived。")
    else:
        lines.append("✅ 所有条目均在有效期内。")

    return "\n".join(lines) + "\n"


def main() -> None:
    check_only = "--check" in sys.argv
    items = collect_items()
    content = render(items)
    if check_only:
        print(content)
    else:
        OUTPUT_FILE.write_text(content, encoding="utf-8")
        print(f"Dashboard written to {OUTPUT_FILE} ({len(items)} items)")


if __name__ == "__main__":
    main()
