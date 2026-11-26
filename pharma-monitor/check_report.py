#!/usr/bin/env python3
"""The short "check finished" note the workflow posts after every check that found nothing new (or failed).

    python3 check_report.py <outcome of the check step> <link to the run>

Reads data/status.json (written by every check) and prints Markdown.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
DASHBOARD_URL = "https://jurajgre-72.github.io/pharma-monitor/"


def report(outcome: str, run_url: str, status: dict | None, now: dt.datetime) -> str:
    when = now.astimezone(ZoneInfo("Europe/Bratislava")).strftime("%d.%m.%Y %H:%M")
    if outcome != "success":
        return (f"⚠️ **Check did not finish** – {when} (Bratislava)\n\n"
                f"The monitor stopped with an error, so this time nothing was checked. "
                f"The next check runs in about 4 hours. Details: {run_url}\n")
    sources = (status or {}).get("sources", {})
    failed = {k: s for k, s in sources.items() if not s.get("ok")}
    lines = [f"✅ **Check finished – nothing new** – {when} (Bratislava)", "",
             f"All {len(sources)} sources were checked; {len(sources) - len(failed)} answered normally."]
    if failed:
        lines += ["", "Could not be read this time (the next check tries again):"]
        lines += [f"- {s.get('name', k)}: {(s.get('error') or 'unknown error')[:160]}" for k, s in failed.items()]
    lines += ["", f"Dashboard: {DASHBOARD_URL}"]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    try:
        status = json.loads((HERE / "data" / "status.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        status = None
    print(report(sys.argv[1] if len(sys.argv) > 1 else "success", sys.argv[2] if len(sys.argv) > 2 else "",
                 status, dt.datetime.now(dt.timezone.utc)), end="")
