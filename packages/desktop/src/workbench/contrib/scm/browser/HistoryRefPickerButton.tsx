import { type CSSProperties, type JSX, useState } from 'react';
import { toast } from '../../../../platform/notification/browser/notificationService.js';
import { pick } from '../../../../platform/quickinput/browser/quickInputService.js';
import { color, font, radius, space, transition } from '../../../browser/style/design.js';
import { Codicon } from '../../../browser/ui/Codicon.js';
import { GitHistoryProvider } from './gitHistoryProvider.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import {
  graphRefFilterFromPick,
  graphRefFilterLabel,
  graphRefFilterTooltip,
  graphRefNormalizeSelectedValues,
  graphRefPickOptions,
  graphRefSelectedValues,
} from './graphRefPickerModel.js';
import type { ScmHistoryFilter } from './scmViewStore.js';
import { scm } from './styles.js';

export const HistoryRefPickerButton = ({
  disabled,
  filter,
  onFilter,
  gitService: git = gitScmService,
  maxWidth = 112,
  testId,
}: {
  readonly disabled: boolean;
  readonly filter: ScmHistoryFilter;
  readonly onFilter: (filter: ScmHistoryFilter) => void;
  readonly gitService?: GitScmService;
  readonly maxWidth?: number;
  readonly testId?: string;
}): JSX.Element => {
  const [hover, setHover] = useState(false);

  const openPicker = (): void => {
    if (disabled) return;
    void (async () => {
      try {
        const refs = await new GitHistoryProvider(git).provideHistoryItemRefs();
        const selectedValues = graphRefSelectedValues(filter);
        const choice = await pick({
          title: 'History Item Reference Picker',
          placeholder: 'Select one/more history item references to view, type to filter',
          emptyText: 'No refs found.',
          canSelectMany: true,
          selectedValues,
          normalizeSelectedValues: graphRefNormalizeSelectedValues,
          options: graphRefPickOptions(refs, selectedValues),
        });
        if (choice === null) return;
        const nextFilter = graphRefFilterFromPick(choice);
        if (nextFilter !== null) onFilter(nextFilter);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      title={graphRefFilterTooltip(filter)}
      aria-label="History Item Reference Picker"
      aria-haspopup="dialog"
      data-testid={testId}
      onClick={openPicker}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={buttonStyle(disabled, hover, maxWidth)}
    >
      <Codicon name="git-branch" size={16} style={{ flexShrink: 0 }} />
      <span
        title={graphRefFilterTooltip(filter)}
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {graphRefFilterLabel(filter)}
      </span>
    </button>
  );
};

function buttonStyle(disabled: boolean, hover: boolean, maxWidth: number): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    height: scm.rowHeight,
    maxWidth,
    padding: `0 ${space[1]}px`,
    background: hover ? scm.hoverBg : 'transparent',
    border: '1px solid transparent',
    borderRadius: radius.sm,
    color: disabled ? scm.disabledFg : color.textTertiary,
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: font.sans,
    fontSize: font.size.ui,
    transition: transition(['background', 'color']),
  };
}
