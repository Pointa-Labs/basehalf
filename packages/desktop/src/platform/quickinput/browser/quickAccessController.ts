import {
  DefaultQuickAccessFilterValue,
  type IQuickAccessController,
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
import type { IQuickPick, IQuickPickItem } from '../common/quickInput.js';

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
  private readonly lastAcceptedValues = new Map<string, string>();
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
    this.visibleOptions = options;
    const descriptor = this.providerForValue(value, options.enabledProviderPrefixes);
    const nextValue = this.valueForShow(value, descriptor, options);
    this.setOpenState(descriptor, nextValue, options);
    this.syncProviderRun(descriptor, nextValue, options);
  }

  updateValue(value: string): void {
    if (!this.state.visible) return;
    const descriptor = this.providerForValue(value, this.visibleOptions.enabledProviderPrefixes);
    this.setOpenState(descriptor, value, {
      ...this.visibleOptions,
      preserveValue: true,
    });
    this.syncProviderRun(descriptor, value, this.visibleOptions);
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
    if (this.state.providerId !== undefined) {
      this.lastAcceptedValues.set(this.state.providerId, value);
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
  ): void {
    const provider = descriptor?.provider;
    if (
      descriptor === undefined ||
      provider === undefined ||
      this.quickInputService === undefined
    ) {
      this.disposeProviderRun();
      return;
    }

    if (this.visibleProviderRun?.descriptor === descriptor) {
      this.visibleProviderRun.picker.value = value;
      this.visibleProviderRun.picker.placeholder = options.placeholder ?? descriptor.placeholder;
      return;
    }

    this.disposeProviderRun();
    const picker = this.quickInputService.createQuickPick({ useSeparators: true });
    const cancellation = new QuickAccessCancellationTokenSource();
    picker.value = value;
    picker.placeholder = options.placeholder ?? descriptor.placeholder;
    const unsubscribeHide = picker.onDidHide(() => {
      if (this.visibleProviderRun?.picker === picker) {
        this.disposeProviderRun();
      }
    });
    let disposable: QuickAccessProviderDisposable;
    try {
      disposable = provider.provide(picker, cancellation.token, options.providerOptions);
    } catch (err) {
      unsubscribeHide();
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
    };
    this.visibleProviderRun = run;
    picker.show();
  }

  private disposeProviderRun(): void {
    const run = this.visibleProviderRun;
    if (run === undefined) return;
    this.visibleProviderRun = undefined;
    run.unsubscribeHide();
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

  private valueForShow(
    value: string,
    descriptor: QuickAccessProviderDescriptor | undefined,
    options: QuickAccessOptions,
  ): string {
    if (descriptor === undefined || options.preserveValue === true) return value;
    if (value !== descriptor.prefix) return value;

    const defaultFilterValue =
      descriptor.defaultFilterValue ?? descriptor.provider?.defaultFilterValue;
    if (defaultFilterValue === DefaultQuickAccessFilterValue.LAST) {
      return this.lastAcceptedValues.get(descriptor.id) ?? value;
    }
    if (typeof defaultFilterValue === 'string') return `${descriptor.prefix}${defaultFilterValue}`;
    return value;
  }
}
