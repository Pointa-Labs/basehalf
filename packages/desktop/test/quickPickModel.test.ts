import { describe, expect, it } from 'vitest';
import type { QuickPickOption } from '../src/platform/quickinput/common/quickInput.js';
import {
  filterQuickPickOptions,
  moveQuickPickActiveIndex,
  normalizeQuickPickSelectedValues,
  quickPickActiveOptionId,
  quickPickInitialActiveIndex,
  toggleQuickPickSelectedValue,
  updateQuickPickSelectedValues,
} from '../src/platform/quickinput/common/quickPickModel.js';

const options: readonly QuickPickOption[] = [
  { value: 'main', label: 'main', hint: 'origin/main' },
  { value: 'feature', label: 'feature/search', detail: 'local branch' },
  { value: 'create', label: 'Create new branch', alwaysShow: true },
];

describe('quickPickModel', () => {
  it('filters by label, hint, and detail while preserving alwaysShow options', () => {
    expect(filterQuickPickOptions('origin', options).map((option) => option.value)).toEqual([
      'main',
      'create',
    ]);
    expect(filterQuickPickOptions('local', options).map((option) => option.value)).toEqual([
      'feature',
      'create',
    ]);
    expect(filterQuickPickOptions('missing', options).map((option) => option.value)).toEqual([
      'create',
    ]);
  });

  it('delegates ordering before filtering', () => {
    const ordered = filterQuickPickOptions('', options, (_query, items) => [...items].reverse());

    expect(ordered.map((option) => option.value)).toEqual(['create', 'feature', 'main']);
  });

  it('models the active item cursor without wrapping', () => {
    expect(quickPickInitialActiveIndex(false)).toBe(0);
    expect(quickPickInitialActiveIndex(true)).toBeNull();
    expect(moveQuickPickActiveIndex(null, 3, 'next')).toBe(0);
    expect(moveQuickPickActiveIndex(null, 3, 'previous')).toBe(2);
    expect(moveQuickPickActiveIndex(2, 3, 'next')).toBe(2);
    expect(moveQuickPickActiveIndex(0, 3, 'previous')).toBe(0);
    expect(moveQuickPickActiveIndex(1, 3, 'first')).toBe(0);
    expect(moveQuickPickActiveIndex(1, 3, 'last')).toBe(2);
    expect(moveQuickPickActiveIndex(1, 0, 'next')).toBe(1);
  });

  it('only exposes an active option id when the cursor points at a visible item', () => {
    expect(quickPickActiveOptionId(1, options, 'row')).toBe('row-1');
    expect(quickPickActiveOptionId(null, options, 'row')).toBeUndefined();
    expect(quickPickActiveOptionId(9, options, 'row')).toBeUndefined();
  });

  it('normalizes multi-select values against available options', () => {
    expect(normalizeQuickPickSelectedValues(['main', 'missing', 'main'], options)).toEqual([
      'main',
    ]);
  });

  it('applies selection normalizers and preserves unique valid values', () => {
    const selected = updateQuickPickSelectedValues(
      ['main'],
      ['main', 'feature'],
      options,
      ({ addedValue }) => (addedValue === 'feature' ? ['feature', 'main', 'feature'] : []),
    );

    expect(selected).toEqual(['feature', 'main']);
  });

  it('toggles multi-select values through the same normalization path', () => {
    expect(toggleQuickPickSelectedValue('feature', ['main'], options)).toEqual(['main', 'feature']);
    expect(toggleQuickPickSelectedValue('main', ['main', 'feature'], options)).toEqual(['feature']);
  });
});
