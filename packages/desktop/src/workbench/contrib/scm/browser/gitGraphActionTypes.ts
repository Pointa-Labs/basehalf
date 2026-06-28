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
