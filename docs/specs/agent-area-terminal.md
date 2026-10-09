# Agent Area terminal identity and wheel input

Status: Active (2026-10-09)
Decision: [D39](../decisions.md#d39--agent-area-terminals-identify-as-basehalf-and-scroll-like-ghostty-new-2026-10-09)
Related: [D21](../decisions.md#d21--right-side-is-agent-area-not-terminal-panel-new-2026-06-30),
[agent launch context](agent-launch-context.md)

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

## Goals

- Agent Area terminals behave like a native terminal at the input and identity
  boundary: Ghostty wheel semantics and BaseHalf's own identity.
- The behavior is the same for every TUI and does not depend on the internal
  heuristics of any agent, which change between releases.
- VS Code behaviors that key on the integrated-terminal identity keep working.
- Claude Code's xterm.js-only glyph-atlas workaround, which no longer applies,
  is replaced by atlas maintenance in the terminal itself.

## Non-goals

- Scrolling the normal buffer's scrollback. xterm.js's own smooth viewport
  scrolling already keeps up with the trackpad and stays unchanged.
- Horizontal wheel input, touch gestures, and wheel events with a modifier
  key, such as fast scroll and zoom. They keep xterm.js and VS Code behavior.
- Changing any agent, or tuning reports for a particular agent.
- Making IDE companion integrations of TUI agents, such as Claude Code's or
  Gemini CLI's VS Code extension auto-connect, work under the new identity.

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

1. **Amount.** The event is converted to pixels:
   - A precise event contributes its vertical delta, in pixels, times 2, as
     Ghostty does on macOS. A line delta counts one cell height per line and a
     page delta counts the terminal's rows.
   - A discrete event contributes at least one notch, and three rows per
     notch, as Ghostty does on macOS.
   - Both are multiplied by `terminal.integrated.mouseWheelScrollSensitivity`.
2. **Rows.** The terminal accumulates the pixels, with their sign. Each whole
   cell height in the accumulator is one row, truncated toward zero. The
   remainder stays for the next event, including after a change of direction.
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

## Failure and recovery

- An agent that assumed xterm.js's sparse wheel reports receives the reports
  any native terminal sends.
- A missing xterm.js internal falls back as described in Wheel input. Identity
  and atlas maintenance do not depend on it.
- Losing the WebGL context disposes the renderer, and atlas maintenance stops
  with it. VS Code's DOM fallback is unchanged.

## Acceptance criteria

1. A unit test of the terminal environment shows `TERM_PROGRAM=BaseHalf` and
   the given version, and no identity for a `strictEnv` launch.
2. A unit test of the wheel conversion covers:
   - accumulating precise deltas, with the remainder carried and a change of
     direction;
   - a discrete event yielding three rows per notch and at least one notch;
   - line and page deltas;
   - sensitivity.
3. A browser test with a real xterm.js terminal opened in the DOM shows:
   - with SGR mouse mode, a wheel event worth N rows sends N reports
     `ESC [ < 64 ; col ; row M` for the cell under the pointer;
   - with the default encoding, N default-encoded reports;
   - in the alternate buffer without mouse mode, N cursor sequences, with
     application cursor mode respected;
   - in the normal buffer, and with a modifier key, nothing is sent and
     xterm.js handles the event;
   - in X10 mode, xterm.js handles the event;
   - XTVERSION is answered with `BaseHalf(<version>)`;
   - the xterm.js internals that wheel reports use exist.
4. A unit test of atlas maintenance with a fake clock shows a clear after the
   third added page, coalesced to one frame, and a clear that the two-second
   interval defers rather than drops.
5. A unit test shows that window reuse and `--wait` recognize `BaseHalf` and
   no longer recognize `vscode`.
6. The smoke test shows, in an Agent Area terminal:
   - `TERM_PROGRAM=BaseHalf` and the product's version;
   - the XTVERSION reply;
   - that a trackpad gesture of P pixels in one direction, over a program
     tracking the mouse in the alternate buffer, followed by two notches of a
     physical wheel, produces ⌊2P ÷ cell height⌋ + 6 reports, within one.
     The gesture is dispatched with Chromium's precise-scroll `wheelDelta` (three
     times the pixel delta). CDP-synthesized wheel events always carry one
     notch, so they stand in for the physical wheel.
7. Recorded manual check: Claude Code in its fullscreen renderer in Agent Area
   logs `wheel accel: window (native)` and `TERM_PROGRAM=BaseHalf`. During a
   medium swipe its transcript moves in steps of at most six rows per report,
   with no stall of more than 100 ms while the wheel events continue.

   Recorded 2026-10-09 with Claude Code 2.1.295, 120 Hz trackpad-shaped
   events, and a 400-line transcript, over two runs:
   - **Slow swipe (218 px):** 31 to 33 transcript updates with a median step
     of 2 rows and no gap over 63 ms. Under the old identity it was 5 updates,
     3-row steps, and gaps of up to 359 ms.
   - **Medium swipe (668 px):** no gap over 42 ms until the transcript's top,
     at about five rows per report. Under the old identity there were gaps of
     up to 133 ms.
