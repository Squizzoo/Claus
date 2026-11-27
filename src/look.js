'use strict';
// How the pet looks and sounds, chosen in the settings window or the tray and kept in pet-settings.json (settings.look).
// Pure: validates whatever is loaded or sent so a bad value can never end up in the settings file.
const PetArt = require('./renderer/pets');
const PetSounds = require('./renderer/sounds');
const PetMood = require('./renderer/mood');

// Quiet hours: between `from` and `to` (hours, local time) the pet makes no sound. It still moves and shows chips.
const QUIET = {
  off: { label: 'Off' },
  night: { label: '22:00 - 07:00', from: 22, to: 7 },
  late: { label: '23:00 - 08:00', from: 23, to: 8 },
  evening: { label: '18:00 - 09:00', from: 18, to: 9 },
};
const QUIET_ORDER = ['off', 'night', 'late', 'evening'];

// The pet window is a square of this many pixels. The art is drawn at 150 and scaled by the renderer.
const SIZES = {
  s: { label: 'Small', px: 100 },
  m: { label: 'Medium', px: 150 },
  l: { label: 'Large', px: 200 },
  xl: { label: 'Extra large', px: 250 },
};
const SIZE_ORDER = ['s', 'm', 'l', 'xl'];
const OPACITIES = [100, 85, 70, 50, 30]; // percent; the list window always stays fully opaque

const DEFAULTS = {
  pet: PetArt.DEFAULT_PET,
  skin: 'default',
  accessory: 'none',
  mustache: 'none',
  size: 'm',
  opacity: 100,
  pack: PetSounds.DEFAULT_PACK,
  volume: PetSounds.DEFAULT_VOLUME,
  quiet: 'off',
  streak: true, // show "n finished today" in the list header
  showTokens: true, // show a chat's token count on its row
  mood: true, // mood memory: a calm pet is sleepy late at night and perky in the morning
  temper: PetMood.DEFAULT_TEMPER, // how lively the pet is most of the time: sleepy | calm | playful | hyper
};

// Every setting is one value out of a fixed list.
function choices() {
  return {
    pet: PetArt.ORDER,
    skin: PetArt.SKIN_ORDER,
    accessory: PetArt.ACCESSORY_ORDER,
    mustache: PetArt.MUSTACHE_ORDER,
    size: SIZE_ORDER,
    opacity: OPACITIES,
    pack: PetSounds.PACK_ORDER,
    volume: PetSounds.VOLUMES,
    quiet: QUIET_ORDER,
    streak: [true, false],
    showTokens: [true, false],
    mood: [true, false],
    temper: PetMood.TEMPER_ORDER,
  };
}

/** Window size in pixels for a size id (the default size for anything unknown). */
function sizePx(id) {
  return (SIZES[id] || SIZES[DEFAULTS.size]).px;
}

/** Returns the look with every field valid; unknown keys are dropped. */
function sanitize(input, base = DEFAULTS) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [key, allowed] of Object.entries(choices())) {
    out[key] = allowed.includes(src[key]) ? src[key] : base[key];
  }
  return out;
}

/** Applies a partial change on top of the current look. */
function merge(current, patch) {
  return sanitize({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) }, current);
}

// How long a chat may wait for you before the pet gets angry, in minutes (0 = never). Shared by the tray and the settings window.
const PATIENCE = [
  { min: 1, label: '1 minute' },
  { min: 2, label: '2 minutes' },
  { min: 5, label: '5 minutes' },
  { min: 10, label: '10 minutes' },
  { min: 0, label: 'Never' },
];
const BEHAVIOUR_DEFAULTS = { muted: false, impatientMin: 2 };

/** The two settings that live outside settings.look (mute, patience): only known keys with valid values get through. */
function sanitizeBehaviour(patch, current = BEHAVIOUR_DEFAULTS) {
  const src = patch && typeof patch === 'object' ? patch : {};
  return {
    muted: typeof src.muted === 'boolean' ? src.muted : current.muted,
    impatientMin: PATIENCE.some((p) => p.min === src.impatientMin) ? src.impatientMin : current.impatientMin,
  };
}

/** True when `date` falls inside the quiet hours preset (which may run past midnight). */
function isQuiet(date, quietId) {
  const q = QUIET[quietId];
  if (!q || q.from === undefined) return false;
  const h = date.getHours() + date.getMinutes() / 60;
  return q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}

// ---------- one pet per project ----------
// A project (see projectKey in state.js) can have its own pet and skin. Only those two: size, accessory and mustache stay global.
// The pet window is a single window; it shows the project's pet while a chat of that project needs you, otherwise the global look.
const PROJECT_LOOK_MAX = 50;
const NEEDS_YOU = new Set(['done', 'question', 'approval']);
const ownKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** { [projectKey]: { pet, skin } } with only valid entries (known pet and skin, sane key, at most PROJECT_LOOK_MAX). */
function sanitizeProjectLooks(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const [key, v] of Object.entries(src)) {
    if (Object.keys(out).length >= PROJECT_LOOK_MAX) break;
    if (typeof key !== 'string' || !key || key.length > 300 || key === '__proto__') continue;
    if (!v || typeof v !== 'object' || !PetArt.ORDER.includes(v.pet)) continue;
    out[key] = { pet: v.pet, skin: PetArt.SKIN_ORDER.includes(v.skin) ? v.skin : 'default' };
  }
  return out;
}

/** Sets (pet = a pet id) or clears (pet = null/unknown) the look of one project; returns the new map. */
function setProjectLook(map, project, pet, skin) {
  const out = sanitizeProjectLooks(map);
  const key = String(project || '');
  if (!key) return out;
  delete out[key];
  if (PetArt.ORDER.includes(pet) && Object.keys(out).length >= PROJECT_LOOK_MAX) delete out[Object.keys(out)[0]]; // full: the oldest choice makes room
  if (PetArt.ORDER.includes(pet)) out[key] = { pet, skin: PetArt.SKIN_ORDER.includes(skin) ? skin : 'default' };
  return sanitizeProjectLooks(out);
}

/**
 * The look to draw now. Only a chat that needs you (done, question, approval; not muted) can switch the pet, and the most recent
 * one wins (ties: the id that sorts first), so two busy projects never make the pet flip with every hook. No such chat, or a
 * project without its own pet: the global look.
 */
function effectiveLook(sessions, base, projectLooks) {
  const looks = projectLooks && typeof projectLooks === 'object' ? projectLooks : {};
  let best = null;
  for (const s of sessions || []) {
    if (s.muted || !NEEDS_YOU.has(s.state)) continue;
    if (!best || s.since > best.since || (s.since === best.since && s.id < best.id)) best = s;
  }
  if (!best || !best.project || !ownKey(looks, best.project)) return base; // the newest chat that needs you has no pet of its own: the global one
  const own = looks[best.project];
  return { ...base, pet: own.pet, skin: own.skin };
}

module.exports = { DEFAULTS, sanitize, merge, choices, isQuiet, sanitizeProjectLooks, setProjectLook, effectiveLook, PROJECT_LOOK_MAX, QUIET, QUIET_ORDER, PATIENCE, BEHAVIOUR_DEFAULTS, sanitizeBehaviour, SIZES, SIZE_ORDER, OPACITIES, sizePx };
