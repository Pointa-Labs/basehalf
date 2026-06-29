import type {
  CommandPaletteAction,
  CommandPaletteGitRefInfo,
  CommandPaletteGitState,
} from '../../../common/quickaccess/commandPaletteModel.js';
import type { CommandPaletteQuickAccessContribution } from '../../../common/quickaccess/commandPaletteProviders.js';
import { branchQuickAccessHint, checkoutTargetForRef } from './branchQuickPickModel.js';

export interface GitQuickAccessService {
  readonly checkout: (branch: string, opts?: { readonly track?: boolean }) => Promise<unknown>;
  readonly createBranch: (name: string) => Promise<unknown>;
  readonly fetch: () => Promise<unknown>;
  readonly init: () => Promise<unknown>;
  readonly pull: () => Promise<unknown>;
  readonly push: () => Promise<unknown>;
  readonly stageAll: () => Promise<unknown>;
  readonly stash: () => Promise<unknown>;
  readonly stashPop: () => Promise<unknown>;
  readonly unstageAll: () => Promise<unknown>;
}

export interface GitQuickAccessContributionArgs {
  readonly current: string | null;
  readonly git: CommandPaletteGitState;
  readonly gitService: GitQuickAccessService;
  readonly promptCreateBranch: () => Promise<string | null | undefined>;
  readonly showSourceControl: (section: 'changes' | 'graph') => void;
  readonly openGitGraph: () => void;
  readonly runGit: (fn: () => Promise<unknown>) => void;
  readonly checkoutBranch?: (
    branch: CommandPaletteGitRefInfo,
    refs: readonly CommandPaletteGitRefInfo[],
  ) => void;
  readonly revealCommit: (hash: string) => void;
}

export interface GitQuickAccessEntityActionsArgs {
  readonly query: string;
  readonly current: string | null;
  readonly git: CommandPaletteGitState;
  readonly gitService: Pick<GitQuickAccessService, 'checkout'>;
  readonly runGit: (fn: () => Promise<unknown>) => void;
  readonly checkoutBranch?: (
    branch: CommandPaletteGitRefInfo,
    refs: readonly CommandPaletteGitRefInfo[],
  ) => void;
  readonly revealCommit: (hash: string) => void;
}

export function createGitQuickAccessContribution(
  args: GitQuickAccessContributionArgs,
): CommandPaletteQuickAccessContribution {
  return {
    id: 'scm.git.quickAccess',
    buildActions: () => buildGitQuickAccessCommandActions(args),
    buildAdditionalActions: ({ query }) => buildGitQuickAccessEntityActions({ ...args, query }),
  };
}

export function buildGitQuickAccessCommandActions(
  args: GitQuickAccessContributionArgs,
): CommandPaletteAction[] {
  if (args.git.workspace !== args.current || args.current === null) return [];
  if (!args.git.repo) {
    return [
      {
        id: 'git:init',
        label: 'Git: Initialize Repository',
        category: 'Git',
        run: () => args.runGit(() => args.gitService.init()),
      },
    ];
  }

  const G = (id: string, label: string, run: () => void): CommandPaletteAction => ({
    id,
    label,
    category: 'Git',
    searchAlso: 'git',
    run,
  });

  return [
    G('git:create-branch', 'Git: Create Branch…', () => {
      void args.promptCreateBranch().then((n) => {
        const name = n?.trim();
        if (name) args.runGit(() => args.gitService.createBranch(name));
      });
    }),
    G('git:commit', 'Git: Commit…', () => args.showSourceControl('changes')),
    G('git:graph', 'Git: Show Commit Graph', () => args.showSourceControl('graph')),
    G('git:graph-full', 'Git: Open Git Graph (full view)', args.openGitGraph),
    G('git:stage-all', 'Git: Stage All Changes', () =>
      args.runGit(() => args.gitService.stageAll()),
    ),
    G('git:unstage-all', 'Git: Unstage All Changes', () =>
      args.runGit(() => args.gitService.unstageAll()),
    ),
    G('git:stash', 'Git: Stash Changes', () => args.runGit(() => args.gitService.stash())),
    G('git:stash-pop', 'Git: Pop Latest Stash', () =>
      args.runGit(() => args.gitService.stashPop()),
    ),
    G('git:amend', 'Git: Amend Last Commit…', () => args.showSourceControl('changes')),
    G('git:push', 'Git: Push', () => args.runGit(() => args.gitService.push())),
    G('git:pull', 'Git: Pull', () => args.runGit(() => args.gitService.pull())),
    G('git:fetch', 'Git: Fetch', () => args.runGit(() => args.gitService.fetch())),
  ];
}

export function buildGitQuickAccessEntityActions(
  args: GitQuickAccessEntityActionsArgs,
): CommandPaletteAction[] {
  const q = args.query.trim().toLowerCase();
  if (q.length === 0 || args.git.workspace !== args.current || !args.git.repo) return [];

  const out: CommandPaletteAction[] = [];
  for (const branch of args.git.branches) {
    if (!branch.name.toLowerCase().includes(q)) continue;
    out.push({
      id: `git:branch:${branch.name}`,
      label: branch.name,
      category: 'Git',
      hint: branchQuickAccessHint(branch),
      searchAlso: 'branch',
      run: () => {
        if (branch.current && branch.type === 'head') return;
        if (args.checkoutBranch !== undefined) {
          args.checkoutBranch(branch, args.git.branches);
          return;
        }
        const target = checkoutTargetForRef(branch, args.git.branches);
        args.runGit(() =>
          args.gitService.checkout(
            target.branch,
            target.track === true ? { track: true } : undefined,
          ),
        );
      },
    });
    if (out.length >= 6) break;
  }

  let commitCount = 0;
  for (const commit of args.git.commits) {
    if (commitCount >= 8) break;
    if (!commit.subject.toLowerCase().includes(q) && !commit.shortHash.toLowerCase().includes(q)) {
      continue;
    }
    commitCount++;
    out.push({
      id: `git:commit:${commit.hash}`,
      label: commit.subject,
      hint: commit.shortHash,
      category: 'Git',
      sub: commit.author.name,
      searchAlso: `commit ${commit.shortHash}`,
      run: () => args.revealCommit(commit.hash),
    });
  }
  return out;
}
