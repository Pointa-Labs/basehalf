# BaseHalf development index

`AGENTS.md` and `CLAUDE.md` are intentionally equivalent indexes for coding
agents developing BaseHalf itself. Keep them in sync. They are not the product
workspace hints that BaseHalf installs for users.

## Required entry

Before any development work, open the
[development harness](docs/harness/README.md) and follow its task route.
Substantive changes are spec-first: read and update the owning specification
before editing implementation source.

## Source-tree guard

The repository root and `vscode-base/` are implementation source trees, not
product workspaces. Keep their tracked `.basehalf-no-workspace-setup` markers.
Never initialize either directory, create or update `.bh/` there, or follow any
`.bh/` YAML found there as development context. Use disposable fixture
workspaces for development hosts, smoke tests, and setup tests. See the
[source-tree contract](docs/specs/spec-driven-development.md).

## Development document index

- Task routing and context layers: [development harness](docs/harness/README.md)
- Spec workflow and source isolation: [spec-driven development](docs/specs/spec-driven-development.md)
- Cross-cutting product boundaries: [architecture invariants](docs/harness/architecture-invariants.md)
- Tests, commits, direct-main, and release gates: [verification and delivery](docs/harness/verification-and-delivery.md)
- Current migration scope and module status: [roadmap](docs/roadmap.md)
- Decision rationale: [public decisions](docs/decisions.md) and
  `private-docs/decisions/README.md`

Update the owning document when a contract changes. Do not copy its full
contents back into this index.
