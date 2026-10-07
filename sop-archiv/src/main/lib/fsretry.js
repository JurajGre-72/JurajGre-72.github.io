'use strict';
// Windows refuses to replace or rewrite a file for a moment while another program has it open: a colleague's
// computer reading the shared archive, an antivirus or a backup program. Such a refusal (EPERM / EACCES /
// EBUSY) is tried again for a few seconds instead of failing the save.

const fs = require('fs');

const BUSY_WIN = new Set(['EPERM', 'EACCES', 'EBUSY']);
const BUSY_OTHER = new Set(['EBUSY']);

async function retryBusy(fn, { win = process.platform === 'win32', totalMs = 10000 } = {}) {
  const busy = win ? BUSY_WIN : BUSY_OTHER;
  const end = Date.now() + totalMs;
  let wait = 10;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!busy.has(e && e.code) || Date.now() + wait > end) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 500);
    }
  }
}

/** Put the finished temporary file in place of the real one. */
function replaceFile(tmp, file, opts) {
  return retryBusy(() => fs.promises.rename(tmp, file), opts);
}

function writeFileRetry(file, data, opts) {
  return retryBusy(() => fs.promises.writeFile(file, data), opts);
}

module.exports = { retryBusy, replaceFile, writeFileRetry };
