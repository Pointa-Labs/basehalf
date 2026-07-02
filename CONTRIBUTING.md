# Contributing

Thanks for your interest. This is an early, company-led open-source project
(Apache-2.0) by Pointa Labs, Inc. The near-term roadmap is driven by the core
team; see [docs/roadmap.md](docs/roadmap.md). By participating you agree to our
[Code of Conduct](CODE_OF_CONDUCT.md).

> **Status note.** Pre-alpha. `@basehalf/core` ships the `workspace`, `badges`,
> `canvas`, `focus`, `adhd`, and `search` modules (plus an internal `watcher`);
> the Electron desktop app (v0) drives them over IPC. There is no standalone CLI
> — a `2026-06` refactor deleted the `bh` CLI package, the `inbound` module, and
> the `proposals` module, and moved `.bh/` to a per-node YAML mirror tree (see
> [docs/decisions.md D19](docs/decisions.md)). Contribution surfaces are narrow
> today — **open an issue first** to find one that's ready for outside work. See
> [docs/roadmap.md](docs/roadmap.md) for the current plan. (A `bh decision`
> subcommand also shipped briefly as an internal dogfood tool and has since been
> retired; see [docs/decisions.md D18](docs/decisions.md).)

## Build it (Node ≥ 20.19, pnpm 9)

```bash
pnpm install
pnpm -r build         # @basehalf/core, then @basehalf/desktop
pnpm -r test          # vitest — core + desktop tests
pnpm -r --if-present lint

pnpm --filter @basehalf/desktop dev   # run the desktop app; Open Folder to start
```

Everything goes through `@basehalf/core`'s `run(command, args)` — the one door.
There is no CLI binary; the desktop app (and your tests) call core directly.

## Repo layout & the rules that must not break

```text
packages/
  core/    kernel (registry + context + mirror store) + modules (one per feature)
  desktop/ — Electron app; React + BlockNote + React Flow on
           the renderer, Node main process owns fs + chokidar
```

When contributing, keep these invariants (see [docs/decisions.md](docs/decisions.md) for the *why*):

1. **One door.** All operations go through `@basehalf/core`'s `run(command, args)`.
   Desktop / watcher / any future MCP or CLI shell are thin shells — never put
   business logic in them.
2. **Module isolation.** A module lives under `packages/core/src/modules/<name>/`,
   registers commands via the kernel registry, and touches core only through
   the `Context` it receives. **Modules calling other modules use `ctx.run`,
   never imports of another module's internals.**
3. **Dependencies point only inward.** `packages/desktop` may depend on
   `@basehalf/core`; the reverse is forbidden. Modules don't depend on each
   other directly — they coordinate through commands.
4. **User files = content truth.** Modules that touch user files must be
   **observers** (file watcher + reconcile-on-launch), never owners. The
   `.bh/` mirror is derived local runtime state and is gitignored in full.
5. **core never writes user files unprompted.** Only explicit user edits
   through the BaseHalf UI (block editor, rename) write back to disk. Agents
   edit user files with their own tools — core stays out of that path.
6. **Primitives, not tasks.** Add small composable commands (e.g. `badge.addRef`,
   `focus.set`), not task-specific ones (e.g. `arrange-into-heart`). The
   agent composes them.
7. **Publish, don't inject.** Agent-facing surfaces write files to known paths
   in the `.bh/mirror/` tree (`current_focus.yaml` symlink + per-node
   `badge.yaml` / `canvas.yaml` / `focus.yaml` / `adhd.yaml`); no system-prompt
   injection, no MCP server required.
8. **Any RMW on a `.bh/` YAML needs a mutex.** Serialize read-modify-writes on a
   mirror file through `createKeyedMutex` (kernel) or concurrent writers (the
   watcher + an in-app edit) silently lose updates.
9. **No fork of the deleted event-log impl.** It was overturned by the
   architecture pivot ([D12](docs/decisions.md)); it lives in git history at
   `c441f79` if you need to reference it.

## Contributor License Agreement (required)

To keep the project's licensing options open (e.g. the ability to offer
commercial editions or adjust the license later if the landscape demands it),
**all code contributions require a signed [CLA](CLA.md)** granting Pointa Labs,
Inc. a broad license, **including the right to relicense**. You keep the
copyright to your work — you're only granting a license to it.

- **How you sign:** just open a pull request. The **CLA Assistant** bot comments
  with a link to [CLA.md](CLA.md); reply with the sentence it asks for. You sign
  once; future PRs are covered. **A PR can't be merged until the CLA check is
  green.** (You can still *open* the PR before signing — the gate is on merge.)
- **CLA, not DCO.** A DCO only certifies you may submit the code; it does **not**
  grant the relicensing rights the project relies on to keep its license choice
  reversible.
- **Contributing for an employer?** Your company should sign a Corporate CLA —
  see the note in [CLA.md](CLA.md).
- If you can't or don't want to sign, we still welcome **issues, ideas, and bug
  reports** — those need no CLA.

## Dependencies & licensing

Keeping the project relicensable and safe to commercialize means being careful
about what code and dependencies enter it. **Full policy:
[docs/dependency-policy.md](docs/dependency-policy.md).** In short:

- **Don't add dependencies casually.** A new runtime dependency needs discussion
  in an issue first. Build/dev tooling has more latitude but still gets reviewed.
- **Allowed licenses:** MIT, BSD-2/3-Clause, Apache-2.0, ISC.
  **Review needed:** MPL-2.0, LGPL (weak copyleft — depends on usage).
  **Not accepted:** GPL / AGPL / SSPL, BSL, or any "source-available" /
  non-commercial license (e.g. one that needs a commercial license to use, like
  the canvas library **tldraw**). These break our ability to relicense and
  conflict with our IP policy (CIIAA §2.9).
- A CI check (`license-check`) enforces the allowlist on every PR.

## Originality of contributions

- Your contribution must be **your own original work** (or properly licensed and
  disclosed per the [CLA](CLA.md)). Don't paste in code from other repos, Q&A
  sites, or a former employer's codebase unless it's compatibly licensed and you
  say so in the PR.
- **AI-assisted code is welcome** — this project is built to be agent-operated.
  But you're responsible for making sure it's original and non-infringing; treat
  AI output like your own code under the CLA.

## Trademark

The **code** is open (Apache-2.0), but the **name and logo** are not: "BaseHalf"
is a trademark of Pointa Labs, Inc. Fork freely — but builds you distribute must
carry their own name. See [docs/trademark-policy.md](docs/trademark-policy.md).

## Style

- Small, readable, dependency-light. Match the surrounding code.
- TypeScript with NodeNext module resolution — relative imports use `.js`
  extensions even when source is `.ts` (Node ESM requirement). Biome enforces this.
- Run `pnpm format` (writes) or `pnpm check` (verify) before opening a PR.
