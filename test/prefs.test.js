'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, sanitize, merge, MAX_ITEMS } = require('../src/prefs');

test('defaults come back for missing or broken input', () => {
  assert.deepEqual(sanitize(undefined), DEFAULTS);
  assert.deepEqual(sanitize('nope'), DEFAULTS);
  assert.deepEqual(sanitize(null), DEFAULTS);
});

test('only known choices are accepted', () => {
  const p = sanitize({ groupBy: 'none', sort: 'alphabet', density: 'compact', other: 1 });
  assert.equal(p.groupBy, 'none');
  assert.equal(p.sort, DEFAULTS.sort);
  assert.equal(p.density, 'compact');
  assert.equal('other' in p, false);
});

test('lists keep only short, unique strings and are capped', () => {
  const p = sanitize({ pinned: ['a', 'a', 5, { x: 1 }, 'b', 'x'.repeat(1000)], collapsed: 'not a list' });
  assert.deepEqual(p.pinned, ['a', 'b']);
  assert.deepEqual(p.collapsed, []);
  const many = sanitize({ mutedChats: Array.from({ length: MAX_ITEMS + 50 }, (_, i) => `id${i}`) });
  assert.equal(many.mutedChats.length, MAX_ITEMS);
});

test('a full list still takes a new entry: the oldest is dropped, not the newest', () => {
  const full = sanitize({ pinned: Array.from({ length: MAX_ITEMS }, (_, i) => `id${i}`) });
  const next = merge(full, { pinned: [...full.pinned, 'new'] });
  assert.equal(next.pinned.length, MAX_ITEMS);
  assert.equal(next.pinned.at(-1), 'new');
  assert.equal(next.pinned.includes('id0'), false);
});

test('merge changes only what the patch names and rejects bad values', () => {
  const current = sanitize({ density: 'compact', pinned: ['a'] });
  const next = merge(current, { groupBy: 'none', sort: 'bogus' });
  assert.equal(next.groupBy, 'none');
  assert.equal(next.sort, DEFAULTS.sort);
  assert.equal(next.density, 'compact');
  assert.deepEqual(next.pinned, ['a']);
  assert.deepEqual(merge(current, 'junk'), current);
  assert.deepEqual(merge(current, { pinned: 7 }).pinned, ['a']); // a bad list keeps the old one
});
