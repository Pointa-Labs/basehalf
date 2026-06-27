import type { GhPrFile } from '@basehalf/core';
import { type JSX, useEffect, useMemo, useState } from 'react';
import { color, font, radius, space } from '../design.js';
import { parseUnifiedPatch } from '../lib/parseUnifiedPatch.js';
import { FileGlyph, badgeType } from './FileGlyph.js';
import { UnifiedDiff } from './UnifiedDiff.js';

/**
 * In-app PR viewer — opens a GitHub pull request's changed files and renders each
 * file's diff inline (GitHub's per-file patch parsed into our UnifiedDiff rows).
 * Read-only review surface; "在浏览器打开" links to github.com for actions we don't
 * host yet. Files come from github.pullRequestFiles (token stays in core).
 */

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const PullRequestView = ({
  number,
  title,
  remoteUrl,
  url,
  onClose,
}: {
  number: number;
  title: string;
  remoteUrl: string;
  url: string;
  onClose: () => void;
}): JSX.Element => {
  const [files, setFiles] = useState<GhPrFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        const r = (await window.bh.run('github.pullRequestFiles', { remoteUrl, number })) as {
          files: GhPrFile[];
        };
        if (cancelled) return;
        setFiles(r.files);
        setSelected(r.files[0]?.filename ?? null);
      } catch (e) {
        if (!cancelled) setError(msg(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteUrl, number]);

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
          <HeaderBtn onClick={() => void window.bh.openExternal(url)}>在浏览器打开</HeaderBtn>
          <HeaderBtn onClick={onClose}>关闭</HeaderBtn>
        </span>
      </div>
      {error !== null ? (
        <Centered tone={color.danger}>{error}</Centered>
      ) : files === null ? (
        <Centered tone={color.textTertiary}>载入改动…</Centered>
      ) : files.length === 0 ? (
        <Centered tone={color.textTertiary}>此 PR 没有文件改动。</Centered>
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
              <Centered tone={color.textTertiary}>选择一个文件。</Centered>
            ) : active.patch === undefined ? (
              <Centered tone={color.textTertiary}>
                {active.status === 'renamed'
                  ? '仅重命名，无内容改动。'
                  : '此文件无法显示差异（可能为二进制）。'}
              </Centered>
            ) : (
              <UnifiedDiff rows={rows} />
            )}
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
