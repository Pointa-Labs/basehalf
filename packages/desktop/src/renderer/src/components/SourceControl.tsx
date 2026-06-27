import type { GitStashEntry, GitStatusResult } from '@basehalf/core';
import {
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { color, font, space, transition } from '../design.js';
import {
  type GitGroups,
  type GitRow,
  classifyStatus,
  statusColor,
  totalChangeCount,
} from '../lib/gitStatus.js';
import { createPrUrl } from '../lib/prUrl.js';
import { useGitStatusStore } from '../store/gitStatus.js';
import { useScmViewStore } from '../store/scmView.js';
import { toast } from '../store/toast.js';
import { useWorkspaceStore } from '../store/workspace.js';
import { BranchSelector } from './BranchSelector.js';
import { Codicon } from './Codicon.js';
import { prompt } from './Dialog.js';
import { FileGlyph, badgeType } from './FileGlyph.js';
import { GitGraph } from './GitGraph.js';
import { PullRequests } from './PullRequests.js';
import { Button } from './primitives/Button.js';
import { CountBadge } from './primitives/CountBadge.js';
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
  // VS Code gitDecoration.* defaults from the Git extension.
  added: '#73c991',
  modified: '#e2c08d',
  deleted: '#c74e39',
  conflict: '#e4676b',
  renamed: '#73c991',
};

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const scm = {
  panelBg: '#181818',
  inputBg: '#313131',
  inputBorder: '#3c3c3c',
  inputPlaceholder: '#989898',
  hoverBg: '#2a2d2e',
  buttonHoverBg: '#2b2b2b',
  disabledFg: '#858585',
  editorRadius: 4,
  rowHeight: 22,
  iconButtonSize: 22,
} as const;

// Platform-correct commit shortcut for the placeholder (the handler accepts
// both ⌘/Ctrl, so the hint should name the right one rather than always "⌘").
// Uses the preload-injected platform, not the deprecated navigator.platform.
const COMMIT_KEY = window.bh.platform === 'darwin' ? '⌘Enter' : 'Ctrl+Enter';

/** A human status label for a row's aria-label (so a screen reader announces
 *  "name, Modified, dir" instead of stopping at the filename). */
const rowStatusText = (row: GitRow): string => {
  if (row.conflict) return 'Conflict';
  if (row.untracked) return 'Untracked';
  const base =
    row.status === 'A'
      ? 'Added'
      : row.status === 'D'
        ? 'Deleted'
        : row.status === 'R'
          ? 'Renamed'
          : row.status === 'C'
            ? 'Copied'
            : 'Modified';
  return row.staged ? `Staged: ${base}` : base;
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
  const graphOpen = useScmViewStore((s) => s.graphOpen);
  const setGraphOpen = useScmViewStore((s) => s.setGraphOpen);
  const [stashes, setStashes] = useState<readonly GitStashEntry[]>([]);
  const [stashesOpen, setStashesOpen] = useState(true);
  const loadStashes = useCallback(async (): Promise<void> => {
    try {
      const r = (await window.bh.run('git.stashList', {})) as { entries: GitStashEntry[] };
      setStashes(r.entries);
    } catch {
      setStashes([]);
    }
  }, []);
  const openInPanel = useWorkspaceStore((s) => s.openInPanel);
  const openGitDiff = useWorkspaceStore((s) => s.openGitDiff);
  const openMerge = useWorkspaceStore((s) => s.openMerge);
  // Clicking a row: a conflict opens the 3-way merge editor (VS Code), an untracked
  // file (no baseline) opens directly, everything else opens its diff.
  const openRow = (r: GitRow): void => {
    if (r.conflict) openMerge(r.path);
    else if (r.untracked) openInPanel(r.path);
    else openGitDiff(r.path, r.staged);
  };

  // Fetch on mount (the global git-status sync also refreshes on file events;
  // this guarantees a fresh read the moment the panel opens).
  useEffect(() => {
    void refresh();
    void loadStashes();
  }, [refresh, loadStashes]);

  // Run a git action, surface failures as a transient toast (VS Code-style), then
  // re-read status from disk truth. `setError` is kept only for the init/no-repo
  // screen below; everyday action errors are toasts, not permanent panel chrome.
  const act = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      try {
        await fn();
        await refresh();
        await loadStashes();
      } catch (err) {
        const m = msg(err);
        setError(m);
        toast.error(m);
      } finally {
        setBusy(false);
      }
    },
    [refresh, loadStashes],
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
  const createBranchPrompt = (): void =>
    void (async () => {
      // Electron has no window.prompt — use the app's custom prompt dialog.
      const name = (
        await prompt({ title: 'Create Branch', label: 'Branch name', placeholder: 'feature/x' })
      )?.trim();
      if (name) void act(() => window.bh.run('git.createBranch', { name }));
    })();
  // Open the hosting platform's "create PR" page for the current branch in the
  // browser — no auth/API, just a URL derived from the remote (the decision-free
  // slice of remote integration).
  const createPullRequest = (): void =>
    void (async () => {
      const branch = status?.branch;
      if (!branch) {
        toast.error('A current branch is required to create a pull request.');
        return;
      }
      try {
        const { url } = (await window.bh.run('git.remoteUrl', {})) as { url: string | null };
        if (url === null) {
          toast.error('No remote (origin) is configured.');
          return;
        }
        const pr = createPrUrl(url, branch);
        if (pr === null) {
          toast.error('Could not derive a pull request URL from the remote.');
          return;
        }
        const res = await window.bh.openExternal(pr);
        if (!res.ok) toast.error(res.error ?? 'Failed to open the browser.');
      } catch (e) {
        toast.error(msg(e));
      }
    })();
  // GRAPH header "Go to Current History Item" (VS Code) — reveal HEAD in the graph.
  const revealHead = (): void =>
    void (async () => {
      try {
        const r = (await window.bh.run('git.log', { maxCount: 1 })) as {
          commits: { hash: string }[];
        };
        const h = r.commits[0]?.hash;
        if (h !== undefined) useScmViewStore.getState().revealCommit(h);
      } catch {
        /* no HEAD yet */
      }
    })();
  const onSync = (): void =>
    void act(async () => {
      await window.bh.run('git.pull', {});
      await window.bh.run('git.push', {});
    });
  const discardAll = (): void => {
    if (groups.changes.length === 0) return;
    if (
      !window.confirm(
        `Discard all ${groups.changes.length} unstaged change(s)? This is IRREVERSIBLE.`,
      )
    )
      return;
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
          { label: 'Create Branch…', onClick: createBranchPrompt },
          { label: 'Pull', onClick: () => runAction('git.pull') },
          {
            label: 'Pull (Rebase)',
            onClick: () => void act(() => window.bh.run('git.pull', { rebase: true })),
          },
          { label: 'Push', onClick: () => runAction('git.push') },
          {
            label: 'Push (Force)',
            onClick: () => void act(() => window.bh.run('git.push', { force: true })),
          },
          { label: 'Fetch', onClick: () => runAction('git.fetch') },
          { label: 'Create Pull Request…', onClick: createPullRequest },
          {
            label: 'Undo Last Commit',
            onClick: () =>
              void act(() => window.bh.run('git.reset', { ref: 'HEAD~1', mode: 'soft' })),
          },
          { label: 'Stash', onClick: () => runAction('git.stash') },
          { label: 'Pop Stash', onClick: () => runAction('git.stashPop') },
          { label: 'Discard All Changes', onClick: discardAll, danger: true },
          { label: 'Refresh', onClick: () => void refresh() },
        ]}
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} onKeyDown={handleTreeKeyDown}>
        {/* Commit box (always visible, VS Code-style) + the resource groups — the
            groups carry the Changes / Staged Changes / Merge Changes headers, so there is no
            extra wrapping Changes disclosure on top of them. */}
        <ChangesView
          message={message}
          setMessage={setMessage}
          canCommit={canCommit}
          hasStaged={hasStaged}
          commitBranch={status.detached ? 'detached' : (status.branch ?? '')}
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

        {stashes.length > 0 && (
          <Disclosure
            title="Stashes"
            count={stashes.length}
            open={stashesOpen}
            onToggle={() => setStashesOpen(!stashesOpen)}
          >
            {stashes.map((s) => (
              <StashRow
                key={s.ref}
                entry={s}
                busy={busy}
                onApply={() => void act(() => window.bh.run('git.stashApply', { ref: s.ref }))}
                onPop={() => void act(() => window.bh.run('git.stashPop', { ref: s.ref }))}
                onDrop={() => {
                  if (window.confirm(`Delete stash ${s.ref}? This is IRREVERSIBLE.`))
                    void act(() => window.bh.run('git.stashDrop', { ref: s.ref }));
                }}
              />
            ))}
          </Disclosure>
        )}

        <Disclosure
          title="Graph"
          open={graphOpen}
          onToggle={() => setGraphOpen(!graphOpen)}
          actions={
            <>
              {/* VS Code's history-view header: ref filter + Go-to-current + the
                  provider's fetch/pull/push/sync. */}
              <span
                title="Branch Filter"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  height: scm.rowHeight,
                  padding: `0 ${space[1]}px`,
                  color: color.textTertiary,
                  fontSize: font.size.ui,
                }}
              >
                <Codicon name="git-branch" size={16} />
                Auto
              </span>
              <IconBtn
                title="Open Git Graph"
                onClick={() => useWorkspaceStore.getState().openGitGraph()}
                disabled={busy}
                glyph="screen-full"
              />
              <IconBtn
                title="Go to Current History Item"
                onClick={revealHead}
                disabled={busy}
                glyph="target"
              />
              <IconBtn
                title="Fetch"
                onClick={() => runAction('git.fetch')}
                disabled={busy}
                glyph="cloud-download"
              />
              <IconBtn
                title="Pull"
                onClick={() => runAction('git.pull')}
                disabled={busy}
                glyph="arrow-down"
              />
              <IconBtn
                title="Push"
                onClick={() => runAction('git.push')}
                disabled={busy}
                glyph="arrow-up"
              />
              <IconBtn title="Sync Changes" onClick={onSync} disabled={busy} glyph="sync" />
            </>
          }
        >
          {graphOpen && <GitGraph />}
        </Disclosure>

        {/* GitHub Pull Requests — renders only for a github.com repo. */}
        <PullRequests />
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
  commitBranch,
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
  commitBranch: string;
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
      {/* The input + its action bar (VS Code's .scm-editor-toolbar, top-right). */}
      <div style={{ position: 'relative' }}>
        <textarea
          className="bh-scm-commit-input"
          value={message}
          aria-label="Commit message"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={
            commitBranch !== ''
              ? `Message (${COMMIT_KEY} to commit on “${commitBranch}”)`
              : `Message (${COMMIT_KEY} to commit)`
          }
          rows={2}
          style={{
            width: '100%',
            minHeight: 72,
            resize: 'vertical',
            boxSizing: 'border-box',
            background: scm.inputBg,
            border: `1px solid ${scm.inputBorder}`,
            borderRadius: scm.editorRadius,
            color: color.textPrimary,
            fontFamily: font.sans,
            fontSize: font.size.ui,
            lineHeight: '20px',
            padding: `${space[2]}px ${space[3]}px`,
            paddingRight: 28,
            outline: 'none',
          }}
        />
        <button
          type="button"
          title="Generate Commit Message (AI)"
          aria-label="Generate commit message"
          onClick={() => toast.info('AI commit messages are not wired up yet.')}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: scm.iconButtonSize,
            height: scm.iconButtonSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            borderRadius: 3,
            color: scm.inputPlaceholder,
            cursor: 'pointer',
            fontSize: font.size.body,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = scm.buttonHoverBg;
            e.currentTarget.style.color = color.textPrimary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.color = scm.inputPlaceholder;
          }}
        >
          <Codicon name="sparkle" size={16} />
        </button>
      </div>
      <div style={{ display: 'flex', marginTop: space[2], height: 32 }}>
        <button
          type="button"
          disabled={!canCommit}
          onClick={() => commit()}
          style={{
            flex: 1,
            minWidth: 0,
            padding: `0 ${space[2]}px`,
            background: canCommit ? color.accent : 'transparent',
            color: canCommit ? color.onAccent : scm.disabledFg,
            border: `1px solid ${canCommit ? '#ffffff1a' : 'transparent'}`,
            borderRight: 'none',
            borderRadius: `${scm.editorRadius}px 0 0 ${scm.editorRadius}px`,
            fontFamily: font.sans,
            fontSize: font.size.ui,
            fontWeight: font.weight.medium,
            cursor: canCommit ? 'pointer' : 'default',
            lineHeight: '30px',
          }}
        >
          <Codicon name={amend ? 'edit' : 'check'} size={14} style={{ marginRight: 6 }} />
          {amend ? 'Amend' : `Commit${hasStaged ? ` (${stagedCount})` : ''}`}
        </button>
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            background: canCommit ? color.accent : 'transparent',
            border: `1px solid ${canCommit ? '#ffffff1a' : 'transparent'}`,
            borderRadius: `0 ${scm.editorRadius}px ${scm.editorRadius}px 0`,
            borderLeft: `1px solid ${canCommit ? '#ffffff33' : color.divider}`,
          }}
        >
          <Menu
            align="right"
            disabled={!canCommit}
            label={
              <Codicon
                name="chevron-down"
                size={14}
                color={canCommit ? color.onAccent : color.textGhost}
              />
            }
            actions={[
              { label: 'Commit & Push', onClick: () => commit('push') },
              { label: 'Commit & Sync', onClick: () => commit('sync') },
            ]}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleAmend}
        aria-pressed={amend}
        style={{
          marginTop: space[1.5],
          width: '100%',
          height: 24,
          padding: 0,
          background: 'none',
          border: 'none',
          color: amend ? color.accent : color.textTertiary,
          fontFamily: font.sans,
          fontSize: font.size.ui,
          cursor: 'pointer',
          textAlign: 'center',
        }}
      >
        <Codicon
          name={amend ? 'check' : 'circle-large-outline'}
          size={16}
          style={{ marginRight: 4, verticalAlign: -2 }}
        />
        Amend Last Commit
      </button>
    </div>

    {/* The three resource groups (the outer panel owns the scroll + arrow-key host). */}
    <div>
      {count === 0 ? (
        <div style={{ padding: space[4], color: color.textTertiary, fontSize: font.size.caption }}>
          There are no changes.
        </div>
      ) : (
        <>
          <Group
            title="Merge Changes"
            rows={groups.merge}
            show={groups.merge.length > 0}
            busy={busy}
            onRow={openRow}
            actions={(r) => [
              { label: 'Stage Changes', glyph: 'add', onClick: () => void stage([r.path]) },
            ]}
          />
          <Group
            title="Staged Changes"
            rows={groups.staged}
            show={hasStaged}
            busy={busy}
            groupAction={{
              label: 'Unstage All Changes',
              glyph: 'remove',
              onClick: () => void unstage(groups.staged.map((r) => r.path)),
            }}
            onRow={openRow}
            actions={(r) => [
              { label: 'Unstage Changes', glyph: 'remove', onClick: () => void unstage([r.path]) },
            ]}
          />
          <Group
            title="Changes"
            rows={groups.changes}
            show={groups.changes.length > 0}
            busy={busy}
            groupAction={{
              label: 'Stage All Changes',
              glyph: 'add',
              onClick: () => void stage(groups.changes.map((r) => r.path)),
            }}
            onRow={openRow}
            actions={(r) => [
              {
                label: 'Discard Changes',
                glyph: 'discard',
                onClick: () => discard(r),
                danger: true,
              },
              { label: 'Stage Changes', glyph: 'add', onClick: () => void stage([r.path]) },
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
        height: 35,
        padding: `0 ${space[2]}px 0 ${space[3]}px`,
        background: scm.panelBg,
        borderBottom: `1px solid ${color.divider}`,
        flexShrink: 0,
        fontFamily: font.sans,
        fontSize: font.size.ui,
        color: color.textSecondary,
        minWidth: 0,
      }}
    >
      <BranchSelector status={status} disabled={busy} onAfter={onAfterBranch} />
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <IconBtn
          title={counts !== '' ? `Sync Changes ${counts}` : 'Sync Changes (Pull, Push)'}
          onClick={onSync}
          disabled={busy}
          glyph="sync"
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
        <Menu actions={menuActions} title="More Actions…" align="right" disabled={busy} />
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
          // VS Code resource-group header: a 22px list row, label + count
          // (margin-left 6px), actions pushed right. Not uppercase.
          display: 'flex',
          alignItems: 'center',
          height: scm.rowHeight,
          padding: `0 ${space[2]}px`,
          fontSize: font.size.ui,
          fontWeight: font.weight.semibold,
          color: color.textSecondary,
          userSelect: 'none',
        }}
      >
        <span>{title}</span>
        <span style={{ marginLeft: 6, display: 'flex' }}>
          <CountBadge count={rows.length} />
        </span>
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
        // VS Code SCM list rows are line-height: 22px (scm.css .monaco-list-row).
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        height: scm.rowHeight,
        padding: `0 ${space[2]}px 0 ${space[3]}px`,
        background: active ? scm.hoverBg : 'transparent',
        fontFamily: font.sans,
        fontSize: font.size.ui,
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
          fontFamily: font.sans,
          fontSize: font.size.ui,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(row.status === 'D' && { textDecoration: 'line-through' }),
        }}
      >
        <span
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            width: 22,
            justifyContent: 'center',
            marginRight: 4,
          }}
        >
          <FileGlyph type={badgeType(clean, isDir)} tone={color.textSecondary} size={16} />
        </span>
        <span
          style={{
            flexShrink: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        {/* VS Code's resource `.description`: the dimmed parent directory, after
            the name, so two files with the same basename are distinguishable. */}
        {dir !== '' && (
          <span
            style={{
              marginLeft: space[2],
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: color.textGhost,
              fontSize: font.size.caption,
            }}
          >
            {dir}
          </span>
        )}
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
      {/* VS Code's resource `.decoration-icon`: 16px, margin-left 5px, on the right. */}
      <span
        aria-hidden
        style={{
          width: 16,
          marginLeft: 5,
          textAlign: 'center',
          fontFamily: font.sans,
          fontSize: font.size.ui,
          fontWeight: font.weight.semibold,
          color: statusColor(row, STATUS_PALETTE),
        }}
      >
        {row.status}
      </span>
    </div>
  );
};

// ── A stash entry row (apply / pop / drop on hover) ──────────────────────────
const StashRow = ({
  entry,
  busy,
  onApply,
  onPop,
  onDrop,
}: {
  entry: GitStashEntry;
  busy: boolean;
  onApply: () => void;
  onPop: () => void;
  onDrop: () => void;
}): JSX.Element => {
  const [active, setActive] = useState(false);
  return (
    <div
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      style={{
        // VS Code SCM list rows are line-height: 22px (scm.css .monaco-list-row).
        display: 'flex',
        alignItems: 'center',
        gap: space[2],
        height: scm.rowHeight,
        padding: `0 ${space[2]}px 0 ${space[3]}px`,
        background: active ? scm.hoverBg : 'transparent',
        fontFamily: font.sans,
        fontSize: font.size.ui,
      }}
    >
      <span
        title={`${entry.ref} — ${entry.message}`}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: color.textSecondary,
        }}
      >
        {entry.message}
      </span>
      <span
        style={{
          display: 'flex',
          gap: space[1],
          opacity: active ? 1 : 0,
          transition: transition(['opacity']),
        }}
      >
        <IconBtn
          title="Apply Stash"
          glyph="cloud-download"
          onClick={onApply}
          disabled={busy}
          tabIndex={active ? 0 : -1}
        />
        <IconBtn
          title="Pop Stash"
          glyph="cloud-upload"
          onClick={onPop}
          disabled={busy}
          tabIndex={active ? 0 : -1}
        />
        <IconBtn
          title="Drop Stash"
          glyph="trash"
          onClick={onDrop}
          disabled={busy}
          danger
          tabIndex={active ? 0 : -1}
        />
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
      width: scm.iconButtonSize,
      height: scm.iconButtonSize,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'none',
      border: 'none',
      borderRadius: 3,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      color: danger ? color.danger : color.textTertiary,
      transition: transition(['background', 'color']),
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = scm.buttonHoverBg;
      e.currentTarget.style.color = danger ? color.danger : color.textPrimary;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'none';
      e.currentTarget.style.color = danger ? color.danger : color.textTertiary;
    }}
  >
    <Codicon name={glyph} size={16} />
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
        title="Dismiss"
        aria-label="Dismiss error"
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
