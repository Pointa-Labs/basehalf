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

    export interface ModelService {
      readonly id: string;
      readonly label: string;
      readonly endpoint: string;
      readonly providerId: string;
      readonly deploymentId: string;
      readonly region: string;
      readonly connectionIdentity: string;
      readonly capabilities: readonly ModelCapability[];
      readonly authorization: 'bearer';
      readonly configured: boolean;
    }

    export interface ModelServiceAccess extends Omit<ModelService, 'configured'> {
      readonly credentialValues: Readonly<Record<string, string>>;
      readonly apiKey?: string;
    }

    export interface ModelServiceAttemptSnapshot {
      readonly serviceId: string;
      readonly serviceLabel: string;
      readonly connectionIdentity: string;
      readonly capability: ModelCapability;
      readonly modelId?: string;
      /** Opaque short-lived grant supplied only to the executor handling this attempt. */
      readonly accessToken?: string;
    }

    export interface ModelProviderConnectionValidationRequest {
      readonly specId: string;
      readonly endpoint: string;
      readonly providerId: string;
      readonly deploymentId: string;
      readonly region: string;
      readonly publicValues: Readonly<Record<string, string>>;
      readonly credentialValues: Readonly<Record<string, string>>;
    }

    export interface ModelProviderConnectionValidator {
      validate(
        request: ModelProviderConnectionValidationRequest,
        token: CancellationToken,
      ): ProviderResult<void>;
    }

    export function registerModelProviderConnectionValidator(
      specId: string,
      validator: ModelProviderConnectionValidator,
    ): Disposable;

    export const onDidChangeModelServices: Event<void>;
    export function getModelServices(
      capability?: ModelCapability,
    ): Thenable<readonly ModelService[]>;
    export function getModelServiceAccess(
      snapshot: ModelServiceAttemptSnapshot,
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

    export type VideoGenerationMode =
      | 'text-to-video'
      | 'first-frame-to-video'
      | 'first-last-frame-to-video'
      | 'reference-to-video'
      | 'video-edit'
      | 'video-extension';

    export type VideoInputKind =
      | 'text-prompt'
      | 'first-frame'
      | 'last-frame'
      | 'reference-image'
      | 'reference-video'
      | 'source-video'
      | 'audio';

    /** Exact host-owned value persisted in the reserved `videoModelSnapshot` recipe parameter. */
    export interface VideoModelSelectionSnapshot {
      readonly schemaVersion: 1;
      readonly catalogId: string;
      readonly providerId: string;
      readonly deploymentId: string;
      readonly region: string;
      readonly modelId: string;
      readonly revision: string;
      readonly mode: VideoGenerationMode;
      readonly inputs: Readonly<Partial<Record<VideoInputKind, number>>>;
    }

    export interface CanvasArtifactSnapshot {
      readonly id: string;
      readonly kind: CanvasContentKind;
      readonly resource: Uri;
      readonly attemptId?: string;
    }

    export interface CanvasNodeSnapshot {
      readonly id: string;
      readonly path: string;
      readonly kind: CanvasContentKind;
      readonly resource?: Uri;
      readonly result?: CanvasArtifactSnapshot;
    }

    export interface CanvasRecipeInput {
      readonly edgeId: string;
      readonly slotId: string;
      readonly order: number;
      readonly source: CanvasNodeSnapshot;
    }

    export interface CanvasRecipeExecutionRequest {
      readonly attemptId: string;
      readonly workspaceFolder: Uri;
      readonly node: CanvasNodeSnapshot;
      readonly recipeId: string;
      /** Host-owned generation intent frozen into this Attempt. */
      readonly prompt: string;
      readonly parameters: Readonly<Record<string, CanvasRecipeValue>>;
      readonly modelServiceId?: string;
      readonly modelService?: ModelServiceAttemptSnapshot;
      readonly inputs: readonly CanvasRecipeInput[];
      readonly outputDirectory: Uri;
      readonly resumeProviderRequestId?: string;
      acknowledgeProviderRequestId(providerRequestId: string): Thenable<void>;
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
      readonly artifact: CanvasRecipeArtifact;
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

    export type CanvasAttemptModel =
      | { readonly source: 'local' }
      | ({
          readonly source: 'service';
          readonly connection: 'resolved';
        } & ModelServiceAttemptSnapshot)
      | {
          readonly source: 'service';
          readonly connection: 'unavailable';
          readonly serviceId?: string;
          readonly capability: ModelCapability;
          readonly modelId?: string;
        };

    export type CanvasArtifactIntegrity = 'available' | 'missing' | 'changed';
    export type CanvasNodeAttemptStatus =
      | 'running'
      | 'succeeded'
      | 'failed'
      | 'cancelled'
      | 'interrupted';

    export type CanvasNodeLifecycle =
      | 'draft'
      | 'running'
      | 'result'
      | 'failed'
      | 'cancelled'
      | 'interrupted';

    export interface CanvasNodeResultArtifact {
      readonly id: string;
      readonly outputId: string;
      readonly kind: CanvasNodeKind;
      readonly resource: Uri;
      readonly integrity: CanvasArtifactIntegrity;
      readonly label?: string;
    }

    export interface CanvasNodeAttempt {
      readonly id: string;
      readonly status: CanvasNodeAttemptStatus;
      readonly createdAt: string;
      readonly startedAt?: string;
      readonly completedAt?: string;
      readonly model?: CanvasAttemptModel;
      readonly providerRequestId?: string;
      readonly usage?: CanvasRecipeUsage;
      readonly cost?: CanvasRecipeCost;
      readonly error?: string;
    }

    export type CanvasNodeResult =
      | { readonly source: 'imported'; readonly artifact: CanvasNodeResultArtifact }
      | {
          readonly source: 'attempt';
          readonly attemptId: string;
          readonly artifact: CanvasNodeResultArtifact;
        };

    export interface CanvasNodeState {
      readonly id: string;
      readonly kind: CanvasNodeKind;
      readonly lifecycle: CanvasNodeLifecycle;
      readonly result?: CanvasNodeResult;
      readonly attempts: readonly CanvasNodeAttempt[];
    }

    /**
     * Reads one saved result node through the host-owned document and integrity model.
     * Attempts are append-only audit records, never alternate selectable results.
     */
    export function inspectCanvasNode(resource: Uri): Thenable<CanvasNodeState | undefined>;

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
