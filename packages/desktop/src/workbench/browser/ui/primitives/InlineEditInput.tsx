/**
 * InlineEditInput — the reusable in-place rename/new-name field.
 *
 * Extracted from NoteTitle's commit machine so the sidebar tree and the canvas
 * cards share ONE tested rule instead of re-implementing the cancelRef dance:
 *  - blur is the single commit path (Enter blurs → commits; click-away commits);
 *  - Escape cancels (discard, no commit);
 *  - an empty/whitespace value is treated as a cancel (never commit a blank name);
 *  - IME-guarded so an Enter/Escape that's really confirming/cancelling a pinyin
 *    candidate doesn't prematurely commit or cancel.
 *
 * Stateless about WHAT it edits — callers wire `onCommit(value)` to a rename /
 * create action and `onCancel` to tear down the edit affordance.
 */

import { type CSSProperties, type JSX, useEffect, useRef, useState } from 'react';
import { isImeComposing } from '../imeGuard.js';

interface InlineEditInputProps {
  readonly initialValue: string;
  /** Called with the trimmed value when the user commits a non-empty name. */
  readonly onCommit: (value: string) => void;
  /** Called on Escape, or on commit of an empty/unchanged value. */
  readonly onCancel: () => void;
  /** Select the text on mount (rename) vs place the cursor at the end (new). */
  readonly selectOnMount?: boolean;
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

export const InlineEditInput = ({
  initialValue,
  onCommit,
  onCancel,
  selectOnMount = true,
  placeholder,
  ariaLabel,
  style,
  testId,
}: InlineEditInputProps): JSX.Element => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  // Single commit path through blur: Escape sets this so blur discards.
  const cancelRef = useRef(false);
  // Guard against the commit-then-onCancel-cleanup blurring us a second time.
  const doneRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only focus/select
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (selectOnMount) el.select();
    else el.setSelectionRange(value.length, value.length);
  }, [selectOnMount]);

  const finish = (): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (cancelRef.current) {
      onCancel();
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === initialValue.trim()) {
      onCancel();
      return;
    }
    onCommit(trimmed);
  };

  return (
    <input
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellCheck={false}
      data-testid={testId}
      // Clicking the field shouldn't bubble to a row select / canvas pan.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          inputRef.current?.blur(); // → onBlur commits
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelRef.current = true;
          inputRef.current?.blur(); // → onBlur discards
        }
      }}
      style={style}
    />
  );
};
