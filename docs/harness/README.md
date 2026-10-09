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
| Development workflow or source-tree initialization | [Spec-driven development](../specs/spec-driven-development.md) | The marker tests of legacy cleanup, migration, sidecar writes, and agent launch context |
| Current migration scope and module status | [Roadmap](../roadmap.md), [architecture invariants](architecture-invariants.md) | Public decisions D20–D23 in [decisions.md](../decisions.md) |
| Canvas, Card Detail, or navigation | [Roadmap](../roadmap.md), [architecture invariants](architecture-invariants.md) | Public decisions D20, D33, D34, and D35; [workspace state](../specs/workspace-state-and-legacy-cleanup.md) for canvas viewports; matching files in `private-docs/decisions/` |
| Canvas card resizing, corner and side resize targets, or the corner indicator | [Canvas card resize](../specs/canvas-card-resize.md) | [Architecture invariants](architecture-invariants.md); roadmap tracks 2 and 9 |
| References, upstream lists, badge editor, reference index, rename refactor, migration from badge pairs, or template references | [Reference graph](../specs/reference-graph.md), [architecture invariants](architecture-invariants.md) | Public decisions D24 and D37 |
| Markdown rich/source/preview editing | Roadmap track 5, [architecture invariants](architecture-invariants.md) | [Reference graph](../specs/reference-graph.md) for frontmatter recognition and rich-editor coherence; `private-docs/decisions/vscode-base-canvas-detail-markdown-projections.md`, `rich-editor-agent-native-hardening.md`, and `rich-editor-undo-single-owner.md` |
| Agent Area, terminal, or agent extensions | [Architecture invariants](architecture-invariants.md); [agent launch context](../specs/agent-launch-context.md) for what Agent Area sessions receive at launch; [Agent Area terminal](../specs/agent-area-terminal.md) for terminal identity, wheel input, and glyph-atlas maintenance | Public decisions D21, D36, and D39 and `private-docs/decisions/right-side-agent-area-hosts-tui-and-extension-agents.md`; the [agent bridge design](../agent-bridge-design.md) is history only |
| `.bh/` persistence, canvas viewport state, focus removal, or legacy cleanup of focus files, `.bh/agent-harness/`, and root agent-file sections | [Workspace state and legacy cleanup](../specs/workspace-state-and-legacy-cleanup.md) | Public decisions D12, D13, D19, D35, and D36; `private-docs/focus_mode_spec/` only as history |
| Plugin platform or plugin publishing | [Plugin architecture](../plugin-architecture.md), [plugin development](../plugin-development.md) | [Plugin docs](../plugins/), public decisions D25–D34; [reference graph](../specs/reference-graph.md#plugins) for the upstream rule on plugin transitions and for template references (D37) |
| AI Video or executable media nodes | `vscode-base/extensions/basehalf-ai-video/docs/product-contract.md` | [`video-node-development-spec.md`](../../vscode-base/extensions/basehalf-ai-video/docs/video-node-development-spec.md) routes the Composer-surface, model/settings, input/frame-role, and execution/recovery work packages; public decisions D28 and D34; [plugin architecture](../plugin-architecture.md) |
| Git, SCM, GitHub, or history graph | [Git/SCM/GitHub/GitGraph](../git-scm-github-gitgraph.md) | Roadmap track 3 and public decision D22 |
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
