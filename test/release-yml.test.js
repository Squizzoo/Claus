'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { latestYml, digest } = require('../scripts/release-yml');

const SHA = Buffer.alloc(64, 7).toString('base64');

test('latest.yml has the shape electron-builder writes', () => {
  const text = latestYml({ version: '0.3.0', file: 'Claus-Setup-0.3.0.exe', sha512: SHA, size: 123, releaseDate: '2026-11-26T14:08:10.625Z' });
  assert.equal(text, `version: 0.3.0\nfiles:\n  - url: Claus-Setup-0.3.0.exe\n    sha512: ${SHA}\n    size: 123\npath: Claus-Setup-0.3.0.exe\nsha512: ${SHA}\nreleaseDate: '2026-11-26T14:08:10.625Z'\n`);
});

test('latest.yml refuses odd input', () => {
  const ok = { version: '0.3.0', file: 'Claus-Setup-0.3.0.exe', sha512: SHA, size: 1, releaseDate: Date.now() };
  assert.doesNotThrow(() => latestYml(ok));
  for (const bad of [{ version: '0.3' }, { file: 'a b.exe' }, { file: '../x.exe' }, { sha512: 'abc' }, { size: 0 }, { size: 1.5 }]) {
    assert.throws(() => latestYml({ ...ok, ...bad }), Error, JSON.stringify(bad));
  }
});

test('digest is the sha512 and size of the file, so it changes when the file is signed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claus-yml-'));
  try {
    const file = path.join(dir, 'x.bin');
    fs.writeFileSync(file, Buffer.alloc(3_000_000, 1));
    const d = digest(file);
    assert.equal(d.size, 3_000_000);
    assert.equal(d.sha512, crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64'));
    fs.appendFileSync(file, 'signature');
    assert.notEqual(digest(file).sha512, d.sha512);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
