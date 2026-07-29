#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import sys
import tarfile
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify an aflow runtime backup can be restored"
    )
    parser.add_argument("backup", type=pathlib.Path)
    args = parser.parse_args()

    report = verify_backup(args.backup)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["valid"] else 1


def verify_backup(backup_path: pathlib.Path) -> dict:
    checks: list[dict] = []
    error = None

    if not backup_path.exists():
        return {
            "backup": str(backup_path),
            "valid": False,
            "checks": [],
            "error": "backup file not found",
        }

    with tempfile.TemporaryDirectory() as tmp:
        extract_dir = pathlib.Path(tmp)
        try:
            with tarfile.open(backup_path, "r:gz") as archive:
                archive.extractall(extract_dir, filter="data")
            checks.append({"id": "extract", "status": "pass"})
        except Exception as exc:
            checks.append({"id": "extract", "status": "fail"})
            return {
                "backup": str(backup_path),
                "valid": False,
                "checks": checks,
                "error": f"extraction failed: {exc}",
            }

        db_path = extract_dir / "runtime.db"
        if db_path.exists():
            checks.append({"id": "runtime_db_exists", "status": "pass"})
            try:
                conn = sqlite3.connect(db_path)
                count = conn.execute(
                    "SELECT count(*) FROM runs"
                ).fetchone()[0]
                conn.close()
                checks.append({
                    "id": "runtime_db_queryable",
                    "status": "pass",
                    "run_count": count,
                })
            except Exception as exc:
                checks.append({
                    "id": "runtime_db_queryable",
                    "status": "fail",
                })
                error = f"database query failed: {exc}"
        else:
            checks.append({"id": "runtime_db_exists", "status": "fail"})
            error = "runtime.db not found in backup"

        manifest_path = extract_dir / "manifest.json"
        if manifest_path.exists():
            checks.append({"id": "manifest_exists", "status": "pass"})
            try:
                manifest = json.loads(
                    manifest_path.read_text(encoding="utf-8")
                )
                checks.append({
                    "id": "manifest_valid",
                    "status": "pass",
                    "created_at": manifest.get("created_at"),
                })
            except Exception as exc:
                checks.append({"id": "manifest_valid", "status": "fail"})
                error = error or f"manifest parse failed: {exc}"
        else:
            checks.append({"id": "manifest_exists", "status": "warn"})

    failed = any(c["status"] == "fail" for c in checks)
    return {
        "backup": str(backup_path),
        "valid": not failed and error is None,
        "checks": checks,
        "error": error,
    }


if __name__ == "__main__":
    raise SystemExit(main())
