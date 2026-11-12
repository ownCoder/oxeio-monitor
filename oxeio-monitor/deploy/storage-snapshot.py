#!/usr/bin/env python3
"""Write least-privilege host storage facts for the owner-only API.

The API deliberately has no Docker socket. This host job exposes aggregate
numbers only, keeps one sample per UTC day for 31 days, and never deletes data.
"""
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone

OUTPUT = os.environ.get(
    "OXEIO_STORAGE_SNAPSHOT",
    "/opt/oxeio/oxeio-monitor/.data/storage/ops/host-storage.json",
)


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()


def docker_facts():
    rows = [json.loads(line) for line in run("docker", "system", "df", "--format", "{{json .}}").splitlines()]
    by_type = {row["Type"]: row for row in rows}
    return {
        "images": value(by_type.get("Images")),
        "containers": value(by_type.get("Containers")),
        "volumes": value(by_type.get("Local Volumes")),
        "buildCache": value(by_type.get("Build Cache")),
    }


def value(row):
    if not row:
        return {"totalCount": 0, "active": 0, "size": "0B", "reclaimable": "0B"}
    return {
        "totalCount": int(row.get("TotalCount", 0)),
        "active": int(row.get("Active", 0)),
        "size": row.get("Size", "0B"),
        "reclaimable": row.get("Reclaimable", "0B").split(" (")[0],
    }


def disk_facts():
    stats = os.statvfs("/")
    total = stats.f_blocks * stats.f_frsize
    free = stats.f_bavail * stats.f_frsize
    return {"totalBytes": total, "freeBytes": free, "usedBytes": total - free}


def cleanup_facts():
    raw = run(
        "systemctl", "show", "oxeio-docker-cache-prune.service",
        "-p", "Result", "-p", "ExecMainExitTimestamp", "-p", "ExecMainStatus",
    )
    values = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
    return {
        "result": values.get("Result") or None,
        "exitStatus": int(values.get("ExecMainStatus") or 0),
        "lastRun": values.get("ExecMainExitTimestamp") or None,
    }


def main():
    now = datetime.now(timezone.utc)
    previous = {}
    try:
        with open(OUTPUT, "r", encoding="utf-8") as handle:
            previous = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass

    disk = disk_facts()
    history = [item for item in previous.get("history", []) if item.get("date") != now.date().isoformat()]
    history.append({"date": now.date().isoformat(), "usedBytes": disk["usedBytes"]})
    payload = {
        "version": 1,
        "capturedAt": now.isoformat().replace("+00:00", "Z"),
        "disk": disk,
        "docker": docker_facts(),
        "cleanup": cleanup_facts(),
        "history": history[-31:],
    }

    os.makedirs(os.path.dirname(OUTPUT), mode=0o750, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".host-storage-", dir=os.path.dirname(OUTPUT))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"))
            handle.write("\n")
        os.chmod(tmp, 0o640)
        os.chown(tmp, 0, 1000)
        os.replace(tmp, OUTPUT)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


if __name__ == "__main__":
    main()
