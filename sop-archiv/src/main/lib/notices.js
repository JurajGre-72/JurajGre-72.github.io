'use strict';
// Notices of the medicines authorities: ŠÚKL (human medicines), ÚŠKVBL (veterinary medicines), the
// Ministry of Health (categorised medicines and prices), SOOL (the medicines verification system) and the
// Czech ÚSKVBL (veterinary quality defects – many packs are shared CZ/SK). Only their public pages are
// read: recalls and quality defects, safety information, availability, new legislation and guidance.
// The EU veterinary medicines database (UPD) is read only for the products the company watches: the page
// of each one, compared with the last reading. Nothing about the archive is sent anywhere.
//
// The parsers here are pure (text in, items out) so they can be tested without the network.

const crypto = require('crypto');

function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };

function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Plain text of an HTML fragment (one line). */
function textOf(html) {
  return decodeEntities(String(html || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** "Fri, 02 Oct 2026 10:00:00 +0200" → "2026-10-02" (the date as published, without time zone shifts). */
function rssDate(s) {
  const m = String(s || '').match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  const iso = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

const SK_MONTHS = ['januar', 'februar', 'marc', 'april', 'maj', 'jun', 'jul', 'august', 'septemb', 'oktob', 'novemb', 'decemb'];

/** "30. septembra 2026" → "2026-09-30" (the Ministry of Health's lists) */
function skLongDate(s) {
  const m = fold(s).match(/(\d{1,2})\.\s*([a-z]+)\s+(\d{4})/);
  if (!m) return null;
  const mo = SK_MONTHS.findIndex((x) => m[2].startsWith(x)) + 1;
  const d = +m[1];
  return mo && d >= 1 && d <= 31 ? `${m[3]}-${pad(mo)}-${pad(d)}` : null;
}

/** "26.06.2026" / "4. 6. 2024" → "2026-06-26" */
function skDate(s) {
  const m = String(s || '').match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  if (!m) return null;
  const d = +m[1];
  const mo = +m[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${m[3]}-${pad(mo)}-${pad(d)}`;
}

function absUrl(href, base) {
  try {
    return new URL(decodeEntities(href), base).toString();
  } catch (_) {
    return '';
  }
}

/** RSS 2.0 → [{ title, link, date, summary }] */
function parseRss(xml, base) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const tag = (k) => {
      const r = it.match(new RegExp(`<${k}\\b[^>]*>([\\s\\S]*?)</${k}>`, 'i'));
      return r ? r[1] : '';
    };
    const title = textOf(tag('title'));
    const link = absUrl(textOf(tag('link')) || textOf(tag('guid')), base);
    if (!title || !link) continue;
    out.push({ title, link, date: rssDate(tag('pubDate') || tag('dc:date')), summary: textOf(tag('description')).slice(0, 600) });
  }
  return out;
}

/** The main content of a WordPress page (ÚŠKVBL), without menus and footer. */
function entryContent(html) {
  const s = String(html || '');
  const start = s.search(/<div[^>]+class="[^"]*\bentry-content\b[^"]*"/i);
  if (start < 0) return '';
  const end = s.slice(start).search(/<\/article>|<div[^>]+class="[^"]*\b(entry-utility|entry-meta|comments)\b|<!--\s*\.entry-content\s*-->|<div id="comments"|<\/main>/i);
  return end > 0 ? s.slice(start, start + end) : s.slice(start, start + 400000);
}

/**
 * A page where each notice is a date followed by one or more links (ÚŠKVBL "Dôležité oznamy"):
 *   <p>——— 26.06.2026</p> <div class="wp-block-file"><a href="…">Oznámenie o …</a></div>
 * → [{ title, link, date }]
 */
function parseDatedList(html, base) {
  const body = entryContent(html);
  const out = [];
  let date = null;
  // Walk dates and links in document order.
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/gi;
  let m;
  while ((m = re.exec(body))) {
    if (m[3]) {
      date = skDate(m[3]) || date;
      continue;
    }
    const title = textOf(m[2]);
    const link = absUrl(m[1], base);
    if (!title || title.length < 6 || !link || /^mailto:|^tel:|#$/i.test(link)) continue;
    out.push({ title, link, date });
  }
  return out;
}

/** A page with a list of documents (ÚŠKVBL "Nová legislatíva"): every link in the content is an item. */
function parseLinkList(html, base) {
  const body = entryContent(html);
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = textOf(m[2]);
    const link = absUrl(m[1], base);
    if (!title || title.length < 6 || !link || /^mailto:|^tel:/i.test(link) || seen.has(link)) continue;
    seen.add(link);
    out.push({ title, link, date: skDate(title) });
  }
  return out;
}

/**
 * A list of articles with the date they were published (Ministry of Health):
 *   <ul class="page-article-list"><li><a href="…">Zoznam kategorizovaných liekov 1.11.2026 – 30.11.2026</a>&nbsp;(30. septembra 2026)</li>
 * → [{ title, link, date, key }]. The list for a month is first published "for information" and later as
 * the valid one at the same address – each is a notice of its own (key).
 */
function parseArticleList(html, base) {
  const out = [];
  for (const ul of String(html || '').matchAll(/<ul[^>]+class="[^"]*\bpage-article-list\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi)) {
    for (const li of ul[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const a = li[1].match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*)$/i);
      if (!a) continue;
      const title = textOf(a[2]);
      const link = absUrl(a[1], base);
      if (!title || !link) continue;
      out.push({ title, link, date: skLongDate(textOf(a[3])), key: `${link}#${/informativ/.test(fold(title)) ? 'info' : 'final'}` });
    }
  }
  return out;
}

const CATEGORIES = ['recall', 'safety', 'availability', 'prices', 'legislation', 'other'];

/** What a notice is about – from its title and its address on the authority's site. */
function categorize({ title = '', link = '', summary = '' }, fallback = null) {
  const t = fold(`${title} ${summary}`);
  const u = String(link).toLowerCase();
  // Slovak and Czech (ÚSKVBL ČR): recalls, quality defects, falsified medicines, GMP non-compliance.
  if (/oznamy-o-stiahnuti|rapid-alert|stiahnut|zakaz\w* (dodavan|uvadzan|predaj|pouzivan)|pozastaven\w* (dodav|predaj|uvadzan|platnost)|falsovan|falsifik|nedostat\w* v kvalit|chyb\w* v kvalit|kvalitativn\w* chyb|stazen\w* (sarz|z trhu|pripravk|vlp)|padel|zavad\w* v jakost|non-compliance/.test(`${u} ${t}`)) return 'recall';
  if (/bezpecnost-liekov|dhpc|informacie-z-prac|farmakovigil/.test(u) || /\bdhpc\b|\bprac\b|riziko|neziaduc|nezadouc|bezpecnost\w* lieku|minimalizaci\w* riz/.test(t)) return 'safety';
  // Supply and marketing authorisation: interruptions, sell-off after a change, cancelled authorisations.
  if (/dostupnost-liekov|msc-komunik/.test(u) || /prerusen\w* dodav|ukoncen\w* dodav|obnoven\w* dodav|zrusen\w* dodav|nedostupn|vypadok|nedostatok lieku|dopredaj|zrusen\w* registraci|pozastaven\w* registraci|zanik\w* registraci|informace o dostupnost/.test(t)) return 'availability';
  // Conferences, jobs, office hours, press releases.
  if (/podujatia|kariera|tlacove-spravy/.test(u) || /konferenci|seminar|pozvank|pracovn\w* ponuk|podateln|vyrocn\w* sprav/.test(fold(title))) return 'other';
  if (/legislativ|usmernen|guideline|metodick|vyhlask|zakon\w* c\.|nariaden|regulation|novel|smernic|pokyn|vykonavac|delegovan|subezn\w* (dovoz|obchod)/.test(`${u} ${t}`)) return 'legislation';
  return fallback && CATEGORIES.includes(fallback) ? fallback : 'other';
}

/** Who publishes what; `kind`: whether it concerns human or veterinary medicines (company profile). */
const AUTHORITIES = {
  sukl: { short: 'ŠÚKL', kind: 'human' },
  uskvbl: { short: 'ÚŠKVBL', kind: 'vet' },
  mzsr: { short: 'MZ SR', kind: 'human' },
  sool: { short: 'SOOL', kind: 'human' },
  uskvblcz: { short: 'ÚSKVBL ČR', kind: 'vet' },
  upd: { short: 'EÚ UPD', kind: 'vet' }
};

// The pages read. `base` lets the tests point them at a local server.
function sources(base = null) {
  const at = (url) => (base ? url.replace(/^https:\/\/[^/]+/, base) : url);
  return [
    { id: 'sukl-recalls', authority: 'sukl', kind: 'rss', url: at('https://www.sukl.sk/sk/rss?page_id=1355&pid=208&days=365'), page: 'https://www.sukl.sk/pre-odbornikov-a-firmy/dostupnost-a-kvalita-liekov/kvalita-liekov/oznamy-o-stiahnuti-liekov', category: 'recall' },
    { id: 'sukl-news', authority: 'sukl', kind: 'rss', url: at('https://www.sukl.sk/sk/rss?page_id=1355&days=365'), page: 'https://www.sukl.sk/aktuality' },
    { id: 'uskvbl-notices', authority: 'uskvbl', kind: 'dated', url: at('https://www.uskvbl.sk/?page_id=115'), page: 'https://www.uskvbl.sk/?page_id=115', category: 'recall' },
    { id: 'uskvbl-legislation', authority: 'uskvbl', kind: 'links', url: at('https://www.uskvbl.sk/?page_id=4702'), page: 'https://www.uskvbl.sk/?page_id=4702', category: 'legislation' },
    // Every month since 2016 is listed: the last two years are enough.
    { id: 'mzsr-categorized', authority: 'mzsr', kind: 'articles', url: at('https://www.health.gov.sk/?zoznam-kategorizovanych-liekov'), page: 'https://www.health.gov.sk/?zoznam-kategorizovanych-liekov', category: 'prices', limit: 24 },
    { id: 'mzsr-categorization', authority: 'mzsr', kind: 'articles', url: at('https://www.health.gov.sk/?kategorizacia-liekov-1'), page: 'https://www.health.gov.sk/?kategorizacia-liekov', category: 'prices' },
    { id: 'sool-news', authority: 'sool', kind: 'rss', url: at('https://sool.sk/feed/'), page: 'https://sool.sk/aktuality/' },
    { id: 'uskvblcz-alerts', authority: 'uskvblcz', kind: 'rss', url: at('https://www.uskvbl.cz/cs/uskvbl/dulezita-upozorneni?format=feed&type=rss'), page: 'https://www.uskvbl.cz/cs/uskvbl/dulezita-upozorneni' }
  ];
}

const HOSTS = ['www.sukl.sk', 'sukl.sk', 'www.uskvbl.sk', 'uskvbl.sk', 'www.health.gov.sk', 'health.gov.sk', 'sool.sk', 'www.sool.sk', 'www.uskvbl.cz', 'uskvbl.cz', 'medicines.health.europa.eu'];

function parseSource(src, text, finalUrl) {
  const base = finalUrl || src.url;
  const items = src.kind === 'rss' ? parseRss(text, base) : src.kind === 'dated' ? parseDatedList(text, base) : src.kind === 'articles' ? parseArticleList(text, base) : parseLinkList(text, base);
  const fixed = src.kind === 'links' || src.kind === 'articles';
  return items.slice(0, src.limit || items.length).map((it) => ({ ...it, category: fixed ? src.category : categorize(it, src.category === 'recall' && src.kind === 'rss' ? 'recall' : null) }));
}

/** A stable id: the same notice from two feeds (ŠÚKL recalls and all news) is one item. */
function noticeId(authority, link, title, key = null) {
  if (key) return crypto.createHash('sha1').update(`${authority}|${key}`).digest('hex').slice(0, 16);
  const k = link ? String(link).replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, (q) => (/page_id|p=|id=/.test(q) ? q : '')) : fold(title);
  return crypto.createHash('sha1').update(`${authority}|${k}`).digest('hex').slice(0, 16);
}

/** Watched names (one per line) found in the notice's title or summary. */
function watchHits(item, watchTerms) {
  const text = ` ${fold(`${item.title} ${item.summary || ''}`).replace(/[^a-z0-9]+/g, ' ')} `;
  const hits = [];
  for (const raw of String(watchTerms || '').split(/\r?\n|;/)) {
    const term = fold(raw).replace(/[^a-z0-9]+/g, ' ').trim();
    if (term.length < 3) continue;
    if (text.includes(` ${term} `)) hits.push(raw.trim());
    if (hits.length >= 5) break;
  }
  return hits;
}

/**
 * Does the notice concern the company? From the company profile (human / veterinary medicines and
 * the other activities) and the watched product names.
 * → { forUs: bool, reason: 'human'|'vet'|<activity id>|null, watch: [names] }
 */
function relevance(item, company, activityHints) {
  const acts = (company && company.activities) || {};
  // A change of a product the company watches in the EU database concerns it by definition.
  if (item.authority === 'upd') return { forUs: true, reason: null, watch: [item.product || item.title] };
  const watch = watchHits(item, company && company.watchTerms);
  if (watch.length) return { forUs: true, reason: null, watch };
  const kind = (AUTHORITIES[item.authority] || {}).kind;
  if (kind === 'human' && acts.human === 'no' && item.category !== 'legislation') return { forUs: false, reason: 'human', watch };
  if (kind === 'vet' && acts.vet === 'no') return { forUs: false, reason: 'vet', watch };
  const hints = activityHints ? activityHints(`${item.title} ${item.summary || ''}`, company, item.title) : [];
  if (hints.length) return { forUs: false, reason: hints[0].id, watch };
  return { forUs: true, reason: null, watch };
}

const OUTCOMES = ['not-ours', 'done', 'noted'];

module.exports = { fold, decodeEntities, textOf, rssDate, skDate, skLongDate, parseRss, parseDatedList, parseLinkList, parseArticleList, categorize, sources, parseSource, noticeId, watchHits, relevance, CATEGORIES, OUTCOMES, HOSTS, AUTHORITIES };
