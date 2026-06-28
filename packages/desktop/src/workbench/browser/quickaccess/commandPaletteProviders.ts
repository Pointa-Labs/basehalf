import { checkoutTargetForRef } from '../../contrib/scm/browser/branchQuickPickModel.js';
import type { GitScmService } from '../../contrib/scm/browser/gitScmService.js';
import type { GitRefInfo } from '../../contrib/scm/common/git.js';
import { recentFilesService } from '../../services/history/browser/recentFiles.js';
import type { SearchQueryResult } from '../../services/search/common/search.js';
import {
  type CommandPaletteAction,
  type CommandPaletteFileEntry,
  type CommandPaletteGitState,
  type CommandPaletteWorkspace,
  EMPTY_RECENT_CAP,
} from './commandPaletteModel.js';

export interface BuildCommandPaletteActionsArgs {
  readonly workspaces: readonly CommandPaletteWorkspace[];
  readonly current: string | null;
  readonly files: readonly CommandPaletteFileEntry[];
  readonly filesWorkspace: string | null;
  readonly git: CommandPaletteGitState;
  readonly modifierLabel: string;
  readonly tildifyPath: (path: string) => string;
  readonly useWorkspace: (name: string) => void;
  readonly openFile: (
    file: string,
    opts?: { readonly pinned?: boolean; readonly matchQuery?: string },
  ) => void;
  readonly pickAndAdd: () => void;
  readonly createDemo: () => void;
  readonly newNote: () => void;
  readonly promptForNewNote: () => void;
  readonly openSettings: () => void;
  readonly showSourceControl: (section: 'changes' | 'graph') => void;
  readonly openGitGraph: () => void;
  readonly promptCreateBranch: () => Promise<string | null | undefined>;
  readonly runGit: (fn: () => Promise<unknown>) => void;
  readonly gitService: GitScmService;
}

export function buildCommandPaletteActions(
  args: BuildCommandPaletteActionsArgs,
): CommandPaletteAction[] {
  return [
    ...workspacePicks(args),
    ...filePicks(args),
    ...chromeActionPicks(args),
    ...gitCommandPicks(args),
  ];
}

function workspacePicks(args: BuildCommandPaletteActionsArgs): CommandPaletteAction[] {
  return args.workspaces
    .filter((workspace) => workspace.name !== args.current)
    .map((workspace) => ({
      id: `ws:${workspace.name}`,
      label: workspace.name,
      hint: args.tildifyPath(workspace.path),
      category: 'Workspace' as const,
      run: () => args.useWorkspace(workspace.name),
    }));
}

function filePicks(args: BuildCommandPaletteActionsArgs): CommandPaletteAction[] {
  if (args.filesWorkspace !== args.current || args.current === null) return [];
  const recent = recentFilesService.recentFilesFor(args.current);
  const recentRank = new Map<string, number>();
  recent.forEach((path, idx) => recentRank.set(path, idx));
  return [...args.files]
    .sort((a, b) => {
      const ra = recentRank.get(a.file);
      const rb = recentRank.get(b.file);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.file.localeCompare(b.file);
    })
    .map((file) => {
      const basename = file.file.includes('/')
        ? (file.file.split('/').pop() ?? file.file)
        : file.file;
      return {
        id: `file:${file.file}`,
        label: basename,
        hint: file.file.includes('/') ? file.file : undefined,
        category: 'File' as const,
        ...(file.prompt !== undefined && file.prompt.length > 0 && { searchAlso: file.prompt }),
        run: () => args.openFile(file.file, { pinned: true }),
      };
    });
}

function chromeActionPicks(args: BuildCommandPaletteActionsArgs): CommandPaletteAction[] {
  const out: CommandPaletteAction[] = [
    {
      id: 'action:add-folder',
      label: 'Add folder…',
      category: 'Action',
      run: args.pickAndAdd,
    },
  ];
  if (args.current === null) {
    out.push({
      id: 'action:try-demo',
      label: 'Try a demo workspace…',
      hint: '~/BaseHalf-Demo',
      category: 'Action',
      run: args.createDemo,
    });
  }
  if (args.current !== null) {
    out.push(
      {
        id: 'action:new-note',
        label: 'New note',
        category: 'Action',
        shortcut: `${args.modifierLabel}N`,
        run: args.newNote,
      },
      {
        id: 'action:new-note-at-path',
        label: 'New note at path…',
        category: 'Action',
        run: args.promptForNewNote,
      },
    );
  }
  out.push({
    id: 'action:settings',
    label: 'Settings…',
    category: 'Action',
    shortcut: `${args.modifierLabel},`,
    run: args.openSettings,
  });
  return out;
}

function gitCommandPicks(args: BuildCommandPaletteActionsArgs): CommandPaletteAction[] {
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

export function buildContentSearchActions(args: {
  readonly contentHits: SearchQueryResult['hits'];
  readonly hitsQuery: string;
  readonly hitsWorkspace: string | null;
  readonly current: string | null;
  readonly query: string;
  readonly filtered: readonly CommandPaletteAction[];
  readonly openFile: (
    file: string,
    opts?: { readonly pinned?: boolean; readonly matchQuery?: string },
  ) => void;
}): CommandPaletteAction[] {
  const q = args.query.trim();
  if (q.length < 3 || args.hitsQuery !== q || args.hitsWorkspace !== args.current) return [];
  const shownFiles = new Set(
    args.filtered
      .filter((action) => action.category === 'File')
      .map((action) => action.id.slice('file:'.length)),
  );
  const out: CommandPaletteAction[] = [];
  for (const hit of args.contentHits) {
    if (shownFiles.has(hit.file)) continue;
    const basename = hit.file.includes('/') ? (hit.file.split('/').pop() ?? hit.file) : hit.file;
    const snippet = hit.matches[0]?.text;
    out.push({
      id: `search:${hit.file}`,
      label: basename,
      category: 'Search',
      ...(hit.file.includes('/') && { hint: hit.file }),
      ...(snippet !== undefined && snippet.length > 0 && { sub: snippet }),
      run: () => args.openFile(hit.file, { pinned: true, matchQuery: q }),
    });
  }
  return out;
}

export function buildGitEntityActions(args: {
  readonly query: string;
  readonly current: string | null;
  readonly git: CommandPaletteGitState;
  readonly gitService: GitScmService;
  readonly runGit: (fn: () => Promise<unknown>) => void;
  readonly checkoutBranch?: (branch: GitRefInfo, refs: readonly GitRefInfo[]) => void;
  readonly revealCommit: (hash: string) => void;
}): CommandPaletteAction[] {
  const q = args.query.trim().toLowerCase();
  if (q.length === 0 || args.git.workspace !== args.current || !args.git.repo) return [];
  const out: CommandPaletteAction[] = [];
  for (const branch of args.git.branches) {
    if (!branch.name.toLowerCase().includes(q)) continue;
    out.push({
      id: `git:branch:${branch.name}`,
      label: branch.name,
      category: 'Git',
      hint: branch.current
        ? 'current branch'
        : branch.type === 'remoteHead'
          ? 'remote'
          : 'Switch branch',
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

export function combineCommandPaletteRows(
  filtered: readonly CommandPaletteAction[],
  contentActions: readonly CommandPaletteAction[],
  gitMatches: readonly CommandPaletteAction[],
): CommandPaletteAction[] {
  return [...filtered, ...contentActions, ...gitMatches];
}
