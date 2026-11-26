"""The "check finished" note posted after every check that found nothing new (or failed)."""
import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_report  # noqa: E402

NOON_UTC = dt.datetime(2026, 11, 26, 12, 5, tzinfo=dt.timezone.utc)


class CheckReportTest(unittest.TestCase):
    def test_nothing_new_lists_failed_sources_in_bratislava_time(self):
        status = {"sources": {"a": {"name": "ŠÚKL · Aktuality", "ok": False, "error": "HTTP 403"},
                              "b": {"name": "EMA", "ok": True}}}
        text = check_report.report("success", "https://run", status, NOON_UTC)
        self.assertIn("Check finished – nothing new", text)
        self.assertIn("26.11.2026 13:05 (Bratislava)", text)  # winter time = UTC+1
        self.assertIn("All 2 sources were checked; 1 answered normally.", text)
        self.assertIn("- ŠÚKL · Aktuality: HTTP 403", text)

    def test_failed_check_says_so_with_a_link(self):
        text = check_report.report("failure", "https://run/1", None, NOON_UTC)
        self.assertIn("Check did not finish", text)
        self.assertIn("https://run/1", text)


if __name__ == "__main__":
    unittest.main()
