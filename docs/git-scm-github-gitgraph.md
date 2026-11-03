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

## The Changes View

Changes is VS Code's view. BaseHalf changes how it starts, in two ways (the
owner's choice, 2026-11-04):

1. It shows a tree: a changed file stands under its folders, as in Files.
   BaseHalf's configuration defaults set `scm.defaultViewMode` to `tree`; VS
   Code's own default is `list`.
2. A folder named `.bh`, at any depth, starts closed. Every other folder starts
   open, as in VS Code. What `.bh` holds is BaseHalf's own and is hidden
   everywhere else in the window, and in a folder new to git it can be nearly
   all the changes: 36 of 40 rows in the owner's folder. It stays in Changes,
   closed and not hidden, because it is committed with the notes.

Everything else stays VS Code's:

- View & Sort, in the `...` that shows while the pointer is over the Changes
  header, switches between the tree and the list. The window keeps that choice
  for each workspace folder (`scm.viewMode`), over the default and after a
  restart. In the list, each file under `.bh` is a row like any other.
- A value of `scm.defaultViewMode` in the user's settings wins over BaseHalf's
  default.
- A click opens `.bh`. It stays open while the window runs, through a refresh
  and when another view of the sidebar is shown and back. After a restart it is
  closed again, although the view saves it as open (`scm.viewState2`).
- A closed folder changes nothing about a commit: Stage All Changes and Commit
  take the files under it as they take any other, and the count in the header
  counts them.

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
- `src/vs/workbench/basehalf/shell/test/common/basehalfWorkbenchProfile.test.ts`
  - Changes shows a tree by default.
- The smoke step `source-control-changes-as-tree`
  (`scripts/basehalf-smoke/areas/workbench/sourceControl.mts`), in a real window
  - A new file in a folder stands under that folder, and the folder is open.
  - A new file under `.bh/` shows no row while `.bh` is closed, as it starts,
    and shows after a click on `.bh`.
- Checked once in a real window, on a copy of a folder with 40 changes
  (2026-11-04): View & Sort and its choice after a restart; `.bh` after a
  refresh, after another view, and after a restart, with Source Control shown
  at once and 45 s after the start; Stage All Changes with `.bh` closed (40 of
  40 staged, 37 of them under `.bh`); `scm.defaultViewMode: list` in the user's
  settings.

