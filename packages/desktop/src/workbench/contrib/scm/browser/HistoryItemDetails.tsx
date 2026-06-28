import type { JSX, ReactNode } from 'react';
import { confirm, prompt } from '../../../../platform/dialogs/browser/dialogService.js';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import { color, font, radius, space, transition } from '../../../browser/style/design.js';
import { Codicon } from '../../../browser/ui/Codicon.js';
import { useWorkspaceStore } from '../../../services/workspace/browser/workspaceStore.js';
import type { GitCommit } from '../common/git.js';
import { HistoryItemChangeList } from './HistoryItemChangeList.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import { useGitStatusStore } from './gitStatusStore.js';
import { commitDiffTitle } from './historyItemChangesModel.js';
import { useGitHistoryProvider, useHistoryItemChanges } from './useHistoryItemChanges.js';

export const HistoryItemDetails = ({
  commit,
  onMutate,
  gitService: git = gitScmService,
}: {
  commit: GitCommit;
  onMutate: () => Promise<void> | void;
  gitService?: GitScmService;
}): JSX.Element => {
  const openCommitDiff = useWorkspaceStore((s) => s.openCommitDiff);
  const historyProvider = useGitHistoryProvider(git);
  const { files, error, setError } = useHistoryItemChanges(historyProvider, commit);

  const run = (fn: () => Promise<unknown>): void => {
    void (async () => {
      try {
        setError(null);
        await fn();
        await useGitStatusStore.getState().refresh();
        await onMutate();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const copySha = (): void => {
    void navigator.clipboard
      .writeText(commit.hash)
      .then(() => toast.success(`Copied ${commit.shortHash}`))
      .catch(() => toast.error('Copy failed'));
  };

  const createBranch = (): void =>
    void (async () => {
      const name = (
        await prompt({
          title: `Create branch from ${commit.shortHash}`,
          label: 'Branch name',
          placeholder: 'feature/x',
        })
      )?.trim();
      if (name) run(() => git.createBranch(name, { ref: commit.hash }));
    })();

  const checkout = (): void =>
    void (async () => {
      if (
        !(await confirm({
          title: `Checkout commit ${commit.shortHash}?`,
          body: 'This enters a detached HEAD state.',
          confirmText: 'Checkout',
        }))
      )
        return;
      run(() => git.checkout(commit.hash));
    })();

  const revert = (): void =>
    void (async () => {
      if (
        !(await confirm({
          title: `Revert commit "${commit.subject}"?`,
          body: 'This creates a revert commit.',
          confirmText: 'Revert',
          destructive: true,
        }))
      )
        return;
      run(async () => {
        const result = await git.revert(commit.hash);
        if (result.conflicts) {
          setError('The revert hit conflicts. Resolve them in Merge Changes, then commit.');
        }
      });
    })();

  const parent = commit.parents[0];

  return (
    <div
      style={{
        padding: `${space[1]}px ${space[2]}px ${space[2]}px ${space[3]}px`,
        background: color.surfaceMuted,
        borderBottom: `1px solid ${color.divider}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          gap: space[1],
          marginBottom: space[1],
        }}
      >
        <DetailButton title="Copy Full SHA" onClick={copySha}>
          <Codicon name="copy" size={12} style={{ marginRight: 4 }} />
          Copy SHA
        </DetailButton>
        <DetailButton title="Create Branch from Commit" onClick={createBranch}>
          <Codicon name="git-branch" size={12} style={{ marginRight: 4 }} />
          Create Branch
        </DetailButton>
        <DetailButton title="Checkout Commit (Detached HEAD)" onClick={checkout}>
          <Codicon name="git-commit" size={12} style={{ marginRight: 4 }} />
          Checkout
        </DetailButton>
        <DetailButton title="Revert this commit" onClick={revert}>
          <Codicon name="discard" size={12} style={{ marginRight: 4 }} />
          Revert
        </DetailButton>
      </div>

      {commit.body.trim() !== '' && (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: color.textSecondary,
            fontFamily: font.sans,
            fontSize: font.size.micro,
            marginBottom: space[1],
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          {commit.body.trim()}
        </div>
      )}

      {error !== null ? (
        <div style={{ color: color.danger, fontFamily: font.sans, fontSize: font.size.micro }}>
          {error}
        </div>
      ) : (
        <HistoryItemChangeList
          files={files}
          paddingX={space[1]}
          messagePaddingX={0}
          loading="Loading changes..."
          empty="No file changes."
          onOpenFile={(file) =>
            openCommitDiff(file.path, commit.hash, parent, commitDiffTitle(commit.shortHash))
          }
        />
      )}
    </div>
  );
};

const DetailButton = ({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 20,
      padding: `0 ${space[2]}px`,
      background: 'none',
      border: `1px solid ${color.border}`,
      borderRadius: radius.sm,
      color: color.textSecondary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: transition(['background', 'color']),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = color.divider;
      e.currentTarget.style.color = color.textPrimary;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'none';
      e.currentTarget.style.color = color.textSecondary;
    }}
  >
    {children}
  </button>
);
