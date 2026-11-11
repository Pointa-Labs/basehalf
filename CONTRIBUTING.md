# Contributing

Thanks for your interest. This is an early, company-led open-source project
(Apache-2.0) by Pointa Labs, Inc. The near-term roadmap is driven by the core
team; see [docs/roadmap.md](docs/roadmap.md). By participating you agree to our
[Code of Conduct](CODE_OF_CONDUCT.md).

> **Status note.** BaseHalf is early and changes quickly. The product is the
> desktop app in `vscode-base/`, built on the open-source code of VS Code.
> Contribution surfaces are narrow today, so **open an issue first** to find
> one that is ready for outside work.

## Build it

The product is built in `vscode-base/`, on macOS, with the Node version in
`vscode-base/.nvmrc`:

```bash
cd vscode-base
nvm use
npm install
npm run compile
./scripts/code.sh        # run BaseHalf from source
```

Checks to run before you open a pull request:

```bash
npm run typecheck-client
./scripts/test.sh
npm run basehalf:smoke   # the product smoke, for changes to what the window shows
```

`packages/` holds the earlier BaseHalf core and desktop app. New product work
does not go there, but CI still builds and tests it (Node 22.12 or later,
pnpm 9):

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm -r --if-present lint
```

## Plugins

BaseHalf has no plugin platform (D76): no extension contributes to it, and
nothing can be published for it. What the container shows and does with
files is built into BaseHalf itself; what agents can do is extended through
the agents' own skills and tool connections.

## How a change is made

1. **Start at the [development harness](docs/harness/README.md).** It routes
   each kind of change to the documents that own it.
2. **Specification first.** What BaseHalf has to do is written in
   [docs/specs/](docs/specs/). A change of behavior updates the owning
   specification before the code; the workflow is in
   [spec-driven development](docs/specs/spec-driven-development.md).
3. **Keep the [architecture invariants](docs/harness/architecture-invariants.md)**,
   and put new files where
   [code organization](docs/harness/code-organization.md) says. The reasons
   are in [docs/decisions.md](docs/decisions.md).
4. **Never open this repository as a BaseHalf workspace.** The repository root
   and `vscode-base/` are source trees. Try your build on a disposable folder
   outside the repository.
5. **Verify.** The checks each kind of change needs are in
   [verification and delivery](docs/harness/verification-and-delivery.md).

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
- In `vscode-base/`, the style is that of VS Code, and its ESLint
  configuration checks it (`npm run eslint`).
- In `packages/`, TypeScript uses NodeNext module resolution: relative imports
  use `.js` extensions even when the source is `.ts`. Biome enforces this; run
  `pnpm format` (writes) or `pnpm check` (verifies).
