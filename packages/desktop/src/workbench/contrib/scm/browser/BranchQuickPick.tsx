import { type JSX, useState } from 'react';
import { color, font, radius, space, transition } from '../../../browser/style/design.js';
import { Codicon } from '../../../browser/ui/Codicon.js';
import type { GitStatusResult } from '../common/git.js';
import { type BranchGitAdapter, defaultBranchGitAdapter } from './branchGitAdapter.js';
import { openBranchQuickPick } from './branchQuickPickCommands.js';

interface BranchQuickPickProps {
  readonly status: GitStatusResult;
  readonly disabled: boolean;
  readonly adapter?: BranchGitAdapter;
  /** Re-read git.status after a switch / merge / create (HEAD or tree changed). */
  readonly onAfter: () => void | Promise<void>;
  readonly variant?: 'scm' | 'statusBar';
}

export const BranchQuickPick = ({
  status,
  disabled,
  adapter,
  onAfter,
  variant = 'scm',
}: BranchQuickPickProps): JSX.Element => {
  const git = adapter ?? defaultBranchGitAdapter;
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const label = status.detached ? 'detached' : (status.branch ?? '-');

  const runPicker = (): void => {
    if (disabled || open) return;
    setOpen(true);
    void openBranchQuickPick({ status, git, onAfter }).finally(() => setOpen(false));
  };

  return (
    <button
      type="button"
      onClick={runPicker}
      disabled={disabled || open}
      title={status.upstream ?? 'Switch Branch'}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid={variant === 'statusBar' ? 'statusbar-branch' : 'scm-branch'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={triggerStyle(variant, open || hover, disabled)}
    >
      <Codicon
        name="git-branch"
        size={variant === 'statusBar' ? 14 : 16}
        style={{ flexShrink: 0 }}
      />
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
      {variant === 'scm' && <Codicon name="chevron-down" size={12} color={color.textGhost} />}
    </button>
  );
};

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
