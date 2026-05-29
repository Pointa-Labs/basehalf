/**
 * Select — a custom dropdown that matches the rest of the chrome.
 *
 * The native `<select>` styles look 1998-era on macOS Electron. This is
 * a hand-rolled menu: a Button-styled trigger + an absolutely-positioned
 * list with hover/selected states.
 *
 * Keep it simple: single-select, click-outside-to-close, Esc to close,
 * arrow-key navigation. Not trying to be Radix.
 */

import { type CSSProperties, type JSX, useEffect, useState } from 'react';
import { color, font, radius, shadow, space, transition } from '../../design.js';
import { PopoverSurface, usePopover } from './Popover.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

interface SelectProps {
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Minimum width of the trigger (so it doesn't collapse). */
  readonly minWidth?: number;
  readonly title?: string;
  /** Test hook for the Playwright driver. Becomes `data-testid` on the trigger. */
  readonly testId?: string;
}

const chevron = (
  <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden style={{ flexShrink: 0 }}>
    <path
      d="M2 4l3 3 3-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Select = ({
  value,
  options,
  onChange,
  placeholder = '—',
  disabled = false,
  minWidth = 160,
  title,
  testId,
}: SelectProps): JSX.Element => {
  const { open, toggle, close, triggerRef, floatingRef, coords } = usePopover({ disabled });
  const [hoverIdx, setHoverIdx] = useState<number>(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );

  const current = options.find((o) => o.value === value);
  const triggerLabel = current?.label ?? placeholder;

  // Arrow-key roving + Enter to pick. Esc / outside-click / positioning are
  // owned by usePopover; this effect adds only the Select-specific nav.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHoverIdx((i) => Math.min(options.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHoverIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const picked = options[hoverIdx];
        if (picked) {
          onChange(picked.value);
          close();
          triggerRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, options, hoverIdx, onChange, close, triggerRef]);

  // When opening, snap hover to the current value.
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      if (idx >= 0) setHoverIdx(idx);
    }
  }, [open, options, value]);

  // Keep the hovered option visible: when arrow-key navigation moves the
  // cursor past the menu's scrollable viewport, scroll the option into
  // view. block:'nearest' does the minimum scroll needed (doesn't recenter).
  useEffect(() => {
    if (!open) return;
    const option = floatingRef.current?.querySelector<HTMLElement>(
      `[data-bh-option-idx="${hoverIdx}"]`,
    );
    option?.scrollIntoView({ block: 'nearest' });
  }, [open, hoverIdx, floatingRef]);

  const triggerStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space[1.5],
    padding: `${space[1.5]}px ${space[2]}px ${space[1.5]}px ${space[3]}px`,
    fontSize: font.size.ui,
    fontFamily: font.sans,
    color: disabled ? color.textGhost : color.textPrimary,
    background: disabled ? color.surfaceMuted : color.surface,
    border: `1px solid ${color.borderStrong}`,
    borderRadius: radius.md,
    cursor: disabled ? 'not-allowed' : 'pointer',
    minWidth,
    justifyContent: 'space-between',
    outline: 'none',
    transition: transition(['background', 'border-color', 'box-shadow']),
    boxShadow: open ? shadow.focus : 'none',
  };

  return (
    <div style={{ display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => toggle()}
        title={title}
        data-testid={testId}
        style={triggerStyle}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: current ? color.textPrimary : color.textTertiary,
          }}
        >
          {triggerLabel}
        </span>
        <span style={{ color: color.textTertiary, display: 'flex', alignItems: 'center' }}>
          {chevron}
        </span>
      </button>
      {open && (
        <PopoverSurface
          coords={coords}
          floatingRef={floatingRef}
          role="listbox"
          style={{ minWidth: coords?.width, maxHeight: 320, overflowY: 'auto' }}
        >
          {options.map((opt, idx) => {
            const selected = opt.value === value;
            const hovered = idx === hoverIdx;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                data-bh-option-idx={idx}
                onMouseEnter={() => setHoverIdx(idx)}
                onClick={() => {
                  onChange(opt.value);
                  close();
                  triggerRef.current?.focus();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background: hovered ? color.accentSofter : 'transparent',
                  color: selected ? color.accent : color.textPrimary,
                  padding: `${space[1.5]}px ${space[2]}px`,
                  fontSize: font.size.ui,
                  fontFamily: font.sans,
                  fontWeight: selected ? font.weight.medium : font.weight.regular,
                  borderRadius: radius.sm,
                  cursor: 'pointer',
                  outline: 'none',
                  gap: space[2],
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {opt.label}
                </span>
                {opt.hint && (
                  <span
                    style={{
                      color: color.textTertiary,
                      fontSize: font.size.caption,
                      flexShrink: 0,
                    }}
                  >
                    {opt.hint}
                  </span>
                )}
                {selected && (
                  <svg
                    width={12}
                    height={12}
                    viewBox="0 0 12 12"
                    aria-hidden
                    style={{ flexShrink: 0 }}
                  >
                    <path
                      d="M2.5 6.5l2.5 2.5 5-5.5"
                      fill="none"
                      stroke={color.accent}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </PopoverSurface>
      )}
    </div>
  );
};
