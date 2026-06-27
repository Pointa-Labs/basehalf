import type {
  GitBranchInfo,
  GitBranchesResult,
  GitMergeResult,
  GitStatusResult,
} from '@basehalf/core';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { color, font, radius, space, transition } from '../design.js';
import { prompt } from './Dialog.js';
import { PopoverSurface, usePopover } from './primitives/Popover.js';

/**
 * BranchSelector — the SCM header's branch indicator + dropdown, modeled on
 * VS Code's branch quick-pick. The trigger shows the current branch; the popover
 * lists local branches (filter as you type, click to switch), creates a new
 * branch (inline), merges a branch into the current one, and deletes a branch.
 *
 * All git work goes through `@basehalf/core`'s `git.*` commands over IPC. After a
 * mutation that changes HEAD or the work tree we call `onAfter` so the panel
 * re-reads `git.status` from disk truth; the branch list reloads on open and
 * after create/delete.
 */

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface BranchSelectorProps {
  readonly status: GitStatusResult;
  readonly disabled: boolean;
  /** Re-read git.status after a switch / merge / create (HEAD or tree changed). */
  readonly onAfter: () => void | Promise<void>;
}

export const BranchSelector = ({ status, disabled, onAfter }: BranchSelectorProps): JSX.Element => {
  const pop = usePopover({ align: 'left', gap: 4 });
  const { open, close } = pop;
  const [branches, setBranches] = useState<readonly GitBranchInfo[] | null>(null);
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'switch' | 'merge'>('switch');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);

  const label = status.detached ? 'detached' : (status.branch ?? '—');

  const loadBranches = useCallback(async (): Promise<void> => {
    try {
      const r = (await window.bh.run('git.branches', {
        includeRemote: true,
      })) as GitBranchesResult;
      setBranches(r.branches);
    } catch (err) {
      setNote(msg(err));
    }
  }, []);

  // (Re)load the branch list each time the popover opens; reset transient UI.
  useEffect(() => {
    if (!open) return;
    setFilter('');
    setMode('switch');
    setCreating(false);
    setNewName('');
    setNote(null);
    void loadBranches();
    // focus the filter once the panel has painted
    const id = window.setTimeout(() => filterRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open, loadBranches]);

  // Run a mutation, surface failures inline, refresh, and (optionally) close.
  const run = useCallback(
    async (fn: () => Promise<unknown>, opts: { closeAfter?: boolean } = {}): Promise<void> => {
      setWorking(true);
      setNote(null);
      try {
        await fn();
        await onAfter();
        if (opts.closeAfter !== false) close();
      } catch (err) {
        setNote(msg(err));
      } finally {
        setWorking(false);
      }
    },
    [onAfter, close],
  );

  const switchTo = (name: string): void =>
    void run(() => window.bh.run('git.checkout', { branch: name }));

  // Picking a remote-tracking branch (origin/feat) checks out its short name,
  // letting git DWIM-create a local tracking branch.
  const pick = (b: GitBranchInfo): void => {
    if (mode === 'merge') {
      mergeFrom(b.name);
      return;
    }
    if (b.remote) {
      const short = b.name.slice(b.name.indexOf('/') + 1);
      void run(() => window.bh.run('git.checkout', { branch: short }));
    } else {
      switchTo(b.name);
    }
  };

  const mergeFrom = (name: string): void =>
    void run(
      async () => {
        const r = (await window.bh.run('git.merge', { branch: name })) as GitMergeResult;
        if (r.conflicts) {
          // Don't close — tell the user to resolve in the Merge Changes group.
          throw new Error(`合并 “${name}” 产生冲突，请在「合并更改」中解决后提交。`);
        }
      },
      { closeAfter: true },
    );

  const deleteBranch = (name: string): void => {
    if (!window.confirm(`删除分支 “${name}”？`)) return;
    void run(
      async () => {
        try {
          await window.bh.run('git.deleteBranch', { name });
        } catch {
          // Not fully merged → git refuses -d. Offer the force path.
          if (!window.confirm(`分支 “${name}” 尚未合并。强制删除？`)) return;
          await window.bh.run('git.deleteBranch', { name, force: true });
        }
        await loadBranches();
      },
      { closeAfter: false },
    );
  };

  const createBranch = (): void => {
    const name = newName.trim();
    if (name === '') return;
    void run(() => window.bh.run('git.createBranch', { name }));
  };

  const renameCurrent = (): void =>
    void (async () => {
      // Electron has no window.prompt — use the app's custom prompt dialog.
      const to = (
        await prompt({ title: '重命名当前分支', label: '新名称', defaultValue: label })
      )?.trim();
      if (to && to !== label) void run(() => window.bh.run('git.renameBranch', { to }));
    })();

  const filtered = (branches ?? []).filter((b) =>
    b.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <>
      <button
        ref={pop.triggerRef}
        type="button"
        onClick={pop.toggle}
        disabled={disabled}
        title={status.upstream ?? '切换分支'}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          minWidth: 0,
          maxWidth: '100%',
          padding: `2px ${space[2]}px`,
          margin: `-2px -${space[1]}px`,
          background: open ? color.divider : 'none',
          border: 'none',
          borderRadius: radius.sm,
          color: color.textSecondary,
          fontFamily: font.sans,
          fontSize: font.size.caption,
          cursor: disabled ? 'default' : 'pointer',
          transition: transition(['background']),
        }}
      >
        <BranchGlyph />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {label}
        </span>
        <span aria-hidden style={{ color: color.textGhost, fontSize: font.size.micro }}>
          ▾
        </span>
      </button>

      {open && (
        <PopoverSurface
          coords={pop.coords}
          floatingRef={pop.floatingRef}
          role="listbox"
          style={{ minWidth: 240, maxWidth: 360, padding: 0, overflow: 'hidden' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 360 }}>
            <div style={{ padding: space[2], borderBottom: `1px solid ${color.divider}` }}>
              {mode === 'merge' && (
                <div
                  style={{
                    fontSize: font.size.micro,
                    color: color.textTertiary,
                    marginBottom: space[1],
                    paddingLeft: space[1],
                  }}
                >
                  选择要合并到 “{label}” 的分支
                </div>
              )}
              <input
                ref={filterRef}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={mode === 'merge' ? '合并分支…' : '切换 / 筛选分支…'}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: color.bg,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.sm,
                  color: color.textPrimary,
                  fontFamily: font.sans,
                  fontSize: font.size.caption,
                  padding: `${space[1]}px ${space[2]}px`,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ overflowY: 'auto', padding: space[1] }}>
              {branches === null ? (
                <Hint>载入分支…</Hint>
              ) : filtered.length === 0 ? (
                <Hint>无匹配分支</Hint>
              ) : (
                filtered.map((b) => (
                  <BranchRow
                    key={b.name}
                    branch={b}
                    mode={mode}
                    disabled={working}
                    onPick={() => pick(b)}
                    onDelete={() => deleteBranch(b.name)}
                  />
                ))
              )}
            </div>

            {creating ? (
              <div
                style={{
                  display: 'flex',
                  gap: space[1],
                  padding: space[2],
                  borderTop: `1px solid ${color.divider}`,
                }}
              >
                <input
                  // biome-ignore lint/a11y/noAutofocus: focusing the new field is the intent of clicking "新建分支".
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createBranch();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setCreating(false);
                    }
                  }}
                  placeholder="新分支名"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    boxSizing: 'border-box',
                    background: color.bg,
                    border: `1px solid ${color.border}`,
                    borderRadius: radius.sm,
                    color: color.textPrimary,
                    fontFamily: font.sans,
                    fontSize: font.size.caption,
                    padding: `${space[1]}px ${space[2]}px`,
                    outline: 'none',
                  }}
                />
                <FooterBtn onClick={createBranch} disabled={working || newName.trim() === ''}>
                  创建
                </FooterBtn>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: space[1],
                  padding: space[1],
                  borderTop: `1px solid ${color.divider}`,
                }}
              >
                <FooterBtn onClick={() => setCreating(true)} disabled={working}>
                  + 新建分支
                </FooterBtn>
                <FooterBtn
                  onClick={() => setMode((m) => (m === 'merge' ? 'switch' : 'merge'))}
                  disabled={working}
                  active={mode === 'merge'}
                >
                  ⤵ 合并到当前
                </FooterBtn>
                {!status.detached && status.branch !== null && (
                  <FooterBtn onClick={renameCurrent} disabled={working}>
                    ✎ 重命名
                  </FooterBtn>
                )}
              </div>
            )}

            {note !== null && (
              <div
                style={{
                  padding: `${space[1]}px ${space[2]}px`,
                  color: color.danger,
                  fontFamily: font.sans,
                  fontSize: font.size.micro,
                  borderTop: `1px solid ${color.divider}`,
                  wordBreak: 'break-word',
                }}
              >
                {note}
              </div>
            )}
          </div>
        </PopoverSurface>
      )}
    </>
  );
};

const BranchRow = ({
  branch,
  mode,
  disabled,
  onPick,
  onDelete,
}: {
  branch: GitBranchInfo;
  mode: 'switch' | 'merge';
  disabled: boolean;
  onPick: () => void;
  onDelete: () => void;
}): JSX.Element => {
  const [hover, setHover] = useState(false);
  // Can't delete the current branch or a remote-tracking ref; in merge mode the
  // current branch is the target.
  const deletable = !branch.current && branch.remote !== true && mode === 'switch';
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[2],
        borderRadius: radius.sm,
        background: hover ? color.divider : 'transparent',
      }}
    >
      <button
        type="button"
        role="option"
        aria-selected={branch.current}
        disabled={disabled || (mode === 'merge' && branch.current)}
        onClick={onPick}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          background: 'none',
          border: 'none',
          padding: `${space[1]}px ${space[2]}px`,
          cursor: disabled || (mode === 'merge' && branch.current) ? 'default' : 'pointer',
          textAlign: 'left',
          color: branch.current ? color.textPrimary : color.textSecondary,
          fontFamily: font.sans,
          fontSize: font.size.caption,
          opacity: mode === 'merge' && branch.current ? 0.4 : 1,
        }}
      >
        <span style={{ width: 12, color: color.accent, fontFamily: font.mono }}>
          {branch.current ? '✓' : ''}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {branch.name}
        </span>
        {branch.remote === true && (
          <span style={{ marginLeft: 'auto', color: color.textGhost, fontSize: font.size.micro }}>
            远程
          </span>
        )}
      </button>
      {deletable && hover && (
        <button
          type="button"
          title={`删除 ${branch.name}`}
          aria-label={`删除分支 ${branch.name}`}
          disabled={disabled}
          onClick={onDelete}
          style={{
            width: 22,
            height: 22,
            marginRight: space[1],
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            borderRadius: radius.sm,
            color: color.textTertiary,
            cursor: 'pointer',
            fontFamily: font.mono,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = color.danger;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = color.textTertiary;
          }}
        >
          🗑
        </button>
      )}
    </div>
  );
};

const FooterBtn = ({
  onClick,
  disabled,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}): JSX.Element => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    style={{
      flex: 1,
      padding: `${space[1]}px ${space[2]}px`,
      background: active ? color.divider : 'none',
      border: 'none',
      borderRadius: radius.sm,
      color: disabled ? color.textGhost : color.textSecondary,
      fontFamily: font.sans,
      fontSize: font.size.caption,
      cursor: disabled ? 'default' : 'pointer',
      whiteSpace: 'nowrap',
      transition: transition(['background', 'color']),
    }}
    onMouseEnter={(e) => {
      if (!disabled) e.currentTarget.style.background = color.divider;
    }}
    onMouseLeave={(e) => {
      if (!active) e.currentTarget.style.background = 'none';
    }}
  >
    {children}
  </button>
);

const Hint = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <div
    style={{
      padding: `${space[2]}px ${space[3]}px`,
      color: color.textTertiary,
      fontFamily: font.sans,
      fontSize: font.size.caption,
    }}
  >
    {children}
  </div>
);

const BranchGlyph = (): JSX.Element => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.3}
    aria-hidden
    style={{ flexShrink: 0 }}
  >
    <circle cx={4} cy={3.5} r={1.8} />
    <circle cx={4} cy={12.5} r={1.8} />
    <circle cx={12} cy={3.5} r={1.8} />
    <path d="M4 5.3v5.4M12 5.3c0 3-2.5 3.2-5 3.7" strokeLinecap="round" />
  </svg>
);
