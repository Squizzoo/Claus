# Claus

A small cat that lives on your desktop and tells you when any Claude chat has
**finished**, has a **question** or needs your **approval**. Click it to see all
your chats; click a chat to jump straight to it in Claude Desktop.

Drag it anywhere, including to another monitor; it remembers where you left it.

## How it works

```
Claude Code hooks ──POST──▶ 127.0.0.1:47821/hook ──▶ ┐
~/.claude/sessions/*.json (live chat registry) ─────▶ ├─▶ state per chat ─▶ pet + list
                                                      ┘
click a chat ──▶ claude://code/continue?session=local_<id> ──▶ Claude Desktop opens it
```

| Pet | Meaning | Source |
| --- | --- | --- |
| sleeping | no chats open | registry |
| calm | chats open, nothing needed | registry |
| thinking dots | a chat is working | `UserPromptSubmit`, `PostToolUse`, registry |
| happy `✓` | a chat finished | `Stop` |
| `?` | Claude asked you a question | `PreToolUse` (AskUserQuestion), `Notification` |
| `!` | a chat needs approval | `PermissionRequest` |

The badge counts chats waiting for you. The pet shows the most urgent state.

**Several kinds at once:** when different notifications are waiting together
(for example an approval, a question and a finished chat), the speech bubble is
replaced by one round chip per kind, `!` `?` `✓`, each with a small count when
more than one chat has that kind.

**Impatient pet:** if a chat has been waiting on you (a question or an approval)
for longer than the patience, the pet turns **angry**: red face, frowning brows,
an anger mark, a shaking body, `!!` / `?!`, one cross chime, and the chat's row in
the list says how long it has waited. Answering it calms the pet down. Change the
patience from the tray icon: *Gets angry after waiting* (1, 2, 5, 10 minutes or never; default 2).

**Click a chat:** the chat opens in Claude Desktop and the Claude window is raised
above whatever covers it (restored if minimised), via `src/focus-claude.ps1`.

**The list:** chats are grouped by project (collapsible; a collapsed project still shows
its most urgent colour). Type in the search box, or press `/`, to filter by chat or project;
arrow keys move, Enter opens the first match, Esc clears the search and then closes the list.
Hover a row for **pin** (stays on top) and **mute** (no sound, chip, badge or angry pet; the chat
stays listed, dimmed). The **x** clears a finished chat or hides an idle one until it does
something again; *Clear finished* / *Clear idle* in the footer do it in bulk, with a 15 second
**Undo**, and *n hidden · Show* brings hidden chats back. The `⋯` button switches grouping,
sorting (needs me first / most recent) and density (comfortable / compact). Everything is
remembered in `pet-settings.json`.

## Run it

```powershell
npm install
node node_modules/electron/install.js   # if electron.exe is missing (npm 11 skips install scripts)
npm start
node scripts/hooks.js install            # dry run: shows what would change
node scripts/hooks.js install --apply    # writes the hooks (backup: settings.json.pet-bak)
```

Hooks are read by chats at start, so restart chats that were already open.
Remove them any time with `node scripts/hooks.js uninstall --apply`.
Tray icon: reset position, mute sounds, anger patience, clear finished, quit.

## Start and stop with Claude

`scripts/watch-claude.ps1` is a tiny hidden watcher: it starts the pet when Claude
Desktop opens and stops it when Claude Desktop closes. It only reacts to changes,
so if you quit the pet from the tray while Claude stays open, it stays quit until
Claude opens again. It matches the desktop app only, not the Claude Code engines.

```powershell
.\scripts\autostart.ps1 install     # adds it to your Startup folder and starts it now
.\scripts\autostart.ps1 status
.\scripts\autostart.ps1 uninstall   # removes it again
```

Note: if closing Claude's window only hides it to the system tray, Claude is still
running, so the pet stays until you fully quit Claude.

## Privacy

- Everything is local. The receiver only listens on `127.0.0.1`, rejects any
  request that carries a browser `Origin`, and always answers `{}` so it can never
  block or change what Claude does.
- Only `session_id`, event name, tool *name*, notification type and `cwd` are kept.
  Tool inputs, prompts and messages are dropped before anything is stored or logged.
- Your list preferences are saved to `pet-settings.json` in the app's user-data folder:
  the session ids you pinned or muted, and the project folder paths you muted or collapsed.
  Nothing else about a chat is written to disk.
- Chat names come from `~/.claude/sessions/*.json` (metadata only, never the `.key` files).
- `CLAUDE_PET_LOG=1` writes event names and 8-character session ids to `pet-events.log`.

## Develop

```powershell
npm test                                   # state machine, hook receiver, list model, prefs
npx electron . --shot=out/mood             # renders every mood + the list to out/*.png
```

`--shot` never writes the real settings. While your own pet is running, give the screenshot
run its own port and profile (single-instance lock): `$env:CLAUDE_PET_PORT = '47999'` and
`--user-data-dir=<temp folder>`.

The list logic (filter, group, sort, pins) lives in `src/renderer/view.js` and is unit tested;
the DOM around it is not. Clicks and keys are tested with real input events over the DevTools
protocol. Start the pet with the debug port, then drive it:

```powershell
$env:CLAUDE_PET_LOG = '1'; node_modules\electron\dist\electron.exe . --remote-debugging-port=9229
node scripts/ui-test.mjs open     # click the cat; reports how often the list redraws (must be 0)
node scripts/ui-test.mjs x 0      # click the x of row 0
node scripts/ui-test.mjs row 0    # click row 0; the log (pet-events.log) must show jump ... focused
node scripts/ui-test.mjs keys Slash b o n   # press keys ('Slash' = /) and print what the list shows
node scripts/ui-test.mjs act pin 1          # hover row 1, click its pin (also: mute, x)
node scripts/ui-test.mjs chain '#opts-toggle' '[data-opt=density]'   # click several elements in one run
node scripts/ui-test.mjs click '#undo'      # click anything; `view` prints the list, `hover` hovers
```

The panel closes when the window loses focus, so every command reopens it first. Chats you
POST to the hook receiver by hand disappear again after about a minute (they are not in the registry).

## Known limits

- The `claude://code/continue?session=…` route is an internal of Claude Desktop
  (verified in 6.28899.6.0), not a documented API. If an update changes it, fix
  `src/jump.js`; nothing else depends on it.
- An interrupted chat (Esc) fires no `Stop`; the pet drops its "working" state
  after ~30 s via the registry. A question or approval you cancelled stays until
  the chat runs again or you click it.
- Chats started outside Claude Desktop (a terminal) are listed but cannot be opened from the pet.
