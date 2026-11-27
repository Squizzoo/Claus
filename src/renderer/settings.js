'use strict';
// The settings window. Everything is a click that sends a small patch to the main process (setLook / setBehaviour);
// the main process validates it, saves it, and sends the new state back, so the window, the pet and the tray always agree.
// The pets are drawn with the same PetArt.buildPet as the real pet, so what you see here is exactly what you get.
(() => {
  const $ = (id) => document.getElementById(id);
  let st = null; // the last state from the main process ({look, muted, impatientMin, ...})
  let mood = 'idle'; // the mood the big preview shows (not saved)
  let drawn = ''; // appearance the gallery cards currently show
  let stageKey = ''; // pet and appearance the big preview currently shows

  const MOODS = [
    ['sleep', 'Sleeping'], ['idle', 'Calm'], ['working', 'Working'], ['done', 'Happy'],
    ['question', 'Question'], ['approval', 'Approval'], ['angry', 'Angry'],
  ];

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const svgOf = (markup) => `<svg viewBox="0 0 150 150" aria-hidden="true"><ellipse class="shadow" cx="75" cy="139" rx="34" ry="5.5"/><g class="bob"><g class="tilt">${markup}</g></g></svg>`;
  /** Draws a pet into a .pet-host element, with its colours as CSS variables on that element. */
  function paint(host, petId, look) {
    const pet = PetArt.buildPet(petId, look.skin, look.accessory, look.mustache);
    host.innerHTML = svgOf(pet.markup.replace(/ id="[^"]*"/g, '')); // the same pet is on this page many times: no repeated ids
    for (const [k, v] of Object.entries(pet.vars)) host.style.setProperty(k, v);
    return pet;
  }
  const setChecked = (nodes, test) => nodes.forEach((n) => n.setAttribute('aria-checked', String(test(n))));

  // ---------- tabs ----------
  const tabButtons = [...document.querySelectorAll('#tabs [role=tab]')];
  function showTab(name) {
    for (const b of tabButtons) {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', String(on));
      $(`tab-${b.dataset.tab}`).hidden = !on;
    }
  }
  tabButtons.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------- today's numbers ----------
  /** A length of time for the Today tab: `-` for none, `40s`, `6m`, `1h 05m`. */
  function lengthText(ms) {
    const s = Math.round((ms || 0) / 1000);
    if (s <= 0) return '-';
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }
  // the projects that have their own pet, each with a button to give them the usual one back
  let projectSig = '';
  function renderProjectPets(list) {
    const sig = JSON.stringify(list);
    if (sig === projectSig) return;
    projectSig = sig;
    const box = $('project-pets');
    box.textContent = '';
    if (!list.length) {
      const none = el('p', 'hint');
      none.textContent = 'No project has its own pet yet.';
      box.append(none);
      return;
    }
    for (const p of list) {
      const row = el('div', 'project-pet');
      const name = el('span', 'project-pet-name');
      name.textContent = p.folder || p.key;
      name.title = p.key;
      const pet = el('span', 'project-pet-pet');
      pet.textContent = p.label;
      const seg = el('div', 'seg'); // the .seg class gives the button its chip look
      const reset = el('button');
      reset.type = 'button';
      reset.textContent = 'Use the usual pet';
      reset.addEventListener('click', () => window.pet.clearProjectLook(p.key));
      seg.append(reset);
      row.append(name, pet, seg);
      box.append(row);
    }
  }
  // the list of versions to choose from (fetched on a click); the selection survives the refreshes of the settings state
  let versionSig = '';
  function renderVersions(sys) {
    const vs = sys.versions || { status: 'idle', list: [], available: false };
    $('versions-load').disabled = !sys.updatesAvailable || !vs.available || vs.status === 'loading';
    $('versions-load').textContent = vs.status === 'ready' ? 'Refresh the list' : 'Show versions';
    $('versions-state').textContent = !sys.updatesAvailable ? 'Choosing a version works in the installed version only.'
      : vs.status === 'loading' ? 'Asking GitHub...'
      : vs.status === 'error' ? `The list could not be loaded: ${vs.error}`
      : vs.status === 'ready' && !vs.list.length ? 'No installable versions were found.' : '';
    const show = vs.status === 'ready' && vs.list.length > 0;
    $('versions-box').hidden = !show;
    const sig = JSON.stringify(vs.list);
    if (!show || sig === versionSig) return;
    versionSig = sig;
    const pick = $('version-pick');
    pick.textContent = '';
    for (const v of vs.list) {
      const o = el('option');
      o.value = v.version;
      o.disabled = v.relation === 'same';
      o.textContent = `${v.version}${v.date ? ` (${v.date})` : ''}${v.relation === 'same' ? ' - installed' : v.relation === 'older' ? ' - older' : ' - newer'}`;
      pick.append(o);
    }
    const first = [...pick.options].find((o) => !o.disabled);
    if (first) pick.value = first.value;
  }
  function renderToday(d) {
    if (!d) return;
    $('st-finished').textContent = String(d.finished);
    $('st-waits').textContent = String(d.waits);
    $('st-wait-total').textContent = lengthText(d.waitMs);
    $('st-wait-longest').textContent = lengthText(d.longestMs);
    $('st-work').textContent = lengthText(d.workMs);
  }

  // ---------- one-time construction ----------
  const gallery = $('gallery');
  const cards = PetArt.ORDER.map((id) => {
    const card = el('button', 'card');
    card.type = 'button';
    card.setAttribute('role', 'radio');
    card.dataset.pet = id;
    card.append(el('div', 'pet-host mood-idle still'), el('span', 'name', PetArt.PETS[id].label));
    card.addEventListener('click', () => pick({ pet: id }));
    gallery.append(card);
    return card;
  });
  $('pet-count').textContent = `${PetArt.ORDER.length} to choose from`;
  // arrow keys move through the gallery (a grid of four); Enter or Space picks
  gallery.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = cards.indexOf(document.activeElement) + step;
    if (i >= 0 && i < cards.length) cards[i].focus();
  });

  const moodButtons = MOODS.map(([id, label]) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.dataset.mood = id;
    b.addEventListener('click', () => { mood = id; renderStage(); });
    $('moods').append(b);
    return b;
  });

  const skinButtons = PetArt.SKIN_ORDER.map((id) => {
    const b = el('button', id === 'default' ? 'swatch original' : 'swatch');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.title = PetArt.SKINS[id].label;
    b.setAttribute('aria-label', PetArt.SKINS[id].label);
    b.dataset.skin = id;
    if (id !== 'default') b.style.setProperty('--sw', PetArt.SKINS[id].body);
    b.addEventListener('click', () => pick({ skin: id }));
    $('skins').append(b);
    return b;
  });

  /** A square tile that shows the thing itself (a hat, a mustache), or a plain label for "none". */
  function tile(parent, label, art, viewBox, onPick, data) {
    const b = el('button', 'tile');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.title = label;
    b.setAttribute('aria-label', label);
    Object.assign(b.dataset, data);
    if (art) b.innerHTML = `<svg viewBox="${viewBox}" aria-hidden="true">${art}</svg>`;
    else b.textContent = label;
    b.addEventListener('click', onPick);
    parent.append(b);
    return b;
  }
  const accButtons = PetArt.ACCESSORY_ORDER.map((id) => tile($('accessories'), PetArt.ACCESSORIES[id].label, PetArt.ACCESSORIES[id].art, '-30 -44 60 54', () => pick({ accessory: id }), { accessory: id }));
  const stacheButtons = PetArt.MUSTACHE_ORDER.map((id) => tile($('mustaches'), PetArt.MUSTACHES[id].label, PetArt.MUSTACHES[id].art, '-28 -12 56 24', () => pick({ mustache: id }), { mustache: id }));

  // sound packs: the pack itself, and three small buttons to hear its finished, question and approval sounds
  const KIND_BUTTONS = [['done', '✓', 'Finished'], ['question', '?', 'Question'], ['approval', '!', 'Approval']];
  const packRows = PetSounds.PACK_ORDER.map((id) => {
    const row = el('div', 'pack');
    row.setAttribute('role', 'radio');
    row.dataset.pack = id;
    const name = el('button', 'name', PetSounds.PACKS[id].label);
    name.type = 'button';
    name.addEventListener('click', () => { pick({ pack: id }); window.pet.previewSound({ pack: id, volume: st && st.look.volume, kind: 'done' }); });
    row.append(name);
    for (const [kind, glyph, title] of KIND_BUTTONS) {
      const b = el('button', 'play', glyph);
      b.type = 'button';
      b.title = `Hear the ${title.toLowerCase()} sound`;
      b.setAttribute('aria-label', `${PetSounds.PACKS[id].label}: ${title.toLowerCase()} sound`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        window.pet.previewSound({ pack: id, volume: st && st.look.volume, kind });
      });
      row.append(b);
    }
    row.addEventListener('click', (e) => { if (e.target === row) name.click(); });
    $('packs').append(row);
    return row;
  });

  /** A row of pill buttons, one of which is selected. */
  function segmented(container, items, onPick) {
    container.textContent = '';
    return items.map(([value, label]) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.value = String(value);
      b.addEventListener('click', () => onPick(value));
      container.append(b);
      return b;
    });
  }
  const volumeButtons = segmented($('volume'), PetSounds.VOLUMES.map((v) => [v, `${v}%`]), (v) => {
    pick({ volume: v });
    window.pet.previewSound({ pack: st && st.look.pack, volume: v, kind: 'done' });
  });
  let quietButtons = [];
  let patienceButtons = [];
  let sizeButtons = [];
  let opacityButtons = [];
  let snapButtons = [];
  let monitorButtons = [];
  $('login').addEventListener('change', (e) => window.pet.setSystem({ login: e.target.checked }));
  $('follow-claude').addEventListener('change', (e) => window.pet.setSystem({ followClaude: e.target.checked }));
  $('watch-chat').addEventListener('change', (e) => window.pet.setSystem({ watchChat: e.target.checked }));
  $('wsl').addEventListener('change', (e) => window.pet.setSystem({ wsl: e.target.checked }));
  $('wsl-hooks-install').addEventListener('click', () => window.pet.wslHooksAction('install'));
  $('wsl-hooks-remove').addEventListener('click', () => window.pet.wslHooksAction('uninstall'));
  $('hooks-install').addEventListener('click', () => window.pet.hooksAction('install'));
  $('hooks-remove').addEventListener('click', () => window.pet.hooksAction('uninstall'));
  $('update-check').addEventListener('click', () => window.pet.updateAction('check'));
  $('update-auto').addEventListener('change', (e) => window.pet.setSystem({ updateCheck: e.target.checked }));
  $('versions-load').addEventListener('click', () => window.pet.updateAction('versions'));
  $('version-go').addEventListener('click', () => { const v = $('version-pick').value; if (v) window.pet.chooseVersion(v); });
  $('update-go').addEventListener('click', () => window.pet.updateAction($('update-go').dataset.action));
  $('fullscreen').addEventListener('change', (e) => place({ fullscreen: e.target.checked }));
  $('click-through').addEventListener('change', (e) => place({ clickThrough: e.target.checked }));
  /** Placement changes go to their own message; shown at once, confirmed by the state that comes back. */
  function place(patch) {
    if (st) {
      st = { ...st, place: { ...st.place, ...patch } };
      render();
    }
    window.pet.setPlace(patch);
  }
  const notifyRows = { snooze: [], toast: [], remind: [], autohide: [], nested: [] };
  let kindBoxes = [];

  $('muted').addEventListener('change', (e) => window.pet.setBehaviour({ muted: e.target.checked }));
  $('streak').addEventListener('change', (e) => pick({ streak: e.target.checked }));
  $('show-tokens').addEventListener('change', (e) => pick({ showTokens: e.target.checked }));
  $('mood-memory').addEventListener('change', (e) => pick({ mood: e.target.checked }));

  // ---------- sending changes ----------
  /** Shows the change at once and asks the main process to apply it (it answers with the real state). */
  function pick(patch) {
    if (st) {
      st = { ...st, look: { ...st.look, ...patch } };
      render();
    }
    window.pet.setLook(patch);
  }

  // ---------- drawing the state ----------
  function renderStage() {
    const stage = $('stage');
    stage.className = `pet-host mood-${mood === 'angry' ? 'idle' : mood}${mood === 'angry' ? ' angry' : ''}`;
    for (const b of moodButtons) b.setAttribute('aria-pressed', String(b.dataset.mood === mood));
  }

  function render() {
    if (!st) return;
    const { look } = st;
    const petId = PetArt.PETS[look.pet] ? look.pet : PetArt.DEFAULT_PET;

    // the cards show every pet in the chosen colour, accessory and mustache; only redrawn when those change
    const key = `${look.skin}/${look.accessory}/${look.mustache}`;
    if (key !== drawn) {
      drawn = key;
      cards.forEach((c) => paint(c.firstChild, c.dataset.pet, look));
    }
    setChecked(cards, (c) => c.dataset.pet === petId);
    cards.forEach((c) => { c.tabIndex = c.dataset.pet === petId ? 0 : -1; });

    // the big preview is only redrawn when its pet or appearance changes (it is animated)
    if (`${petId}/${key}` !== stageKey) {
      stageKey = `${petId}/${key}`;
      $('stage-name').textContent = paint($('stage'), petId, look).label;
    }
    renderStage();

    const own = PetArt.PETS[petId].colors.body;
    skinButtons.forEach((b) => { if (b.dataset.skin === 'default') b.style.setProperty('--sw', own); });
    setChecked(skinButtons, (b) => b.dataset.skin === look.skin);
    setChecked(accButtons, (b) => b.dataset.accessory === look.accessory);
    setChecked(stacheButtons, (b) => b.dataset.mustache === look.mustache);

    setChecked(packRows, (r) => r.dataset.pack === look.pack);
    setChecked(volumeButtons, (b) => b.dataset.value === String(look.volume));
    $('muted').checked = st.muted;
    const note = $('sound-note');
    note.hidden = !(st.muted || st.quietNow);
    note.textContent = st.muted ? 'Sounds are muted: the buttons below stay silent until you switch mute off.' : 'Quiet hours are on right now: alerts are silent, but the buttons below still play.';

    if (st.quiet && quietButtons.length !== st.quiet.length) quietButtons = segmented($('quiet'), st.quiet.map((q) => [q.id, q.label]), (id) => pick({ quiet: id }));
    setChecked(quietButtons, (b) => b.dataset.value === look.quiet);
    if (st.sizes && sizeButtons.length !== st.sizes.length) sizeButtons = segmented($('size'), st.sizes.map((s) => [s.id, `${s.label} (${s.px})`]), (id) => pick({ size: id }));
    setChecked(sizeButtons, (b) => b.dataset.value === look.size);
    if (st.opacities && opacityButtons.length !== st.opacities.length) opacityButtons = segmented($('opacity'), st.opacities.map((v) => [v, `${v}%`]), (v) => pick({ opacity: v }));
    setChecked(opacityButtons, (b) => b.dataset.value === String(look.opacity));
    if (st.place && st.placeChoices) {
      if (!snapButtons.length) {
        snapButtons = segmented($('snap'), st.placeChoices.snap.map((x) => [x.id, x.label]), (id) => place({ snap: id }));
        monitorButtons = segmented($('monitor'), st.placeChoices.monitor.map((x) => [x.id, x.label]), (id) => place({ monitor: id }));
      }
      setChecked(snapButtons, (b) => b.dataset.value === st.place.snap);
      setChecked(monitorButtons, (b) => b.dataset.value === st.place.monitor);
      $('fullscreen').checked = st.place.fullscreen;
      $('click-through').checked = st.place.clickThrough;
    }
    if (st.patience && patienceButtons.length !== st.patience.length) patienceButtons = segmented($('patience'), st.patience.map((p) => [p.min, p.label]), (min) => window.pet.setBehaviour({ impatientMin: min }));
    setChecked(patienceButtons, (b) => b.dataset.value === String(st.impatientMin));
    $('streak').checked = look.streak;
    $('show-tokens').checked = look.showTokens;
    $('mood-memory').checked = look.mood;
    renderProjectPets(st.projectPets || []);
    renderToday(st.daily);

    const nt = st.notify;
    const ch = st.notifyChoices;
    if (nt && ch) {
      if (!notifyRows.snooze.length) {
        notifyRows.snooze = segmented($('snooze'), [[0, 'Off'], ...ch.snooze.map((x) => [x.min, x.label])], (min) => window.pet.snooze(min));
        notifyRows.toast = segmented($('toast'), ch.toast.map((x) => [x.id, x.label]), (id) => window.pet.setNotify({ toast: id }));
        notifyRows.remind = segmented($('remind'), ch.remind.map((x) => [x.min, x.label]), (min) => window.pet.setNotify({ remindMin: min }));
        notifyRows.autohide = segmented($('autohide'), ch.autoHide.map((x) => [x.id, x.label]), (id) => window.pet.setNotify({ autoHide: id }));
        notifyRows.nested = segmented($('nested'), ch.nested.map((x) => [x.id, x.label]), (id) => window.pet.setNotify({ nested: id }));
      }
      if (!kindBoxes.length) {
        kindBoxes = ch.kinds.map(({ id, label }) => {
          const wrap = el('label', 'switch');
          const box = el('input');
          box.type = 'checkbox';
          box.dataset.kind = id;
          box.addEventListener('change', () => window.pet.setNotify({ toastKinds: { [id]: box.checked } }));
          wrap.append(box, el('span', 'track'), el('span', 'label', label));
          $('toast-kinds').append(wrap);
          return box;
        });
      }
      for (const box of kindBoxes) {
        box.checked = nt.toastKinds[box.dataset.kind] !== false;
        box.disabled = nt.toast === 'off'; // no toasts at all: the kinds do not matter
      }
      $('toast-kinds').classList.toggle('disabled', nt.toast === 'off');
      const on = nt.snoozeUntil > 0;
      // while snoozing, "Off" ends it; a preset button restarts it from now
      setChecked(notifyRows.snooze, (b) => (on ? false : b.dataset.value === '0'));
      setChecked(notifyRows.toast, (b) => b.dataset.value === nt.toast);
      setChecked(notifyRows.remind, (b) => b.dataset.value === String(nt.remindMin));
      setChecked(notifyRows.autohide, (b) => b.dataset.value === nt.autoHide);
      setChecked(notifyRows.nested, (b) => b.dataset.value === nt.nested);
      const note = $('snooze-note');
      note.hidden = !on;
      if (on) {
        const d = new Date(nt.snoozeUntil);
        note.textContent = `Snoozed until ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}. Press Off to resume now.`;
      }
    }
    $('today').textContent = String(st.finishedToday);
    renderSystem(st.system, st.jump);
  }

  const JUMP_NOTES = {
    broken: 'Opening a chat from the list no longer seems to work: Claude Desktop may have changed the way chats are opened. The list still shows your chats.',
    unverified: 'Claude Desktop was updated. Opening chats from the list has not been checked since; it is checked the next time you open one.',
  };
  /** The System tab: hooks, start with Windows, Claude Desktop and updates. Buttons that this build cannot use are disabled, with the reason. */
  function renderSystem(sys, jump) {
    const jn = $('jump-note');
    jn.hidden = !(jump && JUMP_NOTES[jump.status]);
    if (!jn.hidden) jn.textContent = `${JUMP_NOTES[jump.status]}${jump.version ? ` (Claude ${jump.version}${jump.okVersion && jump.okVersion !== jump.version ? `, last worked with ${jump.okVersion}` : ''})` : ''}`;
    if (!sys) return;
    const h = sys.hooks;
    const hs = $('hooks-state');
    hs.className = h.complete ? 'status' : 'status warn';
    hs.textContent = h.missing ? `No settings file yet: installing creates it (${h.file})` : !h.exists
      ? `Claude Code's settings file was not found or cannot be read (${h.error || 'unknown'}): ${h.file}`
      : h.complete ? `Installed (${h.installed} of ${h.total} entries) in ${h.file}` : h.installed ? `Partly installed (${h.installed} of ${h.total} entries): install again to complete it. ${h.file}` : `Not installed: the pet cannot hear from Claude Code yet. ${h.file}`;
    $('hooks-install').disabled = !(h.exists || h.missing) || h.complete;
    $('hooks-remove').disabled = !h.exists || h.installed === 0;
    $('login').checked = sys.login;
    $('login').disabled = !sys.loginAvailable;
    $('login-hint').textContent = sys.loginAvailable ? 'Start Claus when you sign in to Windows.' : sys.portable ? 'The portable version has no fixed place to start from. Use the installer to start with Windows.' : 'Only the installed version can start with Windows (this one runs from a source folder).';
    $('follow-claude').checked = sys.followClaude;
    $('watch-chat').checked = sys.watchChat;
    $('wsl').checked = sys.wsl.enabled;
    $('wsl-state').textContent = !sys.wsl.enabled ? 'Off.' : sys.wsl.running ? `${sys.wsl.running} distro${sys.wsl.running === 1 ? ' is' : 's are'} running. ${sys.wsl.hooks}.` : 'No WSL distro is running right now.';
    const u = sys.update;
    $('update-state').textContent = u.text || (sys.updatesAvailable ? '' : 'Updates work in the installed version only.');
    $('update-check').disabled = !sys.updatesAvailable || u.status === 'checking' || u.status === 'downloading';
    $('update-auto').checked = sys.updateCheck;
    renderVersions(sys);
    const go = $('update-go');
    const action = u.status === 'available' ? 'download' : u.status === 'ready' ? 'install' : '';
    go.hidden = !action;
    go.dataset.action = action;
    go.className = 'btn primary';
    go.textContent = action === 'download' ? `Download version ${u.version}` : 'Restart to update';
    $('version').textContent = `Claus ${sys.version}${sys.portable ? ' (portable)' : sys.packaged ? '' : ' (development)'}`;
  }

  window.pet.onSettingsState((s) => {
    st = s;
    render();
  });
})();
