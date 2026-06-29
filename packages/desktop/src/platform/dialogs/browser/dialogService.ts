import { create } from 'zustand';
import type {
  ConfirmOptions,
  DialogState,
  ManyPickOptions,
  PickDialog,
  PickValueResult,
  PromptOptions,
  SinglePickOptions,
} from '../common/dialogs.js';
import {
  confirmDialogFromOptions,
  pickDialogFromOptions,
  promptDialogFromOptions,
} from '../common/dialogs.js';

export type {
  ConfirmDialog,
  ConfirmOptions,
  DialogState,
  ManyPickOptions,
  PickDialog,
  PickOption,
  PickSelectionChange,
  PickValueResult,
  PromptDialog,
  PromptOptions,
  SinglePickOptions,
} from '../common/dialogs.js';

export interface DialogStore {
  readonly current: DialogState;
  readonly returnFocusElement: HTMLElement | null;
  readonly show: (dialog: NonNullable<DialogState>) => void;
  readonly resolveAndClose: (result: unknown) => void;
}

export const useDialogStore = create<DialogStore>((set, get) => ({
  current: null,
  returnFocusElement: null,
  show: (dialog) => set({ current: dialog, returnFocusElement: activeHTMLElement() }),
  resolveAndClose: (result) => {
    const { current, returnFocusElement } = get();
    if (!current) return;
    set({ current: null, returnFocusElement: null });
    current.resolve(result as never);
    queueMicrotask(() => {
      if (get().current === null) focusElementSafely(returnFocusElement);
    });
  },
}));

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().show(confirmDialogFromOptions(opts, resolve));
  });
}

export function prompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().show(promptDialogFromOptions(opts, resolve));
  });
}

export function pick(opts: SinglePickOptions): Promise<string | null>;
export function pick(opts: ManyPickOptions): Promise<readonly string[] | null>;
export function pick(
  opts: SinglePickOptions | ManyPickOptions,
): Promise<string | readonly string[] | null> {
  return new Promise((resolve) => {
    const resolvePick: PickDialog['resolve'] = (value) =>
      resolve(value as string | readonly string[] | null);
    useDialogStore.getState().show(pickDialogFromOptions(opts, resolvePick));
  });
}

export function pickWithInputValue(opts: SinglePickOptions): Promise<PickValueResult | null> {
  return new Promise((resolve) => {
    const resolvePick: PickDialog['resolve'] = (value) => resolve(value as PickValueResult | null);
    useDialogStore.getState().show(pickDialogFromOptions(opts, resolvePick, true));
  });
}

function activeHTMLElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function focusElementSafely(element: HTMLElement | null): void {
  if (element?.isConnected) element.focus({ preventScroll: true });
}
