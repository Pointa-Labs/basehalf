import { type JSX, useState } from 'react';
import { color, font, radius, space, transition } from '../../../browser/style/design.js';
import { Codicon } from '../../../browser/ui/Codicon.js';
import type { GitStatusResult } from '../common/git.js';
import { type BranchGitAdapter, defaultBranchGitAdapter } from './branchGitAdapter.js';
import { runCheckoutBranchCommand } from './branchQuickPickCommands.js';
import {
  type BranchCheckoutBusyReason,
  createBranchCheckoutCommandModel,
} from './branchQuickPickModel.js';

interface BranchQuickPickProps {
  readonly status: GitStatusResult;
  readonly busyReason?: BranchCheckoutBusyReason;
  readonly adapter?: BranchGitAdapter;
  /** Re-read git.status after a switch / merge / create (HEAD or tree changed). */
  readonly onAfter: () => void | Promise<void>;
  readonly variant?: 'scm' | 'statusBar';
}

export const BranchQuickPick = ({
  status,
  busyReason,
  adapter,
  onAfter,
  variant = 'scm',
}: BranchQuickPickProps): JSX.Element => {
  const git = adapter ?? defaultBranchGitAdapter;
  const [picking, setPicking] = useState(false);
  const [hover, setHover] = useState(false);
  const model = createBranchCheckoutCommandModel(status, picking ? 'checkout' : busyReason);

  const runPicker = (): void => {
    if (model.disabled) return;
    setPicking(true);
    void runCheckoutBranchCommand({ git, onAfter }).finally(() => setPicking(false));
  };

  return (
    <button
      type="button"
      onClick={runPicker}
      disabled={model.disabled}
      title={model.tooltip}
      aria-label={model.ariaLabel}
      data-testid={variant === 'statusBar' ? 'statusbar-branch' : 'scm-branch'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={triggerStyle(variant, picking || (!model.disabled && hover), model.disabled)}
    >
      <Codicon
        name={model.icon}
        size={variant === 'statusBar' ? 14 : 16}
        style={{
          flexShrink: 0,
          animation: model.iconSpin ? 'bh-spin 0.8s linear infinite' : undefined,
        }}
      />
      <BranchLabel label={model.label} variant={variant} />
      {variant === 'scm' && !model.disabled && (
        <Codicon name="chevron-down" size={12} style={{ flexShrink: 0, opacity: 0.8 }} />
      )}
    </button>
  );
};

function BranchLabel({
  label,
  variant,
}: {
  readonly label: string;
  readonly variant: 'scm' | 'statusBar';
}): JSX.Element {
  return (
    <span
      style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
        maxWidth: variant === 'statusBar' ? 200 : undefined,
      }}
    >
      {label}
    </span>
  );
}

function triggerStyle(
  variant: 'scm' | 'statusBar',
  highlighted: boolean,
  disabled: boolean,
): React.CSSProperties {
  if (variant === 'statusBar') {
    return {
      display: 'flex',
      alignItems: 'center',
      gap: space[1],
      height: 18,
      padding: `0 ${space[1]}px`,
      background: highlighted ? color.divider : 'none',
      border: 'none',
      borderRadius: radius.sm,
      color: disabled ? color.textGhost : color.textSecondary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
      cursor: disabled ? 'default' : 'pointer',
      transition: transition(['background', 'color']),
    };
  }

  return {
    display: 'flex',
    alignItems: 'center',
    gap: space[2],
    minWidth: 0,
    maxWidth: '100%',
    padding: `2px ${space[2]}px`,
    margin: `-2px -${space[1]}px`,
    background: highlighted ? color.divider : 'none',
    border: 'none',
    borderRadius: radius.sm,
    color: disabled ? color.textGhost : color.textSecondary,
    fontFamily: font.sans,
    fontSize: font.size.caption,
    cursor: disabled ? 'default' : 'pointer',
    transition: transition(['background']),
  };
}
