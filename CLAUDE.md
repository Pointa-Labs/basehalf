# BaseHalf development entry point

`AGENTS.md` and `CLAUDE.md` are intentionally equivalent entry points for
coding agents developing BaseHalf itself. Keep them in sync.

## Start here

BaseHalf uses specification-driven development. For every substantive product,
architecture, protocol, schema, persistence, security, UI-state, or cross-module
change:

1. Open the [development harness](docs/harness/README.md) and read the
   documents routed for the task.
2. Create or update the owning Markdown specification before implementation.
3. Review the specification, derive the plan, implement within its boundary,
   verify its acceptance criteria, and commit the specification with or before
   the implementation.

Canonical flow:

`Spec -> Review -> Plan -> Implementation -> Verification -> Commit`

Decisions record why; specifications define current required behavior. A chat
summary, task plan, code diff, or historical implementation is not a spec. The
full workflow is [spec-driven-development.md](docs/specs/spec-driven-development.md).

## Never initialize this source tree

The repository root and `vscode-base/` are BaseHalf implementation source trees,
not product workspaces. Their tracked `.basehalf-no-workspace-setup` markers
must remain in place.

- Never create or update `.bh/`, `.bh/mirror/`, `.bh/current_focus.yaml`, or
  `.bh/agent-harness/` here.
- Never append product workspace hints, generate agent guides, or add
  `.bh/cache/` ignores here.
- Never read or follow `.bh/` YAML found here as development context; treat it
  as accidental contamination.
- Use disposable fixture workspaces for development hosts, smoke tests, and
  workspace-setup tests.

The public development harness is `docs/harness/`; the generated
`.bh/agent-harness/` belongs only to normal user workspaces.

## Universal product boundaries

- Develop the desktop product in `vscode-base/`: VS Code is the infrastructure
  substrate, while BaseHalf remains canvas-first. Old `packages/` and
  `@basehalf/core` are migration reference, not the center for new desktop work.
- Folders open canvases and files open full-screen Card Detail. The left product
  surface is Files/Git/Search/Plugins; the right surface is Agent Area. Do not
  restore stock editor tabs, Extensions, Chat/Copilot/Sessions, or terminal
  panel UI as primary product surfaces.
- Markdown files are content truth; rich/source/preview share one working copy.
  Explicit directed references carry context; Markdown links only navigate.
- The shell is fixed and curated plugins extend the main canvas. Plugin output
  remains local user-owned files. Executable media uses immutable Attempts and
  one sealed local-file Result per run.
- Automated services never modify user files unprompted.
- Land coherent, module-complete behavior with applicable states, error paths,
  interactions, tests, and explicit verification—never placeholder dead ends.

Load the detailed constraints only when relevant from
[architecture-invariants.md](docs/harness/architecture-invariants.md).

## Delivery

Follow [verification-and-delivery.md](docs/harness/verification-and-delivery.md).
Maintainers work directly on `main` and do not open PRs; external contributors
use branch → PR → CLA/checks → merge. Before a maintainer push, lint, typecheck,
and the full test suite must be green, and substantive changes require
an in-session adversarial review. Commit locally in coherent scopes; push only
when requested.
