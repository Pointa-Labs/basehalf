# The location in the title bar

Status: Active (2026-10-24)
Decision: [D73](../decisions.md)
Related: [layout controls](layout-controls.md) (the two ends of the title
bar), [canvas card name](canvas-card-name.md) (the name of an open note in
the path), [architecture invariants](../harness/architecture-invariants.md)
(product shell, hovers)

## Problem

The middle of the title bar is VS Code's command center, a box that opens
the search. While a canvas or Card Detail is shown, BaseHalf draws in it the
path to the place the user is, and a search button with a magnifier at its
right end. Since 2026-07-12 the box took a click only on that button and on
the folders of the path; anywhere else a click did nothing. The box still
looked like one button: it lit up under the pointer, the pointer was the
pointing hand over all of it, and its hover said "Search …". At the root of
a workspace, where the path is one name, 16 of the box's 600 px took a click.

A press on the box also moved the keyboard into it, and the box held every
key there, so that Enter on a folder would not also open the search. Until
the user clicked somewhere else, no shortcut worked: Cmd+P, Cmd+B, and the
canvas's own. Closing the search with Escape put the keyboard back on the
magnifier, with the same result.

## Goals

- The box does what it looks like: a click on it opens the search.
- The folders of the path still go to their canvas, and nothing more.
- Using the box never takes the keyboard from the canvas, Card Detail, or an
  editor.

## Scope

In scope: what the box shows while a canvas or Card Detail is shown, what a
click and the keys Enter and Space do on each part of it, and where the
keyboard is before, during, and after.

Not in scope, and unchanged:

- The box while neither a canvas nor Card Detail is shown. It is VS Code's:
  the workspace's name, and a click anywhere opens the search.
- The search itself, VS Code's Quick Open with its modes
  (`workbench.action.quickOpenWithModes`), which takes the box's place at
  the top of the window while it is open.
- Go Back and Go Forward beside the box.
- The hovers ([D65](../decisions.md)): the path shows none, the magnifier and
  the rest of the box name the search.

## Terms

- **The box**: the location and search box in the middle of the title bar.
- **Path**: the parts in the box from the workspace folder to the place that
  is shown.
- **Folder button**: a part of the path that is not the last one.
- **Current place**: the last part of the path, in bold.

## Requirements

### What the box shows

1. The path starts with the name of the workspace folder and goes down to
   the folder whose canvas is shown. In Card Detail it ends with the open
   item's name, which for a note has no extension
   ([canvas card name](canvas-card-name.md)).
2. With more than four parts, the box shows the first part, "…", and the
   last two. "…" lists the parts it stands for.
3. Chevrons stand between the parts. The magnifier is at the right end of
   the box.

### A click

4. A click on a folder button opens that folder's canvas. The search does
   not open.
5. A click on "…" lists the parts it stands for, and choosing one opens that
   folder's canvas. The search does not open.
6. A click anywhere else on the box opens the search: on the current place,
   a chevron, the magnifier, and the room around and between the parts.
7. The pointer is the pointing hand over the whole box, and the whole box
   lights up under it, as before.

### The keyboard

8. A press on the box leaves the keyboard where it was. When the search or
   the list of "…" closes, the keyboard is back there.
9. While the keyboard is in the box, reached with Tab, every shortcut works
   as it does elsewhere.
10. Enter and Space on a folder button, on "…", or on the magnifier do what
    a click on it does, and nothing more. On the box itself they open the
    search.

### A drop

11. A folder button takes cards dragged from the canvas. While the pointer is
    over it with cards, it shows the canvas's intent color around its name,
    and cards let go there move into its folder. The current place and "…"
    take nothing ([dropping into a folder](canvas-drop-into-folder.md)).

## States and failure

- **The search is open.** The box is hidden, and the search is in its
  place, as before. Escape closes the search, and requirement 8 applies.
- **A folder button's folder is gone.** Opening its canvas fails as any
  canvas navigation does; the search does not open.
- **A press that moves the window.** The title bar's drag region excludes
  the box, so a press on the box never moves the window, and a press beside
  it always does.

## Acceptance criteria

1. On the canvas of the workspace root, a click in the empty room of the box
   opens the search. After Escape, the keyboard is on the canvas, and Cmd+P
   (Ctrl+P on Windows and Linux) opens the search again.
2. A click on the current place opens the search, and so does a click on a
   chevron.
3. With the keyboard on the magnifier, Cmd+P opens the search, and so does
   Enter.
4. With the keyboard on the box itself, Enter opens the search.
5. In Card Detail, a click on the workspace folder's button opens that
   canvas, and the search stays closed.

## Verification

- `npm run basehalf:smoke`, workbench suite, step
  `title-bar-location-opens-search`: criteria 1, 2 (the current place), and
  3, on the canvas of the workspace root.
- Card Detail suite, step `readme-titlebar-breadcrumbs`: criteria 2 (a
  chevron), 4, and 5.
- Measured on 2026-10-24 in a development window before the change: a click
  in the empty room, on the current place, or after Escape from the search
  left Cmd+P and Cmd+B without effect, and the computed pointer over the
  path and the current place was the pointing hand.
- Not measured: a real mouse through the window system. The drag regions of
  the window were read in the page (the box is `no-drag`, after the title
  bar's drag region, and nothing else overlaps it), and the smoke's clicks
  reach the page without the window system.
