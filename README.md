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

**A chat outside Claude Desktop** (a terminal, or the VS Code extension) is brought forward instead: the pet walks up
from the chat's process to the window it runs in and raises it (`src/focus-claude.ps1 -FromPid`). A terminal with tabs
comes forward as a whole window; the pet cannot pick the tab.

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

**More per row:** a working chat shows `working for 4m 12s · active 8s ago` (it counts in place, once a second; the
turn is timed from your prompt and keeps running across approvals), a waiting chat `waiting 6m 03s!`, and a finished
one how long ago it finished. A token count such as `44k tok` sits at the end of the line (input, output and cache
writes; the tooltip also shows the cache reads). It is read from the chat's own transcript file, see Privacy;
*Show tokens on each row* in the Behaviour tab turns it off. **Right-click a row** for quick actions: open in Claude (or
bring its terminal forward), copy the session id, open the project folder, in VS Code or in a terminal (Windows
Terminal, else PowerShell), pin and mute. The *Today* tab of the settings window (and a line in the tray menu) sums up
the day: chats finished, how often and how long chats waited on you, the longest wait, and the time Claude spent
working.

## Make it yours

**Double-click the pet** to open the settings window: a gallery of all 16 pets, a big live preview of the one you
pick (with a mood switcher, so you can see it happy, worried or angry), and tiles for colour, accessory and mustache.
Every click applies to the real pet straight away. The *Sound* tab has the sound packs (with buttons to hear each
one), volume, quiet hours and mute; the *Notifications* tab has snooze, Windows toasts, the repeat reminder and
auto-hide; the *Behaviour* tab has how long the pet waits before it gets angry and the
finished-today counter and the token counts; the *Window* tab has snapping, monitors, fullscreen and click-through;
the *System* tab has the Claude Code hooks, start with Windows, following Claude Desktop and updates;
the *Today* tab has the day's numbers. *Size* and *Opacity* are under *Appearance*. The tray menu (right-click the tray icon) still has every setting except the mustache, plus *Settings...*
to open the window; both always show the same values. Everything is remembered.

- **Pet:** cat, dog, bunny, bird, penguin, owl, dragon, sprout, blob, ghost, robot, alien, car, sun, moon
  or cloud. Every pet has art for every mood above (sleeping, calm, working, happy, question,
  approval and angry); the speech bubble and chips are the same for all of them.
- **Colour, accessory and mustache:** ten colours (the flushed and angry faces follow the colour you pick), a
  bow, top hat, crown or party hat, and a classic, handlebar or curly mustache. The mustache is a separate choice,
  so it goes with any hat. (The mustache is in the settings window only.)
- **Idle animations:** a calm pet blinks and breathes, and every 8 to 20 seconds stretches, yawns, looks
  around or wags its tail (or antenna, flipper, rays). A pet without a tail never wags.
- **Celebration:** when three chats finish within a minute, confetti and sparkles burst over the pet and
  it hops, with a short fanfare (at most once a minute). Muted chats do not count towards it.
- **Finished today:** the list header shows `✓ n today`, the number of chats that finished today
  (switch it off with *Show chats finished today*). Only the date and the number are saved.
- **Sound:** four packs (Chime, Soft, Retro, Pluck) with a different tune for `!`, `?`, `✓`, the angry
  pet and the celebration; volume 25 to 100 %; *Quiet hours* (22:00-07:00, 23:00-08:00 or 18:00-09:00)
  silence the sounds only, the pet still moves and shows chips. *Mute sounds* stays the manual off switch.

## Install it (the packaged app)

`npm run dist` builds two files into `dist/` (the folder is not committed):

- `Claus-Setup-<version>.exe`: a per-user installer (no admin rights; Start menu entry, optional desktop shortcut, uninstaller).
  This is the version that can **start with Windows** and **update itself**.
- `Claus-<version>-portable.exe`: one file, nothing is installed. It cannot start with Windows or update itself.

The installer is not code-signed, so Windows SmartScreen may say "unknown publisher" the first time: *More info*, *Run anyway*.

**First run.** Claus asks once whether it may add its hooks to Claude Code's settings file (`~/.claude/settings.json`). The dialog
names the file and the entries, an existing hook of yours is never touched, and a backup (`settings.json.pet-bak`) is kept.
Answer *Not now* and it does not ask again; the *System* tab of the settings window installs or removes the hooks whenever you like.
Chats that were already open need a restart to pick the hooks up.

**Updates.** The installed version looks for a newer release on this project's GitHub releases about 10 seconds after it starts
and every 6 hours (a request to GitHub, nothing else is sent). It only tells you (tray menu and the *System* tab); nothing is
downloaded until you press *Download*, and *Restart to update* installs it. You publish a release yourself with
`npm run dist` and the files in `dist/` (installer, its `.blockmap` and `latest.yml`).

**Settings and data** stay in `%APPDATA%\claude-pet` for every way of running Claus (source checkout, installer, portable).

**Hide while Claude Desktop is not running** (*System* tab, also in the tray) replaces the old watcher for the installed
app: the pet hides when Claude Desktop is not running (two checks in a row, 3 seconds apart) and slides back when it opens. Claus itself
keeps running with its tray icon; use *Start with Windows* to have it there from the start. The watcher scripts below stay for a source checkout.

## Run it from source

```powershell
npm install
node node_modules/electron/install.js   # if electron.exe is missing (npm 11 skips install scripts)
npm start
node scripts/hooks.js install            # dry run: shows what would change
node scripts/hooks.js install --apply    # writes the hooks (backup: settings.json.pet-bak)
```

Hooks are read by chats at start, so restart chats that were already open.
Remove them any time with `node scripts/hooks.js uninstall --apply`.
Tray icon: settings window, reset position, pet, colour, accessory, size, opacity, snap, monitors, above fullscreen, click-through,
sound pack, volume, quiet hours, mute sounds, anger patience, finished-today counter, snooze, toasts, repeat reminder, auto-hide,
hide while Claude Desktop is not running, start with Windows and updates (installed version), clear finished, quit.

## Smarter notifications

All of this is in the settings window (*Notifications* tab) and the tray menu.

- **Snooze** (15 minutes or 1 hour): no sound, no toast and no repeat reminder. The pet still shows its chips,
  badge and anger, and the list header says "snoozed until 14:30". It survives a restart and ends by itself.
- **Windows toasts:** a pop-up with the chat name and what happened (finished, asked a question, needs approval).
  By default only when the pet is not visible (auto-hidden, or your mouse is on another screen than the pet);
  *Always* and *Off* are the other choices. Click the toast to open the chat; a terminal chat, which cannot be
  opened, brings up the pet and its list instead. Toasts are silent (the pet already chimes) and Windows keeps them in
  its notification centre. Under *Show a toast when* you pick which kinds get one (a question, an approval, a chat that
  finished); for instance only questions and approvals. They contain only the chat name, the kind of alert and the project folder.
- **Focus awareness:** no sound or toast for a chat you are already looking at in Claude Desktop (the chip stays).
  The first alert after starting the pet cannot know yet, because the window watcher only starts when it is first asked.
- **Repeat reminder** (off, 2, 5, 10 or 15 minutes): a chat that keeps waiting on a question or approval plays its
  sound again. Finished chats are not repeated. Snooze and muted chats silence it.
- **Auto-hide:** *when nothing is open* hides the pet while there are no chats; *only when a chat needs me* shows it
  (sliding in from the nearest screen edge) only while something waits. It stays while the list is open, while you
  drag it or hover it, and for 30 seconds after you show it from the tray. Its position is never changed by this.

## Size, position and screens

All of this is in the settings window (*Appearance* and *Window* tabs) and the tray menu.

- **Size:** small, medium, large or extra large (100, 150, 200 or 250 px). Changing it resizes the pet's window once
  (the pet blinks once) around its centre; the pet, its chips, badge and confetti scale together. The chat list is unchanged.
- **Opacity:** 100, 85, 70, 50 or 30 %. Only the pet is see-through; the list stays readable.
- **Snap to:** *screen edges* pulls the pet against the nearest edge when you let go within about 40 px of it, *corners*
  always settles it in the nearest corner (both leave a 16 px margin). Switching it on pulls the pet in at once.
- **Monitors:** *Follow the window I work in* moves the pet to the screen of the window that is in front (not the one the mouse
  is on), keeping its relative place: bottom right stays bottom right. It waits until that screen has been the active one for
  3 seconds, so it does not chase every click, and it does not move while you drag it or have the list or settings open.
- **Stay above fullscreen apps:** shows the pet over a fullscreen video or presentation. A game in exclusive fullscreen
  still covers it; that is a Windows limit.
- **Click-through:** while no chat needs you (nothing finished, asking or waiting for approval, muted chats not counted)
  clicks go through the pet to the window below. Hold **Ctrl** and hover over the pet to grab it; the moment a chat needs you
  it is clickable again. A muted finished chat does not count as needing you: use the tray icon to open the list then.

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
- The only thing Claus sends out of this computer is the update check of the installed version (a request to GitHub for the
  latest release). It can be avoided with the portable version or a source checkout, which never check.
- Opening a chat is checked afterwards (the jump self-check): the pet asks which chat Claude Desktop shows and compares it with the one
  it opened. Only the pass/fail count, the time of the last success and Claude Desktop's version number are saved for that.
- Your preferences are saved to `pet-settings.json` in the app's user-data folder:
  the session ids you pinned or muted, the project folder paths you muted or collapsed, the pet,
  colour, accessory and sound you chose, and today's date with the number of chats finished.
  Nothing else about a chat is written to disk. The day's summary (the *Today* tab) is the date and five numbers
  (waits, total and longest wait, work time), never a chat name.
- Token counts: the pet finds each chat's transcript (`~/.claude/projects/*/<session id>.jsonl`) by session id and
  reads the usage counters of its assistant messages, only the part added since the last look. A line that carries usage
  is parsed in memory (it also holds the message text); only its message id and four numbers are kept, and the rest is
  dropped at once, never stored or logged. Nothing is read from a path a hook sent.
- Chat names come from `~/.claude/sessions/*.json` (metadata only, never the `.key` files).
- `CLAUDE_PET_LOG=1` writes event names and 8-character session ids to `pet-events.log`.

## Develop

```powershell
npm test                                   # state machine, hook receiver, list model, prefs, pets, sounds
npx electron . --shot=out/mood             # renders every mood + the list to out/*.png
npx electron . --shot=out/m --pets         # contact sheets: every pet in every mood, colours, accessories, mustaches, idle actions
npx electron . --shot=out/s --settings     # the settings window: each tab and a few looks
npx electron . --shot=out/z --sizes        # the pet at every size, with chips and with the list open
npm run dist:dir                           # the unpacked app in dist/win-unpacked (quick packaging check)
npm run dist                               # installer and portable exe in dist/
```

To try the packaged app without touching your own Claude Code settings, run it with a test port, its own profile and a
copy of the settings file: `$env:CLAUDE_SETTINGS_FILE = '<copy of settings.json>'; $env:CLAUDE_PET_PORT = '47999'; dist\win-unpacked\Claus.exe --user-data-dir=<temp folder>`
(`--setup` forces the first-run question from a source checkout).

`--shot` never writes the real settings. While your own pet is running, give the screenshot
run its own port and profile (single-instance lock): `$env:CLAUDE_PET_PORT = '47999'` and
`--user-data-dir=<temp folder>`.

The pets are data in `src/renderer/pets.js`: a pet supplies its body art and a few face measurements, and a
shared generator draws the eyes and mouth for every mood. To add a pet, add one entry there and run the
`--pets` sheets; `test/pets.test.js` checks that it covers every mood. Sounds are data in `src/renderer/sounds.js`.
The pet art is styled by `src/renderer/pet.css`, which only uses classes, so the pet window and the settings window
(gallery cards and the live preview) share it; the settings window is `settings.html` / `settings.js` and draws pets
with the same `PetArt.buildPet` as the real pet. Notification settings (toasts, reminder, auto-hide, snooze) and their decisions are pure and live in `src/notify.js`;
`src/toast.js` is the thin Electron wrapper. A new setting goes into `src/look.js` (validation), the tray in
`main.js` and a control in `settings.js`.

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
node scripts/ui-test.mjs dblclick           # double-click the pet: the settings window opens and the list closes
node scripts/ui-test.mjs settings '[data-pet=dog]' '[data-skin=blue]'   # click in the settings window, print what it and the pet show
```

The panel closes when the window loses focus, so every command reopens it first. Chats you
POST to the hook receiver by hand disappear again after about a minute (they are not in the registry).

## Known limits

- The `claude://code/continue?session=…` route is an internal of Claude Desktop
  (verified in 6.28899.6.0), not a documented API. If an update changes it, fix
  `src/jump.js`; nothing else depends on it. The pet checks itself: after a jump it asks which chat Claude Desktop shows
  (a small PowerShell helper reads the open chat from Claude's window). Only a *different* chat showing up counts as a miss
  (the helper saying "none" proves nothing right after Claude starts), and after two misses in a row the tray and the *System*
  tab warn that opening chats may be broken. After a Claude Desktop update the *System* tab says "not checked yet" until a jump works.
  The same helper marks a finished chat as seen when you open it yourself. It needs the chat view to be in front and Windows'
  UI Automation to see inside Claude (Claude Desktop 6.28899.6.0 shows two web documents; both are read).
- An interrupted chat (Esc) fires no `Stop`. The pet notices through the registry: a working chat whose registry entry turned
  idle after the turn started, and stays idle for 4 seconds, drops to idle (the normal `Stop` wins when it comes). A question
  or approval you cancelled stays until the chat runs again or you click it, because the registry cannot tell it from one you have not answered yet.
- "Follow the window I work in" uses the window that is in front, so it cannot tell a window you only look at from one you work in,
  and a full-screen window on another monitor moves the pet there too. Switch it to *Stay where I put it* to stop that.
- The installer is not code-signed (Windows SmartScreen asks once), and the portable exe cannot start with Windows or update itself.
- Chats started outside Claude Desktop (a terminal, VS Code) cannot be opened, only brought forward: the pet raises the
  window their process runs in. Windows Terminal raises the window, not the tab. A terminal started through Windows'
  default-terminal hand-off has no window among the chat's parent processes, so nothing is raised (the log says
  `no-window`). Chats in WSL cannot be focused.
- A chat that was already open when the pet started has no token count until its transcript is found (within 10 s), and a
  chat without messages yet has none at all. The count is tokens, not money: there is no price table to go stale.
- Toasts have no "Open chat" button (Electron only supports those on macOS): the whole toast is the button. A toast you
  click in the notification centre after it timed out may do nothing, depending on Windows.
- The pet has no taskbar button, so it cannot flash the taskbar; escalation is the repeat reminder.
