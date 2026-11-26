'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PetArt = require('../src/renderer/pets');

const { PETS, ORDER, DEFAULT_PET, REQUIRED_IDS, REQUIRED_CLASSES, buildPet } = PetArt;

test('the registry lists every pet once and the default exists', () => {
  assert.deepEqual([...ORDER].sort(), Object.keys(PETS).sort());
  assert.ok(PETS[DEFAULT_PET]);
});

for (const id of ORDER) {
  test(`${id}: supplies art for every mood`, () => {
    const pet = buildPet(id);
    assert.equal(pet.id, id);
    for (const want of REQUIRED_IDS) assert.ok(pet.markup.includes(`id="${want}"`), `missing #${want}`);
    for (const want of REQUIRED_CLASSES) assert.ok(pet.markup.includes(want), `missing .${want}`);
  });

  test(`${id}: markup stays inside the page's CSP`, () => {
    const pet = buildPet(id);
    assert.ok(!/\sstyle=/.test(pet.markup), 'style attributes are blocked by the CSP');
    assert.ok(!/<script|on\w+=/i.test(pet.markup));
    assert.ok(!/NaN|undefined/.test(pet.markup), 'a measurement is missing');
  });

  test(`${id}: has the variables the CSS reads and a head anchor for the anger mark`, () => {
    const pet = buildPet(id);
    for (const v of ['--fur', '--fur-flush', '--fur-angry', '--ink', '--inner', '--blush', '--tail-origin', '--eye-origin']) {
      assert.match(pet.vars[v], /\S/, v);
    }
    assert.equal(pet.anchors.vein.length, 2);
  });
}

test('an unknown pet falls back to the default', () => {
  assert.equal(buildPet('nope').id, DEFAULT_PET);
  assert.equal(buildPet(undefined).id, DEFAULT_PET);
});

test('the cat face keeps the original measurements', () => {
  const { markup } = buildPet('cat');
  assert.ok(markup.includes('<circle cx="57" cy="90" r="6.5"/>'));
  assert.ok(markup.includes('d="M66 105 Q75 118 84 105"'), 'happy mouth');
  assert.ok(markup.includes('d="M68 109 Q75 103 82 109"'), 'worried mouth');
  assert.ok(markup.includes('d="M66 112 Q75 102 84 112"'), 'angry mouth');
  assert.ok(markup.includes('d="M45 78 L66 87"'), 'angry brow');
  assert.ok(markup.includes('d="M102 83 L86 76"'), 'worried brow, right side');
});

test('mix blends two colours', () => {
  const { mix } = PetArt;
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});

test('every pet gets a flush, an angry and a darker colour that differ from its body', () => {
  for (const id of ORDER) {
    const c = PetArt.fillColors(PETS[id].colors);
    for (const k of ['flush', 'angry', 'dark']) {
      assert.match(c[k], /^#[0-9a-f]{6}$/, `${id} ${k}`);
      assert.notEqual(c[k], c.body, `${id} ${k} should differ from the body`);
    }
  }
});

test('a pet with a tail marks it, a custom tail group carries the id', () => {
  for (const id of ORDER) {
    const pet = buildPet(id);
    assert.equal(pet.hasTail, pet.markup.includes('id="tail"'), id);
  }
});

test('the anger mark offset of the cat is zero', () => {
  assert.deepEqual(buildPet('cat').anchors.vein, [0, 0]);
});

test('every skin and accessory builds for every pet', () => {
  for (const id of ORDER) {
    for (const skin of PetArt.SKIN_ORDER) {
      for (const accessory of PetArt.ACCESSORY_ORDER) {
        const pet = buildPet(id, skin, accessory);
        assert.ok(!/\sstyle=|NaN|undefined/.test(pet.markup), `${id} ${skin} ${accessory}`);
        assert.equal(pet.markup.includes('class="accessory"'), accessory !== 'none', `${id} ${accessory}`);
      }
    }
  }
});

test('the registries list every skin and accessory once', () => {
  assert.deepEqual([...PetArt.SKIN_ORDER].sort(), Object.keys(PetArt.SKINS).sort());
  assert.deepEqual([...PetArt.ACCESSORY_ORDER].sort(), Object.keys(PetArt.ACCESSORIES).sort());
  assert.equal(PetArt.SKIN_ORDER[0], 'default');
  assert.equal(PetArt.ACCESSORY_ORDER[0], 'none');
});

test('a skin recolours the body and recomputes the flush, an unknown skin changes nothing', () => {
  const plain = buildPet('cat');
  const black = buildPet('cat', 'black');
  assert.equal(black.vars['--fur'], PetArt.SKINS.black.body);
  assert.notEqual(black.vars['--fur-flush'], plain.vars['--fur-flush']);
  assert.notEqual(black.vars['--fur-flush'], black.vars['--fur']);
  assert.deepEqual(buildPet('cat', 'nope').vars, plain.vars);
  assert.deepEqual(buildPet('cat', 'default').vars, plain.vars);
});

test('dark skins give light eyes, but not on pets whose face is on a patch or screen', () => {
  assert.equal(buildPet('cat', 'black').vars['--ink'], PetArt.SKINS.black.ink);
  for (const id of ['penguin', 'owl', 'robot', 'car']) {
    assert.equal(buildPet(id, 'black').vars['--ink'], buildPet(id).vars['--ink'], id);
  }
});

test('an accessory sits on the head anchor of its pet', () => {
  const pet = buildPet('dog', 'default', 'hat');
  const [x, y] = PETS.dog.anchors.top;
  assert.ok(pet.markup.includes(`translate(${x + PetArt.ACCESSORIES.hat.at[0]} ${y + PetArt.ACCESSORIES.hat.at[1]})`));
});

test('idle actions: only what the pet can do, and the gap is in range', () => {
  const { pickIdleAction, nextIdleDelay, IDLE_ACTIONS, IDLE_GAP } = PetArt;
  for (let i = 0; i < 200; i++) {
    const r = Math.random;
    assert.ok(!IDLE_ACTIONS[pickIdleAction(false, r)].needsTail, 'a pet without a tail never wags');
    assert.ok(IDLE_ACTIONS[pickIdleAction(true, r)]);
    const d = nextIdleDelay(r);
    assert.ok(d >= IDLE_GAP[0] && d <= IDLE_GAP[1]);
  }
});

test('idle actions: every name is reachable and rand=1 stays in range', () => {
  const { pickIdleAction, IDLE_ACTIONS } = PetArt;
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(pickIdleAction(true, () => i / 100));
  assert.deepEqual([...seen].sort(), Object.keys(IDLE_ACTIONS).sort());
  assert.ok(pickIdleAction(true, () => 1));
  assert.ok(pickIdleAction(false, () => 1));
});

test('object prototype keys are not pets, skins or accessories', () => {
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(buildPet(key).id, DEFAULT_PET);
    assert.deepEqual(buildPet('cat', key, key).vars, buildPet('cat').vars);
    assert.ok(!buildPet('cat', key, key).markup.includes('class="accessory"'));
  }
});

test('the sun draws its rays without the tail outline, so the CSS stroke cannot thicken them', () => {
  const { markup } = buildPet('sun');
  assert.equal((markup.match(/stroke="none" d="M75 31/g) || []).length, 12);
});
