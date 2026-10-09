# Spec-driven development and source-tree isolation

Status: Active (source-tree guard revised 2026-09-27 for D35–D37)

This specification defines how maintainers and coding agents develop BaseHalf.
It also separates the BaseHalf source tree from the user workspaces in which
the product keeps `.bh/` project metadata and runs its legacy cleanup.

## Goals

- Make an explicit specification the authority for substantive development.
- Keep product decisions, required behavior, implementation, and verification
  traceable without relying on conversation history.
- Give coding agents a small, stable entry point and load task-specific
  development guidance progressively instead of front-loading the whole product
  history into every session.
- Prevent BaseHalf from initializing its own source directories as product
  workspaces.
- Keep `.bh/` data, including legacy focus files, from influencing work on
  BaseHalf itself.

## Non-goals

- This specification does not define product behavior in normal user
  workspaces. [Workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md),
  [reference graph](reference-graph.md), and
  [agent launch context](agent-launch-context.md) own it.
- It does not replace decision documents. Decisions record why a direction was
  chosen; specifications define the behavior that the current implementation
  must satisfy.
- It does not require a new specification for typo-only documentation fixes or
  mechanical refactors whose behavior and acceptance criteria are already
  completely covered by an active specification.

## Required development sequence

For every substantive product, architecture, protocol, schema, persistence,
security, UI-state, or cross-module change, use this sequence:

1. Read the active specifications and decisions that own the affected behavior.
2. Create or update a Markdown specification before editing implementation
   source files.
3. Define scope, non-goals, user-visible states, invariants, failure and recovery
   behavior, compatibility boundaries, and observable acceptance criteria.
4. Review the specification adversarially for ambiguous ownership, missing
   states, silent data mutation, incomplete lifecycle behavior, and unverifiable
   requirements.
5. Derive the implementation plan from the accepted specification.
6. Implement only the behavior inside the specified boundary.
7. Verify each acceptance criterion with tests or an explicit manual check.
8. Update the specification when implementation discoveries change the required
   behavior. Do not let code silently become the only record of the new contract.
9. Commit the specification with, or before, the implementation it governs.

The canonical flow is:

`Spec -> Review -> Plan -> Implementation -> Verification -> Commit`

A chat summary, task plan, or code diff is not a substitute for the
specification.

## Specification location and format

- Public product and engineering specifications live under `docs/specs/`.
- Project-development guidance that applies across specifications lives under
  `docs/harness/`. This directory is the BaseHalf development harness: its
  index routes a task to the relevant specifications, decisions, architecture
  constraints, verification commands, and delivery rules.
- Internal specifications may live under an appropriate directory in
  `private-docs/`, but the root coding-agent guides must point to the active
  document when an internal specification is load-bearing.
- A specification is ordinary Markdown. It does not use `.bh/` mirror YAML or
  require YAML frontmatter.
- Prefer one owned topic per document. Link related specifications and decision
  documents instead of copying their contents.

Every substantive specification should contain, as applicable:

- status and ownership;
- problem and goals;
- scope and non-goals;
- terminology and source of truth;
- required behavior and complete UI or lifecycle states;
- persistence, security, and compatibility boundaries;
- failure, cancellation, retry, and recovery behavior;
- acceptance criteria and verification;
- unresolved questions that block implementation.

## BaseHalf source-tree boundary

The following directories are BaseHalf implementation source trees, not user
workspaces:

- the repository root;
- `vscode-base/`, including when it is opened directly as the development-host
  workspace.

Both directories must track `.basehalf-no-workspace-setup`. Presence of this
marker in a workspace folder root is the authoritative opt-out from the product
workspace writes listed below. Markers in subdirectories have no effect, and a
folder whose marker existence cannot be determined is treated as marked.

These services honor the marker:

- **Legacy cleanup** writes nothing in a marked folder and returns
  `skipped: 'marker'`. It deletes no earlier `.bh/` artifact and offers no
  root agent-file removal there
  ([workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md#legacy-cleanup)).
- **Migration** of legacy badge pairs does not run
  ([reference graph](reference-graph.md#source-tree-guard)).
- **Sidecar writes**: BaseHalf writes no `upstream.yaml` and refuses
  connections whose target needs a sidecar store. An explicitly requested
  Markdown or `.bhnode` upstream edit is an ordinary user edit; it writes only
  that store, with no `canvas.yaml` anchor row, no `adhd.yaml`, and nothing
  else under `.bh/`. The rename refactor always prompts.
- **Legacy record**: BaseHalf writes no `.bh/legacy-references.yaml`.
- **Agent launch context**: Agent Area sessions whose workspace has any marked
  folder receive no BaseHalf launch instruction
  ([agent launch context](agent-launch-context.md#scope)).

BaseHalf writes no `.bh/current_focus.yaml`, `focus.yaml`,
`.bh/agent-harness/`, a BaseHalf section in `AGENTS.md` or `CLAUDE.md`, a new
root agent guide, or a `.gitignore` edit in any workspace (D35, D36). Canvas
viewports live in VS Code workspace storage, outside the tree.

**Known gap.** The passive canvas layout (`canvas.yaml`), appearance, and ADHD
writers do not consult the marker; the reference graph lists this as a
non-goal. Moving cards, changing a card's appearance, or marking reading aids
in a source directory opened as a workspace can still write `.bh/mirror/`
there. The disposable-fixture rule below is what keeps the source trees clean.

Coding agents working on BaseHalf must not read or follow any `.bh/` data found
in these source directories, including legacy `current_focus.yaml` or
`focus.yaml` files. Such data is accidental generated contamination, not
development context or product truth. Agents should report it and remove it
only when the user authorizes cleanup.

Development launches, smoke tests, and legacy cleanup or migration tests must
use disposable fixture workspaces. They must never exercise product workspace
behavior against the repository root or `vscode-base/`. A fixture workspace
lives outside the repository, as a user's own workspace does. It never lives
inside the repository, not even in an ignored directory such as
`vscode-base/.build/`.

## Development harness and progressive disclosure

The development context has four distinct layers:

1. Root `AGENTS.md` and `CLAUDE.md` are the always-loaded entry points.
2. `docs/harness/` is the public project-development harness and routing
   layer.
3. `docs/specs/` defines current required behavior and acceptance criteria.
4. `docs/decisions.md` and `private-docs/decisions/` record why directions were
   chosen and preserve historical alternatives.

The root entry points are indexes, not copies of the development rules. They
must contain only what an agent needs to reach the authoritative context:

- repository identity and guide-equivalence notice;
- the non-deferrable source-tree initialization prohibition;
- a mandatory route through the development-harness index;
- direct links to the spec workflow, architecture invariants, verification and
  delivery rules, roadmap, and decision corpora.

They must not contain the complete public or private decision index, migration
history, subsystem specifications, product architecture summaries, delivery
rules, long definitions of done, or task-specific commands. Those belong in the
lower layers and are loaded through the development-harness index when relevant.

The development harness must provide task-oriented routing rather than copying
the full contents of specifications and decisions. At minimum it owns:

- a `README.md` that explains the layers and maps common task families to their
  authoritative documents;
- repository-wide architecture invariants that are too detailed for the root
  entry point but apply across multiple product specifications;
- verification and delivery guidance, including scoped checks, the BaseHalf
  Electron smoke, commit expectations, and the maintainer/external-contributor
  split;
- development-host guidance covering the watch-based hot-reload loop and the
  disposable fixture workspace a development launch must open.

The `.bh/agent-harness/` that earlier releases installed into user
workspaces is a different, retired system (D36). The product no longer
installs it, and legacy cleanup removes the files it wrote. It must never be
used as the development harness for BaseHalf's own source tree.

## Agent-guide ownership

The root `AGENTS.md` and `CLAUDE.md` are human-maintained development entry
points. They must remain semantically equivalent, follow the same compact
index structure, and carry the same source-tree warning and development-harness
routes. BaseHalf no longer writes instructions into any workspace's
`AGENTS.md` or `CLAUDE.md` (D36), and the marker keeps legacy cleanup from
offering to edit these two files.

Development rules belong in the harness, and subsystem details belong in their
owning specification. The root guides contain durable routing and the minimum
source-tree safety warning, not duplicated rule bodies.

## Acceptance criteria

- Opening the repository root in BaseHalf does not change any file.
- Opening `vscode-base/` directly in BaseHalf does not change any file.
- Opening either source directory adds no `.bh/`, generated `CLAUDE.md`,
  injected workspace-hint block, or `.gitignore` edit. The passive layout,
  appearance, and ADHD writers remain the known gap described above.
- Coding agents use this repository's specifications and decisions as context,
  never `.bh/` data or legacy focus files.
- `AGENTS.md` and `CLAUDE.md` remain semantically identical indexes and route
  substantive work through the harness to the spec-first sequence.
- The root guides do not enumerate the complete decision corpus or duplicate
  architecture, delivery, or subsystem contracts.
- `docs/harness/README.md` routes architecture, product-surface, plugin,
  protocol, and delivery work to the documents that own those topics.
- Development-only guidance lives in `docs/harness/`; BaseHalf no longer
  generates `.bh/agent-harness/` in any workspace.
- The harness documents a development-host launch that opens a disposable
  fixture workspace outside the repository, and that procedure never opens the
  repository root or `vscode-base/` as a product workspace.
- Normal user workspaces without the opt-out marker follow
  [workspace state and legacy cleanup](workspace-state-and-legacy-cleanup.md)
  and [reference graph](reference-graph.md).
- In a marked folder, legacy cleanup returns `skipped: 'marker'` and changes
  nothing, migration does not run, no sidecar or legacy-record file is written,
  and Agent Area sessions receive no launch context.

## Verification

- Confirm both opt-out marker files are tracked.
- Compare the two root agent guides after every edit.
- Exercise the marker tests of legacy cleanup, migration and sidecar writes,
  and the agent launch configuration.
- Run a development-host smoke with the repository root and `vscode-base/`
  protected, then confirm `git status` remains unchanged.
