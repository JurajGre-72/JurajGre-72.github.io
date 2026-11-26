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
        self.assertEqual(kw["output_config"]["format"]["schema"]["required"], ["about", "what_changed", "impact"])
        self.assertIn("Title: Item a", kw["messages"][0]["content"])

    def test_a_failure_does_not_stop_the_others_and_is_retried_later(self):
        items = [item("a", "2026-11-26"), item("b", "2026-11-25")]
        explain.explain_items(items, set(), HERE, client=FakeClient([RuntimeError("overloaded"), ANSWER]))
        self.assertNotIn("explain", items[0], "a failed item stays without explanation, so the next run tries again")
        self.assertEqual(items[1]["explain"], ANSWER)

    def test_a_declined_item_is_not_retried(self):
        items = [item("a", "2026-11-26")]
        explain.explain_items(items, set(), HERE, client=FakeClient(["refusal"]))
        self.assertEqual(items[0]["explain"], {"declined": True})
        self.assertEqual(explain.pick(items, set()), [])

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


if __name__ == "__main__":
    unittest.main()
