import type { GitStashEntry } from '@basehalf/core';
import {
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { color, space } from '../design.js';
import { type GitGroups, classifyStatus, totalChangeCount } from '../lib/gitStatus.js';
import { useGitStatusStore } from '../store/gitStatus.js';
import { useScmViewStore } from '../store/scmView.js';
import { Button } from './primitives/Button.js';
import { CommitInput } from './source-control/CommitInput.js';
import { Centered, ErrorLine } from './source-control/EmptyState.js';
import { GraphSection } from './source-control/GraphSection.js';
import { PullRequestsSection } from './source-control/PullRequestsSection.js';
import { RepoHeader } from './source-control/RepoHeader.js';
import { ResourceGroups } from './source-control/ResourceGroups.js';
import { StashSection } from './source-control/StashSection.js';
import { useScmCommands } from './source-control/useScmCommands.js';

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
  // Fetch on mount (the global git-status sync also refreshes on file events;
  // this guarantees a fresh read the moment the panel opens).
  useEffect(() => {
    void refresh();
    void loadStashes();
  }, [refresh, loadStashes]);

  const groups = useMemo<GitGroups>(
    () => (status?.isRepo ? classifyStatus(status.files) : { merge: [], staged: [], changes: [] }),
    [status],
  );
  const hasStaged = groups.staged.length > 0;
  const commands = useScmCommands({
    status,
    groups,
    message,
    setMessage,
    hasStaged,
    refresh,
    loadStashes,
  });
  const { busy, error } = commands;
  const hasCommitMessage = message.trim().length > 0;
  // VS Code exposes amend as a commit action variant, not a persistent checkbox.
  // BaseHalf's git.commit still requires an explicit message, so amend shares the
  // same message gate but does not require freshly staged changes.
  const canCommit = hasCommitMessage && !busy && hasStaged;
  const canCommitAmend = hasCommitMessage && !busy;

  if (status === null) {
    return <Centered>{error ?? '…'}</Centered>;
  }

  if (!status.isRepo) {
    return (
      <Centered>
        <div style={{ color: color.textSecondary, marginBottom: space[3], lineHeight: 1.5 }}>
          This folder isn’t a git repository yet.
        </div>
        <Button variant="primary" size="sm" disabled={busy} onClick={commands.initRepository}>
          Initialize Repository
        </Button>
        {error !== null && <ErrorLine>{error}</ErrorLine>}
      </Centered>
    );
  }

  const count = totalChangeCount(groups);
  const canPublish = status.detached !== true && status.branch !== null && status.upstream === null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <RepoHeader
        status={status}
        busy={busy}
        onSync={commands.sync}
        onAfterBranch={refresh}
        menuActions={[
          { label: 'Create Branch…', onClick: commands.createBranchPrompt },
          { label: 'Pull', onClick: () => commands.runAction('git.pull') },
          { label: 'Pull (Rebase)', onClick: commands.pullRebase },
          { label: 'Push', onClick: () => commands.runAction('git.push') },
          { label: 'Push (Force)', onClick: commands.pushForce },
          { label: 'Fetch', onClick: () => commands.runAction('git.fetch') },
          { label: 'Create Pull Request…', onClick: commands.createPullRequest },
          { label: 'Undo Last Commit', onClick: commands.undoLastCommit },
          { label: 'Stash', onClick: () => commands.runAction('git.stash') },
          { label: 'Pop Stash', onClick: () => commands.popStash() },
          { label: 'Discard All Changes', onClick: commands.discardAll, danger: true },
          { label: 'Refresh', onClick: () => void refresh() },
        ]}
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} onKeyDown={handleTreeKeyDown}>
        <CommitInput
          message={message}
          setMessage={setMessage}
          canCommit={canCommit}
          canCommitAmend={canCommitAmend}
          hasStaged={hasStaged}
          commitBranch={status.detached ? 'detached' : (status.branch ?? '')}
          commit={commands.commit}
        />

        <ResourceGroups
          count={count}
          groups={groups}
          busy={busy}
          hasStaged={hasStaged}
          openRow={commands.openRow}
          stage={commands.stage}
          unstage={commands.unstage}
          discardMany={commands.discardMany}
        />

        <StashSection
          entries={stashes}
          open={stashesOpen}
          onToggle={() => setStashesOpen(!stashesOpen)}
          busy={busy}
          commands={commands}
        />

        <GraphSection
          open={graphOpen}
          onToggle={() => setGraphOpen(!graphOpen)}
          busy={busy}
          canPublish={canPublish}
          commands={commands}
        />

        {/* GitHub Pull Requests — renders only for a github.com repo. */}
        <PullRequestsSection />
      </div>
    </div>
  );
};
