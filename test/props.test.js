'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PetArt = require('../src/renderer/pets');
const Props = require('../src/renderer/props');
const { ACTIVITIES, MARATHON_MS } = require('../src/state');

test('every pet says where the lap and the mouth are, and the laptop stays inside the art', () => {
  for (const id of PetArt.ORDER) {
    const { anchors } = PetArt.buildPet(id);
    const [lx, ly] = anchors.lap;
    assert.ok(lx >= 60 && lx <= 90, `${id} lap x`);
    assert.ok(ly >= 100 && ly <= 118, `${id} lap y`);
    assert.ok(ly > anchors.mouth[1], `${id}: the laptop must sit below the mouth`);
    assert.equal(anchors.mouth.length, 2);
  }
});

test('the props markup is complete, inside the CSP and has no missing measurement', () => {
  for (const id of PetArt.ORDER) {
    const m = Props.markup(PetArt.buildPet(id).anchors);
    assert.ok(!/\sstyle=/.test(m), `${id}: style attributes are blocked by the CSP`);
    assert.ok(!/<script|on\w+=/i.test(m));
    assert.ok(!/NaN|undefined/.test(m), `${id}: a measurement is missing`);
    for (const name of Object.keys(Props.PROPS)) assert.ok(m.includes(`prop-${name}"`), `${id} lacks prop-${name}`);
  }
});

test('every prop is shown by classes that pet.css knows, and every activity has a prop', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/pet.css'), 'utf8');
  for (const [name, classes] of Object.entries(Props.PROPS)) {
    for (const c of classes) assert.ok(css.includes(`.${c}`) && css.includes(`.prop-${name}`), `pet.css never shows .prop-${name} for .${c}`);
  }
  for (const doing of Props.DOING) assert.ok(ACTIVITIES.includes(doing), doing);
  for (const doing of ACTIVITIES.filter((a) => a !== 'work')) assert.ok(Props.DOING.includes(doing), `no prop for ${doing}`);
});

test('the marathon length is the same in the state and in the props', () => {
  assert.equal(Props.MARATHON_MS, MARATHON_MS);
});

test('the idle actions have art in pet.css, the preferred ones exist, and only tail pets chase their tail', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/pet.css'), 'utf8');
  for (const [name, a] of Object.entries(PetArt.IDLE_ACTIONS)) {
    assert.ok(css.includes(`.act-${name}`), `pet.css has no .act-${name}`);
    assert.ok(a.ms >= 1000 && a.ms <= 6000, name);
  }
  assert.ok(PetArt.IDLE_ACTIONS.spin.needsTail);
  for (const n of ['hop', 'dance', 'sneeze', 'wave', 'nap']) assert.ok(PetArt.IDLE_ACTIONS[n] && !PetArt.IDLE_ACTIONS[n].needsTail, n);
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(PetArt.pickIdleAction(false, () => i / 400));
  assert.ok(!seen.has('spin') && !seen.has('wag'), 'a pet without a tail never spins or wags');
});

test('the ant is a pet with antennae that wag', () => {
  assert.ok(PetArt.ORDER.includes('ant'));
  const pet = PetArt.buildPet('ant');
  assert.equal(pet.label, 'Ant');
  assert.ok(pet.hasTail && pet.markup.includes('class="tail"'));
});
