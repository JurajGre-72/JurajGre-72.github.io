# SOP Archív – čo je nové

Každá zverejnená verzia má tu svoj odsek (zobrazí sa v aplikácii pri aktualizácii a na stránke verzie).

## 1.0.8

- Citrix a terminálový server: inštalácia pre všetkých používateľov (Setup.exe /S /allusers, do Program Files). Takto nainštalovanú aplikáciu aktualizuje IT – aplikácia nič neinštaluje sama a v Nastaveniach to oznámi.
- Nastavenie od IT pre všetkých používateľov (C:\ProgramData\SOP Archiv\policy.json): priečinok archívu (používatelia ho nemôžu zmeniť), aktualizácie („it“ alebo „off“) a vypnutie grafickej akcelerácie pre servery bez grafickej karty.
- Dokument pre IT: docs/it/IT-01 Inštalácia SOP Archív – Citrix a terminálový server.docx (požiadavky, inštalácia, overenie, údaje, sieťové spojenia, kontrolný zoznam).

## 1.0.7

- Pri každej osobe si vyberiete, či podpisuje v aplikácii, alebo ručne. Pri odoslaní na schválenie má každý preskúmavateľ a schvaľovateľ voľbu „v aplikácii / ručne“ a dajú sa pridať aj ľudia bez aplikácie (napr. konateľ).
- Podpisový hárok je pripravený podľa toho: kto podpisuje ručne, je na ňom vypísaný menom (schválenie aj oboznámenie). Po zaznamenaní podpísaného hárku sa ručné podpisy zapíšu do schválenia s dátumom z hárku a po poslednom podpise je verzia platná.
- Podpisy → Spôsob podpisu zamestnancov: pri každom zamestnancovi, ktorý dokument musí poznať, v aplikácii alebo ručne. Kto podpisuje ručne, je na hárku a v aplikácii ho dokument nečaká na prečítanie. Zamestnanci, ktorí musia poznať návrh, sú na hárku vypísaní už pred schválením.

## 1.0.6

- Podpisový hárok: dokument → Schválenie a kópie → Podpisy → Podpisový hárok. Posledná strana dokumentu s elektronickými podpismi z aplikácie (preskúmanie a schválenie heslom, kto potvrdil „prečítal som a rozumiem“) a s riadkami na vlastnoručné podpisy pre ľudí bez aplikácie – na schválenie (vypracoval, preskúmal, schválil) aj na oboznámenie zamestnancov. Zamestnanci, ktorí dokument musia poznať, nepracujú v aplikácii a ešte nepotvrdili oboznámenie, sú na hárku vopred vypísaní.
- Hárok sa dá pridať aj na koniec riadenej kópie PDF; dostane pečiatku „Riadená kópia č.“ ako ostatné strany.
- Zaznamenať podpísaný hárok: kto podpísal, kedy a sken (PDF, JPG, PNG). Zamestnancom sa zapíše oboznámenie s platnou verziou (spôsob „vlastnoručný podpis na hárku“), sken sa uloží k dokumentu zašifrovaný a je aj v čitateľnom exporte pre audítora.

## 1.0.5

- SOP pre používanie aplikácie (Pomoc) je úplná – bez miest „DOPLNIŤ“. Zodpovednosti sú uvedené funkciou (správca, odborný zástupca, IT), lehoty a pravidlá sú doplnené (posúdenie oznamu o stiahnutí do 24 hodín, zálohovanie denne, uchovávanie 5 rokov, uloženie kódu na obnovenie).
- Nastavenia aplikácie (automatické odhlásenie, kontrola legislatívy, lehoty revízií podľa typu dokumentu) a vaše postupy, na ktoré SOP odkazuje (stiahnutie z trhu, riadenie dokumentácie, školenia, IT, osobné údaje), sa doplnia z archívu.
- Návrh SOP-SA-01, ktorý už je v archíve a nikto ho zatiaľ neschvaľuje, dostane po kliknutí na „Pridať do archívu ako návrh“ úplný text ako novú verziu návrhu.

## 1.0.4

- Oznamy úradov majú nové zdroje: MZ SR – nový zoznam kategorizovaných liekov (aj informatívny materiál vopred) a dokumenty ku kategorizácii a cenám; SOOL – oznamy systému overovania liekov; ÚSKVBL ČR – závady v kvalite, stiahnutia šarží a falzifikáty veterinárnych liekov.
- EÚ databáza veterinárnych liekov: v Nastaveniach → Profil spoločnosti zadáte odkazy na lieky, ktoré distribuujete. Aplikácia ich raz denne skontroluje a upozorní na zmenu stavu registrácie, krajín registrácie a dostupnosti (Slovensko) alebo na novú verziu SPC, písomnej informácie či obalu – ako oznam na posúdenie.
- Nová kategória „Kategorizácia a ceny“ a výber podľa úradu; v časti „Odkiaľ oznamy sú“ je stav každého zdroja aj zoznam sledovaných liekov.

## 1.0.3

- Vzhľad (Podľa systému, Svetlý, Tmavý) sa zmení hneď po kliknutí, bez tlačidla Uložiť. Tmavý vzhľad dostanú aj časti okna (horná lišta na Macu, ponuky, rozbaľovacie zoznamy).
- Pri „Podľa systému“ aplikácia ukáže, či je počítač práve vo svetlom alebo tmavom režime, a mení sa spolu s ním.
- Prihlasovacia obrazovka si pamätá naposledy zvolený vzhľad na tomto počítači.
- Jazyk sa tiež prepne hneď po výbere.

## 1.0.2

- Aktualizácia jedným kliknutím: Nastavenia → O aplikácii → Skontrolovať aktualizácie → Stiahnuť a nainštalovať. Aplikácia stiahne novú verziu, pred inštaláciou overí jej odtlačok (SHA-256) a sama sa reštartuje. Dokumenty, profily a nastavenia zostanú. Inštaláciu môže spustiť správca a zapíše sa do auditného záznamu.
- Platný dokument, ktorého revízia je po termíne, je označený oranžovo „Platný – revízia po termíne“ (dokument platí až do novej verzie alebo zrušenia, revízia je však zmeškaná).
- Pri importe sa zaznamená, kto dokument importoval („Naposledy zmenil(a)“).
- Stránka zostane na mieste: po uložení nastavenia (napr. AI) alebo keď prídu zmeny kolegov, už neskočí na začiatok.
- Nastavenia → O aplikácii → História verzií a aktualizácií: čo sa zmenilo v každej verzii a kedy a kto ju nainštaloval (z auditného záznamu).

## 1.0.1

- Mac: archív sa už nezakladá v priečinku Dokumenty, ak ho synchronizuje iCloud (ponúkne sa vlastný priečinok používateľa); upozornenie, ak je archív v synchronizovanom priečinku.
- Ak hlavný súbor archívu chýba (napr. ho presunul iCloud), ďalšia zmena ho zapíše znova; pri prihlásení sa obnoví z poslednej uloženej kópie alebo dennej zálohy.
- Windows: súbory dočasne zablokované iným programom sa pri ukladaní skúšajú znova; neuložená zmena sa vždy oznámi a zapíše do auditného záznamu.
- Jazyk zvolený pri založení archívu platí pre všetkých kolegov na každom počítači.

## 1.0.0

- Prvá pilotná verzia.
