import type { ContextMenuItem } from '../../../browser/parts/contextmenu/contextMenuStore.js';
import type { GitCommit } from '../common/git.js';
import type { FullGraphRefKind } from './gitGraphViewModel.js';
import type { GitScmService } from './gitScmService.js';

interface ConfirmOptions {
  readonly title: string;
  readonly body?: string;
  readonly confirmText?: string;
  readonly destructive?: boolean;
}

interface PromptOptions {
  readonly title: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
}

export interface GitGraphActionDeps {
  readonly git: Pick<
    GitScmService,
    | 'checkout'
    | 'createBranch'
    | 'tag'
    | 'cherryPick'
    | 'revert'
    | 'merge'
    | 'reset'
    | 'tagDelete'
    | 'renameBranch'
    | 'deleteBranch'
    | 'stashApply'
    | 'stashPop'
    | 'stashDrop'
  >;
  readonly runGit: (fn: () => Promise<unknown>) => void;
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
  readonly prompt: (options: PromptOptions) => Promise<string | null>;
  readonly setRebaseBase: (sha: string) => void;
  readonly writeClipboard: (text: string) => Promise<void>;
  readonly toastError: (message: string) => void;
  readonly toastSuccess: (message: string) => void;
}

export function fullGraphCommitMenu(
  commit: GitCommit,
  deps: GitGraphActionDeps,
): ContextMenuItem[] {
  const sha = commit.hash;
  const short = commit.shortHash;
  return [
    {
      id: 'checkout',
      label: 'Checkout Commit…',
      run: () =>
        void deps
          .confirm({
            title: `Checkout ${short}?`,
            body: 'This enters a detached HEAD state.',
            confirmText: 'Checkout',
          })
          .then((ok) => {
            if (ok) deps.runGit(() => deps.git.checkout(sha));
          }),
    },
    {
      id: 'branch',
      label: 'Create Branch from Commit…',
      run: () =>
        void deps
          .prompt({
            title: `Create branch from ${short}`,
            label: 'Branch name',
            placeholder: 'feature/x',
          })
          .then((name) => {
            const branch = name?.trim();
            if (branch) deps.runGit(() => deps.git.createBranch(branch, { ref: sha }));
          }),
    },
    {
      id: 'tag',
      label: 'Create Tag at Commit…',
      run: () =>
        void deps
          .prompt({
            title: `Create tag at ${short}`,
            label: 'Tag name',
            placeholder: 'v1.0',
          })
          .then((name) => {
            const tag = name?.trim();
            if (tag) deps.runGit(() => deps.git.tag(tag, sha));
          }),
    },
    { separator: true },
    {
      id: 'cherrypick',
      label: 'Cherry-Pick onto Current Branch',
      run: () =>
        deps.runGit(async () => {
          const result = await deps.git.cherryPick(sha);
          if (result.conflicts)
            deps.toastError('The cherry-pick hit conflicts — resolve them in Merge Changes.');
        }),
    },
    {
      id: 'revert',
      label: 'Revert Commit',
      run: () =>
        deps.runGit(async () => {
          const result = await deps.git.revert(sha);
          if (result.conflicts)
            deps.toastError('The revert hit conflicts — resolve them in Merge Changes.');
        }),
    },
    {
      id: 'merge',
      label: 'Merge into Current Branch',
      run: () =>
        deps.runGit(async () => {
          const result = await deps.git.merge(sha);
          if (result.conflicts)
            deps.toastError('The merge hit conflicts — resolve them in Merge Changes.');
        }),
    },
    { separator: true },
    {
      id: 'reset-mixed',
      label: 'Reset Current Branch to Here (Keep Changes)',
      run: () => deps.runGit(() => deps.git.reset({ ref: sha, mode: 'mixed' })),
    },
    {
      id: 'reset-hard',
      label: 'Reset Current Branch to Here (Discard Changes)',
      danger: true,
      run: () =>
        void deps
          .confirm({
            title: `Hard-reset to ${short}?`,
            body: 'All changes after this commit on the current branch are permanently discarded. This is IRREVERSIBLE.',
            confirmText: 'Hard Reset',
            destructive: true,
          })
          .then((ok) => {
            if (ok) deps.runGit(() => deps.git.reset({ ref: sha, mode: 'hard' }));
          }),
    },
    { separator: true },
    {
      id: 'rebase',
      label: 'Rebase Commits After This…',
      run: () => deps.setRebaseBase(sha),
    },
    { separator: true },
    {
      id: 'copy-sha',
      label: 'Copy Commit Hash',
      run: () => void deps.writeClipboard(sha).then(() => deps.toastSuccess(`Copied ${short}`)),
    },
    {
      id: 'copy-subject',
      label: 'Copy Commit Message',
      run: () => void deps.writeClipboard(commit.subject).then(() => deps.toastSuccess('Copied')),
    },
  ];
}

export function fullGraphRefMenu(
  name: string,
  kind: FullGraphRefKind,
  deps: GitGraphActionDeps,
): ContextMenuItem[] {
  if (kind === 'tag') {
    return [
      {
        id: 'checkout',
        label: `Checkout tag ${name}`,
        run: () => deps.runGit(() => deps.git.checkout(`refs/tags/${name}`)),
      },
      {
        id: 'delete',
        label: 'Delete Tag',
        danger: true,
        run: () =>
          void deps
            .confirm({
              title: `Delete tag ${name}?`,
              confirmText: 'Delete',
              destructive: true,
            })
            .then((ok) => {
              if (ok) deps.runGit(() => deps.git.tagDelete(name));
            }),
      },
    ];
  }

  const items: ContextMenuItem[] = [
    {
      id: 'checkout',
      label: `Checkout ${name}`,
      run: () =>
        deps.runGit(() => deps.git.checkout(name, kind === 'remote' ? { track: true } : {})),
    },
    {
      id: 'merge',
      label: 'Merge into Current Branch',
      run: () =>
        deps.runGit(async () => {
          const result = await deps.git.merge(name);
          if (result.conflicts)
            deps.toastError('The merge hit conflicts — resolve them in Merge Changes.');
        }),
    },
  ];

  if (kind === 'branch') {
    items.push(
      {
        id: 'rename',
        label: 'Rename Branch…',
        run: () =>
          void deps
            .prompt({ title: `Rename ${name}`, label: 'New name', defaultValue: name })
            .then((value) => {
              const to = value?.trim();
              if (to && to !== name) deps.runGit(() => deps.git.renameBranch(name, to));
            }),
      },
      { separator: true },
      {
        id: 'delete',
        label: 'Delete Branch',
        danger: true,
        run: () =>
          void deps
            .confirm({
              title: `Delete branch ${name}?`,
              confirmText: 'Delete',
              destructive: true,
            })
            .then((ok) => {
              if (!ok) return;
              deps.runGit(async () => {
                try {
                  await deps.git.deleteBranch(name);
                } catch {
                  if (
                    await deps.confirm({
                      title: `Branch ${name} is not fully merged. Force delete?`,
                      confirmText: 'Force Delete',
                      destructive: true,
                    })
                  ) {
                    await deps.git.deleteBranch(name, { force: true });
                  }
                }
              });
            }),
      },
    );
  }

  return items;
}

export function fullGraphStashMenu(ref: string, deps: GitGraphActionDeps): ContextMenuItem[] {
  return [
    {
      id: 'apply',
      label: 'Apply Stash',
      run: () => deps.runGit(() => deps.git.stashApply(ref)),
    },
    {
      id: 'pop',
      label: 'Pop Stash',
      run: () => deps.runGit(() => deps.git.stashPop(ref)),
    },
    { separator: true },
    {
      id: 'drop',
      label: 'Drop Stash',
      danger: true,
      run: () =>
        void deps
          .confirm({ title: `Delete ${ref}?`, confirmText: 'Delete', destructive: true })
          .then((ok) => {
            if (ok) deps.runGit(() => deps.git.stashDrop(ref));
          }),
    },
  ];
}
