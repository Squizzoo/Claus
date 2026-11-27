'use strict';
// Mood memory: the calm pet is sleepy late at night and perky in the morning. Pure, so it can be unit tested.
// Only a calm (idle) pet is touched: a chat that needs you always looks the way its state says.
// Loaded as a plain script in the renderer (window.PetMood) and with require() in the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetMood = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SLEEPY = { from: 23, to: 6 }; // local hours: 23:00 up to 06:00
  const PERKY = { from: 6, to: 10 }; // 06:00 up to 10:00

  // How the idle actions change: a sleepy pet waits longer between them and mostly yawns and stretches, a perky one is livelier.
  const GAP_FACTOR = { sleepy: 1.8, perky: 0.6, normal: 1 };
  const PREFER = { sleepy: ['yawn', 'stretch'], perky: ['wag', 'look'], normal: [] };

  /** 'sleepy', 'perky' or 'normal' for a Date (local time). */
  function timeOfDay(date) {
    const h = date.getHours();
    if (h >= SLEEPY.from || h < SLEEPY.to) return 'sleepy';
    if (h >= PERKY.from && h < PERKY.to) return 'perky';
    return 'normal';
  }

  /** The time-of-day for a pet in this mood, or 'normal' when the memory is off or the pet is not calm. */
  function effective(date, mood, enabled = true) {
    return enabled && mood === 'idle' ? timeOfDay(date) : 'normal';
  }

  /** The class the renderer adds to the pet root: 'tod-sleepy', 'tod-perky' or ''. Never a mood-* class. */
  function className(date, mood, enabled = true) {
    const t = effective(date, mood, enabled);
    return t === 'normal' ? '' : `tod-${t}`;
  }

  return { SLEEPY, PERKY, GAP_FACTOR, PREFER, timeOfDay, effective, className };
});
