'use strict';
// Pure session-state logic: no Electron, no I/O, so it can be unit tested.
//
// States, from least to most urgent:
//   idle      nothing happening
//   working   Claude is running a turn
//   done      Claude finished its turn (you may want to look)
//   question  Claude asked you something (AskUserQuestion / elicitation)
//   approval  Claude needs a permission approval

const { badgeTokens } = require('./usage');

const PRIORITY = { idle: 0, working: 1, done: 2, question: 3, approval: 4 };
const ATTENTION = new Set(['done', 'question', 'approval']);
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STALE_WORKING_MS = 30_000;
const INTERRUPT_GRACE_MS = 4_000; // how long the registry must show "idle" before a working chat counts as interrupted
const REGISTRY_GRACE_MS = 60_000;
const VIEW_REPORTS = 2; // consecutive "this chat is open" reports before a finished chat counts as seen
// Chat tab conversations (no hooks, no registry): seen through the page of Claude Desktop, see chat-watch.js.
const CHAT_PREFIX = 'chat_';
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHAT_IDLE_READS = 2; // reads in a row without the Stop button before a streaming reply counts as finished (rides out a blip)
const CHAT_GONE_READS = 3; // reads in a row without the page before a chat that was streaming is dropped (it can no longer be seen)

/**
 * Maps one hook payload to the session's next state.
 * Returns a state name, 'removed', or null for "no change".
 */
function nextState(payload, current) {
  const tool = payload.tool_name;
  switch (payload.hook_event_name) {
    case 'SessionStart':
      return 'idle';
    case 'UserPromptSubmit':
      return 'working';
    case 'PreToolUse':
      return tool === 'AskUserQuestion' ? 'question' : 'working';
    case 'PermissionRequest':
      return tool === 'AskUserQuestion' ? 'question' : 'approval';
    case 'PostToolUse':
      return 'working';
    case 'Stop':
    case 'StopFailure':
      return 'done';
    case 'Notification':
      switch (payload.notification_type) {
        case 'permission_prompt':
          return current === 'question' ? null : 'approval';
        case 'elicitation_dialog':
        case 'agent_needs_input':
          return 'question';
        case 'idle_prompt':
          return current === 'question' || current === 'approval' ? null : 'done';
        default:
          return null;
      }
    case 'SessionEnd':
      return 'removed';
    default:
      return null;
  }
}

function basename(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || String(p);
}

const WAITING_ON_YOU = new Set(['question', 'approval']);
const DEFAULT_IMPATIENT_MS = 120_000;
const UNDO_MS = 15_000;

/**
 * The one key a project is known by: grouping, muting and pinning all use it. Hook and registry
 * paths can differ in case or slash style on Windows, so it is lowercase with forward slashes.
 */
function projectKey(cwd) {
  return String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

class SessionStore {
  constructor({ now = Date.now, impatientMs = DEFAULT_IMPATIENT_MS, undoMs = UNDO_MS } = {}) {
    this.now = now;
    this.sessions = new Map();
    this.registrySynced = false;
    this.alerts = []; // pending {id, state} for the UI to chime
    this.finished = []; // pending {id, muted, at}: every chat that just finished, muted or not (for the day counter and the celebration)
    this.impatientMs = impatientMs; // 0 = never gets angry
    this.undoMs = undoMs;
    this.mutedIds = new Set();
    this.mutedProjects = new Set();
    this.lastClear = null; // {at, items} of the last x / bulk clear, for undo
    this.viewing = null; // {hostId, reports}: the chat open in the foreground Claude window
    this.times = { waits: [], work: [] }; // pending lengths in ms: waits on you that ended in a resume, and finished stretches of work
    this.activity = false; // something moved "last active" without changing any state (a tool ran, the registry ticked)
  }

  /** Muted chats and projects never alert, never get angry and do not count as waiting. */
  setMuted({ ids = [], projects = [] } = {}) {
    this.mutedIds = new Set(ids.map(String));
    this.mutedProjects = new Set(projects.map(projectKey));
  }

  _isMuted(s) {
    return this.mutedIds.has(s.id) || (Boolean(s.cwd) && this.mutedProjects.has(projectKey(s.cwd)));
  }

  /** A chat that asked you something and has waited longer than the patience. */
  _isOverdue(s) {
    return this.impatientMs > 0 && !this._isMuted(s) && WAITING_ON_YOU.has(s.state) && this.now() - s.since >= this.impatientMs;
  }

  /**
   * Call periodically. Returns true when a chat just crossed the patience
   * threshold (the pet turns angry once, with one 'overdue' alert per chat).
   */
  tickOverdue() {
    let crossed = false;
    for (const s of this.sessions.values()) {
      if (this._isOverdue(s) && !s.lateNotified) {
        s.lateNotified = true;
        this.alerts.push({ id: s.id, state: 'overdue' });
        crossed = true;
      }
    }
    return crossed;
  }

  /**
   * Escalation: a chat that keeps waiting on a question or approval chimes again every `remindMs` (0 = never).
   * The reminder is an ordinary alert of the chat's own state, flagged `reminder`, so it plays the same sound.
   * Returns true when a reminder was raised.
   */
  tickReminders(remindMs) {
    if (!(remindMs > 0)) return false;
    let raised = false;
    const now = this.now();
    for (const s of this.sessions.values()) {
      if (!WAITING_ON_YOU.has(s.state) || this._isMuted(s)) continue;
      if (now - Math.max(s.since, s.remindedAt || 0) >= remindMs) {
        s.remindedAt = now;
        this.alerts.push({ id: s.id, state: s.state, reminder: true });
        raised = true;
      }
    }
    return raised;
  }

  _get(id) {
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id,
        name: '',
        cwd: '',
        state: 'idle',
        since: this.now(),
        turnStart: 0, // when the current turn began (kept across questions and approvals); 0 while idle or done
        turnWaitMs: 0, // how much of this turn was spent waiting on you
        pendingWaitMs: 0, // the wait in progress, kept across a question that becomes an approval
        lastHookAt: 0,
        hostSessionId: null,
        entrypoint: null,
        pid: 0,
        pidDomain: '',
        inRegistry: false,
        registryStatus: null,
        registryStatusAt: 0,
        childHosts: new Set(), // Desktop ids of the chats this chat started (read from its transcript, see children.js)
        lastTurnMs: 0, // how long the last finished turn took
        doneAt: 0, // when the chat last finished
      };
      this.sessions.set(id, s);
    }
    return s;
  }

  /** `at` (optional): when the change really happened, for the work and wait times (an interrupt is noticed a few seconds late). */
  _set(s, state, at) {
    if (s.state === state) return false;
    const before = s.state;
    const now = at && at <= this.now() ? at : this.now();
    // A wait only counts when the chat then ran again: a cancelled question that is left alone says nothing about you.
    // Either way the time spent waiting is not time Claude spent working.
    // A question that turns into an approval is one wait, so the pieces are added up until the chat runs again.
    if (WAITING_ON_YOU.has(before)) {
      s.turnWaitMs += now - s.since;
      s.pendingWaitMs += now - s.since;
    }
    if (state === 'working' && s.pendingWaitMs > 0 && !this._isMuted(s)) this.times.waits.push(s.pendingWaitMs);
    if (!WAITING_ON_YOU.has(state)) s.pendingWaitMs = 0;
    // A turn ends when the chat finishes or goes idle: the time it spent working is the turn minus what it waited on you.
    if (state === 'done') {
      s.lastTurnMs = s.turnStart ? Math.max(0, now - s.turnStart) : 0;
      s.doneAt = now;
    }
    if (s.turnStart && (state === 'idle' || state === 'done')) {
      this.times.work.push(Math.max(0, now - s.turnStart - s.turnWaitMs));
    }
    s.state = state;
    if (state === 'working' && (before === 'idle' || before === 'done' || !s.turnStart)) {
      s.turnStart = now;
      s.turnWaitMs = 0;
    } else if (state === 'idle' || state === 'done') {
      s.turnStart = 0;
      s.turnWaitMs = 0;
    }
    s.since = this.now();
    s.lateNotified = false;
    s.remindedAt = 0;
    s.hidden = false; // a hidden idle chat comes back as soon as it does anything
    if (ATTENTION.has(state) && !this._isMuted(s)) this.alerts.push({ id: s.id, state });
    if (state === 'done') this.finished.push({ id: s.id, muted: this._isMuted(s), at: this.now() });
    return true;
  }

  /** Applies a (sanitised) hook payload. Returns true when anything changed. */
  applyHook(payload) {
    const id = payload && payload.session_id;
    if (typeof id !== 'string' || !SESSION_ID.test(id)) return false;
    const existing = this.sessions.get(id);
    const next = nextState(payload, existing ? existing.state : 'idle');
    if (next === null) return false;
    if (next === 'removed') return this.sessions.delete(id);
    const s = this._get(id);
    s.lastHookAt = this.now();
    if (payload.cwd && !s.cwd) s.cwd = String(payload.cwd);
    if (!s.name) s.name = basename(s.cwd);
    const changed = this._set(s, next) || !existing;
    if (!changed) this.activity = true;
    return changed;
  }

  /** Token totals read from a chat's transcript ({input, output, cacheWrite, cacheRead}, or null). True when they changed. */
  /** Remembers which chats a chat started (Desktop ids). Returns true when that changed. */
  setChildren(id, hostIds) {
    const s = this.sessions.get(id);
    if (!s) return false;
    const next = hostIds instanceof Set ? hostIds : new Set(hostIds || []);
    if (next.size === s.childHosts.size && [...next].every((h) => s.childHosts.has(h))) return false;
    s.childHosts = new Set(next);
    return true;
  }

  /** The chat that started this one (its session id), or null: only a parent we know and that is still open counts. */
  _parentOf(s) {
    if (!s.hostSessionId) return null;
    for (const p of this.sessions.values()) if (p !== s && p.childHosts.has(s.hostSessionId)) return p.id;
    return null;
  }

  /**
   * What the alert filter needs to know about a chat that just finished (see notify.js nestedAlertDecision):
   * is it a started chat, did one of its own children finish lately, and how long was its last turn.
   */
  nestedContext(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    let lastChildDoneAt = 0;
    for (const c of this.sessions.values()) if (c !== s && c.hostSessionId && s.childHosts.has(c.hostSessionId)) lastChildDoneAt = Math.max(lastChildDoneAt, c.doneAt);
    return { isChild: this._parentOf(s) !== null, hasChildren: s.childHosts.size > 0, lastChildDoneAt, turnMs: s.lastTurnMs, doneAt: s.doneAt };
  }

  setUsage(id, usage) {
    const s = this.sessions.get(id);
    if (!s) return false;
    const same = JSON.stringify(s.usage || null) === JSON.stringify(usage || null);
    if (same) return false;
    s.usage = usage || null;
    return true;
  }

  ids() {
    return new Set(this.sessions.keys());
  }

  /** The lengths (ms) of waits on you and of work that ended since the last call: {waits, work}. */
  takeTimes() {
    const t = this.times;
    this.times = { waits: [], work: [] };
    return t;
  }

  /** True once after a hook or registry update that only moved "last active": the UI may refresh, but need not rush. */
  takeActivity() {
    const a = this.activity;
    this.activity = false;
    return a;
  }

  /** Merges the session registry (~/.claude/sessions/*.json). Returns true when anything changed. */
  syncRegistry(entries) {
    let changed = false;
    const seen = new Set();
    const now = this.now();

    for (const e of entries) {
      if (!e || !SESSION_ID.test(String(e.sessionId))) continue;
      seen.add(e.sessionId);
      const isNew = !this.sessions.has(e.sessionId);
      const s = this._get(e.sessionId);
      if (isNew) changed = true;

      const name = e.name || basename(e.cwd);
      if (s.name !== name) { s.name = name; changed = true; }
      if (e.cwd && s.cwd !== e.cwd) { s.cwd = e.cwd; changed = true; }
      if (s.hostSessionId !== (e.hostSessionId || null)) { s.hostSessionId = e.hostSessionId || null; changed = true; }
      s.entrypoint = e.entrypoint || null;
      s.pid = Number.isInteger(e.pid) && e.pid > 0 ? e.pid : 0;
      s.pidDomain = typeof e.pidDomain === 'string' ? e.pidDomain : '';
      s.inRegistry = true;
      s.registryStatus = e.status || null;
      if ((e.statusUpdatedAt || 0) > s.registryStatusAt) this.activity = true;
      s.registryStatusAt = e.statusUpdatedAt || 0;

      // Reconcile with what the registry says. Attention states are only
      // left when the registry shows the chat running again after the alert.
      if (e.status === 'busy') {
        const resumed = (e.statusUpdatedAt || 0) > s.since + 1000;
        if (s.state === 'idle' || s.state === 'done') changed = this._set(s, 'working') || changed;
        else if ((s.state === 'question' || s.state === 'approval') && resumed) {
          changed = this._set(s, 'working') || changed;
        }
      } else if (e.status === 'idle') {
        // A turn that ends normally fires `Stop` (-> done). One that is interrupted (Esc) fires nothing, but the registry shows the chat idle again.
        // So a working chat whose registry went idle *after* it started working, and has stayed idle for a few seconds (the grace lets a normal
        // `Stop` win), was interrupted. Without a usable timestamp it still falls back to the old slow rule.
        const idleSince = e.statusUpdatedAt || 0;
        const interrupted = idleSince > s.since && now - idleSince >= INTERRUPT_GRACE_MS;
        if (s.state === 'working' && (interrupted || now - s.since > STALE_WORKING_MS)) {
          changed = this._set(s, 'idle', interrupted ? idleSince : undefined) || changed;
        }
      }
    }

    // Registry is authoritative for who exists, once we have seen it at least once. Chat tab conversations are not in it at all.
    if (this.registrySynced) {
      for (const [id, s] of this.sessions) {
        if (s.source === 'chat') continue;
        if (!seen.has(id) && s.inRegistry) { this.sessions.delete(id); changed = true; }
        else if (!seen.has(id) && !s.inRegistry && now - s.lastHookAt > REGISTRY_GRACE_MS) {
          this.sessions.delete(id); changed = true;
        }
      }
    }
    this.registrySynced = true;
    return changed;
  }

  /**
   * Chat tab conversations as chat-watch.js reads them: [{id (a uuid), working, foreground}] for what the Claude windows show right now,
   * or null for "no usable answer" (nothing changes). A reply that starts streaming makes a row, one that stops is finished (and chimes
   * like any chat, unless the window was in front); a finished one that stays in front of you counts as seen. Only the page on screen is visible: a streaming chat
   * whose page is replaced (you opened another tab) can no longer be followed and is dropped without a chime.
   * Returns true when anything changed.
   */
  applyChats(chats) {
    if (!Array.isArray(chats)) return false;
    let changed = false;
    const visible = new Set();
    for (const c of chats) {
      if (!c || !CHAT_ID.test(String(c.id))) continue;
      const id = CHAT_PREFIX + c.id;
      visible.add(id);
      let s = this.sessions.get(id);
      if (!s) {
        if (!c.working) continue; // a page that is only open says nothing: a row appears when Claude starts answering
        s = this._get(id);
        s.source = 'chat';
        s.name = 'Claude chat';
        changed = true;
      }
      s.chatMisses = 0;
      if (c.working) {
        s.chatIdleReads = 0;
        s.chatSeen = 0;
        s.lastHookAt = this.now();
        changed = this._set(s, 'working') || changed;
      } else if (s.state === 'working') {
        s.chatIdleReads = (s.chatIdleReads || 0) + 1;
        if (s.chatIdleReads >= CHAT_IDLE_READS && this._set(s, 'done')) {
          changed = true;
          // Finishing while the Claude window is in front: you are looking at it, so it counts and is logged but does not chime or toast
          // (a hook chat gets the same through filterFocused; a chat row has no host id for that). This also covers a window that was
          // covered and stopped updating: it flips to done the moment it is brought forward.
          if (c.foreground) this.alerts = this.alerts.filter((a) => a.id !== id);
        }
      } else if (s.state === 'done' && c.foreground) {
        s.chatSeen = (s.chatSeen || 0) + 1;
        if (s.chatSeen >= VIEW_REPORTS) changed = this._set(s, 'idle') || changed;
      } else {
        s.chatSeen = 0;
      }
    }
    for (const [id, s] of this.sessions) {
      if (s.source !== 'chat' || visible.has(id)) continue;
      s.chatMisses = (s.chatMisses || 0) + 1;
      if (s.state === 'idle' || (s.state === 'working' && s.chatMisses >= CHAT_GONE_READS)) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  /** Forgets every Chat tab conversation (the watch was turned off). Returns true when there were any. */
  clearChats() {
    let changed = false;
    for (const [id, s] of this.sessions) {
      if (s.source === 'chat') { this.sessions.delete(id); changed = true; }
    }
    return changed;
  }

  /**
   * The user opened a finished chat. Used by jumping, so it never hides anything and leaves no undo.
   */
  dismiss(id) {
    const s = this.sessions.get(id);
    if (s && s.state === 'done') return this._set(s, 'idle');
    return false;
  }

  /** True while some finished chat could be acknowledged by opening it in Claude Desktop. */
  hasOpenableDone() {
    for (const s of this.sessions.values()) if (s.state === 'done' && s.hostSessionId) return true;
    return false;
  }

  /**
   * The Desktop chat currently open in the foreground Claude window (its `local_<uuid>`), or null when
   * Claude is not in front. A finished chat that stays open for VIEW_REPORTS reports in a row counts as
   * seen: it goes back to idle exactly like jumping to it. Questions and approvals are left alone, since
   * opening the chat does not answer them. Returns true when anything changed.
   */
  markViewing(hostId) {
    if (!hostId) {
      this.viewing = null;
      return false;
    }
    if (this.viewing && this.viewing.hostId === hostId) this.viewing.reports++;
    else this.viewing = { hostId, reports: 1 };
    if (this.viewing.reports < VIEW_REPORTS) return false;
    let changed = false;
    for (const s of this.sessions.values()) {
      if (s.hostSessionId === hostId && s.state === 'done') changed = this._set(s, 'idle') || changed;
    }
    return changed;
  }

  /** Clears one row on request (the x): finished -> idle, idle -> hidden. Undoable. */
  dismissRow(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    return this._clear([s]);
  }

  dismissAllDone() {
    return this._clear([...this.sessions.values()].filter((s) => s.state === 'done'));
  }

  dismissAllIdle() {
    return this._clear([...this.sessions.values()].filter((s) => s.state === 'idle' && !s.hidden));
  }

  /** Shared by the x and the bulk buttons; records one undo batch for the whole call. */
  _clear(list) {
    const items = [];
    for (const s of list) {
      if (s.state !== 'done' && !(s.state === 'idle' && !s.hidden)) continue;
      const before = { state: s.state, since: s.since, hidden: Boolean(s.hidden) };
      if (s.state === 'done') this._set(s, 'idle');
      else s.hidden = true;
      items.push({ id: s.id, before, after: { state: s.state, since: s.since, hidden: Boolean(s.hidden) } });
    }
    if (!items.length) return false;
    this.lastClear = { at: this.now(), items };
    return true;
  }

  _undoable() {
    return Boolean(this.lastClear) && this.now() - this.lastClear.at <= this.undoMs;
  }

  /** Puts back the last clear, skipping chats that changed since. No alerts are raised. */
  undo() {
    if (!this._undoable()) {
      this.lastClear = null;
      return false;
    }
    let changed = false;
    for (const { id, before, after } of this.lastClear.items) {
      const s = this.sessions.get(id);
      if (!s || s.state !== after.state || s.since !== after.since || Boolean(s.hidden) !== after.hidden) continue;
      s.state = before.state;
      s.since = before.since;
      s.hidden = before.hidden;
      s.lateNotified = false;
      changed = true;
    }
    this.lastClear = null;
    return changed;
  }

  unhideAll() {
    let changed = false;
    for (const s of this.sessions.values()) {
      if (s.hidden) { s.hidden = false; changed = true; }
    }
    return changed;
  }

  takeAlerts() {
    const a = this.alerts;
    this.alerts = [];
    return a;
  }

  /** The chats that finished since the last call: {id, muted, at}. */
  takeFinished() {
    const f = this.finished;
    this.finished = [];
    return f;
  }

  snapshot() {
    const all = [...this.sessions.values()];
    const list = all
      .filter((s) => !s.hidden)
      .sort((a, b) => PRIORITY[b.state] - PRIORITY[a.state] || b.since - a.since);
    let mood = 'idle';
    let attention = 0;
    let overdue = false;
    const types = { approval: 0, question: 0, done: 0 }; // chats per kind of notification
    const counts = { done: 0, idle: 0 }; // what the bulk buttons would clear
    for (const s of list) {
      if (s.state === 'done') counts.done++;
      else if (s.state === 'idle') counts.idle++;
      if (this._isMuted(s)) continue; // muted chats stay in the list but never move the pet
      if (PRIORITY[s.state] > PRIORITY[mood]) mood = s.state;
      if (ATTENTION.has(s.state)) {
        attention++;
        types[s.state]++;
      }
      if (this._isOverdue(s)) overdue = true;
    }
    const undoable = this._undoable();
    return {
      mood,
      attention,
      overdue,
      types,
      counts,
      hiddenCount: all.length - list.length,
      undoable,
      undoUntil: undoable ? this.lastClear.at + this.undoMs : 0,
      undoCount: undoable ? this.lastClear.items.length : 0,
      sessions: list.map((s) => ({
        id: s.id,
        name: s.name || '(untitled)',
        folder: basename(s.cwd),
        project: projectKey(s.cwd),
        parent: this._parentOf(s),
        state: s.state,
        since: s.since,
        turnStart: s.turnStart,
        usage: s.usage || null,
        tokens: s.usage ? badgeTokens(s.usage) : null,
        lastActive: Math.max(s.since, s.lastHookAt, s.registryStatusAt),
        overdue: this._isOverdue(s),
        muted: this._isMuted(s),
        jumpable: Boolean(s.hostSessionId) || this._focusable(s) || s.source === 'chat', // clicking the row opens the chat, raises the window it runs in, or Claude Desktop
        terminal: !s.hostSessionId && this._focusable(s),
        chat: s.source === 'chat',
      })),
    };
  }

  /**
   * A chat outside Claude Desktop (a terminal, VS Code) can still be brought forward through the window of the process it runs in.
   * Only for chats whose process lives on this Windows machine (not WSL, whose pids are another machine's).
   */
  _focusable(s) {
    return !s.hostSessionId && s.pid > 0 && (!s.pidDomain || s.pidDomain.startsWith('win32'));
  }

  /** What the main process needs to act on a chat (open it, focus it, copy its id, open its folder); kept out of the UI snapshot. */
  infoOf(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    return { sessionId: s.id, cwd: s.cwd, hostSessionId: s.hostSessionId, pid: s.pid, focusable: this._focusable(s), entrypoint: s.entrypoint, chat: s.source === 'chat' };
  }

  /** Registry data needed to open a chat; kept out of the UI snapshot. */
  hostIdOf(id) {
    const s = this.sessions.get(id);
    return s ? s.hostSessionId : null;
  }
}

module.exports = { SessionStore, nextState, PRIORITY, ATTENTION, SESSION_ID, DEFAULT_IMPATIENT_MS, UNDO_MS, VIEW_REPORTS, basename, projectKey };
