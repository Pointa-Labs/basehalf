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
