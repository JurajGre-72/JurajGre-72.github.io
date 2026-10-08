'use strict';
// The company's SOP for using SOP Archív – kept in the app (Settings → Help), saved as Word, and offered
// as a draft for the archive so it goes through the company's own review and approval like any SOP.
// Company-specific details are left as [DOPLNIŤ: …] (highlighted in Word).

const DOC = {
  type: 'SOP',
  typeLabel: 'Štandardný operačný postup',
  code: 'SOP-SA-01',
  title: 'Používanie aplikácie SOP Archív na riadenie dokumentácie',
  version: '1',
  department: 'Kvalita (QA)'
};

const SECTIONS = [
  {
    heading: '1. Účel',
    text: `Postup určuje, ako spoločnosť používa aplikáciu SOP Archív na riadenie dokumentácie systému kvality – štandardných operačných postupov (SOP), štandardných pracovných postupov (ŠPP), organizačných smerníc (OS) a ďalších riadených dokumentov – a na súvisiace činnosti: schvaľovanie, školenia, riadené kópie, revízie, sledovanie legislatívy, posudzovanie oznamov ŠÚKL a ÚŠKVBL a vedenie auditného záznamu.
Cieľom je, aby bol v každej chvíli k dispozícii platný dokument, aby bolo zrejmé, kto čo a kedy urobil, a aby záznamy zodpovedali požiadavkám správnej veľkodistribučnej praxe (SDP).`
  },
  {
    heading: '2. Rozsah platnosti',
    text: `Postup platí pre všetkých zamestnancov, ktorí v aplikácii pracujú s riadenou dokumentáciou (správcov, editorov a čitateľov), a pre zamestnancov IT, ktorí zabezpečujú priečinok archívu a počítače.
Platí pre aplikáciu SOP Archív vo verzii 1.x nainštalovanú na počítačoch spoločnosti s archívom v priečinku [DOPLNIŤ: cesta k priečinku archívu na firemnom sieťovom disku].`
  },
  {
    heading: '3. Pojmy a skratky',
    text: `- Archív – priečinok, v ktorom aplikácia ukladá dokumenty, ich verzie a všetky záznamy; je zašifrovaný (AES-256).
- Riadený dokument – dokument systému kvality vedený v archíve (SOP, ŠPP, OS a pod.) so stavom, verziou a históriou.
- Stav dokumentu – návrh, platný, na revízii, neplatný.
- Riadená kópia – očíslovaná kópia vydaná z aplikácie (tlač alebo PDF s pečiatkou „Riadená kópia č.“), evidovaná a pri novej verzii stiahnutá.
- Neriadená kópia – akákoľvek iná vytlačená alebo uložená kópia; platí len v deň tlače.
- Auditný záznam – záznam každej akcie v aplikácii s menom používateľa, počítačom a časom; nedá sa upraviť ani zmazať.
- Kód na obnovenie – kód vytvorený pri založení archívu, ktorým správca obnoví prístup, ak sú zabudnuté všetky heslá.
- Čitateľ, Editor, Správca – roly používateľov v aplikácii (pozri kap. 4).
- ŠÚKL – Štátny ústav pre kontrolu liečiv; ÚŠKVBL – Ústav štátnej kontroly veterinárnych biopreparátov a liečiv.
- SDP – správna veľkodistribučná prax; AI asistent – voliteľný jazykový model, ktorý beží len v počítači spoločnosti.`
  },
  {
    heading: '4. Zodpovednosti',
    text: `- Správca aplikácie ([DOPLNIŤ: meno, funkcia]) – zakladá a ruší používateľov, nastavuje profil spoločnosti a nastavenia, uschováva kód na obnovenie, vyprázdňuje kôš, vytvára čitateľný export pre audit; rola „Správca“.
- Odborný zástupca / manažér kvality ([DOPLNIŤ: meno]) – schvaľuje dokumenty, posudzuje zmeny legislatívy a rozhoduje „neplatí pre nás / platí náš dokument“, posudzuje oznamy o stiahnutí liekov; rola „Správca“ alebo „Editor“.
- Editor (autori dokumentov, vedúci úsekov) – importuje dokumenty, vedie ich údaje a verzie, zaznamenáva revízie a školenia, vydáva riadené kópie; rola „Editor“.
- Zamestnanci – čítajú platné dokumenty a potvrdzujú „prečítal som a rozumiem“ vlastným heslom; rola „Čitateľ“.
- IT ([DOPLNIŤ: meno / dodávateľ]) – zabezpečuje sieťový priečinok archívu, práva na zápis, pravidelné zálohovanie priečinka a obnovu zo zálohy, aktualizácie a ochranu počítačov.`
  },
  {
    heading: '5. Postup',
    text: `5.1 Zavedenie aplikácie a prvé spustenie
- Aplikácia sa inštaluje len z inštalačného súboru schváleného správcom. Pred použitím na riadenie dokumentácie sa vykoná validácia podľa validačného plánu (kap. 5.16).
- Archív sa ukladá do priečinka na firemnom sieťovom disku, nie do priečinka synchronizovaného s cloudom (OneDrive, Dropbox, Google Drive, iCloud); aplikácia na takýto priečinok upozorní.
- Pri prvom spustení správca vytvorí svoj profil. Aplikácia zobrazí kód na obnovenie – správca ho vytlačí a uloží na bezpečné miesto ([DOPLNIŤ: napr. trezor konateľa]); kód sa nikomu neposiela e-mailom.
- Správca vyplní profil spoločnosti (Nastavenia → Profil spoločnosti): činnosti, ktoré spoločnosť vykonáva a nevykonáva, špecifiká spoločnosti a sledované výrobky a výrobcov.

5.2 Používatelia, heslá a elektronický podpis
- Každý zamestnanec má vlastný profil. Profily ani heslá sa nesmú zdieľať.
- Roly: Čitateľ (číta a vyhľadáva), Editor (mení dokumenty a záznamy), Správca (navyše používatelia, nastavenia, export, kôš).
- Heslo nastavené správcom si používateľ pri prvom prihlásení zmení na vlastné (aplikácia to vyžaduje). Heslo má aspoň 8 znakov.
- Heslo slúži zároveň ako elektronický podpis pri schvaľovaní dokumentov a pri potvrdení „prečítal som a rozumiem“. Podpis sa ukladá s menom, rolou, dátumom a časom.
- Po nečinnosti sa používateľ automaticky odhlási ([DOPLNIŤ: počet minút], Nastavenia → Archív). Po piatich nesprávnych pokusoch sa prihlásenie na chvíľu zablokuje.
- Pri odchode zamestnanca správca jeho profil deaktivuje (nemaže sa – jeho záznamy zostávajú).

5.3 Evidencia dokumentov
- Dokument sa do archívu vkladá funkciou „Importovať“. Aplikácia navrhne kód, názov, verziu a dátumy; editor ich pred uložením skontroluje a opraví.
- Kód dokumentu sa prideľuje podľa číslovania spoločnosti ([DOPLNIŤ: odkaz na postup číslovania]).
- Zmenený dokument sa ukladá ako nová verzia (funkcia „Nahrať novú verziu“); predchádzajúce verzie zostávajú v archíve ako nahradené. Pôvodný súbor v archíve sa nikdy nemení.
- Pri otvorení dokumentu sa otvára kópia len na čítanie; zmeny sa do archívu prinášajú novou verziou.

5.4 Tvorba nového dokumentu a návrhy zmien s AI
- Nový dokument sa môže vytvoriť funkciou „Nový dokument“ (šablóna, osnova, súvisiace predpisy). Uloží sa ako návrh.
- AI asistent (ak ho správca zapol) beží len v počítači spoločnosti alebo na jej serveri; dokumenty neposiela na internet.
- Text navrhnutý AI je vždy iba návrh. Autor ho musí overiť vecne aj jazykovo, doplniť všetky miesta označené [DOPLNIŤ] a overiť citované ustanovenia v plnom znení predpisu. Za obsah zodpovedá autor a schvaľovateľ.
- Dokumenty spoločnosti opisujú, ako spoločnosť skutočne pracuje, a majú prednosť pred doslovným znením predpisu; prísnejší postup spoločnosti je prípustný.

5.5 Schvaľovanie
- Novú verziu editor odošle na schválenie určeným osobám v poradí (preskúmanie, schválenie).
- Každý podpisuje vlastným heslom. Zamietnutie musí obsahovať dôvod.
- Po poslednom schválení je verzia platná. Kto a kedy podpísal, je pri dokumente aj v auditnom zázname.
- Dokumenty schválené pred zavedením aplikácie na papieri sa evidujú s menom schvaľovateľa; originál s podpismi sa uchováva podľa [DOPLNIŤ: miesto uloženia].

5.6 Školenia
- Pri každom dokumente editor určí, kto ho musí poznať (všetci alebo vybrané úseky).
- Školenie sa zaznamená v aplikácii (dátum, spôsob, školiteľ). Pri čítaní dokumentu zamestnanec potvrdí „prečítal som a rozumiem“ vlastným heslom.
- Nová verzia dokumentu vyžaduje nové zaškolenie; pri drobnej oprave, ktorá nemení postup, sa to dá pri nahratí verzie vypnúť.
- Prehľad chýbajúcich školení je v časti Školenia; karta školení zamestnanca sa dá vytlačiť.

5.7 Riadené a neriadené kópie
- Ak je na pracovisku potrebná tlačená kópia, editor vydá riadenú kópiu (tlač alebo PDF). Kópia je očíslovaná a zaevidovaná, PDF má na každej strane pečiatku „Riadená kópia č.“.
- Pri novej verzii aplikácia ukáže, ktoré riadené kópie treba stiahnuť; editor ich stiahne a zaznamená to.
- Každá iná vytlačená alebo uložená kópia je neriadená. PDF otvorené alebo uložené z aplikácie má na každej strane „NERIADENÁ KÓPIA – platná len v deň tlače“.

5.8 Revízie dokumentov
- Každý platný dokument má termín revízie (predvolene [DOPLNIŤ: napr. 24] mesiacov). Aplikácia upozorňuje na blížiace sa termíny a termíny po lehote.
- Výsledok revízie (bez zmeny / treba upraviť / upravené) sa zaznamená v aplikácii; ďalší termín sa nastaví automaticky.

5.9 Sledovanie legislatívy
- Aplikácia sleduje predpisy z registra (Slov-Lex, EUR-Lex) [DOPLNIŤ: denne / týždenne] a pri novom alebo pripravovanom znení ukáže zmenené ustanovenia a dokumenty, ktoré ich citujú.
- Odborný zástupca alebo poverená osoba zmenu posúdi pri každom dotknutom dokumente (upraviť / netýka sa / poznámka). Ak sa ustanovenie na spoločnosť nevzťahuje alebo platí zámerne iný postup spoločnosti, zaznamená sa rozhodnutie s dôvodom.
- Analýza aplikácie je pomôcka; o dopade zmeny rozhoduje odborný zástupca.

5.10 Oznamy ŠÚKL a ÚŠKVBL
- Aplikácia načítava verejné oznamy ŠÚKL a ÚŠKVBL (stiahnutia liekov z trhu, bezpečnosť, dostupnosť, legislatíva) každé 4 hodiny počas behu aplikácie.
- Oznam o stiahnutí, ktorý sa týka spoločnosti, posúdi poverená osoba do [DOPLNIŤ: lehota, napr. 24 hodín] a zaznamená výsledok: netýka sa nás / opatrenia vykonané (s popisom) / na vedomie.
- Pri stiahnutí výrobku, ktorý spoločnosť distribuovala, sa postupuje podľa [DOPLNIŤ: kód a názov SOP pre stiahnutie z trhu].

5.11 Odstránenie a zrušenie dokumentov
- Dokument, ktorý sa už použil ako riadený záznam (schválenie, kópie, školenia, revízie, posúdenia), sa nedá odstrániť – ak už neplatí, označí sa ako neplatný a zostáva v archíve.
- Odstrániť sa dá len nepoužitý dokument (napr. omylom importovaný); vyžaduje dôvod a dve potvrdenia a zapíše sa do auditného záznamu.
- Kôš (súbory odstránených dokumentov) môže natrvalo vyprázdniť len správca.

5.12 Auditný záznam, inšpekcia a audit
- Auditný záznam obsahuje každú akciu s menom, počítačom a časom. Na stránke Auditný záznam sa dá filtrovať (obdobie, používateľ, oblasť, dokument, text, len zmeny) a exportovať do PDF a Excelu.
- Aplikácia overuje úplnosť záznamu; ak zobrazí narušenie, správca to bezodkladne oznámi [DOPLNIŤ: komu] a priečinok archívu sa uchová bez zmien.
- Pre inšpekciu sa vytvára Správa o riadenej dokumentácii (Prehľad → Správa pre inšpekciu) a podľa potreby čitateľný export celého archívu (Nastavenia → Archív). Čitateľný export nie je zašifrovaný – ukladá sa len na bezpečné miesto a po použití sa zmaže.

5.13 Zálohovanie a obnova
- Priečinok archívu zálohuje IT podľa [DOPLNIŤ: smernica / postup zálohovania IT], najmenej [DOPLNIŤ: denne], na samostatné a bezpečné miesto. Záloha zostáva zašifrovaná a uchováva sa podľa vnútroštátnych predpisov, najmenej však päť rokov (Usmernenia SDP, kap. 3.3.1).
- Obnova zo zálohy sa overí najmenej raz ročne a výsledok sa zaznamená.

5.14 Práca viacerých používateľov naraz
- S archívom môže súčasne pracovať viac používateľov na viacerých počítačoch. Zmeny kolegov sa zobrazia v priebehu niekoľkých sekúnd; pri dokumente je uvedené, kto ho naposledy zmenil.
- Ak aplikácia oznámi, že dokument medzitým zmenil iný používateľ, nič sa neprepíše: okno sa zatvorí, skontrolujú sa nové údaje a zmena sa urobí znova.

5.15 Bezpečnosť a ochrana údajov
- Archív je zašifrovaný; bez prihlásenia sa nedá čítať ani skopírovaný.
- Aplikácia sa pripája na internet len na stiahnutie verejných textov predpisov a oznamov ŠÚKL a ÚŠKVBL (a jednorazovo na stiahnutie modelu AI). Každé spojenie je v Nastaveniach → Sieťová aktivita.
- Záznamy o školeniach obsahujú osobné údaje zamestnancov; spracúvajú sa podľa [DOPLNIŤ: interný predpis o ochrane osobných údajov].

5.16 Validácia a zmeny aplikácie
- Pred použitím aplikácie na riadenie dokumentácie sa vykoná validácia (požiadavky používateľa, analýza rizík, testy, záverečná správa).
- Nová verzia aplikácie sa pred nasadením posúdi v rámci riadenia zmien; rozsah opätovného testovania určí manažér kvality podľa rizika.
- Novú verziu inštaluje správca v aplikácii (Nastavenia → O aplikácii → Skontrolovať aktualizácie → Stiahnuť a nainštalovať) až po prečítaní časti „Čo je nové“ a posúdení zmeny. Aplikácia pred inštaláciou overí odtlačok (SHA-256) stiahnutého súboru; inštalácia a zmena verzie sa zapíšu do auditného záznamu. Ak archív používa viac počítačov, aktualizujú sa všetky [DOPLNIŤ: v ten istý deň].

5.17 Porucha alebo nedostupnosť aplikácie
- Ak aplikácia alebo archív nie sú dostupné, pracuje sa podľa vydaných riadených kópií. Nedostupnosť dlhšia ako [DOPLNIŤ: napr. 1 pracovný deň] sa zaznamená ako odchýlka a oznámi správcovi a IT.`
  },
  {
    heading: '6. Záznamy',
    text: `- Auditný záznam, záznamy o schválení, školeniach, revíziách, posúdeniach zmien legislatívy a oznamov, register riadených kópií – vedú sa v aplikácii.
- Doba uchovávania: najmenej podľa národných predpisov a najmenej 5 rokov ([DOPLNIŤ: doba podľa interných pravidiel]).
- Správy a exporty pre inšpekciu – uchovávajú sa podľa [DOPLNIŤ].`
  },
  {
    heading: '7. Súvisiace dokumenty a legislatíva',
    text: `- Zákon č. 362/2011 Z. z. o liekoch a zdravotníckych pomôckach v platnom znení.
- Vyhláška MZ SR č. 129/2012 Z. z. o požiadavkách na správnu výrobnú prax a správnu veľkodistribučnú prax.
- Usmernenia z 5. novembra 2013 o správnej distribučnej praxi humánnych liekov (2013/C 343/01), najmä kap. 3.3.1 (počítačové systémy), 3.3.2 (kvalifikácia a validácia), kap. 4 (dokumentácia) a kap. 6.5 (stiahnutie liekov z trhu).
- Nariadenie (EÚ) 2019/6 o veterinárnych liekoch.
- EudraLex, zväzok 4, príloha 11 – Počítačové systémy (primerane).
- Nariadenie (EÚ) 2016/679 (GDPR).
- [DOPLNIŤ: SOP pre stiahnutie z trhu, SOP pre riadenie dokumentácie, SOP pre školenia, smernica IT].`
  },
  {
    heading: '8. Príloha – kontrolný zoznam pri zavedení',
    text: `- Archív je v priečinku na sieťovom disku, nie v cloude; IT zálohuje priečinok.
- Kód na obnovenie je vytlačený a uložený.
- Profil spoločnosti je vyplnený; sledované výrobky a výrobcovia sú zadaní.
- Všetci používatelia majú vlastné profily so správnymi rolami a zmenili si heslo.
- Platné dokumenty sú importované; kódy, verzie, dátumy a stavy sú skontrolované.
- Pri dokumentoch je určené, kto ich musí poznať.
- Validácia je dokončená a schválená.`
  }
];

module.exports = { DOC, SECTIONS };
