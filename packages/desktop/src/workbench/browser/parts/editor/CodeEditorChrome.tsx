import { type JSX, type ReactNode, useCallback, useState } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { color, font, radius, shadow, space } from '../../style/design.js';
import { Button } from '../../ui/primitives/Button.js';
import { fileBaseName } from './codeEditorModel.js';

/** Slim top bar: the unsaved dot + a save hint, plus language and blame toggle
 *  on the right. Always rendered so toggling dirty doesn't shift the editor. */
export const CodeEditorStatusBar = ({
  dirty,
  language,
  blameOn,
  onToggleBlame,
}: {
  dirty: boolean;
  language: string;
  blameOn: boolean;
  onToggleBlame: () => void;
}): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: space[2],
      padding: `${space[2]}px ${space[4]}px`,
      borderBottom: `1px solid ${color.divider}`,
      fontFamily: font.sans,
      fontSize: font.size.caption,
      color: color.textTertiary,
      flexShrink: 0,
    }}
  >
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: dirty ? color.accent : color.textGhost,
        transition: 'background 120ms ease',
      }}
    />
    {dirty ? 'Unsaved · ⌘S to save' : 'Saved'}
    <button
      type="button"
      title={
        blameOn ? 'Turn off inline blame' : 'Show inline blame (last change on the current line)'
      }
      aria-pressed={blameOn}
      onClick={onToggleBlame}
      style={{
        marginLeft: 'auto',
        padding: `0 ${space[2]}px`,
        height: 18,
        border: `1px solid ${blameOn ? color.accent : color.border}`,
        borderRadius: radius.sm,
        background: blameOn ? `${color.accent}1f` : 'transparent',
        color: blameOn ? color.accent : color.textTertiary,
        fontFamily: font.sans,
        fontSize: font.size.micro,
        cursor: 'pointer',
      }}
    >
      Blame
    </button>
    <span style={{ fontFamily: font.mono, color: color.textGhost }}>{language}</span>
  </div>
);

export const CodeEditorErrorBanner = ({ error }: { error: string }): JSX.Element => (
  <div
    style={{
      padding: `${space[2]}px ${space[4]}px`,
      background: color.surfaceMuted,
      borderBottom: `1px solid ${color.divider}`,
      color: color.danger,
      fontFamily: font.sans,
      fontSize: font.size.caption,
      flexShrink: 0,
    }}
  >
    {error}
  </div>
);

export const CodeEditorBanner = ({ children }: { children: ReactNode }): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: space[2],
      padding: `${space[2]}px ${space[4]}px`,
      background: color.surfaceMuted,
      borderBottom: `1px solid ${color.border}`,
      fontFamily: font.sans,
      fontSize: font.size.caption,
      color: color.textSecondary,
      flexShrink: 0,
    }}
  >
    {children}
  </div>
);

export const CodeEditorConflictBanner = ({
  onKeepMine,
  onReload,
}: {
  onKeepMine: () => void;
  onReload: () => void;
}): JSX.Element => (
  <CodeEditorBanner>
    <span style={{ flex: 1 }}>This file changed on disk since you opened it.</span>
    <Button variant="primary" size="sm" onClick={onKeepMine}>
      Keep mine
    </Button>
    <Button variant="ghost" size="sm" onClick={onReload}>
      Reload
    </Button>
  </CodeEditorBanner>
);

/** The navigate-away dialog (Save / Don't save / Cancel), centered over the
 *  editor. Mirrors VS Code's unsaved-changes prompt; shown only when the user
 *  leaves a file with unsaved edits. */
export const UnsavedChangesPrompt = ({
  file,
  onSave,
  onDiscard,
  onCancel,
}: {
  file: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}): JSX.Element => {
  const name = fileBaseName(file);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: color.backdrop,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: 360,
          maxWidth: '90%',
          background: color.surface,
          border: `1px solid ${color.border}`,
          borderRadius: radius.lg,
          boxShadow: shadow.raised,
          padding: space[5],
          display: 'flex',
          flexDirection: 'column',
          gap: space[4],
          fontFamily: font.sans,
        }}
      >
        <div style={{ fontSize: font.size.body, color: color.textPrimary }}>
          Save changes to <strong>{name}</strong>?
        </div>
        <div style={{ fontSize: font.size.caption, color: color.textTertiary }}>
          Your changes will be lost if you don’t save them.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: space[2] }}>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            Don’t save
          </Button>
          <Button variant="primary" size="sm" onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};

/** A binary file optimistically routed to `code` mode turns out non-text once
 *  read — offer the open-in-app escape instead of garbling it. */
export const BinaryFileFallback = ({ file }: { file: string }): JSX.Element => {
  const [error, setError] = useState<string | null>(null);
  const openInApp = useCallback(async () => {
    setError(null);
    try {
      const res = await nativeHostService.openPath(file);
      if (!res.ok) setError(res.error ?? "Couldn't open the file.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);
  return (
    <div
      style={{
        flex: 1,
        padding: space[4],
        fontFamily: font.sans,
        fontSize: font.size.caption,
        color: color.textTertiary,
        display: 'flex',
        flexDirection: 'column',
        gap: space[3],
        alignItems: 'flex-start',
      }}
    >
      <span>This looks like a binary file, so it can’t be shown as text.</span>
      <Button variant="primary" onClick={() => void openInApp()}>
        Open in default app
      </Button>
      {error !== null && <span style={{ color: color.danger }}>{error}</span>}
    </div>
  );
};
