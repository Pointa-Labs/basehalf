import type { IQuickAccessController } from './quickAccess.js';

export interface IQuickInputButton {
  readonly iconClass?: string;
  readonly tooltip?: string;
  readonly alwaysVisible?: boolean;
}

export interface IKeyMods {
  readonly ctrlCmd: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export const NO_KEY_MODS: IKeyMods = { ctrlCmd: false, alt: false, shift: false };

export const isKeyModified = (keyMods: IKeyMods): boolean =>
  keyMods.ctrlCmd || keyMods.alt || keyMods.shift;

export type QuickInputValidationSeverity = 'ignore' | 'info' | 'warning' | 'error';

export interface IQuickNavigateConfiguration {
  readonly keybindings: readonly unknown[];
}

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
  readonly id?: string;
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly ariaLabel?: string;
  readonly alwaysShow?: boolean;
  readonly picked?: boolean;
  readonly buttons?: readonly IQuickInputButton[];
  readonly tooltip?: string;
  readonly iconClasses?: readonly string[];
  readonly highlights?: readonly [number, number][];
  readonly descriptionHighlights?: readonly [number, number][];
  readonly detailHighlights?: readonly [number, number][];
  readonly sortText?: string;
  readonly pickable?: boolean;
}

export interface IQuickPickSeparator {
  readonly type: 'separator';
  readonly id?: string;
  readonly label?: string;
  readonly description?: string;
  readonly ariaLabel?: string;
  readonly buttons?: readonly IQuickInputButton[];
  readonly tooltip?: string;
}

export type QuickPickItemOrSeparator<T extends IQuickPickItem> = T | IQuickPickSeparator;

export const isQuickPickSeparator = <T extends IQuickPickItem>(
  item: QuickPickItemOrSeparator<T>,
): item is IQuickPickSeparator => 'type' in item && item.type === 'separator';

export const isQuickPickItem = <T extends IQuickPickItem>(
  item: QuickPickItemOrSeparator<T>,
): item is T => !isQuickPickSeparator(item);

export interface IQuickPickWillAcceptEvent {
  veto(): void;
}

export interface IQuickPickDidAcceptEvent {
  readonly inBackground: boolean;
}

export enum ItemActivation {
  NONE = 0,
  FIRST = 1,
  SECOND = 2,
  LAST = 3,
}

export enum QuickPickFocus {
  First = 1,
  Second = 2,
  Last = 3,
  Next = 4,
  Previous = 5,
  NextPage = 6,
  PreviousPage = 7,
  NextSeparator = 8,
  PreviousSeparator = 9,
}

export interface IQuickPickItemButtonEvent<T extends IQuickPickItem> {
  readonly button: IQuickInputButton;
  readonly item: T;
}

export interface IQuickPickSeparatorButtonEvent {
  readonly button: IQuickInputButton;
  readonly separator: IQuickPickSeparator;
}

export interface IQuickPick<T extends IQuickPickItem = IQuickPickItem> {
  value: string;
  filterValue: (value: string) => string;
  ariaLabel?: string;
  placeholder?: string;
  prompt?: string;
  items: readonly QuickPickItemOrSeparator<T>[];
  activeItems: readonly T[];
  selectedItems: readonly T[];
  canSelectMany: boolean;
  canAcceptInBackground: boolean;
  ok: boolean | 'default';
  okLabel?: string;
  customButton: boolean;
  customLabel?: string;
  customHover?: string;
  customButtonSecondary?: boolean;
  matchOnDescription: boolean;
  matchOnDetail: boolean;
  matchOnLabel: boolean;
  matchOnLabelMode: 'fuzzy' | 'contiguous';
  sortByLabel: boolean;
  keepScrollPosition: boolean;
  quickNavigate?: IQuickNavigateConfiguration;
  itemActivation: ItemActivation;
  readonly keyMods: IKeyMods;
  valueSelection?: readonly [number, number];
  validationMessage?: string;
  severity: QuickInputValidationSeverity;
  busy: boolean;
  enabled: boolean;
  contextKey?: string;
  ignoreFocusOut: boolean;
  hideInput: boolean;
  hideCountBadge: boolean;
  hideCheckAll: boolean;
  readonly visible: boolean;
  readonly disposed: boolean;
  show(): void;
  hide(): void;
  focus(): void;
  focus(focus: QuickPickFocus): void;
  focusOnInput(): void;
  inputHasFocus(): boolean;
  accept(inBackground?: boolean): void;
  dispose(): void;
  onDidChangeValue(listener: (value: string) => void): () => void;
  onDidChangeActive(listener: (items: readonly T[]) => void): () => void;
  onDidChangeSelection(listener: (items: readonly T[]) => void): () => void;
  onWillAccept(listener: (event: IQuickPickWillAcceptEvent) => void): () => void;
  onDidAccept(listener: (event: IQuickPickDidAcceptEvent) => void): () => void;
  onDidCustom(listener: () => void): () => void;
  onDidTriggerItemButton(listener: (event: IQuickPickItemButtonEvent<T>) => void): () => void;
  onDidTriggerSeparatorButton(
    listener: (event: IQuickPickSeparatorButtonEvent) => void,
  ): () => void;
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
