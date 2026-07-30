"""Session title generation.

Two layers:

* ``rule_title`` — instant, zero-dependency, deterministic. Used the moment a
  session is created so the UI always shows a sensible title immediately.
* ``refine_title`` — cleans an LLM-produced summary into a safe short title.
  The actual LLM call lives in the server (it needs the adapter); this module
  only sanitises the result so a misbehaving model can never inject a huge or
  malicious title.

The rule layer is deliberately conservative: a wrong-but-stable title is better
for a production runtime than a clever title that depends on an extra model call
which can fail, cost money, or add latency.
"""

from __future__ import annotations

import re

_MAX = 24
_FENCE = re.compile(r"^```[a-zA-Z0-9_+-]*\s*$")
_MD_INLINE = re.compile(r"[*_`~>#]+")
_WS = re.compile(r"\s+")
# Sentence terminators across CJK + latin.
_SPLIT = re.compile(r"[。！？!?\n；;，,]+")
# A line that looks like a shell command.
_CMD = re.compile(r"^[\s]*[$#%>]\s+\S")
_CMD_BARE = re.compile(
    r"^(git|npm|pnpm|yarn|docker|kubectl|curl|wget|ls|cat|grep|find|cd|mkdir|"
    r"rm|cp|mv|echo|python3?|node|go|cargo|make|pip3?|ssh|scp|rsync)\b"
)


def rule_title(prompt: str) -> str:
    """Derive a short, stable title from the user's first prompt."""
    text = (prompt or "").strip()
    if not text:
        return "新会话"

    # Drop leading fenced code blocks entirely (they make bad titles).
    lines = text.splitlines()
    cleaned: list[str] = []
    in_fence = False
    for line in lines:
        if _FENCE.match(line.strip()):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        cleaned.append(line)
    text = "\n".join(cleaned).strip()
    if not text:
        return "新会话"

    # Shell command? Keep the command itself, lightly trimmed.
    first_line = text.splitlines()[0].strip()
    if _CMD.match(first_line) or _CMD_BARE.match(first_line):
        cmd = _CMD.sub(lambda m: m.group(0).lstrip("$#%> "), first_line).strip()
        cmd = _WS.sub(" ", cmd)
        return _truncate(cmd, _MAX) or "命令"

    # Take the first non-empty line, then the first sentence of it.
    first_line = _WS.sub(" ", first_line).strip()
    sentence = _SPLIT.split(first_line)
    candidate = (sentence[0].strip() if sentence else first_line) or first_line

    # Strip markdown emphasis / heading markers / inline code ticks.
    candidate = _MD_INLINE.sub("", candidate).strip()
    candidate = candidate.strip(" \t\r\n\"'“”‘’[]()（）【】")

    if not candidate:
        candidate = _WS.sub(" ", first_line).strip()

    return _truncate(candidate, _MAX) or "新会话"


def refine_title(llm_output: str, fallback: str) -> str:
    """Sanitise an LLM-generated title; fall back if it's unusable."""
    raw = (llm_output or "").strip()
    if not raw:
        return fallback
    # Take the first line only — models sometimes add explanation.
    raw = raw.splitlines()[0].strip()
    # Strip a leading "标题：" / "Title:" label *before* trimming quotes, so a
    # quoted title like  标题："X"  resolves to X rather than "X.
    raw = re.sub(r"^(标题|title)\s*[:：]\s*", "", raw, flags=re.IGNORECASE).strip()
    # Remove surrounding quotes / brackets the model may have added.
    raw = raw.strip(" \t\r\n\"'“”‘’`[]()（）【】《》<>")
    # Reject anything with newlines, control chars, or that is too long/short.
    if not raw or len(raw) > 40 or any(ch < " " for ch in raw):
        return fallback
    return _truncate(raw, _MAX) or fallback


def _truncate(text: str, limit: int) -> str:
    text = _WS.sub(" ", text).strip()
    if len(text) <= limit:
        return text
    # Try to cut at a natural boundary near the limit.
    cut = text[:limit]
    return cut.rstrip(" ,，.。、;；:：") + "…"
