"""Plain-language explanations of monitor items, written by Claude.

For each item the dashboard shows three short parts:
  about        – what the document, notice or page is
  what_changed – concretely what is new or different
  impact       – what it means for PHARMACOPOLA (wholesale distribution of human and veterinary medicines)

Runs only when ANTHROPIC_API_KEY is set (GitHub secret). Without it, or without the `anthropic` package, the
monitor works exactly as before. At most MAX_PER_RUN items are explained per run: new items first, then older
items without an explanation, newest first, so the existing list fills in over a few checks.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

MODEL = "claude-opus-5-5"
MAX_PER_RUN = 40
DETAIL_CHARS = 12000  # how much of a "what changed" detail file is sent along (law diffs can be long)

SYSTEM = """You explain regulatory updates to the management of PHARMACOPOLA s.r.o., a Slovak wholesale \
distributor of human and veterinary medicines, medical devices and related products (good distribution practice \
= SDP/GDP, ŠÚKL and ÚŠKVBL licences, FMD/medicines verification, reimbursement and prices).

For the item you are given, write three short parts in plain English (the readers are pharmacists, not lawyers):
- about: what this document, notice or web page is, in one or two sentences. Name the issuer and the subject.
- what_changed: concretely what is new or different, in one to three sentences. Use the facts given (provisions,
  dates, products, ŠÚKL codes, stage of a draft law). If the input only shows that a page changed, say what was
  added or removed. Never invent facts that are not in the input; if something is unclear, say so briefly.
- impact: one or two sentences on what it means for a wholesale distributor like PHARMACOPOLA and whether any
  action is needed (e.g. check stock, update an SOP, inform customers, watch the deadline). If it does not concern
  a distributor, say "No direct impact on distribution." and why in a few words.
Keep Slovak names of laws, institutions and products as they are."""

SCHEMA = {
    "type": "object",
    "properties": {
        "about": {"type": "string"},
        "what_changed": {"type": "string"},
        "impact": {"type": "string"},
    },
    "required": ["about", "what_changed", "impact"],
    "additionalProperties": False,
}


def item_prompt(item: dict, here: Path) -> str:
    parts = [f"Source: {item.get('source_name', item.get('source'))}",
             f"Category: {item.get('category', '')}",
             f"Date: {item.get('date', '')[:10]}",
             f"Title: {item.get('title', '')}",
             f"Link: {item.get('url', '')}",
             f"Summary from the monitor: {item.get('summary', '')}"]
    if item.get("effective"):
        parts.append(f"In force from: {', '.join(item['effective'])}")
    if item.get("deadline"):
        parts.append(f"Comment deadline: {item['deadline']}")
    if item.get("details"):
        try:
            detail = json.loads((here / item["details"]).read_text(encoding="utf-8"))
            text = json.dumps(detail, ensure_ascii=False)
            if len(text) > DETAIL_CHARS:
                text = text[:DETAIL_CHARS] + " … (cut)"
            parts.append(f"Details of what changed (JSON): {text}")
        except (OSError, json.JSONDecodeError):
            pass
    return "\n".join(parts)


def explain_one(client, item: dict, here: Path) -> dict | None:
    """One request; returns {"about", "what_changed", "impact"} or None if Claude declined."""
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=4000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # if a safety classifier declines, the API retries on a fallback model in the same call
        system=SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": item_prompt(item, here)}],
    )
    if response.stop_reason == "refusal":
        return None
    text = next((b.text for b in response.content if b.type == "text"), "")
    data = json.loads(text)
    data["usage"] = (response.usage.input_tokens, response.usage.output_tokens)
    return data


def pick(items: list[dict], new_ids: set[str], limit: int = MAX_PER_RUN) -> list[dict]:
    """New items first, then older ones without an explanation, newest first."""
    todo = sorted((i for i in items if "explain" not in i), key=lambda i: i.get("date", ""), reverse=True)
    todo.sort(key=lambda i: i["id"] not in new_ids)  # stable: new items first, each group newest first
    return todo[:limit]


def explain_items(items: list[dict], new_ids: set[str], here: Path, client=None) -> int:
    """Adds item["explain"] in place. Returns how many items were explained."""
    if client is None:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("Explanations: skipped (no ANTHROPIC_API_KEY).")
            return 0
        try:
            import anthropic
        except ImportError:
            print("Explanations: skipped (the anthropic package is not installed).")
            return 0
        client = anthropic.Anthropic(max_retries=3)
    done, tokens_in, tokens_out = 0, 0, 0
    for item in pick(items, new_ids):
        try:
            result = explain_one(client, item, here)
        except Exception as e:  # one failure must not stop the check; the item is tried again next run
            print(f"  ! explanation for {item['id']}: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr)
            if type(e).__name__ in ("AuthenticationError", "PermissionDeniedError"):
                break  # a wrong key fails every request
            continue
        if result is None:
            item["explain"] = {"declined": True}  # not retried
            continue
        tin, tout = result.pop("usage")
        tokens_in, tokens_out = tokens_in + tin, tokens_out + tout
        item["explain"] = {k: str(result[k]).strip() for k in ("about", "what_changed", "impact")}
        done += 1
    if done:
        cost = tokens_in / 1e6 * 4 + tokens_out / 1e6 * 20  # Claude Opus 5.5 list prices, USD
        print(f"Explanations: {done} item(s), {tokens_in} input + {tokens_out} output tokens ≈ ${cost:.2f}")
    return done
