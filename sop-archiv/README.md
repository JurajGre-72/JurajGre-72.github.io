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
| **Spoločný archív** | Archív môže ležať na **firemnom sieťovom disku** a **pracovať s ním môže naraz viac kolegov na viacerých počítačoch**. Každá zmena sa uloží v krátkom kroku (na chvíľu sa zamkne, načítajú sa zmeny ostatných, uloží sa); zmeny kolegov sa na ostatných počítačoch objavia do niekoľkých sekúnd. Pri každom dokumente je **kto ho naposledy zmenil a kedy**, v bočnom paneli **kto ďalší práve pracuje**. Ak dvaja upravujú údaje toho istého dokumentu z rovnakého stavu, druhá zmena sa **neprepíše**, ale aplikácia povie, kto ho medzitým zmenil. |
| **Audit** | Každé prihlásenie, import, otvorenie dokumentu, zmena údajov, revízia, kontrola legislatívy, rozhodnutie „neplatí pre nás“ a použitie AI sa zapisuje do auditného záznamu – pod menom prihláseného používateľa a s názvom počítača (kto, kedy, kde, čo). Každý počítač píše vlastný súbor, každý riadok nesie odtlačok predchádzajúceho – **chýbajúci alebo zmenený riadok aplikácia odhalí**. Stránka **Auditný záznam** má filtre (obdobie, používateľ, oblasť, dokument, text, len zmeny) a export do PDF a Excelu. |
| **Naskenované dokumenty (OCR)** | Naskenované PDF bez textovej vrstvy aplikácia prečíta sama, v tomto počítači (slovenčina + angličtina), na pozadí. Potom sa v nich dá vyhľadávať a kontrolujú sa voči predpisom. |
| **Vaše postupy majú prednosť** | SOP a OS opisujú, ako spoločnosť skutočne pracuje – nemusia opakovať zákon. V **Profile spoločnosti** (Nastavenia) označíte, čo robíte a čo nie (napr. omamné látky, zásielkový predaj, výroba). Pri zmene predpisu môžete ustanovenie označiť **„Na našu spoločnosť sa nevzťahuje“** alebo **„Platí náš dokument“** (zámerne iný, napr. prísnejší postup) – vždy s dôvodom pre inšpekciu. Takéto zistenia sa potom nehlásia; ak sa ustanovenie v novom znení zmení, aplikácia sa opýta znova. |
| **Nový dokument** | Nová SOP / ŠPP / smernica zo šablóny: kód podľa vášho číslovania, popis „ako to u nás funguje“, predpisy k téme (navrhne ich sama), osnova a štýl podľa existujúceho dokumentu. Text napíšete sami alebo ho **navrhne AI kapitolu po kapitole** – z vášho popisu a predpisov; čo nevie (čísla, lehoty, mená), označí žltým **[DOPLNIŤ]**. Uloží sa do archívu ako **návrh vo Worde** s hlavičkou, logom, tabuľkou Vypracoval / Preskúmal / Schválil a číslovaním strán. |
| **Prepísať s AI** | Vyberiete odsek či kapitolu dokumentu a pokyn (zosúladiť s aktuálnym znením predpisu / doplniť, čo predpis vyžaduje / sprehľadniť / vlastný). AI navrhne nové znenie – zobrazí sa **vedľa pôvodného so zvýraznenými zmenami**, s **dôvodmi a odkazmi na §**. Návrhy sa ukladajú k dokumentu (karta *Návrhy zmien*) a dajú sa **exportovať do Wordu** pre toho, kto upravuje originál. Dostupné aj priamo zo správy o zmene predpisu. |
| **Školenia** | Zamestnanci a pri každom dokumente, **kto ho musí poznať** (všetci alebo vybrané úseky). Záznam školenia (dátum, spôsob, školiteľ) platí pre konkrétnu verziu – nová verzia môže vyžadovať preškolenie (pri drobnej oprave nie). Zamestnanec s profilom potvrdí **„prečítal som a rozumiem“ vlastným heslom**. Karta školení zamestnanca na tlač, export do CSV. |
| **Schvaľovanie a riadené kópie** | Nová verzia ide na **preskúmanie a schválenie** určeným kolegom v poradí; každý podpisuje **vlastným heslom**, zamietnutie vyžaduje dôvod, po schválení je verzia platná. **Riadené kópie** (tlač alebo PDF) sú číslované, PDF má na každej strane pečiatku „Riadená kópia č. …“; pri novej verzii aplikácia ukáže, ktoré kópie treba stiahnuť. |
| **Oznamy ŠÚKL a ÚŠKVBL** | Aplikácia každé 4 hodiny (alebo na kliknutie) načíta z verejných stránok **ŠÚKL** (humánne lieky) a **ÚŠKVBL** (veterinárne lieky) **stiahnutia liekov z trhu**, bezpečnostné informácie, dostupnosť a registrácie (prerušenie dodávok, dopredaj, zrušenie registrácie) a novú legislatívu a pokyny. Oznamy o stiahnutí, ktoré sa vás týkajú, čakajú na **posúdenie** – *netýka sa nás* / *opatrenia vykonané* (s popisom) / *na vedomie*; kto a kedy posúdil, je v zázname pre inšpekciu. V Profile spoločnosti si môžete zadať **sledované výrobky a výrobcov** – oznam, v ktorom sa objavia, sa zvýrazní a príde upozornenie. Zoznam sa porovnáva len v počítači. |
| **Správa pre inšpekciu** | Jedným kliknutím (Prehľad → *Správa pre inšpekciu*) **PDF na tlač** (A4 na šírku, číslované strany) alebo **Excel** (každá časť na samostatnom hárku): zoznam riadených dokumentov, revízie po termíne a vykonané, sledované predpisy a ich zmeny, rozhodnutia „neplatí pre nás / platí náš dokument“ s dôvodmi, chýbajúce a vykonané školenia, schvaľovanie s podpismi, riadené kópie a posúdenie oznamov ŠÚKL / ÚŠKVBL o stiahnutí – za zvolené obdobie. |
| **Zabezpečenie** | Celý priečinok archívu je **zašifrovaný (AES-256)** – bez prihlásenia sa nedá prečítať ani skopírovaný. Pri založení dostanete **kód na obnovenie** (vytlačte a uschovajte). Nainštalovaná aplikácia sa nedá spustiť v ladiacom režime ani ovládať z terminálu. |

### Súkromie – SOP a OS nikdy neopustia počítač ani firmu

* Aplikácia **nemá server, cloud, účet ani telemetriu**. Beží iba vo vašom počítači; nikto (ani autor) nevidí, čo v nej je.
* Všetky údaje sú v **jednom priečinku** (predvolene `Dokumenty\SOP-Archiv`, alebo priečinok na firemnom disku) – **zašifrované**; prečítať ich dá len aplikácia po prihlásení. Priečinok môžete zálohovať alebo presunúť.
* Archív **nedávajte do priečinka OneDrive, Dropbox, Google Drive ani iCloud** – súbory by sa (zašifrované) nahrávali do ich cloudu. Aplikácia na to upozorní (pozor: na firemných notebookoch býva aj priečinok *Dokumenty* presunutý do OneDrive).
* **Dokumenty sa nikdy neposielajú na internet.** Používateľské rozhranie aplikácie má prístup na internet úplne zablokovaný. Jediné spojenia von sú stiahnutie **verejnej stránky predpisu** pri kontrole legislatívy (Slov-Lex, EUR-Lex …) a **verejných oznamov ŠÚKL a ÚŠKVBL** – smerom von ide iba adresa stránky. Každé spojenie je zapísané v *Nastavenia → Súkromie a záznamy → Sieťová aktivita*.
* **Režim offline** (Nastavenia → Legislatíva) zakáže akékoľvek pripojenie; predpisy potom importujete ako stiahnuté súbory.
* AI asistent je **predvolene vypnutý**. **Vstavaná AI** beží priamo v aplikácii, v samostatnom procese, ktorý **nemá prístup na internet ani nemôže spúšťať iné programy** (aplikácia to overí a ukáže v Nastaveniach). Internet treba len raz – na stiahnutie súboru modelu (overí sa jeho odtlačok SHA-256); model sa dá nahrať aj z USB kľúča. Alternatívne Ollama / LM Studio v tomto počítači alebo na serveri vo firemnej sieti – adresy na internete aplikácia odmietne.

### Inštalácia (Windows)

1. Na GitHube otvorte **Actions → SOP Archiv → posledný úspešný beh → Artifacts** a stiahnite **SOP-Archiv-Windows** (zip). Po vydaní verzie bude súbor aj v sekcii **Releases**.
2. V zipe sú dve možnosti:
   * `SOP-Archiv-1.0.0-Setup.exe` – klasická inštalácia (odporúčané; vytvorí odkaz na ploche a v ponuke Štart),
   * `SOP-Archiv-1.0.0-portable.exe` – bez inštalácie, stačí spustiť (napr. z USB).
3. Inštalátor nie je digitálne podpísaný, preto Windows zobrazí „Systém Windows ochránil váš počítač“ → kliknite **Ďalšie informácie → Spustiť aj tak**.
4. Pri prvom spustení zvoľte jazyk, meno, organizáciu a priečinok archívu; vytlačte si kód na obnovenie. Zvolený jazyk je jazykom archívu: kolegovia ho uvidia na každom počítači (aj s anglickým Windows), kým si v nastaveniach nezvolia vlastný.
5. Ak chcete AI: *Nastavenia → AI asistent → Vstavaná AI* – stiahnite odporúčaný model (niekoľko GB, raz) alebo vyberte súbor modelu z počítača, a kliknite *Vyskúšať model*.

*macOS:* `SOP-Archiv-Mac` (.dmg) – pri prvom otvorení pravým tlačidlom → **Otvoriť**. *Linux:* AppImage.

### Ako funguje kontrola legislatívy

1. Aplikácia otvorí stránku predpisu v skrytom, izolovanom okne prehliadača (aby fungovali aj stránky, ktoré obsah vykresľujú JavaScriptom, ako nový Slov-Lex).
2. Zo stránky zistí **platné znenie** a **pripravované znenia** (s budúcou účinnosťou) – zo Slov-Lex z odkazov na časové verzie, z EUR-Lex z konsolidovaných znení (CELEX).
3. Uloží si text znení a porovná ich **paragraf po paragrafe** (pri EÚ predpisoch článok po článku). Prečíslovanie poznámok pod čiarou sa ignoruje.
4. Pri prvej kontrole uloží východiskový stav; ak už existuje pripravované znenie, hneď ho nahlási. Pri ďalších kontrolách hlási nové znenia.
5. Dotknuté dokumenty určuje podľa toho, ako predpis citujú (napr. „§ 18 ods. 1 zákona č. 362/2011 Z. z.“, „zákona o liekoch“, „nariadenia (EÚ) 2019/6, článok 99“). Ako sa predpis cituje, sa dá doplniť v registri.

Automatická kontrola: predvolene raz týždenne (dá sa vypnúť alebo zmeniť).

### Obmedzenia – na čo si dať pozor

* **OCR naskenovaných PDF** závisí od kvality skenu; pri zlom skene odporúčame archivovať aj textovú verziu (Word / PDF z Wordu).
* **Kontrola legislatívy závisí od štruktúry stránok Slov-Lex a EUR-Lex** (overené na živých portáloch, ale portály sa môžu zmeniť). Ak niektorý predpis v registri hlási chybu, otvorte zdroj tlačidlom ↗ a prípadne upravte adresu, alebo predpis importujte ako stiahnutý súbor.
* **Kontrola voči predpisu je pomôcka, nie právny výklad.** Rozdiely v číslach a lehotách hľadá v pasážach, ktoré citujú konkrétny §; ak SOP cituje predpis bez čísla paragrafu, zobrazí sa len ako „cituje predpis“. Obsahovú súvislosť určuje podľa spoločných odborných pojmov.
* Na sieťovom disku môže s archívom pracovať naraz viac počítačov; ak dvaja v tej istej chvíli ukladajú, druhý počká niekoľko sekúnd. Údaje toho istého dokumentu z rovnakého stavu neprepíšu – aplikácia ohlási, kto ich medzitým zmenil.
* **GDP / validácia:** ak bude aplikácia slúžiť ako systém riadenia dokumentácie v rámci SDP, pred použitím ju zahrňte do validácie počítačových systémov podľa vášho systému kvality (Usmernenia SDP 2013/C 343/01, kap. 3.3.1 Počítačové systémy). Má profily s heslami, roly a auditný záznam; nemá kvalifikované elektronické podpisy.
* Výstup AI je vždy iba **návrh** – overte ho v plnom znení predpisu. Za obsah dokumentu zodpovedá autor a schvaľovateľ. Kvalita textu závisí od modelu a od toho, ako podrobne opíšete svoj postup; na bežnom notebooku bez grafickej karty trvá napísanie celej SOP aj niekoľko minút.

---

## English

### What it does

* **Archive** – import PDF, Word (.docx/.doc), Excel, OpenDocument, RTF, TXT, HTML (drag & drop or a whole folder). Code, title, version, effective date, review date, author and approver are recognised automatically and confirmed in an import table. Status, department, tags, notes and full **version history**.
* **Find facts** – Slovak-aware full-text search (diacritics and word endings don't matter), results with page, section and highlighted snippet; exact phrases in quotes; **Ask** mode returns the most relevant passages (and, with the AI assistant, a written answer citing the source).
* **Reviews** – overdue / due-soon / 12-month plan, **desktop notifications** (at start and hourly; optional start-with-computer and background mode), recording a review moves the next date by the interval, **.ics calendar export**.
* **Legislation** – a register pre-filled for Slovak wholesale distribution of human and veterinary medicines (Slov-Lex and EUR-Lex), editable and extendable with any web page. Detects **new and upcoming versions**, shows **which § / articles changed** (word-level diff) and **which documents cite them**, with an assessment workflow (updated / not affected / notes / flag for review / close).
* **Check documents against an act you bring** – a downloaded file (PDF/Word/HTML), a web address, or just a name or number. The act and version are recognised automatically; every SOP/OS is checked: cited § missing or changed, **deadlines, retention periods and temperatures that differ** (also when the act writes numbers as words), and documents related by content that don't cite it. Side-by-side comparison; *Check again* after updating a SOP.
* **User profiles** with passwords and roles (Reader / Editor / Administrator), enforced by the app core; automatic sign-out after inactivity; everything recorded under the user's name.
* **Shared archive** on a company network drive: **several colleagues on several computers can work at the same time**. Every change is saved in a short step (lock for a moment, read the others' changes, save); colleagues' changes appear on the other computers within seconds. Each document shows **who changed it last and when**, the sidebar **who else is working**. If two people edit the details of one document from the same state, the second change is **not overwritten**; the app says who changed it meanwhile.
* **Audit trail** of every action (sign-in, import, opening a document, changes, reviews, legislation checks, decisions, use of the AI) with the user and the computer. Each computer writes its own file and every line carries a fingerprint of the previous one, so **a missing or changed line is detected**. The **Audit trail** page filters by period, user, area, document, text and "changes only" and exports to PDF and Excel.
* **Scanned PDFs (OCR)** are read on this computer (Slovak + English), in the background, then searchable and checked like any other document.
* **Your processes take precedence** over the literal text of the law: a **company profile** (what you do and don't do), and per provision **"does not apply to our company"** or **"our document applies"** (deliberately different, e.g. stricter) – always with a reason for inspections. Such findings are no longer reported; if the provision changes in a new version, the app asks again.
* **New document** from a template: next code in your numbering, "how it works in our company", acts suggested for the topic, outline and style from an existing document; write it yourself or let the **AI draft it chapter by chapter** (unknown numbers, deadlines and names are marked **[COMPLETE]**). Saved as a **Word draft** with header, logo, *prepared / reviewed / approved* table and page numbers.
* **Rewrite with AI**: choose a passage and an instruction; the proposed wording is shown **next to the original with changes highlighted**, with **reasons and § references**; proposals are kept with the document and **exported to Word**.
* **Training records**: who must know each document (everyone or selected departments); a training record is valid for a specific version, so a new version may require retraining (a minor correction does not); employees confirm **"read and understood" with their own password**; printable training card, CSV export.
* **Approval and controlled copies**: a new version goes to review and approval in order, each signed with the **signer's own password**; rejection needs a reason; approval makes the version effective. **Controlled copies** (print or PDF) are numbered and the PDF is stamped on every page; after a new version the app lists the copies to withdraw.
* **ŠÚKL and ÚŠKVBL notices**: every 4 hours (or on demand) the app reads from the public pages of **ŠÚKL** (human medicines) and **ÚŠKVBL** (veterinary medicines) **recalls**, safety information, availability and authorisation notices (supply interruptions, sell-off, cancelled authorisations) and new legislation and guidance. Recalls that concern you wait for an **assessment** – *not ours* / *measures taken* (described) / *noted* – recorded with who and when for inspections. **Watched products and manufacturers** in the company profile are highlighted and trigger an alert; the list is compared on this computer only.
* **Inspection report** (Overview → *Inspection report*): a **PDF to print** (A4 landscape, numbered pages) or an **Excel workbook** (one sheet per part) with the document register, reviews overdue and done, acts monitored and their changes, "does not apply / our document applies" decisions with reasons, missing and recorded training, approvals with signatures, controlled copies and the assessment of ŠÚKL / ÚŠKVBL recall notices – for a chosen period.
* **Security**: the whole archive folder is **encrypted (AES-256)**; a **recovery code** is issued at setup; the installed app cannot be started in a debugging mode or controlled from a terminal.

### Privacy

No server, no cloud, no account, no telemetry. All data lives in one ordinary folder (on the computer or a company network drive). **Documents are never sent to the internet**: the user interface is blocked from the internet entirely; the only outbound connections are downloading the public page of a legal act during a legislation check and the public notices of ŠÚKL and ÚŠKVBL. Every connection is listed in *Settings → Privacy*. **Offline mode** blocks all network access. The archive folder is encrypted; the app warns if it is inside a OneDrive / Dropbox / Google Drive / iCloud folder. The optional AI assistant is off by default: the **built-in AI** runs inside the app in a separate process **without any network access or ability to start programs** (verified and shown in Settings); the internet is needed once to download the model file (checked against its SHA-256 fingerprint), or the model can be copied from a USB stick. Alternatively Ollama / LM Studio on this computer or the internal network – internet addresses are refused.

### Install

Download **SOP-Archiv-Windows** from *Actions → SOP Archiv → latest run → Artifacts* (or from *Releases* once a version is tagged): `…-Setup.exe` (installer) or `…-portable.exe`. The build is unsigned: on "Windows protected your PC" choose **More info → Run anyway**. macOS (.dmg: right-click → Open) and Linux (AppImage) builds are produced too.

### Limitations

OCR quality depends on the scan. Legislation parsing depends on the structure of Slov-Lex / EUR-Lex pages (verified on the live portals, but they may change) – check the register, or import downloaded files. AI drafts depend on the model and on how well the process is described; the author and approver remain responsible for the content. The check against an act is an aid, not a legal interpretation. If used as a GDP-relevant system, validate it under your QMS (GDP Guidelines 2013/C 343/01, ch. 3.3.1 Computerised systems). AI output is a suggestion only.

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

* `src/main/` – Electron main process: `main.js` (window, sign-in sessions, role checks on every call, archive lock, debug-switch refusal), `archive.js` (encrypted storage, documents, users, reviews, legislation changes and checks, decisions, proposals), `legislation.js` (monitor + page fetcher), `ocr.js` (local OCR), `ai.js` (local-only providers), `llm/` (built-in AI: `worker.js` runs the model in a utility process with network and process launches disabled, `engine.js`, `download.js`, `models.js`, `builtin.js`), `writing.js` (new document and rewrite handlers), `lib/` (pure, unit-tested: text extraction, metadata & citation detection, file names, Slovak search, version parsing & § diff, `compliance.js` + `quantities.js`, `company.js` (company profile and decisions), `drafting.js` (templates, codes, prompts), `docx.js` (Word writer), `vault.js` (encryption), `cloudsync.js`, `lawfile.js`, `auth.js`, `lock.js`, reviews/ICS).
* `src/renderer/` – UI (plain ES modules, no build step), served over a private `app://` scheme with a strict Content-Security-Policy; the UI talks to the main process only through the whitelisted bridge in `src/main/preload.js`.
* Test hooks: `SOP_ARCHIV_USERDATA`, `SOP_ARCHIV_DATA`, `SOP_ARCHIV_NO_TIMERS`, `SOP_ARCHIV_EXE` (run the e2e test against a packaged build).
