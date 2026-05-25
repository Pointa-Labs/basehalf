# Contributing

Thanks for your interest. This is an early, company-led open-source project
(Apache-2.0) by Pointa Labs, Inc. The near-term roadmap is driven by the core
team; see [docs/roadmap.md](docs/roadmap.md). By participating you agree to our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Run it

No build, no install needed (Node ≥ 18):

```bash
npm test        # run the spec
npm run demo    # narrated tour
node src/cli.mjs help
```

## Repo layout & the rules that must not break

All knowledge logic lives in `src/core/`. The CLI and MCP server are thin
adapters over it. When contributing, keep these invariants (they're the product):

1. **One write path.** Every change goes through a `core` command → an event.
   Nothing writes `.bh/` or a projection directly. (`src/cli.mjs`, `src/mcp.mjs`,
   and any future adapter all call `src/core`.)
2. **The ledger is the truth.** `events.mjs` is append-only. Never mutate or
   delete a past event; to undo, append a revert marker.
3. **Projections are disposable.** Anything derived (current state, search
   index, …) must be rebuildable from the event log.
4. **Attribute every change.** Each event carries an `actor`.
5. **Ground facts.** Writes can carry a source; retrieval returns sources.
6. **Primitives, not tasks.** Add small composable actions (`move`), not
   task-specific ones (`arrange-into-heart`). The agent composes them.

See [docs/architecture.md](docs/architecture.md) and [docs/agent-interface.md](docs/agent-interface.md).

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
  in an issue first. The reference impl is intentionally zero-dependency.
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
- The reference impl is plain ESM JavaScript on purpose (instant to run). The
  production codebase targets TypeScript + SQLite; ports should preserve the
  six invariants above.
