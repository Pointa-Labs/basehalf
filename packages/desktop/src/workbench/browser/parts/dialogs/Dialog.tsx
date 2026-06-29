/**
 * Custom dialog host — replaces window.confirm / window.prompt.
 *
 * Native browser dialogs look like the 90s and break the rest of the polished
 * chrome. The promise-returning dialog service lives in platform/dialogs,
 * while this workbench part renders the active dialog at the root.
 */

import {
  type CSSProperties,
  type JSX,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  ConfirmDialog,
  PickDialog,
  PromptDialog,
} from '../../../../platform/dialogs/browser/dialogService.js';
import { useDialogStore } from '../../../../platform/dialogs/browser/dialogService.js';
export {
  confirm,
  pick,
  pickWithInputValue,
  prompt,
  type PickOption,
  type PickSelectionChange,
  type PickValueResult,
} from '../../../../platform/dialogs/browser/dialogService.js';
import {
  type IQuickInputButton,
  type IQuickPick,
  type IQuickPickItem,
  type IQuickPickSeparator,
  QuickPickFocus,
  isQuickPickSeparator,
  quickInputService,
} from '../../../../platform/quickinput/browser/quickInputService.js';
import {
  filterQuickPickOptions,
  moveQuickPickActiveIndex,
  normalizeQuickPickSelectedValues,
  quickPickActiveOptionId,
  quickPickInitialActiveIndex,
  toggleQuickPickSelectedValue,
} from '../../../../platform/quickinput/common/quickPickModel.js';
import { color, font, motion, radius, shadow, space, transition } from '../../style/design.js';
import { Codicon } from '../../ui/Codicon.js';
import { isImeComposing } from '../../ui/imeGuard.js';
import { Button } from '../../ui/primitives/Button.js';

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

const quickPickBackdropStyle: CSSProperties = {
  ...backdropStyle,
  alignItems: 'flex-start',
  paddingTop: 54,
  background: 'rgba(0, 0, 0, 0.18)',
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

const quickPickStyle: CSSProperties = {
  ...dialogStyle,
  minWidth: 560,
  maxWidth: 660,
  borderRadius: radius.md,
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
  const quickInputHostState = useSyncExternalStore(
    (listener) => quickInputService.subscribe(listener),
    () => quickInputService.getHostState(),
    () => quickInputService.getHostState(),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const activeQuickPick = current === null ? quickInputHostState.activeQuickPick : undefined;

  // Esc cancels + Tab/Shift+Tab cycle focus inside the dialog only.
  // Without the trap, Tab could move focus to background buttons (the
  // topbar buttons, sidebar rows, etc.) — confusing because the user
  // would lose track of "I'm in a modal."
  useEffect(() => {
    if (!current && activeQuickPick === undefined) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (isImeComposing(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (current) {
          resolveAndClose(current.type === 'confirm' ? false : null);
        } else {
          activeQuickPick?.hide();
        }
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
  }, [activeQuickPick, current, resolveAndClose]);

  if (!current && activeQuickPick === undefined) return null;
  return (
    <div
      ref={containerRef}
      style={
        current?.type === 'pick' || activeQuickPick !== undefined
          ? quickPickBackdropStyle
          : backdropStyle
      }
      onMouseDown={(e) => {
        // Click outside dismisses (treats as Cancel).
        if (e.target === e.currentTarget) {
          if (current) {
            resolveAndClose(current.type === 'confirm' ? false : null);
          } else {
            activeQuickPick?.hide();
          }
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bh-dialog-title"
    >
      {current === null ? (
        activeQuickPick !== undefined ? (
          <QuickPickBody picker={activeQuickPick} />
        ) : null
      ) : current.type === 'confirm' ? (
        <ConfirmBody dialog={current} onResolve={resolveAndClose} />
      ) : current.type === 'prompt' ? (
        <PromptBody dialog={current} onResolve={resolveAndClose} />
      ) : (
        <PickBody dialog={current} onResolve={resolveAndClose} />
      )}
    </div>
  );
};

type QuickPickHostRow =
  | {
      readonly kind: 'separator';
      readonly separator: IQuickPickSeparator;
      readonly visualIndex: number;
    }
  | {
      readonly kind: 'item';
      readonly item: IQuickPickItem;
      readonly visualIndex: number;
    };

export function quickPickHostRows(
  items: readonly (IQuickPickItem | IQuickPickSeparator)[],
): readonly QuickPickHostRow[] {
  return items.map((item, visualIndex) =>
    isQuickPickSeparator(item)
      ? { kind: 'separator', separator: item, visualIndex }
      : { kind: 'item', item, visualIndex },
  );
}

const quickPickButtonGroupStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 1,
  flexShrink: 0,
};

const quickPickButtonStyle: CSSProperties = {
  width: 22,
  height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: radius.sm,
  background: 'transparent',
  color: color.textTertiary,
  cursor: 'pointer',
};

const quickInputButtonLabel = (button: IQuickInputButton, index: number): string =>
  button.tooltip ?? button.iconClass ?? `Action ${index + 1}`;

const quickInputButtonCodiconName = (button: IQuickInputButton): string | undefined => {
  const iconClass = button.iconClass?.trim();
  if (!iconClass) return undefined;
  const codiconClass = iconClass.split(/\s+/).find((part) => part.startsWith('codicon-'));
  return codiconClass?.slice('codicon-'.length);
};

const QuickPickButtons = ({
  buttons,
  kind,
  push,
  onTrigger,
}: {
  buttons: readonly IQuickInputButton[] | undefined;
  kind: 'item' | 'separator';
  push: boolean;
  onTrigger: (button: IQuickInputButton) => void;
}): JSX.Element | null => {
  if (buttons === undefined || buttons.length === 0) return null;
  return (
    <span
      data-bh-pick-button-group={kind}
      style={{
        ...quickPickButtonGroupStyle,
        marginLeft: push ? 'auto' : 0,
      }}
    >
      {buttons.map((button, index) => {
        const label = quickInputButtonLabel(button, index);
        const codiconName = quickInputButtonCodiconName(button);
        return (
          <button
            key={`${button.iconClass ?? ''}:${button.tooltip ?? ''}:${index}`}
            type="button"
            title={label}
            aria-label={label}
            tabIndex={-1}
            data-bh-pick-item-button={kind === 'item' ? 'true' : undefined}
            data-bh-pick-separator-button={kind === 'separator' ? 'true' : undefined}
            style={quickPickButtonStyle}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTrigger(button);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = color.divider;
              e.currentTarget.style.color = color.textPrimary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = color.textTertiary;
            }}
          >
            {codiconName !== undefined ? (
              <Codicon name={codiconName} size={14} />
            ) : (
              <span className={button.iconClass} aria-hidden="true">
                {button.iconClass === undefined ? '·' : ''}
              </span>
            )}
          </button>
        );
      })}
    </span>
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

const QuickPickBody = ({
  picker,
}: {
  picker: IQuickPick<IQuickPickItem>;
}): JSX.Element => {
  const [, setVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = 'bh-pick-list';

  useEffect(() => {
    const bump = (): void => setVersion((version) => version + 1);
    const disposables = [
      picker.onDidChangeValue(bump),
      picker.onDidChangeActive(bump),
      picker.onDidChangeSelection(bump),
      picker.onDidHide(bump),
      picker.onDidFocus(() => inputRef.current?.focus()),
    ];
    inputRef.current?.focus();
    return () => {
      for (const dispose of disposables) dispose();
    };
  }, [picker]);

  const rows = quickPickHostRows(picker.items);
  const activeItem = picker.activeItems[0];
  const activeRow =
    activeItem === undefined
      ? undefined
      : rows.find((row) => row.kind === 'item' && row.item === activeItem);
  const activeIdx = activeRow?.visualIndex ?? null;
  const activeOptionId =
    activeIdx !== null && activeIdx >= 0 ? `bh-pick-option-${activeIdx}` : undefined;
  const selectedItems = useMemo(() => new Set(picker.selectedItems), [picker.selectedItems]);

  // Keep the highlighted row in view as the cursor moves past the fold.
  useEffect(() => {
    if (activeIdx === null || activeIdx < 0) return;
    const row = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const toggleItem = (item: IQuickPickItem): void => {
    picker.selectedItems = selectedItems.has(item)
      ? picker.selectedItems.filter((selectedItem) => selectedItem !== item)
      : [...picker.selectedItems, item];
  };

  const choose = (item: IQuickPickItem): void => {
    picker.activeItems = [item];
    if (picker.canSelectMany) {
      toggleItem(item);
      return;
    }
    picker.accept();
  };

  const emptyText =
    picker.value.trim() === '' ? (picker.emptyText ?? 'Nothing to choose from.') : 'No matches.';

  return (
    <div
      style={{
        ...quickPickStyle,
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: `${space[4]}px ${space[5]}px ${space[2]}px` }}>
        <div id="bh-dialog-title" style={titleStyle}>
          {picker.title}
        </div>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={picker.value}
        placeholder={picker.placeholder}
        spellCheck={false}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        onFocus={() => picker.focusOnInput()}
        onChange={(e) => {
          picker.value = e.target.value;
          setVersion((version) => version + 1);
        }}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return; // Enter picks a candidate, not a row
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            quickInputService.navigate(true);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            quickInputService.navigate(false);
          } else if (e.key === 'Home') {
            e.preventDefault();
            picker.focus(QuickPickFocus.First);
          } else if (e.key === 'End') {
            e.preventDefault();
            picker.focus(QuickPickFocus.Last);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            picker.accept();
          } else if (e.key === ' ' && picker.canSelectMany && activeItem !== undefined) {
            e.preventDefault();
            toggleItem(activeItem);
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
        id={listId}
        ref={listRef}
        role="listbox"
        aria-multiselectable={picker.canSelectMany || undefined}
        style={{
          marginTop: space[2],
          maxHeight: 320,
          overflowY: 'auto',
          padding: `0 ${space[3]}px ${space[3]}px`,
        }}
      >
        {rows.length === 0 ? (
          <div
            style={{
              padding: `${space[3]}px ${space[2]}px`,
              fontSize: font.size.caption,
              color: color.textTertiary,
            }}
          >
            {emptyText}
          </div>
        ) : (
          rows.map((row) => {
            if (row.kind === 'separator') {
              const label = row.separator.label ?? row.separator.description ?? '';
              return (
                <div
                  key={row.separator.id ?? `separator-${row.visualIndex}-${label}`}
                  role="separator"
                  aria-label={row.separator.ariaLabel ?? row.separator.label}
                  data-bh-pick-separator="true"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: space[2],
                    padding: `${space[2]}px ${space[2]}px ${space[1]}px`,
                    borderTop: row.visualIndex === 0 ? 'none' : `1px solid ${color.borderStrong}`,
                    color: color.textTertiary,
                    fontSize: font.size.caption,
                    fontWeight: font.weight.medium,
                    cursor: 'default',
                    userSelect: 'none',
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </span>
                  <QuickPickButtons
                    buttons={row.separator.buttons}
                    kind="separator"
                    push={true}
                    onTrigger={(button) => picker.triggerSeparatorButton(button, row.separator)}
                  />
                </div>
              );
            }
            const item = row.item;
            const checked = selectedItems.has(item);
            const active = item === activeItem;
            return (
              <div
                key={item.id ?? `${item.label}-${row.visualIndex}`}
                id={`bh-pick-option-${row.visualIndex}`}
                role={picker.canSelectMany ? 'checkbox' : 'option'}
                aria-checked={picker.canSelectMany ? checked : undefined}
                aria-selected={picker.canSelectMany ? undefined : active}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus on the input; don't blur-then-click
                  choose(item);
                }}
                onMouseMove={() => {
                  picker.activeItems = [item];
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: space[2],
                  padding: `${space[1.5]}px ${space[2]}px`,
                  borderRadius: radius.md,
                  cursor: 'pointer',
                  background: active ? color.accentSofter : checked ? color.divider : 'transparent',
                }}
              >
                {picker.canSelectMany && (
                  <input
                    type="checkbox"
                    checked={checked}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{
                      width: 13,
                      height: 13,
                      margin: 0,
                      flexShrink: 0,
                      accentColor: color.accent,
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: font.size.body,
                    color: color.textPrimary,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {item.label}
                </span>
                {item.description && (
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
                    {item.description}
                  </span>
                )}
                {item.detail && (
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
                    {item.detail}
                  </span>
                )}
                <QuickPickButtons
                  buttons={item.buttons}
                  kind="item"
                  push={item.detail === undefined}
                  onTrigger={(button) => picker.triggerItemButton(button, item)}
                />
              </div>
            );
          })
        )}
      </div>
      {picker.canSelectMany && (
        <div style={{ ...actionsStyle, margin: 0, padding: `${space[3]}px ${space[5]}px` }}>
          <Button variant="ghost" type="button" onClick={() => picker.hide()}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={() => picker.accept()}>
            {picker.okLabel ?? 'OK'}
          </Button>
        </div>
      )}
    </div>
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
  const [selectedIdx, setSelectedIdx] = useState<number | null>(
    quickPickInitialActiveIndex(dialog.canSelectMany),
  );
  const [selectedValues, setSelectedValues] = useState(() =>
    normalizeQuickPickSelectedValues(dialog.selectedValues, dialog.options),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = 'bh-pick-list';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(
    () => filterQuickPickOptions(query, dialog.options, dialog.sortOptions),
    [query, dialog.options, dialog.sortOptions],
  );

  // Reset the cursor to the top whenever the filtered set changes under it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: filtered length is the trigger; resetting on every keystroke is intended
  useEffect(() => {
    setSelectedIdx(quickPickInitialActiveIndex(dialog.canSelectMany));
  }, [filtered.length, dialog.canSelectMany]);

  // Keep the highlighted row in view as the cursor moves past the fold.
  useEffect(() => {
    if (selectedIdx === null) return;
    const row = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const selectedValueSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const toggleValue = (value: string): void => {
    setSelectedValues((previousValues) =>
      toggleQuickPickSelectedValue(
        value,
        previousValues,
        dialog.options,
        dialog.normalizeSelectedValues,
      ),
    );
  };

  const choose = (idx: number): void => {
    const opt = filtered[idx];
    if (!opt) return;
    if (dialog.canSelectMany) {
      toggleValue(opt.value);
      return;
    }
    onResolve(dialog.includeInputValue ? { value: opt.value, inputValue: query } : opt.value);
  };
  const activeOptionId = quickPickActiveOptionId(selectedIdx, filtered, 'bh-pick-option');

  return (
    <div
      style={{
        ...quickPickStyle,
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
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return; // Enter picks a candidate, not a row
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIdx((i) => moveQuickPickActiveIndex(i, filtered.length, 'next'));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIdx((i) => moveQuickPickActiveIndex(i, filtered.length, 'previous'));
          } else if (e.key === 'Home') {
            e.preventDefault();
            setSelectedIdx((i) => moveQuickPickActiveIndex(i, filtered.length, 'first'));
          } else if (e.key === 'End') {
            e.preventDefault();
            setSelectedIdx((i) => moveQuickPickActiveIndex(i, filtered.length, 'last'));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (dialog.canSelectMany) {
              onResolve(selectedValues);
            } else {
              if (selectedIdx !== null) choose(selectedIdx);
            }
          } else if (e.key === ' ' && dialog.canSelectMany && selectedIdx !== null) {
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
        id={listId}
        ref={listRef}
        role="listbox"
        aria-multiselectable={dialog.canSelectMany || undefined}
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
          filtered.map((opt, idx) => {
            const checked = selectedValueSet.has(opt.value);
            const active = idx === selectedIdx;
            return (
              <div
                key={opt.value}
                id={`bh-pick-option-${idx}`}
                role={dialog.canSelectMany ? 'checkbox' : 'option'}
                aria-checked={dialog.canSelectMany ? checked : undefined}
                aria-selected={dialog.canSelectMany ? undefined : active}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus on the input; don't blur-then-click
                  choose(idx);
                }}
                onMouseMove={() => setSelectedIdx(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: space[2],
                  padding: `${space[1.5]}px ${space[2]}px`,
                  borderRadius: radius.md,
                  cursor: 'pointer',
                  background: active ? color.accentSofter : checked ? color.divider : 'transparent',
                }}
              >
                {dialog.canSelectMany && (
                  <input
                    type="checkbox"
                    checked={checked}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{
                      width: 13,
                      height: 13,
                      margin: 0,
                      flexShrink: 0,
                      accentColor: color.accent,
                    }}
                  />
                )}
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
            );
          })
        )}
      </div>
      {dialog.canSelectMany && (
        <div style={{ ...actionsStyle, margin: 0, padding: `${space[3]}px ${space[5]}px` }}>
          <Button variant="ghost" type="button" onClick={() => onResolve(null)}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={() => onResolve(selectedValues)}>
            OK
          </Button>
        </div>
      )}
    </div>
  );
};
