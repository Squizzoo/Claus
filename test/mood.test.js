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
