import {
  DefaultQuickAccessFilterValue,
  type IQuickAccessController,
  type IQuickAccessProvider,
  type QuickAccessControllerListener,
  type QuickAccessControllerState,
  type QuickAccessOptions,
  type QuickAccessProviderDescriptor,
  type QuickAccessProviderDisposable,
  type QuickAccessRegistryLike,
  quickAccessRegistry,
} from '../common/quickAccess.js';
import {
  QuickAccessCancellationTokenSource,
  closedQuickAccessState,
  quickAccessStatesEqual,
  valueSelectionForQuickAccess,
} from '../common/quickAccessModel.js';
import { type IQuickPick, type IQuickPickItem, ItemActivation } from '../common/quickInput.js';

interface QuickAccessQuickInputService {
  createQuickPick<T extends IQuickPickItem>(options?: {
    readonly useSeparators?: boolean;
  }): IQuickPick<T>;
}

interface VisibleQuickAccessProviderRun {
  readonly descriptor: QuickAccessProviderDescriptor;
  readonly picker: IQuickPick<IQuickPickItem>;
  readonly cancellation: QuickAccessCancellationTokenSource;
  readonly disposable: QuickAccessProviderDisposable;
  readonly unsubscribeHide: () => void;
  readonly unsubscribeValue: () => void;
  readonly unsubscribeAccept: () => void;
  pickSession?: VisibleQuickAccessPickSession;
}

interface VisibleQuickAccessPickSession {
  readonly promise: Promise<readonly IQuickPickItem[] | undefined>;
  unsubscribeWillAccept: () => void;
  acceptedItems?: readonly IQuickPickItem[];
  settled: boolean;
  resolve: (items: readonly IQuickPickItem[] | undefined) => void;
}

/**
 * Minimal quick access controller surface.
 *
 * VS Code keeps quick access opening/picking on a platform controller instead of
 * importing the workbench widget from commands. Our React widget subscribes to
 * this small controller while commands and title-bar chrome call `show`.
 */
export class QuickAccessController implements IQuickAccessController {
  private state: QuickAccessControllerState = closedQuickAccessState();
  private readonly listeners = new Set<QuickAccessControllerListener>();
  private readonly lastAcceptedValues = new Map<QuickAccessProviderDescriptor, string>();
  private readonly providerInstances = new Map<
    QuickAccessProviderDescriptor,
    IQuickAccessProvider
  >();
  private visibleProviderRun: VisibleQuickAccessProviderRun | undefined;
  private visibleOptions: QuickAccessOptions = {};

  constructor(
    private readonly registry: QuickAccessRegistryLike = quickAccessRegistry,
    private readonly quickInputService?: QuickAccessQuickInputService,
  ) {}

  getState(): QuickAccessControllerState {
    return this.state;
  }

  isVisible(): boolean {
    return this.state.visible;
  }

  show(value = '', options: QuickAccessOptions = {}): void {
    this.showOrPick(value, options, false);
  }

  pick(
    value = '',
    options: QuickAccessOptions = {},
  ): Promise<readonly IQuickPickItem[] | undefined> {
    return this.showOrPick(value, options, true) ?? Promise.resolve(undefined);
  }

  private showOrPick(value: string, options: QuickAccessOptions, pick: false): void;
  private showOrPick(
    value: string,
    options: QuickAccessOptions,
    pick: true,
  ): Promise<readonly IQuickPickItem[] | undefined> | undefined;
  private showOrPick(
    value: string,
    options: QuickAccessOptions,
    pick: boolean,
  ): Promise<readonly IQuickPickItem[] | undefined> | undefined {
    this.visibleOptions = options;
    const descriptor = this.providerForValue(value, options.enabledProviderPrefixes);
    const nextValue = this.valueForShow(value, descriptor, options);
    this.setOpenState(descriptor, nextValue, options);
    return this.syncProviderRun(descriptor, nextValue, options, pick);
  }

  updateValue(value: string): void {
    if (!this.state.visible) return;
    const descriptor = this.providerForValue(value, this.visibleOptions.enabledProviderPrefixes);
    this.setOpenState(descriptor, value, {
      ...this.visibleOptions,
      preserveValue: true,
    });
    this.syncProviderRun(descriptor, value, this.visibleOptions, false);
  }

  hide(): void {
    this.visibleOptions = {};
    this.disposeProviderRun();
    this.setState(closedQuickAccessState());
  }

  toggle(value = '', options: QuickAccessOptions = {}): void {
    if (this.state.visible) this.hide();
    else this.show(value, options);
  }

  accept(value = this.state.value): void {
    const descriptor =
      this.visibleProviderRun?.descriptor ??
      this.providerForValue(value, this.visibleOptions.enabledProviderPrefixes);
    if (descriptor !== undefined) {
      this.lastAcceptedValues.set(descriptor, value);
    }
  }

  subscribe(listener: QuickAccessControllerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(state: QuickAccessControllerState): void {
    if (quickAccessStatesEqual(this.state, state)) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private setOpenState(
    descriptor: QuickAccessProviderDescriptor | undefined,
    value: string,
    options: QuickAccessOptions,
  ): void {
    const prefix = descriptor?.prefix ?? '';
    this.setState({
      visible: true,
      value,
      filterValue: value.slice(prefix.length),
      providerId: descriptor?.id,
      prefix,
      placeholder: options.placeholder ?? descriptor?.placeholder,
      valueSelection: valueSelectionForQuickAccess(value, prefix, options),
    });
  }

  private syncProviderRun(
    descriptor: QuickAccessProviderDescriptor | undefined,
    value: string,
    options: QuickAccessOptions,
    pick: boolean,
  ): Promise<readonly IQuickPickItem[] | undefined> | undefined {
    const provider = this.providerForDescriptor(descriptor);
    if (
      descriptor === undefined ||
      provider === undefined ||
      this.quickInputService === undefined
    ) {
      this.disposeProviderRun();
      return pick ? Promise.resolve(undefined) : undefined;
    }

    if (this.visibleProviderRun?.descriptor === descriptor) {
      this.applyPickerState(this.visibleProviderRun.picker, descriptor, value, options);
      return pick ? this.installPickSession(this.visibleProviderRun) : undefined;
    }

    const hadVisibleProviderRun = this.visibleProviderRun !== undefined;
    this.disposeProviderRun();
    const picker = this.quickInputService.createQuickPick({ useSeparators: true });
    const cancellation = new QuickAccessCancellationTokenSource();
    this.applyPickerState(picker, descriptor, value, options, hadVisibleProviderRun);
    const pickSession = pick ? this.createPickSession(picker) : undefined;
    const unsubscribeHide = picker.onDidHide(() => {
      const run = this.visibleProviderRun;
      if (run?.picker === picker) {
        this.resolvePickSession(run);
        this.hide();
      }
    });
    const unsubscribeValue = picker.onDidChangeValue((nextValue) => {
      this.updateValue(nextValue);
    });
    const unsubscribeAccept = picker.onDidAccept((event) => {
      this.accept(picker.value);
      const active = picker.activeItems[0];
      if (active !== undefined) {
        options.providerOptions?.handleAccept?.(active, event.inBackground);
      }
    });
    let disposable: QuickAccessProviderDisposable;
    try {
      disposable = provider.provide(picker, cancellation.token, options.providerOptions);
    } catch (err) {
      pickSession?.unsubscribeWillAccept();
      pickSession?.resolve(undefined);
      unsubscribeHide();
      unsubscribeValue();
      unsubscribeAccept();
      cancellation.cancel();
      if (picker.visible) picker.hide();
      if (!picker.disposed) picker.dispose();
      throw err;
    }
    const run: VisibleQuickAccessProviderRun = {
      descriptor,
      picker,
      cancellation,
      disposable,
      unsubscribeHide,
      unsubscribeValue,
      unsubscribeAccept,
      ...(pickSession !== undefined && { pickSession }),
    };
    this.visibleProviderRun = run;
    picker.show();
    return pickSession?.promise;
  }

  private applyPickerState(
    picker: IQuickPick<IQuickPickItem>,
    descriptor: QuickAccessProviderDescriptor,
    value: string,
    options: QuickAccessOptions,
    hadVisibleProviderRun = true,
  ): void {
    if (picker.value !== value) picker.value = value;
    picker.filterValue = (nextValue) => nextValue.slice(descriptor.prefix.length);
    picker.valueSelection = valueSelectionForQuickAccess(value, descriptor.prefix, options);
    picker.placeholder = options.placeholder ?? descriptor.placeholder;
    picker.contextKey = descriptor.contextKey;
    picker.quickNavigate = options.quickNavigateConfiguration;
    picker.hideInput = options.quickNavigateConfiguration !== undefined && !hadVisibleProviderRun;
    if (options.itemActivation !== undefined || options.quickNavigateConfiguration !== undefined) {
      picker.itemActivation = options.itemActivation ?? ItemActivation.SECOND;
    }
  }

  private disposeProviderRun(): void {
    const run = this.visibleProviderRun;
    if (run === undefined) return;
    this.visibleProviderRun = undefined;
    this.resolvePickSession(run);
    run.unsubscribeHide();
    run.unsubscribeValue();
    run.unsubscribeAccept();
    run.cancellation.cancel();
    run.disposable.dispose();
    if (run.picker.visible) run.picker.hide();
    if (!run.picker.disposed) run.picker.dispose();
  }

  private providerForValue(
    value: string,
    enabledProviderPrefixes?: readonly string[],
  ): QuickAccessProviderDescriptor | undefined {
    const descriptor = this.registry.getQuickAccessProvider(value);
    if (
      descriptor === undefined ||
      (enabledProviderPrefixes !== undefined &&
        !enabledProviderPrefixes.includes(descriptor.prefix))
    ) {
      return undefined;
    }
    return descriptor;
  }

  private providerForDescriptor(
    descriptor: QuickAccessProviderDescriptor | undefined,
  ): IQuickAccessProvider | undefined {
    if (descriptor === undefined) return undefined;
    if (descriptor.provider !== undefined) return descriptor.provider;

    let provider = this.providerInstances.get(descriptor);
    if (provider !== undefined) return provider;

    if (descriptor.factory !== undefined) {
      provider = descriptor.factory();
    } else if (descriptor.ctor !== undefined) {
      provider = new descriptor.ctor();
    }

    if (provider !== undefined) {
      this.providerInstances.set(descriptor, provider);
    }
    return provider;
  }

  private valueForShow(
    value: string,
    descriptor: QuickAccessProviderDescriptor | undefined,
    options: QuickAccessOptions,
  ): string {
    if (descriptor === undefined || options.preserveValue === true) return value;
    if (value !== descriptor.prefix) return value;

    const defaultFilterValue =
      descriptor.defaultFilterValue ?? this.providerForDescriptor(descriptor)?.defaultFilterValue;
    if (defaultFilterValue === DefaultQuickAccessFilterValue.LAST) {
      return this.lastAcceptedValues.get(descriptor) ?? value;
    }
    if (typeof defaultFilterValue === 'string') return `${descriptor.prefix}${defaultFilterValue}`;
    return value;
  }

  private installPickSession(
    run: VisibleQuickAccessProviderRun,
  ): Promise<readonly IQuickPickItem[] | undefined> {
    this.resolvePickSession(run);
    const session = this.createPickSession(run.picker);
    run.pickSession = session;
    return session.promise;
  }

  private createPickSession(picker: IQuickPick<IQuickPickItem>): VisibleQuickAccessPickSession {
    let resolveSession!: (items: readonly IQuickPickItem[] | undefined) => void;
    const promise = new Promise<readonly IQuickPickItem[] | undefined>((resolve) => {
      resolveSession = resolve;
    });
    const session: VisibleQuickAccessPickSession = {
      promise,
      unsubscribeWillAccept: () => {},
      settled: false,
      resolve: resolveSession,
    };
    session.unsubscribeWillAccept = picker.onWillAccept((event) => {
      event.veto();
      session.acceptedItems = pickedQuickAccessItems(picker);
      picker.hide();
    });
    return session;
  }

  private resolvePickSession(run: VisibleQuickAccessProviderRun): void {
    const session = run.pickSession;
    if (session === undefined) return;
    run.pickSession = undefined;
    if (session.settled) return;
    session.settled = true;
    session.unsubscribeWillAccept();
    session.resolve(session.acceptedItems);
  }
}

function pickedQuickAccessItems(picker: IQuickPick<IQuickPickItem>): readonly IQuickPickItem[] {
  if (picker.canSelectMany) return [...picker.selectedItems];
  const pickedItems = picker.selectedItems.length > 0 ? picker.selectedItems : picker.activeItems;
  return [...pickedItems];
}
