import type {
  QuickPickBaseOptions,
  QuickPickManyOptions,
  QuickPickOption,
  QuickPickSelectionChange,
  QuickPickSelectionNormalizer,
  QuickPickSingleOptions,
  QuickPickSortOptions,
  QuickPickValueResult,
} from '../../quickinput/common/quickInput.js';

export interface BaseDialog {
  readonly title: string;
  readonly body?: string;
}

export interface ConfirmDialog extends BaseDialog {
  readonly type: 'confirm';
  readonly confirmText: string;
  readonly cancelText: string;
  readonly destructive: boolean;
  readonly resolve: (ok: boolean) => void;
}

export interface PromptDialog extends BaseDialog {
  readonly type: 'prompt';
  readonly label: string;
  readonly placeholder: string;
  readonly defaultValue: string;
  readonly confirmText: string;
  readonly cancelText: string;
  readonly validate?: (value: string) => string | null;
  readonly resolve: (value: string | null) => void;
}

export type PickOption = QuickPickOption;
export type PickSelectionChange = QuickPickSelectionChange;
export type PickValueResult = QuickPickValueResult;
export type BasePickOptions = QuickPickBaseOptions;
export type SinglePickOptions = QuickPickSingleOptions;
export type ManyPickOptions = QuickPickManyOptions;

export interface PickDialog extends BaseDialog {
  readonly type: 'pick';
  readonly placeholder: string;
  readonly emptyText: string;
  readonly options: readonly PickOption[];
  readonly canSelectMany: boolean;
  readonly selectedValues: readonly string[];
  readonly includeInputValue: boolean;
  readonly sortOptions?: QuickPickSortOptions;
  readonly normalizeSelectedValues?: QuickPickSelectionNormalizer;
  readonly resolve: (value: string | readonly string[] | PickValueResult | null) => void;
}

export type DialogState = ConfirmDialog | PromptDialog | PickDialog | null;

export interface ConfirmOptions {
  readonly title: string;
  readonly body?: string;
  readonly confirmText?: string;
  readonly cancelText?: string;
  readonly destructive?: boolean;
}

export interface PromptOptions {
  readonly title: string;
  readonly body?: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly confirmText?: string;
  readonly cancelText?: string;
  readonly validate?: (value: string) => string | null;
}

export function confirmDialogFromOptions(
  opts: ConfirmOptions,
  resolve: ConfirmDialog['resolve'],
): ConfirmDialog {
  return {
    type: 'confirm',
    title: opts.title,
    ...(opts.body !== undefined && { body: opts.body }),
    confirmText: opts.confirmText ?? 'Continue',
    cancelText: opts.cancelText ?? 'Cancel',
    destructive: opts.destructive ?? false,
    resolve,
  };
}

export function promptDialogFromOptions(
  opts: PromptOptions,
  resolve: PromptDialog['resolve'],
): PromptDialog {
  return {
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
  };
}

export function pickDialogFromOptions(
  opts: SinglePickOptions | ManyPickOptions,
  resolve: PickDialog['resolve'],
  includeInputValue = false,
): PickDialog {
  return {
    type: 'pick',
    title: opts.title,
    placeholder: opts.placeholder ?? 'Search…',
    emptyText: opts.emptyText ?? 'Nothing to choose from.',
    options: opts.options,
    canSelectMany: opts.canSelectMany === true,
    selectedValues: opts.canSelectMany === true ? (opts.selectedValues ?? []) : [],
    includeInputValue,
    ...(opts.canSelectMany !== true &&
      opts.sortOptions !== undefined && {
        sortOptions: opts.sortOptions,
      }),
    ...(opts.canSelectMany === true &&
      opts.normalizeSelectedValues !== undefined && {
        normalizeSelectedValues: opts.normalizeSelectedValues,
      }),
    resolve,
  };
}
