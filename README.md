# BaseHalf

> **A compound-thinking workspace for AI-augmented knowledge work — local-first, agent-native.**
> Left screen: your AI agent (Claude Code / Codex). Right screen: BaseHalf — a desktop workspace inspired by Notion's block editor, Excalidraw's free-position canvas, and NotebookLM's source-grounded conversations, where you compose, browse, and reorganize the fragments your thinking is made of.
>
> Built by [Pointa Labs, Inc.](https://basehalf.com) · Open source ([Apache-2.0](LICENSE)). The name and logo are trademarks — see [docs/trademark-policy.md](docs/trademark-policy.md).
>
> **Status: pre-alpha, in active development.** The CLI is real but the desktop app is still being built. See [Status](#status) for what works today.

---

## Why

Tools today force a false choice: Notion for blocks but no spatial canvas, Excalidraw for canvas but no real content, NotebookLM for AI grounding but no local files. Meanwhile, every AI chat ends with the context evaporating into a scroll history you'll never re-read.

BaseHalf is the local workspace that holds the **fragments of your thinking** — files, notes, references — and lets you keep recombining them. Your AI agent reads the same fragments through a published file protocol, so what you see on the right screen is what your agent sees on the left. No prompt injection, no orchestration — just files you both touch.

## What it is (and isn't)

**Is:**

- A **desktop app** (Electron, Mac first) with a free-position canvas, a Notion-style block editor (BlockNote), and a file tree — over a folder of your real files
- An **Obsidian-style vault**: your files stay where they are, BaseHalf adds a `.bh/` layer for metadata (positions, prompts, references)
- A **published protocol** any agent can read: `.bh/focus.md` (current focus) + `.bh/badges/<file>.json` (per-file metadata) + `.bh/index/inbound.json` (reverse refs). No MCP required; any agent that can read files works.
- **Standalone-complete**: usable as a local note app even without an agent — the goal is "at least as good as Notion for editing, typing, blocks."

**Isn't:**

- ❌ An AI agent — no LLM calls, no orchestration, no workflow engine (Claude Code / Codex / Cursor already do this better)
- ❌ An IDE — not built for programmers; no LSP / build / debug
- ❌ A cloud notes service — data lives on your disk; sync is optional and future
- ❌ A content-understanding engine — no auto-summary, no auto-categorization (that's the agent's job)
- ❌ Modifying your files behind your back — all BaseHalf metadata lives in `.bh/`; your `.md` / `.pdf` / `.docx` files are touched only when you edit them through the BaseHalf UI

## The core idea

A **badge** is a file plus a **backpack** — the backpack carries a prompt (for the agent), a canvas position, and reference links. Badges are created automatically when you open a workspace; the JSON is hidden in the UI. You drag, link, and write prompts; the agent reads the published protocol and walks the graph at its own discretion.

The architecture rules:

1. **MD = content truth** — Markdown files on disk are the source. `.bh/` is a rebuildable cache.
2. **One door** — all operations go through `@basehalf/core`'s `run(command, args)`. CLI, MCP, and the desktop app are thin shells.
3. **bh never modifies user files unprompted** — only your explicit edits through the BaseHalf UI write back to MD. Agents use their own file tools directly; bh stays out of the way.
4. **Publish, don't inject** — bh writes the graph to known paths in `.bh/`. Your agent reads them and decides what to load. No system-prompt injection.
5. **Primitives, not tasks** — small composable commands (`badge add-ref`, `view create`), not task-specific ones (`arrange-into-heart`).

## Status

**Pre-alpha; CLI is real, desktop app is end-to-end usable.** Six core modules ship today:

- **`bh workspace`** — register / switch / rename / remove BaseHalf workspaces; `bh init` sets up cwd
- **`bh badge`** — get / set / list / rename badges (file + backpack: prompt + references + canvas position); add/remove references between them
- **`bh inbound`** — query reverse references (who points at this file?); rebuild from all badges
- **`bh focus`** — publish the agent focus signal (`.bh/focus.md`); set from file list or saved view
- **`bh view`** — create / list / update (rename + prompt) / delete saved views; add / remove member badges (references, not copies)

The desktop app (canvas + block editor + agent protocol) is the v0 build — Electron Mac build is **dogfood-ready today** (PRs 9–16; see [docs/roadmap.md](docs/roadmap.md)).

The earlier event-log reference implementation has been replaced by a new monorepo skeleton aligned to the current architecture. The old impl lives in git history at commit `c441f79`. (A `bh decision` CLI also shipped briefly as an internal dogfood tool and has since been retired — see [docs/decisions.md D18](docs/decisions.md).)

## Try the CLI (you can use this today)

```bash
pnpm install
pnpm -r build         # @basehalf/core, then @basehalf/cli
pnpm -r test
cd packages/cli && npm link    # makes `bh` globally available

bh init                                      # register cwd as a workspace
bh workspace add ~/Desktop/my-notes --setup  # register another folder
bh workspace list
bh workspace current

bh badge list                                # show all badges in current workspace
bh badge set chapter-03.md --prompt 'explain supply / demand simply'
bh badge addRef chapter-03.md textbook.pdf --note 'source chapter'
bh inbound get textbook.pdf                  # who references this file?
bh focus set --files chapter-03.md,textbook.pdf
bh view create 'Exam review'                 # group badges into a saved view
bh view addMember exam-review chapter-03.md --x 100 --y 200
```

## Try the desktop scaffold (PR 9 — under construction)

```bash
pnpm install
pnpm --filter @basehalf/desktop dev   # launches an Electron window
```

The window currently shows a single button that exercises the IPC bridge
to core (`window.bh.run('workspace.list')`). Real UI lands in PR 10+
(workspace selector, NavTree, canvas). See
[docs/roadmap.md](docs/roadmap.md) and `private-docs/` for the v0 plan.

Requirements: Node ≥ 20.19, pnpm 9.

## Repo layout

```text
packages/
  core/             kernel (registry + context) + modules (one per feature)
    src/
      index.ts        createCore() — the one door
      kernel/         registry, context, types
      modules/
        workspace/    add / list / use / current / remove / listFiles
                      + eager badge materialization on open
        badges/       file + folder badges; references; canvas position
        inbound/      reverse index; incremental + full rebuild
        focus/        .bh/focus.md — what the agent should read this turn
        views/        saved compound views — group badges across folders
  cli/              bh — thin shell over core (citty subcommands)
  desktop/          Electron + React shell — IPC over core, contextIsolation on
    src/main/         BrowserWindow + window state + ipc handler
    src/preload/      contextBridge → window.bh
    src/renderer/     React app — workspace UI (PR 10); canvas lands in PR 13
docs/             decisions · dependency-policy · roadmap · trademark-policy
```

## Why not just…

| Instead of | What you get | What's missing | BaseHalf |
|---|---|---|---|
| Notion + Finder | Best-in-class block editor; tidy file browsing | No spatial canvas; no agent-native protocol; data on Notion's cloud | Blocks + canvas + local files + agent protocol |
| Obsidian + canvas plugin | Local-first markdown vault; community canvas | No agent-native protocol; canvas is second-class | First-class canvas + same-vault model + agent protocol |
| Excalidraw / tldraw | Best-in-class free-position canvas | Doesn't know what's *in* your files | Canvas that reads/edits your real files |
| NotebookLM | Source-grounded AI conversations | Sources are a flat list; no spatial layout; cloud-only | Same grounding but spatial + local |
| Cursor / VSCode + extensions | IDE-tier file handling | Built for code; not for cross-format knowledge work | Built for cross-format knowledge work |
| ChatGPT / Claude built-in memory | Zero setup | Siloed per vendor; you don't own it | Portable files; any agent can read |

## Contributing

This is an early, deliberately narrow project. The desktop app is being built by the core team; **for now, please open an issue before sending a non-trivial PR** to align on scope first.

1. Read [CONTRIBUTING.md](CONTRIBUTING.md) — build/test commands and the architecture invariants.
2. Open a PR; the template walks you through the checklist and CI runs the spec.
3. Sign the [CLA](CLA.md) when the bot prompts (required before merge); contributions must use [permissively-licensed dependencies](docs/dependency-policy.md).

Bug reports, ideas, and discussion need no CLA — issues are open.

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE). Contributions require a signed [CLA](CLA.md) — see [CONTRIBUTING.md](CONTRIBUTING.md).
The "BaseHalf" name and logo are trademarks of Pointa Labs, Inc. ([trademark policy](docs/trademark-policy.md)).
