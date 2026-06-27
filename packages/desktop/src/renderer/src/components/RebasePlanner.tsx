import type { GitCommit, GitLogResult, GitRebaseItem, GitRebaseResult } from '@basehalf/core';
import { type JSX, useEffect, useState } from 'react';
import { color, font, radius, shadow, space } from '../design.js';
import { toast } from '../store/toast.js';
import { prompt } from './Dialog.js';
import { Button } from './primitives/Button.js';

/**
 * RebasePlanner — VS Code / Git Graph-style interactive rebase. Lists the commits
 * base..HEAD (oldest→newest, the replay order), each with an action (keep / drop /
 * fixup-into-previous / reword) and up/down reordering. "应用" runs the all-or-
 * nothing git.rebaseInteractive: it replays the plan onto base, and on any conflict
 * aborts and leaves the branch untouched (the original stays in the reflog).
 */

type Action = GitRebaseItem['action'];

interface Row {
  readonly commit: GitCommit;
  action: Action;
  message?: string;
}

const ACTION_LABEL: Record<Action, string> = {
  pick: '保留',
  drop: '丢弃',
  fixup: '合并入上一个',
  reword: '改写信息',
};

export const RebasePlanner = ({
  base,
  onClose,
  onApplied,
}: {
  base: string;
  onClose: () => void;
  onApplied: () => void;
}): JSX.Element => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = (await window.bh.run('git.log', {
          ref: `${base}..HEAD`,
          maxCount: 100,
        })) as GitLogResult;
        // git.log is newest→oldest; the rebase replays oldest→newest.
        if (!cancelled)
          setRows([...r.commits].reverse().map((c) => ({ commit: c, action: 'pick' })));
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  const setAction = (i: number, action: Action): void =>
    setRows((rs) => {
      if (rs === null) return rs;
      const next = rs.map((r, k) => (k === i ? { ...r, action } : r));
      return next;
    });

  const reword = (i: number): void =>
    void (async () => {
      const row = rows?.[i];
      if (!row) return;
      const m = (
        await prompt({
          title: '改写提交信息',
          label: '新信息',
          defaultValue: row.commit.subject,
        })
      )?.trim();
      if (m)
        setRows((rs) =>
          rs === null
            ? rs
            : rs.map((r, k) => (k === i ? { ...r, action: 'reword', message: m } : r)),
        );
    })();

  const move = (i: number, dir: -1 | 1): void =>
    setRows((rs) => {
      if (rs === null) return rs;
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      const a = next[i];
      const b = next[j];
      if (a === undefined || b === undefined) return rs;
      next[i] = b;
      next[j] = a;
      return next;
    });

  const apply = (): void =>
    void (async () => {
      if (rows === null) return;
      setBusy(true);
      try {
        const items: GitRebaseItem[] = rows.map((r) =>
          r.action === 'reword' && r.message
            ? { sha: r.commit.hash, action: 'reword', message: r.message }
            : { sha: r.commit.hash, action: r.action },
        );
        const res = (await window.bh.run('git.rebaseInteractive', {
          base,
          items,
        })) as GitRebaseResult;
        if (res.ok) {
          toast.success('变基完成。');
          onApplied();
          onClose();
        } else {
          toast.error('变基遇到冲突，已自动撤销（分支未改动）。');
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();

  const kept = rows?.filter((r) => r.action !== 'drop').length ?? 0;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: color.backdrop,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
      }}
    >
      <div
        data-testid="rebase-planner"
        style={{
          width: 560,
          maxWidth: '92%',
          maxHeight: '80%',
          background: color.surface,
          border: `1px solid ${color.border}`,
          borderRadius: radius.lg,
          boxShadow: shadow.raised,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: font.sans,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: `${space[3]}px ${space[4]}px`,
            borderBottom: `1px solid ${color.divider}`,
          }}
        >
          <div style={{ fontSize: font.size.body, color: color.textPrimary }}>
            整理提交历史（变基）
          </div>
          <div style={{ fontSize: font.size.micro, color: color.textTertiary, marginTop: 2 }}>
            将以下提交重放到 <code>{base.slice(0, 7)}</code>{' '}
            之上。遇到冲突会自动撤销，分支不受影响。
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: space[2] }}>
          {rows === null ? (
            <Muted>载入提交…</Muted>
          ) : rows.length === 0 ? (
            <Muted>所选基点之后没有提交。</Muted>
          ) : (
            rows.map((row, i) => (
              <div
                key={row.commit.hash}
                data-testid="rebase-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: space[2],
                  padding: `${space[1]}px ${space[2]}px`,
                  opacity: row.action === 'drop' ? 0.5 : 1,
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <Arrow label="▲" onClick={() => move(i, -1)} disabled={i === 0} />
                  <Arrow label="▼" onClick={() => move(i, 1)} disabled={i === rows.length - 1} />
                </span>
                <select
                  value={row.action}
                  onChange={(e) => {
                    const a = e.target.value as Action;
                    if (a === 'reword') reword(i);
                    else setAction(i, a);
                  }}
                  style={{
                    flexShrink: 0,
                    background: color.bg,
                    color: color.textPrimary,
                    border: `1px solid ${color.border}`,
                    borderRadius: radius.sm,
                    fontSize: font.size.micro,
                    padding: '2px 4px',
                  }}
                >
                  {(['pick', 'drop', 'fixup', 'reword'] as Action[]).map((a) => (
                    <option key={a} value={a}>
                      {ACTION_LABEL[a]}
                    </option>
                  ))}
                </select>
                <span
                  style={{
                    color: color.textGhost,
                    fontFamily: font.mono,
                    fontSize: font.size.micro,
                  }}
                >
                  {row.commit.shortHash}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: color.textSecondary,
                    fontSize: font.size.caption,
                    textDecoration: row.action === 'drop' ? 'line-through' : 'none',
                  }}
                >
                  {row.action === 'reword' && row.message ? row.message : row.commit.subject}
                </span>
              </div>
            ))
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: space[2],
            padding: `${space[3]}px ${space[4]}px`,
            borderTop: `1px solid ${color.divider}`,
          }}
        >
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || rows === null || kept === 0}
            onClick={apply}
          >
            应用（{kept} 个提交）
          </Button>
        </div>
      </div>
    </div>
  );
};

const Arrow = ({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      width: 16,
      height: 12,
      lineHeight: '10px',
      padding: 0,
      background: 'none',
      border: 'none',
      cursor: disabled ? 'default' : 'pointer',
      color: disabled ? color.textGhost : color.textTertiary,
      fontSize: 8,
    }}
  >
    {label}
  </button>
);

const Muted = ({ children }: { children: string }): JSX.Element => (
  <div style={{ padding: space[4], color: color.textTertiary, fontSize: font.size.caption }}>
    {children}
  </div>
);
