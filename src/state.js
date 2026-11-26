'use strict';
// Pure session-state logic: no Electron, no I/O, so it can be unit tested.
//
// States, from least to most urgent:
//   idle      nothing happening
//   working   Claude is running a turn
//   done      Claude finished its turn (you may want to look)
//   question  Claude asked you something (AskUserQuestion / elicitation)
//   approval  Claude needs a permission approval

const PRIORITY = { idle: 0, working: 1, done: 2, question: 3, approval: 4 };
const ATTENTION = new Set(['done', 'question', 'approval']);
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STALE_WORKING_MS = 30_000;
const REGISTRY_GRACE_MS = 60_000;
const VIEW_REPORTS = 2; // consecutive "this chat is open" reports before a finished chat counts as seen

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
        lastHookAt: 0,
        hostSessionId: null,
        entrypoint: null,
        inRegistry: false,
        registryStatus: null,
        registryStatusAt: 0,
      };
      this.sessions.set(id, s);
    }
    return s;
  }

  _set(s, state) {
    if (s.state === state) return false;
    s.state = state;
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
    return this._set(s, next) || !existing;
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
      s.inRegistry = true;
      s.registryStatus = e.status || null;
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
        if (s.state === 'working' && now - s.since > STALE_WORKING_MS) {
          changed = this._set(s, 'idle') || changed;
        }
      }
    }

    // Registry is authoritative for who exists, once we have seen it at least once.
    if (this.registrySynced) {
      for (const [id, s] of this.sessions) {
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
        state: s.state,
        since: s.since,
        overdue: this._isOverdue(s),
        muted: this._isMuted(s),
        jumpable: Boolean(s.hostSessionId),
      })),
    };
  }

  /** Registry data needed to open a chat; kept out of the UI snapshot. */
  hostIdOf(id) {
    const s = this.sessions.get(id);
    return s ? s.hostSessionId : null;
  }
}

module.exports = { SessionStore, nextState, PRIORITY, ATTENTION, SESSION_ID, DEFAULT_IMPATIENT_MS, UNDO_MS, VIEW_REPORTS, basename, projectKey };
