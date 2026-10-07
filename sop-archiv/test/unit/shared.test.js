'use strict';
// Several computers working with one archive folder: what one computer reads in the background must
// never undo what it has just changed itself, and the folder's lock has only one holder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Archive } = require('../../src/main/archive');
const { ArchiveLock } = require('../../src/main/lib/lock');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sop-shared-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function computer(dir, host) {
  const a = new Archive({ dataDir: dir, user: host, host });
  await a.open();
  a.shared = true;
  return a;
}

/** The next reading of archive.json takes long (a slow network drive). */
function slowFirstRead(a) {
  const read = a._readFile.bind(a);
  let slow = true;
  a._readFile = async (file) => {
    const r = await read(file);
    if (slow && file.endsWith('archive.json')) {
      slow = false;
      await sleep(150);
    }
    return r;
  };
}

/** A write transaction as main.js runs it (without the folder lock, which is tested below). */
async function tx(a, fn) {
  a.inTx = true;
  try {
    await a.syncFromDisk();
    await fn();
    await a.save();
  } finally {
    a.inTx = false;
  }
}

test('a background reload that is still reading does not undo a change made meanwhile', async () => {
  const dir = tmpDir();
  const qa = await computer(dir, 'PC-QA');
  const sklad = await computer(dir, 'PC-SKLAD');
  await tx(sklad, () => {
    sklad.data.settings.zoSkladu = 'Poznámka od Petra';
  });

  // The background reload on PC-QA reads slowly (a network drive): it ends after PC-QA's own change.
  slowFirstRead(qa);
  const background = qa.syncFromDisk();
  await tx(qa, () => {
    qa.data.settings.zQa = 'Revízia z PC-QA';
  });
  await background;
  assert.equal(qa.data.settings.zQa, 'Revízia z PC-QA', 'own change still there');
  assert.equal(qa.data.settings.zoSkladu, 'Poznámka od Petra', 'colleague’s change there too');
  await qa.syncFromDisk();
  assert.equal(qa.data.settings.zQa, 'Revízia z PC-QA', 'and after the next reload');

  const check = await computer(dir, 'PC-3');
  assert.equal(check.data.settings.zQa, 'Revízia z PC-QA');
  assert.equal(check.data.settings.zoSkladu, 'Poznámka od Petra');
});

test('the next change after a slow background reload keeps everything saved before', async () => {
  const dir = tmpDir();
  const qa = await computer(dir, 'PC-QA');
  const sklad = await computer(dir, 'PC-SKLAD');
  await tx(sklad, () => {
    sklad.data.settings.prva = 1;
  });
  slowFirstRead(qa);
  const background = qa.syncFromDisk(); // reads the first change, slowly
  await tx(sklad, () => {
    sklad.data.settings.druha = 2; // a second change on the other computer meanwhile
  });
  await tx(qa, () => {
    qa.data.settings.tretia = 3;
  });
  await background;
  const check = await computer(dir, 'PC-3');
  assert.deepEqual([check.data.settings.prva, check.data.settings.druha, check.data.settings.tretia], [1, 2, 3]);
});

test('folder lock: a lock file that is still being written counts as taken', () => {
  const dir = tmpDir();
  const file = path.join(dir, '.sop-archiv.lock');
  fs.writeFileSync(file, ''); // another computer has just created it and not written it yet
  const b = new ArchiveLock(dir, { host: 'pc2', user: 'Eva', pid: 4242 });
  assert.equal(b.tryAcquire().ok, false, 'not overwritten');
  fs.writeFileSync(file, '{"host":"pc1","us'); // half written
  assert.equal(b.tryAcquire().ok, false);
  // A broken lock file that nobody refreshes (a crash in the middle of writing it) is taken over later.
  const old = (Date.now() - 10 * 60 * 1000) / 1000;
  fs.utimesSync(file, old, old);
  assert.equal(b.tryAcquire().ok, true);
  b.release();
  assert.equal(fs.existsSync(file), false);
});

test('folder lock: only one of many computers holds it at a time', async () => {
  const dir = tmpDir();
  const locks = Array.from({ length: 6 }, (_, i) => new ArchiveLock(dir, { host: `pc${i}`, user: `u${i}`, pid: 1000 + i }));
  let inside = 0;
  let most = 0;
  let done = 0;
  await Promise.all(
    locks.map(async (l) => {
      for (let n = 0; n < 15; n++) {
        while (!l.tryAcquire().ok) await sleep(1);
        inside++;
        most = Math.max(most, inside);
        await sleep(2);
        inside--;
        done++;
        l.release();
        await sleep(Math.random() * 3);
      }
    })
  );
  assert.equal(done, 90);
  assert.equal(most, 1, 'never two holders at once');
});

test('a file kept busy for a moment (Windows) is tried again instead of failing the save', async () => {
  const { retryBusy } = require('../../src/main/lib/fsretry');
  const busy = () => Object.assign(new Error('operation not permitted, rename'), { code: 'EPERM' });
  let n = 0;
  const flaky = async () => {
    if (++n < 3) throw busy();
    return 'ok';
  };
  assert.equal(await retryBusy(flaky, { win: true }), 'ok');
  assert.equal(n, 3);
  n = 0;
  await assert.rejects(retryBusy(flaky, { win: false }), /not permitted/, 'elsewhere EPERM is a real refusal');
  await assert.rejects(
    retryBusy(async () => {
      throw busy();
    }, { win: true, totalMs: 100 }),
    /not permitted/,
    'and it gives up after a while'
  );
});

test('a save that does not reach the disk is reported once, audited, and what is saved is read back', async () => {
  const dir = tmpDir();
  const a = await computer(dir, 'PC-QA');
  await tx(a, () => {
    a.data.settings.x = 'uložené';
  });
  // archive.json cannot be replaced (here a folder stands in its place; in practice the network folder is gone).
  const file = path.join(dir, 'archive.json');
  const kept = fs.readFileSync(file);
  fs.rmSync(file);
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, 'x'), '');
  await tx(a, () => {
    a.data.settings.x = 'neuložené';
  });
  assert.ok(a.saveError, 'the failure is known');
  assert.ok(a.takeSaveError());
  assert.equal(a.takeSaveError(), null, 'reported once');
  fs.rmSync(file, { recursive: true });
  fs.writeFileSync(file, kept);
  assert.equal(await a.syncFromDisk(), true, 'read back');
  assert.equal(a.data.settings.x, 'uložené', 'the screen shows what is really saved');
  await sleep(50);
  assert.ok((await a.allAudit()).some((r) => r.action === 'archive.saveFailed'), 'in the audit trail');
});

test('the main file vanishes while the app is open (e.g. iCloud moved it): the next change writes it again', async () => {
  const dir = tmpDir();
  const a = await computer(dir, 'MacBook');
  await tx(a, () => {
    a.data.settings.x = 'pred';
  });
  fs.rmSync(path.join(dir, 'archive.json'));
  fs.writeFileSync(path.join(dir, 'archive.rev'), 'iny'); // as if changed elsewhere: the file is read – and is missing
  await tx(a, () => {
    a.data.settings.x = 'po'; // a change of settings, the language … no "ENOENT" any more
  });
  assert.ok(fs.existsSync(path.join(dir, 'archive.json')), 'written again');
  const check = await computer(dir, 'PC-3');
  assert.equal(check.data.settings.x, 'po');
  await sleep(50);
  assert.ok((await a.allAudit()).some((r) => r.action === 'archive.fileMissing'), 'recorded in the audit trail');
});

test('encrypted archive whose main file is missing at sign-in: restored from the previous save, never started empty', async () => {
  const dir = tmpDir();
  const a = await computer(dir, 'MacBook');
  a.inTx = true;
  await a.enableEncryption();
  const admin = await a.createUser({ name: 'Juraj Gregus', role: 'admin', password: 'Tajne-heslo-1', mustChange: false });
  a.data.settings.x = 'uložené';
  await a.save();
  await a.save(); // the previous save (archive.prev.json) holds the data too
  a.inTx = false;
  assert.equal(fs.readFileSync(path.join(dir, 'archive.rev'), 'utf8').length, 16, 'the revision marker stays readable');

  fs.rmSync(path.join(dir, 'archive.json'));
  const b = new Archive({ dataDir: dir, user: 'MacBook', host: 'MacBook' });
  await b.open();
  b.shared = true;
  b.inTx = true;
  const r = await b.login(admin.id, 'Tajne-heslo-1');
  b.inTx = false;
  assert.ok(r && r.user, 'signed in');
  assert.equal(b.data.settings.x, 'uložené', 'the data is back');
  assert.ok(b.data.users.some((u) => u.name === 'Juraj Gregus'));
  assert.ok(fs.existsSync(path.join(dir, 'archive.json')), 'and written again');

  // No copy at all: an error, not an empty archive in place of the company's.
  for (const f of ['archive.json', 'archive.prev.json']) fs.rmSync(path.join(dir, f), { force: true });
  fs.rmSync(path.join(dir, 'backups'), { recursive: true, force: true });
  const c = new Archive({ dataDir: dir, user: 'MacBook', host: 'MacBook' });
  await c.open();
  c.shared = true;
  c.inTx = true;
  await assert.rejects(c.login(admin.id, 'Tajne-heslo-1'), /ARCHIVE_MISSING/);
  assert.ok(!fs.existsSync(path.join(dir, 'archive.json')), 'nothing empty was written');
});
