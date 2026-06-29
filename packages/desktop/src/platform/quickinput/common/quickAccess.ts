import type {
  IQuickNavigateConfiguration,
  IQuickPick,
  IQuickPickItem,
  ItemActivation,
} from './quickInput.js';

export interface QuickAccessProviderRunOptions {
  readonly from?: string;
  readonly placeholder?: string;
  readonly handleAccept?: (item: IQuickPickItem, isBackgroundAccept: boolean) => void;
}

export interface QuickAccessOptions {
  readonly preserveValue?: boolean;
  readonly providerOptions?: QuickAccessProviderRunOptions;
  readonly enabledProviderPrefixes?: readonly string[];
  readonly placeholder?: string;
  readonly quickNavigateConfiguration?: IQuickNavigateConfiguration;
  readonly itemActivation?: ItemActivation;
}

export interface QuickAccessControllerState {
  readonly visible: boolean;
  readonly value: string;
  readonly filterValue: string;
  readonly providerId?: string;
  readonly prefix: string;
  readonly placeholder?: string;
  readonly valueSelection: readonly [number, number];
}

export type QuickAccessControllerListener = () => void;

export interface IQuickAccessController {
  getState(): QuickAccessControllerState;
  subscribe(listener: QuickAccessControllerListener): () => void;
  show(value?: string, options?: QuickAccessOptions): void;
  updateValue(value: string): void;
  hide(): void;
  toggle(value?: string, options?: QuickAccessOptions): void;
  isVisible(): boolean;
  accept(value?: string): void;
}

export enum DefaultQuickAccessFilterValue {
  PRESERVE = 0,
  LAST = 1,
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): () => void;
}

export interface QuickAccessProviderDisposable {
  dispose(): void;
}

export interface IQuickAccessProvider {
  readonly defaultFilterValue?: string | DefaultQuickAccessFilterValue;
  provide(
    picker: IQuickPick<IQuickPickItem>,
    token: CancellationToken,
    options?: QuickAccessProviderRunOptions,
  ): QuickAccessProviderDisposable;
}

export interface QuickAccessProviderHelp {
  readonly prefix?: string;
  readonly description: string;
  readonly commandId?: string;
}

export interface QuickAccessProviderDescriptor {
  readonly id: string;
  readonly prefix: string;
  readonly placeholder?: string;
  readonly contextKey?: string;
  readonly defaultFilterValue?: string | DefaultQuickAccessFilterValue;
  readonly provider?: IQuickAccessProvider;
  readonly helpEntries?: readonly QuickAccessProviderHelp[];
}

export type QuickAccessProviderRegistration = () => void;

export interface QuickAccessRegistryLike {
  registerQuickAccessProvider(
    provider: QuickAccessProviderDescriptor,
  ): QuickAccessProviderRegistration;
  getQuickAccessProviders(): readonly QuickAccessProviderDescriptor[];
  getQuickAccessProvider(value: string): QuickAccessProviderDescriptor | undefined;
}

export class QuickAccessRegistry implements QuickAccessRegistryLike {
  private providers: QuickAccessProviderDescriptor[] = [];
  private defaultProvider: QuickAccessProviderDescriptor | undefined;

  registerQuickAccessProvider(
    provider: QuickAccessProviderDescriptor,
  ): QuickAccessProviderRegistration {
    if (provider.prefix.length === 0) {
      this.defaultProvider = provider;
    } else {
      this.providers.push(provider);
      this.providers.sort((a, b) => b.prefix.length - a.prefix.length);
    }

    return () => {
      const index = this.providers.indexOf(provider);
      if (index >= 0) this.providers.splice(index, 1);
      if (this.defaultProvider === provider) this.defaultProvider = undefined;
    };
  }

  getQuickAccessProviders(): readonly QuickAccessProviderDescriptor[] {
    return [this.defaultProvider, ...this.providers].filter(
      (provider): provider is QuickAccessProviderDescriptor => provider !== undefined,
    );
  }

  getQuickAccessProvider(value: string): QuickAccessProviderDescriptor | undefined {
    const explicit = value
      ? this.providers.find((provider) => value.startsWith(provider.prefix))
      : undefined;
    return explicit ?? this.defaultProvider;
  }

  clear(): QuickAccessProviderRegistration {
    const providers = [...this.providers];
    const defaultProvider = this.defaultProvider;
    this.providers = [];
    this.defaultProvider = undefined;
    return () => {
      this.providers = providers;
      this.defaultProvider = defaultProvider;
    };
  }
}

export const quickAccessRegistry = new QuickAccessRegistry();
