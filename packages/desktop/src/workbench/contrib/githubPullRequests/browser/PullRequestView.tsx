import { type JSX, useEffect, useMemo, useState } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { FileGlyph, badgeType } from '../../../browser/labels/FileGlyph.js';
import { toast } from '../../../browser/parts/notifications/toastStore.js';
import { color, font, radius, space } from '../../../browser/style/design.js';
import { Button } from '../../../browser/ui/primitives/Button.js';
import { UnifiedDiff } from '../../multiDiffEditor/browser/UnifiedDiff.js';
import { parseUnifiedPatch } from '../../multiDiffEditor/browser/parseUnifiedPatch.js';
import type { GhPrFile } from '../common/githubPullRequests.js';
import {
  type GithubPullRequestService,
  githubErrorMessage,
  githubPullRequestService,
} from './githubPullRequestService.js';

/**
 * In-app PR viewer — opens a GitHub pull request's changed files and renders each
 * file's diff inline (GitHub's per-file patch parsed into our UnifiedDiff rows),
 * with a review footer (Approve / Request changes / Comment) that submits via the
 * API. Files come from the GitHub PR service; credentials stay in the host.
 */

export const PullRequestView = ({
  number,
  title,
  remoteUrl,
  url,
  onClose,
  service = githubPullRequestService,
}: {
  number: number;
  title: string;
  remoteUrl: string;
  url: string;
  onClose: () => void;
  service?: GithubPullRequestService;
}): JSX.Element => {
  const [files, setFiles] = useState<GhPrFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reviewBody, setReviewBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitReview = (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'): void =>
    void (async () => {
      setSubmitting(true);
      try {
        await service.reviewPullRequest({
          remoteUrl,
          number,
          event,
          body: reviewBody,
        });
        setReviewBody('');
        toast.success(
          event === 'APPROVE'
            ? 'Approved.'
            : event === 'REQUEST_CHANGES'
              ? 'Changes requested.'
              : 'Comment submitted.',
        );
      } catch (e) {
        toast.error(githubErrorMessage(e));
      } finally {
        setSubmitting(false);
      }
    })();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        const pullRequestFiles = await service.pullRequestFiles(remoteUrl, number);
        if (cancelled) return;
        const nextFiles = [...pullRequestFiles];
        setFiles(nextFiles);
        setSelected(nextFiles[0]?.filename ?? null);
      } catch (e) {
        if (!cancelled) setError(githubErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteUrl, number, service]);

  const active = files?.find((f) => f.filename === selected) ?? null;
  const rows = useMemo(
    () => (active?.patch !== undefined ? parseUnifiedPatch(active.patch) : []),
    [active],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          padding: `${space[2]}px ${space[3]}px`,
          borderBottom: `1px solid ${color.divider}`,
          fontFamily: font.sans,
          fontSize: font.size.caption,
          flexShrink: 0,
        }}
      >
        <span style={{ color: color.textGhost, fontFamily: font.mono }}>#{number}</span>
        <span
          style={{
            color: color.textPrimary,
            fontWeight: font.weight.medium,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: space[2] }}>
          <HeaderBtn onClick={() => void nativeHostService.openExternal(url)}>
            Open in Browser
          </HeaderBtn>
          <HeaderBtn onClick={onClose}>Close</HeaderBtn>
        </span>
      </div>
      {error !== null ? (
        <Centered tone={color.danger}>{error}</Centered>
      ) : files === null ? (
        <Centered tone={color.textTertiary}>Loading changes…</Centered>
      ) : files.length === 0 ? (
        <Centered tone={color.textTertiary}>This pull request has no file changes.</Centered>
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* File list */}
          <div
            style={{
              width: 260,
              flexShrink: 0,
              borderRight: `1px solid ${color.divider}`,
              overflowY: 'auto',
            }}
          >
            {files.map((f) => {
              const name = f.filename.slice(f.filename.lastIndexOf('/') + 1);
              return (
                <button
                  key={f.filename}
                  type="button"
                  data-testid="pr-file"
                  onClick={() => setSelected(f.filename)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: space[1],
                    width: '100%',
                    padding: `${space[1]}px ${space[2]}px`,
                    background: selected === f.filename ? color.accentSofter : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: font.sans,
                    fontSize: font.size.micro,
                  }}
                >
                  <FileGlyph type={badgeType(name, false)} tone={color.textTertiary} size={12} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: color.textSecondary,
                    }}
                  >
                    {f.filename}
                  </span>
                  <span style={{ fontFamily: font.mono, flexShrink: 0 }}>
                    <span style={{ color: color.success }}>+{f.additions}</span>{' '}
                    <span style={{ color: color.danger }}>−{f.deletions}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {/* Selected file diff */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {active === null ? (
              <Centered tone={color.textTertiary}>Select a file.</Centered>
            ) : active.patch === undefined ? (
              <Centered tone={color.textTertiary}>
                {active.status === 'renamed'
                  ? 'Renamed only, no content changes.'
                  : 'This file has no displayable diff (it may be binary).'}
              </Centered>
            ) : (
              <UnifiedDiff rows={rows} />
            )}
          </div>
        </div>
      )}
      {/* Review footer — submit a review (needs a write-scoped token). */}
      {error === null && (
        <div
          data-testid="pr-review"
          style={{
            flexShrink: 0,
            borderTop: `1px solid ${color.divider}`,
            padding: space[2],
            display: 'flex',
            alignItems: 'flex-end',
            gap: space[2],
          }}
        >
          <textarea
            value={reviewBody}
            onChange={(e) => setReviewBody(e.target.value)}
            placeholder="Leave a review comment (optional for approve)…"
            data-testid="pr-review-body"
            rows={2}
            style={{
              flex: 1,
              resize: 'none',
              boxSizing: 'border-box',
              background: color.bg,
              border: `1px solid ${color.border}`,
              borderRadius: radius.md,
              color: color.textPrimary,
              fontFamily: font.sans,
              fontSize: font.size.caption,
              padding: `${space[1]}px ${space[2]}px`,
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[1] }}>
            <Button
              variant="primary"
              size="sm"
              disabled={submitting}
              onClick={() => submitReview('APPROVE')}
            >
              Approve
            </Button>
            <div style={{ display: 'flex', gap: space[1] }}>
              <Button
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={() => submitReview('REQUEST_CHANGES')}
              >
                Request Changes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={() => submitReview('COMMENT')}
              >
                Comment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const HeaderBtn = ({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: `2px ${space[2]}px`,
      background: color.surface,
      border: `1px solid ${color.border}`,
      borderRadius: radius.sm,
      color: color.textSecondary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      cursor: 'pointer',
    }}
  >
    {children}
  </button>
);

const Centered = ({ children, tone }: { children: string; tone: string }): JSX.Element => (
  <div
    style={{ padding: space[4], color: tone, fontFamily: font.sans, fontSize: font.size.caption }}
  >
    {children}
  </div>
);
