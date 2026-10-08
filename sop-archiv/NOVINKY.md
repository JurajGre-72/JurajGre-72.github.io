# SOP Archív – čo je nové

Každá zverejnená verzia má tu svoj odsek (zobrazí sa v aplikácii pri aktualizácii a na stránke verzie).

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
