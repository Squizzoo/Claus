'use strict';
// How the pet looks and sounds, chosen in the settings window or the tray and kept in pet-settings.json (settings.look).
// Pure: validates whatever is loaded or sent so a bad value can never end up in the settings file.
const PetArt = require('./renderer/pets');
const PetSounds = require('./renderer/sounds');

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

module.exports = { DEFAULTS, sanitize, merge, choices, isQuiet, QUIET, QUIET_ORDER, PATIENCE, BEHAVIOUR_DEFAULTS, sanitizeBehaviour, SIZES, SIZE_ORDER, OPACITIES, sizePx };
