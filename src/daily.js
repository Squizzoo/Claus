'use strict';
// The day's summary: how long chats waited on you and how long they worked. Pure, like celebrate.js: times come in
// as arguments, nothing here reads the clock or the disk. Only the date and numbers are kept, never a chat name.
// (The finished-today count lives in settings.streak; summary() merges the two.)
const { dayKey } = require('./celebrate');

const EMPTY = { day: '', waits: 0, waitMs: 0, longestMs: 0, workMs: 0 };
const MAX_MS = 100 * 3_600_000; // no total on one day can be this big: a corrupt file must not show nonsense
const MAX_COUNT = 99_999;
// A chat that waited longer than this was almost certainly abandoned (a cancelled question stays "waiting" until the
// chat runs again), so that wait says nothing about you and is not counted.
const WAIT_CAP_MS = 4 * 3_600_000;
const WORK_CAP_MS = 12 * 3_600_000;

const ms = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(MAX_MS, Math.floor(v))) : 0);

/** Whatever was read from the settings file, as a valid summary. */
function sanitize(input) {
  const src = input && typeof input === 'object' ? input : {};
  const day = typeof src.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.day) ? src.day : '';
  if (!day) return { ...EMPTY };
  const waits = Number.isInteger(src.waits) ? Math.max(0, Math.min(MAX_COUNT, src.waits)) : 0;
  return { day, waits, waitMs: ms(src.waitMs), longestMs: ms(src.longestMs), workMs: ms(src.workMs) };
}

/** The stored summary when it is from the day of `date`, else a fresh one for that day. */
function today(daily, date) {
  const s = sanitize(daily);
  const day = dayKey(date);
  return s.day === day ? s : { ...EMPTY, day };
}

/** A chat waited `waitedMs` on you and then ran again. */
function recordWait(daily, waitedMs, date) {
  const s = today(daily, date);
  if (!(waitedMs >= 0) || waitedMs > WAIT_CAP_MS) return s;
  return { ...s, waits: Math.min(MAX_COUNT, s.waits + 1), waitMs: ms(s.waitMs + waitedMs), longestMs: Math.max(s.longestMs, ms(waitedMs)) };
}

/** A turn spent `workedMs` working (without the time it waited for you). */
function recordWork(daily, workedMs, date) {
  const s = today(daily, date);
  if (!(workedMs > 0)) return s;
  return { ...s, workMs: ms(s.workMs + Math.min(workedMs, WORK_CAP_MS)) };
}

/** What the settings window and the tray show for `date`: the stored day plus the finished count. */
function summary(daily, finished, date) {
  const s = today(daily, date);
  return { finished: Math.max(0, Number(finished) || 0), waits: s.waits, waitMs: s.waitMs, longestMs: s.longestMs, workMs: s.workMs };
}

module.exports = { EMPTY, WAIT_CAP_MS, WORK_CAP_MS, sanitize, recordWait, recordWork, summary };
