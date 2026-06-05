# Agent Bridge — Design (DRAFT)

> Status: **draft for review.** Captures the target architecture for how an
> external AI agent (Claude Code / Codex / any) exchanges information with —
> and controls — the BaseHalf desktop app. Decisions marked **OPEN** still
> need a human call. Once settled, the load-bearing ones graduate into
> `docs/decisions.md` (next free id is D19).
>
> Third-party products are referenced generically (per the trademark policy);
> see §8.

## 1. Why — the need this serves

BaseHalf's value over a plain folder is the **graph a person curates by hand**
(file↔file relations, per-file prompts) plus **where their attention is right
now** (what they're looking at on the canvas). The goal is to make BaseHalf a
**shared thinking space for a human and an agent**: the person organizes
knowledge the most natural way — looking, selecting, connecting, writing on a
canvas — and the agent understands and participates in that space **completely,
in real time, with zero bridge-building by the user**.

- **Kill the "translation tax."** Today a person must translate what's already
  clear in their head (which files, which relation, what they're focused on)
  into text and feed it to the agent. The product should remove that step.
- **North star:** make the **shared attention** between human and agent *free*
  — the way two people sharing a desk get "this", "those two" for free.

`focus` is the smallest facet of this; the information-flow architecture below
is its root.

## 2. Core judgment — persistent plane vs runtime plane

(Earlier drafts said "dual-center" / "two truth centers" — that wording collides
with our single-source-of-truth rule, so it is retired. The split is NOT about
*who is the source*; it is about *where data lives and how it flows*. Those are
two orthogonal axes.)

A plain file-based knowledge tool is **single-plane**: files are the only state
the agent reaches, the UI is a read-only projection, and the whole information
flow is one line (`agent ↔ in-app server ↔ core ↔ files`). UI state never enters
the flow — which is why such tools can "only do the data layer."

BaseHalf has **two planes**. The split is "has a file version?" — on disk vs only
in renderer memory — **NOT** "user's files vs our metadata":

| Plane | Where it lives | Examples |
|---|---|---|
| **Persistent** (has a file version) | disk (`.md` + all of `.bh/`) | file content, badge prompts, refs, inbound index, canvas positions, search |
| **Runtime** (no file version) | renderer memory | current selection, active view & zoom, highlight, which file is in preview, the live (in-editor) document |

Both your `.md` **and** our `.bh/` sit in the persistent plane — they flow to the
agent the same way (file → core → reactive UI), so they are ONE plane, not two.
The runtime plane is state **with no file version**: its source of truth is "the
UI right now." A single-plane tool has no equivalent — this second plane is the
canvas product's differentiator.

**Orthogonal axis — source of truth (unchanged).** Within the persistent plane,
`.md` is the **content truth**; `.bh/badges` (prompt/ref/position) is **metadata
truth** the user authored (NOT derived from `.md` — which is why it stays in git;
only `.bh/cache/` is ignored); `inbound.json` + `cache/` are **derived**. So "two
planes" and "single source of truth" never conflict: planes = how data flows;
source-of-truth = who is the source within the persistent plane.

## 3. Topology — one shell, two lines

```
                         ┌──────── data line (≈ single-center tools) ────────┐
                         │                                                    │
  agent  ──[ in-app server ]── core.run ──> .md / .bh/ ──> watcher ──> UI (reactive)
   (MCP primary)  │
                  └──────── runtime line (no precedent except §8-C) ─────────┐
                                                                             │
                          main process ── IPC ──> renderer (executes UI op)  ┘
```

- **One shell:** a single local server hosted **inside the Electron app**; the
  agent's single entry point. Transport: see §4.
- **Data line:** data commands resolve through `core.run(command, args)` to
  files / `.bh/`; the file watcher then updates the UI reactively. Covers
  badge / ref / prompt / search / content.
- **Runtime line:** UI commands cross `main → IPC → renderer`, executed by the
  app in its own UI thread. No file round-trip.
- **One door (invariant):** the server is just **another thin shell over
  `core.run`**, sharing the exact logic the CLI and desktop already call — a
  facade, never a second implementation. (Verified pattern: a reference impl's
  CLI command *is* a wrapper that calls the MCP tool — "no separate code paths,
  no duplicate data fetching." §8-A/B.)

## 4. The "door" — connection form

The transport is **not** the essence; it's just how commands arrive. Choices:

- **MCP — primary.** O(1) across the fragmenting agent ecosystem (implement
  once, every MCP-capable agent plugs in), tools are self-describing (no hint to
  read), **stdio = fully local, no network**.
- **CLI — fallback.** Reaches humans, scripts, CI, and any agent that doesn't
  speak MCP. Same `core.run` underneath.
- **Files (`.bh/`) — demoted to internal storage**, *not* a contract for the
  agent. Stop teaching agents the on-disk JSON shape; the interface is the
  contract.
- **Protocol delivery:** capabilities via MCP self-description; *usage/judgment*
  via a **skill** (versionable, updatable) — replacing the long, frozen,
  Claude-only `CLAUDE.md` hint that fails for other agents.
- **Security (if an HTTP form is used):** bind `127.0.0.1` + bearer token.

**OPEN (D-b):** stdio MCP vs. an in-app local-HTTP MCP. HTTP fits if we also
want to serve non-agent local clients (scripts/REST) from the same port; stdio
is lighter if agents are the only consumer.

## 5. The command vocabulary — *what* we expose (the real product decision)

Picking CLI/MCP is not the decision; **which desktop actions become callable
commands** is. Three classes, each with a fixed execution landing spot:

| Class | Examples | Lands in |
|---|---|---|
| read · data | `getBadge`, `getInbound`, `search`, `readContent` | core → files |
| **read · runtime** | `getCurrentSelection`, `getActiveView` | renderer (this is the `focus` core) |
| write · data | `setPrompt`, `addRef`, `rename` | core → files → watcher → reactive UI |
| **write · runtime** *(deferred)* | `highlightCards`, `focusView`, `openInPreview`, `scrollTo` | main → IPC → renderer |

**Direction = pull-first.** The agent reads when it needs to (including reading
the selection), because it runs *after* the user's message — so it sees the
latest runtime state without us building push. Add push only when the agent must
*react* to a selection change on its own.

## 6. Scope & phases — the boundary

- **Phase 0 — minimal validation. ✅ IMPLEMENTED + VERIFIED** (branch
  `feat/focus-selection-side-effect`). Make `focus` a side effect of canvas
  selection, reusing the existing file channel (`focus.md` + watcher) — no MCP,
  no server. **Precise semantics** (chosen after reading the code, which had
  selection and focus *deliberately* decoupled): a canvas **multi-selection (≥2
  file badges — shift-click / marquee)** mirrors into `focus.md` (debounced); a
  **single** selection stays UI-only ("operate on this one": drag/connect/
  inspect); the existing explicit actions (Add to Context / folder / Clear) still
  own single-file + override flows. *Why ≥2:* "these / those two" is inherently
  plural — a multi-select is the intentional "treat these as a group" gesture,
  and gating on it stops a single click (made to drag a card) from silently
  changing agent context. *Verified:* tsc + biome + 444 unit tests green; a
  real-app e2e (shift-click two badges → `focus.md` mirrors both; single click
  does not); and a real `claude -p` given only the pronoun **"these"** resolved
  it from `focus.md` to the two files AND read the human-authored ref-note's
  meaning — zero bridge-building.
- **Phase 1 — shell + data line.** Host the in-app MCP server; move the data
  layer (badge / ref / prompt / search) onto it as `core.run` facades. Low risk;
  this path is well-trodden (§8-A/B).
- **Phase 2 — runtime line · read.** Add live selection/active-view reads on the
  same server, retiring the `focus.md` snapshot's lag/single-value awkwardness.
- **Phase 3 — runtime line · write (optional ambition).** Let the agent drive
  the canvas (highlight/focus). Only reference is §8-C.

**Deliberately NOT yet:** UI-control writes (Phase 3), push notifications,
remote/networked transports, multi-agent session identity.

## 7. Open decisions (need a human call)

- **D-a — agent role: read-only sidekick vs. hands-on participant.**
  *Recommendation:* start **read-only** (data + read-selection ≈ 80% of the
  value, lowest risk); defer "agent touches the canvas" (write·runtime) to
  Phase 3. Determines whether the runtime-*write* line gets built at all.
- **D-b — transport: stdio vs. in-app HTTP.** See §4.
- **D-c — selection as *data* vs. *runtime*.** Phase 0 models it as data
  (write a file, reactive read — cheap, validates the idea); Phase 2 decides
  whether to upgrade it to a live runtime read.
- **D-d — usage layer: a skill vs. MCP prompts** for conveying *how* to use the
  tools.

## 8. References (generic, per trademark policy)

- **A — single-core, multi-facade KB.** A local-first Markdown knowledge base:
  files are truth, a derived index is kept in sync by a **file watcher +
  checksum-diff reconcile**, exposed over **CLI + MCP + HTTP**, all thin facades
  over one service core. *Architecture twin — copy the data-line skeleton and
  the watcher/reconcile pattern.*
- **B — in-app local endpoint.** A desktop-app plugin (same TS/Electron-class
  stack) that **hosts a local REST + MCP endpoint inside the running app**, one
  core behind two facades, `127.0.0.1` + bearer token. *Copy the "shell"
  implementation.*
- **C — runtime-state control.** A creation tool whose agent bridge drives the
  app's **in-memory running state** (not files) via an in-process socket plus an
  external MCP server, executing commands on the app's own UI thread. *The only
  reference that controls UI/runtime state — the template for the runtime-write
  line, if D-a says yes.*
- **D — block KB bridges.** Block-based local-first tools reached via the app's
  **local kernel HTTP API + a stdio MCP server**, plus a **companion skill** for
  usage. *Reference for the protocol-delivery split (capabilities = MCP, usage =
  skill).*

---

*Next: settle §7 (esp. D-a), then execute Phase 0 as the cheapest end-to-end
test before building the shell.*
