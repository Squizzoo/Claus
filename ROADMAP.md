# Claus Roadmap

Ideas for where the pet goes next, grouped in phases and ordered roughly by value
against effort. Nothing here is built yet unless marked **[done]**. Tick items off
as they land.

## Phase 1: List ergonomics **[done]**

Small changes with a big payoff now that the chat list is getting long.

- [x] **Check the x on each row.** Always visible on finished and idle rows. On a finished
      chat it clears the notification, on an idle chat it hides the row until that chat does
      something again (not shown for working, question or approval, which still need you).
- [x] **Search and filter.** Search box at the top of the panel matching chat title and
      project name (every word must match). `/` focuses it, arrow keys move, Enter opens the
      first chat that can be opened, Esc clears the search and then closes the panel.
- [x] **Group by project.** Collapsible sections per project with a count, e.g.
      `delijstenfabriek.nl (2)`; a collapsed section still shows the colour of its most urgent
      chat. Sort option "Needs me first" (default) or "Most recent"; grouping can be turned off.
- [x] **Bulk actions.** "Clear finished" and "Clear idle" in the panel footer, "n hidden ·
      Show" to bring hidden chats back, and an Undo toast (15 s) after any x or bulk clear.
- [x] **Pin and mute.** Pinned chats stay on top (a Pinned section). Muted chats or projects
      never trigger sound, chips, the badge or the angry pet; they stay in the list, dimmed.
      Hover a row for the pin and mute buttons; a project header has its own mute button.
      Keyboard on a focused row: `p` pin, `m` mute, Delete dismiss.
- [x] **Readable rows.** Status stripe and tint per row, last event text ("asked a question ·
      3 min ago"), and a compact density that shows only a short age. View options (group, sort,
      density) sit behind the ⋯ button next to the search box and are remembered.

## Phase 2: Pet personality **[done]**

- [x] **Pet picker.** 16 pets (cat, dog, bunny, bird, penguin, owl, dragon, sprout, blob, ghost,
      robot, alien, car, sun, moon, cloud) on a mood-to-sprite abstraction: a pet supplies its body
      art and face measurements, a shared generator draws every mood. Picked from the tray; a
      settings panel comes in Phase 5.
- [x] **Colour and skin variants.** Ten colours that keep the flushed and angry faces, and a
      bow, top hat, crown or party hat.
- [x] **Idle animations.** Blinking and breathing, plus a random stretch, yawn, look-around or
      tail wag every 8 to 20 seconds while calm.
- [x] **Celebration.** Confetti, sparkles and a hop when three chats finish within a minute,
      plus a "finished today" counter in the list header.
- [x] **Sound packs.** Chime, Soft, Retro and Pluck with a tune per kind (`!`, `?`, `✓`, angry,
      celebration), volume 25-100 %, and quiet hours (sound only). Do Not Disturb for a set
      time is the Snooze item of Phase 3.

## Phase 3: Smarter notifications **[done]**

- [x] **Windows toast notifications**, for when the pet is hidden or on another monitor. The toast itself is the
      "Open chat" click (Windows buttons need a packaged app); a terminal chat opens the list instead.
- [x] **Escalation.** Repeat the chime of a waiting question or approval every 2 to 15 minutes. No taskbar
      flash (the pet has no taskbar button) and no moving the pet.
- [x] **Focus awareness.** No sound or toast for a chat you are already looking at in Claude Desktop.
- [x] **Auto-hide.** Hide the pet when nothing is open, or peek in from the screen edge only when a chat needs you.
- [x] **Snooze.** Silence sound, toasts and reminders for 15 or 60 minutes, from the tray or the settings window.

## Phase 4: More information per chat **[done]**

- [x] **Durations.** `working for 4m 12s · active 8s ago` on a working row, counting in place; a turn is timed from
      the prompt and keeps running across approvals.
- [x] **Token badge per chat.** The hooks carry no token data, so the counters are read from the chat's transcript file
      (only the id and four counters of each message are kept, deduplicated by message id). Tokens, no cost estimate: a price table goes stale.
- [x] **Daily summary.** Chats finished, waits on you, total and longest wait, work time. A *Today* tab, the tray and the
      header tooltip. Local only, numbers only. Waits longer than 4 hours are skipped (abandoned chats).
- [x] **Row quick actions** (right-click): open in Claude, copy session id, open the project folder, in VS Code or in a
      terminal, pin, mute.
- [x] **Terminal chats.** A row click raises the window the chat's process runs in (terminal or VS Code). The whole
      window, not the tab; a default-terminal hand-off has no such window.

## Phase 5: Behaviour and platform **[done]**

- [x] **Settings window** instead of tray-only: appearance, sound, notifications, behaviour, window and system tabs
      (the tray keeps working and always shows the same values).
- [x] **Size and opacity**, plus click-through while idle. Four sizes (100 to 250 px) and five opacities; the window is
      resized once when the size changes. Click-through while no chat needs you; Ctrl + hover grabs the pet.
- [x] **Snap to corners or edges**, optional "stay above fullscreen apps" (not above exclusive-fullscreen games).
- [x] **Multi-monitor modes:** stay put, or follow the window you work in (the monitor of the foreground window, after 3 s).
- [x] **Robustness.** An interrupted chat (Esc fires no `Stop`) drops to idle 4 s after the registry shows it idle instead of
      after 30 s (a cancelled question or approval still stays, see README "Known limits"). A self-check after each jump
      warns in the tray and the *System* tab when the `claude://code/continue` route seems to have stopped working, or when
      Claude Desktop was updated and opening chats has not been checked since. Fixed on the way: the open-chat helper
      read only the first of Claude Desktop's two web documents and always answered "none".
- [x] **Packaging.** `npm run dist` builds a per-user NSIS installer and a portable exe (electron-builder); the installed
      version updates from GitHub releases (a click to download, a click to restart), starts with Windows on request and can
      hide while Claude Desktop is not running. The first run asks once before adding the hooks to Claude Code's settings.
      Open: code signing (SmartScreen warns about an unsigned installer), a nicer app icon than the tray cat head.

## Phase 6: Stretch ideas

- [ ] **Click-to-reply.** Allow or deny simple approvals from the pet. Touches
      permissions, so opt-in only, or skip.
- [ ] **Mood memory.** Sleepy late at night, perky in the morning.
- [ ] **One pet per project** instead of a single pet for everything.
- [ ] **WSL chats.** Show chats from the WSL side too, since hooks are shared.

## Suggested order

1. ~~Phase 1: x check, search, project grouping~~ (done, with the rest of the phase).
2. ~~Phase 2: pet-picker abstraction and the rest of pet personality~~ (done).
3. ~~Phase 3: toasts and snooze~~ (done, with the rest of the phase).
4. ~~Phase 4: durations, tokens, daily summary, quick actions, terminal focus~~ (done).
5. ~~Phase 5: settings window, size and placement, robustness, packaging~~ (done).
6. Phase 6: stretch ideas, as they seem worth it.

Each phase fits on its own branch.
