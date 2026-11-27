'use strict';
// Writes latest.yml for a release from the installer that is actually going to be published.
//
// electron-builder writes latest.yml for the UNSIGNED installer. Code signing changes the file, so its sha512 and size no longer match, and
// electron-updater would refuse the download. The release workflow runs this on the SIGNED installer instead.
//
//   node scripts/release-yml.js <Claus-Setup-x.y.z.exe> [out latest.yml]
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** The text of latest.yml, in the format electron-builder writes. `releaseDate` is an ISO date string. */
function latestYml({ version, file, sha512, size, releaseDate }) {
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new Error(`bad version: ${version}`);
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(file)) throw new Error(`bad file name: ${file}`);
  if (!/^[A-Za-z0-9+/]{86}==$/.test(sha512)) throw new Error('sha512 must be base64 of 64 bytes');
  if (!Number.isInteger(size) || size <= 0) throw new Error('bad size');
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${file}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date(releaseDate).toISOString()}'`,
    '',
  ].join('\n');
}

/** sha512 (base64) and size of a file, streamed. */
function digest(file) {
  const hash = crypto.createHash('sha512');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  let size = 0;
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) {
      hash.update(buf.subarray(0, n));
      size += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha512: hash.digest('base64'), size };
}

function main() {
  const [installer, out = 'latest.yml'] = process.argv.slice(2);
  if (!installer) {
    console.error('usage: node scripts/release-yml.js <Claus-Setup-x.y.z.exe> [latest.yml]');
    process.exit(2);
  }
  const file = path.basename(installer);
  const m = /^Claus-Setup-(\d+\.\d+\.\d+)\.exe$/.exec(file);
  if (!m) throw new Error(`unexpected installer name: ${file}`);
  const { sha512, size } = digest(installer);
  fs.writeFileSync(out, latestYml({ version: m[1], file, sha512, size, releaseDate: new Date() }));
  console.log(`${out}: ${file}, ${size} bytes`);
}

if (require.main === module) main();

module.exports = { latestYml, digest };
