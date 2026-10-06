'use strict';
// Made-up pages shaped like the ŠÚKL RSS feeds and the ÚŠKVBL WordPress pages (for unit and e2e tests).

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

module.exports = { suklRss, uskvblNotices, uskvblLegislation, isoDaysAgo };
