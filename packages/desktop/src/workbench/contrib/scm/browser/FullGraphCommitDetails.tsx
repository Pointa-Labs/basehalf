import { type JSX, useEffect, useState } from 'react';
import { color, font, space } from '../../../browser/style/design.js';
import type { GitCommit, GitCommitFilesResult } from '../common/git.js';
import { fullGraphFormatDate } from './gitGraphViewModel.js';
import type { GitScmService } from './gitScmService.js';

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
  const [files, setFiles] = useState<GitCommitFilesResult['files'] | null>(null);
  useEffect(() => {
    if (commit === null) return;
    let cancelled = false;
    setFiles(null);
    void (async () => {
      try {
        const files = await gitService.commitFiles(commit.hash);
        if (!cancelled) setFiles(files);
      } catch {
        if (!cancelled) setFiles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commit, gitService]);
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
        {files === null ? (
          <div
            style={{
              padding: `0 ${space[3]}px`,
              color: color.textTertiary,
              fontSize: font.size.micro,
            }}
          >
            Loading changes…
          </div>
        ) : (
          files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onOpenFile(file.path, parent)}
              title={file.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: space[2],
                width: '100%',
                padding: `2px ${space[3]}px`,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                color: color.textSecondary,
                fontFamily: font.sans,
                fontSize: font.size.micro,
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = color.divider;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'none';
              }}
            >
              <span
                style={{
                  width: 12,
                  flexShrink: 0,
                  textAlign: 'center',
                  fontFamily: font.mono,
                  fontWeight: font.weight.semibold,
                  color: statusTone(file.status),
                }}
              >
                {file.status}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.path}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

const statusTone = (status: string): string =>
  status === 'A'
    ? color.success
    : status === 'D'
      ? color.danger
      : status === 'R' || status === 'C'
        ? color.accent
        : color.warning;
