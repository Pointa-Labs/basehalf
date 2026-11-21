# Agent Area terminal identity, wheel input, scrollbar, the edges of its grid, and the settings it follows

Status: Active (2026-10-09; scrollbar added and precise wheel amount revised 2026-10-12; wheel rows and row height matched to the reference terminal 2026-10-13; the grid's width and the edges around it added 2026-10-27; the settings of a terminal that a session follows added 2026-11-21)
Decision: [D39](../decisions.md#d39--agent-area-terminals-identify-as-basehalf-and-scroll-like-ghostty-new-2026-10-09),
[D86](../decisions.md#d86--a-program-in-an-agent-area-terminal-reaches-the-edges-of-its-pane-new-2026-10-27),
[D140](../decisions.md#d140--a-session-of-the-agent-area-follows-the-settings-of-a-terminal-new-2026-11-21)
Related: [D21](../decisions.md#d21--right-side-is-agent-area-not-terminal-panel-new-2026-06-30),
[agent launch context](agent-launch-context.md),
[the settings BaseHalf offers](settings-catalog.md)

## Problem

Scrolling a full-screen TUI agent in Agent Area stutters. Claude Code in its
fullscreen renderer is the main case. Measured on 2026-10-09 with Claude Code
2.1.283 and 2.1.295, the renderer kept 120 fps and BaseHalf code used a few
milliseconds of CPU, so the stutter is not a rendering cost. It comes from
how the terminal reports the wheel and how the agent interprets it:

- xterm.js 6.1 scales pixel deltas under 50 px (trackpad) by 0.3 and sends at
  most one wheel report per wheel event, however many rows the event covers.
  A trackpad gesture of 3,340 px produced 70 reports.
- Agents recognize xterm.js through `TERM_PROGRAM=vscode` or the XTVERSION
  reply `xterm.js(…)`. Claude Code then applies an xterm.js-only velocity
  curve: a report that follows the previous one by less than 80 ms scrolls up
  to 36 rows, and one that follows by 80 ms or more scrolls 3. Slow swipes moved in
  3-row steps with stalls of more than 300 ms, and medium swipes moved about
  six times the finger distance in jumps of up to 69 rows per frame.
- Sending standard reports while still identifying as xterm.js is worse: the
  velocity curve reads them as very fast scrolling, and a slow swipe scrolled
  through the whole transcript.

Ghostty, the reference for Agent Area's interaction quality (D21), sends one
report per row of accumulated scroll, and agents use their native terminal
model there. With both changes, standard reports and a non-xterm.js identity,
Claude Code in Agent Area answered each report with one frame within 6 to 8
ms.

The first version sent too many reports for a trackpad, and two-finger
scrolling of Claude Code's transcript still felt jumpy. It doubled a precise
delta, as the reference terminal does on macOS, and counted one row per cell
height in CSS pixels: two reports per cell height of finger travel. The
reference terminal receives the delta in points and counts rows by the cell
height in device pixels, so on a display with a scale factor of 2 the doubling
cancels out and it sends one report per cell height. Claude Code scrolls more
rows per report as reports get denser. Measured on 2026-10-12 with Claude Code
2.1.296, 120 Hz trackpad-shaped events, a cell height of 14 px, and an
800-line transcript, over two runs:

| Swipe | Reports per cell height | Reports | Transcript rows | Rows per update |
| --- | --- | --- | --- | --- |
| Slow, 220 px, about 16 rows of travel | 2 | 30 | 77 to 113 | median 3 to 4, up to 10 |
| Slow, 220 px | 1 | 14 to 15 | 13 to 14 | 1 |
| Medium, 635 px, about 45 rows of travel | 2 | 89 to 90 | 460 to 466 | median 9 to 12, up to 35 |
| Medium, 635 px | 1 | 44 | 190 | median 6, up to 13 |

The rows with two reports per cell height were recorded on the revised build
with `terminal.integrated.mouseWheelScrollSensitivity` set to 2, which gives
the first version's amount.

One report per cell height still scrolled further than the reference
terminal, and the user felt it. On 2026-10-13 the same trackpad gestures were
posted as system events to the reference terminal, version 1.3.1 with its
default font, and to BaseHalf. A program in each counted the wheel reports:

| Gesture | Travel | Reference terminal, rows of 17 points | BaseHalf, rows of 14 px |
| --- | --- | --- | --- |
| Slow, 220 points, no momentum | 12.9 and 15.7 rows | 12 to 13 | 15 to 16 |
| Medium, 635 points, with momentum | 37.4 and 45.4 rows | 27 | 46 |
| Fast, 2,090 points, with momentum | 122.9 and 149.3 rows | 96 | 150 |

Two things differ. The reference terminal's rows are taller, so the same
travel is fewer rows. And it does not carry a remainder: once its accumulator
holds one row or more, it sends the whole rows and starts again from zero.
Its source says that it saves the remainder, and computes that remainder
from the quotient before truncating it, which is zero. A swipe that covers
1.6 rows with every event therefore scrolls one row an event. Read that way,
its source gives 12, 26, and 94 reports for the three gestures; keeping the
remainder would give 12, 37, and 122. Claude Code scrolls more rows per
report as reports get denser, so BaseHalf's 46 against 27 is far more than
1.7 times the distance.

With the rows rule and the row height of this specification, the same
gestures gave 12 to 13, 27, and 103 reports in BaseHalf. The slow and the
medium gesture match the reference terminal. The fast one is 7 reports
above its 96: the posted gesture holds six events of 48 points in a row, and
the workbench's wheel classifier takes equal events of 40 points or more for
notches of a physical wheel, which count three rows each. The reference
terminal asks the operating system which device it is; a web page cannot.

A full-screen program paints the background of each of its cells. On
2026-10-27 the user saw a long strip down the right side of the Agent Area
while a full-screen agent that paints its own background ran there. Measured
that day in a pane 289 px wide and 797 px high, at a scale factor of 2, with
cells of 7.5 by 17 px: the grid was 270 px wide, and the 17 px to its right
and the 13 px under it showed the theme's terminal background, rgb(31, 31,
31), beside the program's rgb(4, 4, 4). The terminal counted its columns as
VS Code's terminal does, after keeping 14 px at the right for a scrollbar,
and 3 px were left of a cell's width. Under the grid lay the 11 px left of a
row's height and the pane's inset of 2 px. VS Code 1.143.1 showed the same
program with 10 px to the right of its grid and 26 px under it in its
panel's background. The reference terminal keeps 2 px at each side by
default and leaves the rest of a cell at the right and of a row at the
bottom. It fills that space with its background color, or, when its padding
color is set to extend, with the color of the nearest cell.

The base has settings for what a terminal does beyond its text: whether
closing it asks first, what a secondary click does, how its tab is named,
and what its bell shows. On 2026-11-21 the audit of the settings
([the settings BaseHalf offers](settings-catalog.md)) found that the Agent
Area followed none of them. The Agent Area creates the terminal of a session
as one the base hides from the user, so that the base's terminal panel never
shows it. The base then counts it as a background terminal, in none of its
terminal groups, and what the groups and the base's tabs did for a terminal
went with them. Run in the real window that day:

- With `terminal.integrated.confirmOnKill` as `always` and `sleep 600` in a
  Terminal session, closing the tab asked nothing. Six seconds later, when
  the session was destroyed, the question came, and Cancel left `sleep 600`
  running with no session to show it.
- A Terminal session was named Terminal whatever ran in it, and a title
  that a program set showed nowhere.
- A secondary click selected the word under it and showed no menu.
- Open in Integrated Terminal on a folder in Files showed nothing: it
  created a terminal of the base's panel, which BaseHalf hides.

## Goals

- Agent Area terminals behave like a native terminal at the input and identity
  boundary: Ghostty wheel semantics and BaseHalf's own identity.
- The behavior is the same for every TUI and does not depend on the internal
  heuristics of any agent, which change between releases.
- VS Code behaviors that key on the integrated-terminal identity keep working.
- Claude Code's xterm.js-only glyph-atlas workaround, which no longer applies,
  is replaced by atlas maintenance in the terminal itself.
- A terminal shows a scrollbar only where it has rows to scroll to.
- A program's output reaches the window as soon as the pty has delivered it,
  so that a frame that answers a wheel report shows without a wait of the
  terminal's own.
- A program that paints its own background reaches the edges of its pane, at
  every size of the pane, and a shell looks as it did.
- A setting of a terminal that BaseHalf lists does in a session of the Agent
  Area what it says.

## Non-goals

- Scrolling the normal buffer's scrollback. xterm.js's own smooth viewport
  scrolling already keeps up with the trackpad and stays unchanged.
- Horizontal wheel input, touch gestures, and wheel events with a modifier
  key, such as fast scroll and zoom. They keep xterm.js and VS Code behavior.
- Changing any agent, or tuning reports for a particular agent. Telling an
  agent what the terminal supports, through a variable that the agent
  documents for that purpose, is not tuning.
- A scrollbar for content that a TUI scrolls by itself. The terminal does not
  know that position.
- Making IDE companion integrations of TUI agents, such as Claude Code's or
  Gemini CLI's VS Code extension auto-connect, work under the new identity.
- Three groups of the base's settings of a terminal, which stay pending in
  [the settings BaseHalf offers](settings-catalog.md#pending-29): sessions
  that are there again after the window reloads
  (`terminal.integrated.enablePersistentSessions`, `persistentSession*`), a
  split that starts where its session is (`terminal.integrated.splitCwd`),
  and the suggestions of a shell (`terminal.integrated.suggest.*`).
- A mark outside the Agent Area for a bell that rings while the Agent Area
  is hidden.
- The entries that extensions add to the base's menu of a terminal.

## Terminology

- **Integrated terminal**: a terminal process whose environment VS Code's
  terminal environment builds. In BaseHalf every integrated terminal is an
  Agent Area terminal (D21), so this specification applies to all of them.
- **Wheel report**: a mouse report for wheel button 4 (up) or 5 (down) in the
  mouse encoding that the application selected, such as SGR (`ESC [ < 64 ; …
  M`), SGR-Pixels, URXVT, or the default encoding.
- **Wheel tracking**: the application enabled a mouse mode that reports the
  wheel, which is mode 1000, 1002, or 1003. Mode 9 (X10) does not report it.
- **Precise event**: a wheel event from a trackpad or another device that
  reports pixel deltas. **Discrete event**: a notch of a physical mouse wheel,
  as VS Code's `MouseWheelClassifier` classifies this terminal's wheel events.
- **Grid**: the rectangle of the cells that the terminal shows, as many whole
  rows and columns as fit. **Edges**: the part of the pane outside the grid.
- **Terminal session**: a session of the Agent Area whose pane is a
  terminal: a Terminal session, an agent's session that runs the agent's
  program in a terminal (Codex, Claude Code), and a terminal that an
  extension created. A session that an agent's extension draws is not one.
- **Background of a cell**: the color the terminal draws behind the cell: its
  palette entry or its RGB color, its foreground when the cell is drawn
  inverse, and the terminal's default background otherwise. The default
  background is the terminal's background at that moment, also after the
  program changed it (OSC 11); a palette entry likewise follows OSC 4.

## Required behavior

### Identity

1. The environment of every integrated terminal sets `TERM_PROGRAM=BaseHalf`
   and `TERM_PROGRAM_VERSION` to the product's `basehalfVersion`, or to the VS
   Code version when the product defines none. Local and remote terminals
   behave the same. `TERM` and `COLORTERM` are unchanged. A `strictEnv` launch
   still receives neither variable.
2. A terminal answers XTVERSION (`CSI > q` or `CSI > 0 q`) with
   `DCS > | BaseHalf(<version>) ST`, using the same version, instead of
   xterm.js's `xterm.js(<version>)`. xterm.js handles other parameter values.
3. VS Code behaviors that identify the integrated terminal through
   `TERM_PROGRAM` recognize `BaseHalf` instead of `vscode`:
   - opening files from the `basehalf` CLI in the current window on Linux and
     Windows;
   - returning focus to the terminal after `--wait`;
   - fish shell integration, which loads only in an integrated terminal;
   - Python environment activation in the zsh, bash, fish, and PowerShell
     integration scripts.

   The CLI's shell-integration usage comments name `BaseHalf`.
4. Consequences that are accepted:
   - Tools treat the terminal as an unknown truecolor `xterm-256color`
     terminal. Their xterm.js-specific behaviors no longer apply.
   - TUI agents no longer auto-connect to their VS Code companion extensions.
   - A process keeps the identity it started with. Sessions started before an
     update report `vscode` until they restart.
   - Dotfiles that test `TERM_PROGRAM` for `vscode` no longer match.

### Wheel input

For each wheel event on a terminal that has a vertical delta and no Ctrl,
Alt, Meta, or Shift key:

1. **Amount.** The event is converted to rows, with a fraction:
   - A precise event contributes its vertical delta in pixels divided by the
     cell height, so one cell height of finger travel is one row on every
     display and the content follows the fingers. This is the reference
     terminal's amount on a display with a scale factor of 2. Its amount
     varies with the scale factor; BaseHalf's does not. The amount is not
     tuned to an agent. A line delta counts one row per line and a page delta
     counts the terminal's rows.
   - A discrete event contributes at least one notch, and three rows per
     notch, as Ghostty does on macOS. A notch is a whole number of rows
     whatever the cell height.
   - Both are multiplied by `terminal.integrated.mouseWheelScrollSensitivity`.
2. **Rows.** The terminal accumulates the amount, with its sign, also across
   a change of direction, while it is less than one row. Once the accumulator
   holds one row or more, the terminal sends the whole rows, truncated toward
   zero, and empties the accumulator: the fraction is dropped, as the
   reference terminal drops it. A gesture that covers more than one row with
   each event therefore scrolls less than its travel.
3. **Dispatch.**
   - With wheel tracking, the terminal sends one wheel report per row, at the
     cell under the pointer. It uses xterm.js's own encoder, so the
     application's protocol and encoding apply unchanged.
   - Without wheel tracking, in the alternate buffer, it sends one cursor-up
     or cursor-down sequence per row. Application cursor mode selects
     `ESC O A` over `ESC [ A`.
   - Otherwise the event goes to xterm.js's viewport scrolling unchanged.

   In the first two cases the event is consumed even when it adds up to no
   whole row, so the viewport does not scroll.
4. Events outside this rule, and every event in X10 mode, keep xterm.js's
   behavior.
5. If xterm.js's internal encoder or coordinate service is missing, which an
   xterm.js upgrade could cause, wheel reports fall back to xterm.js's
   behavior and a warning is logged once per terminal. A test pins those
   internals so that such an upgrade fails tests instead.

### Row height

The number of reports for a gesture depends on the height of a row, so equal
rows are part of scrolling like the reference terminal.

1. BaseHalf's default for `terminal.integrated.fontSize` is 13 and for
   `terminal.integrated.lineHeight` 1.15. With the default font family on
   macOS that gives rows of 17 px, the row height of the reference terminal
   at its default font size, which is also 13.
2. A user who sets another font size or line height gets other rows and a
   proportionally different scroll distance, as in the reference terminal.

### The grid and its edges

1. **Width and height.** The grid takes the pane less 2 px at each of its
   four sides, as the reference terminal's default padding does, and as many
   whole cells as fit in what remains. The terminal keeps no width for the
   scrollbar: the scrollbar lies over the rows (Scrollbar), and a program in
   the alternate buffer has none. What is left of a cell's width lies at the
   right of the grid, and what is left of a row's height lies under it.
2. **Beside the rows.** At the left and at the right of the grid, the edge of
   each row has the background of the row's first and of its last cell.
3. **Above and under the rows.** Above the grid, the edge of each column has
   the background of the column's cell in the first row, and under the grid,
   of its cell in the last row. The corners take the background of the
   corner cell. A row colors its edge this way only when none of its cells
   has the default background and none holds a powerline glyph, U+E0B0 to
   U+E0C8, U+E0CA, U+E0CC to U+E0D2, or U+E0D4: a row with a cell in the
   default background looks right with the default background beside it, and
   a powerline glyph drawn wider looks wrong. Otherwise that edge and its
   corners have the default background. These are the reference terminal's
   rules when its padding color is set to extend, without its third rule,
   which leaves out a row that shell integration marks as a prompt.
4. **Not extended.** The selection, the cursor, the scrollbar, and links
   draw over the grid and color no edge.
5. **Timing.** The edges follow each frame the terminal draws, in the same
   frame: new output, a scroll, a switch of buffer, a change of colors, and a
   change of the pane's size or of the cells' size.
6. A shell's cells mostly have the default background, so its edges have the
   default background as before. A line that a program colors up to the last
   column, such as a full-width bar, continues to the pane's right edge.

### Glyph atlas maintenance

xterm.js's WebGL renderer keeps glyphs in a texture atlas shared by terminals
with the same font and colors. The atlas adds pages as it fills and starts
merging pages once it holds four, or as many as the GPU can bind. Claude Code
clears it for xterm.js terminals once it has drawn about 2,000 glyph and style
combinations. Under the BaseHalf identity it no longer does.

- A terminal that renders with WebGL clears the atlas at the next animation
  frame once the atlas has added three pages since that terminal last cleared
  it. Clearing empties the pages without removing them, so the atlas adds
  pages again only after they refill. It stays below the merge threshold.
- A terminal clears at most once every two seconds. When the third page is
  added sooner, the clear waits until two seconds have passed; it is
  deferred, not dropped. Pages added in the meantime do not start another
  count.
- Terminals that share an atlas count its pages independently. A clear of an
  atlas that another terminal has just cleared does nothing.
- A terminal using the DOM renderer does nothing.

### Scrollbar

A terminal's scrollbar shows where the viewport is within the rows of the
active buffer. xterm.js decides whether it is shown and marks it
`xterm-visible` or `xterm-invisible`. Until 2026-10-12 BaseHalf's stylesheet
set the scrollbar's opacity in every state, and its selector outranked the
xterm.js rule that hides the scrollbar. The scrollbar was therefore always
painted. Where no row lies outside the viewport, the slider is as long as its
track, so a full-screen TUI agent showed a bar over the whole height of the
terminal.

1. A terminal whose active buffer has no row outside the viewport shows no
   scrollbar, and the scrollbar takes no pointer input. This is the state of a
   shell whose output has not yet filled the terminal, and of every program in
   the alternate buffer. A TUI that scrolls its own content, as Claude Code
   does in its fullscreen renderer, therefore has no terminal scrollbar.
2. A terminal whose active buffer has rows outside the viewport shows the
   scrollbar while the pointer is over its rows, while the slider is dragged,
   and while the viewport scrolls and for half a second after. Scrolling by
   the user and by new output both count. It is hidden otherwise, and fades
   out the way xterm.js fades it. The slider's length and position come from
   xterm.js.
3. The scrollbar is a 6 px rounded slider in a 12 px transparent track
   without arrows, at the right edge of the pane. It lies over the rows; the
   terminal keeps no width for it. While xterm.js shows it, it is at full opacity when the
   pointer is over the terminal or the slider is dragged, and dimmed
   otherwise. BaseHalf sets neither the opacity nor its transition on a
   scrollbar that xterm.js hides, so one that xterm.js hides at once
   disappears at once.

### Output latency

A full-screen program answers a wheel report with a frame. How soon that frame
shows decides whether the content follows the fingers. Measured on 2026-10-12,
a program that repaints at once answers a report through the pty in 0.2 ms.
The terminal host, which reads the pty in a process of its own, kept every
output for 5 ms before it sent it to the window, to bound the number of
messages under a flood of output. The output of a program that answered at
once reached the window 6.0 to 6.6 ms after the report. At 120 Hz the window
draws a frame every 8.3 ms, so a frame that needed a few milliseconds more to
be written missed the next frame of the window and showed one frame later.

1. Output that follows a quiet period is sent to the window once the pty has
   been silent for 0.25 ms. A quiet period means that the pty delivered
   nothing for 5 ms. A pty delivers what a program writes at once in pieces of
   1,024 bytes, a fraction of a millisecond apart. The silence keeps those
   pieces in one message.
2. The batch of 5 ms that began with that output stays open. What arrives
   later in it goes in one message at its end, no later than before. Output
   that follows other output within 5 ms is batched as before. A flood of
   output therefore costs at most one message more than before for each quiet
   period.
3. This applies to every integrated terminal. The other users of the same
   buffer, which carry terminal data to and from extensions, are unchanged.

### Scroll regions for Claude Code

Claude Code scrolls its fullscreen transcript in one of two ways. With scroll
regions it asks the terminal to move the rows that stay and sends only the
rows that appear. Without them it sends every row again. It uses scroll
regions where it expects synchronized output (DEC mode 2026), and it decides
that from the terminal's name when it starts, before the terminal has
answered its query. It does not know the name BaseHalf. In an Agent Area
terminal it therefore sent every row again, although the terminal supports
synchronized output and says so.

A repaint is slow to arrive. A pty on macOS passes 1,024 bytes at a time, and
Claude Code writes the next piece about 1.1 ms after the last. The terminal
shows nothing of a synchronized frame until its last piece. Measured on
2026-10-12 with Claude Code 2.1.296, a terminal of 101 columns and 57 rows, a
Chinese transcript, and a slow swipe at 120 Hz, over two runs:

| Way of scrolling | Sent for one row | Frame complete after the report | Shown after the report |
| --- | --- | --- | --- |
| Every row again | about 3,200 characters, in 3 messages | 18 to 19 ms | 23 to 24 ms, the third frame |
| Scroll regions | about 220 characters | 5 to 6 ms | 8 to 9 ms, the next frame |

1. On macOS and Linux, the environment of every Agent Area terminal sets
   `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1`. Claude Code documents this variable for
   a terminal that supports synchronized output and is not detected. It makes
   no claim that the terminal does not keep: xterm.js implements synchronized
   output and scroll regions. A launch configuration that sets the variable
   itself keeps its own value.
2. The variable names one agent because that agent reads no other statement
   of this capability at the time it decides. It changes nothing for other
   programs. BaseHalf sets no variable that changes how an agent interprets
   input.
3. On Windows the variable is not set. A pseudoconsole stands between the
   program and the terminal there, and what it does with these sequences is
   not verified.

### The settings of a terminal that a session follows

The base's settings of a terminal reach every terminal session, and no
session that an agent's extension draws. A setting that is not named here
and that the base reads inside the terminal itself, such as the font, the
cursor, and the scrollback, works as in the base.

#### Closing with something running

1. **Something runs** in a terminal session when:
   - it is an agent's session, and the agent's program has started and has
     not ended. The agent is the program of its terminal, as if a shell had
     started it;
   - it is any other terminal session, and its shell has a child process, as
     the base counts them. `terminal.integrated.ignoreProcessNames` applies
     as in the base.
2. **Closing sessions** follows `terminal.integrated.confirmOnKill`. The
   Agent Area is where BaseHalf has its terminals, in the place of the
   base's panel, and BaseHalf has no terminal in the editor area. So `panel`
   and `always` ask before sessions in which something runs are closed, and
   `never` and `editor` do not ask.
   - Every way to close asks: the close button of a tab, a middle click on a
     tab, Close Tab, Close Other Tabs, and Close Tabs to the Right, the keys
     that close a pane or a tab, Kill Pane, Kill Active Agent Area Session,
     and the base's Kill the Active Terminal Instance.
   - The question comes before anything changes. It names the session in
     which something runs, or says how many there are.
   - Cancel changes nothing: each session keeps its tab, its pane, its
     program, and the keyboard.
   - After the answer to close, the close goes on as it does without a
     question: the tab leaves the strip and a toast offers Undo for six
     seconds, and a kill ends the session at once. When the six seconds end,
     the session ends without another question.
   - While a question about a session is open, another request to close that
     session does nothing.
3. **Closing the window** follows `terminal.integrated.confirmOnExit`:
   closing the window, quitting, reloading the window, and opening another
   folder in it. `never` asks nothing. `always` asks when the Agent Area has
   a terminal session. `hasChildProcesses` asks when something runs in one.
   A session whose tab was closed and whose six seconds have not ended
   counts. There is one question for the window, and Cancel keeps the window
   and every session. The base asks no question of its own about terminals.
4. **Defaults.** BaseHalf's default for `terminal.integrated.confirmOnExit`
   is `hasChildProcesses`: a window that closes takes an agent's run with
   it, nothing brings it back, and the key that closes a pane closes the
   window when the keyboard is elsewhere. The default for
   `terminal.integrated.confirmOnKill` stays the base's `editor`, which asks
   nothing in the Agent Area: a closed session comes back with Undo.

#### Clicks

1. A secondary click on the terminal of a session follows
   `terminal.integrated.rightClickBehavior`:
   - `default` shows the session's menu;
   - `selectWord` selects the word under the pointer and shows the menu.
     The terminal selects the word itself, and selects none while the
     program tracks the mouse;
   - `copyPaste` copies the selection and takes it away when there is one,
     and pastes otherwise. It shows no menu;
   - `paste` pastes and shows no menu;
   - `nothing` shows no menu. The click goes to the program, as it does with
     every value while the program tracks the mouse.

   With Shift held, a secondary click shows the menu whatever the setting
   says, as in the base. The menu also opens from the keyboard, with the key
   that opens a menu.
2. A middle click follows `terminal.integrated.middleClickBehavior`: `paste`
   pastes, and `default` gives the terminal the keyboard and leaves the rest
   to the system.
3. The menu holds Copy, Paste, and Select All; Clear; Split Pane Right and
   Split Pane Down; and Close Pane. Copy is disabled while the terminal has
   no selection. Each item does what its key does, and the menu shows the
   keys. The pane that was clicked is the pane in front, and the items act
   on it. The menu is drawn as the window draws its menus
   (`window.menuStyle`), where the tab's menu is drawn.
4. A paste from a click or from the menu is the base's paste: files on the
   clipboard are typed as their paths
   ([copy, paste, and drop](copy-paste-and-drop.md)), and text of several
   lines asks first as `terminal.integrated.enableMultiLinePasteWarning`
   says.
5. A click on the terminal's scrollbar does none of this.

#### The name of a session

1. A tab shows the name of its session, of the pane in front where the tab
   has several, and after the name, dimmer, the session's description when
   it has one.
2. **A plain terminal**, which is a Terminal session or a terminal that an
   extension created, is named by the base.
   `terminal.integrated.tabs.title` gives the name, by default the process
   that runs in the terminal. `terminal.integrated.tabs.description` gives
   the description, by default the folder the shell is in when that is not
   the folder of the workspace. `terminal.integrated.tabs.separator` stands
   between their parts. With `terminal.integrated.tabs.allowAgentCliTitle`
   on, a program in it that the base knows as an agent's names the tab with
   the title it sets, as in the base. A terminal that was created with a
   name of its own keeps that name. The Agent Area gives a terminal no name.
   Until the terminal has a title, the tab says Terminal.
3. **An agent's session** shows the title that the agent's program sets for
   its terminal, in place of the agent's name, while
   `terminal.integrated.tabs.allowAgentCliTitle` is on and the program runs.
   Before the program has set a title, after it has ended, and with the
   setting off, the tab shows the agent's name, Codex or Claude Code. The
   title template names plain terminals only: it would name an agent's
   session by its process. The description of an agent's session follows
   `terminal.integrated.tabs.description` like that of any terminal.
4. A name that the user gave the tab stands in place of all this, and the
   tab then shows no description.
5. A name is one line. Line breaks and tabs in it are dropped, the icons
   that the base's templates write as `$(name)` are drawn as icons, and what
   comes after 256 characters is cut.
6. **A name does not move the strip.** The tabs share the strip's width
   equally whatever their names say. A name longer than its tab ends in an
   ellipsis; the description gives way before the name does, and the compact
   density leaves it out. When a name or a description changes, only that
   text changes, at the next frame: the strip is not drawn again, it keeps
   its place, and its tabs keep their elements, so that a press, a double
   click, a drag, and the rename field on a tab go on. Changes within one
   frame are one change.
7. The toast of a closed tab and the question before a close name the
   session as its tab does.
8. The tab's key, its state, its activity dot, and the scrolling of the
   strip are unchanged.

#### The bell

An agent rings the bell of its terminal when it needs the user. The bell on
the tab is how a user who looks at another session comes to know, and a user
who shows the Agent Area again after hiding it.

1. With `terminal.integrated.enableVisualBell` on, a bell that a program
   rings shows on the tab of its session: a bell stands where the tab's
   activity dot and its close button stand, and the close button returns
   under the pointer. BaseHalf's default for the setting is on; the base's
   is off.
2. A session is **in view** while the Agent Area is shown and its tab is in
   front. The bell of a session in view shows for
   `terminal.integrated.bellDuration` milliseconds after the last ring. The
   bell of a session that is not in view stays until the session comes into
   view, and from then for the same time, as if it rang at that moment: a
   second is too short for a user who is elsewhere.
3. A tab with several panes shows the bell of any of them.
4. The bell sounds as the base's signal says: the base plays
   `accessibility.signals.terminalBell` for every ring of every terminal, in
   view or not, and that setting says whether a sound is heard. The base
   turns a value of the deprecated `terminal.integrated.enableBell` into
   these two settings.
5. As in the base, a ring within the first second of a terminal shows
   nothing.
6. A bell changes only its mark on the tab: the strip is not drawn again
   ([The name of a session](#the-name-of-a-session), rule 6).

#### Open in Integrated Terminal

`terminal.explorerKind` and `terminal.sourceControlRepositoriesKind` say
which terminal Open in Terminal starts from Files and from the repositories
of Source Control. With `integrated` or `both`, their menus hold Open in
Integrated Terminal.

1. Open in Integrated Terminal opens a Terminal session of the Agent Area
   whose shell starts in the folder: the folder that was chosen, the folder
   of a file that was chosen, or the root of the repository. The Agent Area
   shows, with the session in front and the keyboard in it.
2. With several items chosen in Files, each folder among them gets one
   session.
3. No terminal of the base's panel is created. The entry goes the way the
   terminal commands go that BaseHalf turns into sessions of the Agent Area.
4. With `external`, Open in External Terminal starts the system's terminal
   as in the base.

#### The accessible view

A screen reader cannot read the terminal's canvas
([screen reader mode](screen-reader-mode.md)). The base offers the
terminal's text in its accessible view, and help for the terminal's keys in
Accessibility Help.

1. Open Accessible View, Focus Accessible Terminal View, and Accessibility
   Help act on the terminal of the session that has the keyboard. While the
   keyboard is in the accessible view, they and the keys of the view act on
   the terminal of the session in front. They create no terminal of the
   base's panel. Focus Accessible Terminal View without a terminal session
   opens a Terminal session first.
2. The view holds the text of that terminal, and Escape returns the keyboard
   to it.
3. `terminal.integrated.accessibleViewPreserveCursorPosition` and
   `terminal.integrated.accessibleViewFocusOnCommandExecution` work as in
   the base.

## Failure and recovery

- An agent that assumed xterm.js's sparse wheel reports receives the reports
  any native terminal sends.
- A missing xterm.js internal falls back as described in Wheel input. Identity
  and atlas maintenance do not depend on it.
- Losing the WebGL context disposes the renderer, and atlas maintenance stops
  with it. VS Code's DOM fallback is unchanged.
- A Claude Code that no longer reads `CLAUDE_CODE_FORCE_SYNC_OUTPUT` sends
  every row again, as before. Scrolling is slower, and nothing breaks.
- If Claude Code's scroll regions leave wrong rows on the screen, its
  `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1` makes it send every row again.
- If an xterm.js upgrade renames the classes that mark the scrollbar as shown
  or hidden, BaseHalf's opacity rules stop matching and xterm.js's own
  opacity applies. The scrollbar still hides where nothing can scroll. A test
  pins the class names so that such an upgrade fails tests instead.
- The edges read the grid's element and the terminal's current colors from
  xterm.js internals. If an upgrade removes them, the terminal draws no
  edges, logs a warning once, and the pane shows the theme's terminal
  background around the grid. A test pins those internals so that such an
  upgrade fails tests instead.
- The edges read the cells, not the renderer, so they are the same when VS
  Code falls back to its DOM renderer.
- The question before a close needs to know whether a shell has a child
  process, which the base learns about a second after the last key. A close
  within that second finds nothing running and asks nothing; the tab's Undo
  still brings the session back.
- A question that is open when its session's program ends closes nothing by
  itself: after the answer the tabs are read again, and a session that is
  gone is left out.
- The name, the description, and the bell are read from the base's terminal:
  its title and description, the title its program set, and the bell among
  its statuses. If a base update renames them, the code no longer compiles.
- A terminal whose program never sets a title, and an agent whose program
  the base does not know, show the name they have without it.

## Acceptance criteria

1. A unit test of the terminal environment shows `TERM_PROGRAM=BaseHalf` and
   the given version, and no identity for a `strictEnv` launch.
2. A unit test of the wheel conversion covers:
   - accumulating precise deltas of less than a row, also across a change of
     direction, and dropping the fraction once whole rows are sent;
   - a discrete event yielding three rows per notch and at least one notch,
     also at a cell height that is not a whole number of pixels;
   - line and page deltas;
   - sensitivity.
3. A browser test with a real xterm.js terminal opened in the DOM shows:
   - with SGR mouse mode, a wheel event worth N rows sends N reports
     `ESC [ < 64 ; col ; row M` for the cell under the pointer, before its
     dispatch returns;
   - with the default encoding, N default-encoded reports;
   - in the alternate buffer without mouse mode, N cursor sequences, with
     application cursor mode respected;
   - in the normal buffer, and with a modifier key, nothing is sent and
     xterm.js handles the event;
   - in X10 mode, xterm.js handles the event;
   - XTVERSION is answered with `BaseHalf(<version>)`;
   - the xterm.js internals that wheel reports use exist;
   - the xterm.js classes that mark the scrollbar as hidden without
     scrollback, and as shown under the pointer with scrollback, exist.
4. A unit test of atlas maintenance with a fake clock shows a clear after the
   third added page, coalesced to one frame, and a clear that the two-second
   interval defers rather than drops.
5. A unit test shows that window reuse and `--wait` recognize `BaseHalf` and
   no longer recognize `vscode`.
6. A unit test of the output buffer with a set clock shows:
   - output after a quiet period sent once the terminal has been silent for
     the quiet time, with the pieces that arrived meanwhile in one message;
   - output that arrives later in the same batch sent at the end of the
     batch;
   - a batch that begins less than its length after other output not sent
     early;
   - a batch that never falls silent sent at its end.
7. A unit test shows `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1` in the environment of
   an Agent Area terminal on macOS and Linux, absent on Windows, and a launch
   configuration's own value kept.
8. The smoke test shows, in an Agent Area terminal:
   - `TERM_PROGRAM=BaseHalf` and the product's version;
   - `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1` on macOS and Linux;
   - the XTVERSION reply;
   - that a trackpad gesture of P pixels in one direction, over a program
     tracking the mouse in the alternate buffer, followed by two notches of a
     physical wheel, produces the reports of rule 2 for its events plus 6,
     within one.
     The gesture is dispatched with Chromium's precise-scroll `wheelDelta` (three
     times the pixel delta). CDP-synthesized wheel events always carry one
     notch, so they stand in for the physical wheel.
   - with more output than the terminal has rows, a scrollbar at full opacity
     that takes pointer input and whose slider is shorter than its track while
     the pointer is over the terminal, and no scrollbar once the pointer has
     left;
   - no scrollbar for a program in the alternate buffer while the pointer is
     over the terminal;
   - a grid that ends less than a cell and 2 px from the pane's right edge and
     less than a row and 2 px from its bottom edge, and, for a program in the
     alternate buffer that paints every cell in one color, that color on the
     four edges.
9. Recorded manual check: trackpad gestures posted as system events give, in
   an Agent Area terminal with BaseHalf's default font, the number of wheel
   reports that they give in the reference terminal with its default font,
   for a slow gesture and for one with momentum. The Problem section holds
   the record of 2026-10-13: 12 to 13 and 27 reports in both.
10. Recorded manual check: Claude Code in its fullscreen renderer in Agent Area
   logs `wheel accel: window (native)`, `TERM_PROGRAM=BaseHalf`, and
   `DECSTBM: enabled`. After its scroll regions have moved the transcript, the
   screen is the same as after a repaint of every row (Ctrl+L). A slow
   swipe moves its transcript one row per report and as far as the fingers
   travel, within three rows. During a medium swipe the transcript moves at
   most six rows per report on average, and it follows each report within
   100 ms.

   Recorded 2026-10-12 with Claude Code 2.1.296, 120 Hz trackpad-shaped
   events, a cell height of 14 px, and an 800-line transcript, over two runs
   on a machine under load:
   - **Slow swipe (220 px, about 16 rows of travel):** 14 to 15 reports moved
     the transcript 13 to 14 rows in steps of one row, and it stopped with the
     swipe. Each update came within 83 ms of its report, with a median of 15
     to 17 ms.
   - **Medium swipe (635 px, about 45 rows of travel):** 44 reports moved the
     transcript 190 rows, 4.3 rows per report, in updates of a median of 6
     rows and at most 13. Each update came within 34 ms of its report, with a
     median of 7 to 8 ms.

   Recorded 2026-10-12 with Claude Code 2.1.296 started with
   `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1`, a terminal of 101 columns and 57 rows,
   and transcripts in English and in Chinese: the log said `DECSTBM:
   enabled`, and after each of 18 swipes, slow, medium, and fast, the screen
   was the same as after Ctrl+L. The table under Scroll regions for Claude
   Code holds the times.
11. A unit test of the background of a cell covers the default background, a
    palette entry of the 16 and of the 256 colors, an RGB color, and an
    inverse cell with a default and with a set foreground. A unit test of the
    rows above and under the grid shows that a row with a cell in the default
    background, with an RGB background equal to the default, or with a
    powerline glyph colors no edge, and that a row of colored cells does.
12. A browser test with a real xterm.js terminal opened in the DOM and its
    edges shows:
    - a row whose last cell has a colored background colors the edge at the
      right of that row, and no other row;
    - in the alternate buffer, a screen painted in one color colors the four
      edges and the corners in that color;
    - a last row with a cell in the default background leaves the edge under
      the grid in the default background;
    - a default background that the program sets (OSC 11) reaches the edges;
    - the xterm.js internals that the edges read exist.
13. Recorded manual check: the full-screen agent of the Problem section in an
    Agent Area terminal, at three widths of the pane and with the sidebar
    shown and hidden, leaves no pixel of the theme's terminal background
    between its grid and the pane's border, and a shell looks as before.

    Recorded 2026-10-27 at a scale factor of 2, with the agent painting
    rgb(10, 10, 10), and rgb(255, 255, 255) under a light terminal
    background: at pane widths of 289, 349, 469, 482, 519, and 769 px, the
    last with the sidebar hidden, a pixel row from the grid's last column to
    the pane's border and a pixel column under the grid held only the
    program's color, with 2 or 7 px left beside the grid and 13 px under it.
    In a shell, a line colored to its last column reached both edges, the
    other rows and the space above and under the grid kept the default
    background, and the scrollbar showed over the last column at the pane's
    edge. Claude Code kept edges of the default background, and a full-width
    panel of Codex reached the edges. With every row in a new color at about
    120 frames a second, the edges took 9 ms of the window's 593 ms of work
    over 4.6 s, and frames came at a median of 8.3 ms.
14. A unit test of closing shows: something runs in an agent's session
    whose program runs and in another terminal session whose shell has a
    child process, and in no session that an extension draws; which values
    of `terminal.integrated.confirmOnKill` and of
    `terminal.integrated.confirmOnExit` ask, for sessions with and without
    something running; and what the question says for one session and for
    several. A unit test shows `hasChildProcesses` as BaseHalf's default for
    `terminal.integrated.confirmOnExit`.
15. Recorded manual check, in a real window with `sleep 600` in a Terminal
    session:
    - with `terminal.integrated.confirmOnKill` as `always`, the close button
      of the tab, the key that closes a pane, Close Other Tabs from another
      tab, and Kill Pane each ask before the tab leaves the strip; after
      Cancel the tab, the pane, and `sleep 600` are there, and the terminal
      takes what is typed; after the answer to close, the toast with Undo
      shows, and the session ends six seconds later with no question;
    - with the setting as `editor`, the tab closes with no question;
    - with `terminal.integrated.confirmOnExit` at BaseHalf's default,
      closing the window asks; after Cancel the window and the session are
      as before; with a shell that runs nothing, the window closes with no
      question; with `always` it asks also then, and with `never` never.

    Recorded 2026-11-21 in a development build, driven over the debugging
    port with real keys and pointer events, the question drawn in the
    window: each of the four ways asked "“Terminal” is still running."
    with the tab in the strip, and after Cancel the tab, the pane, the
    keyboard in the terminal, and `sleep 600` were there, also when the
    question came from the tab's menu. After Close Session the toast showed,
    and 6.8 s later the session and `sleep 600` were gone with no question.
    A tab whose shell ran nothing closed with no question, and so did
    `sleep 601` with the setting as `editor`. Close Window asked at
    BaseHalf's default with `sleep 600` running and kept the window after
    Cancel; it closed the window with no question when the shell ran
    nothing, and with `never` though `sleep 600` ran; with `always` it asked
    "The Agent Area has an open session." for a shell that ran nothing.
16. A unit test of clicks shows what a secondary click does for each value
    of `terminal.integrated.rightClickBehavior`, with and without a
    selection and with Shift, and what a middle click does for each value of
    `terminal.integrated.middleClickBehavior`.
17. Recorded manual check, in a real window with a Terminal session that
    printed `hello world`:
    - with `default`, a secondary click on a word shows the menu with its
      seven items and their keys, with Copy disabled; Select All and then
      Copy from the menu put the terminal's text on the clipboard; Paste
      types the clipboard at the prompt; Clear leaves the prompt alone;
    - with `selectWord`, the word is selected, and Copy from the menu copies
      it;
    - with `copyPaste`, a secondary click with a selection copies it and
      shows no menu, and the next secondary click types it at the prompt;
    - with `paste`, a secondary click types the clipboard and shows no menu;
    - with `nothing`, a secondary click shows no menu and types nothing, and
      with Shift held it shows the menu;
    - a middle click types the clipboard with
      `terminal.integrated.middleClickBehavior` as `paste`, and nothing with
      `default`.

    Recorded 2026-11-21 in a development build with real pointer events:
    with `default` the menu held Copy ⌘C, disabled, Paste ⌘V, Select All ⌘A,
    Clear ⌘K, Split Pane Right ⌘D, Split Pane Down ⇧⌘D, and Close Pane ⌘W,
    and nothing was selected; after Select All, Copy put the whole text on
    the clipboard, Paste typed `echo pasted` at the prompt, and Clear left
    the prompt's row. With `selectWord` the click selected `hello`, and Copy
    copied it. With `copyPaste` a click over the selected `world` copied it,
    took the selection away, and showed no menu, and the next click typed
    `world`. With `paste` a click typed the clipboard, with `nothing` it
    typed nothing and showed no menu, and with Shift held it showed the
    menu. A middle click typed the clipboard with `paste` and nothing with
    `default`.
18. A unit test of the name shows: a plain terminal named by the base's
    title and description, and Terminal until it has a title; an agent's
    session showing the title its program set when the setting allows, and
    the agent's name before a title, with the setting off, and for a title
    of blanks; a session that an extension draws keeping its own name; a
    name of several lines and of 1,000 characters shown as one line of 256;
    and a name the user gave a tab standing alone. A unit test of the launch
    configuration shows that the Agent Area gives a terminal no name and
    keeps a name its creator gave.
19. Recorded manual check, in a real window with two tabs:
    - a Terminal session is named `zsh`, `sleep` while `sleep 600` runs, and
      `zsh` again after it is interrupted; after `cd sub` the tab shows
      `sub` after the name;
    - a title that a program sets shows with `${sequence}` as
      `terminal.integrated.tabs.title`, and a template with
      `${separator}` shows the separator of the settings;
    - a title of 440 characters leaves the tabs' places and widths and the
      strip's scroll width as they were, and ends in an ellipsis;
    - 300 titles set within about three seconds leave the tabs' elements
      and places as they were, with no tab added or removed, and a tab
      renamed in its field meanwhile keeps what was typed;
    - an agent's session shows the title its program set, the agent's name
      with `terminal.integrated.tabs.allowAgentCliTitle` off, the title
      again with it on, and the agent's name once the program has ended;
      the question before closing it names it as the tab does.

    Recorded 2026-11-21 in a development build with real keys, with a
    stand-in for the agent's program that sets the title it is told: the
    tab read `zsh`, `sleep`, `zsh`, then `zsh` with `sub`; `my title` with
    `${sequence}`; `zsh · sub` with `/private/tmp/bh-s3-ws/sub` after it
    for a title of `${process}${separator}${cwdFolder}`, a separator of
    ` · `, and a description of `${cwd}`. With the long title the two tabs
    stayed at 128 px each and the name showed 256 characters, cut by an
    ellipsis. Over 300 titles the two tabs kept their elements, one layout
    was sampled over every frame, and the strip gained and lost no tab;
    `mine`, typed into the rename field during another 300 titles, was the
    tab's name afterwards. The agent's tab read `✳ Claude Code`, `✳ Fix
    the flaky test`, `Claude Code` with the setting off, the title again
    with it on, and `Claude Code` with Exited after `quit`; the question
    said "“✳ Fix the flaky test” is still running."
20. A unit test of the bell shows: a ring in view shows until its time
    ends; a ring out of view shows after its time has ended, until the
    session comes into view and for the time of a bell after that; and a
    session that comes into view while the bell still rings shows it until
    both times have ended. A unit test shows on as
    BaseHalf's default for `terminal.integrated.enableVisualBell`.
21. Recorded manual check, in a real window with two Terminal sessions:
    - `printf '\a'` in the session in front shows the bell on its tab and
      takes it away after the duration, at the default and at
      `terminal.integrated.bellDuration` of 3000;
    - a bell rung in the session that is not in front, three seconds after
      the other tab was chosen, shows on its tab, is still there ten
      seconds later, and goes within the duration after the tab is chosen;
    - a bell rung while the Agent Area is hidden shows on the tab in front
      when the Agent Area is shown again, for the duration;
    - with `terminal.integrated.enableVisualBell` off no bell shows;
    - with `accessibility.signals.terminalBell` set to sound, a ring loads
      the base's sound; the tabs keep their elements through a bell.

    Recorded 2026-11-21 in a development build with its sound muted: the
    bell of the session in front showed for 991 ms at the default and for
    2,994 ms at a duration of 3000, in the warning color of the theme, and
    the close button returned under the pointer. A bell rung in the other
    session showed on its tab and was there ten seconds later; once its tab
    was chosen it showed for another 1,035 ms. A bell rung while the Agent
    Area was hidden showed for 1,012 ms once the area was shown. With the
    setting off none showed. With `accessibility.signals.terminalBell` set
    to sound, the base played `terminalBell.mp3` for a ring in view and for
    one out of view, and nothing at the signal's default or with the sound
    off. The tabs kept their elements throughout.
22. Recorded manual check, in a real window whose folder holds a folder
    `sub` and is a repository: Open in Integrated Terminal on `sub` in Files
    opens a Terminal session in the Agent Area whose `pwd` is `sub`, with
    the keyboard in it; on a file it opens one in the file's folder; and
    from a repository of Source Control one in the repository's root. The
    base's panel stays hidden, and the window answers half a minute later.

    Recorded 2026-11-21 in a development build with real pointer events:
    from `sub` in Files the tab read `zsh` with `sub` and `pwd` printed the
    path of `sub`; from `scene.md` and from the repository's row in
    Changes, shown with `scm.alwaysShowRepositories`, `pwd` printed the
    folder's root; the keyboard was in the new session each time. Half a
    minute later the window answered, with three sessions and no panel.
    Before the change, on this branch, the entry from Files showed nothing,
    and about ten seconds later the window no longer answered, its renderer
    at a whole core; this was not run on the commit the branch started from.
23. Recorded manual check, in a real window in screen reader mode with two
    Terminal sessions that each printed a line of their own: the key of the
    accessible view, pressed in the session in front, shows a view that
    holds that session's line and not the other's, with the keyboard in the
    view; Escape returns the keyboard to that terminal; the key of
    Accessibility Help shows the terminal's help; after the other tab is
    chosen, the view holds the other session's line. No shell is started by
    any of this.

    Recorded 2026-11-21 in a development build with
    `editor.accessibilitySupport` on and real keys: the view opened from the
    second session held `marker-two` and not `marker-one`, with the keyboard
    in it, and Escape returned the keyboard to the terminal; Accessibility
    Help showed the terminal's help; from the first session the view held
    `marker-one` and not `marker-two`; no shell was added. With
    `terminal.integrated.accessibleViewFocusOnCommandExecution` on, a
    command that ran moved the keyboard into the view, which held its
    output. Before the change the view opened on a new terminal of the
    base's panel, which had started a shell of its own, and Escape left the
    keyboard outside the session.

