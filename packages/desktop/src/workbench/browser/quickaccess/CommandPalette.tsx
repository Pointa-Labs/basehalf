import { type JSX, useEffect, useState } from 'react';
import { CommandPaletteView } from './CommandPaletteView.js';
import { useCommandPaletteRows } from './commandPaletteActions.js';
import { useCommandPaletteController } from './commandPaletteController.js';
import { useCommandPaletteStore } from './commandPaletteStore.js';

/**
 * CommandPalette is now the thin workbench host for quick access.
 *
 * Mirroring VS Code's quickinput split, provider/action assembly lives in
 * `commandPaletteActions`, focus and keyboard state lives in
 * `commandPaletteController`, and this file only wires those parts to the view.
 * The host passes the quick access value/provider state through; provider
 * adapters decide what rows and async data they own.
 */
export const CommandPalette = (): JSX.Element | null => {
  const open = useCommandPaletteStore((s) => s.open);
  const quickAccessValue = useCommandPaletteStore((s) => s.value);
  const quickAccessFilterValue = useCommandPaletteStore((s) => s.filterValue);
  const quickAccessProviderId = useCommandPaletteStore((s) => s.providerId);
  const placeholder = useCommandPaletteStore((s) => s.placeholder);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const [query, setQuery] = useState('');
  const { rows, matchMap } = useCommandPaletteRows({
    open,
    providerId: quickAccessProviderId,
    value: quickAccessValue,
    query: quickAccessFilterValue,
  });
  useEffect(() => {
    if (open) setQuery(quickAccessValue);
  }, [open, quickAccessValue]);
  const controller = useCommandPaletteController({
    open,
    initialValue: quickAccessValue,
    query,
    rows,
    setOpen,
    setQuery,
  });

  if (!open) return null;

  return (
    <CommandPaletteView
      controller={controller}
      filterValue={quickAccessFilterValue}
      inputValue={query}
      matchMap={matchMap}
      placeholder={placeholder}
      rows={rows}
    />
  );
};
