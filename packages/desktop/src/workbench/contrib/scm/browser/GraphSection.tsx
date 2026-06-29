import type { JSX } from 'react';
import { Disclosure } from '../../../browser/ui/primitives/Disclosure.js';
import { GitGraph } from './GitGraph.js';
import { GraphRefPicker } from './GraphRefPicker.js';
import { ScmIconButton as IconBtn } from './ScmIconButton.js';
import { type GraphHeaderButtonAction, graphHeaderActions } from './graphHeaderActionModel.js';
import { useScmViewStore } from './scmViewStore.js';
import type { ScmCommands } from './useScmCommands.js';

export const GraphSection = ({
  open,
  onToggle,
  busy,
  onRefresh,
  commands,
}: {
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  onRefresh: () => void;
  commands: Pick<ScmCommands, 'openFullGraph' | 'revealHead'>;
}): JSX.Element => (
  <Disclosure
    title="Graph"
    open={open}
    onToggle={onToggle}
    actions={graphHeaderActions({ busy }).map((action) =>
      action.kind === 'refPicker' ? (
        <GraphRefPicker key={action.id} disabled={action.disabled} />
      ) : (
        <GraphHeaderButton
          key={action.id}
          action={action}
          commands={commands}
          onRefresh={onRefresh}
        />
      ),
    )}
  >
    {open && <GitGraph />}
  </Disclosure>
);

function GraphHeaderButton({
  action,
  commands,
  onRefresh,
}: {
  readonly action: GraphHeaderButtonAction;
  readonly commands: Pick<ScmCommands, 'openFullGraph' | 'revealHead'>;
  readonly onRefresh: () => void;
}): JSX.Element {
  const onClick = (): void => {
    if (action.id === 'revealCurrent') {
      commands.revealHead();
      return;
    }
    if (action.id === 'refresh') {
      useScmViewStore.getState().requestHistoryReload();
      onRefresh();
      return;
    }
    commands.openFullGraph();
  };

  return (
    <IconBtn
      title={action.title}
      onClick={onClick}
      disabled={action.disabled}
      glyph={action.glyph}
    />
  );
}
