import type { GitStatusResult } from '@basehalf/core';
import {
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { color, font, radius, space, transition } from '../design.js';
import {
  type GitGroups,
  type GitRow,
  classifyStatus,
  statusColor,
  totalChangeCount,
} from '../lib/gitStatus.js';
import { useGitStatusStore } from '../store/gitStatus.js';
import { useScmViewStore } from '../store/scmView.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { BranchSelector } from './BranchSelector.js';
import { FileGlyph, badgeType } from './FileGlyph.js';
import { GitGraph } from './GitGraph.js';
import { Button } from './primitives/Button.js';
import { Disclosure } from './primitives/Disclosure.js';
import { Menu, type MenuAction } from './primitives/Menu.js';

/**
 * The Source Control panel — the git SCM view that replaces the file tree in the
 * sidebar when the activity-bar git icon is active. Reads `git.status` (parsed
 * into Staged / Changes / Merge groups), commits, and stages / unstages /
 * discards files. All git work goes through `@basehalf/core`'s `git.*` commands
 * over IPC; the disk file is the truth, this is a control surface over it.
 *
 * Refreshes on mount (the panel mounts when you switch to this view), after each
 * action, and via the manual refresh button. Click a row to open the file.
 */

const STATUS_PALETTE = {
  added: color.success,
  modified: color.warning,
  deleted: color.danger,
  conflict: color.danger,
  renamed: color.accent,
};

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Platform-correct commit shortcut for the placeholder (the handler accepts
// both ⌘/Ctrl, so the hint should name the right one rather than always "⌘").
// Uses the preload-injected platform, not the deprecated navigator.platform.
const COMMIT_KEY = window.bh.platform === 'darwin' ? '⌘Enter' : 'Ctrl+Enter';

/** A human status label for a row's aria-label (so a screen reader announces
 *  "name, 已修改, dir" instead of stopping at the filename). */
const rowStatusText = (row: GitRow): string => {
  if (row.conflict) return '合并冲突';
  if (row.untracked) return '未跟踪';
  const base =
    row.status === 'A'
      ? '已新增'
      : row.status === 'D'
        ? '已删除'
        : row.status === 'R'
          ? '已重命名'
          : row.status === 'C'
            ? '已复制'
            : '已修改';
  return row.staged ? `已暂存:${base}` : base;
};

/** Arrow-key navigation across the whole change list (one keyboard tree). */
const handleTreeKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-scm-row]'));
  if (items.length === 0) return;
  const active = document.activeElement;
  const idx = items.findIndex((el) => el === active || el.contains(active));
  if (idx === -1) {
    items[0]?.focus();
  } else {
    const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
    items[next]?.focus();
  }
  e.preventDefault();
};

export const SourceControl = (): JSX.Element => {
  const status = useGitStatusStore((s) => s.status);
  const refresh = useGitStatusStore((s) => s.refresh);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changesOpen = useScmViewStore((s) => s.changesOpen);
  const graphOpen = useScmViewStore((s) => s.graphOpen);
  const setChangesOpen = useScmViewStore((s) => s.setChangesOpen);
  const setGraphOpen = useScmViewStore((s) => s.setGraphOpen);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const openGitDiff = useWorkspaceStore((s) => s.openGitDiff);
  // Clicking a row opens its diff; an untracked file (no baseline) or a conflict
  // (resolution is its own surface) opens the file directly instead.
  const openRow = (r: GitRow): void => {
    if (r.untracked || r.conflict) openInPanel(r.path);
    else openGitDiff(r.path, r.staged);
  };

  // Fetch on mount (the global git-status sync also refreshes on file events;
  // this guarantees a fresh read the moment the panel opens).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Run a git action, surface failures, then re-read status from disk truth.
  const act = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(msg(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const groups = useMemo<GitGroups>(
    () => (status?.isRepo ? classifyStatus(status.files) : { merge: [], staged: [], changes: [] }),
    [status],
  );
  const hasStaged = groups.staged.length > 0;
  const [amend, setAmend] = useState(false);
  // Amend lets you re-commit HEAD with a new message / extra staged changes, so it
  // needs a message but NOT necessarily fresh staged changes; a normal commit needs
  // both a message and something staged.
  const canCommit = message.trim().length > 0 && !busy && (amend || hasStaged);

  // Toggling amend on prefills the commit box with HEAD's message (if empty), the
  // way an editor's "amend" does — you tweak it rather than retype it.
  const toggleAmend = useCallback(() => {
    setAmend((on) => {
      const next = !on;
      if (next && message.trim() === '') {
        void (async () => {
          try {
            const r = (await window.bh.run('git.log', { maxCount: 1 })) as {
              commits: { subject: string; body: string }[];
            };
            const head = r.commits[0];
            if (head)
              setMessage(head.body.trim() ? `${head.subject}\n\n${head.body}` : head.subject);
          } catch {
            // no HEAD yet (unborn) — just leave the box empty
          }
        })();
      }
      return next;
    });
  }, [message]);

  const stage = (paths: string[]): Promise<void> =>
    act(() => window.bh.run('git.stage', { paths }));
  const unstage = (paths: string[]): Promise<void> =>
    act(() => window.bh.run('git.unstage', { paths }));

  const discard = (row: GitRow): void => {
    // Accurate, action-specific wording: an untracked file goes to the OS Trash
    // (recoverable); a tracked discard is a hard revert to HEAD (not recoverable).
    // The old copy said "can't be undone" for BOTH — wrong for untracked.
    const message = row.untracked
      ? `Move “${row.path}” to the Trash?\n\nIt’s untracked — recoverable from the Trash.`
      : `Discard changes in “${row.path}”?\n\nThis reverts to the last commit and can’t be undone.`;
    if (!window.confirm(message)) return;
    void act(() => {
      if (!row.untracked) return window.bh.run('git.discard', { paths: [row.path] });
      // Untracked files/dirs aren't git's to restore — trash them. A dir arrives as
      // "dir/" (git collapses it); strip the slash + flag it a folder so its `.bh/`
      // mirror subtree gets purged too, not left dangling.
      const isDir = row.path.endsWith('/');
      return window.bh.run('workspace.deleteEntry', {
        path: isDir ? row.path.slice(0, -1) : row.path,
        kind: isDir ? 'folder' : 'file',
      });
    });
  };

  // Commit, optionally followed by push or sync (pull then push) — the VS Code
  // "Commit & Push" / "Commit & Sync" split-button actions.
  const commit = (after?: 'push' | 'sync'): void => {
    if (!canCommit) return;
    void act(async () => {
      await window.bh.run('git.commit', { message: message.trim(), amend });
      setMessage('');
      setAmend(false);
      if (after === 'push') await window.bh.run('git.push', {});
      else if (after === 'sync') {
        await window.bh.run('git.pull', {});
        await window.bh.run('git.push', {});
      }
    });
  };

  // Header git actions (push/pull/fetch/sync/stash) — each runs then re-reads
  // status from disk. Sync = pull then push (the everyday "stay in lockstep").
  const runAction = (name: string): void => void act(() => window.bh.run(name, {}));
  const createBranchPrompt = (): void => {
    const name = window.prompt('新分支名')?.trim();
    if (name) void act(() => window.bh.run('git.createBranch', { name }));
  };
  const onSync = (): void =>
    void act(async () => {
      await window.bh.run('git.pull', {});
      await window.bh.run('git.push', {});
    });
  const discardAll = (): void => {
    if (groups.changes.length === 0) return;
    if (!window.confirm(`放弃全部 ${groups.changes.length} 处未暂存改动？此操作不可撤销。`)) return;
    const tracked = groups.changes.filter((r) => !r.untracked).map((r) => r.path);
    void act(() =>
      tracked.length > 0 ? window.bh.run('git.discard', { paths: tracked }) : Promise.resolve(),
    );
  };

  if (status === null) {
    return <Centered>{error ?? '…'}</Centered>;
  }

  if (!status.isRepo) {
    return (
      <Centered>
        <div style={{ color: color.textSecondary, marginBottom: space[3], lineHeight: 1.5 }}>
          This folder isn’t a git repository yet.
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => void act(() => window.bh.run('git.init', {}))}
        >
          Initialize Repository
        </Button>
        {error !== null && <ErrorLine>{error}</ErrorLine>}
      </Centered>
    );
  }

  const count = totalChangeCount(groups);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <RepoHeader
        status={status}
        busy={busy}
        onSync={onSync}
        onAfterBranch={refresh}
        menuActions={[
          { label: '新建分支…', onClick: createBranchPrompt },
          { label: '拉取（Pull）', onClick: () => runAction('git.pull') },
          { label: '推送（Push）', onClick: () => runAction('git.push') },
          { label: '获取（Fetch）', onClick: () => runAction('git.fetch') },
          { label: '贮藏（Stash）', onClick: () => runAction('git.stash') },
          { label: '弹出贮藏（Pop Stash）', onClick: () => runAction('git.stashPop') },
          { label: '放弃全部改动', onClick: discardAll, danger: true },
          { label: '刷新', onClick: () => void refresh() },
        ]}
      />

      {error !== null && <ErrorLine onDismiss={() => setError(null)}>{error}</ErrorLine>}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} onKeyDown={handleTreeKeyDown}>
        <Disclosure
          title="更改"
          count={count}
          open={changesOpen}
          onToggle={() => setChangesOpen(!changesOpen)}
        >
          <ChangesView
            message={message}
            setMessage={setMessage}
            canCommit={canCommit}
            hasStaged={hasStaged}
            stagedCount={groups.staged.length}
            amend={amend}
            onToggleAmend={toggleAmend}
            commit={commit}
            count={count}
            groups={groups}
            busy={busy}
            openRow={openRow}
            stage={stage}
            unstage={unstage}
            discard={discard}
          />
        </Disclosure>

        <Disclosure title="图谱" open={graphOpen} onToggle={() => setGraphOpen(!graphOpen)}>
          {graphOpen && <GitGraph />}
        </Disclosure>
      </div>
    </div>
  );
};

// ── The Changes view (commit box + the three resource groups) ────────────────
const ChangesView = ({
  message,
  setMessage,
  canCommit,
  hasStaged,
  stagedCount,
  amend,
  onToggleAmend,
  commit,
  count,
  groups,
  busy,
  openRow,
  stage,
  unstage,
  discard,
}: {
  message: string;
  setMessage: (s: string) => void;
  canCommit: boolean;
  hasStaged: boolean;
  stagedCount: number;
  amend: boolean;
  onToggleAmend: () => void;
  commit: (after?: 'push' | 'sync') => void;
  count: number;
  groups: GitGroups;
  busy: boolean;
  openRow: (r: GitRow) => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (r: GitRow) => void;
}): JSX.Element => (
  <>
    {/* Commit message + button. */}
    <div style={{ padding: `${space[2]}px ${space[3]}px`, flexShrink: 0 }}>
      <textarea
        value={message}
        aria-label="Commit message"
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={hasStaged ? `Message (${COMMIT_KEY} to commit)` : 'Stage changes to commit'}
        rows={2}
        style={{
          width: '100%',
          resize: 'vertical',
          boxSizing: 'border-box',
          background: color.bg,
          border: `1px solid ${color.border}`,
          borderRadius: radius.md,
          color: color.textPrimary,
          fontFamily: font.sans,
          fontSize: font.size.caption,
          padding: `${space[2]}px ${space[3]}px`,
          outline: 'none',
        }}
      />
      <div style={{ display: 'flex', marginTop: space[2] }}>
        <button
          type="button"
          disabled={!canCommit}
          onClick={() => commit()}
          style={{
            flex: 1,
            minWidth: 0,
            padding: `${space[2]}px`,
            background: canCommit ? color.accent : color.surfaceMuted,
            color: canCommit ? color.onAccent : color.textGhost,
            border: 'none',
            borderRadius: `${radius.md}px 0 0 ${radius.md}px`,
            fontFamily: font.sans,
            fontSize: font.size.caption,
            fontWeight: font.weight.medium,
            cursor: canCommit ? 'pointer' : 'default',
          }}
        >
          {amend ? '✎ 修订上次提交' : `✓ Commit${hasStaged ? ` (${stagedCount})` : ''}`}
        </button>
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            background: canCommit ? color.accent : color.surfaceMuted,
            borderRadius: `0 ${radius.md}px ${radius.md}px 0`,
            borderLeft: `1px solid ${color.bg}`,
          }}
        >
          <Menu
            align="right"
            disabled={!canCommit}
            label={<span style={{ color: canCommit ? color.onAccent : color.textGhost }}>▾</span>}
            actions={[
              { label: 'Commit & Push（提交并推送）', onClick: () => commit('push') },
              { label: 'Commit & Sync（提交并同步）', onClick: () => commit('sync') },
            ]}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleAmend}
        aria-pressed={amend}
        style={{
          marginTop: space[1],
          width: '100%',
          padding: `${space[1]}px`,
          background: 'none',
          border: 'none',
          color: amend ? color.accent : color.textTertiary,
          fontFamily: font.sans,
          fontSize: font.size.micro,
          cursor: 'pointer',
          textAlign: 'center',
        }}
      >
        {amend ? '☑' : '☐'} 修订上次提交（amend）
      </button>
    </div>

    {/* The three resource groups (the outer panel owns the scroll + arrow-key host). */}
    <div>
      {count === 0 ? (
        <div style={{ padding: space[4], color: color.textTertiary, fontSize: font.size.caption }}>
          No changes — working tree clean.
        </div>
      ) : (
        <>
          <Group
            title="Merge Changes"
            rows={groups.merge}
            show={groups.merge.length > 0}
            busy={busy}
            onRow={openRow}
            actions={(r) => [{ label: 'Stage', glyph: '+', onClick: () => void stage([r.path]) }]}
          />
          <Group
            title="Staged Changes"
            rows={groups.staged}
            show={hasStaged}
            busy={busy}
            groupAction={{
              label: 'Unstage all',
              glyph: '−',
              onClick: () => void unstage(groups.staged.map((r) => r.path)),
            }}
            onRow={openRow}
            actions={(r) => [
              { label: 'Unstage', glyph: '−', onClick: () => void unstage([r.path]) },
            ]}
          />
          <Group
            title="Changes"
            rows={groups.changes}
            show={groups.changes.length > 0}
            busy={busy}
            groupAction={{
              label: 'Stage all',
              glyph: '+',
              onClick: () => void stage(groups.changes.map((r) => r.path)),
            }}
            onRow={openRow}
            actions={(r) => [
              { label: 'Discard', glyph: '↩', onClick: () => discard(r), danger: true },
              { label: 'Stage', glyph: '+', onClick: () => void stage([r.path]) },
            ]}
          />
        </>
      )}
    </div>
  </>
);

// ── Repo header: branch selector + Sync + overflow menu (VS Code repo row) ────
const RepoHeader = ({
  status,
  busy,
  onSync,
  onAfterBranch,
  menuActions,
}: {
  status: GitStatusResult;
  busy: boolean;
  onSync: () => void;
  onAfterBranch: () => void | Promise<void>;
  menuActions: MenuAction[];
}): JSX.Element => {
  // The Sync glyph carries the ahead/behind counts the way VS Code's status-bar
  // sync does: ↑ahead ↓behind, or a plain ↻ when in sync.
  const counts =
    status.ahead > 0 || status.behind > 0
      ? `${status.ahead > 0 ? `↑${status.ahead}` : ''}${status.behind > 0 ? `↓${status.behind}` : ''}`
      : '';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[1],
        padding: `${space[2]}px ${space[2]}px ${space[2]}px ${space[3]}px`,
        borderBottom: `1px solid ${color.divider}`,
        flexShrink: 0,
        fontFamily: font.sans,
        fontSize: font.size.caption,
        color: color.textSecondary,
        minWidth: 0,
      }}
    >
      <BranchSelector status={status} disabled={busy} onAfter={onAfterBranch} />
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <IconBtn
          title={counts !== '' ? `同步（${counts}）` : '同步（拉取并推送）'}
          onClick={onSync}
          disabled={busy}
          glyph="↻"
        />
        {counts !== '' && (
          <span
            style={{
              color: color.textTertiary,
              fontFamily: font.mono,
              fontSize: font.size.micro,
              marginRight: space[1],
            }}
          >
            {counts}
          </span>
        )}
        <Menu actions={menuActions} title="更多 Git 操作" align="right" disabled={busy} />
      </span>
    </div>
  );
};

// ── A resource group (Staged / Changes / Merge) ──────────────────────────────
interface RowAction {
  label: string;
  glyph: string;
  onClick: () => void;
  danger?: boolean;
}
const Group = ({
  title,
  rows,
  show,
  busy,
  onRow,
  actions,
  groupAction,
}: {
  title: string;
  rows: readonly GitRow[];
  show: boolean;
  busy: boolean;
  onRow: (r: GitRow) => void;
  actions: (r: GitRow) => RowAction[];
  groupAction?: RowAction;
}): JSX.Element | null => {
  if (!show) return null;
  return (
    <div role="group" aria-label={title}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          padding: `${space[1]}px ${space[3]}px`,
          fontSize: font.size.micro,
          fontWeight: font.weight.semibold,
          letterSpacing: font.trackedCaps,
          textTransform: 'uppercase',
          color: color.textTertiary,
          userSelect: 'none',
        }}
      >
        <span>{title}</span>
        <span style={{ color: color.textGhost }}>{rows.length}</span>
        {groupAction && (
          <span style={{ marginLeft: 'auto' }}>
            <IconBtn
              title={groupAction.label}
              glyph={groupAction.glyph}
              onClick={groupAction.onClick}
              disabled={busy}
            />
          </span>
        )}
      </div>
      {rows.map((r) => (
        <Row
          key={`${title}:${r.path}`}
          row={r}
          busy={busy}
          onOpen={() => onRow(r)}
          actions={actions(r)}
        />
      ))}
    </div>
  );
};

const Row = ({
  row,
  busy,
  onOpen,
  actions,
}: {
  row: GitRow;
  busy: boolean;
  onOpen: () => void;
  actions: RowAction[];
}): JSX.Element => {
  // `active` = hovered OR keyboard-focused, so the inline actions show for both.
  const [active, setActive] = useState(false);
  // Untracked DIRECTORIES come back as "dir/" (git collapses them with a trailing
  // slash) — strip it for the basename, then re-add so it still reads as a folder.
  const isDir = row.path.endsWith('/');
  const clean = isDir ? row.path.slice(0, -1) : row.path;
  const lastSlash = clean.lastIndexOf('/');
  const name = `${clean.slice(lastSlash + 1)}${isDir ? '/' : ''}`;
  const dir = lastSlash === -1 ? '' : clean.slice(0, lastSlash); // '' for a top-level file
  const ariaLabel = `${name}, ${rowStatusText(row)}${dir ? `, ${dir}` : ''}`;
  return (
    <div
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setActive(false);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[2],
        height: 24,
        padding: `0 ${space[3]}px`,
        background: active ? color.divider : 'transparent',
        fontFamily: font.sans,
        fontSize: font.size.caption,
      }}
    >
      {/* The name is a real button: focusable + Enter-activatable natively, and it
          carries the row's full aria-label so a screen reader announces the status,
          not just the filename. Actions are siblings (a button can't nest buttons). */}
      <button
        type="button"
        data-scm-row
        aria-label={ariaLabel}
        onClick={onOpen}
        title={row.path}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          color: color.textPrimary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(row.status === 'D' && { textDecoration: 'line-through' }),
        }}
      >
        <span style={{ flexShrink: 0, display: 'inline-flex', marginRight: space[2] }}>
          <FileGlyph
            type={badgeType(clean, isDir)}
            tone={row.untracked ? color.textTertiary : statusColor(row, STATUS_PALETTE)}
            size={14}
          />
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
      </button>
      {/* Inline actions stay in the DOM (so they're keyboard-reachable); only their
          visibility + tab-stops toggle with hover/focus. */}
      <span
        style={{
          display: 'flex',
          gap: space[1],
          opacity: active ? 1 : 0,
          transition: transition(['opacity']),
        }}
      >
        {actions.map((a) => (
          <IconBtn
            key={a.label}
            title={a.label}
            glyph={a.glyph}
            onClick={a.onClick}
            danger={a.danger}
            disabled={busy}
            tabIndex={active ? 0 : -1}
          />
        ))}
      </span>
      <span
        aria-hidden
        style={{
          width: 14,
          textAlign: 'center',
          fontFamily: font.mono,
          fontWeight: font.weight.semibold,
          color: statusColor(row, STATUS_PALETTE),
        }}
      >
        {row.status}
      </span>
    </div>
  );
};

const IconBtn = ({
  glyph,
  title,
  onClick,
  disabled,
  danger,
  tabIndex,
}: {
  glyph: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  tabIndex?: number;
}): JSX.Element => (
  <button
    type="button"
    title={title}
    aria-label={title}
    disabled={disabled}
    tabIndex={tabIndex}
    onClick={(e) => {
      e.stopPropagation(); // don't let a row-action click also open the row's diff
      onClick();
    }}
    style={{
      width: 20,
      height: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'none',
      border: 'none',
      borderRadius: radius.sm,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      color: danger ? color.danger : color.textTertiary,
      fontFamily: font.mono,
      fontSize: font.size.body,
      lineHeight: 1,
      transition: transition(['background', 'color']),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = color.divider;
      e.currentTarget.style.color = danger ? color.danger : color.textPrimary;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'none';
      e.currentTarget.style.color = danger ? color.danger : color.textTertiary;
    }}
  >
    {glyph}
  </button>
);

const Centered = ({ children }: { children: ReactNode }): JSX.Element => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: space[5],
      textAlign: 'center',
      fontFamily: font.sans,
      fontSize: font.size.caption,
      color: color.textTertiary,
    }}
  >
    {children}
  </div>
);

const ErrorLine = ({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss?: () => void;
}): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: space[2],
      padding: `${space[2]}px ${space[3]}px`,
      background: `${color.danger}14`,
      color: color.danger,
      fontFamily: font.sans,
      fontSize: font.size.caption,
      flexShrink: 0,
      wordBreak: 'break-word',
    }}
  >
    <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    {onDismiss !== undefined && (
      <button
        type="button"
        title="关闭"
        aria-label="关闭错误提示"
        onClick={onDismiss}
        style={{
          flexShrink: 0,
          background: 'none',
          border: 'none',
          color: color.danger,
          cursor: 'pointer',
          padding: 0,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    )}
  </div>
);
