# Git, SCM, GitHub, And GitGraph Boundary

BaseHalf's Git surface uses VS Code's Git, GitHub, and SCM implementations as
the product-quality substrate. BaseHalf should not add a parallel Git popover,
custom source-control model, or standalone GitGraph implementation unless a
later product decision explicitly replaces this boundary.

## Ownership

- `vscode-base/extensions/git/` owns repository discovery, status, branch
  queries, commit input, publish, sync, fetch, pull, push, Git credentials,
  Source Control resource groups, and the Git API exposed to other extensions.
- `vscode-base/extensions/github-authentication/` owns the VS Code
  authentication provider flow. Development builds may inject a BaseHalf-owned
  GitHub OAuth app through `BASEHALF_GITHUB_CLIENT_ID` and
  `BASEHALF_GITHUB_CLIENT_SECRET`; without a configured client secret, the
  expected local behavior is the VS Code OSS no-secret fallback.
- `vscode-base/extensions/github/` owns GitHub-specific Git integration:
  credential provider, push-error handler, remote source publisher, branch
  protection provider, canonical URI provider, and Source Control history item
  details for GitHub remotes.
- `vscode-base/src/vs/workbench/contrib/scm/` owns the visible Source Control
  view container, Changes view, Repositories view, and Graph view.

## GitGraph Boundary

GitGraph maps to VS Code's Source Control Graph, not to a BaseHalf-specific
graph renderer.

The workbench registers the Graph view as `workbench.scm.history` in
`src/vs/workbench/contrib/scm/browser/scm.contribution.ts`. It is visible when
`scm.historyProviderCount` is non-zero. That count is maintained by
`SCMService` from registered SCM providers whose `historyProvider` observable is
set.

The Git extension provides that data in
`extensions/git/src/repository.ts` by assigning:

```ts
this._sourceControl.historyProvider = this._historyProvider;
```

`GitHistoryProvider` then serves refs, commit history, history item changes,
current/remote/base refs, and the data used by the workbench graph renderer.
GitHub enriches the same path by registering
`GitHubSourceControlHistoryItemDetailsProvider`, which supplies avatars, hover
commands, and issue-link rewriting for GitHub remotes.

## Local Verification

The no-network regression coverage lives in:

- `extensions/github-authentication/src/test/flows.test.ts`
  - BaseHalf callback scheme is treated as a supported client.
  - BaseHalf OAuth env config is only loaded from explicit BaseHalf variables.
  - No-secret builds fall back to device-code/PAT-compatible VS Code flows.
- `extensions/github/src/test/github.test.ts`
  - GitHub registers as a Git remote source publisher.
  - GitHub registers Source Control history item details for the VS Code Graph
    provider path.
- `extensions/git/src/test/smoke.test.ts`
  - No-remote publish routes through a registered remote source publisher.
  - Branch refs are available for the VS Code branch picker path.
  - Push, fetch, and pull run through Git command routes against a local bare
    remote.
  - Commit log data is available for the Source Control Graph provider path.

