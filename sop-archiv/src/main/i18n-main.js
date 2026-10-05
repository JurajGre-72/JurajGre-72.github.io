'use strict';
// Strings used by the main process (notifications, tray, menus, dialogs).

const STR = {
  sk: {
    'tray.open': 'Otvoriť SOP Archív',
    'tray.reviews': 'Revízie dokumentov',
    'tray.quit': 'Ukončiť',
    'menu.file': 'Súbor',
    'menu.import': 'Importovať dokumenty…',
    'menu.openFolder': 'Otvoriť priečinok archívu',
    'menu.edit': 'Úpravy',
    'menu.view': 'Zobraziť',
    'notify.title': 'SOP Archív – pripomienka',
    'notify.overdue': '{n} dokument(y) po termíne revízie',
    'notify.due': '{n} dokument(y) s revíziou do {days} dní',
    'notify.legis': '{n} zmena(y) legislatívy čaká na posúdenie',
    'notify.allGood': 'Všetky revízie sú v termíne.',
    'notify.legisTitle': 'Zmena legislatívy',
    'notify.legisFound': 'Zistené zmeny v sledovaných predpisoch: {n}. Kliknite pre podrobnosti.',
    'dlg.documents': 'Dokumenty',
    'dlg.allFiles': 'Všetky súbory',
    'dlg.backupTitle': 'Vyberte priečinok pre zálohu (napr. USB disk)',
    'err.targetHasArchive': 'V cieľovom priečinku už existuje archív.',
    'err.noAi': 'AI asistent nie je nastavený (Nastavenia → AI asistent).',
    'err.offline': 'Aplikácia je v režime offline.',
    'err.openArchive': 'Archív sa nepodarilo otvoriť:'
  },
  en: {
    'tray.open': 'Open SOP Archive',
    'tray.reviews': 'Document reviews',
    'tray.quit': 'Quit',
    'menu.file': 'File',
    'menu.import': 'Import documents…',
    'menu.openFolder': 'Open archive folder',
    'menu.edit': 'Edit',
    'menu.view': 'View',
    'notify.title': 'SOP Archive – reminder',
    'notify.overdue': '{n} document(s) past their review date',
    'notify.due': '{n} document(s) due for review within {days} days',
    'notify.legis': '{n} legislation change(s) awaiting assessment',
    'notify.allGood': 'All reviews are on schedule.',
    'notify.legisTitle': 'Legislation change',
    'notify.legisFound': 'Changes detected in monitored legislation: {n}. Click for details.',
    'dlg.documents': 'Documents',
    'dlg.allFiles': 'All files',
    'dlg.backupTitle': 'Choose a folder for the backup (e.g. a USB drive)',
    'err.targetHasArchive': 'The target folder already contains an archive.',
    'err.noAi': 'The AI assistant is not set up (Settings → AI assistant).',
    'err.offline': 'The app is in offline mode.',
    'err.openArchive': 'Could not open the archive:'
  }
};

module.exports = function t(lang, key, vars = {}) {
  const s = (STR[lang] && STR[lang][key]) || STR.en[key] || key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
};
