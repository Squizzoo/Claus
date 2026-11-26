'use strict';
// When several chats finish close together the pet celebrates, and a counter keeps the chats finished
// today. Pure: times come in as arguments, nothing here reads the clock or the disk.

const DEFAULTS = {
  min: 3, // this many finished chats...
  windowMs: 60_000, // ...within this long make a celebration
  cooldownMs: 60_000, // and no new one for this long, so a long run of finishes is not one endless party
};

function createCelebrator(options = {}) {
  const o = { ...DEFAULTS, ...options };
  let times = [];
  let quietUntil = 0;
  return {
    /** One chat finished at `at` (ms). Returns how many finished together when that is a celebration, else 0. */
    record(at) {
      times = times.filter((t) => at - t < o.windowMs);
      times.push(at);
      if (times.length < o.min || at < quietUntil) return 0;
      const n = times.length;
      times = [];
      quietUntil = at + o.cooldownMs;
      return n;
    },
  };
}

/** The local calendar day of a Date as 'YYYY-MM-DD'. */
function dayKey(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const EMPTY = { day: '', count: 0 };
const MAX_COUNT = 99_999;

/** Whatever was read from the settings file, as a valid {day, count}. */
function sanitizeStreak(input) {
  const day = input && typeof input.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : '';
  const count = input && Number.isInteger(input.count) ? Math.max(0, Math.min(MAX_COUNT, input.count)) : 0;
  return day ? { day, count } : { ...EMPTY };
}

/** One more finished chat on the day of `date`; a new day starts again from 1. */
function bumpStreak(streak, date) {
  const day = dayKey(date);
  const s = sanitizeStreak(streak);
  return s.day === day ? { day, count: Math.min(MAX_COUNT, s.count + 1) } : { day, count: 1 };
}

/** Chats finished on the day of `date` (0 when the stored day is another one). */
function finishedToday(streak, date) {
  const s = sanitizeStreak(streak);
  return s.day === dayKey(date) ? s.count : 0;
}

module.exports = { DEFAULTS, createCelebrator, dayKey, sanitizeStreak, bumpStreak, finishedToday, EMPTY };
