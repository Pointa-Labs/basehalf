# BaseHalf development harness

`docs/harness/` is the progressive-disclosure entry point for developing
BaseHalf itself. Start here after reading the short root `AGENTS.md` or
`CLAUDE.md`, then load only the documents that own the task at hand.

This is not the product-generated `.bh/agent-harness/`. That harness is written
only into normal user workspaces and explains the user-facing `.bh` protocol.
BaseHalf's source tree is protected from that initialization.

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
| Development workflow or source-tree initialization | [Spec-driven development](../specs/spec-driven-development.md) | Workspace setup implementation and its marker tests |
| Current migration scope and module status | [Roadmap](../roadmap.md), [architecture invariants](architecture-invariants.md) | Public decisions D20–D23 in [decisions.md](../decisions.md) |
| Canvas, Card Detail, navigation, or references | [Roadmap](../roadmap.md), [architecture invariants](architecture-invariants.md) | Public decisions D20, D24, D33, D34; matching files in `private-docs/decisions/` |
| Markdown rich/source/preview editing | Roadmap track 5, [architecture invariants](architecture-invariants.md) | `private-docs/decisions/vscode-base-canvas-detail-markdown-projections.md`, `rich-editor-agent-native-hardening.md`, and `rich-editor-undo-single-owner.md` |
| Agent Area, terminal, or agent extensions | [Agent bridge design](../agent-bridge-design.md), [architecture invariants](architecture-invariants.md) | Public decision D21 and `private-docs/decisions/right-side-agent-area-hosts-tui-and-extension-agents.md` |
| `.bh/mirror/`, focus, cursor, badge, or workspace protocol | `private-docs/focus_mode_spec/` | Public decisions D12–D14 and D19; relevant private decision records |
| Plugin platform or plugin publishing | [Plugin architecture](../plugin-architecture.md), [plugin development](../plugin-development.md) | [Plugin docs](../plugins/), public decisions D25–D34 |
| AI Video or executable media nodes | `vscode-base/extensions/basehalf-ai-video/docs/product-contract.md` | [`video-node-development-spec.md`](../../vscode-base/extensions/basehalf-ai-video/docs/video-node-development-spec.md) routes the Composer-surface, model/settings, input/frame-role, and execution/recovery work packages; public decisions D28 and D34; [plugin architecture](../plugin-architecture.md) |
| Git, SCM, GitHub, or history graph | [Git/SCM/GitHub/GitGraph](../git-scm-github-gitgraph.md) | Roadmap track 3 and public decision D22 |
| Dependencies, licenses, or distribution | [Dependency policy](../dependency-policy.md) | [Trademark policy](../trademark-policy.md), public decisions D8–D11 |
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
