'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Mood = require('../src/renderer/mood');
const Pets = require('../src/renderer/pets');

const at = (h, m = 0) => new Date(2026, 10, 27, h, m);

test('timeOfDay: sleepy 23:00-06:00, perky 06:00-10:00, normal otherwise', () => {
  for (const h of [23, 0, 3, 5]) assert.equal(Mood.timeOfDay(at(h, 59)), 'sleepy', `${h}h`);
  for (const h of [6, 8, 9]) assert.equal(Mood.timeOfDay(at(h, 59)), 'perky', `${h}h`);
  for (const h of [10, 12, 17, 22]) assert.equal(Mood.timeOfDay(at(h)), 'normal', `${h}h`);
  assert.equal(Mood.timeOfDay(at(5, 59)), 'sleepy'); // the boundaries
  assert.equal(Mood.timeOfDay(at(6, 0)), 'perky');
  assert.equal(Mood.timeOfDay(at(9, 59)), 'perky');
  assert.equal(Mood.timeOfDay(at(10, 0)), 'normal');
  assert.equal(Mood.timeOfDay(at(22, 59)), 'normal');
  assert.equal(Mood.timeOfDay(at(23, 0)), 'sleepy');
});

test('only a calm pet changes: every state that needs you is left alone', () => {
  for (const mood of ['working', 'done', 'question', 'approval', 'sleep']) {
    assert.equal(Mood.effective(at(2), mood), 'normal', mood);
    assert.equal(Mood.className(at(2), mood), '', mood);
  }
  assert.equal(Mood.className(at(2), 'idle'), 'tod-sleepy');
  assert.equal(Mood.className(at(8), 'idle'), 'tod-perky');
  assert.equal(Mood.className(at(14), 'idle'), '');
});

test('the memory can be switched off, and never produces a mood-* class', () => {
  assert.equal(Mood.className(at(2), 'idle', false), '');
  assert.equal(Mood.effective(at(8), 'idle', false), 'normal');
  for (const h of [0, 8, 14]) assert.doesNotMatch(Mood.className(at(h), 'idle'), /^mood-/);
});

test('idle timing follows the time of day', () => {
  assert.ok(Mood.GAP_FACTOR.sleepy > 1 && Mood.GAP_FACTOR.perky < 1 && Mood.GAP_FACTOR.normal === 1);
  const base = Pets.nextIdleDelay(() => 0.5);
  assert.equal(Pets.nextIdleDelay(() => 0.5, Mood.GAP_FACTOR.sleepy), Math.round(base * 1.8));
  assert.ok(Pets.nextIdleDelay(() => 0.5, Mood.GAP_FACTOR.perky) < base);
});

test('a preferred idle action is more likely, and a pet without a tail never wags', () => {
  const count = (prefer, hasTail = true) => {
    const seen = {};
    for (let i = 0; i < 1000; i++) {
      const n = Pets.pickIdleAction(hasTail, () => i / 1000, prefer);
      seen[n] = (seen[n] || 0) + 1;
    }
    return seen;
  };
  const plain = count([]);
  const sleepy = count(Mood.PREFER.sleepy);
  assert.ok(sleepy.yawn > plain.yawn && sleepy.stretch > plain.stretch);
  assert.equal(count(Mood.PREFER.perky, false).wag, undefined);
});

test('temperament: sleepy, playful and hyper win over the clock, calm follows it', () => {
  const o = (temper, tod = true) => ({ temper, tod });
  assert.deepEqual(Mood.TEMPER_ORDER, ['sleepy', 'calm', 'playful', 'hyper']);
  assert.equal(Mood.DEFAULT_TEMPER, 'calm');
  for (const h of [2, 8, 14]) {
    assert.equal(Mood.look(at(h), 'idle', o('sleepy')), 'sleepy', `sleepy ${h}h`);
    assert.equal(Mood.look(at(h), 'idle', o('playful')), 'playful', `playful ${h}h`);
    assert.equal(Mood.look(at(h), 'idle', o('hyper')), 'hyper', `hyper ${h}h`);
  }
  assert.equal(Mood.look(at(2), 'idle', o('calm')), 'sleepy'); // calm follows the clock...
  assert.equal(Mood.look(at(2), 'idle', o('calm', false)), 'normal'); // ...unless the clock is off
  assert.equal(Mood.look(at(2), 'idle', o('sleepy', false)), 'sleepy'); // the explicit choice does not need the clock switch
  assert.equal(Mood.look(at(14), 'idle'), 'normal'); // default options = calm with the clock on
});

test('temperament only touches a calm pet, and a working one when it is playful or hyper', () => {
  for (const mood of ['done', 'question', 'approval', 'sleep']) {
    for (const temper of Mood.TEMPER_ORDER) assert.equal(Mood.look(at(2), mood, { temper }), 'normal', `${mood}/${temper}`);
  }
  assert.equal(Mood.look(at(2), 'working', { temper: 'hyper' }), 'hyper');
  assert.equal(Mood.look(at(2), 'working', { temper: 'playful' }), 'playful');
  assert.equal(Mood.look(at(2), 'working', { temper: 'sleepy' }), 'normal'); // a working chat is never slowed down
  assert.equal(Mood.lookClass(at(2), 'idle', { temper: 'hyper' }), 'tod-hyper');
  assert.equal(Mood.lookClass(at(14), 'idle'), '');
  assert.equal(Mood.temperOf('hyper'), 'hyper');
  assert.equal(Mood.temperOf('nope'), 'calm');
});

test('every look has timing and preferred actions, and the preferred actions exist', () => {
  for (const key of ['sleepy', 'perky', 'normal', 'playful', 'hyper']) {
    assert.equal(typeof Mood.GAP_FACTOR[key], 'number', key);
    for (const name of Mood.PREFER[key]) assert.ok(Pets.IDLE_ACTIONS[name], `${key} prefers unknown action ${name}`);
  }
  assert.ok(Mood.GAP_FACTOR.hyper < Mood.GAP_FACTOR.playful && Mood.GAP_FACTOR.playful < Mood.GAP_FACTOR.normal && Mood.GAP_FACTOR.normal < Mood.GAP_FACTOR.sleepy);
  for (const id of Mood.TEMPER_ORDER) assert.ok(Mood.TEMPERS[id].label && Mood.TEMPERS[id].hint, id);
});
