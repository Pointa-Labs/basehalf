# BaseHalf development harness

`docs/harness/` is the progressive-disclosure entry point for developing
BaseHalf itself. Start here after reading the short root `AGENTS.md` or
`CLAUDE.md`, then load only the documents that own the task at hand.

This is not the `.bh/agent-harness/` that earlier BaseHalf releases wrote into
user workspaces. The product no longer installs it, and the legacy cleanup in
[workspace state and legacy cleanup](../specs/workspace-state-and-legacy-cleanup.md)
removes the files it wrote. BaseHalf's source tree is marked, so that cleanup
never changes it.

## Context layers

1. `AGENTS.md` / `CLAUDE.md`: development indexes and source-tree safety warning.
2. `docs/harness/`: task routing, cross-cutting architecture, verification,
   and delivery rules.
3. `docs/specs/`: current required behavior and observable acceptance criteria.
4. `docs/decisions.md` and `private-docs/decisions/`: why a direction was chosen
   and what it superseded.

Use specifications to decide what the implementation must do. Use decisions to
understand why. Do not treat a conversation summary, plan, historical decision,
or current code behavior as a substitute for an active specification.

## Start every substantive task

1. Check the task routes below and read the owning documents.
2. Update or create the active specification before changing implementation.
3. Review the specification for missing states, ownership, failure/recovery,
   compatibility, and verifiable acceptance criteria.
4. Implement within that boundary.
5. Run the scoped checks and delivery gate in
   [verification-and-delivery.md](verification-and-delivery.md).

The full workflow and source-tree isolation contract is
[spec-driven-development.md](../specs/spec-driven-development.md).

## Task routes

| Task family | Read first | Add when relevant |
| --- | --- | --- |
| Development workflow or source-tree initialization | [Spec-driven development](../specs/spec-driven-development.md) | The marker tests of legacy cleanup, migration, sidecar writes, generation information, and agent launch context |
| Current migration scope and module status | [Roadmap](../roadmap.md), [architecture invariants](architecture-invariants.md) | Public decisions D20–D23 in [decisions.md](../decisions.md) |
| Where a BaseHalf source file goes, which of BaseHalf's folders may import which, canvas features that register with the canvas, or a change to one of VS Code's own files | [Code organization](code-organization.md) | Public decision D60; [architecture invariants](architecture-invariants.md) |
| Canvas, Card Detail, or navigation | [Roadmap](../roadmap.md), [architecture invariants](architecture-invariants.md) | Public decisions D20, D33, D34, and D35; [workspace state](../specs/workspace-state-and-legacy-cleanup.md) for canvas viewports; matching files in `private-docs/decisions/` |
| How Card Detail fades in and out over the canvas, the frames between, where the keyboard goes, Escape, and the cards under it when it closes | [Opening and closing Card Detail](../specs/card-detail-opening.md) | Public decision D65; [generation cards](../specs/generation-cards.md#the-player) for the video or the sound it plays; [architecture invariants](architecture-invariants.md#product-shell) for the files it shows |
| Canvas card resizing, which cards resize, corner and side resize targets, or the corner indicator | [Canvas card resize](../specs/canvas-card-resize.md) | Public decision D66; [architecture invariants](architecture-invariants.md); roadmap tracks 2 and 9 |
| The place a card gets when it appears on a canvas, when BaseHalf saves it, the shape of an image or a video card, the place of a card that goes to another folder, or keeping layouts out of git | [Canvas card placement](../specs/canvas-card-placement.md) | Public decisions D46 and D66; [following moved items](../specs/following-moved-items.md) for the relocation that carries a row and for when an item is known to be new; [mirror file resilience](../specs/mirror-file-resilience.md) |
| The name BaseHalf shows for an item (a note has no extension there), a card's name in its caption: the pointer over it, the double click that renames in place, or the rename editors | [Canvas card name](../specs/canvas-card-name.md) | Public decision D55; [canvas selection and arrangement](../specs/canvas-selection-and-arrangement.md) for a card of a set; [reference graph](../specs/reference-graph.md#rename-refactor) for what a rename rewrites |
| The canvas's Create menu (a secondary click or a double click on empty canvas, and the Create button): its items, and what New Folder makes and how it is undone | [Canvas Create menu](../specs/canvas-create-menu.md) | Public decision D77; [canvas card placement](../specs/canvas-card-placement.md#pointing) for where the new card goes; [canvas card name](../specs/canvas-card-name.md) for renaming it; [generation cards](../specs/generation-cards.md#creating-a-generation-card) for New Image and New Video |
| Clicks on a card that are lost during a re-render, or the lifetime of a card element's listeners | [Canvas card interaction continuity](../specs/canvas-card-interaction-continuity.md) | [Architecture invariants](architecture-invariants.md) |
| What a two-finger scroll or a mouse wheel moves on the canvas: the canvas, or the note of the card it started on | [Canvas wheel gestures](../specs/canvas-wheel-gestures.md) | [Architecture invariants](architecture-invariants.md); [canvas card resize](../specs/canvas-card-resize.md#terms) for flow and screen pixels |
| Canvas connection handles, their capture circles and snap, or the line kept while the Create from Connection menu is open | [Canvas connection handles](../specs/canvas-connection-handles.md) | [Reference graph](../specs/reference-graph.md#creating-connected-nodes) for the menu; [canvas card resize](../specs/canvas-card-resize.md) for the resize targets on the same edges |
| Selecting cards with a marquee, what one selected card and several selected cards show, moving several cards, arranging selected cards, or tidying a canvas | [Canvas selection and arrangement](../specs/canvas-selection-and-arrangement.md) | Public decision D52; [canvas card placement](../specs/canvas-card-placement.md) for rows, chosen rows, list order, and the plain grid; [canvas connection handles](../specs/canvas-connection-handles.md) and [canvas wheel gestures](../specs/canvas-wheel-gestures.md) for what the set box covers |
| References, upstream lists, badge editor, reference index, rename refactor, migration from badge pairs, or template references | [Reference graph](../specs/reference-graph.md), [architecture invariants](architecture-invariants.md) | Public decisions D24 and D37 |
| What a Markdown Note card shows of its note: tables, images, task boxes, HTML, and the blocks that stay as they are while the card is edited; how long a note the card shows and edits, and how it builds a long note in parts; the excerpt of a text or code card; how Card Detail draws a table | [Note rendering](../specs/note-rendering.md) | Public decision D54; [canvas wheel gestures](../specs/canvas-wheel-gestures.md) for scrolling a Note at rest |
| Markdown rich/source/preview editing | Roadmap track 5, [architecture invariants](architecture-invariants.md) | [Reference graph](../specs/reference-graph.md) for frontmatter recognition and rich-editor coherence; `private-docs/decisions/vscode-base-canvas-detail-markdown-projections.md`, `rich-editor-agent-native-hardening.md`, and `rich-editor-undo-single-owner.md` |
| Agent Area, terminal, or agent extensions | [Architecture invariants](architecture-invariants.md); [agent launch context](../specs/agent-launch-context.md) for what Agent Area sessions receive at launch; [agent skill](../specs/agent-skill.md) for the skill BaseHalf offers to install for agents; [Agent Area terminal](../specs/agent-area-terminal.md) for terminal identity, wheel input, glyph-atlas maintenance, the scrollbar, output latency, and what the terminal's environment declares to agents | Public decisions D21, D36, and D39 and `private-docs/decisions/right-side-agent-area-hosts-tui-and-extension-agents.md`; the [agent bridge design](../agent-bridge-design.md) is history only |
| What agents can learn of the user's selection: the record under `.bh/cache/`, what is recorded for cards, notes, and Card Detail, the status bar entry under the Agent Area, or the skill's section about it | [The selection agents can see](../specs/selection-for-agents.md) | Public decision D57 (revises the non-goal of D35); [agent skill](../specs/agent-skill.md); [canvas selection and arrangement](../specs/canvas-selection-and-arrangement.md) |
| Screen reader mode, `editor.accessibilitySupport`, detection of assistive technology, or the terminal's live region | [Screen reader mode](../specs/screen-reader-mode.md) | Public decision D53; [Agent Area terminal](../specs/agent-area-terminal.md) |
| Items renamed or moved outside the workbench, recognizing them by content, relocating their card information, or the entries that are rewritten after a move | [Following moved items](../specs/following-moved-items.md) | Public decision D44; [reference graph](../specs/reference-graph.md#rename-refactor) for the rename refactor; [mirror file resilience](../specs/mirror-file-resilience.md) for the mirror files |
| Reading or writing `canvas.yaml`, `badge.yaml`, `adhd.yaml`, or `generation.yaml`, a `made.yaml` that cannot be read, unreadable mirror content, recovery copies, or the mirror cascade's Retry and Skip | [Mirror file resilience](../specs/mirror-file-resilience.md) | Public decision D40; [workspace state](../specs/workspace-state-and-legacy-cleanup.md) for what `.bh/` holds; [reference graph](../specs/reference-graph.md) for `upstream.yaml`, which this does not cover; [generation cards](../specs/generation-cards.md#card-information) for the fields of `generation.yaml` and `made.yaml` |
| `.bh/` persistence, canvas viewport state, focus removal, or legacy cleanup of focus files, `.bh/agent-harness/`, and root agent-file sections | [Workspace state and legacy cleanup](../specs/workspace-state-and-legacy-cleanup.md) | Public decisions D12, D13, D19, D35, and D36; `private-docs/focus_mode_spec/` only as history |
| How AI Video ships as BaseHalf's own code, the removed plugin surface, or the frozen plugin platform and its publishing | [Built-in AI Video and the frozen plugin platform](../specs/built-in-ai-video-and-plugin-freeze.md) | Public decisions D75 and D45. [Plugin architecture](../plugin-architecture.md), [plugin development](../plugin-development.md), and the [plugin docs](../plugins/) describe the frozen platform (D25, D29–D32); [reference graph](../specs/reference-graph.md#plugins) for the upstream rule on project file transitions and for template references (D37) |
| Generation cards: an image or a video card and its draft, `generation.yaml` and `made.yaml`, the inputs and their order, the mode that is used and the inputs a draft refuses, the panel under a draft and under a card with its file, its input row of tiles, the mentions in its prompt and the `@` reference menu, Pick on Canvas, the settings and the ranges the inputs narrow, New Version, the card and the player that plays a video on any card, a generation from Generate to its files and its task record, several images from one generation, or an agent generating with `basehalf --generate` | [Generation cards](../specs/generation-cards.md) | Public decisions D74, D71, D70, D69, D68, D67, D63, D64, D58, D62, and D45; [reference graph](../specs/reference-graph.md) for `upstream` and drafts as nodes; [following moved items](../specs/following-moved-items.md) for drafts and generating cards that move; [canvas card placement](../specs/canvas-card-placement.md) for where a new draft or a captured frame appears; [Video Sequence](../specs/video-sequence.md) for Sequence and the starter template |
| The Video Sequence document, its view in Card Detail and its operations, its capability for agents, or the starter template | [Video Sequence](../specs/video-sequence.md) | Public decisions D75, D63, and D45; [generation cards](../specs/generation-cards.md) for the cards a Sequence names; [reference graph](../specs/reference-graph.md#templates) for templates |
| BaseHalf's pages in Settings (Providers, About), the BaseHalf group of the Settings table of contents, and how Settings opens at a page | [BaseHalf's pages in Settings](../specs/settings-pages.md) | [Providers and the model catalog](../specs/providers.md) and [app update](../specs/app-update.md) for what each page holds; public decisions D49, D59, and D64 |
| Which providers and models BaseHalf runs, image and video models alike, what each model accepts, how each model names its inputs in a prompt, the Providers page, credentials and regions, requests to providers and the provider service in the shared process, and why BaseHalf shows no price | [Providers and the model catalog](../specs/providers.md) | Public decisions D75, D74, D70, D59, D64, D58, and D61; [generation cards](../specs/generation-cards.md) for the card, the panel, and a generation |
| The app's own update: what is downloaded and kept, when a ready update replaces the installed application, the version that is shown, or the update check before a release | [App update](../specs/app-update.md) | Public decision D47; [verification and delivery](verification-and-delivery.md) for the release checks |
| Git, SCM, GitHub, or history graph | [Git/SCM/GitHub/GitGraph](../git-scm-github-gitgraph.md) | Roadmap track 3 and public decision D22 |
| Where the title bar shows the buttons that show and hide the sidebar and the Agent Area, or what the header of Card Detail holds | [Layout controls](../specs/layout-controls.md) | Public decision D56; [workbench appearance](../specs/workbench-appearance.md) for the cards these buttons show and hide |
| The path and the search in the middle of the title bar: what a click on each part does, and where the keyboard is | [The location in the title bar](../specs/title-bar-location.md) | Public decision D73; [canvas card name](../specs/canvas-card-name.md) for the name of an open note in the path |
| Tooltips and hovers: where BaseHalf shows one, and that it never shows the system's | [Architecture invariants, "Product shell"](architecture-invariants.md#product-shell) | Public decision D65 |
| The color theme, the rounded cards of the sidebar, canvas area, and Agent Area, or the status colors in Source Control and Files | [Workbench appearance](../specs/workbench-appearance.md) | Roadmap tracks 8 and 9, public decisions D22 and D51 |
| Dependencies, licenses, or distribution | [Dependency policy](../dependency-policy.md) | [Trademark policy](../trademark-policy.md), public decisions D8–D11 |
| Running BaseHalf from source with hot reload | [Development host](development-host.md) | [Verification and delivery](verification-and-delivery.md); the fixture-workspace rule in [spec-driven development](../specs/spec-driven-development.md) |
| Tests, commit, direct-main, or release checks | [Verification and delivery](verification-and-delivery.md) | [Contributing](../../CONTRIBUTING.md) for external contributors |
| “Why did we choose this?” | [Public decisions](../decisions.md) | `private-docs/decisions/README.md`, then the relevant decision file |

`private-docs/` is a separate, intentionally untracked internal repository. It
may not exist in every checkout. Preserve its independent worktree and modify it
only when the task explicitly owns an internal specification or decision.

## Maintaining this harness

- Add a route when a new task family gains an authoritative specification.
- Prefer links and short invariants over copied subsystem contracts.
- Remove stale routes when a document is superseded.
- Keep the root agent guides equivalent and small; do not copy this index back
  into them.
