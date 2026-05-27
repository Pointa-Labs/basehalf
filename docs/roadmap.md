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

## Current phase: v0 desktop build

PR 8 → PR 16, roughly 6–10 weeks. The CLI scaffold (workspace + decisions
modules) is the substrate; v0 builds the desktop app + the agent protocol on
top.

| PR | What | Est |
|---|---|---|
| 8 | Fix `bh init` (stop gitignoring `.bh/`); replace CLAUDE.md hint with the agent protocol guide | 0.5–1 day |
| 9 | `packages/desktop/` — Electron skeleton (main + preload + renderer), IPC working | 1 day |
| 10 | Workspace selector + left-side file tree (Obsidian-style) | 2 days |
| 11 | `badges` + `inbound` + `focus` + `views` modules in core + CLI commands | 4–5 days |
| 12 | `watcher` module — chokidar + reconcile-on-launch | 3 days |
| 13 | Canvas (React Flow) + drag + viewport persistence | 4–6 days |
| 14 | Block editor (BlockNote) + PDF viewer (pdf.js) | 4–6 days |
| 15 | Media viewers + block-embed custom blocks | 2–3 days |
| 16 | Polish + standalone-mode verification + dogfood readiness | 3–5 days |

Plus integration / debug buffer: 5–7 days. **Total: 6–10 weeks** to a
dogfood-able v0 desktop app.

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
