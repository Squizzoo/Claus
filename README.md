# Claus

A small pet that lives on your desktop (a cat by default, or one of 16 pets) and tells you when any Claude chat has
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

**Open a chat yourself:** a finished chat you open in Claude Desktop (without using the pet) is
cleared too, as soon as it has been in front for a second or two. The pet reads the open chat's
id from the Claude window through Windows UI Automation (`src/open-chat.ps1`), and only asks while
a finished chat is waiting. Side effect: this switches on Chromium accessibility inside Claude
Desktop until it restarts, which costs it a little extra work. Questions and approvals are never
cleared this way, since opening the chat does not answer them.

**The list:** chats are grouped by project (collapsible; a collapsed project still shows
its most urgent colour). Type in the search box, or press `/`, to filter by chat or project;
arrow keys move, Enter opens the first match, Esc clears the search and then closes the list.
Hover a row for **pin** (stays on top) and **mute** (no sound, chip, badge or angry pet; the chat
stays listed, dimmed). The **x** clears a finished chat or hides an idle one until it does
something again; *Clear finished* / *Clear idle* in the footer do it in bulk, with a 15 second
**Undo**, and *n hidden · Show* brings hidden chats back. The `⋯` button switches grouping,
sorting (needs me first / most recent) and density (comfortable / compact). Everything is
remembered in `pet-settings.json`.

## Make it yours

Everything here is in the tray menu (right-click the tray icon) and remembered.

- **Pet:** cat, dog, bunny, bird, penguin, owl, dragon, sprout, blob, ghost, robot, alien, car, sun, moon
  or cloud. Every pet has art for every mood above (sleeping, calm, working, happy, question,
  approval and angry); the speech bubble and chips are the same for all of them.
- **Colour and accessory:** ten colours (the flushed and angry faces follow the colour you pick) and a
  bow, top hat, crown or party hat.
- **Idle animations:** a calm pet blinks and breathes, and every 8 to 20 seconds stretches, yawns, looks
  around or wags its tail (or antenna, flipper, rays). A pet without a tail never wags.
- **Celebration:** when three chats finish within a minute, confetti and sparkles burst over the pet and
  it hops, with a short fanfare (at most once a minute). Muted chats do not count towards it.
- **Finished today:** the list header shows `✓ n today`, the number of chats that finished today
  (switch it off with *Show chats finished today*). Only the date and the number are saved.
- **Sound:** four packs (Chime, Soft, Retro, Pluck) with a different tune for `!`, `?`, `✓`, the angry
  pet and the celebration; volume 25 to 100 %; *Quiet hours* (22:00-07:00, 23:00-08:00 or 18:00-09:00)
  silence the sounds only, the pet still moves and shows chips. *Mute sounds* stays the manual off switch.

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
Tray icon: reset position, pet, colour, accessory, sound pack, volume, quiet hours, mute sounds, anger patience,
finished-today counter, clear finished, quit.

## Start and stop with Claude

Instead of starting the pet by hand, let it follow Claude Desktop: it appears when Claude Desktop
opens and goes away when Claude Desktop closes. Set it up once:

1. **Install the pet first** (once, from the project folder), so `node_modules\electron\dist\electron.exe` exists:

   ```powershell
   npm install
   node node_modules/electron/install.js   # only if electron.exe is missing (npm 11 skips install scripts)
   ```

2. **Add the hooks** so Claude tells the pet what chats are doing (see *Run it* above; restart chats that were already open):

   ```powershell
   node scripts/hooks.js install --apply
   ```

3. **Turn on the startup watcher:**

   ```powershell
   .\scripts\autostart.ps1 install
   ```

   This puts a small launcher (`ClaudePetWatcher.vbs`) in your Windows Startup folder and starts the
   watcher right away. From then on it runs hidden at every Windows login, with no console window. If
   PowerShell refuses to run the script (execution policy), use
   `powershell -ExecutionPolicy Bypass -File .\scripts\autostart.ps1 install` instead.

4. **Check it:**

   ```powershell
   .\scripts\autostart.ps1 status    # shows the startup entry and whether the watcher is running
   ```

   Open Claude Desktop: the pet appears within a few seconds. Fully quit Claude Desktop and it disappears again.

To switch it off again: `.\scripts\autostart.ps1 uninstall` removes the startup entry and stops the watcher
(a pet that is already open keeps running until you quit it from the tray).

How the watcher behaves (`scripts/watch-claude.ps1`):

- It only reacts to changes. If you quit the pet from the tray while Claude stays open, the pet stays
  quit until the next time Claude opens.
- It ignores a short gap (a few seconds) without Claude, so an app restart or update does not stop the pet.
- It matches the Claude **desktop app** only (the Microsoft Store install under `WindowsApps`), not the Claude
  Code engines that also run as `claude.exe`. If your Claude Desktop is installed somewhere else, change the
  default of the `-PathLike` parameter at the top of `watch-claude.ps1`, then run `autostart.ps1 uninstall` and `install`.
- When Claude closes, the watcher stops every pet running from this project's folder, including one you
  started by hand with `npm start`.
- If closing Claude's window only hides it to the system tray, Claude is still running, so the pet stays
  until you fully quit Claude.
- The startup entry points at this folder. If you move or rename the project, run `autostart.ps1 uninstall`
  and then `install` again from the new location.
- To start the pet by hand without the watcher, use `npm start`.

## Privacy

- Everything is local. The receiver only listens on `127.0.0.1`, rejects any
  request that carries a browser `Origin`, and always answers `{}` so it can never
  block or change what Claude does.
- Only `session_id`, event name, tool *name*, notification type and `cwd` are kept.
  Tool inputs, prompts and messages are dropped before anything is stored or logged.
- Your preferences are saved to `pet-settings.json` in the app's user-data folder:
  the session ids you pinned or muted, the project folder paths you muted or collapsed, the pet,
  colour, accessory and sound you chose, and today's date with the number of chats finished.
  Nothing else about a chat is written to disk.
- Chat names come from `~/.claude/sessions/*.json` (metadata only, never the `.key` files).
- `CLAUDE_PET_LOG=1` writes event names and 8-character session ids to `pet-events.log`.

## Develop

```powershell
npm test                                   # state machine, hook receiver, list model, prefs, pets, sounds
npx electron . --shot=out/mood             # renders every mood + the list to out/*.png
npx electron . --shot=out/m --pets         # contact sheets: every pet in every mood, colours, accessories, idle actions
```

`--shot` never writes the real settings. While your own pet is running, give the screenshot
run its own port and profile (single-instance lock): `$env:CLAUDE_PET_PORT = '47999'` and
`--user-data-dir=<temp folder>`.

The pets are data in `src/renderer/pets.js`: a pet supplies its body art and a few face measurements, and a
shared generator draws the eyes and mouth for every mood. To add a pet, add one entry there and run the
`--pets` sheets; `test/pets.test.js` checks that it covers every mood. Sounds are data in `src/renderer/sounds.js`.

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
