"""Plain-language explanations (explain.py) with a fake Claude client – no key, no network, no cost."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import explain  # noqa: E402
import slovak  # noqa: E402
import monitor  # noqa: E402

HERE = Path(__file__).resolve().parents[1]


class FakeClient:
    """Answers like the Messages API; `script` decides per call: a dict (JSON answer), "refusal" or an exception."""

    def __init__(self, script):
        self.script, self.calls = list(script), []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        usage = SimpleNamespace(input_tokens=1000, output_tokens=100)
        if step == "refusal":
            return SimpleNamespace(stop_reason="refusal", content=[], usage=usage)
        return SimpleNamespace(stop_reason="end_turn", usage=usage,
                               content=[SimpleNamespace(type="text", text=json.dumps(step))])


def item(i, date, **kw):
    return {"id": i, "source": "uskvbl", "source_name": "ÚŠKVBL", "category": "Veterinary", "date": date,
            "title": f"Item {i}", "url": "https://x", "summary": "Added: …", **kw}


ANSWER = {"about": "A notice.", "what_changed": "A new list was added.", "impact": "Check stock."}


class ExplainTest(unittest.TestCase):
    def test_new_items_first_then_older_newest_first_and_limit(self):
        items = [item("old1", "2026-01-01"), item("new", "2025-06-01"), item("old2", "2026-03-01"),
                 item("done", "2026-11-01", explain=ANSWER)]
        picked = [i["id"] for i in explain.pick(items, {"new"}, limit=2)]
        self.assertEqual(picked, ["new", "old2"])

    def test_explanations_are_stored_and_the_request_is_as_intended(self):
        items = [item("a", "2026-11-26")]
        client = FakeClient([ANSWER])
        self.assertEqual(explain.explain_items(items, {"a"}, HERE, client=client), 1)
        self.assertEqual(items[0]["explain"], ANSWER)
        kw = client.calls[0]
        self.assertEqual(kw["model"], "claude-opus-5-5")
        self.assertEqual(kw["fallbacks"], "default")
        self.assertEqual(kw["output_config"]["format"]["schema"]["required"], ["about", "what_changed", "impact", "sk"])
        self.assertIn("Title: Item a", kw["messages"][0]["content"])

    def test_a_failure_does_not_stop_the_others_and_is_retried_later(self):
        items = [item("a", "2026-11-26"), item("b", "2026-11-25")]
        explain.explain_items(items, set(), HERE, client=FakeClient([RuntimeError("overloaded"), ANSWER]))
        self.assertNotIn("explain", items[0], "a failed item stays without explanation, so the next run tries again")
        self.assertEqual(items[1]["explain"], ANSWER)

    def test_claudes_slovak_version_is_stored(self):
        items = [item("a", "2026-11-26")]
        sk = {"about": "Oznam.", "what_changed": "Pribudol zoznam.", "impact": "Skontrolujte zásoby."}
        explain.explain_items(items, set(), HERE, client=FakeClient([{**ANSWER, "sk": sk}]))
        self.assertEqual(items[0]["explain"], {**ANSWER, "sk": sk})

    def test_a_declined_item_is_not_retried(self):
        items = [item("a", "2026-11-26")]
        explain.explain_items(items, set(), HERE, client=FakeClient(["refusal"]))
        self.assertTrue(items[0]["explain"]["declined"])
        self.assertTrue(items[0]["explain"]["about"], "a declined item keeps the free explanation")
        self.assertEqual(explain.pick(items, set(), 40), [])

    def test_the_limit_option_reaches_the_selection(self):
        items = [item(str(n), f"2026-11-{n:02d}") for n in range(1, 6)]
        client = FakeClient([ANSWER] * 5)
        self.assertEqual(explain.explain_items(items, set(), HERE, client=client, limit=2), 2)
        self.assertEqual(len(client.calls), 2)
        with mock.patch.object(explain, "explain_items", return_value=0) as ex, \
             mock.patch.object(monitor, "save_json"), \
             mock.patch.object(monitor, "CHANGES_DIR", Path(tempfile.mkdtemp()) / "changes"), \
             mock.patch.object(monitor, "load_json", side_effect=lambda path, default, real=monitor.load_json:
                               real(path, default) if path == monitor.CONFIG_FILE else ({} if default is None else default)), \
             mock.patch.object(sys, "argv", ["monitor.py", "--sources", "nothing", "--explain-limit", "2"]):
            monitor.main()
        self.assertEqual(ex.call_args.kwargs["limit"], 2, "--explain-limit must reach explain_items")

    def test_without_a_key_nothing_happens(self):
        items = [item("a", "2026-11-26")]
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(explain.explain_items(items, {"a"}, HERE), 0)
        self.assertNotIn("explain", items[0])

    def test_a_broken_explanation_step_never_stops_the_check(self):
        # runs main() against an empty temporary data folder: nothing in pharma-monitor/data may be touched
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        with mock.patch.object(monitor, "CHANGES_DIR", tmp / "changes"), \
             mock.patch.object(monitor, "ITEMS_FILE", tmp / "items.json"), \
             mock.patch.object(monitor, "STATE_FILE", tmp / "state.json"), \
             mock.patch.object(monitor, "STATUS_FILE", tmp / "status.json"), \
             mock.patch.object(explain, "explain_items", side_effect=RuntimeError("boom")), \
             mock.patch.object(monitor, "save_json") as save, \
             mock.patch.object(monitor, "load_json", side_effect=lambda path, default, real=monitor.load_json:
                               real(path, default) if path == monitor.CONFIG_FILE else ({} if default is None else default)), \
             mock.patch.object(sys, "argv", ["monitor.py", "--sources", "nothing"]):
            monitor.main()  # must not raise
        saved = [c.args[0].name for c in save.call_args_list]
        self.assertIn("status.json", saved)

    def test_the_email_shows_the_explanation(self):
        it = monitor.make_item("uskvbl", "u1", "New document: Zoznam", "https://x", None, "Veterinary", 2, [], "raw")
        it["explain"] = ANSWER
        _, body = monitor.digest([it])
        self.assertIn("**About:** A notice.", body)
        self.assertIn("**For PHARMACOPOLA:** Check stock.", body)



class FreeExplanationTest(unittest.TestCase):
    def test_supply_interruption(self):
        it = {"source": "sukl_web", "category": "Supply / availability", "url": "https://www.sukl.sk/x-24857-prerusenie-2.11.2026",
              "title": "Novalgin 500 mg (24857) - Prerušenie 2.11.2026",
              "summary": "Typ oznámenia: Prerušenie · Platnosť od: 2.11.2026 · Predpokladaný termín obnovenia: 29.11.2026 · Kód ŠÚKL: 24857"}
        e = explain.basic(it)
        self.assertEqual(e["about"], "ŠÚKL supply notice for Novalgin 500 mg (24857).")
        self.assertIn("Type: Interruption", e["what_changed"])
        self.assertIn("Expected resumption: 29.11.2026", e["what_changed"])
        self.assertIn("check your stock", e["impact"])
        self.assertTrue(e["auto"])

    def test_law_change(self):
        it = {"source": "lawchanges", "category": "Law change", "effective": ["2027-01-01"],
              "title": "39/2007 Z. z. – Act on Veterinary Care: new wording in force from 01.01.2027",
              "summary": "Changed by 272/2026 Z. z. 79 provision(s) changed: § 5, § 6. Open the item to see the old and new wording."}
        e = explain.basic(it)
        self.assertEqual(e["about"], "Slov-Lex published a new consolidated wording of 39/2007 Z. z. (Act on Veterinary Care).")
        self.assertEqual(e["what_changed"], "Changed by 272/2026 Z. z. 79 provision(s) changed: § 5, § 6. In force from 01.01.2027.")
        self.assertIn("by 01.01.2027", e["impact"])

    def test_bill_in_parliament(self):
        it = {"source": "slovlex_lp", "category": "Bill in Parliament (NR SR)",
              "title": "LP/2026/382 · Zákon: Návrh zákona o omamných látkach",
              "summary": "Stage: Rokovanie Národnej rady SR (since 14.09.2026) · Submitted by: Ministerstvo zdravotníctva SR"}
        e = explain.basic(it)
        self.assertTrue(e["about"].startswith("Draft act in the Slov-Lex legislative process, submitted by Ministerstvo zdravotníctva SR"))
        self.assertIn("Parliament", e["impact"])

    def test_a_page_with_two_notices_describes_only_the_first(self):
        it = {"source": "sukl_web", "category": "Supply / availability", "url": "https://x-24857-prerusenie",
              "title": "Novalgin (24857) - Prerušenie 02.11.2026",
              "summary": "Typ oznámenia: Prerušenie · Platnosť od: 02.11.2026 · Predpokladaný termín obnovenia: Detail"
                         " · Typ oznámenia: Obnovenie · Platnosť od: 26.11.2026"}
        self.assertEqual(explain.basic(it)["what_changed"], "Type: Interruption · Valid from: 02.11.2026")

    def test_a_published_draft_is_law_not_a_draft(self):
        it = {"source": "slovlex_lp", "category": "Draft law", "title": "LP/2026/625 · Zákon: Návrh zákona",
              "summary": "Moved from stage “Pripomienkové konanie” to “Vyhlásené v Zbierke zákonov SR”"
                         " · Stage: Vyhlásené v Zbierke zákonov SR (since 17.11.2026)"}
        self.assertIn("now law", explain.basic(it)["impact"])

    def test_uskvbl_invoice_page_needs_no_action(self):
        it = {"source": "uskvbl", "category": "Veterinary (ÚŠKVBL)", "priority": "medium",
              "title": "Updated page: OBJEDNÁVKY A FAKTÚRY", "summary": "New on the page: faktúry jún 2026"}
        self.assertIn("no action needed", explain.basic(it)["impact"])

    def test_every_item_gets_one_and_a_rerun_changes_nothing(self):
        items = [item("a", "2026-11-26"), item("b", "2026-11-25", explain=ANSWER)]
        self.assertEqual(explain.add_basic(items), 2, "both get Slovak titles, only the first a free explanation")
        self.assertTrue(items[0]["explain"]["auto"])
        self.assertTrue(items[0]["explain"]["sk"]["about"])
        self.assertEqual(items[1]["explain"], ANSWER, "a Claude explanation is never overwritten")
        self.assertEqual(explain.add_basic(items), 0)

    def test_free_explanations_are_upgraded_by_claude_but_declined_ones_are_not_retried(self):
        items = [item("a", "2026-11-26"), item("b", "2026-11-25")]
        explain.add_basic(items)
        items[1]["explain"]["declined"] = True
        self.assertEqual([i["id"] for i in explain.pick(items, set(), 40)], ["a"])


class SlovakTest(unittest.TestCase):
    def test_supply_notice_in_slovak_keeps_the_notice_text(self):
        it = {"source": "sukl_web", "category": "Supply / availability", "url": "https://x-24857-prerusenie",
              "title": "Novalgin (24857) - Prerušenie 2.11.2026",
              "summary": "Typ oznámenia: Prerušenie · Platnosť od: 2.11.2026 · Kód ŠÚKL: 24857"}
        e = explain.free(it)["sk"]
        self.assertEqual(e["about"], "Oznámenie ŠÚKL o dostupnosti lieku Novalgin (24857).")
        self.assertEqual(e["what_changed"], "Typ oznámenia: Prerušenie · Platnosť od: 2.11.2026 · Kód ŠÚKL: 24857")
        self.assertIn("skontrolujte zásoby", e["impact"])

    def test_law_change_title_and_text(self):
        it = {"source": "lawchanges", "category": "Law change", "effective": ["2027-01-01"], "tags": ["Amends 39/2007"],
              "title": "39/2007 Z. z. – Act on Veterinary Care: new wording in force from 01.01.2027",
              "summary": "Changed by 272/2026 Z. z. 79 provision(s) changed: § 5, § 6 +3 more. Open the item to see the old and new wording."}
        explain.add_basic([it])
        self.assertEqual(it["title_sk"], "39/2007 Z. z. – zákon o veterinárnej starostlivosti: nové znenie účinné od 01.01.2027")
        self.assertEqual(it["category_sk"], "Zmena zákona")
        self.assertEqual(it["tags_sk"], ["Mení 39/2007"])
        self.assertEqual(it["explain"]["sk"]["what_changed"],
                         "Zmenené predpisom 272/2026 Z. z. Zmenené ustanovenia (79): § 5, § 6 a ďalšie (3). Účinné od 01.01.2027.")

    def test_draft_stage_and_uskvbl_titles(self):
        draft = {"source": "slovlex_lp", "category": "Draft law", "title": "LP/2026/1 · Vyhláška: Návrh vyhlášky",
                 "summary": "Moved from stage “Pripomienkové konanie” to “Rokovanie vlády SR” · Stage: Rokovanie vlády SR (since 2.11.2026)"}
        e = explain.free(draft)["sk"]
        self.assertTrue(e["about"].startswith("Návrh vyhlášky v legislatívnom procese Slov-Lex"))
        self.assertEqual(e["what_changed"], "Presunuté zo štádia „Pripomienkové konanie“ do štádia „Rokovanie vlády SR“"
                                            " · Štádium: Rokovanie vlády SR (od 2.11.2026)")
        self.assertIn("vláda", e["impact"])
        doc = {"source": "uskvbl", "category": "Veterinary (ÚŠKVBL)", "title": "Document published: Zoznam liekov"}
        self.assertEqual(slovak.title(doc), "Zverejnený dokument: Zoznam liekov")

    def test_reimbursement_list_title(self):
        it = {"source": "kategorizacia", "title": "Zoznam 1.12.2026 (updated version): 17 added, 7 removed, 26 price/reimbursement changes"}
        self.assertEqual(slovak.title(it), "Zoznam 1.12.2026 (aktualizovaná verzia): pridané: 17, vyradené: 7, zmeny cien a úhrad: 26")


if __name__ == "__main__":
    unittest.main()
