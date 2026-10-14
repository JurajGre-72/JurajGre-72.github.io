'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const appSop = require('../../src/main/lib/appsop');

const all = (sections) => sections.map((s) => `${s.heading}\n${s.text}`).join('\n\n');

test('the SOP for using the app is complete: nothing left to fill in, responsibilities by function', () => {
  const text = all(appSop.SECTIONS);
  assert.doesNotMatch(text, /\[DOPLN/i, 'no [DOPLNIŤ] places');
  assert.doesNotMatch(text, /\$\{|undefined|null/, 'every value filled');
  assert.match(text, /Po 30 minútach nečinnosti/, 'the default settings without an archive');
  assert.match(text, /automaticky raz týždenne/);
  assert.match(text, /SOP, ŠPP, OS: každých 24 mesiacov/);
  assert.match(text, /postupuje podľa platného postupu spoločnosti pre stiahnutie liekov z trhu/);
  assert.equal(appSop.DOC.effectiveDate, 'dňom schválenia');
});

test('filled in from the archive: its settings and the company’s own procedures', () => {
  const data = {
    settings: { autoLockMinutes: 15, legisAutoCheck: 'daily', docTypes: [{ id: 'SOP', interval: 24 }, { id: 'ŠPP', interval: 24 }, { id: 'OS', interval: 36 }] },
    docs: [
      { code: 'SM Q 05', title: 'Reklamácie, vratky a stiahnutie liekov z trhu', status: 'effective' },
      { code: 'SM Q 05', title: 'Stiahnutie liekov z trhu (stará)', status: 'obsolete' },
      { code: 'SM Q 01', title: 'Riadenie dokumentácie', status: 'effective' },
      { code: 'SM Q 07', title: 'Školenia zamestnancov', status: 'draft' },
      { code: 'SOP-SA-01', title: 'Používanie aplikácie SOP Archív na riadenie dokumentácie', status: 'draft' }
    ]
  };
  const text = all(appSop.sections(appSop.context(data)));
  assert.doesNotMatch(text, /\[DOPLN/i);
  assert.match(text, /Po 15 minútach nečinnosti/);
  assert.match(text, /automaticky raz denne/);
  assert.match(text, /SOP: každých 24 mesiacov, ŠPP: každých 24 mesiacov, OS: každých 36 mesiacov/);
  assert.match(text, /postupuje podľa SM Q 05 Reklamácie, vratky a stiahnutie liekov z trhu;/);
  assert.match(text, /číslovania spoločnosti \(SM Q 01 Riadenie dokumentácie\)/, 'the SOP itself is not its own document-control procedure');
  assert.match(text, /- SM Q 07 Školenia zamestnancov\./);
  assert.match(text, /- Pravidlá spoločnosti na ochranu osobných údajov\./, 'not in the archive: named by what it is');
  const off = all(appSop.sections(appSop.context({ settings: { autoLockMinutes: 0 } })));
  assert.match(off, /automatické odhlásenie je vypnuté/);
  assert.match(all(appSop.sections(appSop.context({ settings: { docTypes: [{ id: 'SOP', interval: 3 }] } }))), /SOP: každé 3 mesiace/);
});
