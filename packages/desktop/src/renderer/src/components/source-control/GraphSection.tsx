import type { JSX } from 'react';
import { Disclosure } from '../primitives/Disclosure.js';
import { GitGraph } from './GitGraph.js';
import { GraphRefPicker } from './GraphRefPicker.js';
import { ScmIconButton as IconBtn } from './ScmIconButton.js';
import type { ScmCommands } from './useScmCommands.js';

export const GraphSection = ({
  open,
  onToggle,
  busy,
  canPublish,
  commands,
}: {
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  canPublish: boolean;
  commands: Pick<ScmCommands, 'openFullGraph' | 'revealHead' | 'runAction' | 'sync'>;
}): JSX.Element => (
  <Disclosure
    title="Graph"
    open={open}
    onToggle={onToggle}
    actions={
      <>
        <GraphRefPicker disabled={busy} />
        <IconBtn
          title="Open Git Graph"
          onClick={commands.openFullGraph}
          disabled={busy}
          glyph="screen-full"
        />
        <IconBtn
          title="Go to Current History Item"
          onClick={commands.revealHead}
          disabled={busy}
          glyph="target"
        />
        <IconBtn
          title="Fetch"
          onClick={() => commands.runAction('git.fetch')}
          disabled={busy}
          glyph="cloud-download"
        />
        <IconBtn
          title="Pull"
          onClick={() => commands.runAction('git.pull')}
          disabled={busy}
          glyph="arrow-down"
        />
        <IconBtn
          title="Push"
          onClick={() => commands.runAction('git.push')}
          disabled={busy}
          glyph="arrow-up"
        />
        <IconBtn
          title={canPublish ? 'Publish Branch' : 'Sync Changes'}
          onClick={commands.sync}
          disabled={busy}
          glyph={canPublish ? 'cloud-upload' : 'sync'}
        />
      </>
    }
  >
    {open && <GitGraph />}
  </Disclosure>
);
