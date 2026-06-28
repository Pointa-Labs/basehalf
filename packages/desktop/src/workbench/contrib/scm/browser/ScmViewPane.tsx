import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { color, space } from '../../../browser/style/design.js';
import { Button } from '../../../browser/ui/primitives/Button.js';
import { PullRequestsSection } from '../../githubPullRequests/browser/PullRequestsSection.js';
import { CommitInput } from './CommitInput.js';
import { Centered, ErrorLine } from './EmptyState.js';
import { GraphSection } from './GraphSection.js';
import { RepoHeader } from './RepoHeader.js';
import { ResourceGroups } from './ResourceGroups.js';
import { StashSection } from './StashSection.js';
import type { ScmViewPaneModel } from './useScmViewPaneModel.js';

const handleTreeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-scm-row]'));
  if (items.length === 0) return;
  const active = document.activeElement;
  const index = items.findIndex((element) => element === active || element.contains(active));
  if (index === -1) {
    items[0]?.focus();
  } else {
    const next =
      event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1);
    items[next]?.focus();
  }
  event.preventDefault();
};

/**
 * SCM workbench view pane, analogous to VS Code's `scmViewPane`: it renders the
 * provider/input/resource-group model and delegates Git behavior to commands.
 */
export function ScmViewPane({ model }: { readonly model: ScmViewPaneModel }): JSX.Element {
  const { commands, groups, provider, refresh, status, statusError } = model;
  const { busy, error } = commands;

  if (status === null) {
    return <Centered>{error ?? statusError ?? '…'}</Centered>;
  }

  if (!provider.isRepository) {
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

  const view = provider.view;
  if (view === null) return <Centered>{error ?? statusError ?? '…'}</Centered>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <RepoHeader
        status={status}
        busy={busy}
        onSync={commands.sync}
        onAfterBranch={refresh}
        menuActions={[
          { label: 'Create Branch…', onClick: commands.createBranchPrompt },
          { label: 'Pull', onClick: commands.pull, disabled: !view.canPull },
          { label: 'Pull (Rebase)', onClick: commands.pullRebase, disabled: !view.canPull },
          { label: 'Push', onClick: commands.push },
          { label: 'Push (Force)', onClick: commands.pushForce },
          { label: 'Fetch', onClick: commands.fetch },
          { label: 'Create Pull Request…', onClick: commands.createPullRequest },
          { label: 'Undo Last Commit', onClick: commands.undoLastCommit },
          { label: 'Stash', onClick: commands.stash },
          { label: 'Pop Stash', onClick: () => commands.popStash() },
          { label: 'Discard All Changes', onClick: commands.discardAll, danger: true },
          { label: 'Refresh', onClick: () => void refresh() },
        ]}
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} onKeyDown={handleTreeKeyDown}>
        <CommitInput
          message={model.message}
          setMessage={model.setMessage}
          canCommit={view.canCommit}
          canCommitAmend={view.canCommitAmend}
          canPrimaryAction={view.canCommit || view.canPublish || view.canSync}
          hasStaged={view.hasStaged}
          commitBranch={view.commitBranch}
          primaryLabel={
            view.canCommit ? 'Commit' : view.canPublish ? 'Publish Branch' : 'Sync Changes'
          }
          primaryGlyph={view.canCommit ? 'check' : view.canPublish ? 'cloud-upload' : 'sync'}
          primaryAction={
            view.canCommit ? undefined : view.canPublish ? commands.sync : commands.sync
          }
          commit={commands.commit}
        />

        <ResourceGroups
          count={view.count}
          groups={groups}
          busy={busy}
          hasStaged={view.hasStaged}
          openRow={commands.openRow}
          stage={commands.stage}
          unstage={commands.unstage}
          discardMany={commands.discardMany}
        />

        <StashSection
          entries={model.stashes}
          open={model.stashesOpen}
          onToggle={() => model.setStashesOpen(!model.stashesOpen)}
          busy={busy}
          commands={commands}
        />

        <GraphSection
          open={model.graphOpen}
          onToggle={() => model.setGraphOpen(!model.graphOpen)}
          busy={busy}
          canPublish={view.canPublish}
          canPull={view.canPull}
          commands={commands}
        />

        <PullRequestsSection />
      </div>
    </div>
  );
}
