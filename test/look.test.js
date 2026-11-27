'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, sanitize, merge, choices, sanitizeBehaviour } = require('../src/look');
const PetArt = require('../src/renderer/pets');

test('defaults are valid', () => {
  assert.deepEqual(sanitize(DEFAULTS), DEFAULTS);
  assert.equal(DEFAULTS.pet, PetArt.DEFAULT_PET);
});

test('garbage input gives the defaults', () => {
  for (const bad of [null, undefined, 5, 'x', [], { pet: 7 }, { pet: 'unicorn' }, { pet: '__proto__' }]) {
    assert.deepEqual(sanitize(bad), DEFAULTS);
  }
});

test('every pet in the registry is accepted', () => {
  for (const id of PetArt.ORDER) assert.equal(sanitize({ pet: id }).pet, id);
});

test('unknown keys are dropped', () => {
  assert.deepEqual(Object.keys(sanitize({ pet: 'dog', evil: 1 })).sort(), Object.keys(DEFAULTS).sort());
});

test('merge keeps the current value when the patch is bad', () => {
  const cur = sanitize({ pet: 'owl' });
  assert.equal(merge(cur, { pet: 'nope' }).pet, 'owl');
  assert.equal(merge(cur, { pet: 'ghost' }).pet, 'ghost');
  assert.equal(merge(cur, null).pet, 'owl');
});

test('every choice list has no duplicates', () => {
  for (const [key, list] of Object.entries(choices())) assert.equal(new Set(list).size, list.length, key);
});

test('skin and accessory are validated like the pet', () => {
  assert.equal(sanitize({ skin: 'black', accessory: 'crown' }).skin, 'black');
  assert.equal(sanitize({ skin: 'black', accessory: 'crown' }).accessory, 'crown');
  assert.equal(sanitize({ skin: 'rainbow' }).skin, 'default');
  assert.equal(sanitize({ accessory: 'fez' }).accessory, 'none');
  const cur = sanitize({ pet: 'dog', skin: 'pink', accessory: 'bow' });
  assert.deepEqual(merge(cur, { skin: 'x', accessory: 'hat' }), { ...cur, accessory: 'hat' });
});

test('sound settings are validated', () => {
  assert.equal(sanitize({ pack: 'retro' }).pack, 'retro');
  assert.equal(sanitize({ pack: 'jazz' }).pack, 'chime');
  assert.equal(sanitize({ volume: 50 }).volume, 50);
  for (const bad of [0, 30, 150, '50', null, NaN]) assert.equal(sanitize({ volume: bad }).volume, 100, String(bad));
  assert.equal(sanitize({ quiet: 'night' }).quiet, 'night');
  assert.equal(sanitize({ quiet: '24h' }).quiet, 'off');
  assert.equal(sanitize({ streak: false }).streak, false);
  assert.equal(sanitize({ streak: 'no' }).streak, true);
  assert.equal(sanitize({}).showTokens, true);
  assert.equal(sanitize({ showTokens: false }).showTokens, false);
  assert.equal(sanitize({ showTokens: 'off' }).showTokens, true);
});

test('quiet hours that run past midnight', () => {
  const at = (h, m = 0) => new Date(2026, 5, 1, h, m);
  const { isQuiet } = require('../src/look');
  assert.equal(isQuiet(at(23), 'night'), true);
  assert.equal(isQuiet(at(3), 'night'), true);
  assert.equal(isQuiet(at(6, 59), 'night'), true);
  assert.equal(isQuiet(at(7), 'night'), false);
  assert.equal(isQuiet(at(12), 'night'), false);
  assert.equal(isQuiet(at(21, 59), 'night'), false);
  assert.equal(isQuiet(at(22), 'night'), true);
  assert.equal(isQuiet(at(8, 30), 'late'), false);
  assert.equal(isQuiet(at(18, 30), 'evening'), true);
});

test('quiet hours off, or an unknown preset, are never quiet', () => {
  const { isQuiet } = require('../src/look');
  for (let h = 0; h < 24; h++) {
    assert.equal(isQuiet(new Date(2026, 5, 1, h), 'off'), false);
    assert.equal(isQuiet(new Date(2026, 5, 1, h), 'nope'), false);
  }
});

test('mustache is validated like the other choices and defaults to none', () => {
  assert.equal(DEFAULTS.mustache, 'none');
  for (const id of PetArt.MUSTACHE_ORDER) assert.equal(sanitize({ mustache: id }).mustache, id);
  assert.equal(sanitize({ mustache: 'beard' }).mustache, 'none');
  assert.equal(sanitize({ pet: 'dog' }).mustache, 'none'); // a settings file from before the mustache existed
  assert.equal(merge(sanitize({ mustache: 'curly' }), { mustache: 'nope' }).mustache, 'curly');
});

test('behaviour: only mute and a known patience get through', () => {
  const cur = { muted: false, impatientMin: 2 };
  assert.deepEqual(sanitizeBehaviour({ muted: true }, cur), { muted: true, impatientMin: 2 });
  assert.deepEqual(sanitizeBehaviour({ impatientMin: 0 }, cur), { muted: false, impatientMin: 0 });
  assert.deepEqual(sanitizeBehaviour({ impatientMin: 7, muted: 'yes', evil: 1 }, cur), cur);
  assert.deepEqual(sanitizeBehaviour(null, cur), cur);
  assert.deepEqual(sanitizeBehaviour({ impatientMin: 10 }), { muted: false, impatientMin: 10 });
});

test('size and opacity are validated and the size maps to pixels', () => {
  const L = require('../src/look');
  assert.equal(DEFAULTS.size, 'm');
  assert.equal(DEFAULTS.opacity, 100);
  assert.equal(sanitize({ size: 'xl', opacity: 50 }).size, 'xl');
  assert.equal(sanitize({ size: 'xl', opacity: 50 }).opacity, 50);
  assert.equal(sanitize({ size: 'huge', opacity: 10 }).size, 'm');
  assert.equal(sanitize({ size: 'huge', opacity: 10 }).opacity, 100);
  assert.equal(sanitize({ opacity: '50' }).opacity, 100); // a string is not a number choice
  assert.deepEqual(L.SIZE_ORDER.map((id) => L.sizePx(id)), [100, 150, 200, 250]);
  assert.equal(L.sizePx('nope'), 150);
  assert.equal(L.sizePx(undefined), 150);
});

test('sanitizeProjectLooks keeps only known pets and skins and caps the number of entries', () => {
  const L = require('../src/look');
  const ok = L.sanitizeProjectLooks({ 'c:/a': { pet: 'dog', skin: 'default' }, 'c:/b': { pet: 'nope' }, 'c:/c': { pet: 'cat', skin: 'nope' }, 'c:/d': 5, '': { pet: 'cat' } });
  assert.deepEqual(Object.keys(ok).sort(), ['c:/a', 'c:/c']);
  assert.equal(ok['c:/c'].skin, 'default');
  assert.deepEqual(L.sanitizeProjectLooks(null), {});
  assert.deepEqual(L.sanitizeProjectLooks([1, 2]), {});
  const many = {};
  for (let i = 0; i < 200; i++) many[`p${i}`] = { pet: 'cat' };
  assert.equal(Object.keys(L.sanitizeProjectLooks(many)).length, L.PROJECT_LOOK_MAX);
  assert.equal(Object.prototype.polluted, undefined);
  L.sanitizeProjectLooks(JSON.parse('{"__proto__":{"pet":"cat"}}'));
  assert.equal(Object.prototype.pet, undefined);
});

test('setProjectLook sets, replaces and clears one project', () => {
  const L = require('../src/look');
  let m = L.setProjectLook({}, 'c:/a', 'dog');
  assert.deepEqual(m, { 'c:/a': { pet: 'dog', skin: 'default' } });
  m = L.setProjectLook(m, 'c:/a', 'owl', 'default');
  assert.equal(m['c:/a'].pet, 'owl');
  m = L.setProjectLook(m, 'c:/a', null);
  assert.deepEqual(m, {});
  assert.deepEqual(L.setProjectLook({}, '', 'dog'), {});
});

test('effectiveLook: only the newest chat that needs you can switch the pet', () => {
  const L = require('../src/look');
  const base = { ...L.DEFAULTS, pet: 'cat', size: 'l', accessory: 'bow' };
  const maps = { 'c:/a': { pet: 'dog', skin: 'default' } };
  const s = (id, project, state, since, extra = {}) => ({ id, project, state, since, muted: false, ...extra });
  // nothing needs you: global look, even while a project with its own pet is working
  assert.equal(L.effectiveLook([s('1', 'c:/a', 'working', 5)], base, maps), base);
  // a done chat of project a: its pet, but size and accessory stay global
  const dog = L.effectiveLook([s('1', 'c:/a', 'done', 5)], base, maps);
  assert.equal(dog.pet, 'dog');
  assert.equal(dog.size, 'l');
  assert.equal(dog.accessory, 'bow');
  // a newer chat of a project without its own pet wins: global look; an older one does not
  assert.equal(L.effectiveLook([s('1', 'c:/a', 'done', 5), s('2', 'c:/b', 'question', 9)], base, maps), base);
  assert.equal(L.effectiveLook([s('1', 'c:/a', 'done', 9), s('2', 'c:/b', 'question', 5)], base, maps).pet, 'dog');
  // muted chats never switch it, and a tie is stable
  assert.equal(L.effectiveLook([s('1', 'c:/a', 'done', 5, { muted: true })], base, maps), base);
  const tie = [s('b', 'c:/a', 'done', 5), s('a', 'c:/b', 'done', 5)];
  assert.equal(L.effectiveLook(tie, base, maps), base);
  assert.equal(L.effectiveLook([...tie].reverse(), base, maps), base);
  assert.equal(L.effectiveLook([], base, maps), base);
  assert.equal(L.effectiveLook(null, base, null), base);
});
