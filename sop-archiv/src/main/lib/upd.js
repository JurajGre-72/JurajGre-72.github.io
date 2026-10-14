'use strict';
// The EU veterinary medicines database (Union Product Database, medicines.health.europa.eu/veterinary).
// The site does not allow automated searching, so the app reads only the page of each product the company
// watches (its address is entered in Settings → Company) and compares it with the last reading: status of
// the authorisation, the countries where it is authorised and available, and the dates of the product
// information (SPC, package leaflet, labelling). Pure functions: text in, data out – tested without network.

const { fold, textOf } = require('./notices');

const HOST = 'https://medicines.health.europa.eu';
const MAX_PRODUCTS = 200;

/** The product numbers in what the user entered: addresses of product pages, or the bare numbers. */
function updIds(text) {
  const out = [];
  for (const raw of String(text || '').split(/[\r\n;,\s]+/)) {
    const m = raw.match(/medicines\.health\.europa\.eu\/veterinary\/(?:[a-z]{2}\/)?(\d{6,15})(?:[/?#]|$)/i) || raw.match(/^(\d{9,15})$/);
    if (m && !out.includes(m[1])) out.push(m[1]);
    if (out.length >= MAX_PRODUCTS) break;
  }
  return out;
}

/** The product's page (Slovak labels; names and documents stay in the language they were published in). */
function updUrl(id, base = null) {
  return `${base || HOST}/veterinary/sk/${id}`;
}

/** The part of the page holding one field, e.g. "auth-status". */
function fieldHtml(html, name) {
  const i = html.indexOf(`products__extra-field-upd-products-${name} `);
  if (i < 0) return '';
  const next = html.indexOf('class="field products__', i + 40);
  return html.slice(i, next > 0 ? next : i + 20000);
}

const dmy = (s) => {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

/** Two-letter country codes of a field (from the flag shown next to each country). */
const countries = (part) => [...new Set([...part.matchAll(/flag-icon-([a-z]{2})\b/g)].map((m) => m[1].toUpperCase()))].sort();

/**
 * What the page says about the product, or null when it does not look like a product page (changed layout).
 * → { name, status, statusLabel, authStatus, authStatusDate, authNumber, holder, authorisedIn, availableIn, docs: { title: date } }
 */
function parseProduct(html) {
  const s = String(html || '');
  const titleM = s.match(/products__extra-field-upd-products-product-title-with-fallback[\s\S]*?<div class="field__item">([\s\S]*?)<\/div>/);
  const name = textOf(titleM ? titleM[1] : (fieldHtml(s, 'medicine-name').match(/<div class="field__item">([\s\S]*?)<\/div>/) || [])[1]);
  if (!name) return null;
  const statusM = s.match(/class="product-status product-status--([a-z_-]+)[^"]*"[\s\S]*?<div class="field__item">([\s\S]*?)<\/div>/);
  const firstItem = (part) => {
    const all = [...part.matchAll(/<div class="field__item">([\s\S]*?)<\/div>/g)].map((m) => textOf(m[1])).filter(Boolean);
    return all.length ? all[all.length - 1] : '';
  };
  const li = (part) => textOf((part.match(/<li>([\s\S]*?)<\/li>/) || [])[1]);
  const docs = {};
  const docPart = s.slice(Math.max(0, s.search(/>\s*(Dokumenty|Documents)\s*</)));
  // Each document: its title in bold, then the language versions, each "Publikované na: 17/06/2026".
  for (const m of docPart.matchAll(/<(?:div|span|h\d)[^>]*class="fw-bold"[^>]*>([^<]{3,200})<([\s\S]*?)(?=<(?:div|span|h\d)[^>]*class="fw-bold"[^>]*>[^<]{3,200}<|$)/g)) {
    const dates = [...m[2].matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})/g)].map((d) => dmy(d[1])).filter(Boolean).sort();
    if (dates.length) docs[textOf(m[1])] = dates[dates.length - 1];
  }
  return {
    name,
    status: statusM ? statusM[1] : '',
    statusLabel: statusM ? textOf(statusM[2]) : '',
    authStatus: firstItem(fieldHtml(s, 'auth-status')),
    authStatusDate: dmy(textOf(fieldHtml(s, 'auth-status-change'))),
    authNumber: li(fieldHtml(s, 'auth-number')),
    holder: li(fieldHtml(s, 'marketing-authorisation-holder')),
    authorisedIn: countries(fieldHtml(s, 'authorised-countries')),
    availableIn: countries(fieldHtml(s, 'available-in-countries')),
    docs
  };
}

const TEXT = {
  sk: {
    status: 'stav lieku: {from} → {to}',
    authStatus: 'stav registrácie: {from} → {to}',
    skAuthorisedOut: 'Slovensko už nie je medzi krajinami registrácie',
    skAuthorisedIn: 'registrovaný aj na Slovensku',
    skAvailableOut: 'na Slovensku už nie je uvedený ako dostupný',
    skAvailableIn: 'uvedený ako dostupný na Slovensku',
    doc: 'nová verzia: {doc} ({date})',
    docNew: 'zverejnený dokument: {doc} ({date})',
    holder: 'držiteľ registrácie: {from} → {to}',
    gone: 'liek sa v databáze už nenachádza',
    title: 'EÚ databáza – {name}: {what}'
  },
  en: {
    status: 'product status: {from} → {to}',
    authStatus: 'authorisation status: {from} → {to}',
    skAuthorisedOut: 'Slovakia is no longer among the countries of authorisation',
    skAuthorisedIn: 'now also authorised in Slovakia',
    skAvailableOut: 'no longer listed as available in Slovakia',
    skAvailableIn: 'listed as available in Slovakia',
    doc: 'new version: {doc} ({date})',
    docNew: 'document published: {doc} ({date})',
    holder: 'marketing authorisation holder: {from} → {to}',
    gone: 'the product is no longer in the database',
    title: 'EU database – {name}: {what}'
  }
};
const skDay = (iso) => iso.split('-').reverse().map(Number).join('. ');
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined || v[k] === '' ? '–' : v[k]));

/** What changed between two readings of a product (empty when nothing that matters did). */
function changes(prev, cur, lang = 'sk') {
  const T = TEXT[lang] || TEXT.sk;
  if (!prev || prev.gone) return [];
  if (cur.gone) return [T.gone];
  const out = [];
  if (prev.status !== cur.status && (prev.status || cur.status)) out.push(fill(T.status, { from: prev.statusLabel || prev.status, to: cur.statusLabel || cur.status }));
  if (fold(prev.authStatus) !== fold(cur.authStatus)) out.push(fill(T.authStatus, { from: prev.authStatus, to: cur.authStatus }));
  const had = (list) => (list || []).includes('SK');
  if (had(prev.authorisedIn) !== had(cur.authorisedIn)) out.push(had(cur.authorisedIn) ? T.skAuthorisedIn : T.skAuthorisedOut);
  if (had(prev.availableIn) !== had(cur.availableIn)) out.push(had(cur.availableIn) ? T.skAvailableIn : T.skAvailableOut);
  if (prev.holder && cur.holder && fold(prev.holder) !== fold(cur.holder)) out.push(fill(T.holder, { from: prev.holder, to: cur.holder }));
  for (const [doc, date] of Object.entries(cur.docs || {})) {
    const before = (prev.docs || {})[doc];
    if (!before) out.push(fill(T.docNew, { doc, date: skDay(date) }));
    else if (date > before) out.push(fill(T.doc, { doc, date: skDay(date) }));
  }
  return out;
}

/**
 * The readings of this check against the kept ones → { items (notices), snapshots (to keep), failed }.
 * readings: [{ id, product } | { id, gone: true } | { id, error }]. A product read for the first time is
 * only remembered (its changes are reported from the next reading on).
 */
function compare(kept, readings, { lang = 'sk', today, base = null } = {}) {
  const T = TEXT[lang] || TEXT.sk;
  const snapshots = {};
  const items = [];
  let failed = 0;
  for (const r of readings) {
    const prev = kept[r.id];
    if (r.error) {
      failed++;
      if (prev) snapshots[r.id] = prev;
      continue;
    }
    const cur = r.gone ? { ...(prev || {}), gone: true, checkedAt: today } : { ...r.product, checkedAt: today };
    snapshots[r.id] = cur;
    const what = changes(prev, cur, lang);
    if (!what.length) continue;
    const name = cur.name || (prev && prev.name) || r.id;
    items.push({
      title: fill(T.title, { name, what: what[0] }),
      summary: what.length > 1 ? what.join('; ') : '', // one change is the title itself
      link: updUrl(r.id, base),
      date: today,
      category: 'availability',
      product: name,
      key: `upd|${r.id}|${today}|${what.join('|')}`
    });
  }
  return { items, snapshots, failed };
}

module.exports = { updIds, updUrl, parseProduct, changes, compare, MAX_PRODUCTS };
