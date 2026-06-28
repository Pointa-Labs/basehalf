import type { IQuickAccessController } from './quickAccess.js';

export interface QuickPickOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
  readonly detail?: string;
  readonly alwaysShow?: boolean;
}

export interface QuickPickSelectionChange {
  readonly previousValues: readonly string[];
  readonly nextValues: readonly string[];
  readonly addedValue?: string;
}

export interface QuickPickValueResult {
  readonly value: string;
  readonly inputValue: string;
}

export type QuickPickSortOptions = (
  query: string,
  options: readonly QuickPickOption[],
) => readonly QuickPickOption[];

export type QuickPickSelectionNormalizer = (
  selection: QuickPickSelectionChange,
) => readonly string[];

export interface QuickPickBaseOptions {
  readonly title: string;
  readonly placeholder?: string;
  readonly emptyText?: string;
  readonly options: readonly QuickPickOption[];
}

export interface QuickPickSingleOptions extends QuickPickBaseOptions {
  readonly canSelectMany?: false;
  readonly sortOptions?: QuickPickSortOptions;
}

export interface QuickPickManyOptions extends QuickPickBaseOptions {
  readonly canSelectMany: true;
  readonly selectedValues?: readonly string[];
  readonly normalizeSelectedValues?: QuickPickSelectionNormalizer;
}

export type QuickPickOptions = QuickPickSingleOptions | QuickPickManyOptions;

export interface IQuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly alwaysShow?: boolean;
  readonly picked?: boolean;
}

export interface IQuickPickSeparator {
  readonly type: 'separator';
  readonly label?: string;
}

export interface IQuickPick<T extends IQuickPickItem = IQuickPickItem> {
  value: string;
  placeholder?: string;
  items: readonly T[];
  activeItems: readonly T[];
  selectedItems: readonly T[];
  canSelectMany: boolean;
  busy: boolean;
  enabled: boolean;
  readonly visible: boolean;
  readonly disposed: boolean;
  show(): void;
  hide(): void;
  focus(): void;
  accept(): void;
  dispose(): void;
  onDidChangeValue(listener: (value: string) => void): () => void;
  onDidChangeActive(listener: (items: readonly T[]) => void): () => void;
  onDidChangeSelection(listener: (items: readonly T[]) => void): () => void;
  onDidAccept(listener: () => void): () => void;
  onDidHide(listener: () => void): () => void;
  onDidFocus(listener: () => void): () => void;
}

export interface CreateQuickPickOptions {
  readonly useSeparators?: boolean;
}

export interface IQuickInputService {
  readonly quickAccess: IQuickAccessController;
  createQuickPick<T extends IQuickPickItem>(options?: CreateQuickPickOptions): IQuickPick<T>;
  focus(): void;
  navigate(next: boolean): void;
  accept(): void;
  cancel(): void;
  pick(opts: QuickPickSingleOptions): Promise<string | null>;
  pick(opts: QuickPickManyOptions): Promise<readonly string[] | null>;
  pick(
    opts: QuickPickSingleOptions | QuickPickManyOptions,
  ): Promise<string | readonly string[] | null>;
  pickWithInputValue(opts: QuickPickSingleOptions): Promise<QuickPickValueResult | null>;
}
