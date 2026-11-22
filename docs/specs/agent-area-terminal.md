# Agent Area terminal identity, wheel input, scrollbar, the edges of its grid, the settings it follows, and the sessions a folder opens with

Status: Active (2026-10-09; scrollbar added and precise wheel amount revised 2026-10-12; wheel rows and row height matched to the reference terminal 2026-10-13; the grid's width and the edges around it added 2026-10-27; the settings of a terminal that a session follows added 2026-11-21; the sessions a folder opens with, the First Session, the bell on the title bar's button, and Kill All Terminals added 2026-11-21)
Decision: [D39](../decisions.md#d39--agent-area-terminals-identify-as-basehalf-and-scroll-like-ghostty-new-2026-10-09),
[D86](../decisions.md#d86--a-program-in-an-agent-area-terminal-reaches-the-edges-of-its-pane-new-2026-10-27),
[D140](../decisions.md#d140--a-session-of-the-agent-area-follows-the-settings-of-a-terminal-new-2026-11-21),
[D147](../decisions.md#d147--a-folder-opens-with-the-arrangement-of-its-agent-area-and-every-session-starts-anew-new-2026-11-21)
Related: [D21](../decisions.md#d21--right-side-is-agent-area-not-terminal-panel-new-2026-06-30),
[agent launch context](agent-launch-context.md),
[the settings BaseHalf offers](settings-catalog.md),
[BaseHalf's Settings](settings-pages.md#agent-area),
[layout controls](layout-controls.md)

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

The Agent Area kept nothing of its sessions. Read in the code and run in the
real window on 2026-11-21:

- Its tabs and the panes of each tab were plain data in memory, and nothing
  stored them. After every start, after Reload Window, and after a folder was
  opened again, the Agent Area was as in a new folder: hidden, and with no
  session once it was shown. A user who works with three agents side by side
  in a folder arranged them again at every start.
- A bell rung while the Agent Area was hidden showed nowhere until the area
  was shown: only the tab drew it.
- Kill All Terminals, with `terminal.integrated.confirmOnKill` as `always`
  and `sleep 600` and `sleep 601` in two Terminal sessions, asked the base's
  question, "Do you want to terminate the active terminal session?", once
  for each terminal. An agent's session, which has no child process, was
  ended with no question.
- With another folder opened in the window while `sleep 600` ran, the
  question's button said Close Window, and the window stayed.

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
- A folder opens with the tabs and panes its Agent Area was closed with, and
  a start costs the processes of one tab, however many tabs there are.
- A bell reaches a user who has hidden the Agent Area.

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
- Keeping the process of a session, or its text, through a reload or a
  restart, as the base's persistent sessions do
  (`terminal.integrated.enablePersistentSessions`, `persistentSession*`).
  BaseHalf brings back the arrangement and starts every process anew (D147).
- Telling an agent to continue what it did before. An agent's session starts
  the agent's program as a new tab does.
- The suggestions of a shell (`terminal.integrated.suggest.*`). The Agent
  Area's terminal is for agents and for a plain shell: an agent's session has
  no shell to suggest for, the extension that provides the suggestions does
  not ship, and completion is the shell's own (D147).
- A count of bells on the title bar's button, or a mark that moves.
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
- **Arrangement**: the tabs of the Agent Area in their order, and for each
  tab its name, its panes with their split and sizes, and the session of
  each pane by its kind and its folder.
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
3. The font size is the size of the text on the screen at every zoom of the
   window, and the keys that zoom change it while the Agent Area has the
   keyboard ([each part zooms by itself](zoom.md)).

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
   - **Kill All Terminals** ends every terminal session at once, also one
     whose tab was closed and whose six seconds have not ended. It asks
     once for all of them, by rule 1: the question names the session in
     which something runs, or says how many there are, and its button says
     Kill Session or Kill Sessions. Cancel ends none. A session that an
     agent's extension draws is no terminal and stays. The base asks no
     question of its own.
3. **Closing the window** follows `terminal.integrated.confirmOnExit`:
   closing the window, quitting, reloading the window, and opening another
   folder in it. `never` asks nothing. `always` asks when the Agent Area has
   a terminal session. `hasChildProcesses` asks when something runs in one.
   A session whose tab was closed and whose six seconds have not ended
   counts. There is one question for the window, and Cancel keeps the window
   and every session. The base asks no question of its own about terminals.
   The question's button names what the answer does: Close Window, Quit,
   Reload Window, and, when another folder is opened in the window or its
   folder is closed, Close Folder: the folder leaves the window, and its
   sessions end with it. A session that waits to start
   ([The sessions a folder opens with](#the-sessions-a-folder-opens-with))
   has no terminal and no program, and no question counts it.
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
   says, as in the base.
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
7. **While the Agent Area is hidden**, a bell shows on the button of the
   title bar that shows the Agent Area
   ([layout controls](layout-controls.md)): a dot in the warning color of
   the theme, the color of the bell on a tab, at the button's upper right.
   It shows from the ring until the Agent Area is shown, and then the tab
   shows the bell by rule 2. The dot has no count and does not move, and
   the button keeps its place and its size. A session that ends while the
   Agent Area is hidden takes its bell with it: the dot shows while a
   session that rang is there. The button's name says that a session rang,
   for a screen reader.
8. With `terminal.integrated.enableVisualBell` off the base keeps no bell,
   so no tab and no button shows one. When the setting is turned off, the
   bells that show go at once, on the tabs and on the button.

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

#### The folder of a split

`terminal.integrated.splitCwd` says where the terminal of a split starts.

1. Split Pane Right and Split Pane Down open a Terminal session beside the
   session in front. With `inherited`, the base's default, its shell starts
   in the folder the session in front is in now; with `initial`, in the
   folder that session started in; with `workspaceRoot`, in the workspace
   folder.
2. The session in front may be an agent's: its folder is the folder of the
   agent's program.
3. Beside a session that has no terminal, one that an agent's extension
   draws, and beside a session whose process has ended, the split starts in
   the workspace folder, as every new session does.
4. The folder is read before the pane appears, and the split is the same
   split otherwise: the same pane, tab, and keyboard.

#### The First Session

`basehalf.agent.defaultSession`, First Session in BaseHalf's Settings, says
which session a new tab starts with: Codex, Claude Code, the panel of the
Codex or of the Claude Code extension, or Terminal. BaseHalf's default is
Codex.

1. **A new tab starts with it**: the key of a new tab while the keyboard is
   in the Agent Area, a double click on the strip beside its tabs, New
   Agent Tab of a tab's menu, and the command Toggle Agent Area Terminal,
   by Control+Backquote, Command+J, or the Command Palette, when it shows
   an Agent Area that has no session.
2. The button with the plus sign at the end of the strip lists the sessions,
   and the one chosen starts. A split starts a Terminal session
   ([The folder of a split](#the-folder-of-a-split)).
3. The button of the title bar shows the Agent Area as it is. With no
   session it shows the sessions to choose from, and starts none. The
   button's command is Toggle Agent Area, the one command by that name
   ([the commands and menus BaseHalf has](commands-and-menus.md#one-command-for-one-thing),
   D150): its key and the Command Palette do what the button does.
4. A change of the setting holds for the next new tab. No session that is
   open changes.

#### The sessions a folder opens with

`basehalf.agent.restoreSessions`, Reopen Sessions in BaseHalf's Settings,
is on by default. With it on, a folder opens with the arrangement its Agent
Area had when the folder was last open, as a terminal of the system opens
with the windows it was closed with.

1. **What comes back** is the arrangement: the tabs in their order; the
   name a user gave a tab; the panes of each tab with their split and the
   sizes the user gave them; the kind of each session, which is Terminal,
   Codex, Claude Code, or the panel of an agent's extension; the folder
   each terminal session was in; which tab was in front, and in each tab
   which pane. Whether the Agent Area is shown is kept by the window, as
   before.
2. **Each session is a new process.** A terminal session starts its shell
   or the agent's program anew, as a new tab does, in the folder it was in.
   No text of the earlier process comes back. BaseHalf tells no agent to
   continue anything: what an agent offers for that is the agent's own.
3. **What does not come back**:
   - a session the user closed. It leaves the arrangement when its tab or
     pane closes, and is in it again after Undo;
   - a session whose program has ended or could not start. What it showed
     was the text of that program, which does not come back, and a program
     the user ended is not started against them. A session that is started
     again with Restart Pane is in the arrangement again. A tab all of
     whose sessions are such does not come back, and a pane beside one that
     is left out takes its room;
   - a terminal that an extension created. The extension starts it again
     when it wants it;
   - a pane's zoom, the dot of unseen output, and a bell.
4. **Sessions start when they are first in view.** A session is in view
   while the Agent Area is shown and its tab is in front. At a start, the
   sessions of the tab in front start, each pane of it. A tab that is not
   in front shows its name, and its sessions start when the tab is chosen.
   While the Agent Area is hidden, no session starts; they start when it is
   shown. A folder closed with eight tabs starts the processes of one.
5. **A session that waits to start** has a tab like any other. The tab
   shows the name the user gave it, or the name of the session's kind:
   Terminal, Codex, Claude Code. It shows no word of a state, no bell, and
   no dot. Its tab can be chosen, moved, renamed, and closed. Closing it
   asks nothing, since nothing runs in it.
6. **Nothing flashes at a start.** The strip has its tabs in the first
   frame that shows the Agent Area, with the tab in front as it was. No
   session of the First Session appears and goes, the list of sessions to
   choose from does not show, and no pane shows a state of failure or the
   word of a state while its session waits. A session that starts shows no
   word either until its terminal is there: a shell is there within a few
   frames, and a word that shows for that long is a flash. A pane whose
   terminal starts shows the terminal's background until the terminal
   draws. A tab without a name of the user's then takes the name of what
   runs in it, as a new session's tab does.
7. **The keyboard.** A window that opens leaves the keyboard where it is: a
   session that starts with the window does not take it, also where the base
   sends the keyboard to the Agent Area by itself. A session that starts
   because its tab was chosen takes the keyboard once its terminal is there,
   if it is still the session in front. Choosing a tab gives the keyboard to
   the pane in front of that tab, whether its session starts or runs; the
   field that renames a tab keeps the keyboard while it is open. A session
   that ends or is closed while it has the keyboard hands it to the pane
   that comes to the front; with no session left, the keyboard goes to the
   canvas ([where the keyboard returns](keyboard-return.md#each-closing)).
8. **No session starts in a window that closes.** As the terminals of a
   closing window end, the tabs behind them come in front; their sessions
   stay as they are.
9. **A folder that is gone.** A terminal session whose folder no longer
   exists, or is no longer a folder, starts in the workspace folder, as a
   new session does. A session that was in the workspace folder is kept as
   being there, not by its path.
10. **Where it is kept.** The arrangement is kept with the window's own
    state of the folder (the workspace's storage), on this machine, not in
    the folder and not in `.bh/`. Each folder has its own. It is written
    when the arrangement changes, within a fraction of a second: a tab or a
    pane opens, closes, moves, or is renamed, a divider moves, another tab
    or pane comes in front, a shell changes its folder, a program ends. So
    it holds after BaseHalf ended without closing, as in a crash. It is not
    written while the window closes: the sessions that end with the window
    stay in it.
11. **It holds through** Quit and a new start, Reload Window, closing the
    window and opening the folder again, and another folder opened in the
    same window, which has its own arrangement. The question before a
    window closes with something running is as it was
    ([Closing with something running](#closing-with-something-running)).
    Whether the Agent Area is shown is the base's to keep, and the base
    writes it when a window closes: after BaseHalf ended without closing,
    the Agent Area is shown or hidden as at the close before.
12. **Off.** With the setting off, the Agent Area opens with no session, as
    before, and nothing is kept: turning the setting off removes what was
    kept for the folder. Turning it on keeps the arrangement as it stands.
    The sessions that are open do not change either way.
13. **Every session of the Agent Area is started as one the base does not
    keep.** The base keeps no process of a session through a reload, on
    this machine or on a remote one, and
    `terminal.integrated.enablePersistentSessions`,
    `persistentSessionReviveProcess`, and `persistentSessionScrollback`
    change nothing in BaseHalf.

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
- An arrangement that cannot be read, because what is kept is not what
  BaseHalf writes, is left out: the Agent Area opens with no session. A
  kind of session that this BaseHalf does not know is left out like a
  session that ended.
- A session that cannot start when it comes into view shows what a new
  session shows then: the state of failure in its pane, with Restart
  Session. It leaves the arrangement by rule 3 of
  [The sessions a folder opens with](#the-sessions-a-folder-opens-with).
- When the terminals of a window all end at once without the window
  closing, as when the process that hosts them is lost, their sessions
  leave the arrangement as ended sessions do.
- The title bar's button draws the dot through the base's registry of
  title bar items. If a base update no longer asks the registry for that
  button, the button shows no dot and works as before; the tab still shows
  the bell once the Agent Area is shown.

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
24. The smoke test shows, in a Terminal session at the defaults: the tab
    named by the process in it and not Terminal; on a system whose default
    shows it, the terminal's menu with its seven items after a secondary
    click; and a bell on the tab after `printf '\a'` that goes again, with
    the tab the element it was.
25. A unit test shows where a split starts for each value of
    `terminal.integrated.splitCwd`, and beside a session without a terminal.
26. Recorded manual check, in a real window with a Terminal session after
    `cd sub`: Split Pane Right at the default opens a session whose `pwd`
    is `sub`; with `workspaceRoot`, the workspace folder; with `initial`,
    the folder the first session started in.
27. A unit test of the arrangement, from plain data, shows:
    - what is kept of two tabs, one with three panes in two splits: the
      order of the tabs, the name of a tab, each split with its direction
      and its size, each session's kind and folder, the tab in front, and
      in each tab the pane in front;
    - what is left out: a tab and a pane that were closed and can still be
      brought back with Undo, a session whose program ended or could not
      start, a terminal that an extension created, and a pane's zoom; a tab
      of only such sessions is left out, the pane beside one that is left
      out takes its room, and the tab and the pane in front are then the
      nearest that are kept;
    - a folder that is the workspace folder is kept as none;
    - what is kept reads back as the same arrangement, and what is restored
      from it has the same tabs, panes, sizes, names, and sessions, with
      new ids, and no closed tab, no dot of unseen output;
    - text that is not an arrangement, an arrangement of another version,
      and one with a kind of session that is not known are read as none or
      without that session.
28. A unit test of when a session starts shows: none while the Agent Area
    is hidden; every pane of the tab in front, and of no other tab, once
    the area is shown; the panes of another tab when it is chosen; and no
    session a second time.
29. A unit test of the bell shows the dot of the title bar's button: a ring
    while the Agent Area is hidden shows it, also while its time on the tab
    has ended; a ring while the area is shown does not, on a tab in front
    or not; showing the area takes it away and leaves the bell of a tab
    that is not in front. A unit test of the question shows Close Folder
    for another folder opened in the window and Kill Sessions for several
    sessions.
30. A unit test of the launch configuration shows that every session of
    the Agent Area starts as one the base does not keep, with and without
    the command bridge.
31. Recorded manual check, in a real window, with the window ended as in a
    crash and started again with the same state each time: a folder with
    three tabs, a Terminal session after `cd sub`, a tab named by the user
    with three panes in two splits whose dividers were moved, and a Claude
    Code session, the second tab in front. After the start: the same three
    tabs in their order with the second in front, its panes at the sizes
    they had, each with a new shell, the first pane's `pwd` the folder it
    was in; in the first second after the start, sampled in every frame,
    the strip never shows another set of tabs, the list of sessions to
    choose from never shows, and no pane shows a state; only the processes
    of the tab in front run, and the others start when their tab is
    chosen. The same after Reload Window, after Quit, and after another
    folder was opened in the window and this one again, the other folder
    with its own arrangement. With the folder of a session removed
    meanwhile, the session starts in the workspace folder. A session
    closed before the end is not there, and neither is one whose program
    had ended. With the setting off, the Agent Area opens with no session.

    Recorded 2026-11-21 in a development build, driven over the debugging
    port with real keys and pointer events, with a stand-in for the agents'
    programs that writes a line each time it starts. The main process was
    ended with a kill signal and started again with the same state; a
    sampler read the Agent Area in every frame from 0.2 to 0.4 s of the
    page, before the workbench was drawn. The dividers stood at 36% and at
    70%.
    - **After the end as in a crash.** The first frame that had the
      workbench, 1.43 to 1.47 s into the page over six starts, had the
      three tabs Terminal, Research in front, and Claude Code, with the
      three panes at 104 by 797, 185 by 557, and 185 by 240 px, as before.
      The panes showed the terminal's background for 5 or 6 frames and then
      their terminals. No other state was sampled in the 3 to 6 s after: no
      list of sessions, no word of a state, no other set of tabs. The
      keyboard was not in the Agent Area. Three shells ran, with the prompt
      of the third in `sub`; the stand-in had not started. Choosing the
      first tab started a fourth shell in `sub`, with the keyboard in it;
      choosing the third started the stand-in, with BaseHalf's launch
      context, and the keyboard in it. With the Claude Code tab in front at
      the end, the stand-in alone started.
    - **Reload Window.** The first frame with the workbench, 1.10 s into
      the page, had the tabs. The three shells of the window before were
      gone and three new ones ran, and nothing else. A build before rule 8
      started the stand-in of the next tab in the closing window and left
      it running.
    - **Quit and a new start**, with the Agent Area hidden at Quit: the
      question was "“✳ claude” is still running." with Quit. After the
      start the Agent Area was hidden and neither a shell nor the stand-in
      ran. A click on the title bar's button showed the Agent Area with the
      three tabs in its first frame, 62 ms after the click, and the
      terminals 78 ms later.
    - **Close Window**, and the folder opened again in the application that
      stayed: the tabs in the first frame with the workbench, three shells.
    - **Another folder opened in the window** had the Agent Area hidden and
      no session. With one Terminal session made there and the first folder
      opened in the window again, that folder had its three tabs in the
      first frame, and the storage held one arrangement for each folder.
    - **A folder that is gone.** With `sub` removed while BaseHalf was
      ended, the first tab and the pane that were in `sub` started in the
      workspace folder.
    - **Closed and ended.** A pane that was closed was out of what the
      storage kept 0.7 s later, with its Undo still offered, and was not
      there after the start. The Claude Code session whose program had
      ended, its tab saying Exited, was out of it likewise, and not there.
    - **Off.** Turned off with two tabs open, what was kept was gone from
      the storage and the tabs stayed; turned on, it was kept again. After
      a start with it off the Agent Area showed the sessions to choose from
      and no process ran.
32. Recorded manual check, in a real window with a Terminal session that
    rings its bell after a few seconds: with the Agent Area hidden, the
    ring shows a dot on the title bar's button in the warning color, the
    button where it was; the dot is there ten seconds later; showing the
    Agent Area takes the dot away, and the tab shows the bell for its
    time. A ring while the Agent Area is shown puts no dot on the button.
    With `terminal.integrated.enableVisualBell` off no dot shows, and
    turning it off takes a dot away at once.

    Recorded 2026-11-21 in a development build, sampled in every frame,
    with `sleep 4; printf '\a'` typed before the Agent Area was hidden: the
    dot showed from the frame of the ring, 6 px wide, 2 px from the top and
    from the right of the button, in rgb(229, 186, 125), the color of the
    bell on a tab; the button stood at the same 22 by 22 px in every frame,
    and its name read "Toggle Secondary Side Bar (⌥⌘B). A session rang its
    bell." Ten seconds later the dot was there. In the frame that showed
    the Agent Area the dot was gone and the tab showed the bell, for 1,006
    ms. A ring with the Agent Area shown showed the bell on the tab for
    1,000 ms and no dot. With the setting off a ring showed neither; turned
    off while a dot showed, the dot went 252 ms after the settings file was
    written, and the tab showed no bell when the Agent Area was shown. With
    the sidebar at the right the button would stand at the left end; the
    settings BaseHalf offers keep the sidebar at the left, so that place
    was read in the code only.
33. Recorded manual check, in a real window with `sleep 600` in two
    Terminal sessions, an agent's session, and
    `terminal.integrated.confirmOnKill` as `always`: Kill All Terminals
    asks one question, "3 sessions are still running.", with Kill Sessions;
    Cancel leaves all three; Kill Sessions ends them and both `sleep`. With
    the setting as `editor` it ends the sessions with no question.

    Recorded 2026-11-21 in a development build with `sleep 600`, `sleep
    601`, and the stand-in for Claude Code: one question, "3 sessions are
    still running.", with Cancel and Kill Sessions. After Cancel no second
    question came and the three tabs and processes were there. After Kill
    Sessions no tab, no session, and no `sleep` was left. At the default,
    two sessions with `sleep` ended with no question. Before the change, on
    the commit this work started from, the base asked "Do you want to
    terminate the active terminal session?" once for each terminal.
34. Recorded manual check, in a real window with `sleep 600` in a Terminal
    session: opening another folder in the window asks with Close Folder;
    Cancel keeps the folder and the session.

    Recorded 2026-11-21 in a development build, with Open Folder drawn in
    the window: the question said "“sleep” is still running." with Cancel
    and Close Folder. After Cancel the window had its folder and the
    session with `sleep`. After Close Folder the other folder opened with
    its own arrangement, and the shell of the folder that closed was gone.
35. The smoke test shows, in the `workbench` suite, with a tab named by the
    user and a tab of two panes: after Reload Window the Agent Area has the
    two tabs in their order under their names, with the tab in front as it
    was and its two panes; the terminal of the tab that is not in front
    starts only when its tab is chosen; a tab that was closed before the
    reload is not there; and Kill All Terminals ends the sessions with no
    question at the setting's default. The step's function was run eight
    times against a development window on 2026-11-21, from an Agent Area
    shown and hidden, with and without sessions left open; the suite was
    not run.
