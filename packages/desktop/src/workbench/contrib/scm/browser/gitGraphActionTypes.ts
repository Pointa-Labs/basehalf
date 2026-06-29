import {
  confirm as defaultConfirm,
  prompt as defaultPrompt,
} from '../../../../platform/dialogs/browser/dialogService.js';
import { toast as defaultToast } from '../../../../platform/notification/browser/notificationService.js';
import type { GitCommit } from '../common/git.js';
import { GitErrorCodes, ensureGitError } from '../common/git.js';
import type { FullGraphRefModel } from '../common/gitGraphRefIndex.js';
import type { GitScmService } from './gitScmService.js';

export interface GitGraphConfirmOptions {
  readonly title: string;
  readonly body?: string;
  readonly confirmText?: string;
  readonly destructive?: boolean;
}

export interface GitGraphPromptOptions {
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
    | 'deleteRemoteRef'
    | 'stashApply'
    | 'stashPop'
    | 'stashDrop'
  >;
  readonly runGit: (fn: () => Promise<unknown>) => void;
  readonly confirm: (options: GitGraphConfirmOptions) => Promise<boolean>;
  readonly prompt: (options: GitGraphPromptOptions) => Promise<string | null>;
  readonly setRebaseBase: (sha: string) => void;
  readonly writeClipboard: (text: string) => Promise<void>;
  readonly toastError: (message: string) => void;
  readonly toastSuccess: (message: string) => void;
}

export type FullGraphCommitMenuCommand =
  | 'checkout'
  | 'branch'
  | 'tag'
  | 'cherrypick'
  | 'revert'
  | 'merge'
  | 'reset-mixed'
  | 'reset-hard'
  | 'rebase'
  | 'copy-sha'
  | 'copy-subject';

export type FullGraphRefMenuCommand = 'checkout' | 'delete-branch' | 'delete-tag';

export interface GitGraphActionRunner {
  executeCommitAction(command: FullGraphCommitMenuCommand, commit: GitCommit): void;
  executeRefAction(command: FullGraphRefMenuCommand, ref: FullGraphRefModel): void;
}

export type GitGraphActionService = GitGraphActionDeps & GitGraphActionRunner;

export type GitGraphActionRunnerOptions = Pick<
  GitGraphActionDeps,
  'git' | 'runGit' | 'setRebaseBase'
> &
  Partial<
    Pick<
      GitGraphActionDeps,
      'confirm' | 'prompt' | 'writeClipboard' | 'toastError' | 'toastSuccess'
    >
  >;

export function createGitGraphActionRunner(
  options: GitGraphActionRunnerOptions,
): GitGraphActionService {
  return new DefaultGitGraphActionRunner({
    git: options.git,
    runGit: options.runGit,
    confirm: options.confirm ?? defaultConfirm,
    prompt: options.prompt ?? defaultPrompt,
    setRebaseBase: options.setRebaseBase,
    writeClipboard: options.writeClipboard ?? writeBrowserClipboard,
    toastError: options.toastError ?? defaultToast.error,
    toastSuccess: options.toastSuccess ?? defaultToast.success,
  });
}

export class DefaultGitGraphActionRunner implements GitGraphActionService {
  constructor(private readonly deps: GitGraphActionDeps) {}

  get git(): GitGraphActionDeps['git'] {
    return this.deps.git;
  }

  get runGit(): GitGraphActionDeps['runGit'] {
    return this.deps.runGit;
  }

  get confirm(): GitGraphActionDeps['confirm'] {
    return this.deps.confirm;
  }

  get prompt(): GitGraphActionDeps['prompt'] {
    return this.deps.prompt;
  }

  get setRebaseBase(): GitGraphActionDeps['setRebaseBase'] {
    return this.deps.setRebaseBase;
  }

  get writeClipboard(): GitGraphActionDeps['writeClipboard'] {
    return this.deps.writeClipboard;
  }

  get toastError(): GitGraphActionDeps['toastError'] {
    return this.deps.toastError;
  }

  get toastSuccess(): GitGraphActionDeps['toastSuccess'] {
    return this.deps.toastSuccess;
  }

  executeCommitAction(command: FullGraphCommitMenuCommand, commit: GitCommit): void {
    const sha = commit.hash;
    const short = commit.shortHash;

    switch (command) {
      case 'checkout':
        void this.confirm({
          title: `Checkout ${short}?`,
          body: 'This enters a detached HEAD state.',
          confirmText: 'Checkout',
        }).then((ok) => {
          if (ok) this.runGit(() => this.git.checkout(sha));
        });
        return;
      case 'branch':
        void this.prompt({
          title: `Create branch from ${short}`,
          label: 'Branch name',
          placeholder: 'feature/x',
        }).then((name) => {
          const branch = name?.trim();
          if (branch) this.runGit(() => this.git.createBranch(branch, { ref: sha }));
        });
        return;
      case 'tag':
        void this.prompt({
          title: `Create tag at ${short}`,
          label: 'Tag name',
          placeholder: 'v1.0',
        }).then((name) => {
          const tag = name?.trim();
          if (tag) this.runGit(() => this.git.tag(tag, sha));
        });
        return;
      case 'cherrypick':
        this.runGit(async () => {
          const result = await this.git.cherryPick(sha);
          if (result.conflicts)
            this.toastError('The cherry-pick hit conflicts — resolve them in Merge Changes.');
        });
        return;
      case 'revert':
        this.runGit(async () => {
          const result = await this.git.revert(sha);
          if (result.conflicts)
            this.toastError('The revert hit conflicts — resolve them in Merge Changes.');
        });
        return;
      case 'merge':
        this.runGit(async () => {
          const result = await this.git.merge(sha);
          if (result.conflicts)
            this.toastError('The merge hit conflicts — resolve them in Merge Changes.');
        });
        return;
      case 'reset-mixed':
        this.runGit(() => this.git.reset({ ref: sha, mode: 'mixed' }));
        return;
      case 'reset-hard':
        void this.confirm({
          title: `Hard-reset to ${short}?`,
          body: 'All changes after this commit on the current branch are permanently discarded. This is IRREVERSIBLE.',
          confirmText: 'Hard Reset',
          destructive: true,
        }).then((ok) => {
          if (ok) this.runGit(() => this.git.reset({ ref: sha, mode: 'hard' }));
        });
        return;
      case 'rebase':
        this.setRebaseBase(sha);
        return;
      case 'copy-sha':
        void this.writeClipboard(sha).then(() => this.toastSuccess(`Copied ${short}`));
        return;
      case 'copy-subject':
        void this.writeClipboard(commit.subject).then(() => this.toastSuccess('Copied'));
        return;
    }
  }

  executeRefAction(command: FullGraphRefMenuCommand, ref: FullGraphRefModel): void {
    const { kind, name } = ref;

    switch (command) {
      case 'checkout':
        this.runGit(() =>
          this.git.checkout(
            kind === 'remote' ? (ref.trackingLocal ?? ref.targetRef) : name,
            kind === 'remote' && ref.trackingLocal === undefined ? { track: true } : {},
          ),
        );
        return;
      case 'delete-branch':
        void this.confirm({
          title: `Delete branch ${name}?`,
          confirmText: 'Delete',
          destructive: true,
        }).then((ok) => {
          if (!ok) return;
          this.runGit(() => deleteBranchRefWithRecovery(ref, this));
        });
        return;
      case 'delete-tag':
        void this.confirm({
          title: `Delete tag ${name}?`,
          confirmText: 'Delete',
          destructive: true,
        }).then((ok) => {
          if (ok) this.runGit(() => this.git.tagDelete(name));
        });
        return;
    }
  }
}

export async function deleteBranchRefWithRecovery(
  ref: Pick<FullGraphRefModel, 'kind' | 'name'>,
  deps: Pick<GitGraphActionDeps, 'confirm' | 'git'>,
): Promise<void> {
  const { name, kind } = ref;
  const remoteRef = kind === 'remote' ? remoteRefParts(name) : null;
  const deleteBranch = (force?: boolean): Promise<void> =>
    kind === 'remote'
      ? remoteRef === null
        ? Promise.resolve()
        : deps.git.deleteRemoteRef(
            remoteRef.remote,
            remoteRef.name,
            force === true ? { force: true } : {},
          )
      : deps.git.deleteBranch(name, force === true ? { force: true } : {});

  try {
    await deleteBranch();
  } catch (err) {
    const gitError = ensureGitError(err);
    if (gitError.gitErrorCode !== GitErrorCodes.BranchNotFullyMerged) {
      throw gitError;
    }
    if (
      await deps.confirm({
        title: `Branch ${name} is not fully merged. Force delete?`,
        confirmText: 'Force Delete',
        destructive: true,
      })
    ) {
      await deleteBranch(true);
    }
  }
}

function remoteRefParts(name: string): { remote: string; name: string } | null {
  const index = name.indexOf('/');
  if (index <= 0 || index === name.length - 1) return null;
  return { remote: name.slice(0, index), name: name.slice(index + 1) };
}

function writeBrowserClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.clipboard?.writeText === undefined) {
    return Promise.reject(new Error('Clipboard API is not available'));
  }
  return navigator.clipboard.writeText(text);
}
