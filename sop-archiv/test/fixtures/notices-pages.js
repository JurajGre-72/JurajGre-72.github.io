'use strict';
// Made-up pages shaped like the ŠÚKL RSS feeds, the ÚŠKVBL WordPress pages, the Ministry of Health's
// lists, the SOOL and ÚSKVBL ČR feeds and a product page of the EU veterinary medicines database
// (for unit and e2e tests).

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function rfc822(iso) {
  const d = new Date(`${iso}T09:30:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} 11:30:00 +0200`;
}

function isoDaysAgo(n, from = new Date()) {
  return new Date(from.getTime() - n * 86400000).toISOString().slice(0, 10);
}

/** items: [{ title, path, date, summary }] */
function suklRss(title, items, host = 'https://www.sukl.sk') {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>Štátny ústav pre kontrolu liečiv - ${title}</title><link>${host}/</link>
${items
  .map(
    (i) => `<item><title><![CDATA[${i.title}]]></title><link>${host}${i.path}</link><guid>${host}${i.path}</guid><pubDate>${rfc822(i.date)}</pubDate><description><![CDATA[<p>${i.summary || ''}</p>]]></description></item>`
  )
  .join('\n')}
</channel></rss>`;
}

function wpPage(title, body) {
  return `<!DOCTYPE html><html lang="sk-SK"><head><meta charset="UTF-8"><title>${title} |</title></head><body>
<div id="access"><ul class="menu"><li><a href="https://www.uskvbl.sk/?page_id=30">Legislatíva</a></li><li><a href="https://www.uskvbl.sk/?page_id=115">Dôležité oznamy</a></li></ul></div>
<div id="main"><div id="container"><div id="content" role="main">
<div id="post-1" class="page type-page status-publish hentry"><h1 class="entry-title">${title}</h1>
<div class="entry-content">
${body}
</div><!-- .entry-content --></div></div></div></div>
<div id="footer"><a href="https://www.uskvbl.sk/?page_id=9391">Mapa stránky</a></div></body></html>`;
}

/** items: [{ title, file, date }] – each notice is a date line and a link to a document */
function uskvblNotices(items, host = 'https://www.uskvbl.sk') {
  return wpPage(
    'DÔLEŽITÉ OZNAMY',
    items
      .map((i) => {
        const [y, m, d] = i.date.split('-');
        return `<p class="wp-block-paragraph">&#8212;&#8212;&#8212;&#8212;&#8212; ${d}.${m}.${y}</p>\n<div class="wp-block-file"><a href="${host}/wp-content/uploads/${i.file}">${i.title}</a></div>`;
      })
      .join('\n\n')
  );
}

/** links: [{ title, file }] */
function uskvblLegislation(links, host = 'https://www.uskvbl.sk') {
  return wpPage('Nová legislatíva', `<p>Nariadenia EÚ</p>\n${links.map((l) => `<p><a href="${host}/wp-content/uploads/${l.file}">${l.title}</a></p>`).join('\n')}`);
}

const SK_GEN = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna', 'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];

/** The Ministry of Health's list page: items [{ title, slug, date }] (menus around it must be left out). */
function mzList(title, items, host = 'https://www.health.gov.sk') {
  const longDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d}. ${SK_GEN[m - 1]} ${y}`;
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ministerstvo zdravotníctva Slovenskej republiky</title></head><body>
<ul class="left-menu"><li><a href="${host}/?vedenie">O ministerstve</a></li><li><a href="${host}/?zoznam-kategorizovanych-liekov">Zoznam kategorizovaných liekov</a></li></ul>
<div id="MainContentPanel"><h1>${title}</h1>
<div class="ExternalClass1"><table id="layoutsTable"><tbody><tr><td></td></tr></tbody></table></div><ul class="page-article-list">${items
    .map((i) => `<li><a href="${host}/Clanok?${i.slug}" title="${i.title}">${i.title}</a>&nbsp;(${longDate(i.date)})</li>`)
    .join('')}</ul></div>
<div class="footer"><a href="?mapastranky">Mapa stránky</a> | <a href="?rss">RSS</a></div></body></html>`;
}

/**
 * A product page of the EU veterinary medicines database:
 * { name, status ('authorised'), statusLabel, authStatus, authorisedIn ['SK'], availableIn ['SK'], holder, docs: { title: 'YYYY-MM-DD' } }
 */
function updProduct(p) {
  const dmy = (iso) => iso.split('-').reverse().map(Number).join('/');
  const flags = (list) => `<div class="field__item"><ul class="inline-list list-items-count-${list.length}">${list
    .map((c) => `<li><div class="taxonomy-term upd-country flag-and-name"><div class="field__item"><span class="flag-icon flag-icon-${c.toLowerCase()} flag-icon-squared"></span></div><div class="field__item">${c}</div></div></li>`)
    .join('')}</ul></div>`;
  const field = (name, label, inner) => `<div class="field products__extra-field-upd-products-${name} label-display-inline"><div class="row"><div class="field__label col-12 col-md-4">${label}<span class="me-1">:</span></div><div class="field__items col-12 col-md">${inner}</div></div></div>`;
  return `<!DOCTYPE html><html lang="sk"><head><meta charset="utf-8"><title>${p.name} | UPD</title></head><body><main>
<h1 class="fs-1 card-title bcl-heading"><div class="products__extra-field-upd-products-product-title-with-fallback label-display-hidden title"><div class="field__item"> ${p.name} </div></div></h1>
<div class="product-status product-status--${p.status || 'authorised'} field products__field-upd-product-status label-display-hidden no-label"><div class="row"><div class="field__items col-12 col-md"><div class="field__item">${p.statusLabel || 'Oprávnený'}</div></div></div></div>
<h2 class="inpage-item-title">Identifikácia lieku</h2>
${field('medicine-name', 'Názov lieku', `<div class="field__item"> ${p.name} </div>`)}
${field('auth-status', 'Stav registrácie', `<div class="field__item"><ul class="list-items-count-1"><li><div class="taxonomy-term upd-auth-status full"><div class="field__items col-12 col-md"><div class="field__item">${p.authStatus || 'Valid'}</div></div></div></li></ul></div>`)}
${field('authorised-countries', 'Registrovaný v/vo', flags(p.authorisedIn || ['SK']))}
${field('available-in-countries', 'Dostupné v', flags(p.availableIn || ['SK']))}
${field('marketing-authorisation-holder', 'Držiteľ rozhodnutia o registrácii', `<div class="field__item"><ul class="list-items-count-1"><li>${p.holder || 'Fiktívna Farma s.r.o.'}</li></ul></div>`)}
${field('auth-number', 'Číslo registrácie', `<div class="field__item"><ul class="list-items-count-1"><li>96/001/26-S</li></ul></div>`)}
${field('auth-status-change', 'Dátum zmeny stavu registrácie', `<div class="field__item"><time datetime="2026-01-12T00:00:00Z">12/01/2026</time></div>`)}
<h2 class="inpage-item-title">Dokumenty</h2>
${Object.entries(p.docs || {})
  .map(([title, date]) => `<div class="doc"><div class="fw-bold">${title}</div><div class="collapse"><small class="fw-bold m-0">Slovensky<span class="fw-normal"> (PDF)</span><div class="fw-normal"> Publikované na: ${dmy(date)}</div></small></div></div>`)
  .join('\n')}
</main><footer>Veterinary Medicine Information website</footer></body></html>`;
}

module.exports = { suklRss, uskvblNotices, uskvblLegislation, mzList, updProduct, isoDaysAgo };
