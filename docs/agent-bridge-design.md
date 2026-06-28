# Agent Bridge — Design (DRAFT)

> Status: **draft for review.** Captures the target architecture for how an
> external AI agent (Claude Code / Codex / any) exchanges information with —
> and controls — the BaseHalf desktop app. Decisions marked **OPEN** still
> need a human call. Once settled, the load-bearing ones graduate into
> `docs/decisions.md` (next free id is D21).
>
> **2026-06 note.** The published file shapes named below (`.bh/focus.md` +
> `.bh/badges/<file>.json` + `.bh/index/inbound.json`) were replaced by the
> `.bh/mirror/` YAML tree + `.bh/current_focus.yaml` symlink (see
> [decisions.md D19](decisions.md)); the data-line / runtime-line architecture
> this doc describes is unchanged — read the file names as their current mirror
> equivalents. The `bh` CLI "floor" was also retired, and the old core-only
> command bus is no longer the target architecture; future non-file doors should
> expose the same workbench services/providers that the desktop uses.
>
> Third-party products are referenced generically (per the trademark policy);
> see §8.

## 1. Why — the need this serves

BaseHalf's value over a plain folder is the **graph a person curates by hand**
(file↔file relations, badge descriptions) plus **where their attention is right
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

## 2. Architecture judgment — persistent plane vs runtime plane

(Earlier drafts said "dual-center" / "two truth centers" — that wording collides
with our single-source-of-truth rule, so it is retired. The split is NOT about
*who is the source*; it is about *where data lives and how it flows*. Those are
two orthogonal axes.)

A plain file-based knowledge tool is **single-plane**: files are the only state
the agent reaches, the UI is a read-only projection, and the whole information
flow is one line (`agent ↔ in-app server ↔ storage/service layer ↔ files`). UI
state never enters the flow — which is why such tools can "only do the data
layer."

BaseHalf has **two planes**. The split is "has a file version?" — on disk vs only
in renderer memory — **NOT** "user's files vs our metadata":

| Plane | Where it lives | Examples |
|---|---|---|
| **Persistent** (has a file version) | disk (`.md` + all of `.bh/`) | file content, badge descriptions/refs/`referenced_by`, canvas positions, focus YAML, ADHD YAML, search |
| **Runtime** (no file version) | renderer memory | current selection, active view & zoom, highlight, which file is in preview, the live (in-editor) document |

Both your `.md` **and** our `.bh/` sit in the persistent plane — they flow to the
agent the same way (file → domain service/provider → reactive UI), so they are
ONE plane, not two.
The runtime plane is state **with no file version**: its source of truth is "the
UI right now." A single-plane tool has no equivalent — this second plane is the
canvas product's differentiator.

**Orthogonal axis — source of truth (unchanged).** Within the persistent plane,
`.md` is the **content truth**; `.bh/mirror/` is the workspace mirror for the
user's annotations and attention (badge descriptions/refs/`referenced_by`,
canvas positions, focus viewport, reading aids), which is why it stays in git;
only `.bh/cache/` is ignored. So "two planes" and "single source of truth" never
conflict: planes = how data flows; source-of-truth = who is the source within
the persistent plane.

## 3. Topology — one shell, two lines

```
                         ┌──────── data line (≈ single-center tools) ────────┐
                         │                                                    │
  agent  ──[ in-app server ]── domain services/providers ──> .md / .bh/ ──> watcher ──> UI
   (door: files = floor; MCP additive)                         │
                  └──────── runtime line (no precedent except §8-C) ─────────┐
                                                                             │
                          main process ── IPC ──> renderer (executes UI op)  ┘
```

- **One app-hosted shell:** a local server hosted **inside the Electron app**;
  the agent sees one connection surface, while the implementation fans into the
  same services/providers the workbench uses. This is a transport topology, not
  a requirement that everything enter one core command bus. Transport: see §4.
- **Data line:** data commands resolve through the same domain services and
  provider adapters the workbench uses, then land in files / `.bh/`; the file
  watcher then updates the UI reactively. Covers badge / ref / description /
  search / content. The current desktop path owns these service/provider
  implementations directly instead of routing through the retired core command
  bus.
- **Runtime line:** UI commands cross `main → IPC → renderer`, executed by the
  app in its own UI thread. No file round-trip.
- **Service boundary:** the server should expose the same domain services the
  Electron app uses. New code should extend those workbench-style services and
  providers, not preserve a single core command bus.

## 4. The "door" — connection form

The transport is **not** the essence; it's just how commands arrive. Choices:

- **Files (`.bh/`) — the universal floor (active: D14; CLI leg retired, D19).**
  Every agent that can read files reaches the published `.bh/mirror/` tree
  (`.bh/current_focus.yaml` + per-node `badge.yaml` / `canvas.yaml` /
  `focus.yaml` / `adhd.yaml`) with zero config. This is the contract today and
  stays the contract — the published file shapes ARE the agent interface (D14:
  publish, not inject), not internal storage. (The original draft also listed a
  `bh` CLI as a shell-reachable door; that package was deleted in the `2026-06`
  refactor. The desktop briefly used legacy core as its main data backend during
  that phase; future non-file doors should sit on the same service/provider
  boundaries as the workbench.)
- **MCP — an ADDITIVE premium door, layered on later.** O(1) across the
  fragmenting agent ecosystem (implement once, every MCP-capable agent plugs in),
  tools are self-describing (no hint to read), **stdio = fully local, no
  network**. Its real, non-marginal justification is the *runtime plane* (§2):
  live selection / active-view that a file snapshot can't deliver. It layers on
  top of the floor — it does NOT demote the file protocol to a fallback.
- **Protocol delivery:** capabilities via MCP self-description; *usage/judgment*
  via a **skill** or generated harness (versionable, updatable) — keeping
  root hints short across `AGENTS.md` / `CLAUDE.md`.
- **Security (if an HTTP form is used):** bind `127.0.0.1` + bearer token.

**OPEN (D-b):** stdio MCP vs. an in-app local-HTTP MCP. HTTP fits if we also
want to serve non-agent local clients (scripts/REST) from the same port; stdio
is lighter if agents are the only consumer.

## 5. The command vocabulary — *what* we expose (the real product decision)

Picking CLI/MCP is not the decision; **which desktop actions become callable
commands** is. Three classes, each with a fixed execution landing spot:

| Class | Examples | Lands in |
|---|---|---|
| read · data | `getBadge`, `getReferencedBy`, `search`, `readContent` | domain service/provider → files |
| **read · runtime** | `getCurrentSelection`, `getActiveView` | renderer/workbench |
| write · data | `setDescription`, `addRef`, `rename` | domain service/provider → files → watcher → reactive UI |
| **write · runtime** *(deferred)* | `highlightCards`, `focusView`, `openInPreview`, `scrollTo` | main → IPC → renderer |

**Direction = pull-first.** The agent reads when it needs to (including reading
the selection), because it runs *after* the user's message — so it sees the
latest runtime state without us building push. Add push only when the agent must
*react* to a selection change on its own.

## 6. Scope & phases — the boundary

- **Phase 0 — minimal validation. ✅ IMPLEMENTED + VERIFIED, then superseded by
  D19.** The pre-refactor validation branch (`feat/focus-selection-side-effect`)
  mirrored canvas multi-selection into `focus.md` to prove the shared-attention
  loop. D19 replaced that curated/snapshot channel with the current
  `.bh/current_focus.yaml` symlink + per-node `focus.yaml` viewport mirror, so
  the validation result survives but the file shape and implementation path do
  not.
- **Phase 1 — shell + data line.** Host the in-app MCP server; expose the data
  layer (badge / ref / description / search) through the same service/provider
  boundaries the desktop uses. Low risk; this path is well-trodden (§8-A/B).
- **Phase 2 — runtime line · read.** Add live selection/active-view reads on the
  same server, bypassing any file-snapshot lag when an agent needs renderer-only
  state.
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
- **D-c — selection as *data* vs. *runtime*.** Phase 0 proved the idea through a
  file mirror; Phase 2 decides which selection facets should become live runtime
  reads.
- **D-d — usage layer: a skill vs. MCP prompts** for conveying *how* to use the
  tools.

## 8. References (generic, per trademark policy)

- **A — local-first, multi-door KB.** A local-first Markdown knowledge base:
  files are truth, a derived index is kept in sync by a **file watcher +
  checksum-diff reconcile**, exposed over **CLI + MCP + HTTP**. *Reference for
  the data-line skeleton and watcher/reconcile pattern; do not copy a
  single-core boundary into current BaseHalf work.*
- **B — in-app local endpoint.** A desktop-app plugin (same TS/Electron-class
  stack) that **hosts a local REST + MCP endpoint inside the running app**, one
  app service layer behind multiple transports, `127.0.0.1` + bearer token.
  *Copy the "shell" implementation, not a Core-backed facade.*
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

*Next: settle §7 (esp. D-a) before building any MCP/runtime shell on top of the
current desktop services.*
