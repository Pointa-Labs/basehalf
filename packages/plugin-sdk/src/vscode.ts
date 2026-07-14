import type { CancellationToken, Disposable, Event, ProviderResult, Uri, Webview } from 'vscode';

declare module 'vscode' {
  export namespace basehalf {
    export type ModelCapability = 'text' | 'image' | 'video' | 'audio';
    export type ModelServiceAuthorization = 'bearer' | 'header' | 'none';

    export interface ModelService {
      readonly id: string;
      readonly label: string;
      readonly endpoint: string;
      readonly capabilities: readonly ModelCapability[];
      readonly authorization: ModelServiceAuthorization;
      readonly headerName?: string;
      readonly configured: boolean;
    }

    export interface ModelServiceAccess extends Omit<ModelService, 'configured'> {
      readonly apiKey?: string;
    }

    export const onDidChangeModelServices: Event<void>;
    export function getModelServices(
      capability?: ModelCapability,
    ): Thenable<readonly ModelService[]>;
    export function getModelServiceAccess(
      serviceId: string,
    ): Thenable<ModelServiceAccess | undefined>;

    export interface CardProjectionView {
      readonly webview: Webview;
      readonly visible: boolean;
      readonly onDidChangeVisibility: Event<void>;
      readonly onDidDispose: Event<void>;
      setDirty(dirty: boolean): void;
    }

    export interface CardProjectionProvider {
      resolveCardProjection(
        resource: Uri,
        view: CardProjectionView,
        token: CancellationToken,
      ): ProviderResult<void>;
    }

    export interface CardProjectionProviderOptions {
      readonly retainContextWhenHidden?: boolean;
    }

    export function registerCardProjectionProvider(
      projectionId: string,
      provider: CardProjectionProvider,
      options?: CardProjectionProviderOptions,
    ): Disposable;
  }
}
