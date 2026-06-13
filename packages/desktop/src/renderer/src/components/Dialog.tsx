/**
 * Custom dialog system — replaces window.confirm / window.prompt.
 *
 * Native browser dialogs look like the 90s and break the rest of the
 * polished chrome. This module exposes two Promise-returning helpers
 * (confirm / prompt) and a single `<DialogHost />` that App mounts at
 * the root. State lives in a Zustand store so the helpers can be called
 * from anywhere without prop-drilling a context.
 */

import { type CSSProperties, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { color, font, motion, radius, shadow, space, transition } from '../design.js';
import { isImeComposing } from '../lib/imeGuard.js';
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

/** One row in a `pick` dialog. `value` is what resolves; the rest is display. */
export interface PickOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
  readonly detail?: string;
}

interface PickDialog extends BaseDialog {
  readonly type: 'pick';
  readonly placeholder: string;
  readonly emptyText: string;
  readonly options: readonly PickOption[];
  readonly resolve: (value: string | null) => void;
}

type DialogState = ConfirmDialog | PromptDialog | PickDialog | null;

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

interface PickOptions {
  readonly title: string;
  readonly placeholder?: string;
  readonly emptyText?: string;
  readonly options: readonly PickOption[];
}

/** Search-and-pick from a list. Resolves the chosen option's `value`, or null
 *  if dismissed. Caller supplies the options (and their display fields) — the
 *  dialog stays generic, owning only the search/keyboard/selection mechanics. */
export function pick(opts: PickOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().show({
      type: 'pick',
      title: opts.title,
      placeholder: opts.placeholder ?? 'Search…',
      emptyText: opts.emptyText ?? 'Nothing to choose from.',
      options: opts.options,
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
      ) : current.type === 'prompt' ? (
        <PromptBody dialog={current} onResolve={resolveAndClose} />
      ) : (
        <PickBody dialog={current} onResolve={resolveAndClose} />
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

const PickBody = ({
  dialog,
  onResolve,
}: {
  dialog: PickDialog;
  onResolve: (result: unknown) => void;
}): JSX.Element => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return dialog.options;
    return dialog.options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint?.toLowerCase().includes(q) ?? false) ||
        (o.detail?.toLowerCase().includes(q) ?? false),
    );
  }, [query, dialog.options]);

  // Reset the cursor to the top whenever the filtered set changes under it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: filtered length is the trigger; resetting on every keystroke is intended
  useEffect(() => {
    setSelectedIdx(0);
  }, [filtered.length]);

  // Keep the highlighted row in view as the cursor moves past the fold.
  useEffect(() => {
    const row = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const choose = (idx: number): void => {
    const opt = filtered[idx];
    if (opt) onResolve(opt.value);
  };

  return (
    <div
      style={{
        ...dialogStyle,
        minWidth: 460,
        maxWidth: 560,
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: `${space[4]}px ${space[5]}px ${space[2]}px` }}>
        <div id="bh-dialog-title" style={titleStyle}>
          {dialog.title}
        </div>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={dialog.placeholder}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return; // Enter picks a candidate, not a row
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(selectedIdx);
          }
        }}
        style={{
          margin: `0 ${space[5]}px`,
          padding: `${space[2]}px ${space[3]}px`,
          fontSize: font.size.body,
          fontFamily: font.sans,
          color: color.textPrimary,
          background: color.bg,
          border: `1px solid ${color.borderStrong}`,
          borderRadius: radius.md,
          outline: 'none',
        }}
      />
      <div
        ref={listRef}
        style={{
          marginTop: space[2],
          maxHeight: 320,
          overflowY: 'auto',
          padding: `0 ${space[3]}px ${space[3]}px`,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: `${space[3]}px ${space[2]}px`,
              fontSize: font.size.caption,
              color: color.textTertiary,
            }}
          >
            {dialog.options.length === 0 ? dialog.emptyText : 'No matches.'}
          </div>
        ) : (
          filtered.map((opt, idx) => (
            <div
              key={opt.value}
              role="option"
              aria-selected={idx === selectedIdx}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus on the input; don't blur-then-click
                choose(idx);
              }}
              onMouseMove={() => setSelectedIdx(idx)}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: space[2],
                padding: `${space[1.5]}px ${space[2]}px`,
                borderRadius: radius.md,
                cursor: 'pointer',
                background: idx === selectedIdx ? color.accentSofter : 'transparent',
              }}
            >
              <span
                style={{
                  fontSize: font.size.body,
                  color: color.textPrimary,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {opt.label}
              </span>
              {opt.hint && (
                <span
                  style={{
                    fontSize: font.size.caption,
                    fontFamily: font.mono,
                    color: color.textTertiary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {opt.hint}
                </span>
              )}
              {opt.detail && (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: font.size.caption,
                    color: color.textGhost,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '45%',
                  }}
                >
                  {opt.detail}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
