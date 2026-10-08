'use strict';
// Content of the validation documents for SOP Archív (drafts for the company's QA: review, complete the
// [DOPLNIŤ] places, execute the tests, sign). Built into Word by build.js with the app's own Word writer.

const URS = [
  ['URS-01', 'Evidencia riadených dokumentov (SOP, ŠPP, OS…) s kódom, názvom, verziou, stavom (návrh / platný / na revízii / neplatný), dátumami a históriou verzií; pôvodný súbor sa v archíve nemení.', 'kritická', 'SDP 4.1, 4.2'],
  ['URS-02', 'Prístup len pre oprávnené osoby: vlastný profil s heslom pre každého, roly Čitateľ / Editor / Správca, automatické odhlásenie po nečinnosti, blokovanie pri opakovanom nesprávnom hesle, heslo od správcu zmenené pri prvom prihlásení.', 'kritická', 'SDP 3.3.1'],
  ['URS-03', 'Elektronický podpis pri schvaľovaní verzie a pri potvrdení „prečítal som a rozumiem“ – vlastným heslom; záznam obsahuje meno, rolu (význam podpisu), dátum a čas.', 'kritická', 'SDP 4.2; EudraLex zv. 4 príl. 11 kap. 14'],
  ['URS-04', 'Auditný záznam každej akcie (kto, kedy, čo, na ktorom počítači), ktorý sa v aplikácii nedá upraviť ani zmazať, s kontrolou úplnosti, filtrovaním a exportom.', 'kritická', 'SDP 4.2; príl. 11 kap. 9'],
  ['URS-05', 'Ochrana údajov: archív zašifrovaný, dokumenty sa neposielajú na internet, upozornenie na priečinok synchronizovaný s cloudom, záznam sieťovej aktivity.', 'vysoká', 'SDP 3.3.1; GDPR'],
  ['URS-06', 'Schvaľovanie novej verzie určenými osobami v poradí; zamietnutie len s dôvodom; verzia platí až po poslednom schválení.', 'kritická', 'SDP 4.2'],
  ['URS-07', 'Riadené kópie: číslovanie, pečiatka na každej strane PDF, evidencia, zoznam kópií na stiahnutie pri novej verzii; ostatné PDF kópie označené ako neriadené s dátumom.', 'vysoká', 'SDP 4.2'],
  ['URS-08', 'Školenia: určenie, kto musí dokument poznať, záznam školenia viazaný na verziu, potvrdenie heslom, prehľad chýbajúcich školení.', 'vysoká', 'SDP 2.4'],
  ['URS-09', 'Revízie dokumentov: termíny, upozornenia, záznam výsledku a posun ďalšieho termínu.', 'stredná', 'SDP 4.2'],
  ['URS-10', 'Sledovanie predpisov SR a EÚ: nové a pripravované znenia, zmenené ustanovenia, dotknuté dokumenty, posúdenie a rozhodnutia spoločnosti s dôvodom.', 'vysoká', 'SDP 1.2'],
  ['URS-11', 'Oznamy ŠÚKL a ÚŠKVBL: načítanie, roztriedenie, zvýraznenie sledovaných výrobkov, posúdenie oznamov o stiahnutí s popisom opatrení.', 'vysoká', 'SDP 6.5'],
  ['URS-12', 'Riadený záznam sa nedá odstrániť (len označiť ako neplatný); odstránenie nepoužitého dokumentu len s dôvodom a dvojitým potvrdením.', 'kritická', 'SDP 4.2'],
  ['URS-13', 'Súčasná práca viacerých používateľov bez straty zmien; zobrazenie, kto dokument naposledy zmenil; zastaraná úprava sa neprepíše.', 'vysoká', 'SDP 3.3.1'],
  ['URS-14', 'Správa pre inšpekciu (PDF, Excel) a čitateľný export celého archívu s odtlačkami súborov.', 'vysoká', 'SDP 4.2'],
  ['URS-15', 'Obnova: kód na obnovenie prístupu; obnova poškodeného súboru archívu z predchádzajúceho uloženia; zálohovanie priečinka (IT).', 'kritická', 'SDP 3.3.1'],
  ['URS-16', 'Vyhľadávanie v obsahu dokumentov (slovenčina, diakritika), čítanie naskenovaných PDF (OCR).', 'stredná', '—'],
  ['URS-17', 'AI asistent (voliteľný) len v počítači spoločnosti, bez prístupu na sieť; jeho výstup je len návrh, ktorý overí autor.', 'vysoká', 'SDP 3.3.1'],
  ['URS-18', 'Postup pri poruche alebo nedostupnosti aplikácie (riadené kópie, záznam odchýlky).', 'vysoká', 'SDP 3.3.1 (posledný odsek)'],
  ['URS-19', 'Nová verzia programu sa inštaluje len overená (odtlačok SHA-256 zverejnenej verzie), len správcom, so zápisom do auditného záznamu; údaje archívu zostanú nezmenené.', 'vysoká', 'SDP 3.3.1, 3.3.2 (riadenie zmien)']
];

// [id, what can go wrong, impact, P, D, risk, in the app, procedure, tests]
const RISKS = [
  ['URS-01', 'Používa sa neplatná verzia alebo sa stratí história.', 'Postup v rozpore s platným dokumentom.', 'nízka', 'vysoká', 'stredné', 'Stavy, história verzií, pôvodný súbor sa nemení; otvorenie len na čítanie.', 'SOP-SA-01 kap. 5.3', 'OQ-01, OQ-02'],
  ['URS-02', 'Neoprávnená osoba zmení alebo podpíše dokument.', 'Neplatný záznam, strata dôvery v systém.', 'nízka', 'stredná', 'vysoké', 'Profily, roly kontrolované jadrom, odhlásenie, blokovanie, zmena hesla pri prvom prihlásení.', 'Nezdieľať heslá; deaktivácia pri odchode.', 'OQ-03, OQ-04'],
  ['URS-03', 'Podpis bez vedomia osoby alebo bez významu.', 'Neplatné schválenie / školenie.', 'nízka', 'stredná', 'vysoké', 'Podpis len vlastným heslom; meno, rola, čas uložené; nesprávne heslo zaznamenané.', 'Heslo ako podpis – školenie používateľov.', 'OQ-05, OQ-08'],
  ['URS-04', 'Zmena alebo zmazanie záznamu bez stopy.', 'Nepreukázateľnosť činností pri inšpekcii.', 'nízka', 'vysoká', 'stredné', 'Šifrované riadky len pridávané, súbor na počítač, reťaz odtlačkov – kontrola úplnosti.', 'Pri narušení oznámiť, uchovať priečinok.', 'OQ-06'],
  ['URS-05', 'Únik dokumentov mimo spoločnosť.', 'Porušenie dôvernosti, GDPR.', 'nízka', 'stredná', 'vysoké', 'AES-256, rozhranie bez internetu, záznam sieťovej aktivity, varovanie pred cloudom.', 'Archív len na firemnom disku.', 'OQ-07'],
  ['URS-06', 'Platná verzia bez schválenia.', 'Neschválený postup v praxi.', 'nízka', 'vysoká', 'stredné', 'Platnosť až po poslednom podpise; zamietnutie s dôvodom.', 'SOP-SA-01 kap. 5.5', 'OQ-08'],
  ['URS-07', 'Na pracovisku zostane stará tlačená verzia.', 'Postup podľa neplatnej verzie.', 'stredná', 'stredná', 'stredné', 'Evidencia kópií, zoznam na stiahnutie, pečiatky „riadená / neriadená kópia“.', 'Stiahnuť kópie pri novej verzii.', 'OQ-09'],
  ['URS-08', 'Zamestnanec nie je zaškolený na platnú verziu.', 'Chyba pri práci s liekmi.', 'stredná', 'vysoká', 'stredné', 'Školenie viazané na verziu, prehľad chýbajúcich, potvrdenie heslom.', 'SOP-SA-01 kap. 5.6', 'OQ-10'],
  ['URS-09', 'Prekročený termín revízie.', 'Zastaraný dokument.', 'stredná', 'vysoká', 'nízke', 'Upozornenia, prehľad revízií.', '—', 'OQ-11'],
  ['URS-10', 'Prehliadnutá zmena predpisu.', 'Nesúlad s legislatívou.', 'stredná', 'stredná', 'stredné', 'Automatická kontrola, zmenené ustanovenia, dotknuté dokumenty.', 'Posúdenie odborným zástupcom; aplikácia je pomôcka.', 'OQ-12'],
  ['URS-11', 'Neposúdený oznam o stiahnutí lieku.', 'Distribúcia stiahnutého lieku.', 'nízka', 'vysoká', 'vysoké', 'Kontrola každé 4 h, zvýraznenie, počítadlo na posúdenie, upozornenie.', 'Lehota na posúdenie; SOP pre stiahnutie.', 'OQ-13'],
  ['URS-12', 'Zmazanie riadeného dokumentu.', 'Strata záznamu.', 'nízka', 'vysoká', 'stredné', 'Blokovanie odstránenia, dôvod, dve potvrdenia, kôš.', '—', 'OQ-14'],
  ['URS-13', 'Strata zmeny pri súčasnej práci.', 'Chýbajúci alebo prepísaný záznam.', 'stredná', 'stredná', 'stredné', 'Krátke transakcie so zámkom, načítanie zmien, kontrola konfliktu.', '—', 'OQ-15'],
  ['URS-14', 'Neúplné podklady pre inšpekciu.', 'Zistenie pri inšpekcii.', 'nízka', 'vysoká', 'nízke', 'Správa a export z jedného miesta, odtlačky súborov.', '—', 'OQ-16, OQ-17'],
  ['URS-15', 'Strata údajov (disk, chyba).', 'Strata dokumentácie.', 'nízka', 'vysoká', 'vysoké', 'Predchádzajúce uloženie a denné kópie súboru archívu; kód na obnovenie.', 'Zálohovanie priečinka IT; ročný test obnovy.', 'OQ-18, IQ-05'],
  ['URS-16', 'Dokument sa nenájde.', 'Zdržanie.', 'stredná', 'vysoká', 'nízke', 'Fulltext so slovenčinou, OCR.', '—', 'OQ-19'],
  ['URS-17', 'AI vymyslí alebo zmení obsah; únik cez AI.', 'Nesprávny postup v dokumente.', 'stredná', 'stredná', 'stredné', 'AI len lokálne bez siete (overené); výstup len návrh so zvýraznenými zmenami; [DOPLNIŤ] miesta.', 'Overenie autorom a schvaľovateľom.', 'OQ-20'],
  ['URS-18', 'Aplikácia nedostupná.', 'Nemožnosť pracovať s dokumentmi.', 'nízka', 'vysoká', 'stredné', '—', 'Riadené kópie; záznam odchýlky.', 'PQ-05'],
  ['URS-19', 'Nainštaluje sa podvrhnutá alebo poškodená verzia; neodsúhlasená zmena programu.', 'Nesprávne fungovanie systému, únik údajov.', 'nízka', 'vysoká', 'stredné', 'Len zverejnené verzie; odtlačok SHA-256 overený pred inštaláciou; len správca; zápis do auditného záznamu; archív sa nemení.', 'SOP-SA-01 kap. 5.16 – posúdenie zmeny pred inštaláciou.', 'OQ-21']
];

// [id, test, steps, expected, automated evidence]
const OQ = [
  ['OQ-01', 'Import a údaje dokumentu', 'Importovať PDF, Word a OpenDocument; skontrolovať navrhnutý kód, názov, verziu, dátumy; uložiť.', 'Dokumenty sú v zozname so správnymi údajmi a stavom.', 'E2E: import 6 súborov; „import table“'],
  ['OQ-02', 'Nová verzia, história', 'Nahrať novú verziu dokumentu; otvoriť dokument.', 'Stará verzia je nahradená, nie zmenená; otvorí sa kópia len na čítanie.', 'E2E: „Nová verzia“ v histórii'],
  ['OQ-03', 'Roly a oprávnenia', 'Prihlásiť sa ako Čitateľ; skúsiť zmeniť údaje dokumentu (aj priamo cez jadro).', 'Zmena je odmietnutá.', 'E2E: „reader cannot change anything (UI and core)“'],
  ['OQ-04', 'Heslá a prihlásenie', 'Nesprávne heslo 5×; nový používateľ s heslom od správcu; prihlásiť sa.', 'Zablokovanie na chvíľu, zaznamenané; pri prvom prihlásení vynútená zmena hesla, rovnaké heslo odmietnuté.', 'E2E: „wrong password rejected and audited“; vynútená zmena hesla'],
  ['OQ-05', 'Potvrdenie „prečítal som“', 'Zamestnanec potvrdí dokument nesprávnym a potom správnym heslom.', 'Nesprávne heslo odmietnuté; záznam s menom a časom.', 'E2E: „reading confirmed with the own password“'],
  ['OQ-06', 'Auditný záznam', 'Vykonať zmeny; otvoriť Auditný záznam; filtrovať podľa dokumentu a „len zmeny“; exportovať PDF a Excel; overiť úplnosť.', 'Záznamy s menom, počítačom, časom; export obsahuje filter; úplnosť overená.', 'E2E: „audit trail: filtered…, exported…“; test reťaze (unit)'],
  ['OQ-07', 'Šifrovanie a sieť', 'Skontrolovať súbory archívu bez aplikácie; skúsiť z rozhrania otvoriť internetovú stránku; pozrieť Sieťovú aktivitu.', 'Obsah nečitateľný; rozhranie bez internetu; zoznam len povolených spojení.', 'E2E: „archive folder encrypted“, „UI cannot reach the internet“'],
  ['OQ-08', 'Schvaľovanie', 'Odoslať verziu na schválenie; podpísať nesprávnym a správnym heslom; zamietnuť bez dôvodu.', 'Nesprávne heslo odmietnuté; platná po podpise; zamietnutie bez dôvodu nemožné.', 'E2E: „approval signed with the own password“'],
  ['OQ-09', 'Riadené a neriadené kópie', 'Vydať riadenú kópiu PDF; uložiť kópiu dokumentu; nahrať novú verziu.', 'PDF s pečiatkou „Riadená kópia č.“; uložená kópia „NERIADENÁ KÓPIA“; kópia na stiahnutie.', 'E2E: „controlled copy stamped…; other copies marked uncontrolled“'],
  ['OQ-10', 'Školenia', 'Určiť, kto musí dokument poznať; zaznamenať školenie; nahrať novú verziu.', 'Prehľad zaškolených; nová verzia vyžaduje nové školenie.', 'E2E: „training: … recorded“; unit training'],
  ['OQ-11', 'Revízie', 'Zaznamenať revíziu.', 'Ďalší termín posunutý podľa intervalu.', 'E2E: „review recorded, next review date moved“'],
  ['OQ-12', 'Legislatíva', 'Spustiť kontrolu predpisu s novým znením; posúdiť dotknutý dokument; zaznamenať rozhodnutie s dôvodom.', 'Zmenené ustanovenia a dotknuté dokumenty; rozhodnutie s dôvodom.', 'E2E: „monitor: upcoming version, § diff…“, „company precedence…“'],
  ['OQ-13', 'Oznamy ŠÚKL / ÚŠKVBL', 'Načítať oznamy; posúdiť oznam o stiahnutí „opatrenia vykonané“ bez a s popisom.', 'Bez popisu odmietnuté; posúdenie s menom a časom; sledovaný výrobok zvýraznený.', 'E2E: „notices: … recall assessed…“'],
  ['OQ-14', 'Odstránenie', 'Skúsiť odstrániť dokument so záznamami; odstrániť nepoužitý dokument; vyprázdniť kôš.', 'Dokument so záznamami sa nedá odstrániť; inak dôvod a dve potvrdenia; zaznamenané.', 'E2E: „delete a document…, empty the trash“'],
  ['OQ-15', 'Viac počítačov naraz', 'Na dvoch počítačoch súčasne meniť ten istý dokument; upraviť údaje zo zastaraného stavu.', 'Obe zmeny zachované; zastaraná úprava odmietnutá s menom; „Naposledy zmenil(a)“.', 'E2E: „two computers change it at the same time…“'],
  ['OQ-16', 'Správa pre inšpekciu', 'Vytvoriť správu PDF a Excel za obdobie.', 'Správa obsahuje register, revízie, legislatívu, rozhodnutia, školenia, schválenia, kópie, oznamy.', 'E2E: „inspection report: PDF … and Excel“'],
  ['OQ-17', 'Čitateľný export', 'Vytvoriť čitateľný export; otvoriť súbory bez aplikácie; overiť odtlačok SHA-256 jedného súboru.', 'Všetky súbory, register s odtlačkami, správa a auditný záznam.', 'E2E: „readable export…“; unit export'],
  ['OQ-18', 'Obnova', 'Obnoviť heslo správcu kódom na obnovenie (nesprávny a správny kód).', 'Nesprávny kód odmietnutý; správny nastaví nové heslo.', 'E2E: „recovery code…“; unit „damaged archive.json is restored“'],
  ['OQ-19', 'Vyhľadávanie a OCR', 'Hľadať slovo bez diakritiky; importovať naskenované PDF.', 'Nájdené aj tvary slov; text skenu sa dá vyhľadať.', 'E2E: vyhľadávanie; „scanned PDF: text recognised…“'],
  ['OQ-20', 'AI asistent', 'Zapnúť vstavanú AI; Test v Nastaveniach; navrhnúť kapitolu a úpravu odseku.', 'Proces AI bez siete (overené); návrh so zvýraznenými zmenami; nič sa nezmení bez uloženia autorom.', 'E2E: „built-in AI: … no network in the AI process“, „rewrite with AI“'],
  ['OQ-21', 'Aktualizácia programu', 'Ako správca: Nastavenia → O aplikácii → Skontrolovať aktualizácie → Stiahnuť a nainštalovať; po reštarte skontrolovať verziu a auditný záznam.', 'Nová verzia nainštalovaná; zmenený súbor by bol odmietnutý; dokumenty a profily nezmenené; inštalácia a zmena verzie v auditnom zázname.', 'E2E: „one-click update … altered file refused“; CI: aktualizácia na Macu a Windows']
];

const IQ = [
  ['IQ-01', 'Inštalačný súbor', 'Zaznamenať verziu aplikácie, názov a SHA-256 inštalačného súboru.', 'Verzia a odtlačok zhodné s uvoľnenou verziou.'],
  ['IQ-02', 'Inštalácia na počítače', 'Nainštalovať na každý počítač; zaznamenať názov počítača a verziu (Nastavenia → O aplikácii).', 'Aplikácia sa spustí, verzia zhodná.'],
  ['IQ-03', 'Priečinok archívu', 'Overiť umiestnenie na firemnom sieťovom disku, nie v cloude; práva na zápis pre používateľov.', 'Aplikácia neupozorňuje na cloud; všetci určení používatelia môžu pracovať.'],
  ['IQ-04', 'Prvé spustenie', 'Vytvoriť profil správcu; vytlačiť a uložiť kód na obnovenie; vyplniť profil spoločnosti.', 'Kód uložený na určenom mieste; profil vyplnený.'],
  ['IQ-05', 'Zálohovanie priečinka', 'IT nastaví zálohovanie priečinka archívu; vykonať skúšobnú obnovu do iného priečinka a otvoriť ju.', 'Obnovený archív sa otvorí heslom; dokumenty sú čitateľné.'],
  ['IQ-06', 'Čas počítačov', 'Overiť, že počítače majú synchronizovaný čas (doména / NTP).', 'Rozdiel času do 1 minúty.']
];

const PQ = [
  ['PQ-01', 'Import skutočných dokumentov', 'Importovať kópie platných SOP, ŠPP a OS; skontrolovať kódy, verzie, dátumy.', 'Údaje zodpovedajú dokumentom (opravy zaznamenať).'],
  ['PQ-02', 'Naskenované dokumenty', 'Importovať naskenované dokumenty; po OCR vyhľadať v nich výraz.', 'Text sa nájde.'],
  ['PQ-03', 'Citované predpisy', 'Skontrolovať register predpisov a citácie v dokumentoch.', 'Citované predpisy sú sledované.'],
  ['PQ-04', 'Bežná prevádzka 2 týždne', 'Pracovať s aplikáciou 2 týždne (schválenie, školenie, revízie) viacerými používateľmi.', 'Bez straty údajov; problémy zaznamenané.'],
  ['PQ-05', 'Postup pri poruche', 'Simulovať nedostupnosť sieťového disku.', 'Postupuje sa podľa SOP-SA-01 kap. 5.17.']
];

const sign = `Vypracoval: [DOPLNIŤ meno] · Dátum: ______ · Podpis: ______
Preskúmal: [DOPLNIŤ meno] · Dátum: ______ · Podpis: ______
Schválil (odborný zástupca): [DOPLNIŤ meno] · Dátum: ______ · Podpis: ______`;

const table = (cols, widths, rows) => ({ columns: cols, widths, rows });

const DOCS = [
  {
    file: 'VAL-01 Validačný plán a požiadavky používateľa.docx',
    doc: { type: 'VAL', typeLabel: 'Validačný plán', code: 'VAL-SA-01', title: 'Validačný plán a požiadavky používateľa – aplikácia SOP Archív', version: '1', department: 'Kvalita (QA)' },
    sections: [
      { heading: '1. Účel a rozsah', text: 'Plán určuje, ako spoločnosť overí, že aplikácia SOP Archív spoľahlivo plní požiadavky na riadenie dokumentácie podľa SDP (Usmernenia 2013/C 343/01, kap. 3.3.1 a 3.3.2) pred zavedením do prevádzky.\nRozsah: aplikácia SOP Archív verzia [DOPLNIŤ: verzia], počítače [DOPLNIŤ: zoznam], priečinok archívu [DOPLNIŤ: cesta].' },
      { heading: '2. Opis systému', text: '- Aplikácia pre počítače (Windows), bez servera a cloudu; archív je zašifrovaný priečinok na firemnom sieťovom disku, s ktorým môže pracovať viac počítačov naraz.\n- Funkcie: riadené dokumenty a verzie, schvaľovanie s elektronickým podpisom heslom, školenia, riadené kópie, revízie, sledovanie legislatívy, oznamy ŠÚKL a ÚŠKVBL, auditný záznam, správy a export, voliteľný lokálny AI asistent.\n- Kategória softvéru: aplikácia vyvinutá na mieru (GAMP 5, kat. 5) – preto sa okrem funkčných testov posudzuje aj vývoj: zdrojový kód je vo verziovanom úložisku a každá verzia prechádza automatickými testami (jednotkové testy a úplný test aplikácie na Windows, macOS a Linux).' },
      { heading: '3. Zodpovednosti', text: '- Manažér kvality / odborný zástupca: schvaľuje plán, hodnotí výsledky, uvoľňuje systém do prevádzky.\n- Správca aplikácie: vykonáva IQ a OQ, vedie záznamy.\n- Kľúčoví používatelia: vykonávajú PQ.\n- IT: inštalácia, priečinok, zálohovanie, čas počítačov.' },
      { heading: '4. Postup validácie', text: '- Požiadavky používateľa (kap. 5) → analýza rizík (VAL-SA-02) → testy IQ, OQ, PQ (VAL-SA-03) → validačná správa (VAL-SA-04).\n- Rozsah testov podľa rizika: požiadavky s vysokým rizikom sa testujú vždy ručne aj automaticky.\n- Odchýlky sa zaznamenajú, posúdia a uzavrú pred uvoľnením.\n- Akceptačné kritérium: všetky testy kritických a vysokých požiadaviek vyhoveli alebo odchýlky sú uzavreté s posúdením.' },
      { heading: '5. Požiadavky používateľa (URS)', text: 'Priorita: kritická – bez splnenia nemožno systém používať; vysoká – nutné do uvoľnenia; stredná – žiaduce.', table: table(['ID', 'Požiadavka', 'Priorita', 'Odkaz'], [900, 5800, 1100, 1838], URS) },
      { heading: '6. Udržiavanie validovaného stavu', text: '- Nová verzia aplikácie: posúdenie zmeny (riadenie zmien), opätovné testy podľa rizika – minimálne OQ testy dotknutých funkcií a automatické testy verzie.\n- Periodické hodnotenie systému raz ročne (auditný záznam, odchýlky, používatelia, obnova zo zálohy).' },
      { heading: '7. Schválenie plánu', text: sign }
    ]
  },
  {
    file: 'VAL-02 Analýza rizík a matica sledovateľnosti.docx',
    doc: { type: 'VAL', typeLabel: 'Analýza rizík', code: 'VAL-SA-02', title: 'Analýza rizík a matica sledovateľnosti – aplikácia SOP Archív', version: '1', department: 'Kvalita (QA)' },
    sections: [
      { heading: '1. Metóda', text: 'Pre každú požiadavku sa posúdi, čo môže zlyhať, aký to má dopad na kvalitu liekov, pacienta alebo súlad so SDP, pravdepodobnosť (P) a odhaliteľnosť (D). Výsledné riziko (nízke / stredné / vysoké) určuje rozsah testov. Uvedené sú opatrenia v aplikácii aj procedurálne opatrenia (SOP-SA-01).' },
      { heading: '2. Analýza rizík', text: '', table: table(['Požiadavka', 'Čo môže zlyhať', 'Dopad', 'P', 'D', 'Riziko', 'Opatrenia v aplikácii', 'Procedurálne opatrenia', 'Testy'], [1050, 1300, 1150, 600, 600, 750, 1600, 1300, 1288], RISKS) },
      { heading: '3. Matica sledovateľnosti', text: 'Každá požiadavka (URS) → riziko → test, ktorým sa preukazuje splnenie (VAL-SA-03).', table: table(['Požiadavka', 'Riziko', 'Testy'], [2000, 2000, 5638], RISKS.map((r) => [r[0], r[5], r[8]])) },
      { heading: '4. Schválenie', text: sign }
    ]
  },
  {
    file: 'VAL-03 Testovací protokol IQ OQ PQ.docx',
    doc: { type: 'VAL', typeLabel: 'Testovací protokol', code: 'VAL-SA-03', title: 'Testovací protokol IQ / OQ / PQ – aplikácia SOP Archív', version: '1', department: 'Kvalita (QA)' },
    sections: [
      { heading: '1. Pokyny', text: '- Test vykoná určená osoba podľa krokov, výsledok zapíše („vyhovel / nevyhovel“), priloží dôkaz (snímka obrazovky, export) a podpíše s dátumom.\n- Nevyhovujúci výsledok = odchýlka: opíše sa v kap. 5 a posúdi.\n- Automatický dôkaz: každá verzia aplikácie prechádza úplným automatickým testom (výpis „All e2e checks passed“ a snímky obrazovky z CI, verzia [DOPLNIŤ]); priložiť výpis k protokolu.' },
      { heading: '2. Kvalifikácia inštalácie (IQ)', text: '', table: table(['ID', 'Test', 'Postup', 'Očakávaný výsledok', 'Výsledok / podpis / dátum'], [700, 1500, 3000, 2600, 1838], IQ.map((r) => [...r, ''])) },
      { heading: '3. Prevádzková kvalifikácia (OQ)', text: '', table: table(['ID', 'Test', 'Postup', 'Očakávaný výsledok', 'Automatický dôkaz', 'Výsledok / podpis / dátum'], [650, 1150, 2400, 2100, 1700, 1638], OQ.map((r) => [...r, ''])) },
      { heading: '4. Kvalifikácia výkonu (PQ)', text: '', table: table(['ID', 'Test', 'Postup', 'Očakávaný výsledok', 'Výsledok / podpis / dátum'], [700, 1500, 3000, 2600, 1838], PQ.map((r) => [...r, ''])) },
      { heading: '5. Odchýlky', text: 'Č. odchýlky · test · opis · posúdenie dopadu · nápravné opatrenie · uzavretie (meno, dátum):\n[DOPLNIŤ]' },
      { heading: '6. Podpisy', text: sign }
    ]
  },
  {
    file: 'VAL-04 Validačná správa.docx',
    doc: { type: 'VAL', typeLabel: 'Validačná správa', code: 'VAL-SA-04', title: 'Validačná správa – aplikácia SOP Archív', version: '1', department: 'Kvalita (QA)' },
    sections: [
      { heading: '1. Súhrn', text: 'Validácia aplikácie SOP Archív verzia [DOPLNIŤ] bola vykonaná podľa plánu VAL-SA-01 v období [DOPLNIŤ].' },
      { heading: '2. Výsledky', text: '- IQ: [DOPLNIŤ: počet testov / vyhoveli]\n- OQ: [DOPLNIŤ]\n- PQ: [DOPLNIŤ]\n- Automatické testy verzie: [DOPLNIŤ: dátum, výsledok]' },
      { heading: '3. Odchýlky', text: '[DOPLNIŤ: zoznam odchýlok a ich uzavretie, alebo „žiadne“]' },
      { heading: '4. Zostatkové riziká a podmienky používania', text: '- Výstup AI asistenta je len návrh; za obsah dokumentov zodpovedá autor a schvaľovateľ.\n- Analýza legislatívy je pomôcka; o dopade rozhoduje odborný zástupca.\n- Zálohovanie priečinka zabezpečuje IT podľa [DOPLNIŤ].\n- [DOPLNIŤ: ďalšie]' },
      { heading: '5. Záver', text: 'Aplikácia SOP Archív [je / nie je] spôsobilá na používanie na riadenie dokumentácie podľa SOP-SA-01. Uvoľnená do prevádzky dňa [DOPLNIŤ].' },
      { heading: '6. Schválenie', text: sign }
    ]
  }
];

module.exports = { DOCS, URS, RISKS, OQ, IQ, PQ };
