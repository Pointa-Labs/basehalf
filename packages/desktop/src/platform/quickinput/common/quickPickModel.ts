import type {
  IQuickPickItem,
  QuickPickItemOrSeparator,
  QuickPickOption,
  QuickPickSelectionNormalizer,
  QuickPickSortOptions,
} from './quickInput.js';

export type QuickPickActiveIndex = number | null;

export function quickPickInitialActiveIndex(canSelectMany: boolean): QuickPickActiveIndex {
  return canSelectMany ? null : 0;
}

export function quickPickActiveOptionId(
  activeIndex: QuickPickActiveIndex,
  options: readonly QuickPickOption[],
  idPrefix: string,
): string | undefined {
  return activeIndex !== null && options[activeIndex] !== undefined
    ? `${idPrefix}-${activeIndex}`
    : undefined;
}

export function filterQuickPickOptions(
  query: string,
  options: readonly QuickPickOption[],
  sortOptions?: QuickPickSortOptions,
): readonly QuickPickOption[] {
  const orderedOptions = sortOptions?.(query, options) ?? options;
  const needle = query.trim().toLowerCase();
  if (needle === '') return orderedOptions;

  return orderedOptions.filter(
    (option) =>
      option.alwaysShow === true ||
      option.label.toLowerCase().includes(needle) ||
      (option.hint?.toLowerCase().includes(needle) ?? false) ||
      (option.detail?.toLowerCase().includes(needle) ?? false),
  );
}

export function quickPickItemsWithSeparators<T extends IQuickPickItem>(
  options: readonly QuickPickOption[],
  itemForOption: (option: QuickPickOption) => T | undefined,
): readonly QuickPickItemOrSeparator<T>[] {
  const items: QuickPickItemOrSeparator<T>[] = [];
  let currentSeparator: string | undefined;

  for (const option of options) {
    const item = itemForOption(option);
    if (item === undefined) continue;

    if (option.separator !== currentSeparator) {
      currentSeparator = option.separator;
      if (currentSeparator !== undefined) {
        items.push({ type: 'separator', label: currentSeparator });
      }
    }

    items.push(item);
  }

  return items;
}

export function moveQuickPickActiveIndex(
  activeIndex: QuickPickActiveIndex,
  optionCount: number,
  direction: 'next' | 'previous' | 'first' | 'last',
): QuickPickActiveIndex {
  if (optionCount <= 0) return activeIndex;

  if (direction === 'first') return 0;
  if (direction === 'last') return optionCount - 1;
  if (direction === 'next') {
    return activeIndex === null ? 0 : Math.min(activeIndex + 1, optionCount - 1);
  }
  return activeIndex === null ? optionCount - 1 : Math.max(activeIndex - 1, 0);
}

export function normalizeQuickPickSelectedValues(
  selectedValues: readonly string[],
  options: readonly QuickPickOption[],
): string[] {
  const validValues = new Set(options.map((option) => option.value));
  return uniqueQuickPickValues(selectedValues.filter((value) => validValues.has(value)));
}

export function updateQuickPickSelectedValues(
  previousValues: readonly string[],
  nextValues: readonly string[],
  options: readonly QuickPickOption[],
  normalizeSelectedValues?: QuickPickSelectionNormalizer,
): string[] {
  const addedValue = nextValues.find((value) => !previousValues.includes(value));
  const normalizedValues =
    normalizeSelectedValues?.({
      previousValues,
      nextValues,
      ...(addedValue !== undefined ? { addedValue } : {}),
    }) ?? nextValues;
  return normalizeQuickPickSelectedValues(normalizedValues, options);
}

export function toggleQuickPickSelectedValue(
  value: string,
  selectedValues: readonly string[],
  options: readonly QuickPickOption[],
  normalizeSelectedValues?: QuickPickSelectionNormalizer,
): string[] {
  const selectedValueSet = new Set(selectedValues);
  const nextValues = selectedValueSet.has(value)
    ? selectedValues.filter((selectedValue) => selectedValue !== value)
    : [...selectedValues, value];
  return updateQuickPickSelectedValues(
    selectedValues,
    nextValues,
    options,
    normalizeSelectedValues,
  );
}

export function uniqueQuickPickValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
