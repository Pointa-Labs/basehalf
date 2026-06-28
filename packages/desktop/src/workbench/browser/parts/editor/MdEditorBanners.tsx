import type { JSX } from 'react';
import { color, font, motion, space } from '../../style/design.js';
import { Button } from '../../ui/primitives/Button.js';

export const MdEditorBanners = ({
  viewOnly,
  reloadPrompt,
  writeFailed,
  error,
  onKeepMine,
  onAcceptReload,
  onRetryWrite,
  onDiscardAndClose,
}: {
  viewOnly: boolean;
  reloadPrompt: boolean;
  writeFailed: boolean;
  error: string;
  onKeepMine: () => void;
  onAcceptReload: () => void;
  onRetryWrite: () => void;
  onDiscardAndClose: () => void;
}): JSX.Element => (
  <>
    {viewOnly && (
      <div
        style={{
          padding: `${space[2]}px ${space[4]}px`,
          background: color.surfaceMuted,
          borderBottom: `1px solid ${color.border}`,
          fontSize: font.size.caption,
          fontFamily: font.sans,
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          color: color.warning,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color.warning,
            flexShrink: 0,
          }}
        />
        <span>View only — plain-text files are read-only here; edit them with your own tools</span>
      </div>
    )}
    {reloadPrompt && (
      <div
        style={{
          padding: `${space[2]}px ${space[4]}px`,
          background: color.warningSoft,
          borderBottom: `1px solid ${color.warning}33`,
          color: color.warning,
          fontSize: font.size.caption,
          fontFamily: font.sans,
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          animation: `bh-banner-in ${motion.normal}`,
        }}
      >
        <span style={{ flex: 1 }}>This file changed on disk while you were editing.</span>
        <Button variant="primary" size="sm" onClick={onKeepMine}>
          Keep my edits
        </Button>
        <Button variant="ghost" size="sm" onClick={onAcceptReload}>
          Reload from disk
        </Button>
      </div>
    )}
    {writeFailed && !reloadPrompt && (
      <div
        style={{
          padding: `${space[2]}px ${space[4]}px`,
          background: color.dangerSoft,
          borderBottom: `1px solid ${color.danger}33`,
          color: color.danger,
          fontSize: font.size.caption,
          fontFamily: font.sans,
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          animation: `bh-banner-in ${motion.normal}`,
        }}
      >
        <span style={{ flex: 1 }}>
          Couldn't save this file{error ? ` — ${error}` : ''}. Your edits are still here.
        </span>
        <Button variant="primary" size="sm" onClick={onRetryWrite}>
          Retry
        </Button>
        <Button variant="ghost" size="sm" onClick={onDiscardAndClose}>
          Discard &amp; close
        </Button>
      </div>
    )}
    {error && !writeFailed && (
      <div
        style={{
          padding: `${space[2]}px ${space[4]}px`,
          background: color.dangerSoft,
          color: color.danger,
          fontSize: font.size.caption,
          fontFamily: font.sans,
          borderBottom: `1px solid ${color.danger}33`,
        }}
      >
        {error}
      </div>
    )}
  </>
);
