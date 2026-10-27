# PHARMACOPOLA Regulatory Monitor

Styled in the PHARMACOPOLA brand colours (navy `#003A5B`, teal `#00A78F`) with the company logo from pharmacopola.sk.

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

1. `.github/workflows/pharma-monitor.yml` checks all sources **every hour**. GitHub's own schedule (every 15 minutes
   by day) is best-effort and in practice starts only a few runs a day, so a Claude scheduled task
   ("PHARMACOPOLA monitor – hourly check", which messages the session "PHARMACOPOLA monitor – hourly starter")
   starts the workflow once an hour. It can also be started by hand (**Actions → Regulatory monitor → Run workflow**).
   Every run writes `data/status.json` (when each source was checked); `data/items.json` changes only when
   something new is found.
2. When it finds new relevant items it opens a **GitHub issue** labelled `regulatory-update` with a digest
   (🔴 high / 🟠 medium / ⚪ low). GitHub e-mails new issues to the repository owner. Check that
   *Settings → Notifications → Email* is on and that you are "watching" this repository.
3. **Optional direct e-mail** (for example to a company address or several people): add these repository secrets under
   *Settings → Secrets and variables → Actions*:
   `SMTP_HOST` (e.g. `smtp.gmail.com`), `SMTP_PORT` (`587`), `SMTP_USER`, `SMTP_PASSWORD`
   (for Gmail, an [app password](https://myaccount.google.com/apppasswords)), `MAIL_TO` (comma-separated).

The dashboard shows everything found, with filters, search and "NEW" markers.

### "Check for updates now" button

One click, no sign-in. The button loads the newest results straight away (bypassing the website cache). If a check
of all sources is running at that moment, it waits for it to finish and for the results to be published, then
shows how many new items were found (marked NEW). Otherwise it says when all sources were last checked – never more
than about an hour ago. It also says since when nothing new has been published. "Last check" in the header shows the same time.

**Optional – "Start an extra check"** (link in *How it works*) starts a full check immediately, outside the schedule.
GitHub only allows that with a token, so the first use asks for one:

1. GitHub → *Settings → Developer settings → Fine-grained tokens → Generate new token*
   (direct link: https://github.com/settings/personal-access-tokens/new).
2. *Repository access*: only `JurajGre-72.github.io`. *Permissions → Repository → Actions*: **Read and write**. Nothing else.
3. Paste it into the dialog. It is stored only in that browser (local storage) and sent only to `api.github.com`;
   "Forget the saved token" removes it. With a saved token, the main button also starts an extra check.

Without a token, "Run it on GitHub instead" opens the workflow page, where *Run workflow* does the same.

## Mac app

**To share with a colleague**, send https://jurajgre-72.github.io/pharma-monitor/download/ – a simple page in Slovak and
English (`download/index.html`). **Windows:** an *Install the app* button installs the monitor from Edge or Chrome as an
app (Start menu and desktop icon, own window, no security warnings; `sw.js` is a pass-through service worker that only
makes this possible – nothing is cached). **Mac:** add it to the Dock from Safari (no install) or download the Mac app,
with step-by-step instructions. E-mail services block app files as attachments, so send this link instead.

`macos-app/` is a small native macOS app (Swift, WebKit) that shows the live dashboard in its own window with the
PHARMACOPOLA icon. Download: https://github.com/JurajGre-72/JurajGre-72.github.io/releases/download/monitor-mac-latest/PHARMACOPOLA-Monitor.dmg

- **Easiest install (recommended):** open *Terminal* and paste
  `curl -fsSL https://jurajgre-72.github.io/pharma-monitor/install-mac.sh | bash` – it downloads the app into
  Applications and starts it. Files fetched this way are not blocked by macOS, so no security prompts appear.
- Or open the .dmg and drag **PHARMACOPOLA Monitor** into **Applications**. The app is not notarised by Apple, so macOS
  blocks the first start; *System Settings → Privacy & Security → "Open Anyway"* is needed (on recent macOS this
  sometimes fails – then use the Terminal command above, which also replaces the blocked copy).
- Needs macOS 11 (Big Sur) or newer.
- Dashboard and data changes appear automatically: the app loads the live site fresh at every start, and the dashboard
  loads a newly published version of itself (checked every 10 minutes, when you come back to the app and on
  *Check for updates*). **Check for App Update** (toolbar, ⌘U, also checked quietly once a day) reloads the
  dashboard and installs a newer app build if there is one.
- When you change `index.html`, also change its `<meta name="pm-build">` value so open pages pick up the new version at once.
- To release a new app version: change the app, bump `macos-app/VERSION` (e.g. `1.0.1`), update
  `macos-app/RELEASE_NOTES.md`, merge to `main`. `.github/workflows/macos-app.yml` builds it on a Mac runner,
  runs a smoke test (the app must render the dashboard) and publishes release `monitor-mac-v<version>` (found by the
  update button) and refreshes the download release `monitor-mac-latest`. These tags never become the repository's
  "latest" release, so other projects' releases in this repository are not affected.

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

## Tests

`tests/dashboard.test.mjs` clicks through every control of the dashboard (search, filters, "Show more",
"Mark all read", dark mode, all "what changed" views, and the "Check for updates now" button and the optional extra check with the
GitHub API mocked) and fails on any broken control or browser error. It runs automatically on pull requests
(`.github/workflows/pharma-monitor-check.yml`); a manual run of that workflow also tests the published site.

```bash
npm install --no-save playwright@1.56.1 && npx playwright install chromium
node pharma-monitor/tests/dashboard.test.mjs
```

> Monitoring aid, not legal advice. Always check the official text.
