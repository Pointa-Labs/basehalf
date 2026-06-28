import { useSyncExternalStore } from 'react';
import { quickInputService } from '../../../platform/quickinput/browser/quickInputService.js';

interface CommandPaletteStore {
  open: boolean;
  value: string;
  filterValue: string;
  providerId?: string;
  prefix: string;
  placeholder?: string;
  setOpen: (open: boolean) => void;
}

function setCommandPaletteOpen(open: boolean): void {
  if (open) quickInputService.quickAccess.show();
  else quickInputService.quickAccess.hide();
}

function snapshot(): CommandPaletteStore {
  const state = quickInputService.quickAccess.getState();
  return {
    open: state.visible,
    value: state.value,
    filterValue: state.filterValue,
    providerId: state.providerId,
    prefix: state.prefix,
    placeholder: state.placeholder,
    setOpen: setCommandPaletteOpen,
  };
}

export function useCommandPaletteStore<T>(selector: (store: CommandPaletteStore) => T): T {
  return useSyncExternalStore(
    (listener) => quickInputService.quickAccess.subscribe(listener),
    () => selector(snapshot()),
    () => selector(snapshot()),
  );
}

export function openCommandPalette(): void {
  quickInputService.quickAccess.show();
}

export function isCommandPaletteOpen(): boolean {
  return quickInputService.quickAccess.isVisible();
}

export function closeCommandPalette(): void {
  quickInputService.quickAccess.hide();
}
