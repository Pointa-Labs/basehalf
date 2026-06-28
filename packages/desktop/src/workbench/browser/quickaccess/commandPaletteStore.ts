import { create } from 'zustand';

interface CommandPaletteStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function openCommandPalette(): void {
  useCommandPaletteStore.getState().setOpen(true);
}

export function isCommandPaletteOpen(): boolean {
  return useCommandPaletteStore.getState().open;
}

export function closeCommandPalette(): void {
  useCommandPaletteStore.getState().setOpen(false);
}
