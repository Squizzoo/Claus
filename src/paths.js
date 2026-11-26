'use strict';
// Files that another program has to open by path (the PowerShell helpers) cannot be read from inside app.asar,
// so the packaged app keeps them unpacked next to it (electron-builder asarUnpack). `unpacked()` points at that copy.
const path = require('path');

/** `...\resources\app.asar\src\x.ps1` -> `...\resources\app.asar.unpacked\src\x.ps1`; any other path (a dev checkout) stays as it is. */
function unpacked(file) {
  return String(file).replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
}

/** Absolute path of a helper script that sits next to the sources. */
function helperScript(name) {
  return unpacked(path.join(__dirname, name));
}

module.exports = { unpacked, helperScript };
