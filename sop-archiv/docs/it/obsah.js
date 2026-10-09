'use strict';
// The information sheet for IT: installing SOP Archív on a terminal server (Citrix Virtual Apps and
// Desktops) or on company computers for all users. Built into Word by docs/it/build.js.

const REPO = 'https://github.com/JurajGre-72/JurajGre-72.github.io/releases';

const table = (columns, widths, rows) => ({ columns, widths, rows });

const DOC = {
  file: 'IT-01 Inštalácia SOP Archív – Citrix a terminálový server.docx',
  doc: { type: 'ID', typeLabel: 'Informácia pre IT', code: 'IT-SA-01', title: 'Inštalácia aplikácie SOP Archív v Citrixe a na terminálovom serveri', version: '1', department: 'IT', effectiveDate: 'dňom vydania' },
  sections: [
    {
      heading: '1. Čo je SOP Archív',
      text: `SOP Archív je desktopová aplikácia spoločnosti na riadenie dokumentácie systému kvality veľkodistribúcie liekov (SOP, ŠPP, OS): verzie, schvaľovanie, školenia, riadené kópie, revízie, sledovanie legislatívy a oznamov úradov, auditný záznam.
- Nemá serverovú časť, databázu ani službu; nepočúva na žiadnom sieťovom porte a neposiela telemetriu.
- Všetky údaje sú v jednom priečinku (archív) na firemnom sieťovom disku; aplikácia ho šifruje (AES-256-GCM). Viac používateľov pracuje s tým istým archívom naraz (zámok súboru a transakcie v aplikácii).
- Technológia: Electron 44 (Chromium), Windows x64. Program je verejne dostupný na ${REPO}; neobsahuje žiadne dokumenty spoločnosti.
- Od verzie 1.0.8 podporuje inštaláciu pre všetkých používateľov a nastavenie od IT (kap. 5).`
    },
    {
      heading: '2. Požiadavky',
      text: '',
      table: table(
        ['Položka', 'Požiadavka'],
        [2600, 7038],
        [
          ['Operačný systém', 'Windows Server 2016 / 2019 / 2022 / 2025 (Citrix Virtual Apps and Desktops, RDS) alebo Windows 10 / 11, 64-bit'],
          ['Disk', 'približne 1 GB pre program (Program Files); pre každého používateľa desiatky MB v profile'],
          ['Pamäť', 'približne 300–500 MB RAM na jednu reláciu používateľa (bez vstavaného AI modelu)'],
          ['Grafika', 'GPU nie je potrebná; na serveri bez grafickej karty možno vypnúť hardvérovú akceleráciu (kap. 5, „disableGpu“)'],
          ['Ďalší softvér na serveri', 'Program na otvorenie dokumentov v tej istej relácii: Microsoft Word, Excel a čítačka PDF (dokumenty sa otvárajú v predvolenom programe Windows)'],
          ['Sieťový priečinok archívu', 'Zdieľaný priečinok (UNC cesta, napr. \\\\server\\QA\\SOP-Archiv) dostupný z Citrix servera; používatelia aplikácie potrebujú právo Upraviť (Modify)'],
          ['Internet (voliteľne)', 'Odchádzajúce HTTPS (443) na adresy v kap. 7; bez internetu aplikácia funguje, len nesleduje legislatívu a oznamy']
        ]
      )
    },
    {
      heading: '3. Stiahnutie a overenie',
      text: `- Inštalačný súbor: ${REPO} → najnovšia verzia → SOP-Archiv-<verzia>-Setup.exe (Windows x64).
- Pri každej verzii je súbor SHA256SUMS.txt s odtlačkami. Overenie v PowerShelli:
  Get-FileHash .\\SOP-Archiv-<verzia>-Setup.exe -Algorithm SHA256
  Výsledok sa musí zhodovať s riadkom v SHA256SUMS.txt.
- Program zatiaľ nie je podpísaný komerčným certifikátom (Authenticode). Ak SmartScreen, AppLocker alebo WDAC blokujú inštalátor, povoľte ho podľa odtlačku (hash) alebo ho spustite z účtu správcu; aplikácia nainštalovaná do Program Files je pri predvolených pravidlách AppLockeru povolená.`
    },
    {
      heading: '4. Inštalácia pre všetkých používateľov',
      text: `Spustite ako správca (na Citrix serveri v inštalačnom režime, napr. change user /install, alebo cez nástroj na nasadenie softvéru):
  SOP-Archiv-<verzia>-Setup.exe /S /allusers
- /S – tichá inštalácia bez otázok; /allusers – pre všetkých používateľov do C:\\Program Files\\SOP Archiv.
- Iný priečinok: na koniec príkazu pridajte /D=D:\\Programy\\SOP Archiv (parameter /D musí byť posledný, bez úvodzoviek).
- Spúšťaný program (publikovaná aplikácia v Citrixe): C:\\Program Files\\SOP Archiv\\SOP Archiv.exe, bez parametrov, pracovný priečinok C:\\Program Files\\SOP Archiv. Ikona je v programe.
- Aplikáciu inštalovanú pre všetkých používateľov aktualizuje IT – aplikácia sama nič neinštaluje a v Nastaveniach to používateľom oznámi.
- Nová verzia: ten istý príkaz s novým inštalátorom (prepíše program, údaje a nastavenia zostávajú). Pred nasadením nová verzia prejde riadením zmien oddelenia kvality (SOP-SA-01, kap. 5.16); čo je nové, je na stránke verzie.
- Odinštalovanie:
  "C:\\Program Files\\SOP Archiv\\Uninstall SOP Archiv.exe" /S /allusers
  Odinštalovanie nemaže archív ani nastavenia používateľov.
- Tichá inštalácia aj odinštalovanie pre všetkých používateľov sa pri každej verzii automaticky overujú na Windows (GitHub Actions).`
    },
    {
      heading: '5. Nastavenie od IT pre všetkých používateľov (policy.json)',
      text: `Súbor C:\\ProgramData\\SOP Archiv\\policy.json (vytvorí správca; používatelia ho majú len na čítanie). Príklad:
  {
    "dataDir": "\\\\\\\\server\\\\QA\\\\SOP-Archiv",
    "updates": "it",
    "disableGpu": true
  }
- dataDir – priečinok archívu pre všetkých používateľov; v aplikácii sa potom nedá zmeniť. V JSON sa každé spätné lomítko píše dvakrát (\\\\server\\QA\\SOP-Archiv sa zapíše ako "\\\\\\\\server\\\\QA\\\\SOP-Archiv").
- updates – "it": novú verziu inštaluje IT, aplikácia len vie overiť, či nejaká existuje; "off": aplikácia aktualizácie vôbec nekontroluje (žiadne spojenie na GitHub); "app": aplikácia sa aktualizuje sama (len pri inštalácii pre jedného používateľa).
- disableGpu – true: kreslenie bez grafickej karty (odporúčané na Citrix serveri bez GPU).
- Súbor sa číta pri každom spustení aplikácie. Chybný súbor aplikácia ignoruje a pracuje s predvolenými nastaveniami.`
    },
    {
      heading: '6. Kde sú údaje',
      text: '',
      table: table(
        ['Čo', 'Kde', 'Poznámka pre IT'],
        [2300, 3700, 3638],
        [
          ['Archív (dokumenty, verzie, záznamy, auditný záznam)', 'Sieťový priečinok, napr. \\\\server\\QA\\SOP-Archiv', 'Šifrovaný. Zálohovať denne (SOP-SA-01, kap. 5.13), obnovu overiť raz ročne. Neumiestňovať do OneDrive/SharePoint synchronizácie.'],
          ['Nastavenia používateľa', '%APPDATA%\\SOP Archiv\\settings.json, network.log', 'Zahrnúť do profilu používateľa (Citrix UPM / FSLogix).'],
          ['Vyrovnávacia pamäť prehliadača', '%APPDATA%\\SOP Archiv\\Cache, Code Cache, GPUCache', 'Možno vylúčiť z profilu.'],
          ['Modely vstavaného AI (voliteľné)', '%APPDATA%\\SOP Archiv\\models', 'Niekoľko GB; vylúčiť z profilu. Na Citrix serveri odporúčame vstavaný AI model nezapínať (zaťaženie CPU a RAM).'],
          ['Stiahnuté aktualizácie', '%APPDATA%\\SOP Archiv\\updates', 'Len pri samoaktualizácii; pri inštalácii od IT sa nepoužíva.'],
          ['Otvorené dokumenty (pracovné kópie len na čítanie)', '%TEMP%\\SOP-Archiv-<číslo procesu>', 'Mažú sa pri ukončení aplikácie a pri ďalšom spustení.']
        ]
      )
    },
    {
      heading: '7. Sieťové spojenia (odchádzajúce HTTPS, port 443)',
      text: `Aplikácia používa systémové nastavenie proxy (ako prehliadač Edge). Žiadne dokumenty ani údaje z archívu sa neodosielajú – len sa sťahujú verejné stránky. Každé spojenie je zapísané v aplikácii (Nastavenia → Súkromie a záznamy → Sieťová aktivita).`,
      table: table(
        ['Účel', 'Adresy'],
        [3200, 6438],
        [
          ['Sledovanie legislatívy', 'www.slov-lex.sk, static.slov-lex.sk, eur-lex.europa.eu (a stránky, ktoré používateľ pridá k predpisu)'],
          ['Oznamy úradov', 'www.sukl.sk, www.uskvbl.sk, www.health.gov.sk, sool.sk, www.uskvbl.cz, medicines.health.europa.eu'],
          ['Kontrola aktualizácií (updates "app" alebo "it")', 'api.github.com; pri samoaktualizácii aj github.com, objects.githubusercontent.com, release-assets.githubusercontent.com'],
          ['Stiahnutie AI modelu (voliteľné, len na príkaz správcu aplikácie)', 'huggingface.co, cdn-lfs.huggingface.co, *.hf.co']
        ]
      )
    },
    {
      heading: '8. Citrix – poznámky',
      text: `- Viac používateľov na jednom serveri naraz: áno. Každý má vlastnú reláciu, nastavenia a zámok spustenia; archív na sieťovom disku je spoločný.
- Dokumenty sa otvárajú v predvolenom programe (Word, Excel, čítačka PDF) v tej istej relácii – pri publikovanej aplikácii musia byť tieto programy nainštalované na tom istom serveri (alebo dostupné v relácii).
- Tlač: cez tlačiarne relácie (Citrix Universal Print Driver).
- Dialógy na výber súboru (import dokumentov, sken podpísaného hárku) pracujú s diskami dostupnými v relácii; ak používatelia importujú súbory z vlastného počítača, je potrebné mapovanie klientskych diskov alebo spoločný sieťový priečinok.
- Ak sa okno aplikácie nevykreslí (čierne alebo prázdne), nastavte v policy.json "disableGpu": true.
- Aplikácia sa nedá spustiť v režime ladenia (ochrana Electron Fuses) – parametre ako --inspect sa odmietnu.`
    },
    {
      heading: '9. Bezpečnosť',
      text: `- Archív je šifrovaný (AES-256-GCM); bez prihlásenia sa nedá čítať ani skopírovaný.
- Každý používateľ má vlastný profil a heslo (aspoň 8 znakov); heslo slúži aj ako elektronický podpis. Všetky úkony sú v auditnom zázname s menom, počítačom a časom.
- Používateľské rozhranie aplikácie nemá prístup na internet (všetky webové požiadavky okna sú zablokované); spojenia z kap. 7 robí len hlavný proces a len na uvedené adresy.
- Program: podpis integrity balíka (ASAR integrity), vypnuté ladenie a Node.js režimy (Electron Fuses), okno v sandboxe bez Node.js.`
    },
    {
      heading: '10. Kontrolný zoznam pre IT',
      text: `- Overený odtlačok SHA-256 inštalátora (kap. 3).
- Nainštalované pre všetkých používateľov: SOP-Archiv-<verzia>-Setup.exe /S /allusers (kap. 4).
- Vytvorený sieťový priečinok archívu s právom Upraviť pre používateľov aplikácie; zahrnutý do denného zálohovania.
- Vytvorený C:\\ProgramData\\SOP Archiv\\policy.json s cestou k archívu ("dataDir"), "updates": "it" a podľa potreby "disableGpu": true (kap. 5).
- Publikovaná aplikácia v Citrixe: C:\\Program Files\\SOP Archiv\\SOP Archiv.exe pre skupinu používateľov aplikácie.
- Na serveri dostupný Word, Excel a čítačka PDF; tlačiarne v relácii.
- Povolené odchádzajúce HTTPS na adresy z kap. 7 (alebo vedome nepovolené – aplikácia funguje aj bez internetu).
- Profil používateľa: %APPDATA%\\SOP Archiv zahrnutý, Cache a models vylúčené (kap. 6).
- Správca aplikácie (oddelenie kvality) po nasadení prvý raz otvorí archív a vytvorí používateľov.`
    }
  ]
};

module.exports = { DOC };
