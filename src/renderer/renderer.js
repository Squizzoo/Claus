'use strict';
(() => {
  const ROLE = new URLSearchParams(location.search).get('role') === 'panel' ? 'panel' : 'pet'; // two windows, one page
  const root = document.getElementById('root');
  const petEl = document.getElementById('pet');
  const panel = document.getElementById('panel');
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  const badge = document.getElementById('badge');
  const bubbleText = document.getElementById('bubble-text');
  const chips = document.getElementById('chips');
  const search = document.getElementById('search');
  const optsToggle = document.getElementById('opts-toggle');
  const opts = document.getElementById('opts');
  const footer = document.getElementById('footer');
  const undoBar = document.getElementById('undo-bar');
  const undoText = document.getElementById('undo-text');
  const bulk = document.getElementById('bulk');
  const clearDone = document.getElementById('clear-done');
  const clearIdle = document.getElementById('clear-idle');
  const unhide = document.getElementById('unhide');

  const MAX_PANEL = 480; // same cap as main.js
  const PHRASE = { approval: 'asked for approval', question: 'asked a question', done: 'finished', working: 'working', idle: 'idle' };
  const BUBBLE = { sleep: 'z z', idle: '', working: '…', done: '✓', question: '?', approval: '!' };
  const OPTIONS = {
    groupBy: { values: ['project', 'none'], label: { project: 'Group: by project', none: 'Group: off' } },
    sort: { values: ['needs-me', 'recent'], label: { 'needs-me': 'Sort: needs me first', recent: 'Sort: most recent' } },
    density: { values: ['comfortable', 'compact'], label: { comfortable: 'Rows: comfortable', compact: 'Rows: compact' } },
  };
  const DEFAULT_PREFS = { groupBy: 'project', sort: 'needs-me', density: 'comfortable', collapsed: [], pinned: [], mutedChats: [], mutedProjects: [] };

  let last = {
    sessions: [], mood: 'idle', attention: 0, overdue: false, types: { approval: 0, question: 0, done: 0 },
    counts: { done: 0, idle: 0 }, hiddenCount: 0, undoable: false, undoUntil: 0, undoCount: 0, prefs: DEFAULT_PREFS, expanded: false,
  };
  const tilt = document.getElementById('tilt');
  const veinPos = document.getElementById('vein-pos');
  let audio = null;
  let petId = null; // the pet currently drawn
  let lookKey = ''; // pet, colour and accessory currently drawn
  let listSig = '';
  let sentHeight = -1;
  let query = '';
  let optsOpen = false;
  let undoTimer = null;

  // ---------- list model ----------
  const undoVisible = (state) => state.undoable && Date.now() < state.undoUntil;
  const footerVisible = (state) => undoVisible(state) || state.counts.done > 0 || state.counts.idle > 0 || state.hiddenCount > 0;

  // The height the window wants. Built from the list WITHOUT the search query, so it does not jump while typing.
  function wantedHeight(state) {
    const view = PetView.buildView(state.sessions, state.prefs, '');
    return PetView.wantedHeight(view, { density: state.prefs.density, footer: footerVisible(state), options: optsOpen }, MAX_PANEL);
  }

  // ---------- rendering ----------
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    return Math.floor(s / 3600) + ' h ago';
  }

  function shortAge(ms) {
    const m = Math.floor(Math.max(0, Date.now() - ms) / 60000);
    return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
  }

  function dur(ms) {
    const m = Math.floor(ms / 60000);
    return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  // One chip per kind of notification, kept between renders so they don't replay their pop-in.
  const chipEls = new Map();
  const CHIP = { approval: '!', question: '?', done: '✓' };
  function renderChips(state) {
    const kinds = ['approval', 'question', 'done'].filter((k) => state.types[k] > 0);
    const multi = kinds.length >= 2;
    const late = new Set(state.sessions.filter((s) => s.overdue).map((s) => s.state));
    for (const [k, el] of chipEls) {
      if (!multi || !kinds.includes(k)) { el.remove(); chipEls.delete(k); }
    }
    if (multi) {
      kinds.forEach((k, i) => {
        let el = chipEls.get(k);
        if (!el) {
          el = document.createElement('div');
          el.append(document.createTextNode(CHIP[k]), document.createElement('small'));
          chipEls.set(k, el);
        }
        el.className = `chip k-${k}${late.has(k) ? ' late' : ''}`;
        el.style.setProperty('--i', String(i));
        el.querySelector('small').textContent = String(state.types[k]);
        el.querySelector('small').hidden = state.types[k] < 2;
        chips.append(el); // append keeps urgent-first order: approval, question, done
      });
    }
    return multi;
  }

  const actButton = (act, text, title, on) => {
    const b = document.createElement('button');
    b.className = `act${on ? ' on' : ''}`;
    b.type = 'button';
    b.tabIndex = -1; // pointer only; the keyboard uses p, m and Delete on the focused row
    b.dataset.act = act;
    b.textContent = text;
    b.title = title;
    return b;
  };

  function groupEl(g) {
    const li = document.createElement('li');
    li.className = `group s-${g.state}${g.late ? ' late' : ''}${g.muted ? ' muted' : ''}`;
    li.dataset.key = g.key;
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-expanded', String(!g.collapsed));
    li.title = g.collapsed ? 'Show this project' : 'Hide this project';

    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = g.collapsed ? '▸' : '▾';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = g.label;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `(${g.count})`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    li.append(chev, label, n, dot);
    if (g.kind === 'project' && g.key) { // the "Other" group has no project to mute
      li.append(actButton('mute-project', g.muted ? '🔕' : '🔔', g.muted ? 'Unmute this project' : 'Mute this project', g.muted));
    }
    return li;
  }

  function rowEl(r, showFolder) {
    const li = document.createElement('li');
    li.className = `row s-${r.state}${r.jumpable ? '' : ' nojump'}${r.overdue ? ' late' : ''}${r.muted ? ' muted' : ''}${r.pinned ? ' pinned' : ''}`;
    li.dataset.id = r.id;
    li.dataset.jump = r.jumpable ? '1' : '';
    li.tabIndex = 0;
    li.title = r.jumpable ? 'Open this chat' : 'This chat is not in Claude Desktop, so it cannot be opened from here';

    const dot = document.createElement('span');
    dot.className = 'dot';
    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    if (r.pinned || r.muted) {
      const flag = document.createElement('span');
      flag.className = 'flag';
      flag.textContent = `${r.pinned ? '📌' : ''}${r.muted ? '🔕' : ''} `;
      name.append(flag);
    }
    name.append(document.createTextNode(r.name));
    const sub = document.createElement('div');
    sub.className = 'sub';
    const when = r.overdue ? `waiting ${dur(Date.now() - r.since)}!` : ago(r.since);
    sub.textContent = `${PHRASE[r.state]} · ${when}${showFolder && r.folder ? ' · ' + r.folder : ''}`;
    // compact rows show only a short age; the full line is in the tooltip
    const short = document.createElement('span');
    short.className = 'short';
    short.textContent = shortAge(r.since);
    text.append(name, sub, short);
    if (r.jumpable) li.title = `${r.name}\n${sub.textContent}`;

    const hover = document.createElement('div');
    hover.className = 'hover-acts';
    hover.append(
      actButton('pin', '📌', r.pinned ? 'Unpin' : 'Pin to the top', r.pinned),
      actButton('mute', '🔕', r.mutedChat ? 'Unmute this chat' : 'Mute this chat (no sound, no chip)', r.mutedChat)
    );
    li.append(dot, text, hover);

    if (r.state === 'done' || r.state === 'idle') {
      const x = actButton('x', '×', r.state === 'done' ? 'Dismiss' : 'Hide from the list until it does something', false);
      x.className = 'x';
      li.append(x);
    } else {
      li.append(document.createElement('span'));
    }
    return li;
  }

  /** Puts keyboard focus back on the same row or group after the list was rebuilt. */
  function focusedKey() {
    const a = document.activeElement;
    if (!a || !list.contains(a)) return null;
    return a.dataset.id ? { id: a.dataset.id } : { key: a.dataset.key };
  }
  function restoreFocus(k) {
    if (!k) return;
    const sel = k.id ? `.row[data-id="${CSS.escape(k.id)}"]` : `.group[data-key="${CSS.escape(k.key)}"]`;
    const el = list.querySelector(sel);
    if (el) el.focus({ preventScroll: true });
  }

  function renderBars(state, view) {
    const p = state.prefs;
    for (const [key, o] of Object.entries(OPTIONS)) opts.querySelector(`[data-opt="${key}"]`).textContent = o.label[p[key]];
    opts.hidden = !optsOpen;
    optsToggle.setAttribute('aria-expanded', String(optsOpen));
    optsToggle.classList.toggle('on', optsOpen);

    const showUndo = undoVisible(state);
    footer.hidden = !footerVisible(state);
    undoBar.hidden = !showUndo;
    bulk.hidden = showUndo;
    undoText.textContent = state.undoCount === 1 ? 'Cleared 1 chat' : `Cleared ${state.undoCount} chats`;
    clearDone.hidden = state.counts.done === 0;
    clearDone.textContent = `Clear finished (${state.counts.done})`;
    clearIdle.hidden = state.counts.idle === 0;
    clearIdle.textContent = `Clear idle (${state.counts.idle})`;
    unhide.hidden = state.hiddenCount === 0;
    unhide.textContent = `${state.hiddenCount} hidden · Show`;

    window.clearTimeout(undoTimer);
    if (showUndo) undoTimer = window.setTimeout(() => render(last), Math.max(50, state.undoUntil - Date.now() + 50));

    if (state.sessions.length === 0) {
      empty.textContent = state.hiddenCount > 0 ? 'All chats are hidden.' : 'No chats are open right now.';
    } else if (view.shown === 0) {
      empty.textContent = `No chat matches “${query.trim()}”.`;
    }
  }

  /** Draws the chosen pet into #tilt (only when it changed) and applies its colours. */
  function applyLook(look) {
    const pet = PetArt.buildPet(look && look.pet, look && look.skin, look && look.accessory, look && look.mustache);
    petId = pet.id;
    const key = `${pet.id}/${look && look.skin}/${look && look.accessory}/${look && look.mustache}`;
    if (key !== lookKey) {
      lookKey = key;
      tilt.innerHTML = pet.markup;
      const [dx, dy] = pet.anchors.vein;
      if (dx || dy) veinPos.setAttribute('transform', `translate(${dx} ${dy})`);
      else veinPos.removeAttribute('transform');
    }
    for (const [k, v] of Object.entries(pet.vars)) root.style.setProperty(k, v);
  }

  // ---------- idle animations ----------
  // Only the pet window, only while the pet is calm: every so often it stretches, yawns, looks around or wags.
  let idleAct = ''; // class of the action in progress ('' = none)
  let idleTimer = null;
  let idleWanted = false;
  const stopIdle = () => {
    window.clearTimeout(idleTimer);
    idleAct = '';
  };
  function scheduleIdle() {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      const name = PetArt.pickIdleAction(PetArt.buildPet(last.look && last.look.pet).hasTail);
      idleAct = `act-${name}`;
      root.classList.add(idleAct);
      idleTimer = window.setTimeout(() => {
        root.classList.remove(idleAct);
        idleAct = '';
        scheduleIdle();
      }, PetArt.IDLE_ACTIONS[name].ms);
    }, PetArt.nextIdleDelay());
  }
  function syncIdle(calm) {
    if (ROLE !== 'pet' || calm === idleWanted) return;
    idleWanted = calm;
    if (calm) scheduleIdle();
    else stopIdle();
  }

  function render(state) {
    last = state;
    applyLook(state.look);
    const mood = state.sessions.length === 0 ? 'sleep' : state.mood;
    syncIdle(mood === 'idle' && !state.overdue && state.idleActions !== false);
    root.className = `pet-host role-${ROLE} pet-${petId} side-${state.layout.side} ${state.layout.vertical} mood-${mood}${state.overdue ? ' angry' : ''}${idleAct ? ' ' + idleAct : ''}${root.classList.contains('celebrating') ? ' celebrating' : ''}`;
    const multi = renderChips(state);
    const text = state.overdue && !multi ? (mood === 'question' ? '?!' : '!!') : BUBBLE[mood] ?? '';
    bubbleText.textContent = text;
    document.getElementById('bubble').style.visibility = text && !multi ? 'visible' : 'hidden';

    badge.hidden = state.attention === 0;
    badge.textContent = String(state.attention);
    badge.className = state.attention ? `s-${state.mood}` : '';

    panel.hidden = !state.expanded;
    if (!state.expanded) {
      // a fresh start every time the panel opens
      if (query) { query = ''; search.value = ''; }
      optsOpen = false;
    }

    const view = PetView.buildView(state.sessions, state.prefs, query);
    const today = state.look && state.look.streak && state.finishedToday > 0 ? `✓ ${state.finishedToday} today` : '';
    const waiting = `${state.attention} waiting · ${state.sessions.length} open${today ? ' · ' + today : ''}`;
    count.textContent = !state.sessions.length ? today : query.trim() ? `${view.shown} of ${state.sessions.length} shown` : waiting;
    count.title = today ? `${state.finishedToday} chats finished today` : '';
    renderBars(state, view);
    empty.hidden = view.shown > 0;
    list.hidden = view.shown === 0;
    list.className = state.prefs.density === 'compact' ? 'compact' : '';

    // Rebuild the rows only when what they show has changed. Rebuilding on every render
    // replaces the row under the mouse between press and release, and the click is lost.
    const flat = state.prefs.groupBy === 'none';
    const sig = JSON.stringify([flat, view.items.map((i) => (i.type === 'group'
      ? [i.key, i.label, i.count, i.state, i.late, i.muted, i.collapsed]
      : [i.id, i.name, i.state, i.jumpable, i.overdue, i.muted, i.pinned, i.mutedChat, i.folder, i.since && (i.overdue ? Math.floor((Date.now() - i.since) / 60000) : ago(i.since))]))]);
    if (sig !== listSig) {
      listSig = sig;
      const keep = focusedKey();
      list.textContent = '';
      for (const i of view.items) list.append(i.type === 'group' ? groupEl(i) : rowEl(i, flat));
      restoreFocus(keep);
    }

    // Ask the main process for a different window height only when the wanted height changed.
    if (state.expanded) {
      const want = wantedHeight(state);
      if (want !== sentHeight) {
        sentHeight = want;
        window.pet.panelHeight(want);
      }
    } else {
      sentHeight = -1;
    }

    // Tell the main process once this state is on screen (it reveals the list window after that).
    if (state.paintId) requestAnimationFrame(() => requestAnimationFrame(() => window.pet.painted(state.paintId)));
  }

  // ---------- actions ----------
  const toggled = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const prefs = () => last.prefs;

  function act(h) {
    if (h.type === 'group') {
      if (h.act === 'mute-project') window.pet.setPrefs({ mutedProjects: toggled(prefs().mutedProjects, h.key) });
      else window.pet.setPrefs({ collapsed: toggled(prefs().collapsed, h.key) });
      return;
    }
    if (h.act === 'x') window.pet.dismiss(h.id);
    else if (h.act === 'pin') window.pet.setPrefs({ pinned: toggled(prefs().pinned, h.id) });
    else if (h.act === 'mute') window.pet.setPrefs({ mutedChats: toggled(prefs().mutedChats, h.id) });
    else if (h.jumpable) window.pet.jump(h.id);
  }

  // ---------- clicks on the list (delegated, so a redraw mid-click cannot lose them) ----------
  let pressed = null;
  const hit = (e) => {
    const el = e.target instanceof Element ? e.target : null;
    const item = el && el.closest('.row, .group');
    if (!item) return null;
    const btn = el.closest('[data-act]');
    return {
      type: item.classList.contains('group') ? 'group' : 'row',
      id: item.dataset.id || '',
      key: item.dataset.key || '',
      jumpable: item.dataset.jump === '1',
      act: btn ? btn.dataset.act : '',
    };
  };
  list.addEventListener('pointerdown', (e) => {
    if (e.button === 0) pressed = hit(e);
  });
  list.addEventListener('pointerup', (e) => {
    const down = pressed;
    pressed = null;
    const up = hit(e);
    if (!down || !up || down.type !== up.type || down.id !== up.id || down.key !== up.key || down.act !== up.act) return; // released somewhere else
    act(up);
  });
  list.addEventListener('keydown', (e) => {
    if (e.target.closest('input')) return;
    const h = hit(e);
    if (!h) return;
    if (e.key === 'Enter' || (e.key === ' ' && h.type === 'group')) {
      e.preventDefault();
      act({ ...h, act: '' });
    } else if (h.type === 'row' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'p') act({ ...h, act: 'pin' });
      else if (key === 'm') act({ ...h, act: 'mute' });
      else if (e.key === 'Delete' || e.key === 'Backspace') act({ ...h, act: 'x' });
    }
  });

  // ---------- search, options and the footer ----------
  search.addEventListener('input', () => {
    query = search.value;
    render(last);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = PetView.firstJumpable(PetView.buildView(last.sessions, last.prefs, query));
      if (first) window.pet.jump(first.id);
    }
  });
  optsToggle.addEventListener('click', () => {
    optsOpen = !optsOpen;
    render(last);
  });
  opts.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-opt]') : null;
    if (!b) return;
    const o = OPTIONS[b.dataset.opt];
    const next = o.values[(o.values.indexOf(prefs()[b.dataset.opt]) + 1) % o.values.length];
    window.pet.setPrefs({ [b.dataset.opt]: next });
  });
  clearDone.addEventListener('click', () => window.pet.clearFinished());
  clearIdle.addEventListener('click', () => window.pet.clearIdle());
  unhide.addEventListener('click', () => window.pet.unhide());
  document.getElementById('undo').addEventListener('click', () => window.pet.undo());

  // ---------- keyboard on the whole panel ----------
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (query) {
        query = '';
        search.value = '';
        render(last);
      } else window.pet.collapse();
    } else if (e.key === '/' && last.expanded && e.target !== search) {
      e.preventDefault();
      search.focus();
      search.select();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && last.expanded) {
      const items = [...list.querySelectorAll('.row, .group')];
      const at = items.indexOf(document.activeElement);
      if (e.key === 'ArrowUp' && at <= 0) {
        e.preventDefault();
        search.focus();
      } else if (items.length) {
        e.preventDefault();
        items[e.key === 'ArrowDown' ? Math.min(at + 1, items.length - 1) : at - 1].focus();
      }
    }
  });

  // ---------- sound ----------
  // The tunes live in sounds.js; main.js sends {pack, volume} along, or nothing at all while muted or in quiet hours.
  function playSound(kind, cfg) {
    try {
      audio = audio || new AudioContext();
      const t0 = audio.currentTime;
      for (const n of PetSounds.plan(cfg && cfg.pack, kind, cfg && cfg.volume)) {
        const o = audio.createOscillator();
        const g = audio.createGain();
        const t = t0 + n.start;
        o.type = n.wave;
        o.frequency.value = n.freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(n.gain, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n.len);
        o.connect(g).connect(audio.destination);
        o.start(t);
        o.stop(t + n.len + 0.02);
      }
    } catch { /* no audio device */ }
  }

  // ---------- celebration ----------
  // Several chats finished together: confetti and sparkles over the pet (inside its fixed window) and a higher hop.
  const confetti = document.getElementById('confetti');
  const COLORS = ['#e8574b', '#3b7dd8', '#3fa66a', '#f5a623', '#b08cf0', '#ff7ab6', '#ffd23f'];
  let partyTimer = null;
  function celebrate(count) {
    if (ROLE !== 'pet') return;
    const n = Math.min(40, 14 + count * 4);
    for (let i = 0; i < n; i++) {
      const el = document.createElement('i');
      const spark = i % 4 === 0;
      el.className = spark ? 'piece spark' : 'piece';
      if (spark) el.textContent = '✦';
      const side = Math.random() * 2 - 1;
      el.style.setProperty('--c', COLORS[i % COLORS.length]);
      el.style.setProperty('--x', `${Math.round(side * 70)}px`);
      el.style.setProperty('--yp', `${-Math.round(30 + Math.random() * 40)}px`);
      el.style.setProperty('--y', `${Math.round(30 + Math.random() * 40)}px`);
      el.style.setProperty('--r', `${Math.round((Math.random() * 2 - 1) * 540)}deg`);
      el.style.setProperty('--d', `${Math.round(Math.random() * 250)}ms`);
      el.style.setProperty('--t', `${1500 + Math.round(Math.random() * 700)}ms`);
      confetti.append(el);
    }
    root.classList.add('celebrating');
    window.clearTimeout(partyTimer);
    partyTimer = window.setTimeout(() => {
      confetti.textContent = '';
      root.classList.remove('celebrating');
    }, 2700);
  }

  // ---------- drag vs click on the pet ----------
  let down = null;
  let lastClick = 0;
  const DOUBLE_CLICK_MS = 350;
  petEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    petEl.setPointerCapture(e.pointerId);
    down = { x: e.screenX, y: e.screenY, dragging: false };
  });
  petEl.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!down.dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
      down.dragging = true;
      window.pet.dragStart();
    }
    if (down.dragging) window.pet.dragMove();
  });
  const finish = (e) => {
    if (!down) return;
    const wasDrag = down.dragging;
    down = null;
    if (wasDrag) {
      lastClick = 0; // a drag is never half of a double-click
      window.pet.dragEnd();
    } else if (e.type === 'pointerup') {
      // a single click toggles the list at once; a second click right after it opens the settings window instead
      const now = Date.now();
      if (now - lastClick < DOUBLE_CLICK_MS) {
        lastClick = now; // a third quick click only focuses the settings window again, it does not reopen the list
        window.pet.openSettings();
      } else {
        lastClick = now;
        window.pet.togglePanel(wantedHeight(last));
      }
    }
  };
  petEl.addEventListener('pointerup', finish);
  petEl.addEventListener('pointercancel', finish);
  petEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') window.pet.togglePanel(wantedHeight(last));
  });

  window.pet.onState(render);
  window.pet.onAlert((a) => playSound(PetSounds.topKind(a.states), a.sound));
  window.pet.onCelebrate((c) => {
    celebrate(c.count);
    if (c.sound) playSound('celebrate', c.sound);
  });
  setInterval(() => last.expanded && render(last), 30_000); // refresh "x min ago"
  render({ ...last, layout: { side: 'right', vertical: 'up' } });
})();
