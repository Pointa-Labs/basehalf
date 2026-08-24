# Spec-driven development and source-tree isolation

Status: Active

This specification defines how maintainers and coding agents develop BaseHalf.
It also separates the BaseHalf source tree from the user workspaces that the
product initializes with the `.bh/` YAML protocol.

## Goals

- Make an explicit specification the authority for substantive development.
- Keep product decisions, required behavior, implementation, and verification
  traceable without relying on conversation history.
- Give coding agents a small, stable entry point and load task-specific
  development guidance progressively instead of front-loading the whole product
  history into every session.
- Prevent BaseHalf from initializing its own source directories as product
  workspaces.
- Keep `.bh/` focus and mirror state from influencing work on BaseHalf itself.

## Non-goals

- This specification does not change the `.bh/` protocol for normal user
  workspaces.
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
  `docs/development/`. This directory is the BaseHalf development harness: its
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
marker is the authoritative opt-out from product workspace initialization.

When the marker is present, BaseHalf must not:

- create or update `.bh/`, `.bh/mirror/`, `.bh/current_focus.yaml`, or
  `.bh/agent-harness/`;
- append the BaseHalf workspace-hint block to `AGENTS.md` or `CLAUDE.md`;
- create a new root agent guide;
- modify `.gitignore` for `.bh/cache/`;
- publish focus, badge, canvas, appearance, or ADHD YAML for the source tree.

Coding agents working on BaseHalf must not read or follow `.bh/current_focus.yaml`
or any `.bh/` mirror data found in these source directories. Such data is
accidental generated contamination, not development context or product truth.
Agents should report it and remove it only when the user authorizes cleanup.

Development launches, smoke tests, and workspace-setup tests must use disposable
fixture workspaces. They must never exercise product initialization against the
repository root or `vscode-base/`.

## Development harness and progressive disclosure

The development context has four distinct layers:

1. Root `AGENTS.md` and `CLAUDE.md` are the always-loaded entry points.
2. `docs/development/` is the public project-development harness and routing
   layer.
3. `docs/specs/` defines current required behavior and acceptance criteria.
4. `docs/decisions.md` and `private-docs/decisions/` record why directions were
   chosen and preserve historical alternatives.

The root entry points must contain only guidance that every coding task needs:

- repository identity and the source-tree initialization prohibition;
- the spec-first sequence;
- a link to the development harness;
- a compact set of repository-wide architectural invariants;
- the maintainer delivery gate.

They must not contain the complete public or private decision index, migration
history, subsystem specifications, long definitions of done, or commands that
only one task family needs. Those belong in the lower layers and are loaded
through the development-harness index when relevant.

The development harness must provide task-oriented routing rather than copying
the full contents of specifications and decisions. At minimum it owns:

- a `README.md` that explains the layers and maps common task families to their
  authoritative documents;
- repository-wide architecture invariants that are too detailed for the root
  entry point but apply across multiple product specifications;
- verification and delivery guidance, including scoped checks, the BaseHalf
  Electron smoke, commit expectations, and the maintainer/external-contributor
  split.

The product-generated `.bh/agent-harness/` is a different system. It is
installed into normal user workspaces and explains the user-facing `.bh`
protocol. It must never be used as the development harness for BaseHalf's own
source tree.

## Agent-guide ownership

The root `AGENTS.md` and `CLAUDE.md` are human-maintained development entry
points. They must remain semantically equivalent, follow the same compact
structure, and carry the same specification workflow, universal invariants,
source-tree boundary, and development-harness route. Product workspace setup
must never inject generated workspace-protocol instructions into either file.

Subsystem details belong in their owning specification. The root guides should
contain durable routing and safety rules, not duplicate entire subsystem
contracts.

## Acceptance criteria

- Opening the repository root in BaseHalf does not change any file.
- Opening `vscode-base/` directly in BaseHalf does not change any file.
- Neither source directory gains `.bh/`, a generated `CLAUDE.md`, an injected
  workspace-hint block, or a `.gitignore` edit.
- Coding agents use this repository's specifications and decisions as context,
  never the product's YAML focus protocol.
- `AGENTS.md` and `CLAUDE.md` remain semantically identical and route substantive
  work through the spec-first sequence.
- The root guides do not enumerate the complete decision corpus or duplicate
  subsystem contracts.
- `docs/development/README.md` routes architecture, product-surface, plugin,
  protocol, and delivery work to the documents that own those topics.
- Development-only guidance lives in `docs/development/`; the generated
  `.bh/agent-harness/` remains exclusively a normal-user-workspace feature.
- Normal user workspaces without the opt-out marker retain the existing BaseHalf
  initialization behavior.

## Verification

- Confirm both opt-out marker files are tracked.
- Compare the two root agent guides after every edit.
- Exercise the existing workspace-setup marker test.
- Run a development-host smoke with the repository root and `vscode-base/`
  protected, then confirm `git status` remains unchanged.
