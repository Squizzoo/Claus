'use strict';
// How lively a calm pet is: the temperament the user picked (sleepy, calm, playful, hyper) and, for a calm temperament, the time of day
// (sleepy late at night, perky in the morning). Pure, so it can be unit tested.
// A chat that needs you always looks the way its state says: only an idle pet (and, for playful and hyper, a working one, which just moves faster) is touched.
// Loaded as a plain script in the renderer (window.PetMood) and with require() in the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetMood = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SLEEPY = { from: 23, to: 6 }; // local hours: 23:00 up to 06:00
  const PERKY = { from: 6, to: 10 }; // 06:00 up to 10:00

  // The temperament: the setting that says how busy the pet is most of the time. `calm` is the default and the only one the time of day adds to.
  const TEMPER_ORDER = ['sleepy', 'calm', 'playful', 'hyper'];
  const TEMPERS = {
    sleepy: { label: 'Sleepy', hint: 'Slow, yawns and naps a lot.' },
    calm: { label: 'Calm', hint: 'Now and then it stretches or looks around.' },
    playful: { label: 'Playful', hint: 'Hops, waves and wags often.' },
    hyper: { label: 'Hyper', hint: 'Never sits still: spins, dances and bounces.' },
  };
  const DEFAULT_TEMPER = 'calm';

  // How the idle actions change per look: a sleepy pet waits longer between them and mostly yawns, stretches and naps, a hyper one hardly waits.
  const GAP_FACTOR = { sleepy: 1.8, perky: 0.6, normal: 1, playful: 0.5, hyper: 0.2 };
  const PREFER = {
    sleepy: ['yawn', 'stretch', 'nap'],
    perky: ['wag', 'look', 'hop'],
    normal: [],
    playful: ['wag', 'hop', 'wave', 'dance', 'look'],
    hyper: ['hop', 'spin', 'dance', 'sneeze', 'wave', 'wag'],
  };

  /** 'sleepy', 'perky' or 'normal' for a Date (local time). */
  function timeOfDay(date) {
    const h = date.getHours();
    if (h >= SLEEPY.from || h < SLEEPY.to) return 'sleepy';
    if (h >= PERKY.from && h < PERKY.to) return 'perky';
    return 'normal';
  }

  /**
   * The look of a pet in this mood: 'sleepy' | 'perky' | 'normal' | 'playful' | 'hyper'.
   * `tod` switches the time of day on, `temper` is the chosen temperament. 'normal' when the pet is not in a mood this touches.
   * Sleepy, playful and hyper win over the time of day; only a calm temperament follows the clock.
   */
  function look(date, mood, { tod = true, temper = DEFAULT_TEMPER } = {}) {
    if (temper === 'sleepy') return mood === 'idle' ? 'sleepy' : 'normal';
    if (temper === 'playful' || temper === 'hyper') return mood === 'idle' || mood === 'working' ? temper : 'normal';
    return tod && mood === 'idle' ? timeOfDay(date) : 'normal';
  }

  /** The class the renderer adds to the pet root: 'tod-sleepy', 'tod-perky', 'tod-playful', 'tod-hyper' or ''. Never a mood-* class. */
  function lookClass(date, mood, options) {
    const l = look(date, mood, options);
    return l === 'normal' ? '' : `tod-${l}`;
  }

  /** The time-of-day for a pet in this mood, or 'normal' when the memory is off or the pet is not calm. */
  function effective(date, mood, enabled = true) {
    return look(date, mood, { tod: enabled });
  }

  /** The class for the time of day alone (kept for the plain calm temperament). */
  function className(date, mood, enabled = true) {
    return lookClass(date, mood, { tod: enabled });
  }

  /** A temperament id that is known, else the default. */
  const temperOf = (id) => (TEMPER_ORDER.includes(id) ? id : DEFAULT_TEMPER);

  return { SLEEPY, PERKY, GAP_FACTOR, PREFER, TEMPER_ORDER, TEMPERS, DEFAULT_TEMPER, timeOfDay, look, lookClass, effective, className, temperOf };
});
