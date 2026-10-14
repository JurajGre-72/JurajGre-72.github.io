// End-to-end test of every control on the dashboard: filters, buttons, settings, detail views and the
// "Check for updates now" flow (GitHub API mocked). Uses the real data in pharma-monitor/data.
//
//   npm install --no-save playwright@1.56.1   (or set NODE_PATH to a global install)
//   node pharma-monitor/tests/dashboard.test.mjs            # bundled Chromium
//   PW_CHANNEL=chrome node pharma-monitor/tests/dashboard.test.mjs   # installed Google Chrome (CI)
//   DASHBOARD_URL=https://jurajgre-72.github.io/pharma-monitor/ node …  # test the published site

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8000 + Math.floor(Math.random() * 900);
const URL = process.env.DASHBOARD_URL || `http://127.0.0.1:${PORT}/pharma-monitor/`;
const DATA = process.env.DASHBOARD_URL
  ? await (await fetch(new globalThis.URL('data/items.json', URL))).json()
  : JSON.parse(fs.readFileSync(path.join(ROOT, 'pharma-monitor/data/items.json'), 'utf8'));
const TOKEN = 'github_pat_TEST_0123456789abcdefghijklmnop';

let failures = 0, passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes++; console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const server = process.env.DASHBOARD_URL ? null
  : spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
if (server) await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => {
    // blocked web fonts and the deliberately mocked HTTP 401 are expected, not page errors
    const src = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|api\.github\.com/.test(src + m.text())) page.errors.push(`${m.text()} (${src})`);
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());  // keep the test offline-safe
  return page;
}
const count = (page, sel) => page.locator(sel).count();
const texts = (page, sel) => page.locator(sel).allInnerTexts();

try {
  // ------------------------------------------------------------------ load
  console.log('Loading');
  let page = await newPage();
  await page.goto(URL);
  await page.waitForSelector('article.item');
  const total = DATA.items.length;
  const shown = await count(page, 'article.item');
  check('items render', shown === Math.min(60, total), `${shown} shown, ${total} in data`);
  check('stat: tracked count', (await page.locator('#sTotal').innerText()) === String(total));
  check('stat: last check filled', (await page.locator('#sChecked').innerText()) !== '–');
  check('sources list shows every source', (await count(page, '.src-row')) === Object.keys(DATA.sources).length);
  check('status strip hidden when idle', await page.locator('#updStatus').isHidden());
  check('logo loads', await page.locator('.bar .logo').evaluate((img) => img.complete && img.naturalWidth > 0));

  // ------------------------------------------------------------------ search
  console.log('Search');
  await page.fill('#q', '362/2011');
  await page.waitForTimeout(300);
  const titles = await texts(page, 'article.item');
  check('search narrows the list', titles.length > 0 && titles.length < shown, `${titles.length} results`);
  check('every result matches the search', titles.every((t) => t.includes('362/2011')));
  await page.fill('#q', 'zzz-no-such-thing');
  await page.waitForTimeout(300);
  check('no-match message', (await page.locator('#out .empty').innerText()).includes('Nothing matches'));
  await page.fill('#q', '');
  await page.waitForTimeout(300);
  check('clearing search restores the list', (await count(page, 'article.item')) === shown);

  // ------------------------------------------------------------------ priority
  console.log('Priority filter');
  await page.click('#prio button[data-v="high"]');
  let pills = await texts(page, 'article.item .pill.high, article.item .pill.medium, article.item .pill.low');
  check('High shows only high', pills.length > 0 && pills.every((p) => p === 'High'), pills.slice(0, 5).join(','));
  check('High button pressed', (await page.getAttribute('#prio button[data-v="high"]', 'aria-pressed')) === 'true');
  await page.click('#prio button[data-v="medium"]');
  pills = await texts(page, 'article.item .pill.high, article.item .pill.medium, article.item .pill.low');
  check('Medium+ hides low', pills.length > 0 && !pills.includes('Low'));
  await page.click('#prio button[data-v="all"]');
  check('All restores', (await count(page, 'article.item')) === shown);

  // ------------------------------------------------------------------ category & source
  console.log('Category and source filters');
  const cats = await page.locator('#cat option').allTextContents();
  check('category options built from data', cats.length > 2, cats.join(' | '));
  await page.selectOption('#cat', 'Law change');
  let catPills = await texts(page, 'article.item .pill.cat');
  check('category filter', catPills.length > 0 && catPills.every((c) => c === 'Law change'));
  await page.selectOption('#cat', '');
  await page.selectOption('#src', 'sukl_recall');
  const srcMeta = await texts(page, 'article.item .meta');
  check('source filter', srcMeta.length > 0 && srcMeta.every((m) => m.includes('Stiahnutia liekov')));
  await page.selectOption('#src', '');
  check('filters reset', (await count(page, 'article.item')) === shown);

  // ------------------------------------------------------------------ show more
  console.log('Show more');
  if (total > 60) {
    check('"Show more" visible', await page.locator('#moreWrap').isVisible());
    await page.click('#more');
    check('"Show more" loads the rest', (await count(page, 'article.item')) === Math.min(120, total));
  } else {
    check('"Show more" hidden when everything fits', await page.locator('#moreWrap').isHidden());
  }

  // ------------------------------------------------------------------ mark read / only new
  console.log('Mark all read / Only new');
  const newBefore = Number(await page.locator('#sNew').innerText());
  await page.check('#onlyNew');
  const onlyNewCount = await count(page, 'article.item');
  check('"Only new" shows only NEW items', onlyNewCount === Math.min(newBefore, 60) && (await count(page, 'article.item .pill.new')) === onlyNewCount,
    `${onlyNewCount} vs ${newBefore}`);
  await page.click('#markRead');
  check('"Mark all read" zeroes the counter', (await page.locator('#sNew').innerText()) === '0');
  check('"Mark all read" clears NEW badges', (await count(page, '.pill.new')) === 0);
  check('"Only new" now empty', (await count(page, 'article.item')) === 0);
  await page.uncheck('#onlyNew');
  await page.reload();
  await page.waitForSelector('article.item');
  check('read state remembered after reload', (await page.locator('#sNew').innerText()) === '0');

  // ------------------------------------------------------------------ theme
  console.log('Dark mode toggle');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const bgLight = await bg();
  await page.click('#theme');
  check('toggle switches to dark', (await page.getAttribute('html', 'data-theme')) === 'dark' && (await bg()) !== bgLight);
  await page.reload();
  await page.waitForSelector('article.item');
  check('dark mode remembered after reload', (await page.getAttribute('html', 'data-theme')) === 'dark');
  await page.click('#theme');
  check('toggle back to light', (await page.getAttribute('html', 'data-theme')) === 'light' && (await bg()) === bgLight);

  // ------------------------------------------------------------------ detail views
  console.log('"What changed" details');
  async function openDetail(query, kindSelector) {
    await page.fill('#q', query);
    await page.waitForTimeout(300);
    const card = page.locator('article.item', { has: page.locator('.more-btn') }).first();
    if (!(await card.count())) return null;
    await card.locator('.more-btn').click();
    await card.locator(`.detail ${kindSelector}`).first().waitFor({ timeout: 5000 });
    return card;
  }
  let card = await openDetail('Law change', '.chg');
  if (card) {
    check('law change: provisions listed', (await card.locator('.chg').count()) > 0);
    check('law change: old/new highlighted', (await card.locator('.detail ins, .detail del').count()) > 0);
    check('law change: links to old and new wording', (await card.locator('.detail .hint a').count()) >= 2);
    await card.locator('.more-btn').click();
    check('detail collapses', await card.locator('.detail').isHidden());
    await card.locator('.more-btn').click();
    check('detail reopens', await card.locator('.detail').isVisible());
  } else check('law change item with details exists', false);

  card = await openDetail('Zoznam kategorizovaných liekov', 'table.pl');
  if (card) {
    const rows = () => card.locator('table.pl tbody tr').count();
    const changedRows = await rows();
    check('price list: changed medicines table', changedRows > 0);
    await card.locator('.tabs button[data-tab="added"]').click();
    const addedRows = await rows();
    check('price list: "Added" tab', addedRows > 0 && (await card.locator('.tabs button[data-tab="added"]').getAttribute('aria-pressed')) === 'true');
    await card.locator('.tabs button[data-tab="removed"]').click();
    check('price list: "Removed" tab', (await card.locator('table.pl, .hint').count()) > 0);
    await card.locator('.tabs button[data-tab="added"]').click();
    const firstName = (await card.locator('table.pl tbody tr td:nth-child(2)').first().innerText()).split('\n')[0].split(' ')[0];
    await card.locator('.tabs input').fill(firstName);
    const filtered = await rows();
    check('price list: filter box', filtered > 0 && filtered <= addedRows, `${filtered} of ${addedRows} for "${firstName}"`);
  } else check('price list item with details exists', false);

  card = await openDetail('Amends 362/2011', 'pre.amend, .chg');
  check('amendment text or law diff opens', !!card);
  await page.fill('#q', '');

  // ------------------------------------------------------------------ external links
  console.log('Links');
  const hrefs = await page.locator('article.item h3 a').evaluateAll((as) => as.map((a) => [a.href, a.target]));
  check('item titles link to the official source in a new tab', hrefs.length > 0 && hrefs.every(([h, t]) => /^https:\/\//.test(h) && t === '_blank'));
  const pdfs = await page.locator('.links a').evaluateAll((as) => as.map((a) => a.href));
  check('official PDF / Slov-Lex links are absolute', pdfs.every((h) => /^https:\/\//.test(h)));
  check('errors on the page', page.errors.length === 0, page.errors.join(' | '));

  // ------------------------------------------------------------------ update button: setup dialog
  console.log('"Check for updates now" – setup');
  page = await newPage();
  await page.goto(URL);
  await page.waitForSelector('article.item');
  await page.click('#refresh');
  check('no token → setup dialog opens', await page.evaluate(() => document.querySelector('#setup').open));
  check('"Run it on GitHub" points to the workflow',
    (await page.getAttribute('#runOnGithub', 'href')) === 'https://github.com/JurajGre-72/JurajGre-72.github.io/actions/workflows/pharma-monitor.yml');
  check('token link points to GitHub token page', (await page.locator('#setup a').first().getAttribute('href')).startsWith('https://github.com/settings/personal-access-tokens/new'));
  await page.fill('#tokenInput', 'not-a-token');
  await page.click('#tokenSave');
  check('invalid token is rejected', await page.evaluate(() => document.querySelector('#setup').open && !localStorage.getItem('pm-gh-token')));
  await page.click('#setupClose');
  check('× closes the dialog', await page.evaluate(() => !document.querySelector('#setup').open));
  await page.click('#refresh');
  await page.keyboard.press('Escape');
  check('Escape closes the dialog', await page.evaluate(() => !document.querySelector('#setup').open));

  // ------------------------------------------------------------------ update button: full run (GitHub API mocked)
  console.log('"Check for updates now" – run');
  const calls = [];
  let polls = 0, published = false;
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request(), u = req.url();
    calls.push({ method: req.method(), url: u, auth: req.headers().authorization || '', body: req.postData() });
    if (u.endsWith('/dispatches')) return route.fulfill({ status: 204, body: '' });
    if (u.includes('/runs?')) return route.fulfill({ json: { workflow_runs: [{ id: 7, status: 'queued', conclusion: null, created_at: new Date().toISOString(), html_url: 'https://github.com/run/7' }] } });
    if (u.endsWith('/runs/7')) {
      polls += 1;
      const done = polls >= 2;
      published = published || done;
      return route.fulfill({ json: { id: 7, status: done ? 'completed' : 'in_progress', conclusion: done ? 'success' : null, html_url: 'https://github.com/run/7' } });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.route('**/data/items.json*', (route) => {
    if (!published) return route.continue();
    const d = JSON.parse(JSON.stringify(DATA));
    d.updated = new Date().toISOString();
    d.items.unshift({ id: 'test:new', source: 'sukl_recall', source_name: 'ŠÚKL · Stiahnutia liekov z trhu', title: 'TEST recall',
      url: 'https://www.sukl.sk/', date: d.updated, detected: d.updated, category: 'Recall / quality', priority: 'high', tags: [], summary: '' });
    return route.fulfill({ json: d });
  });
  await page.evaluate(() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, Math.min(ms, 30), ...a); });
  await page.click('#refresh');
  await page.fill('#tokenInput', TOKEN);
  await page.click('#tokenSave');
  check('valid token saved in this browser', (await page.evaluate(() => localStorage.getItem('pm-gh-token'))) === TOKEN);
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled && /Done/.test(document.querySelector('#updStatus').innerText), null, { timeout: 20000 });
  const dispatch = calls.find((c) => c.url.endsWith('/actions/workflows/pharma-monitor.yml/dispatches'));
  check('starts the workflow on main', !!dispatch && dispatch.method === 'POST' && JSON.parse(dispatch.body).ref === 'main');
  check('sends the token only to api.github.com', calls.every((c) => c.auth === `Bearer ${TOKEN}` && c.url.startsWith('https://api.github.com/')));
  check('follows the run until it completes', polls >= 2);
  check('reports the result', (await page.locator('#updStatus').innerText()).includes('1 new item'));
  check('reloads the list with the new item', (await page.locator('article.item h3').first().innerText()) === 'TEST recall');
  check('stats updated after reload', (await page.locator('#sTotal').innerText()) === String(total + 1));

  // second click uses the saved token directly (no dialog)
  calls.length = 0; polls = 0; published = false;
  await page.click('#refresh');
  check('saved token → no dialog on next click', await page.evaluate(() => !document.querySelector('#setup').open));
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled, null, { timeout: 20000 });
  check('second run dispatched', calls.some((c) => c.url.endsWith('/dispatches')));

  // ------------------------------------------------------------------ update button: rejected token, forget token
  console.log('"Check for updates now" – errors and forgetting the token');
  await page.unroute('https://api.github.com/**');
  await page.route('https://api.github.com/**', (r) => r.fulfill({ status: 401, body: '{}' }));
  await page.click('#refresh');
  await page.waitForFunction(() => /did not accept/.test(document.querySelector('#updStatus').innerText), null, { timeout: 10000 });
  check('rejected token → clear message', await page.locator('#updStatus.err').isVisible());
  await page.click('#updStatus [data-action="setup"]');
  check('"Enter a new token" reopens the dialog', await page.evaluate(() => document.querySelector('#setup').open));
  await page.click('#tokenForget');
  check('"Forget the saved token" removes it', await page.evaluate(() => !localStorage.getItem('pm-gh-token') && !document.querySelector('#setup').open));
  check('errors on the page', page.errors.length === 0, page.errors.join(' | '));

  // ------------------------------------------------------------------ phone width
  console.log('Phone layout');
  page = await newPage({ viewport: { width: 375, height: 800 } });
  await page.goto(URL);
  await page.waitForSelector('article.item');
  check('no horizontal scroll at 375 px', (await page.evaluate(() => document.documentElement.scrollWidth)) <= 375);
  check('update button visible on phone', await page.locator('#refresh').isVisible());
} catch (e) {
  failures++;
  console.log(`  ✗ test crashed: ${e.message}`);
} finally {
  await browser.close();
  if (server) server.kill();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
