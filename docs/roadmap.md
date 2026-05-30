# Roadmap

The early game is **evidence of user pull** — people use BaseHalf daily, ask
for more, won't go back to Notion + Finder — not revenue and not a finished
product.

> **2026-05-27 update.** This roadmap was rewritten after the architecture
> pivot from "agent memory layer" to "compound thinking workspace" (see
> [decisions.md](decisions.md) D12 / D17). The old roadmap phases (Block /
> Command / Event Log → RAG → tldraw canvas → collaboration) are obsolete.

## Product form, over time

The center of gravity is **the desktop app**. CLI is a means, not an end.

- **v0 (today → ~6–10 weeks):** Electron desktop app on Mac. Free-position
  canvas + block editor (BlockNote) + file tree + agent protocol. Workspace =
  Obsidian-style folder of real files. Goal: dogfoodable; the team uses it
  daily for its own knowledge work.
- **v0.x (after v0 dogfood):** polish and the things that became obvious
  during dogfood — multi-workspace, saved-view templates, user-configurable
  file-type filters (`.bh/config.json`), possibly Rust sidecars for watcher /
  search if profiling demands.
- **v1:** still local-first, still Apache-2.0, still free. Sync (local-first,
  optional cloud), collaboration (Yjs / CRDT — architecture pre-wired for
  this), Windows / Linux builds, AI-native file manager ambition (replace
  Finder/Explorer for daily file browsing, not just AI work).
- **v1+ (option):** open-core paid layer if and only if there's clear demand
  — hosted sync, team spaces, SSO. No commitment to this; v0/v1 are fully
  free and open source.

## Current phase: v0 desktop build — feature-complete, dogfood-ready

PR 8 → PR 18 all merged. v0 is now end-to-end usable for the core loop:
pick a workspace, see badges on a canvas, drag to position, draw
references between them, click → preview + edit MD via BlockNote, agent
reads `.bh/focus.md` + `.bh/badges/*.json` + `.bh/index/inbound.json`.

**Agent loop verified (2026-05-28).** A headless `claude -p` against a
3-file workspace with one focused file and two references correctly:
read `.bh/focus.md` → identified the focused file → read its badge JSON
→ followed both references with their notes → read `.bh/index/inbound.json`
and concluded "nothing else references either of them." The protocol
works end-to-end without any prompting beyond the CLAUDE.md hint
installed by `bh init` / `workspace.add --setup`. Remaining v0 success
gate is real-use daily dogfood, not protocol correctness.

| PR | What | Status |
| --- | --- | --- |
| 8 | Fix `bh init` (gitignore only `.bh/cache/`; swap recall hint for pre-v0 workspace hint); retire the `decisions` module (corpus moves to MD in private-docs) | ✅ done |
| 9 | `packages/desktop/` — Electron skeleton (main + preload + renderer), IPC working | ✅ done |
| 10 | Workspace selector + left-side file tree (Obsidian-style) | ✅ done |
| 11 | `badges` + `inbound` + `focus` + `views` modules in core + CLI commands | ✅ done |
| 12 | `watcher` module — chokidar + reconcile-on-launch | ✅ done (rename heuristic + external-edit reload prompt have since shipped) |
| 13 | Canvas (React Flow) + drag + viewport persistence | ✅ done (folder sub-canvas + saved-view selector have since shipped) |
| 14 | Block editor (BlockNote) + PDF viewer | ✅ done (BlockNote MD round-trip is lossy — flagged in UI; G-08 hardening deferred to v0.x) |
| 15 | Media viewers (image / audio / video) | ✅ done |
| 16 | Polish + dogfood readiness | ⏳ self-build complete; dogfood week ongoing |

Originally deferred to v0.x — several have since shipped during the v0
polish/hardening arc (status updated 2026-05-30):

- ✅ BlockNote round-trip view-only fallback when serialization drift > threshold
  (content-token lossy guard → view-only mode; covered in `verify-ui`). Follow-on
  also shipped: YAML-frontmatter notes are now EDITABLE — the frontmatter is
  peeled off + preserved verbatim, only the body round-trips, so Obsidian/Jekyll
  notes aren't stuck read-only (the guard checks the body alone).
- pdf.js (currently `file://` iframe; sufficient for reading, not annotation) —
  still deferred.
- ✅ folder badge → sub-canvas (double-click) — scopes to folder contents.
- ✅ saved-view selector in TopBar (view picker + create/rename/delete/edit-prompt).
- ✅ file rename heuristic (watcher unlink+add → `badge.rename`; covered in
  `watcher.test.ts`).
- ✅ external-edit IPC + reload prompt in the editor ("changed on disk" banner →
  Keep my edits / Reload).
- macOS Full Disk Access programmatic prompt (today: guidance banner) — still
  deferred.
- canvas perf benchmark at 1000+ badges — still open; 150-badge load profiled
  fine (snappy, no jank), so the realistic-folder case is covered.

Also shipped beyond the original v0 scope: a read-only code/text viewer (so
source/config files are readable, not just docs/media) and an adaptive
auto-layout that frames large folders on first open.

New v0.x follow-ups surfaced while building the code/text viewer:

- Code-viewer **syntax highlighting** (needs a highlighter dep — weigh against
  [dependency-policy.md](dependency-policy.md); plain monospace ships today).
- Read **extension-less text files** (Dockerfile, Makefile, LICENSE, README,
  `.gitignore`) — they currently fall through to "no built-in viewer". The clean
  fix is content-based text detection (null-byte / non-printable sniff) gated on
  a **capped** `workspace.readFile` so a large unknown binary can't be slurped
  whole; do it properly rather than an ever-growing extension allowlist.
- **Core-level `.bh/` reconcile.** In-app edits to a badge (prompt / refs) need to
  refresh derived caches that the file watcher can't see (it ignores `.bh/`
  writes). v0 wires this in the renderer (the editor panel pings the canvas via a
  badge bus, and re-sets focus when a focused file is edited). The robust version
  is in core: `badge.set/addRef/removeRef` reconcile `focus.md` like they already
  reconcile `inbound.json` — needs a `focus.resync` that preserves the `intent:`
  line and a focus-file `createKeyedMutex` (resync is the first read-modify-write
  on focus.md), which then also covers CLI / agent edits, not just the desktop.
- **Edit a folder badge's prompt in the desktop UI.** Folders are first-class
  agent-protocol badges (a folder `.badge.json` carries a prompt + refs), but the
  desktop has no gesture to open a folder's panel: single-click focuses,
  double-click scopes into the sub-canvas, and the editor opens only for files.
  So folder prompts are CLI-only today. Needs a disambiguated affordance (e.g. an
  edit control on the folder badge, or an editable header inside its sub-canvas)
  — a small interaction-design call, deferred rather than bolted on.

## What we are deliberately NOT doing yet

- **No agent orchestration in bh.** Claude Code / Codex / Cursor are the
  brains. bh is the workspace. (D1, D14.)
- **No paid tier.** v0 / v1 fully free + open source. (D9 timing note.)
- **No collaboration in v0.** Architecture pre-wires for it (git as the
  conflict layer; soft-delete tombstones in `.bh/`); v1 introduces Yjs /
  CRDT if/when the team scenario shows up. (D6.)
- **No Rust pre-optimization.** TypeScript / Node for everything in v0;
  swap in Rust sidecars only when profiling shows a real bottleneck.
- **No `.docx` / `.pptx` rendering inside bh.** "Open in system app" button
  for these — Word / Keynote do this better than any in-browser renderer.
  (Notion does the same.)
- **No tldraw.** Source-available + needs commercial license; we use React
  Flow instead. (See [dependency-policy.md](dependency-policy.md).)
- **No event log / Command Bus enforcement.** MD is the truth (D12); agents
  edit MD with their own tools; git provides history.

## How we measure v0 success

After v0 ships and the team dogfoods for ~1 week, the question is:

> Did anyone on the team say *"卧槽 bh 救了我一命"* (wow, bh just saved me)
> about a real piece of knowledge work — not as a hypothetical, not about
> the CLI, but about the desktop right-screen experience?

If yes → v0 is real, start widening dogfood (early users in the
curious-learner-using-AI persona). If no → the wedge or the UX needs work
before any public soft launch.

## What "public soft launch" looks like (v1 territory, not v0)

Not a Hacker News splash. A quiet release to communities where the target
user lives:

- Claude Code / Codex / Cursor users (Discord, subreddits)
- Knowledge management communities (Obsidian, Logseq, Heptabase users)
- People who post "I'm trying to learn X with ChatGPT and it's a mess"

No promotion until there's a video / demo that makes the right-screen
experience obvious in 30 seconds. The CLI alone is not a launch artifact.
