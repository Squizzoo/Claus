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

## Phase 3: Smarter notifications

- [ ] **Windows toast notifications** with an "Open chat" action, for when the pet
      is hidden or on another monitor.
- [ ] **Escalation.** Repeat the chime after N minutes, flash the taskbar, or move
      the pet to the screen edge nearest the cursor.
- [ ] **Focus awareness.** Don't notify for a chat you are already looking at. (Partly done: a
      finished chat you open in Claude Desktop is cleared after ~2 s, but the chime for a chat
      that finishes while open still plays.)
- [ ] **Auto-hide.** Hide the pet when nothing is open; optionally peek in from the
      screen edge only when a chat needs you.
- [ ] **Snooze.** Silence everything for 15 or 60 minutes from the tray.

## Phase 4: More information per chat

- [ ] **Durations.** "Working for 4m 12s", time since last activity.
- [ ] **Token or cost badge per chat**, if the hooks expose the data.
- [ ] **Daily summary.** Chats finished today, total waiting time, longest wait.
      Local only.
- [ ] **Row quick actions** (right-click): Open in Claude, copy session id, open
      project folder, open in terminal or VS Code.
- [ ] **Terminal chats.** Focus the terminal window as a fallback, since these
      cannot be opened through `claude://` today.

## Phase 5: Behaviour and platform

- [ ] **Settings window** instead of tray-only. Partly done: double-click the pet for a window with a pet
      gallery, live preview, colour, accessory, mustache, sounds, quiet hours, patience and the
      counter (the tray keeps working). Still open: size and opacity, once they exist.
- [ ] **Size and opacity**, plus click-through while idle.
- [ ] **Snap to corners or edges**, optional "stay above fullscreen apps".
- [ ] **Multi-monitor modes:** follow the active monitor or stay put.
- [ ] **Robustness.** Handle interrupted chats (Esc fires no `Stop`, see README
      "Known limits"). Self-check that warns in the tray when the `claude://code/continue`
      route stops working after a Claude Desktop update.
- [ ] **Packaging.** Installer or portable `.exe` via electron-builder, auto-update,
      first-run hook installer so setup is not manual npm and PowerShell steps.

## Phase 6: Stretch ideas

- [ ] **Click-to-reply.** Allow or deny simple approvals from the pet. Touches
      permissions, so opt-in only, or skip.
- [ ] **Mood memory.** Sleepy late at night, perky in the morning.
- [ ] **One pet per project** instead of a single pet for everything.
- [ ] **WSL chats.** Show chats from the WSL side too, since hooks are shared.

## Suggested order

1. ~~Phase 1: x check, search, project grouping~~ (done, with the rest of the phase).
2. ~~Phase 2: pet-picker abstraction and the rest of pet personality~~ (done).
3. Phase 3: toasts and snooze.
4. Phase 5: settings panel, once there are enough options to need one.
5. Packaging, when the feature set feels right.

Each phase fits on its own branch.
