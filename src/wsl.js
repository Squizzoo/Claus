'use strict';
// Claude Code chats that run inside WSL. Opt-in (settings.system.wsl).
//
// Two halves, both without opening anything to the network:
//  - hooks: a `command` hook inside WSL pipes the event to Windows' own curl.exe (WSL interop), which talks to the pet on
//    127.0.0.1. It runs on the Windows side, so it works in NAT and mirrored networking, and the pet never listens on another address.
//  - chats: the registry of a RUNNING distro (\\wsl.localhost\<distro>\home\<user>\.claude\sessions) is read every few seconds.
//    Only running distros are touched: reading a stopped one would start its VM.
// Parsing is pure; the few functions that start wsl.exe are at the bottom and never throw.
const { execFile } = require('child_process');

const DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HOME = /^\/[A-Za-z0-9._@+\-/]{0,200}$/;
const CURL = '/mnt/c/Windows/System32/curl.exe';

/** Output of `wsl.exe -l -q` (UTF-16, often with a BOM and NULs when decoded as UTF-8) -> distro names. */
function parseDistros(out) {
  const text = Buffer.isBuffer(out) ? (out.includes(0) ? out.toString('utf16le') : out.toString('utf8')) : String(out || '');
  return text
    .replace(/\u0000/g, '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s*\(Default\)$/i, ''))
    .filter((l) => DISTRO.test(l));
}

/** `echo $HOME` output -> a safe absolute Linux path, or null. */
function parseHome(out) {
  const h = String(out || '').trim();
  return HOME.test(h) && !h.includes('..') ? h : null;
}

/** The Windows (UNC) path of a file or folder inside a distro: wslPath('Ubuntu', '/home/pat', '.claude/sessions'). */
function wslPath(distro, home, rel = '') {
  if (!DISTRO.test(String(distro)) || !parseHome(home)) return null;
  const tail = String(rel).split(/[\\/]+/).filter((p) => p && p !== '..').join('\\');
  return `\\\\wsl.localhost\\${distro}${home.replace(/\//g, '\\')}${tail ? '\\' + tail : ''}`;
}

/** The command a WSL hook runs: the event arrives on stdin and goes to the pet through the Windows curl. Never fails the hook if the pet is off. */
function hookCommand(port) {
  return `${CURL} -s -m 3 -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:${Number(port)}/hook || exit 0`;
}

/** Pids from `ls /proc`-style output: lines that are plain numbers. */
function parsePids(out) {
  return new Set(String(out || '').split(/\s+/).filter((t) => /^\d{1,9}$/.test(t)).map(Number));
}

// ---------- the parts that start wsl.exe ----------
const run = (args, { binary = false, timeout = 6000 } = {}) =>
  new Promise((resolve) => {
    try {
      execFile('wsl.exe', args, { timeout, windowsHide: true, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? null : stdout));
    } catch {
      resolve(null);
    }
  });

/** Names of the distros that are running right now (none when WSL is not installed). */
async function runningDistros() {
  return parseDistros(await run(['--list', '--running', '-q'], { binary: true }));
}
/** All installed distros. */
async function allDistros() {
  return parseDistros(await run(['-l', '-q'], { binary: true }));
}
/** The default user's home inside a running distro. */
async function homeOf(distro) {
  if (!DISTRO.test(distro)) return null;
  return parseHome(await run(['-d', distro, '-e', 'sh', '-c', 'echo $HOME']));
}
/** The pids alive inside a distro (Windows cannot signal them). Null when it could not be asked. */
async function livePids(distro) {
  if (!DISTRO.test(distro)) return null;
  const out = await run(['-d', distro, '-e', 'ls', '/proc']);
  return out == null ? null : parsePids(out);
}

module.exports = { DISTRO, parseDistros, parseHome, wslPath, hookCommand, parsePids, runningDistros, allDistros, homeOf, livePids };
