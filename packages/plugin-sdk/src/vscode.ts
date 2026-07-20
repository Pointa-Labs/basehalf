import type {
  CancellationToken,
  Disposable,
  Event,
  Progress,
  ProviderResult,
  Uri,
  Webview,
} from 'vscode';

declare module 'vscode' {
  export namespace basehalf {
    export type ModelCapability = 'text' | 'image' | 'video' | 'audio';
    export type ModelServiceAuthorization = 'bearer' | 'header' | 'none';

    export interface ModelService {
      readonly id: string;
      readonly label: string;
      readonly endpoint: string;
      readonly connectionIdentity: string;
      readonly capabilities: readonly ModelCapability[];
      readonly authorization: ModelServiceAuthorization;
      readonly headerName?: string;
      readonly configured: boolean;
    }

    export interface ModelServiceAccess extends Omit<ModelService, 'configured'> {
      readonly apiKey?: string;
    }

    export interface ModelServiceRunSnapshot {
      readonly serviceId: string;
      readonly serviceLabel: string;
      readonly connectionIdentity: string;
      readonly capability: ModelCapability;
      readonly modelId?: string;
      /** Opaque short-lived grant supplied only to the executor handling this run. */
      readonly accessToken?: string;
    }

    export const onDidChangeModelServices: Event<void>;
    export function getModelServices(
      capability?: ModelCapability,
    ): Thenable<readonly ModelService[]>;
    export function getModelServiceAccess(
      snapshot: ModelServiceRunSnapshot,
    ): Thenable<ModelServiceAccess | undefined>;

    export type CanvasContentKind =
      | 'text'
      | 'code'
      | 'file'
      | 'folder'
      | 'image'
      | 'video'
      | 'audio'
      | 'pdf'
      | 'presentation';

    export type CanvasNodeKind = Exclude<CanvasContentKind, 'text' | 'code' | 'folder'>;

    export type CanvasRecipeValue =
      | null
      | boolean
      | number
      | string
      | readonly CanvasRecipeValue[]
      | { readonly [key: string]: CanvasRecipeValue };

    export interface CanvasArtifactSnapshot {
      readonly id: string;
      readonly kind: CanvasContentKind;
      readonly resource: Uri;
      readonly runId?: string;
    }

    export interface CanvasNodeSnapshot {
      readonly id: string;
      readonly path: string;
      readonly kind: CanvasContentKind;
      readonly resource?: Uri;
      readonly current?: CanvasArtifactSnapshot;
    }

    export interface CanvasRecipeInput {
      readonly edgeId: string;
      readonly slotId: string;
      readonly order: number;
      readonly source: CanvasNodeSnapshot;
    }

    export interface CanvasRecipeExecutionRequest {
      readonly runId: string;
      readonly workspaceFolder: Uri;
      readonly node: CanvasNodeSnapshot;
      readonly recipeId: string;
      readonly parameters: Readonly<Record<string, CanvasRecipeValue>>;
      readonly modelServiceId?: string;
      readonly modelService?: ModelServiceRunSnapshot;
      readonly inputs: readonly CanvasRecipeInput[];
      readonly outputDirectory: Uri;
    }

    export interface CanvasRecipeProgress {
      readonly message?: string;
      readonly increment?: number;
    }

    export interface CanvasRecipeArtifact {
      readonly id: string;
      readonly outputId: string;
      readonly kind: CanvasNodeKind;
      readonly resource: Uri;
      readonly label?: string;
    }

    export interface CanvasRecipeExecutionResult {
      readonly artifacts: readonly CanvasRecipeArtifact[];
      readonly primaryArtifactId?: string;
      readonly providerRequestId?: string;
      readonly usage?: CanvasRecipeUsage;
      readonly cost?: CanvasRecipeCost;
    }

    export interface CanvasRecipeUsage {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly cachedInputTokens?: number;
      readonly images?: number;
      readonly videoSeconds?: number;
      readonly audioSeconds?: number;
    }

    export interface CanvasRecipeCost {
      readonly currency: string;
      readonly amount: string;
      readonly kind: 'actual' | 'estimated';
    }

    export type CanvasRunModel =
      | { readonly source: 'local' }
      | ({ readonly source: 'service'; readonly connection: 'resolved' } & ModelServiceRunSnapshot)
      | {
          readonly source: 'service';
          readonly connection: 'unavailable';
          readonly serviceId?: string;
          readonly capability: ModelCapability;
          readonly modelId?: string;
        };

    export type CanvasArtifactIntegrity = 'available' | 'missing' | 'changed';
    export type CanvasNodeVersionStatus =
      | 'imported'
      | 'running'
      | 'succeeded'
      | 'failed'
      | 'cancelled'
      | 'interrupted';

    export interface CanvasNodeVersionArtifact {
      readonly id: string;
      readonly kind: CanvasNodeKind;
      readonly resource: Uri;
      readonly integrity: CanvasArtifactIntegrity;
    }

    export interface CanvasNodeVersion {
      readonly id: string;
      readonly status: CanvasNodeVersionStatus;
      readonly createdAt: string;
      readonly primaryArtifact?: CanvasNodeVersionArtifact;
      readonly model?: CanvasRunModel;
      readonly providerRequestId?: string;
      readonly usage?: CanvasRecipeUsage;
      readonly cost?: CanvasRecipeCost;
    }

    export interface CanvasNodeState {
      readonly id: string;
      readonly kind: CanvasNodeKind;
      readonly currentVersionId?: string;
      readonly versions: readonly CanvasNodeVersion[];
    }

    export interface CanvasNodeInspectOptions {
      readonly versionIds?: readonly string[];
      readonly includeCurrent?: boolean;
    }

    /**
     * Reads a saved result node. Omitting options preserves the complete-history
     * view. Supplying options returns only requested versions and optional Current.
     */
    export function inspectCanvasNode(
      resource: Uri,
      options?: CanvasNodeInspectOptions,
    ): Thenable<CanvasNodeState | undefined>;

    /**
     * Atomically replaces one saved ordinary project file only while its bytes
     * still equal `expected`, and records the change as one BaseHalf project
     * undo step. The host rejects dirty files, symbolic links, and paths outside
     * the current workspace.
     */
    export function applyProjectFileTransition(
      resource: Uri,
      expected: Uint8Array,
      next: Uint8Array,
      label: string,
    ): Thenable<void>;

    /** One exact ordinary-project-file transition proposed for structural cleanup. */
    export interface ProjectFileTransition {
      readonly resource: Uri;
      readonly expected: Uint8Array;
      readonly next: Uint8Array;
      readonly label: string;
    }

    /** Reviewed plugin hook for removing domain references before a canvas node is deleted. */
    export interface CanvasStructuralCleanupProvider {
      prepareDelete(
        resource: Uri,
        token: CancellationToken,
      ): ProviderResult<readonly ProjectFileTransition[]>;
    }

    /** Registers at most one structural cleanup provider for this reviewed plugin. */
    export function registerCanvasStructuralCleanupProvider(
      provider: CanvasStructuralCleanupProvider,
    ): Disposable;

    export interface CanvasRecipeExecutor {
      execute(
        request: CanvasRecipeExecutionRequest,
        progress: Progress<CanvasRecipeProgress>,
        token: CancellationToken,
      ): ProviderResult<CanvasRecipeExecutionResult>;
    }

    export function registerCanvasRecipeExecutor(
      recipeId: string,
      executor: CanvasRecipeExecutor,
    ): Disposable;

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
