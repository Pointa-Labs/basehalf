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

export function pick(opts: SinglePickOptions): Promise<string | null>;
export function pick(opts: ManyPickOptions): Promise<readonly string[] | null>;
export function pick(
  opts: SinglePickOptions | ManyPickOptions,
): Promise<string | readonly string[] | null> {
  return new Promise((resolve) => {
    const resolvePick: PickDialog['resolve'] = (value) =>
      resolve(value as string | readonly string[] | null);
    useDialogStore.getState().show({
      type: 'pick',
      title: opts.title,
      placeholder: opts.placeholder ?? 'Search…',
      emptyText: opts.emptyText ?? 'Nothing to choose from.',
      options: opts.options,
      canSelectMany: opts.canSelectMany === true,
      selectedValues: opts.canSelectMany === true ? (opts.selectedValues ?? []) : [],
      includeInputValue: false,
      ...(opts.canSelectMany !== true &&
        opts.sortOptions !== undefined && {
          sortOptions: opts.sortOptions,
        }),
      ...(opts.canSelectMany === true &&
        opts.normalizeSelectedValues !== undefined && {
          normalizeSelectedValues: opts.normalizeSelectedValues,
        }),
      resolve: resolvePick,
    });
  });
}

export function pickWithInputValue(opts: SinglePickOptions): Promise<PickValueResult | null> {
  return new Promise((resolve) => {
    const resolvePick: PickDialog['resolve'] = (value) => resolve(value as PickValueResult | null);
    useDialogStore.getState().show({
      type: 'pick',
      title: opts.title,
      placeholder: opts.placeholder ?? 'Search…',
      emptyText: opts.emptyText ?? 'Nothing to choose from.',
      options: opts.options,
      canSelectMany: false,
      selectedValues: [],
      includeInputValue: true,
      ...(opts.sortOptions !== undefined && { sortOptions: opts.sortOptions }),
      resolve: resolvePick,
    });
  });
}

function activeHTMLElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function focusElementSafely(element: HTMLElement | null): void {
  if (element?.isConnected) element.focus({ preventScroll: true });
}
