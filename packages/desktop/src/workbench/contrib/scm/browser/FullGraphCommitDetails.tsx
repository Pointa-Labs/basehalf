import type { JSX } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import type { GitCommit } from '../common/git.js';
import { HistoryItemChangeList } from './HistoryItemChangeList.js';
import { fullGraphFormatDate } from './gitGraphViewModel.js';
import type { GitScmService } from './gitScmService.js';
import { useGitHistoryProvider, useHistoryItemChanges } from './useHistoryItemChanges.js';

export const FullGraphCommitDetails = ({
  commit,
  gitService,
  onClose,
  onOpenFile,
}: {
  commit: GitCommit | null;
  gitService: GitScmService;
  onClose: () => void;
  onOpenFile: (path: string, parent: string | undefined) => void;
}): JSX.Element | null => {
  const historyProvider = useGitHistoryProvider(gitService);
  const { files } = useHistoryItemChanges(historyProvider, commit, { swallowErrors: true });
  if (commit === null) return null;
  const parent = commit.parents[0];
  return (
    <div
      style={{
        flexShrink: 0,
        height: '38%',
        minHeight: 120,
        borderTop: `1px solid ${color.border}`,
        background: color.surface,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          padding: `${space[2]}px ${space[3]}px`,
          borderBottom: `1px solid ${color.divider}`,
        }}
      >
        <span style={{ fontFamily: font.mono, color: color.accent, fontSize: font.size.caption }}>
          {commit.shortHash}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: color.textPrimary,
            fontWeight: font.weight.medium,
            fontSize: font.size.caption,
          }}
        >
          {commit.subject}
        </span>
        <span style={{ color: color.textTertiary, fontSize: font.size.micro }}>
          {commit.author.name} · {fullGraphFormatDate(commit.author.date)}
        </span>
        <button
          type="button"
          aria-label="Close Details"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: color.textTertiary,
            cursor: 'pointer',
            fontSize: font.size.body,
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: `${space[1]}px 0` }}>
        {commit.body.trim() !== '' && (
          <div
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: color.textSecondary,
              fontSize: font.size.micro,
              padding: `${space[1]}px ${space[3]}px ${space[2]}px`,
            }}
          >
            {commit.body.trim()}
          </div>
        )}
        <HistoryItemChangeList
          files={files}
          paddingX={space[3]}
          rowPaddingY={2}
          loading="Loading changes…"
          getLabel={(file) => file.path}
          onOpenFile={(file) => onOpenFile(file.path, parent)}
        />
      </div>
    </div>
  );
};
