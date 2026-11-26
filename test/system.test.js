'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/system');

test('defaults are valid and garbage falls back to them', () => {
  assert.deepEqual(S.sanitize(S.DEFAULTS), S.DEFAULTS);
  for (const bad of [null, undefined, 5, 'x', [], { login: 'yes' }, { followClaude: 1 }, { setupAsked: null }]) assert.deepEqual(S.sanitize(bad), S.DEFAULTS);
  assert.deepEqual(Object.keys(S.sanitize({ login: true, evil: 1 })).sort(), Object.keys(S.DEFAULTS).sort());
});

test('merge keeps the current value when the patch is bad', () => {
  const cur = S.sanitize({ login: true });
  assert.equal(S.merge(cur, { login: 'x' }).login, true);
  assert.equal(S.merge(cur, { login: false }).login, false);
  assert.equal(S.merge(cur, { followClaude: true }).followClaude, true);
  assert.equal(S.merge(cur, null).login, true);
});

test('what a build can do: a dev checkout and a portable exe cannot start with Windows or update', () => {
  assert.deepEqual(S.capabilities({ packaged: false, portable: false }), { login: false, updates: false, firstRun: false });
  assert.deepEqual(S.capabilities({ packaged: true, portable: true }), { login: false, updates: false, firstRun: true });
  assert.deepEqual(S.capabilities({ packaged: true, portable: false }), { login: true, updates: true, firstRun: true });
});

test('the first-run dialog comes once, only when the hooks are missing and there is a file to add them to', () => {
  const ask = (over) => S.shouldAskSetup({ settings: S.DEFAULTS, firstRun: true, forced: false, hooksComplete: false, hooksFileExists: true, ...over });
  assert.equal(ask({}), true);
  assert.equal(ask({ firstRun: false }), false); // a dev checkout
  assert.equal(ask({ forced: true, firstRun: false }), true); // --setup
  assert.equal(ask({ settings: { ...S.DEFAULTS, setupAsked: true } }), false);
  assert.equal(ask({ settings: { ...S.DEFAULTS, setupAsked: true }, forced: true }), true);
  assert.equal(ask({ hooksComplete: true }), false);
  assert.equal(ask({ hooksFileExists: false }), false);
});

test('Claude counts as gone after two misses in a row; a missing answer changes nothing; running resets', () => {
  let m = 0;
  m = S.missesAfter(m, { running: false });
  assert.equal(S.claudeGone(m), false);
  m = S.missesAfter(m, null);
  assert.equal(S.claudeGone(m), false);
  m = S.missesAfter(m, { running: false });
  assert.equal(S.claudeGone(m), true);
  m = S.missesAfter(m, { running: false });
  assert.equal(m, S.GONE_AFTER_POLLS);
  m = S.missesAfter(m, { running: true });
  assert.equal(m, 0);
});
