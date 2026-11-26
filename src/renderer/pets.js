'use strict';
// The pets as data: each pet supplies its body art and a few face measurements; a shared face
// generator draws the eyes and mouth for every mood, so every pet has art for all seven looks
// (sleeping, calm, working, happy, question, approval, angry). No DOM, so it can be unit tested.
// Loaded as a plain script in the renderer (window.PetArt) and with require() in main and the tests.
// The markup uses attributes and classes only: the page's CSP forbids style="" attributes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetArt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const f = (v) => String(Math.round(v * 100) / 100);
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key); // 'constructor' or '__proto__' must not count as a pet or skin

  // What every pet's markup must contain (test/pets.test.js checks all of them).
  const REQUIRED_IDS = ['body'];
  const REQUIRED_CLASSES = ['eyes-open', 'eyes-happy', 'eyes-closed', 'eyes-angry', 'eyes-worried', 'mouth-calm', 'mouth-happy', 'mouth-worried', 'mouth-angry'];

  /**
   * The five eye looks, the cheeks, the nose and the four mouths, from a handful of measurements.
   * Numbers are written for a 6.5 radius eye; `s` scales them for bigger or smaller eyes.
   */
  function faceMarkup(face) {
    const { cx, eyeY: y, eyeDx: dx, eyeR: r, mouthY: my } = face;
    const mw = face.mouthW || 1;
    const s = r / 6.5;
    const xs = [cx - dx, cx + dx];
    const each = (fn) => xs.map((x, i) => fn(x, i === 0 ? 1 : -1)).join('');
    const circle = (x, cy, rad, cls) => `<circle${cls ? ` class="${cls}"` : ''} cx="${f(x)}" cy="${f(cy)}" r="${f(rad)}"/>`;
    const line = (x1, y1, x2, y2) => `<path class="brow" d="M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}"/>`;
    const arc = (x, y1, cy, w) => `<path d="M${f(x - w)} ${f(y1)} Q${f(x)} ${f(cy)} ${f(x + w)} ${f(y1)}"/>`;
    const mouth = (name, dxm, y1, cy) => `<path class="mouth mouth-${name}" d="M${f(cx - dxm * mw)} ${f(y1)} Q${f(cx)} ${f(cy)} ${f(cx + dxm * mw)} ${f(y1)}"/>`;

    let out = '';
    if (face.cheeks) {
      const c = face.cheeks;
      out += [cx - c.dx, cx + c.dx].map((x) => `<ellipse class="cheek" cx="${f(x)}" cy="${f(c.y)}" rx="${f(c.rx)}" ry="${f(c.ry)}"/>`).join('');
    }
    out += '<g class="eyes eyes-open"><g class="blink">' + each((x) => circle(x, y, r)) + each((x) => circle(x + 2 * s, y - 2.5 * s, 2.2 * s, 'shine')) + '</g></g>';
    out += '<g class="eyes eyes-happy">' + each((x) => arc(x, y + 2 * s, y - 8 * s, 8 * s)) + '</g>';
    out += '<g class="eyes eyes-closed">' + each((x) => arc(x, y, y + 6 * s, 8 * s)) + '</g>';
    out += '<g class="eyes eyes-angry">'
      + each((x) => circle(x, y + 3 * s, r * (5.5 / 6.5)))
      + each((x) => circle(x + 1.8 * s, y + 3 * s - 2 * s, 1.9 * s, 'shine'))
      + each((x, side) => line(x - 12 * s * side, y - 12 * s, x + 9 * s * side, y - 3 * s))
      + '</g>';
    out += '<g class="eyes eyes-worried">'
      + each((x) => circle(x, y + s, r * (7.5 / 6.5)))
      + each((x) => circle(x + 2.5 * s, y + s - 3 * s, 2.6 * s, 'shine'))
      + each((x, side) => line(x - 9 * s * side, y - 7 * s, x + 7 * s * side, y - 14 * s))
      + '</g>';
    if (face.nose) {
      const n = face.nose;
      out += `<path id="nose" d="M${f(cx - n.w)} ${f(n.y)} L${f(cx + n.w)} ${f(n.y)} L${f(cx)} ${f(n.y + n.h)} Z"/>`;
    }
    out += mouth('calm', 7, my, my + 6) + mouth('happy', 9, my - 1, my + 12) + mouth('worried', 7, my + 3, my - 3) + mouth('angry', 9, my + 6, my - 4);
    return out;
  }

  // ---------- colours ----------
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  /** `t` of the way from colour a to colour b, both '#rrggbb'. */
  function mix(a, b, t) {
    const [x, y] = [hex(a), hex(b)];
    return toHex(x.map((v, i) => v + (y[i] - v) * t));
  }
  /** A pet's colours with everything the CSS needs: the flushed and angry body, the darker shade, the nose. */
  function fillColors(c) {
    return {
      ...c,
      flush: c.flush || mix(c.body, '#ff6f5e', 0.45),
      angry: c.angry || mix(c.body, '#ff4a36', 0.7),
      dark: c.dark || mix(c.body, '#000000', 0.22),
      nose: c.nose || '#d97a7a',
    };
  }

  // ---------- skins and accessories ----------
  // A skin recolours the body of any pet (the flush, angry and darker shades follow from it). `ink` is the colour
  // of the eyes and mouth on that body; it only applies to pets whose face sits on the body itself.
  const SKINS = {
    default: { label: 'Original' },
    ginger: { label: 'Ginger', body: '#f0a24f', ink: '#3b2a1e' },
    cream: { label: 'Cream', body: '#f6e3c1', ink: '#4a3b2a' },
    grey: { label: 'Grey', body: '#aab1bd', ink: '#2c3138' },
    black: { label: 'Black', body: '#3b3e48', ink: '#f6e58a', dark: true },
    white: { label: 'White', body: '#fbfbfd', ink: '#3a3a4a' },
    pink: { label: 'Pink', body: '#f6a6c1', ink: '#4a2a3a' },
    blue: { label: 'Blue', body: '#7fb6ef', ink: '#1f3350' },
    green: { label: 'Green', body: '#8bd48f', ink: '#1f4a2a' },
    purple: { label: 'Purple', body: '#b08cf0', ink: '#2e2250' },
  };
  const SKIN_ORDER = ['default', 'ginger', 'cream', 'grey', 'black', 'white', 'pink', 'blue', 'green', 'purple'];

  // Drawn around (0, 0) = the middle of the top of the head, upwards; `at` moves it from the pet's anchors.top.
  const ACCESSORIES = {
    none: { label: 'None' },
    bow: {
      label: 'Bow',
      at: [26, 8],
      art: '<g transform="rotate(-18)"><path d="M0 0 L-15 -10 L-15 10 Z" fill="#ff5d8f"/><path d="M0 0 L15 -10 L15 10 Z" fill="#ff5d8f"/><circle r="4.5" fill="#d93a6e"/></g>',
    },
    hat: {
      label: 'Top hat',
      at: [0, 4],
      art: '<rect x="-14" y="-26" width="28" height="28" rx="3" fill="#2d2f3a"/><rect x="-14" y="-10" width="28" height="6" fill="#e8574b"/><ellipse cx="0" cy="2" rx="23" ry="5" fill="#2d2f3a"/>',
    },
    crown: {
      label: 'Crown',
      at: [0, 5],
      art: '<path d="M-18 2 L-21 -20 L-9 -10 L0 -25 L9 -10 L21 -20 L18 2 Z" fill="#ffcf3f" stroke="#d99a00" stroke-width="2" stroke-linejoin="round"/><circle cx="0" cy="-8" r="2.8" fill="#e8574b"/><circle cx="-10" cy="-2" r="2" fill="#4a9be8"/><circle cx="10" cy="-2" r="2" fill="#4a9be8"/>',
    },
    party: {
      label: 'Party hat',
      at: [0, 4],
      art: '<g transform="rotate(10)"><path d="M-15 3 L0 -36 L15 3 Z" fill="#ff7ab6"/><path d="M-10 -9 L10 -9 M-6 -19 L6 -19" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/><circle cx="0" cy="-38" r="4.5" fill="#ffe36e"/></g>',
    },
  };
  const ACCESSORY_ORDER = ['none', 'bow', 'hat', 'crown', 'party'];

  // ---------- the pets ----------
  // Layers, back to front: tail, back (ears, wings), body, front (feet, belly, muzzle), face.
  // `tail` is the part that wags (a tail, an antenna, a flipper, the sun's rays): {d, origin} for a plain
  // stroke or {markup, origin} for a group, which must carry id="tail". Shapes that should follow the pet's
  // colour use the classes fur (the body colour), dark (a darker shade), inner (belly, muzzle) and beak (the nose colour).
  // anchors.vein: the centre of the anger mark; anchors.top: the top of the head, for accessories.
  const sunRays = Array.from({ length: 12 }, (_, i) => `<path class="fur" stroke="none" d="M75 31 L64 55 L86 55 Z" transform="rotate(${i * 30} 75 88)"/>`).join('');
  const PETS = {
    cat: {
      label: 'Cat',
      colors: { body: '#f2b872', flush: '#f4a08a', angry: '#ee8062', ink: '#3b2a1e', inner: '#f4a6a0', blush: '#f4a6a0' },
      tail: { d: 'M112 118 C140 114 146 88 131 78', origin: '112px 118px' },
      back: '<path class="ear fur" d="M42 66 L38 30 L68 50 Z"/><path class="ear fur" d="M108 66 L112 30 L82 50 Z"/>'
        + '<path class="inner" d="M45 58 L43 40 L58 50 Z"/><path class="inner" d="M105 58 L107 40 L92 50 Z"/>',
      body: '<ellipse id="body" class="fur" cx="75" cy="94" rx="47" ry="41"/>',
      front: '<ellipse class="foot fur" cx="54" cy="132" rx="13" ry="7"/><ellipse class="foot fur" cx="96" cy="132" rx="13" ry="7"/>',
      face: { cx: 75, eyeY: 90, eyeDx: 18, eyeR: 6.5, mouthY: 106, nose: { y: 99, w: 4, h: 5 }, cheeks: { dx: 31, y: 102, rx: 8, ry: 5 } },
      anchors: { vein: [75, 38], top: [75, 52] },
    },
    dog: {
      label: 'Dog',
      colors: { body: '#d9a066', ink: '#3b2a1e', inner: '#f8e6c4', blush: '#f4a6a0', nose: '#3b2a1e' },
      mouthOnInner: true, // the mouth is drawn on the muzzle
      tail: { d: 'M114 116 C134 112 140 96 132 86', origin: '114px 116px' },
      back: '',
      body: '<ellipse id="body" class="fur" cx="75" cy="94" rx="47" ry="41"/>',
      front: '<ellipse class="dark" cx="94" cy="82" rx="14" ry="13" transform="rotate(-15 94 82)"/>'
        + '<ellipse class="inner" cx="75" cy="106" rx="22" ry="15"/>'
        + '<ellipse class="foot fur" cx="54" cy="132" rx="13" ry="7"/><ellipse class="foot fur" cx="96" cy="132" rx="13" ry="7"/>'
        + '<ellipse class="ear dark" cx="33" cy="76" rx="13" ry="27" transform="rotate(12 33 76)"/>'
        + '<ellipse class="ear dark" cx="117" cy="76" rx="13" ry="27" transform="rotate(-12 117 76)"/>',
      face: { cx: 75, eyeY: 86, eyeDx: 19, eyeR: 6.5, mouthY: 108, nose: { y: 96, w: 6, h: 5 }, cheeks: { dx: 38, y: 100, rx: 6, ry: 4 } },
      anchors: { vein: [75, 36], top: [75, 54] },
    },
    bunny: {
      label: 'Bunny',
      colors: { body: '#f1e7ea', ink: '#4a3b44', inner: '#f6b5c5', blush: '#f6a5b8', nose: '#ef8fa6' },
      tail: { markup: '<g id="tail"><circle class="fur" cx="117" cy="122" r="11" stroke="none"/></g>', origin: '117px 122px' },
      back: '<ellipse class="ear fur" cx="55" cy="38" rx="11" ry="30" transform="rotate(-6 55 38)"/><ellipse class="ear fur" cx="95" cy="38" rx="11" ry="30" transform="rotate(6 95 38)"/>'
        + '<ellipse class="inner" cx="55" cy="40" rx="5.5" ry="21" transform="rotate(-6 55 40)"/><ellipse class="inner" cx="95" cy="40" rx="5.5" ry="21" transform="rotate(6 95 40)"/>',
      body: '<ellipse id="body" class="fur" cx="75" cy="97" rx="45" ry="39"/>',
      front: '<ellipse class="foot fur" cx="55" cy="132" rx="12" ry="7"/><ellipse class="foot fur" cx="95" cy="132" rx="12" ry="7"/>',
      face: { cx: 75, eyeY: 92, eyeDx: 18, eyeR: 6.5, mouthY: 108, nose: { y: 100, w: 3.5, h: 4 }, cheeks: { dx: 31, y: 104, rx: 8, ry: 5 } },
      anchors: { vein: [75, 36], top: [75, 58] },
    },
    bird: {
      label: 'Bird',
      colors: { body: '#6dbbea', ink: '#26384d', inner: '#fff1d2', blush: '#f4a6a0', nose: '#f5a623' },
      mouthOnInner: true,
      tail: { d: 'M112 114 C134 120 144 108 142 94', origin: '112px 114px' },
      back: '<path class="fur" d="M62 58 Q56 36 69 46 Q72 30 80 46 Q94 36 88 58 Z"/>',
      body: '<ellipse id="body" class="fur" cx="75" cy="94" rx="45" ry="41"/>',
      front: '<ellipse class="inner" cx="75" cy="112" rx="27" ry="21"/>'
        + '<ellipse class="dark" cx="35" cy="100" rx="10" ry="22" transform="rotate(12 35 100)"/><ellipse class="dark" cx="115" cy="100" rx="10" ry="22" transform="rotate(-12 115 100)"/>'
        + '<ellipse class="beak" cx="58" cy="135" rx="9" ry="4.5"/><ellipse class="beak" cx="92" cy="135" rx="9" ry="4.5"/>',
      face: { cx: 75, eyeY: 82, eyeDx: 20, eyeR: 6.5, mouthY: 112, mouthW: 0.8, nose: { y: 91, w: 8, h: 12 }, cheeks: { dx: 33, y: 98, rx: 7, ry: 4.5 } },
      anchors: { vein: [75, 30], top: [75, 52] },
    },
    penguin: {
      label: 'Penguin',
      colors: { body: '#3f5272', ink: '#1f2733', inner: '#f6f8fc', blush: '#f4a6a0', nose: '#f5a623' },
      faceOnBody: false, // the eyes sit on a white patch
      tail: { markup: '<g id="tail"><ellipse class="dark" cx="121" cy="100" rx="9" ry="24" transform="rotate(-14 121 100)" stroke="none"/></g>', origin: '118px 80px' },
      back: '<ellipse class="dark" cx="29" cy="100" rx="9" ry="24" transform="rotate(14 29 100)"/>',
      body: '<ellipse id="body" class="fur" cx="75" cy="92" rx="43" ry="46"/>',
      front: '<ellipse class="inner" cx="75" cy="92" rx="33" ry="23"/><ellipse class="inner" cx="75" cy="112" rx="29" ry="25"/>'
        + '<ellipse class="beak" cx="56" cy="136" rx="11" ry="5"/><ellipse class="beak" cx="94" cy="136" rx="11" ry="5"/>',
      face: { cx: 75, eyeY: 86, eyeDx: 17, eyeR: 6, mouthY: 108, mouthW: 0.9, nose: { y: 95, w: 7, h: 8 }, cheeks: { dx: 27, y: 100, rx: 7, ry: 4 } },
      anchors: { vein: [75, 32], top: [75, 48] },
    },
    owl: {
      label: 'Owl',
      colors: { body: '#b98a5e', ink: '#2e2118', inner: '#f7edd9', blush: '#e7a38a', nose: '#f5a623' },
      faceOnBody: false, // the eyes sit on cream discs
      tail: { markup: '<g id="tail"><ellipse class="dark" cx="121" cy="102" rx="10" ry="24" transform="rotate(-14 121 102)" stroke="none"/></g>', origin: '118px 82px' },
      back: '<path class="fur" d="M40 64 L36 32 L63 52 Z"/><path class="fur" d="M110 64 L114 32 L87 52 Z"/><ellipse class="dark" cx="29" cy="102" rx="10" ry="24" transform="rotate(14 29 102)"/>',
      body: '<ellipse id="body" class="fur" cx="75" cy="94" rx="45" ry="43"/>',
      front: '<circle class="inner" cx="57" cy="84" r="19"/><circle class="inner" cx="93" cy="84" r="19"/>'
        + '<ellipse class="beak" cx="58" cy="136" rx="9" ry="4.5"/><ellipse class="beak" cx="92" cy="136" rx="9" ry="4.5"/>',
      face: { cx: 75, eyeY: 84, eyeDx: 18, eyeR: 7.5, mouthY: 114, mouthW: 0.8, nose: { y: 94, w: 5, h: 10 } },
      anchors: { vein: [75, 34], top: [75, 52] },
    },
    dragon: {
      label: 'Dragon',
      colors: { body: '#72cf7c', ink: '#23402a', inner: '#f0f7c9', blush: '#f4a68c', nose: '#2f7a42' },
      mouthOnInner: true,
      tail: { markup: '<g id="tail"><path d="M112 118 C140 120 146 98 132 88"/><path class="dark" d="M126 90 L141 83 L135 99 Z" stroke="none"/></g>', origin: '112px 118px' },
      back: '<path class="dark" d="M36 86 C10 74 6 46 22 38 C24 52 34 60 46 64 Z"/><path class="dark" d="M114 86 C140 74 144 46 128 38 C126 52 116 60 104 64 Z"/>'
        + '<path class="inner" d="M52 62 L44 34 L68 52 Z"/><path class="inner" d="M98 62 L106 34 L82 52 Z"/>',
      body: '<ellipse id="body" class="fur" cx="75" cy="94" rx="46" ry="41"/>',
      front: '<ellipse class="inner" cx="75" cy="112" rx="27" ry="20"/>'
        + '<ellipse class="foot fur" cx="54" cy="132" rx="13" ry="7"/><ellipse class="foot fur" cx="96" cy="132" rx="13" ry="7"/>'
        + '<path class="dark" d="M66 55 L72 42 L77 54 Z"/><path class="dark" d="M76 53 L82 40 L87 53 Z"/>',
      face: { cx: 75, eyeY: 88, eyeDx: 18, eyeR: 6.5, mouthY: 108, nose: { y: 98, w: 2.5, h: 3 }, cheeks: { dx: 32, y: 102, rx: 7, ry: 4.5 } },
      anchors: { vein: [75, 36], top: [75, 54] },
    },
    sprout: {
      label: 'Sprout',
      colors: { body: '#9482f2', ink: '#2b2550', inner: '#8fe3a8', blush: '#f6a5c0', nose: '#2b2550' },
      mouthOnInner: true,
      tail: { markup: '<g id="tail"><path d="M112 118 C136 124 146 102 134 92"/><circle class="inner" cx="133" cy="88" r="9" stroke="none"/></g>', origin: '112px 118px' },
      back: '<circle class="dark" cx="36" cy="66" r="14"/><circle class="dark" cx="114" cy="66" r="14"/>',
      body: '<ellipse id="body" class="fur" cx="75" cy="95" rx="46" ry="41"/>',
      front: '<path class="inner" d="M75 56 C70 40 58 36 50 41 C57 51 66 56 75 56 Z"/><path class="inner" d="M75 56 C80 40 92 36 100 41 C93 51 84 56 75 56 Z"/>'
        + '<ellipse class="inner" cx="75" cy="114" rx="21" ry="15"/>'
        + '<ellipse class="foot fur" cx="54" cy="133" rx="12" ry="7"/><ellipse class="foot fur" cx="96" cy="133" rx="12" ry="7"/>',
      face: { cx: 75, eyeY: 90, eyeDx: 19, eyeR: 7, mouthY: 106, nose: { y: 99, w: 3, h: 3.5 }, cheeks: { dx: 33, y: 102, rx: 8, ry: 5 } },
      anchors: { vein: [75, 36], top: [75, 54] },
    },
    blob: {
      label: 'Blob',
      colors: { body: '#7fdcae', ink: '#1f4a39', inner: '#d6f7e7', blush: '#f5a7b5' },
      back: '',
      body: '<path id="body" class="fur" d="M26 112 C20 72 50 46 75 46 C102 46 130 72 124 112 C122 130 108 137 75 137 C42 137 28 130 26 112 Z"/>',
      front: '<ellipse class="inner" cx="52" cy="68" rx="10" ry="5.5" transform="rotate(-30 52 68)"/>',
      face: { cx: 75, eyeY: 92, eyeDx: 19, eyeR: 7, mouthY: 108, cheeks: { dx: 33, y: 104, rx: 8, ry: 5 } },
      anchors: { vein: [75, 36], top: [75, 48] },
    },
    ghost: {
      label: 'Ghost',
      colors: { body: '#f3f0ff', ink: '#3a3558', inner: '#ffffff', blush: '#f6a5c0' },
      back: '',
      body: '<path id="body" class="fur" d="M27 122 C27 72 46 44 75 44 C104 44 123 72 123 122 L123 136 C115 129 108 139 99 134 C91 130 84 139 75 134 C66 139 59 130 51 134 C42 139 35 129 27 136 Z"/>',
      front: '',
      face: { cx: 75, eyeY: 86, eyeDx: 19, eyeR: 7.5, mouthY: 106, cheeks: { dx: 33, y: 102, rx: 8, ry: 5 } },
      anchors: { vein: [75, 34], top: [75, 46] },
    },
    robot: {
      label: 'Robot',
      colors: { body: '#a9bdd0', ink: '#7df5c8', inner: '#27323f', blush: '#7df5c8', nose: '#e8574b' },
      faceOnBody: false, // the face is on the dark screen
      tail: { markup: '<g id="tail"><path d="M75 56 L75 38"/><circle class="beak" cx="75" cy="33" r="6.5" stroke="none"/></g>', origin: '75px 56px' },
      back: '<rect class="dark" x="20" y="80" width="14" height="26" rx="5"/><rect class="dark" x="116" y="80" width="14" height="26" rx="5"/>',
      body: '<rect id="body" class="fur" x="30" y="54" width="90" height="80" rx="18"/>',
      front: '<rect class="inner" x="40" y="64" width="70" height="46" rx="11"/>'
        + '<rect class="dark" x="42" y="132" width="24" height="7" rx="3"/><rect class="dark" x="84" y="132" width="24" height="7" rx="3"/>'
        + '<circle class="dark" cx="46" cy="122" r="3"/><circle class="dark" cx="104" cy="122" r="3"/>',
      face: { cx: 75, eyeY: 84, eyeDx: 16, eyeR: 6, mouthY: 98, mouthW: 0.9 },
      vars: { '--tail-w': '5' },
      anchors: { vein: [75, 34], top: [75, 54], bow: [112, 57] },
    },
    alien: {
      label: 'Alien',
      colors: { body: '#a6e46c', ink: '#16251a', inner: '#e4fbc2', blush: '#7fd05a', nose: '#6aa83e' },
      tail: { markup: '<g id="tail"><path d="M60 52 C56 40 50 34 46 30"/><path d="M90 52 C94 40 100 34 104 30"/><circle class="inner" cx="45" cy="27" r="6" stroke="none"/><circle class="inner" cx="105" cy="27" r="6" stroke="none"/></g>', origin: '75px 52px' },
      back: '',
      body: '<path id="body" class="fur" d="M75 44 C108 44 126 70 120 100 C116 124 98 137 75 137 C52 137 34 124 30 100 C24 70 42 44 75 44 Z"/>',
      front: '',
      face: { cx: 75, eyeY: 90, eyeDx: 20, eyeR: 9, mouthY: 114, mouthW: 0.8 },
      vars: { '--tail-w': '4' },
      anchors: { vein: [75, 34], top: [75, 46] },
    },
    car: {
      label: 'Car',
      colors: { body: '#e8574b', ink: '#2b2b33', inner: '#cfe9f5', blush: '#ffb7a8', nose: '#ffe58a' },
      faceOnBody: false, // the eyes are in the windscreen
      tail: { d: 'M104 52 L118 34', origin: '104px 52px' },
      back: '<path class="fur" d="M38 80 L50 50 L100 50 L112 80 Z"/>',
      body: '<rect id="body" class="fur" x="20" y="76" width="110" height="54" rx="17"/>',
      front: '<path class="inner" d="M47 76 L55 55 L95 55 L103 76 Z"/>'
        + '<circle class="beak" cx="35" cy="100" r="8"/><circle class="beak" cx="115" cy="100" r="8"/>'
        + '<rect class="dark" x="26" y="119" width="98" height="10" rx="5"/>'
        + '<ellipse class="dark" cx="38" cy="132" rx="13" ry="9"/><ellipse class="dark" cx="112" cy="132" rx="13" ry="9"/>',
      face: { cx: 75, eyeY: 68, eyeDx: 15, eyeR: 5.5, mouthY: 101, mouthW: 1.2 },
      vars: { '--tail-w': '3' },
      anchors: { vein: [75, 32], top: [75, 50], bow: [107, 64] },
    },
    sun: {
      label: 'Sun',
      colors: { body: '#ffd23f', ink: '#5a3410', inner: '#fff0a8', blush: '#ff9a5c', flush: '#ffa05a', angry: '#ff6a3c' },
      tail: { markup: `<g id="tail" stroke="none">${sunRays}</g>`, origin: '75px 88px' },
      back: '',
      body: '<circle id="body" class="fur" cx="75" cy="88" r="38"/>',
      front: '',
      face: { cx: 75, eyeY: 84, eyeDx: 14, eyeR: 5.5, mouthY: 98, mouthW: 0.9, cheeks: { dx: 24, y: 96, rx: 6.5, ry: 4 } },
      anchors: { vein: [75, 22], top: [75, 52] },
    },
    moon: {
      label: 'Moon',
      colors: { body: '#f2e4a6', ink: '#4a4326', inner: '#ffffff', blush: '#f0a98c' },
      tail: { markup: '<g id="tail"><path d="M122 60 L125 69 L134 72 L125 75 L122 84 L119 75 L110 72 L119 69 Z" fill="#ffe36e" stroke="none"/></g>', origin: '122px 72px' },
      back: '',
      body: '<circle id="body" class="fur" cx="75" cy="92" r="43"/>',
      front: '<circle class="dark" cx="48" cy="72" r="7"/><circle class="dark" cx="104" cy="112" r="9"/><circle class="dark" cx="100" cy="70" r="4.5"/><circle class="dark" cx="52" cy="116" r="5.5"/><circle class="dark" cx="75" cy="128" r="3.5"/>',
      face: { cx: 75, eyeY: 90, eyeDx: 17, eyeR: 6.5, mouthY: 106, cheeks: { dx: 30, y: 102, rx: 7.5, ry: 4.5 } },
      anchors: { vein: [75, 36], top: [75, 50] },
    },
    cloud: {
      label: 'Cloud',
      colors: { body: '#e3effa', ink: '#46566f', inner: '#ffffff', blush: '#f5a9bd' },
      tail: { markup: '<g id="tail"><path d="M138 100 L127 118 L136 118 L128 136 L148 111 L138 111 L146 100 Z" fill="#ffd23f" stroke="none"/></g>', origin: '138px 100px' },
      back: '<circle class="fur" cx="46" cy="100" r="24"/><circle class="fur" cx="104" cy="98" r="26"/><circle class="fur" cx="60" cy="72" r="22"/><circle class="fur" cx="92" cy="70" r="20"/>',
      body: '<ellipse id="body" class="fur" cx="75" cy="94" rx="40" ry="38"/>',
      front: '<ellipse class="fur" cx="75" cy="118" rx="50" ry="16"/>',
      face: { cx: 75, eyeY: 90, eyeDx: 18, eyeR: 6.5, mouthY: 106, cheeks: { dx: 31, y: 102, rx: 8, ry: 5 } },
      anchors: { vein: [75, 36], top: [75, 46] },
    },
  };
  const ORDER = ['cat', 'dog', 'bunny', 'bird', 'penguin', 'owl', 'dragon', 'sprout', 'blob', 'ghost', 'robot', 'alien', 'car', 'sun', 'moon', 'cloud'];
  const DEFAULT_PET = 'cat';

  /** The pet's colours under a skin: the body changes, the shades are worked out again from it. */
  function colorsFor(p, skinId) {
    const skin = own(SKINS, skinId) ? SKINS[skinId] : null;
    if (!skin || !skin.body) return fillColors(p.colors);
    const { flush, angry, dark, ...rest } = p.colors;
    const out = { ...rest, body: skin.body, ink: p.faceOnBody === false ? p.colors.ink : skin.ink };
    // light eyes and mouth on a dark body would vanish on a pale muzzle or belly: darken that patch too
    if (skin.dark && p.mouthOnInner) out.inner = mix(skin.body, '#ffffff', 0.28);
    return fillColors(out);
  }

  /** Everything the renderer needs to draw one pet: the markup for #tilt, CSS variables for #root, anchors. */
  function buildPet(id, skinId, accessoryId) {
    const key = own(PETS, id) ? id : DEFAULT_PET;
    const p = PETS[key];
    const c = colorsFor(p, skinId);
    const tail = p.tail ? p.tail.markup || `<path id="tail" d="${p.tail.d}"/>` : '';
    const acc = own(ACCESSORIES, accessoryId) ? ACCESSORIES[accessoryId] : null;
    // a bow goes to the pet's own spot when it has one (car, robot), else beside the top of the head
    const spot = accessoryId === 'bow' && p.anchors.bow ? p.anchors.bow : acc && acc.art ? [p.anchors.top[0] + acc.at[0], p.anchors.top[1] + acc.at[1]] : null;
    const accessory = spot ? `<g class="accessory" transform="translate(${spot[0]} ${spot[1]})">${acc.art}</g>` : '';
    const markup = tail + p.back + p.body + p.front + faceMarkup(p.face) + accessory;
    const vars = {
      '--fur': c.body,
      '--fur-flush': c.flush,
      '--fur-angry': c.angry,
      '--fur-dark': c.dark,
      '--ink': c.ink,
      '--inner': c.inner,
      '--blush': c.blush,
      '--nose': c.nose,
      '--tail-origin': p.tail ? p.tail.origin : '75px 134px',
      '--tail-w': '10',
      '--eye-origin': `${p.face.cx}px ${p.face.eyeY}px`,
      ...(p.vars || {}),
    };
    // anchors.vein is stored as the centre of the mark; the renderer wants the offset from the cat's spot
    const anchors = { top: p.anchors.top, vein: [p.anchors.vein[0] - 75, p.anchors.vein[1] - 38] };
    return { id: key, label: p.label, markup, vars, anchors, hasTail: Boolean(p.tail) };
  }

  // ---------- idle animations ----------
  // Short things a calm pet does now and then, on top of the blinking and breathing that never stop.
  // Each is a class on #root (act-<name>) that lasts `ms`; wag needs a tail (or antenna, flipper, rays) to wag.
  const IDLE_ACTIONS = {
    stretch: { ms: 1800 },
    yawn: { ms: 2000 },
    look: { ms: 1800 },
    wag: { ms: 1500, needsTail: true },
  };
  const IDLE_GAP = [8000, 20000]; // wait between two actions, in ms

  /** The name of the next idle action, never one the pet cannot do. */
  function pickIdleAction(hasTail, rand = Math.random) {
    const names = Object.keys(IDLE_ACTIONS).filter((n) => hasTail || !IDLE_ACTIONS[n].needsTail);
    return names[Math.min(names.length - 1, Math.floor(rand() * names.length))];
  }
  function nextIdleDelay(rand = Math.random) {
    return Math.round(IDLE_GAP[0] + rand() * (IDLE_GAP[1] - IDLE_GAP[0]));
  }

  return { PETS, ORDER, DEFAULT_PET, SKINS, SKIN_ORDER, ACCESSORIES, ACCESSORY_ORDER, IDLE_ACTIONS, IDLE_GAP, pickIdleAction, nextIdleDelay, REQUIRED_IDS, REQUIRED_CLASSES, buildPet, faceMarkup, mix, fillColors };
});
