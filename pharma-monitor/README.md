# PHARMACOPOLA Regulatory Monitor

Watches official Slovak sources and tells you when something new appears that matters
to a distributor of human and veterinary medicines, medical devices and related products.

**Dashboard:** https://jurajgre-72.github.io/pharma-monitor/

## What it checks

| Source | What | "What changed" detail |
|---|---|---|
| **Slov-Lex – Collection of Laws** (`slovlex`) | Every new law, government regulation, decree and ministry measure | Full text is read; the exact amendment points for key laws are extracted, even from omnibus acts. Shows when it comes into force. |
| **Slov-Lex – key law wordings** (`lawchanges`) | New consolidated wording of 18 key laws (362/2011, 363/2011, 39/2007, 139/1998, …), often published before it takes effect | Provision-by-provision comparison with the previous wording: § / odsek / písmeno, removed and added words highlighted, plus the amending act |
| **Slov-Lex – eLegislatíva** (`slovlex_lp`) | New drafts (pripomienkové konanie) and every stage change: government, **Parliament (NR SR)**, publication. Includes MPs' bills and EU acts handled by Slovak ministries | Stage moved from → to, comment deadline, submitting ministry, main act amended |
| **MZ SR – list of categorised medicines** (`kategorizacia`) | Each monthly reimbursement list (Part A) | Medicines added / removed and changes of max. price, reimbursement, co-pay, prescription and indication restrictions, by ŠÚKL code |
| **ŠÚKL – recall feed** (`sukl_recall`) | Medicines withdrawn from the market | Always **high** priority |
| **ŠÚKL – news feed** (`sukl`) | Supply disruptions (MSC), distribution and pharmacy guidance, DHPC safety letters, medical devices, advertising | Priority depends on section |
| **MZ SR – news** (`mzsr`) | Press releases about medicines, reimbursement, prices, insurance | Keyword filtered |
| **ÚŠKVBL** (`uskvbl`) | Updates of the veterinary institute's pages (important notices, quality, lists) | Lines added to the page |
| **ŠVPS SR** (`svps`) | Veterinary medicines, emergency measures, animal disease outbreaks, non-compliant products | Keyword and category filtered |
| **EUR-Lex** (`eurlex`) | New EU regulations, directives and decisions on medicines, veterinary medicines, medical devices, distribution, shortages | Slovak title, link to the Slovak text, which act it amends |
| **EMA** (`ema`) | European Medicines Agency news (CHMP/PRAC/CVMP highlights, shortages, safety) | Headline decides priority |

**Not included:** the Public Health Authority (ÚVZ SR) rejects all automated requests (HTTP 401), and the
Parliament website (nrsr.sk) is too unreliable for automated reading (timeouts / HTTP 504). Bills in Parliament
are still covered through Slov-Lex eLegislatíva, which tracks them through the "Rokovanie Národnej rady SR" stage.

## How you get notified

1. `.github/workflows/pharma-monitor.yml` runs twice a day (about 06:15 and 15:15 Bratislava time) and can also be started by hand
   (**Actions → Regulatory monitor → Run workflow**).
2. When it finds new relevant items it opens a **GitHub issue** labelled `regulatory-update` with a digest
   (🔴 high / 🟠 medium / ⚪ low). GitHub e-mails new issues to the repository owner. Check that
   *Settings → Notifications → Email* is on and that you are "watching" this repository.
3. **Optional direct e-mail** (for example to a company address or several people): add these repository secrets under
   *Settings → Secrets and variables → Actions*:
   `SMTP_HOST` (e.g. `smtp.gmail.com`), `SMTP_PORT` (`587`), `SMTP_USER`, `SMTP_PASSWORD`
   (for Gmail, an [app password](https://myaccount.google.com/apppasswords)), `MAIL_TO` (comma-separated).

The dashboard shows everything found, with filters, search and "NEW" markers.

## Tuning relevance

Edit `config.json`:

- `keywords`: label, level (`high` / `medium` / `low`) and a regular expression. Text is matched
  in lower case **without diacritics** (`liečivo` → `liecivo`).
- `key_laws`: law numbers to look for inside new legislation, with `key_law_levels` setting how important an amendment is.
- `exclude`: noise to drop (job offers, tenders for staff, …).
- `notify_min_priority`: lowest priority that triggers a notification (default `medium`; low items still appear on the dashboard).
- `eu_keywords`: English rules for EUR-Lex and EMA; `eurlex_min_priority` drops frequent low-value EU acts (feed additives, biocides).
- `generic_labels`: tags that are shown but do not raise priority on regulator feeds (almost every ŠÚKL item mentions "liek").

## Run locally

```bash
python3 pharma-monitor/monitor.py               # all sources
python3 pharma-monitor/monitor.py --sources sukl_recall,mzsr
```

Python 3.10+, no extra packages (`curl` is used as a fallback for flaky downloads). The "what changed" details are
written to `data/changes/*.json` and loaded by the dashboard when you open an item.

Data is saved in `data/items.json` (dashboard) and `data/state.json`
(what has already been seen). Delete `state.json` to start a source from scratch; the first run of a source
loads recent history without sending a notification.

> Monitoring aid, not legal advice. Always check the official text.
