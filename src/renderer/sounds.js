'use strict';
// The notification sounds as data: a few packs, each with a short tune per kind of notification.
// No AudioContext here, so it can be unit tested; plan() turns a tune into notes the renderer schedules.
// Loaded as a plain script in the renderer (window.PetSounds) and with require() in main and the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetSounds = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // `overdue` is the angry pet, `celebrate` the burst when several chats finish together.
  const KINDS = ['done', 'question', 'approval', 'overdue', 'celebrate'];
  const URGENCY = ['overdue', 'approval', 'question', 'done']; // when several kinds arrive at once, the first one wins

  // wave: oscillator shape; gain: loudness at 100 %; len: seconds each note rings; step: seconds between notes.
  const PACKS = {
    chime: {
      label: 'Chime',
      wave: 'sine', gain: 0.12, len: 0.28,
      kinds: {
        done: { notes: [660, 880], step: 0.13 },
        question: { notes: [587, 740, 880], step: 0.13 },
        approval: { notes: [880, 698, 880], step: 0.13 },
        overdue: { notes: [523, 440, 523, 440], step: 0.13, wave: 'triangle' },
        celebrate: { notes: [523, 659, 784, 1047, 1319], step: 0.09 },
      },
    },
    soft: {
      label: 'Soft',
      wave: 'sine', gain: 0.1, len: 0.55,
      kinds: {
        done: { notes: [392, 523], step: 0.2 },
        question: { notes: [440, 523, 659], step: 0.2 },
        approval: { notes: [523, 440, 523], step: 0.2 },
        overdue: { notes: [262, 220, 262, 220], step: 0.2, wave: 'triangle' },
        celebrate: { notes: [392, 494, 587, 784], step: 0.16 },
      },
    },
    retro: {
      label: 'Retro',
      wave: 'square', gain: 0.045, len: 0.1,
      kinds: {
        done: { notes: [784, 1047], step: 0.08 },
        question: { notes: [659, 784, 988], step: 0.08 },
        approval: { notes: [988, 784, 988, 784], step: 0.07 },
        overdue: { notes: [262, 196, 262, 196], step: 0.12 },
        celebrate: { notes: [523, 659, 784, 1047, 784, 1047, 1319], step: 0.07 },
      },
    },
    pluck: {
      label: 'Pluck',
      wave: 'triangle', gain: 0.16, len: 0.34,
      kinds: {
        done: { notes: [523, 784], step: 0.11 },
        question: { notes: [494, 659, 784], step: 0.11 },
        approval: { notes: [784, 659, 784], step: 0.11 },
        overdue: { notes: [330, 262, 330, 262], step: 0.12 },
        celebrate: { notes: [392, 523, 659, 784, 1047], step: 0.08 },
      },
    },
  };
  const PACK_ORDER = ['chime', 'soft', 'retro', 'pluck'];
  const DEFAULT_PACK = 'chime';
  const VOLUMES = [25, 50, 75, 100];
  const DEFAULT_VOLUME = 100; // 100 % is as loud as the pet always was

  /** The most urgent kind in a list of alert states ('overdue', 'approval', 'question' or 'done'). */
  function topKind(states) {
    return URGENCY.find((k) => states.includes(k)) || 'done';
  }

  /** Notes to play: [{freq, start, len, gain, wave}], start in seconds from now. Empty when the volume is 0. */
  function plan(packId, kind, volume = DEFAULT_VOLUME) {
    const pack = PACKS[packId] || PACKS[DEFAULT_PACK];
    const tune = pack.kinds[kind] || pack.kinds.done;
    const gain = pack.gain * (Math.max(0, Math.min(100, Number(volume))) / 100);
    if (!(gain > 0)) return [];
    return tune.notes.map((freq, i) => ({ freq, start: i * tune.step, len: pack.len, gain, wave: tune.wave || pack.wave }));
  }

  return { PACKS, PACK_ORDER, DEFAULT_PACK, VOLUMES, DEFAULT_VOLUME, KINDS, topKind, plan };
});
