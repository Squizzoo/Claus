# Claude Pet Roadmap

Ideas for where the pet goes next, grouped in phases and ordered roughly by value
against effort. Nothing here is built yet unless marked **[done]**. Tick items off
as they land.

## Phase 1: List ergonomics

Small changes with a big payoff now that the chat list is getting long.

- [ ] **Check the x on each row.** `dismiss` already exists in `src/main.js` and the
      UI test clicks it. Verify the x is visible (or appears on hover) in the panel.
- [ ] **Search and filter.** Search box at the top of the panel matching chat title
      and project name. `/` focuses it, arrow keys move, Enter jumps to the chat.
- [ ] **Group by project.** Collapsible sections per `cwd` with a count, e.g.
      `delijstenfabriek.nl (2)`. Sort option "Needs me first": approvals and
      questions above idle chats.
- [ ] **Bulk actions.** "Clear all idle" and "Clear finished" in the panel (today
      only in the tray menu). Undo after an accidental x.
- [ ] **Pin and mute.** Pinned chats stay on top. Muted chats or projects never
      trigger sound or chips.
- [ ] **Readable rows.** Status colour or icon per row, last event text ("asked a
      question 3 min ago"), compact or comfortable density.

## Phase 2: Pet personality

- [ ] **Pet picker.** Cat, dog, blob, robot, ghost and so on. First build a
      mood-to-sprite abstraction: each pet supplies art for sleeping, calm,
      working, happy, question, approval and angry. Selectable from the tray or
      the settings panel.
- [ ] **Colour and skin variants.** Fur colours and small accessories (hat, bow).
- [ ] **Idle animations.** Blinking, stretching, tail wag, yawning.
- [ ] **Celebration.** Confetti or sparkles when several chats finish together,
      plus an optional "finished today" streak counter.
- [ ] **Sound packs.** Different chime per kind (`!`, `?`, `✓`), volume control,
      quiet hours / Do Not Disturb.

## Phase 3: Smarter notifications

- [ ] **Windows toast notifications** with an "Open chat" action, for when the pet
      is hidden or on another monitor.
- [ ] **Escalation.** Repeat the chime after N minutes, flash the taskbar, or move
      the pet to the screen edge nearest the cursor.
- [ ] **Focus awareness.** Don't notify for a chat you are already looking at.
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

- [ ] **Settings panel** instead of tray-only: patience, sounds, pet, size,
      opacity.
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

1. Phase 1: x check, search, project grouping.
2. Phase 2: pet-picker abstraction (everything pet-related builds on it).
3. Phase 3: toasts and snooze.
4. Phase 5: settings panel, once there are enough options to need one.
5. Packaging, when the feature set feels right.

Each phase fits on its own branch.
