import { Fragment, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { color, space } from '../../../browser/style/design.js';
import { Button } from '../../../browser/ui/primitives/Button.js';
import {
  type SourceControlPrimaryAction,
  sourceControlActionButtonModel,
} from '../common/sourceControlActionButtonModel.js';
import { CommitInput } from './CommitInput.js';
import { Centered, ErrorLine } from './EmptyState.js';
import { GraphSection } from './GraphSection.js';
import { RepoHeader } from './RepoHeader.js';
import { ResourceGroups } from './ResourceGroups.js';
import { StashSection } from './StashSection.js';
import { scmHeaderActionModel } from './scmHeaderActions.js';
import {
  type ScmViewContribution,
  scmContributionMenuActions,
  scmViewContributionRegistry,
  scmVisibleViewContributions,
} from './scmViewContributions.js';
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
export function ScmViewPane({
  contributions,
  model,
}: {
  readonly contributions?: readonly ScmViewContribution[];
  readonly model: ScmViewPaneModel;
}): JSX.Element {
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
  const actionButton = sourceControlActionButtonModel(view);
  const visibleContributions = scmVisibleViewContributions(
    contributions ?? scmViewContributionRegistry.getScmViewContributions(),
    model,
  );
  const headerActions = scmHeaderActionModel({
    status,
    busy,
    view,
    commands,
    refresh,
    contributionActions: scmContributionMenuActions(visibleContributions, model),
  });
  const runPrimaryAction = (action: SourceControlPrimaryAction): void => {
    if (action === 'publish') commands.publish();
    else if (action === 'sync') commands.sync();
    else commands.commit();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <RepoHeader status={status} busy={busy} onAfterBranch={refresh} actions={headerActions} />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} onKeyDown={handleTreeKeyDown}>
        <CommitInput
          message={model.message}
          setMessage={model.setMessage}
          hasStaged={view.hasStaged}
          commitBranch={view.commitBranch}
          actionButton={actionButton}
          primaryAction={runPrimaryAction}
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
          onRefresh={() => void refresh()}
          commands={commands}
        />

        {visibleContributions.map((contribution) => {
          const section = contribution.renderSection?.(model);
          return section === undefined || section === null ? null : (
            <Fragment key={contribution.id}>{section}</Fragment>
          );
        })}
      </div>
    </div>
  );
}
