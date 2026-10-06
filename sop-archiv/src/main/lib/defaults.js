'use strict';
// Starter content for a new archive. Everything here can be edited in the app.

const SLOVLEX = (year, num) => `https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/${year}/${num}/`;
const EURLEX = (celex) => `https://eur-lex.europa.eu/legal-content/SK/ALL/?uri=CELEX:${celex}`;

// Legislation relevant to wholesale distribution of human and veterinary medicines in Slovakia.
// `aliases` are matched (diacritics-insensitive, * = any letters) against document text.
const DEFAULT_LAWS = [
  { key: 'SK:362/2011', title: 'Zákon č. 362/2011 Z. z. o liekoch a zdravotníckych pomôckach', short: 'Zákon o liekoch', jurisdiction: 'SK', url: SLOVLEX(2011, 362), aliases: ['362/2011', 'zákon* o liekoch', 'o liekoch a zdravotníckych pomôckach'] },
  { key: 'SK:129/2012', title: 'Vyhláška MZ SR č. 129/2012 Z. z. o požiadavkách na správnu výrobnú prax a správnu veľkodistribučnú prax', short: 'Vyhláška o SVP a SVDP', jurisdiction: 'SK', url: SLOVLEX(2012, 129), aliases: ['129/2012'] },
  { key: 'SK:39/2007', title: 'Zákon č. 39/2007 Z. z. o veterinárnej starostlivosti', short: 'Zákon o veterinárnej starostlivosti', jurisdiction: 'SK', url: SLOVLEX(2007, 39), aliases: ['39/2007', 'o veterinárnej starostlivosti'] },
  { key: 'SK:139/1998', title: 'Zákon č. 139/1998 Z. z. o omamných látkach, psychotropných látkach a prípravkoch', short: 'Zákon o omamných a psychotropných látkach', jurisdiction: 'SK', url: SLOVLEX(1998, 139), aliases: ['139/1998', 'o omamných látkach'] },
  { key: 'SK:331/2011', title: 'Zákon č. 331/2011 Z. z. o prekurzoroch drog', short: 'Zákon o prekurzoroch drog', jurisdiction: 'SK', url: SLOVLEX(2011, 331), aliases: ['331/2011', 'o prekurzoroch drog'] },
  { key: 'SK:363/2011', title: 'Zákon č. 363/2011 Z. z. o rozsahu a podmienkach úhrady liekov, zdravotníckych pomôcok a dietetických potravín', short: 'Zákon o úhrade liekov', jurisdiction: 'SK', url: SLOVLEX(2011, 363), aliases: ['363/2011'] },
  { key: 'SK:18/2018', title: 'Zákon č. 18/2018 Z. z. o ochrane osobných údajov', short: 'Zákon o ochrane osobných údajov', jurisdiction: 'SK', url: SLOVLEX(2018, 18), aliases: ['18/2018', 'o ochrane osobných údajov'] },
  { key: 'SK:124/2006', title: 'Zákon č. 124/2006 Z. z. o bezpečnosti a ochrane zdravia pri práci', short: 'Zákon o BOZP', jurisdiction: 'SK', url: SLOVLEX(2006, 124), aliases: ['124/2006', 'o bezpečnosti a ochrane zdravia pri práci'] },
  { key: 'SK:395/2002', title: 'Zákon č. 395/2002 Z. z. o archívoch a registratúrach', short: 'Zákon o archívoch a registratúrach', jurisdiction: 'SK', url: SLOVLEX(2002, 395), aliases: ['395/2002', 'o archívoch a registratúrach'] },
  { key: 'SK:79/2015', title: 'Zákon č. 79/2015 Z. z. o odpadoch', short: 'Zákon o odpadoch', jurisdiction: 'SK', url: SLOVLEX(2015, 79), aliases: ['79/2015', 'zákon* o odpadoch'] },
  { key: 'EU:32001L0083', title: 'Smernica 2001/83/ES, ktorou sa ustanovuje zákonník Spoločenstva o humánnych liekoch', short: 'Smernica 2001/83/ES', jurisdiction: 'EU', url: EURLEX('32001L0083'), aliases: ['2001/83'] },
  { key: 'EU:32019R0006', title: 'Nariadenie (EÚ) 2019/6 o veterinárnych liekoch', short: 'Nariadenie o veterinárnych liekoch', jurisdiction: 'EU', url: EURLEX('32019R0006'), aliases: ['2019/6'] },
  { key: 'EU:52013XC1123(01)', title: 'Usmernenia z 5. novembra 2013 o správnej distribučnej praxi humánnych liekov (2013/C 343/01)', short: 'Usmernenia SDP (GDP)', jurisdiction: 'EU', url: EURLEX('52013XC1123(01)'), aliases: ['2013/C 343/01', 'distribučnej praxi humánnych liekov', 'good distribution practice of medicinal products for human use'] },
  { key: 'EU:32021R1248', title: 'Vykonávacie nariadenie Komisie (EÚ) 2021/1248 o správnej distribučnej praxi veterinárnych liekov', short: 'SDP veterinárnych liekov', jurisdiction: 'EU', url: EURLEX('32021R1248'), aliases: ['2021/1248'] },
  { key: 'EU:32016R0161', title: 'Delegované nariadenie Komisie (EÚ) 2016/161 – ochranné prvky na obaloch humánnych liekov', short: 'Ochranné prvky (FMD)', jurisdiction: 'EU', url: EURLEX('32016R0161'), aliases: ['2016/161', 'ochrann* prvk*'] },
  { key: 'EU:32017R0745', title: 'Nariadenie (EÚ) 2017/745 o zdravotníckych pomôckach (MDR)', short: 'MDR', jurisdiction: 'EU', url: EURLEX('32017R0745'), aliases: ['2017/745'] },
  { key: 'EU:32004R0273', title: 'Nariadenie (ES) č. 273/2004 o prekurzoroch drog', short: 'Nariadenie o prekurzoroch drog', jurisdiction: 'EU', url: EURLEX('32004R0273'), aliases: ['273/2004'] },
  { key: 'EU:32016R0679', title: 'Nariadenie (EÚ) 2016/679 – všeobecné nariadenie o ochrane údajov (GDPR)', short: 'GDPR', jurisdiction: 'EU', url: EURLEX('32016R0679'), aliases: ['2016/679', 'GDPR'] }
];

const DOC_TYPES = [
  { id: 'SOP', sk: 'Štandardný operačný postup (SOP)', en: 'Standard operating procedure (SOP)', interval: 24 },
  { id: 'OS', sk: 'Organizačná smernica (OS)', en: 'Organizational directive (OS)', interval: 24 },
  { id: 'ŠPP', sk: 'Štandardný pracovný postup (ŠPP)', en: 'Standard working procedure (ŠPP)', interval: 24 },
  { id: 'SM', sk: 'Smernica (SM)', en: 'Directive (SM)', interval: 24 },
  { id: 'ME', sk: 'Metodika (ME)', en: 'Methodology (ME)', interval: 24 },
  { id: 'ID', sk: 'Interný dokument (ID)', en: 'Internal document (ID)', interval: 24 },
  { id: 'PP', sk: 'Pracovný postup', en: 'Work instruction', interval: 24 },
  { id: 'MP', sk: 'Metodický pokyn', en: 'Guideline', interval: 24 },
  { id: 'F', sk: 'Formulár / záznam', en: 'Form / record', interval: 36 },
  { id: 'PLAN', sk: 'Plán / program', en: 'Plan / programme', interval: 12 },
  { id: 'CONTRACT', sk: 'Zmluva / dohoda o kvalite', en: 'Contract / quality agreement', interval: 24 },
  { id: 'CERT', sk: 'Povolenie / certifikát', en: 'Licence / certificate', interval: 12 },
  { id: 'OTHER', sk: 'Iný dokument', en: 'Other document', interval: 24 }
];

const DEPARTMENTS = {
  sk: ['Vedenie spoločnosti', 'Kvalita (QA)', 'Sklad', 'Doprava a logistika', 'Nákup', 'Predaj', 'Registrácia / regulačné záležitosti', 'Veterinárny sortiment', 'Ekonomika', 'IT', 'Personalistika'],
  en: ['Management', 'Quality (QA)', 'Warehouse', 'Transport & logistics', 'Purchasing', 'Sales', 'Regulatory affairs', 'Veterinary products', 'Finance', 'IT', 'HR']
};

function defaultArchive(lang = 'sk') {
  return {
    schema: 1,
    createdAt: new Date().toISOString(),
    org: '',
    docs: [],
    laws: [],
    changes: [],
    settings: {
      warnDays: 60,
      reminderDaysIcs: 14,
      docTypes: DOC_TYPES.map((t) => ({ ...t })),
      departments: (DEPARTMENTS[lang] || DEPARTMENTS.sk).slice(),
      legisAutoCheck: 'weekly', // off | startup | daily | weekly
      autoLockMinutes: 30, // sign out after inactivity (0 = never)
      legisLastAutoCheck: null
    }
  };
}

module.exports = { DEFAULT_LAWS, DOC_TYPES, DEPARTMENTS, defaultArchive };
