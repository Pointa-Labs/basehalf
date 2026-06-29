# Roadmap

The early game is **evidence of user pull** — people use BaseHalf daily, ask
for more, won't go back to Notion + Finder — not revenue and not a finished
product.

> **2026-05-27 update.** This roadmap was rewritten after the architecture
> pivot from "agent memory layer" to "compound thinking workspace" (see
> [decisions.md](decisions.md) D12 / D17). The old roadmap phases (Block /
> Command / Event Log → RAG → tldraw canvas → collaboration) are obsolete.
>
> **2026-06 update.** The code was aligned to `private-docs/focus_mode_spec/`:
> the `bh` CLI package, the `inbound` module, the `proposals` module, and the
> `.bh/focus.md` brief were deleted; `.bh/` is now a per-node **mirror tree** of
> YAML files (`badge.yaml` / `canvas.yaml` / `focus.yaml` / `adhd.yaml` +
> a `.bh/current_focus.yaml` symlink) and focus is a live viewport mirror, not a
> curated list. See [decisions.md D19](decisions.md). The PR-numbered tables
> below are historical; the legacy core package still contains historical
> modules, but new desktop-facing work should use the VS Code-aligned
> workbench/main-process service boundaries below.
>
> **2026-06-28 architecture update.** The previous "`@basehalf/core` is the one
> door" rule is being retired. BaseHalf is now refactoring toward VS Code's
> Electron workbench shape: renderer workbench parts, main-process services,
> provider/extension integrations, and narrow shared protocols. Existing core
> modules remain for the package's own tests/history, but the desktop app is
> moving off core adapters without changing user-visible behavior. GitHub
> integration and the SCM/mirror/config/workspace data paths now live in
> desktop main-process providers/channels. See [decisions.md D20](decisions.md).

## Product form, over time

The center of gravity is **the desktop app**. Earlier phases shipped a `bh` CLI
and then consolidated around `@basehalf/core` over IPC; that was useful
scaffolding, but new architecture work should follow VS Code-style workbench /
service / provider boundaries instead of deepening a single core RPC layer.

- **v0 (today → ~6–10 weeks):** Electron desktop app on Mac. Free-position
  canvas + block editor (BlockNote) + file tree + agent protocol. Workspace =
  Obsidian-style folder of real files. Goal: dogfoodable; the team uses it
  daily for its own knowledge work.
- **v0.x (after v0 dogfood):** polish and the things that became obvious
  during dogfood — multi-workspace, folder-grouping refinements, user-configurable
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
reads the published `.bh/` mirror. *(The protocol files referenced in the
PR-era notes below — `.bh/focus.md` + `.bh/badges/*.json` +
`.bh/index/inbound.json` — were superseded in the `2026-06` refactor by the
`.bh/mirror/` YAML tree + `.bh/current_focus.yaml` symlink; see
[decisions.md D19](decisions.md). The historical notes are kept verbatim.)*

**Agent loop verified (2026-05-28, on the pre-refactor protocol).** A headless
`claude -p` against a 3-file workspace with one focused file and two references
correctly: read `.bh/focus.md` → identified the focused file → read its badge
JSON → followed both references with their notes → read `.bh/index/inbound.json`
and concluded "nothing else references either of them." The protocol
works end-to-end without any prompting beyond the CLAUDE.md hint
installed at workspace setup. Remaining v0 success gate is real-use daily
dogfood, not protocol correctness.

| PR | What | Status |
| --- | --- | --- |
| 8 | Fix `bh init` (gitignore only `.bh/cache/`; swap recall hint for pre-v0 workspace hint); retire the `decisions` module (corpus moves to MD in private-docs) | ✅ done |
| 9 | `packages/desktop/` — Electron skeleton (main + preload + renderer), IPC working | ✅ done |
| 10 | Workspace selector + left-side file tree (Obsidian-style) | ✅ done |
| 11 | `badges` + `inbound` + `focus` + `views` modules in core + CLI commands | ✅ done |
| 12 | `watcher` module — chokidar + reconcile-on-launch | ✅ done (rename heuristic + external-edit reload prompt have since shipped) |
| 13 | Canvas (React Flow) + drag + viewport persistence | ✅ done (folder sub-canvas has since shipped) |
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
- ✅ saved-view selector in TopBar — later removed; grouping is now folder-based
  (focus a folder; the folder badge description is available through the mirror).
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
- Read **extension-less / unknown text files** (`Dockerfile`, `VERSION`, `TODO`,
  `CODEOWNERS`, a stray `*.tf` / `*.hcl` / `*.foo`). ✅ _shipped._ Viewer routing
  (`lib/viewerMode.ts`) is now a **deny-list, not an allow-list**: known non-text
  formats (Office/iWork docs, archives, fonts, media we don't decode inline) hand
  off to "open in default app"; **everything else routes to the read-only text
  viewer** — so there is no allowlist to keep growing and no dead-end. The
  capped byte-sniff in the desktop workspace files service (NUL **or** invalid-UTF-8 →
  `binary` flag, surrogate-pair-safe) is the safety net: a binary optimistically
  routed in renders a clean "binary file" message **with an open-in-app button**,
  never mojibake. The capped read is now **bounded** (`readFileBytesCappedNoFollow`):
  it fetches only `maxChars*4` bytes via an O_NOFOLLOW partial read, so even a
  multi-GB mis-routed file (or a huge log) never lands in memory whole before the
  cap/sniff runs — the read-whole-then-cap step is gone.
- **Historical core-level `.bh/` reconcile.** ✅ _shipped, then superseded by the
  mirror refactor._ This originally refreshed the old `focus.md` brief after
  badge description/ref edits. D19 removed the brief; current badge/canvas/focus/
  ADHD writes use the desktop-native YAML mirror services and keyed RMW guards.
- **Edit a folder badge's description in the desktop UI.** ✅ _shipped._ Folders
  are first-class agent-protocol badges (a folder `badge.yaml` carries a
  description + refs), and they originally lacked a desktop editing affordance
  because single-click focuses / double-click scopes into the sub-canvas / the
  editor opens only for files. Resolved with a
  contextual affordance: while **scoped into** a folder, the toolbar shows an
  edit-folder-description action that reads the folder badge's current
  description and writes it back through the mirror service. Discoverable from
  the one place you're already looking at the folder, no canvas clutter.

**2026-05-31 — retrieval + agent-handoff arc (#105–#110, all merged).** A
first-principles pass strengthening the two ends of the daily loop, then a
cross-feature composition review to confirm it all holds together:

- **Full-text content search.** ✅ _shipped (#105), then moved native._ This
  originally landed as a `search` core module + `bh search` + a debounced palette
  section. The current workbench search composes desktop workspace files and
  badge metadata directly through main-process services/providers.
- **Copy agent brief.** ✅ _shipped (#106, #108), then retired by D19._ This
  handed the old curated `.bh/focus.md` turn brief to arbitrary chats. The
  current agent floor is the `.bh/current_focus.yaml` symlink plus the
  `.bh/mirror/` YAML files; there is no `bh focus brief` path.
- **View-prompt → brief-intent freshness.** ✅ _shipped (#107), then retired by
  D19._ The old `focus.md` intent/provenance writers were removed with the
  curated brief machinery.
- **Palette match highlighting.** ✅ _shipped (#109)._ The matched query run is
  marked (accent) in both row labels and content snippets — scannable results.
- **Cross-feature composition review.** ✅ _shipped (#110)._ A holistic seam
  review of the merged arc caught two P2s per-PR review structurally couldn't.
  The specific fixes were for the pre-D19 `focus.md` protocol; the current risk
  class maps to symlink-safe `current_focus.yaml` handling and keyed YAML mirror
  writes.

Note: code-viewer **syntax highlighting** (first bullet above) remains the open
v0.x item, still gated on the dependency-policy weighing of a highlighter dep.

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
> about a real piece of knowledge work — not as a hypothetical, but about the
> desktop right-screen experience?

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
experience obvious in 30 seconds. A bare protocol dump is not a launch artifact.
