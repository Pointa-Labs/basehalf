import type { GitRefsResult } from '@basehalf/core';
import { type JSX, useState } from 'react';
import { color, font, radius, space, transition } from '../../design.js';
import { type ScmHistoryFilter, useScmViewStore } from '../../store/scmView.js';
import { toast } from '../../store/toast.js';
import { Codicon } from '../Codicon.js';
import { pick as pickDialog } from '../Dialog.js';
import {
  graphRefDisplayName,
  graphRefFilterFromPick,
  graphRefPickOptions,
} from './graphRefPickerModel.js';
import { scm } from './styles.js';

export const GraphRefPicker = ({ disabled }: { disabled: boolean }): JSX.Element => {
  const filter = useScmViewStore((s) => s.historyFilter);
  const setFilter = useScmViewStore((s) => s.setHistoryFilter);
  const [hover, setHover] = useState(false);

  const openPicker = (): void => {
    if (disabled) return;
    void (async () => {
      try {
        const result = (await window.bh.run('git.refs', {
          includeRemote: true,
          includeTags: true,
        })) as GitRefsResult;
        const choice = await pickDialog({
          title: 'History Item Reference Picker',
          placeholder: 'Select history item reference',
          emptyText: 'No refs found.',
          options: graphRefPickOptions(result.refs),
        });
        if (choice === null) return;
        const nextFilter = graphRefFilterFromPick(choice);
        if (nextFilter !== null) setFilter(nextFilter);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const label = filterLabel(filter);

  return (
    <div style={{ display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        title="History Item Reference Picker"
        aria-haspopup="dialog"
        onClick={openPicker}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          height: scm.rowHeight,
          maxWidth: 112,
          padding: `0 ${space[1]}px`,
          background: hover ? scm.hoverBg : 'transparent',
          border: '1px solid transparent',
          borderRadius: radius.sm,
          color: disabled ? scm.disabledFg : color.textTertiary,
          cursor: disabled ? 'default' : 'pointer',
          fontFamily: font.sans,
          fontSize: font.size.ui,
          transition: transition(['background', 'color']),
        }}
      >
        <Codicon name="git-branch" size={16} style={{ flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </button>
    </div>
  );
};

function filterLabel(filter: ScmHistoryFilter): string {
  if (filter.kind === 'ref') return graphRefDisplayName(filter.ref);
  return filter.kind === 'all' ? 'All' : 'Auto';
}
