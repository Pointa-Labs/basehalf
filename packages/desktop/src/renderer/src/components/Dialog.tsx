/**
 * Custom dialog system — replaces window.confirm / window.prompt.
 *
 * Native browser dialogs look like the 90s and break the rest of the
 * polished chrome. This module exposes two Promise-returning helpers
 * (confirm / prompt) and a single `<DialogHost />` that App mounts at
 * the root. State lives in a Zustand store so the helpers can be called
 * from anywhere without prop-drilling a context.
 */

import { type CSSProperties, type JSX, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
import { Button } from './primitives/Button.js';

interface BaseDialog {
  readonly title: string;
  readonly body?: string;
}

interface ConfirmDialog extends BaseDialog {
  readonly type: 'confirm';
  readonly confirmText: string;
  readonly cancelText: string;
  readonly destructive: boolean;
  readonly resolve: (ok: boolean) => void;
}

interface PromptDialog extends BaseDialog {
  readonly type: 'prompt';
  readonly label: string;
  readonly placeholder: string;
  readonly defaultValue: string;
  readonly confirmText: string;
  readonly cancelText: string;
  readonly validate?: (value: string) => string | null;
  readonly resolve: (value: string | null) => void;
}

type DialogState = ConfirmDialog | PromptDialog | null;

interface DialogStore {
  current: DialogState;
  show: (dialog: NonNullable<DialogState>) => void;
  resolveAndClose: (result: unknown) => void;
}

const useDialogStore = create<DialogStore>((set, get) => ({
  current: null,
  show: (dialog) => set({ current: dialog }),
  resolveAndClose: (result) => {
    const cur = get().current;
    if (!cur) return;
    cur.resolve(result as never);
    set({ current: null });
  },
}));

interface ConfirmOptions {
  readonly title: string;
  readonly body?: string;
  readonly confirmText?: string;
  readonly cancelText?: string;
  readonly destructive?: boolean;
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().show({
      type: 'confirm',
      title: opts.title,
      ...(opts.body !== undefined && { body: opts.body }),
      confirmText: opts.confirmText ?? 'Continue',
      cancelText: opts.cancelText ?? 'Cancel',
      destructive: opts.destructive ?? false,
      resolve,
    });
  });
}

interface PromptOptions {
  readonly title: string;
  readonly body?: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly confirmText?: string;
  readonly cancelText?: string;
  readonly validate?: (value: string) => string | null;
}

export function prompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().show({
      type: 'prompt',
      title: opts.title,
      ...(opts.body !== undefined && { body: opts.body }),
      label: opts.label,
      placeholder: opts.placeholder ?? '',
      defaultValue: opts.defaultValue ?? '',
      confirmText: opts.confirmText ?? 'OK',
      cancelText: opts.cancelText ?? 'Cancel',
      ...(opts.validate !== undefined && { validate: opts.validate }),
      resolve,
    });
  });
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: color.backdrop,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  animation: `bh-fade-in ${motion.fast}`,
  // backdrop-filter would be nicer but Electron renderer support is patchy.
};

const dialogStyle: CSSProperties = {
  background: color.surface,
  borderRadius: radius.xl,
  boxShadow: shadow.floating,
  minWidth: 380,
  maxWidth: 480,
  padding: `${space[5]}px ${space[5]}px ${space[4]}px`,
  fontFamily: font.sans,
  color: color.textPrimary,
  animation: `bh-dialog-in ${motion.normal}`,
};

const titleStyle: CSSProperties = {
  fontSize: font.size.display,
  fontWeight: font.weight.semibold,
  marginBottom: space[2],
  letterSpacing: -0.2,
};

const bodyStyle: CSSProperties = {
  fontSize: font.size.body,
  color: color.textSecondary,
  lineHeight: 1.5,
  marginBottom: space[4],
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: space[2],
  marginTop: space[4],
};

/** CSS selector matching all natively focusable / tabbable elements
 *  inside the dialog body. Used by the focus trap to find the first /
 *  last focusable target. */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const DialogHost = (): JSX.Element | null => {
  const current = useDialogStore((s) => s.current);
  const resolveAndClose = useDialogStore((s) => s.resolveAndClose);
  const containerRef = useRef<HTMLDivElement>(null);

  // Esc cancels + Tab/Shift+Tab cycle focus inside the dialog only.
  // Without the trap, Tab could move focus to background buttons (the
  // topbar buttons, sidebar rows, etc.) — confusing because the user
  // would lose track of "I'm in a modal."
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        resolveAndClose(current.type === 'confirm' ? false : null);
        return;
      }
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [current, resolveAndClose]);

  if (!current) return null;
  return (
    <div
      ref={containerRef}
      style={backdropStyle}
      onMouseDown={(e) => {
        // Click outside dismisses (treats as Cancel).
        if (e.target === e.currentTarget) {
          resolveAndClose(current.type === 'confirm' ? false : null);
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bh-dialog-title"
    >
      {current.type === 'confirm' ? (
        <ConfirmBody dialog={current} onResolve={resolveAndClose} />
      ) : (
        <PromptBody dialog={current} onResolve={resolveAndClose} />
      )}
    </div>
  );
};

const ConfirmBody = ({
  dialog,
  onResolve,
}: {
  dialog: ConfirmDialog;
  onResolve: (result: unknown) => void;
}): JSX.Element => (
  <div style={dialogStyle}>
    <div id="bh-dialog-title" style={titleStyle}>
      {dialog.title}
    </div>
    {dialog.body && <div style={bodyStyle}>{dialog.body}</div>}
    <div style={actionsStyle}>
      {/* Destructive dialogs autofocus Cancel — pressing Enter on a
          "Delete this thing?" should NOT delete. Non-destructive
          dialogs autofocus the primary so Enter accepts the obvious
          good path. */}
      <Button variant="ghost" onClick={() => onResolve(false)} autoFocus={dialog.destructive}>
        {dialog.cancelText}
      </Button>
      <Button
        variant={dialog.destructive ? 'danger' : 'primary'}
        onClick={() => onResolve(true)}
        autoFocus={!dialog.destructive}
      >
        {dialog.confirmText}
      </Button>
    </div>
  </div>
);

const PromptBody = ({
  dialog,
  onResolve,
}: {
  dialog: PromptDialog;
  onResolve: (result: unknown) => void;
}): JSX.Element => {
  const [value, setValue] = useState(dialog.defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (): void => {
    if (dialog.validate) {
      const err = dialog.validate(value);
      if (err) {
        setError(err);
        return;
      }
    }
    onResolve(value);
  };

  return (
    <form
      style={dialogStyle}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div id="bh-dialog-title" style={titleStyle}>
        {dialog.title}
      </div>
      {dialog.body && <div style={bodyStyle}>{dialog.body}</div>}
      <label
        style={{
          display: 'block',
          fontSize: font.size.caption,
          color: color.textSecondary,
          marginBottom: space[1],
        }}
      >
        {dialog.label}
      </label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={dialog.placeholder}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: `${space[2]}px ${space[3]}px`,
          fontSize: font.size.body,
          fontFamily: font.sans,
          color: color.textPrimary,
          background: color.surface,
          border: `1px solid ${error ? color.danger : color.borderStrong}`,
          borderRadius: radius.md,
          outline: 'none',
          transition: transition(['border-color', 'box-shadow']),
        }}
        onFocus={(e) => {
          if (!error) e.currentTarget.style.boxShadow = shadow.focus;
        }}
        onBlur={(e) => {
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
      {error && (
        <div
          style={{
            marginTop: space[1],
            fontSize: font.size.caption,
            color: color.danger,
          }}
        >
          {error}
        </div>
      )}
      <div style={actionsStyle}>
        <Button variant="ghost" type="button" onClick={() => onResolve(null)}>
          {dialog.cancelText}
        </Button>
        <Button variant="primary" type="submit">
          {dialog.confirmText}
        </Button>
      </div>
    </form>
  );
};
