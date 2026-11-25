"""Unit tests for the whole-website trackers (ŠÚKL sitemap, ÚŠKVBL / SOOL WordPress). No network: fetching is faked.

    python3 -m unittest discover -s pharma-monitor/tests -p 'test_*.py'
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import monitor  # noqa: E402

RULES = monitor.Rules(monitor.load_json(monitor.CONFIG_FILE, None))
NOTICE = "https://www.sukl.sk/novalgin-500-mg-24857-prerusenie-02.11.2026"


def sitemap(pages: dict) -> str:
    rows = "".join(f"<url><loc>{u}</loc><lastmod>{m}</lastmod></url>" for u, m in pages.items())
    return f"<urlset>{rows}</urlset>"


def site(n=150, **changed) -> dict:
    """A fake ŠÚKL sitemap with n filler pages (the tracker refuses suspiciously short sitemaps)."""
    pages = {f"https://www.sukl.sk/page-{i}": "2026-09-14" for i in range(n)}
    pages.update(changed)
    return pages


NOTICE_LINES = ["Novalgin 500 mg (24857) - Prerušenie 02.11.2026", "Detail hlásenia", "Typ oznámenia", "Prerušenie",
                "Platnosť od", "02.11.2026", "Dátum hlásenia", "23.11.2026", "Predpokladaný termín obnovenia", "23.11.2026",
                "Kód ŠÚKL", "24857"]


class SuklWebTest(unittest.TestCase):
    def run_check(self, state, pages, page_result, bootstrap=False):
        with mock.patch.object(monitor, "fetch", return_value=sitemap(pages)), \
             mock.patch.object(monitor, "sukl_page", side_effect=page_result):
            return monitor.check_sukl_web(RULES, state, bootstrap, set())

    def baseline(self):
        state = {}
        self.run_check(state, site(**{NOTICE: "2026-11-01"}), lambda u: (NOTICE_LINES[0], NOTICE_LINES), bootstrap=True)
        return state

    def test_changed_notice_reports_what_changed(self):
        state = self.baseline()
        state["sukl_web"]["lines"][NOTICE] = monitor.line_hashes(NOTICE_LINES)
        new_lines = NOTICE_LINES[:-3] + ["30.11.2026"] + NOTICE_LINES[-2:]  # expected resumption moved
        items = self.run_check(state, site(**{NOTICE: "2026-11-24"}), lambda u: (new_lines[0], new_lines))
        self.assertEqual(len(items), 1)
        self.assertIn("Predpokladaný termín obnovenia: 30.11.2026", items[0]["summary"])
        self.assertEqual(items[0]["category"], "Supply / availability")

    def test_failed_download_is_retried_not_skipped(self):
        state = self.baseline()
        state["sukl_web"]["lines"][NOTICE] = monitor.line_hashes(NOTICE_LINES)
        changed = site(**{NOTICE: "2026-11-24"})
        new_lines = NOTICE_LINES + ["Poznámka", "nové"]

        def down(url):
            raise RuntimeError("timeout")
        self.assertEqual(self.run_check(state, changed, down), [])
        self.assertEqual(state["sukl_web"]["lastmod"][NOTICE], "2026-11-01", "date must not be recorded after a failure")
        items = self.run_check(state, changed, lambda u: (new_lines[0], new_lines))
        self.assertEqual(len(items), 1, "the change must be reported once the page loads again")
        self.assertEqual(state["sukl_web"]["lastmod"][NOTICE], "2026-11-24")

    def test_page_that_keeps_failing_is_given_up_after_three_tries(self):
        state = self.baseline()
        dead = "https://www.sukl.sk/dead-link"
        pages = site(**{NOTICE: "2026-11-01", dead: "2026-11-24"})

        def down(url):
            raise RuntimeError("404")
        for _ in range(3):
            self.run_check(state, pages, down)
        self.assertEqual(state["sukl_web"]["lastmod"][dead], "2026-11-24")
        self.assertNotIn(dead, state["sukl_web"]["failed"])

    def test_notice_read_for_the_first_time_is_dated_when_it_was_filed(self):
        state = self.baseline()  # the notice is known from the sitemap but its text was never read
        state["sukl_web"]["lines"].pop(NOTICE, None)
        lines = NOTICE_LINES[:6] + ["Dátum hlásenia", "2.11.2026 15:22"] + NOTICE_LINES[8:]  # ŠÚKL's newer date format
        items = self.run_check(state, site(**{NOTICE: "2026-11-25"}), lambda u: (lines[0], lines))
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["date"], "2026-11-02T12:00:00Z")

    def test_notice_republished_under_a_new_address_is_not_reported_again(self):
        state = self.baseline()
        moved = NOTICE.replace("02.11.2026", "2.11.2026")
        lines = NOTICE_LINES[:5] + ["2.11.2026"] + NOTICE_LINES[6:]
        known = {monitor.notice_key(monitor.notice_summary(NOTICE_LINES))}
        with mock.patch.object(monitor, "fetch", return_value=sitemap(site(**{NOTICE: "2026-11-01", moved: "2026-11-25"}))), \
             mock.patch.object(monitor, "sukl_page", return_value=(lines[0], lines)):
            items = monitor.check_sukl_web(RULES, state, False, set(), known)
        self.assertEqual(items, [])

    def test_notice_dates_in_both_formats(self):
        self.assertEqual(monitor.iso(monitor.notice_date("Dátum hlásenia: 02.11.2026")), "2026-11-02T12:00:00Z")
        self.assertEqual(monitor.iso(monitor.notice_date("Typ: X · Dátum hlásenia: 2.11.2026 15:22 · Kód")), "2026-11-02T12:00:00Z")
        self.assertIsNone(monitor.notice_date("no date here"))

    def test_redated_page_with_same_text_is_not_reported(self):
        state = self.baseline()
        state["sukl_web"]["lines"][NOTICE] = monitor.line_hashes(NOTICE_LINES)
        items = self.run_check(state, site(**{NOTICE: "2026-11-24"}), lambda u: (NOTICE_LINES[0], NOTICE_LINES))
        self.assertEqual(items, [])

    def test_site_wide_redating_does_not_download_everything(self):
        state = self.baseline()
        calls = []
        pages = {u: "2026-11-24" for u in site(**{NOTICE: "2026-11-01"})}  # the same pages, all re-dated
        self.run_check(state, pages, lambda u: calls.append(u) or ("t", ["text line"]))
        self.assertLessEqual(len(calls), 1, "only pages whose text we already track may be downloaded")


class WordPressListTest(unittest.TestCase):
    def fake_site(self, total):
        entries = [{"id": i} for i in range(total, 0, -1)]  # newest first

        def wp_get(site, route, per_page, page, **params):
            chunk = entries[(page - 1) * per_page: page * per_page]
            if not chunk:
                raise RuntimeError("400 rest_post_invalid_page_number")
            return chunk
        return wp_get

    def test_reads_back_until_an_entry_already_seen(self):
        seen = {str(i) for i in range(1, 51)}  # we knew ids 1–50; 250 newer ones arrived since
        with mock.patch.object(monitor, "wp_get", side_effect=self.fake_site(300)):
            got = []
            for e in monitor.wp_newest("sool", "media", lambda e: str(e["id"]) in seen):
                got.append(e["id"])
                seen.add(str(e["id"]))  # the caller records entries while reading, as check_wordpress does
        self.assertTrue(set(range(51, 301)) <= set(got), "all 250 new entries must be read")

    def test_normal_check_makes_one_request(self):
        fake = self.fake_site(300)
        calls = []
        with mock.patch.object(monitor, "wp_get", side_effect=lambda *a, **k: calls.append(k["page"]) or fake(*a, **k)):
            list(monitor.wp_newest("sool", "media", lambda e: e["id"] <= 299))
        self.assertEqual(calls, [1])

    def test_stops_at_the_last_page(self):
        with mock.patch.object(monitor, "wp_get", side_effect=self.fake_site(200)):
            self.assertEqual(len(list(monitor.wp_newest("sool", "media", lambda e: False))), 200)


class WordPressHistoryTest(unittest.TestCase):
    def test_history_lists_two_years_once_without_notifications(self):
        now = monitor.now_utc()
        day = lambda d: monitor.iso(now - monitor.dt.timedelta(days=d)).replace("Z", "")
        media = [{"id": 3, "date_gmt": day(10), "title": {"rendered": "Duecoxin_40mg_tbl_psy"},
                  "source_url": "https://www.uskvbl.sk/wp-content/uploads/a.pdf", "mime_type": "application/pdf"},
                 {"id": 2, "date_gmt": day(20), "title": {"rendered": "logo"},
                  "source_url": "https://www.uskvbl.sk/wp-content/uploads/b.png", "mime_type": "image/png"},
                 {"id": 1, "date_gmt": day(900), "title": {"rendered": "old"},
                  "source_url": "https://www.uskvbl.sk/wp-content/uploads/c.pdf", "mime_type": "application/pdf"}]

        def wp_get(site, route, **params):
            if route == "media":
                return media if params.get("page", 1) == 1 else []
            return []
        state = {"uskvbl": {"pages": {}, "posts": {}, "media": {"3": "x", "2": "x", "1": "x"}}}  # all already seen
        with mock.patch.object(monitor, "wp_get", side_effect=wp_get):
            items = monitor.check_wordpress("uskvbl", RULES, state, False)
            again = monitor.check_wordpress("uskvbl", RULES, state, False)
        self.assertEqual([i["title"] for i in items], ["Document published: Duecoxin 40mg tbl psy"])  # no image, nothing > 2 years
        self.assertTrue(items[0].get("_backlog"), "history must not send notifications")
        self.assertEqual(again, [], "the history is listed only once")


class DescribeChangeTest(unittest.TestCase):
    def test_unchanged_text_is_none(self):
        lines = ["a line", "another line"]
        self.assertIsNone(monitor.describe_change(lines, monitor.line_hashes(lines), monitor.line_hashes(lines)))

    def test_added_value_gets_its_label_and_removed_lines_are_counted(self):
        old = ["Platnosť od", "02.11.2026", "Poznámka", "pôvodná"]
        new = ["Platnosť od", "09.11.2026", "Poznámka"]
        out = monitor.describe_change(new, monitor.line_hashes(new), monitor.line_hashes(old))
        self.assertIn("Added: Platnosť od: 09.11.2026", out)
        self.assertIn("Removed: 2 lines", out)


if __name__ == "__main__":
    unittest.main()
