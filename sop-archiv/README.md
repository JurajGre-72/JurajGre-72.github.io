# SOP Archív

**Offline desktop app for SOPs, organizational directives (OS) and other controlled documents** – search inside documents, review-date reminders, and monitoring of Slovak and EU legislation with a §-level comparison of what changed and which of your documents are affected.

*Slovenská verzia nižšie · English version further down.*

---

## Slovensky

### Čo aplikácia robí

| | |
|---|---|
| **Archív** | Import PDF, Word (.docx aj staré .doc), Excel (.xlsx), OpenDocument (.odt/.ods), RTF, TXT, HTML. Súbory sa dajú pretiahnuť myšou alebo importovať celý priečinok. Aplikácia sama rozpozná **kód** (SOP-QA-001, OS 3/2024 …), **názov, verziu, dátum účinnosti, termín revízie, autora a schvaľovateľa**; pred importom ich skontrolujete v tabuľke. Každý dokument má stav (návrh / platný / na revízii / neplatný), úsek, štítky, poznámky a **históriu verzií** – nová verzia staršiu nenahradí, iba ju označí ako nahradenú. |
| **Vyhľadávanie faktov** | Fulltextové vyhľadávanie v obsahu všetkých dokumentov s ohľadom na slovenčinu – na diakritike a tvaroch slov nezáleží („liek“ nájde „liekov“, „teplota“ nájde „teplote“). Výsledky ukazujú stranu, kapitolu a zvýraznený úryvok. Presná fráza v úvodzovkách: `"2 – 8 °C"`. Režim **Opýtať sa** nájde najrelevantnejšie miesta k otázke (a s AI asistentom na ne aj odpovie s citáciou zdroja). |
| **Revízie** | Prehľad dokumentov po termíne, s blížiacou sa revíziou (predvolene 60 dní vopred) a plán na 12 mesiacov. **Systémové upozornenia** pri spustení a každú hodinu; voliteľne sa aplikácia spúšťa s počítačom a beží na pozadí. Zaznamenanie revízie (dátum, kto, výsledok, poznámka) automaticky posunie ďalší termín podľa intervalu. **Export do kalendára (.ics)** pre Outlook / Google Kalendár s pripomienkou. |
| **Legislatíva** | Register sledovaných predpisov – predvyplnený pre veľkodistribúciu humánnych a veterinárnych liekov (zákon č. 362/2011 Z. z., vyhláška č. 129/2012 Z. z., zákony č. 39/2007, 139/1998, 331/2011, 363/2011, 18/2018, 124/2006, 395/2002, 79/2015 Z. z.; smernica 2001/83/ES, nariadenia (EÚ) 2019/6, 2021/1248, 2016/161, 2017/745, 2016/679, (ES) 273/2004 a usmernenia SDP 2013/C 343/01). Dá sa ľubovoľne upraviť a doplniť aj o iné stránky (napr. oznamy ŠÚKL / ÚŠKVBL). |
| **Kontrola dokumentov voči predpisu** | Predpis prinesiete sami – **stiahnutý súbor** (PDF, Word, HTML zo Slov-Lex / EUR-Lex), **webovú adresu** alebo len **názov či číslo** („zákon o liekoch“, „362/2011“, „nariadenie 2019/6“). Aplikácia sama rozpozná, o ktorý predpis a ktoré znenie ide, a skontroluje všetky SOP a OS: **ktoré ho citujú**, či **citovaný § ešte existuje**, či sa **zmenil**, či **sedia lehoty, doby uchovávania a teploty** (napr. SOP „5 rokov“ × zákon „desať rokov“, aj keď je číslo v zákone napísané slovom) a ktoré dokumenty s ním **obsahovo súvisia**, hoci ho necitujú. Pri každom dokumente je **porovnanie vedľa seba** – miesto v SOP a aktuálne znenie paragrafu. Po úprave SOP stačí kliknúť **Skontrolovať znova**. |
| **Čo treba zmeniť a prečo** | Pri zmene predpisu aplikácia ukáže **ktoré § / články sa zmenili** (pôvodné vs. nové znenie, slovo po slove), **od kedy** zmena platí a **ktoré vaše dokumenty predpis citujú** – navrchu tie, ktoré citujú priamo zmenený paragraf. Ku každému dokumentu zaznamenáte posúdenie (upravené / netýka sa / poznámka), môžete ho označiť „Na revízii“ a zmenu uzavrieť. Voliteľný **AI asistent** k tomu napíše návrh „čo v SOP zmeniť a prečo“. |
| **Používatelia** | Každý kolega má **vlastný profil s heslom** a rolou: *Čitateľ* (prezerá a vyhľadáva), *Editor* (importuje, upravuje, zaznamenáva revízie, kontroluje legislatívu), *Správca* (navyše používatelia, nastavenia, mazanie). Oprávnenia stráži jadro aplikácie, nielen obrazovka. Po nečinnosti sa používateľ automaticky odhlási. Profily sú uložené v priečinku archívu – heslá iba ako šifrovaný odtlačok (scrypt). |
| **Spoločný archív** | Archív môže ležať na **firemnom sieťovom disku**. Upravovať ho môže v jednej chvíli len jeden počítač; ostatní ho majú otvorený **len na čítanie** a zmeny sa im načítajú automaticky. Keď prvý počítač aplikáciu zavrie, ďalší môže prevziať úpravy (tlačidlo *Skúsiť znova*). Tým sa zabráni prepísaniu práce kolegu. |
| **Audit** | Každé prihlásenie, import, zmena údajov, revízia, kontrola legislatívy a posúdenie dopadu sa zapisuje do auditného záznamu – pod menom prihláseného používateľa (kto, kedy, čo). |

### Súkromie – SOP a OS nikdy neopustia počítač ani firmu

* Aplikácia **nemá server, cloud, účet ani telemetriu**. Beží iba vo vašom počítači; nikto (ani autor) nevidí, čo v nej je.
* Všetky údaje sú v **jednom priečinku** (predvolene `Dokumenty\SOP-Archiv`, alebo priečinok na firemnom disku) ako obyčajné súbory – originály dokumentov, vytiahnutý text, `archive.json` a `audit.log`. Priečinok môžete zálohovať, presunúť alebo otvoriť aj bez aplikácie.
* **Dokumenty sa nikdy neposielajú na internet.** Používateľské rozhranie aplikácie má prístup na internet úplne zablokovaný. Jediné spojenie von je stiahnutie **verejnej stránky predpisu** pri kontrole legislatívy (Slov-Lex, EUR-Lex …) – smerom von ide iba adresa tejto stránky. Každé spojenie je zapísané v *Nastavenia → Súkromie a záznamy → Sieťová aktivita*.
* **Režim offline** (Nastavenia → Legislatíva) zakáže akékoľvek pripojenie; predpisy potom importujete ako stiahnuté súbory.
* AI asistent je **predvolene vypnutý** a smie bežať **iba v tomto počítači alebo na serveri vo vnútornej sieti firmy** (Ollama alebo LM Studio, napr. `ollama pull qwen2.5:7b`). Adresy na internete aplikácia odmietne.

### Inštalácia (Windows)

1. Na GitHube otvorte **Actions → SOP Archiv → posledný úspešný beh → Artifacts** a stiahnite **SOP-Archiv-Windows** (zip). Po vydaní verzie bude súbor aj v sekcii **Releases**.
2. V zipe sú dve možnosti:
   * `SOP-Archiv-1.0.0-Setup.exe` – klasická inštalácia (odporúčané; vytvorí odkaz na ploche a v ponuke Štart),
   * `SOP-Archiv-1.0.0-portable.exe` – bez inštalácie, stačí spustiť (napr. z USB).
3. Inštalátor nie je digitálne podpísaný, preto Windows zobrazí „Systém Windows ochránil váš počítač“ → kliknite **Ďalšie informácie → Spustiť aj tak**.
4. Pri prvom spustení zvoľte jazyk, meno, organizáciu a priečinok archívu.

*macOS:* `SOP-Archiv-Mac` (.dmg) – pri prvom otvorení pravým tlačidlom → **Otvoriť**. *Linux:* AppImage.

### Ako funguje kontrola legislatívy

1. Aplikácia otvorí stránku predpisu v skrytom, izolovanom okne prehliadača (aby fungovali aj stránky, ktoré obsah vykresľujú JavaScriptom, ako nový Slov-Lex).
2. Zo stránky zistí **platné znenie** a **pripravované znenia** (s budúcou účinnosťou) – zo Slov-Lex z odkazov na časové verzie, z EUR-Lex z konsolidovaných znení (CELEX).
3. Uloží si text znení a porovná ich **paragraf po paragrafe** (pri EÚ predpisoch článok po článku). Prečíslovanie poznámok pod čiarou sa ignoruje.
4. Pri prvej kontrole uloží východiskový stav; ak už existuje pripravované znenie, hneď ho nahlási. Pri ďalších kontrolách hlási nové znenia.
5. Dotknuté dokumenty určuje podľa toho, ako predpis citujú (napr. „§ 18 ods. 1 zákona č. 362/2011 Z. z.“, „zákona o liekoch“, „nariadenia (EÚ) 2019/6, článok 99“). Ako sa predpis cituje, sa dá doplniť v registri.

Automatická kontrola: predvolene raz týždenne (dá sa vypnúť alebo zmeniť).

### Obmedzenia – na čo si dať pozor

* **Naskenované PDF bez textovej vrstvy** (sken podpísaného originálu) sa uložia, ale nedá sa v nich vyhľadávať (OCR zatiaľ nie je). Aplikácia ich označí; odporúčame archivovať aj textovú verziu (Word / PDF z Wordu).
* **Kontrola legislatívy závisí od štruktúry stránok Slov-Lex a EUR-Lex.** Logika bola otestovaná na simulovaných stránkach, nie priamo na živých portáloch. Po prvej kontrole skontrolujte v registri, či sa pri predpisoch zobrazilo platné znenie; ak niektorý hlási chybu, otvorte zdroj tlačidlom ↗ a prípadne upravte adresu.
* **Kontrola voči predpisu je pomôcka, nie právny výklad.** Rozdiely v číslach a lehotách hľadá v pasážach, ktoré citujú konkrétny §; ak SOP cituje predpis bez čísla paragrafu, zobrazí sa len ako „cituje predpis“. Obsahovú súvislosť určuje podľa spoločných odborných pojmov.
* Na sieťovom disku môže archív v jednej chvíli **upravovať len jeden počítač** (ostatní len čítajú).
* **GDP / validácia:** ak bude aplikácia slúžiť ako systém riadenia dokumentácie v rámci SDP, pred použitím ju zahrňte do validácie počítačových systémov podľa vášho systému kvality (Usmernenia SDP, kap. 3.5). Má profily s heslami, roly a auditný záznam; nemá kvalifikované elektronické podpisy.
* Výstup AI je vždy iba **návrh** – overte ho v plnom znení predpisu.

---

## English

### What it does

* **Archive** – import PDF, Word (.docx/.doc), Excel, OpenDocument, RTF, TXT, HTML (drag & drop or a whole folder). Code, title, version, effective date, review date, author and approver are recognised automatically and confirmed in an import table. Status, department, tags, notes and full **version history**.
* **Find facts** – Slovak-aware full-text search (diacritics and word endings don't matter), results with page, section and highlighted snippet; exact phrases in quotes; **Ask** mode returns the most relevant passages (and, with the AI assistant, a written answer citing the source).
* **Reviews** – overdue / due-soon / 12-month plan, **desktop notifications** (at start and hourly; optional start-with-computer and background mode), recording a review moves the next date by the interval, **.ics calendar export**.
* **Legislation** – a register pre-filled for Slovak wholesale distribution of human and veterinary medicines (Slov-Lex and EUR-Lex), editable and extendable with any web page. Detects **new and upcoming versions**, shows **which § / articles changed** (word-level diff) and **which documents cite them**, with an assessment workflow (updated / not affected / notes / flag for review / close).
* **Check documents against an act you bring** – a downloaded file (PDF/Word/HTML), a web address, or just a name or number. The act and version are recognised automatically; every SOP/OS is checked: cited § missing or changed, **deadlines, retention periods and temperatures that differ** (also when the act writes numbers as words), and documents related by content that don't cite it. Side-by-side comparison; *Check again* after updating a SOP.
* **User profiles** with passwords and roles (Reader / Editor / Administrator), enforced by the app core; automatic sign-out after inactivity; everything recorded under the user's name.
* **Shared archive** on a company network drive: one computer edits at a time, the others are read-only and refresh automatically.
* **Audit trail** of every action.

### Privacy

No server, no cloud, no account, no telemetry. All data lives in one ordinary folder (on the computer or a company network drive). **Documents are never sent to the internet**: the user interface is blocked from the internet entirely; the only outbound connection is downloading the public page of a legal act during a legislation check. Every connection is listed in *Settings → Privacy*. **Offline mode** blocks all network access. The optional AI assistant may only run on this computer or a server in the internal company network (Ollama, LM Studio) – internet addresses are refused.

### Install

Download **SOP-Archiv-Windows** from *Actions → SOP Archiv → latest run → Artifacts* (or from *Releases* once a version is tagged): `…-Setup.exe` (installer) or `…-portable.exe`. The build is unsigned: on "Windows protected your PC" choose **More info → Run anyway**. macOS (.dmg: right-click → Open) and Linux (AppImage) builds are produced too.

### Limitations

Scanned PDFs without a text layer are stored but not searchable (no OCR yet). Legislation parsing depends on the structure of Slov-Lex / EUR-Lex pages and was tested against simulated pages, not the live portals – check the register after the first run, or import downloaded files. The check against an act is an aid, not a legal interpretation. On a shared drive only one computer edits at a time. If used as a GDP-relevant system, validate it under your QMS (GDP Guidelines ch. 3.5). AI output is a suggestion only.

---

## For developers

```bash
cd sop-archiv
npm install
npm start                 # run the app from source
npm test                  # unit tests (node:test)
xvfb-run -a npm run test:e2e   # end-to-end test of the real Electron app (screenshots in the OS temp folder)
npm run dist:win          # build installers (run on the target OS; CI does this for all three)
```

* `src/main/` – Electron main process: `main.js` (window, sign-in sessions, role checks on every call, archive lock), `archive.js` (storage, documents, users, reviews, legislation changes and checks), `legislation.js` (monitor + page fetcher), `ai.js` (optional local-only providers), `lib/` (pure, unit-tested: text extraction, metadata & citation detection, Slovak search, version parsing & § diff, `compliance.js` + `quantities.js` (checking documents against an act), `lawfile.js` (recognising an imported act), `auth.js`, `lock.js`, reviews/ICS).
* `src/renderer/` – UI (plain ES modules, no build step), served over a private `app://` scheme with a strict Content-Security-Policy; the UI talks to the main process only through the whitelisted bridge in `src/main/preload.js`.
* Test hooks: `SOP_ARCHIV_USERDATA`, `SOP_ARCHIV_DATA`, `SOP_ARCHIV_NO_TIMERS`, `SOP_ARCHIV_EXE` (run the e2e test against a packaged build).
