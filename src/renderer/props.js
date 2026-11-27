'use strict';
// The props a pet uses to act out what its chats are doing (a laptop to type on, a book, a terminal...) and the little extras of its idle actions
// (zzz, music notes, a sneeze puff, a heart when you pet it). Pure markup, drawn into one layer on top of the pet; pet.css decides which prop is
// visible for which class on the pet root (doing-type, doing-read, busy, marathon, act-nap, hover-happy ...). Everything is styled by class, never by id or style=.
// The pet supplies where things go (anchors.lap, anchors.top, anchors.mouth), so one set of props fits every pet.
// Loaded as a plain script in the renderer (window.PetProps) and with require() in the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetProps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const f = (v) => String(Math.round(v * 100) / 100);

  // The activities a working chat can show (state.js ACTIVITIES minus the plain 'work', which is just the usual bounce).
  const DOING = ['type', 'read', 'web', 'run', 'think'];
  const MARATHON_MS = 15 * 60_000; // one turn that runs this long makes the pet tired (same number as state.js)
  const BUSY_CHATS = 3; // this many chats working at once make the pet frantic

  // Every prop and the root classes that show it: the contract between this file, pet.css and the tests.
  const PROPS = {
    laptop: ['doing-type'],
    book: ['doing-read'],
    globe: ['doing-web'],
    terminal: ['doing-run'],
    thought: ['doing-think'],
    sweat: ['busy'],
    coffee: ['marathon'],
    zzz: ['act-nap'], // a sleeping pet (no chats) already has its own zz speech bubble
    notes: ['act-dance'],
    puff: ['act-sneeze'],
    heart: ['hover-happy'],
    hand: ['act-wave'],
  };

  /** The markup of the whole prop layer for a pet whose anchors are { lap: [x, y], top: [x, y], mouth: [x, y] } (all in the 150 x 150 art). */
  function markup(anchors) {
    const [lx, ly] = anchors.lap;
    const [tx, ty] = anchors.top;
    const [mx, my] = anchors.mouth;
    const h = Math.max(18, Math.min(30, 148 - ly)); // the laptop never leaves the art

    const laptop = `<g class="prop prop-laptop">`
      + `<rect class="lid" x="${f(lx - 33)}" y="${f(ly)}" width="66" height="${f(h)}" rx="5"/>`
      + `<rect class="lid-edge" x="${f(lx - 33)}" y="${f(ly)}" width="66" height="3" rx="1.5"/>`
      + `<circle class="logo" cx="${f(lx)}" cy="${f(ly + h / 2 + 1)}" r="4"/>`
      + `<ellipse class="paw paw-l" cx="${f(lx - 17)}" cy="${f(ly + 1)}" rx="8" ry="5.5"/>`
      + `<ellipse class="paw paw-r" cx="${f(lx + 17)}" cy="${f(ly + 1)}" rx="8" ry="5.5"/>`
      + `</g>`;

    const book = `<g class="prop prop-book">`
      + `<path class="page" d="M${f(lx - 33)} ${f(ly + 2)} Q${f(lx - 16)} ${f(ly - 4)} ${f(lx)} ${f(ly + 3)} L${f(lx)} ${f(ly + h)} Q${f(lx - 16)} ${f(ly + h - 6)} ${f(lx - 33)} ${f(ly + h - 1)} Z"/>`
      + `<path class="page" d="M${f(lx + 33)} ${f(ly + 2)} Q${f(lx + 16)} ${f(ly - 4)} ${f(lx)} ${f(ly + 3)} L${f(lx)} ${f(ly + h)} Q${f(lx + 16)} ${f(ly + h - 6)} ${f(lx + 33)} ${f(ly + h - 1)} Z"/>`
      + `<path class="page-line" d="M${f(lx - 27)} ${f(ly + 9)} L${f(lx - 6)} ${f(ly + 10)} M${f(lx - 27)} ${f(ly + 15)} L${f(lx - 6)} ${f(ly + 16)} M${f(lx + 6)} ${f(ly + 10)} L${f(lx + 27)} ${f(ly + 9)} M${f(lx + 6)} ${f(ly + 16)} L${f(lx + 27)} ${f(ly + 15)}"/>`
      + `<ellipse class="paw paw-l" cx="${f(lx - 30)}" cy="${f(ly + 3)}" rx="6" ry="4.5"/><ellipse class="paw paw-r" cx="${f(lx + 30)}" cy="${f(ly + 3)}" rx="6" ry="4.5"/>`
      + `</g>`;

    const terminal = `<g class="prop prop-terminal">`
      + `<rect class="term" x="${f(lx - 31)}" y="${f(ly - 3)}" width="62" height="${f(h + 1)}" rx="4"/>`
      + `<rect class="term-bar" x="${f(lx - 31)}" y="${f(ly - 3)}" width="62" height="5" rx="2"/>`
      + `<text class="term-text" x="${f(lx - 24)}" y="${f(ly + h / 2 + 5)}" font-size="13">&gt;</text>`
      + `<rect class="caret" x="${f(lx - 12)}" y="${f(ly + h / 2 - 3)}" width="8" height="3" rx="1"/>`
      + `<ellipse class="paw paw-l" cx="${f(lx - 28)}" cy="${f(ly - 2)}" rx="6" ry="4.5"/><ellipse class="paw paw-r" cx="${f(lx + 28)}" cy="${f(ly - 2)}" rx="6" ry="4.5"/>`
      + `</g>`;

    // a little globe floating beside the head
    const gx = Math.max(16, tx - 54); // on the left: the speech bubble of a working pet sits at the top right
    const gy = Math.max(24, ty + 2);
    const globe = `<g class="prop prop-globe"><g transform="translate(${f(gx)} ${f(gy)})"><g class="float">`
      + `<circle class="globe" r="11"/><ellipse class="globe-line" rx="4.5" ry="11"/><path class="globe-line" d="M-11 0 L11 0 M-9 -5.5 L9 -5.5 M-9 5.5 L9 5.5"/>`
      + `</g></g></g>`;

    const thought = `<g class="prop prop-thought"><g transform="translate(${f(Math.max(24, tx - 48))} ${f(Math.max(20, ty - 18))})">`
      + `<circle class="thought" cx="12" cy="22" r="2.6"/><circle class="thought" cx="6" cy="29" r="1.8"/>`
      + `<ellipse class="thought" cx="18" cy="8" rx="19" ry="12"/>`
      + `<circle class="think-dot d1" cx="9" cy="8" r="2.4"/><circle class="think-dot d2" cx="18" cy="8" r="2.4"/><circle class="think-dot d3" cx="27" cy="8" r="2.4"/>`
      + `</g></g>`;

    const sweat = `<g class="prop prop-sweat"><g transform="translate(${f(tx + 36)} ${f(ty + 6)})"><path class="sweat" d="M0 0 C-6 9 -6 15 0 15 C6 15 6 9 0 0 Z"/></g></g>`;

    const coffee = `<g class="prop prop-coffee"><g transform="translate(${f(Math.min(128, lx + 44))} ${f(ly + h - 16)})">`
      + `<path class="steam s1" d="M-3 -4 C-7 -10 0 -13 -4 -20"/><path class="steam s2" d="M3 -4 C-1 -10 6 -13 2 -20"/>`
      + `<path class="cup" d="M-9 0 L9 0 L7 15 Q0 18 -7 15 Z"/><path class="cup-handle" d="M9 3 Q16 4 8 11"/>`
      + `</g></g>`;

    const zzz = `<g class="prop prop-zzz"><g transform="translate(${f(Math.min(126, tx + 30))} ${f(ty + 4)})">`
      + `<text class="z z1" x="0" y="0" font-size="13">z</text><text class="z z2" x="9" y="-11" font-size="16">z</text><text class="z z3" x="19" y="-24" font-size="20">Z</text>`
      + `</g></g>`;

    const notes = `<g class="prop prop-notes">`
      + `<text class="note n1" x="${f(Math.max(10, tx - 56))}" y="${f(ty + 14)}" font-size="20">&#9834;</text>`
      + `<text class="note n2" x="${f(Math.min(130, tx + 42))}" y="${f(ty + 4)}" font-size="22">&#9835;</text>`
      + `</g>`;

    const puff = `<g class="prop prop-puff"><g transform="translate(${f(mx + 20)} ${f(my + 2)})">`
      + `<circle class="puff p1" cx="0" cy="0" r="4"/><circle class="puff p2" cx="9" cy="-4" r="3"/><circle class="puff p3" cx="15" cy="3" r="2.4"/>`
      + `</g></g>`;

    const heart = `<g class="prop prop-heart"><g transform="translate(${f(tx)} ${f(ty - 4)})"><path class="heart" d="M0 8 C-14 -2 -7 -12 0 -5 C7 -12 14 -2 0 8 Z"/></g></g>`;

    const hand = `<g class="prop prop-hand"><ellipse class="paw hand" cx="${f(Math.min(132, mx + 52))}" cy="${f(my - 14)}" rx="7" ry="10"/></g>`;

    return `<g class="props">${laptop}${book}${terminal}${globe}${thought}${sweat}${coffee}${zzz}${notes}${puff}${heart}${hand}</g>`;
  }

  return { DOING, PROPS, MARATHON_MS, BUSY_CHATS, markup };
});
