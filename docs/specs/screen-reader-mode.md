# Screen reader mode

Status: Active (2026-10-13)
Decision: [D53](../decisions.md#d53--screen-reader-mode-is-the-users-choice-not-a-guess-new-2026-10-13)
Related: [Agent Area terminal](agent-area-terminal.md)

## Problem

The workbench that BaseHalf is built on has a screen reader mode, the setting
`editor.accessibilitySupport`. Its default, `auto`, turns the mode on while
the operating system reports assistive technology. A dictation tool that
reads the window through the accessibility interface counts as assistive
technology. The workbench then also asks "Screen reader usage detected. Do
you want to enable editor.accessibilitySupport …?", and Yes writes `on` to
the user's settings for good. A person who dictates is not a screen reader
user and cannot know what the answer costs.

It costs the Agent Area terminal its speed. The terminal draws its text on a
canvas, which a screen reader cannot read, so in this mode xterm.js keeps the
rows a second time as text and collects what was printed in a live region to
be read aloud. For every frame it writes the text of every changed row and
measures it. It empties the live region on a key press or when the terminal
loses focus, and it stops filling it after 20 line feeds. A full-screen
program moves the cursor and sends hardly any line feed, and scrolling with a
trackpad presses no key. The live region then grows without bound, and each
frame costs more than the last.

Measured on 2026-10-13 with Claude Code 2.1.296 in its fullscreen renderer, a
terminal of 110 columns and 65 rows, a Chinese transcript, the pointer over
the terminal, and swipes up and down for 40 seconds:

| Screen reader mode | 99th percentile of the frame interval | Long tasks |
| --- | --- | --- |
| Off | 9.5 ms throughout | none |
| On, first 4 s | 25 ms | 2, 0.3 s in all |
| On, after 10 s | 373 ms | 6, 2.6 s in all |
| On, after 35 s | about 1 s | the main thread is blocked nearly all the time |

With the mode on, 86% of the main thread's time was native code of the
browser engine, layout and the accessibility tree. The canvas stutters for
seconds after such scrolling, and showing or hiding the Agent Area is slow.

The growing live region is the cause, not the second copy of the rows. With
the limit of this specification and the mode on, the same 40 seconds kept a
99th percentile of 9.4 to 12.1 ms with no long task, and the main thread was
idle 88% of the time.

## Goals

- A person who uses a dictation tool, or any assistive technology that is not
  a screen reader, never enters screen reader mode without choosing it.
- BaseHalf asks no question whose answer the user cannot judge.
- A person who needs the mode can turn it on, and the terminal stays usable
  in it.

## Non-goals

- Making the canvas readable by a screen reader.
- Changing xterm.js.
- Changing a profile that already holds `on`. That value is the user's
  setting. The status bar shows "Screen Reader Optimized" while it holds, and
  the entry leads to turning it off.

## Required behavior

1. BaseHalf's default for `editor.accessibilitySupport` is `off`. Assistive
   technology that the operating system reports does not turn the mode on,
   and BaseHalf does not ask about it.
2. The user turns the mode on with the setting or with the command Toggle
   Screen Reader Accessibility Mode. `auto` stays a value that the user can
   choose.
3. In an Agent Area terminal in screen reader mode, the live region holds at
   most 4,096 characters. When it holds more after a frame, the terminal
   empties it, as a key press does. A program that sends line feeds is
   unaffected: xterm.js stops filling the region after 20 of them.

## Failure and recovery

- If an xterm.js upgrade renames the live region, the limit no longer
  applies, and the region grows as before in screen reader mode. A test pins
  its place and name so that such an upgrade fails tests instead.

## Acceptance criteria

1. A unit test shows `off` as BaseHalf's default for
   `editor.accessibilitySupport`.
2. A browser test with a real xterm.js terminal in screen reader mode shows
   the live region emptied once it holds more than 4,096 characters of output
   without line feeds, and left alone below that.
3. Recorded manual check: with a profile that holds no value for the setting
   and the operating system reporting assistive technology, the status bar
   shows no "Screen Reader Optimized" entry, no question appears, and the
   terminal has no accessibility tree.

   Recorded 2026-10-13 in a development host, with the report of assistive
   technology switched on through Electron's
   `app.setAccessibilitySupportEnabled(true)`: none of the three appeared.
   With the setting at `auto` in the same host, the status bar entry and the
   question both appeared.
4. Recorded manual check: in screen reader mode, swipes up and down over
   Claude Code's fullscreen transcript for 40 seconds leave the frame
   interval steady. The Problem section holds the record of 2026-10-13.
