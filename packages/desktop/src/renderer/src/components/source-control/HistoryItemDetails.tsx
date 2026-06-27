import type { GitCommit, GitCommitFilesResult } from '@basehalf/core';
import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { color, font, radius, space, transition } from '../../design.js';
import { useGitStatusStore } from '../../store/gitStatus.js';
import { toast } from '../../store/toast.js';
import { useWorkspaceStore } from '../../store/workspace.js';
import { Codicon } from '../Codicon.js';
import { confirm, prompt } from '../Dialog.js';
import { historyStatusTone } from './historyGraphModel.js';

export const HistoryItemDetails = ({
  commit,
  onMutate,
}: {
  commit: GitCommit;
  onMutate: () => Promise<void> | void;
}): JSX.Element => {
  const openCommitDiff = useWorkspaceStore((s) => s.openCommitDiff);
  const [files, setFiles] = useState<GitCommitFilesResult['files'] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      if (name) run(() => window.bh.run('git.createBranch', { name, ref: commit.hash }));
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
      run(() => window.bh.run('git.checkout', { branch: commit.hash }));
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
        const result = (await window.bh.run('git.revert', { ref: commit.hash })) as {
          conflicts: boolean;
        };
        if (result.conflicts) {
          setError('The revert hit conflicts. Resolve them in Merge Changes, then commit.');
        }
      });
    })();

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setError(null);
    void (async () => {
      try {
        const result = (await window.bh.run('git.commitFiles', {
          ref: commit.hash,
        })) as GitCommitFilesResult;
        if (!cancelled) setFiles(result.files);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commit.hash]);

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
      ) : files === null ? (
        <div
          style={{ color: color.textTertiary, fontFamily: font.sans, fontSize: font.size.micro }}
        >
          Loading changes...
        </div>
      ) : files.length === 0 ? (
        <div
          style={{ color: color.textTertiary, fontFamily: font.sans, fontSize: font.size.micro }}
        >
          No file changes.
        </div>
      ) : (
        files.map((file) => {
          const displayPath = file.orig ? `${file.orig} -> ${file.path}` : file.path;
          return (
            <button
              key={`${file.status}:${displayPath}`}
              type="button"
              onClick={() =>
                openCommitDiff(file.path, commit.hash, parent, `${commit.shortHash} -> parent`)
              }
              title={displayPath}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: space[2],
                width: '100%',
                height: 22,
                padding: `0 ${space[1]}px`,
                background: 'none',
                border: 'none',
                borderRadius: radius.sm,
                cursor: 'pointer',
                textAlign: 'left',
                color: color.textSecondary,
                fontFamily: font.sans,
                fontSize: font.size.micro,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = color.divider;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
              }}
            >
              <span
                style={{
                  width: 12,
                  flexShrink: 0,
                  textAlign: 'center',
                  fontFamily: font.mono,
                  fontWeight: font.weight.semibold,
                  color: historyStatusTone(file.status),
                }}
              >
                {file.status}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayPath}
              </span>
            </button>
          );
        })
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
