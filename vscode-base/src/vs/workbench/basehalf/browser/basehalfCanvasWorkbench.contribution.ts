/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasWorkbench.css';

import * as DOM from '../../../base/browser/dom.js';
import { $, append, clearNode, isHTMLElement, isHTMLInputElement, isHTMLTextAreaElement, isSVGElement } from '../../../base/browser/dom.js';
import { AnchorAlignment, AnchorAxisAlignment, AnchorPosition } from '../../../base/browser/ui/contextview/contextview.js';
import { InputBox, MessageType } from '../../../base/browser/ui/inputbox/inputBox.js';
import { IKeyboardEvent } from '../../../base/browser/keyboardEvent.js';
import { DeferredPromise } from '../../../base/common/async.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { safeIntl } from '../../../base/common/date.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { equals as objectsEqual, stableStringify } from '../../../base/common/objects.js';
import { toAction } from '../../../base/common/actions.js';
import { basename, dirname, extname, isEqualOrParent, joinPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { FileAccess } from '../../../base/common/network.js';
import { ResourceFileEdit } from '../../../editor/browser/services/bulkEditService.js';
import { RedoCommand, UndoCommand } from '../../../editor/browser/editorExtensions.js';
import { localize } from '../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../platform/commands/common/commands.js';
import { IClipboardService } from '../../../platform/clipboard/common/clipboardService.js';
import { IDialogService, IFileDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { getPathForFile } from '../../../platform/dnd/browser/dnd.js';
import { FileChangesEvent, FileOperationResult, FileSystemProviderCapabilities, IFileContent, IFileService, IFileStat, toFileOperationResult } from '../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IQuickInputService, IQuickPickItem } from '../../../platform/quickinput/common/quickInput.js';
import { IContextMenuService, IContextViewDelegate, IContextViewService } from '../../../platform/contextview/browser/contextView.js';
import { defaultInputBoxStyles } from '../../../platform/theme/browser/defaultStyles.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IUndoRedoService, UndoRedoElementType } from '../../../platform/undoRedo/common/undoRedo.js';
import { IWorkbenchLayoutService, Parts } from '../../services/layout/browser/layoutService.js';
import { IExplorerService } from '../../contrib/files/browser/files.js';
import { clearExplorerFileClipboardCut, explorerFileClipboardShouldMove, findValidPasteFileTargetForResource, incrementFileName } from '../../contrib/files/browser/fileActions.js';
import { IFilesConfiguration, UndoConfirmLevel } from '../../contrib/files/common/files.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { DEFAULT_EDITOR_ASSOCIATION, SideBySideEditor } from '../../common/editor.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { SettingsEditor2Input } from '../../services/preferences/common/preferencesEditorInput.js';
import { ILifecycleService } from '../../services/lifecycle/common/lifecycle.js';
import { IPathService } from '../../services/path/common/pathService.js';
import { ITextFileService } from '../../services/textfile/common/textfiles.js';
import { IWorkingCopyService } from '../../services/workingCopy/common/workingCopyService.js';
import { mainWindow } from '../../../base/browser/window.js';
import {
	baseHalfCanvasBadgeRelationships,
	baseHalfCanvasItemBounds,
	baseHalfCanvasItemsSharePreviewVersion,
	baseHalfCanvasModelFromStat,
	baseHalfCanvasOpenPosition,
	baseHalfCanvasTransferPosition,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH,
	IBaseHalfCanvasBadgeMetadata,
	IBaseHalfCanvasBadgeRelationshipIssue,
	IBaseHalfCanvasBounds,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasFile,
	IBaseHalfCanvasItem
} from '../common/basehalfCanvasModel.js';
import { IBaseHalfBadgeGraphService, IBaseHalfReferenceState } from '../common/basehalfBadgeGraph.js';
import { IBaseHalfBadgeFile, IBaseHalfBadgeNode, IBaseHalfBadgeReadProblem } from '../common/basehalfBadgeMirror.js';
import { IBaseHalfCanvasAppearanceService } from '../common/basehalfCanvasAppearance.js';
import {
	BaseHalfCanvasMirrorCorrupt,
	IBaseHalfCanvasCardStateTransition,
	IBaseHalfCanvasEdgeStateTransition,
	IBaseHalfCanvasMirrorService,
	IBaseHalfCanvasStateTransition
} from '../common/basehalfCanvasMirror.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorResource, baseHalfMirrorRoot } from '../common/basehalfMirrorTree.js';
import { IBaseHalfActiveCanvasEditor, IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService, IBaseHalfCanvasNavigationState, IBaseHalfCardDetailState } from '../common/basehalfCanvasNavigation.js';
import {
	baseHalfCanvasNoteFormatOwnerKey,
	baseHalfCanvasNoteFormatOwnersEqual,
	baseHalfCanvasNoteFormatCommandOutcome,
	baseHalfCanvasNoteMountRequestsFocus,
	baseHalfCanvasNotePrepareIdentityBoundClose,
	BaseHalfCanvasNoteFocusLeaseOwner,
	BaseHalfCanvasNoteFormatNavigationOwnership,
	BaseHalfCanvasNoteFormatSelectionBarrier,
	IBaseHalfCanvasNoteFocusLease,
	IBaseHalfCanvasNoteFormatOwner
} from '../common/basehalfCanvasNoteFormatLifecycle.js';
import { baseHalfCanvasInlineEditKeyAction, BASEHALF_CANVAS_UNDO_REDO_SOURCE, BaseHalfCanvasCreateKind, BaseHalfCanvasEditingRequest, IBaseHalfCanvasEditingService } from '../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasActionContext, IBaseHalfCanvasActionContextService, isBaseHalfCanvasActionContext } from '../common/basehalfCanvasActionContext.js';
import {
	baseHalfCanvasMarkdownEditTarget,
	baseHalfCanvasMarkdownPreviewSource,
	baseHalfCanvasMarkdownSourceFitsInline,
	BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES
} from '../common/basehalfCanvasPreview.js';
import { BaseHalfCardDetailProjection, IBaseHalfCardProjectionRegistryService, isBaseHalfMarkdownResource } from '../common/basehalfCardDetail.js';
import { IBaseHalfFocusMirrorService } from '../common/basehalfFocusMirrorService.js';
import { IBaseHalfPdfSelection } from '../common/basehalfMediaViewState.js';
import { baseHalfPdfBranchBaseName, baseHalfPdfBranchMarkdown } from '../common/basehalfPdfBranch.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	BASEHALF_NODE_PROMPT_MAX_LENGTH,
	BaseHalfNodeDocumentError,
	BaseHalfNodeArtifactKind,
	BaseHalfNodeJsonValue,
	BaseHalfNodeKind,
	createBaseHalfNodeDocument,
	getBaseHalfNodeResultArtifact,
	IBaseHalfNodeDocument,
	IBaseHalfNodeInputBinding,
	IBaseHalfNodeResultArtifact,
	importBaseHalfNodeResult,
	parseBaseHalfNodeDocumentBytes,
	parseBaseHalfNodeDocumentBytesForActiveHost,
	serializeBaseHalfNodeDocument
} from '../common/basehalfNodeDocument.js';
import {
	BaseHalfCanvasContentKind,
	baseHalfCanvasContentKindForPath,
	baseHalfCanvasRecipeMatchesNodeKind,
	compensateBaseHalfCanvasConnectedNodeCreate,
	createBaseHalfCanvasConnectedNodeDocument,
	getBaseHalfCanvasConnectedRecipeChoices,
	getBaseHalfCanvasDefaultNodeRole,
	IBaseHalfCanvasRecipeDescriptor,
	IBaseHalfCanvasRecipeParameterDefinition,
	IBaseHalfCanvasRecipeRegistryService
} from '../common/basehalfCanvasRecipes.js';
import {
	BASEHALF_CONFIGURE_MODEL_SERVICE_COMMAND_ID,
	BASEHALF_MANAGE_MODEL_SERVICES_COMMAND_ID,
	IBaseHalfModelServiceDescriptor,
	IBaseHalfModelServiceService,
	isBaseHalfPublicHttpsBearerModelServiceConfiguration
} from '../common/basehalfModelServices.js';
import {
	IBaseHalfModelProviderCatalogService,
	IBaseHalfRegisteredModelProviderConnectionSpec
} from '../common/basehalfModelProviderCatalogs.js';
import {
	IBaseHalfModelConnectionCompletion,
	IBaseHalfModelConnectionNavigationService
} from '../common/basehalfModelConnectionNavigation.js';
import { IBaseHalfVideoModelCatalogService } from '../common/basehalfVideoModelCatalogs.js';
import {
	BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID,
	BASEHALF_VIDEO_GENERATION_MODES,
	BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID,
	BaseHalfVideoGenerationMode,
	BaseHalfVideoInputKind,
	BaseHalfVideoInputState,
	BaseHalfVideoCapabilityResolution,
	BaseHalfVideoModelScalar,
	BaseHalfVideoSettings,
	BaseHalfVideoSettingsNormalization,
	baseHalfVideoModelMatchesServiceScope,
	createBaseHalfVideoModelRegistry,
	createBaseHalfVideoModelSelectionSnapshotFromCapability,
	evaluateBaseHalfVideoInputs,
	getBaseHalfVideoPromptMaxCharacters,
	getBaseHalfVideoPromptProblem,
	IBaseHalfSupportedVideoCapabilityResolution,
	IBaseHalfVideoInputEvaluation,
	IBaseHalfVideoModelDescriptor,
	IBaseHalfVideoModelRegistry,
	IBaseHalfVideoModelSelectionSnapshot,
	IBaseHalfVideoSettingAdjustment,
	parseBaseHalfVideoModelSelectionSnapshot,
	resolveBaseHalfVideoModelSelectionSnapshot,
	resolveBaseHalfVideoModelSelectionSnapshotCapability,
	normalizeBaseHalfVideoSettings,
	normalizeBaseHalfVideoSettingsForCapability
} from '../common/basehalfVideoModels.js';
import {
	baseHalfVideoModelChoiceLogicalKey,
	createBaseHalfVideoMessagePrecedencePresentation,
	createBaseHalfVideoModelPickerPresentation,
	createBaseHalfVideoModelSettingsPresentation,
	createBaseHalfVideoSettingAdjustmentPresentations,
	IBaseHalfVideoMessage,
	IBaseHalfVideoModelChoice,
	IBaseHalfVideoModelPresentationEntry,
	IBaseHalfVideoModelRowPresentation,
	IBaseHalfVideoParameterPresentation,
	mergeBaseHalfVideoSettingAdjustments,
	reconcileBaseHalfVideoGenerationMethodSettings,
	reconcileBaseHalfVideoModelSettings,
	resolveBaseHalfVideoModelPickerFocus
} from '../common/basehalfVideoModelSettingsPresentation.js';
import {
	acceptBaseHalfVideoCanvasPickSelection,
	acquireBaseHalfVideoInputTransaction,
	applyBaseHalfVideoInputMutationToDocument,
	baseHalfVideoCanvasPickDraftRevisionIsCurrent,
	baseHalfVideoCanvasPickSelectionIsActive,
	baseHalfVideoInputTransactionIsCurrent,
	BaseHalfVideoDirectEdgeState,
	BaseHalfVideoInputMutationError,
	BaseHalfVideoInputPresentationProblemKind,
	beginBaseHalfVideoCanvasPick,
	cancelBaseHalfVideoCanvasPick,
	completeBaseHalfVideoCanvasPick,
	confirmBaseHalfVideoDocumentWriteAcknowledgement,
	consumeBaseHalfVideoCanvasPickDeferredFocus,
	createBaseHalfVideoCanvasPickState,
	createBaseHalfVideoDocumentWriteAcknowledgement,
	createBaseHalfVideoInputTransactionOwnerState,
	createBaseHalfVideoInputsPresentation,
	failBaseHalfVideoCanvasPick,
	getBaseHalfVideoCanvasPickInteraction,
	getBaseHalfVideoInputsExecutionGate,
	IBaseHalfVideoCanvasPickState,
	IBaseHalfVideoDocumentWriteAcknowledgement,
	IBaseHalfVideoInputMutationPlan,
	IBaseHalfVideoInputPresentationProblem,
	IBaseHalfVideoInputSourceState,
	markBaseHalfVideoCanvasPickCommitting,
	markBaseHalfVideoCanvasPickReady,
	markBaseHalfVideoCanvasPickRevalidating,
	observeBaseHalfVideoDocumentVersion,
	planBaseHalfVideoFrameSwap,
	planBaseHalfVideoInputPick,
	planBaseHalfVideoInputRemove,
	planBaseHalfVideoInputReplace,
	planBaseHalfVideoInputRoleChange,
	releaseBaseHalfVideoInputTransaction,
	settleBaseHalfVideoDocumentWriteAcknowledgement,
	updateBaseHalfVideoCanvasPickViewport
} from '../common/basehalfVideoInputs.js';
import { BaseHalfCanvasCardPresentation } from '../common/basehalfCanvasCardPresentation.js';
import { BaseHalfCanvasPreviewHydrationQueue, BaseHalfCanvasPreviewVerificationQueue, IBaseHalfCanvasPreviewHydrationBatch } from '../common/basehalfCanvasPreviewHydration.js';
import { splitBaseHalfMarkdownFrontmatter } from '../common/basehalfMarkdownProjection.js';
import { BaseHalfCanvasMarkdownInlineEditor, BaseHalfCanvasMarkdownRequiresRichEditorError, IBaseHalfCanvasMarkdownInlineSelection, renderBaseHalfCanvasStoredMarkdownBody } from './cardDetail/basehalfCanvasMarkdownInlineEditor.js';
import { BaseHalfMarkdownPreviewCardDetail } from './cardDetail/basehalfMarkdownPreviewCardDetail.js';
import { BaseHalfMarkdownRichCardDetail } from './cardDetail/basehalfMarkdownRichCardDetail.js';
import { BaseHalfSourceCardDetail } from './cardDetail/basehalfSourceCardDetail.js';
import { IBaseHalfCardDetailSurfaceInstance, IBaseHalfCardDetailSurfaceRegistryService } from './cardDetail/basehalfCardDetailSurface.js';
import { BaseHalfMediaCardDetail } from './cardDetail/basehalfMediaCardDetail.js';
import { BaseHalfCanvasReactScene } from './basehalfCanvasReactScene.js';
import { releaseBaseHalfCanvasCardMedia } from './basehalfCanvasCardMedia.js';
import {
	BaseHalfCanvasInteractionRenderGate,
	baseHalfBadgeDraftFailureDisposition,
	baseHalfCopyRetainedBadgeDraft,
	baseHalfDiscardRetainedBadgeDraft,
	baseHalfPersistedCanvasEdgeRemoval,
	baseHalfResourceMutationStampsEqual,
	baseHalfShouldVetoForBadgeDrafts,
	baseHalfTransitionBadgeDraftIdentity,
	removeCompleteBaseHalfCanvasReference
} from './basehalfCanvasConnectionTransaction.js';
import { BASEHALF_CANVAS_MAX_ZOOM, BASEHALF_CANVAS_MIN_ZOOM, BaseHalfSetting, normalizeBaseHalfCanvasZoom } from '../common/basehalfConfiguration.js';
import { BASEHALF_AUTO_SAVE_DELAY_MS } from '../common/basehalfWorkbenchProfile.js';
import { baseHalfActiveEditorFlushOptions, BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from '../common/basehalfEditorFlush.js';
import {
	BaseHalfCanvasSceneContextMenuRequest,
	BaseHalfCanvasSceneSelectionAction,
	BaseHalfCanvasSceneCardControls,
	BaseHalfCanvasSceneVideoAction,
	BaseHalfCanvasNoteBackground,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT,
	BASEHALF_CANVAS_VIDEO_COMPOSER_LAYOUT_EVENT,
	BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE,
	BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT,
	BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT,
	IBaseHalfCanvasNoteEditPoint,
	IBaseHalfCanvasNoteFormatState,
	IBaseHalfCanvasSceneConnection,
	IBaseHalfCanvasSceneConnectionDrop,
	IBaseHalfCanvasSceneCard,
	IBaseHalfCanvasSceneCardPresentation,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneGeometry,
	IBaseHalfCanvasSceneReconnect,
	IBaseHalfCanvasSceneViewport
} from '../common/basehalfCanvasScene.js';
import {
	BASEHALF_VIDEO_COMPOSER_HEIGHT,
	BASEHALF_VIDEO_COMPOSER_WIDTH,
	BaseHalfVideoComposerDirectManipulation,
	createBaseHalfVideoComposerFooterPresentation,
	IBaseHalfVideoComposerLayout
} from '../common/basehalfVideoComposerPresentation.js';
import type { BaseHalfMarkdownFormatCommand } from '../common/basehalfMarkdownFormatting.js';
import { BASEHALF_CANVAS_CARD_CONTEXT_MENU, BASEHALF_CANVAS_OPEN_RESULT_NODE_COMMAND_ID, BASEHALF_CANVAS_PANE_CONTEXT_MENU } from './basehalfCanvasContextMenu.js';
import { IBaseHalfCanvasResourceDeletionService } from './basehalfCanvasResourceDeletion.js';
import { BaseHalfNodeArtifactIntegrity, baseHalfNodeImportedAssetDirectory, IBaseHalfNodeExecutionService, IBaseHalfNodeExecutionState, IBaseHalfNodeProviderRunAuthorization } from './basehalfNodeExecutionService.js';
import {
	BaseHalfNodeLocalDraftExitCoordinator,
	BaseHalfNodeParameterDraftValue,
	baseHalfNodeArtifactUsesTextPreview,
	baseHalfNodeCanImportContentKind,
	baseHalfNodeAttemptHasCompleteRetrySnapshot,
	baseHalfNodeImportActionLabel,
	baseHalfNodeImportObjectLabel,
	baseHalfNodeLocalPrimaryActionOpensSurface,
	baseHalfNodeLocalStatusToken,
	baseHalfNodeLocalSurfaceTargetOwnsEscape,
	chooseBaseHalfNodeConnectionSlot,
	configureBaseHalfNodeLocalSurfaceAccessibility,
	createBaseHalfNodeParameterDraft,
	decodeBaseHalfNodeTextPreview,
	getBaseHalfNodeAvailableInputSlots,
	getBaseHalfNodeAssignableInputSlots,
	getBaseHalfNodeInputResultLabel,
	getBaseHalfNodeInputStructureProblem,
	getBaseHalfNodeInputRows,
	getBaseHalfNodeCardStatusText,
	getBaseHalfNodeResultArtifactOpenProblem,
	getBaseHalfNodeImportProblem,
	getBaseHalfNodeLocalState,
	getBaseHalfNodeLocalExecutionState,
	getBaseHalfNodeModelSelectionProblem,
	getBaseHalfNodeAttemptDisclosureLines,
	getBaseHalfNodeAttemptSummary,
	resolveBaseHalfNodeLocalSurfacePlacement,
	resolveBaseHalfVideoComposerPopoverPlacement,
	IBaseHalfNodeLocalConfigurationDraft,
	IBaseHalfNodeInputResultIdentity,
	isBaseHalfNodeCardStatusPositive,
	mergeBaseHalfNodeLocalConfigurationDraft,
	moveBaseHalfNodeInputBinding,
	parseBaseHalfNodeParameterDraft,
	resolveBaseHalfNodeLocalDraftExit,
	resolveBaseHalfNodeImplicitVideoRecipe,
	resolveBaseHalfNodeRecipeDraft
} from './basehalfNodeLocalSurface.js';
import {
	BaseHalfStructuralResourceOutcome,
	baseHalfStructuralResourceOutcome,
	IBaseHalfWorkspaceMutationCoordinator,
	IBaseHalfWorkspaceMutationLease,
	IBaseHalfWorkspaceMutationStamp,
	IBaseHalfWorkspaceResourceMutationStamp
} from '../common/basehalfWorkspaceMutation.js';

interface IBaseHalfCanvasMediaPreview {
	readonly text: string;
	readonly mediaKind: 'image' | 'video' | 'audio' | 'pdf';
	readonly resource: URI;
}

interface IBaseHalfNodeInboundSource {
	readonly path: string;
	readonly kind?: BaseHalfCanvasContentKind;
	readonly resultIdentity?: IBaseHalfNodeInputResultIdentity;
}

interface IBaseHalfNodeInboundState {
	readonly sources: readonly IBaseHalfNodeInboundSource[];
	readonly problem?: string;
}

function baseHalfNodeInboundInputKinds(sources: readonly IBaseHalfNodeInboundSource[]): Map<string, BaseHalfCanvasContentKind> {
	return new Map(sources.flatMap(source => source.kind === undefined ? [] : [[source.path, source.kind] as const]));
}

type BaseHalfVideoComposerOverlay = 'models' | 'settings' | 'inputs' | 'attempts';

interface IBaseHalfVideoComposerModelState {
	readonly registry: IBaseHalfVideoModelRegistry;
	readonly inputs: BaseHalfVideoInputState;
	readonly models: readonly IBaseHalfVideoModelDescriptor[];
	readonly service?: IBaseHalfModelServiceDescriptor;
	readonly descriptor?: IBaseHalfVideoModelDescriptor;
	readonly mode?: BaseHalfVideoGenerationMode;
	readonly resolution?: BaseHalfVideoCapabilityResolution;
	readonly inputEvaluation?: IBaseHalfVideoInputEvaluation;
	readonly normalization?: BaseHalfVideoSettingsNormalization;
	readonly problem?: string;
}

const BASEHALF_VIDEO_MODE_LABELS: Readonly<Record<BaseHalfVideoGenerationMode, string>> = Object.freeze({
	'text-to-video': 'Text to Video',
	'first-frame-to-video': 'Start Frame',
	'first-last-frame-to-video': 'Start + End Frames',
	'reference-to-video': 'References',
	'video-edit': 'Edit video',
	'video-extension': 'Extend video'
});

function baseHalfVideoSettingsFromRecipeParameters(
	parameters: Readonly<Record<string, BaseHalfNodeJsonValue>> | undefined
): BaseHalfVideoSettings {
	if (!parameters) {
		return Object.freeze({});
	}
	const settings: Record<string, BaseHalfVideoModelScalar> = {};
	for (const [id, value] of Object.entries(parameters)) {
		if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
			settings[id] = value;
		}
	}
	return Object.freeze(settings);
}

/**
 * Video settings keep their provider-neutral scalar types until save. The
 * generic local-surface draft predates numeric capability settings, so this
 * narrow adapter avoids converting numbers to lossy strings between renders.
 */
function baseHalfVideoSettingsAsParameterDraft(
	settings: BaseHalfVideoSettings,
	snapshot?: IBaseHalfVideoModelSelectionSnapshot
): Record<string, BaseHalfNodeParameterDraftValue> {
	return {
		...settings,
		...(snapshot ? { [BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID]: snapshot } : {})
	} as unknown as Record<string, BaseHalfNodeParameterDraftValue>;
}

function baseHalfCanonicalVideoParameterDraft(
	catalogId: string,
	resolution: IBaseHalfSupportedVideoCapabilityResolution,
	inputs: BaseHalfVideoInputState,
	normalization: Extract<BaseHalfVideoSettingsNormalization, { readonly status: 'ready' }>
): Record<string, BaseHalfNodeParameterDraftValue> {
	return baseHalfVideoSettingsAsParameterDraft(
		normalization.values,
		createBaseHalfVideoModelSelectionSnapshotFromCapability(catalogId, resolution, inputs)
	);
}

const EMPTY_BASEHALF_VIDEO_MODEL_REGISTRY = createBaseHalfVideoModelRegistry({ schemaVersion: 1, models: [] });
const BASEHALF_VIDEO_INPUT_SOURCE_CHANGED_PROBLEM = 'The input source changed after it was attached.';

function baseHalfVideoRegistryForRecipe(
	service: IBaseHalfVideoModelCatalogService,
	recipe: IBaseHalfCanvasRecipeDescriptor | undefined
): IBaseHalfVideoModelRegistry {
	return recipe?.modelCapability === 'video' && recipe.videoModelCatalogId
		? service.getRegistry(recipe.videoModelCatalogId, recipe.extensionId)
		: EMPTY_BASEHALF_VIDEO_MODEL_REGISTRY;
}

function baseHalfVideoSettingsFromParameterDraft(
	draft: Readonly<Record<string, BaseHalfNodeParameterDraftValue>>
): BaseHalfVideoSettings {
	const settings: Record<string, BaseHalfVideoModelScalar> = {};
	for (const [id, value] of Object.entries(draft as Readonly<Record<string, unknown>>)) {
		if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
			settings[id] = value;
		}
	}
	return Object.freeze(settings);
}

function baseHalfVideoSnapshotFromParameterDraft(
	draft: Readonly<Record<string, BaseHalfNodeParameterDraftValue>>,
	expectedCatalogId: string | undefined
): IBaseHalfVideoModelSelectionSnapshot | undefined {
	if (!expectedCatalogId) {
		return undefined;
	}
	const value = (draft as Readonly<Record<string, unknown>>)[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID];
	if (value === undefined) {
		return undefined;
	}
	try {
		return parseBaseHalfVideoModelSelectionSnapshot(value, expectedCatalogId);
	} catch {
		return undefined;
	}
}

function baseHalfVideoModelKeyFromParameterDraft(
	draft: Readonly<Record<string, BaseHalfNodeParameterDraftValue>>,
	expectedCatalogId: string | undefined
): IBaseHalfVideoModelDescriptor['key'] | undefined {
	const snapshot = baseHalfVideoSnapshotFromParameterDraft(draft, expectedCatalogId);
	return snapshot ? Object.freeze({
		provider: snapshot.providerId,
		deployment: snapshot.deploymentId,
		region: snapshot.region,
		modelId: snapshot.modelId,
		revision: snapshot.revision
	}) : undefined;
}

function baseHalfVideoParameterDraftFromRecipeParameters(
	parameters: Readonly<Record<string, BaseHalfNodeJsonValue>> | undefined,
	expectedCatalogId: string | undefined
): Record<string, BaseHalfNodeParameterDraftValue> {
	const settings = baseHalfVideoSettingsFromRecipeParameters(parameters);
	if (!parameters || !expectedCatalogId || parameters[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID] === undefined) {
		return baseHalfVideoSettingsAsParameterDraft(settings);
	}
	try {
		return baseHalfVideoSettingsAsParameterDraft(
			settings,
			parseBaseHalfVideoModelSelectionSnapshot(parameters[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID], expectedCatalogId)
		);
	} catch {
		return baseHalfVideoSettingsAsParameterDraft(settings);
	}
}

function baseHalfVideoInputState(
	prompt: string,
	bindings: readonly IBaseHalfNodeInputBinding[],
	inputKinds: ReadonlyMap<string, BaseHalfCanvasContentKind>
): BaseHalfVideoInputState {
	const counts: Partial<Record<BaseHalfVideoInputKind, number>> = { 'text-prompt': 1 };
	const appendInput = (kind: BaseHalfVideoInputKind): void => {
		counts[kind] = (counts[kind] ?? 0) + 1;
	};
	for (const binding of bindings) {
		const slot = binding.slot.toLowerCase();
		const contentKind = inputKinds.get(binding.sourcePath);
		if (slot === 'first-frame') {
			appendInput('first-frame');
		} else if (slot === 'last-frame') {
			appendInput('last-frame');
		} else if (slot === 'source-video') {
			appendInput('source-video');
		} else if (slot === 'audio' || contentKind === 'audio') {
			appendInput('audio');
		} else if (contentKind === 'image') {
			appendInput('reference-image');
		} else if (contentKind === 'video') {
			appendInput('reference-video');
		}
	}
	// The field itself participates in mode selection so users can choose a
	// model before writing. Required prompt content is checked separately.
	void prompt;
	return Object.freeze(counts);
}

function baseHalfVideoInputEvaluationProblem(evaluation: IBaseHalfVideoInputEvaluation): string | undefined {
	const problem = evaluation.problems[0];
	if (!problem) {
		return undefined;
	}
	if (problem.kind === 'too-few' && problem.input === 'first-frame') {
		return localize('basehalf.canvas.videoComposer.addStartFrame', "Add Start Frame.");
	}
	if (problem.kind === 'too-few' && problem.input === 'last-frame') {
		return localize('basehalf.canvas.videoComposer.addEndFrame', "Add End Frame.");
	}
	if (problem.kind === 'unsupported' && problem.input === 'first-frame') {
		return localize('basehalf.canvas.videoComposer.reviewStartFrame', "Remove Start Frame or choose a generation method that uses it.");
	}
	if (problem.kind === 'unsupported' && problem.input === 'last-frame') {
		return localize('basehalf.canvas.videoComposer.reviewEndFrame', "Remove End Frame or choose Start + End Frames.");
	}
	return problem.reason;
}

function baseHalfVideoInputPresentationProblemLabel(kind: BaseHalfVideoInputPresentationProblemKind): string {
	switch (kind) {
		case 'missing-start-frame':
			return localize('basehalf.canvas.videoComposer.missingStartFrame', "Start Frame is required.");
		case 'missing-end-frame':
			return localize('basehalf.canvas.videoComposer.missingEndFrame', "End Frame is required.");
		case 'source-missing':
			return localize('basehalf.canvas.videoComposer.inputSourceMissing', "The source is missing.");
		case 'source-changed':
			return localize('basehalf.canvas.videoComposer.inputSourceChanged', "The source changed after it was attached.");
		case 'source-unverified':
			return localize('basehalf.canvas.videoComposer.inputSourceUnverified', "Save and verify the source before generating.");
		case 'unused-role':
			return localize('basehalf.canvas.videoComposer.inputRoleUnused', "The selected generation method does not use this role.");
		case 'incompatible-role':
			return localize('basehalf.canvas.videoComposer.inputRoleIncompatible', "This source is incompatible with its assigned role.");
		case 'over-capacity':
		case 'too-many':
			return localize('basehalf.canvas.videoComposer.inputOverCapacity', "This role has too many inputs.");
		case 'too-few':
			return localize('basehalf.canvas.videoComposer.inputUnderCapacity', "This role needs another input.");
		case 'unsupported-input':
			return localize('basehalf.canvas.videoComposer.inputUnsupported', "The selected generation method does not accept this input.");
	}
}

function baseHalfVideoInputPresentationProblemMessage(problem: IBaseHalfVideoInputPresentationProblem): string {
	if (problem.sourcePath) {
		switch (problem.kind) {
			case 'source-missing':
				return localize('basehalf.canvas.videoComposer.namedInputSourceMissing', "Input source '{0}' is missing.", problem.sourcePath);
			case 'source-changed':
				return localize('basehalf.canvas.videoComposer.namedInputSourceChanged', "Input source '{0}' changed after it was attached.", problem.sourcePath);
			case 'source-unverified':
				return localize('basehalf.canvas.videoComposer.namedInputSourceUnverified', "Save and verify input source '{0}' before generating.", problem.sourcePath);
		}
	}
	return baseHalfVideoInputPresentationProblemLabel(problem.kind);
}

export function baseHalfCanvasVideoInputReadinessMessage(
	problem: IBaseHalfVideoInputPresentationProblem
): IBaseHalfVideoMessage {
	const actionLabel = problem.kind === 'missing-start-frame'
		? localize('basehalf.canvas.videoComposer.addStartFrame', "Add Start Frame.")
		: problem.kind === 'missing-end-frame'
			? localize('basehalf.canvas.videoComposer.addEndFrame', "Add End Frame.")
			: localize('basehalf.canvas.videoComposer.reviewInputs', "Review inputs");
	return Object.freeze({
		kind: 'input-readiness-problem',
		message: problem.kind === 'missing-start-frame' || problem.kind === 'missing-end-frame'
			? actionLabel
			: baseHalfVideoInputPresentationProblemMessage(problem),
		action: Object.freeze({
			id: 'review-inputs',
			label: actionLabel
		})
	});
}

const BASEHALF_VIDEO_INPUTS_OVERLAY_FOCUS_PREFIX = 'video-overlay:inputs:';

function baseHalfVideoCanvasPickOriginFocusKey(originFocusKey: string | undefined, role: string): string {
	return originFocusKey?.startsWith(BASEHALF_VIDEO_INPUTS_OVERLAY_FOCUS_PREFIX)
		? originFocusKey
		: `video:input:${role}`;
}

function baseHalfVideoCanvasPickInputsOverlayFocusKey(returnFocusKey: string | undefined): string | undefined {
	return returnFocusKey?.startsWith(BASEHALF_VIDEO_INPUTS_OVERLAY_FOCUS_PREFIX)
		? returnFocusKey.slice(BASEHALF_VIDEO_INPUTS_OVERLAY_FOCUS_PREFIX.length)
		: undefined;
}

export function baseHalfCanvasVideoPickCandidatePaths(
	modelPaths: readonly string[],
	targetNodePath: string
): readonly string[] {
	return Object.freeze(modelPaths.filter(sourcePath => sourcePath !== targetNodePath));
}

export function baseHalfCanvasVideoPickCandidateBatches(
	modelPaths: readonly string[],
	targetNodePath: string,
	maximumBatchSize = 16
): readonly (readonly string[])[] {
	if (!Number.isInteger(maximumBatchSize) || maximumBatchSize < 1) {
		throw new Error('Video input candidate batch size must be a positive integer.');
	}
	const paths = baseHalfCanvasVideoPickCandidatePaths(modelPaths, targetNodePath);
	const batches: (readonly string[])[] = [];
	for (let offset = 0; offset < paths.length; offset += maximumBatchSize) {
		batches.push(Object.freeze(paths.slice(offset, offset + maximumBatchSize)));
	}
	return Object.freeze(batches);
}

export function baseHalfCanvasVideoPickMountedCandidatePaths(
	mountedPaths: readonly string[],
	candidatePaths: ReadonlySet<string>
): readonly string[] {
	return Object.freeze(mountedPaths.filter(path => candidatePaths.has(path)));
}

export function baseHalfCanvasVideoPickHasCandidateChange(
	candidatePaths: Iterable<string>,
	affects: (sourcePath: string) => boolean
): boolean {
	for (const sourcePath of candidatePaths) {
		if (affects(sourcePath)) {
			return true;
		}
	}
	return false;
}

export function baseHalfCanvasVideoPickRevisionDependencyPaths(
	sourcePath: string,
	artifactPath?: string
): readonly string[] {
	return Object.freeze([...new Set([sourcePath, ...(artifactPath ? [artifactPath] : [])])]);
}

export function baseHalfCanvasVideoPickCheckpointCanContinue(
	state: IBaseHalfVideoCanvasPickState,
	epoch: number,
	transactionIsCurrent: boolean,
	lifetimeIsCurrent: boolean,
	surfaceIsConnected: boolean
): boolean {
	return transactionIsCurrent
		&& lifetimeIsCurrent
		&& surfaceIsConnected
		&& state.epoch === epoch
		&& state.request?.epoch === epoch
		&& state.phase === 'preflighting';
}

export function baseHalfCanvasSetVideoInputPickActive(
	cards: HTMLElement,
	surface: HTMLElement,
	targetNodePath: string,
	active: boolean
): void {
	if (active) {
		cards.dataset.videoInputPickActive = targetNodePath;
		surface.classList.add('input-pick-active');
		return;
	}
	if (cards.dataset.videoInputPickActive === targetNodePath) {
		delete cards.dataset.videoInputPickActive;
	}
	surface.classList.remove('input-pick-active');
}

export function disposeBaseHalfCanvasVideoPickStore(
	activePickStore: MutableDisposable<DisposableStore>,
	pickStore: DisposableStore
): boolean {
	if (activePickStore.value === pickStore) {
		activePickStore.clear();
		return true;
	}
	pickStore.dispose();
	return false;
}

function baseHalfVideoDocumentConfigurationProblem(
	document: IBaseHalfNodeDocument,
	recipe: IBaseHalfCanvasRecipeDescriptor | undefined,
	modelServices: readonly IBaseHalfModelServiceDescriptor[],
	registry: IBaseHalfVideoModelRegistry,
	inputKinds: ReadonlyMap<string, BaseHalfCanvasContentKind>
): string | undefined {
	if (document.kind !== 'video' || recipe?.modelCapability !== 'video' || !document.recipe) {
		return undefined;
	}
	if (!recipe.videoModelCatalogId) {
		return 'The selected video generator is not bound to a reviewed model catalog.';
	}
	const service = modelServices.find(candidate => candidate.id === document.recipe!.modelServiceId?.toLowerCase());
	// The generic local-state projection owns missing/unconfigured connection
	// messaging. Catalog validation begins only after an exact service exists.
	if (!service?.configured) {
		return undefined;
	}
	if (!isBaseHalfPublicHttpsBearerModelServiceConfiguration(service)) {
		return 'Reconnect this video model service with a public HTTPS endpoint and Bearer API key.';
	}
	const snapshotValue = document.recipe.parameters[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID];
	if (snapshotValue === undefined || !document.recipe.modelId) {
		return 'Choose a reviewed video model.';
	}
	let snapshot: IBaseHalfVideoModelSelectionSnapshot;
	try {
		snapshot = parseBaseHalfVideoModelSelectionSnapshot(snapshotValue, recipe.videoModelCatalogId);
	} catch (error) {
		return error instanceof Error ? error.message : 'The saved video model selection is invalid.';
	}
	if (snapshot.modelId !== document.recipe.modelId) {
		return 'The saved video model selection does not match the selected model.';
	}
	const persisted = resolveBaseHalfVideoModelSelectionSnapshot(registry, recipe.videoModelCatalogId, service, snapshot);
	if (persisted.status !== 'supported') {
		return persisted.reason;
	}
	const currentInputs = baseHalfVideoInputState(document.prompt, document.recipe.inputBindings, inputKinds);
	const current = registry.resolve({ ...persisted.descriptor.key, mode: snapshot.mode, inputs: currentInputs });
	if (current.status !== 'supported') {
		return current.reason;
	}
	const normalization = normalizeBaseHalfVideoSettings(current, baseHalfVideoSettingsFromRecipeParameters(document.recipe.parameters));
	if (normalization.status !== 'ready') {
		return normalization.reason;
	}
	const canonicalParameters = baseHalfCanonicalVideoParameterDraft(recipe.videoModelCatalogId, current, currentInputs, normalization);
	if (!objectsEqual(document.recipe.parameters, canonicalParameters)) {
		return 'Review the model settings and save this Draft again.';
	}
	return getBaseHalfVideoPromptProblem(current, document.prompt);
}

function layoutBaseHalfVideoComposerPopover(surface: HTMLElement, popover: HTMLElement, bounds?: DOMRect): boolean {
	const surfaceRect = surface.getBoundingClientRect();
	const kind = (['models', 'settings', 'inputs', 'attempts'] as const).find(candidate => popover.classList.contains(candidate));
	const trigger = kind ? (surface.querySelector<HTMLElement>(`[data-video-composer-trigger="${kind}"]`)
		?? (kind === 'inputs' ? surface.querySelector<HTMLElement>('.basehalf-video-composer-inputs') : undefined)) : undefined;
	if (!kind || !trigger) {
		return false;
	}
	const surfaceWindow = surface.ownerDocument.defaultView ?? mainWindow;
	const viewportRect = bounds ?? new DOMRect(0, 0, surfaceWindow.innerWidth, surfaceWindow.innerHeight);
	const placement = resolveBaseHalfVideoComposerPopoverPlacement({
		kind,
		composerPlacement: surface.dataset.placement === 'above' || surface.dataset.placement === 'clamped-above'
			? surface.dataset.placement
			: surface.dataset.placement === 'clamped-below' ? 'clamped-below' : 'below',
		composer: surfaceRect,
		trigger: trigger.getBoundingClientRect(),
		viewport: viewportRect,
		desiredHeight: popover.scrollHeight || 160,
		alignment: kind === 'inputs' ? 'composer-leading' : kind === 'attempts' ? 'trigger-trailing' : 'trigger-leading'
	});
	popover.dataset.popoverPlacement = placement.placement;
	popover.style.left = `${Math.round(placement.left)}px`;
	popover.style.top = `${Math.round(placement.top)}px`;
	popover.style.right = 'auto';
	popover.style.bottom = 'auto';
	popover.style.width = `${Math.round(placement.width)}px`;
	popover.style.setProperty('--basehalf-video-popover-max-height', `${Math.max(48, Math.floor(placement.maxHeight))}px`);
	return placement.width >= 48 && placement.maxHeight >= 48;
}

interface IBaseHalfVideoComposerPortalLayout extends IBaseHalfVideoComposerLayout {
	readonly epoch: number;
	readonly anchorChanged: boolean;
	readonly viewportResized: boolean;
	readonly viewportInteraction: boolean;
	readonly manipulating?: BaseHalfVideoComposerDirectManipulation;
}

interface IBaseHalfRenderedNodeChrome {
	readonly card: HTMLElement;
	readonly title: string;
	readonly status?: HTMLElement;
	readonly action?: HTMLButtonElement;
	readonly progress?: HTMLElement;
	readonly progressValue?: HTMLElement;
}

interface IBaseHalfActiveNodeLocalSurface {
	readonly sceneKey: string;
	readonly path: string;
	readonly resource: URI;
	readonly nodeId: string;
	readonly nodeKind: IBaseHalfNodeDocument['kind'];
	hasDraftChanges(): boolean;
	prepareForImport(): Promise<boolean>;
	closeForSwitch(): Promise<boolean>;
	closeForShutdown(): Promise<boolean>;
	closeTransientOverlay(): void;
	showVideoDetails(): Promise<void>;
	rebindScene(sceneKey: string, structuralEpoch: number): void;
}

interface IBaseHalfActiveCanvasNoteEditor {
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly path: string;
	readonly resourceKey: string;
	readonly mountedVisualKey: string;
	readonly state: IBaseHalfCardDetailState;
	readonly card: HTMLElement;
	readonly container: HTMLElement;
	readonly host: HTMLElement;
	readonly fallback: HTMLElement;
	readonly fallbackRendering: DisposableStore;
	readonly mountDisposables: DisposableStore;
	readonly instance: BaseHalfCanvasMarkdownInlineEditor;
	readonly open: Promise<void>;
	readonly focusIntent: IBaseHalfPendingCanvasNoteFocus | undefined;
	chromeStale: boolean;
	closing?: Promise<boolean>;
}

interface IBaseHalfCanvasNotePreviewMount {
	readonly path: string;
	readonly resourceKey: string;
	readonly card: HTMLElement;
	readonly container: HTMLElement;
	readonly fallback: HTMLElement;
	readonly rendering: DisposableStore;
	preview: { readonly kind: 'markdown' | 'richRequired'; readonly text: string };
}

export function baseHalfCanvasRetainedCardChromeIsStale(mountedVisualKey: string, currentVisualKey: string): boolean {
	return mountedVisualKey !== currentVisualKey;
}

export function baseHalfCanvasVideoOverlayNextFocusTarget(
	requestedRepairFocusTarget: HTMLElement | undefined,
	connectedExactFocusTarget: HTMLElement | undefined,
	repairedModelFocusTarget: HTMLElement | undefined,
	fallbackFocusTarget: HTMLElement | undefined
): HTMLElement | undefined {
	return requestedRepairFocusTarget ?? connectedExactFocusTarget ?? repairedModelFocusTarget ?? fallbackFocusTarget;
}

interface IBaseHalfCanvasPostCreateOwner {
	readonly interactionEpoch: number;
	readonly navigationEpoch: number;
	readonly navigationState: IBaseHalfCanvasNavigationState;
}

export function baseHalfCanvasPostCreateOwnerIsCurrent(
	owner: IBaseHalfCanvasPostCreateOwner,
	interactionEpoch: number,
	navigationEpoch: number,
	navigationState: IBaseHalfCanvasNavigationState
): boolean {
	return owner.interactionEpoch === interactionEpoch
		&& owner.navigationEpoch === navigationEpoch
		&& owner.navigationState === navigationState;
}

interface IBaseHalfPendingCanvasSelection {
	readonly sceneKey: string;
	readonly paths: readonly string[];
	readonly owner: IBaseHalfCanvasPostCreateOwner;
}

interface IBaseHalfPendingCanvasFit {
	readonly sceneKey: string;
	readonly paths: readonly string[];
	readonly owner: IBaseHalfCanvasPostCreateOwner;
	readonly viewportGeneration: number;
}

type IBaseHalfPendingCanvasNoteFocus = {
	readonly path: string;
	readonly point?: IBaseHalfCanvasNoteEditPoint;
	readonly selection?: IBaseHalfCanvasMarkdownInlineSelection;
	readonly createOwner?: IBaseHalfCanvasPostCreateOwner;
} & ({
	readonly focus: true;
	readonly lease: IBaseHalfCanvasNoteFocusLease;
	/** The element that owned focus when a newly created Note requested its
	 *  inline editor. The card may claim focus only while that intent is still
	 *  current, so asynchronous preview hydration never steals focus back from
	 *  a later user interaction. */
	readonly createFocusOrigin?: Element | null;
	readonly createFocusReturnPath?: string;
} | {
	readonly focus: false;
});

type IBaseHalfPendingCreatedCanvasNoteActivation = {
	readonly sceneKey: string;
	readonly path: string;
	readonly resourceKey: string;
	readonly owner: IBaseHalfCanvasPostCreateOwner;
	readonly fitPaths?: readonly string[];
	readonly fitViewportGeneration?: number;
} & ({
	readonly focus: true;
	readonly focusOrigin: Element | null;
	readonly focusReturnPath?: string;
	readonly lease: IBaseHalfCanvasNoteFocusLease;
} | {
	readonly focus: false;
});

interface IBaseHalfPendingCanvasNoteFormatCommand {
	readonly sceneKey: string;
	readonly path: string;
	readonly resourceKey: string;
	readonly command: BaseHalfMarkdownFormatCommand;
	readonly completion: DeferredPromise<boolean>;
	navigationGuard?: IBaseHalfPendingCanvasNoteNavigationGuard;
	active?: IBaseHalfActiveCanvasNoteEditor;
	cancelled: boolean;
	running: boolean;
}

interface IBaseHalfPendingMarkdownRichFormatCommand {
	readonly resourceKey: string;
	readonly command: BaseHalfMarkdownFormatCommand;
}

interface IBaseHalfPendingCanvasNoteNavigationGuard {
	readonly ownership: BaseHalfCanvasNoteFormatNavigationOwnership<IBaseHalfPendingCanvasNoteFormatCommand>;
	readonly editor: IBaseHalfActiveCanvasEditor;
	closing?: Promise<boolean>;
}

type BaseHalfCanvasCardPreview =
	| { readonly kind: 'folder'; readonly total: number; readonly items: readonly BaseHalfCanvasFolderPreviewItem[] }
	| ({ readonly kind: 'media' } & IBaseHalfCanvasMediaPreview)
	| {
		readonly kind: 'node';
		readonly document: IBaseHalfNodeDocument;
		readonly execution?: IBaseHalfNodeExecutionState;
		readonly recipe?: IBaseHalfCanvasRecipeDescriptor;
		readonly videoConfiguration?:
			| { readonly valid: true }
			| { readonly valid: false; readonly problem: string };
		readonly matchingRecipeCount: number;
		readonly modelServices: readonly IBaseHalfModelServiceDescriptor[];
		readonly resultMedia?: IBaseHalfCanvasMediaPreview;
		readonly resultOutputText?: string;
		readonly resultIntegrity?: Exclude<BaseHalfNodeArtifactIntegrity, 'available'>;
		readonly inputKinds: ReadonlyMap<string, BaseHalfCanvasContentKind>;
		readonly directSourcePaths: readonly string[];
		readonly directSourceProblems: ReadonlyMap<string, string>;
		readonly graphProblem?: string;
		readonly verificationPending?: boolean;
		readonly dirty: boolean;
	}
	| { readonly kind: 'nodeLoading'; readonly text: string }
	| { readonly kind: 'invalidNode'; readonly text: string }
	| { readonly kind: 'text' | 'code' | 'markdown' | 'empty' | 'loading' | 'unavailable' | 'richRequired'; readonly text: string };

export function baseHalfCanvasCardPreviewRenderKey(preview: BaseHalfCanvasCardPreview | undefined): string {
	return JSON.stringify(preview, (_key, value: unknown) => {
		if (value instanceof Map) {
			return [...value.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)));
		}
		return value;
	}) ?? '';
}

export function baseHalfCanvasCardPreviewCanRetainElement(
	resultNode: boolean,
	previous: BaseHalfCanvasCardPreview | undefined,
	next: BaseHalfCanvasCardPreview | undefined
): boolean {
	return previous === next
		|| (resultNode && baseHalfCanvasCardPreviewRenderKey(previous) === baseHalfCanvasCardPreviewRenderKey(next));
}

export function baseHalfCanvasWarningDisplayMessage(message: string): string {
	return message === 'Corrupt canvas.yaml' || message.startsWith('Corrupt canvas.yaml at ')
		? 'Corrupt canvas.yaml'
		: message;
}

export function baseHalfCanvasPendingSelectionIsReady(
	paths: readonly string[],
	availablePaths: ReadonlySet<string>
): boolean {
	return paths.length > 0 && paths.every(path => availablePaths.has(path));
}

/**
 * Builds the narrow durable checkpoint used before a Draft leaves the canvas
 * to unlock a model provider. Incomplete provider/model choices are never
 * serialized: authored identity and prompt advance while the last valid saved
 * recipe (or no recipe for a new node) remains the auditable configuration.
 */
export function baseHalfCanvasProvisionalVideoDraftDocument(
	document: IBaseHalfNodeDocument,
	title: string,
	role: string,
	prompt: string
): IBaseHalfNodeDocument | undefined {
	if (document.kind !== 'video' || document.result || document.attempts.length > 0) {
		return undefined;
	}
	return {
		...document,
		title: title.trim(),
		role: role.trim(),
		prompt
	};
}

interface IBaseHalfCanvasCardPreviewCacheEntry {
	readonly item: IBaseHalfCanvasItem;
	readonly preview: BaseHalfCanvasCardPreview;
}
interface IBaseHalfCanvasCardRenderCacheEntry {
	readonly item: IBaseHalfCanvasItem;
	readonly preview: BaseHalfCanvasCardPreview | undefined;
	readonly visualKey: string;
	readonly sceneKey: string;
	readonly element: HTMLElement;
}
type BaseHalfCanvasFolderPreviewItem = { readonly name: string; readonly kind: 'file' | 'folder' };
type BaseHalfCanvasGlyphType = 'folder' | 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'presentation' | 'code' | 'file' | 'generic' | 'badge';
type BaseHalfCardDetailSaveStatus = 'saving' | 'saved' | 'error';

function canvasResultNodeKindLabel(kind: BaseHalfNodeKind): string {
	switch (kind) {
		case 'file':
			return localize('basehalf.canvas.resultKind.file', "File");
		case 'image':
			return localize('basehalf.canvas.resultKind.image', "Image");
		case 'video':
			return localize('basehalf.canvas.resultKind.video', "Video");
		case 'audio':
			return localize('basehalf.canvas.resultKind.audio', "Audio");
		case 'pdf':
			return localize('basehalf.canvas.resultKind.pdf', "PDF");
		case 'presentation':
			return localize('basehalf.canvas.resultKind.presentation', "Presentation");
	}
}

const nodeAttemptDateFormatter = safeIntl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit'
});
type BaseHalfBadgeEditorFocusTarget = 'prompt' | 'add-reference' | 'inbound-toggle';
type BaseHalfCanvasBadgeFocusTarget = BaseHalfBadgeEditorFocusTarget | 'toggle';
interface IBaseHalfBadgeEditorControls {
	readonly prompt?: HTMLTextAreaElement;
	readonly addReference?: HTMLButtonElement;
	readonly inboundToggle?: HTMLButtonElement;
}
interface IBaseHalfBadgeDescriptionDraft {
	readonly node: IBaseHalfBadgeNode;
	readonly guard: IBaseHalfCanvasMutationGuard;
	readonly identityStamp: IBaseHalfWorkspaceResourceMutationStamp;
	readonly resourceIdentity: string;
	value: string;
	recovery?: 'retry-exhausted' | 'identity-changed' | 'resource-missing';
}
interface IBaseHalfBadgeDescriptionPending extends IBaseHalfBadgeDescriptionDraft {
	delayReleased: boolean;
	retryAttempt: number;
	readonly delay: Promise<void>;
	readonly releaseDelay: () => void;
	write?: Promise<void>;
}
type BaseHalfBadgeDescriptionSaveState = 'pending' | 'saved' | 'retrying' | 'error';
interface IBaseHalfCardDetailSurface {
	readonly host: HTMLElement;
	readonly store: DisposableStore;
	readonly instance: IBaseHalfCardDetailSurfaceInstance;
	readonly whenRendered: Promise<unknown>;
}
interface IBaseHalfCanvasMutationGuard {
	readonly workspaceKey: string;
	readonly resourceStamp: IBaseHalfWorkspaceResourceMutationStamp;
	readonly resourceIdentity: string;
	run<T>(task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>, relatedStamps?: readonly IBaseHalfWorkspaceResourceMutationStamp[]): Promise<T>;
}

interface IBaseHalfCanvasUndoNode {
	readonly path: string;
	readonly kind: IBaseHalfCanvasItem['kind'];
}

interface IBaseHalfCanvasReferenceTransition {
	readonly source: IBaseHalfCanvasUndoNode;
	readonly target: IBaseHalfCanvasUndoNode;
	readonly expected: IBaseHalfReferenceState;
	readonly next: IBaseHalfReferenceState;
}

interface IBaseHalfCanvasNodeDocumentTransition {
	readonly resource: URI;
	readonly expected: VSBuffer;
	readonly next: VSBuffer;
}

interface IBaseHalfCanvasConnectionTransition {
	readonly folder: IBaseHalfCanvasFolderState;
	readonly nodes: readonly IBaseHalfCanvasUndoNode[];
	readonly references: readonly IBaseHalfCanvasReferenceTransition[];
	readonly canvas: IBaseHalfCanvasStateTransition;
	readonly documents: readonly IBaseHalfCanvasNodeDocumentTransition[];
}

interface IBaseHalfCanvasCreatedNodeTransition {
	readonly folder: IBaseHalfCanvasFolderState;
	readonly targetPath: string;
	readonly targetResource: URI;
	readonly contents: VSBuffer;
	readonly stashResource: URI;
	readonly connection: IBaseHalfCanvasConnectionTransition;
}

interface IBaseHalfCanvasConnectionTargetDocumentSnapshot {
	readonly resource: URI;
	readonly contents: VSBuffer;
	readonly document: IBaseHalfNodeDocument;
	readonly recipe?: IBaseHalfCanvasRecipeDescriptor;
}

interface IBaseHalfCanvasConnectionTargetSnapshot {
	readonly path: string;
	readonly kind: IBaseHalfCanvasItem['kind'];
	readonly directSourcePaths: readonly string[];
	readonly inputKinds: ReadonlyMap<string, BaseHalfCanvasContentKind>;
	readonly node?: IBaseHalfCanvasConnectionTargetDocumentSnapshot;
}
interface IBaseHalfStampedReferenceCandidate {
	readonly candidate: IBaseHalfCanvasItem;
	readonly stamp: IBaseHalfWorkspaceResourceMutationStamp;
}
type BaseHalfCanvasInlineEdit =
	| {
		readonly kind: 'rename';
		readonly context: IBaseHalfCanvasActionContext;
		readonly resource: URI;
		readonly parent: URI;
		readonly path: string;
		readonly initialValue: string;
		value: string;
		selectionPending: boolean;
	}
	| {
		readonly kind: 'create';
		readonly context: IBaseHalfCanvasActionContext;
		readonly parent: URI;
		readonly createKind: Exclude<BaseHalfCanvasCreateKind, 'note' | 'resultNode'>;
		readonly initialValue: string;
		readonly anchor: { readonly x: number; readonly y: number };
		readonly canvasPosition: { readonly x: number; readonly y: number };
		value: string;
		selectionPending: boolean;
	};

const TEXT_PREVIEW_MAX_BYTES = BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES;
const CANVAS_MARKDOWN_FULL_EDITOR_LABEL = localize(
	'basehalf.canvas.note.fullEditorRequired',
	"This Markdown file is too large for quick edit. Double-click to open the full editor."
);
const BASEHALF_CANVAS_SELECTION_UNDO_FILE_SIZE = 5_000_000;
const BASEHALF_CANVAS_UNDO_REDO_PRIORITY = 115;
const BASEHALF_CANVAS_NOTE_EDITOR_UNDO_REDO_PRIORITY = 10_000;
// Video is the authored object on this canvas, not a thumbnail inside a generic
// result card. Its title is external chrome, so the node itself is a true 16:9
// stage rather than a media frame plus an internal header.
const BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH = 720;
const BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT = 405;

class BaseHalfCanvasWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.canvasWorkbench';

	private readonly root: HTMLElement;
	private readonly createButton: HTMLButtonElement;
	private readonly chrome: HTMLElement;
	private readonly zoomControls: HTMLElement;
	private readonly snapToggle: HTMLButtonElement;
	private readonly zoomValue: HTMLButtonElement;
	private readonly surface: HTMLElement;
	private readonly cards: HTMLElement;
	private readonly inlineEditLayer: HTMLElement;
	private readonly canvasOverlay: HTMLElement;
	private readonly canvasScene: BaseHalfCanvasReactScene;
	private readonly detail: HTMLElement;
	private readonly detailTitle: HTMLElement;
	private readonly detailMeta: HTMLElement;
	private readonly detailSaveStatus: HTMLButtonElement;
	private readonly detailSaveStatusIcon: HTMLElement;
	private readonly detailSaveStatusLabel: HTMLElement;
	private readonly detailProjectionActions: HTMLElement;
	private readonly detailBadgeZone: HTMLElement;
	private readonly detailBody: HTMLElement;
	private readonly editorContainer: HTMLElement;
	private readonly cardListeners = this._register(new DisposableStore());
	private readonly cardListenerStores = new Map<string, DisposableStore>();
	private readonly inlineEditListeners = this._register(new DisposableStore());
	private readonly detailChromeDisposables = this._register(new DisposableStore());
	private readonly detailTitleDisposables = this._register(new DisposableStore());
	private readonly canvasUndoRedoSource = BASEHALF_CANVAS_UNDO_REDO_SOURCE;

	private renderSeq = 0;
	private backgroundRenderTimer: number | undefined;
	private readonly badgeDescriptionTimers = new Map<string, number>();
	private readonly badgeDescriptionDrafts = new Map<string, IBaseHalfBadgeDescriptionDraft>();
	private readonly badgeDescriptionRecoveryDrafts = new Map<string, IBaseHalfBadgeDescriptionDraft[]>();
	private readonly badgeDescriptionPending = new Map<string, IBaseHalfBadgeDescriptionPending>();
	private readonly badgeDescriptionSaveStates = new Map<string, BaseHalfBadgeDescriptionSaveState>();
	private readonly badgeInteractionRenderGate = new BaseHalfCanvasInteractionRenderGate();
	private badgeInteractionReleaseTimer: number | undefined;
	private readonly pendingCanvasWarnings: string[] = [];
	private renderedBadges: ReadonlyMap<string, IBaseHalfBadgeFile> = new Map();
	private renderedBadgeProblems: ReadonlyMap<string, IBaseHalfBadgeReadProblem> = new Map();
	private readonly detailBadgeDisposables: DisposableStore;
	private detailBadgeSeq = 0;
	private detailBadgeOpen = false;
	private detailBadgeRefreshAfterFocusLeaves = false;
	private detailBadgeResourceKey: string | undefined;
	private detailResourceMutationStamp: IBaseHalfWorkspaceResourceMutationStamp | undefined;
	private readonly expandedInboundBadges = new Set<string>();
	private readonly openBadgeFaces = new Set<string>();
	private readonly canvasBadgeFocusRefresh: MutableDisposable<IDisposable>;
	private canvasBadgeRefreshAfterFocusLeaves = false;
	private pendingCanvasBadgeFocus: { readonly path: string; readonly target: BaseHalfCanvasBadgeFocusTarget } | undefined;
	private renderedItemsByPath = new Map<string, IBaseHalfCanvasItem>();
	private renderedCardPreviewsByPath = new Map<string, IBaseHalfCanvasCardPreviewCacheEntry>();
	private renderedCardsByPath = new Map<string, IBaseHalfCanvasCardRenderCacheEntry>();
	private renderedCardElementsByPath = new Map<string, HTMLElement>();
	private renderedNodeChromeByPath = new Map<string, IBaseHalfRenderedNodeChrome>();
	private renderedPathByResourceKey = new Map<string, string>();
	private renderedSceneCards: readonly IBaseHalfCanvasSceneCard[] = [];
	private renderedSceneEdges: readonly IBaseHalfCanvasSceneEdge[] = [];
	private readonly cardPresentationUpdaters = new WeakMap<HTMLElement, (presentation: IBaseHalfCanvasSceneCardPresentation) => void>();
	private readonly cardPreviewHydrationQueue = new BaseHalfCanvasPreviewHydrationQueue();
	private cardPreviewHydrationTimer: number | undefined;
	private cardPreviewHydrationRunning = false;
	private readonly cardPreviewVerificationQueue = new BaseHalfCanvasPreviewVerificationQueue();
	private cardPreviewModelServicesGeneration = -1;
	private cardPreviewModelServicesPromise: Promise<readonly IBaseHalfModelServiceDescriptor[]> | undefined;
	private renderedSceneStructuralEpoch = 0;
	private readonly detailSurfaces = new Map<BaseHalfCardDetailProjection, IBaseHalfCardDetailSurface>();
	private detailSurfaceResourceKey: string | undefined;
	private activeDetailProjection: BaseHalfCardDetailProjection | undefined;
	private detailSwapSeq = 0;
	private detailIdentityReconcileSeq = 0;
	private detailIdentityPendingResourceKey: string | undefined;
	private folderFocusTimer: number | undefined;
	private pendingFolderFocusWrite: {
		readonly folder: IBaseHalfCanvasFolderState;
		readonly sceneKey: string;
		readonly structuralStamp: IBaseHalfWorkspaceMutationStamp;
		readonly fields: { readonly viewport_center: { readonly x: number; readonly y: number }; readonly zoom: number };
	} | undefined;
	private lastFolderFocusKey: string | undefined;
	private restoredFolderFocusKey: string | undefined;
	private folderFocusRestoreGeneration = 0;
	private canvasZoom = 1;
	private canvasSnapEnabled = true;
	private zoomMenuOpen = false;
	private zoomMenu: HTMLElement | undefined;
	private zoomMenuInput: HTMLInputElement | undefined;
	private zoomMenuInAction: HTMLButtonElement | undefined;
	private zoomMenuOutAction: HTMLButtonElement | undefined;
	private zoomMenuPresetActions: readonly { readonly button: HTMLButtonElement; readonly zoom: number }[] = [];
	private renderQueuedBehindGesture = false;
	private canvasLayoutReconcileQueuedBehindGesture = false;
	private canvasLayoutReconcileGeneration = 0;
	private readonly canvasInteractionEndWaiters = new Set<() => void>();
	private inlineEdit: BaseHalfCanvasInlineEdit | undefined;
	private canvasInteractionEpoch = 0;
	private canvasNavigationEpoch = 0;
	private pendingCanvasSelection: IBaseHalfPendingCanvasSelection | undefined;
	private pendingCanvasFit: IBaseHalfPendingCanvasFit | undefined;
	private pendingDetailNameEditResourceKey: string | undefined;
	private pendingDetailEditorFocusResourceKey: string | undefined;
	private fileDragDepth = 0;
	private lastCanvasContextMenu: {
		readonly context: IBaseHalfCanvasActionContext;
		readonly request: BaseHalfCanvasSceneContextMenuRequest;
		readonly createPosition?: { readonly x: number; readonly y: number };
	} | undefined;
	private activeNodeLocalSurface: IBaseHalfActiveNodeLocalSurface | undefined;
	private activeCanvasNoteEditor: IBaseHalfActiveCanvasNoteEditor | undefined;
	private canvasNoteSurfacePath: string | undefined;
	private pendingCanvasNoteFocus: IBaseHalfPendingCanvasNoteFocus | undefined;
	private pendingCreatedCanvasNoteActivation: IBaseHalfPendingCreatedCanvasNoteActivation | undefined;
	private readonly canvasNotePreviewMounts = new WeakMap<HTMLElement, IBaseHalfCanvasNotePreviewMount>();
	private renderedNoteBackgrounds: ReadonlyMap<string, BaseHalfCanvasNoteBackground> = new Map();
	private readonly canvasNoteFormatStates = new Map<string, IBaseHalfCanvasNoteFormatState>();
	private readonly canvasNoteSelections = new Map<string, IBaseHalfCanvasMarkdownInlineSelection>();
	private readonly canvasNoteEditPoints = new Map<string, IBaseHalfCanvasNoteEditPoint>();
	private readonly pendingCanvasNoteFormatCommands: IBaseHalfPendingCanvasNoteFormatCommand[] = [];
	private readonly pendingMarkdownRichFormatCommands: IBaseHalfPendingMarkdownRichFormatCommand[] = [];
	private pendingCanvasNoteFormatDrain: { readonly active: IBaseHalfActiveCanvasNoteEditor; readonly promise: Promise<void> } | undefined;
	private pendingCanvasNoteNavigationGuard: IBaseHalfPendingCanvasNoteNavigationGuard | undefined;
	private readonly pendingCanvasSelectionFormatBarrier = new BaseHalfCanvasNoteFormatSelectionBarrier();
	private readonly canvasNoteFocusLeaseOwner = new BaseHalfCanvasNoteFocusLeaseOwner();
	private nodeLocalSurfaceOpenChain: Promise<void> = Promise.resolve();
	private nodeLocalSurfaceIntent = 0;
	private pendingVideoModelConnectionCompletion: IBaseHalfModelConnectionCompletion | undefined;
	private videoModelConnectionResumeTimer: number | undefined;
	private preparedSceneSelection: {
		readonly sceneKey: string;
		readonly structuralEpoch: number;
		readonly paths: readonly string[];
	} | undefined;
	private disposed = false;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBaseHalfBadgeGraphService private readonly badgeGraphService: IBaseHalfBadgeGraphService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfCanvasAppearanceService private readonly canvasAppearanceService: IBaseHalfCanvasAppearanceService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IBaseHalfFocusMirrorService private readonly focusMirrorService: IBaseHalfFocusMirrorService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IDialogService private readonly dialogService: IDialogService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IPathService private readonly pathService: IPathService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IBaseHalfCanvasEditingService private readonly canvasEditingService: IBaseHalfCanvasEditingService,
		@IBaseHalfCanvasActionContextService private readonly canvasActionContextService: IBaseHalfCanvasActionContextService,
		@IBaseHalfNodeExecutionService private readonly nodeExecutionService: IBaseHalfNodeExecutionService,
		@IBaseHalfCanvasRecipeRegistryService private readonly canvasRecipeRegistryService: IBaseHalfCanvasRecipeRegistryService,
		@IBaseHalfModelServiceService private readonly modelServiceService: IBaseHalfModelServiceService,
		@IBaseHalfModelProviderCatalogService private readonly modelProviderCatalogService: IBaseHalfModelProviderCatalogService,
		@IBaseHalfModelConnectionNavigationService private readonly modelConnectionNavigationService: IBaseHalfModelConnectionNavigationService,
		@IBaseHalfVideoModelCatalogService private readonly videoModelCatalogService: IBaseHalfVideoModelCatalogService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IBaseHalfCardProjectionRegistryService private readonly cardProjectionRegistryService: IBaseHalfCardProjectionRegistryService,
		@IBaseHalfCardDetailSurfaceRegistryService private readonly cardDetailSurfaceRegistryService: IBaseHalfCardDetailSurfaceRegistryService,
		@IBaseHalfCanvasResourceDeletionService private readonly canvasResourceDeletionService: IBaseHalfCanvasResourceDeletionService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@ILifecycleService lifecycleService: ILifecycleService
	) {
		super();
		this._register(CommandsRegistry.registerCommand(BASEHALF_CANVAS_OPEN_RESULT_NODE_COMMAND_ID, (_accessor, argument: unknown) => {
			if (!isBaseHalfCanvasActionContext(argument)) {
				return;
			}
			return this.openResultNodeFromActionContext(argument);
		}));
		this.detailBadgeDisposables = this._register(new DisposableStore());
		this.canvasBadgeFocusRefresh = this._register(new MutableDisposable());
		this._register(lifecycleService.onBeforeShutdown(event => event.veto(
			this.vetoShutdownForUnsavedCanvasDrafts(),
			'veto.basehalfCanvasDrafts'
		)));
		this._register(lifecycleService.onWillShutdown(event => event.join(
			this.flushAllBadgeDescriptionWrites(),
			{ id: 'join.basehalfBadgeDescriptions', label: localize('join.basehalfBadgeDescriptions', "Saving Badge prompts") }
		)));

		const editorContainer = this.layoutService.getContainer(mainWindow, Parts.EDITOR_PART);
		if (!editorContainer) {
			throw new Error('BaseHalf canvas requires the main editor part container.');
		}

		this.editorContainer = editorContainer;
		this.editorContainer.classList.add('basehalf-canvas-host');
		this.root = DOM.$('.basehalf-canvas-workbench');
		this.root.setAttribute('aria-label', 'BaseHalf canvas');
		this.root.setAttribute('data-file-drop-label', localize('basehalf.canvas.dropFiles', "Drop files to import"));
		// Focusable (not tabbable) for canvas keyboard shortcuts. Edge deletion is
		// scoped more narrowly to the React Flow scene host.
		this.root.tabIndex = -1;
		for (const type of [DOM.EventType.POINTER_DOWN, DOM.EventType.KEY_DOWN, DOM.EventType.WHEEL] as const) {
			this._register(this.addDisposableListener(
				this.root.ownerDocument,
				type,
				event => this.onDocumentUserInteraction(event),
				true
			));
		}
		// A window-level blur supersedes delayed post-create presentation. Do not
		// capture descendant blur events: disabling the inline filename input is a
		// normal part of accepting Create and must not invalidate its own owner.
		this._register(this.addDisposableListener(mainWindow, DOM.EventType.BLUR, () => this.markCanvasUserInteraction()));
		this.createButton = append(this.root, $('button.basehalf-canvas-create-button')) as HTMLButtonElement;
		this.createButton.type = 'button';
		this.createButton.title = localize('basehalf.canvas.createMenu', "Create...");
		this.createButton.setAttribute('aria-label', localize('basehalf.canvas.createMenu', "Create..."));
		const createButtonIcon = append(this.createButton, $('span.codicon.codicon-add'));
		createButtonIcon.setAttribute('aria-hidden', 'true');
		this._register(this.addDisposableListener(this.createButton, 'click', () => this.showCanvasCreateMenu(this.createButton)));

		this.chrome = DOM.append(this.root, DOM.$('.basehalf-canvas-chrome'));
		this.zoomControls = DOM.append(this.chrome, DOM.$('.basehalf-canvas-zoom-controls'));
		this.zoomControls.setAttribute('role', 'group');
		this.zoomControls.setAttribute('aria-label', localize('basehalf.canvas.viewControls', "Canvas view controls"));
		this.snapToggle = append(this.zoomControls, $('button.basehalf-canvas-chrome-button.basehalf-canvas-snap-toggle')) as HTMLButtonElement;
		this.snapToggle.type = 'button';
		this.snapToggle.setAttribute('data-testid', 'canvas-snap-toggle');
		const snapIcon = append(this.snapToggle, $('span.codicon.codicon-magnet'));
		snapIcon.setAttribute('aria-hidden', 'true');
		this._register(this.addDisposableListener(this.snapToggle, 'click', () => this.toggleCanvasSnap()));
		this.zoomValue = append(this.zoomControls, $('button.basehalf-canvas-chrome-button.basehalf-canvas-zoom-value')) as HTMLButtonElement;
		this.zoomValue.type = 'button';
		this.zoomValue.setAttribute('aria-haspopup', 'dialog');
		this.zoomValue.setAttribute('aria-expanded', 'false');
		this.zoomValue.setAttribute('data-testid', 'canvas-zoom-trigger');
		this._register(this.addDisposableListener(this.zoomValue, 'click', () => this.toggleCanvasZoomMenu()));
		this._register(toDisposable(() => {
			if (this.zoomMenuOpen) {
				this.contextViewService.hideContextView();
			}
		}));
		this.surface = DOM.append(this.root, DOM.$('.basehalf-canvas-surface'));
		this.cards = DOM.append(this.surface, DOM.$('.basehalf-canvas-cards'));
		this.inlineEditLayer = DOM.append(this.surface, DOM.$('.basehalf-canvas-inline-edit-layer'));
		this.canvasOverlay = DOM.append(this.surface, DOM.$('.basehalf-canvas-overlay'));
		this.canvasScene = this._register(new BaseHalfCanvasReactScene(this.cards, {
			commitGeometry: (sceneKey, structuralEpoch, geometries) => this.commitSceneGeometry(sceneKey, structuralEpoch, geometries),
			connect: (sceneKey, structuralEpoch, connection) => this.connectSceneEdge(sceneKey, structuralEpoch, connection),
			createFromConnection: (sceneKey, structuralEpoch, drop) => this.createResultNodeFromConnection(sceneKey, structuralEpoch, drop),
			reconnect: (sceneKey, structuralEpoch, intent) => this.reconnectSceneEdge(sceneKey, structuralEpoch, intent),
			removeEdge: (sceneKey, structuralEpoch, edge) => this.removeEdgeFromScene(sceneKey, structuralEpoch, edge),
			performSelectionAction: (sceneKey, structuralEpoch, action, paths) => this.performSceneSelectionAction(sceneKey, structuralEpoch, action, paths),
			cancelPendingCardOpen: () => this.cancelPendingNodeActivation(),
			prepareSelectionChange: (sceneKey, structuralEpoch, paths) => this.prepareSceneSelectionChange(sceneKey, structuralEpoch, paths),
			focusNoteEditor: (sceneKey, structuralEpoch, path) => this.focusSceneNoteEditor(sceneKey, structuralEpoch, path),
			editNote: (sceneKey, structuralEpoch, path, point) => this.beginSceneNoteEdit(sceneKey, structuralEpoch, path, point),
			rememberNoteEditPoint: (sceneKey, structuralEpoch, path, point) => this.rememberSceneNoteEditPoint(sceneKey, structuralEpoch, path, point),
			formatNote: (sceneKey, structuralEpoch, path, command) => this.formatSceneNote(sceneKey, structuralEpoch, path, command),
			copyNote: (sceneKey, structuralEpoch, path) => this.copySceneNote(sceneKey, structuralEpoch, path),
			setNoteBackground: (sceneKey, structuralEpoch, path, background) => this.setSceneNoteBackground(sceneKey, structuralEpoch, path, background),
			openCard: (sceneKey, structuralEpoch, path) => this.openSceneCard(sceneKey, structuralEpoch, path),
			invokeVideoAction: (sceneKey, structuralEpoch, path, action, anchor) => this.invokeSceneVideoAction(sceneKey, structuralEpoch, path, action, anchor),
			showCreateMenu: (sceneKey, structuralEpoch, position) => this.showSceneContextMenu(
				sceneKey,
				structuralEpoch,
				{ kind: 'pane', anchor: position },
				position
			),
			showContextMenu: (sceneKey, structuralEpoch, request) => this.showSceneContextMenu(sceneKey, structuralEpoch, request),
			reportViewport: (sceneKey, viewport, final) => this.onSceneViewport(sceneKey, viewport, final),
			didStartViewportInteraction: () => {
				this.folderFocusRestoreGeneration++;
				this.markCanvasUserInteraction();
			},
			didEndInteraction: () => this.flushRenderQueuedBehindGesture(),
			reportError: error => {
				this.logService.error(error instanceof Error ? error : String(error));
				this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				this.requestRender();
			}
		}));
		this._register(this.addDisposableListener(this.surface, DOM.EventType.DRAG_ENTER, event => this.onCanvasFileDragEnter(event)));
		this._register(this.addDisposableListener(this.surface, DOM.EventType.DRAG_OVER, event => this.onCanvasFileDragOver(event)));
		this._register(this.addDisposableListener(this.surface, DOM.EventType.DRAG_LEAVE, event => this.onCanvasFileDragLeave(event)));
		this._register(this.addDisposableListener(this.surface, DOM.EventType.DROP, event => void this.onCanvasFileDrop(event)));

		this.detail = DOM.append(this.root, DOM.$('.basehalf-card-detail'));
		const detailHeader = append(this.detail, $('.basehalf-card-detail-header'));
		const detailTitleBlock = append(detailHeader, $('.basehalf-card-detail-title-block'));
		this.detailTitle = append(detailTitleBlock, $('.basehalf-card-detail-title'));
		this.detailMeta = append(detailTitleBlock, $('.basehalf-card-detail-meta'));
		this.detailBadgeZone = append(detailHeader, $('.basehalf-card-detail-badge'));
		const detailActions = append(detailHeader, $('.basehalf-card-detail-actions'));
		// Ordinary save state stays invisible (everything auto-saves); the
		// indicator only appears when saving stopped working, as the in-card
		// escape hatch: click retries the save.
		this.detailSaveStatus = append(detailActions, $('button.basehalf-card-detail-save-status')) as HTMLButtonElement;
		this.detailSaveStatus.type = 'button';
		this.detailSaveStatus.setAttribute('aria-hidden', 'true');
		this._register(this.addDisposableListener(this.detailSaveStatus, 'click', () => void this.editorFlushService.flushPane(BASEHALF_CARD_DETAIL_PANE_ID, { forceSerialize: true })));
		this.detailSaveStatusIcon = append(this.detailSaveStatus, $('span.basehalf-card-detail-save-status-icon.codicon'));
		this.detailSaveStatusIcon.setAttribute('aria-hidden', 'true');
		this.detailSaveStatusLabel = append(this.detailSaveStatus, $('span.basehalf-card-detail-save-status-label'));
		this.detailProjectionActions = append(detailActions, $('.basehalf-card-detail-projections'));
		const focusDocument = append(detailActions, $('button.basehalf-card-detail-focus.codicon')) as HTMLButtonElement;
		focusDocument.type = 'button';
		const updateFocusDocumentAction = () => {
			const sideBarVisible = this.layoutService.isVisible(Parts.SIDEBAR_PART);
			focusDocument.className = `basehalf-card-detail-focus codicon codicon-${sideBarVisible ? 'layout-sidebar-left-off' : 'layout-sidebar-left'}`;
			focusDocument.title = sideBarVisible
				? localize('basehalf.cardDetail.focusDocument', "Focus on document")
				: localize('basehalf.cardDetail.showSidebar', "Show sidebar");
			focusDocument.setAttribute('aria-label', focusDocument.title);
			focusDocument.setAttribute('aria-pressed', String(!sideBarVisible));
		};
		updateFocusDocumentAction();
		this._register(this.addDisposableListener(focusDocument, 'click', () => {
			this.layoutService.setPartHidden(this.layoutService.isVisible(Parts.SIDEBAR_PART), Parts.SIDEBAR_PART);
		}));
		this._register(this.layoutService.onDidChangePartVisibility(event => {
			if (event.partId === Parts.SIDEBAR_PART) {
				updateFocusDocumentAction();
			}
		}));
		const close = append(detailActions, $('button.basehalf-card-detail-close.codicon.codicon-close')) as HTMLButtonElement;
		close.type = 'button';
		close.title = 'Close';
		close.setAttribute('aria-label', 'Close');
		this._register(this.addDisposableListener(close, 'click', () => void this.canvasNavigationService.closeCardDetail()));
		this.detailBody = append(this.detail, $('.basehalf-card-detail-body'));
		this.registerCardDetailSurfaceProviders();

		this.editorContainer.prepend(this.root);

		this.resetCardPreviewHydrationScene();
		this._register(this.canvasNavigationService.onDidChangeState(() => {
			this.canvasNavigationEpoch++;
			this.canvasEditingService.invalidatePostCreateIntents();
			this.resetCardPreviewHydrationScene();
			this.requestRender();
		}));
		this._register(this.cardProjectionRegistryService.onDidChangeProjections(() => this.reconcileCardProjectionRegistrations()));
		this._register(this.cardDetailSurfaceRegistryService.onDidChangeProviders(() => this.reconcileCardProjectionRegistrations()));
		this._register(this.canvasEditingService.registerHandler(request => this.beginCanvasInlineEdit(request)));
		this._register(this.fileService.onDidFilesChange(event => {
			const folder = this.getCurrentFolder();
			if (!folder) {
				return;
			}

			// The folder's mirror node lives under `<workspace>/.bh/mirror/<rel>`,
			// NOT under the folder resource itself — an agent editing badge.yaml
			// for a SUBFOLDER canvas must still re-render it.
			const affectsBadgeMirror = event.affects(baseHalfMirrorRoot(folder.workspaceFolder));
			// While detail is open the document/editor owns normal user-file
			// refreshes. Only mirror changes can affect its Badge projection; do
			// not turn every Markdown auto-save into a graph read.
			const affectsVisibleSurface = this.canvasNavigationService.state.cardDetail
				? affectsBadgeMirror
				: event.affects(folder.resource) || affectsBadgeMirror;
			if (affectsVisibleSurface && !this.isFocusMirrorOnlyChange(event, folder)) {
				if (this.isCurrentCanvasLayoutOnlyChange(event, folder)) {
					this.scheduleCanvasLayoutReconciliation();
				} else {
					this.scheduleBackgroundRender();
				}
			}
		}));
		this._register(this.nodeExecutionService.onDidChange(event => {
			const folder = this.getCurrentFolder();
			if (folder && isEqualOrParent(event.resource, folder.resource)) {
				if (event.state) {
					this.patchRenderedNodeExecutionState(event.resource, event.state);
				} else {
					this.scheduleBackgroundRender();
				}
			}
		}));
		this._register(this.canvasRecipeRegistryService.onDidChange(() => this.scheduleBackgroundRender()));
		this._register(this.modelServiceService.onDidChange(() => {
			this.cardPreviewVerificationQueue.reset();
			this.cardPreviewModelServicesGeneration = -1;
			this.cardPreviewModelServicesPromise = undefined;
			this.scheduleBackgroundRender();
		}));
		this._register(this.modelConnectionNavigationService.onDidComplete(completion => {
			if (completion.intent.returnTarget?.kind !== 'videoModel') {
				return;
			}
			this.pendingVideoModelConnectionCompletion = completion;
			this.scheduleVideoModelConnectionResume();
		}));
		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => {
			const folder = this.getCurrentFolder();
			if (folder && isEqualOrParent(workingCopy.resource, folder.workspaceFolder)) {
				this.scheduleBackgroundRender();
			}
		}));
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.reconcileActiveEditor()));
		this._register(this.editorService.onDidActiveEditorChange(() => {
			this.reconcileActiveEditor();
			this.scheduleVideoModelConnectionResume();
		}));
		this._register(this.addDisposableListener(this.root, 'keydown', event => {
			if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229) {
				void this.canvasNavigationService.closeCardDetail();
				return;
			}
			this.onCanvasKeyDown(event);
		}));
		this._register(this.addDisposableListener(this.root, 'pointerdown', event => {
			const target = event.target;
			if ((isHTMLElement(target) || isSVGElement(target))
				&& target.closest('.basehalf-canvas-card-badge-toggle, .basehalf-canvas-card-badge-face')) {
				this.badgeInteractionRenderGate.begin();
			}
		}, true));
		const finishBadgePointerGesture = () => {
			if (this.badgeInteractionReleaseTimer !== undefined) {
				mainWindow.clearTimeout(this.badgeInteractionReleaseTimer);
			}
			// `click` follows `pointerup`. Keep the current card alive through that
			// dispatch, then apply the latest queued render in the next task.
			this.badgeInteractionReleaseTimer = mainWindow.setTimeout(() => {
				this.badgeInteractionReleaseTimer = undefined;
				if (this.badgeInteractionRenderGate.end() && !this.disposed) {
					this.requestRender();
				}
			}, 0);
		};
		this._register(this.addDisposableListener(this.root.ownerDocument, 'pointerup', finishBadgePointerGesture, true));
		this._register(this.addDisposableListener(this.root.ownerDocument, 'pointercancel', finishBadgePointerGesture, true));
		this._register(this.addDisposableListener(mainWindow, 'blur', finishBadgePointerGesture, true));
		this._register(UndoCommand.addImplementation(BASEHALF_CANVAS_NOTE_EDITOR_UNDO_REDO_PRIORITY, 'basehalfCanvasNoteEditor', () => {
			const active = this.activeCanvasNoteEditor;
			if (!active?.instance.hasFocus()) {
				return false;
			}
			return Promise.resolve(active.instance.undo()).catch(error => this.reportCanvasMutationError(error));
		}));
		this._register(RedoCommand.addImplementation(BASEHALF_CANVAS_NOTE_EDITOR_UNDO_REDO_PRIORITY, 'basehalfCanvasNoteEditor', () => {
			const active = this.activeCanvasNoteEditor;
			if (!active?.instance.hasFocus()) {
				return false;
			}
			return Promise.resolve(active.instance.redo()).catch(error => this.reportCanvasMutationError(error));
		}));
		this._register(UndoCommand.addImplementation(BASEHALF_CANVAS_UNDO_REDO_PRIORITY, 'basehalfCanvas', () => {
			if (!this.isCanvasUndoRedoActive() || !this.undoRedoService.canUndo(this.canvasUndoRedoSource)) {
				return false;
			}
			return Promise.resolve(this.undoRedoService.undo(this.canvasUndoRedoSource)).catch(error => this.reportCanvasMutationError(error));
		}));
		this._register(RedoCommand.addImplementation(BASEHALF_CANVAS_UNDO_REDO_PRIORITY, 'basehalfCanvas', () => {
			if (!this.isCanvasUndoRedoActive() || !this.undoRedoService.canRedo(this.canvasUndoRedoSource)) {
				return false;
			}
			return Promise.resolve(this.undoRedoService.redo(this.canvasUndoRedoSource)).catch(error => this.reportCanvasMutationError(error));
		}));
		this._register(toDisposable(() => {
			if (this.folderFocusTimer !== undefined) {
				mainWindow.clearTimeout(this.folderFocusTimer);
				this.folderFocusTimer = undefined;
			}
			for (const timer of this.badgeDescriptionTimers.values()) {
				mainWindow.clearTimeout(timer);
			}
			for (const [key, pending] of this.badgeDescriptionPending) {
				this.flushBadgeDescriptionWrite(pending.node.workspaceFolder, pending.node.relativePath);
				this.logService.trace(`Flushing Badge prompt during canvas teardown: ${key}`);
			}
			this.badgeDescriptionTimers.clear();
		}));

		this.updateCanvasLayer();
		this.updateCanvasSnapChrome();
		this.updateCanvasZoomChrome();
		this._register(this.workspaceMutationCoordinator.onDidFinishStructuralMutation(outcome => {
			let detailReconciliation: Promise<void> | undefined;
			const detail = this.canvasNavigationService.state.cardDetail;
			if (detail) {
				const effect = baseHalfStructuralResourceOutcome(outcome, detail.workspaceFolder, detail.relativePath, detail.resource);
				if (effect.kind !== 'none') {
					detailReconciliation = this.reconcileRetainedDetailIdentity(detail, effect);
					outcome.waitUntil(detailReconciliation);
				}
			}
			if (outcome.workspaces.some(workspace => this.getCurrentFolder()?.workspaceFolder.toString() === workspace.toString())) {
				this.requestRender();
			}
			void detailReconciliation?.catch(error => this.logService.error(error));
		}));
		this._register(this.workspaceMutationCoordinator.onDidChangeResourceMutationFence(() => this.syncDetailMutationFence()));
		this.requestRender();
	}

	override dispose(): void {
		this.disposed = true;
		this.cancelPendingCreatedCanvasNoteActivation();
		this.canvasNoteFocusLeaseOwner.revoke();
		this.pendingCanvasSelectionFormatBarrier.reset();
		this.cancelPendingCanvasNoteFormatCommands();
		if (this.pendingCanvasNoteNavigationGuard) {
			this.releaseCanvasNoteFormatNavigationGuard(this.pendingCanvasNoteNavigationGuard, true);
		}
		for (const resolve of this.canvasInteractionEndWaiters) {
			resolve();
		}
		this.canvasInteractionEndWaiters.clear();
		this.cancelPendingNodeActivation();
		const activeNote = this.activeCanvasNoteEditor;
		if (activeNote) {
			this.activeCanvasNoteEditor = undefined;
			this.canvasNoteSurfacePath = undefined;
			this.releaseCanvasNoteFocusIntent(activeNote.focusIntent);
			this.canvasNavigationService.setActiveCanvasEditor(undefined);
			this.detachCanvasNoteEditorMount(activeNote);
		}
		this.clearCardListenerStores();
		this.canvasNavigationService.setSurfaceActive(false);
		this.renderSeq++;
		this.disposeDetailSurfaces();
		if (this.backgroundRenderTimer !== undefined) {
			mainWindow.clearTimeout(this.backgroundRenderTimer);
			this.backgroundRenderTimer = undefined;
		}
		if (this.videoModelConnectionResumeTimer !== undefined) {
			mainWindow.clearTimeout(this.videoModelConnectionResumeTimer);
			this.videoModelConnectionResumeTimer = undefined;
		}
		this.pendingVideoModelConnectionCompletion = undefined;
		if (this.badgeInteractionReleaseTimer !== undefined) {
			mainWindow.clearTimeout(this.badgeInteractionReleaseTimer);
			this.badgeInteractionReleaseTimer = undefined;
		}
		if (this.cardPreviewHydrationTimer !== undefined) {
			mainWindow.clearTimeout(this.cardPreviewHydrationTimer);
			this.cardPreviewHydrationTimer = undefined;
		}
		this.cardPreviewHydrationQueue.resetScene('disposed');
		this.badgeInteractionRenderGate.reset();
		super.dispose();
	}

	/**
	 * Render driven by disk activity rather than user navigation. Auto-save
	 * makes these frequent (one per typing pause), so they coalesce, and while
	 * a full-screen card detail covers the canvas the rebuild is skipped
	 * entirely — closing the detail changes navigation state, which always
	 * triggers a fresh full render. Only the detail header's badge zone is
	 * live while covered, so refresh just that.
	 */
	private scheduleBackgroundRender(): void {
		if (this.backgroundRenderTimer !== undefined) {
			return;
		}
		this.backgroundRenderTimer = mainWindow.setTimeout(() => {
			this.backgroundRenderTimer = undefined;
			if (this.disposed) {
				return;
			}
			const cardDetail = this.canvasNavigationService.state.cardDetail;
			if (cardDetail) {
				void this.renderDetailBadge(cardDetail);
				return;
			}
			if (this.deferCanvasBadgeRefreshWhileFocused()) {
				return;
			}
			this.requestRender();
		}, 100);
	}

	private clearCardListenerStores(): void {
		for (const store of this.cardListenerStores.values()) {
			store.dispose();
		}
		this.cardListenerStores.clear();
	}

	private disposeRemovedCardListenerStores(retainedPaths: ReadonlySet<string>): void {
		for (const [path, store] of this.cardListenerStores) {
			if (retainedPaths.has(path)) {
				continue;
			}
			store.dispose();
			this.cardListenerStores.delete(path);
		}
	}

	private replaceCardListenerStore(path: string): DisposableStore {
		this.cardListenerStores.get(path)?.dispose();
		const store = new DisposableStore();
		this.cardListenerStores.set(path, store);
		return store;
	}

	private patchRenderedNodeExecutionState(resource: URI, execution: IBaseHalfNodeExecutionState): void {
		const path = this.renderedPathByResourceKey.get(this.uriIdentityService.extUri.getComparisonKey(resource));
		const chrome = path ? this.renderedNodeChromeByPath.get(path) : undefined;
		if (!chrome) {
			return;
		}

		const state = getBaseHalfNodeLocalExecutionState(execution);
		const statusText = getBaseHalfNodeCardStatusText(state);
		chrome.card.dataset.nodeStatus = baseHalfNodeLocalStatusToken(state.status);
		chrome.card.dataset.nodeLifecycle = 'attempt';
		if (chrome.card.dataset.nodeKind === 'video') {
			const progressLabel = execution.progress === undefined ? '' : ` ${Math.round(Math.max(0, Math.min(100, execution.progress)))} percent`;
			chrome.card.setAttribute('aria-label', `${chrome.title}, Video, ${statusText}${progressLabel}`);
		}
		const status = chrome.status;
		if (status) {
			status.textContent = statusText;
			status.title = state.message;
			status.setAttribute('aria-label', `${state.status}: ${state.message}`);
			status.classList.toggle('ready', isBaseHalfNodeCardStatusPositive(state));
			status.classList.add('executing');
		}

		const action = chrome.action;
		if (action) {
			action.textContent = state.action.label;
			action.dataset.nodeAction = state.action.kind;
			action.setAttribute('aria-disabled', String(execution.phase === 'cancelling'));
			action.title = `${state.action.label}: ${state.message}`;
			action.setAttribute('aria-label', action.title);
		}

		const progress = chrome.progress;
		if (progress) {
			const value = chrome.progressValue;
			progress.hidden = false;
			progress.classList.toggle('indeterminate', execution.progress === undefined);
			progress.setAttribute('aria-label', `${state.status}: ${state.message}`);
			if (execution.progress === undefined) {
				progress.removeAttribute('aria-valuemin');
				progress.removeAttribute('aria-valuemax');
				progress.removeAttribute('aria-valuenow');
				if (value) {
					value.style.width = '36%';
				}
			} else {
				const bounded = Math.max(0, Math.min(100, execution.progress));
				progress.setAttribute('aria-valuemin', '0');
				progress.setAttribute('aria-valuemax', '100');
				progress.setAttribute('aria-valuenow', String(Math.round(bounded)));
				if (value) {
					value.style.width = `${bounded}%`;
				}
			}
		}

	}

	private deferCanvasBadgeRefreshWhileFocused(): boolean {
		const active = this.cards.ownerDocument.activeElement;
		if (!isHTMLElement(active) || !this.cards.contains(active)) {
			return false;
		}
		const face = active.closest<HTMLElement>('.basehalf-canvas-card-badge-face');
		if (!face) {
			return false;
		}
		if (this.canvasBadgeRefreshAfterFocusLeaves) {
			return true;
		}

		this.canvasBadgeRefreshAfterFocusLeaves = true;
		this.canvasBadgeFocusRefresh.value = this.addDisposableListener(face, 'focusout', () => {
			mainWindow.setTimeout(() => {
				if (!this.canvasBadgeRefreshAfterFocusLeaves) {
					return;
				}
				const nextActive = this.cards.ownerDocument.activeElement;
				if (isHTMLElement(nextActive) && face.contains(nextActive)) {
					return;
				}
				this.resetCanvasBadgeDeferredRefresh();
				if (!this.disposed) {
					this.requestRender();
				}
			}, 0);
		});
		return true;
	}

	private resetCanvasBadgeDeferredRefresh(): void {
		this.canvasBadgeRefreshAfterFocusLeaves = false;
		this.canvasBadgeFocusRefresh.clear();
	}

	private addDisposableListener<K extends keyof HTMLElementEventMap>(node: HTMLElement | SVGElement, type: K, listener: (event: HTMLElementEventMap[K]) => void, useCaptureOrOptions?: boolean | AddEventListenerOptions): { dispose(): void };
	private addDisposableListener<K extends keyof DocumentEventMap>(node: Document, type: K, listener: (event: DocumentEventMap[K]) => void, useCaptureOrOptions?: boolean | AddEventListenerOptions): { dispose(): void };
	private addDisposableListener<K extends keyof WindowEventMap>(node: Window, type: K, listener: (event: WindowEventMap[K]) => void, useCaptureOrOptions?: boolean | AddEventListenerOptions): { dispose(): void };
	private addDisposableListener(node: EventTarget, type: string, listener: (event: Event) => void, useCaptureOrOptions?: boolean | AddEventListenerOptions) {
		node.addEventListener(type, listener as EventListener, useCaptureOrOptions);
		return {
			dispose: () => node.removeEventListener(type, listener as EventListener, useCaptureOrOptions)
		};
	}

	private requestRender(): void {
		void this.render().catch(error => {
			if (this.disposed) {
				return;
			}
			this.logService.error(error);
			this.renderCanvasWarning(error instanceof Error ? error.message : String(error));
		});
	}

	private async render(): Promise<void> {
		if (this.disposed) {
			return;
		}
		const navigatedDetail = this.canvasNavigationService.state.cardDetail;
		const inlineEditor = this.activeCanvasNoteEditor;
		if (navigatedDetail) {
			this.canvasNoteSurfacePath = undefined;
		}
		if (navigatedDetail && !inlineEditor) {
			this.cancelPendingCanvasNoteFormatCommands(pending => !pending.active);
		}
		if (navigatedDetail && inlineEditor) {
			// Navigation has already drained the shared editor flush barrier. Retire
			// the canvas author before the detail surface can acquire the document.
			await this.drainActiveCanvasNoteFormatCommands(inlineEditor);
			this.activeCanvasNoteEditor = undefined;
			this.canvasNoteSurfacePath = undefined;
			this.clearPendingCanvasNoteFocus(inlineEditor.path);
			this.releaseCanvasNoteFocusIntent(inlineEditor.focusIntent);
			this.canvasNavigationService.setActiveCanvasEditor(undefined);
			this.detachCanvasNoteEditorMount(inlineEditor);
		}
		// Card detail is navigation state, not scene data. It must react even if a
		// pointer gesture is still winding down on the canvas underneath.
		this.renderDetail();
		if (!this.canvasNavigationService.state.cardDetail && this.badgeInteractionRenderGate.defer()) {
			return;
		}

		// External file/mirror changes may arrive during a live scene transaction.
		// Reconcile after the gesture so a stale disk snapshot cannot overwrite the
		// controlled React Flow geometry under the pointer.
		if (this.deferRenderForSceneInteraction()) {
			return;
		}
		this.renderQueuedBehindGesture = false;

		const seq = ++this.renderSeq;
		const folder = this.getCurrentFolder();

		if (!folder) {
			this.cancelPendingCreatedCanvasNoteActivation();
			this.cancelPendingCanvasNoteFormatCommands();
			if (this.activeCanvasNoteEditor && !await this.closeActiveCanvasNoteEditor(false)) {
				return;
			}
			if (this.activeNodeLocalSurface && !await this.activeNodeLocalSurface.closeForSwitch()) {
				return;
			}
			if (!this.isRenderCurrent(seq)) {
				return;
			}
			clearNode(this.canvasOverlay);
			clearNode(this.inlineEditLayer);
			this.inlineEditListeners.clear();
			this.inlineEdit = undefined;
			this.renderedBadges = new Map();
			this.renderedBadgeProblems = new Map();
			this.renderedItemsByPath = new Map();
			this.renderedCardPreviewsByPath = new Map();
			this.renderedCardsByPath = new Map();
			this.renderedCardElementsByPath = new Map();
			this.renderedNodeChromeByPath = new Map();
			this.renderedPathByResourceKey = new Map();
			this.renderedSceneCards = [];
			this.renderedSceneEdges = [];
			this.renderedSceneStructuralEpoch = 0;
			this.resetCanvasBadgeDeferredRefresh();
			this.cardListeners.clear();
			this.clearCardListenerStores();
			this.canvasScene.update({ key: 'no-folder', structuralEpoch: 0, revision: seq, cards: [], edges: [] });
			this.renderEmpty('No folder');
			return;
		}
		const structuralStamp = this.workspaceMutationCoordinator.capture(folder.workspaceFolder);
		if (!this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
			return;
		}

		let stat: IFileStat;
		try {
			stat = await this.fileService.resolve(folder.resource, { resolveMetadata: true });
		} catch (error) {
			if (!this.isRenderCurrent(seq)) {
				return;
			}
			if (this.activeCanvasNoteEditor && !await this.closeActiveCanvasNoteEditor(false)) {
				return;
			}
			if (this.activeNodeLocalSurface && !await this.activeNodeLocalSurface.closeForSwitch()) {
				return;
			}
			this.cancelPendingCanvasNoteFormatCommands(pending => pending.sceneKey === this.sceneKey(folder));
			if (!this.isRenderCurrent(seq)
				|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return;
			}
			if (this.badgeInteractionRenderGate.defer() || this.deferRenderForSceneInteraction()) {
				return;
			}
			clearNode(this.canvasOverlay);
			clearNode(this.inlineEditLayer);
			this.inlineEditListeners.clear();
			this.renderedBadges = new Map();
			this.renderedBadgeProblems = new Map();
			this.renderedItemsByPath = new Map();
			this.renderedCardPreviewsByPath = new Map();
			this.renderedCardsByPath = new Map();
			this.renderedCardElementsByPath = new Map();
			this.renderedNodeChromeByPath = new Map();
			this.renderedPathByResourceKey = new Map();
			this.renderedSceneCards = [];
			this.renderedSceneEdges = [];
			this.renderedSceneStructuralEpoch = structuralStamp.structuralEpoch;
			this.resetCanvasBadgeDeferredRefresh();
			this.cardListeners.clear();
			this.clearCardListenerStores();
			if (!this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return;
			}
			this.canvasScene.update({ key: this.sceneKey(folder), structuralEpoch: structuralStamp.structuralEpoch, revision: seq, cards: [], edges: [] });
			this.renderEmpty(error instanceof Error ? error.message : String(error));
			return;
		}

		if (!this.isRenderCurrent(seq)) {
			return;
		}

		let canvas: IBaseHalfCanvasFile | null = null;
		let canvasWarning: string | undefined;
		try {
			canvas = await this.canvasMirrorService.readCanvas(folder);
		} catch (error) {
			canvasWarning = error instanceof BaseHalfCanvasMirrorCorrupt ? 'Corrupt canvas.yaml' : 'Unable to read canvas.yaml';
		}
		if (!this.isRenderCurrent(seq)) {
			return;
		}

		// One sparse-mirror walk fetches every badge in the workspace: the model
		// needs them BEFORE it builds items so the child cap can keep annotated
		// children and the edge set can derive from the reference graph.
		const badgeRead = await this.badgeGraphService.listBadges(folder.workspaceFolder);
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		const appearanceRead = await this.canvasAppearanceService.readAll(folder.workspaceFolder);
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		this.renderedNoteBackgrounds = appearanceRead.backgrounds;
		for (const problem of appearanceRead.problems) {
			this.logService.warn(`BaseHalf card appearance issue for ${problem.relativePath}: ${problem.message}`);
		}

		const model = baseHalfCanvasModelFromStat(stat, {
			rootLevel: folder.relativePath.length === 0,
			folderRelativePath: folder.relativePath,
			canvas,
			badges: badgeRead.badges
		});
		let badgeWarning: string | undefined;
		const folderPrefix = folder.relativePath.length === 0 ? '' : `${folder.relativePath}/`;
		const localProblems = badgeRead.problems.filter(problem => problem.relativePath.startsWith(folderPrefix));
		if (localProblems.length > 0) {
			badgeWarning = `${localProblems.length} badge metadata issue${localProblems.length === 1 ? '' : 's'}`;
			for (const problem of localProblems) {
				this.logService.warn(`BaseHalf badge metadata issue for ${problem.relativePath}: ${problem.message}`);
			}
		}
		const items = model.items;
		const currentSceneKey = this.sceneKey(folder);
		const activeNoteBeforeModelUpdate = this.activeCanvasNoteEditor;
		if (activeNoteBeforeModelUpdate && !items.some(item => item.path === activeNoteBeforeModelUpdate.path
			&& this.uriIdentityService.extUri.isEqual(item.stat.resource, activeNoteBeforeModelUpdate.state.resource))) {
			if (!await this.closeActiveCanvasNoteEditor(false)) {
				return;
			}
			if (!this.isRenderCurrent(seq)
				|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return;
			}
		}
		const activeSurfaceBeforeModelUpdate = this.activeNodeLocalSurface;
		const activeSurfaceItem = activeSurfaceBeforeModelUpdate
			? items.find(item => item.path === activeSurfaceBeforeModelUpdate.path
				&& this.uriIdentityService.extUri.isEqual(item.stat.resource, activeSurfaceBeforeModelUpdate.resource))
			: undefined;
		if (activeSurfaceBeforeModelUpdate
			&& (activeSurfaceBeforeModelUpdate.sceneKey !== currentSceneKey
				|| !activeSurfaceItem)) {
			if (!await activeSurfaceBeforeModelUpdate.closeForSwitch()) {
				return;
			}
			if (!this.isRenderCurrent(seq)
				|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return;
			}
		}
		const previews = new Map<string, BaseHalfCanvasCardPreview>();
		const retainedResultNodePaths: string[] = [];
		for (const item of items) {
			const cached = this.reusableCardPreview(item);
			if (cached) {
				previews.set(item.path, cached);
				if (item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)
					&& this.renderedCardsByPath.get(item.path)?.element.dataset.previewLevel !== 'shell') {
					retainedResultNodePaths.push(item.path);
				}
				continue;
			}
			previews.set(
				item.path,
				item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)
					? { kind: 'nodeLoading', text: 'Checking content…' }
					: { kind: 'loading', text: 'Loading preview…' }
			);
		}
		const activeSurfaceAfterPreview = this.activeNodeLocalSurface;
		const retainedSurfacePreview = activeSurfaceAfterPreview ? previews.get(activeSurfaceAfterPreview.path) : undefined;
		if (activeSurfaceAfterPreview && retainedSurfacePreview?.kind === 'node'
			&& (retainedSurfacePreview.document.id !== activeSurfaceAfterPreview.nodeId
				|| retainedSurfacePreview.document.kind !== activeSurfaceAfterPreview.nodeKind)) {
			if (!await activeSurfaceAfterPreview.closeForSwitch()) {
				return;
			}
			if (!this.isRenderCurrent(seq)
				|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return;
			}
		}
		if (this.badgeInteractionRenderGate.defer() || this.deferRenderForSceneInteraction()) {
			return;
		}
		if (!this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
			return;
		}
		if (this.canvasNoteSurfacePath && !this.activeCanvasNoteEditor
			&& !items.some(item => item.path === this.canvasNoteSurfacePath && isBaseHalfMarkdownResource(item.stat.resource))) {
			const missingNotePath = this.canvasNoteSurfacePath;
			this.canvasNoteSurfacePath = undefined;
			this.clearPendingCanvasNoteFocus(missingNotePath);
		}
		// Promote the create intent only after this model has passed every render
		// deferral/staleness gate. From here to the scene update the new Note's
		// selection and editing projection are committed as one synchronous frame;
		// a render that exits early must leave the intent pending for its successor.
		this.promotePendingCreatedCanvasNoteActivation(currentSceneKey, items);
		const liveNoteKeys = new Set(items
			.filter(item => isBaseHalfMarkdownResource(item.stat.resource))
			.map(item => `${item.path}\0${this.uriIdentityService.extUri.getComparisonKey(item.stat.resource)}`));
		this.cancelPendingCanvasNoteFormatCommands(pending => pending.sceneKey !== currentSceneKey
			|| !liveNoteKeys.has(`${pending.path}\0${pending.resourceKey}`));
		if (this.pendingCanvasSelection
			&& (this.pendingCanvasSelection.sceneKey !== currentSceneKey
				|| !this.isCanvasPostCreateOwnerCurrent(this.pendingCanvasSelection.owner))) {
			this.pendingCanvasSelection = undefined;
		}
		const pendingSelectionRequest = this.pendingCanvasSelection;
		const pendingSelectionPaths = pendingSelectionRequest?.sceneKey === currentSceneKey
			? pendingSelectionRequest.paths
			: undefined;
		let pendingSelection = pendingSelectionPaths
			&& baseHalfCanvasPendingSelectionIsReady(pendingSelectionPaths, new Set(items.map(item => item.path)))
			? pendingSelectionPaths
			: undefined;
		const activeNote = this.activeCanvasNoteEditor;
		const changesNote = pendingSelection && this.canvasNoteSurfacePath
			&& !(pendingSelection.length === 1 && pendingSelection[0] === this.canvasNoteSurfacePath);
		if (changesNote) {
			if (activeNote) {
				const closed = await this.closeActiveCanvasNoteEditorAfterFormats(false);
				if (!this.isRenderCurrent(seq)
					|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
					return;
				}
				if (!closed) {
					this.pendingCanvasSelection = undefined;
					pendingSelection = undefined;
				}
			} else {
				const notePath = this.canvasNoteSurfacePath;
				const noteItem = notePath ? items.find(item => item.path === notePath && isBaseHalfMarkdownResource(item.stat.resource)) : undefined;
				const resourceKey = noteItem ? this.uriIdentityService.extUri.getComparisonKey(noteItem.stat.resource) : undefined;
				const waitsForPreMountFormat = !!notePath && !!resourceKey
					&& this.pendingCanvasNoteFormatCommands.some(pending => pending.sceneKey === currentSceneKey
						&& pending.path === notePath
						&& pending.resourceKey === resourceKey);
				if (notePath && resourceKey && waitsForPreMountFormat) {
					this.deferPendingCanvasSelectionUntilCanvasNoteFormatsSettle(
						currentSceneKey,
						notePath,
						resourceKey
					);
					// Keep the current Note selected and force its inline projection to
					// mount in this render. The queued selection is replayed only after
					// every accepted formatting intent has reached a terminal outcome.
					pendingSelection = undefined;
				} else {
					this.canvasNoteSurfacePath = undefined;
				}
			}
		}
		const activeSurfaceBeforeSelectionCommit = this.activeNodeLocalSurface;
		if (pendingSelection && activeSurfaceBeforeSelectionCommit
			&& !(pendingSelection.length === 1 && pendingSelection[0] === activeSurfaceBeforeSelectionCommit.path)) {
			const closed = await activeSurfaceBeforeSelectionCommit.closeForSwitch();
			if (!this.isRenderCurrent(seq)
				|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return;
			}
			if (!closed) {
				this.pendingCanvasSelection = undefined;
				pendingSelection = undefined;
			}
		}

		clearNode(this.canvasOverlay);
		clearNode(this.inlineEditLayer);
		this.inlineEditListeners.clear();
		const previousRenderedCards = this.renderedCardsByPath;
		const previousRenderedNodeChrome = this.renderedNodeChromeByPath;
		this.renderedBadges = badgeRead.badges;
		this.renderedBadgeProblems = new Map(badgeRead.problems.map(problem => [problem.relativePath, problem]));
		this.renderedItemsByPath = new Map(items.map(item => [item.path, item]));
		this.renderedCardPreviewsByPath = new Map(items.map(item => [
			item.path,
			{ item, preview: previews.get(item.path)! }
		]));
		this.renderedCardsByPath = new Map();
		this.renderedCardElementsByPath = new Map();
		this.renderedNodeChromeByPath = new Map();
		this.renderedPathByResourceKey = new Map(items.map(item => [this.uriIdentityService.extUri.getComparisonKey(item.stat.resource), item.path]));
		if (this.inlineEdit?.kind === 'rename') {
			const editedItem = this.renderedItemsByPath.get(this.inlineEdit.path);
			if (!editedItem || !this.uriIdentityService.extUri.isEqual(editedItem.stat.resource, this.inlineEdit.resource)) {
				this.inlineEdit = undefined;
			}
		}
		this.resetCanvasBadgeDeferredRefresh();
		this.cardListeners.clear();
		const sceneCards = items.map((item, index) => {
			const preview = previews.get(item.path);
			const bounds = this.cardBoundsForPreview(item, index, items.length, preview);
			const badge = this.badgeMetadataWithDraft(
				folder.workspaceFolder,
				item.path,
				item.badge,
				baseHalfBadgeResourceIdentity(item.stat)
			);
			const displayedItem = badge === item.badge ? item : { ...item, badge };
			const visualKey = this.cardVisualKey(displayedItem);
			const cached = previousRenderedCards.get(item.path);
			const element = this.canReuseRenderedCard(cached, displayedItem, preview, visualKey, currentSceneKey)
				? cached.element
				: this.createCard(displayedItem, bounds, preview, structuralStamp, currentSceneKey);
			const controls = this.sceneCardControls(displayedItem, preview);
			const retainedActiveNote = this.activeCanvasNoteEditor;
			if (retainedActiveNote?.path === item.path && retainedActiveNote.card === element) {
				retainedActiveNote.chromeStale = baseHalfCanvasRetainedCardChromeIsStale(
					retainedActiveNote.mountedVisualKey,
					visualKey
				);
			}
			this.applyNoteBackground(element, isBaseHalfMarkdownResource(item.stat.resource) ? this.renderedNoteBackgrounds.get(item.path) ?? 'default' : undefined);
			this.renderedCardElementsByPath.set(item.path, element);
			this.renderedCardsByPath.set(item.path, { item, preview, visualKey, sceneKey: currentSceneKey, element });
			if (cached?.element === element) {
				const retainedChrome = previousRenderedNodeChrome.get(item.path);
				if (retainedChrome) {
					this.renderedNodeChromeByPath.set(item.path, retainedChrome);
				}
			}
			return {
				path: item.path,
				kind: item.kind,
				...(controls ? { controls } : {}),
				...(item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) ? { renameChangesPathOnly: true as const } : {}),
				...bounds,
				element,
				updatePresentation: (presentation: IBaseHalfCanvasSceneCardPresentation) => this.cardPresentationUpdaters.get(element)?.(presentation),
				...(this.openBadgeFaces.has(item.path) || this.canvasNoteSurfacePath === item.path ? { forceInteractive: true as const } : {}),
				...(this.canvasNoteSurfacePath === item.path ? { noteEditing: true as const } : {})
			};
		});
		this.disposeRemovedCardListenerStores(new Set(items.map(item => item.path)));
		const sceneEdges = model.edges.map(edge => {
			const from = this.renderedItemsByPath.get(edge.from);
			const to = this.renderedItemsByPath.get(edge.to);
			if (!from || !to) {
				throw new Error(`Canvas edge endpoints are not part of the rendered scene: ${edge.from} -> ${edge.to}`);
			}
			return {
				...edge,
				id: edgeId(edge.from, edge.to),
				fromKind: from.kind,
				toKind: to.kind
			};
		});
		this.renderedSceneCards = Object.freeze(sceneCards);
		this.renderedSceneEdges = Object.freeze(sceneEdges);
		this.renderedSceneStructuralEpoch = structuralStamp.structuralEpoch;
		if (pendingSelection && (!pendingSelectionRequest
			|| this.pendingCanvasSelection !== pendingSelectionRequest
			|| !this.isCanvasPostCreateOwnerCurrent(pendingSelectionRequest.owner))) {
			pendingSelection = undefined;
		}
		this.canvasScene.update({
			key: currentSceneKey,
			structuralEpoch: structuralStamp.structuralEpoch,
			revision: seq,
			cards: sceneCards,
			edges: sceneEdges,
			selectedCardPaths: pendingSelection
		});
		const retainedSurface = this.activeNodeLocalSurface;
		if (retainedSurface?.sceneKey === currentSceneKey
			&& items.some(item => item.path === retainedSurface.path
				&& this.uriIdentityService.extUri.isEqual(item.stat.resource, retainedSurface.resource))) {
			retainedSurface.rebindScene(currentSceneKey, structuralStamp.structuralEpoch);
		}
		if (this.canvasNoteSurfacePath && !this.tryMountCanvasNoteEditor(this.canvasNoteSurfacePath)) {
			// An editing intent is allowed to precede the first complete Markdown
			// preview (notably for a freshly created empty Note). Queue that source
			// read from the committed host snapshot itself; React presentation
			// callbacks are intentionally lazy and cannot be the sole wake-up edge.
			this.scheduleCardPreviewHydration(this.canvasNoteSurfacePath, 2);
		}
		for (const path of retainedResultNodePaths) {
			this.scheduleCardPreviewHydration(path);
		}
		if (pendingSelection && this.pendingCanvasSelection === pendingSelectionRequest) {
			this.pendingCanvasSelection = undefined;
		}
		this.renderInlineCreateEditor(folder);
		if (items.length === 0) {
			this.renderCanvasEmptyState(folder);
		} else {
			if (model.truncated > 0) {
				this.renderTruncated(model.truncated);
			}
		}
		if (canvasWarning) {
			this.renderCanvasWarning(canvasWarning);
		}
		if (badgeWarning) {
			this.renderCanvasWarning(badgeWarning);
		}
		for (const warning of this.pendingCanvasWarnings.splice(0)) {
			this.renderCanvasWarning(warning);
		}

		if (this.pendingCanvasFit
			&& (!this.isCanvasPostCreateOwnerCurrent(this.pendingCanvasFit.owner)
				|| this.pendingCanvasFit.viewportGeneration !== this.folderFocusRestoreGeneration)) {
			this.pendingCanvasFit = undefined;
		}
		const pendingFit = this.pendingCanvasFit?.sceneKey === currentSceneKey && !this.canvasNavigationService.state.cardDetail
			? this.pendingCanvasFit
			: undefined;
		if (pendingFit) {
			this.pendingCanvasFit = undefined;
			mainWindow.requestAnimationFrame(() => {
				if (!this.isCurrentSceneKey(pendingFit.sceneKey)
					|| !this.isCanvasPostCreateOwnerCurrent(pendingFit.owner)
					|| pendingFit.viewportGeneration !== this.folderFocusRestoreGeneration
					|| this.canvasNavigationService.state.cardDetail) {
					return;
				}
				void this.canvasScene.fit(pendingFit.paths, {
					maxZoom: Math.min(1, this.defaultCanvasZoom(folder)),
					padding: 0.16
				}).then(() => {
					if (this.isCurrentSceneKey(pendingFit.sceneKey)
						&& this.isCanvasPostCreateOwnerCurrent(pendingFit.owner)
						&& pendingFit.viewportGeneration === this.folderFocusRestoreGeneration
						&& !this.canvasNavigationService.state.cardDetail) {
						this.scheduleFolderFocusWrite(0);
					}
				}).catch(error => this.logService.error(error));
			});
		} else {
			this.restoreOrWriteFolderFocus(folder, seq);
		}
	}

	private sceneKey(folder: IBaseHalfCanvasFolderState): string {
		return `${folder.workspaceFolder.toString()}::${folder.relativePath}`;
	}

	private resetCardPreviewHydrationScene(): void {
		const folder = this.getCurrentFolder();
		this.cardPreviewHydrationQueue.resetScene(folder ? this.sceneKey(folder) : 'no-folder');
		this.cardPreviewVerificationQueue.reset();
		this.cardPreviewModelServicesGeneration = -1;
		this.cardPreviewModelServicesPromise = undefined;
		if (this.cardPreviewHydrationTimer !== undefined) {
			mainWindow.clearTimeout(this.cardPreviewHydrationTimer);
			this.cardPreviewHydrationTimer = undefined;
		}
	}

	private isCurrentSceneKey(sceneKey: string): boolean {
		const folder = this.getCurrentFolder();
		return !!folder && this.sceneKey(folder) === sceneKey;
	}

	private folderForSceneMutation(sceneKey: string): IBaseHalfCanvasFolderState {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey) {
			throw new Error('The canvas changed before this interaction completed.');
		}
		return folder;
	}

	private sceneMutationStamp(folder: IBaseHalfCanvasFolderState, structuralEpoch: number): IBaseHalfWorkspaceMutationStamp {
		return { workspaceKey: folder.workspaceFolder.toString(), structuralEpoch };
	}

	private resourceMutationGuard(
		workspaceFolder: URI,
		stamp: IBaseHalfWorkspaceResourceMutationStamp,
		resourceIdentity: string
	): IBaseHalfCanvasMutationGuard {
		return {
			workspaceKey: workspaceFolder.toString(),
			resourceStamp: stamp,
			resourceIdentity,
			run: (task, relatedStamps = []) => this.workspaceMutationCoordinator.runResourceMutation(
				workspaceFolder,
				[stamp, ...relatedStamps],
				async lease => {
					const resource = stamp.relativePath
						? joinPath(workspaceFolder, ...stamp.relativePath.split('/'))
						: workspaceFolder;
					if (baseHalfBadgeResourceIdentity(await this.fileService.stat(resource)) !== resourceIdentity) {
						throw new Error(`'${stamp.relativePath || 'workspace'}' was replaced before this Badge change could be saved.`);
					}
					return task(lease);
				}
			)
		};
	}

	private async resolveLiveCanvasNodes(
		sceneKey: string,
		folder: IBaseHalfCanvasFolderState,
		nodes: readonly { readonly path: string; readonly kind: IBaseHalfCanvasItem['kind'] }[]
	): Promise<ReadonlyMap<string, IBaseHalfBadgeNode>> {
		const prefix = folder.relativePath ? `${folder.relativePath}/` : '';
		for (const node of nodes) {
			const child = prefix ? node.path.startsWith(prefix) ? node.path.slice(prefix.length) : '' : node.path;
			if (!child || child.includes('/')) {
				throw new Error(`Canvas node is no longer a direct child of this folder: ${node.path}`);
			}
		}
		const live = await this.resolveLiveWorkspaceNodes(folder.workspaceFolder, nodes);
		this.folderForSceneMutation(sceneKey);
		return live;
	}

	private async resolveLiveWorkspaceNodes(
		workspaceFolder: URI,
		nodes: readonly { readonly path: string; readonly kind: IBaseHalfCanvasItem['kind'] }[]
	): Promise<ReadonlyMap<string, IBaseHalfBadgeNode>> {
		const live = new Map<string, IBaseHalfBadgeNode>();
		for (const node of nodes) {
			const resource = joinPath(workspaceFolder, ...node.path.split('/'));
			const stat = await this.fileService.stat(resource);
			if (node.kind === 'folder' ? !stat.isDirectory : !stat.isFile) {
				throw new Error(`Canvas node kind changed before the interaction completed: ${node.path}`);
			}
			live.set(node.path, {
				resource,
				workspaceFolder,
				relativePath: node.path,
				kind: node.kind
			});
		}
		return live;
	}

	private isCanvasUndoRedoActive(): boolean {
		const active = this.root.ownerDocument.activeElement;
		return this.canvasNavigationService.isSurfaceActive
			&& !this.canvasNavigationService.state.cardDetail
			&& !!active
			&& this.root.contains(active);
	}

	private pushCanvasUndoElement(
		label: string,
		folder: IBaseHalfCanvasFolderState,
		nodes: readonly IBaseHalfCanvasUndoNode[],
		documents: readonly IBaseHalfCanvasNodeDocumentTransition[],
		apply: (reverse: boolean, lease: IBaseHalfWorkspaceMutationLease) => Promise<void>
	): void {
		const uniqueNodes = uniqueCanvasUndoNodes(nodes);
		const stampPaths = [...new Set([folder.relativePath, ...uniqueNodes.map(node => node.path)])];
		const stamps = stampPaths.map(path => this.workspaceMutationCoordinator.captureResource(folder.workspaceFolder, path));
		const resources = uniqueUris([
			this.canvasMirrorService.canvasResource(folder),
			...uniqueNodes.map(node => joinPath(folder.workspaceFolder, ...node.path.split('/'))),
			...documents.map(document => document.resource)
		]);
		const run = async (reverse: boolean): Promise<void> => {
			await this.workspaceMutationCoordinator.runResourceMutation(folder.workspaceFolder, stamps, lease => apply(reverse, lease));
			this.scheduleBackgroundRender();
		};
		this.undoRedoService.pushElement({
			type: UndoRedoElementType.Workspace,
			resources,
			label,
			code: 'basehalf.canvas.mutation',
			undo: () => run(true),
			redo: () => run(false)
		}, undefined, this.canvasUndoRedoSource);
	}

	private async applyCanvasGeometryTransition(
		folder: IBaseHalfCanvasFolderState,
		nodes: readonly IBaseHalfCanvasUndoNode[],
		transition: IBaseHalfCanvasStateTransition,
		reverse: boolean,
		lease: IBaseHalfWorkspaceMutationLease
	): Promise<void> {
		await this.resolveLiveWorkspaceNodes(folder.workspaceFolder, nodes);
		await this.canvasMirrorService.transitionCanvasState(folder, reverseCanvasStateTransition(transition, reverse), lease);
	}

	private async applyCanvasConnectionTransition(
		transition: IBaseHalfCanvasConnectionTransition,
		reverse: boolean,
		lease: IBaseHalfWorkspaceMutationLease,
		allowMissingNodes = false
	): Promise<void> {
		const references = reverseReferenceTransitions(transition.references, reverse);
		const canvas = reverseCanvasStateTransition(transition.canvas, reverse);
		const documents = reverseDocumentTransitions(transition.documents, reverse);
		let live: ReadonlyMap<string, IBaseHalfBadgeNode>;
		if (!allowMissingNodes) {
			live = await this.resolveLiveWorkspaceNodes(transition.folder.workspaceFolder, transition.nodes);
		} else {
			const resolved = new Map<string, IBaseHalfBadgeNode>();
			for (const node of transition.nodes) {
				try {
					const candidate = await this.resolveLiveWorkspaceNodes(transition.folder.workspaceFolder, [node]);
					resolved.set(node.path, candidate.get(node.path)!);
				} catch (error) {
					if (toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) {
						throw error;
					}
					resolved.set(node.path, {
						resource: joinPath(transition.folder.workspaceFolder, ...node.path.split('/')),
						workspaceFolder: transition.folder.workspaceFolder,
						relativePath: node.path,
						kind: node.kind
					});
				}
			}
			live = resolved;
		}

		for (const document of documents) {
			if (this.workingCopyService.isDirty(document.resource) || this.nodeExecutionService.getActiveRun(document.resource)) {
				throw new Error(`Save '${basename(document.resource)}' and finish its active run before changing this connection.`);
			}
			const current = await this.fileService.readFile(document.resource, { atomic: true, limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } });
			if (!current.value.equals(document.expected)) {
				throw new Error(`'${basename(document.resource)}' changed before this connection update could be applied.`);
			}
		}

		let referencesApplied = false;
		let canvasApplied = false;
		const written: IBaseHalfCanvasNodeDocumentTransition[] = [];
		try {
			if (references.length > 0) {
				await this.badgeGraphService.transitionReferenceStates(references.map(reference => ({
					source: live.get(reference.source.path)!,
					target: live.get(reference.target.path)!,
					expected: reference.expected,
					next: reference.next
				})), lease);
				referencesApplied = true;
			}
			await this.canvasMirrorService.transitionCanvasState(transition.folder, canvas, lease);
			canvasApplied = true;
			for (const document of documents) {
				await this.fileService.writeFileWithExpectedContents(
					document.resource,
					document.next,
					document.expected,
					{ atomic: { postfix: '.basehalf-canvas-undo-tmp' } }
				);
				written.push(document);
			}
		} catch (error) {
			const rollbackErrors: unknown[] = [];
			for (const document of written.reverse()) {
				try {
					await this.fileService.writeFileWithExpectedContents(
						document.resource,
						document.expected,
						document.next,
						{ atomic: { postfix: '.basehalf-canvas-undo-rollback-tmp' } }
					);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (canvasApplied) {
				try {
					await this.canvasMirrorService.transitionCanvasState(transition.folder, reverseCanvasStateTransition(canvas, true), lease);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (referencesApplied) {
				try {
					await this.badgeGraphService.transitionReferenceStates(references.map(reference => ({
						source: live.get(reference.source.path)!,
						target: live.get(reference.target.path)!,
						expected: reference.next,
						next: reference.expected
					})), lease);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (rollbackErrors.length > 0) {
				throw new AggregateError([error, ...rollbackErrors], 'The canvas connection and its safe rollback both failed. Reopen the project before continuing.');
			}
			throw error;
		}
	}

	private async compensateCanvasConnectionGraphTransition(
		transition: IBaseHalfCanvasConnectionTransition
	): Promise<void> {
		if (transition.references.length === 0 && !canvasStateTransitionChangesAnything(transition.canvas)) {
			return;
		}
		const graphOnlyTransition: IBaseHalfCanvasConnectionTransition = {
			...transition,
			documents: []
		};
		const stamps = [...new Set([transition.folder.relativePath, ...transition.nodes.map(node => node.path)])]
			.map(path => this.workspaceMutationCoordinator.captureResource(transition.folder.workspaceFolder, path));
		await this.workspaceMutationCoordinator.runResourceMutation(
			transition.folder.workspaceFolder,
			stamps,
			lease => this.applyCanvasConnectionTransition(graphOnlyTransition, true, lease, true)
		);
	}

	private async commitSceneGeometry(sceneKey: string, structuralEpoch: number, geometries: readonly IBaseHalfCanvasSceneGeometry[]): Promise<void> {
		if (geometries.length === 0) {
			return;
		}
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		let committedTransition: IBaseHalfCanvasStateTransition | undefined;
		const nodes = geometries.map(geometry => ({ path: geometry.path, kind: geometry.kind }));
		await this.workspaceMutationCoordinator.runSceneMutation(
			queuedFolder.workspaceFolder,
			this.sceneMutationStamp(queuedFolder, structuralEpoch),
			async lease => {
				const folder = this.folderForSceneMutation(sceneKey);
				await this.resolveLiveCanvasNodes(sceneKey, folder, geometries);
				const current = await this.canvasMirrorService.readCanvas(folder);
				const cards: IBaseHalfCanvasCardStateTransition[] = geometries.map(geometry => ({
					path: geometry.path,
					expected: current?.cards.find(card => card.path === geometry.path) ?? null,
					next: {
						path: geometry.path,
						kind: geometry.kind,
						x: geometry.x,
						y: geometry.y,
						width: geometry.width,
						height: geometry.height
					}
				}));
				committedTransition = { cards };
				await this.canvasMirrorService.transitionCanvasState(folder, committedTransition, lease);
			}
		);
		if (committedTransition && canvasStateTransitionChangesAnything(committedTransition)) {
			this.pushCanvasUndoElement(
				localize('basehalf.canvas.geometry.undo', "Move or resize canvas cards"),
				queuedFolder,
				nodes,
				[],
				(reverse, lease) => this.applyCanvasGeometryTransition(queuedFolder, nodes, committedTransition!, reverse, lease)
			);
		}
		if (this.isCurrentSceneKey(sceneKey) && this.renderedSceneStructuralEpoch === structuralEpoch) {
			const geometryByPath = new Map(geometries.map(geometry => [geometry.path, geometry]));
			this.renderedSceneCards = Object.freeze(this.renderedSceneCards.map(card => {
				const geometry = geometryByPath.get(card.path);
				return geometry ? { ...card, ...geometry } : card;
			}));
			this.canvasScene.update({
				key: sceneKey,
				structuralEpoch,
				revision: this.renderSeq,
				cards: this.renderedSceneCards,
				edges: this.renderedSceneEdges
			});
		}
		// React Flow already owns the optimistic live geometry. Rebuilding every
		// card here used to replace hydrated contents with "Loading preview…"
		// until asynchronous file reads completed. The mirror file event still
		// provides canonical reconciliation, now with unchanged previews cached.
	}

	private async chooseConnectionInputSlot(
		candidates: ReturnType<typeof getBaseHalfNodeAvailableInputSlots>,
		sourcePath: string,
		targetPath: string,
		sourceKind: BaseHalfCanvasContentKind
	): Promise<IBaseHalfCanvasRecipeDescriptor['inputs'][number] | undefined> {
		const decision = await chooseBaseHalfNodeConnectionSlot(candidates, async choices => {
			type SlotPick = IQuickPickItem & { readonly slot: IBaseHalfCanvasRecipeDescriptor['inputs'][number] };
			const picked = await this.quickInputService.pick<SlotPick>(choices.map(slot => ({
				label: slot.label,
				slot
			})), {
				placeHolder: `Use '${sourcePath}' as which input to '${targetPath}'?`
			});
			return picked?.slot;
		});
		if (decision.kind === 'reject') {
			this.queueCanvasWarning(`'${sourcePath}' cannot connect to '${targetPath}': its recipe has no available input role for ${sourceKind} content.`);
			this.requestRender();
			return undefined;
		}
		return decision.kind === 'bind' ? decision.slot : undefined;
	}

	private async prepareConnectionTargetBinding(
		target: IBaseHalfCanvasConnectionTargetSnapshot,
		sourcePath: string,
		sourceKind: BaseHalfCanvasContentKind,
		baseDocument = target.node?.document
	): Promise<{ readonly kind: 'proceed'; readonly document?: IBaseHalfNodeDocument } | { readonly kind: 'cancel' }> {
		if (!target.node || !baseDocument?.recipe) {
			return { kind: 'proceed' };
		}
		if (baseDocument.result || baseDocument.attempts.length > 0) {
			throw new Error(`'${target.path}' already has an attempt or sealed Result. Copy its settings to a new Draft before changing recipe inputs.`);
		}
		const recipe = target.node.recipe;
		if (!recipe) {
			throw new Error(`Recipe '${baseDocument.recipe.recipeId}' for '${target.path}' is not installed. Choose an available recipe before connecting context.`);
		}
		if (!baseHalfCanvasRecipeMatchesNodeKind(recipe, baseDocument.kind)) {
			throw new Error(`Recipe '${recipe.label}' no longer produces ${baseDocument.kind} content for '${target.path}'. Choose a matching recipe before connecting context.`);
		}
		const candidates = getBaseHalfNodeAvailableInputSlots(
			recipe,
			baseDocument.recipe.inputBindings,
			sourcePath,
			sourceKind
		);
		const slot = await this.chooseConnectionInputSlot(candidates, sourcePath, target.path, sourceKind);
		if (!slot) {
			return { kind: 'cancel' };
		}
		return {
			kind: 'proceed',
			document: {
				...baseDocument,
				recipe: {
					...baseDocument.recipe,
					inputBindings: normalizeNodeInputBindings([
						...baseDocument.recipe.inputBindings,
						{ sourcePath, slot: slot.id, order: baseDocument.recipe.inputBindings.length }
					])
				}
			}
		};
	}

	private async createResultNodeFromConnection(
		sceneKey: string,
		structuralEpoch: number,
		drop: IBaseHalfCanvasSceneConnectionDrop
	): Promise<void> {
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		const stamp = this.sceneMutationStamp(queuedFolder, structuralEpoch);
		if (!this.workspaceMutationCoordinator.isStampCurrent(queuedFolder.workspaceFolder, stamp)) {
			return;
		}
		this.markCanvasUserInteraction();

		let sourceKind: BaseHalfCanvasContentKind;
		try {
			sourceKind = await this.readWorkspaceContentKind(queuedFolder.workspaceFolder, drop.from);
		} catch (error) {
			throw new Error(`'${drop.from}' changed before a result operation could be chosen.`, { cause: error });
		}
		if (!this.workspaceMutationCoordinator.isStampCurrent(queuedFolder.workspaceFolder, stamp) || !this.isCurrentSceneKey(sceneKey)) {
			return;
		}

		const choices = getBaseHalfCanvasConnectedRecipeChoices(this.canvasRecipeRegistryService.getRecipes(), sourceKind);
		if (choices.length === 0) {
			this.queueCanvasWarning(`No installed operation can use ${sourceKind} context from '${drop.from}'.`);
			this.requestRender();
			return;
		}
		type RecipePick = IQuickPickItem & { readonly choice: typeof choices[number] };
		const picked = await this.quickInputService.pick<RecipePick>(choices.map(choice => ({
			label: choice.recipe.label,
			description: `Creates ${choice.primaryOutput.kind}`,
			choice
		})), {
			title: 'Create from Connection',
			placeHolder: 'Choose what this context should produce'
		});
		if (!picked) {
			return;
		}

		const slot = await this.chooseConnectionInputSlot(
			picked.choice.slots,
			drop.from,
			picked.choice.recipe.label,
			sourceKind
		);
		if (!slot) {
			return;
		}
		if (!this.workspaceMutationCoordinator.isStampCurrent(queuedFolder.workspaceFolder, stamp) || !this.isCurrentSceneKey(sceneKey)) {
			return;
		}
		if (this.canvasRecipeRegistryService.getRecipe(picked.choice.recipe.id) !== picked.choice.recipe) {
			throw new Error(`'${picked.choice.recipe.label}' changed while it was being selected. Choose the operation again.`);
		}
		const postCreateOwner = this.captureCanvasPostCreateOwner();

		const name = await this.findAvailableConnectedNodeName(queuedFolder, picked.choice.primaryOutput.kind);
		const targetPath = canvasChildPath(queuedFolder.relativePath, name);
		const targetResource = joinPath(queuedFolder.workspaceFolder, ...targetPath.split('/'));
		const nodeId = generateUuid();
		const document = createBaseHalfCanvasConnectedNodeDocument(picked.choice.recipe, nodeId, drop.from, sourceKind, slot.id);
		const targetSize = picked.choice.primaryOutput.kind === 'video'
			? { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT }
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT };
		const contents = VSBuffer.fromString(serializeBaseHalfNodeDocument(document));
		const edge: IBaseHalfCanvasEdge = {
			from: drop.from,
			from_anchor: drop.fromAnchor,
			to: targetPath,
			to_anchor: oppositeCanvasAnchor(drop.fromAnchor)
		};
		const stashResource = joinPath(
			queuedFolder.workspaceFolder,
			'.bh',
			'cache',
			'canvas-node-undo',
			generateUuid(),
			name
		);

		const reservation = this.workspaceMutationCoordinator.reserveStructural(queuedFolder.workspaceFolder, [{
			workspace: queuedFolder.workspaceFolder,
			relativePath: targetPath
		}]);
		let committed: IBaseHalfCanvasCreatedNodeTransition | undefined;
		let failure: unknown;
		await reservation.finish(async lease => {
			let fileCreated = false;
			let referenceTransition: Awaited<ReturnType<IBaseHalfBadgeGraphService['addReferenceWithState']>> | undefined;
			let canvasApplied = false;
			let canvasTransition: IBaseHalfCanvasStateTransition | undefined;
			try {
				this.folderForSceneMutation(sceneKey);
				if (this.canvasRecipeRegistryService.getRecipe(picked.choice.recipe.id) !== picked.choice.recipe) {
					throw new Error(`'${picked.choice.recipe.label}' is no longer installed.`);
				}
				const currentCanvas = await this.canvasMirrorService.readCanvas(queuedFolder);
				if (await this.fileService.exists(baseHalfMirrorResource(queuedFolder.workspaceFolder, targetPath, 'badge.yaml'))
					|| currentCanvas?.cards.some(candidate => candidate.path === targetPath)
					|| currentCanvas?.edges.some(candidate => candidate.from === edge.from && candidate.to === edge.to)) {
					throw new Error(`Project metadata for '${targetPath}' already exists.`);
				}
				const placement = this.avoidCanvasCreateOverlap({
					canvasPosition: drop.position,
					screenPosition: { x: 0, y: 0 }
				}, 'resultNode', currentCanvas?.cards, targetSize);
				const card: NonNullable<IBaseHalfCanvasStateTransition['cards']>[number]['next'] = {
					path: targetPath,
					kind: 'file',
					x: roundCanvasPosition(placement.canvasPosition.x),
					y: roundCanvasPosition(placement.canvasPosition.y),
					width: targetSize.width,
					height: targetSize.height
				};
				canvasTransition = {
					cards: [{ path: targetPath, expected: null, next: card }],
					edges: [{ from: edge.from, to: edge.to, expected: null, next: edge }]
				};
				await this.fileService.writeFileWithExpectedContents(
					targetResource,
					contents,
					null,
					{ atomic: { postfix: '.basehalf-node-create-tmp' } }
				);
				fileCreated = true;
				const live = await this.resolveLiveWorkspaceNodes(queuedFolder.workspaceFolder, [
					{ path: drop.from, kind: drop.fromKind },
					{ path: targetPath, kind: 'file' }
				]);
				if (await this.readWorkspaceContentKind(queuedFolder.workspaceFolder, drop.from) !== sourceKind) {
					throw new Error(`'${drop.from}' changed content kind before the node could be created.`);
				}
				referenceTransition = await this.badgeGraphService.addReferenceWithState(
					live.get(drop.from)!,
					live.get(targetPath)!,
					lease
				);
				if (referenceTransition.result !== 'added') {
					throw new Error(`Context metadata for '${targetPath}' already exists.`);
				}
				await this.canvasMirrorService.transitionCanvasState(queuedFolder, canvasTransition, lease);
				canvasApplied = true;
				const connection: IBaseHalfCanvasConnectionTransition = {
					folder: queuedFolder,
					nodes: [
						{ path: drop.from, kind: drop.fromKind },
						{ path: targetPath, kind: 'file' }
					],
					references: [{
						source: { path: drop.from, kind: drop.fromKind },
						target: { path: targetPath, kind: 'file' },
						expected: referenceTransition.before,
						next: referenceTransition.after
					}],
					canvas: canvasTransition,
					documents: []
				};
				committed = { folder: queuedFolder, targetPath, targetResource, contents, stashResource, connection };
			} catch (error) {
				const rollbackErrors = await compensateBaseHalfCanvasConnectedNodeCreate({
					canvasApplied,
					referenceApplied: referenceTransition !== undefined,
					fileCreated,
					rollbackCanvas: async () => {
						if (canvasTransition) {
							await this.canvasMirrorService.transitionCanvasState(queuedFolder, reverseCanvasStateTransition(canvasTransition, true), lease);
						}
					},
					rollbackReference: async () => {
						if (!referenceTransition) {
							return;
						}
						const live = await this.resolveLiveWorkspaceNodes(queuedFolder.workspaceFolder, [
							{ path: drop.from, kind: drop.fromKind },
							{ path: targetPath, kind: 'file' }
						]);
						await this.badgeGraphService.transitionReferenceStates([{
							source: live.get(drop.from)!,
							target: live.get(targetPath)!,
							expected: referenceTransition.after,
							next: referenceTransition.before
						}], lease);
					},
					discardFile: async () => {
						await this.discardExactCanvasNodeFile(targetResource, contents);
					}
				});
				failure = rollbackErrors.length > 0
					? new AggregateError([error, ...rollbackErrors], `The result node could not be created and its safe cleanup did not fully complete. '${targetPath}' was not overwritten or deleted.`)
					: error;
			}
		});
		if (failure) {
			throw failure;
		}
		if (!committed) {
			throw new Error('The result node transaction completed without a committed state.');
		}

		this.pushCanvasCreatedNodeUndo(committed);
		this.queueCanvasSelection(this.sceneKey(queuedFolder), [targetPath], postCreateOwner);
		this.requestRender();
	}

	private async findAvailableConnectedNodeName(folder: IBaseHalfCanvasFolderState, kind: BaseHalfNodeKind): Promise<string> {
		const canvas = await this.canvasMirrorService.readCanvas(folder);
		for (let index = 0; index < 1000; index++) {
			const name = `${kind}${index === 0 ? '' : `-${index + 1}`}${BASEHALF_NODE_DOCUMENT_EXTENSION}`;
			const path = canvasChildPath(folder.relativePath, name);
			if (await this.fileService.exists(joinPath(folder.workspaceFolder, ...path.split('/')))
				|| await this.fileService.exists(baseHalfMirrorResource(folder.workspaceFolder, path, 'badge.yaml'))
				|| canvas?.cards.some(card => card.path === path)
				|| canvas?.edges.some(edge => edge.from === path || edge.to === path)) {
				continue;
			}
			return name;
		}
		throw new Error(`Too many ${kind} result nodes already use the default name.`);
	}

	private pushCanvasCreatedNodeUndo(transition: IBaseHalfCanvasCreatedNodeTransition): void {
		const source = transition.connection.nodes[0];
		const run = async (reverse: boolean): Promise<void> => {
			const reservation = this.workspaceMutationCoordinator.reserveStructural(transition.folder.workspaceFolder, [{
				workspace: transition.folder.workspaceFolder,
				relativePath: transition.targetPath
			}]);
			await reservation.finish(lease => this.applyCanvasCreatedNodeTransition(transition, reverse, lease));
			this.scheduleBackgroundRender();
		};
		this.undoRedoService.pushElement({
			type: UndoRedoElementType.Workspace,
			resources: uniqueUris([
				this.canvasMirrorService.canvasResource(transition.folder),
				joinPath(transition.folder.workspaceFolder, ...source.path.split('/')),
				transition.targetResource
			]),
			label: localize('basehalf.canvas.createFromConnection.undo', "Create connected result node"),
			code: 'basehalf.canvas.createFromConnection',
			undo: () => run(true),
			redo: () => run(false)
		}, undefined, this.canvasUndoRedoSource);
	}

	private async applyCanvasCreatedNodeTransition(
		transition: IBaseHalfCanvasCreatedNodeTransition,
		reverse: boolean,
		lease: IBaseHalfWorkspaceMutationLease
	): Promise<void> {
		if (reverse) {
			await this.assertExactCanvasNodeFile(transition.targetResource, transition.contents);
			await this.applyCanvasConnectionTransition(transition.connection, true, lease);
			try {
				await this.moveExactCanvasNodeToStash(transition.targetResource, transition.contents, transition.stashResource);
			} catch (error) {
				try {
					await this.applyCanvasConnectionTransition(transition.connection, false, lease);
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], 'Undo could not remove the new node and could not restore its canvas connection. Reopen the project before continuing.');
				}
				throw error;
			}
			return;
		}

		await this.restoreExactCanvasNodeFromStash(transition.targetResource, transition.contents, transition.stashResource);
		try {
			await this.applyCanvasConnectionTransition(transition.connection, false, lease);
		} catch (error) {
			try {
				await this.moveExactCanvasNodeToStash(transition.targetResource, transition.contents, transition.stashResource);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], `Redo could not restore the connection and '${transition.targetPath}' changed before safe cleanup. The file was preserved.`);
			}
			throw error;
		}
	}

	private async assertExactCanvasNodeFile(resource: URI, expected: VSBuffer): Promise<void> {
		if (this.workingCopyService.isDirty(resource) || this.nodeExecutionService.getActiveRun(resource)) {
			throw new Error(`Save '${basename(resource)}' and finish its active run before changing this node.`);
		}
		const current = await this.fileService.readFile(resource, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		if (!current.value.equals(expected)) {
			throw new Error(`'${basename(resource)}' changed after it was created. Its file, connection, and canvas card were preserved.`);
		}
	}

	private async moveExactCanvasNodeToStash(resource: URI, expected: VSBuffer, stash: URI): Promise<void> {
		await this.assertExactCanvasNodeFile(resource, expected);
		if (await this.fileService.exists(stash)) {
			throw new Error(`The private undo copy for '${basename(resource)}' already exists.`);
		}
		await this.fileService.createFolder(dirname(stash));
		await this.fileService.move(resource, stash, false);
		const moved = await this.fileService.readFile(stash, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		if (moved.value.equals(expected)) {
			return;
		}
		const restoreErrors: unknown[] = [];
		try {
			if (await this.fileService.exists(resource)) {
				throw new Error(`'${basename(resource)}' was recreated while its undo was being prepared.`);
			}
			await this.fileService.move(stash, resource, false);
		} catch (error) {
			restoreErrors.push(error);
		}
		throw restoreErrors.length > 0
			? new AggregateError(restoreErrors, `'${basename(resource)}' changed during safe removal. Its changed contents were preserved.`)
			: new Error(`'${basename(resource)}' changed during safe removal and was restored.`);
	}

	private async discardExactCanvasNodeFile(resource: URI, expected: VSBuffer): Promise<void> {
		await this.assertExactCanvasNodeFile(resource, expected);
		await this.fileService.del(resource, {
			atomic: { postfix: `.basehalf-node-rollback-${generateUuid()}` }
		});
	}

	private async restoreExactCanvasNodeFromStash(resource: URI, expected: VSBuffer, stash: URI): Promise<void> {
		if (await this.fileService.exists(resource)) {
			throw new Error(`'${basename(resource)}' already exists. Redo did not replace it.`);
		}
		if (await this.fileService.exists(stash)) {
			const stashed = await this.fileService.readFile(stash, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			if (!stashed.value.equals(expected)) {
				throw new Error(`The private undo copy for '${basename(resource)}' changed. Redo did not use it.`);
			}
			await this.fileService.move(stash, resource, false);
			await this.assertExactCanvasNodeFile(resource, expected);
			return;
		}
		await this.fileService.writeFileWithExpectedContents(
			resource,
			expected,
			null,
			{ atomic: { postfix: '.basehalf-node-redo-tmp' } }
		);
	}

	private async readConnectionTargetSnapshot(
		folder: IBaseHalfCanvasFolderState,
		path: string,
		kind: IBaseHalfCanvasItem['kind'],
		action: 'connecting' | 'reconnecting',
		loadNodeConfiguration = false
	): Promise<IBaseHalfCanvasConnectionTargetSnapshot> {
		const target: IBaseHalfBadgeNode = {
			resource: joinPath(folder.workspaceFolder, ...path.split('/')),
			workspaceFolder: folder.workspaceFolder,
			relativePath: path,
			kind
		};
		const neighborhood = await this.badgeGraphService.readBadgeNeighborhood(target);
		if (neighborhood.problems.length > 0) {
			throw new Error(`Repair the context metadata for '${path}' before ${action} it.`);
		}
		const directSourcePaths = Object.freeze([...(neighborhood.badges.get(path)?.referenced_by ?? [])].sort());
		if (!loadNodeConfiguration || !path.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			return Object.freeze({ path, kind, directSourcePaths, inputKinds: new Map() });
		}

		const resource = target.resource;
		if (this.workingCopyService.isDirty(resource) || this.nodeExecutionService.getActiveRun(resource)) {
			throw new Error(`Save '${path}' and finish its active run before ${action} context.`);
		}
		const content = await this.fileService.readFile(resource, { atomic: true, limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } });
		const document = parseBaseHalfNodeDocumentBytes(content.value.buffer);
		if (document.attempts.some(attempt => attempt.status === 'running')) {
			throw new Error(`Finish '${path}' active run before ${action} context.`);
		}
		const recipe = document.recipe ? this.canvasRecipeRegistryService.getRecipe(document.recipe.recipeId) : undefined;
		const inputKinds = new Map<string, BaseHalfCanvasContentKind>();
		if (recipe && baseHalfCanvasRecipeMatchesNodeKind(recipe, document.kind)) {
			for (const sourcePath of directSourcePaths) {
				inputKinds.set(sourcePath, await this.readWorkspaceContentKind(folder.workspaceFolder, sourcePath));
			}
		}
		return Object.freeze({
			path,
			kind,
			directSourcePaths,
			inputKinds,
			node: Object.freeze({ resource, contents: content.value, document, recipe })
		});
	}

	private async readConnectionPairState(
		folder: IBaseHalfCanvasFolderState,
		source: IBaseHalfCanvasUndoNode,
		target: IBaseHalfCanvasUndoNode
	): Promise<IBaseHalfReferenceState> {
		const node = (value: IBaseHalfCanvasUndoNode): IBaseHalfBadgeNode => ({
			resource: joinPath(folder.workspaceFolder, ...value.path.split('/')),
			workspaceFolder: folder.workspaceFolder,
			relativePath: value.path,
			kind: value.kind
		});
		const [sourceNeighborhood, targetNeighborhood] = await Promise.all([
			this.badgeGraphService.readBadgeNeighborhood(node(source)),
			this.badgeGraphService.readBadgeNeighborhood(node(target))
		]);
		if (sourceNeighborhood.problems.length > 0 || targetNeighborhood.problems.length > 0) {
			throw new Error(`Repair the context metadata between '${source.path}' and '${target.path}' before changing this connection.`);
		}
		return {
			forward: sourceNeighborhood.badges.get(source.path)?.references.includes(target.path) ?? false,
			backlink: targetNeighborhood.badges.get(target.path)?.referenced_by.includes(source.path) ?? false
		};
	}

	private async assertConnectionTargetCurrent(
		folder: IBaseHalfCanvasFolderState,
		expectedTarget: IBaseHalfCanvasConnectionTargetSnapshot,
		sourcePath: string
	): Promise<IBaseHalfCanvasConnectionTargetSnapshot> {
		const current = await this.readConnectionTargetSnapshot(folder, expectedTarget.path, expectedTarget.kind, 'connecting', !!expectedTarget.node);
		if (!connectionTargetSnapshotsEqual(expectedTarget, current)) {
			throw new Error(`'${expectedTarget.path}' or its direct context changed before the connection could be saved.`);
		}
		if (current.directSourcePaths.includes(sourcePath)) {
			throw new Error(`Context from '${sourcePath}' is already connected to '${current.path}'.`);
		}
		return current;
	}

	private async connectSceneEdge(sceneKey: string, structuralEpoch: number, connection: IBaseHalfCanvasSceneConnection): Promise<void> {
		if (connection.from === connection.to) {
			throw new Error('A node cannot provide context to itself.');
		}
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		const target = await this.readConnectionTargetSnapshot(queuedFolder, connection.to, connection.toKind, 'connecting', true);
		const sourceKind = await this.readWorkspaceContentKind(queuedFolder.workspaceFolder, connection.from);
		const pair = await this.readConnectionPairState(
			queuedFolder,
			{ path: connection.from, kind: connection.fromKind },
			{ path: connection.to, kind: connection.toKind }
		);
		const existingCanvasEdge = (await this.canvasMirrorService.readCanvas(queuedFolder))?.edges
			.some(edge => edge.from === connection.from && edge.to === connection.to) ?? false;
		if (existingCanvasEdge || pair.forward || pair.backlink || target.directSourcePaths.includes(connection.from)) {
			if (pair.forward !== pair.backlink) {
				throw new Error(`Repair the incomplete context metadata between '${connection.from}' and '${connection.to}' before reconnecting it.`);
			}
			throw new Error(`Context from '${connection.from}' is already connected to '${connection.to}'.`);
		}
		const binding = await this.prepareConnectionTargetBinding(target, connection.from, sourceKind);
		if (binding.kind === 'cancel') {
			// The canvas scene clears its optimistic edge after this promise settles. Reconcile
			// on the next background pass so a cancelled picker cannot leave that edge
			// visible even though no graph layer was changed.
			this.scheduleBackgroundRender();
			return;
		}
		const nodeUpdate = target.node && binding.document
			? {
				resource: target.node.resource,
				expected: target.node.contents,
				next: VSBuffer.fromString(serializeBaseHalfNodeDocument(binding.document))
			}
			: undefined;
		let committedTransition: IBaseHalfCanvasConnectionTransition | undefined;
		await this.workspaceMutationCoordinator.runSceneMutation(
			queuedFolder.workspaceFolder,
			this.sceneMutationStamp(queuedFolder, structuralEpoch),
			async lease => {
				const folder = this.folderForSceneMutation(sceneKey);
				await this.assertConnectionTargetCurrent(folder, target, connection.from);
				if (await this.readWorkspaceContentKind(folder.workspaceFolder, connection.from) !== sourceKind) {
					throw new Error(`'${connection.from}' changed content kind before it could be connected to '${connection.to}'.`);
				}
				const currentPair = await this.readConnectionPairState(
					folder,
					{ path: connection.from, kind: connection.fromKind },
					{ path: connection.to, kind: connection.toKind }
				);
				if (currentPair.forward || currentPair.backlink) {
					throw new Error(`The context metadata between '${connection.from}' and '${connection.to}' changed before it could be connected.`);
				}
				const live = await this.resolveLiveCanvasNodes(sceneKey, folder, [
					{ path: connection.from, kind: connection.fromKind },
					{ path: connection.to, kind: connection.toKind }
				]);
				const edge: IBaseHalfCanvasEdge = {
					from: connection.from,
					from_anchor: connection.fromAnchor,
					to: connection.to,
					to_anchor: connection.toAnchor
				};
				const currentCanvasEdge = (await this.canvasMirrorService.readCanvas(folder))?.edges
					.find(candidate => candidate.from === edge.from && candidate.to === edge.to) ?? null;
				if (currentCanvasEdge) {
					throw new Error(`Context from '${connection.from}' is already connected to '${connection.to}'.`);
				}
				let referenceTransition: Awaited<ReturnType<IBaseHalfBadgeGraphService['addReferenceWithState']>> | undefined;
				let canvasApplied = false;
				let documentApplied = false;
				try {
					referenceTransition = await this.badgeGraphService.addReferenceWithState(live.get(edge.from)!, live.get(edge.to)!, lease);
					if (referenceTransition.result !== 'added') {
						throw new Error(`Context from '${connection.from}' is already connected to '${connection.to}' or requires metadata repair.`);
					}
					await this.canvasMirrorService.transitionCanvasState(folder, {
						edges: [{ from: edge.from, to: edge.to, expected: null, next: edge }]
					}, lease);
					canvasApplied = true;
					if (nodeUpdate) {
						await this.fileService.writeFileWithExpectedContents(
							nodeUpdate.resource,
							nodeUpdate.next,
							nodeUpdate.expected,
							{ atomic: { postfix: '.basehalf-node-connect-tmp' } }
						);
						documentApplied = true;
					}
					committedTransition = {
						folder,
						nodes: [
							{ path: connection.from, kind: connection.fromKind },
							{ path: connection.to, kind: connection.toKind }
						],
						references: [{
							source: { path: connection.from, kind: connection.fromKind },
							target: { path: connection.to, kind: connection.toKind },
							expected: referenceTransition.before,
							next: referenceTransition.after
						}],
						canvas: { edges: [{ from: edge.from, to: edge.to, expected: null, next: edge }] },
						documents: nodeUpdate ? [nodeUpdate] : []
					};
				} catch (error) {
					const rollbackErrors: unknown[] = [];
					if (documentApplied && nodeUpdate) {
						try {
							await this.fileService.writeFileWithExpectedContents(
								nodeUpdate.resource,
								nodeUpdate.expected,
								nodeUpdate.next,
								{ atomic: { postfix: '.basehalf-node-connect-rollback-tmp' } }
							);
						} catch (restoreError) {
							rollbackErrors.push(restoreError);
						}
					}
					if (canvasApplied) {
						try {
							await this.canvasMirrorService.transitionCanvasState(folder, {
								edges: [{ from: edge.from, to: edge.to, expected: edge, next: null }]
							}, lease);
						} catch (restoreError) {
							rollbackErrors.push(restoreError);
						}
					}
					if (referenceTransition) {
						try {
							await this.badgeGraphService.transitionReferenceStates([{
								source: live.get(edge.from)!,
								target: live.get(edge.to)!,
								expected: referenceTransition.after,
								next: referenceTransition.before
							}], lease);
						} catch (restoreError) {
							rollbackErrors.push(restoreError);
						}
					}
					if (rollbackErrors.length > 0) {
						throw new AggregateError([error, ...rollbackErrors], 'The connection change and its safe rollback both failed. Reopen the project before continuing.');
					}
					throw error;
				}
			}
		);
		if (committedTransition && canvasConnectionTransitionChangesAnything(committedTransition)) {
			this.pushCanvasUndoElement(
				localize('basehalf.canvas.connect.undo', "Connect canvas nodes"),
				queuedFolder,
				committedTransition.nodes,
				committedTransition.documents,
				(reverse, lease) => this.applyCanvasConnectionTransition(committedTransition!, reverse, lease)
			);
		}
		this.requestRender();
	}

	private async reconnectSceneEdge(sceneKey: string, structuralEpoch: number, intent: IBaseHalfCanvasSceneReconnect): Promise<void> {
		const { previous, next: connection } = intent;
		if (connection.from === connection.to) {
			throw new Error('A node cannot provide context to itself.');
		}
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		const next: IBaseHalfCanvasEdge = {
			from: connection.from,
			from_anchor: connection.fromAnchor,
			to: connection.to,
			to_anchor: connection.toAnchor
		};
		const endpointsChanged = previous.from !== next.from || previous.to !== next.to;
		const targetSnapshots = new Map<string, IBaseHalfCanvasConnectionTargetSnapshot>();
		const loadTarget = async (path: string, kind: IBaseHalfCanvasItem['kind']) => {
			let target = targetSnapshots.get(path);
			if (!target) {
				target = await this.readConnectionTargetSnapshot(queuedFolder, path, kind, 'reconnecting', true);
				targetSnapshots.set(path, target);
			}
			return target;
		};
		const previousTarget = await loadTarget(previous.to, previous.toKind);
		const previousPair = await this.readConnectionPairState(
			queuedFolder,
			{ path: previous.from, kind: previous.fromKind },
			{ path: previous.to, kind: previous.toKind }
		);
		const initialCanvas = await this.canvasMirrorService.readCanvas(queuedFolder);
		const initialPreviousCanvasEdge = initialCanvas?.edges.find(edge => edge.from === previous.from && edge.to === previous.to) ?? null;
		if (!initialPreviousCanvasEdge || !canvasEdgesEqual(initialPreviousCanvasEdge, previous)
			|| !previousPair.forward || !previousPair.backlink
			|| !previousTarget.directSourcePaths.includes(previous.from)) {
			throw new Error('This context connection changed before it could be reconnected.');
		}
		if (endpointsChanged && initialCanvas?.edges.some(edge => edge.from === next.from && edge.to === next.to)) {
			throw new Error(`Context from '${next.from}' is already connected to '${next.to}'.`);
		}

		const documents = new Map<string, {
			readonly target: IBaseHalfCanvasConnectionTargetSnapshot;
			document: IBaseHalfNodeDocument;
		}>();
		const editableDocument = (target: IBaseHalfCanvasConnectionTargetSnapshot) => {
			if (!target.node) {
				return undefined;
			}
			let state = documents.get(target.path);
			if (!state) {
				state = { target, document: target.node.document };
				documents.set(target.path, state);
			}
			return state;
		};
		let selectedNextSourceKind: BaseHalfCanvasContentKind | undefined;
		if (endpointsChanged) {
			const nextPair = await this.readConnectionPairState(
				queuedFolder,
				{ path: next.from, kind: connection.fromKind },
				{ path: next.to, kind: connection.toKind }
			);
			if (nextPair.forward || nextPair.backlink) {
				if (nextPair.forward !== nextPair.backlink) {
					throw new Error(`Repair the incomplete context metadata between '${next.from}' and '${next.to}' before reconnecting it.`);
				}
				throw new Error(`Context from '${next.from}' is already connected to '${next.to}'.`);
			}
			const previousDocument = editableDocument(previousTarget);
			if (previousDocument?.document.recipe) {
				if (previousDocument.document.result || previousDocument.document.attempts.length > 0) {
					throw new Error(`'${previousTarget.path}' already has an attempt or sealed Result. Its recipe inputs cannot be reconnected.`);
				}
				previousDocument.document = {
					...previousDocument.document,
					recipe: {
						...previousDocument.document.recipe,
						inputBindings: normalizeNodeInputBindings(previousDocument.document.recipe.inputBindings
							.filter(binding => binding.sourcePath !== previous.from))
					}
				};
			}

			const nextTarget = await loadTarget(next.to, connection.toKind);
			const nextDirectSourcePaths = nextTarget.path === previousTarget.path
				? nextTarget.directSourcePaths.filter(path => path !== previous.from)
				: nextTarget.directSourcePaths;
			if (nextDirectSourcePaths.includes(next.from)) {
				throw new Error(`Context from '${next.from}' is already connected to '${next.to}'.`);
			}

			const nextSourceKind = await this.readWorkspaceContentKind(queuedFolder.workspaceFolder, next.from);
			selectedNextSourceKind = nextSourceKind;
			const nextDocument = editableDocument(nextTarget);
			const binding = await this.prepareConnectionTargetBinding(
				nextTarget,
				next.from,
				nextSourceKind,
				nextDocument?.document
			);
			if (binding.kind === 'cancel') {
				this.scheduleBackgroundRender();
				return;
			}
			if (nextDocument && binding.document) {
				nextDocument.document = binding.document;
			}
		}
		const nodeUpdates = [...documents.values()].map(state => ({
			resource: state.target.node!.resource,
			expected: state.target.node!.contents,
			next: VSBuffer.fromString(serializeBaseHalfNodeDocument(state.document))
		})).filter(update => !update.expected.equals(update.next));
		let committedTransition: IBaseHalfCanvasConnectionTransition | undefined;
		await this.workspaceMutationCoordinator.runSceneMutation(
			queuedFolder.workspaceFolder,
			this.sceneMutationStamp(queuedFolder, structuralEpoch),
			async lease => {
				const folder = this.folderForSceneMutation(sceneKey);
				for (const expectedTarget of targetSnapshots.values()) {
					const currentTarget = await this.readConnectionTargetSnapshot(folder, expectedTarget.path, expectedTarget.kind, 'reconnecting', !!expectedTarget.node);
					if (!connectionTargetSnapshotsEqual(expectedTarget, currentTarget)) {
						throw new Error(`'${expectedTarget.path}' or its direct context changed before the connection could be reconnected.`);
					}
				}
				if (selectedNextSourceKind !== undefined
					&& await this.readWorkspaceContentKind(folder.workspaceFolder, next.from) !== selectedNextSourceKind) {
					throw new Error(`'${next.from}' changed content kind before it could be reconnected to '${next.to}'.`);
				}
				const currentPreviousPair = await this.readConnectionPairState(
					folder,
					{ path: previous.from, kind: previous.fromKind },
					{ path: previous.to, kind: previous.toKind }
				);
				if (!currentPreviousPair.forward || !currentPreviousPair.backlink) {
					throw new Error('The context metadata changed before the connection could be reconnected.');
				}
				if (endpointsChanged) {
					const currentNextPair = await this.readConnectionPairState(
						folder,
						{ path: next.from, kind: connection.fromKind },
						{ path: next.to, kind: connection.toKind }
					);
					if (currentNextPair.forward || currentNextPair.backlink) {
						throw new Error('The destination context metadata changed before the connection could be reconnected.');
					}
				}
				const currentCanvas = await this.canvasMirrorService.readCanvas(folder);
				const currentPreviousCanvasEdge = currentCanvas?.edges.find(edge => edge.from === previous.from && edge.to === previous.to) ?? null;
				if (!currentPreviousCanvasEdge || !canvasEdgesEqual(currentPreviousCanvasEdge, previous)
					|| (endpointsChanged && currentCanvas?.edges.some(edge => edge.from === next.from && edge.to === next.to))) {
					throw new Error('The canvas connection changed before it could be reconnected.');
				}
				const live = await this.resolveLiveCanvasNodes(sceneKey, folder, [
					{ path: previous.from, kind: previous.fromKind },
					{ path: previous.to, kind: previous.toKind },
					{ path: connection.from, kind: connection.fromKind },
					{ path: connection.to, kind: connection.toKind }
				]);
				let referenceTransition: Awaited<ReturnType<IBaseHalfBadgeGraphService['reconnectReferenceWithState']>> | undefined;
				const canvasTransitions = canvasReconnectStateTransitions(previous, next);
				let canvasApplied = false;
				const written: typeof nodeUpdates = [];
				try {
					if (endpointsChanged) {
						referenceTransition = await this.badgeGraphService.reconnectReferenceWithState(
							live.get(previous.from)!,
							live.get(previous.to)!,
							live.get(next.from)!,
							live.get(next.to)!,
							lease
						);
						if (referenceTransition.result === 'already-connected') {
							throw new Error('This context connection already exists.');
						}
					}
					await this.canvasMirrorService.transitionCanvasState(folder, { edges: canvasTransitions }, lease);
					canvasApplied = true;
					for (const update of nodeUpdates) {
						await this.fileService.writeFileWithExpectedContents(
							update.resource,
							update.next,
							update.expected,
							{ atomic: { postfix: '.basehalf-node-reconnect-tmp' } }
						);
						written.push(update);
					}
					const referenceChanges: IBaseHalfCanvasReferenceTransition[] = referenceTransition ? [
						{
							source: { path: previous.from, kind: previous.fromKind },
							target: { path: previous.to, kind: previous.toKind },
							expected: referenceTransition.before.previous,
							next: referenceTransition.after.previous
						},
						{
							source: { path: connection.from, kind: connection.fromKind },
							target: { path: connection.to, kind: connection.toKind },
							expected: referenceTransition.before.next,
							next: referenceTransition.after.next
						}
					] : [];
					committedTransition = {
						folder,
						nodes: uniqueCanvasUndoNodes([
							{ path: previous.from, kind: previous.fromKind },
							{ path: previous.to, kind: previous.toKind },
							{ path: connection.from, kind: connection.fromKind },
							{ path: connection.to, kind: connection.toKind }
						]),
						references: referenceChanges,
						canvas: { edges: canvasTransitions },
						documents: nodeUpdates.map(update => ({ resource: update.resource, expected: update.expected, next: update.next }))
					};
				} catch (error) {
					const rollbackErrors: unknown[] = [];
					for (const update of written.reverse()) {
						try {
							await this.fileService.writeFileWithExpectedContents(
								update.resource,
								update.expected,
								update.next,
								{ atomic: { postfix: '.basehalf-node-reconnect-rollback-tmp' } }
							);
						} catch (restoreError) {
							rollbackErrors.push(restoreError);
						}
					}
					if (canvasApplied) {
						try {
							await this.canvasMirrorService.transitionCanvasState(folder, {
								edges: canvasTransitions.map(change => ({ ...change, expected: change.next, next: change.expected }))
							}, lease);
						} catch (restoreError) {
							rollbackErrors.push(restoreError);
						}
					}
					if (referenceTransition) {
						try {
							await this.badgeGraphService.transitionReferenceStates([
								{
									source: live.get(previous.from)!, target: live.get(previous.to)!,
									expected: referenceTransition.after.previous, next: referenceTransition.before.previous
								},
								{
									source: live.get(next.from)!, target: live.get(next.to)!,
									expected: referenceTransition.after.next, next: referenceTransition.before.next
								}
							], lease);
						} catch (restoreError) {
							rollbackErrors.push(restoreError);
						}
					}
					if (rollbackErrors.length > 0) {
						throw new AggregateError([error, ...rollbackErrors], 'The connection change and its safe rollback both failed. Reopen the project before continuing.');
					}
					throw error;
				}
			}
		);
		if (committedTransition && canvasConnectionTransitionChangesAnything(committedTransition)) {
			this.pushCanvasUndoElement(
				localize('basehalf.canvas.reconnect.undo', "Reconnect canvas nodes"),
				queuedFolder,
				committedTransition.nodes,
				committedTransition.documents,
				(reverse, lease) => this.applyCanvasConnectionTransition(committedTransition!, reverse, lease)
			);
		}
		this.requestRender();
	}

	private async removeEdgeFromScene(sceneKey: string, structuralEpoch: number, edge: IBaseHalfCanvasSceneEdge): Promise<void> {
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		let nodeUpdate: { readonly resource: URI; readonly expected: VSBuffer; readonly next: VSBuffer } | undefined;
		if (edge.to.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			const resource = joinPath(queuedFolder.workspaceFolder, ...edge.to.split('/'));
			if (this.workingCopyService.isDirty(resource) || this.nodeExecutionService.getActiveRun(resource)) {
					this.queueCanvasWarning(`Save '${edge.to}' and finish its active attempt before removing this connection.`);
				this.requestRender();
				return;
			}
			try {
				const content = await this.fileService.readFile(resource, { atomic: true, limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } });
				const document = parseBaseHalfNodeDocumentBytes(content.value.buffer);
				if (document.attempts.some(attempt => attempt.status === 'running')) {
						throw new Error(`Finish '${edge.to}' active attempt before removing this connection.`);
					}
					if (document.recipe?.inputBindings.some(binding => binding.sourcePath === edge.from)) {
						if (document.result || document.attempts.length > 0) {
							throw new Error(`'${edge.to}' already has an attempt or sealed Result. Its recipe inputs cannot be disconnected.`);
						}
					const inputBindings = normalizeNodeInputBindings(document.recipe.inputBindings.filter(binding => binding.sourcePath !== edge.from));
					nodeUpdate = {
						resource,
						expected: content.value,
						next: VSBuffer.fromString(serializeBaseHalfNodeDocument({
							...document,
							recipe: { ...document.recipe, inputBindings }
						}))
					};
				}
				} catch (error) {
					this.logService.warn(error);
					this.queueCanvasWarning(error instanceof Error ? error.message : `Open '${edge.to}' and repair it before removing this connection.`);
				this.requestRender();
				return;
			}
		}
		let committedTransition: IBaseHalfCanvasConnectionTransition | undefined;
		await this.workspaceMutationCoordinator.runSceneMutation(
			queuedFolder.workspaceFolder,
			this.sceneMutationStamp(queuedFolder, structuralEpoch),
			async lease => {
				const folder = this.folderForSceneMutation(sceneKey);
				const live = await this.resolveLiveCanvasNodes(sceneKey, folder, [
					{ path: edge.from, kind: edge.fromKind },
					{ path: edge.to, kind: edge.toKind }
				]);
				// A semantic edge may be derived entirely from reciprocal references
				// and therefore have no persisted anchor row. Only CAS-delete the row
				// that actually exists; rendered default anchors are not disk state.
				const canvasTransitions = baseHalfPersistedCanvasEdgeRemoval(
					(await this.canvasMirrorService.readCanvas(folder))?.edges ?? [],
					edge.from,
					edge.to
				);
				let referenceTransition: Awaited<ReturnType<IBaseHalfBadgeGraphService['removeReferenceWithState']>> | undefined;
				let canvasApplied = false;
				try {
					referenceTransition = await removeCompleteBaseHalfCanvasReference(
						() => this.badgeGraphService.removeReferenceWithState(live.get(edge.from)!, live.get(edge.to)!, lease),
						transition => this.badgeGraphService.transitionReferenceStates([{
							source: live.get(edge.from)!,
							target: live.get(edge.to)!,
							expected: transition.after,
							next: transition.before
						}], lease),
						`Connection '${edge.from}' → '${edge.to}' changed before it could be removed.`,
						!!nodeUpdate
					);
					if (canvasTransitions.length > 0) {
						await this.canvasMirrorService.transitionCanvasState(folder, { edges: canvasTransitions }, lease);
						canvasApplied = true;
					}
					if (nodeUpdate) {
						await this.fileService.writeFileWithExpectedContents(
							nodeUpdate.resource,
							nodeUpdate.next,
							nodeUpdate.expected,
							{ atomic: { postfix: '.basehalf-node-unbind-tmp' } }
						);
					}
					committedTransition = {
						folder,
						nodes: [
							{ path: edge.from, kind: edge.fromKind },
							{ path: edge.to, kind: edge.toKind }
						],
						references: [{
							source: { path: edge.from, kind: edge.fromKind },
							target: { path: edge.to, kind: edge.toKind },
							expected: referenceTransition.before,
							next: referenceTransition.after
						}],
						canvas: { edges: canvasTransitions },
						documents: nodeUpdate ? [nodeUpdate] : []
					};
				} catch (error) {
					const rollbackErrors: unknown[] = [];
					if (canvasApplied) {
						try {
							await this.canvasMirrorService.transitionCanvasState(folder, reverseCanvasStateTransition({ edges: canvasTransitions }, true), lease);
						} catch (restoreError) {
							rollbackErrors.push(restoreError);
						}
					}
					if (referenceTransition) {
						try {
							await this.badgeGraphService.transitionReferenceStates([{
								source: live.get(edge.from)!,
								target: live.get(edge.to)!,
								expected: referenceTransition.after,
								next: referenceTransition.before
							}], lease);
						} catch (restoreError) {
							rollbackErrors.push(restoreError);
						}
					}
					if (rollbackErrors.length > 0) {
						throw new AggregateError([error, ...rollbackErrors], 'The connection change and its safe rollback both failed. Reopen the project before continuing.');
					}
					throw error;
				}
			}
		);
		if (committedTransition) {
			this.pushCanvasUndoElement(
				localize('basehalf.canvas.disconnect.undo', "Disconnect canvas nodes"),
				queuedFolder,
				committedTransition.nodes,
				committedTransition.documents,
				(reverse, lease) => this.applyCanvasConnectionTransition(committedTransition!, reverse, lease)
			);
		}
		this.requestRender();
	}

	private async prepareSceneSelectionChange(sceneKey: string, structuralEpoch: number, paths: readonly string[]): Promise<boolean> {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return false;
		}
		if (this.activeNodeLocalSurface && !(paths.length === 1 && paths[0] === this.activeNodeLocalSurface.path)) {
			if (!await this.activeNodeLocalSurface.closeForSwitch()) {
				return false;
			}
		}
		if (!(paths.length === 1 && paths[0] === this.activeNodeLocalSurface?.path)) {
			// Cancel an asynchronous file/model/input read that has not mounted its
			// surface yet. A late open must never follow a selection that moved on.
			this.nodeLocalSurfaceIntent++;
		}
		const notePath = this.canvasNoteSurfacePath ?? this.activeCanvasNoteEditor?.path;
		const changesNote = notePath !== undefined && !(paths.length === 1 && paths[0] === notePath);
		if (!changesNote) {
			this.scheduleVideoComposerForSelection(sceneKey, structuralEpoch, paths);
			return true;
		}
		const activeBeforeWait = this.activeCanvasNoteEditor;
		const noteItem = this.renderedItemsByPath.get(notePath);
		const resourceKey = activeBeforeWait?.path === notePath && activeBeforeWait.sceneKey === sceneKey
			? activeBeforeWait.resourceKey
			: noteItem && isBaseHalfMarkdownResource(noteItem.stat.resource)
				? this.uriIdentityService.extUri.getComparisonKey(noteItem.stat.resource)
				: undefined;
		if (resourceKey) {
			if (!await this.waitForCanvasNoteFormatCommands(sceneKey, notePath, resourceKey)) {
				return false;
			}
		}
		const currentFolder = this.getCurrentFolder();
		if (!currentFolder || this.sceneKey(currentFolder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(currentFolder.workspaceFolder, this.sceneMutationStamp(currentFolder, structuralEpoch))) {
			return false;
		}
		const active = this.activeCanvasNoteEditor;
		if (active) {
			if (paths.length === 1 && paths[0] === active.path) {
				return true;
			}
			const closed = await this.closeActiveCanvasNoteEditorAfterFormats();
			if (closed) {
				this.scheduleVideoComposerForSelection(sceneKey, structuralEpoch, paths);
			}
			return closed;
		}
		if (this.canvasNoteSurfacePath === notePath) {
			this.clearPendingCanvasNoteFocus(notePath);
			this.canvasNoteSurfacePath = undefined;
			this.requestRender();
		}
		this.scheduleVideoComposerForSelection(sceneKey, structuralEpoch, paths);
		return true;
	}

	private scheduleVideoComposerForSelection(sceneKey: string, structuralEpoch: number, paths: readonly string[]): void {
		// Selection is accepted before React commits it. Remember that intent only
		// while a Video preview is still hydrating; the scene-owned Composer portal
		// itself is projected from the committed selection and needs no DOM polling.
		const preparedSelection = {
			sceneKey,
			structuralEpoch,
			paths: Object.freeze([...paths])
		};
		this.preparedSceneSelection = preparedSelection;
		if (paths.length !== 1) {
			return;
		}
		const path = paths[0];
		const openWhenInteractionSettles = (): void => {
			if (this.disposed || this.canvasNavigationService.state.cardDetail || this.preparedSceneSelection !== preparedSelection) {
				return;
			}
			// A direct drag of an unselected Video accepts selection before the
			// pointer is released. Keep the new Composer dormant until the gesture
			// ends so adjacent chrome never appears underneath the pointer.
			if (this.canvasScene.isInteracting()) {
				mainWindow.requestAnimationFrame(openWhenInteractionSettles);
				return;
			}
			const folder = this.getCurrentFolder();
			const item = this.renderedItemsByPath.get(path);
			const preview = this.renderedCardPreviewsByPath.get(path)?.preview;
			const card = this.renderedCardElementsByPath.get(path);
			if (!folder || this.sceneKey(folder) !== sceneKey
				|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
				return;
			}
			if (!item || preview?.kind !== 'node' || preview.document.kind !== 'video' || !card) {
				return;
			}
			void this.showNodeLocalSurface(item, card);
		};
		mainWindow.requestAnimationFrame(openWhenInteractionSettles);
	}

	private consumePreparedVideoComposer(path: string): void {
		const preparedSelection = this.preparedSceneSelection;
		if (preparedSelection?.paths.length === 1 && preparedSelection.paths[0] === path) {
			this.preparedSceneSelection = undefined;
		}
	}

	private async beginSceneNoteEdit(
		sceneKey: string,
		structuralEpoch: number,
		path: string,
		point?: IBaseHalfCanvasNoteEditPoint,
		acceptedFormatOwner?: IBaseHalfCanvasNoteFormatOwner
	): Promise<void> {
		this.cancelPendingNodeActivation();
		const folder = this.getCurrentFolder();
		const item = this.renderedItemsByPath.get(path);
		if (!folder || this.canvasNavigationService.state.cardDetail || !item
			|| !isBaseHalfMarkdownResource(item.stat.resource)
			|| this.sceneKey(folder) !== sceneKey) {
			return;
		}
		if (!acceptedFormatOwner) {
			this.markCanvasUserInteraction();
		}
		const resourceKey = this.uriIdentityService.extUri.getComparisonKey(item.stat.resource);
		const owner = { sceneKey, path, resourceKey };
		if (acceptedFormatOwner
			? !baseHalfCanvasNoteFormatOwnersEqual(acceptedFormatOwner, owner)
			: !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const completePreview = this.renderedCardPreviewsByPath.get(path)?.preview.kind === 'markdown';
		if (baseHalfCanvasMarkdownEditTarget(item.stat.size, completePreview) === 'richDetail') {
			// Formatting requests are already owned by the pending inline-command
			// lifecycle and must not wait on themselves through openSceneCard.
			if (!acceptedFormatOwner) {
				await this.openSceneCard(sceneKey, structuralEpoch, path);
			}
			return;
		}
		const remainsCurrent = (): boolean => {
			const currentFolder = this.getCurrentFolder();
			const currentItem = this.renderedItemsByPath.get(path);
			if (!currentFolder
				|| this.canvasNavigationService.state.cardDetail
				|| !currentItem
				|| !isBaseHalfMarkdownResource(currentItem.stat.resource)
				|| !this.uriIdentityService.extUri.isEqual(currentItem.stat.resource, item.stat.resource)
				|| this.sceneKey(currentFolder) !== sceneKey) {
				return false;
			}
			return acceptedFormatOwner
				? baseHalfCanvasNoteFormatOwnersEqual(acceptedFormatOwner, {
					sceneKey,
					path,
					resourceKey: this.uriIdentityService.extUri.getComparisonKey(currentItem.stat.resource)
				})
				: this.workspaceMutationCoordinator.isStampCurrent(currentFolder.workspaceFolder, this.sceneMutationStamp(currentFolder, structuralEpoch));
		};
		const active = this.activeCanvasNoteEditor;
		const rememberedSelection = point ? undefined : this.canvasNoteSelections.get(resourceKey);
		const rememberedPoint = point ?? (rememberedSelection ? undefined : this.canvasNoteEditPoints.get(resourceKey));
		const focus = baseHalfCanvasNoteMountRequestsFocus(acceptedFormatOwner ? 'format' : 'edit');
		if (!focus) {
			this.canvasNoteFocusLeaseOwner.revoke();
		}
		const focusLocation = {
			path,
			...(rememberedPoint ? { point: rememberedPoint } : {}),
			...(rememberedSelection ? { selection: rememberedSelection } : {})
		};
		const pendingFocus: IBaseHalfPendingCanvasNoteFocus = focus
			? { ...focusLocation, focus: true, lease: this.canvasNoteFocusLeaseOwner.claim() }
			: { ...focusLocation, focus: false };
		if (active?.path === path
			&& active.sceneKey === sceneKey
			&& this.uriIdentityService.extUri.isEqual(active.state.resource, item.stat.resource)) {
			this.canvasNoteSurfacePath = path;
			active.card.dataset.noteEditing = 'true';
			if (active.closing) {
				const closed = await active.closing;
				if (!closed) {
					if (this.activeCanvasNoteEditor === active) {
						this.focusCanvasNoteEditorFromIntent(active, pendingFocus);
					} else {
						this.releaseCanvasNoteFocusIntent(pendingFocus);
					}
					return;
				}
				// Multiple callers may await the same close. Retire identity-safely here
				// as well so a rapid second double click cannot race the original closer
				// and lose the re-open request between promise settlement and teardown.
				if (this.activeCanvasNoteEditor === active) {
					this.retireActiveCanvasNoteEditor(active, false);
				}
				if (remainsCurrent()) {
					this.canvasNoteSurfacePath = path;
					this.pendingCanvasNoteFocus = pendingFocus;
					this.tryMountCanvasNoteEditor(path);
					this.requestRender();
				} else {
					this.releaseCanvasNoteFocusIntent(pendingFocus);
				}
				return;
			}
			await active.open.catch(() => undefined);
			if (this.activeCanvasNoteEditor === active && !active.closing && remainsCurrent()) {
				this.focusCanvasNoteEditorFromIntent(active, pendingFocus);
			} else {
				this.releaseCanvasNoteFocusIntent(pendingFocus);
			}
			return;
		}
		if (!await this.closeActiveCanvasNoteEditor(false) || !remainsCurrent()) {
			this.releaseCanvasNoteFocusIntent(pendingFocus);
			return;
		}
		this.canvasNoteSurfacePath = path;
		this.pendingCanvasNoteFocus = pendingFocus;
		this.tryMountCanvasNoteEditor(path);
		this.requestRender();
	}

	private rememberSceneNoteEditPoint(sceneKey: string, structuralEpoch: number, path: string, point: IBaseHalfCanvasNoteEditPoint): void {
		const folder = this.getCurrentFolder();
		const item = this.renderedItemsByPath.get(path);
		if (!folder || !item || !isBaseHalfMarkdownResource(item.stat.resource)
			|| this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const resourceKey = this.uriIdentityService.extUri.getComparisonKey(item.stat.resource);
		this.canvasNoteEditPoints.set(resourceKey, point);
		this.canvasNoteSelections.delete(resourceKey);
	}

	private async formatSceneNote(sceneKey: string, structuralEpoch: number, path: string, command: BaseHalfMarkdownFormatCommand): Promise<void> {
		const folder = this.getCurrentFolder();
		const item = this.renderedItemsByPath.get(path);
		if (!folder || !item || !isBaseHalfMarkdownResource(item.stat.resource)
			|| this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const resourceKey = this.uriIdentityService.extUri.getComparisonKey(item.stat.resource);
		const completePreview = this.renderedCardPreviewsByPath.get(path)?.preview.kind === 'markdown';
		if (baseHalfCanvasMarkdownEditTarget(item.stat.size, completePreview) === 'richDetail') {
			const pendingRich = this.queueMarkdownRichFormatCommand(resourceKey, command);
			await this.openSceneCard(sceneKey, structuralEpoch, path);
			const detail = this.canvasNavigationService.state.cardDetail;
			if (!detail || this.uriIdentityService.extUri.getComparisonKey(detail.resource) !== resourceKey) {
				this.discardMarkdownRichFormatCommand(pendingRich);
			}
			return;
		}
		const pending: IBaseHalfPendingCanvasNoteFormatCommand = {
			sceneKey,
			path,
			resourceKey,
			command,
			completion: new DeferredPromise<boolean>(),
			cancelled: false,
			running: false
		};
		this.pendingCanvasNoteFormatCommands.push(pending);
		// Attach the consumer before opening the editor: loading can fail while a
		// previous author is still closing, and every accepted intent must settle.
		void pending.completion.p.catch(() => undefined);
		const active = this.activeCanvasNoteEditor;
		const navigationGuard = !active
			? this.ensureCanvasNoteFormatNavigationGuard(sceneKey, path, resourceKey, item.stat.resource, folder.workspaceFolder, pending)
			: undefined;
		try {
			if (active && !active.closing && this.canvasNoteFormatCommandMatchesActive(pending, active)) {
				pending.active = active;
				void this.runPendingCanvasNoteFormatCommands(active);
			} else {
				await this.beginSceneNoteEdit(sceneKey, structuralEpoch, path, undefined, { sceneKey, path, resourceKey });
				const opened = this.activeCanvasNoteEditor;
				if (opened && !opened.closing && this.canvasNoteFormatCommandMatchesActive(pending, opened)) {
					void this.runPendingCanvasNoteFormatCommands(opened);
				} else if (this.canvasNoteSurfacePath !== path) {
					this.cancelPendingCanvasNoteFormatCommand(pending);
				}
			}
			await pending.completion.p;
		} finally {
			if (navigationGuard) {
				this.releaseCanvasNoteFormatNavigationGuard(navigationGuard);
			}
		}
	}

	private queueMarkdownRichFormatCommand(
		resourceKey: string,
		command: BaseHalfMarkdownFormatCommand
	): IBaseHalfPendingMarkdownRichFormatCommand {
		const pending = { resourceKey, command };
		this.pendingMarkdownRichFormatCommands.push(pending);
		return pending;
	}

	private discardMarkdownRichFormatCommand(pending: IBaseHalfPendingMarkdownRichFormatCommand): void {
		const index = this.pendingMarkdownRichFormatCommands.indexOf(pending);
		if (index >= 0) {
			this.pendingMarkdownRichFormatCommands.splice(index, 1);
		}
	}

	private takeMarkdownRichFormatCommands(resource: URI): readonly BaseHalfMarkdownFormatCommand[] {
		const resourceKey = this.uriIdentityService.extUri.getComparisonKey(resource);
		const commands: BaseHalfMarkdownFormatCommand[] = [];
		for (let index = this.pendingMarkdownRichFormatCommands.length - 1; index >= 0; index--) {
			const pending = this.pendingMarkdownRichFormatCommands[index];
			if (pending.resourceKey !== resourceKey) {
				continue;
			}
			commands.unshift(pending.command);
			this.pendingMarkdownRichFormatCommands.splice(index, 1);
		}
		return commands;
	}

	private async copySceneNote(sceneKey: string, structuralEpoch: number, path: string): Promise<void> {
		const folder = this.getCurrentFolder();
		const item = this.renderedItemsByPath.get(path);
		if (!folder || !item || !isBaseHalfMarkdownResource(item.stat.resource)
			|| this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const active = this.activeCanvasNoteEditor;
		if (active?.path === path && this.uriIdentityService.extUri.isEqual(active.state.resource, item.stat.resource)) {
			await active.open;
			await active.instance.copyDocument();
			return;
		}
		const textFileModel = this.textFileService.files.get(item.stat.resource);
		if (textFileModel?.isResolved()) {
			await this.clipboardService.writeText(textFileModel.textEditorModel.getValue());
			return;
		}
		const content = await this.fileService.readFile(item.stat.resource, { atomic: true });
		await this.clipboardService.writeText(content.value.toString());
	}

	private async setSceneNoteBackground(
		sceneKey: string,
		structuralEpoch: number,
		path: string,
		background: BaseHalfCanvasNoteBackground
	): Promise<void> {
		const folder = this.getCurrentFolder();
		const item = this.renderedItemsByPath.get(path);
		if (!folder || !item || !isBaseHalfMarkdownResource(item.stat.resource)
			|| this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		await this.canvasAppearanceService.setBackground(folder.workspaceFolder, path, background);
		const currentFolder = this.getCurrentFolder();
		const currentItem = this.renderedItemsByPath.get(path);
		if (!currentFolder || !currentItem || this.sceneKey(currentFolder) !== sceneKey
			|| !this.uriIdentityService.extUri.isEqual(currentItem.stat.resource, item.stat.resource)) {
			return;
		}
		const next = new Map(this.renderedNoteBackgrounds);
		if (background === 'default') {
			next.delete(path);
		} else {
			next.set(path, background);
		}
		this.renderedNoteBackgrounds = next;
		const card = this.renderedCardElementsByPath.get(path);
		if (card) {
			this.applyNoteBackground(card, background);
		}
	}

	private publishCanvasNoteFormatState(path: string, resource: URI, state: IBaseHalfCanvasNoteFormatState): void {
		this.canvasNoteFormatStates.set(this.uriIdentityService.extUri.getComparisonKey(resource), state);
		const item = this.renderedItemsByPath.get(path);
		if (!item || !this.uriIdentityService.extUri.isEqual(item.stat.resource, resource)) {
			return;
		}
		const card = this.renderedCardElementsByPath.get(path);
		const CustomEventConstructor = card?.ownerDocument.defaultView?.CustomEvent;
		if (card && CustomEventConstructor) {
			card.dispatchEvent(new CustomEventConstructor(BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT, { detail: state }));
		}
	}

	private ensureCanvasNoteFormatNavigationGuard(
		sceneKey: string,
		path: string,
		resourceKey: string,
		resource: URI,
		workspaceFolder: URI,
		pending: IBaseHalfPendingCanvasNoteFormatCommand
	): IBaseHalfPendingCanvasNoteNavigationGuard {
		const completion = pending.completion.p.catch(() => false);
		const owner = { sceneKey, path, resourceKey };
		const existing = this.pendingCanvasNoteNavigationGuard;
		if (existing) {
			if (!existing.ownership.accept(owner, pending, completion)) {
				const error = new Error(localize(
					'basehalf.canvas.note.formatOwnerBusy',
					"Another Note formatting action is still starting. Try again after it finishes."
				));
				this.failPendingCanvasNoteFormatCommand(pending, error);
				throw error;
			}
			pending.navigationGuard = existing;
			return existing;
		}
		const ownership = new BaseHalfCanvasNoteFormatNavigationOwnership<IBaseHalfPendingCanvasNoteFormatCommand>(owner);
		ownership.accept(owner, pending, completion);
		const editor: IBaseHalfActiveCanvasEditor = {
			resource,
			workspaceFolder,
			relativePath: path,
			supportsCanvasProjectionHandoff: false,
			prepareToClose: () => {
				if (!guard.closing) {
					guard.closing = this.prepareCanvasNoteFormatNavigationGuard(guard);
				}
				return guard.closing;
			}
		};
		const guard: IBaseHalfPendingCanvasNoteNavigationGuard = { ownership, editor };
		pending.navigationGuard = guard;
		this.pendingCanvasNoteNavigationGuard = guard;
		if (!this.canvasNavigationService.activeCanvasEditor) {
			this.canvasNavigationService.setActiveCanvasEditor(editor);
		}
		return guard;
	}

	private async prepareCanvasNoteFormatNavigationGuard(guard: IBaseHalfPendingCanvasNoteNavigationGuard): Promise<boolean> {
		const applied = await this.waitForCanvasNoteFormatNavigationGuard(guard);
		if (!applied) {
			this.releaseCanvasNoteFormatNavigationGuard(guard, true);
			return false;
		}
		if (!this.activeCanvasNoteEditor
			|| this.canvasNavigationService.activeCanvasEditor === guard.editor) {
			this.releaseCanvasNoteFormatNavigationGuard(guard, true);
			return false;
		}
		this.releaseCanvasNoteFormatNavigationGuard(guard, true);
		return true;
	}

	private async waitForCanvasNoteFormatNavigationGuard(guard: IBaseHalfPendingCanvasNoteNavigationGuard): Promise<boolean> {
		return guard.ownership.wait();
	}

	private releaseCanvasNoteFormatNavigationGuard(
		guard: IBaseHalfPendingCanvasNoteNavigationGuard,
		force = false
	): void {
		if (this.pendingCanvasNoteNavigationGuard !== guard
			|| (!force && guard.ownership.hasPending)) {
			return;
		}
		this.pendingCanvasNoteNavigationGuard = undefined;
		if (this.canvasNavigationService.activeCanvasEditor === guard.editor) {
			this.canvasNavigationService.setActiveCanvasEditor(undefined);
		}
	}

	private canvasNoteFormatCommandMatchesActive(
		pending: IBaseHalfPendingCanvasNoteFormatCommand,
		active: IBaseHalfActiveCanvasNoteEditor
	): boolean {
		return pending.sceneKey === active.sceneKey
			&& pending.path === active.path
			&& pending.resourceKey === active.resourceKey;
	}

	private canvasNoteFormatCommandOwnedByActive(
		pending: IBaseHalfPendingCanvasNoteFormatCommand,
		active: IBaseHalfActiveCanvasNoteEditor
	): boolean {
		return pending.active === active && this.canvasNoteFormatCommandMatchesActive(pending, active);
	}

	private isCanvasNoteFormatCommandCurrent(
		pending: IBaseHalfPendingCanvasNoteFormatCommand,
		active: IBaseHalfActiveCanvasNoteEditor
	): boolean {
		if (this.disposed || this.activeCanvasNoteEditor !== active || active.closing
			|| !this.canvasNoteFormatCommandOwnedByActive(pending, active)) {
			return false;
		}
		const folder = this.getCurrentFolder();
		const item = this.renderedItemsByPath.get(pending.path);
		return !!folder
			&& this.sceneKey(folder) === pending.sceneKey
			&& !!item
			&& isBaseHalfMarkdownResource(item.stat.resource)
			&& this.uriIdentityService.extUri.getComparisonKey(item.stat.resource) === pending.resourceKey;
	}

	private removePendingCanvasNoteFormatCommand(pending: IBaseHalfPendingCanvasNoteFormatCommand): void {
		const index = this.pendingCanvasNoteFormatCommands.indexOf(pending);
		if (index >= 0) {
			this.pendingCanvasNoteFormatCommands.splice(index, 1);
		}
	}

	private completePendingCanvasNoteFormatCommand(pending: IBaseHalfPendingCanvasNoteFormatCommand): void {
		this.removePendingCanvasNoteFormatCommand(pending);
		void pending.completion.complete(true);
		this.settlePendingCanvasNoteFormatNavigationGuard(pending);
	}

	private failPendingCanvasNoteFormatCommand(pending: IBaseHalfPendingCanvasNoteFormatCommand, error: unknown): void {
		this.removePendingCanvasNoteFormatCommand(pending);
		void pending.completion.error(error);
		this.settlePendingCanvasNoteFormatNavigationGuard(pending);
	}

	private cancelPendingCanvasNoteFormatCommand(pending: IBaseHalfPendingCanvasNoteFormatCommand): void {
		pending.cancelled = true;
		if (pending.running) {
			return;
		}
		this.removePendingCanvasNoteFormatCommand(pending);
		void pending.completion.complete(false);
		this.settlePendingCanvasNoteFormatNavigationGuard(pending);
	}

	private settlePendingCanvasNoteFormatNavigationGuard(pending: IBaseHalfPendingCanvasNoteFormatCommand): void {
		const guard = pending.navigationGuard;
		if (!guard) {
			return;
		}
		pending.navigationGuard = undefined;
		guard.ownership.settle(pending);
		this.releaseCanvasNoteFormatNavigationGuard(guard);
	}

	private cancelPendingCanvasNoteFormatCommands(
		predicate: (pending: IBaseHalfPendingCanvasNoteFormatCommand) => boolean = () => true
	): void {
		for (const pending of [...this.pendingCanvasNoteFormatCommands]) {
			if (predicate(pending)) {
				this.cancelPendingCanvasNoteFormatCommand(pending);
			}
		}
	}

	private deferPendingCanvasSelectionUntilCanvasNoteFormatsSettle(
		sceneKey: string,
		path: string,
		resourceKey: string
	): void {
		const owner = baseHalfCanvasNoteFormatOwnerKey({ sceneKey, path, resourceKey });
		this.pendingCanvasSelectionFormatBarrier.defer(
			owner,
			() => this.waitForCanvasNoteFormatCommands(sceneKey, path, resourceKey),
			applied => {
				if (!applied) {
					const pendingSelection = this.pendingCanvasSelection;
					if (pendingSelection?.sceneKey === sceneKey
						&& this.canvasNoteSurfacePath === path
						&& !(pendingSelection.paths.length === 1 && pendingSelection.paths[0] === path)) {
						this.pendingCanvasSelection = undefined;
					}
				}
				if (!this.disposed) {
					this.requestRender();
				}
			}
		);
	}

	private async waitForCanvasNoteFormatCommands(
		sceneKey: string,
		path: string,
		resourceKey: string
	): Promise<boolean> {
		let applied = true;
		while (true) {
			const pending = this.pendingCanvasNoteFormatCommands.filter(candidate => candidate.sceneKey === sceneKey
				&& candidate.path === path
				&& candidate.resourceKey === resourceKey);
			if (pending.length === 0) {
				return applied;
			}
			const outcomes = await Promise.all(pending.map(candidate => candidate.completion.p.catch(() => false)));
			applied = outcomes.every(Boolean) && applied;
		}
	}

	private async drainActiveCanvasNoteFormatCommands(active: IBaseHalfActiveCanvasNoteEditor): Promise<boolean> {
		let applied = true;
		for (const pending of this.pendingCanvasNoteFormatCommands) {
			if (!pending.active && this.canvasNoteFormatCommandMatchesActive(pending, active)) {
				pending.active = active;
			}
		}
		if (this.pendingCanvasNoteFormatCommands.some(pending => this.canvasNoteFormatCommandOwnedByActive(pending, active))) {
			void this.runPendingCanvasNoteFormatCommands(active);
		}
		while (true) {
			const pending = this.pendingCanvasNoteFormatCommands.filter(candidate => this.canvasNoteFormatCommandMatchesActive(candidate, active));
			if (pending.length === 0) {
				return applied;
			}
			const outcomes = await Promise.all(pending.map(candidate => candidate.completion.p.catch(() => false)));
			applied = outcomes.every(Boolean) && applied;
		}
	}

	private runPendingCanvasNoteFormatCommands(active: IBaseHalfActiveCanvasNoteEditor): Promise<void> {
		const currentDrain = this.pendingCanvasNoteFormatDrain;
		if (currentDrain?.active === active) {
			return currentDrain.promise;
		}
		const promise = this.doRunPendingCanvasNoteFormatCommands(active);
		const drain = { active, promise };
		this.pendingCanvasNoteFormatDrain = drain;
		void promise.then(() => {
			if (this.pendingCanvasNoteFormatDrain !== drain) {
				return;
			}
			this.pendingCanvasNoteFormatDrain = undefined;
			if (this.activeCanvasNoteEditor === active
				&& this.pendingCanvasNoteFormatCommands.some(pending => (!pending.active || pending.active === active)
					&& this.canvasNoteFormatCommandMatchesActive(pending, active))) {
				void this.runPendingCanvasNoteFormatCommands(active);
			}
		});
		return promise;
	}

	private async doRunPendingCanvasNoteFormatCommands(active: IBaseHalfActiveCanvasNoteEditor): Promise<void> {
		for (const pending of this.pendingCanvasNoteFormatCommands) {
			if (!pending.active && this.canvasNoteFormatCommandMatchesActive(pending, active)) {
				pending.active = active;
			}
		}
		try {
			await active.open;
		} catch {
			this.cancelPendingCanvasNoteFormatCommands(pending => this.canvasNoteFormatCommandOwnedByActive(pending, active));
			return;
		}
		while (true) {
			const pending = this.pendingCanvasNoteFormatCommands.find(candidate => !candidate.running
				&& this.canvasNoteFormatCommandOwnedByActive(candidate, active));
			if (!pending) {
				return;
			}
			if (!this.isCanvasNoteFormatCommandCurrent(pending, active)) {
				this.cancelPendingCanvasNoteFormatCommand(pending);
				continue;
			}
			pending.running = true;
			try {
				const handled = await active.instance.runFormatCommand(pending.command);
				switch (baseHalfCanvasNoteFormatCommandOutcome(pending.cancelled, handled)) {
					case 'applied':
						this.completePendingCanvasNoteFormatCommand(pending);
						break;
					case 'cancelled':
						this.cancelPendingCanvasNoteFormatCommand(pending);
						break;
					case 'rejected':
						this.failPendingCanvasNoteFormatCommand(
							pending,
							new Error(localize('basehalf.canvas.note.formatNotApplied', "The formatting action could not be applied."))
						);
						break;
				}
			} catch (error) {
				if (pending.cancelled) {
					this.cancelPendingCanvasNoteFormatCommand(pending);
				} else {
					this.failPendingCanvasNoteFormatCommand(pending, error);
				}
			} finally {
				pending.running = false;
				if (pending.cancelled && !pending.completion.isSettled) {
					this.cancelPendingCanvasNoteFormatCommand(pending);
				}
			}
		}
	}

	private releaseCanvasNoteFocusIntent(intent: IBaseHalfPendingCanvasNoteFocus | undefined): void {
		if (intent?.focus) {
			this.canvasNoteFocusLeaseOwner.release(intent.lease);
		}
	}

	private clearPendingCanvasNoteFocus(path: string): void {
		const pending = this.pendingCanvasNoteFocus;
		if (pending?.path !== path) {
			return;
		}
		this.pendingCanvasNoteFocus = undefined;
		this.releaseCanvasNoteFocusIntent(pending);
	}

	private captureCanvasPostCreateOwner(): IBaseHalfCanvasPostCreateOwner {
		return {
			interactionEpoch: this.canvasInteractionEpoch,
			navigationEpoch: this.canvasNavigationEpoch,
			navigationState: this.canvasNavigationService.state
		};
	}

	private isCanvasPostCreateOwnerCurrent(owner: IBaseHalfCanvasPostCreateOwner): boolean {
		return baseHalfCanvasPostCreateOwnerIsCurrent(
			owner,
			this.canvasInteractionEpoch,
			this.canvasNavigationEpoch,
			this.canvasNavigationService.state
		);
	}

	private markCanvasUserInteraction(): void {
		this.canvasInteractionEpoch++;
		this.canvasEditingService.invalidatePostCreateIntents();
		this.cancelPendingCreatedCanvasNoteActivation();
		this.pendingCanvasSelection = undefined;
		this.pendingCanvasFit = undefined;
		const promotedFocus = this.pendingCanvasNoteFocus;
		let clearedPromotedSurface = false;
		if (promotedFocus?.createOwner) {
			const path = promotedFocus.path;
			this.clearPendingCanvasNoteFocus(path);
			if (!this.activeCanvasNoteEditor && this.canvasNoteSurfacePath === path) {
				this.canvasNoteSurfacePath = undefined;
				clearedPromotedSurface = true;
			}
		}
		if (clearedPromotedSurface) {
			this.requestRender();
		}
	}

	private onDocumentUserInteraction(event: Event): void {
		if (!event.isTrusted) {
			return;
		}
		const targetPath = isHTMLElement(event.target)
			? event.target.closest<HTMLElement>('.basehalf-canvas-card')?.dataset.basehalfCardPath
			: undefined;
		const expected = this.currentPostCreateSelectionPaths();
		if (targetPath && expected?.length === 1 && expected[0] === targetPath) {
			return;
		}
		this.markCanvasUserInteraction();
	}

	private currentPostCreateSelectionPaths(): readonly string[] | undefined {
		const pendingCreated = this.pendingCreatedCanvasNoteActivation;
		const promotedFocus = this.pendingCanvasNoteFocus;
		const activeFocus = this.activeCanvasNoteEditor?.focusIntent;
		return pendingCreated && this.isCanvasPostCreateOwnerCurrent(pendingCreated.owner)
			? [pendingCreated.path]
			: promotedFocus?.createOwner && this.isCanvasPostCreateOwnerCurrent(promotedFocus.createOwner)
				? [promotedFocus.path]
				: activeFocus?.createOwner && this.isCanvasPostCreateOwnerCurrent(activeFocus.createOwner)
					? [this.activeCanvasNoteEditor!.path]
					: this.pendingCanvasSelection && this.isCanvasPostCreateOwnerCurrent(this.pendingCanvasSelection.owner)
						? this.pendingCanvasSelection.paths
						: undefined;
	}

	private canvasSelectionSupersedesPostCreate(paths: readonly string[]): boolean {
		const expected = this.currentPostCreateSelectionPaths();
		return expected !== undefined && (
			expected.length !== paths.length
			|| expected.some(path => !paths.includes(path))
		);
	}

	private queueCanvasSelection(
		sceneKey: string,
		paths: readonly string[],
		owner: IBaseHalfCanvasPostCreateOwner = this.captureCanvasPostCreateOwner()
	): boolean {
		if (paths.length === 0 || !this.isCanvasPostCreateOwnerCurrent(owner)) {
			return false;
		}
		this.pendingCanvasSelection = { sceneKey, paths, owner };
		return true;
	}

	private queueCreatedCanvasNoteActivation(
		folder: IBaseHalfCanvasFolderState,
		path: string,
		resource: URI,
		owner: IBaseHalfCanvasPostCreateOwner,
		focus: { readonly focus: true; readonly origin: Element | null; readonly returnPath?: string } | { readonly focus: false },
		fitPaths?: readonly string[]
	): boolean {
		if (!this.isCanvasPostCreateOwnerCurrent(owner)) {
			return false;
		}
		this.cancelPendingCreatedCanvasNoteActivation();
		const base = {
			sceneKey: this.sceneKey(folder),
			path,
			resourceKey: this.uriIdentityService.extUri.getComparisonKey(resource),
			owner,
			fitPaths,
			...(fitPaths?.length ? { fitViewportGeneration: this.folderFocusRestoreGeneration } : {})
		};
		this.pendingCreatedCanvasNoteActivation = focus.focus
			? {
				...base,
				focus: true,
				focusOrigin: focus.origin,
				focusReturnPath: focus.returnPath,
				lease: this.canvasNoteFocusLeaseOwner.claim()
			}
			: { ...base, focus: false };
		return true;
	}

	private promotePendingCreatedCanvasNoteActivation(
		sceneKey: string,
		items: readonly IBaseHalfCanvasItem[]
	): void {
		const pending = this.pendingCreatedCanvasNoteActivation;
		if (!pending) {
			return;
		}
		if (pending.sceneKey !== sceneKey || !this.isCanvasPostCreateOwnerCurrent(pending.owner)) {
			this.cancelPendingCreatedCanvasNoteActivation();
			return;
		}
		const item = items.find(candidate => candidate.path === pending.path);
		if (!item) {
			return;
		}
		if (!isBaseHalfMarkdownResource(item.stat.resource)
			|| this.uriIdentityService.extUri.getComparisonKey(item.stat.resource) !== pending.resourceKey) {
			this.cancelPendingCreatedCanvasNoteActivation();
			return;
		}

		this.pendingCreatedCanvasNoteActivation = undefined;
		this.canvasNoteSurfacePath = pending.path;
		this.pendingCanvasNoteFocus = pending.focus
			? {
				path: pending.path,
				focus: true,
				lease: pending.lease,
				createOwner: pending.owner,
				createFocusOrigin: pending.focusOrigin,
				createFocusReturnPath: pending.focusReturnPath
			}
			: { path: pending.path, focus: false, createOwner: pending.owner };
		// A stale render may have observed the pending selection before the file
		// entered its model. Re-publish it at the same fresh identity boundary.
		this.queueCanvasSelection(sceneKey, [pending.path], pending.owner);
		if (pending.fitPaths?.length && pending.fitViewportGeneration !== undefined) {
			this.pendingCanvasFit = {
				sceneKey,
				paths: pending.fitPaths,
				owner: pending.owner,
				viewportGeneration: pending.fitViewportGeneration
			};
		}
	}

	private cancelPendingCreatedCanvasNoteActivation(): void {
		const pending = this.pendingCreatedCanvasNoteActivation;
		if (!pending) {
			return;
		}
		this.pendingCreatedCanvasNoteActivation = undefined;
		if (this.pendingCanvasSelection?.sceneKey === pending.sceneKey
			&& this.pendingCanvasSelection.paths.length === 1
			&& this.pendingCanvasSelection.paths[0] === pending.path) {
			this.pendingCanvasSelection = undefined;
		}
		if (pending.focus) {
			this.canvasNoteFocusLeaseOwner.release(pending.lease);
		}
	}

	private focusCanvasNoteEditorFromIntent(
		active: IBaseHalfActiveCanvasNoteEditor,
		intent: IBaseHalfPendingCanvasNoteFocus | undefined
	): void {
		if (!intent?.focus) {
			return;
		}
		const shouldFocus = this.canvasNoteFocusLeaseOwner.consume(intent.lease, () => {
			if (this.disposed
				|| this.activeCanvasNoteEditor !== active
				|| active.closing
				|| (intent.createOwner !== undefined && !this.isCanvasPostCreateOwnerCurrent(intent.createOwner))
				|| this.canvasNavigationService.state.cardDetail) {
				return false;
			}
			const ownerDocument = active.card.ownerDocument;
			const focused = ownerDocument.activeElement;
			const focusedCardPath = isHTMLElement(focused)
				? focused.closest<HTMLElement>('.basehalf-canvas-card')?.dataset.basehalfCardPath
				: undefined;
			const remainsOwned = ownerDocument.hasFocus()
				&& (focused === ownerDocument.body
					|| focused === active.card
					|| (intent.createFocusOrigin !== undefined && focused === intent.createFocusOrigin)
					|| (intent.createFocusReturnPath !== undefined && focusedCardPath === intent.createFocusReturnPath)
					|| (isHTMLElement(focused) && active.card.contains(focused)));
			return remainsOwned;
		});
		if (shouldFocus) {
			active.instance.focus(intent.point);
		}
	}

	private focusSceneNoteEditor(sceneKey: string, structuralEpoch: number, path: string): void {
		const folder = this.getCurrentFolder();
		const active = this.activeCanvasNoteEditor;
		if (!folder || this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		if (active?.path === path && !active.closing) {
			active.instance.focus();
			return;
		}
		this.renderedCardElementsByPath.get(path)?.focus();
	}

	private async closeActiveCanvasNoteEditorAfterFormats(refreshCanvas = true): Promise<boolean> {
		const accepted = this.activeCanvasNoteEditor;
		if (!accepted) {
			return true;
		}
		return this.closeCanvasNoteEditorAfterFormats(accepted, refreshCanvas);
	}

	private closeCanvasNoteEditorAfterFormats(
		accepted: IBaseHalfActiveCanvasNoteEditor,
		refreshCanvas = true
	): Promise<boolean> {
		return baseHalfCanvasNotePrepareIdentityBoundClose(
			accepted,
			() => this.activeCanvasNoteEditor,
			async () => {
				if (!accepted.closing && !await this.drainActiveCanvasNoteFormatCommands(accepted)) {
					return false;
				}
				if (this.activeCanvasNoteEditor !== accepted) {
					return false;
				}
				const closed = await this.closeActiveCanvasNoteEditor(refreshCanvas);
				return this.activeCanvasNoteEditor && this.activeCanvasNoteEditor !== accepted
					? false
					: closed;
			}
		);
	}

	private async closeActiveCanvasNoteEditor(refreshCanvas = true): Promise<boolean> {
		const active = this.activeCanvasNoteEditor;
		if (!active) {
			return true;
		}
		if (!active.closing) {
			active.closing = active.instance.prepareToClose();
		}
		const closing = active.closing;
		let ok = false;
		try {
			ok = await closing;
		} catch (error) {
			this.logService.error(error);
		}
		if (this.activeCanvasNoteEditor !== active || active.closing !== closing) {
			return ok;
		}
		if (!ok) {
			active.closing = undefined;
			active.instance.focus();
			this.showCanvasNoteSaveWarning(active.path);
			return false;
		}
		this.retireActiveCanvasNoteEditor(active, refreshCanvas);
		return true;
	}

	/**
	 * Refresh the resting projection while the opaque editor still covers it.
	 * Removing the editor then reveals one complete frame instead of exposing
	 * an empty card until the canvas render timer runs.
	 */
	private refreshActiveCanvasNoteFallback(active: IBaseHalfActiveCanvasNoteEditor): void {
		const scrollTop = active.instance.getScrollTop();
		const documentLength = active.instance.getDocumentLength();
		if (documentLength !== undefined && documentLength > BASEHALF_CANVAS_MARKDOWN_INLINE_MAX_BYTES) {
			this.renderActiveCanvasNoteFullEditorFallback(active);
			return;
		}
		const text = active.instance.getDocumentText();
		if (text === undefined) {
			active.fallback.scrollTop = scrollTop;
			return;
		}
		if (!baseHalfCanvasMarkdownSourceFitsInline(text)) {
			this.renderActiveCanvasNoteFullEditorFallback(active);
			return;
		}
		active.fallbackRendering.clear();
		clearNode(active.fallback);
		const preview = { kind: 'markdown', text } as const;
		this.renderStaticMarkdownSource(
			active.fallback,
			active.state.resource,
			baseHalfCanvasMarkdownPreviewSource(preview.text),
			active.fallbackRendering
		);
		const mount = this.canvasNotePreviewMounts.get(active.card);
		if (mount?.fallback === active.fallback) {
			mount.preview = preview;
		}
		const item = this.renderedItemsByPath.get(active.path);
		if (item && this.uriIdentityService.extUri.isEqual(item.stat.resource, active.state.resource)) {
			this.renderedCardPreviewsByPath.set(active.path, { item, preview });
		}
		active.fallback.scrollTop = scrollTop;
	}

	private renderActiveCanvasNoteFullEditorFallback(active: IBaseHalfActiveCanvasNoteEditor): void {
		active.fallbackRendering.clear();
		clearNode(active.fallback);
		const placeholder = append(active.fallback, $('span.basehalf-canvas-note-empty.basehalf-canvas-note-full-editor-required'));
		placeholder.setAttribute('data-testid', 'canvas-note-full-editor-required');
		placeholder.textContent = CANVAS_MARKDOWN_FULL_EDITOR_LABEL;
		active.fallback.scrollTop = 0;
		const richRequiredPreview = { kind: 'richRequired', text: CANVAS_MARKDOWN_FULL_EDITOR_LABEL } as const;
		const mount = this.canvasNotePreviewMounts.get(active.card);
		if (mount?.fallback === active.fallback) {
			mount.preview = richRequiredPreview;
		}

		// The preview cache may still describe the <=8 KiB snapshot from before
		// this edit. Replace it before the inline host is removed so a rapid
		// second double-click cannot re-enter quick edit with stale metadata.
		const item = this.renderedItemsByPath.get(active.path);
		if (item && this.uriIdentityService.extUri.isEqual(item.stat.resource, active.state.resource)) {
			this.renderedCardPreviewsByPath.set(active.path, {
				item,
				preview: richRequiredPreview
			});
		}
	}

	private detachCanvasNoteEditorMount(active: IBaseHalfActiveCanvasNoteEditor): void {
		active.mountDisposables.dispose();
		active.instance.dispose();
		active.host.remove();
		active.fallback.classList.remove('basehalf-canvas-note-editor-fallback');
		active.fallback.removeAttribute('aria-hidden');
		active.fallback.removeAttribute('inert');
		delete active.card.dataset.noteSurface;
		delete active.card.dataset.noteEditing;
		delete active.card.dataset.noteSaveState;
		// Background renders advance cache metadata while the editor deliberately
		// retains its original card DOM. Preserve the fast path when that chrome
		// still matches, but never let a retained header masquerade as a newer one.
		if (active.chromeStale) {
			this.renderedCardsByPath.delete(active.path);
		}
	}

	private failCanvasNoteEditorOpen(active: IBaseHalfActiveCanvasNoteEditor): void {
		if (this.activeCanvasNoteEditor !== active) {
			return;
		}
		this.cancelPendingCanvasNoteFormatCommands(pending => this.canvasNoteFormatCommandMatchesActive(pending, active));
		this.activeCanvasNoteEditor = undefined;
		if (this.canvasNoteSurfacePath === active.path) {
			this.canvasNoteSurfacePath = undefined;
		}
		this.clearPendingCanvasNoteFocus(active.path);
		this.releaseCanvasNoteFocusIntent(active.focusIntent);
		this.canvasNavigationService.setActiveCanvasEditor(undefined);
		this.detachCanvasNoteEditorMount(active);
	}

	private retireActiveCanvasNoteEditor(
		active: IBaseHalfActiveCanvasNoteEditor,
		refreshCanvas: boolean
	): void {
		if (this.activeCanvasNoteEditor !== active) {
			return;
		}
		this.cancelPendingCanvasNoteFormatCommands(pending => this.canvasNoteFormatCommandOwnedByActive(pending, active));
		// Every successful retirement, including a rapid-close waiter that wins
		// the continuation race, must preserve the atomic projection boundary.
		this.refreshActiveCanvasNoteFallback(active);
		const resourceKey = this.uriIdentityService.extUri.getComparisonKey(active.state.resource);
		const selection = active.instance.getSelection();
		if (selection) {
			this.canvasNoteSelections.set(resourceKey, selection);
		}
		const formatState = active.instance.getFormatState();
		if (formatState) {
			this.publishCanvasNoteFormatState(active.path, active.state.resource, { ...formatState, editable: false });
		}
		this.activeCanvasNoteEditor = undefined;
		if (this.canvasNoteSurfacePath === active.path) {
			this.canvasNoteSurfacePath = undefined;
		}
		this.clearPendingCanvasNoteFocus(active.path);
		this.releaseCanvasNoteFocusIntent(active.focusIntent);
		this.canvasNavigationService.setActiveCanvasEditor(undefined);
		this.detachCanvasNoteEditorMount(active);
		if (refreshCanvas) {
			mainWindow.setTimeout(() => {
				if (!this.disposed) {
					this.requestRender();
				}
			}, 0);
		}
	}

	private async openSceneCard(sceneKey: string, structuralEpoch: number, path: string): Promise<void> {
		this.cancelPendingNodeActivation();
		const intent = this.nodeLocalSurfaceIntent;
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const item = this.renderedItemsByPath.get(path);
		if (!item) {
			return;
		}
		this.markCanvasUserInteraction();
		const targetResourceKey = this.uriIdentityService.extUri.getComparisonKey(item.stat.resource);
		if (!await this.waitForCanvasNoteFormatCommands(sceneKey, path, targetResourceKey)) {
			return;
		}
		const folderBeforeClose = this.getCurrentFolder();
		const itemBeforeClose = this.renderedItemsByPath.get(path);
		if (!folderBeforeClose || this.sceneKey(folderBeforeClose) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folderBeforeClose.workspaceFolder, this.sceneMutationStamp(folderBeforeClose, structuralEpoch))
			|| !itemBeforeClose
			|| this.uriIdentityService.extUri.getComparisonKey(itemBeforeClose.stat.resource) !== targetResourceKey) {
			return;
		}
		if (!await this.closeActiveCanvasNoteEditorAfterFormats(false)) {
			return;
		}
		const currentFolder = this.getCurrentFolder();
		const currentItem = this.renderedItemsByPath.get(path);
		const currentStampValid = !!currentFolder
			&& this.sceneKey(currentFolder) === sceneKey
			&& this.workspaceMutationCoordinator.isStampCurrent(currentFolder.workspaceFolder, this.sceneMutationStamp(currentFolder, structuralEpoch));
		if (this.nodeLocalSurfaceIntent !== intent
			|| !currentStampValid
			|| !currentItem
			|| !this.uriIdentityService.extUri.isEqual(currentItem.stat.resource, item.stat.resource)) {
			return;
		}
		if (currentItem.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			const anchor = this.renderedCardElementsByPath.get(currentItem.path);
			if (anchor) {
				void this.openResultNodeContent(currentFolder, currentItem, anchor);
			}
			return;
		}
		if (currentItem.stat.isDirectory) {
			await this.canvasNavigationService.openFolderCanvas(currentItem.stat.resource, { source: 'api' });
		} else {
			await this.canvasNavigationService.openCardDetail(currentItem.stat.resource, {
				source: 'api',
				pinned: true,
				...(isBaseHalfMarkdownResource(currentItem.stat.resource) ? { projection: 'rich' as const } : {})
			});
		}
	}

	private cancelPendingNodeActivation(): void {
		this.nodeLocalSurfaceIntent++;
	}

	private async openResultNodeFromActionContext(context: IBaseHalfCanvasActionContext): Promise<void> {
		await this.canvasActionContextService.assertCurrent(context);
		const folder = this.getCurrentFolder();
		const item = this.renderedItemsByPath.get(context.relativePath);
		const anchor = item ? this.renderedCardElementsByPath.get(item.path) : undefined;
		if (!folder || !item || !anchor
			|| !this.uriIdentityService.extUri.isEqual(folder.workspaceFolder, context.workspaceFolder)
			|| !this.uriIdentityService.extUri.isEqual(item.stat.resource, context.resource)
			|| !item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			throw new Error('The result node is no longer available on the current canvas.');
		}
		this.markCanvasUserInteraction();
		this.cancelPendingNodeActivation();
		await this.openResultNodeContent(folder, item, anchor);
	}

	private async openResultNodeContent(
		folder: IBaseHalfCanvasFolderState,
		item: IBaseHalfCanvasItem,
		anchor: HTMLElement
	): Promise<void> {
		try {
			const content = await this.fileService.readFile(item.stat.resource, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			const document = this.nodeExecutionService.getActiveRun(item.stat.resource)
				? parseBaseHalfNodeDocumentBytesForActiveHost(content.value.buffer)
				: parseBaseHalfNodeDocumentBytes(content.value.buffer);
			const artifact = getBaseHalfNodeResultArtifact(document);
			if (!artifact) {
				await this.showNodeLocalSurface(item, anchor);
				return;
			}
			const integrity = await this.nodeExecutionService.getArtifactIntegrity(folder.workspaceFolder, artifact, { fresh: true });
			if (integrity !== 'available') {
				this.queueCanvasWarning(getBaseHalfNodeResultArtifactOpenProblem(artifact.path, integrity) ?? 'The sealed Result cannot be opened.');
				this.requestRender();
				await this.showNodeLocalSurface(item, anchor);
				return;
			}
			await this.openNodeArtifactPath(folder, artifact.path);
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
			await this.showNodeLocalSurface(item, anchor);
		}
	}

	private async invokeSceneVideoAction(
		sceneKey: string,
		structuralEpoch: number,
		path: string,
		action: BaseHalfCanvasSceneVideoAction,
		anchor: HTMLElement
	): Promise<void> {
		const frozenMoreAnchor = action === 'more'
			? (() => {
				const rect = anchor.getBoundingClientRect();
				return { x: rect.left + rect.width / 2, y: rect.bottom };
			})()
			: undefined;
		if (action === 'more') {
			if (this.activeNodeLocalSurface?.path === path) {
				this.activeNodeLocalSurface.closeTransientOverlay();
			}
			const folder = this.getCurrentFolder();
			const item = this.renderedItemsByPath.get(path);
			const preview = this.renderedCardPreviewsByPath.get(path)?.preview;
			const controls = item ? this.sceneCardControls(item, preview) : undefined;
			if (!folder || this.sceneKey(folder) !== sceneKey
				|| !item
				|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))
				|| controls?.kind !== 'video'
				|| !controls.actions.includes('more')) {
				throw new Error(localize('basehalf.canvas.video.actionUnavailable', "That video action is no longer available."));
			}
			this.markCanvasUserInteraction();
			const request: BaseHalfCanvasSceneContextMenuRequest = {
				kind: 'card',
				path,
				anchor: frozenMoreAnchor ?? { x: 0, y: 0 }
			};
			const context = await this.canvasActionContextService.capture(item.stat.resource, folder.workspaceFolder, item.path);
			const latestFolder = this.getCurrentFolder();
			const latestItem = this.renderedItemsByPath.get(path);
			if (!latestFolder || this.sceneKey(latestFolder) !== sceneKey
				|| !latestItem
				|| !this.workspaceMutationCoordinator.isStampCurrent(latestFolder.workspaceFolder, this.sceneMutationStamp(latestFolder, structuralEpoch))
				|| !this.uriIdentityService.extUri.isEqual(latestItem.stat.resource, item.stat.resource)) {
				throw new Error(localize('basehalf.canvas.video.actionUnavailable', "That video action is no longer available."));
			}
			this.lastCanvasContextMenu = { context, request };
			mainWindow.setTimeout(() => {
				const currentFolder = this.getCurrentFolder();
				if (this.disposed || !currentFolder || this.sceneKey(currentFolder) !== sceneKey
					|| !this.workspaceMutationCoordinator.isStampCurrent(currentFolder.workspaceFolder, this.sceneMutationStamp(currentFolder, structuralEpoch))) {
					return;
				}
				this.contextMenuService.showContextMenu({
					menuId: BASEHALF_CANVAS_CARD_CONTEXT_MENU,
					menuActionOptions: { arg: context },
					getAnchor: () => request.anchor,
					onHide: wasCancelled => {
						if (wasCancelled) {
							this.cards.focus({ preventScroll: true });
						}
					}
				});
			}, 0);
			return;
		}
		const { folder, items } = await this.resolveSceneSelection(sceneKey, structuralEpoch, [path]);
		const item = items[0];
		const preview = this.renderedCardPreviewsByPath.get(path)?.preview;
		const controls = this.sceneCardControls(item, preview);
		if (controls?.kind !== 'video' || !controls.actions.includes(action)) {
			throw new Error(localize('basehalf.canvas.video.actionUnavailable', "That video action is no longer available."));
		}
		this.markCanvasUserInteraction();
		switch (action) {
			case 'importResult':
				if (this.activeNodeLocalSurface?.path === path
					&& !await this.activeNodeLocalSurface.prepareForImport()) {
					return;
				}
				await this.importCanvasNodeResult(item);
				return;
			case 'openFullPreview':
				await this.openResultNodeContent(folder, item, anchor);
				return;
			case 'copySettings':
				await this.copyCanvasNodeSettings(item);
				return;
			case 'showDetails':
				await this.showNodeLocalSurface(item, anchor);
				if (this.activeNodeLocalSurface?.path === path) {
					await this.activeNodeLocalSurface.showVideoDetails();
				}
				return;
		}
	}

	private async performSceneSelectionAction(
		sceneKey: string,
		structuralEpoch: number,
		action: BaseHalfCanvasSceneSelectionAction,
		paths: readonly string[]
	): Promise<void> {
		const uniquePaths = [...new Set(paths)];
		if (uniquePaths.length === 0) {
			return;
		}
		const duplicateOwner = action === 'duplicate'
			? (() => {
				this.markCanvasUserInteraction();
				return this.captureCanvasPostCreateOwner();
			})()
			: undefined;
		const { folder, items } = await this.resolveSceneSelection(sceneKey, structuralEpoch, uniquePaths);
		if (action !== 'duplicate') {
			this.markCanvasUserInteraction();
		}
		if (action === 'copyReferences') {
			if (items.length < 2) {
				return;
			}
			await this.clipboardService.writeText(items.map(item => item.path).join('\n'));
			return;
		}
		this.cancelPendingNodeActivation();
		if (this.activeNodeLocalSurface && !await this.activeNodeLocalSurface.closeForSwitch()) {
			return;
		}
		if (action === 'rename') {
			if (items.length !== 1) {
				return;
			}
			const context = await this.canvasActionContextService.capture(items[0].stat.resource, folder.workspaceFolder, items[0].path);
			await this.canvasActionContextService.assertCurrent(context);
			await this.canvasEditingService.requestRename(context);
			return;
		}
		if (action === 'duplicate') {
			const hadActiveNote = !!this.activeCanvasNoteEditor;
			if (hadActiveNote && !await this.closeActiveCanvasNoteEditorAfterFormats(false)) {
				return;
			}
			if (hadActiveNote) {
				this.canvasScene.select({ cardPaths: [] });
			}
			await this.duplicateSceneSelection(sceneKey, structuralEpoch, folder, items, duplicateOwner!);
			return;
		}
		await this.deleteSceneSelection(sceneKey, structuralEpoch, folder, items);
	}

	private async resolveSceneSelection(
		sceneKey: string,
		structuralEpoch: number,
		paths: readonly string[]
	): Promise<{ readonly folder: IBaseHalfCanvasFolderState; readonly items: readonly IBaseHalfCanvasItem[] }> {
		const folder = this.folderForSceneMutation(sceneKey);
		if (!this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			throw new Error('The canvas changed before the selection action could be applied.');
		}
		const items = paths.map(path => this.renderedItemsByPath.get(path));
		if (items.some(item => !item)) {
			throw new Error('One or more selected cards are no longer available.');
		}
		const liveItems = items as IBaseHalfCanvasItem[];
		await this.resolveLiveCanvasNodes(sceneKey, folder, liveItems.map(item => ({ path: item.path, kind: item.kind })));
		return { folder, items: Object.freeze(liveItems) };
	}

	private async duplicateSceneSelection(
		sceneKey: string,
		structuralEpoch: number,
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
		postCreateOwner: IBaseHalfCanvasPostCreateOwner
	): Promise<void> {
		const configuredNaming = this.configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
		const naming = configuredNaming === 'disabled' ? 'smart' : configuredNaming;
		const reserved = new Set<string>();
		const copies: { readonly item: IBaseHalfCanvasItem; readonly target: URI }[] = [];
		for (const item of items) {
			let target = await findValidPasteFileTargetForResource(
				this.fileService,
				this.dialogService,
				folder.resource,
				{ resource: item.stat.resource, isDirectory: item.kind === 'folder', allowOverwrite: false },
				naming
			);
			if (!target) {
				return;
			}
			let targetKey = this.uriIdentityService.extUri.getComparisonKey(target);
			while (reserved.has(targetKey) || await this.fileService.exists(target)) {
				target = joinPath(folder.resource, incrementFileName(basename(target), item.kind === 'folder', naming));
				targetKey = this.uriIdentityService.extUri.getComparisonKey(target);
			}
			reserved.add(targetKey);
			copies.push({ item, target });
		}

		await this.resolveSceneSelection(sceneKey, structuralEpoch, items.map(item => item.path));
		await this.explorerService.applyBulkEdit(copies.map(copy => new ResourceFileEdit(copy.item.stat.resource, copy.target, {
			copy: true,
			overwrite: false
		})), {
			undoLabel: copies.length === 1
				? localize('basehalf.canvas.duplicate.undoOne', "Duplicate {0}", basename(copies[0].target))
				: localize('basehalf.canvas.duplicate.undoMany', "Duplicate {0} items", copies.length),
			progressLabel: copies.length === 1
				? localize('basehalf.canvas.duplicate.progressOne', "Duplicating {0}", items[0].name)
				: localize('basehalf.canvas.duplicate.progressMany', "Duplicating {0} items", copies.length),
			confirmBeforeUndo: this.confirmExplorerUndo()
		});
		const paths = copies.map(copy => canvasChildPath(folder.relativePath, basename(copy.target)));
		this.queueCanvasSelection(sceneKey, paths, postCreateOwner);
		this.requestRender();
	}

	private async deleteSceneSelection(
		sceneKey: string,
		structuralEpoch: number,
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[]
	): Promise<void> {
		const useTrash = this.configurationService.getValue<boolean>('files.enableTrash')
			&& items.every(item => this.fileService.hasCapability(item.stat.resource, FileSystemProviderCapabilities.Trash));
		const names = items.map(item => item.name);
		const selectionLabel = items.length === 1
			? localize('basehalf.canvas.selection.deleteOne.label', "'{0}'", names[0])
			: localize('basehalf.canvas.selection.deleteMany.label', "{0} selected items", items.length);
		const scopeDetail = items.some(item => item.kind === 'folder')
			? localize('basehalf.canvas.selection.deleteFolder.scope', "The selected cards and their context connections will be removed. Selected folders include all their contents. Other project files are not removed.")
			: localize('basehalf.canvas.selection.deleteFile.scope', "The selected cards and their context connections will be removed. Other project files are not removed.");
		const recoveryDetail = useTrash
			? localize('basehalf.canvas.selection.deleteTrash.recovery', "You can restore the selected items from the Trash.")
			: localize('basehalf.canvas.selection.deletePermanent.recovery', "This action cannot be undone from the Trash.");
		const confirmation = await this.dialogService.confirm({
			type: 'warning',
			message: useTrash
				? localize('basehalf.canvas.selection.deleteTrash.message', "Move {0} to the Trash?", selectionLabel)
				: localize('basehalf.canvas.selection.deletePermanent.message', "Permanently delete {0}?", selectionLabel),
			detail: items.length === 1
				? `${scopeDetail} ${recoveryDetail}`
				: `${names.slice(0, 12).join('\n')}${names.length > 12 ? localize('basehalf.canvas.selection.delete.more', "\n+{0} more", names.length - 12) : ''}\n\n${scopeDetail} ${recoveryDetail}`,
			primaryButton: useTrash
				? localize('basehalf.canvas.selection.deleteTrash.primary', "&&Move to Trash")
				: localize('basehalf.canvas.selection.deletePermanent.primary', "&&Delete Permanently")
		});
		if (!confirmation.confirmed) {
			return;
		}
		const hadActiveNote = !!this.activeCanvasNoteEditor;
		if (hadActiveNote && !await this.closeActiveCanvasNoteEditorAfterFormats(false)) {
			return;
		}
		if (hadActiveNote) {
			this.canvasScene.select({ cardPaths: [] });
		}
		await this.resolveSceneSelection(sceneKey, structuralEpoch, items.map(item => item.path));
		const apply = (permanently: boolean) => this.canvasResourceDeletionService.delete(items.map(item => ({
			resource: item.stat.resource,
			folder: item.kind === 'folder',
			maxSize: BASEHALF_CANVAS_SELECTION_UNDO_FILE_SIZE
		})), {
			permanently,
			undoLabel: items.length === 1
				? localize('basehalf.canvas.selection.delete.undoOne', "Delete {0}", items[0].name)
				: localize('basehalf.canvas.selection.delete.undoMany', "Delete {0} items", items.length),
			progressLabel: items.length === 1
				? localize('basehalf.canvas.selection.delete.progressOne', "Deleting {0}", items[0].name)
				: localize('basehalf.canvas.selection.delete.progressMany', "Deleting {0} items", items.length),
			confirmBeforeUndo: this.confirmExplorerUndo()
		});

		if (!useTrash) {
			await apply(true);
		} else {
			try {
				await apply(false);
			} catch (error) {
				const fallback = await this.dialogService.confirm({
					type: 'warning',
					message: localize('basehalf.canvas.selection.trashFailed', "The Trash operation failed. Permanently delete {0}?", selectionLabel),
					detail: error instanceof Error ? error.message : String(error),
					primaryButton: localize('basehalf.canvas.selection.deletePermanent.primary', "&&Delete Permanently")
				});
				if (!fallback.confirmed) {
					return;
				}
				await this.resolveSceneSelection(sceneKey, structuralEpoch, items.map(item => item.path));
				await apply(true);
			}
		}
		this.canvasScene.select({ cardPaths: [] });
		this.requestRender();
	}

	private showSceneContextMenu(
		sceneKey: string,
		structuralEpoch: number,
		request: BaseHalfCanvasSceneContextMenuRequest,
		createPosition?: { readonly x: number; readonly y: number }
	): void {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		this.markCanvasUserInteraction();
		this.activeNodeLocalSurface?.closeTransientOverlay();
		if (request.kind === 'edge') {
			mainWindow.setTimeout(() => {
				const current = this.getCurrentFolder();
				const edge = this.renderedSceneEdges.find(candidate => candidate.id === request.edge.id);
				if (this.disposed || !current || this.sceneKey(current) !== sceneKey || !edge
					|| !this.workspaceMutationCoordinator.isStampCurrent(current.workspaceFolder, this.sceneMutationStamp(current, structuralEpoch))) {
					return;
				}
				this.lastCanvasContextMenu = undefined;
				this.contextMenuService.showContextMenu({
					getAnchor: () => request.anchor,
					getActions: () => [toAction({
						id: 'basehalf.canvas.disconnectSelection',
						label: localize('basehalf.canvas.edge.disconnect', "Disconnect"),
						run: () => this.removeEdgeFromScene(sceneKey, structuralEpoch, edge)
					})],
					onHide: wasCancelled => {
						if (wasCancelled) {
							this.cards.focus({ preventScroll: true });
						}
					}
				});
			}, 0);
			return;
		}
		const item = request.kind === 'card' ? this.renderedItemsByPath.get(request.path) : undefined;
		const resource = item?.stat.resource ?? (request.kind === 'pane' ? folder.resource : undefined);
		const relativePath = item?.path ?? folder.relativePath;
		if (!resource) {
			return;
		}

		mainWindow.setTimeout(async () => {
			const current = this.getCurrentFolder();
			if (this.disposed || !current || this.sceneKey(current) !== sceneKey
				|| !this.workspaceMutationCoordinator.isStampCurrent(current.workspaceFolder, this.sceneMutationStamp(current, structuralEpoch))) {
				return;
			}
			let context: IBaseHalfCanvasActionContext;
			try {
				context = await this.canvasActionContextService.capture(resource, folder.workspaceFolder, relativePath);
			} catch (error) {
				this.logService.warn(error);
				return;
			}
			const latest = this.getCurrentFolder();
			if (this.disposed || !latest || this.sceneKey(latest) !== sceneKey
				|| !this.workspaceMutationCoordinator.isStampCurrent(latest.workspaceFolder, this.sceneMutationStamp(latest, structuralEpoch))) {
				return;
			}
			this.lastCanvasContextMenu = { context, request, createPosition };
			const menuId = request.kind === 'card' ? BASEHALF_CANVAS_CARD_CONTEXT_MENU : BASEHALF_CANVAS_PANE_CONTEXT_MENU;
			this.contextMenuService.showContextMenu({
				menuId,
				menuActionOptions: { arg: context },
				getAnchor: () => request.anchor,
				onHide: wasCancelled => {
					if (wasCancelled) {
						this.cards.focus({ preventScroll: true });
					}
				}
			});
		}, 0);
	}

	private showCanvasCreateMenu(anchor: HTMLElement): void {
		const folder = this.getCurrentFolder();
		if (!folder || this.canvasNavigationService.state.cardDetail) {
			return;
		}
		const structuralStamp = this.workspaceMutationCoordinator.capture(folder.workspaceFolder);
		const anchorRect = anchor.getBoundingClientRect();
		const surfaceRect = this.surface.getBoundingClientRect();
		this.showSceneContextMenu(
			this.sceneKey(folder),
			structuralStamp.structuralEpoch,
			{ kind: 'pane', anchor: { x: anchorRect.right, y: anchorRect.bottom } },
			{ x: surfaceRect.left + surfaceRect.width / 2, y: surfaceRect.top + surfaceRect.height / 2 }
		);
	}

	private isCanvasFileDrag(event: DragEvent): boolean {
		return !!event.dataTransfer && [...event.dataTransfer.types].includes('Files');
	}

	private onCanvasFileDragEnter(event: DragEvent): void {
		if (!this.isCanvasFileDrag(event) || this.canvasNavigationService.state.cardDetail) {
			return;
		}
		event.preventDefault();
		this.fileDragDepth++;
		this.root.classList.add('basehalf-canvas-file-dragging');
	}

	private onCanvasFileDragOver(event: DragEvent): void {
		if (!this.isCanvasFileDrag(event) || this.canvasNavigationService.state.cardDetail) {
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
	}

	private onCanvasFileDragLeave(event: DragEvent): void {
		if (!this.isCanvasFileDrag(event)) {
			return;
		}
		this.fileDragDepth = Math.max(0, this.fileDragDepth - 1);
		if (this.fileDragDepth === 0) {
			this.root.classList.remove('basehalf-canvas-file-dragging');
		}
	}

	private async onCanvasFileDrop(event: DragEvent): Promise<void> {
		if (!this.isCanvasFileDrag(event) || !event.dataTransfer || this.canvasNavigationService.state.cardDetail) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.fileDragDepth = 0;
		this.root.classList.remove('basehalf-canvas-file-dragging');
		const resources = [...event.dataTransfer.files]
			.map(file => getPathForFile(file))
			.filter((path): path is string => typeof path === 'string' && path.length > 0)
			.map(path => URI.file(path));
		if (resources.length === 0) {
			return;
		}
		this.markCanvasUserInteraction();
		const postCreateOwner = this.captureCanvasPostCreateOwner();
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		try {
			const context = await this.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
			const canvasPosition = this.canvasScene.screenToCanvasPosition(event.clientX, event.clientY);
			await this.importCanvasResources(folder, context, resources, canvasPosition, 'copy', postCreateOwner);
		} catch (error) {
			this.reportCanvasMutationError(error);
		}
	}

	private onSceneViewport(sceneKey: string, viewport: IBaseHalfCanvasSceneViewport, final: boolean): void {
		if (!this.isCurrentSceneKey(sceneKey)) {
			return;
		}
		this.canvasZoom = viewport.zoom;
		this.updateCanvasZoomChrome();
		if (final) {
			this.scheduleOverscanCardPreviews(viewport);
			const folder = this.getCurrentFolder();
			if (folder) {
				this.scheduleFolderFocusWrite(200, { folder, viewport });
			}
		}
	}

	private scheduleOverscanCardPreviews(viewport: IBaseHalfCanvasSceneViewport): void {
		this.cardPreviewHydrationQueue.resetViewport();
		const width = this.cards.clientWidth / viewport.zoom;
		const height = this.cards.clientHeight / viewport.zoom;
		if (width <= 0 || height <= 0) {
			this.ensureCardPreviewHydrationScheduled();
			return;
		}
		const left = -viewport.x / viewport.zoom;
		const top = -viewport.y / viewport.zoom;
		const overscanX = width * 0.75;
		const overscanY = height * 0.75;
		const right = left + width;
		const bottom = top + height;
		for (const card of this.renderedSceneCards) {
			if (card.x + card.width < left - overscanX
				|| card.x > right + overscanX
				|| card.y + card.height < top - overscanY
				|| card.y > bottom + overscanY) {
				continue;
			}
			this.scheduleCardPreviewHydration(card.path);
		}
		this.ensureCardPreviewHydrationScheduled();
	}

	private isRenderCurrent(seq: number): boolean {
		return !this.disposed && seq === this.renderSeq;
	}

	private isFocusMirrorOnlyChange(event: FileChangesEvent, folder: IBaseHalfCanvasFolderState): boolean {
		// This window writes viewport/cursor focus mirrors at pan/zoom cadence; a full
		// canvas rebuild (folder resolve + preview reads) for those writes causes a
		// visible hitch right after every gesture. Canvas/badge mirror changes and user
		// file changes must still re-render.
		let sawRelevantChange = false;
		const mirrorRoot = baseHalfMirrorRoot(folder.workspaceFolder);
		for (const resource of [...event.rawAdded, ...event.rawUpdated, ...event.rawDeleted]) {
			if (!isEqualOrParent(resource, folder.resource) && !isEqualOrParent(resource, mirrorRoot)) {
				continue;
			}
			sawRelevantChange = true;
			if (!isBaseHalfFocusMirrorResource(resource)) {
				return false;
			}
		}
		return sawRelevantChange;
	}

	private isCurrentCanvasLayoutOnlyChange(event: FileChangesEvent, folder: IBaseHalfCanvasFolderState): boolean {
		const mirrorRoot = baseHalfMirrorRoot(folder.workspaceFolder);
		const canvasResource = this.canvasMirrorService.canvasResource(folder);
		const canvasParent = dirname(canvasResource);
		const canvasName = basename(canvasResource);
		let sawRelevantChange = false;
		for (const resource of [...event.rawAdded, ...event.rawUpdated, ...event.rawDeleted]) {
			if (!isEqualOrParent(resource, folder.resource) && !isEqualOrParent(resource, mirrorRoot)) {
				continue;
			}
			sawRelevantChange = true;
			const isCanvasFile = this.uriIdentityService.extUri.isEqual(resource, canvasResource);
			const isAtomicCanvasTemporary = this.uriIdentityService.extUri.isEqual(dirname(resource), canvasParent)
				&& basename(resource).replace(/^\./, '').startsWith(`${canvasName}.basehalf-tmp`);
			const isCanvasAncestor = isEqualOrParent(canvasResource, resource)
				&& isEqualOrParent(resource, mirrorRoot);
			if (!isCanvasFile && !isAtomicCanvasTemporary && !isCanvasAncestor) {
				return false;
			}
		}
		return sawRelevantChange;
	}

	private reusableCardPreview(item: IBaseHalfCanvasItem): BaseHalfCanvasCardPreview | undefined {
		const cached = this.renderedCardPreviewsByPath.get(item.path);
		if (!cached
			|| cached.preview.kind === 'nodeLoading'
			|| cached.preview.kind === 'unavailable'
			|| !baseHalfCanvasItemsSharePreviewVersion(cached.item, item)) {
			return undefined;
		}
		if (item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)
			&& cached.preview.kind !== 'node'
			&& cached.preview.kind !== 'invalidNode') {
			return undefined;
		}
		// Result nodes are still re-verified after the retained frame is mounted.
		// Keeping this last complete preview avoids replacing a playing video (or
		// another media element) with a loading face during unrelated renders.
		return cached.preview;
	}

	private cardVisualKey(item: IBaseHalfCanvasItem): string {
		const relationships = baseHalfCanvasBadgeRelationships(
			item.path,
			item.badge,
			this.renderedBadges,
			this.renderedBadgeProblems
		);
		const ownProblem = this.renderedBadgeProblems.get(item.path);
		const inlineRename = this.inlineEdit?.kind === 'rename' && this.inlineEdit.path === item.path
			? { value: this.inlineEdit.value, selectionPending: this.inlineEdit.selectionPending }
			: undefined;
		return JSON.stringify({
			badge: item.badge,
			badgeOpen: this.openBadgeFaces.has(item.path),
			inlineRename,
			relationships: {
				references: relationships.references,
				referencedBy: relationships.referencedBy,
				issues: relationships.issues.map(issue => ({
					direction: issue.direction,
					from: issue.from,
					to: issue.to,
					reason: issue.reason,
					problem: issue.problem ? {
						relativePath: issue.problem.relativePath,
						message: issue.problem.message,
						corrupt: issue.problem.corrupt
					} : undefined
				}))
			},
			ownProblem: ownProblem ? {
				relativePath: ownProblem.relativePath,
				message: ownProblem.message,
				corrupt: ownProblem.corrupt
			} : undefined
		});
	}

	private canReuseRenderedCard(
		cached: IBaseHalfCanvasCardRenderCacheEntry | undefined,
		item: IBaseHalfCanvasItem,
		preview: BaseHalfCanvasCardPreview | undefined,
		visualKey: string,
		sceneKey: string
	): cached is IBaseHalfCanvasCardRenderCacheEntry {
		const activeNote = this.activeCanvasNoteEditor;
		if (cached
			&& activeNote?.path === item.path
			&& activeNote.card === cached.element
			&& cached.sceneKey === sceneKey
			&& this.uriIdentityService.extUri.isEqual(activeNote.state.resource, item.stat.resource)
			&& !this.openBadgeFaces.has(item.path)
			&& !(this.inlineEdit?.kind === 'rename' && this.inlineEdit.path === item.path)) {
			// The selected Note owns a live inline editor. Preserve its exact DOM identity
			// across autosave-driven preview refreshes; selection teardown performs a
			// stable flush before the card may return to its static preview.
			return true;
		}
		const retainedNote = cached ? this.canvasNotePreviewMounts.get(cached.element) : undefined;
		const retainedNoteMatches = !!cached
			&& !!retainedNote
			&& cached.sceneKey === sceneKey
			&& cached.visualKey === visualKey
			&& retainedNote.path === item.path
			&& retainedNote.resourceKey === this.uriIdentityService.extUri.getComparisonKey(item.stat.resource)
			&& !this.openBadgeFaces.has(item.path)
			&& !(this.inlineEdit?.kind === 'rename' && this.inlineEdit.path === item.path)
			&& (preview?.kind === 'loading'
				|| ((preview?.kind === 'markdown' || preview?.kind === 'richRequired')
					&& preview.kind === retainedNote.preview.kind
					&& preview.text === retainedNote.preview.text));
		if (retainedNoteMatches) {
			// A Note fallback may already contain the exact saved TextModel snapshot
			// while the file watcher briefly reports loading and then hydrates the
			// same bytes. Reuse that DOM; rebuilding it would expose a second flash
			// after the atomic editor-to-preview handoff.
			return true;
		}
		const resultNode = item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION);
		const previewUnchanged = baseHalfCanvasCardPreviewCanRetainElement(resultNode, cached?.preview, preview);
		// Result nodes are re-verified on every requested render, but an equivalent
		// verified result must retain its media DOM and playback state. Ordinary
		// previews already share their cached object identity.
		return !!cached
			&& cached.sceneKey === sceneKey
			&& !this.openBadgeFaces.has(item.path)
			&& !(this.inlineEdit?.kind === 'rename' && this.inlineEdit.path === item.path)
			&& previewUnchanged
			&& cached.visualKey === visualKey
			&& baseHalfCanvasItemsSharePreviewVersion(cached.item, item);
	}

	private scheduleCanvasLayoutReconciliation(): void {
		if (this.canvasNavigationService.state.cardDetail) {
			// Card detail covers the scene. Closing it always performs a fresh
			// render, so there is no hidden layout work to do here.
			return;
		}
		if (this.canvasScene.isInteracting()) {
			this.canvasLayoutReconcileQueuedBehindGesture = true;
			return;
		}
		const generation = ++this.canvasLayoutReconcileGeneration;
		void this.reconcileCurrentCanvasLayout(generation).then(reconciled => {
			if (!reconciled && !this.disposed) {
				this.requestRender();
			}
		}).catch(error => {
			if (!this.disposed) {
				this.logService.warn(error);
				this.requestRender();
			}
		});
	}

	/**
	 * canvas.yaml owns layout only. Reconcile that projection directly into
	 * React Flow while retaining every authored card HTMLElement and listener.
	 * A full render is reserved for actual item, content, Badge, or node-state
	 * changes; replacing the card DOM after a drag makes its visual state flash.
	 */
	private async reconcileCurrentCanvasLayout(generation: number): Promise<boolean> {
		const folder = this.getCurrentFolder();
		if (!folder || this.canvasNavigationService.state.cardDetail) {
			return true;
		}
		const sceneKey = this.sceneKey(folder);
		const renderSeq = this.renderSeq;
		const structuralStamp = this.workspaceMutationCoordinator.capture(folder.workspaceFolder);
		const stat = await this.fileService.resolve(folder.resource, { resolveMetadata: true });
		const canvas = await this.canvasMirrorService.readCanvas(folder);
		if (this.disposed
			|| this.canvasLayoutReconcileGeneration !== generation
			|| this.renderSeq !== renderSeq
			|| !this.isCurrentSceneKey(sceneKey)
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
			return true;
		}
		if (this.canvasScene.isInteracting()) {
			this.canvasLayoutReconcileQueuedBehindGesture = true;
			return true;
		}

		const model = baseHalfCanvasModelFromStat(stat, {
			rootLevel: folder.relativePath.length === 0,
			folderRelativePath: folder.relativePath,
			canvas,
			badges: this.renderedBadges
		});
		if (model.items.length !== this.renderedItemsByPath.size
			|| model.items.some(item => {
				const rendered = this.renderedItemsByPath.get(item.path);
				return !rendered || !baseHalfCanvasItemsSharePreviewVersion(rendered, item);
			})) {
			return false;
		}

		const currentCards = new Map(this.renderedSceneCards.map(card => [card.path, card]));
		const nextCards: IBaseHalfCanvasSceneCard[] = [];
		for (let index = 0; index < model.items.length; index++) {
			const item = model.items[index];
			const current = currentCards.get(item.path);
			if (!current || current.kind !== item.kind) {
				return false;
			}
			const preview = this.renderedCardPreviewsByPath.get(item.path)?.preview;
			nextCards.push({
				...current,
				...this.cardBoundsForPreview(item, index, model.items.length, preview)
			});
		}
		const nextItems = new Map(model.items.map(item => [item.path, item]));
		const nextEdges: IBaseHalfCanvasSceneEdge[] = [];
		for (const edge of model.edges) {
			const from = nextItems.get(edge.from);
			const to = nextItems.get(edge.to);
			if (!from || !to) {
				return false;
			}
			nextEdges.push({
				...edge,
				id: edgeId(edge.from, edge.to),
				fromKind: from.kind,
				toKind: to.kind
			});
		}

		const previousPreviews = this.renderedCardPreviewsByPath;
		const previousRenderedCards = this.renderedCardsByPath;
		this.renderedItemsByPath = nextItems;
		this.renderedCardPreviewsByPath = new Map(model.items.flatMap(item => {
			const cached = previousPreviews.get(item.path);
			return cached ? [[item.path, { item, preview: cached.preview }] as const] : [];
		}));
		this.renderedCardsByPath = new Map(model.items.flatMap(item => {
			const cached = previousRenderedCards.get(item.path);
			return cached ? [[item.path, { ...cached, item }] as const] : [];
		}));
		this.renderedPathByResourceKey = new Map(model.items.map(item => [
			this.uriIdentityService.extUri.getComparisonKey(item.stat.resource),
			item.path
		]));
		this.renderedSceneCards = Object.freeze(nextCards);
		this.renderedSceneEdges = Object.freeze(nextEdges);
		this.canvasScene.update({
			key: sceneKey,
			structuralEpoch: structuralStamp.structuralEpoch,
			revision: renderSeq,
			cards: nextCards,
			edges: nextEdges
		});
		return true;
	}

	private async readCardPreview(
		item: IBaseHalfCanvasItem,
		modelServices: readonly IBaseHalfModelServiceDescriptor[],
		verifyNodeState: boolean
	): Promise<BaseHalfCanvasCardPreview> {
		if (item.kind === 'folder') {
			let stat: IFileStat;
			try {
				stat = item.stat.children ? item.stat : await this.fileService.resolve(item.stat.resource);
			} catch {
				// External file operations can invalidate a render snapshot between
				// enumeration and preview resolution. The next file event rerenders the
				// canvas without the removed card; avoid surfacing that expected race.
				return { kind: 'unavailable', text: 'Preview unavailable' };
			}
			const children = (stat.children ?? [])
				.filter(child => child.isDirectory || child.isFile)
				.sort((a, b) => {
					if (a.isDirectory !== b.isDirectory) {
						return a.isDirectory ? -1 : 1;
					}
					return basename(a.resource).localeCompare(basename(b.resource));
				});
			return {
				kind: 'folder',
				total: children.length,
				items: children.slice(0, 6).map(child => ({
					name: basename(child.resource),
					kind: child.isDirectory ? 'folder' : 'file'
				}))
			};
		}

		if (item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			try {
				const raw = (await this.fileService.readFile(item.stat.resource, {
					limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
				})).value.buffer;
				const execution = this.nodeExecutionService.getActiveRun(item.stat.resource);
				const document = execution
					? parseBaseHalfNodeDocumentBytesForActiveHost(raw)
					: parseBaseHalfNodeDocumentBytes(raw);
				const folder = this.getCurrentFolder();
				const inbound = folder
					? await this.readNodeInboundSources(folder, item)
					: { sources: Object.freeze([]), problem: 'Open this node in its project before running it.' };
				const inputKinds = baseHalfNodeInboundInputKinds(inbound.sources);
				const directSourceProblems = folder && verifyNodeState
					? await this.readNodeDirectSourceProblems(folder, inbound.sources, document.recipe?.inputBindings)
					: new Map<string, string>();
				const artifact = getBaseHalfNodeResultArtifact(document);
				const previousPreview = this.renderedCardPreviewsByPath.get(item.path)?.preview;
				const previousArtifact = previousPreview?.kind === 'node'
					? getBaseHalfNodeResultArtifact(previousPreview.document)
					: undefined;
				const retainsVerifiedResultPreview = !verifyNodeState
					&& previousPreview?.kind === 'node'
					&& previousPreview.verificationPending !== true
					&& artifact !== undefined
					&& previousArtifact !== undefined
					&& stableStringify(artifact) === stableStringify(previousArtifact);
				// A corrected node stat or another unrelated render must not demote the
				// same sealed artifact to a verification-pending face. Fresh hydration
				// still follows and replaces this retained result if integrity changed.
				const resultPreview = retainsVerifiedResultPreview
					? {
						...(previousPreview.resultMedia ? { resultMedia: previousPreview.resultMedia } : {}),
						...(previousPreview.resultOutputText ? { resultOutputText: previousPreview.resultOutputText } : {}),
						...(previousPreview.resultIntegrity ? { resultIntegrity: previousPreview.resultIntegrity } : {})
					}
					: folder ? await this.readNodeResultPreview(folder, document, verifyNodeState) : {};
				const recipe = document.recipe ? this.canvasRecipeRegistryService.getRecipe(document.recipe.recipeId) : undefined;
				const matchingRecipeCount = this.canvasRecipeRegistryService.getRecipes()
					.filter(candidate => baseHalfCanvasRecipeMatchesNodeKind(candidate, document.kind)).length;
				const videoConfigurationProblem = baseHalfVideoDocumentConfigurationProblem(
					document,
					recipe,
					modelServices,
					baseHalfVideoRegistryForRecipe(this.videoModelCatalogService, recipe),
					inputKinds
				);
				return {
					kind: 'node',
					document,
					...(execution === undefined ? {} : { execution }),
					...(recipe === undefined ? {} : { recipe }),
					...(document.kind === 'video' && recipe?.modelCapability === 'video'
						? { videoConfiguration: videoConfigurationProblem
							? { valid: false as const, problem: videoConfigurationProblem }
							: { valid: true as const } }
						: {}),
					matchingRecipeCount,
					modelServices,
					inputKinds,
					directSourcePaths: Object.freeze(inbound.sources.map(source => source.path)),
					directSourceProblems,
					...(verifyNodeState || retainsVerifiedResultPreview ? {} : { verificationPending: true }),
					...(inbound.problem ? { graphProblem: inbound.problem } : {}),
					dirty: this.workingCopyService.isDirty(item.stat.resource),
					...resultPreview
				};
			} catch (error) {
				const reason = error instanceof BaseHalfNodeDocumentError
					? error.message
					: 'The result node could not be read.';
				return {
					kind: 'invalidNode',
					text: `${reason.slice(0, 240)} Open source to repair it.`
				};
			}
		}

		const media = mediaPreview(item.name);
		if (media) {
			const resource = media.kind === 'pdf' ? item.stat.resource : item.stat.resource.with({
				query: `basehalfCanvasVersion=${item.stat.mtime ?? 0}-${item.stat.size ?? 0}`
			});
			return { kind: 'media', text: media.label, mediaKind: media.kind, resource };
		}

		const kind = markdownPreviewKind(item.name);
		if (kind === 'markdown' && item.stat.size !== undefined && item.stat.size > TEXT_PREVIEW_MAX_BYTES) {
			return { kind: 'richRequired', text: CANVAS_MARKDOWN_FULL_EDITOR_LABEL };
		}
		try {
			// This is an all-or-nothing gate: oversized Markdown files require the
			// full editor; no partial source may masquerade as the stored projection.
			const contents = await this.fileService.readFile(item.stat.resource, {
				limits: { size: TEXT_PREVIEW_MAX_BYTES }
			});
			const raw = contents.value.toString();
			if (raw.includes('\u0000')) {
				return { kind: 'unavailable', text: 'Binary file' };
			}

			const text = kind === 'markdown' ? baseHalfCanvasMarkdownPreviewSource(raw) : cleanCardPreviewText(item.name, raw);
			if (kind === 'markdown') {
				return { kind, text };
			}
			return text ? { kind, text } : { kind: 'empty', text: 'Empty file' };
		} catch (error) {
			if (kind === 'markdown' && error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_TOO_LARGE) {
				return { kind: 'richRequired', text: CANVAS_MARKDOWN_FULL_EDITOR_LABEL };
			}
			return { kind: 'unavailable', text: 'Preview unavailable' };
		}
	}

	private scheduleCardPreviewHydration(path: string, priority = 1): void {
		const current = this.renderedCardPreviewsByPath.get(path)?.preview;
		const resultNode = this.renderedItemsByPath.get(path)?.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) === true;
		if (current?.kind !== 'loading' && current?.kind !== 'nodeLoading' && !resultNode) {
			this.cardPreviewHydrationQueue.delete(path);
			return;
		}
		this.cardPreviewHydrationQueue.enqueue(path, priority === 2 ? 2 : 1);
		this.ensureCardPreviewHydrationScheduled();
	}

	private updateCardPreviewHydrationPresentation(path: string, presentation: BaseHalfCanvasCardPresentation, sceneKey: string): void {
		if (!this.isCurrentSceneKey(sceneKey)) {
			return;
		}
		const current = this.renderedCardPreviewsByPath.get(path)?.preview;
		if (current?.kind !== 'loading' && current?.kind !== 'nodeLoading') {
			if (this.renderedItemsByPath.get(path)?.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) !== true) {
				this.cardPreviewHydrationQueue.delete(path);
			}
			return;
		}
		// A newly created Note can enter its editing projection before the first
		// complete Markdown preview exists. React Flow deliberately presents an
		// editing Note at `preview` level, but its hydration is still interactive
		// work: a trailing viewport reset must not discard the only path that can
		// mount the inline editor.
		if (this.canvasNoteSurfacePath === path) {
			this.cardPreviewHydrationQueue.enqueue(path, 2);
		} else {
			this.cardPreviewHydrationQueue.setPresentation(path, presentation);
		}
		this.ensureCardPreviewHydrationScheduled();
	}

	private ensureCardPreviewHydrationScheduled(): void {
		this.cardPreviewHydrationQueue.prune(path => {
			const preview = this.renderedCardPreviewsByPath.get(path)?.preview;
			return preview?.kind === 'loading'
				|| preview?.kind === 'nodeLoading'
				|| this.renderedItemsByPath.get(path)?.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) === true;
		});
		if (this.cardPreviewHydrationQueue.size === 0
			|| this.cardPreviewHydrationRunning
			|| this.cardPreviewHydrationTimer !== undefined
			|| this.disposed) {
			return;
		}
		this.cardPreviewHydrationTimer = mainWindow.setTimeout(() => {
			this.cardPreviewHydrationTimer = undefined;
			void this.drainCardPreviewHydration();
		}, 0);
	}

	private async drainCardPreviewHydration(): Promise<void> {
		if (this.cardPreviewHydrationRunning || this.disposed) {
			return;
		}
		this.cardPreviewHydrationRunning = true;
		try {
			while (!this.disposed && this.cardPreviewHydrationQueue.size > 0) {
				const folder = this.getCurrentFolder();
				if (!folder || this.canvasNavigationService.state.cardDetail) {
					this.cardPreviewHydrationQueue.clear();
					return;
				}
				const seq = this.renderSeq;
				const sceneKey = this.sceneKey(folder);
				const structuralStamp = this.workspaceMutationCoordinator.capture(folder.workspaceFolder);
				const batch = this.cardPreviewHydrationQueue.take(4, path =>
					this.renderedItemsByPath.get(path)?.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) ? 1 : 0
				);
				if (!batch) {
					return;
				}
				if (batch.sceneKey !== sceneKey || !this.cardPreviewHydrationQueue.isCurrent(batch)) {
					return;
				}
				const items = batch.paths.flatMap(path => {
					const item = this.renderedItemsByPath.get(path);
					const preview = this.renderedCardPreviewsByPath.get(path)?.preview;
					return item && (preview?.kind === 'loading'
						|| preview?.kind === 'nodeLoading'
						|| item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) ? [item] : [];
				});
				if (items.length === 0) {
					continue;
				}
				await this.hydrateCardPreviews(folder, items, structuralStamp, seq, batch);
				if (!this.isRenderCurrent(seq)
					|| !this.isCurrentSceneKey(sceneKey)
					|| !this.cardPreviewHydrationQueue.isCurrent(batch)) {
					return;
				}
			}
		} catch (error) {
			if (!this.disposed) {
				this.logService.warn(error);
			}
		} finally {
			this.cardPreviewHydrationRunning = false;
			this.ensureCardPreviewHydrationScheduled();
		}
	}

	private resolveCardPreviewModelServices(batch: IBaseHalfCanvasPreviewHydrationBatch): Promise<readonly IBaseHalfModelServiceDescriptor[]> {
		if (this.cardPreviewModelServicesGeneration !== batch.generation || !this.cardPreviewModelServicesPromise) {
			this.cardPreviewModelServicesGeneration = batch.generation;
			this.cardPreviewModelServicesPromise = this.modelServiceService.getServices().catch(error => {
				this.logService.warn(error);
				return [];
			});
		}
		return this.cardPreviewModelServicesPromise;
	}

	private async hydrateCardPreviews(
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
		structuralStamp: IBaseHalfWorkspaceMutationStamp,
		seq: number,
		batch: IBaseHalfCanvasPreviewHydrationBatch
	): Promise<void> {
		// Ordinary content must never wait for credential-backed model discovery.
		// New result nodes also get a safe, verification-pending face first. A
		// result node with a complete cached face keeps that face until fresh
		// verification completes, so its media element is never downgraded to a
		// loading or verification-pending frame during unrelated canvas work.
		const initialItems = items.filter(item => {
			const preview = this.renderedCardPreviewsByPath.get(item.path)?.preview;
			return preview?.kind === 'loading' || preview?.kind === 'nodeLoading';
		});
		if (initialItems.length > 0
			&& !await this.hydrateCardPreviewItems(folder, initialItems, [], false, structuralStamp, seq, batch)) {
			return;
		}

		const resultNodes = items.filter(item => item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION));
		if (resultNodes.length === 0) {
			return;
		}

		void this.cardPreviewVerificationQueue.enqueue(async isCurrent => {
			if (!isCurrent()
				|| !this.isRenderCurrent(seq)
				|| !this.isCurrentSceneKey(batch.sceneKey)
				|| !this.cardPreviewHydrationQueue.isCurrent(batch)) {
				return;
			}
			const modelServices = await this.resolveCardPreviewModelServices(batch);
			if (!isCurrent()
				|| !this.isRenderCurrent(seq)
				|| !this.isCurrentSceneKey(batch.sceneKey)
				|| !this.cardPreviewHydrationQueue.isCurrent(batch)) {
				return;
			}
			await this.hydrateCardPreviewItems(folder, resultNodes, modelServices, true, structuralStamp, seq, batch, isCurrent);
		}, error => {
			if (!this.disposed) {
				this.logService.warn(error instanceof Error ? error.message : String(error));
			}
		});
	}

	private sceneCardControls(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined): BaseHalfCanvasSceneCardControls | undefined {
		if (isBaseHalfMarkdownResource(item.stat.resource)) {
			return {
				kind: 'note',
				formatState: this.canvasNoteFormatStates.get(this.uriIdentityService.extUri.getComparisonKey(item.stat.resource)) ?? BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE,
				background: this.renderedNoteBackgrounds.get(item.path) ?? 'default'
			};
		}
		if (preview?.kind === 'nodeLoading') {
			return { kind: 'pending' };
		}
		if (preview?.kind !== 'node' || preview.document.kind !== 'video') {
			return undefined;
		}
		if (!preview.document.result) {
			const importAvailable = !this.nodeExecutionService.getActiveRun(item.stat.resource)
				&& !preview.dirty
				&& getBaseHalfNodeImportProblem(preview.document) === undefined;
			return {
				kind: 'video',
				actions: Object.freeze<BaseHalfCanvasSceneVideoAction[]>(importAvailable ? ['importResult'] : [])
			};
		}
		if (preview.verificationPending
			|| preview.resultIntegrity
			|| preview.resultMedia?.mediaKind !== 'video') {
			return { kind: 'video', actions: Object.freeze([]) };
		}
		return {
			kind: 'video',
			actions: Object.freeze<BaseHalfCanvasSceneVideoAction[]>([
				'copySettings',
				'showDetails',
				'more',
				'openFullPreview'
			])
		};
	}

	private resolveLiveCanvasCard(path: string): HTMLElement | undefined {
		const candidates = Array.from(this.cards.querySelectorAll<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]'))
			.filter(candidate => candidate.dataset.basehalfCardPath === path
				&& candidate.isConnected
				&& candidate.getClientRects().length > 0
				&& candidate.closest('.react-flow__node') !== null);
		return candidates.find(candidate => candidate.closest('.react-flow__node.selected') !== null)
			?? candidates[candidates.length - 1];
	}

	private async hydrateCardPreviewItems(
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
		modelServices: readonly IBaseHalfModelServiceDescriptor[],
		verifyNodeState: boolean,
		structuralStamp: IBaseHalfWorkspaceMutationStamp,
		seq: number,
		hydrationBatch: IBaseHalfCanvasPreviewHydrationBatch,
		isStageCurrent: () => boolean = () => true
	): Promise<boolean> {
		const batchSize = 4;
		for (let start = 0; start < items.length; start += batchSize) {
			if (!isStageCurrent()
				|| !this.isRenderCurrent(seq)
				|| !this.isCurrentSceneKey(hydrationBatch.sceneKey)
				|| !this.cardPreviewHydrationQueue.isCurrent(hydrationBatch)) {
				return false;
			}
			const batch = items.slice(start, start + batchSize);
			const hydrated = await Promise.all(batch.map(async item => {
				try {
					const before = await this.fileService.stat(item.stat.resource);
					const versionedItem: IBaseHalfCanvasItem = {
						...item,
						stat: { ...item.stat, ...before, children: item.stat.children }
					};
					const preview = await this.readCardPreview(versionedItem, modelServices, verifyNodeState);
					const after = await this.fileService.stat(item.stat.resource);
					if (before.etag !== after.etag
						|| before.size !== after.size
						|| before.isFile !== after.isFile
						|| before.isDirectory !== after.isDirectory
						|| before.isSymbolicLink !== after.isSymbolicLink) {
						return { item };
					}
					return { item, preview };
				} catch {
					return { item };
				}
			}));
			if (!isStageCurrent()
				|| !this.isRenderCurrent(seq)
				|| !this.isCurrentSceneKey(hydrationBatch.sceneKey)
				|| !this.cardPreviewHydrationQueue.isCurrent(hydrationBatch)
				|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return false;
			}
			while (this.canvasScene.isInteracting()) {
				await this.waitForCanvasSceneInteractionEnd();
				if (!isStageCurrent()
					|| !this.isRenderCurrent(seq)
					|| !this.isCurrentSceneKey(hydrationBatch.sceneKey)
					|| !this.cardPreviewHydrationQueue.isCurrent(hydrationBatch)
					|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
					return false;
				}
			}
			if (this.badgeInteractionRenderGate.defer()) {
				return false;
			}

			const replacements = new Map<string, IBaseHalfCanvasSceneCard>();
			for (const { item, preview } of hydrated) {
				const currentItem = this.renderedItemsByPath.get(item.path);
				if (!preview || !currentItem || !baseHalfCanvasItemsSharePreviewVersion(item, currentItem)) {
					continue;
				}
				const currentCard = this.renderedSceneCards.find(card => card.path === item.path);
				if (!currentCard) {
					continue;
				}
				this.renderedCardPreviewsByPath.set(item.path, { item: currentItem, preview });
				if (this.activeCanvasNoteEditor?.path === currentItem.path) {
					continue;
				}
				const badge = this.badgeMetadataWithDraft(
					folder.workspaceFolder,
					currentItem.path,
					currentItem.badge,
					baseHalfBadgeResourceIdentity(currentItem.stat)
				);
				const displayedItem = badge === currentItem.badge ? currentItem : { ...currentItem, badge };
				const visualKey = this.cardVisualKey(displayedItem);
				const cached = this.renderedCardsByPath.get(currentItem.path);
				const element = this.canReuseRenderedCard(cached, displayedItem, preview, visualKey, hydrationBatch.sceneKey)
					? cached.element
					: this.createCard(displayedItem, currentCard, preview, structuralStamp, hydrationBatch.sceneKey);
				this.applyNoteBackground(element, isBaseHalfMarkdownResource(currentItem.stat.resource) ? this.renderedNoteBackgrounds.get(currentItem.path) ?? 'default' : undefined);
				this.renderedCardsByPath.set(currentItem.path, {
					item: currentItem,
					preview,
					visualKey,
					sceneKey: hydrationBatch.sceneKey,
					element
				});
				const controls = this.sceneCardControls(displayedItem, preview);
				replacements.set(currentItem.path, {
					...currentCard,
					controls,
					element,
					updatePresentation: (presentation: IBaseHalfCanvasSceneCardPresentation) => this.cardPresentationUpdaters.get(element)?.(presentation),
					...(this.openBadgeFaces.has(currentItem.path) || this.canvasNoteSurfacePath === currentItem.path ? { forceInteractive: true as const } : {}),
					...(this.canvasNoteSurfacePath === currentItem.path ? { noteEditing: true as const } : {})
				});
			}
			if (replacements.size === 0) {
				continue;
			}
				this.renderedSceneCards = Object.freeze(this.renderedSceneCards.map(card => replacements.get(card.path) ?? card));
				this.canvasScene.update({
				key: hydrationBatch.sceneKey,
				structuralEpoch: structuralStamp.structuralEpoch,
				revision: seq,
				cards: this.renderedSceneCards,
					edges: this.renderedSceneEdges
				});
				const preparedSelection = this.preparedSceneSelection;
				if (preparedSelection?.sceneKey === hydrationBatch.sceneKey
					&& preparedSelection.structuralEpoch === structuralStamp.structuralEpoch
					&& preparedSelection.paths.length === 1
					&& replacements.has(preparedSelection.paths[0])) {
					// React applies `.selected` to a replacement card in its layout
					// effect. Re-arm the bounded retry from the accepted selection,
					// instead of synchronously reading the not-yet-committed DOM.
					this.scheduleVideoComposerForSelection(
						hydrationBatch.sceneKey,
						structuralStamp.structuralEpoch,
						preparedSelection.paths
					);
				}
		}
		return true;
	}

	private async readNodeResultPreview(folder: IBaseHalfCanvasFolderState, document: IBaseHalfNodeDocument, verifyIntegrity: boolean): Promise<{
		readonly resultMedia?: IBaseHalfCanvasMediaPreview;
		readonly resultOutputText?: string;
		readonly resultIntegrity?: Exclude<BaseHalfNodeArtifactIntegrity, 'available'>;
	}> {
		const artifact = getBaseHalfNodeResultArtifact(document);
		if (!artifact) {
			return {};
		}
		if (!verifyIntegrity) {
			return {};
		}
		const outputPath = artifact.path;
		const resource = joinPath(folder.workspaceFolder, ...outputPath.split('/'));
		const integrity = await this.nodeExecutionService.getArtifactIntegrity(folder.workspaceFolder, artifact);
		if (integrity !== 'available') {
			return { resultIntegrity: integrity };
		}
		const media = mediaPreviewFromArtifact(artifact.kind, artifact.label ?? baseHalfReferenceLabel(artifact.path));
		if (media) {
			let resolvedResource = resource;
			try {
				const stat = await this.fileService.resolve(resource, { resolveMetadata: true });
				if (stat.size !== artifact.size) {
					return { resultIntegrity: 'changed' };
				}
				if (media.kind !== 'pdf') {
					resolvedResource = resource.with({ query: `basehalfCanvasVersion=${stat.mtime ?? 0}-${stat.size ?? 0}` });
				}
			} catch {
				return { resultIntegrity: 'missing' };
			}
			return { resultMedia: { text: media.label, mediaKind: media.kind, resource: resolvedResource } };
		}
		if (!baseHalfNodeArtifactUsesTextPreview(artifact.kind, outputPath)) {
			return {};
		}
		try {
			const contents = (await this.fileService.readFile(resource, {
				limits: { size: TEXT_PREVIEW_MAX_BYTES }
			})).value;
			const raw = decodeBaseHalfNodeTextPreview(contents);
			if (raw === undefined) {
				return {};
			}
			const text = markdownPreviewKind(outputPath) === 'markdown' ? raw : cleanCardPreviewText(outputPath, raw);
			return text ? { resultOutputText: text } : {};
		} catch {
			return { resultIntegrity: 'missing' };
		}
	}

	private getCurrentFolder(): IBaseHalfCanvasFolderState | undefined {
		const stateFolder = this.canvasNavigationService.state.canvasFolder;
		if (stateFolder) {
			return stateFolder;
		}

		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			return undefined;
		}

		return {
			resource: folder.uri,
			workspaceFolder: folder.uri,
			relativePath: '',
			source: 'api'
		};
	}

	private reconcileActiveEditor(): void {
		const cardDetail = this.canvasNavigationService.state.cardDetail;
		if (cardDetail) {
			const duplicateEditors = this.editorService.findEditors(cardDetail.resource, { supportSideBySide: SideBySideEditor.ANY });
			if (duplicateEditors.length > 0) {
				void this.editorService.closeEditors(duplicateEditors, { preserveFocus: true })
					.finally(() => this.updateCanvasLayer());
			}
		}
		this.updateCanvasLayer();
	}

	private updateCanvasLayer(): void {
		const editorContent = Array.from(this.editorContainer.children).find(child => child.classList.contains('content'));
		const active = this.editorService.visibleEditors.length === 0 || editorContent?.classList.contains('empty') === true;
		if (!active && this.zoomMenuOpen) {
			this.closeCanvasZoomMenu(false);
		}
		this.editorContainer.classList.toggle('basehalf-canvas-on-top', active);
		this.canvasNavigationService.setSurfaceActive(active);
	}

	private async beginCanvasInlineEdit(request: BaseHalfCanvasEditingRequest): Promise<void> {
		if (request.kind === 'select') {
			this.selectCanvasResources(request.folder, request.resources);
			return;
		}
		this.markCanvasUserInteraction();
		const requestOwner = this.captureCanvasPostCreateOwner();
		const requestFocusOrigin = this.root.ownerDocument.activeElement;
		this.cancelPendingNodeActivation();
		if (this.activeNodeLocalSurface && !await this.activeNodeLocalSurface.closeForSwitch()) {
			return;
		}
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		const placementContext = request.kind === 'rename' ? undefined : request.context;
		let context = request.context;
		try {
			context ??= await this.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
			await this.canvasActionContextService.assertCurrent(context);
		} catch (error) {
			if (request.kind === 'rename' || (context && !this.uriIdentityService.extUri.isEqual(context.resource, folder.resource))) {
				this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				this.requestRender();
				return;
			}
			try {
				context = await this.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
				await this.canvasActionContextService.assertCurrent(context);
			} catch (refreshError) {
				this.queueCanvasWarning(refreshError instanceof Error ? refreshError.message : String(refreshError));
				this.requestRender();
				return;
			}
		}
		if (!this.uriIdentityService.extUri.isEqual(context.resource, folder.resource) && request.kind !== 'rename') {
			return;
		}

		if (request.kind === 'rename') {
			if (this.canvasNavigationService.state.cardDetail) {
				return;
			}
			const item = [...this.renderedItemsByPath.values()]
				.find(candidate => candidate.path === context.relativePath
					&& this.uriIdentityService.extUri.isEqual(candidate.stat.resource, context.resource));
			if (!item) {
				return;
			}
			if (this.activeCanvasNoteEditor?.path === item.path && !await this.closeActiveCanvasNoteEditorAfterFormats(false)) {
				return;
			}
			this.inlineEdit = {
				kind: 'rename',
				context,
				resource: item.stat.resource,
				parent: dirname(item.stat.resource),
				path: item.path,
				initialValue: basename(item.stat.resource),
				value: basename(item.stat.resource),
				selectionPending: true
			};
			this.requestRender();
			return;
		}

		const initialPlacement = this.canvasCreatePlacement(placementContext ?? context);
		const createSize = request.kind === 'create' && request.createKind === 'resultNode' && request.resultKind === 'video'
			? { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT }
			: undefined;
		const placement = request.kind === 'create'
			? this.avoidCanvasCreateOverlap(initialPlacement, request.createKind, [], createSize)
			: initialPlacement;
		if (request.kind === 'paste') {
			const resources = await this.clipboardService.readResources();
			if (resources.length === 0) {
				this.queueCanvasWarning(localize('basehalf.canvas.paste.empty', "The clipboard does not contain files."));
				this.requestRender();
				return;
			}
			await this.importCanvasResources(folder, context, resources, placement.canvasPosition, explorerFileClipboardShouldMove() ? 'move' : 'copy', requestOwner);
			return;
		}
		if (request.kind === 'import') {
			const resources = await this.fileDialogService.showOpenDialog({
				title: localize('basehalf.canvas.import.title', "Import Files"),
				openLabel: localize('basehalf.canvas.import.openLabel', "Import"),
				defaultUri: folder.resource,
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: true
			});
			if (resources?.length) {
				this.markCanvasUserInteraction();
				const importOwner = this.captureCanvasPostCreateOwner();
				await this.importCanvasResources(folder, context, resources, placement.canvasPosition, 'copy', importOwner);
			}
			return;
		}
		if (request.createKind === 'note') {
			if (!this.isCanvasPostCreateOwnerCurrent(requestOwner)) {
				return;
			}
			await this.createUntitledNote(
				folder,
				context,
				placement.canvasPosition,
				requestOwner,
				requestFocusOrigin,
				requestOwner.navigationState.cardDetail
			);
			return;
		}
		if (request.createKind === 'resultNode') {
			if (!this.isCanvasPostCreateOwnerCurrent(requestOwner)) {
				return;
			}
			await this.createEmptyContentNode(folder, context, placement.canvasPosition, request.resultKind, requestOwner);
			return;
		}
		if (this.canvasNavigationService.state.cardDetail) {
			return;
		}

		const surfaceRect = this.surface.getBoundingClientRect();
		this.inlineEdit = {
			kind: 'create',
			context,
			parent: context.resource,
			createKind: request.createKind,
			initialValue: '',
			anchor: { x: placement.screenPosition.x - surfaceRect.left, y: placement.screenPosition.y - surfaceRect.top },
			canvasPosition: placement.canvasPosition,
			value: '',
			selectionPending: true
		};
		this.requestRender();
	}

	private selectCanvasResources(folderResource: URI, resources: readonly URI[]): void {
		const folder = this.getCurrentFolder();
		if (!folder || this.canvasNavigationService.state.cardDetail
			|| !this.uriIdentityService.extUri.isEqual(folder.resource, folderResource)) {
			return;
		}
		const paths = resources
			.filter(resource => this.uriIdentityService.extUri.isEqual(dirname(resource), folder.resource))
			.map(resource => canvasChildPath(folder.relativePath, basename(resource)));
		if (paths.length === 0) {
			return;
		}
		this.queueCanvasSelection(this.sceneKey(folder), paths);
		this.requestRender();
	}

	private canvasCreatePlacement(context: IBaseHalfCanvasActionContext | undefined): {
		readonly screenPosition: { readonly x: number; readonly y: number };
		readonly canvasPosition: { readonly x: number; readonly y: number };
	} {
		const menu = this.lastCanvasContextMenu;
		const surfaceRect = this.surface.getBoundingClientRect();
		const screenPosition = menu && context && menu.context === context && menu.request.kind === 'pane'
			? menu.createPosition ?? (!isHTMLElement(menu.request.anchor) ? menu.request.anchor : undefined)
				?? { x: surfaceRect.left + surfaceRect.width / 2, y: surfaceRect.top + surfaceRect.height / 2 }
			: { x: surfaceRect.left + surfaceRect.width / 2, y: surfaceRect.top + surfaceRect.height / 2 };
		return {
			screenPosition,
			canvasPosition: this.canvasScene.screenToCanvasPosition(screenPosition.x, screenPosition.y)
		};
	}

	private avoidCanvasCreateOverlap(
		placement: { readonly screenPosition: { readonly x: number; readonly y: number }; readonly canvasPosition: { readonly x: number; readonly y: number } },
		kind: BaseHalfCanvasCreateKind,
		extraOccupied: readonly IBaseHalfCanvasBounds[] = [],
		sizeOverride?: { readonly width: number; readonly height: number }
	): { readonly screenPosition: { readonly x: number; readonly y: number }; readonly canvasPosition: { readonly x: number; readonly y: number } } {
		const items = [...this.renderedItemsByPath.values()];
		const occupied = [
			...items.map((item, index) => baseHalfCanvasItemBounds(item, index, items.length)),
			...extraOccupied
		];
		const size = sizeOverride ?? (kind === 'folder'
			? { width: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT }
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT });
		const surface = this.surface.getBoundingClientRect();
		const captionScreenFootprint = (BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP + BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * this.canvasZoom;
		const viewportStart = this.canvasScene.screenToCanvasPosition(surface.left + 24, surface.top + 24 + captionScreenFootprint);
		const viewportEnd = this.canvasScene.screenToCanvasPosition(surface.right - 24, surface.bottom - 24);
		const viewport = {
			x: viewportStart.x,
			y: viewportStart.y,
			width: Math.max(0, viewportEnd.x - viewportStart.x),
			height: Math.max(0, viewportEnd.y - viewportStart.y)
		};
		const canvasPosition = baseHalfCanvasOpenPosition(placement.canvasPosition, size, occupied, viewport);
		return {
			canvasPosition,
			screenPosition: {
				x: placement.screenPosition.x + (canvasPosition.x - placement.canvasPosition.x) * this.canvasZoom,
				y: placement.screenPosition.y + (canvasPosition.y - placement.canvasPosition.y) * this.canvasZoom
			}
		};
	}

	private async createUntitledNote(
		folder: IBaseHalfCanvasFolderState,
		context: IBaseHalfCanvasActionContext,
		canvasPosition: { readonly x: number; readonly y: number },
		createOwner: IBaseHalfCanvasPostCreateOwner,
		createFocusOrigin: Element | null,
		sourceDetail: IBaseHalfCardDetailState | undefined
	): Promise<void> {
		if (!this.isCanvasPostCreateOwnerCurrent(createOwner)) {
			return;
		}
		const createFocusReturnPath = sourceDetail?.relativePath ?? (isHTMLElement(createFocusOrigin)
			? createFocusOrigin.closest<HTMLElement>('.basehalf-canvas-card')?.dataset.basehalfCardPath
			: undefined);
		const projection = this.activeDetailProjection ?? sourceDetail?.projection;
		if (projection && !await this.editorFlushService.flushPane(BASEHALF_CARD_DETAIL_PANE_ID, baseHalfActiveEditorFlushOptions(projection))) {
			throw new Error(localize('basehalf.canvas.newNote.flushBlocked', "Save or resolve this file's changes before creating a new note."));
		}
		if (!sourceDetail && !await this.closeActiveCanvasNoteEditorAfterFormats(false)) {
			throw new Error(localize('basehalf.canvas.newNote.inlineCloseBlocked', "Save or resolve this file's changes before creating a new note."));
		}
		if (!this.uriIdentityService.extUri.isEqual(this.getCurrentFolder()?.resource, folder.resource)) {
			return;
		}
		await this.canvasActionContextService.assertCurrent(context);
		let name: string | undefined;
		for (let index = 0; index < 1000; index++) {
			const candidate = index === 0 ? 'untitled.md' : `untitled-${index}.md`;
			if (!await this.fileService.exists(joinPath(folder.resource, candidate))) {
				name = candidate;
				break;
			}
		}
		if (!name) {
			throw new Error(localize('basehalf.canvas.newNote.exhausted', "Too many untitled notes. Rename one before creating another."));
		}
		const target = await this.createCanvasEntry(folder, context, name, 'file', canvasPosition, {
			select: false,
			postCreateOwner: createOwner
		});
		if (!this.isCanvasPostCreateOwnerCurrent(createOwner)) {
			return;
		}
		if (sourceDetail) {
			if (!await this.canvasNavigationService.closeCardDetail({ expectedCardDetail: sourceDetail })) {
				if (!this.isCanvasPostCreateOwnerCurrent(createOwner)) {
					return;
				}
				throw new Error(localize('basehalf.canvas.newNote.closeBlocked', "The note was created, but this file must finish saving before returning to the canvas."));
			}
			if (this.canvasInteractionEpoch !== createOwner.interactionEpoch
				|| this.canvasNavigationEpoch !== createOwner.navigationEpoch + 1
				|| this.canvasNavigationService.state.cardDetail) {
				return;
			}
		}
		const currentFolder = this.getCurrentFolder();
		if (!currentFolder || this.sceneKey(currentFolder) !== this.sceneKey(folder)) {
			return;
		}
		const activationOwner = this.captureCanvasPostCreateOwner();
		const path = canvasChildPath(folder.relativePath, name);
		this.queueCanvasSelection(this.sceneKey(folder), [path], activationOwner);
		this.queueCreatedCanvasNoteActivation(folder, path, target, activationOwner, {
			focus: true,
			origin: createFocusOrigin,
			returnPath: createFocusReturnPath
		});
		this.requestRender();
	}

	private async createEmptyContentNode(
		folder: IBaseHalfCanvasFolderState,
		context: IBaseHalfCanvasActionContext,
		canvasPosition: { readonly x: number; readonly y: number },
		kind: BaseHalfNodeKind,
		postCreateOwner: IBaseHalfCanvasPostCreateOwner
	): Promise<void> {
		if (!this.isCanvasPostCreateOwnerCurrent(postCreateOwner)) {
			return;
		}
		await this.canvasActionContextService.assertCurrent(context);
		if (!this.uriIdentityService.extUri.isEqual(this.getCurrentFolder()?.resource, folder.resource)) {
			return;
		}
		const label = canvasResultNodeKindLabel(kind);
		let name: string | undefined;
		for (let index = 0; index < 1000; index++) {
			const candidate = `${kind}${index === 0 ? '' : `-${index + 1}`}${BASEHALF_NODE_DOCUMENT_EXTENSION}`;
			if (!await this.fileService.exists(joinPath(folder.resource, candidate))) {
				name = candidate;
				break;
			}
		}
		if (!name) {
			throw new Error(`Too many ${label.toLowerCase()} outputs already use the default name.`);
		}
		const document = createBaseHalfNodeDocument({
			id: generateUuid(),
			kind,
			title: label,
			role: getBaseHalfCanvasDefaultNodeRole(kind)
		});
		await this.createCanvasEntry(folder, context, name, 'file', canvasPosition, {
			contents: VSBuffer.fromString(serializeBaseHalfNodeDocument(document)),
			postCreateOwner,
			size: kind === 'video'
				? { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT }
				: undefined
		});
	}

	private async createPdfBranch(resource: URI, selection: IBaseHalfPdfSelection): Promise<void> {
		this.markCanvasUserInteraction();
		const createOwner = this.captureCanvasPostCreateOwner();
		const createFocusOrigin = this.root.ownerDocument.activeElement;
		const cardDetail = createOwner.navigationState.cardDetail;
		const folder = this.getCurrentFolder();
		if (!cardDetail || !folder
			|| !this.uriIdentityService.extUri.isEqual(cardDetail.resource, resource)
			|| !this.uriIdentityService.extUri.isEqual(dirname(resource), folder.resource)) {
			throw new Error(localize('basehalf.pdf.branch.stale', "The PDF or its canvas changed before the branch could be created."));
		}

		const renderedItems = [...this.renderedItemsByPath.values()];
		const sourceItem = this.renderedItemsByPath.get(cardDetail.relativePath);
		const sourceIndex = sourceItem ? renderedItems.indexOf(sourceItem) : -1;
		const sourceBounds = sourceItem && sourceIndex >= 0
			? baseHalfCanvasItemBounds(sourceItem, sourceIndex, renderedItems.length)
			: undefined;
		if (sourceItem && sourceBounds && !sourceItem.card) {
			// Persist the source's currently visible fallback geometry before adding a
			// sibling. Otherwise the fallback grid changes and the PDF appears to move.
			await this.canvasMirrorService.updateCardGeometry(folder, {
				path: sourceItem.path,
				kind: sourceItem.kind,
				...sourceBounds
			});
		}

		const context = await this.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
		const sourceName = basename(resource);
		const baseName = baseHalfPdfBranchBaseName(sourceName);
		let name: string | undefined;
		for (let index = 0; index < 1000; index++) {
			const candidate = `${baseName}${index === 0 ? '' : `-${index + 1}`}.md`;
			if (!await this.fileService.exists(joinPath(folder.resource, candidate))) {
				name = candidate;
				break;
			}
		}
		if (!name) {
			throw new Error(localize('basehalf.pdf.branch.exhausted', "Too many notes already use this PDF's branch name."));
		}

		const defaultPlacement = this.canvasCreatePlacement(undefined);
		const initialCanvasPosition = sourceBounds
			? { x: sourceBounds.x + sourceBounds.width + 72, y: sourceBounds.y }
			: defaultPlacement.canvasPosition;
		const placement = this.avoidCanvasCreateOverlap({
			screenPosition: defaultPlacement.screenPosition,
			canvasPosition: initialCanvasPosition
		}, 'note');
		const contents = VSBuffer.fromString(baseHalfPdfBranchMarkdown(sourceName, selection));
		const target = await this.createCanvasEntry(folder, context, name, 'file', placement.canvasPosition, {
			contents,
			select: false
		});

		const targetPath = canvasChildPath(folder.relativePath, name);
		let sourceNode: IBaseHalfBadgeNode;
		try {
			const nodes = await this.resolveLiveWorkspaceNodes(folder.workspaceFolder, [
				{ path: cardDetail.relativePath, kind: 'file' },
				{ path: targetPath, kind: 'file' }
			]);
			const resolvedSource = nodes.get(cardDetail.relativePath);
			const resolvedTarget = nodes.get(targetPath);
			if (!resolvedSource || !resolvedTarget) {
				throw new Error('The PDF branch nodes could not be resolved.');
			}
			sourceNode = resolvedSource;
			await this.badgeGraphService.addReference(sourceNode, resolvedTarget);
		} catch (error) {
			// The user-owned note already exists. Keep it reachable even if the
			// derived reference graph could not complete its two-sided write.
			try {
				await this.activateCreatedCanvasNoteAfterDetail(
					cardDetail,
					folder,
					targetPath,
					target,
					createFocusOrigin,
					createOwner,
					[cardDetail.relativePath, targetPath]
				);
			} catch (activationError) {
				this.logService.error('[BaseHalf] failed to return to a PDF branch card after its reference write failed', activationError);
			}
			throw new Error(localize(
				'basehalf.pdf.branch.referenceFailed',
				"The note was created, but its reference from {0} could not be saved: {1}",
				sourceName,
				error instanceof Error ? error.message : String(error)
			));
		}

		let fittedPaths: readonly string[] = [cardDetail.relativePath, targetPath];
		try {
			const sourceBadge = await this.badgeGraphService.readBadge(sourceNode);
			fittedPaths = [...new Set([cardDetail.relativePath, ...(sourceBadge?.references ?? []), targetPath])];
		} catch (error) {
			// Framing is a view concern and must not turn a successful graph write
			// into an apparent action failure.
			this.logService.warn('[BaseHalf] failed to read PDF branch references for canvas framing', error);
		}
		await this.activateCreatedCanvasNoteAfterDetail(
			cardDetail,
			folder,
			targetPath,
			target,
			createFocusOrigin,
			createOwner,
			fittedPaths
		);
	}

	private async activateCreatedCanvasNoteAfterDetail(
		sourceDetail: IBaseHalfCardDetailState,
		folder: IBaseHalfCanvasFolderState,
		path: string,
		resource: URI,
		focusOrigin: Element | null,
		createOwner: IBaseHalfCanvasPostCreateOwner,
		fitPaths: readonly string[]
	): Promise<boolean> {
		if (!this.isCanvasPostCreateOwnerCurrent(createOwner)
			|| createOwner.navigationState.cardDetail !== sourceDetail) {
			return false;
		}
		const ownerDocument = this.root.ownerDocument;
		const focusStillBelongsToCreate = focusOrigin !== null && ownerDocument.activeElement === focusOrigin;
		if (!await this.canvasNavigationService.closeCardDetail({ expectedCardDetail: sourceDetail })) {
			if (!this.isCanvasPostCreateOwnerCurrent(createOwner)) {
				return false;
			}
			throw new Error(localize('basehalf.pdf.branch.closeBlocked', "Save or resolve the active file before returning to the new note."));
		}
		if (this.canvasInteractionEpoch !== createOwner.interactionEpoch
			|| this.canvasNavigationEpoch !== createOwner.navigationEpoch + 1
			|| this.canvasNavigationService.state.cardDetail) {
			return false;
		}
		const currentFolder = this.getCurrentFolder();
		if (!currentFolder
			|| !this.uriIdentityService.extUri.isEqual(currentFolder.resource, folder.resource)
			|| this.sceneKey(currentFolder) !== this.sceneKey(folder)) {
			return false;
		}
		// A PDF projection owns a separate browsing context. Removing it can leave
		// the parent document temporarily focused on <body>, which would consume the
		// delayed editor lease before the new card can claim focus. Re-enter the
		// Canvas through its stable host only while the original create action still
		// owns focus; a user interaction during the async file/graph work wins.
		if (focusStillBelongsToCreate) {
			this.root.focus({ preventScroll: true });
		}
		const handedFocusBackToCanvas = focusStillBelongsToCreate
			&& ownerDocument.activeElement === this.root
			&& ownerDocument.hasFocus();
		const activationOwner = this.captureCanvasPostCreateOwner();
		if (!this.queueCreatedCanvasNoteActivation(
			folder,
			path,
			resource,
			activationOwner,
			handedFocusBackToCanvas ? { focus: true, origin: this.root } : { focus: false },
			fitPaths
		)) {
			return false;
		}
		this.queueCanvasSelection(this.sceneKey(folder), [path], activationOwner);
		this.requestRender();
		return true;
	}

	private renderInlineRenameEditor(card: HTMLElement, item: IBaseHalfCanvasItem): void {
		const edit = this.inlineEdit;
		if (!edit || edit.kind !== 'rename' || edit.path !== item.path
			|| !this.uriIdentityService.extUri.isEqual(edit.resource, item.stat.resource)) {
			return;
		}
		const identity = card.querySelector<HTMLElement>('.basehalf-canvas-card-caption-identity');
		if (!identity) {
			return;
		}
		card.classList.add('inline-editing');
		const host = append(identity, $('.basehalf-canvas-inline-name-editor'));
		this.renderInlineNameInput(host, edit, item.kind === 'folder');
	}

	private renderInlineCreateEditor(folder: IBaseHalfCanvasFolderState): void {
		const edit = this.inlineEdit;
		if (!edit) {
			return;
		}
		if (!this.uriIdentityService.extUri.isEqual(edit.parent, folder.resource)) {
			this.inlineEdit = undefined;
			return;
		}
		if (edit.kind !== 'create') {
			return;
		}
		const host = append(this.inlineEditLayer, $('.basehalf-canvas-inline-create-card'));
		host.style.left = `${Math.max(12, Math.min(edit.anchor.x, this.surface.clientWidth - 292))}px`;
		host.style.top = `${Math.max(12, Math.min(edit.anchor.y, this.surface.clientHeight - 64))}px`;
		this.renderInlineNameInput(host, edit, edit.createKind === 'folder');
	}

	private renderInlineNameInput(host: HTMLElement, edit: BaseHalfCanvasInlineEdit, folder: boolean): void {
		host.classList.add('nodrag', 'nopan', 'nowheel');
		const icon = append(host, $(`span.basehalf-canvas-inline-name-icon.codicon.${folder ? 'codicon-folder' : 'codicon-file'}`));
		icon.setAttribute('aria-hidden', 'true');
		const inputHost = append(host, $('.basehalf-canvas-inline-name-input'));
		const inputBox = new InputBox(inputHost, this.contextViewService, {
			ariaLabel: folder
				? localize('basehalf.canvas.folderNameInput', "Folder name. Press Enter to confirm or Escape to cancel.")
				: localize('basehalf.canvas.fileNameInput', "File name. Press Enter to confirm or Escape to cancel."),
			inputBoxStyles: defaultInputBoxStyles,
			placeholder: folder
				? localize('basehalf.canvas.folderNamePlaceholder', "Folder name")
				: localize('basehalf.canvas.fileNamePlaceholder', "filename.ext")
		});
		this.inlineEditListeners.add(inputBox);
		inputBox.value = edit.value;
		const extension = folder ? '' : extname(URI.file(edit.initialValue));
		const selectionEnd = extension.length > 0 && extension.length < edit.initialValue.length
			? edit.initialValue.length - extension.length
			: edit.initialValue.length;
		let validationSequence = 0;
		let finishing = false;

		const refreshValidation = async () => {
			const sequence = ++validationSequence;
			const candidate = inputBox.value;
			let result: { readonly content: string; readonly type: MessageType } | undefined;
			try {
				result = await this.validateCanvasEntryName(edit.parent, candidate, edit.kind === 'rename' ? edit.resource : undefined);
			} catch (error) {
				result = { content: error instanceof Error ? error.message : String(error), type: MessageType.ERROR };
			}
			if (sequence !== validationSequence || this.inlineEdit !== edit) {
				return;
			}
			if (result) {
				inputBox.showMessage({ content: result.content, type: result.type });
			} else {
				inputBox.hideMessage();
			}
		};

		const finish = async (keepOpenOnError: boolean) => {
			if (finishing || this.inlineEdit !== edit) {
				return;
			}
			finishing = true;
			const postCreateOwner = edit.kind === 'create' ? this.captureCanvasPostCreateOwner() : undefined;
			const name = inputBox.value;
			edit.value = name;
			inputBox.disable();
			let validation: { readonly content: string; readonly type: MessageType } | undefined;
			try {
				validation = await this.validateCanvasEntryName(edit.parent, name, edit.kind === 'rename' ? edit.resource : undefined);
			} catch (error) {
				validation = { content: error instanceof Error ? error.message : String(error), type: MessageType.ERROR };
			}
			if (this.inlineEdit !== edit) {
				return;
			}
			if (validation?.type === MessageType.ERROR) {
				finishing = false;
				if (keepOpenOnError) {
					inputBox.enable();
					inputBox.showMessage({ content: validation.content, type: validation.type }, true);
					inputBox.focus();
				} else {
					this.cancelCanvasInlineEdit(edit);
				}
				return;
			}
			if (edit.kind === 'rename' && name === edit.initialValue) {
				this.cancelCanvasInlineEdit(edit);
				return;
			}
			this.inlineEdit = undefined;
			try {
				await this.commitCanvasInlineEdit(edit, name, postCreateOwner);
				this.lastCanvasContextMenu = undefined;
				this.requestRender();
			} catch (error) {
				this.inlineEdit = edit;
				finishing = false;
				if (inputBox.element.isConnected) {
					inputBox.enable();
					inputBox.showMessage({
						content: error instanceof Error ? error.message : String(error),
						type: MessageType.ERROR
					}, true);
					inputBox.focus();
				} else {
					this.requestRender();
				}
			}
		};

		this.inlineEditListeners.add(inputBox.onDidChange(value => {
			edit.value = value;
			void refreshValidation();
		}));
		this.inlineEditListeners.add(DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.KEY_DOWN, (event: IKeyboardEvent) => {
			event.stopPropagation();
			const browserEvent = event.browserEvent;
			const enter = event.equals(KeyCode.Enter) || browserEvent.key === 'Enter' || browserEvent.code === 'Enter';
			const escape = event.equals(KeyCode.Escape) || browserEvent.key === 'Escape' || browserEvent.key === 'Esc' || browserEvent.code === 'Escape';
			const action = baseHalfCanvasInlineEditKeyAction({
				key: enter ? 'Enter' : escape ? 'Escape' : '',
				isComposing: browserEvent.isComposing,
				keyCode: browserEvent.keyCode
			});
			if (action === undefined) {
				return;
			}
			if (action === 'accept') {
				event.preventDefault();
				void finish(true);
			} else {
				event.preventDefault();
				this.cancelCanvasInlineEdit(edit);
			}
		}));
		this.inlineEditListeners.add(this.addDisposableListener(inputBox.inputElement, 'blur', () => {
			mainWindow.setTimeout(() => {
				if (inputBox.element.isConnected && !finishing && this.inlineEdit === edit
					&& inputBox.inputElement.ownerDocument.activeElement !== inputBox.inputElement) {
					void finish(false);
				}
			}, 0);
		}));
		mainWindow.setTimeout(() => {
			if (this.inlineEdit === edit && inputBox.element.isConnected) {
				inputBox.focus();
				if (edit.selectionPending) {
					edit.selectionPending = false;
					inputBox.select({ start: 0, end: selectionEnd });
				}
				void refreshValidation();
			}
		}, 0);
	}

	private cancelCanvasInlineEdit(edit: BaseHalfCanvasInlineEdit): void {
		if (this.inlineEdit !== edit) {
			return;
		}
		this.inlineEdit = undefined;
		this.lastCanvasContextMenu = undefined;
		this.requestRender();
		mainWindow.setTimeout(() => this.cards.focus({ preventScroll: true }), 0);
	}

	private async validateCanvasEntryName(parent: URI, name: string, current?: URI): Promise<{ readonly content: string; readonly type: MessageType } | undefined> {
		if (name.length === 0 || /^\s+$/.test(name)) {
			return { content: localize('basehalf.canvas.name.empty', "A file or folder name is required."), type: MessageType.ERROR };
		}
		if (name === '.' || name === '..' || /[\\/]/.test(name)) {
			return { content: localize('basehalf.canvas.name.singleSegment', "Enter a name without path separators."), type: MessageType.ERROR };
		}
		if (!(await this.pathService.hasValidBasename(parent, name))) {
			return { content: localize('basehalf.canvas.name.invalid', "This name is not valid on the current file system."), type: MessageType.ERROR };
		}
		const target = joinPath(parent, name);
		if ((!current || !this.uriIdentityService.extUri.isEqual(target, current)) && await this.fileService.exists(target)) {
			return { content: localize('basehalf.canvas.name.exists', "A file or folder with this name already exists."), type: MessageType.ERROR };
		}
		if (/^\s|\s$/.test(name)) {
			return { content: localize('basehalf.canvas.name.whitespace', "Leading or trailing whitespace will be preserved."), type: MessageType.WARNING };
		}
		return undefined;
	}

	private async commitCanvasInlineEdit(
		edit: BaseHalfCanvasInlineEdit,
		name: string,
		postCreateOwner?: IBaseHalfCanvasPostCreateOwner
	): Promise<void> {
		const target = joinPath(edit.parent, name);
		if (edit.kind === 'rename') {
			await this.canvasActionContextService.assertCurrent(edit.context);
			await this.fileService.stat(edit.resource);
			await this.explorerService.applyBulkEdit([new ResourceFileEdit(edit.resource, target)], {
				undoLabel: localize('basehalf.canvas.rename.undo', "Rename {0} to {1}", edit.initialValue, name),
				progressLabel: localize('basehalf.canvas.rename.progress', "Renaming {0}", edit.initialValue),
				confirmBeforeUndo: this.confirmExplorerUndo()
			});
			return;
		}
		const folder = this.getCurrentFolder();
		if (!folder || !this.uriIdentityService.extUri.isEqual(folder.resource, edit.parent)) {
			throw new Error(localize('basehalf.canvas.create.folderChanged', "The canvas changed before the item could be created."));
		}
		await this.createCanvasEntry(folder, edit.context, name, edit.createKind, edit.canvasPosition, {
			postCreateOwner: postCreateOwner ?? this.captureCanvasPostCreateOwner()
		});
	}

	private async createCanvasEntry(
		folder: IBaseHalfCanvasFolderState,
		context: IBaseHalfCanvasActionContext,
		name: string,
		kind: 'file' | 'folder',
		canvasPosition: { readonly x: number; readonly y: number },
		options: {
			readonly contents?: VSBuffer;
			readonly select?: boolean;
			readonly postCreateOwner?: IBaseHalfCanvasPostCreateOwner;
			readonly size?: { readonly width: number; readonly height: number };
		} = {}
	): Promise<URI> {
		const postCreateOwner = options.postCreateOwner ?? this.captureCanvasPostCreateOwner();
		await this.canvasActionContextService.assertCurrent(context);
		const target = joinPath(folder.resource, name);
		await this.explorerService.applyBulkEdit([new ResourceFileEdit(undefined, target, {
			folder: kind === 'folder',
			contents: options.contents ? Promise.resolve(options.contents) : undefined
		})], {
			undoLabel: kind === 'folder'
				? localize('basehalf.canvas.newFolder.undo', "Create Folder {0}", name)
				: localize('basehalf.canvas.newFile.undo', "Create File {0}", name),
			progressLabel: kind === 'folder'
				? localize('basehalf.canvas.newFolder.progress', "Creating folder {0}", name)
				: localize('basehalf.canvas.newFile.progress', "Creating file {0}", name),
			confirmBeforeUndo: this.confirmExplorerUndo()
		});

		const path = canvasChildPath(folder.relativePath, name);
		const size = options.size ?? (kind === 'folder'
			? { width: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT }
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT });
		try {
			await this.canvasMirrorService.updateCardGeometry(folder, {
				path,
				kind,
				x: canvasPosition.x,
				y: canvasPosition.y,
				width: size.width,
				height: size.height
			});
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning(localize('basehalf.canvas.createGeometryFailed', "The item was created, but its canvas position could not be saved."));
		}

		// A canvas Create action produces and selects a card; it never implies an
		// Open action. Card-local editors/configuration remain available in place,
		// while Card Detail is reserved for an explicit Open/Expand interaction.
		if (options.select !== false) {
			this.queueCanvasSelection(this.sceneKey(folder), [path], postCreateOwner);
		}
		this.requestRender();
		return target;
	}

	private async importCanvasResources(
		folder: IBaseHalfCanvasFolderState,
		context: IBaseHalfCanvasActionContext,
		resources: readonly URI[],
		canvasPosition: { readonly x: number; readonly y: number },
		operation: 'copy' | 'move',
		postCreateOwner: IBaseHalfCanvasPostCreateOwner
	): Promise<void> {
		if (this.canvasNavigationService.state.cardDetail) {
			return;
		}
		await this.canvasActionContextService.assertCurrent(context);
		if (!this.uriIdentityService.extUri.isEqual(this.getCurrentFolder()?.resource, folder.resource)) {
			return;
		}
		const incrementalNaming = this.configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
		const uniqueResources = [...new Map(resources.map(resource => [resource.toString(), resource])).values()];
		const transfers: { readonly source: URI; readonly target: URI; readonly kind: 'file' | 'folder' }[] = [];
		for (const source of uniqueResources) {
			if (operation === 'move' && this.uriIdentityService.extUri.isEqual(dirname(source), folder.resource)) {
				continue;
			}
			const stat = await this.fileService.stat(source);
			if (!stat.isFile && !stat.isDirectory) {
				continue;
			}
			if (stat.isDirectory && isEqualOrParent(folder.resource, source)) {
				throw new Error(localize('basehalf.canvas.import.ancestor', "A folder cannot be imported into itself or one of its descendants."));
			}
			const target = await findValidPasteFileTargetForResource(
				this.fileService,
				this.dialogService,
				folder.resource,
				{ resource: source, isDirectory: stat.isDirectory, allowOverwrite: operation === 'move' || incrementalNaming === 'disabled' },
				incrementalNaming
			);
			if (target) {
				transfers.push({ source, target, kind: stat.isDirectory ? 'folder' : 'file' });
			}
		}
		if (transfers.length === 0) {
			if (operation === 'move') {
				await clearExplorerFileClipboardCut(this.explorerService);
			}
			return;
		}
		await this.explorerService.applyBulkEdit(transfers.map(transfer => new ResourceFileEdit(transfer.source, transfer.target, {
			copy: operation === 'copy',
			overwrite: incrementalNaming === 'disabled'
		})), {
			undoLabel: transfers.length === 1
				? operation === 'move'
					? localize('basehalf.canvas.move.undoOne', "Move {0}", basename(transfers[0].target))
					: localize('basehalf.canvas.import.undoOne', "Import {0}", basename(transfers[0].target))
				: operation === 'move'
					? localize('basehalf.canvas.move.undoMany', "Move {0} items", transfers.length)
					: localize('basehalf.canvas.import.undoMany', "Import {0} items", transfers.length),
			progressLabel: transfers.length === 1
				? operation === 'move'
					? localize('basehalf.canvas.move.progressOne', "Moving {0}", basename(transfers[0].target))
					: localize('basehalf.canvas.import.progressOne', "Importing {0}", basename(transfers[0].target))
				: operation === 'move'
					? localize('basehalf.canvas.move.progressMany', "Moving {0} items", transfers.length)
					: localize('basehalf.canvas.import.progressMany', "Importing {0} items", transfers.length),
			confirmBeforeUndo: this.confirmExplorerUndo()
		});
		if (operation === 'move') {
			await clearExplorerFileClipboardCut(this.explorerService);
		}

		const paths: string[] = [];
		for (let index = 0; index < transfers.length; index++) {
			const transfer = transfers[index];
			const position = baseHalfCanvasTransferPosition(canvasPosition, index, transfers.length);
			const name = basename(transfer.target);
			const path = canvasChildPath(folder.relativePath, name);
			paths.push(path);
			try {
				await this.canvasMirrorService.updateCardGeometry(folder, {
					path,
					kind: transfer.kind,
					x: position.x,
					y: position.y,
					width: transfer.kind === 'folder' ? BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH : BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
					height: transfer.kind === 'folder' ? BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT : BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT
				});
			} catch (error) {
				this.logService.warn(error);
				this.queueCanvasWarning(localize('basehalf.canvas.importGeometryFailed', "The items were imported, but some canvas positions could not be saved."));
			}
		}
		this.queueCanvasSelection(this.sceneKey(folder), paths, postCreateOwner);
		this.requestRender();
	}

	private confirmExplorerUndo(): boolean {
		return this.configurationService.getValue<IFilesConfiguration>().explorer.confirmUndo === UndoConfirmLevel.Verbose;
	}

	private async requestInlineRename(item: IBaseHalfCanvasItem): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		try {
			const context = await this.canvasActionContextService.capture(item.stat.resource, folder.workspaceFolder, item.path);
			await this.canvasEditingService.requestRename(context);
		} catch (error) {
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
		}
	}

	private applyNoteBackground(card: HTMLElement, background: BaseHalfCanvasNoteBackground | undefined): void {
		if (background === undefined) {
			delete card.dataset.noteBackground;
			return;
		}
		card.dataset.noteBackground = background;
	}

	private createCard(
		item: IBaseHalfCanvasItem,
		bounds: IBaseHalfCanvasBounds,
		preview: BaseHalfCanvasCardPreview | undefined,
		structuralStamp: IBaseHalfWorkspaceMutationStamp,
		sceneKey: string
	): HTMLElement {
		const listeners = this.replaceCardListenerStore(item.path);
		const presentationListeners = new MutableDisposable<DisposableStore>();
		listeners.add(presentationListeners);
		const card = $('.basehalf-canvas-card');
		const displayName = cardDisplayName(item, preview);
		const resultNode = item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION);
		const markdownNote = isBaseHalfMarkdownResource(item.stat.resource);
		card.tabIndex = 0;
		card.setAttribute('role', 'group');
		card.dataset.basehalfCardPath = item.path;
		card.dataset.cardHeight = String(bounds.height);
		const badgeOpen = this.openBadgeFaces.has(item.path);
		card.dataset.previewLevel = 'shell';
		card.dataset.projection = badgeOpen ? 'badge' : 'preview';
		card.classList.add(item.kind);
		card.classList.toggle('badge-open', badgeOpen);
		card.setAttribute('aria-label', `${displayName} card`);
		card.title = resultNode
			? `${item.path} - click to select; double-click to open the sealed Result`
			: item.kind === 'folder'
			? `${item.path} - click to select; double-click to enter this folder`
			: markdownNote
				? `${item.path} - click to select; double-click the content to edit`
				: `${item.path} - click to select; double-click to open the editor`;

		const type = preview?.kind === 'node' ? preview.document.kind : preview?.kind === 'nodeLoading' ? 'generic' : badgeType(item.name, item.kind === 'folder');
		if (preview?.kind === 'node') {
			card.dataset.nodeKind = preview.document.kind;
			card.classList.add(`node-kind-${preview.document.kind}`);
		}
		const orphan = item.badge?.orphan === true;
		const badgeRelationships = baseHalfCanvasBadgeRelationships(item.path, item.badge, this.renderedBadges, this.renderedBadgeProblems);
		const badgeIssueCount = badgeRelationships.issues.length + (this.renderedBadgeProblems.has(item.path) ? 1 : 0);
		card.classList.toggle('has-reference-issues', badgeIssueCount > 0);
		card.dataset.referenceIssueCount = String(badgeIssueCount);
		card.setAttribute('aria-label', `${displayName} card${orphan ? ', missing' : ''}${badgeIssueCount > 0 ? `, ${badgeIssueCount} reference metadata issue${badgeIssueCount === 1 ? '' : 's'}` : ''}`);
		const canShowBadgeFace = !(item.kind === 'folder' && orphan);
		const caption = append(card, $('.basehalf-canvas-card-caption'));
		const captionIdentity = append(caption, $('.basehalf-canvas-card-caption-identity'));
		const icon = append(captionIdentity, $('.basehalf-canvas-card-caption-icon'));
		icon.setAttribute('aria-hidden', 'true');
		this.renderGlyph(icon, type, glyphTone(type, orphan), 15);
		const label = append(captionIdentity, $('.basehalf-canvas-card-label'));
		label.textContent = displayName;
		label.title = displayName;
		label.classList.toggle('danger', orphan);
		const captionActions = append(caption, $('.basehalf-canvas-card-caption-actions'));
		if (canShowBadgeFace) {
			this.renderCardBadgeToggle(captionActions, item, badgeRelationships, badgeIssueCount, listeners);
		}
		const content = append(card, $('.basehalf-canvas-card-content'));
		this.renderInlineRenameEditor(card, item);
		this.renderedCardElementsByPath.set(item.path, card);

		let renderedPresentation: BaseHalfCanvasCardPresentation | undefined;
		let renderedHeight: number | undefined;
		const updatePresentation = (presentation: IBaseHalfCanvasSceneCardPresentation): void => {
			// A live Note editor is an overlay on the retained preview. Even a stale
			// scene callback must not dispose that preview's rendering/listener owner.
			const presentationLevel = this.activeCanvasNoteEditor?.card === card
				? 'preview'
				: presentation.level;
			this.updateCardPreviewHydrationPresentation(item.path, presentationLevel, sceneKey);
			if (renderedHeight !== presentation.height) {
				renderedHeight = presentation.height;
				card.dataset.cardHeight = String(presentation.height);
			}
			if (renderedPresentation === presentationLevel) {
				card.dataset.previewLevel = presentationLevel;
				if (this.canvasNoteSurfacePath === item.path) {
					this.tryMountCanvasNoteEditor(item.path);
				}
				return;
			}
			renderedPresentation = presentationLevel;
			card.dataset.previewLevel = presentationLevel;
			const nextListeners = new DisposableStore();
			presentationListeners.value = nextListeners;
			clearNode(content);
			this.renderedNodeChromeByPath.delete(item.path);
			if (presentationLevel === 'shell') {
				return;
			}

			const active = append(content, $('.basehalf-canvas-card-active'));
			const body = append(active, $('.basehalf-canvas-card-body'));
			if (badgeOpen && canShowBadgeFace) {
				this.renderCardBadgeFace(body, item, nextListeners);
			} else {
				this.renderCardPreview(body, item, preview, orphan, presentationLevel === 'interactive', nextListeners, card);
			}
			this.renderFolderCoverage(active, item, preview);
			this.restorePendingCanvasBadgeFocus(card, item.path);
		};
		this.cardPresentationUpdaters.set(card, updatePresentation);
		updatePresentation({
			level: 'shell',
			height: bounds.height
		});

		listeners.add(this.addDisposableListener(card, 'keydown', event => {
			if (event.target !== card) {
				return;
			}
			if (event.key === 'F2') {
				event.preventDefault();
				event.stopPropagation();
				void this.requestInlineRename(item);
			} else if (event.key === 'Enter') {
				event.preventDefault();
				if ((event.metaKey || event.ctrlKey) && resultNode && preview?.kind === 'node') {
					const state = nodeLocalStateForCardPreview(preview);
					if (state.ready && (state.action.kind === 'run' || state.action.kind === 'retry')) {
						void this.runCanvasNode(item);
					} else {
						this.queueCanvasWarning(state.message);
						this.requestRender();
					}
					return;
				}
				if (resultNode) {
					this.selectCard(item.path);
					const folder = this.getCurrentFolder();
					if (folder) {
						this.cancelPendingNodeActivation();
						void this.openResultNodeContent(folder, item, card);
					}
				} else if (markdownNote) {
					this.selectCard(item.path);
					void this.beginSceneNoteEdit(sceneKey, structuralStamp.structuralEpoch, item.path);
				} else {
					void this.canvasNavigationService.openResource(item.stat.resource, { source: 'api', pinned: true });
				}
			} else if (event.key === ' ') {
				event.preventDefault();
				this.selectCard(item.path);
			}
		}));
		return card;
	}

	private restorePendingCanvasBadgeFocus(card: HTMLElement, path: string): void {
		const pending = this.pendingCanvasBadgeFocus;
		if (!pending || pending.path !== path) {
			return;
		}

		let attempts = 0;
		const focus = () => {
			if (this.disposed || this.pendingCanvasBadgeFocus !== pending) {
				return;
			}
			if (!card.isConnected) {
				if (attempts++ < 8) {
					mainWindow.requestAnimationFrame(focus);
				}
				return;
			}
			let target: HTMLElement | null | undefined;
			switch (pending.target) {
				case 'prompt':
					target = card.dataset.previewLevel !== 'shell'
						? card.querySelector<HTMLTextAreaElement>('.basehalf-canvas-card-badge-prompt')
						: undefined;
					break;
				case 'add-reference':
					target = card.dataset.previewLevel !== 'shell'
						? card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-add-reference')
						: undefined;
					break;
				case 'inbound-toggle':
					target = card.dataset.previewLevel !== 'shell'
						? card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-inbound-toggle')
						: undefined;
					break;
				case 'toggle':
					target = card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-caption .basehalf-canvas-card-badge-toggle');
					break;
			}
			if (!target) {
				if (attempts++ < 8) {
					mainWindow.requestAnimationFrame(focus);
				}
				return;
			}
			target.focus();
			if (card.ownerDocument.activeElement === target) {
				this.pendingCanvasBadgeFocus = undefined;
			} else if (attempts++ < 8) {
				mainWindow.requestAnimationFrame(focus);
			}
		};
		mainWindow.requestAnimationFrame(focus);
	}

	private cardBoundsForPreview(
		item: IBaseHalfCanvasItem,
		index: number,
		total: number,
		preview: BaseHalfCanvasCardPreview | undefined
	): IBaseHalfCanvasBounds {
		const bounds = baseHalfCanvasItemBounds(item, index, total);
		if (!item.card && preview?.kind === 'node' && preview.document.kind === 'video') {
			return {
				...bounds,
				width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH,
				height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT
			};
		}
		return bounds;
	}

	private renderCardBadgeToggle(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		badgeRelationships: ReturnType<typeof baseHalfCanvasBadgeRelationships>,
		badgeIssueCount: number,
		listeners: DisposableStore
	): void {
		const badgeOpen = this.openBadgeFaces.has(item.path);
		const badgeToggle = append(container, $('button.basehalf-canvas-card-badge-toggle')) as HTMLButtonElement;
		badgeToggle.classList.add('nodrag', 'nopan', 'nowheel');
		badgeToggle.type = 'button';
		badgeToggle.title = badgeIssueCount > 0
			? `${badgeIssueCount} reference metadata issue${badgeIssueCount === 1 ? '' : 's'} - open Badge to resolve`
			: badgeOpen ? 'Hide the badge - back to the preview' : item.badge?.description ? 'Has a badge - edit it' : 'Edit Badge';
		badgeToggle.setAttribute('aria-label', `${badgeOpen ? 'Hide' : 'Show'} badge for ${item.path}${badgeIssueCount > 0 ? `, ${badgeIssueCount} reference metadata issue${badgeIssueCount === 1 ? '' : 's'}` : ''}`);
		badgeToggle.setAttribute('aria-pressed', String(badgeOpen));
		badgeToggle.classList.toggle('lit', !!item.badge?.description || badgeIssueCount > 0);
		badgeToggle.classList.toggle('issue', badgeIssueCount > 0);
		badgeToggle.classList.toggle('pressed', badgeOpen);
		this.renderGlyph(badgeToggle, 'badge', badgeIssueCount > 0 ? 'var(--bh-card-warning)' : item.badge?.description ? 'var(--bh-card-accent)' : 'var(--bh-card-text-tertiary)', 15);
		if (badgeIssueCount > 0) {
			const marker = append(badgeToggle, $('.basehalf-canvas-card-badge-dot.issue'));
			marker.setAttribute('data-testid', 'card-reference-issue-marker');
			marker.setAttribute('data-reference-issue-count', String(badgeIssueCount));
			marker.setAttribute('aria-hidden', 'true');
		} else if (item.badge?.description && (badgeRelationships.references.length > 0 || badgeRelationships.referencedBy.length > 0)) {
			append(badgeToggle, $('.basehalf-canvas-card-badge-dot'));
		}
		listeners.add(this.addDisposableListener(badgeToggle, 'pointerdown', event => {
			event.stopPropagation();
		}));
		listeners.add(this.addDisposableListener(badgeToggle, 'dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		}));
		listeners.add(this.addDisposableListener(badgeToggle, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			void (async () => {
				if (this.activeCanvasNoteEditor?.path === item.path && !await this.closeActiveCanvasNoteEditorAfterFormats(false)) {
					return;
				}
				this.selectCard(item.path);
				this.toggleBadgeFace(item.path);
			})();
		}));
	}

	private renderGlyph(container: Element, type: BaseHalfCanvasGlyphType, tone: string, size: number | string): void {
		const dim = typeof size === 'number' ? `${size}px` : size;
		const svg = $.SVG('svg');
		svg.classList.add('basehalf-file-glyph');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '1.25');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		svg.setAttribute('aria-hidden', 'true');
		svg.style.width = dim;
		svg.style.height = dim;
		svg.style.color = tone;
		renderGlyphPath(svg, type);
		container.appendChild(svg);
	}

	private renderCardPreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: BaseHalfCanvasCardPreview | undefined,
		orphan: boolean,
		interactive: boolean,
		listeners: DisposableStore,
		card: HTMLElement
	): void {
		const previewNode = append(container, $('.basehalf-canvas-card-preview'));
		const previewKindClass = `kind-${preview?.kind ?? 'unavailable'}`;
		previewNode.classList.add(previewKindClass);
		if (orphan) {
			previewNode.textContent = item.kind === 'folder' ? item.badge?.description ?? '' : 'Missing file';
			return;
		}
		if (this.canvasNoteSurfacePath === item.path
			&& isBaseHalfMarkdownResource(item.stat.resource)) {
			previewNode.classList.remove(previewKindClass);
			previewNode.classList.add('kind-markdown');
			this.renderMarkdownPreview(previewNode, item, preview?.kind === 'markdown' ? preview.text : '', listeners, card);
			return;
		}
		if (!preview) {
			previewNode.textContent = 'Preview unavailable';
			return;
		}
		if (preview.kind === 'folder') {
			this.renderFolderPreview(previewNode, preview, item.badge?.description);
			return;
		}
		if (preview.kind === 'markdown') {
			this.renderMarkdownPreview(previewNode, item, preview.text, listeners, card);
			return;
		}
		if (preview.kind === 'media') {
			this.renderMediaPreview(previewNode, preview, interactive, listeners);
			return;
		}
		if (preview.kind === 'node') {
			this.renderNodePreview(previewNode, item, preview, interactive, listeners, card);
			return;
		}
		if (preview.kind === 'invalidNode') {
			this.renderInvalidNodePreview(previewNode, item, preview.text, listeners);
			return;
		}
		previewNode.textContent = preview.text;
	}

	private renderInvalidNodePreview(container: HTMLElement, item: IBaseHalfCanvasItem, message: string, listeners: DisposableStore): void {
		const title = append(container, $('.basehalf-canvas-invalid-node-title'));
		title.textContent = 'Invalid result node';
		const detail = append(container, $('.basehalf-canvas-invalid-node-message'));
		detail.textContent = message;
		const action = append(container, $('button.basehalf-canvas-invalid-node-action')) as HTMLButtonElement;
		action.classList.add('nodrag', 'nopan', 'nowheel');
		action.type = 'button';
		action.textContent = 'Open source';
		action.title = 'Open the local JSON source without changing it';
		listeners.add(this.addDisposableListener(action, 'pointerdown', event => event.stopPropagation()));
		listeners.add(this.addDisposableListener(action, 'dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		}));
		listeners.add(this.addDisposableListener(action, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			void this.canvasNavigationService.openResource(item.stat.resource, {
				source: 'api',
				pinned: true,
				projection: 'source'
			});
		}));
	}

	private renderNodePreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>,
		interactive: boolean,
		listeners: DisposableStore,
		card: HTMLElement
	): void {
		card.dataset.nodeLifecycle = preview.document.result ? 'result' : preview.document.attempts.length > 0 ? 'attempt' : 'draft';
		if (preview.document.kind === 'video') {
			this.renderVideoNodePreview(container, item, preview, interactive, listeners, card);
			return;
		}
		const result = append(container, $('.basehalf-canvas-node-result'));
		const resultLabel = append(result, $('.basehalf-canvas-node-result-label'));
		resultLabel.textContent = 'Result';
		if (preview.resultMedia) {
			const media = append(result, $('.basehalf-canvas-node-result-media'));
			this.renderMediaPreview(media, { kind: 'media', ...preview.resultMedia }, interactive, listeners);
		} else {
			const resultValue = append(result, $('.basehalf-canvas-node-result-value'));
			resultValue.textContent = nodePreviewResultLabel(preview);
			resultValue.title = nodeResultTitle(preview.document, preview.resultOutputText);
		}

		const activeExecution = this.nodeExecutionService.getActiveRun(item.stat.resource);
		const localState = nodeLocalStateForCardPreview(activeExecution ? { ...preview, execution: activeExecution } : preview);
		card.dataset.nodeStatus = baseHalfNodeLocalStatusToken(localState.status);
		let status: HTMLElement | undefined;
		if (localState.message) {
			status = append(container, $('.basehalf-canvas-node-status'));
			status.textContent = getBaseHalfNodeCardStatusText(localState);
			status.title = localState.message;
			status.setAttribute('aria-label', `${localState.status}: ${localState.message}`);
			status.classList.toggle('ready', isBaseHalfNodeCardStatusPositive(localState));
			status.classList.toggle('executing', !!activeExecution);
			status.setAttribute('aria-live', 'polite');
		}
		const progress = append(container, $('.basehalf-canvas-node-progress'));
		const progressValue = append(progress, $('.basehalf-canvas-node-progress-value'));
		const executionProgress = activeExecution?.progress;
		progress.hidden = !activeExecution;
		progress.classList.toggle('indeterminate', activeExecution !== undefined && executionProgress === undefined);
		progressValue.style.width = executionProgress === undefined ? '36%' : `${Math.max(0, Math.min(100, executionProgress))}%`;
		progress.setAttribute('role', 'progressbar');
		progress.setAttribute('aria-label', activeExecution ? `${localState.status}: ${localState.message}` : 'No active generation');
		if (executionProgress !== undefined) {
			progress.setAttribute('aria-valuemin', '0');
			progress.setAttribute('aria-valuemax', '100');
			progress.setAttribute('aria-valuenow', String(Math.round(Math.max(0, Math.min(100, executionProgress)))));
		}
		this.renderNodeActions(container, item, preview, localState, activeExecution, listeners, card, { status, progress, progressValue });
	}

	private renderVideoNodePreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>,
		interactive: boolean,
		listeners: DisposableStore,
		card: HTMLElement
	): void {
		const activeExecution = this.nodeExecutionService.getActiveRun(item.stat.resource);
		const localState = nodeLocalStateForCardPreview(activeExecution ? { ...preview, execution: activeExecution } : preview);
		const emptyDraft = !preview.document.result && preview.document.attempts.length === 0 && !activeExecution;
		card.dataset.nodeStatus = baseHalfNodeLocalStatusToken(localState.status);
		card.classList.toggle('empty-video-draft', emptyDraft);
		card.setAttribute('aria-label', `${preview.document.title}, Video, ${getBaseHalfNodeCardStatusText(localState)}${activeExecution?.progress === undefined ? '' : ` ${Math.round(Math.max(0, Math.min(100, activeExecution.progress)))} percent`}`);

		const stage = append(container, $('.basehalf-video-stage'));
		stage.title = localState.message;
		if (preview.resultMedia?.mediaKind === 'video' && !preview.resultIntegrity) {
			const media = append(stage, $('.basehalf-video-stage-media'));
			this.renderMediaPreview(media, { kind: 'media', ...preview.resultMedia }, interactive, listeners);
		} else {
			const empty = append(stage, $('.basehalf-video-stage-empty'));
			empty.classList.toggle('simple', emptyDraft);
			empty.setAttribute('aria-hidden', 'true');
			const glyph = append(empty, $('.basehalf-video-stage-glyph'));
			this.renderGlyph(glyph, 'video', 'var(--bh-card-text-ghost)', emptyDraft ? 42 : 30);
			if (!emptyDraft) {
				const hint = append(empty, $('.basehalf-video-stage-hint'));
				hint.textContent = preview.verificationPending && preview.document.result
					? localize('basehalf.canvas.videoStage.checking', "Checking the sealed video…")
					: preview.document.recipe
						? localize('basehalf.canvas.videoStage.configured', "Video Draft")
						: localize('basehalf.canvas.videoStage.empty', "Video unavailable");
			}
		}

		let status: HTMLElement | undefined;
		if (!emptyDraft && (!preview.document.result || preview.resultIntegrity || preview.verificationPending || activeExecution)) {
			status = append(stage, $('.basehalf-canvas-node-status.basehalf-video-state'));
			status.textContent = getBaseHalfNodeCardStatusText(localState);
			status.title = localState.message;
			status.setAttribute('role', 'status');
			status.setAttribute('aria-live', 'polite');
			status.setAttribute('aria-label', `${localState.status}: ${localState.message}`);
			status.classList.toggle('ready', isBaseHalfNodeCardStatusPositive(localState));
			status.classList.toggle('executing', !!activeExecution);
		}

		const progress = append(stage, $('.basehalf-canvas-node-progress.basehalf-video-progress'));
		const progressValue = append(progress, $('.basehalf-canvas-node-progress-value'));
		const executionProgress = activeExecution?.progress;
		progress.hidden = !activeExecution;
		progress.classList.toggle('indeterminate', activeExecution !== undefined && executionProgress === undefined);
		progressValue.style.width = executionProgress === undefined ? '36%' : `${Math.max(0, Math.min(100, executionProgress))}%`;
		progress.setAttribute('role', 'progressbar');
		progress.setAttribute('aria-label', activeExecution ? `${localState.status}: ${localState.message}` : localize('basehalf.canvas.videoProgress.inactive', "No active video generation"));
		if (executionProgress !== undefined) {
			progress.setAttribute('aria-valuemin', '0');
			progress.setAttribute('aria-valuemax', '100');
			progress.setAttribute('aria-valuenow', String(Math.round(Math.max(0, Math.min(100, executionProgress)))));
		}

		this.renderedNodeChromeByPath.set(item.path, {
			card,
			title: preview.document.title,
			...(status ? { status } : {}),
			progress,
			progressValue
		});
	}

	private renderNodeActions(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>,
		localState: ReturnType<typeof nodeLocalStateForCardPreview>,
		activeExecution: IBaseHalfNodeExecutionState | undefined,
		listeners: DisposableStore,
		card: HTMLElement,
		chrome: Omit<IBaseHalfRenderedNodeChrome, 'card' | 'title'>
	): void {
		const actions = append(container, $('.basehalf-canvas-node-actions'));
		if (!baseHalfNodeLocalPrimaryActionOpensSurface(localState.action)) {
			const edit = append(actions, $('button.basehalf-canvas-node-edit')) as HTMLButtonElement;
			edit.classList.add('nodrag', 'nopan', 'nowheel');
			edit.type = 'button';
			edit.textContent = preview.document.attempts.length > 0 || preview.document.result ? 'Details' : 'Configure';
			edit.title = preview.document.attempts.length > 0 || preview.document.result
				? 'View this sealed node and its Attempts'
				: 'Configure this Draft and view its Attempts';
			edit.setAttribute('aria-label', edit.title);
			listeners.add(this.addDisposableListener(edit, 'pointerdown', event => event.stopPropagation()));
			listeners.add(this.addDisposableListener(edit, 'dblclick', event => {
				event.preventDefault();
				event.stopPropagation();
			}));
			listeners.add(this.addDisposableListener(edit, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				this.selectCard(item.path);
				void this.showNodeLocalSurface(item, edit);
			}));
		}
		const action = append(actions, $('button.basehalf-canvas-node-action')) as HTMLButtonElement;
		action.classList.add('nodrag', 'nopan', 'nowheel');
		action.type = 'button';
		action.textContent = preview.document.kind === 'video' && preview.document.result && localState.action.kind === 'locate'
			? localize('basehalf.canvas.video.open', "Open Video")
			: localState.action.label;
		action.dataset.nodeAction = localState.action.kind;
		const isRunAction = localState.action.kind === 'run' || localState.action.kind === 'retry';
		const actionUnavailable = (isRunAction && !localState.ready)
			|| localState.action.kind === 'wait'
			|| activeExecution?.phase === 'cancelling'
			|| preview.execution?.phase === 'cancelling';
		action.setAttribute('aria-disabled', String(actionUnavailable));
		action.title = `${localState.action.label}: ${localState.message}`;
		action.setAttribute('aria-label', action.title);
		if (actionUnavailable && chrome.status) {
			const statusElement = chrome.status;
			listeners.add(this.addDisposableListener(action, 'focus', () => {
				statusElement.textContent = localState.message;
				statusElement.classList.add('explaining-action');
			}));
			listeners.add(this.addDisposableListener(action, 'blur', () => {
				statusElement.textContent = getBaseHalfNodeCardStatusText(localState);
				statusElement.classList.remove('explaining-action');
			}));
		}
		this.renderedNodeChromeByPath.set(item.path, {
			card,
			title: preview.document.title,
			...(chrome.status ? { status: chrome.status } : {}),
			action,
			...(chrome.progress ? { progress: chrome.progress } : {}),
			...(chrome.progressValue ? { progressValue: chrome.progressValue } : {})
		});
		listeners.add(this.addDisposableListener(action, 'pointerdown', event => event.stopPropagation()));
		listeners.add(this.addDisposableListener(action, 'dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		}));
		listeners.add(this.addDisposableListener(action, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			if (action.getAttribute('aria-disabled') === 'true') {
				this.queueCanvasWarning(localState.message);
				this.requestRender();
				return;
			}
			this.selectCard(item.path);
			switch (action.dataset.nodeAction) {
				case 'cancel': {
					const active = this.nodeExecutionService.getActiveRun(item.stat.resource);
					if (active && this.nodeExecutionService.cancel(item.stat.resource, active.runId)) {
						return;
					}
					this.queueCanvasWarning('That run already changed. The active run was not cancelled.');
					this.requestRender();
					return;
				}
				case 'wait':
					return;
				case 'add':
				case 'configure':
					void this.showNodeLocalSurface(item, action);
					return;
				case 'import':
					void this.importCanvasNodeResult(item);
					return;
				case 'locate':
					void this.locateNodeResult(item);
					return;
				case 'copy':
					void this.copyCanvasNodeSettings(item);
					return;
				case 'recover':
					void this.recoverInterruptedCanvasNode(item);
					return;
				case 'run':
				case 'retry':
					void this.runCanvasNode(item);
			}
		}));
	}

	private async copyCanvasNodeSettings(item: IBaseHalfCanvasItem): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		try {
			await this.performSceneSelectionAction(this.sceneKey(folder), this.renderedSceneStructuralEpoch, 'duplicate', [item.path]);
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
		}
	}

	private async recoverInterruptedCanvasNode(item: IBaseHalfCanvasItem): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		try {
			await this.nodeExecutionService.recoverInterrupted({
				resource: item.stat.resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath: item.path
			});
		} catch (error) {
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
		} finally {
			this.requestRender();
		}
	}

	private async runCanvasNode(item: IBaseHalfCanvasItem): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		if (this.workingCopyService.isDirty(item.stat.resource)) {
			this.queueCanvasWarning('Save this node before running it.');
			this.requestRender();
			return;
		}
		try {
			const authorization = await this.confirmVideoProviderRun(item);
			if (authorization === false) {
				return;
			}
			await this.nodeExecutionService.run({
				resource: item.stat.resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath: item.path
			}, authorization);
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
		}
	}

	private async confirmVideoProviderRun(item: IBaseHalfCanvasItem): Promise<false | Readonly<{
		readonly providerAuthorization?: IBaseHalfNodeProviderRunAuthorization;
	}>> {
		const folder = this.getCurrentFolder();
		if (!folder) {
			return false;
		}
		const content = await this.fileService.readFile(item.stat.resource, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		const initialDocument = parseBaseHalfNodeDocumentBytes(content.value.buffer);
		const initialRecipeState = initialDocument.recipe;
		if (!initialRecipeState) {
			return Object.freeze({});
		}
		const initialRecipe = this.canvasRecipeRegistryService.getRecipe(initialRecipeState.recipeId);
		if (initialDocument.kind !== 'video' || initialRecipe?.modelCapability !== 'video' || !initialRecipe.videoModelCatalogId) {
			return Object.freeze({});
		}

		// Authorization is created only after the host has completed the same
		// provider preflight that run() will repeat. The disclosure below is derived
		// from this exact document, never from a later mutable Composer snapshot.
		const preflight = await this.nodeExecutionService.prepareProviderRun({
			resource: item.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: item.path
		});
		const document = preflight.document;
		const recipeState = document.recipe;
		if (!recipeState) {
			throw new Error('The provider preflight returned a Video Draft without a Recipe.');
		}
		const recipe = this.canvasRecipeRegistryService.getRecipe(recipeState.recipeId);
		if (document.kind !== 'video' || recipe?.modelCapability !== 'video' || !recipe.videoModelCatalogId) {
			throw new Error('The provider preflight no longer resolves to an executable reviewed Video Recipe.');
		}

		const snapshot = parseBaseHalfVideoModelSelectionSnapshot(
			recipeState.parameters[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID],
			recipe.videoModelCatalogId
		);
		const registry = baseHalfVideoRegistryForRecipe(this.videoModelCatalogService, recipe);
		const resolution = registry.resolve({
			provider: snapshot.providerId,
			deployment: snapshot.deploymentId,
			region: snapshot.region,
			modelId: snapshot.modelId,
			revision: snapshot.revision,
			mode: snapshot.mode,
			inputs: snapshot.inputs
		});
		const services = await this.modelServiceService.getServices(undefined, 'video');
		const service = services.find(candidate => candidate.id === recipeState.modelServiceId);
		const providerLabel = service?.label ?? snapshot.providerId;
		const modelLabel = resolution.status === 'supported' ? resolution.descriptor.label : snapshot.modelId;
		const methodLabel = BASEHALF_VIDEO_MODE_LABELS[snapshot.mode];
		let settingsLabel = localize('basehalf.canvas.videoAuthorization.settingsUnavailable', "No reviewed setting summary is available.");
		if (resolution.status === 'supported') {
			const normalization = normalizeBaseHalfVideoSettings(
				resolution,
				baseHalfVideoSettingsFromRecipeParameters(recipeState.parameters)
			);
			if (normalization.status === 'ready') {
				const summary = createBaseHalfVideoModelSettingsPresentation(resolution, normalization).settingsSummary;
				if (summary.length > 0) {
					settingsLabel = summary.map(token => `${token.label}: ${token.value}`).join(' · ');
				}
			}
		}

		const retry = preflight.authorizationKind === 'replacement';
		const confirmation = await this.dialogService.confirm({
			type: 'warning',
			message: retry
				? localize('basehalf.canvas.videoAuthorization.retryMessage', "Retry video generation with {0}?", modelLabel)
				: localize('basehalf.canvas.videoAuthorization.generateMessage', "Generate video with {0}?", modelLabel),
			detail: [
				localize('basehalf.canvas.videoAuthorization.provider', "Provider connection: {0}", providerLabel),
				localize('basehalf.canvas.videoAuthorization.model', "Model: {0}", modelLabel),
				localize('basehalf.canvas.videoAuthorization.method', "Method: {0}", methodLabel),
				localize('basehalf.canvas.videoAuthorization.settings', "Settings: {0}", settingsLabel),
				'',
				retry
					? localize('basehalf.canvas.videoAuthorization.retryDetail', "The existing task is inspected first. A new provider task is created only if the earlier task is proven failed or cancelled. The provider determines the exact charge.")
					: localize('basehalf.canvas.videoAuthorization.generateDetail', "This action may create a paid provider task. The provider determines the exact charge.")
			].join('\n'),
			primaryButton: retry
				? localize('basehalf.canvas.videoAuthorization.retryButton', "&&Retry")
				: localize('basehalf.canvas.videoAuthorization.generateButton', "&&Generate")
		});
		if (!confirmation.confirmed) {
			return false;
		}
		return Object.freeze({
			providerAuthorization: Object.freeze({
				kind: preflight.authorizationKind,
				requestFingerprint: preflight.requestFingerprint
			})
		});
	}

	private scheduleVideoModelConnectionResume(): void {
		if (!this.pendingVideoModelConnectionCompletion || this.videoModelConnectionResumeTimer !== undefined || this.disposed) {
			return;
		}
		this.videoModelConnectionResumeTimer = mainWindow.setTimeout(() => {
			this.videoModelConnectionResumeTimer = undefined;
			void this.resumeVideoModelConnection();
		}, 0);
	}

	private async resumeVideoModelConnection(): Promise<void> {
		const completion = this.pendingVideoModelConnectionCompletion;
		const target = completion?.intent.returnTarget;
		if (!completion || target?.kind !== 'videoModel' || this.disposed) {
			return;
		}
		// Completion fires immediately before Settings closes. Wait
		// for its editor-change event so the Composer is mounted in the visible
		// BaseHalf canvas rather than behind the settings editor.
		if (this.editorService.activeEditor?.typeId === SettingsEditor2Input.ID) {
			return;
		}
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== target.sceneKey || this.canvasNavigationService.state.cardDetail) {
			this.pendingVideoModelConnectionCompletion = undefined;
			return;
		}
		const item = this.renderedItemsByPath.get(target.nodePath);
		const anchor = this.renderedCardElementsByPath.get(target.nodePath);
		if (!item || !anchor?.isConnected || this.activeNodeLocalSurface) {
			this.pendingVideoModelConnectionCompletion = undefined;
			return;
		}
		await this.showNodeLocalSurface(item, anchor);
	}

	private showNodeLocalSurface(item: IBaseHalfCanvasItem, anchor: HTMLElement): Promise<void> {
		const intent = ++this.nodeLocalSurfaceIntent;
		const open = async () => {
			if (intent !== this.nodeLocalSurfaceIntent) {
				return;
			}
			// Direct actions (notably keyboard Enter) can ask for a Video Composer
			// before React Flow's asynchronous selection transaction has retired an
			// inline Note editor. Keep one authoring owner: finish the Note's format
			// and save barrier before mounting the Composer, then recheck this open
			// intent because either wait may have been superseded.
			if (this.activeCanvasNoteEditor
				&& (!await this.closeActiveCanvasNoteEditorAfterFormats(false) || intent !== this.nodeLocalSurfaceIntent)) {
				return;
			}
			// A Note surface may be accepted but not mounted yet while a format/open
			// transaction owns it. Its normal selection continuation will either
			// retire it and schedule this Composer, or retain it; do not create a
			// second invisible authoring owner in the meantime.
			if (this.canvasNoteSurfacePath && !this.activeCanvasNoteEditor) {
				return;
			}
			const active = this.activeNodeLocalSurface;
			if (active?.path === item.path) {
				return;
			}
			if (active && !await active.closeForSwitch()) {
				this.selectCard(active.path);
				return;
			}
			if (intent !== this.nodeLocalSurfaceIntent) {
				return;
			}
			await this.openNodeLocalSurface(item, anchor, intent);
		};
		const queued = this.nodeLocalSurfaceOpenChain.then(open, open);
		this.nodeLocalSurfaceOpenChain = queued.catch(error => {
			this.logService.warn(error);
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
		});
		return this.nodeLocalSurfaceOpenChain;
	}

	private async openNodeLocalSurface(item: IBaseHalfCanvasItem, anchor: HTMLElement, intent: number): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder || this.canvasNavigationService.state.cardDetail) {
			return;
		}

		let content: IFileContent;
		let document: IBaseHalfNodeDocument;
		try {
			content = await this.fileService.readFile(item.stat.resource, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			const active = this.nodeExecutionService.getActiveRun(item.stat.resource);
			document = active
				? parseBaseHalfNodeDocumentBytesForActiveHost(content.value.buffer)
				: parseBaseHalfNodeDocumentBytes(content.value.buffer);
		} catch (error) {
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
			return;
		}

		let modelServices: readonly IBaseHalfModelServiceDescriptor[] = [];
		try {
			modelServices = await this.modelServiceService.getServices();
		} catch (error) {
			this.logService.warn(error);
		}
		let inbound = await this.readNodeInboundSources(folder, item);
		const currentFolder = this.getCurrentFolder();
		const resolveLiveCardAnchor = (): HTMLElement => {
			const mapped = this.renderedCardElementsByPath.get(item.path);
			return this.resolveLiveCanvasCard(item.path)
				?? (mapped?.isConnected ? mapped : anchor);
		};
		const currentAnchor = resolveLiveCardAnchor();
		if (intent !== this.nodeLocalSurfaceIntent
			|| this.canvasNavigationService.state.cardDetail
			|| !currentFolder
			|| this.sceneKey(currentFolder) !== this.sceneKey(folder)
			|| !currentAnchor.isConnected) {
			return;
		}
		let inboundSources = inbound.sources;
		let inputKinds = baseHalfNodeInboundInputKinds(inboundSources);
		let inputResultIdentities = new Map(inboundSources.flatMap(source => source.resultIdentity
			? [[source.path, source.resultIdentity] as const]
			: []));
		let directSourcePaths = Object.freeze(inboundSources.map(source => source.path));
		let directSourceProblems: ReadonlyMap<string, string> = new Map();
		let recipes = this.canvasRecipeRegistryService.getRecipes()
			.filter(recipe => baseHalfCanvasRecipeMatchesNodeKind(recipe, document.kind));
		const videoGeneratorRecipes = (): readonly IBaseHalfCanvasRecipeDescriptor[] => recipes;
		const implicitVideoRecipe = resolveBaseHalfNodeImplicitVideoRecipe(document, recipes);
		let selectedRecipeId = document.recipe?.recipeId ?? implicitVideoRecipe?.id ?? '';
		let selectedRecipe = document.recipe
			? this.canvasRecipeRegistryService.getRecipe(selectedRecipeId)
			: implicitVideoRecipe;
		if (selectedRecipe && !baseHalfCanvasRecipeMatchesNodeKind(selectedRecipe, document.kind)) {
			selectedRecipe = undefined;
		}
		let resultPreview: Awaited<ReturnType<BaseHalfCanvasWorkbenchContribution['readNodeResultPreview']>> = document.result
			? await this.readNodeResultPreview(folder, document, true)
			: {};
		let verificationPending = false;
		let draftParameters: Record<string, BaseHalfNodeParameterDraftValue> = selectedRecipe?.modelCapability === 'video'
			? baseHalfVideoParameterDraftFromRecipeParameters(document.recipe?.parameters, selectedRecipe.videoModelCatalogId)
			: selectedRecipe
				? { ...createBaseHalfNodeParameterDraft(selectedRecipe, document.recipe?.parameters ?? {}) }
				: {};
		let localRecipeNeedsModelCleanup = !!selectedRecipe
			&& selectedRecipe.modelCapability === undefined
			&& !!(document.recipe?.modelServiceId || document.recipe?.modelId);
		let draftModelServiceId = localRecipeNeedsModelCleanup ? undefined : document.recipe?.modelServiceId;
		let draftModelId = localRecipeNeedsModelCleanup ? undefined : document.recipe?.modelId;
		let draftVideoModelKey = selectedRecipe?.modelCapability === 'video'
			? baseHalfVideoModelKeyFromParameterDraft(draftParameters, selectedRecipe.videoModelCatalogId)
			: undefined;
		let draftBindings = document.recipe?.inputBindings ?? [];
		let draftTitle = document.title;
		let draftRole = document.role;
		let draftPrompt = document.prompt;
		const videoComposer = document.kind === 'video';
		if (videoComposer && document.result && !resultPreview.resultIntegrity) {
			this.consumePreparedVideoComposer(item.path);
			return;
		}
		let localSurfaceMode: 'configure' | 'attempts' = document.kind === 'video'
			? 'configure'
			: document.result || document.attempts.length > 0 ? 'attempts' : 'configure';
		let videoComposerOverlay: BaseHalfVideoComposerOverlay | undefined;
		let videoComposerOverlayFocusKey: string | undefined;
		let videoInputCanvasPickState: IBaseHalfVideoCanvasPickState = createBaseHalfVideoCanvasPickState();
		let attemptsVisibleCount = 50;
		const expandedAttemptDisclosures = new Set<string>();
		const removedConnections = new Set<string>();
		const configurationDraft = (): IBaseHalfNodeLocalConfigurationDraft => ({
			title: draftTitle,
			role: draftRole,
			prompt: draftPrompt,
			recipeId: selectedRecipeId,
			parameters: draftParameters,
			...(draftModelServiceId === undefined ? {} : { modelServiceId: draftModelServiceId }),
			...(draftModelId === undefined ? {} : { modelId: draftModelId }),
			inputBindings: draftBindings
		});
		const configurationDraftFromDocument = (
			candidate: IBaseHalfNodeDocument,
			candidateRecipes: readonly IBaseHalfCanvasRecipeDescriptor[] = recipes
		): IBaseHalfNodeLocalConfigurationDraft => {
			const implicitRecipe = resolveBaseHalfNodeImplicitVideoRecipe(candidate, candidateRecipes);
			const recipeId = candidate.recipe?.recipeId ?? implicitRecipe?.id ?? '';
			const recipe = candidate.recipe
				? this.canvasRecipeRegistryService.getRecipe(recipeId)
				: implicitRecipe;
			const matchingRecipe = recipe && baseHalfCanvasRecipeMatchesNodeKind(recipe, candidate.kind) ? recipe : undefined;
			const preservesModelSelection = !matchingRecipe || matchingRecipe.modelCapability !== undefined;
			return {
				title: candidate.title,
				role: candidate.role,
				prompt: candidate.prompt,
				recipeId,
				parameters: matchingRecipe?.modelCapability === 'video'
					? baseHalfVideoParameterDraftFromRecipeParameters(candidate.recipe?.parameters, matchingRecipe.videoModelCatalogId)
					: matchingRecipe
						? { ...createBaseHalfNodeParameterDraft(matchingRecipe, candidate.recipe?.parameters ?? {}) }
						: {},
				...(!preservesModelSelection || candidate.recipe?.modelServiceId === undefined ? {} : { modelServiceId: candidate.recipe.modelServiceId }),
				...(!preservesModelSelection || candidate.recipe?.modelId === undefined ? {} : { modelId: candidate.recipe.modelId }),
				inputBindings: candidate.recipe?.inputBindings ?? []
			};
		};
		const applyConfigurationDraft = (draft: IBaseHalfNodeLocalConfigurationDraft): void => {
			draftTitle = draft.title;
			draftRole = draft.role;
			draftPrompt = draft.prompt;
			selectedRecipeId = draft.recipeId;
			selectedRecipe = this.canvasRecipeRegistryService.getRecipe(selectedRecipeId);
			if (selectedRecipe && !baseHalfCanvasRecipeMatchesNodeKind(selectedRecipe, document.kind)) {
				selectedRecipe = undefined;
			}
			draftParameters = { ...draft.parameters };
			draftModelServiceId = draft.modelServiceId;
			draftModelId = draft.modelId;
			draftVideoModelKey = selectedRecipe?.modelCapability === 'video'
				? baseHalfVideoModelKeyFromParameterDraft(draftParameters, selectedRecipe.videoModelCatalogId)
				: undefined;
			draftBindings = draft.inputBindings.map(binding => ({ ...binding }));
		};
		const documentConfigurationKey = (candidate: IBaseHalfNodeDocument): string => stableStringify({
			title: candidate.title,
			role: candidate.role,
			prompt: candidate.prompt,
			recipe: candidate.recipe ? {
				recipeId: candidate.recipe.recipeId,
				modelServiceId: candidate.recipe.modelServiceId,
				modelId: candidate.recipe.modelId,
				parameters: Object.entries(candidate.recipe.parameters).sort(([left], [right]) => left.localeCompare(right)),
				inputBindings: candidate.recipe.inputBindings
			} : undefined
		});
		const draftStateKeyFor = (draft: IBaseHalfNodeLocalConfigurationDraft, removed: readonly string[] = []): string => stableStringify({
			...draft,
			parameters: Object.entries(draft.parameters).sort(([left], [right]) => left.localeCompare(right)),
			removedConnections: [...removed].sort()
		});
		const draftStateKey = () => draftStateKeyFor(configurationDraft(), [...removedConnections]);
		let configurationBaseline = configurationDraftFromDocument(document);
		let latestExternalConfiguration = configurationBaseline;
		let savedDocumentConfigurationKey = documentConfigurationKey(document);
		let videoInputTransactionOwnerState = createBaseHalfVideoInputTransactionOwnerState();
		let syncVideoInputTransactionPresentation = () => { };
		const acquireVideoInputTransaction = (): number | undefined => {
			const acquisition = acquireBaseHalfVideoInputTransaction(videoInputTransactionOwnerState);
			videoInputTransactionOwnerState = acquisition.state;
			if (acquisition.transactionId !== undefined) {
				syncVideoInputTransactionPresentation();
			}
			return acquisition.transactionId;
		};
		const releaseVideoInputTransaction = (transactionId: number): void => {
			const nextState = releaseBaseHalfVideoInputTransaction(videoInputTransactionOwnerState, transactionId);
			if (nextState === videoInputTransactionOwnerState) {
				return;
			}
			videoInputTransactionOwnerState = nextState;
			syncVideoInputTransactionPresentation();
		};
		let videoInputDocumentTransitionAck: {
			readonly transactionId: number;
			readonly acknowledgement: IBaseHalfVideoDocumentWriteAcknowledgement;
		} | undefined;
		const registerVideoInputDocumentTransition = (
			transactionId: number,
			previousKey: string,
			nextKey: string,
			previousEtag: string
		): typeof videoInputDocumentTransitionAck => {
			if (!baseHalfVideoInputTransactionIsCurrent(videoInputTransactionOwnerState, transactionId)) {
				return undefined;
			}
			const previousAck = videoInputDocumentTransitionAck;
			videoInputDocumentTransitionAck = {
				transactionId,
				acknowledgement: createBaseHalfVideoDocumentWriteAcknowledgement(
					nextKey,
					{ configurationKey: previousKey, etag: previousEtag },
					previousAck?.acknowledgement.ownVersions
				)
			};
			return previousAck;
		};
		const settleVideoInputDocumentTransition = (transactionId: number, expectedKey: string, observedKey: string, observedEtag: string): boolean => {
			if (videoInputDocumentTransitionAck?.transactionId !== transactionId
				|| videoInputDocumentTransitionAck.acknowledgement.expectedConfigurationKey !== expectedKey) {
				return false;
			}
			const confirmation = confirmBaseHalfVideoDocumentWriteAcknowledgement(
				videoInputDocumentTransitionAck.acknowledgement,
				{ configurationKey: observedKey, etag: observedEtag }
			);
			videoInputDocumentTransitionAck = confirmation.acknowledgement
				? { transactionId, acknowledgement: confirmation.acknowledgement }
				: undefined;
			return confirmation.confirmed;
		};
		const restoreVideoInputDocumentTransition = (
			transactionId: number,
			expectedKey: string,
			previousAck: typeof videoInputDocumentTransitionAck
		): void => {
			if (videoInputDocumentTransitionAck?.transactionId === transactionId
				&& videoInputDocumentTransitionAck.acknowledgement.expectedConfigurationKey === expectedKey) {
				videoInputDocumentTransitionAck = previousAck;
			}
		};
		const clearVideoInputDocumentTransition = (transactionId: number): void => {
			if (videoInputDocumentTransitionAck?.transactionId === transactionId) {
				videoInputDocumentTransitionAck = undefined;
			}
		};
		let configurationConflict: readonly string[] | undefined;
		let refreshFailure: string | undefined;
		let savedDraftState = localRecipeNeedsModelCleanup
			? `${draftStateKey()}\u0000legacy-model-selection`
			: draftStateKey();
			let modelConnectionResumeNotice: string | undefined;
			let modelConnectionResumeAdjustments: readonly IBaseHalfVideoSettingAdjustment[] = [];
		const pendingModelConnection = this.pendingVideoModelConnectionCompletion;
		const pendingModelTarget = pendingModelConnection?.intent.returnTarget;
		if (pendingModelConnection && pendingModelTarget?.kind === 'videoModel'
			&& pendingModelTarget.sceneKey === this.sceneKey(folder)
			&& pendingModelTarget.nodePath === item.path) {
			// The returned path now owns this one-shot completion. Consume it even
			// when its immutable document identity has become stale so a path reused
			// by a different node can never inherit the model choice later.
			this.pendingVideoModelConnectionCompletion = undefined;
			const targetRecipe = recipes.find(candidate => candidate.id === pendingModelTarget.recipeId
				&& candidate.modelCapability === 'video'
				&& baseHalfCanvasRecipeMatchesNodeKind(candidate, document.kind));
			const spec = this.modelProviderCatalogService.getConnectionSpec(pendingModelConnection.intent.specId);
			const service = modelServices.find(candidate => candidate.id === pendingModelConnection.serviceId);
			const catalogId = targetRecipe?.videoModelCatalogId;
			const registry = baseHalfVideoRegistryForRecipe(this.videoModelCatalogService, targetRecipe);
			const descriptor = registry.models.find(candidate =>
				candidate.key.provider === pendingModelTarget.modelKey.provider
				&& candidate.key.deployment === pendingModelTarget.modelKey.deployment
				&& candidate.key.region === pendingModelTarget.modelKey.region
				&& candidate.key.modelId === pendingModelTarget.modelKey.modelId
				&& candidate.key.revision === pendingModelTarget.modelKey.revision);
			const mutable = !document.result && document.attempts.length === 0 && !this.nodeExecutionService.getActiveRun(item.stat.resource);
			if (pendingModelTarget.documentId === document.id
				&& mutable
				&& targetRecipe
				&& targetRecipe.extensionId === spec?.extensionId
				&& catalogId === pendingModelTarget.catalogId
				&& spec.capabilities.includes('video')
				&& spec.providerId === pendingModelTarget.modelKey.provider
				&& spec.deploymentId === pendingModelTarget.modelKey.deployment
				&& spec.region === pendingModelTarget.modelKey.region
				&& service?.configured
				&& service.specId === spec.id
				&& isBaseHalfPublicHttpsBearerModelServiceConfiguration(service)
					&& descriptor
					&& !descriptor.availability
					&& baseHalfVideoModelMatchesServiceScope(descriptor, service)) {
					const candidate = baseHalfVideoSettingsFromParameterDraft(draftParameters);
					const savedMode = candidate[BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID];
					const previousMode = typeof savedMode === 'string' && (BASEHALF_VIDEO_GENERATION_MODES as readonly string[]).includes(savedMode)
						? savedMode as BaseHalfVideoGenerationMode
						: undefined;
					if (selectedRecipe?.id !== targetRecipe.id) {
					// Recipe is an implementation detail of the user-facing model choice.
					// Provider identity, snapshots, and parameters belong to that owner.
					// Input bindings do not: retain them for capability reconciliation so
					// incompatible roles remain explicit in Needs review.
					selectedRecipeId = targetRecipe.id;
					selectedRecipe = targetRecipe;
					draftModelServiceId = undefined;
					draftModelId = undefined;
					draftVideoModelKey = undefined;
						localRecipeNeedsModelCleanup = false;
					}
				draftModelServiceId = service.id;
				draftModelId = descriptor.key.modelId;
				draftVideoModelKey = descriptor.key;
						const inputs = baseHalfVideoInputState(draftPrompt, draftBindings, inputKinds);
					const reconciliation = reconcileBaseHalfVideoModelSettings(descriptor, previousMode, candidate, inputs);
					modelConnectionResumeAdjustments = reconciliation.normalization?.adjustments ?? [];
					if (reconciliation.status === 'ready') {
						const resolution = registry.resolveCapability({ ...descriptor.key, mode: reconciliation.mode });
						if (resolution.status === 'supported') {
							draftParameters = baseHalfVideoSettingsAsParameterDraft(
								reconciliation.normalization.values,
								createBaseHalfVideoModelSelectionSnapshotFromCapability(catalogId, resolution, inputs)
							);
						}
							modelConnectionResumeNotice = reconciliation.methodChanged && reconciliation.previousMode
								? localize(
									'basehalf.canvas.videoComposer.unlockedModelMethodReconciled',
									"{0} is ready. Generation method changed from {1} to {2}.",
									descriptor.label,
									BASEHALF_VIDEO_MODE_LABELS[reconciliation.previousMode],
									BASEHALF_VIDEO_MODE_LABELS[reconciliation.mode]
								)
								: localize(
									'basehalf.canvas.videoComposer.modelUnlocked',
									"{0} is ready. Review this Draft before generating.",
									descriptor.label
								);
					} else {
						if (reconciliation.normalization) {
							draftParameters = baseHalfVideoSettingsAsParameterDraft(reconciliation.normalization.values);
						}
						modelConnectionResumeNotice = reconciliation.reason;
					}
					videoComposerOverlay = 'settings';
			} else {
				modelConnectionResumeNotice = localize(
					'basehalf.canvas.videoComposer.modelUnlockTargetStale',
					"That model setup no longer matches this editable Draft. Choose the model again."
				);
				videoComposerOverlay = 'models';
			}
		}
		let allowNextHide = false;
		let restoreFocusAfterIntentionalHide = true;
		let disposeMountedVideoComposer: ((restoreFocus: boolean) => void) | undefined;
		let configurationCurrentlyMutable = !document.result && document.attempts.length === 0;
		let saveDraftImplementation: () => Promise<boolean> = async () => false;
		let saveLockedModelNavigationDraftImplementation: () => Promise<boolean> = async () => false;
		let checkpointVideoInputConfigurationImplementation: (transactionId: number) => Promise<boolean> = async () => false;
		let pendingDraftSave: Promise<boolean> | undefined;
		const runDraftSave = (implementation: () => Promise<boolean>): Promise<boolean> => {
			if (pendingDraftSave) {
				return pendingDraftSave;
			}
			const pending = Promise.resolve().then(() => implementation());
			pendingDraftSave = pending;
			pending.then(
				() => {
					if (pendingDraftSave === pending) {
						pendingDraftSave = undefined;
					}
				},
				() => {
					if (pendingDraftSave === pending) {
						pendingDraftSave = undefined;
					}
				}
			);
			return pending;
		};
		const saveDraft = (): Promise<boolean> => runDraftSave(saveDraftImplementation);
		const saveLockedModelNavigationDraft = (): Promise<boolean> => runDraftSave(saveLockedModelNavigationDraftImplementation);
		const checkpointVideoInputConfiguration = (transactionId: number): Promise<boolean> => runDraftSave(
			() => checkpointVideoInputConfigurationImplementation(transactionId)
		);
		const draftExitCoordinator = new BaseHalfNodeLocalDraftExitCoordinator();
		let revealConfigureMode = () => { };
		const hasDraftChanges = () => draftStateKey() !== savedDraftState;
		const focusAnchor = () => {
			const liveAnchor = resolveLiveCardAnchor();
			if (liveAnchor.isConnected) {
				liveAnchor.focus({ preventScroll: true });
				return;
			}
			this.root.focus({ preventScroll: true });
		};
		const hideIntentionally = async (restoreFocus = true): Promise<void> => {
			this.consumePreparedVideoComposer(item.path);
			if (videoComposer) {
				disposeMountedVideoComposer?.(restoreFocus);
				return;
			}
			allowNextHide = true;
			restoreFocusAfterIntentionalHide = restoreFocus;
			this.contextViewService.hideContextView();
		};
		const chooseDraftExit = async (): Promise<'save' | 'discard' | 'keep'> => {
			if (videoComposer) {
				if (!configurationCurrentlyMutable) {
					const { result } = await this.dialogService.prompt<'discard'>({
						message: 'Generation started before these edits were saved.',
						detail: 'This Attempt uses the last saved prompt and settings. Copy anything you need from the Composer, then discard these local edits or keep it open.',
						buttons: [{ label: 'Discard local edits', run: () => 'discard' }],
						cancelButton: 'Keep Composer open'
					});
					return result ?? 'keep';
				}
				return 'save';
			}
			const { result } = await this.dialogService.prompt<'save' | 'discard'>({
				message: `Save changes to '${draftTitle.trim() || item.name}'?`,
				detail: 'Title, recipe, model, parameters, and input choices stay local only after they are saved.',
				buttons: [
					{ label: 'Save', run: () => 'save' },
					{ label: 'Discard', run: () => 'discard' }
				],
				cancelButton: 'Keep editing'
			});
			return result ?? 'keep';
		};
		const requestLeaveSurface = (
			after?: () => void | Promise<void>,
			restoreFocus = true,
			saveForExit: () => Promise<boolean> = saveDraft
		): Promise<boolean> => {
			return draftExitCoordinator.request(async () => {
				if (pendingDraftSave) {
					await pendingDraftSave;
				}
				let accepted = await resolveBaseHalfNodeLocalDraftExit(hasDraftChanges(), chooseDraftExit, saveForExit);
				if (!accepted && videoComposer && configurationCurrentlyMutable && hasDraftChanges()) {
					const { result } = await this.dialogService.prompt<'retry' | 'discard'>({
						message: localize('basehalf.canvas.videoComposer.saveFailed', "The Video Draft could not be saved."),
						detail: localize('basehalf.canvas.videoComposer.saveFailedDetail', "Fix the issue and retry, discard only the local Composer edits, or keep the Composer open."),
						buttons: [
							{ label: localize('basehalf.canvas.videoComposer.retrySave', "Retry Save"), run: () => 'retry' },
							{ label: localize('basehalf.canvas.videoComposer.discardLocalEdits', "Discard Local Edits"), run: () => 'discard' }
						],
						cancelButton: localize('basehalf.canvas.videoComposer.keepOpen', "Keep Composer Open")
					});
					if (result === 'retry') {
						accepted = await saveForExit();
					} else if (result === 'discard') {
						applyConfigurationDraft(configurationBaseline);
						removedConnections.clear();
						configurationConflict = undefined;
						savedDraftState = draftStateKeyFor(configurationBaseline);
						accepted = true;
					}
				}
				if (!accepted) {
					revealConfigureMode();
					return false;
				}
				await hideIntentionally(restoreFocus);
				await after?.();
				return true;
			});
		};
		const leaveSurface = async (after?: () => void | Promise<void>): Promise<void> => {
			await requestLeaveSurface(after);
		};
		const recoverImplicitDismiss = (): Promise<boolean> => draftExitCoordinator.request(async () => {
			if (pendingDraftSave) {
				await pendingDraftSave;
			}
			return resolveBaseHalfNodeLocalDraftExit(hasDraftChanges(), chooseDraftExit, saveDraft);
		});
		let pendingImplicitDismissRecovery: Promise<void> | undefined;
		const retainImplicitDismiss = (): void => {
			if (pendingImplicitDismissRecovery) {
				return;
			}
			const pending = (async () => {
				let accepted = false;
				try {
					accepted = await recoverImplicitDismiss();
				} catch (error) {
					this.logService.warn(error);
					this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				}
					if (accepted) {
						this.consumePreparedVideoComposer(item.path);
						if (this.activeNodeLocalSurface === localSurfaceController) {
						this.activeNodeLocalSurface = undefined;
					}
					focusAnchor();
					return;
				}
			revealConfigureMode();
				this.activeNodeLocalSurface = localSurfaceController;
				if (!this.disposed) {
					this.contextViewService.showContextView(delegate);
				}
			})();
			pendingImplicitDismissRecovery = pending;
			pending.then(
				() => {
					if (pendingImplicitDismissRecovery === pending) {
						pendingImplicitDismissRecovery = undefined;
					}
				},
				() => {
					if (pendingImplicitDismissRecovery === pending) {
						pendingImplicitDismissRecovery = undefined;
					}
				}
			);
		};
		const readLatestSurfaceState = async () => {
			const nextContent = await this.fileService.readFile(item.stat.resource, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			const active = this.nodeExecutionService.getActiveRun(item.stat.resource);
			const nextDocument = active
				? parseBaseHalfNodeDocumentBytesForActiveHost(nextContent.value.buffer)
				: parseBaseHalfNodeDocumentBytes(nextContent.value.buffer);
			let nextModelServices = modelServices;
			try {
				nextModelServices = await this.modelServiceService.getServices();
			} catch (error) {
				this.logService.warn(error);
			}
			const nextInbound = await this.readNodeInboundSources(folder, item);
			const nextInboundSources = nextInbound.sources;
			const nextInputKinds = baseHalfNodeInboundInputKinds(nextInboundSources);
			const nextInputResultIdentities = new Map(nextInboundSources.flatMap(source => source.resultIdentity
				? [[source.path, source.resultIdentity] as const]
				: []));
			const [nextDirectSourceProblems, nextResultPreview] = await Promise.all([
				this.readNodeDirectSourceProblems(folder, nextInboundSources, nextDocument.recipe?.inputBindings),
				this.readNodeResultPreview(folder, nextDocument, true)
			]);
			return {
				content: nextContent,
				document: nextDocument,
				modelServices: nextModelServices,
				inbound: nextInbound,
				inboundSources: nextInboundSources,
				inputKinds: nextInputKinds,
				inputResultIdentities: nextInputResultIdentities,
				directSourcePaths: Object.freeze(nextInboundSources.map(source => source.path)),
				directSourceProblems: nextDirectSourceProblems,
				recipes: this.canvasRecipeRegistryService.getRecipes()
					.filter(recipe => baseHalfCanvasRecipeMatchesNodeKind(recipe, nextDocument.kind)),
				resultPreview: nextResultPreview
			};
		};

		let showVideoDetails = async (): Promise<void> => { };
		let closeVideoTransientOverlay = (): void => { };
		let rebindVideoComposerScene = (_sceneKey: string, _structuralEpoch: number): void => { };
		let updateVideoInputPickViewport = (_visible: boolean): void => { };
		const localSurfaceController: IBaseHalfActiveNodeLocalSurface = {
			sceneKey: this.sceneKey(folder),
			path: item.path,
			resource: item.stat.resource,
			nodeId: document.id,
			nodeKind: document.kind,
			hasDraftChanges,
			prepareForImport: () => hasDraftChanges() ? saveDraft() : Promise.resolve(true),
			closeForSwitch: () => requestLeaveSurface(undefined, false),
			closeForShutdown: () => requestLeaveSurface(undefined, false),
			closeTransientOverlay: () => closeVideoTransientOverlay(),
			showVideoDetails: () => showVideoDetails(),
			rebindScene: (sceneKey, structuralEpoch) => rebindVideoComposerScene(sceneKey, structuralEpoch)
		};
		let focusLocalSurface = () => { };
		const anchorRect = currentAnchor.getBoundingClientRect();
		const anchorWindow = currentAnchor.ownerDocument.defaultView ?? mainWindow;
		const localSurfaceWidth = videoComposer ? BASEHALF_VIDEO_COMPOSER_WIDTH : 400;
		const placement = resolveBaseHalfNodeLocalSurfacePlacement(anchorRect, {
			width: anchorWindow.innerWidth,
			height: anchorWindow.innerHeight
		});
		const getLocalSurfaceAnchor = () => resolveLiveCardAnchor();
		let renderedLocalSurface: HTMLElement | undefined;
		const isNodeLocalSurfaceInteractionTarget = (target: EventTarget | null): boolean => {
			if (!isHTMLElement(target) && !isSVGElement(target)) {
				return false;
			}
			const videoToolbar = target.closest<HTMLElement>('.basehalf-video-context-toolbar');
			const liveVideoCard = videoComposer ? resolveLiveCardAnchor() : undefined;
			return renderedLocalSurface?.contains(target) === true
				|| (videoComposer
					&& (videoToolbar?.dataset.nodePath === item.path || liveVideoCard?.contains(target) === true));
		};

			const renderLocalSurface = (contextContainer: HTMLElement): IDisposable => {
					const store = new DisposableStore();
					const formListeners = new DisposableStore();
					store.add(formListeners);
					const canvasPickStore = new MutableDisposable<DisposableStore>();
					store.add(canvasPickStore);
					const surface = append(contextContainer, $('.basehalf-node-local-surface'));
					renderedLocalSurface = surface;
					store.add(toDisposable(() => {
						if (renderedLocalSurface === surface) {
							renderedLocalSurface = undefined;
						}
					}));
					surface.dataset.nodePath = item.path;
					if (videoComposer) {
						surface.classList.add('basehalf-video-composer');
						surface.style.setProperty('--basehalf-video-composer-width', `${localSurfaceWidth}px`);
						surface.dataset.placement = 'below';
					}
				const videoInputTransactionControlSelector = [
					'.basehalf-video-frame-slot-open',
					'.basehalf-video-frame-slot-replace',
					'.basehalf-video-frame-slot-remove',
					'.basehalf-video-frame-swap',
					'.basehalf-video-input-chip',
					'.basehalf-video-input-review',
					'.basehalf-video-input-add-trigger',
					'.basehalf-video-input-role',
					'.basehalf-video-input-replace',
					'.basehalf-video-input-remove',
					'.basehalf-video-input-add',
					'.basehalf-video-input-pick-action',
					'.basehalf-video-composer-primary'
				].join(', ');
				const syncTransactionPresentation = (): void => {
					const busy = videoInputTransactionOwnerState.activeTransactionId !== undefined;
					surface.classList.toggle('video-input-transaction-active', busy);
					for (const control of surface.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(videoInputTransactionControlSelector)) {
						if (busy) {
							if (control.dataset.videoInputTransactionDisabled === undefined) {
								control.dataset.videoInputTransactionDisabled = String(control.disabled);
							}
							control.disabled = true;
						} else if (control.dataset.videoInputTransactionDisabled !== undefined) {
							control.disabled = control.dataset.videoInputTransactionDisabled === 'true';
							delete control.dataset.videoInputTransactionDisabled;
						}
					}
				};
				syncVideoInputTransactionPresentation = syncTransactionPresentation;
				store.add(toDisposable(() => {
					if (syncVideoInputTransactionPresentation === syncTransactionPresentation) {
						syncVideoInputTransactionPresentation = () => { };
					}
				}));
				const closeForExternalInteraction = (event: Event): void => {
					if (draftExitCoordinator.isPending) {
						return;
					}
					if (videoComposer) {
						if (videoComposerOverlay && !surface.contains(event.target as Node)) {
							closeVideoComposerOverlay(false);
						}
						return;
					}
					if (isNodeLocalSurfaceInteractionTarget(event.target)) {
						return;
					}
					if (videoComposerOverlay) {
						closeVideoComposerOverlay(false);
						return;
					}
					if (hasDraftChanges()) {
						event.preventDefault();
						event.stopImmediatePropagation();
						void requestLeaveSurface(undefined, false);
						return;
					}
					void hideIntentionally(false);
				};
				store.add(this.addDisposableListener(surface.ownerDocument, 'pointerdown', closeForExternalInteraction, true));
				store.add(this.addDisposableListener(surface, 'pointerdown', event => {
					if (!videoComposerOverlay || (!isHTMLElement(event.target) && !isSVGElement(event.target))) {
						return;
					}
					if (event.target.closest('.basehalf-video-composer-popover')
						|| event.target.closest('.basehalf-video-model-trigger, .basehalf-video-settings-trigger, .basehalf-video-attempts-trigger, .basehalf-video-input-add-trigger')) {
						return;
					}
					closeVideoComposerOverlay(false);
				}, true));
				const onSurfaceEscape = (event: KeyboardEvent): void => {
					if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229 || draftExitCoordinator.isPending) {
						return;
					}
					if (videoComposer) {
						event.preventDefault();
						event.stopPropagation();
						if (!closeVideoComposerOverlay(true)) {
							focusAnchor();
						}
						return;
					}
					if (baseHalfNodeLocalSurfaceTargetOwnsEscape(event.target)) {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					void requestLeaveSurface();
				};
				if (videoComposer) {
					store.add(this.addDisposableListener(surface, 'keydown', onSurfaceEscape));
				} else {
					store.add(this.addDisposableListener(surface.ownerDocument, 'keydown', onSurfaceEscape));
				}
					let runVideoDraftFromSurface = () => { };
					store.add(this.addDisposableListener(surface, 'keydown', event => {
						if (!videoComposer || event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)
							|| event.defaultPrevented || event.isComposing || event.keyCode === 229) {
							return;
						}
						event.preventDefault();
						event.stopPropagation();
						runVideoDraftFromSurface();
					}));
				let liveExecutionRunId = this.nodeExecutionService.getActiveRun(item.stat.resource)?.runId;
				let refreshSequence = 0;
				let refreshDisposed = false;
				let surfaceComposing = false;
				let pendingAfterComposition: (() => void) | undefined;
				store.add(this.addDisposableListener(surface, 'compositionstart', () => {
					surfaceComposing = true;
				}, true));
				store.add(this.addDisposableListener(surface, 'compositionend', () => {
					surfaceComposing = false;
					const pending = pendingAfterComposition;
					pendingAfterComposition = undefined;
					pending?.();
				}, true));
					let refreshLiveExecutionPresentation = () => { };
					let refreshWorkingCopyPresentation = () => { };
					let refreshVideoSurfacePresentation = () => { };
					let queueSurfaceRefresh = () => { };
				let renderedConfigureBody: HTMLElement | undefined;
				let renderedAttemptsBody: HTMLElement | undefined;
				let stableVideoPromptInput: HTMLTextAreaElement | undefined;
					let videoSettingsNotice: string | undefined = modelConnectionResumeNotice
					?? (localRecipeNeedsModelCleanup
							? localize('basehalf.canvas.videoComposer.localModelCleanup', "This local generator no longer uses the legacy model selection. Save the Draft to remove it.")
							: undefined);
					let videoSettingsAdjustments: readonly IBaseHalfVideoSettingAdjustment[] = modelConnectionResumeAdjustments;
					let videoSettingsAdjustmentPreviousParameters: readonly IBaseHalfVideoParameterPresentation[] = [];
					let videoModelSearchQuery = '';
					let videoModelPickerRows: readonly IBaseHalfVideoModelRowPresentation[] = [];
					let videoModelPickerShowSearch = false;
					let videoModelFocusTargets = new Map<string, HTMLElement>();
					let requestedVideoModelRepairFocusLogicalKey: string | undefined;
				let renderedFocusTargets = new Map<string, HTMLElement>();
				let renderedFocusKeys = new WeakMap<HTMLElement, string>();
				const registerFocusTarget = <T extends HTMLElement>(element: T, key: string): T => {
					renderedFocusTargets.set(key, element);
					renderedFocusKeys.set(element, key);
					return element;
				};

				const captureSurfacePresentation = () => {
					const activeElement = surface.ownerDocument.activeElement;
					const focused = isHTMLElement(activeElement) && surface.contains(activeElement)
						? {
							key: renderedFocusKeys.get(activeElement),
							selectionStart: isHTMLInputElement(activeElement) || isHTMLTextAreaElement(activeElement)
								? activeElement.selectionStart
								: undefined,
							selectionEnd: isHTMLInputElement(activeElement) || isHTMLTextAreaElement(activeElement)
								? activeElement.selectionEnd
								: undefined
						}
						: undefined;
					return {
						focused,
						configureScrollTop: renderedConfigureBody?.scrollTop ?? 0,
						attemptsScrollTop: renderedAttemptsBody?.scrollTop ?? 0
					};
				};
				const restoreSurfacePresentation = (presentation: ReturnType<typeof captureSurfacePresentation>) => {
					if (renderedConfigureBody) {
						renderedConfigureBody.scrollTop = presentation.configureScrollTop;
					}
					if (renderedAttemptsBody) {
						renderedAttemptsBody.scrollTop = presentation.attemptsScrollTop;
					}
					if (!presentation.focused?.key || !surface.isConnected) {
						return;
					}
					const target = renderedFocusTargets.get(presentation.focused.key);
					if (!target) {
						return;
					}
					target.focus({ preventScroll: true });
					if ((isHTMLInputElement(target) || isHTMLTextAreaElement(target))
						&& presentation.focused.selectionStart !== undefined
						&& presentation.focused.selectionEnd !== undefined) {
						target.setSelectionRange(presentation.focused.selectionStart, presentation.focused.selectionEnd);
					}
				};
				let showVideoComposerOverlay: (overlay: BaseHalfVideoComposerOverlay, focusKey?: string) => void = overlay => {
					videoComposerOverlay = overlay;
				};
				let closeVideoComposerOverlay: (restoreFocus?: boolean) => boolean = () => false;
				let cancelVideoInputCanvasPickForChildOverlay = (): boolean => true;

				const renderSurface = () => {
					const presentation = captureSurfacePresentation();
					formListeners.clear();
					const retainedPrompt = stableVideoPromptInput && surface.contains(stableVideoPromptInput)
						? stableVideoPromptInput
						: undefined;
					if (retainedPrompt) {
						surface.appendChild(retainedPrompt);
					}
					for (const child of [...surface.children]) {
						if (child !== retainedPrompt) {
							child.remove();
						}
					}
					surface.dataset.view = videoComposer ? 'composer' : localSurfaceMode;
					renderedConfigureBody = undefined;
					renderedAttemptsBody = undefined;
					renderedFocusTargets = new Map();
					renderedFocusKeys = new WeakMap();
					let refreshSaveState = () => { };
					let refreshVideoPrimaryState = () => { };
					const active = this.nodeExecutionService.getActiveRun(item.stat.resource);
					const busy = !!active || document.attempts.some(attempt => attempt.status === 'running');
					const configurationMutable = !busy && !document.result && document.attempts.length === 0;
					const emptyVideoComposer = videoComposer
						&& configurationMutable
						&& !document.recipe
						&& !draftModelServiceId
						&& !draftModelId;
					configurationCurrentlyMutable = configurationMutable;
					const readActiveDirectSourcePaths = () => directSourcePaths.filter(path => !removedConnections.has(path));
					const readStructuralProblem = () => selectedRecipe
						? getBaseHalfNodeInputStructureProblem(selectedRecipe, draftBindings, inputKinds, readActiveDirectSourcePaths())
						: undefined;
					const readVideoModelState = (): IBaseHalfVideoComposerModelState => {
						const catalogId = selectedRecipe?.modelCapability === 'video' ? selectedRecipe.videoModelCatalogId : undefined;
						const registry = baseHalfVideoRegistryForRecipe(this.videoModelCatalogService, selectedRecipe);
						// Catalog availability and credential availability are separate. The
						// picker must remain useful before the first connection exists, so it
						// always presents the recipe-owned reviewed catalog and marks models
						// locked or available at render time.
						const models = registry.models;
						const service = modelServices.find(candidate => candidate.id === draftModelServiceId);
						const inputs = baseHalfVideoInputState(draftPrompt, draftBindings, inputKinds);
						if (!catalogId) {
							return { registry, inputs, models, problem: localize('basehalf.canvas.videoComposer.chooseGenerator', "Choose an installed video generator.") };
						}
						if (!service) {
							return { registry, inputs, models, problem: localize('basehalf.canvas.videoComposer.chooseConnection', "Choose a video model connection.") };
						}
						if (!service.configured) {
							return { registry, service, inputs, models, problem: localize('basehalf.canvas.videoComposer.connectionNeedsCredentials', "This video model connection needs credentials.") };
						}
						if (!isBaseHalfPublicHttpsBearerModelServiceConfiguration(service)) {
							return { registry, service, inputs, models, problem: localize('basehalf.canvas.videoComposer.connectionTransportUnsupported', "Reconnect this video model service with a public HTTPS endpoint and Bearer API key.") };
						}
						const matchingModels = registry.models.filter(model => baseHalfVideoModelMatchesServiceScope(model, service));
						if (matchingModels.length === 0) {
							return { registry, service, inputs, models, problem: localize('basehalf.canvas.videoComposer.noReviewedModels', "No reviewed video models match this connection.") };
						}
						const snapshot = baseHalfVideoSnapshotFromParameterDraft(draftParameters, catalogId);
						if (!draftModelId) {
							return { registry, service, inputs, models, problem: localize('basehalf.canvas.videoComposer.chooseReviewedModel', "Choose a reviewed video model.") };
						}
						if (!snapshot) {
							// A model can be chosen before its required image/video inputs exist.
							// Preserve that exact in-memory catalog key so Settings can explain
							// what is missing and can mint the immutable snapshot once the Draft
							// becomes resolvable, without silently switching model revisions.
							const descriptor = matchingModels.find(candidate => candidate.key.modelId === draftModelId
								&& (!draftVideoModelKey
									|| (candidate.key.provider === draftVideoModelKey.provider
										&& candidate.key.deployment === draftVideoModelKey.deployment
										&& candidate.key.region === draftVideoModelKey.region
										&& candidate.key.revision === draftVideoModelKey.revision)));
							if (!descriptor) {
								return { registry, service, inputs, models, problem: localize('basehalf.canvas.videoComposer.chooseReviewedModel', "Choose a reviewed video model.") };
							}
							const settings = baseHalfVideoSettingsFromParameterDraft(draftParameters);
							const requestedMode = settings[BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID];
							const mode = (typeof requestedMode === 'string'
								? descriptor.modes.find(capability => capability.mode === requestedMode)?.mode
								: undefined) ?? descriptor.modes[0]?.mode;
							if (!mode) {
								return { registry, service, inputs, models, descriptor, problem: localize('basehalf.canvas.videoComposer.noReviewedMode', "This reviewed model has no generation method.") };
							}
							const resolution = registry.resolveCapability({ ...descriptor.key, mode });
							if (resolution.status !== 'supported') {
								return { registry, service, inputs, models, descriptor, mode, resolution, problem: resolution.reason };
							}
							const inputEvaluation = evaluateBaseHalfVideoInputs(resolution, inputs);
							const normalization = normalizeBaseHalfVideoSettingsForCapability(resolution, inputs, settings);
							const inputProblem = baseHalfVideoInputEvaluationProblem(inputEvaluation);
							const promptProblem = getBaseHalfVideoPromptProblem(resolution, draftPrompt);
							return {
								registry,
								service,
								inputs,
								models,
								descriptor,
								mode,
								resolution,
								inputEvaluation,
								normalization,
								...(normalization.status === 'unavailable'
									? { problem: normalization.reason }
									: inputProblem
										? { problem: inputProblem }
										: promptProblem
											? { problem: promptProblem }
											: {})
							};
						}
						if (snapshot.modelId !== draftModelId) {
							return { registry, service, inputs, models, problem: localize('basehalf.canvas.videoComposer.chooseReviewedModel', "Choose a reviewed video model.") };
						}
						const persistedResolution = resolveBaseHalfVideoModelSelectionSnapshotCapability(registry, catalogId, service, snapshot);
						if (persistedResolution.status !== 'supported') {
							return {
								registry,
								service,
								inputs,
								models,
								...(persistedResolution.status === 'unavailable' ? { descriptor: persistedResolution.descriptor } : {}),
								resolution: persistedResolution,
								problem: persistedResolution.reason
							};
						}
						const descriptor = persistedResolution.descriptor;
						const settings = baseHalfVideoSettingsFromParameterDraft(draftParameters);
						const mode = persistedResolution.selection.mode;
						const resolution = persistedResolution;
						const inputEvaluation = evaluateBaseHalfVideoInputs(resolution, inputs);
						const normalization = normalizeBaseHalfVideoSettingsForCapability(resolution, inputs, settings);
						const inputProblem = baseHalfVideoInputEvaluationProblem(inputEvaluation);
						const promptProblem = getBaseHalfVideoPromptProblem(resolution, draftPrompt);
						const canonicalProblem = normalization.status === 'ready'
							&& selectedRecipe?.videoModelCatalogId
							&& !objectsEqual(
								draftParameters,
								baseHalfCanonicalVideoParameterDraft(selectedRecipe.videoModelCatalogId, resolution, inputs, normalization)
							)
							? localize('basehalf.canvas.videoComposer.reviewCanonicalSettings', "Review the model settings and save this Draft again.")
							: undefined;
						return {
							registry,
							service,
							inputs,
							models,
							descriptor,
							mode,
							resolution,
							inputEvaluation,
							normalization,
							...(normalization.status === 'unavailable'
								? { problem: normalization.reason }
								: inputProblem
									? { problem: inputProblem }
									: promptProblem
										? { problem: promptProblem }
										: canonicalProblem
											? { problem: canonicalProblem }
											: {})
						};
					};
					const readVideoInputsPresentation = () => {
						if (selectedRecipe?.modelCapability !== 'video') {
							return undefined;
						}
						const state = readVideoModelState();
						if (state.resolution?.status !== 'supported' || !state.inputEvaluation) {
							return undefined;
						}
						const sourcePaths = [...new Set(draftBindings.map(binding => binding.sourcePath))];
						const sources: IBaseHalfVideoInputSourceState[] = sourcePaths.map(sourcePath => {
							const binding = draftBindings.find(candidate => candidate.sourcePath === sourcePath);
							const kind = inputKinds.get(sourcePath);
							const identity = inputResultIdentities.get(sourcePath);
							const verificationProblem = directSourceProblems.get(sourcePath);
							const sourceChanged = verificationProblem === BASEHALF_VIDEO_INPUT_SOURCE_CHANGED_PROBLEM;
							return Object.freeze({
								sourcePath,
								...(identity ? { sourceId: identity.id } : {}),
								title: sourcePath.split('/').at(-1) || sourcePath,
								...(kind ? { kind } : {}),
								saved: kind !== undefined && !verificationProblem,
								integrity: kind === undefined
									? 'missing' as const
									: sourceChanged ? 'changed' as const
										: verificationProblem ? 'unverified' as const : 'available' as const,
								...(!verificationProblem && binding?.sourceRevision ? { revision: binding.sourceRevision } : {})
							});
						});
						return Object.freeze({
							state,
							capability: state.resolution.capability,
							sources: Object.freeze(sources),
							presentation: createBaseHalfVideoInputsPresentation({
								capability: state.resolution.capability,
								recipeInputs: selectedRecipe.inputs,
								bindings: draftBindings,
								sources,
								inputEvaluation: state.inputEvaluation
							})
						});
					};
					const readVideoMessagePrecedence = (
						transactionFailure?: string,
						attemptProblem?: string
					) => {
						const messages: IBaseHalfVideoMessage[] = [];
						if (transactionFailure) {
							messages.push({ kind: 'transaction-failure', message: transactionFailure });
						}
						if (attemptProblem) {
							messages.push({ kind: 'attempt-problem', message: attemptProblem });
						}
						const state = readVideoModelState();
						const inputs = readVideoInputsPresentation();
						const inputGate = inputs ? getBaseHalfVideoInputsExecutionGate(inputs.presentation) : undefined;
						if (state.problem && !inputGate?.problem) {
							messages.push({
								kind: 'model-selection-problem',
								message: state.problem,
								action: { id: state.resolution?.status === 'supported' ? 'review-settings' : 'review-models', label: localize('basehalf.canvas.videoComposer.reviewModelConfiguration', "Review model configuration") }
							});
						}
						if (inputGate?.problem) {
							messages.push(baseHalfCanvasVideoInputReadinessMessage(inputGate.problem));
						}
						if (videoSettingsNotice) {
							messages.push({
								kind: videoSettingsAdjustments.length > 0 ? 'settings-adjustment' : 'information',
								message: videoSettingsNotice
							});
						}
						return createBaseHalfVideoMessagePrecedencePresentation(messages);
					};
					const readVideoInputDirectEdgeState = async (
						sourcePath: string,
						persistedCanvasEdgeSourcePaths?: ReadonlySet<string>
					): Promise<BaseHalfVideoDirectEdgeState> => {
						const source: IBaseHalfCanvasUndoNode = { path: sourcePath, kind: 'file' };
						const target: IBaseHalfCanvasUndoNode = { path: item.path, kind: item.kind };
						const [pair, persistedCanvas] = await Promise.all([
							this.readConnectionPairState(folder, source, target),
							persistedCanvasEdgeSourcePaths ? Promise.resolve(undefined) : this.canvasMirrorService.readCanvas(folder)
						]);
						const hasCanvasEdge = persistedCanvasEdgeSourcePaths
							? persistedCanvasEdgeSourcePaths.has(sourcePath)
							: persistedCanvas?.edges.some(edge => edge.from === sourcePath && edge.to === item.path) ?? false;
						if (!pair.forward && !pair.backlink && !hasCanvasEdge) {
							return 'absent';
						}
						if (pair.forward && pair.backlink && hasCanvasEdge) {
							return 'present';
						}
						return 'inconsistent';
					};
					const inspectVideoInputSource = async (
						sourcePath: string,
						recordRevisionDependency?: (dependencyPath: string) => void
					): Promise<IBaseHalfVideoInputSourceState> => {
						const source = await this.readWorkspaceContentDescriptor(folder.workspaceFolder, sourcePath);
						for (const dependencyPath of source.revisionDependencyPaths) {
							recordRevisionDependency?.(dependencyPath);
						}
						const revision = await this.nodeExecutionService.getInputRevision(folder.workspaceFolder, sourcePath, { fresh: true });
						return Object.freeze({
							sourcePath,
							...(source.resultIdentity ? { sourceId: source.resultIdentity.id } : {}),
							title: sourcePath.split('/').at(-1) || sourcePath,
							kind: source.kind,
							saved: true,
							integrity: 'available' as const,
							revision,
							revisionDependencyPaths: source.revisionDependencyPaths
						});
					};
					const commitVideoInputPlan = async (
						plan: IBaseHalfVideoInputMutationPlan,
						expectedDraftState: string,
						transactionId: number,
						inspectedSources: readonly IBaseHalfVideoInputSourceState[] = [],
						expectedDraftRevision?: string
					): Promise<boolean> => {
						if (!baseHalfVideoInputTransactionIsCurrent(videoInputTransactionOwnerState, transactionId)
							|| !configurationMutable || draftStateKey() !== expectedDraftState || this.nodeExecutionService.getActiveRun(item.stat.resource)) {
							this.queueCanvasWarning(localize(
								'basehalf.canvas.videoComposer.inputCommitStale',
								"The Video Draft changed before this input could be saved. Review the current inputs and try again."
							));
							this.requestRender();
							return false;
						}
						const nextInputKinds = new Map(inputKinds);
						for (const source of inspectedSources) {
							if (source.kind) {
								nextInputKinds.set(source.sourcePath, source.kind);
							}
						}
						try {
						let nextDocument = applyBaseHalfVideoInputMutationToDocument({ document, plan });
						const persistedRecipe = this.canvasRecipeRegistryService.getRecipe(document.recipe!.recipeId);
						const persistedSnapshotValue = document.recipe!.parameters[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID];
						if (persistedRecipe?.modelCapability === 'video' && persistedRecipe.videoModelCatalogId && persistedSnapshotValue !== undefined) {
							try {
								const persistedSnapshot = parseBaseHalfVideoModelSelectionSnapshot(
									persistedSnapshotValue,
									persistedRecipe.videoModelCatalogId
								);
								const snapshotWithInputs = {
									...persistedSnapshot,
									inputs: baseHalfVideoInputState(document.prompt, plan.afterBindings, nextInputKinds)
								} as unknown as BaseHalfNodeJsonValue;
								nextDocument = createBaseHalfNodeDocument({
									...nextDocument,
									recipe: {
										...nextDocument.recipe!,
										parameters: {
											...nextDocument.recipe!.parameters,
											[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID]: snapshotWithInputs
										}
									}
								});
							} catch (error) {
								this.logService.warn(error);
							}
						}
						const persistedConfiguration = configurationDraftFromDocument(nextDocument);
						const nextConfigurationKey = documentConfigurationKey(nextDocument);
						const previousTransitionAck = registerVideoInputDocumentTransition(
							transactionId,
							savedDocumentConfigurationKey,
							nextConfigurationKey,
							content.etag
						);
						let transition: IBaseHalfCanvasConnectionTransition;
						try {
							transition = await this.saveNodeLocalChanges(
								folder,
								item,
								content.value,
								nextDocument,
								plan.graph.removeSourcePaths,
								plan.graph.addSourcePaths,
								new Map(inspectedSources.flatMap(source => source.revision === undefined
									? []
									: [[source.sourcePath, source.revision] as const])),
								expectedDraftRevision
							);
						} catch (error) {
							restoreVideoInputDocumentTransition(transactionId, nextConfigurationKey, previousTransitionAck);
							throw error;
						}
						const confirmedContent = await this.fileService.readFile(item.stat.resource, {
							atomic: true,
							limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
						});
						const confirmedDocument = parseBaseHalfNodeDocumentBytes(confirmedContent.value.buffer);
						const confirmedConfigurationKey = documentConfigurationKey(confirmedDocument);
						if (!settleVideoInputDocumentTransition(transactionId, nextConfigurationKey, confirmedConfigurationKey, confirmedContent.etag)) {
							try {
								await this.compensateCanvasConnectionGraphTransition(transition);
								this.queueCanvasWarning(localize(
									'basehalf.canvas.videoComposer.inputCommitUnconfirmed',
									"The Video Draft changed before the saved input could be confirmed. The input graph was restored; review the current inputs before trying again."
								));
							} catch (compensationError) {
								this.logService.warn(compensationError);
								this.queueCanvasWarning(localize(
									'basehalf.canvas.videoComposer.inputCommitCompensationFailed',
									"The Video Draft changed and the input graph could not be restored safely. Reopen the project and repair its input connections."
								));
							}
							queueSurfaceRefresh();
							return false;
						}
						if (canvasConnectionTransitionChangesAnything(transition)) {
							this.pushCanvasUndoElement(
								localize('basehalf.canvas.videoInput.undo', "Change video input"),
								folder,
								transition.nodes,
								transition.documents,
								(reverse, lease) => this.applyCanvasConnectionTransition(transition, reverse, lease)
							);
						}
						document = nextDocument;
						content = confirmedContent;
						draftBindings = plan.afterBindings.map(binding => ({ ...binding }));
						configurationBaseline = persistedConfiguration;
						latestExternalConfiguration = persistedConfiguration;
						savedDocumentConfigurationKey = nextConfigurationKey;
						const nextInbound = await this.readNodeInboundSources(folder, item);
						inbound = nextInbound;
						inboundSources = nextInbound.sources;
						inputKinds = baseHalfNodeInboundInputKinds(inboundSources);
						inputResultIdentities = new Map(inboundSources.flatMap(source => source.resultIdentity
							? [[source.path, source.resultIdentity] as const]
							: []));
						directSourcePaths = Object.freeze(inboundSources.map(source => source.path));
						directSourceProblems = await this.readNodeDirectSourceProblems(folder, inboundSources, nextDocument.recipe?.inputBindings);
						const draftSnapshot = baseHalfVideoSnapshotFromParameterDraft(draftParameters, selectedRecipe?.videoModelCatalogId);
						if (draftSnapshot) {
							draftParameters = {
								...draftParameters,
								[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID]: {
									...draftSnapshot,
									inputs: baseHalfVideoInputState(draftPrompt, draftBindings, inputKinds)
								}
							} as unknown as Record<string, BaseHalfNodeParameterDraftValue>;
						}
						savedDraftState = draftStateKeyFor(persistedConfiguration);
						this.requestRender();
						renderSurface();
						queueSurfaceRefresh();
						return true;
					} catch (error) {
						this.logService.warn(error);
						this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
						queueSurfaceRefresh();
						return false;
					}
				};
					const startVideoInputCanvasPick = async (
						role: BaseHalfVideoInputKind,
						replaceSourcePath?: string,
						restoreFocusTarget?: HTMLElement
					): Promise<void> => {
						if (!configurationMutable || !selectedRecipe) {
							return;
						}
						const transactionId = acquireVideoInputTransaction();
						if (transactionId === undefined) {
							return;
						}
						let transactionActive = true;
						const releasePickTransaction = (): void => {
							if (!transactionActive) {
								return;
							}
							transactionActive = false;
							releaseVideoInputTransaction(transactionId);
						};
						const returnFocusKey = baseHalfVideoCanvasPickOriginFocusKey(
							restoreFocusTarget ? renderedFocusKeys.get(restoreFocusTarget) : undefined,
							role
						);
						const returnOverlayTriggerFocusKey = baseHalfVideoCanvasPickInputsOverlayFocusKey(returnFocusKey)
							? videoComposerOverlayFocusKey
							: undefined;
						videoInputCanvasPickState = beginBaseHalfVideoCanvasPick(videoInputCanvasPickState, {
							sceneKey: localSurfaceController.sceneKey,
							targetNodePath: item.path,
							targetNodeId: document.id,
							expectedDraftRevision: content.etag,
							recipeId: selectedRecipe.id,
							requestedRole: role,
							returnFocusKey
						});
						const epoch = videoInputCanvasPickState.epoch;
						let lifetimeActive = true;
						const pickStore = new DisposableStore();
						const requestLifetimeIsCurrent = (): boolean => lifetimeActive
							&& !pickStore.isDisposed
							&& canvasPickStore.value === pickStore
							&& baseHalfVideoInputTransactionIsCurrent(videoInputTransactionOwnerState, transactionId)
							&& videoInputCanvasPickState.epoch === epoch
							&& videoInputCanvasPickState.request?.epoch === epoch
							&& surface.isConnected;
						const requestIsCurrent = (): boolean => requestLifetimeIsCurrent()
							&& videoInputCanvasPickState.phase !== 'idle';
						const disposePickStore = (): boolean => disposeBaseHalfCanvasVideoPickStore(canvasPickStore, pickStore);
						const cancelPickRequest = (): boolean => {
							if (!requestIsCurrent() || !getBaseHalfVideoCanvasPickInteraction(videoInputCanvasPickState).cancelAllowed) {
								return false;
							}
							videoInputCanvasPickState = cancelBaseHalfVideoCanvasPick(videoInputCanvasPickState, epoch);
							disposePickStore();
							releasePickTransaction();
							return true;
						};
						const cancelPickForChildOverlay = (): boolean => {
							return !requestIsCurrent() || cancelPickRequest();
						};
						pickStore.add(toDisposable(() => {
							lifetimeActive = false;
							baseHalfCanvasSetVideoInputPickActive(this.cards, surface, item.path, false);
							if (transactionActive && videoInputCanvasPickState.phase !== 'committing') {
								if (videoInputCanvasPickState.epoch === epoch && videoInputCanvasPickState.request?.epoch === epoch) {
									videoInputCanvasPickState = failBaseHalfVideoCanvasPick(videoInputCanvasPickState, epoch);
								}
								clearVideoInputDocumentTransition(transactionId);
								releasePickTransaction();
							}
						}));
						pickStore.add(toDisposable(() => {
							if (cancelVideoInputCanvasPickForChildOverlay === cancelPickForChildOverlay) {
								cancelVideoInputCanvasPickForChildOverlay = () => true;
							}
						}));
						canvasPickStore.value = pickStore;
						if (canvasPickStore.value !== pickStore) {
							disposePickStore();
							return;
						}
						baseHalfCanvasSetVideoInputPickActive(this.cards, surface, item.path, true);
						cancelVideoInputCanvasPickForChildOverlay = cancelPickForChildOverlay;
						closeVideoComposerOverlay(false);
						const candidateBatches = baseHalfCanvasVideoPickCandidateBatches(
							[...this.renderedItemsByPath.keys()],
							item.path
						);
						const candidatePaths = Object.freeze(candidateBatches.flat());
						const candidatePathSet = new Set(candidatePaths);
						const candidateRevisionDependencyPaths = new Set(candidatePaths);
						pickStore.add(this.fileService.onDidFilesChange(event => {
							if (!requestIsCurrent()) {
								return;
							}
							const candidateChanged = baseHalfCanvasVideoPickHasCandidateChange(candidateRevisionDependencyPaths, sourcePath => event.affects(
								joinPath(folder.workspaceFolder, ...sourcePath.split('/'))
							));
							if (candidateChanged) {
								cancelPickRequest();
								queueSurfaceRefresh();
							}
						}));
						let checkpointed = false;
						try {
							checkpointed = await checkpointVideoInputConfiguration(transactionId);
						} catch (error) {
							if (requestLifetimeIsCurrent()) {
								this.logService.warn(error);
								this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
							}
						}
						if (!checkpointed || !baseHalfCanvasVideoPickCheckpointCanContinue(
							videoInputCanvasPickState,
							epoch,
							baseHalfVideoInputTransactionIsCurrent(videoInputTransactionOwnerState, transactionId),
							lifetimeActive && !pickStore.isDisposed && canvasPickStore.value === pickStore,
							surface.isConnected
						)) {
							disposePickStore();
							return;
						}
						const expectedDraftRevision = content.etag;
						const videoInputs = readVideoInputsPresentation();
						if (!videoInputs) {
							disposePickStore();
							return;
						}
						const inputRecipe = selectedRecipe;
						const expectedDraftState = draftStateKey();
						const roleLabel = role === 'first-frame'
							? localize('basehalf.canvas.videoComposer.startFrame', "Start Frame")
							: role === 'last-frame'
								? localize('basehalf.canvas.videoComposer.endFrame', "End Frame")
								: role;
						const bannerHost = surface.closest<HTMLElement>('.monaco-workbench') ?? surface.ownerDocument.body;
						const banner = append(bannerHost, $('.basehalf-video-input-pick-banner'));
						banner.dataset.targetNodePath = item.path;
						banner.setAttribute('role', 'status');
						banner.setAttribute('aria-live', 'polite');
						const bannerText = append(banner, $('.basehalf-video-input-pick-copy'));
						bannerText.textContent = replaceSourcePath
							? localize('basehalf.canvas.videoComposer.pickReplacement', "Choose a saved canvas source to replace {0}.", roleLabel)
							: localize('basehalf.canvas.videoComposer.pickInput', "Choose a saved canvas source for {0}.", roleLabel);
						const cancel = append(banner, $('button.basehalf-video-input-pick-cancel')) as HTMLButtonElement;
						cancel.type = 'button';
						cancel.textContent = localize('basehalf.canvas.videoComposer.cancelPick', "Cancel");
						// Eligibility belongs to the complete canvas model, not the currently
						// mounted React viewport. Newly mounted cards receive the cached result.
						const presentedCards = new Set<HTMLElement>();
						const eligibilityReasons = new Map<string, string | undefined>();
						const collectMountedCandidateCards = (): ReadonlyMap<string, HTMLElement> => {
							const mountedCards = new Map<string, HTMLElement>();
							for (const card of this.root.querySelectorAll<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]')) {
								const path = card.dataset.basehalfCardPath;
								if (path && card.isConnected) {
									mountedCards.set(path, card);
								}
							}
							const mountedCandidatePaths = baseHalfCanvasVideoPickMountedCandidatePaths(
								[...mountedCards.keys()],
								candidatePathSet
							);
							return new Map(mountedCandidatePaths.map(path => [path, mountedCards.get(path)!]));
						};
						const applyCandidatePresentation = (sourcePath: string, card: HTMLElement): void => {
							presentedCards.add(card);
							const inspected = eligibilityReasons.has(sourcePath);
							const reason = eligibilityReasons.get(sourcePath);
							card.classList.add('basehalf-video-input-pick-candidate');
							card.classList.toggle('pending', !inspected);
							card.classList.toggle('basehalf-video-input-pick-eligible', inspected && !reason);
							card.classList.toggle('basehalf-video-input-pick-ineligible', inspected && !!reason);
							if (reason) {
								card.dataset.videoInputPickReason = reason;
							} else {
								delete card.dataset.videoInputPickReason;
							}
						};
						let mountedCandidateCards = collectMountedCandidateCards();
						for (const [sourcePath, card] of mountedCandidateCards) {
							applyCandidatePresentation(sourcePath, card);
						}
						const view = surface.ownerDocument.defaultView;
						if (view) {
							let frame = 0;
							const refreshCandidatePresentation = () => {
								mountedCandidateCards = collectMountedCandidateCards();
								for (const [sourcePath, card] of mountedCandidateCards) {
									applyCandidatePresentation(sourcePath, card);
								}
								frame = view.requestAnimationFrame(refreshCandidatePresentation);
							};
							frame = view.requestAnimationFrame(refreshCandidatePresentation);
							pickStore.add(toDisposable(() => view.cancelAnimationFrame(frame)));
						}
						const restoreCards = () => {
							baseHalfCanvasSetVideoInputPickActive(this.cards, surface, item.path, false);
							banner.remove();
							for (const card of collectMountedCandidateCards().values()) {
								presentedCards.add(card);
							}
							for (const card of presentedCards) {
								card.classList.remove(
									'basehalf-video-input-pick-candidate',
									'basehalf-video-input-pick-eligible',
									'basehalf-video-input-pick-ineligible',
									'pending'
								);
								delete card.dataset.videoInputPickReason;
							}
						};
						pickStore.add(toDisposable(restoreCards));
						const cancelPick = (restoreFocus = true): void => {
							if (videoInputCanvasPickState.epoch !== epoch) {
								return;
							}
							const returnFocusKey = videoInputCanvasPickState.request?.returnFocusKey;
							if (!cancelPickRequest()) {
								return;
							}
							if (!restoreFocus) {
								return;
							}
							const overlayFocusKey = baseHalfVideoCanvasPickInputsOverlayFocusKey(returnFocusKey);
							if (overlayFocusKey) {
								showVideoComposerOverlay('inputs', overlayFocusKey);
								videoComposerOverlayFocusKey = returnOverlayTriggerFocusKey;
								return;
							}
							const focusTarget = returnFocusKey ? renderedFocusTargets.get(returnFocusKey) : undefined;
							if (focusTarget?.isConnected) {
								focusTarget.focus({ preventScroll: true });
							}
						};
						const cancelFromControl = (event: Event): void => {
							event.preventDefault();
							event.stopPropagation();
							cancelPick();
						};
						// Pointer cancellation must run before an outer canvas interaction can
						// rebuild and detach the fixed banner. Click remains for keyboard use.
						pickStore.add(this.addDisposableListener(cancel, 'pointerdown', cancelFromControl));
						pickStore.add(this.addDisposableListener(cancel, 'click', cancelFromControl));
						const pickDraftRevisionIsCurrent = async (): Promise<boolean> => {
							const latest = await this.fileService.readFile(item.stat.resource, {
								atomic: true,
								limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
							});
							return requestIsCurrent()
								&& latest.etag === expectedDraftRevision
								&& (videoInputCanvasPickState.phase === 'preflighting'
									|| baseHalfVideoCanvasPickDraftRevisionIsCurrent(videoInputCanvasPickState, epoch, latest.etag));
						};
						const retainCurrentPickRevision = async (): Promise<boolean> => {
							try {
								if (await pickDraftRevisionIsCurrent()) {
									return true;
								}
							} catch (error) {
								if (requestLifetimeIsCurrent()) {
									this.logService.warn(error);
								}
							}
							if (!requestLifetimeIsCurrent()) {
								disposePickStore();
								return false;
							}
							cancelPick(false);
							queueSurfaceRefresh();
							return false;
						};
						const eligible = new Map<string, { source: IBaseHalfVideoInputSourceState; edgeState: BaseHalfVideoDirectEdgeState }>();
						let preflightComplete = false;
						// Escape owns cancellation as soon as pick mode is visible, including
						// while asynchronous source and graph preflight is still running.
						pickStore.add(this.addDisposableListener(surface.ownerDocument, 'keydown', event => {
							if (!requestIsCurrent() || !getBaseHalfVideoCanvasPickInteraction(videoInputCanvasPickState).cancelAllowed || event.defaultPrevented || event.isComposing || event.keyCode === 229) {
								return;
							}
							if (event.key === 'Escape') {
								event.preventDefault();
								event.stopImmediatePropagation();
								cancelPick();
								return;
							}
							if (!preflightComplete && (event.key === 'Enter' || event.key === ' ')) {
								const activeElement = surface.ownerDocument.activeElement;
								if (isHTMLElement(activeElement) && activeElement.closest('.basehalf-canvas-card[data-basehalf-card-path]')) {
									event.preventDefault();
									event.stopImmediatePropagation();
									bannerText.textContent = localize('basehalf.canvas.videoComposer.checkingPickedInput', "Checking saved canvas sources…");
								}
							}
						}, true));
						pickStore.add(this.addDisposableListener(surface.ownerDocument, 'pointerdown', event => {
							if (!requestIsCurrent() || videoInputCanvasPickState.phase === 'committing' || preflightComplete || (!isHTMLElement(event.target) && !isSVGElement(event.target))) {
								return;
							}
							const card = event.target.closest('.basehalf-canvas-card[data-basehalf-card-path]');
							if (card) {
								event.preventDefault();
								event.stopImmediatePropagation();
								bannerText.textContent = localize('basehalf.canvas.videoComposer.checkingPickedInput', "Checking saved canvas sources…");
							}
						}, true));
						if (!await retainCurrentPickRevision()) {
							return;
						}
						let preflightCanvas: IBaseHalfCanvasFile | null;
						try {
							preflightCanvas = await this.canvasMirrorService.readCanvas(folder);
						} catch (error) {
							if (!requestLifetimeIsCurrent()) {
								disposePickStore();
								return;
							}
							videoInputCanvasPickState = failBaseHalfVideoCanvasPick(videoInputCanvasPickState, epoch);
							disposePickStore();
							releasePickTransaction();
							this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
							return;
						}
						if (!await retainCurrentPickRevision()) {
							return;
						}
						const preflightCanvasEdgeSourcePaths = new Set((preflightCanvas?.edges ?? [])
							.filter(edge => edge.to === item.path)
							.map(edge => edge.from));
						let currentEdgeState: BaseHalfVideoDirectEdgeState | undefined;
						if (replaceSourcePath) {
							try {
								currentEdgeState = await readVideoInputDirectEdgeState(replaceSourcePath, preflightCanvasEdgeSourcePaths);
							} catch {
								currentEdgeState = 'inconsistent';
							}
							if (!await retainCurrentPickRevision()) {
								return;
							}
						}
						for (const candidateBatch of candidateBatches) {
							await Promise.all(candidateBatch.map(async sourcePath => {
								let reason: string | undefined;
								try {
									const [source, edgeState] = await Promise.all([
										inspectVideoInputSource(sourcePath, dependencyPath => candidateRevisionDependencyPaths.add(dependencyPath)),
										readVideoInputDirectEdgeState(sourcePath, preflightCanvasEdgeSourcePaths)
									]);
									const sources = [...videoInputs.sources.filter(candidate => candidate.sourcePath !== sourcePath), source];
									if (replaceSourcePath) {
										planBaseHalfVideoInputReplace({
											capability: videoInputs.capability,
											recipeInputs: inputRecipe.inputs,
											bindings: draftBindings,
											sources,
											sourcePath: replaceSourcePath,
											replacementSourcePath: sourcePath,
											currentEdgeState: currentEdgeState ?? 'inconsistent',
											replacementEdgeState: edgeState
										});
									} else {
										planBaseHalfVideoInputPick({
											capability: videoInputs.capability,
											recipeInputs: inputRecipe.inputs,
											bindings: draftBindings,
											sources,
											sourcePath,
											role,
											edgeState
										});
									}
									eligible.set(sourcePath, { source, edgeState });
								} catch (error) {
									reason = error instanceof Error ? error.message : String(error);
								}
							if (!requestIsCurrent()) {
								releasePickTransaction();
								return;
								}
								eligibilityReasons.set(sourcePath, reason);
								const mountedCard = mountedCandidateCards.get(sourcePath);
								if (mountedCard) {
									applyCandidatePresentation(sourcePath, mountedCard);
								}
							}));
							if (!await retainCurrentPickRevision()) {
								return;
							}
						}
						if (!requestIsCurrent()) {
							return;
						}
						if (draftStateKey() !== expectedDraftState) {
							cancelPick(false);
							return;
						}
						videoInputCanvasPickState = markBaseHalfVideoCanvasPickReady(videoInputCanvasPickState, epoch, expectedDraftRevision);
						videoInputCanvasPickState = updateBaseHalfVideoCanvasPickViewport(
							videoInputCanvasPickState,
							epoch,
							surface.dataset.visibility !== 'anchor-offscreen'
						);
						preflightComplete = true;
						if (eligible.size === 0) {
							bannerText.textContent = localize('basehalf.canvas.videoComposer.noEligiblePick', "No saved canvas source is eligible for {0}. Press Escape to cancel.", roleLabel);
						} else {
							bannerText.textContent += ` ${localize('basehalf.canvas.videoComposer.pickKeyboardHint', "Select a highlighted card, or press Escape to cancel.")}`;
						}
						const acceptCard = async (card: HTMLElement): Promise<void> => {
							const sourcePath = card.dataset.basehalfCardPath;
							const preflight = sourcePath ? eligible.get(sourcePath) : undefined;
							if (!sourcePath || !preflight || !requestIsCurrent()) {
								if (sourcePath && !preflight) {
									bannerText.textContent = card.dataset.videoInputPickReason
										?? localize('basehalf.canvas.videoComposer.inputNotEligible', "That source is not eligible for this input.");
								}
								return;
							}
							const acceptedState = acceptBaseHalfVideoCanvasPickSelection(videoInputCanvasPickState, epoch);
							if (acceptedState === videoInputCanvasPickState) {
								return;
							}
							videoInputCanvasPickState = markBaseHalfVideoCanvasPickRevalidating(acceptedState, epoch);
							try {
								if (draftStateKey() !== expectedDraftState) {
									cancelPick(false);
									return;
								}
								if (!await retainCurrentPickRevision()) {
									return;
								}
								const [source, edgeState] = await Promise.all([
									inspectVideoInputSource(sourcePath),
									readVideoInputDirectEdgeState(sourcePath)
								]);
								if (!await retainCurrentPickRevision()) {
									return;
								}
								if (source.revision !== preflight.source.revision || edgeState !== preflight.edgeState) {
									throw new Error('That source changed after pick mode opened. Reopen the picker to use its latest saved revision.');
								}
								const latestInputs = readVideoInputsPresentation();
								if (!latestInputs || !selectedRecipe) {
									throw new Error('The generation method changed while choosing an input.');
								}
								const sources = [...latestInputs.sources.filter(candidate => candidate.sourcePath !== sourcePath), source];
								const replacementEdgeState = replaceSourcePath
									? await readVideoInputDirectEdgeState(replaceSourcePath)
									: undefined;
								if (!await retainCurrentPickRevision()) {
									return;
								}
								const plan = replaceSourcePath
									? planBaseHalfVideoInputReplace({
										capability: latestInputs.capability,
										recipeInputs: selectedRecipe.inputs,
										bindings: draftBindings,
										sources,
										sourcePath: replaceSourcePath,
										replacementSourcePath: sourcePath,
										currentEdgeState: replacementEdgeState!,
										replacementEdgeState: edgeState
									})
									: planBaseHalfVideoInputPick({
										capability: latestInputs.capability,
										recipeInputs: selectedRecipe.inputs,
										bindings: draftBindings,
										sources,
										sourcePath,
										role,
										edgeState
									});
								if (!await retainCurrentPickRevision()) {
									return;
								}
								bannerText.textContent = localize('basehalf.canvas.videoComposer.savingPickedInput', "Saving selected input…");
								videoInputCanvasPickState = markBaseHalfVideoCanvasPickCommitting(videoInputCanvasPickState, epoch);
								cancel.disabled = true;
								if (!await commitVideoInputPlan(plan, expectedDraftState, transactionId, [source], expectedDraftRevision)) {
									if (videoInputCanvasPickState.epoch === epoch && videoInputCanvasPickState.request?.epoch === epoch) {
										videoInputCanvasPickState = failBaseHalfVideoCanvasPick(videoInputCanvasPickState, epoch);
									}
									disposePickStore();
									releasePickTransaction();
									return;
								}
								const refreshedInputs = readVideoInputsPresentation();
								const filledRoleVisibleInPresentation = !!refreshedInputs
									&& baseHalfVideoCanvasPickSelectionIsActive(refreshedInputs.presentation, sourcePath, role);
								const completedFocusKey = role === 'first-frame' || role === 'last-frame'
									? `video:input:${role}`
									: `video:input:${sourcePath}:slot`;
								const completion = completeBaseHalfVideoCanvasPick(
									videoInputCanvasPickState,
									epoch,
									filledRoleVisibleInPresentation,
									completedFocusKey
								);
									videoInputCanvasPickState = completion.state;
									releasePickTransaction();
									disposePickStore();
									if (completion.reopenInputs && completion.focusKey) {
										showVideoComposerOverlay('inputs');
										anchorWindow.requestAnimationFrame(() => {
											renderedFocusTargets.get(completion.focusKey!)?.focus({ preventScroll: true });
										});
									}
								} catch (error) {
									if (!requestLifetimeIsCurrent()) {
										disposePickStore();
										return;
									}
									videoInputCanvasPickState = failBaseHalfVideoCanvasPick(videoInputCanvasPickState, epoch);
									disposePickStore();
									releasePickTransaction();
									this.queueCanvasWarning(error instanceof BaseHalfVideoInputMutationError || error instanceof Error
										? error.message
										: String(error));
								}
						};
						pickStore.add(this.addDisposableListener(surface.ownerDocument, 'pointerdown', event => {
							if (!requestIsCurrent() || !getBaseHalfVideoCanvasPickInteraction(videoInputCanvasPickState).acceptsSelection || (!isHTMLElement(event.target) && !isSVGElement(event.target))) {
								return;
							}
							const card = event.target.closest<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]');
							if (!card) {
								return;
							}
							event.preventDefault();
							event.stopImmediatePropagation();
							void acceptCard(card);
						}, true));
						pickStore.add(this.addDisposableListener(surface.ownerDocument, 'click', event => {
							if (!requestIsCurrent() || videoInputCanvasPickState.phase === 'committing' || (!isHTMLElement(event.target) && !isSVGElement(event.target))) {
								return;
							}
							if (event.target.closest('.react-flow__pane, .basehalf-canvas-cards')
								&& !event.target.closest('.basehalf-canvas-card[data-basehalf-card-path]')) {
								cancelPick(false);
							}
						}, true));
						pickStore.add(this.addDisposableListener(surface.ownerDocument, 'keydown', event => {
							if (!requestIsCurrent() || event.defaultPrevented || event.isComposing || event.keyCode === 229) {
								return;
							}
							if (event.key === 'Escape') {
								event.preventDefault();
								event.stopImmediatePropagation();
								cancelPick();
								return;
							}
							if (event.key !== 'Enter' && event.key !== ' ') {
								return;
							}
							if (!getBaseHalfVideoCanvasPickInteraction(videoInputCanvasPickState).acceptsSelection) {
								return;
							}
							const activeElement = surface.ownerDocument.activeElement;
							const card = isHTMLElement(activeElement)
								? activeElement.closest<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]')
								: undefined;
							if (!card) {
								return;
							}
							event.preventDefault();
							event.stopImmediatePropagation();
							void acceptCard(card);
						}, true));
					};
					const readVideoCapabilityProblem = (): string | undefined => {
						if (!videoComposer || selectedRecipe?.modelCapability !== 'video') {
							return undefined;
						}
						const state = readVideoModelState();
						const inputs = readVideoInputsPresentation();
						const gate = inputs ? getBaseHalfVideoInputsExecutionGate(inputs.presentation) : undefined;
						return state.problem ?? (gate?.problem ? baseHalfVideoInputPresentationProblemLabel(gate.problem.kind) : undefined);
					};
					const readVideoRecipeParameters = (): Readonly<Record<string, BaseHalfNodeJsonValue>> | undefined => {
						if (selectedRecipe?.modelCapability === undefined) {
							const parsed = selectedRecipe ? parseBaseHalfNodeParameterDraft(selectedRecipe, draftParameters) : undefined;
							return parsed?.valid ? parsed.parameters : undefined;
						}
						if (selectedRecipe.modelCapability !== 'video') {
							return undefined;
						}
						const state = readVideoModelState();
						const catalogId = selectedRecipe?.videoModelCatalogId;
						if (!catalogId || state.normalization?.status !== 'ready' || state.resolution?.status !== 'supported') {
							return undefined;
						}
						return {
							...state.normalization.values,
							[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID]: createBaseHalfVideoModelSelectionSnapshotFromCapability(catalogId, state.resolution, state.inputs)
						} as unknown as Readonly<Record<string, BaseHalfNodeJsonValue>>;
					};
					const readDraftLocalState = () => {
						const parsed = selectedRecipe && (!videoComposer || selectedRecipe.modelCapability === undefined)
							? parseBaseHalfNodeParameterDraft(selectedRecipe, draftParameters)
							: undefined;
						if (parsed && !parsed.valid) {
							return {
								ready: false,
								status: 'Needs input' as const,
								message: parsed.message,
								action: { kind: 'configure' as const, label: 'Configure' }
							};
						}
						const draftRecipe = resolveBaseHalfNodeRecipeDraft(
							document,
							selectedRecipeId,
							selectedRecipe,
							videoComposer && selectedRecipe?.modelCapability === 'video'
								? readVideoRecipeParameters()
								: parsed?.valid ? parsed.parameters : undefined,
							draftModelServiceId,
							draftModelId,
							draftBindings
						);
						const draftDocument: IBaseHalfNodeDocument = { ...document, recipe: draftRecipe };
						const videoConfigurationProblem = readVideoCapabilityProblem();
						return getBaseHalfNodeLocalState(draftDocument, {
							recipe: selectedRecipe,
							...(videoComposer && selectedRecipe?.modelCapability === 'video'
								? { videoConfiguration: videoConfigurationProblem
									? { valid: false as const, problem: videoConfigurationProblem }
									: { valid: true as const } }
								: {}),
							modelServices,
							execution: this.nodeExecutionService.getActiveRun(item.stat.resource),
							resultIntegrity: resultPreview.resultIntegrity,
							dirty: this.workingCopyService.isDirty(item.stat.resource),
							graphProblem: inbound.problem,
							directSourcePaths: readActiveDirectSourcePaths(),
							directSourceProblems,
							verificationPending,
							inputKinds,
							matchingRecipeCount: recipes.length
						});
					};
					const localState = readDraftLocalState();
					const importProblem = getBaseHalfNodeImportProblem(document);

					const modeButtons = new Map<'configure' | 'attempts', HTMLButtonElement>();
					let refreshModePresentation = () => { };
					let title: HTMLElement;
					let role: HTMLElement;
					if (videoComposer) {
						title = append(surface, $('span.basehalf-video-composer-accessible-title'));
						title.id = `basehalf-video-composer-title-${document.id}`;
						title.textContent = localize('basehalf.canvas.videoComposer.label', "Generate video for {0}", draftTitle.trim() || localize('basehalf.canvas.untitled', "Untitled"));
						role = append(surface, $('span.basehalf-video-composer-accessible-title'));
						role.textContent = draftRole.trim();
						surface.setAttribute('role', 'region');
						surface.removeAttribute('aria-modal');
						surface.setAttribute('aria-labelledby', title.id);
						refreshLiveExecutionPresentation = () => refreshVideoPrimaryState();
					} else {
						const header = append(surface, $('.basehalf-node-local-header'));
						const heading = append(header, $('.basehalf-node-local-heading'));
						title = append(heading, $('.basehalf-node-local-title'));
						title.textContent = draftTitle.trim() || 'Untitled';
						configureBaseHalfNodeLocalSurfaceAccessibility(surface, title, document.id);
						role = append(heading, $('.basehalf-node-local-role'));
						role.textContent = `${nodeKindLabel(document.kind)} · ${draftRole.trim() || 'Role required'}`;
						const close = append(header, $('button.basehalf-node-local-close.codicon.codicon-close')) as HTMLButtonElement;
						registerFocusTarget(close, 'close');
						close.type = 'button';
						close.title = 'Close';
						close.setAttribute('aria-label', 'Close node details');
						formListeners.add(this.addDisposableListener(close, 'click', () => void leaveSurface()));

						const modeSwitch = append(surface, $('.basehalf-node-local-mode-switch'));
						modeSwitch.setAttribute('role', 'tablist');
						modeSwitch.setAttribute('aria-label', 'Node details');
						for (const candidate of ['configure', 'attempts'] as const) {
							const modeButton = append(modeSwitch, $('button.basehalf-node-local-mode')) as HTMLButtonElement;
							registerFocusTarget(modeButton, `mode:${candidate}`);
							modeButtons.set(candidate, modeButton);
							modeButton.type = 'button';
							modeButton.dataset.nodeLocalMode = candidate;
							modeButton.id = `basehalf-node-${candidate}-${document.id}`;
							modeButton.setAttribute('aria-controls', `basehalf-node-${candidate}-panel-${document.id}`);
							modeButton.textContent = candidate === 'configure'
								? configurationMutable ? 'Configure' : 'Configuration'
								: 'Attempts';
							modeButton.classList.toggle('active', localSurfaceMode === candidate);
							modeButton.classList.toggle('has-draft', candidate === 'configure' && hasDraftChanges());
							modeButton.setAttribute('role', 'tab');
							modeButton.setAttribute('aria-selected', String(localSurfaceMode === candidate));
							modeButton.setAttribute('tabindex', localSurfaceMode === candidate ? '0' : '-1');
							modeButton.setAttribute('aria-label', candidate === 'configure' && hasDraftChanges() ? 'Configure, unsaved changes' : modeButton.textContent);
							formListeners.add(this.addDisposableListener(modeButton, 'click', () => {
								if (localSurfaceMode === candidate) {
									return;
								}
								localSurfaceMode = candidate;
								renderSurface();
							}));
							formListeners.add(this.addDisposableListener(modeButton, 'keydown', event => {
								if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
									return;
								}
								event.preventDefault();
								const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'configure' : 'attempts';
								localSurfaceMode = next;
								renderSurface();
							}));
						}

						const readiness = append(surface, $('.basehalf-node-local-readiness'));
						readiness.setAttribute('aria-live', 'polite');
						readiness.classList.toggle('ready', isBaseHalfNodeCardStatusPositive(localState));
						const readinessDot = append(readiness, $('.basehalf-node-local-readiness-dot'));
						readinessDot.setAttribute('aria-hidden', 'true');
						const readinessText = append(readiness, $('.basehalf-node-local-readiness-text'));
						readinessText.textContent = localState.message;
						refreshLiveExecutionPresentation = () => {
							const nextState = readDraftLocalState();
							readiness.classList.toggle('ready', isBaseHalfNodeCardStatusPositive(nextState));
							readinessText.textContent = nextState.message;
						};
					}

					if (configurationConflict?.length) {
						const conflict = append(surface, $('.basehalf-node-local-conflict'));
						conflict.setAttribute('role', 'alert');
						const conflictTitle = append(conflict, $('.basehalf-node-local-conflict-title'));
						conflictTitle.textContent = 'Configuration changed elsewhere';
						const conflictMessage = append(conflict, $('.basehalf-node-local-conflict-message'));
						conflictMessage.textContent = `${configurationConflict.join(', ')} changed in both places. Result and Attempts are refreshed, but your draft will not overwrite the saved configuration until you choose.`;
						const conflictActions = append(conflict, $('.basehalf-node-local-conflict-actions'));
						const useSaved = append(conflictActions, $('button.basehalf-node-local-link')) as HTMLButtonElement;
						registerFocusTarget(useSaved, 'conflict:use-saved');
						useSaved.type = 'button';
						useSaved.textContent = 'Use saved configuration';
						useSaved.setAttribute('aria-label', 'Use the latest saved configuration');
						formListeners.add(this.addDisposableListener(useSaved, 'click', () => void (async () => {
							const confirmation = await this.dialogService.confirm({
								message: 'Replace your unsaved changes with the latest saved configuration?',
								detail: 'Result and Attempts are already up to date. Only the fields in Configure will be replaced.',
								primaryButton: 'Use saved configuration'
							});
							if (!confirmation.confirmed) {
								return;
							}
							applyConfigurationDraft(latestExternalConfiguration);
							removedConnections.clear();
							configurationBaseline = latestExternalConfiguration;
							configurationConflict = undefined;
							savedDraftState = draftStateKeyFor(latestExternalConfiguration);
							renderSurface();
						})()));
						const keepLocal = append(conflictActions, $('button.basehalf-node-local-link')) as HTMLButtonElement;
						registerFocusTarget(keepLocal, 'conflict:keep-local');
						keepLocal.type = 'button';
						keepLocal.textContent = 'Keep my edits';
						keepLocal.setAttribute('aria-label', 'Keep my edits over the latest saved configuration');
						formListeners.add(this.addDisposableListener(keepLocal, 'click', () => {
							configurationConflict = undefined;
							renderSurface();
						}));
					}
					if (refreshFailure) {
						const failure = append(surface, $('.basehalf-node-local-conflict.refresh-failed'));
						failure.setAttribute('role', 'status');
						const failureTitle = append(failure, $('.basehalf-node-local-conflict-title'));
						failureTitle.textContent = 'Could not refresh this node';
						const failureMessage = append(failure, $('.basehalf-node-local-conflict-message'));
						failureMessage.textContent = refreshFailure;
					}

					const body = append(surface, $('.basehalf-node-local-body'));
					renderedConfigureBody = body;
					if (!videoComposer) {
						body.id = `basehalf-node-configure-panel-${document.id}`;
						body.setAttribute('role', 'tabpanel');
						body.setAttribute('aria-labelledby', `basehalf-node-configure-${document.id}`);
					}
					body.classList.add('mode-configure');
					body.classList.toggle('video-composer-body', videoComposer);

					if (videoComposer) {
						const videoInputs = readVideoInputsPresentation();
						const hasVideoInputCapacity = !!videoInputs && videoInputs.capability.inputs.some(input => {
							if (input.kind === 'text-prompt' || input.maxItems === 0) {
								return false;
							}
							const recipeInput = selectedRecipe?.inputs.find(candidate => candidate.id === input.kind);
							const count = draftBindings.filter(binding => binding.slot === input.kind).length;
							return !!recipeInput && count < Math.min(input.maxItems, recipeInput.maxItems);
						});
						if (videoInputs && (videoInputs.presentation.frameSlots.length > 0
							|| videoInputs.presentation.ordinaryChips.length > 0
							|| videoInputs.presentation.needsReview.length > 0
							|| hasVideoInputCapacity)) {
							const inputsRegion = append(body, $('.basehalf-video-composer-inputs'));
							inputsRegion.setAttribute('aria-label', localize('basehalf.canvas.videoComposer.inputsHeading', "Generation inputs"));
							if (videoInputs.presentation.frameSlots.length > 0) {
								const frameStrip = append(inputsRegion, $('.basehalf-video-frame-strip'));
								frameStrip.setAttribute('role', 'group');
								frameStrip.setAttribute('aria-label', localize('basehalf.canvas.videoComposer.temporalFrames', "Temporal frames"));
								for (const [index, slot] of videoInputs.presentation.frameSlots.entries()) {
									if (index > 0) {
										const connector = append(frameStrip, $('.basehalf-video-frame-connector.codicon.codicon-arrow-right'));
										connector.setAttribute('aria-hidden', 'true');
									}
									const roleLabel = slot.role === 'first-frame'
										? localize('basehalf.canvas.videoComposer.startFrame', "Start Frame")
										: localize('basehalf.canvas.videoComposer.endFrame', "End Frame");
									const slotRoot = append(frameStrip, $('.basehalf-video-frame-slot'));
									slotRoot.dataset.frameRole = slot.role;
									slotRoot.classList.toggle('empty', !slot.binding);
									slotRoot.classList.toggle('problem', !!slot.problem);
									const open = append(slotRoot, $('button.basehalf-video-frame-slot-open')) as HTMLButtonElement;
									registerFocusTarget(open, `video:input:${slot.role}`);
									open.type = 'button';
									const role = append(open, $('.basehalf-video-frame-slot-role'));
									role.textContent = roleLabel;
									const source = append(open, $('.basehalf-video-frame-slot-source'));
									source.textContent = slot.source?.title
										?? (slot.binding?.sourcePath.split('/').at(-1) || localize('basehalf.canvas.videoComposer.chooseFrame', "Choose image"));
									open.setAttribute('aria-label', slot.binding
										? localize('basehalf.canvas.videoComposer.openFrameInput', "{0}: {1}. Open input settings.", roleLabel, source.textContent)
										: localize('basehalf.canvas.videoComposer.addFrameInput', "Add {0}.", roleLabel));
									formListeners.add(this.addDisposableListener(open, 'click', () => {
										if (slot.binding) {
											showVideoComposerOverlay('inputs', `input:${slot.binding.sourcePath}:slot`);
											return;
										}
										void startVideoInputCanvasPick(slot.role, undefined, open);
									}));
									if (slot.problem) {
										open.setAttribute('aria-description', baseHalfVideoInputPresentationProblemLabel(slot.problem.kind));
									}
									if (slot.binding) {
										const binding = slot.binding;
										const replace = append(slotRoot, $('button.basehalf-video-frame-slot-replace.codicon.codicon-replace')) as HTMLButtonElement;
										registerFocusTarget(replace, `video:input:${slot.role}:replace`);
										replace.type = 'button';
										replace.disabled = !configurationMutable;
										replace.title = localize('basehalf.canvas.videoComposer.replaceFrameInput', "Replace {0}", roleLabel);
										replace.setAttribute('aria-label', replace.title);
										formListeners.add(this.addDisposableListener(replace, 'click', () => {
											void startVideoInputCanvasPick(slot.role, binding.sourcePath, replace);
										}));
										const remove = append(slotRoot, $('button.basehalf-video-frame-slot-remove.codicon.codicon-close')) as HTMLButtonElement;
										registerFocusTarget(remove, `video:input:${slot.role}:remove`);
										remove.type = 'button';
										remove.disabled = !configurationMutable;
										remove.title = localize('basehalf.canvas.videoComposer.removeFrameInput', "Remove {0}", roleLabel);
										remove.setAttribute('aria-label', remove.title);
										formListeners.add(this.addDisposableListener(remove, 'click', () => void (async () => {
											const transactionId = acquireVideoInputTransaction();
											if (transactionId === undefined) {
												return;
											}
											const expectedDraftState = draftStateKey();
											try {
												const edgeState = await readVideoInputDirectEdgeState(binding.sourcePath);
												const plan = planBaseHalfVideoInputRemove({
													capability: videoInputs.capability,
													recipeInputs: selectedRecipe!.inputs,
													bindings: draftBindings,
													sources: videoInputs.sources,
													sourcePath: binding.sourcePath,
													edgeState
												});
												await commitVideoInputPlan(plan, expectedDraftState, transactionId);
											} catch (error) {
												this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
												this.requestRender();
											} finally {
												releaseVideoInputTransaction(transactionId);
											}
										})()));
									}
								}
								if (videoInputs.presentation.canSwapFrames) {
									const swap = append(frameStrip, $('button.basehalf-video-frame-swap.codicon.codicon-arrow-swap')) as HTMLButtonElement;
									registerFocusTarget(swap, 'video:input:swap');
									swap.type = 'button';
									swap.disabled = !configurationMutable;
									swap.title = localize('basehalf.canvas.videoComposer.swapFrames', "Swap Start and End");
									swap.setAttribute('aria-label', swap.title);
									formListeners.add(this.addDisposableListener(swap, 'click', () => void (async () => {
										const transactionId = acquireVideoInputTransaction();
										if (transactionId === undefined) {
											return;
										}
										try {
											const expectedDraftState = draftStateKey();
											const frameSources = await Promise.all(videoInputs.presentation.frameSlots
												.flatMap(slot => slot.binding ? [slot.binding.sourcePath] : [])
												.map(sourcePath => inspectVideoInputSource(sourcePath)));
											const plan = planBaseHalfVideoFrameSwap({
												capability: videoInputs.capability,
												recipeInputs: selectedRecipe!.inputs,
												bindings: draftBindings,
												sources: [
													...videoInputs.sources.filter(source => !frameSources.some(fresh => fresh.sourcePath === source.sourcePath)),
													...frameSources
												]
											});
											await commitVideoInputPlan(plan, expectedDraftState, transactionId, frameSources);
										} catch (error) {
											this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
											this.requestRender();
										} finally {
											releaseVideoInputTransaction(transactionId);
										}
									})()));
								}
							}
							if (videoInputs.presentation.ordinaryChips.length > 0) {
								const chips = append(inputsRegion, $('.basehalf-video-input-chip-strip'));
								for (const input of videoInputs.presentation.ordinaryChips) {
									const chip = append(chips, $('button.basehalf-video-input-chip')) as HTMLButtonElement;
									registerFocusTarget(chip, `video:input:${input.binding.sourcePath}:slot`);
									chip.type = 'button';
									chip.textContent = `${input.binding.slot} · ${input.source?.title ?? input.binding.sourcePath}`;
									formListeners.add(this.addDisposableListener(chip, 'click', () => showVideoComposerOverlay('inputs', `input:${input.binding.sourcePath}:slot`)));
								}
							}
							if (videoInputs.presentation.needsReview.length > 0) {
								const review = append(inputsRegion, $('button.basehalf-video-input-review')) as HTMLButtonElement;
								registerFocusTarget(review, 'video:input:review');
								review.type = 'button';
								review.textContent = localize('basehalf.canvas.videoComposer.inputsNeedReview', "Needs review · {0}", videoInputs.presentation.needsReview.length);
								review.setAttribute('aria-label', localize('basehalf.canvas.videoComposer.reviewInputsCount', "Review {0} video inputs", videoInputs.presentation.needsReview.length));
								formListeners.add(this.addDisposableListener(review, 'click', () => showVideoComposerOverlay('inputs', 'video:inputs')));
							}
							if (hasVideoInputCapacity) {
								const addInput = append(inputsRegion, $('button.basehalf-video-input-add-trigger.codicon.codicon-add')) as HTMLButtonElement;
								registerFocusTarget(addInput, 'video:inputs');
								addInput.type = 'button';
								addInput.dataset.videoComposerTrigger = 'inputs';
								addInput.title = localize('basehalf.canvas.videoComposer.addInput', "Add input");
								addInput.setAttribute('aria-label', addInput.title);
								addInput.setAttribute('aria-haspopup', 'dialog');
								addInput.setAttribute('aria-controls', `basehalf-video-inputs-popover-${document.id}`);
								const showInputs = () => showVideoComposerOverlay('inputs', 'video:inputs');
								formListeners.add(this.addDisposableListener(addInput, 'pointerdown', event => {
									if (event.button === 0) {
										showInputs();
									}
								}));
								formListeners.add(this.addDisposableListener(addInput, 'click', event => {
									if (event.detail === 0) {
										showInputs();
									}
								}));
							}
						}
						const promptSection = this.renderNodeLocalSection(body, 'Prompt');
						promptSection.classList.add('basehalf-video-prompt-section');
						const promptLabel = append(promptSection, $('label.basehalf-video-prompt-label')) as HTMLLabelElement;
						promptLabel.textContent = localize('basehalf.canvas.videoComposer.prompt', "Video prompt");
						if (configurationMutable) {
							const promptInput = stableVideoPromptInput
								?? $('textarea.basehalf-node-local-input.multiline.basehalf-video-prompt') as HTMLTextAreaElement;
							stableVideoPromptInput = promptInput;
							promptSection.appendChild(promptInput);
							registerFocusTarget(promptInput, 'video:prompt');
							promptInput.id = `basehalf-video-prompt-${document.id}`;
							promptLabel.htmlFor = promptInput.id;
							if (promptInput.value !== draftPrompt) {
								promptInput.value = draftPrompt;
							}
							promptInput.rows = 3;
							promptInput.maxLength = BASEHALF_NODE_PROMPT_MAX_LENGTH;
							promptInput.placeholder = localize('basehalf.canvas.videoComposer.promptPlaceholder', "Describe the video you want to generate. Use @ to reference canvas material.");
							promptInput.setAttribute('aria-label', promptLabel.textContent);
							formListeners.add(this.addDisposableListener(promptInput, 'input', () => {
								draftPrompt = promptInput.value;
								refreshSaveState();
								refreshLiveExecutionPresentation();
							}));
						} else {
							promptLabel.remove();
							const promptText = append(promptSection, $('.basehalf-video-prompt-copy'));
							promptText.textContent = draftPrompt || localize('basehalf.canvas.videoComposer.noPrompt', "No prompt saved");
							promptText.setAttribute('aria-label', `${localize('basehalf.canvas.videoComposer.prompt', "Video prompt")}: ${promptText.textContent}`);
							if (hasDraftChanges()) {
								promptText.classList.add('unsaved');
								const unsavedNotice = append(promptSection, $('.basehalf-video-prompt-unsaved'));
								unsavedNotice.textContent = localize('basehalf.canvas.videoComposer.unsavedFrozen', "Not included in the current Attempt");
								unsavedNotice.setAttribute('role', 'status');
							}
						}
					}
					if (!videoComposer) {
					const contentSection = this.renderNodeLocalSection(body, 'Content');
					const contentDescription = append(contentSection, $('.basehalf-node-local-description'));
					contentDescription.textContent = document.result
						? `This ${baseHalfNodeImportObjectLabel(document.kind)} is the sealed Result. It cannot be replaced or reconfigured.`
						: document.attempts.length > 0
							? baseHalfNodeAttemptHasCompleteRetrySnapshot(document.attempts.at(-1)!)
								? 'No Result was sealed. The configuration is locked; Retry uses the same saved settings.'
								: 'No Result was sealed, and the last Attempt stopped before its complete execution snapshot was frozen. Copy settings into a new Draft.'
							: document.recipe
								? 'This Draft is configured. Run it once, or make changes before its first attempt.'
								: 'Choose a recipe below, or import one local file as the Result.';
					const contentActions = append(contentSection, $('.basehalf-node-local-content-actions'));
					if (!importProblem) {
						const importContent = append(contentActions, $('button.basehalf-node-local-link')) as HTMLButtonElement;
						registerFocusTarget(importContent, 'content:import');
						importContent.type = 'button';
						importContent.textContent = baseHalfNodeImportActionLabel(document.kind);
						importContent.disabled = busy || this.workingCopyService.isDirty(item.stat.resource);
						importContent.title = importContent.disabled
							? 'Save this Draft and finish its active attempt first'
							: `${importContent.textContent} as the sealed Result`;
						formListeners.add(this.addDisposableListener(importContent, 'click', () => {
							if (!importContent.disabled) {
								void leaveSurface(() => this.importCanvasNodeResult(item));
							}
						}));
					}
					const artifact = getBaseHalfNodeResultArtifact(document);
					if (artifact && !verificationPending && !resultPreview.resultIntegrity) {
						const openResult = append(contentActions, $('button.basehalf-node-local-link')) as HTMLButtonElement;
						registerFocusTarget(openResult, 'content:open');
						openResult.type = 'button';
						openResult.textContent = `Open ${baseHalfNodeImportObjectLabel(document.kind)}`;
						formListeners.add(this.addDisposableListener(openResult, 'click', () => void leaveSurface(() => this.locateNodeArtifact(artifact))));
					}
					if (document.result || document.attempts.length > 0) {
						const copySettings = append(contentActions, $('button.basehalf-node-local-link')) as HTMLButtonElement;
						registerFocusTarget(copySettings, 'content:copy-settings');
						copySettings.type = 'button';
						copySettings.textContent = 'Copy settings to new Draft';
						copySettings.title = 'Create an independent Draft with the same recipe settings and no inherited Result or input bindings';
						formListeners.add(this.addDisposableListener(copySettings, 'click', () => void leaveSurface(() => this.copyCanvasNodeSettings(item))));
					}

					const recipeSection = this.renderNodeLocalSection(body, 'Recipe');
					const recipeSelect = append(recipeSection, $('select.basehalf-node-local-select')) as HTMLSelectElement;
					registerFocusTarget(recipeSelect, 'recipe');
					recipeSelect.setAttribute('aria-label', 'Recipe');
					const emptyRecipe = append(recipeSelect, $('option')) as HTMLOptionElement;
					emptyRecipe.value = '';
					emptyRecipe.textContent = document.recipe ? 'No recipe' : recipes.length > 0 ? 'Choose a recipe' : 'No recipes installed';
					if (selectedRecipeId && !selectedRecipe) {
						const missing = append(recipeSelect, $('option')) as HTMLOptionElement;
						missing.value = selectedRecipeId;
						missing.textContent = `${selectedRecipeId} (not installed)`;
						missing.disabled = true;
					}
					for (const recipe of recipes) {
						const option = append(recipeSelect, $('option')) as HTMLOptionElement;
						option.value = recipe.id;
						option.textContent = recipe.label;
					}
					recipeSelect.value = selectedRecipeId;
					recipeSelect.disabled = !configurationMutable;
					formListeners.add(this.addDisposableListener(recipeSelect, 'change', () => void (async () => {
						const nextId = recipeSelect.value;
						if (!nextId && selectedRecipeId && document.recipe) {
							const confirmation = await this.dialogService.confirm({
								message: `Remove the recipe from '${draftTitle.trim() || item.name}'?`,
								detail: 'This empty Draft will have no runnable recipe until another one is chosen.',
								primaryButton: 'Remove recipe'
							});
							if (!confirmation.confirmed) {
								recipeSelect.value = selectedRecipeId;
								return;
							}
						}
						const nextRecipe = this.canvasRecipeRegistryService.getRecipe(nextId);
						const preservesRecipe = nextRecipe?.id === document.recipe?.recipeId.toLowerCase();
						selectedRecipeId = nextId;
						selectedRecipe = nextRecipe;
						draftParameters = nextRecipe
							? { ...createBaseHalfNodeParameterDraft(nextRecipe, preservesRecipe ? document.recipe?.parameters ?? {} : {}) }
							: {};
						draftModelServiceId = preservesRecipe ? document.recipe?.modelServiceId : undefined;
						draftModelId = preservesRecipe ? document.recipe?.modelId : undefined;
						draftBindings = preservesRecipe ? document.recipe?.inputBindings ?? [] : [];
						renderSurface();
					})()));
					if (selectedRecipe?.description) {
						const description = append(recipeSection, $('.basehalf-node-local-description'));
						description.textContent = selectedRecipe.description;
					}

					if (selectedRecipe?.modelCapability) {
						const modelCapability = selectedRecipe.modelCapability;
						const modelSection = this.renderNodeLocalSection(body, 'Model service');
						const modelSelect = append(modelSection, $('select.basehalf-node-local-select')) as HTMLSelectElement;
						registerFocusTarget(modelSelect, 'model:service');
						modelSelect.setAttribute('aria-label', `${modelCapability} model service`);
						const emptyModel = append(modelSelect, $('option')) as HTMLOptionElement;
						emptyModel.value = '';
						emptyModel.textContent = 'Choose a configured service';
						for (const service of modelServices.filter(service => service.capabilities.includes(modelCapability))) {
							const option = append(modelSelect, $('option')) as HTMLOptionElement;
							option.value = service.id;
							option.textContent = service.configured ? service.label : `${service.label} (needs key)`;
							option.disabled = !service.configured;
						}
						modelSelect.value = draftModelServiceId ?? '';
						modelSelect.disabled = !configurationMutable;
						formListeners.add(this.addDisposableListener(modelSelect, 'change', () => {
							draftModelServiceId = modelSelect.value || undefined;
							renderSurface();
						}));
						const modelIdField = append(modelSection, $('.basehalf-node-local-field'));
						const modelIdLabel = append(modelIdField, $('label.basehalf-node-local-label')) as HTMLLabelElement;
						modelIdLabel.textContent = 'Model ID';
						const modelIdInput = append(modelIdField, $('input.basehalf-node-local-input')) as HTMLInputElement;
						registerFocusTarget(modelIdInput, 'model:id');
						modelIdInput.id = `basehalf-node-model-id-${Date.now()}`;
						modelIdLabel.htmlFor = modelIdInput.id;
						modelIdInput.value = draftModelId ?? '';
						modelIdInput.maxLength = 256;
						modelIdInput.placeholder = 'Provider model identifier (optional)';
						modelIdInput.disabled = !configurationMutable;
						modelIdInput.setAttribute('aria-label', 'Model ID');
						formListeners.add(this.addDisposableListener(modelIdInput, 'input', () => {
							draftModelId = modelIdInput.value;
							refreshSaveState();
						}));
						const manage = append(modelSection, $('button.basehalf-node-local-link')) as HTMLButtonElement;
						registerFocusTarget(manage, 'model:manage');
						manage.type = 'button';
						manage.textContent = 'Manage model services';
						formListeners.add(this.addDisposableListener(manage, 'click', () => void leaveSurface(
							async () => { await this.commandService.executeCommand(BASEHALF_MANAGE_MODEL_SERVICES_COMMAND_ID); }
						)));
					}

					const standardParameters = selectedRecipe?.parameters ?? [];
					if (selectedRecipe && standardParameters.length > 0) {
						const parametersSection = this.renderNodeLocalSection(body, 'Parameters');
						for (const parameter of standardParameters) {
							const parameterInput = this.renderNodeLocalParameter(parametersSection, parameter, draftParameters[parameter.id], value => {
								draftParameters[parameter.id] = value;
								refreshSaveState();
								refreshLiveExecutionPresentation();
							}, formListeners);
							parameterInput.disabled = !configurationMutable;
							registerFocusTarget(parameterInput, `parameter:${parameter.id}`);
						}
					}

					if (selectedRecipe) {
						const inputRecipe = selectedRecipe;
						const inputsSection = this.renderNodeLocalSection(body, 'Direct inputs');
						const inputNote = append(inputsSection, $('.basehalf-node-local-description'));
						inputNote.textContent = 'Connections provide direct context. Choose how this recipe uses each source.';
						const slotSummary = append(inputsSection, $('.basehalf-node-local-slot-summary'));
						for (const input of inputRecipe.inputs) {
							const count = draftBindings.filter(binding => binding.slot === input.id).length;
							const chip = append(slotSummary, $('.basehalf-node-local-slot'));
							chip.textContent = `${input.label} ${count} · ${input.minItems}-${input.maxItems}`;
						}
						const inputRows = getBaseHalfNodeInputRows(inputRecipe, draftBindings, inputKinds, inputResultIdentities);
						if (inputRows.length > 0) {
							const list = append(inputsSection, $('.basehalf-node-local-list'));
							for (const row of inputRows) {
								const entry = append(list, $('.basehalf-node-local-input-row'));
								entry.classList.toggle('invalid', !row.accepted);
								const inputText = append(entry, $('.basehalf-node-local-input-text'));
								const inputName = append(inputText, $('.basehalf-node-local-input-name'));
								inputName.textContent = row.sourcePath;
								const inputMeta = append(inputText, $('.basehalf-node-local-input-meta'));
								const resultIdentityLabel = row.resultIdentity
									? getBaseHalfNodeInputResultLabel(row.resultIdentity)
									: undefined;
								inputMeta.textContent = [
									inputKinds.get(row.sourcePath) ?? 'missing',
									resultIdentityLabel,
									`position ${row.order + 1}`
								].filter((value): value is string => value !== undefined).join(' · ');
								if (row.resultIdentity) {
									const resultKind = row.resultIdentity.source === 'attempt' ? 'generated' : 'imported';
									inputMeta.title = `Bound ${resultKind} Result: ${row.resultIdentity.id}`;
									inputMeta.setAttribute('aria-label', `${inputMeta.textContent}. Exact ${resultKind} Result ${row.resultIdentity.id}.`);
								}
								const slotSelect = append(entry, $('select.basehalf-node-local-compact-select')) as HTMLSelectElement;
								registerFocusTarget(slotSelect, `input:${row.sourcePath}:slot`);
								slotSelect.setAttribute('aria-label', `Input role for ${row.sourcePath}`);
								const sourceKind = inputKinds.get(row.sourcePath);
								const assignableSlots = sourceKind
									? getBaseHalfNodeAssignableInputSlots(inputRecipe, draftBindings, row.sourcePath, sourceKind)
									: [];
								if (!assignableSlots.some(slot => slot.id === row.slot)) {
									const unavailable = append(slotSelect, $('option')) as HTMLOptionElement;
									unavailable.value = row.slot;
									unavailable.textContent = `${row.slotLabel} (unavailable)`;
									unavailable.disabled = true;
								}
								for (const slot of assignableSlots) {
									const option = append(slotSelect, $('option')) as HTMLOptionElement;
									option.value = slot.id;
									option.textContent = slot.label;
								}
								slotSelect.value = row.slot;
								slotSelect.disabled = !configurationMutable;
								formListeners.add(this.addDisposableListener(slotSelect, 'change', () => {
									draftBindings = normalizeNodeInputBindings(draftBindings.map(binding => binding.order === row.order
										? { ...binding, slot: slotSelect.value }
										: binding));
									renderSurface();
								}));
								const sameSlotRows = inputRows.filter(candidate => candidate.slot === row.slot);
								const sameSlotIndex = sameSlotRows.findIndex(candidate => candidate.sourcePath === row.sourcePath);
								const moveUp = append(entry, $('button.basehalf-node-local-icon.codicon.codicon-chevron-up')) as HTMLButtonElement;
								registerFocusTarget(moveUp, `input:${row.sourcePath}:up`);
								moveUp.type = 'button';
								moveUp.disabled = !configurationMutable || this.workingCopyService.isDirty(item.stat.resource) || sameSlotIndex <= 0;
								moveUp.title = `Move ${row.sourcePath} earlier in ${row.slotLabel}`;
								moveUp.setAttribute('aria-label', moveUp.title);
								formListeners.add(this.addDisposableListener(moveUp, 'click', () => {
									draftBindings = moveBaseHalfNodeInputBinding(draftBindings, row.sourcePath, -1);
									renderSurface();
								}));
								const moveDown = append(entry, $('button.basehalf-node-local-icon.codicon.codicon-chevron-down')) as HTMLButtonElement;
								registerFocusTarget(moveDown, `input:${row.sourcePath}:down`);
								moveDown.type = 'button';
								moveDown.disabled = !configurationMutable || this.workingCopyService.isDirty(item.stat.resource) || sameSlotIndex < 0 || sameSlotIndex >= sameSlotRows.length - 1;
								moveDown.title = `Move ${row.sourcePath} later in ${row.slotLabel}`;
								moveDown.setAttribute('aria-label', moveDown.title);
								formListeners.add(this.addDisposableListener(moveDown, 'click', () => {
									draftBindings = moveBaseHalfNodeInputBinding(draftBindings, row.sourcePath, 1);
									renderSurface();
								}));
								const locate = append(entry, $('button.basehalf-node-local-icon.codicon.codicon-go-to-file')) as HTMLButtonElement;
								registerFocusTarget(locate, `input:${row.sourcePath}:open`);
								locate.type = 'button';
								locate.title = `Open ${row.sourcePath}`;
								locate.setAttribute('aria-label', locate.title);
								formListeners.add(this.addDisposableListener(locate, 'click', () => void leaveSurface(
									async () => { await this.canvasNavigationService.openResource(joinPath(folder.workspaceFolder, ...row.sourcePath.split('/')), { source: 'api', pinned: true }); }
								)));
								const remove = append(entry, $('button.basehalf-node-local-icon.codicon.codicon-close')) as HTMLButtonElement;
								registerFocusTarget(remove, `input:${row.sourcePath}:remove`);
								remove.type = 'button';
								remove.disabled = !configurationMutable || this.workingCopyService.isDirty(item.stat.resource);
								remove.title = `Remove connection from ${row.sourcePath}`;
								remove.setAttribute('aria-label', remove.title);
								formListeners.add(this.addDisposableListener(remove, 'click', () => {
									removedConnections.add(row.sourcePath);
									draftBindings = normalizeNodeInputBindings(draftBindings.filter(binding => binding.order !== row.order));
									renderSurface();
								}));
							}
						}
						const available = inboundSources.flatMap(source => source.kind === undefined ? [] : getBaseHalfNodeAvailableInputSlots(inputRecipe, draftBindings, source.path, source.kind)
							.map(slot => ({ source, slot })));
						if (available.length > 0) {
							const addRow = append(inputsSection, $('.basehalf-node-local-add-input'));
							const addSelect = append(addRow, $('select.basehalf-node-local-select')) as HTMLSelectElement;
							registerFocusTarget(addSelect, 'input:add');
							const placeholder = append(addSelect, $('option')) as HTMLOptionElement;
							placeholder.value = '';
							placeholder.textContent = 'Use connected context…';
							for (const candidate of available) {
								const option = append(addSelect, $('option')) as HTMLOptionElement;
								option.value = `${candidate.source.path}\u0000${candidate.slot.id}`;
								option.textContent = `${candidate.source.path} → ${candidate.slot.label}`;
							}
							addSelect.disabled = !configurationMutable;
							formListeners.add(this.addDisposableListener(addSelect, 'change', () => {
								const [sourcePath, slot] = addSelect.value.split('\u0000');
								if (sourcePath && slot) {
									removedConnections.delete(sourcePath);
									draftBindings = normalizeNodeInputBindings([...draftBindings, { sourcePath, slot, order: draftBindings.length }]);
									renderSurface();
								}
							}));
						} else if (inputRows.length === 0) {
							const empty = append(inputsSection, $('.basehalf-node-local-empty'));
							empty.textContent = inboundSources.length === 0
								? 'Connect context to this node to make inputs available.'
								: 'Connected context is not compatible with this recipe.';
						}
					}

					const detailsSection = this.renderNodeLocalSection(body, 'Details');
					detailsSection.classList.add('low-priority');
					const titleField = append(detailsSection, $('.basehalf-node-local-field'));
					const titleLabel = append(titleField, $('label.basehalf-node-local-label')) as HTMLLabelElement;
					titleLabel.textContent = 'Title';
					const titleInput = append(titleField, $('input.basehalf-node-local-input')) as HTMLInputElement;
					registerFocusTarget(titleInput, 'details:title');
					titleInput.id = `basehalf-node-title-${document.id}`;
					titleLabel.htmlFor = titleInput.id;
					titleInput.value = draftTitle;
					titleInput.maxLength = 240;
					titleInput.disabled = !configurationMutable;
					titleInput.setAttribute('aria-label', 'Node title');
					formListeners.add(this.addDisposableListener(titleInput, 'input', () => {
						draftTitle = titleInput.value;
						title.textContent = draftTitle.trim() || 'Untitled';
						refreshSaveState();
					}));
					const roleField = append(detailsSection, $('.basehalf-node-local-field'));
					const roleLabel = append(roleField, $('label.basehalf-node-local-label')) as HTMLLabelElement;
					roleLabel.textContent = 'Role';
					const roleInput = append(roleField, $('input.basehalf-node-local-input')) as HTMLInputElement;
					registerFocusTarget(roleInput, 'details:role');
					roleInput.id = `basehalf-node-role-${document.id}`;
					roleLabel.htmlFor = roleInput.id;
					roleInput.value = draftRole;
					roleInput.maxLength = 120;
					roleInput.disabled = !configurationMutable;
					roleInput.setAttribute('aria-label', 'Node role');
					formListeners.add(this.addDisposableListener(roleInput, 'input', () => {
						draftRole = roleInput.value;
						role.textContent = `${nodeKindLabel(document.kind)} · ${draftRole.trim() || 'Role required'}`;
						refreshSaveState();
					}));
					}

					const attemptsBody = !videoComposer
						? append(surface, $('.basehalf-node-local-body.mode-attempts'))
						: undefined;
					renderedAttemptsBody = attemptsBody;
					if (attemptsBody) {
						attemptsBody.id = `basehalf-node-attempts-panel-${document.id}`;
						attemptsBody.setAttribute('role', 'tabpanel');
						attemptsBody.setAttribute('aria-labelledby', `basehalf-node-attempts-${document.id}`);
					}
					if (attemptsBody && localSurfaceMode === 'attempts') {
						this.renderNodeLocalAttempts(
							attemptsBody,
							document,
							formListeners,
							registerFocusTarget,
							expandedAttemptDisclosures,
							attemptsVisibleCount,
							() => {
								attemptsVisibleCount += 50;
								renderSurface();
							}
						);
					}

					const footer = append(surface, $('.basehalf-node-local-footer'));
					const footerMessage = append(footer, $('.basehalf-node-local-footer-message'));
					footerMessage.setAttribute('role', 'status');
					footerMessage.setAttribute('aria-live', 'polite');
					let videoModel: HTMLButtonElement | undefined;
					let videoSettings: HTMLButtonElement | undefined;
					let videoAttempts: HTMLButtonElement | undefined;
					let videoPrimary: HTMLButtonElement | undefined;
					let refreshVideoMetadata = () => { };
					if (videoComposer) {
						const metadata = append(footer, $('.basehalf-video-composer-metadata'));
						videoModel = append(metadata, $('button.basehalf-video-model-trigger')) as HTMLButtonElement;
						registerFocusTarget(videoModel, 'video:model');
						videoModel.type = 'button';
						videoModel.dataset.videoComposerTrigger = 'models';
						videoModel.setAttribute('aria-haspopup', 'dialog');
						videoModel.setAttribute('aria-controls', `basehalf-video-models-popover-${document.id}`);
						formListeners.add(this.addDisposableListener(videoModel, 'click', () => {
							if (videoComposerOverlay === 'models') {
								closeVideoComposerOverlay(true);
							} else {
								showVideoComposerOverlay('models', 'video:model');
							}
						}));
						videoSettings = append(metadata, $('button.basehalf-video-settings-trigger')) as HTMLButtonElement;
						registerFocusTarget(videoSettings, 'video:settings');
						videoSettings.type = 'button';
						videoSettings.dataset.videoComposerTrigger = 'settings';
						videoSettings.setAttribute('aria-haspopup', 'dialog');
						videoSettings.setAttribute('aria-controls', `basehalf-video-settings-popover-${document.id}`);
						formListeners.add(this.addDisposableListener(videoSettings, 'click', () => {
							if (videoComposerOverlay === 'settings') {
								closeVideoComposerOverlay(true);
							} else {
								showVideoComposerOverlay('settings', 'video:settings');
							}
						}));
						const controls = append(footer, $('.basehalf-video-composer-controls'));
						if (document.attempts.length > 0) {
							videoAttempts = append(controls, $('button.basehalf-video-composer-control.basehalf-video-attempts-trigger.codicon.codicon-history')) as HTMLButtonElement;
							registerFocusTarget(videoAttempts, 'video:attempts');
							videoAttempts.type = 'button';
							videoAttempts.dataset.videoComposerTrigger = 'attempts';
							videoAttempts.title = localize('basehalf.canvas.videoComposer.showAttempts', "Show video attempts");
							videoAttempts.setAttribute('aria-label', videoAttempts.title);
							videoAttempts.setAttribute('aria-haspopup', 'dialog');
							videoAttempts.setAttribute('aria-controls', `basehalf-video-attempts-popover-${document.id}`);
							formListeners.add(this.addDisposableListener(videoAttempts, 'click', () => {
								if (videoComposerOverlay === 'attempts') {
									closeVideoComposerOverlay(true);
								} else {
									showVideoComposerOverlay('attempts', 'video:attempts');
								}
							}));
						}
						if (!document.result) {
							videoPrimary = append(controls, $('button.basehalf-video-composer-primary.codicon')) as HTMLButtonElement;
							registerFocusTarget(videoPrimary, 'video:primary');
							videoPrimary.type = 'button';
						}

						const overlayRoot = append(surface, $('.basehalf-video-composer-overlay-root'));
						overlayRoot.dataset.nodePath = item.path;
						const videoModelTrigger = videoModel;
						const videoSettingsTrigger = videoSettings;
						const overlayListeners = new DisposableStore();
						formListeners.add(overlayListeners);
						const overlayTriggers = new Map<BaseHalfVideoComposerOverlay, HTMLButtonElement>([
							['models', videoModel],
							['settings', videoSettings],
							...(surface.querySelector<HTMLButtonElement>('.basehalf-video-input-add-trigger')
								? [['inputs', surface.querySelector<HTMLButtonElement>('.basehalf-video-input-add-trigger')!] as const]
								: []),
							...(videoAttempts ? [['attempts', videoAttempts] as const] : [])
						]);
						const syncOverlayTriggers = () => {
							for (const [candidate, trigger] of overlayTriggers) {
								const open = videoComposerOverlay === candidate;
								trigger.classList.toggle('active', open);
								trigger.setAttribute('aria-expanded', String(open));
							}
							videoModelTrigger.classList.toggle('active', videoComposerOverlay === 'models');
							videoModelTrigger.setAttribute('aria-expanded', String(videoComposerOverlay === 'models'));
							videoSettingsTrigger.classList.toggle('active', videoComposerOverlay === 'settings');
						};
						const appendPopoverHeading = (popover: HTMLElement, text: string, id: string): void => {
							const heading = append(popover, $('.basehalf-video-popover-heading'));
							heading.id = id;
							heading.textContent = text;
						};
						const applyVideoNormalization = (
							resolution: IBaseHalfSupportedVideoCapabilityResolution,
							candidate: unknown,
							context?: string
						) => {
							const inputs = baseHalfVideoInputState(draftPrompt, draftBindings, inputKinds);
							const normalization = normalizeBaseHalfVideoSettingsForCapability(resolution, inputs, candidate);
							const catalogId = selectedRecipe?.videoModelCatalogId;
							if (!catalogId) {
								videoSettingsNotice = localize('basehalf.canvas.videoComposer.generatorCatalogUnavailable', "The selected video generator has no reviewed model catalog.");
								return normalization;
							}
							draftParameters = baseHalfVideoSettingsAsParameterDraft(
								normalization.values,
								createBaseHalfVideoModelSelectionSnapshotFromCapability(catalogId, resolution, inputs)
							);
							if (normalization.adjustments.length > 0) {
								videoSettingsAdjustments = mergeBaseHalfVideoSettingAdjustments(videoSettingsAdjustments, normalization.adjustments);
							}
							if (normalization.status === 'unavailable') {
								videoSettingsNotice = normalization.reason;
							} else {
								videoSettingsNotice = context;
							}
							return normalization;
						};
						const currentVideoSettingsParameters = (): readonly IBaseHalfVideoParameterPresentation[] => {
							const current = readVideoModelState();
							return current.resolution?.status === 'supported' && current.normalization
								? createBaseHalfVideoModelSettingsPresentation(current.resolution, current.normalization).parameters
								: [];
						};
						const selectVideoGenerator = (nextRecipe: IBaseHalfCanvasRecipeDescriptor): void => {
							if (nextRecipe.id === selectedRecipe?.id) {
								return;
							}
							selectedRecipeId = nextRecipe.id;
							selectedRecipe = nextRecipe;
							// Catalog snapshots and provider/model identity belong to the
							// previous recipe. Candidate scalar values and bindings remain
							// available to the one model-reconciliation transaction below.
							draftModelServiceId = undefined;
							draftModelId = undefined;
							draftVideoModelKey = undefined;
							videoSettingsNotice = nextRecipe.modelCapability === 'video'
								? localize('basehalf.canvas.videoComposer.generatorChangedChooseModel', "Generator changed to {0}. Choose a model.", nextRecipe.label)
								: localize('basehalf.canvas.videoComposer.localGeneratorChanged', "Generator changed to {0}. Review its parameters and inputs.", nextRecipe.label);
						};
						const selectVideoDescriptor = (
							registry: IBaseHalfVideoModelRegistry,
							descriptor: IBaseHalfVideoModelDescriptor,
							inputs: BaseHalfVideoInputState,
							requestedMode?: BaseHalfVideoGenerationMode,
							context?: string,
							previousParameters: readonly IBaseHalfVideoParameterPresentation[] = []
						): void => {
							draftModelId = descriptor.key.modelId;
							draftVideoModelKey = descriptor.key;
							const candidate = baseHalfVideoSettingsFromParameterDraft(draftParameters);
							const savedMode = candidate[BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID];
							const previousMode = typeof savedMode === 'string' && (BASEHALF_VIDEO_GENERATION_MODES as readonly string[]).includes(savedMode)
								? savedMode as BaseHalfVideoGenerationMode
								: undefined;
							const reconciliation = requestedMode
								? reconcileBaseHalfVideoGenerationMethodSettings(descriptor, requestedMode, previousMode, candidate, inputs)
								: reconcileBaseHalfVideoModelSettings(descriptor, previousMode, candidate, inputs);
							videoSettingsAdjustments = reconciliation.normalization?.adjustments ?? [];
							videoSettingsAdjustmentPreviousParameters = previousParameters;
							if (reconciliation.status === 'unavailable') {
								if (reconciliation.normalization) {
									draftParameters = baseHalfVideoSettingsAsParameterDraft(reconciliation.normalization.values);
								}
								videoSettingsNotice = reconciliation.reason;
								return;
							}
							const catalogId = selectedRecipe?.videoModelCatalogId;
							const resolution = registry.resolveCapability({ ...descriptor.key, mode: reconciliation.mode });
							if (!catalogId || resolution.status !== 'supported') {
								videoSettingsNotice = resolution.status === 'supported'
									? localize('basehalf.canvas.videoComposer.generatorCatalogUnavailable', "The selected video generator has no reviewed model catalog.")
									: resolution.reason;
								return;
							}
							draftParameters = baseHalfVideoSettingsAsParameterDraft(
								reconciliation.normalization.values,
								createBaseHalfVideoModelSelectionSnapshotFromCapability(catalogId, resolution, inputs)
							);
							videoSettingsNotice = reconciliation.methodChanged && reconciliation.previousMode
								? localize(
									'basehalf.canvas.videoComposer.modelMethodReconciled',
									"Generation method changed from {0} to {1} for the selected model.",
									BASEHALF_VIDEO_MODE_LABELS[reconciliation.previousMode],
									BASEHALF_VIDEO_MODE_LABELS[reconciliation.mode]
								)
								: context;
						};
						const renderVideoModelPicker = (
							popover: HTMLElement,
							headingId: string,
							focusKey: string | undefined,
							registerOverlayFocusTarget: <T extends HTMLElement>(element: T, key: string, preferred?: boolean) => T
						): void => {
							videoModelFocusTargets = new Map();
							appendPopoverHeading(popover, localize('basehalf.canvas.videoComposer.modelsHeading', "Video models"), headingId);
							const pickerStatus = readVideoMessagePrecedence().primaryMessage?.message;
							if (pickerStatus) {
								const notice = append(popover, $('.basehalf-video-capability-status.basehalf-video-model-picker-notice'));
								notice.setAttribute('role', 'status');
								notice.setAttribute('aria-live', 'polite');
								notice.textContent = pickerStatus;
							}
							const list = append(popover, $('.basehalf-video-model-list'));
							list.dataset.videoOverlayScrollKey = 'models';
							const providerSpecs = this.modelProviderCatalogService.getConnectionSpecs();
							const modelEntries: Array<{
								readonly recipe: IBaseHalfCanvasRecipeDescriptor;
								readonly registry: IBaseHalfVideoModelRegistry;
								readonly descriptor: IBaseHalfVideoModelDescriptor;
								readonly spec?: IBaseHalfRegisteredModelProviderConnectionSpec;
								readonly service?: IBaseHalfModelServiceDescriptor;
								readonly usableService?: IBaseHalfModelServiceDescriptor;
								readonly choice: IBaseHalfVideoModelChoice;
								readonly presentation: IBaseHalfVideoModelPresentationEntry;
								readonly exactDraftIdentity: boolean;
							}> = [];
							const selectedSettings = baseHalfVideoSettingsFromParameterDraft(draftParameters);
							const selectedMode = selectedSettings[BASEHALF_VIDEO_GENERATION_MODE_PARAMETER_ID];
							const pickerInputs = baseHalfVideoInputState(draftPrompt, draftBindings, inputKinds);
							const draftService = modelServices.find(candidate => candidate.id === draftModelServiceId);
							for (const recipe of videoGeneratorRecipes().filter(candidate => candidate.modelCapability === 'video' && candidate.videoModelCatalogId)) {
								const registry = baseHalfVideoRegistryForRecipe(this.videoModelCatalogService, recipe);
								const ownedSpecs = providerSpecs.filter(spec => spec.extensionId === recipe.extensionId && spec.capabilities.includes('video'));
								for (const descriptor of registry.models) {
									const spec = ownedSpecs.find(candidate => candidate.providerId === descriptor.key.provider
										&& candidate.deploymentId === descriptor.key.deployment
										&& candidate.region === descriptor.key.region);
									const service = spec ? modelServices.find(candidate => candidate.specId === spec.id) : undefined;
									const usableService = service?.configured
										&& isBaseHalfPublicHttpsBearerModelServiceConfiguration(service)
										&& baseHalfVideoModelMatchesServiceScope(descriptor, service)
										? service
										: undefined;
									const exactDraftIdentity = recipe.id === selectedRecipe?.id
										&& descriptor.key.modelId === draftModelId
										&& (draftVideoModelKey
											? descriptor.key.provider === draftVideoModelKey.provider
												&& descriptor.key.deployment === draftVideoModelKey.deployment
												&& descriptor.key.region === draftVideoModelKey.region
												&& descriptor.key.revision === draftVideoModelKey.revision
											: !draftService || draftService.specId === spec?.id);
									const choice: IBaseHalfVideoModelChoice = Object.freeze({
										recipeId: recipe.id,
										catalogId: recipe.videoModelCatalogId!,
										providerId: descriptor.key.provider,
										deploymentId: descriptor.key.deployment,
										region: descriptor.key.region,
										modelId: descriptor.key.modelId,
										revision: descriptor.key.revision,
										...(spec ? { connectionSpecId: spec.id } : {}),
										...(service ? { connectionServiceId: service.id } : {})
									});
									let selectionProblem: IBaseHalfVideoModelPresentationEntry['selectionProblem'];
									if (exactDraftIdentity && typeof selectedMode === 'string') {
										const selectedCapability = descriptor.modes.find(mode => mode.mode === selectedMode && !mode.availability);
										if (!selectedCapability) {
											selectionProblem = {
												reason: localize('basehalf.canvas.videoComposer.selectedMethodNeedsReview', "The selected generation method is no longer available for this model."),
												repairSurface: 'settings'
											};
										} else {
											const selectedResolution = registry.resolveCapability({ ...descriptor.key, mode: selectedCapability.mode });
											if (selectedResolution.status !== 'supported') {
												selectionProblem = { reason: selectedResolution.reason, repairSurface: 'settings' };
											} else {
												const selectedNormalization = normalizeBaseHalfVideoSettingsForCapability(selectedResolution, pickerInputs, selectedSettings);
												if (selectedNormalization.status === 'unavailable') {
													selectionProblem = { reason: selectedNormalization.reason, repairSurface: 'settings' };
												}
											}
										}
									}
									const presentation: IBaseHalfVideoModelPresentationEntry = Object.freeze({
										choice,
										descriptor,
										connectionState: usableService ? 'configured' : service ? 'needs-attention' : 'missing',
										providerLabel: spec?.providerLabel ?? descriptor.key.provider,
										deploymentLabel: spec?.label ?? descriptor.key.region,
										groupLabel: `${spec?.providerLabel ?? descriptor.key.provider} · ${spec?.label ?? descriptor.key.region}`,
										...(selectionProblem ? { selectionProblem } : {})
									});
									modelEntries.push({ recipe, registry, descriptor, spec, service, usableService, choice, presentation, exactDraftIdentity });
								}
							}
						const selectedEntry = modelEntries.find(entry => entry.exactDraftIdentity);
							const selectedChoice = selectedEntry?.choice ?? (selectedRecipe?.modelCapability === 'video'
								&& selectedRecipe.videoModelCatalogId && draftVideoModelKey && draftModelId
								? Object.freeze({
									recipeId: selectedRecipe.id,
									catalogId: selectedRecipe.videoModelCatalogId,
									providerId: draftVideoModelKey.provider,
									deploymentId: draftVideoModelKey.deployment,
									region: draftVideoModelKey.region,
									modelId: draftModelId,
									revision: draftVideoModelKey.revision,
									...(draftService ? { connectionSpecId: draftService.specId, connectionServiceId: draftService.id } : {})
								})
								: undefined);
							const pickerPresentation = createBaseHalfVideoModelPickerPresentation({
								entries: modelEntries.map(entry => entry.presentation),
								...(selectedChoice ? { selectedChoice } : {}),
								...(!selectedEntry && selectedChoice ? {
									staleSelection: {
										choice: selectedChoice,
										label: draftModelId ?? localize('basehalf.canvas.videoComposer.previousModel', "Previous model"),
										reason: localize('basehalf.canvas.videoComposer.modelRevisionNeedsReview', "This saved model revision is no longer in the reviewed catalog. Choose a current model.")
									}
								} : {}),
								query: videoModelSearchQuery
							});
							videoModelPickerRows = Object.freeze([
								...(pickerPresentation.pinnedSelectedRow ? [pickerPresentation.pinnedSelectedRow] : []),
								...pickerPresentation.rows
							]);
							videoModelPickerShowSearch = pickerPresentation.showSearch;
							if (pickerPresentation.showSearch) {
								const searchRoot = append(popover, $('.basehalf-video-model-search'));
								popover.insertBefore(searchRoot, list);
								const search = registerOverlayFocusTarget(
									append(searchRoot, $('input.basehalf-video-model-search-input')) as HTMLInputElement,
									'model:search',
									focusKey === 'model:search'
								);
								search.type = 'search';
								search.placeholder = localize('basehalf.canvas.videoComposer.searchModels', "Search models");
								search.setAttribute('aria-label', search.placeholder);
								search.value = videoModelSearchQuery;
								overlayListeners.add(this.addDisposableListener(search, 'input', () => {
									videoModelSearchQuery = search.value;
									showVideoComposerOverlay('models', 'model:search');
								}));
							}
								const rows = [
									...(pickerPresentation.pinnedSelectedRow ? [pickerPresentation.pinnedSelectedRow] : []),
									...pickerPresentation.rows
								];
								const pinnedSelectedLogicalKey = pickerPresentation.pinnedSelectedRow?.logicalKey;
								const pinnedSelectedProviderGroupKey = '\u0000selected';
								const entryByKey = new Map(modelEntries.map(entry => [baseHalfVideoModelChoiceLogicalKey(entry.choice), entry] as const));
						const visibleModelEntries = rows.flatMap(row => {
							const entry = entryByKey.get(row.logicalKey);
							return entry ? [{ ...entry, row }] : [];
						});
						const staleRow = rows.find(row => !entryByKey.has(row.logicalKey));
						if (!visibleModelEntries.length && !staleRow) {
							const empty = append(list, $('.basehalf-video-popover-empty'));
							empty.textContent = videoModelSearchQuery
								? localize('basehalf.canvas.videoComposer.noMatchingModels', "No models match this search.")
								: localize('basehalf.canvas.videoComposer.noReviewedModelsInstalled', "No reviewed video models are installed.");
							return;
						}

								const providerGroups = new Map<string, typeof visibleModelEntries>();
								const modelRowButtons: HTMLButtonElement[] = [];
							const wireModelRowKeyboard = (row: HTMLButtonElement): void => {
								modelRowButtons.push(row);
								overlayListeners.add(this.addDisposableListener(row, 'keydown', event => {
									const currentIndex = modelRowButtons.indexOf(row);
									const nextIndex = event.key === 'ArrowDown'
										? (currentIndex + 1) % modelRowButtons.length
										: event.key === 'ArrowUp'
											? (currentIndex - 1 + modelRowButtons.length) % modelRowButtons.length
											: event.key === 'Home'
												? 0
												: event.key === 'End'
													? modelRowButtons.length - 1
													: undefined;
									if (nextIndex === undefined || nextIndex === currentIndex) {
										return;
									}
									event.preventDefault();
									for (const candidate of modelRowButtons) {
										candidate.tabIndex = candidate === modelRowButtons[nextIndex] ? 0 : -1;
									}
									modelRowButtons[nextIndex].focus();
								}));
							};
						if (staleRow) {
								const staleGroup = append(list, $('.basehalf-video-model-provider-group.basehalf-video-model-stale-group'));
								const staleHeading = append(staleGroup, $('.basehalf-video-model-provider-heading'));
								staleHeading.textContent = localize('basehalf.canvas.videoComposer.selectedModel', "Selected model");
								const staleButton = registerOverlayFocusTarget(
									append(staleGroup, $('button.basehalf-video-model-option.selected.needs-review')) as HTMLButtonElement,
									'model:stale',
									requestedVideoModelRepairFocusLogicalKey === staleRow.logicalKey
								);
								staleButton.dataset.modelLogicalKey = staleRow.logicalKey;
								videoModelFocusTargets.set(staleRow.logicalKey, staleButton);
								staleButton.type = 'button';
								staleButton.dataset.modelState = staleRow.state;
								staleButton.dataset.connectionState = 'locked';
								staleButton.setAttribute('aria-pressed', 'true');
								staleButton.title = staleRow.disabledReason ?? staleRow.label;
								staleButton.setAttribute('aria-label', staleButton.title);
								const staleIcon = append(staleButton, $('.basehalf-video-model-option-icon.codicon.codicon-warning'));
								staleIcon.setAttribute('aria-hidden', 'true');
								const staleCopy = append(staleButton, $('.basehalf-video-model-option-copy'));
								const staleLabel = append(staleCopy, $('.basehalf-video-model-option-label'));
								staleLabel.textContent = staleRow.label;
								const staleReason = append(staleCopy, $('.basehalf-video-model-option-reason'));
								staleReason.textContent = staleRow.disabledReason ?? localize('basehalf.canvas.videoComposer.chooseCurrentModel', "Choose a current model.");
								const staleState = append(staleButton, $('.basehalf-video-model-option-state'));
								staleState.textContent = localize('basehalf.canvas.videoComposer.needsReview', "Needs review");
								wireModelRowKeyboard(staleButton);
								overlayListeners.add(this.addDisposableListener(staleButton, 'click', () => {
									videoModelSearchQuery = '';
									requestedVideoModelRepairFocusLogicalKey = staleRow.repairFocusLogicalKey;
									showVideoComposerOverlay('models');
								}));
							}
								for (const entry of visibleModelEntries) {
									const providerId = entry.row.logicalKey === pinnedSelectedLogicalKey
										? pinnedSelectedProviderGroupKey
										: entry.spec?.providerId ?? entry.descriptor.key.provider;
									const group = providerGroups.get(providerId) ?? [];
									group.push(entry);
									providerGroups.set(providerId, group);
								}
								for (const [providerId, providerEntries] of providerGroups) {
									const pinnedSelectedGroup = providerId === pinnedSelectedProviderGroupKey;
									const providerGroup = append(list, $('.basehalf-video-model-provider-group'));
									providerGroup.classList.toggle('basehalf-video-model-selected-group', pinnedSelectedGroup);
									if (pinnedSelectedGroup) {
										providerGroup.setAttribute('role', 'group');
										const providerHeading = append(providerGroup, $('.basehalf-video-model-provider-heading'));
										providerHeading.id = `basehalf-video-selected-model-heading-${document.id}`;
										providerHeading.textContent = localize('basehalf.canvas.videoComposer.selectedModel', "Selected model");
										providerGroup.setAttribute('aria-labelledby', providerHeading.id);
									} else {
										providerGroup.dataset.providerId = providerId;
										if (pickerPresentation.showScopeHeadings && [...providerGroups.keys()].filter(key => key !== pinnedSelectedProviderGroupKey).length > 1) {
											const providerHeading = append(providerGroup, $('.basehalf-video-model-provider-heading'));
											providerHeading.textContent = providerEntries[0].spec?.providerLabel ?? providerId;
										}
									}
									const specGroups = new Map<string, typeof visibleModelEntries>();
									for (const entry of providerEntries) {
										const specId = pinnedSelectedGroup
											? pinnedSelectedProviderGroupKey
											: entry.spec?.id ?? `${entry.descriptor.key.deployment}/${entry.descriptor.key.region}`;
										const group = specGroups.get(specId) ?? [];
									group.push(entry);
									specGroups.set(specId, group);
								}
									for (const [specId, specEntries] of specGroups) {
										const specGroup = append(providerGroup, $('.basehalf-video-model-spec-group'));
										if (!pinnedSelectedGroup) {
											specGroup.dataset.specId = specId;
											if (pickerPresentation.showScopeHeadings && specGroups.size > 1) {
												const specHeading = append(specGroup, $('.basehalf-video-model-spec-heading'));
												specHeading.textContent = specEntries[0].spec?.label ?? specId;
											}
										}
								for (const { recipe, registry, descriptor, spec, service, usableService, row: rowPresentation } of specEntries) {
									const selected = rowPresentation.selected;
									const unavailable = rowPresentation.state === 'unavailable';
									const locked = rowPresentation.state === 'connect' || rowPresentation.state === 'needs-review';
									const connectionNeedsAttention = rowPresentation.state === 'connect' && !!service;
										const focusToken = `${recipe.id}:${descriptor.key.provider}:${descriptor.key.deployment}:${descriptor.key.region}:${descriptor.key.modelId}:${descriptor.key.revision}`;
										const row = registerOverlayFocusTarget(
											append(specGroup, $('button.basehalf-video-model-option')) as HTMLButtonElement,
											`model:${focusToken}`,
											!unavailable && (selected || focusKey === 'video:model' || requestedVideoModelRepairFocusLogicalKey === rowPresentation.logicalKey)
										);
										row.dataset.modelLogicalKey = rowPresentation.logicalKey;
										videoModelFocusTargets.set(rowPresentation.logicalKey, row);
										row.type = 'button';
										row.dataset.providerId = descriptor.key.provider;
										row.dataset.modelId = descriptor.key.modelId;
										row.dataset.modelState = rowPresentation.state;
										row.dataset.connectionState = unavailable ? 'unavailable' : locked ? 'locked' : 'available';
										if (spec) {
											row.dataset.specId = spec.id;
										}
										row.classList.toggle('selected', selected);
										row.classList.toggle('needs-review', rowPresentation.state === 'needs-review');
										row.setAttribute('aria-pressed', String(selected));
										row.disabled = unavailable || !configurationMutable;
										row.tabIndex = selected && !unavailable ? 0 : -1;
										const icon = append(row, $('.basehalf-video-model-option-icon.codicon.codicon-server-process'));
										icon.setAttribute('aria-hidden', 'true');
										const copy = append(row, $('.basehalf-video-model-option-copy'));
										const label = append(copy, $('.basehalf-video-model-option-label'));
										label.textContent = rowPresentation.label;
										const meta = append(copy, $('.basehalf-video-model-option-meta'));
										const ownershipSummary = recipe.id === selectedRecipe?.id ? recipe.label : `${recipe.label} / ${descriptor.key.region}`;
										const ownership = append(meta, $('.basehalf-video-model-option-ownership'));
										ownership.textContent = rowPresentation.disambiguationLabel ?? ownershipSummary;
										if (rowPresentation.capabilityTokens.length > 0) {
											const tokens = append(meta, $('.basehalf-video-model-capability-tokens'));
											for (const token of rowPresentation.capabilityTokens) {
												const tokenElement = append(tokens, $('.basehalf-video-model-capability-token'));
												tokenElement.dataset.tokenKind = token.kind;
												tokenElement.textContent = token.label;
											}
										}
										if (rowPresentation.disabledReason) {
											const reason = append(meta, $('.basehalf-video-model-option-reason'));
											reason.textContent = rowPresentation.disabledReason;
										}
										const connectionState = append(row, $('.basehalf-video-model-option-state'));
										const stateText = append(connectionState, $('.basehalf-video-model-option-state-text'));
										stateText.textContent = rowPresentation.state === 'unavailable'
											? localize('basehalf.canvas.videoComposer.unavailable', "Unavailable")
											: rowPresentation.state === 'needs-review'
												? localize('basehalf.canvas.videoComposer.needsReview', "Needs review")
										: rowPresentation.state === 'connect'
											? connectionNeedsAttention
												? localize('basehalf.canvas.videoComposer.connectionNeedsAttention', "Needs attention · Review connection")
												: spec ? localize('basehalf.canvas.videoComposer.connectAddApiKey', "Connect · Add API key") : localize('basehalf.canvas.videoComposer.providerSetupUnavailable', "Setup unavailable")
													: rowPresentation.state === 'selected'
														? localize('basehalf.canvas.videoComposer.selected', "Selected")
														: localize('basehalf.canvas.videoComposer.available', "Available");
									const stateIcon = append(connectionState, $(`.basehalf-video-model-option-state-icon.codicon.${unavailable ? 'codicon-circle-slash' : rowPresentation.state === 'needs-review' || connectionNeedsAttention ? 'codicon-warning' : locked ? 'codicon-lock' : selected ? 'codicon-check' : 'codicon-unlock'}`));
										stateIcon.setAttribute('aria-hidden', 'true');
									row.title = rowPresentation.disabledReason ?? (connectionNeedsAttention
										? localize('basehalf.canvas.videoComposer.reviewConnectionForModel', "Review the connection for {0} before using {1}.", spec?.providerLabel ?? descriptor.key.provider, descriptor.label)
										: locked
										? spec
												? localize('basehalf.canvas.videoComposer.configureProviderForModel', "Add an API key for {0} to use {1}.", spec.providerLabel, descriptor.label)
												: localize('basehalf.canvas.videoComposer.noProviderContract', "No official connection setup is available for this model.")
										: localize('basehalf.canvas.videoComposer.useModel', "Use {0}.", descriptor.label));
									row.setAttribute('aria-label', row.title);
									if (rowPresentation.disabledReason) {
										row.setAttribute('aria-description', rowPresentation.disabledReason);
									}
										if (unavailable) {
											continue;
										}
										wireModelRowKeyboard(row);
										overlayListeners.add(this.addDisposableListener(row, 'click', () => {
										if (rowPresentation.action === 'select' && usableService) {
											const previousParameters = currentVideoSettingsParameters();
											selectVideoGenerator(recipe);
											draftModelServiceId = usableService.id;
											selectVideoDescriptor(registry, descriptor, baseHalfVideoInputState(draftPrompt, draftBindings, inputKinds), undefined,
												localize('basehalf.canvas.videoComposer.modelChanged', "Model changed to {0}.", descriptor.label), previousParameters);
												refreshVideoMetadata();
												refreshSaveState();
												refreshLiveExecutionPresentation();
												showVideoComposerOverlay('models', `model:${focusToken}`);
												return;
											}
											if (rowPresentation.action === 'repair' && rowPresentation.repairSurface === 'settings') {
												showVideoComposerOverlay('settings', 'video:settings');
												return;
											}
											if (rowPresentation.action === 'none') {
												return;
											}
											if (!spec) {
												return;
											}
											const target = {
												kind: 'videoModel' as const,
												sceneKey: localSurfaceController.sceneKey,
												nodePath: item.path,
												documentId: document.id,
												recipeId: recipe.id,
												catalogId: recipe.videoModelCatalogId!,
												modelKey: { ...descriptor.key }
											};
											void requestLeaveSurface(async () => {
												await this.commandService.executeCommand(BASEHALF_CONFIGURE_MODEL_SERVICE_COMMAND_ID, {
													specId: spec.id,
													catalogId: target.catalogId,
													recipeId: target.recipeId,
													modelKey: target.modelKey,
													nodePath: target.nodePath,
													documentId: target.documentId,
													sceneKey: target.sceneKey
												});
											}, false, saveLockedModelNavigationDraft).catch(error => {
												this.logService.warn(error);
												this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
												this.requestRender();
											});
										}));
									}
								}
							}
							if (modelRowButtons.length > 0 && !modelRowButtons.some(button => button.tabIndex === 0)) {
								modelRowButtons[0].tabIndex = 0;
							}
						};
						const renderVideoComposerOverlay = (focusKey?: string): void => {
							const activeBeforeRender = surface.ownerDocument.activeElement;
							const previousOverlayFocusKey = isHTMLElement(activeBeforeRender) && overlayRoot.contains(activeBeforeRender)
								? renderedFocusKeys.get(activeBeforeRender)
								: undefined;
							const previousModelFocusedLogicalKey = isHTMLElement(activeBeforeRender) && overlayRoot.contains(activeBeforeRender)
								? activeBeforeRender.dataset.modelLogicalKey
								: undefined;
							const previousModelPickerRows = videoModelPickerRows;
							const previousScrollPositions = new Map<string, number>();
							for (const element of overlayRoot.getElementsByTagName('*')) {
								if (isHTMLElement(element) && element.dataset.videoOverlayScrollKey) {
									previousScrollPositions.set(element.dataset.videoOverlayScrollKey, element.scrollTop);
								}
							}
							overlayListeners.clear();
							clearNode(overlayRoot);
							syncOverlayTriggers();
							if (!videoComposerOverlay) {
								overlayRoot.hidden = true;
								return;
							}
							overlayRoot.hidden = false;
							overlayRoot.dataset.overlay = videoComposerOverlay;
							const popover = append(overlayRoot, $(`.basehalf-video-composer-popover.${videoComposerOverlay}`));
							popover.id = `basehalf-video-${videoComposerOverlay}-popover-${document.id}`;
							popover.setAttribute('role', 'dialog');
							popover.setAttribute('aria-modal', 'false');
							const headingId = `${popover.id}-title`;
							popover.setAttribute('aria-labelledby', headingId);
							let firstOverlayFocusTarget: HTMLElement | undefined;
							let preferredOverlayFocusTarget: HTMLElement | undefined;
								const registerOverlayFocusTarget = <T extends HTMLElement>(element: T, key: string, preferred = false): T => {
									registerFocusTarget(element, `video-overlay:${videoComposerOverlay}:${key}`);
									firstOverlayFocusTarget ??= element;
									if ((preferred || key === focusKey) && !preferredOverlayFocusTarget) {
										preferredOverlayFocusTarget = element;
								}
								return element;
							};
							if (videoComposerOverlay === 'models') {
								renderVideoModelPicker(popover, headingId, focusKey, registerOverlayFocusTarget);
							} else if (videoComposerOverlay === 'settings') {
								const state = readVideoModelState();
								appendPopoverHeading(popover, state.descriptor
									? localize('basehalf.canvas.videoComposer.settingsHeadingForModel', "Video generation settings for {0}", state.descriptor.label)
									: localize('basehalf.canvas.videoComposer.settingsHeading', "Video generation settings"), headingId);
								const scroll = append(popover, $('.basehalf-video-settings-scroll'));
								scroll.dataset.videoOverlayScrollKey = 'settings';

									if (selectedRecipe?.modelCapability === 'video') {
									let reviewedSource: { readonly url: string; readonly verifiedAt: string } | undefined;
									if (state.resolution?.status === 'supported' && state.normalization) {
										const settingsPresentation = createBaseHalfVideoModelSettingsPresentation(state.resolution, state.normalization);
										reviewedSource = settingsPresentation.source;

									const wireRadioButtons = (buttons: readonly HTMLButtonElement[]): void => {
										for (const button of buttons) {
											overlayListeners.add(this.addDisposableListener(button, 'keydown', event => {
												if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
													return;
												}
												const enabled = buttons.filter(candidate => !candidate.disabled);
												const currentIndex = enabled.indexOf(button);
												if (currentIndex < 0 || enabled.length < 2) {
													return;
												}
												const next = event.key === 'Home'
													? enabled[0]
													: event.key === 'End'
														? enabled[enabled.length - 1]
														: enabled[(currentIndex + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length];
												event.preventDefault();
												next.focus();
												next.click();
											}));
										}
									};
									const commitMethod = (mode: BaseHalfVideoGenerationMode): void => {
										selectVideoDescriptor(
											state.registry,
											state.descriptor!,
										state.inputs,
										mode,
										localize('basehalf.canvas.videoComposer.methodChanged', "Generation method changed to {0}.", BASEHALF_VIDEO_MODE_LABELS[mode]),
										settingsPresentation.parameters
									);
										refreshVideoMetadata();
										refreshSaveState();
										refreshLiveExecutionPresentation();
										renderSurface();
									};
									const modeField = append(scroll, $('.basehalf-video-popover-field.basehalf-video-capability-field'));
									const modeLabel = append(modeField, $('.basehalf-video-popover-label'));
									modeLabel.textContent = localize('basehalf.canvas.videoComposer.generateMethod', "Generate method");
									if (settingsPresentation.methods.control === 'fixed') {
										const fixedMethod = append(modeField, $('.basehalf-video-fixed-method'));
										fixedMethod.textContent = settingsPresentation.methods.options[0]?.label ?? localize('basehalf.canvas.videoComposer.noReviewedMode', "No reviewed method");
										const fixedDescription = append(modeField, $('.basehalf-video-popover-description'));
										fixedDescription.textContent = localize('basehalf.canvas.videoComposer.fixedMethod', "This model exposes one reviewed generation method.");
									} else if (settingsPresentation.methods.control === 'listbox') {
										const select = registerOverlayFocusTarget(
											append(modeField, $('select.basehalf-video-listbox')) as HTMLSelectElement,
											'mode:listbox',
											focusKey === 'video:settings'
										);
										select.setAttribute('aria-label', modeLabel.textContent);
										select.disabled = !configurationMutable;
										for (const optionPresentation of settingsPresentation.methods.options) {
											const option = append(select, $('option')) as HTMLOptionElement;
											option.value = optionPresentation.mode;
											option.textContent = optionPresentation.label;
										}
										select.value = state.resolution.selection.mode;
										overlayListeners.add(this.addDisposableListener(select, 'change', () => commitMethod(select.value as BaseHalfVideoGenerationMode)));
									} else {
										const modes = append(modeField, $('.basehalf-video-segmented.basehalf-video-mode-segmented'));
										modes.setAttribute('role', 'radiogroup');
										modes.setAttribute('aria-label', modeLabel.textContent);
										const modeButtons: HTMLButtonElement[] = [];
										for (const optionPresentation of settingsPresentation.methods.options) {
											const modeButton = registerOverlayFocusTarget(
												append(modes, $('button.basehalf-video-segment')) as HTMLButtonElement,
												`mode:${optionPresentation.mode}`,
												focusKey === 'video:settings' && optionPresentation.selected
											);
											modeButton.type = 'button';
											modeButton.textContent = optionPresentation.label;
											modeButton.classList.toggle('selected', optionPresentation.selected);
											modeButton.setAttribute('role', 'radio');
											modeButton.setAttribute('aria-checked', String(optionPresentation.selected));
											modeButton.tabIndex = optionPresentation.selected ? 0 : -1;
											modeButton.disabled = !configurationMutable;
											modeButtons.push(modeButton);
											overlayListeners.add(this.addDisposableListener(modeButton, 'click', () => commitMethod(optionPresentation.mode)));
										}
										wireRadioButtons(modeButtons);
									}

									for (const parameter of settingsPresentation.parameters) {
										const field = append(scroll, $('.basehalf-video-popover-field.basehalf-video-capability-field'));
										field.classList.toggle('disabled', !parameter.enabled);
										const label = append(field, $('.basehalf-video-popover-label'));
										label.textContent = parameter.label;
										if (parameter.description) {
											const description = append(field, $('.basehalf-video-popover-description'));
											description.textContent = parameter.description;
										}
										const commitValue = (value: BaseHalfVideoModelScalar, key: string): void => {
											applyVideoNormalization(state.resolution as IBaseHalfSupportedVideoCapabilityResolution, {
												...state.normalization!.values,
												[parameter.parameterId]: value
											});
											refreshVideoMetadata();
											refreshSaveState();
											refreshLiveExecutionPresentation();
											showVideoComposerOverlay('settings', key);
										};
									const selectedValue = parameter.value;
									if (parameter.control === 'fixed') {
										const fixedValue = append(field, $('.basehalf-video-fixed-parameter'));
										fixedValue.textContent = parameter.valueLabel ?? localize('basehalf.canvas.videoComposer.reviewedFixedValue', "Reviewed fixed value");
										const fixedDescription = append(field, $('.basehalf-video-popover-description'));
										fixedDescription.textContent = localize('basehalf.canvas.videoComposer.fixedParameter', "This model fixes this setting to one reviewed value.");
									} else if (parameter.control === 'listbox' && parameter.options) {
											const select = registerOverlayFocusTarget(
												append(field, $('select.basehalf-video-listbox')) as HTMLSelectElement,
												`parameter:${parameter.parameterId}:listbox`,
												focusKey === `parameter:${parameter.parameterId}:listbox`
											);
											select.setAttribute('aria-label', parameter.label);
											select.disabled = !configurationMutable || !parameter.enabled;
											for (const optionPresentation of parameter.options) {
												const option = append(select, $('option')) as HTMLOptionElement;
												option.value = `${typeof optionPresentation.value}:${String(optionPresentation.value)}`;
												option.textContent = optionPresentation.enabled ? optionPresentation.label : `${optionPresentation.label} — ${optionPresentation.unavailableReason ?? localize('basehalf.canvas.videoComposer.unavailable', "Unavailable")}`;
												option.disabled = !optionPresentation.enabled;
												if (optionPresentation.value === selectedValue) {
													option.selected = true;
												}
											}
											overlayListeners.add(this.addDisposableListener(select, 'change', () => {
												const selectedOption = parameter.options?.find(option => `${typeof option.value}:${String(option.value)}` === select.value);
												if (selectedOption?.enabled) {
													commitValue(selectedOption.value, `parameter:${parameter.parameterId}:listbox`);
												}
											}));
										} else if (parameter.control === 'segmented' && parameter.options) {
											const segmented = append(field, $('.basehalf-video-segmented'));
											segmented.setAttribute('role', 'radiogroup');
											segmented.setAttribute('aria-label', parameter.label);
											const buttons: HTMLButtonElement[] = [];
											for (const option of parameter.options) {
												const selected = selectedValue === option.value;
												const key = `parameter:${parameter.parameterId}:${typeof option.value}:${String(option.value)}`;
												const button = registerOverlayFocusTarget(
													append(segmented, $('button.basehalf-video-segment')) as HTMLButtonElement,
													key,
													selected
												);
												button.type = 'button';
												button.textContent = option.label;
												button.classList.toggle('selected', selected);
												button.setAttribute('role', 'radio');
												button.setAttribute('aria-checked', String(selected));
												button.tabIndex = selected ? 0 : -1;
											button.disabled = !configurationMutable || !parameter.enabled || !option.enabled;
											if (option.unavailableReason) {
												button.title = option.unavailableReason;
												button.setAttribute('aria-description', option.unavailableReason);
												const optionReason = append(field, $('.basehalf-video-option-inline-reason'));
												optionReason.textContent = `${option.label}: ${option.unavailableReason}`;
											}
												buttons.push(button);
												overlayListeners.add(this.addDisposableListener(button, 'click', () => commitValue(option.value, key)));
											}
											wireRadioButtons(buttons);
										} else if (parameter.control === 'boolean') {
											const segmented = append(field, $('.basehalf-video-segmented'));
											segmented.setAttribute('role', 'radiogroup');
											segmented.setAttribute('aria-label', parameter.label);
											const buttons: HTMLButtonElement[] = [];
											for (const option of [{ value: true, label: localize('basehalf.canvas.videoComposer.on', "On") }, { value: false, label: localize('basehalf.canvas.videoComposer.off', "Off") }]) {
												const selected = selectedValue === option.value;
												const key = `parameter:${parameter.parameterId}:${String(option.value)}`;
												const button = registerOverlayFocusTarget(
													append(segmented, $('button.basehalf-video-segment')) as HTMLButtonElement,
													key,
													selected
												);
												button.type = 'button';
												button.textContent = option.label;
												button.classList.toggle('selected', selected);
												button.setAttribute('role', 'radio');
												button.setAttribute('aria-checked', String(selected));
												button.tabIndex = selected ? 0 : -1;
												button.disabled = !configurationMutable || !parameter.enabled;
												buttons.push(button);
												overlayListeners.add(this.addDisposableListener(button, 'click', () => commitValue(option.value, key)));
											}
											wireRadioButtons(buttons);
									} else if (parameter.control === 'range' && parameter.minimum !== undefined && parameter.maximum !== undefined && parameter.step !== undefined) {
												const rangeRow = append(field, $('.basehalf-video-range-row'));
												const input = registerOverlayFocusTarget(
													append(rangeRow, $('input.basehalf-video-range')) as HTMLInputElement,
													`parameter:${parameter.parameterId}`
												);
												const numericValue = typeof selectedValue === 'number' ? selectedValue : parameter.minimum;
												input.type = 'range';
												input.min = String(parameter.minimum);
												input.max = String(parameter.maximum);
												input.step = String(parameter.step);
												input.value = String(numericValue);
												input.disabled = !configurationMutable || !parameter.enabled;
												const numericInput = registerOverlayFocusTarget(
													append(rangeRow, $('input.basehalf-video-range-number')) as HTMLInputElement,
													`parameter:${parameter.parameterId}:number`
												);
												numericInput.type = 'number';
												numericInput.min = input.min;
												numericInput.max = input.max;
												numericInput.step = input.step;
												numericInput.value = input.value;
												numericInput.disabled = input.disabled;
											if (parameter.unit) {
												const unit = append(rangeRow, $('.basehalf-video-range-unit'));
												unit.textContent = parameter.unit;
												}
												const commitRange = (source: HTMLInputElement): void => {
													const value = Number(source.value);
													if (Number.isFinite(value)) {
														commitValue(value, source === input ? `parameter:${parameter.parameterId}` : `parameter:${parameter.parameterId}:number`);
													}
												};
												overlayListeners.add(this.addDisposableListener(input, 'change', () => commitRange(input)));
												overlayListeners.add(this.addDisposableListener(numericInput, 'change', () => commitRange(numericInput)));
										}
										if (parameter.disabledReason) {
											const reason = append(field, $('.basehalf-video-parameter-reason'));
											reason.textContent = parameter.disabledReason;
											field.setAttribute('aria-description', parameter.disabledReason);
										}
									}

									const adjustments = videoSettingsAdjustments.length > 0
										? createBaseHalfVideoSettingAdjustmentPresentations(videoSettingsAdjustments, settingsPresentation.parameters, videoSettingsAdjustmentPreviousParameters)
										: settingsPresentation.adjustments;
									if (adjustments.length > 0) {
										const adjustmentSection = append(scroll, $('.basehalf-video-settings-adjustments'));
										const adjustmentHeading = append(adjustmentSection, $('.basehalf-video-settings-section-label'));
										adjustmentHeading.textContent = localize('basehalf.canvas.videoComposer.adjustedSettings', "Adjusted settings");
										const adjustmentList = append(adjustmentSection, $('ul'));
										for (const adjustment of adjustments) {
											const item = append(adjustmentList, $('li'));
											const transition = adjustment.kind === 'removed'
												? localize('basehalf.canvas.videoComposer.adjustmentRemoved', "{0} was removed", adjustment.previousValueLabel ?? localize('basehalf.canvas.videoComposer.previousSavedValue', "Previous saved value"))
												: adjustment.previousValueLabel === undefined
													? localize('basehalf.canvas.videoComposer.adjustmentDefaulted', "set to {0}", adjustment.valueLabel ?? localize('basehalf.canvas.videoComposer.reviewedValue', "Reviewed value"))
													: localize('basehalf.canvas.videoComposer.adjustmentChanged', "{0} → {1}", adjustment.previousValueLabel, adjustment.valueLabel ?? localize('basehalf.canvas.videoComposer.reviewedValue', "Reviewed value"));
											item.textContent = `${adjustment.parameterLabel}: ${transition}. ${adjustment.reason}`;
										}
									}
								}

								const statusText = readVideoMessagePrecedence().primaryMessage?.message;
								if (statusText) {
									const status = append(scroll, $('.basehalf-video-capability-status'));
									status.setAttribute('role', 'status');
									status.setAttribute('aria-live', 'polite');
									status.textContent = statusText;
								}
								if (reviewedSource) {
									const reviewedSourceDetails = append(scroll, $('details.basehalf-video-reviewed-source')) as HTMLDetailsElement;
									const sourceSummary = append(reviewedSourceDetails, $('summary'));
									sourceSummary.textContent = localize('basehalf.canvas.videoComposer.reviewedModelInformation', "Reviewed model information");
									const sourceLink = append(reviewedSourceDetails, $('a.basehalf-video-reviewed-source-link')) as HTMLAnchorElement;
									sourceLink.href = reviewedSource.url;
									sourceLink.target = '_blank';
									sourceLink.rel = 'noopener noreferrer';
									sourceLink.textContent = localize('basehalf.canvas.videoComposer.officialModelDocumentation', "Official model documentation");
									const reviewedAt = append(reviewedSourceDetails, $('.basehalf-video-reviewed-at'));
									reviewedAt.textContent = localize('basehalf.canvas.videoComposer.reviewedAt', "Reviewed {0}", reviewedSource.verifiedAt);
								}
									} else if (selectedRecipe && selectedRecipe.modelCapability === undefined) {
									if (selectedRecipe.description) {
										const description = append(scroll, $('.basehalf-video-popover-description'));
										description.textContent = selectedRecipe.description;
									}
									for (const parameter of selectedRecipe.parameters) {
										const input = this.renderNodeLocalParameter(
											scroll,
											parameter,
											draftParameters[parameter.id],
											value => {
												draftParameters[parameter.id] = value;
												refreshVideoMetadata();
												refreshSaveState();
												refreshLiveExecutionPresentation();
											},
											overlayListeners
										);
										input.disabled = !configurationMutable;
										registerOverlayFocusTarget(input, `local-parameter:${parameter.id}`, focusKey === 'video:settings');
										}
										const parsed = parseBaseHalfNodeParameterDraft(selectedRecipe, draftParameters);
										const blockingProblem = !parsed.valid ? parsed.message : readStructuralProblem();
										const statusText = blockingProblem ?? videoSettingsNotice;
									if (statusText) {
										const status = append(scroll, $('.basehalf-video-capability-status'));
										status.setAttribute('role', 'status');
										status.setAttribute('aria-live', 'polite');
										status.textContent = statusText;
									}
									} else if (videoSettingsNotice) {
										const status = append(scroll, $('.basehalf-video-capability-status'));
										status.setAttribute('role', 'status');
										status.setAttribute('aria-live', 'polite');
										status.textContent = videoSettingsNotice;
									}
								} else if (videoComposerOverlay === 'inputs') {
								appendPopoverHeading(popover, localize('basehalf.canvas.videoComposer.inputsHeading', "Generation inputs"), headingId);
								if (!selectedRecipe) {
									const empty = append(popover, $('.basehalf-video-popover-empty'));
									empty.textContent = localize('basehalf.canvas.videoComposer.chooseGeneratorForInputs', "Choose a generator to assign connected context.");
								} else {
									const videoInputs = readVideoInputsPresentation();
									const activeRoleIds = videoInputs
										? new Set(videoInputs.capability.inputs.filter(input => input.kind !== 'text-prompt' && input.maxItems > 0).map(input => input.kind))
										: undefined;
									const bindingPresentations = new Map(videoInputs?.presentation.bindings.map(input => [input.binding.sourcePath, input]) ?? []);
									const rows = getBaseHalfNodeInputRows(selectedRecipe, draftBindings, inputKinds, inputResultIdentities);
									const list = append(popover, $('.basehalf-video-popover-list'));
									list.dataset.videoOverlayScrollKey = 'inputs';
									for (const row of rows) {
										const entry = append(list, $('.basehalf-video-popover-row'));
										const bindingPresentation = bindingPresentations.get(row.sourcePath);
										entry.classList.toggle('needs-review', !!bindingPresentation?.blocking);
										if (bindingPresentation) {
											entry.dataset.inputStatus = bindingPresentation.status;
										}
										const text = append(entry, $('.basehalf-video-input-text'));
										const name = append(text, $('.basehalf-video-popover-row-title'));
										name.textContent = row.sourcePath;
										const meta = append(text, $('.basehalf-video-popover-row-meta'));
										meta.textContent = [
											inputKinds.get(row.sourcePath) ?? localize('basehalf.canvas.videoComposer.missingInput', "Missing"),
											...(bindingPresentation?.problem ? [baseHalfVideoInputPresentationProblemLabel(bindingPresentation.problem.kind)] : [])
										].join(' · ');
										const slot = registerOverlayFocusTarget(
											append(entry, $('select.basehalf-video-input-role')) as HTMLSelectElement,
											`input:${row.sourcePath}:slot`
										);
										for (const candidate of getBaseHalfNodeAssignableInputSlots(selectedRecipe, draftBindings, row.sourcePath, inputKinds.get(row.sourcePath) ?? 'file')
											.filter(candidate => !activeRoleIds || activeRoleIds.has(candidate.id as BaseHalfVideoInputKind))) {
											const option = append(slot, $('option')) as HTMLOptionElement;
											option.value = candidate.id;
											option.textContent = candidate.label;
										}
										slot.value = row.slot;
										slot.disabled = !configurationMutable;
										overlayListeners.add(this.addDisposableListener(slot, 'change', () => void (async () => {
											const transactionId = acquireVideoInputTransaction();
											if (transactionId === undefined) {
												slot.value = row.slot;
												return;
											}
											const nextRole = slot.value as BaseHalfVideoInputKind;
											const expectedDraftState = draftStateKey();
											try {
												const confirmation = await this.dialogService.confirm({
													message: localize('basehalf.canvas.videoComposer.confirmInputRole', "Change {0} from {1} to {2}?", row.sourcePath, row.slot, nextRole),
													detail: localize('basehalf.canvas.videoComposer.confirmInputRoleDetail', "Source: {0}. Current role: {1}. New role: {2}. The source connection stays in place.", row.sourcePath, row.slot, nextRole),
													primaryButton: localize('basehalf.canvas.videoComposer.changeInputRole', "Change role")
												});
												if (!confirmation.confirmed) {
													showVideoComposerOverlay('inputs', `input:${row.sourcePath}:slot`);
													return;
												}
												const source = await inspectVideoInputSource(row.sourcePath);
												const plan = planBaseHalfVideoInputRoleChange({
													capability: videoInputs!.capability,
													recipeInputs: selectedRecipe!.inputs,
													bindings: draftBindings,
													sources: [...videoInputs!.sources.filter(candidate => candidate.sourcePath !== row.sourcePath), source],
													sourcePath: row.sourcePath,
													role: nextRole
												});
												if (!await commitVideoInputPlan(plan, expectedDraftState, transactionId, [source])) {
													showVideoComposerOverlay('inputs', `input:${row.sourcePath}:slot`);
												}
											} catch (error) {
												this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
												this.requestRender();
												showVideoComposerOverlay('inputs', `input:${row.sourcePath}:slot`);
											} finally {
												releaseVideoInputTransaction(transactionId);
											}
										})()));
										const replace = registerOverlayFocusTarget(
											append(entry, $('button.basehalf-video-input-replace.codicon.codicon-replace')) as HTMLButtonElement,
											`input:${row.sourcePath}:replace`
										);
										replace.type = 'button';
										replace.disabled = !configurationMutable || !bindingPresentation?.actions.includes('replace');
										replace.title = localize('basehalf.canvas.videoComposer.replaceInput', "Replace input from canvas");
										replace.setAttribute('aria-label', replace.title);
										overlayListeners.add(this.addDisposableListener(replace, 'click', () => {
											void startVideoInputCanvasPick(row.slot as BaseHalfVideoInputKind, row.sourcePath, replace);
										}));
										const remove = registerOverlayFocusTarget(
											append(entry, $('button.basehalf-video-input-remove.codicon.codicon-close')) as HTMLButtonElement,
											`input:${row.sourcePath}:remove`
										);
										remove.type = 'button';
										remove.disabled = !configurationMutable;
										remove.title = localize('basehalf.canvas.videoComposer.removeInput', "Remove input");
										remove.setAttribute('aria-label', remove.title);
										overlayListeners.add(this.addDisposableListener(remove, 'click', () => void (async () => {
											const transactionId = acquireVideoInputTransaction();
											if (transactionId === undefined) {
												return;
											}
											const expectedDraftState = draftStateKey();
											try {
												const edgeState = await readVideoInputDirectEdgeState(row.sourcePath);
												const plan = planBaseHalfVideoInputRemove({
													capability: videoInputs!.capability,
													recipeInputs: selectedRecipe!.inputs,
													bindings: draftBindings,
													sources: videoInputs!.sources,
													sourcePath: row.sourcePath,
													edgeState
												});
												await commitVideoInputPlan(plan, expectedDraftState, transactionId);
											} catch (error) {
												this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
												this.requestRender();
											} finally {
												releaseVideoInputTransaction(transactionId);
											}
										})()));
									}
									const available = inboundSources.flatMap(source => source.kind === undefined ? [] : getBaseHalfNodeAvailableInputSlots(selectedRecipe!, draftBindings, source.path, source.kind)
										.filter(slot => !activeRoleIds || activeRoleIds.has(slot.id as BaseHalfVideoInputKind))
										.map(slot => ({ source, slot })));
									if (available.length > 0) {
										const add = registerOverlayFocusTarget(
											append(popover, $('select.basehalf-video-input-add')) as HTMLSelectElement,
											'input:add'
										);
										const placeholder = append(add, $('option')) as HTMLOptionElement;
										placeholder.value = '';
										placeholder.textContent = localize('basehalf.canvas.videoComposer.addConnectedInput', "Add connected context…");
										for (const candidate of available) {
											const option = append(add, $('option')) as HTMLOptionElement;
											option.value = `${candidate.source.path}\u0000${candidate.slot.id}`;
											option.textContent = `${candidate.source.path} → ${candidate.slot.label}`;
										}
										add.disabled = !configurationMutable;
										overlayListeners.add(this.addDisposableListener(add, 'change', () => {
											const [sourcePath, slotId] = add.value.split('\u0000');
											if (sourcePath && slotId) {
												removedConnections.delete(sourcePath);
												draftBindings = normalizeNodeInputBindings([...draftBindings, { sourcePath, slot: slotId, order: draftBindings.length }]);
												refreshSaveState();
												showVideoComposerOverlay('inputs', 'video:inputs');
											}
										}));
									} else if (rows.length === 0) {
										const empty = append(popover, $('.basehalf-video-popover-empty'));
										empty.textContent = inboundSources.length === 0
											? localize('basehalf.canvas.videoComposer.connectContext', "Pick a saved canvas source to add an input.")
											: localize('basehalf.canvas.videoComposer.noCompatibleContext', "Connected context is not compatible with this generator.");
									}
									if (videoInputs) {
										const pickRoles = videoInputs.capability.inputs.filter(input => {
											if (input.kind === 'text-prompt' || input.maxItems === 0) {
												return false;
											}
											const recipeInput = selectedRecipe!.inputs.find(candidate => candidate.id === input.kind);
											const count = draftBindings.filter(binding => binding.slot === input.kind).length;
											return !!recipeInput && count < Math.min(input.maxItems, recipeInput.maxItems);
										});
										if (pickRoles.length > 0) {
											const pickActions = append(popover, $('.basehalf-video-input-pick-actions'));
											for (const input of pickRoles) {
												const roleLabel = input.kind === 'first-frame'
													? localize('basehalf.canvas.videoComposer.startFrame', "Start Frame")
													: input.kind === 'last-frame'
														? localize('basehalf.canvas.videoComposer.endFrame', "End Frame")
														: input.kind;
												const pick = registerOverlayFocusTarget(
													append(pickActions, $('button.basehalf-video-input-pick-action.codicon.codicon-target')) as HTMLButtonElement,
													`input:pick:${input.kind}`
												);
											pick.type = 'button';
											pick.disabled = !configurationMutable;
											pick.textContent = localize('basehalf.canvas.videoComposer.pickRoleFromCanvas', "Pick {0} from canvas", roleLabel);
											pick.setAttribute('aria-label', pick.textContent);
												overlayListeners.add(this.addDisposableListener(pick, 'click', () => {
													void startVideoInputCanvasPick(input.kind, undefined, pick);
												}));
											}
										}
									}
								}
							} else {
								appendPopoverHeading(popover, localize('basehalf.canvas.videoComposer.attempts', "Video attempts"), headingId);
								const attempts = append(popover, $('.basehalf-video-attempts-scroll'));
								attempts.dataset.videoOverlayScrollKey = 'attempts';
								this.renderNodeLocalAttempts(attempts, document, overlayListeners, registerFocusTarget, expandedAttemptDisclosures, attemptsVisibleCount, () => {
									attemptsVisibleCount += 50;
									showVideoComposerOverlay('attempts');
								});
								const newestAttempt = [...document.attempts]
									.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
								firstOverlayFocusTarget = newestAttempt
									? renderedFocusTargets.get(`attempt:${newestAttempt.id}:details`)
									: renderedFocusTargets.get('attempts:load-more');
							}
							for (const element of popover.getElementsByTagName('*')) {
								if (isHTMLElement(element) && element.dataset.videoOverlayScrollKey) {
									element.scrollTop = previousScrollPositions.get(element.dataset.videoOverlayScrollKey) ?? 0;
								}
							}
							layoutBaseHalfVideoComposerPopover(surface, popover, this.cards.getBoundingClientRect());
							const exactFocusTarget = previousOverlayFocusKey
								? renderedFocusTargets.get(previousOverlayFocusKey)
								: undefined;
							const connectedExactFocusTarget = exactFocusTarget?.isConnected && popover.contains(exactFocusTarget)
								? exactFocusTarget
								: undefined;
							const repairedModelFocus = videoComposerOverlay === 'models'
								? resolveBaseHalfVideoModelPickerFocus(
									previousModelPickerRows,
									videoModelPickerRows,
									previousModelFocusedLogicalKey,
									videoModelPickerShowSearch
								)
								: undefined;
							const repairedModelFocusTarget = repairedModelFocus?.kind === 'row'
								? videoModelFocusTargets.get(repairedModelFocus.logicalKey)
								: repairedModelFocus?.kind === 'search'
									? renderedFocusTargets.get('video-overlay:models:model:search')
									: undefined;
							const requestedRepairFocusTarget = requestedVideoModelRepairFocusLogicalKey
								? videoModelFocusTargets.get(requestedVideoModelRepairFocusLogicalKey)
								: undefined;
							requestedVideoModelRepairFocusLogicalKey = undefined;
							const nextFocusTarget = baseHalfCanvasVideoOverlayNextFocusTarget(
								requestedRepairFocusTarget,
								connectedExactFocusTarget,
								repairedModelFocusTarget,
								previousOverlayFocusKey || focusKey ? preferredOverlayFocusTarget ?? firstOverlayFocusTarget : undefined
							);
							if (nextFocusTarget) {
								anchorWindow.requestAnimationFrame(() => {
									const target = nextFocusTarget.isConnected && popover.contains(nextFocusTarget)
										? nextFocusTarget
										: preferredOverlayFocusTarget?.isConnected && popover.contains(preferredOverlayFocusTarget)
											? preferredOverlayFocusTarget
												: firstOverlayFocusTarget?.isConnected && popover.contains(firstOverlayFocusTarget)
													? firstOverlayFocusTarget
													: undefined;
									if (target) {
										target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
										target.focus({ preventScroll: true });
									}
								});
							}
						};
							closeVideoComposerOverlay = (restoreFocus = false): boolean => {
							if (!videoComposerOverlay) {
								return false;
							}
							const focusKey = videoComposerOverlayFocusKey;
							videoComposerOverlay = undefined;
							videoComposerOverlayFocusKey = undefined;
							renderVideoComposerOverlay();
							if (restoreFocus && focusKey) {
								renderedFocusTargets.get(focusKey)?.focus({ preventScroll: true });
							}
								return true;
							};
							closeVideoTransientOverlay = () => {
								closeVideoComposerOverlay(false);
							};
						showVideoComposerOverlay = (overlay, focusKey) => {
							if (!cancelVideoInputCanvasPickForChildOverlay()) {
								return;
							}
							const activeBeforeShow = surface.ownerDocument.activeElement;
							const updatesOpenOverlay = videoComposerOverlay === overlay
								&& isHTMLElement(activeBeforeShow)
								&& overlayRoot.contains(activeBeforeShow);
							if (overlay === 'settings' && selectedRecipe?.videoModelCatalogId) {
								const state = readVideoModelState();
								if (state.resolution?.status === 'supported' && state.normalization?.status === 'ready') {
									const canonical = baseHalfCanonicalVideoParameterDraft(
										selectedRecipe.videoModelCatalogId,
										state.resolution,
										state.inputs,
										state.normalization
									);
									if (!objectsEqual(draftParameters, canonical)) {
										draftParameters = canonical;
										videoSettingsNotice = localize(
											'basehalf.canvas.videoComposer.reviewedCanonicalSettings',
											"Updated this Draft to the current reviewed settings."
										);
									}
								}
							}
							videoComposerOverlay = overlay;
							// An in-popover choice may request a precise focus target after the
							// schema-driven body is rebuilt. It must not replace the trigger that
							// originally opened the popover, because Escape returns to that trigger.
							if (!updatesOpenOverlay) {
								videoComposerOverlayFocusKey = focusKey ?? videoComposerOverlayFocusKey;
							}
							renderVideoComposerOverlay(focusKey);
							refreshVideoMetadata();
							refreshSaveState();
							refreshVideoPrimaryState();
						};
						refreshVideoMetadata = () => {
							if (!videoModel || !videoSettings) {
								return;
							}
							const state = readVideoModelState();
							const promptMaximum = state.resolution?.status === 'supported'
								? getBaseHalfVideoPromptMaxCharacters(state.resolution)
								: undefined;
							if (stableVideoPromptInput) {
								stableVideoPromptInput.maxLength = promptMaximum ?? BASEHALF_NODE_PROMPT_MAX_LENGTH;
								stableVideoPromptInput.title = promptMaximum === undefined
									? ''
									: localize('basehalf.canvas.videoComposer.promptLimit', "Up to {0} characters for the selected generation method", promptMaximum.toLocaleString('en-US'));
							}
							const localRecipe = selectedRecipe?.modelCapability === undefined ? selectedRecipe : undefined;
							const modelLabel = localRecipe?.label
								?? state.descriptor?.label
								?? localize('basehalf.canvas.videoComposer.chooseModel', "Choose model");
							clearNode(videoModel);
							const modelIcon = append(videoModel, $('.codicon.codicon-server-process'));
							modelIcon.setAttribute('aria-hidden', 'true');
							const modelText = append(videoModel, $('.basehalf-video-trigger-label'));
							modelText.textContent = modelLabel;
							videoModel.title = modelLabel;
							videoModel.setAttribute('aria-label', localize('basehalf.canvas.videoComposer.modelTrigger', "Generator: {0}", modelLabel));
							clearNode(videoSettings);
							const settingValues: string[] = [];
							const settingsNeedsReview = selectedRecipe?.modelCapability === 'video' && !!draftModelId
								&& (state.resolution?.status !== 'supported' || state.normalization?.status === 'unavailable');
							videoSettings.classList.toggle('needs-review', settingsNeedsReview);
							videoSettings.dataset.settingsState = settingsNeedsReview ? 'needs-review' : 'ready';
							if (localRecipe) {
								for (const parameter of localRecipe.parameters) {
									const value = draftParameters[parameter.id];
									if (value === undefined || settingValues.length >= 4) {
										continue;
									}
									settingValues.push(parameter.type === 'boolean'
										? `${parameter.label} ${value ? localize('basehalf.canvas.videoComposer.on', "On") : localize('basehalf.canvas.videoComposer.off', "Off")}`
										: String(value));
								}
							} else if (state.resolution?.status === 'supported' && state.normalization) {
								const presentation = createBaseHalfVideoModelSettingsPresentation(state.resolution, state.normalization);
								settingValues.push(...presentation.settingsSummary.map(token => token.value));
							}
							if (settingValues.length === 0) {
								const empty = append(videoSettings, $('.basehalf-video-composer-metadata-empty'));
								empty.textContent = localize('basehalf.canvas.videoComposer.chooseModelSettings', "Choose model settings");
							} else {
								for (const value of settingValues) {
									const entry = append(videoSettings, $('.basehalf-video-composer-metadata-item'));
									entry.textContent = value;
								}
							}
							videoSettings.title = settingValues.join(' · ') || localize('basehalf.canvas.videoComposer.chooseModelSettings', "Choose model settings");
							videoSettings.setAttribute('aria-label', localize('basehalf.canvas.videoComposer.settingsTrigger', "Video settings: {0}", videoSettings.title));
							if (settingsNeedsReview && state.problem) {
								videoSettings.setAttribute('aria-description', state.problem);
							} else {
								videoSettings.removeAttribute('aria-description');
							}
							syncOverlayTriggers();
						};
						refreshVideoMetadata();
						renderVideoComposerOverlay();
						refreshVideoSurfacePresentation = () => {
							refreshVideoMetadata();
							refreshSaveState();
							if (videoComposerOverlay) {
								renderVideoComposerOverlay();
							}
						};
					}
					const save = !videoComposer ? append(footer, $('button.basehalf-node-local-save')) as HTMLButtonElement : undefined;
					if (save) {
						registerFocusTarget(save, 'save');
						save.type = 'button';
						save.textContent = 'Save';
						save.setAttribute('aria-label', 'Save node changes');
					}
					const recipeDraftIsValid = () => !selectedRecipe
						|| (videoComposer && selectedRecipe.modelCapability === 'video'
							? !!readVideoRecipeParameters() && !readStructuralProblem()
							: parseBaseHalfNodeParameterDraft(selectedRecipe, draftParameters).valid && !readStructuralProblem());
					const readModelSelectionProblem = () => videoComposer && selectedRecipe?.modelCapability === 'video'
						? readVideoCapabilityProblem()
						: selectedRecipe?.modelCapability
							? getBaseHalfNodeModelSelectionProblem(draftModelServiceId, draftModelId)
							: undefined;
					const activateVideoPrimary = async (): Promise<void> => {
						if (videoInputTransactionOwnerState.activeTransactionId !== undefined
							&& (!cancelVideoInputCanvasPickForChildOverlay()
								|| videoInputTransactionOwnerState.activeTransactionId !== undefined)) {
							return;
						}
						const nextState = readDraftLocalState();
						switch (nextState.action.kind) {
							case 'run':
							case 'retry':
								if (hasDraftChanges() && !await saveDraft()) {
									return;
								}
								if (nextState.action.kind === 'run' && !nextState.ready) {
									footerMessage.textContent = nextState.message;
									return;
								}
								await this.runCanvasNode(item);
								return;
							case 'cancel': {
								const activeRun = this.nodeExecutionService.getActiveRun(item.stat.resource);
								if (!activeRun || !this.nodeExecutionService.cancel(item.stat.resource, activeRun.runId)) {
									footerMessage.textContent = 'That generation already changed; nothing was cancelled.';
								}
								return;
							}
							case 'locate':
								await requestLeaveSurface(() => this.locateNodeResult(item), false);
								return;
							case 'copy':
								await requestLeaveSurface(() => this.copyCanvasNodeSettings(item), false);
								return;
							case 'recover':
								await this.recoverInterruptedCanvasNode(item);
								return;
							case 'import':
								await requestLeaveSurface(() => this.importCanvasNodeResult(item), false);
								return;
							case 'add':
							case 'configure': {
								const needsGenerator = !selectedRecipe;
								const needsModel = needsGenerator || nextState.status === 'Provider missing';
								const precedenceAction = videoComposer ? readVideoMessagePrecedence().primaryAction?.id : undefined;
								const overlay: BaseHalfVideoComposerOverlay = precedenceAction === 'review-inputs'
									? 'inputs'
									: precedenceAction === 'review-models' || needsModel
										? 'models'
										: 'settings';
								showVideoComposerOverlay(overlay, needsGenerator || needsModel ? 'video:model' : `video:${overlay}`);
							return;
							}
							case 'wait':
								footerMessage.textContent = nextState.message;
						}
					};
					runVideoDraftFromSurface = () => {
						const action = readDraftLocalState().action.kind;
						if (action === 'run' || action === 'retry') {
							void activateVideoPrimary();
						}
					};
					refreshVideoPrimaryState = () => {
						if (!videoPrimary) {
							return;
						}
						const nextState = readDraftLocalState();
						videoPrimary.dataset.nodeAction = nextState.action.kind;
						videoPrimary.dataset.nodeStatus = baseHalfNodeLocalStatusToken(nextState.status);
						const actionLabel = nextState.action.kind === 'locate'
							? 'Open video'
							: nextState.action.kind === 'copy'
								? 'New Draft'
								: nextState.action.kind === 'add' || nextState.action.kind === 'configure'
									? 'Set up video'
								: nextState.action.kind === 'cancel'
									? 'Cancel'
									: nextState.action.kind === 'recover'
									? 'Check status'
									: nextState.action.kind === 'retry' ? 'Retry' : 'Generate';
						videoPrimary.textContent = '';
						videoPrimary.classList.remove('codicon-arrow-up', 'codicon-debug-stop', 'codicon-play', 'codicon-add', 'codicon-refresh');
						videoPrimary.classList.add(nextState.action.kind === 'cancel'
							? 'codicon-debug-stop'
							: nextState.action.kind === 'locate'
								? 'codicon-play'
								: nextState.action.kind === 'copy'
									? 'codicon-add'
									: nextState.action.kind === 'recover'
										? 'codicon-refresh'
										: 'codicon-arrow-up');
						const editProblem = configurationConflict?.length || refreshFailure
							|| baseHalfNodeIdentityProblem(draftTitle, draftRole)
							|| readModelSelectionProblem()
							|| !recipeDraftIsValid()
							|| this.workingCopyService.isDirty(item.stat.resource);
						videoPrimary.disabled = videoInputTransactionOwnerState.activeTransactionId !== undefined
							|| nextState.action.kind === 'wait'
							|| nextState.status === 'Cancelling'
							|| ((nextState.action.kind === 'run' || nextState.action.kind === 'retry') && (!nextState.ready || !!editProblem));
						videoPrimary.title = `${actionLabel}: ${nextState.message}`;
						videoPrimary.setAttribute('aria-label', videoPrimary.title);
					};
					if (videoPrimary) {
						formListeners.add(this.addDisposableListener(videoPrimary, 'click', () => { void activateVideoPrimary(); }));
					}
					refreshModePresentation = () => {
						body.hidden = !videoComposer && localSurfaceMode !== 'configure';
						if (attemptsBody) {
							attemptsBody.hidden = localSurfaceMode !== 'attempts';
						}
						footer.hidden = !videoComposer && (localSurfaceMode !== 'configure' || !configurationMutable);
						if (save) {
							save.hidden = !configurationMutable;
						}
						for (const [candidate, modeButton] of modeButtons) {
							const activeMode = localSurfaceMode === candidate;
							const hasUnsavedDraft = candidate === 'configure' && hasDraftChanges();
							modeButton.classList.toggle('active', activeMode);
							modeButton.classList.toggle('has-draft', hasUnsavedDraft);
							modeButton.setAttribute('aria-selected', String(activeMode));
							modeButton.setAttribute('tabindex', activeMode ? '0' : '-1');
							modeButton.setAttribute('aria-label', hasUnsavedDraft
								? 'Configure, unsaved changes'
								: candidate === 'configure' ? configurationMutable ? 'Configure' : 'Configuration' : 'Attempts');
						}
					};
					revealConfigureMode = () => {
						if (videoComposer) {
							showVideoComposerOverlay('settings', 'video:settings');
							return;
						}
						localSurfaceMode = 'configure';
						refreshModePresentation();
						modeButtons.get('configure')?.focus();
					};
					refreshSaveState = () => {
						const dirty = this.workingCopyService.isDirty(item.stat.resource);
						const nextState = readDraftLocalState();
						const identityProblem = baseHalfNodeIdentityProblem(draftTitle, draftRole);
						const modelSelectionProblem = readModelSelectionProblem();
						const unchanged = !hasDraftChanges();
						const transactionFailure = configurationConflict?.length
							? 'Resolve the saved-configuration conflict before saving.'
							: refreshFailure
								? 'Wait for this node to refresh before saving.'
								: undefined;
						const videoMessage = videoComposer
							? readVideoMessagePrecedence(transactionFailure).primaryMessage?.message
							: undefined;
						footerMessage.textContent = !videoComposer && transactionFailure
							? transactionFailure
								: !configurationMutable && !unchanged
									? 'Generation started before these edits were saved. They are not part of this Attempt.'
									: dirty
										? 'Save the open source editor before changing this node.'
										: identityProblem ?? (emptyVideoComposer
											? ''
											: videoMessage ?? modelSelectionProblem ?? readStructuralProblem() ?? (!nextState.ready ? nextState.message : ''));
						if (save) {
							save.disabled = !configurationMutable || unchanged || !!configurationConflict?.length || !!refreshFailure || !!identityProblem || !!modelSelectionProblem || !recipeDraftIsValid() || dirty;
							save.title = unchanged
								? 'No changes to save'
								: footerMessage.textContent || 'Save node changes';
						}
						refreshVideoPrimaryState();
						refreshModePresentation();
					};
					refreshWorkingCopyPresentation = refreshSaveState;
					refreshSaveState();
					checkpointVideoInputConfigurationImplementation = async transactionId => {
						if (!baseHalfVideoInputTransactionIsCurrent(videoInputTransactionOwnerState, transactionId)
							|| !configurationMutable
							|| !selectedRecipe
							|| selectedRecipe.modelCapability !== 'video'
							|| !selectedRecipe.videoModelCatalogId
							|| this.workingCopyService.isDirty(item.stat.resource)
							|| !!configurationConflict?.length
							|| !!refreshFailure
							|| this.nodeExecutionService.getActiveRun(item.stat.resource)) {
							return false;
						}
						const state = readVideoModelState();
						if (state.resolution?.status !== 'supported' || state.normalization?.status !== 'ready') {
							return false;
						}
						const persistedBindings = document.recipe?.inputBindings ?? [];
						const persistedInputs = baseHalfVideoInputState(document.prompt, persistedBindings, inputKinds);
						const parameters: Readonly<Record<string, BaseHalfNodeJsonValue>> = {
							...state.normalization.values,
							[BASEHALF_VIDEO_MODEL_SNAPSHOT_PARAMETER_ID]: createBaseHalfVideoModelSelectionSnapshotFromCapability(
								selectedRecipe.videoModelCatalogId,
								state.resolution,
								persistedInputs
							) as unknown as BaseHalfNodeJsonValue
						};
						const nextRecipe = resolveBaseHalfNodeRecipeDraft(
							document,
							selectedRecipeId,
							selectedRecipe,
							parameters,
							draftModelServiceId,
							draftModelId,
							persistedBindings
						);
						if (!nextRecipe) {
							return false;
						}
						const nextDocument: IBaseHalfNodeDocument = { ...document, recipe: nextRecipe };
						const nextConfigurationKey = documentConfigurationKey(nextDocument);
						if (nextConfigurationKey === savedDocumentConfigurationKey) {
							return true;
						}
						const persistedConfiguration = configurationDraftFromDocument(nextDocument);
						const previousConfigurationBaseline = configurationBaseline;
						const previousLatestExternalConfiguration = latestExternalConfiguration;
						const previousSavedDocumentConfigurationKey = savedDocumentConfigurationKey;
						const previousSavedDraftState = savedDraftState;
						const previousConfigurationConflict = configurationConflict;
						// A refresh that began before this checkpoint can otherwise publish the
						// previous document after the write and look like an external rollback.
						refreshSequence++;
						const previousTransitionAck = registerVideoInputDocumentTransition(
							transactionId,
							previousSavedDocumentConfigurationKey,
							nextConfigurationKey,
							content.etag
						);
						configurationBaseline = persistedConfiguration;
						latestExternalConfiguration = persistedConfiguration;
						savedDocumentConfigurationKey = nextConfigurationKey;
						savedDraftState = draftStateKeyFor(persistedConfiguration);
						configurationConflict = undefined;
						try {
							const transition = await this.saveNodeLocalChanges(folder, item, content.value, nextDocument, []);
							const confirmedContent = await this.fileService.readFile(item.stat.resource, {
								atomic: true,
								limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
							});
							const confirmedDocument = parseBaseHalfNodeDocumentBytes(confirmedContent.value.buffer);
							const confirmedConfigurationKey = documentConfigurationKey(confirmedDocument);
							if (!settleVideoInputDocumentTransition(transactionId, nextConfigurationKey, confirmedConfigurationKey, confirmedContent.etag)) {
								configurationBaseline = previousConfigurationBaseline;
								latestExternalConfiguration = previousLatestExternalConfiguration;
								savedDocumentConfigurationKey = previousSavedDocumentConfigurationKey;
								savedDraftState = previousSavedDraftState;
								configurationConflict = previousConfigurationConflict;
								this.queueCanvasWarning(localize(
									'basehalf.canvas.videoComposer.inputCheckpointUnconfirmed',
									"The Video Draft changed before the input checkpoint could be confirmed. Review the current configuration before trying again."
								));
								queueSurfaceRefresh();
								return false;
							}
							if (canvasConnectionTransitionChangesAnything(transition)) {
								this.pushCanvasUndoElement(
									localize('basehalf.canvas.videoInput.checkpointUndo', "Update video input configuration"),
									folder,
									transition.nodes,
									transition.documents,
									(reverse, lease) => this.applyCanvasConnectionTransition(transition, reverse, lease)
								);
							}
							document = nextDocument;
							content = confirmedContent;
							configurationBaseline = persistedConfiguration;
							latestExternalConfiguration = persistedConfiguration;
							savedDocumentConfigurationKey = nextConfigurationKey;
							configurationConflict = undefined;
							savedDraftState = draftStateKeyFor(persistedConfiguration);
							queueSurfaceRefresh();
							return true;
						} catch (error) {
							restoreVideoInputDocumentTransition(transactionId, nextConfigurationKey, previousTransitionAck);
							if (savedDocumentConfigurationKey === nextConfigurationKey) {
								configurationBaseline = previousConfigurationBaseline;
								latestExternalConfiguration = previousLatestExternalConfiguration;
								savedDocumentConfigurationKey = previousSavedDocumentConfigurationKey;
								savedDraftState = previousSavedDraftState;
								configurationConflict = previousConfigurationConflict;
							}
							this.logService.warn(error);
							this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
							queueSurfaceRefresh();
							return false;
						}
					};
					saveDraftImplementation = async () => {
						if (baseHalfNodeIdentityProblem(draftTitle, draftRole)
							|| readModelSelectionProblem()
							|| !recipeDraftIsValid() || this.workingCopyService.isDirty(item.stat.resource)
							|| !!configurationConflict?.length || !!refreshFailure || !configurationMutable || this.nodeExecutionService.getActiveRun(item.stat.resource)) {
							return false;
						}
						if (save) {
							save.disabled = true;
						}
						footerMessage.textContent = 'Saving...';
						const latestParameters = selectedRecipe && (!videoComposer || selectedRecipe.modelCapability === undefined)
							? parseBaseHalfNodeParameterDraft(selectedRecipe, draftParameters)
							: undefined;
						const nextRecipe = resolveBaseHalfNodeRecipeDraft(
							document,
							selectedRecipeId,
							selectedRecipe,
							videoComposer && selectedRecipe?.modelCapability === 'video'
								? readVideoRecipeParameters()
								: latestParameters?.valid ? latestParameters.parameters : undefined,
							draftModelServiceId,
							draftModelId,
							draftBindings
						);
						const nextDocument: IBaseHalfNodeDocument = {
							...document,
							title: draftTitle.trim(),
							role: draftRole.trim(),
							prompt: draftPrompt,
							recipe: nextRecipe
						};
						try {
							const transition = await this.saveNodeLocalChanges(folder, item, content.value, nextDocument, [...removedConnections]);
							if (canvasConnectionTransitionChangesAnything(transition)) {
								this.pushCanvasUndoElement(
									localize('basehalf.canvas.nodeEdit.undo', "Edit result node"),
									folder,
									transition.nodes,
									transition.documents,
									(reverse, lease) => this.applyCanvasConnectionTransition(transition, reverse, lease)
								);
							}
							const persistedConfiguration = configurationDraftFromDocument(nextDocument);
							document = nextDocument;
							content = { ...content, value: transition.documents[0]?.next ?? content.value };
							localRecipeNeedsModelCleanup = false;
							videoSettingsNotice = undefined;
							videoSettingsAdjustments = [];
							videoSettingsAdjustmentPreviousParameters = [];
							applyConfigurationDraft(persistedConfiguration);
							configurationBaseline = persistedConfiguration;
							latestExternalConfiguration = persistedConfiguration;
							savedDocumentConfigurationKey = documentConfigurationKey(nextDocument);
							configurationConflict = undefined;
							savedDraftState = draftStateKey();
							this.requestRender();
							return true;
						} catch (error) {
							this.logService.warn(error);
							footerMessage.textContent = 'This node changed while saving. Refreshing the saved configuration…';
							if (save) {
								save.disabled = false;
							}
							queueSurfaceRefresh();
							return false;
						}
					};
					saveLockedModelNavigationDraftImplementation = async () => {
						if (baseHalfNodeIdentityProblem(draftTitle, draftRole)
							|| this.workingCopyService.isDirty(item.stat.resource)
							|| !!configurationConflict?.length || !!refreshFailure || !configurationMutable
							|| this.nodeExecutionService.getActiveRun(item.stat.resource)) {
							return false;
						}
						// A complete Draft still uses the normal save, including its validated
						// recipe and graph edits. Only an unresolved locked-provider choice
						// takes the narrower prompt checkpoint below.
						if (!readModelSelectionProblem() && recipeDraftIsValid()) {
							return saveDraftImplementation();
						}
					const nextDocument = baseHalfCanvasProvisionalVideoDraftDocument(
							document,
							draftTitle,
							draftRole,
							draftPrompt
						);
					if (!nextDocument) {
						return false;
					}
					const currentBindings = draftBindings;
					const currentRemovedConnections = new Set(removedConnections);
						if (save) {
							save.disabled = true;
						}
						footerMessage.textContent = localize(
							'basehalf.canvas.videoComposer.savingBeforeModelSetup',
							"Saving this Draft before model setup..."
						);
						try {
							// Incomplete recipe/model state and pending graph removals are not a
							// valid disk contract. Preserve the last persisted recipe and write
							// only the authored identity/prompt checkpoint.
							const transition = await this.saveNodeLocalChanges(folder, item, content.value, nextDocument, []);
							if (canvasConnectionTransitionChangesAnything(transition)) {
								this.pushCanvasUndoElement(
									localize('basehalf.canvas.nodeEdit.undo', "Edit result node"),
									folder,
									transition.nodes,
									transition.documents,
									(reverse, lease) => this.applyCanvasConnectionTransition(transition, reverse, lease)
								);
							}
						const persistedConfiguration = configurationDraftFromDocument(nextDocument);
						document = nextDocument;
						content = { ...content, value: transition.documents[0]?.next ?? content.value };
						applyConfigurationDraft(persistedConfiguration);
						const persistedDraftState = draftStateKey();
						draftBindings = currentBindings;
						removedConnections.clear();
						for (const path of currentRemovedConnections) {
							removedConnections.add(path);
						}
						configurationBaseline = persistedConfiguration;
							latestExternalConfiguration = persistedConfiguration;
							savedDocumentConfigurationKey = documentConfigurationKey(nextDocument);
							configurationConflict = undefined;
						localRecipeNeedsModelCleanup = !!selectedRecipe
								&& selectedRecipe.modelCapability === undefined
								&& !!(nextDocument.recipe?.modelServiceId || nextDocument.recipe?.modelId);
						videoSettingsNotice = undefined;
						videoSettingsAdjustments = [];
						videoSettingsAdjustmentPreviousParameters = [];
						savedDraftState = localRecipeNeedsModelCleanup
							? `${persistedDraftState}\u0000legacy-model-selection`
							: persistedDraftState;
							this.requestRender();
							return true;
						} catch (error) {
							this.logService.warn(error);
							footerMessage.textContent = localize(
								'basehalf.canvas.videoComposer.saveBeforeModelSetupFailed',
								"This Draft changed before its prompt could be saved. Refreshing the saved configuration..."
							);
							if (save) {
								save.disabled = false;
							}
							queueSurfaceRefresh();
							return false;
						}
					};
					if (save) {
						formListeners.add(this.addDisposableListener(save, 'click', async () => {
							if (await saveDraft()) {
								await hideIntentionally();
							}
						}));
					}
					syncTransactionPresentation();
					restoreSurfacePresentation(presentation);
				};
				showVideoDetails = () => {
					const overlay: BaseHalfVideoComposerOverlay = document.result || document.attempts.length > 0 ? 'attempts' : 'settings';
					showVideoComposerOverlay(overlay, `video:${overlay}`);
					return Promise.resolve();
				};

				const changedBindingPaths = (
					base: readonly IBaseHalfNodeInputBinding[],
					local: readonly IBaseHalfNodeInputBinding[]
				): ReadonlySet<string> => {
					const signature = (bindings: readonly IBaseHalfNodeInputBinding[]) => new Map(bindings.map(binding => [
						binding.sourcePath,
						`${binding.slot}\u0000${binding.order}`
					]));
					const baseByPath = signature(base);
					const localByPath = signature(local);
					return new Set([...baseByPath.keys(), ...localByPath.keys(), ...removedConnections]
						.filter(path => baseByPath.get(path) !== localByPath.get(path) || removedConnections.has(path)));
				};
				const directInputProjectionKey = (
					paths: readonly string[],
					kinds: ReadonlyMap<string, BaseHalfCanvasContentKind>,
					problems: ReadonlyMap<string, string>
				): string => stableStringify({
					paths: [...paths].sort(),
					kinds: [...kinds].sort(([left], [right]) => left.localeCompare(right)),
					problems: [...problems].sort(([left], [right]) => left.localeCompare(right))
				});
					const applyLatestSurfaceState = (latest: Awaited<ReturnType<typeof readLatestSurfaceState>>): void => {
						const localBeforeRefresh = configurationDraft();
						const exactVideoModelKeyBeforeRefresh = draftVideoModelKey;
						const hadDraftChanges = hasDraftChanges();
					const previouslyNeededLocalModelCleanup = localRecipeNeedsModelCleanup;
					const nextExternalConfiguration = configurationDraftFromDocument(latest.document, latest.recipes);
					const nextDocumentConfigurationKey = documentConfigurationKey(latest.document);
					const documentTransitionAck = videoInputDocumentTransitionAck;
					let observedDocumentVersionWasOwn = false;
					const savedConfigurationChanged = nextDocumentConfigurationKey !== savedDocumentConfigurationKey;
					if (documentTransitionAck) {
						const observation = observeBaseHalfVideoDocumentVersion(
							documentTransitionAck.acknowledgement,
							{ configurationKey: nextDocumentConfigurationKey, etag: latest.content.etag },
							true
						);
						videoInputDocumentTransitionAck = {
							transactionId: documentTransitionAck.transactionId,
							acknowledgement: observation.classification === 'expected'
								? settleBaseHalfVideoDocumentWriteAcknowledgement(observation.acknowledgement)
								: observation.acknowledgement
						};
						observedDocumentVersionWasOwn = observation.classification === 'expected';
						if (observation.classification === 'own-intermediate' || observation.classification === 'own-echo') {
							if (observation.rereadRequired) {
								queueSurfaceRefresh();
							}
							verificationPending = false;
							refreshFailure = undefined;
							return;
						}
						if (observation.classification === 'external') {
							videoInputDocumentTransitionAck = undefined;
						}
					}
					const directInputProjectionChanged = directInputProjectionKey(
						directSourcePaths,
						inputKinds,
						directSourceProblems
					) !== directInputProjectionKey(
						latest.directSourcePaths,
						latest.inputKinds,
						latest.directSourceProblems
					);
					if ((!observedDocumentVersionWasOwn && latest.content.etag !== content.etag) || directInputProjectionChanged) {
						canvasPickStore.clear();
					}
					const previousSourcePaths = new Set(directSourcePaths);
					const nextSourcePaths = new Set(latest.directSourcePaths);
					const changedSourcePaths = new Set([...previousSourcePaths, ...nextSourcePaths]
						.filter(path => previousSourcePaths.has(path) !== nextSourcePaths.has(path)));

					content = latest.content;
					document = latest.document;
					modelServices = latest.modelServices;
					inbound = latest.inbound;
					inboundSources = latest.inboundSources;
					inputKinds = latest.inputKinds;
					inputResultIdentities = latest.inputResultIdentities;
					directSourcePaths = latest.directSourcePaths;
					directSourceProblems = latest.directSourceProblems;
					recipes = latest.recipes;
					resultPreview = latest.resultPreview;
					verificationPending = false;
					latestExternalConfiguration = nextExternalConfiguration;
					refreshFailure = undefined;

					if (savedConfigurationChanged) {
						const merged = mergeBaseHalfNodeLocalConfigurationDraft(
							configurationBaseline,
							localBeforeRefresh,
							nextExternalConfiguration
						);
						applyConfigurationDraft(merged.draft);
						configurationBaseline = nextExternalConfiguration;
						savedDocumentConfigurationKey = nextDocumentConfigurationKey;
						savedDraftState = draftStateKeyFor(nextExternalConfiguration);
						configurationConflict = merged.conflicts.length ? merged.conflicts : undefined;
					} else if (!hadDraftChanges && !configurationConflict?.length) {
						applyConfigurationDraft(nextExternalConfiguration);
						configurationBaseline = nextExternalConfiguration;
						savedDraftState = draftStateKeyFor(nextExternalConfiguration);
						} else {
							selectedRecipe = this.canvasRecipeRegistryService.getRecipe(selectedRecipeId);
						if (selectedRecipe && !baseHalfCanvasRecipeMatchesNodeKind(selectedRecipe, document.kind)) {
							selectedRecipe = undefined;
							}
						}
						if (!draftVideoModelKey
							&& exactVideoModelKeyBeforeRefresh
							&& selectedRecipeId === localBeforeRefresh.recipeId
							&& draftModelServiceId === localBeforeRefresh.modelServiceId
							&& draftModelId === localBeforeRefresh.modelId) {
							// A not-yet-resolvable model selection has no persisted snapshot yet.
							// Preserve its exact revision across unrelated hydration (for example a
							// title-only external write) instead of falling back to the first model
							// sharing the same provider model id.
							draftVideoModelKey = exactVideoModelKeyBeforeRefresh;
						}
						localRecipeNeedsModelCleanup = !!selectedRecipe
						&& selectedRecipe.modelCapability === undefined
						&& !!(document.recipe?.modelServiceId || document.recipe?.modelId);
					if (localRecipeNeedsModelCleanup) {
						if (!savedDraftState.endsWith('\u0000legacy-model-selection')) {
							savedDraftState = `${savedDraftState}\u0000legacy-model-selection`;
						}
						videoSettingsNotice = localize('basehalf.canvas.videoComposer.localModelCleanup', "This local generator no longer uses the legacy model selection. Save the Draft to remove it.");
					} else if (previouslyNeededLocalModelCleanup) {
						videoSettingsNotice = undefined;
					}

					if (changedSourcePaths.size > 0) {
						const locallyChangedPaths = changedBindingPaths(configurationBaseline.inputBindings, configurationDraft().inputBindings);
						if ([...changedSourcePaths].some(path => locallyChangedPaths.has(path))) {
							configurationConflict = Object.freeze([...new Set([...(configurationConflict ?? []), 'Direct inputs'])]);
						}
					}
					if (!videoComposer && (document.result || document.attempts.length > 0) && localSurfaceMode === 'configure' && !hasDraftChanges()) {
						localSurfaceMode = 'attempts';
					}
					liveExecutionRunId = this.nodeExecutionService.getActiveRun(item.stat.resource)?.runId;
				};
					queueSurfaceRefresh = () => {
						const sequence = ++refreshSequence;
						void readLatestSurfaceState().then(latest => {
						const apply = () => {
							if (refreshDisposed || sequence !== refreshSequence) {
								return;
							}
							if (latest.document.id !== localSurfaceController.nodeId || latest.document.kind !== localSurfaceController.nodeKind) {
								void requestLeaveSurface(undefined, false).then(accepted => {
									if (accepted && !this.disposed) {
										this.requestRender();
									}
								});
								return;
							}
							const previousConfigurationKey = documentConfigurationKey(document);
								const previousStructureKey = `${document.result ? 'result' : 'draft'}:${document.attempts.length}:${liveExecutionRunId ?? 'idle'}`;
								applyLatestSurfaceState(latest);
								if (videoComposer && document.result && !resultPreview.resultIntegrity) {
									disposeMountedVideoComposer?.(false);
									this.requestRender();
									return;
								}
								const nextStructureKey = `${document.result ? 'result' : 'draft'}:${document.attempts.length}:${liveExecutionRunId ?? 'idle'}`;
								if (videoComposer && previousConfigurationKey === documentConfigurationKey(document) && previousStructureKey === nextStructureKey) {
									refreshVideoSurfacePresentation();
								} else {
									renderSurface();
								}
								};
						if (surfaceComposing) {
							pendingAfterComposition = apply;
						} else {
							apply();
						}
					}, error => {
						const apply = () => {
							if (refreshDisposed || sequence !== refreshSequence) {
								return;
							}
							this.logService.warn(error);
							verificationPending = false;
							refreshFailure = (error instanceof Error ? error.message : String(error)).slice(0, 400);
							renderSurface();
						};
						if (surfaceComposing) {
							pendingAfterComposition = apply;
						} else {
							apply();
						}
					});
				};

				const badgeResource = baseHalfMirrorResource(folder.workspaceFolder, item.path, 'badge.yaml');
				store.add(this.nodeExecutionService.onDidChange(event => {
					if (!this.uriIdentityService.extUri.isEqual(event.resource, item.stat.resource)) {
						return;
					}
					if (event.state?.runId && event.state.runId === liveExecutionRunId) {
						refreshLiveExecutionPresentation();
						return;
					}
					liveExecutionRunId = event.state?.runId;
					queueSurfaceRefresh();
				}));
				store.add(this.fileService.onDidFilesChange(event => {
					const affectsDirectSource = directSourcePaths.some(path => event.affects(joinPath(folder.workspaceFolder, ...path.split('/'))));
					const resultArtifact = getBaseHalfNodeResultArtifact(document);
					const affectsResultArtifact = !!resultArtifact && event.affects(joinPath(folder.workspaceFolder, ...resultArtifact.path.split('/')));
					if (event.affects(item.stat.resource) || event.affects(badgeResource) || affectsDirectSource || affectsResultArtifact) {
						queueSurfaceRefresh();
					}
				}));
				store.add(this.canvasRecipeRegistryService.onDidChange(() => queueSurfaceRefresh()));
				store.add(this.modelServiceService.onDidChange(() => queueSurfaceRefresh()));
				store.add(this.videoModelCatalogService.onDidChange(() => queueSurfaceRefresh()));
				store.add(this.workingCopyService.onDidChangeDirty(workingCopy => {
					if (this.uriIdentityService.extUri.isEqual(workingCopy.resource, item.stat.resource)) {
						refreshWorkingCopyPresentation();
					}
					if (this.uriIdentityService.extUri.isEqualOrParent(workingCopy.resource, folder.workspaceFolder)) {
						queueSurfaceRefresh();
					}
				}));
					store.add(toDisposable(() => {
					refreshDisposed = true;
					refreshSequence++;
					pendingAfterComposition = undefined;
						refreshLiveExecutionPresentation = () => { };
						refreshWorkingCopyPresentation = () => { };
						refreshVideoSurfacePresentation = () => { };
							queueSurfaceRefresh = () => { };
						runVideoDraftFromSurface = () => { };
					}));

				renderSurface();
				focusLocalSurface = () => {
					const target = videoComposer
						? (renderedFocusTargets.get('video:prompt')
							?? renderedFocusTargets.get('video:primary')
							?? renderedFocusTargets.get('video:settings'))
						: (renderedFocusTargets.get(`mode:${localSurfaceMode}`)
							?? renderedFocusTargets.get('content:import')
							?? renderedFocusTargets.get('recipe')
							?? renderedFocusTargets.get('close'));
					target?.focus({ preventScroll: true });
				};
				updateVideoInputPickViewport = visible => {
					const request = videoInputCanvasPickState.request;
					if (request) {
						videoInputCanvasPickState = updateBaseHalfVideoCanvasPickViewport(
							videoInputCanvasPickState,
							request.epoch,
							visible
						);
					}
					const focus = consumeBaseHalfVideoCanvasPickDeferredFocus(videoInputCanvasPickState, {
						sceneKey: localSurfaceController.sceneKey,
						targetNodePath: item.path,
						targetNodeId: document.id,
						selected: this.activeNodeLocalSurface === localSurfaceController,
						visible
					});
					videoInputCanvasPickState = focus.state;
					if (focus.focusKey) {
						anchorWindow.requestAnimationFrame(() => {
							renderedFocusTargets.get(focus.focusKey!)?.focus({ preventScroll: true });
						});
					}
				};
					store.add(toDisposable(() => {
						focusLocalSurface = () => { };
						showVideoDetails = async () => { };
						closeVideoTransientOverlay = () => { };
						updateVideoInputPickViewport = () => { };
					}));
				queueSurfaceRefresh();
				return store;
			};
		const delegate: IContextViewDelegate = {
			getAnchor: getLocalSurfaceAnchor,
			anchorAlignment: placement.anchorAlignment,
			anchorAxisAlignment: placement.anchorAxisAlignment,
			anchorPosition: placement.anchorPosition,
			canRelayout: true,
			focus: () => focusLocalSurface(),
			render: renderLocalSurface,
			onHide: () => {
						this.consumePreparedVideoComposer(item.path);
						if (allowNextHide) {
							allowNextHide = false;
							if (this.activeNodeLocalSurface === localSurfaceController) {
								this.activeNodeLocalSurface = undefined;
							}
							if (restoreFocusAfterIntentionalHide) {
								focusAnchor();
							}
							return;
						}
						if (hasDraftChanges()) {
							// Keep the controller reachable while the hidden surface's decision
							// is pending. Shutdown and another surface switch join this promise.
							retainImplicitDismiss();
							return;
						}
						if (this.activeNodeLocalSurface === localSurfaceController) {
							this.activeNodeLocalSurface = undefined;
						}
						focusAnchor();
				}
		};
		if (intent !== this.nodeLocalSurfaceIntent || this.canvasNavigationService.state.cardDetail) {
			return;
		}
		this.activeNodeLocalSurface = localSurfaceController;
		// The prepared selection is an auto-open intent, not durable selection
		// state. Consume it only after the surface has successfully mounted so later
		// integrity/model hydration cannot replay the open and dismiss Composer.
		this.consumePreparedVideoComposer(item.path);
		if (videoComposer) {
			const mount = $('.basehalf-video-composer-mount');
			mount.dataset.nodePath = item.path;
			const lifetime = this._register(new DisposableStore());
			lifetime.add(renderLocalSurface(mount));
			const navigationEditor: IBaseHalfActiveCanvasEditor = {
				resource: item.stat.resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath: item.path,
				supportsCanvasProjectionHandoff: false,
				prepareToClose: () => requestLeaveSurface(undefined, false)
			};
			this.canvasNavigationService.setActiveCanvasEditor(navigationEditor);
			lifetime.add(toDisposable(() => {
				if (this.canvasNavigationService.activeCanvasEditor === navigationEditor) {
					this.canvasNavigationService.setActiveCanvasEditor(undefined);
				}
			}));
			let pendingInitialFocus = true;
			let latestPortalLayoutEpoch = -1;
			const onPortalLayout = (event: Event) => {
				const detail = (event as CustomEvent<IBaseHalfVideoComposerPortalLayout>).detail;
				const surface = renderedLocalSurface;
				if (!detail || !surface?.isConnected || detail.epoch < latestPortalLayoutEpoch) {
					return;
				}
				latestPortalLayoutEpoch = detail.epoch;
				updateVideoInputPickViewport(detail.visible);
				surface.dataset.placement = detail.placement;
				surface.dataset.visibility = detail.visibility;
				if (detail.manipulating) {
					surface.dataset.directManipulation = detail.manipulating;
				} else {
					delete surface.dataset.directManipulation;
				}
				surface.style.setProperty('--basehalf-video-composer-width', `${detail.screenWidth}px`);
				surface.style.setProperty('--basehalf-video-composer-height', `${detail.screenHeight}px`);
				const footerPresentation = createBaseHalfVideoComposerFooterPresentation(detail.screenWidth);
				surface.dataset.footerDensity = footerPresentation.density;
				surface.style.setProperty('--basehalf-video-model-max-width', `${footerPresentation.modelMaximumWidth}px`);
				const popover = surface.querySelector<HTMLElement>('.basehalf-video-composer-popover');
				const popoverFits = popover?.isConnected
					? layoutBaseHalfVideoComposerPopover(surface, popover, this.cards.getBoundingClientRect())
					: true;
				const transientGeometryChange = detail.viewportInteraction
					|| !!detail.manipulating
					|| (detail.anchorChanged && !detail.viewportResized)
					|| (detail.viewportResized && !popoverFits);
				if (transientGeometryChange) {
					closeVideoTransientOverlay();
				}
				if (detail.manipulating && surface.contains(surface.ownerDocument.activeElement)) {
					focusAnchor();
				}
				if (detail.visibility === 'anchor-offscreen' && surface.contains(surface.ownerDocument.activeElement)) {
					const pickBanner = [...surface.ownerDocument.querySelectorAll<HTMLElement>('.basehalf-video-input-pick-banner')]
						.find(candidate => candidate.dataset.targetNodePath === item.path);
					const pickCancel = pickBanner?.querySelector<HTMLButtonElement>('.basehalf-video-input-pick-cancel');
					if (pickCancel?.isConnected) {
						pickCancel.focus({ preventScroll: true });
					} else {
						this.root.focus({ preventScroll: true });
					}
				}
				if (pendingInitialFocus && detail.visible && !detail.manipulating && !detail.viewportInteraction) {
					pendingInitialFocus = false;
					mainWindow.requestAnimationFrame(() => {
						mainWindow.requestAnimationFrame(() => {
							if (mounted && mount.isConnected && this.activeNodeLocalSurface === localSurfaceController) {
								focusLocalSurface();
							}
						});
					});
				}
			};
			mount.addEventListener(BASEHALF_CANVAS_VIDEO_COMPOSER_LAYOUT_EVENT, onPortalLayout);
			lifetime.add(toDisposable(() => mount.removeEventListener(BASEHALF_CANVAS_VIDEO_COMPOSER_LAYOUT_EVENT, onPortalLayout)));
			let mounted = true;
			const publishVideoComposerSurface = (sceneKey: string, structuralEpoch: number): void => {
				if (!mounted) {
					return;
				}
				this.canvasScene.setVideoComposerSurface({
					sceneKey,
					structuralEpoch,
					path: item.path,
					element: mount,
					screenWidth: localSurfaceWidth,
					screenHeight: BASEHALF_VIDEO_COMPOSER_HEIGHT
				});
			};
			rebindVideoComposerScene = publishVideoComposerSurface;
			disposeMountedVideoComposer = restoreFocus => {
				if (!mounted) {
					return;
				}
				mounted = false;
				this.canvasScene.clearVideoComposerSurface(mount);
				lifetime.dispose();
				if (this.activeNodeLocalSurface === localSurfaceController) {
					this.activeNodeLocalSurface = undefined;
				}
				if (restoreFocus) {
					focusAnchor();
				}
			};
			publishVideoComposerSurface(this.sceneKey(folder), this.renderedSceneStructuralEpoch);
			return;
		}
		this.contextViewService.showContextView(delegate);
	}

	private async saveNodeLocalChanges(
		folder: IBaseHalfCanvasFolderState,
		item: IBaseHalfCanvasItem,
		expectedContents: VSBuffer,
		nextDocument: IBaseHalfNodeDocument,
		removedSourcePaths: readonly string[],
		addedSourcePaths: readonly string[] = [],
		expectedSourceRevisions: ReadonlyMap<string, string> = new Map(),
		expectedTargetRevision?: string
	): Promise<IBaseHalfCanvasConnectionTransition> {
		const nextContents = VSBuffer.fromString(serializeBaseHalfNodeDocument(nextDocument));
		const documentTransition = { resource: item.stat.resource, expected: expectedContents, next: nextContents };
		const removedSources = [...new Set(removedSourcePaths)];
		const addedSources = [...new Set(addedSourcePaths)];
		if (removedSources.some(sourcePath => addedSources.includes(sourcePath))) {
			throw new Error('One input source cannot be added and removed in the same node edit.');
		}
		const validateSourceRevisions = async (): Promise<void> => {
			for (const [sourcePath, expectedRevision] of expectedSourceRevisions) {
				const currentRevision = await this.nodeExecutionService.getInputRevision(
					folder.workspaceFolder,
					sourcePath,
					{ fresh: true }
				);
				if (currentRevision !== expectedRevision) {
					throw new Error(`Input source '${sourcePath}' changed before this node edit could be saved.`);
				}
			}
		};
		const validateTargetRevision = async (): Promise<void> => {
			if (!expectedTargetRevision) {
				return;
			}
			const latest = await this.fileService.readFile(item.stat.resource, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			if (latest.etag !== expectedTargetRevision) {
				throw new Error('The Video Draft changed while the selected input was being checked. Review the current inputs and try again.');
			}
		};
		if (removedSources.length === 0 && addedSources.length === 0) {
			await validateSourceRevisions();
			await validateTargetRevision();
			await this.fileService.writeFileWithExpectedContents(
				item.stat.resource,
				nextContents,
				expectedContents,
				{ atomic: { postfix: '.basehalf-node-edit-tmp' } }
			);
			return {
				folder,
				nodes: [{ path: item.path, kind: item.kind }],
				references: [],
				canvas: { edges: [] },
				documents: [documentTransition]
			};
		}

		const persistedEdges = (await this.canvasMirrorService.readCanvas(folder))?.edges ?? [];
		const describeSource = async (sourcePath: string): Promise<IBaseHalfCanvasUndoNode> => {
			const stat = await this.fileService.stat(joinPath(folder.workspaceFolder, ...sourcePath.split('/')));
			return { path: sourcePath, kind: stat.isDirectory ? 'folder' : 'file' };
		};
		const removals = await Promise.all(removedSources.map(async sourcePath => {
			let source: IBaseHalfCanvasUndoNode;
			let sourceExists = true;
			try {
				source = await describeSource(sourcePath);
			} catch (error) {
				if (toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) {
					throw error;
				}
				source = { path: sourcePath, kind: 'file' };
				sourceExists = false;
			}
			const canvasEdge = persistedEdges.find(edge => edge.from === sourcePath && edge.to === item.path);
			return { source, sourceExists, canvasEdge };
		}));
		const additions = await Promise.all(addedSources.map(async sourcePath => {
			const source = await describeSource(sourcePath);
			if (persistedEdges.some(edge => edge.from === sourcePath && edge.to === item.path)) {
				throw new Error(`Context from '${sourcePath}' is already connected to '${item.path}'.`);
			}
			const canvasEdge: IBaseHalfCanvasEdge = {
				from: sourcePath,
				from_anchor: 'east',
				to: item.path,
				to_anchor: 'west'
			};
			return { source, canvasEdge };
		}));
		let committedTransition: IBaseHalfCanvasConnectionTransition | undefined;
		await this.workspaceMutationCoordinator.runSceneMutation(
			folder.workspaceFolder,
			this.sceneMutationStamp(folder, this.renderedSceneStructuralEpoch),
			async lease => {
				const target = { path: item.path, kind: item.kind };
				const nodes = [...removals.map(removal => removal.source), ...additions.map(addition => addition.source), target];
				const existingNodes = [
					...removals.filter(removal => removal.sourceExists).map(removal => removal.source),
					...additions.map(addition => addition.source),
					target
				];
				const live = new Map(await this.resolveLiveWorkspaceNodes(folder.workspaceFolder, existingNodes));
				for (const removal of removals) {
					if (!removal.sourceExists) {
						live.set(removal.source.path, {
							resource: joinPath(folder.workspaceFolder, ...removal.source.path.split('/')),
							workspaceFolder: folder.workspaceFolder,
							relativePath: removal.source.path,
							kind: removal.source.kind
						});
					}
				}
				const referenceTransitions: IBaseHalfCanvasReferenceTransition[] = [];
				const canvasTransitions: IBaseHalfCanvasEdgeStateTransition[] = [];
				try {
					await validateTargetRevision();
					await validateSourceRevisions();
					for (const removal of removals) {
						const removed = await removeCompleteBaseHalfCanvasReference(
							() => this.badgeGraphService.removeReferenceWithState(
								live.get(removal.source.path)!,
								live.get(item.path)!,
								lease
							),
							transition => this.badgeGraphService.transitionReferenceStates([{
								source: live.get(removal.source.path)!,
								target: live.get(item.path)!,
								expected: transition.after,
								next: transition.before
							}], lease),
							`Connection '${removal.source.path}' → '${item.path}' changed before it could be removed.`,
							true
						);
						referenceTransitions.push({
							source: removal.source,
							target,
							expected: removed.before,
							next: removed.after
						});
						if (removal.canvasEdge) {
							const canvasTransition = {
								from: removal.source.path,
								to: item.path,
								expected: removal.canvasEdge,
								next: null
							};
							await this.canvasMirrorService.transitionCanvasState(folder, { edges: [canvasTransition] }, lease);
							canvasTransitions.push(canvasTransition);
						}
					}
					for (const addition of additions) {
						const added = await this.badgeGraphService.addReferenceWithState(
							live.get(addition.source.path)!,
							live.get(item.path)!,
							lease
						);
						if (added.result !== 'added') {
							throw new Error(`Context from '${addition.source.path}' is already connected to '${item.path}' or requires metadata repair.`);
						}
						referenceTransitions.push({
							source: addition.source,
							target,
							expected: added.before,
							next: added.after
						});
						const canvasTransition = {
							from: addition.source.path,
							to: item.path,
							expected: null,
							next: addition.canvasEdge
						};
						await this.canvasMirrorService.transitionCanvasState(folder, { edges: [canvasTransition] }, lease);
						canvasTransitions.push(canvasTransition);
					}
					await validateTargetRevision();
					await this.fileService.writeFileWithExpectedContents(
						item.stat.resource,
						nextContents,
						expectedContents,
						{ atomic: { postfix: '.basehalf-node-edit-tmp' } }
					);
					committedTransition = {
						folder,
						nodes,
						references: referenceTransitions,
						canvas: { edges: canvasTransitions },
						documents: [documentTransition]
					};
				} catch (error) {
					const rollbackErrors: unknown[] = [];
					for (const transition of [...canvasTransitions].reverse()) {
						try {
							await this.canvasMirrorService.transitionCanvasState(folder, {
								edges: [{ ...transition, expected: transition.next, next: transition.expected }]
							}, lease);
						} catch (restoreError) {
							rollbackErrors.push(restoreError);
						}
					}
					for (const transition of [...referenceTransitions].reverse()) {
						try {
							await this.badgeGraphService.transitionReferenceStates([{
								source: live.get(transition.source.path)!,
								target: live.get(transition.target.path)!,
								expected: transition.next,
								next: transition.expected
							}], lease);
						} catch (restoreError) {
							rollbackErrors.push(restoreError);
						}
					}
					if (rollbackErrors.length > 0) {
						throw new AggregateError([error, ...rollbackErrors], 'The node edit and its safe rollback both failed. Reopen the project before continuing.');
					}
					throw error;
				}
			}
		);
		if (!committedTransition) {
			throw new Error('The node edit did not complete.');
		}
		return committedTransition;
	}

	private async readNodeInboundSources(folder: IBaseHalfCanvasFolderState, item: IBaseHalfCanvasItem): Promise<IBaseHalfNodeInboundState> {
		try {
			const target: IBaseHalfBadgeNode = {
				resource: item.stat.resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath: item.path,
				kind: 'file'
			};
			const neighborhood = await this.badgeGraphService.readBadgeNeighborhood(target);
			if (neighborhood.problems.length > 0) {
				return Object.freeze({
					sources: Object.freeze([]),
					problem: 'Repair direct context references before running this node.'
				});
			}
			const paths = neighborhood.badges.get(item.path)?.referenced_by ?? [];
			const sources: IBaseHalfNodeInboundSource[] = [];
			for (const path of paths) {
				try {
					sources.push(await this.readWorkspaceContentDescriptor(folder.workspaceFolder, path));
				} catch (error) {
					if (toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) {
						throw error;
					}
					// Retain the durable backlink path while leaving its kind unknown,
					// so one missing source does not discard readable siblings.
					sources.push(Object.freeze({ path }));
				}
			}
			return Object.freeze({ sources: Object.freeze(sources.sort((left, right) => left.path.localeCompare(right.path))) });
		} catch (error) {
			this.logService.warn(error);
			return Object.freeze({
				sources: Object.freeze([]),
				problem: 'Direct context could not be read. Reopen the node and try again.'
			});
		}
	}

	private async readWorkspaceContentKind(workspaceFolder: URI, path: string): Promise<BaseHalfCanvasContentKind> {
		return (await this.readWorkspaceContentDescriptor(workspaceFolder, path)).kind;
	}

	private async readWorkspaceContentDescriptor(
		workspaceFolder: URI,
		path: string
	): Promise<IBaseHalfNodeInboundSource & {
		readonly kind: BaseHalfCanvasContentKind;
		readonly revisionDependencyPaths: readonly string[];
	}> {
		const resource = joinPath(workspaceFolder, ...path.split('/'));
		const stat = await this.fileService.resolve(resource, { resolveMetadata: true });
		if (!stat.isDirectory && path.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			const source = await this.fileService.readFile(resource, { limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } });
			const sourceDocument = parseBaseHalfNodeDocumentBytes(source.value.buffer);
			const artifact = getBaseHalfNodeResultArtifact(sourceDocument);
			const resultIdentity = sourceDocument.result?.source === 'attempt'
				? { source: 'attempt' as const, id: sourceDocument.result.attemptId }
				: sourceDocument.result?.source === 'imported'
					? { source: 'imported' as const, id: sourceDocument.result.artifact.id }
					: undefined;
			return Object.freeze({
				path,
				kind: sourceDocument.kind,
				revisionDependencyPaths: baseHalfCanvasVideoPickRevisionDependencyPaths(path, artifact?.path),
				...(resultIdentity === undefined ? {} : { resultIdentity: Object.freeze(resultIdentity) })
			});
		}
		return Object.freeze({
			path,
			kind: baseHalfCanvasContentKindForPath(path, stat.isDirectory),
			revisionDependencyPaths: baseHalfCanvasVideoPickRevisionDependencyPaths(path)
		});
	}

	private async readNodeDirectSourceProblems(
		folder: IBaseHalfCanvasFolderState,
		sources: readonly IBaseHalfNodeInboundSource[],
		bindings: readonly IBaseHalfNodeInputBinding[] = []
	): Promise<ReadonlyMap<string, string>> {
		const checks = await Promise.all(sources.map(async source => {
			try {
				const revision = await this.nodeExecutionService.getInputRevision(folder.workspaceFolder, source.path, { fresh: true });
				const binding = bindings.find(candidate => candidate.sourcePath === source.path);
				if (binding?.sourceRevision !== undefined && binding.sourceRevision !== revision) {
					return [source.path, BASEHALF_VIDEO_INPUT_SOURCE_CHANGED_PROBLEM] as const;
				}
				return undefined;
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					return [source.path, reason.slice(0, 400)] as const;
				}
			}));
		return new Map(checks.filter((entry): entry is readonly [string, string] => entry !== undefined));
	}

	private renderNodeLocalSection(container: HTMLElement, label: string): HTMLElement {
		const section = append(container, $('.basehalf-node-local-section'));
		const heading = append(section, $('.basehalf-node-local-section-title'));
		heading.textContent = label;
		return section;
	}

	private renderNodeLocalParameter(
		container: HTMLElement,
		parameter: IBaseHalfCanvasRecipeParameterDefinition,
		value: BaseHalfNodeParameterDraftValue,
		onChange: (value: BaseHalfNodeParameterDraftValue) => void,
		listeners: DisposableStore
	): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
		const field = append(container, $('.basehalf-node-local-field'));
		const label = append(field, $('label.basehalf-node-local-label')) as HTMLLabelElement;
		label.textContent = parameter.required ? `${parameter.label} · required` : parameter.label;
		if (parameter.type === 'multiline') {
			const input = append(field, $('textarea.basehalf-node-local-input.multiline')) as HTMLTextAreaElement;
			input.value = typeof value === 'string' ? value : '';
			input.rows = 3;
			label.htmlFor = input.id = `basehalf-node-${parameter.id}-${Date.now()}`;
			input.setAttribute('aria-label', parameter.label);
			listeners.add(this.addDisposableListener(input, 'input', () => onChange(input.value)));
			return input;
		}
		if (parameter.type === 'enum') {
			const input = append(field, $('select.basehalf-node-local-select')) as HTMLSelectElement;
			if (!parameter.required && parameter.default === undefined) {
				const unset = append(input, $('option')) as HTMLOptionElement;
				unset.value = '';
				unset.textContent = 'Not set';
			}
			for (const optionValue of parameter.options) {
				const option = append(input, $('option')) as HTMLOptionElement;
				option.value = optionValue.value;
				option.textContent = optionValue.label;
			}
			input.value = typeof value === 'string' ? value : '';
			label.htmlFor = input.id = `basehalf-node-${parameter.id}-${Date.now()}`;
			input.setAttribute('aria-label', parameter.label);
			listeners.add(this.addDisposableListener(input, 'change', () => onChange(input.value || undefined)));
			return input;
		}
		if (parameter.type === 'boolean') {
			const input = append(field, $('select.basehalf-node-local-select')) as HTMLSelectElement;
			if (!parameter.required && parameter.default === undefined) {
				const unset = append(input, $('option')) as HTMLOptionElement;
				unset.value = '';
				unset.textContent = 'Not set';
			}
			for (const [optionValue, optionLabel] of [['true', 'On'], ['false', 'Off']] as const) {
				const option = append(input, $('option')) as HTMLOptionElement;
				option.value = optionValue;
				option.textContent = optionLabel;
			}
			input.value = value === undefined ? '' : String(value);
			label.htmlFor = input.id = `basehalf-node-${parameter.id}-${Date.now()}`;
			input.setAttribute('aria-label', parameter.label);
			listeners.add(this.addDisposableListener(input, 'change', () => onChange(input.value ? input.value === 'true' : undefined)));
			return input;
		}
		const input = append(field, $('input.basehalf-node-local-input')) as HTMLInputElement;
		input.type = parameter.type === 'number' ? 'number' : 'text';
		input.value = typeof value === 'string' ? value : '';
		if (parameter.type === 'number') {
			if (parameter.minimum !== undefined) {
				input.min = String(parameter.minimum);
			}
			if (parameter.maximum !== undefined) {
				input.max = String(parameter.maximum);
			}
			if (parameter.step !== undefined) {
				input.step = String(parameter.step);
			}
		}
		label.htmlFor = input.id = `basehalf-node-${parameter.id}-${Date.now()}`;
		input.setAttribute('aria-label', parameter.label);
		listeners.add(this.addDisposableListener(input, 'input', () => onChange(input.value || undefined)));
		return input;
	}

	private renderNodeLocalAttempts(
		container: HTMLElement,
		document: IBaseHalfNodeDocument,
		listeners: DisposableStore,
		registerFocusTarget: <T extends HTMLElement>(element: T, key: string) => T,
		expandedDisclosures: Set<string>,
		visibleCount: number,
		onLoadMore: () => void
	): void {
		const attemptsSection = this.renderNodeLocalSection(container, 'Attempts');
		const attempts = [...document.attempts]
			.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
		if (attempts.length === 0) {
			const empty = append(attemptsSection, $('.basehalf-node-local-empty'));
			empty.textContent = document.result?.source === 'imported'
				? 'This Result was imported; no generation attempts were made.'
				: 'No attempts yet.';
			return;
		}
		const list = append(attemptsSection, $('.basehalf-node-local-attempts'));
		for (const attempt of attempts.slice(0, visibleCount)) {
			const resultArtifact = document.result?.source === 'attempt' && document.result.attemptId === attempt.id
				? document.result.artifact
				: undefined;
			const row = append(list, $('.basehalf-node-local-attempt-row'));
			const text = append(row, $('.basehalf-node-local-attempt-text'));
			const title = append(text, $('.basehalf-node-local-attempt-title'));
			title.textContent = `${nodeAttemptStatusLabel(attempt.status)} · ${formatNodeAttemptTime(attempt.completedAt ?? attempt.startedAt ?? attempt.createdAt)}`;
			const detail = append(text, $('.basehalf-node-local-attempt-detail'));
			detail.textContent = getBaseHalfNodeAttemptSummary(attempt, resultArtifact?.label ?? resultArtifact?.path);
			detail.title = detail.textContent;
			const actions = append(row, $('.basehalf-node-local-attempt-actions'));
			const disclosureLines = getBaseHalfNodeAttemptDisclosureLines(attempt, resultArtifact);
			const details = append(actions, $('button.basehalf-node-local-link')) as HTMLButtonElement;
			registerFocusTarget(details, `attempt:${attempt.id}:details`);
			details.type = 'button';
			details.textContent = 'Details';
			const disclosure = append(row, $('.basehalf-node-local-attempt-disclosure'));
			disclosure.hidden = !expandedDisclosures.has(attempt.id);
			details.setAttribute('aria-expanded', String(!disclosure.hidden));
			disclosure.textContent = disclosureLines.join('\n');
			listeners.add(this.addDisposableListener(details, 'click', () => {
				disclosure.hidden = !disclosure.hidden;
				if (disclosure.hidden) {
					expandedDisclosures.delete(attempt.id);
				} else {
					expandedDisclosures.add(attempt.id);
				}
				details.setAttribute('aria-expanded', String(!disclosure.hidden));
			}));
		}
		if (attempts.length > visibleCount) {
			const loadMore = append(attemptsSection, $('button.basehalf-node-local-link')) as HTMLButtonElement;
			registerFocusTarget(loadMore, 'attempts:load-more');
			loadMore.type = 'button';
			loadMore.textContent = `Load ${Math.min(50, attempts.length - visibleCount)} older attempts`;
			loadMore.setAttribute('aria-label', `${loadMore.textContent}; ${attempts.length - visibleCount} remain`);
			listeners.add(this.addDisposableListener(loadMore, 'click', onLoadMore));
		}
	}

	private async importCanvasNodeResult(item: IBaseHalfCanvasItem): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder || this.canvasNavigationService.state.cardDetail) {
			return;
		}
		try {
			if (this.workingCopyService.isDirty(item.stat.resource) || this.nodeExecutionService.getActiveRun(item.stat.resource)) {
				throw new Error('Save this Draft and finish its active attempt before importing a Result.');
			}
			const content = await this.fileService.readFile(item.stat.resource, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			const document = parseBaseHalfNodeDocumentBytes(content.value.buffer);
			const importProblem = getBaseHalfNodeImportProblem(document);
			if (importProblem) {
				throw new Error(importProblem);
			}
			if (document.attempts.some(attempt => attempt.status === 'running')) {
				throw new Error('Finish the active attempt before importing a Result.');
			}
			await this.importNodeResult(folder, item, content.value, document);
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
		}
	}

	private async importNodeResult(
		folder: IBaseHalfCanvasFolderState,
		item: IBaseHalfCanvasItem,
		expectedContents: VSBuffer,
		document: IBaseHalfNodeDocument
	): Promise<void> {
		const importProblem = getBaseHalfNodeImportProblem(document);
		if (importProblem) {
			throw new Error(importProblem);
		}
		const importLabel = baseHalfNodeImportActionLabel(document.kind);
		const resources = await this.fileDialogService.showOpenDialog({
			title: `${importLabel} as Result`,
			openLabel: importLabel,
			defaultUri: folder.resource,
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false
		});
		const source = resources?.[0];
		if (!source) {
			return;
		}
		try {
			if (this.workingCopyService.isDirty(item.stat.resource) || this.nodeExecutionService.getActiveRun(item.stat.resource)) {
				throw new Error('Save this Draft and finish its active attempt before importing a Result.');
			}
			const stat = await this.fileService.resolve(source, { resolveMetadata: true });
			if (!stat.isFile || stat.isSymbolicLink) {
				throw new Error('Choose a regular local file.');
			}
			const importedKind = baseHalfCanvasContentKindForPath(basename(source), false);
			if (!baseHalfNodeCanImportContentKind(document.kind, importedKind)) {
				throw new Error(`Choose a ${document.kind} file for this node. '${basename(source)}' is ${importedKind} content.`);
			}
			const incrementalNaming = this.configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
			const assetDirectory = baseHalfNodeImportedAssetDirectory(folder.workspaceFolder, document.id);
			const target = await findValidPasteFileTargetForResource(
				this.fileService,
				this.dialogService,
				assetDirectory,
				{ resource: source, isDirectory: false, allowOverwrite: false },
				incrementalNaming === 'disabled' ? 'smart' : incrementalNaming
			);
			if (!target) {
				return;
			}
			const artifact = await this.nodeExecutionService.copyImportedResult(folder.workspaceFolder, source, target, document.kind);
			try {
				await this.fileService.writeFileWithExpectedContents(
					item.stat.resource,
					VSBuffer.fromString(serializeBaseHalfNodeDocument(importBaseHalfNodeResult(document, artifact))),
					expectedContents,
					{ atomic: { postfix: '.basehalf-node-import-tmp' } }
				);
			} catch (error) {
				throw new Error(`The node changed before the import could be saved. The copied file '${artifact.path}' was kept as ordinary project data.`, { cause: error });
			}
			this.contextViewService.hideContextView();
			this.requestRender();
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
		}
	}

	private async locateNodeResult(item: IBaseHalfCanvasItem): Promise<void> {
		try {
			const content = await this.fileService.readFile(item.stat.resource, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			const document = this.nodeExecutionService.getActiveRun(item.stat.resource)
				? parseBaseHalfNodeDocumentBytesForActiveHost(content.value.buffer)
				: parseBaseHalfNodeDocumentBytes(content.value.buffer);
			const artifact = getBaseHalfNodeResultArtifact(document);
			if (artifact) {
				await this.locateNodeArtifact(artifact);
			}
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning('The Result changed before it could be opened. Reopen the node and try again.');
			this.requestRender();
		}
	}

	private async locateNodeArtifact(
		artifact: IBaseHalfNodeResultArtifact
	): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		const path = artifact.path;
		try {
			const integrity = await this.nodeExecutionService.getArtifactIntegrity(folder.workspaceFolder, artifact, { fresh: true });
			const problem = getBaseHalfNodeResultArtifactOpenProblem(path, integrity);
			if (problem) {
				this.queueCanvasWarning(problem);
				this.requestRender();
				return;
			}
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning(`The sealed Result could not be verified: '${path}'. Restore the original file or copy the settings into a new Draft.`);
			this.requestRender();
			return;
		}
		await this.openNodeArtifactPath(folder, path);
	}

	private async openNodeArtifactPath(folder: IBaseHalfCanvasFolderState, path: string): Promise<void> {
		const resource = joinPath(folder.workspaceFolder, ...path.split('/'));
		this.contextViewService.hideContextView();
		try {
			await this.fileService.resolve(resource);
			await this.canvasNavigationService.openResource(resource, { source: 'api', pinned: true });
		} catch {
			this.layoutService.setPartHidden(false, Parts.SIDEBAR_PART);
			await this.explorerService.select(dirname(resource), 'force');
			this.queueCanvasWarning(`The recorded output '${path}' is missing.`);
			this.requestRender();
		}
	}

	private renderMediaPreview(
		container: HTMLElement,
		preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'media' }>,
		interactive: boolean,
		listeners: DisposableStore
	): void {
		container.classList.add(`media-${preview.mediaKind}`);
		if (preview.mediaKind === 'image') {
			const image = append(container, $('img.basehalf-canvas-card-media-visual')) as HTMLImageElement;
			image.src = FileAccess.uriToBrowserUri(preview.resource).toString(true);
			image.alt = '';
			image.draggable = false;
			image.loading = 'lazy';
			image.addEventListener('error', () => {
				image.remove();
				this.renderMediaFallback(container, preview.text, 'image', () => {
					clearNode(container);
					this.renderMediaPreview(container, preview, interactive, listeners);
				});
			}, { once: true });
			return;
		}
			if (preview.mediaKind === 'video') {
				const video = append(container, $('video.basehalf-canvas-card-media-visual')) as HTMLVideoElement;
			video.src = FileAccess.uriToBrowserUri(preview.resource).toString(true);
			video.preload = 'metadata';
			video.controls = interactive;
			video.tabIndex = interactive ? 0 : -1;
				if (interactive) {
					video.classList.add('nodrag', 'nopan', 'nowheel');
				}
			video.playsInline = true;
			if (interactive) {
				video.setAttribute('aria-label', localize('basehalf.canvas.videoPreview.player', "Video player for {0}", preview.text));
				} else {
					video.setAttribute('aria-hidden', 'true');
					video.style.pointerEvents = 'none';
				}
			listeners.add(toDisposable(() => releaseBaseHalfCanvasCardMedia(video)));
			if (interactive) {
				this.configureCardMediaTransport(video);
			}
			video.addEventListener('error', () => {
				video.remove();
				this.renderMediaFallback(container, preview.text, 'video', () => {
					clearNode(container);
					this.renderMediaPreview(container, preview, interactive, listeners);
				});
			}, { once: true });
			return;
		}
		if (preview.mediaKind === 'audio') {
			if (!interactive) {
				this.renderMediaFallback(container, preview.text, 'audio');
				return;
			}
			const idle = append(container, $('.basehalf-canvas-card-media-idle'));
			idle.setAttribute('aria-hidden', 'true');
			const glyph = append(idle, $('.basehalf-canvas-card-media-idle-glyph'));
			this.renderGlyph(glyph, 'audio', 'var(--bh-card-text-tertiary)', 24);
			const label = append(idle, $('.basehalf-canvas-card-media-idle-label'));
			label.textContent = preview.text;
			const audio = append(container, $('audio.basehalf-canvas-card-media-transport')) as HTMLAudioElement;
			audio.src = FileAccess.uriToBrowserUri(preview.resource).toString(true);
			audio.preload = 'metadata';
			audio.controls = true;
			audio.tabIndex = 0;
			audio.classList.add('nodrag', 'nopan', 'nowheel');
			listeners.add(toDisposable(() => releaseBaseHalfCanvasCardMedia(audio)));
			this.configureCardMediaTransport(audio);
			audio.addEventListener('error', () => {
				audio.remove();
				this.renderMediaFallback(container, preview.text, 'audio', () => {
					clearNode(container);
					this.renderMediaPreview(container, preview, interactive, listeners);
				});
			}, { once: true });
			return;
		}
		this.renderMediaFallback(container, preview.text, preview.mediaKind);
	}

	private configureCardMediaTransport(media: HTMLMediaElement): void {
		for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'] as const) {
			media.addEventListener(type, event => {
				// An idle preview behaves like the rest of its card: it can be
				// selected, dragged, opened, and panned across. The scene enables
				// controls only for the selected card; only then does the media
				// transport own these gestures.
				if (media.controls) {
					event.stopPropagation();
				}
			});
		}
		media.addEventListener('play', () => {
			for (const other of this.cards.querySelectorAll<HTMLMediaElement>('video, audio')) {
				if (other !== media && !other.paused) {
					other.pause();
				}
			}
		});
	}

	private renderMediaFallback(container: HTMLElement, label: string, kind: 'image' | 'video' | 'audio' | 'pdf', reload?: () => void): void {
		if (container.querySelector('.basehalf-canvas-card-media-fallback')) {
			return;
		}
		const fallback = append(container, $('.basehalf-canvas-card-media-fallback'));
		const glyph = append(fallback, $('.basehalf-canvas-card-media-fallback-glyph'));
		this.renderGlyph(glyph, kind, 'var(--bh-card-text-tertiary)', 24);
		const text = append(fallback, $('span.basehalf-canvas-card-media-fallback-label'));
		text.textContent = reload ? 'Preview unavailable' : label;
		if (reload) {
			text.title = label;
			const button = append(fallback, $('button.basehalf-canvas-card-media-reload')) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = 'Reload preview';
			button.title = `Reload preview for ${label}`;
			button.addEventListener('pointerdown', event => event.stopPropagation());
			button.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				reload();
			}, { once: true });
		}
	}

	private renderFolderPreview(container: HTMLElement, preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'folder' }>, description: string | undefined): void {
		if (preview.total === 0) {
			const empty = append(container, $('span.basehalf-canvas-folder-empty'));
			empty.textContent = 'Empty folder';
		} else {
			const list = append(container, $('.basehalf-canvas-folder-preview-list'));
			for (const child of preview.items) {
				const row = append(list, $('.basehalf-canvas-folder-preview-row'));
				const glyph = append(row, $('.basehalf-canvas-folder-preview-glyph'));
				this.renderGlyph(glyph, badgeType(child.name, child.kind === 'folder'), child.kind === 'folder' ? 'var(--bh-card-folder-glyph)' : 'var(--bh-card-text-tertiary)', 12);
				const label = append(row, $('.basehalf-canvas-folder-preview-label'));
				label.textContent = child.kind === 'folder' ? `${child.name}/` : child.name;
				label.classList.toggle('folder', child.kind === 'folder');
			}
			const remaining = preview.total - preview.items.length;
			if (remaining > 0) {
				const more = append(list, $('.basehalf-canvas-folder-preview-more'));
				more.textContent = `+${remaining} more`;
			}
		}
		if (description) {
			const note = append(container, $('.basehalf-canvas-folder-note'));
			note.textContent = description;
		}
	}

	private renderMarkdownPreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		text: string,
		listeners: DisposableStore,
		card: HTMLElement
	): void {
		const fallback = append(container, $('.bh-md-preview'));
		const rendering = new DisposableStore();
		listeners.add(rendering);
		this.renderStaticMarkdownPreview(fallback, item, text, rendering);
		const mount: IBaseHalfCanvasNotePreviewMount = {
			path: item.path,
			resourceKey: this.uriIdentityService.extUri.getComparisonKey(item.stat.resource),
			card,
			container,
			fallback,
			rendering,
			preview: { kind: 'markdown', text }
		};
		this.canvasNotePreviewMounts.set(card, mount);
		listeners.add(toDisposable(() => {
			if (this.canvasNotePreviewMounts.get(card) === mount) {
				this.canvasNotePreviewMounts.delete(card);
			}
		}));
		this.tryMountCanvasNoteEditor(item.path);
	}

	private tryMountCanvasNoteEditor(path: string): boolean {
		if (this.activeCanvasNoteEditor) {
			return this.activeCanvasNoteEditor.path === path;
		}
		if (this.canvasNoteSurfacePath !== path
			|| this.canvasNavigationService.state.cardDetail
			|| (this.inlineEdit?.kind === 'rename' && this.inlineEdit.path === path)) {
			return false;
		}
		const folder = this.getCurrentFolder();
		const item = this.renderedItemsByPath.get(path);
		const card = this.renderedCardElementsByPath.get(path);
		const renderedCard = this.renderedCardsByPath.get(path);
		const mount = card ? this.canvasNotePreviewMounts.get(card) : undefined;
		const completePreview = this.renderedCardPreviewsByPath.get(path)?.preview.kind === 'markdown';
		if (!folder || !item || !card || !renderedCard || !mount
			|| !isBaseHalfMarkdownResource(item.stat.resource)
			|| baseHalfCanvasMarkdownEditTarget(item.stat.size, completePreview) !== 'inline'
			|| renderedCard.element !== card
			|| mount.path !== path
			|| mount.resourceKey !== this.uriIdentityService.extUri.getComparisonKey(item.stat.resource)
			|| mount.card !== card
			|| mount.fallback.parentElement !== mount.container
			|| !card.contains(mount.container)) {
			return false;
		}

		const sceneKey = this.sceneKey(folder);
		const pendingFocus = this.pendingCanvasNoteFocus?.path === path
			? this.pendingCanvasNoteFocus
			: undefined;
		if (pendingFocus?.createOwner && !this.isCanvasPostCreateOwnerCurrent(pendingFocus.createOwner)) {
			this.clearPendingCanvasNoteFocus(path);
			if (this.canvasNoteSurfacePath === path) {
				this.canvasNoteSurfacePath = undefined;
			}
			return false;
		}
		if (pendingFocus) {
			this.pendingCanvasNoteFocus = undefined;
		}
		const fallbackScrollTop = mount.fallback.scrollTop;
		mount.fallback.classList.add('basehalf-canvas-note-editor-fallback');
		const host = append(mount.container, $('.basehalf-canvas-note-editor.basehalf-canvas-note-inline-editor.nodrag.nopan.nowheel'));
		host.setAttribute('data-testid', `canvas-note-editor-${path}`);
		const mountDisposables = new DisposableStore();
		const state: IBaseHalfCardDetailState = {
			resource: item.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: path,
			source: 'api',
			pinned: true,
			projection: 'rich'
		};
		const requestToolbarFocus = (): void => {
			const EventConstructor = card.ownerDocument.defaultView?.Event;
			if (EventConstructor) {
				card.dispatchEvent(new EventConstructor(BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT));
			}
		};
		const instance = this.instantiationService.createInstance(
			BaseHalfCanvasMarkdownInlineEditor,
			host,
			status => card.setAttribute('data-note-save-state', status),
			{
				onCanvasToolbarRequest: requestToolbarFocus,
				onCanvasExitRequest: () => void this.closeCanvasNoteEditorAfterFormats(active),
				onSaveRequest: save => void save.then(ok => {
					if (!ok) {
						this.showCanvasNoteSaveWarning(path);
					}
				}),
				onOpenLink: href => this.openStaticMarkdownPreviewLink(href),
				onFormatStateChange: formatState => this.publishCanvasNoteFormatState(path, item.stat.resource, formatState)
			}
		);
		const open = instance.open(state, pendingFocus?.point, pendingFocus?.selection, fallbackScrollTop);
		const active: IBaseHalfActiveCanvasNoteEditor = {
			sceneKey,
			structuralEpoch: this.renderedSceneStructuralEpoch,
			path,
			resourceKey: mount.resourceKey,
			mountedVisualKey: renderedCard.visualKey,
			state,
			card,
			container: mount.container,
			host,
			fallback: mount.fallback,
			fallbackRendering: mount.rendering,
			mountDisposables,
			instance,
			open,
			focusIntent: pendingFocus,
			chromeStale: false
		};
		this.activeCanvasNoteEditor = active;
		card.dataset.noteSurface = 'true';
		card.dataset.noteEditing = 'true';
		this.canvasNavigationService.setActiveCanvasEditor({
			...state,
			prepareToClose: () => this.closeCanvasNoteEditorAfterFormats(active)
		});
		for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'] as const) {
			mountDisposables.add(this.addDisposableListener(host, type, event => event.stopPropagation()));
		}
		void open.then(() => {
			if (this.activeCanvasNoteEditor !== active
				|| active.host.parentElement !== active.container
				|| this.canvasNotePreviewMounts.get(active.card)?.fallback !== active.fallback) {
				return;
			}
			if (pendingFocus?.createOwner && !this.isCanvasPostCreateOwnerCurrent(pendingFocus.createOwner)) {
				this.failCanvasNoteEditorOpen(active);
				this.requestRender();
				return;
			}
			// The original preview remains the atomic exit frame underneath the live
			// surface, but only one projection enters the accessibility tree.
			active.instance.setScrollTop(fallbackScrollTop);
			active.fallback.setAttribute('aria-hidden', 'true');
			active.fallback.setAttribute('inert', '');
			active.host.classList.add('ready');
			this.focusCanvasNoteEditorFromIntent(active, pendingFocus);
			void this.runPendingCanvasNoteFormatCommands(active);
		}, error => {
			if (this.activeCanvasNoteEditor !== active) {
				return;
			}
			const requiresRichEditor = error instanceof BaseHalfCanvasMarkdownRequiresRichEditorError;
			const richCommands = requiresRichEditor
				? this.pendingCanvasNoteFormatCommands
					.filter(pending => this.canvasNoteFormatCommandMatchesActive(pending, active))
					.map(pending => pending.command)
				: [];
			const queuedRich = richCommands.map(command => this.queueMarkdownRichFormatCommand(active.resourceKey, command));
			this.failCanvasNoteEditorOpen(active);
			this.requestRender();
			if (requiresRichEditor) {
				void this.openSceneCard(active.sceneKey, active.structuralEpoch, active.path).then(() => {
					const detail = this.canvasNavigationService.state.cardDetail;
					if (!detail || this.uriIdentityService.extUri.getComparisonKey(detail.resource) !== active.resourceKey) {
						for (const pending of queuedRich) {
							this.discardMarkdownRichFormatCommand(pending);
						}
					}
				}, richError => {
					for (const pending of queuedRich) {
						this.discardMarkdownRichFormatCommand(pending);
					}
					this.reportCanvasMutationError(richError);
				});
			} else {
				this.reportCanvasMutationError(error);
			}
		});
		return true;
	}

	private renderStaticMarkdownPreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		text: string,
		listeners: DisposableStore
	): void {
		this.renderStaticMarkdownSource(container, item.stat.resource, text, listeners);
	}

	private renderStaticMarkdownSource(
		container: HTMLElement,
		resource: URI,
		text: string,
		listeners: DisposableStore
	): void {
		const { body } = splitBaseHalfMarkdownFrontmatter(text);
		if (!body.trim()) {
			const empty = append(container, $('span.basehalf-canvas-note-empty'));
			empty.textContent = localize('basehalf.canvas.note.empty', "Double-click to edit");
			return;
		}
		listeners.add(renderBaseHalfCanvasStoredMarkdownBody(
			container,
			resource,
			text,
			href => this.openStaticMarkdownPreviewLink(href)
		));
	}

	private openStaticMarkdownPreviewLink(href: string): void {
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		let resource: URI;
		try {
			resource = URI.parse(href).with({ query: null, fragment: null });
		} catch {
			return;
		}
		if (!this.uriIdentityService.extUri.isEqualOrParent(resource, folder.workspaceFolder)) {
			return;
		}
		void this.canvasNavigationService.openResource(resource, { source: 'api', pinned: true })
			.catch(error => this.logService.error(error));
	}

	private renderCardBadgeFace(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		listeners: DisposableStore
	): void {
		const face = append(container, $('.basehalf-canvas-card-badge-face'));
		face.classList.add('nowheel', 'nodrag');
		face.setAttribute('data-testid', `card-badge-face-${item.path}`);
		listeners.add(this.addDisposableListener(face, 'pointerdown', event => event.stopPropagation()));
		listeners.add(this.addDisposableListener(face, 'mousedown', event => event.stopPropagation()));
		listeners.add(this.addDisposableListener(face, 'dblclick', event => event.stopPropagation()));
		listeners.add(this.addDisposableListener(face, 'wheel', event => event.stopPropagation()));
		listeners.add(this.addDisposableListener(face, 'keydown', event => {
			if (event.key !== 'Escape' || event.isComposing) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.toggleBadgeFace(item.path);
		}, true));

		const body = append(face, $('.basehalf-canvas-card-badge-scroll'));
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		const saveState = this.badgeDescriptionSaveStates.get(this.badgeDescriptionKey(folder.workspaceFolder, item.path));
		if (saveState) {
			face.setAttribute('data-badge-save-state', saveState);
			face.setAttribute('aria-busy', String(saveState === 'pending' || saveState === 'retrying'));
		}
		const mutationGuard = this.resourceMutationGuard(
			folder.workspaceFolder,
			this.workspaceMutationCoordinator.captureResource(folder.workspaceFolder, item.path),
			baseHalfBadgeResourceIdentity(item.stat)
		);

		this.renderBadgeEditorContent(body, {
			resource: item.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: item.path,
			kind: item.kind
		}, item.badge, this.renderedBadges, this.renderedBadgeProblems, mutationGuard,
		disposable => listeners.add(disposable),
		() => this.referenceCandidates(item),
		focusTarget => {
			this.pendingCanvasBadgeFocus = { path: item.path, target: focusTarget };
			this.requestRender();
		});
	}

	/**
	 * The shared badge editor — prompt, outbound references, inbound backlinks —
	 * used by both the canvas card's flip face and the card detail's badge zone.
	 * The two surfaces differ only in their container chrome and listener
	 * lifetime, so they hand in a listener sink and a reference-candidate
	 * provider.
	 */
	private renderBadgeEditorContent(
		body: HTMLElement,
		node: IBaseHalfBadgeNode,
		badge: IBaseHalfCanvasBadgeMetadata | undefined,
		badges: ReadonlyMap<string, IBaseHalfBadgeFile>,
		problems: ReadonlyMap<string, IBaseHalfBadgeReadProblem>,
		mutationGuard: IBaseHalfCanvasMutationGuard,
		addListener: (disposable: IDisposable) => void,
		candidates: () => readonly IBaseHalfCanvasItem[],
		refresh: (focusTarget: BaseHalfBadgeEditorFocusTarget) => void
	): IBaseHalfBadgeEditorControls {
		const ownProblem = problems.get(node.relativePath);
		if (ownProblem) {
			const issueSection = append(body, $('.basehalf-canvas-card-badge-section.reference-issues'));
			issueSection.setAttribute('data-testid', 'badge-metadata-issue');
			const heading = append(issueSection, $('.basehalf-canvas-card-badge-issues-title'));
			heading.textContent = 'Badge metadata issue';
			const row = append(issueSection, $('.basehalf-canvas-card-badge-issue-row'));
			const message = append(row, $('span.basehalf-canvas-card-badge-issue-message'));
			message.textContent = ownProblem.corrupt ? 'badge.yaml cannot be parsed' : 'badge.yaml cannot be read';
			message.title = ownProblem.message;
			const open = append(row, $('button.basehalf-canvas-card-badge-issue-action')) as HTMLButtonElement;
			open.type = 'button';
			open.textContent = 'Open metadata';
			open.title = ownProblem.message;
			addListener(this.addDisposableListener(open, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				void this.openBadgeMetadata(node.workspaceFolder, ownProblem.relativePath, ownProblem.resource).catch(error => {
					message.textContent = 'Metadata could not be opened safely';
					message.title = error instanceof Error ? error.message : String(error);
					this.reportCanvasMutationError(error);
				});
			}));
			return {};
		}

		const prompt = append(body, $('textarea.basehalf-canvas-card-badge-prompt')) as HTMLTextAreaElement;
		prompt.value = badge?.description ?? '';
		prompt.placeholder = node.kind === 'folder' ? 'What agents should know about this folder...' : 'What agents should know about this file...';
		prompt.rows = 1;
		prompt.spellcheck = false;
		prompt.setAttribute('aria-label', `Badge prompt for ${node.relativePath}`);
		this.fitBadgePrompt(prompt);
		let composing = false;
		const flushPrompt = () => {
			composing = false;
			const key = this.badgeDescriptionKey(node.workspaceFolder, node.relativePath);
			if (this.badgeDescriptionDrafts.has(key) || prompt.value !== (badge?.description ?? '')) {
				this.scheduleBadgeDescriptionWrite(node, prompt.value, mutationGuard);
			}
			this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath);
		};
		addListener(this.addDisposableListener(prompt, 'compositionstart', () => {
			composing = true;
		}));
		addListener(this.addDisposableListener(prompt, 'compositionend', () => {
			composing = false;
			this.fitBadgePrompt(prompt);
			this.scheduleBadgeDescriptionWrite(node, prompt.value, mutationGuard);
		}));
		addListener(this.addDisposableListener(prompt, 'input', event => {
			this.fitBadgePrompt(prompt);
			if (!composing && !(event instanceof InputEvent && event.isComposing)) {
				this.scheduleBadgeDescriptionWrite(node, prompt.value, mutationGuard);
			}
		}));
		addListener(this.addDisposableListener(prompt, 'blur', () => {
			flushPrompt();
			this.scheduleBackgroundRender();
		}));
		addListener(this.addDisposableListener(prompt, 'keydown', event => {
			if (event.isComposing) {
				event.stopPropagation();
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}
			event.stopPropagation();
		}));
		this.renderBadgeDescriptionRecovery(body, node, addListener, refresh);

		// External Agents update the reciprocal badge files sequentially. Treat a
		// half-written pair as malformed input everywhere, not as a badge-only
		// relationship that disagrees with the canvas projection.
		const relationships = baseHalfCanvasBadgeRelationships(node.relativePath, badge, badges, problems);
		const refs = relationships.references;
		if (relationships.issues.length > 0) {
			const issueSection = append(body, $('.basehalf-canvas-card-badge-section.reference-issues'));
			issueSection.setAttribute('data-testid', 'reference-issues');
			const heading = append(issueSection, $('.basehalf-canvas-card-badge-issues-title'));
			heading.textContent = `${relationships.issues.length} reference issue${relationships.issues.length === 1 ? '' : 's'}`;
			for (const issue of relationships.issues) {
				const counterpart = issue.direction === 'outbound' ? issue.to : issue.from;
				const counterpartOrphan = badges.get(counterpart)?.orphan === true;
				const issueResourceStamps = [issue.from, issue.to].map(path => this.workspaceMutationCoordinator.captureResource(node.workspaceFolder, path));
				const row = append(issueSection, $('.basehalf-canvas-card-badge-issue-row'));
				row.setAttribute('data-testid', 'reference-issue');
				row.setAttribute('data-reference-from', issue.from);
				row.setAttribute('data-reference-to', issue.to);
				row.setAttribute('data-reference-direction', issue.direction);
				row.setAttribute('data-reference-reason', issue.reason);
				const actionButtons: HTMLButtonElement[] = [];
				let actionError: HTMLElement | undefined;
				const runAction = (action: () => Promise<boolean>) => {
					actionError?.remove();
					actionError = undefined;
					row.setAttribute('aria-busy', 'true');
					for (const button of actionButtons) {
						button.disabled = true;
					}
					void action().then(() => {
						// A false result means the pair changed after this issue row was
						// rendered (already complete or fully gone). Refresh the stale
						// diagnosis without mutating that newer graph state.
						refresh('add-reference');
					}).catch(error => {
						const alert = actionError = append(row, $('span.basehalf-canvas-card-badge-issue-error'));
						alert.setAttribute('role', 'alert');
						alert.setAttribute('data-testid', 'reference-issue-action-error');
						alert.textContent = error instanceof Error ? error.message : String(error);
						this.reportCanvasMutationError(error);
					}).finally(() => {
						row.removeAttribute('aria-busy');
						for (const button of actionButtons) {
							button.disabled = false;
						}
					});
				};
				const direction = append(row, $('span.basehalf-canvas-card-badge-direction.issue'));
				direction.textContent = issue.direction === 'outbound' ? '→' : '←';
				const label = append(row, $('button.basehalf-canvas-card-badge-link')) as HTMLButtonElement;
				label.type = 'button';
				label.textContent = baseHalfReferenceLabel(counterpart);
				label.title = counterpart;
				addListener(this.addDisposableListener(label, 'click', event => {
					event.preventDefault();
					event.stopPropagation();
					this.openWorkspaceRelative(node.workspaceFolder, counterpart);
				}));
				const state = append(row, $('span.basehalf-canvas-card-badge-issue-message'));
				state.textContent = issue.reason === 'unreadable'
					? 'metadata unreadable'
					: counterpartOrphan
						? 'card is missing; restore it or discard'
						: issue.direction === 'outbound' ? 'target is missing its backlink' : 'source is missing its reference';
				state.title = issue.problem?.message ?? 'Only one side of this reference is recorded.';
				if (issue.reason === 'incomplete') {
					const repair = append(row, $('button.basehalf-canvas-card-badge-issue-action')) as HTMLButtonElement;
					repair.type = 'button';
					repair.textContent = 'Repair';
					repair.setAttribute('data-testid', 'reference-issue-repair');
					repair.setAttribute('aria-label', `Repair reference ${issue.from} to ${issue.to}`);
					repair.disabled = counterpartOrphan;
					if (counterpartOrphan) {
						repair.title = `Restore ${counterpart} before repairing this reference`;
					}
					if (!counterpartOrphan) {
						actionButtons.push(repair);
					}
					addListener(this.addDisposableListener(repair, 'click', event => {
						event.preventDefault();
						event.stopPropagation();
						runAction(() => this.repairBadgeRelationshipIssue(node, issue, mutationGuard, issueResourceStamps));
					}));
					const discard = append(row, $('button.basehalf-canvas-card-badge-issue-action.subtle')) as HTMLButtonElement;
					discard.type = 'button';
					discard.textContent = 'Discard';
					discard.setAttribute('data-testid', 'reference-issue-discard');
					discard.setAttribute('aria-label', `Discard incomplete reference ${issue.from} to ${issue.to}`);
					actionButtons.push(discard);
					addListener(this.addDisposableListener(discard, 'click', event => {
						event.preventDefault();
						event.stopPropagation();
						runAction(() => this.discardBadgeRelationshipIssue(node, issue, badges, mutationGuard, issueResourceStamps));
					}));
					const open = append(row, $('button.basehalf-canvas-card-badge-issue-action.subtle')) as HTMLButtonElement;
					open.type = 'button';
					open.textContent = 'Open metadata';
					open.setAttribute('data-testid', 'reference-issue-open-yaml');
					actionButtons.push(open);
					addListener(this.addDisposableListener(open, 'click', event => {
						event.preventDefault();
						event.stopPropagation();
						void this.openBadgeMetadata(node.workspaceFolder, node.relativePath).catch(error => {
							state.textContent = 'metadata could not be opened safely';
							state.title = error instanceof Error ? error.message : String(error);
							this.reportCanvasMutationError(error);
						});
					}));
				} else if (issue.problem) {
					const open = append(row, $('button.basehalf-canvas-card-badge-issue-action')) as HTMLButtonElement;
					open.type = 'button';
					open.textContent = 'Open metadata';
					open.setAttribute('data-testid', 'reference-issue-open-yaml');
					actionButtons.push(open);
					addListener(this.addDisposableListener(open, 'click', event => {
						event.preventDefault();
						event.stopPropagation();
						void this.openBadgeMetadata(node.workspaceFolder, issue.problem!.relativePath, issue.problem!.resource).catch(error => {
							state.textContent = 'metadata could not be opened safely';
							state.title = error instanceof Error ? error.message : String(error);
							this.reportCanvasMutationError(error);
						});
					}));
				}
			}
		}
		const stampedCandidates: IBaseHalfStampedReferenceCandidate[] = candidates().map(candidate => ({
			candidate,
			stamp: this.workspaceMutationCoordinator.captureResource(node.workspaceFolder, candidate.path)
		}));
		const refSection = append(body, $('.basehalf-canvas-card-badge-section'));
		if (refs.length > 0) {
			const list = append(refSection, $('.basehalf-canvas-card-badge-list'));
			for (const to of refs) {
				const targetStamp = this.workspaceMutationCoordinator.captureResource(node.workspaceFolder, to);
				const row = append(list, $('.basehalf-canvas-card-badge-row'));
				const direction = append(row, $('span.basehalf-canvas-card-badge-direction'));
				direction.textContent = '→';
				const label = append(row, $('button.basehalf-canvas-card-badge-link')) as HTMLButtonElement;
				label.type = 'button';
				label.textContent = baseHalfReferenceLabel(to);
				label.title = to;
				addListener(this.addDisposableListener(label, 'click', event => {
					event.preventDefault();
					event.stopPropagation();
					this.openWorkspaceRelative(node.workspaceFolder, to);
				}));
				const remove = append(row, $('button.basehalf-canvas-card-badge-remove.codicon.codicon-close')) as HTMLButtonElement;
				remove.type = 'button';
				remove.title = `Remove reference to ${baseHalfReferenceLabel(to)}`;
				remove.setAttribute('aria-label', `Remove reference to ${to}`);
				addListener(this.addDisposableListener(remove, 'click', event => {
					event.preventDefault();
					event.stopPropagation();
					if (remove.disabled) {
						return;
					}
					remove.disabled = true;
					row.setAttribute('aria-busy', 'true');
					void this.removeBadgeReference(node, to, mutationGuard, targetStamp).then(changed => {
						if (changed) {
							refresh('add-reference');
						}
					}).catch(error => this.reportCanvasMutationError(error)).finally(() => {
						remove.disabled = false;
						row.removeAttribute('aria-busy');
					});
				}));
			}
		}
		const add = append(refSection, $('button.basehalf-canvas-card-add-reference')) as HTMLButtonElement;
		add.type = 'button';
		add.textContent = '+ Add reference';
		addListener(this.addDisposableListener(add, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			if (add.disabled) {
				return;
			}
			add.disabled = true;
			add.setAttribute('aria-busy', 'true');
			void this.addBadgeReference(node, refs, stampedCandidates, mutationGuard).then(changed => {
				if (changed) {
					refresh('add-reference');
				}
			}).catch(error => this.reportCanvasMutationError(error)).finally(() => {
				add.disabled = false;
				add.removeAttribute('aria-busy');
			});
		}));

		const inbound = relationships.referencedBy;
		let inboundToggle: HTMLButtonElement | undefined;
		if (inbound.length > 0) {
			const inboundSection = append(body, $('.basehalf-canvas-card-badge-section'));
			const toggle = inboundToggle = append(inboundSection, $('button.basehalf-canvas-card-inbound-toggle')) as HTMLButtonElement;
			toggle.type = 'button';
			toggle.textContent = `← ${inbound.length} referenced by`;
			toggle.setAttribute('aria-expanded', String(this.expandedInboundBadges.has(node.relativePath)));
			addListener(this.addDisposableListener(toggle, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				if (this.expandedInboundBadges.has(node.relativePath)) {
					this.expandedInboundBadges.delete(node.relativePath);
				} else {
					this.expandedInboundBadges.add(node.relativePath);
				}
				refresh('inbound-toggle');
			}));
			if (this.expandedInboundBadges.has(node.relativePath)) {
				const list = append(inboundSection, $('.basehalf-canvas-card-badge-list.inbound'));
				for (const from of inbound) {
					const row = append(list, $('.basehalf-canvas-card-badge-row'));
					const direction = append(row, $('span.basehalf-canvas-card-badge-direction.inbound'));
					direction.textContent = '←';
					const label = append(row, $('button.basehalf-canvas-card-badge-link')) as HTMLButtonElement;
					label.type = 'button';
					label.textContent = baseHalfReferenceLabel(from);
					label.title = from;
					addListener(this.addDisposableListener(label, 'click', event => {
						event.preventDefault();
						event.stopPropagation();
						this.openWorkspaceRelative(node.workspaceFolder, from);
					}));
				}
			}
		}
		return { prompt, addReference: add, inboundToggle };
	}

	private renderBadgeDescriptionRecovery(
		body: HTMLElement,
		node: IBaseHalfBadgeNode,
		addListener: (disposable: IDisposable) => void,
		refresh: (focusTarget: BaseHalfBadgeEditorFocusTarget) => void
	): void {
		const key = this.badgeDescriptionKey(node.workspaceFolder, node.relativePath);
		const active = this.badgeDescriptionDrafts.get(key);
		const retained = [
			...(this.badgeDescriptionRecoveryDrafts.get(key) ?? []),
			...(active?.recovery === 'retry-exhausted' ? [active] : [])
		];
		if (retained.length === 0) {
			return;
		}

		const section = append(body, $('.basehalf-canvas-card-badge-section.reference-issues.badge-save-recovery'));
		section.setAttribute('data-testid', 'badge-save-recovery');
		const heading = append(section, $('.basehalf-canvas-card-badge-issues-title'));
		heading.textContent = retained.length === 1 ? 'Badge draft not saved' : `${retained.length} Badge drafts not saved`;

		for (const draft of retained) {
			const row = append(section, $('.basehalf-canvas-card-badge-issue-row'));
			row.setAttribute('data-recovery-reason', draft.recovery ?? 'retry-exhausted');
			const message = append(row, $('span.basehalf-canvas-card-badge-issue-message'));
			message.textContent = draft.recovery === 'identity-changed'
				? 'The file at this path was replaced. This retained draft will not be written to the new file.'
				: draft.recovery === 'resource-missing'
					? 'The original file is missing. This retained draft will not be written unless you copy it yourself.'
					: 'The draft is retained locally. Retry saving or discard it.';

			if (draft.recovery === 'retry-exhausted') {
				const retry = append(row, $('button.basehalf-canvas-card-badge-issue-action')) as HTMLButtonElement;
				retry.type = 'button';
				retry.textContent = 'Retry';
				retry.setAttribute('data-testid', 'badge-save-retry');
				addListener(this.addDisposableListener(retry, 'click', event => {
					event.preventDefault();
					event.stopPropagation();
					const current = this.badgeDescriptionDrafts.get(key);
					if (current !== draft || current.recovery !== 'retry-exhausted') {
						return;
					}
					if (!this.workspaceMutationCoordinator.isResourceStampCurrent(current.node.workspaceFolder, current.identityStamp)) {
						current.recovery = 'identity-changed';
						this.archiveBadgeDescriptionDraft(key, current);
						this.badgeDescriptionDrafts.delete(key);
						this.setBadgeDescriptionSaveState(current.node, 'error');
						refresh('prompt');
						return;
					}
					current.recovery = undefined;
					this.scheduleBadgeDescriptionWrite(current.node, current.value, current.guard);
					this.flushBadgeDescriptionWrite(current.node.workspaceFolder, current.node.relativePath);
				}));
			} else {
				const copy = append(row, $('button.basehalf-canvas-card-badge-issue-action')) as HTMLButtonElement;
				copy.type = 'button';
				copy.textContent = 'Copy draft';
				copy.setAttribute('data-testid', 'badge-save-copy');
				addListener(this.addDisposableListener(copy, 'click', event => {
					event.preventDefault();
					event.stopPropagation();
					void this.copyBadgeDescriptionRecovery(draft.value);
				}));
			}

			const discard = append(row, $('button.basehalf-canvas-card-badge-issue-action.subtle')) as HTMLButtonElement;
			discard.type = 'button';
			discard.textContent = 'Discard';
			discard.setAttribute('data-testid', 'badge-save-discard');
			addListener(this.addDisposableListener(discard, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				this.discardBadgeDescriptionRecovery(key, draft);
				refresh('prompt');
			}));
		}
	}

	private fitBadgePrompt(prompt: HTMLTextAreaElement, mountAttempt = 0): void {
		if (!prompt.isConnected) {
			if (mountAttempt < 8) {
				mainWindow.requestAnimationFrame(() => this.fitBadgePrompt(prompt, mountAttempt + 1));
			}
			return;
		}
		prompt.style.height = 'auto';
		prompt.style.height = `${prompt.scrollHeight}px`;
		prompt.classList.toggle('scrollable', prompt.scrollHeight > prompt.clientHeight + 1);
	}

	/** Open a workspace-relative path in BaseHalf navigation — via the rendered
	 *  canvas item when it is on the current canvas, else straight from the URI
	 *  (a cross-folder reference target is still one click away). */
	private openWorkspaceRelative(workspaceFolder: URI, relativePath: string): void {
		const rendered = this.renderedItemsByPath.get(relativePath);
		const resource = rendered?.stat.resource ?? (relativePath ? joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder);
		void this.canvasNavigationService.openResource(resource, { source: 'api', pinned: true });
	}

	/** A folder card's coverage heat: how many of its DIRECT children carry a
	 *  human note. Rendered only once something is annotated — an untouched
	 *  folder stays clean. Direct children (this canvas's granularity), not a
	 *  recursive census, so rendering never walks the workspace. */
	private renderFolderCoverage(container: HTMLElement, item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined): void {
		if (item.kind !== 'folder' || preview?.kind !== 'folder' || preview.total === 0) {
			return;
		}

		const childPrefix = `${item.path}/`;
		let noted = 0;
		for (const [path, badge] of this.renderedBadges) {
			if (badge.description && path.startsWith(childPrefix) && !path.slice(childPrefix.length).includes('/')) {
				noted++;
			}
		}
		if (noted === 0) {
			return;
		}

		const share = Math.min(1, noted / preview.total);
		const coverage = append(container, $('.basehalf-canvas-card-coverage'));
		coverage.title = `${noted} of ${preview.total} annotated`;
		const fill = append(coverage, $('.basehalf-canvas-card-coverage-fill'));
		fill.style.width = `${Math.max(6, Math.round(share * 100))}%`;
	}


	private selectCard(path: string): void {
		const expected = this.currentPostCreateSelectionPaths();
		if (!expected || this.canvasSelectionSupersedesPostCreate([path])) {
			this.markCanvasUserInteraction();
		}
		this.canvasScene.select({ cardPaths: [path] });
	}


	private toggleBadgeFace(path: string): void {
		if (this.openBadgeFaces.has(path)) {
			const folder = this.getCurrentFolder();
			if (folder) {
				this.flushBadgeDescriptionWrite(folder.workspaceFolder, path);
			}
			this.openBadgeFaces.delete(path);
			this.pendingCanvasBadgeFocus = { path, target: 'toggle' };
		} else {
			this.openBadgeFaces.add(path);
			this.pendingCanvasBadgeFocus = { path, target: 'prompt' };
		}
		this.requestRender();
	}

	private badgeDescriptionKey(workspaceFolder: URI, relativePath: string): string {
		return `${workspaceFolder.toString()}\0${relativePath}`;
	}

	private badgeMetadataWithDraft(
		workspaceFolder: URI,
		relativePath: string,
		badge: IBaseHalfCanvasBadgeMetadata | undefined,
		resourceIdentity: string
	): IBaseHalfCanvasBadgeMetadata | undefined {
		const key = this.badgeDescriptionKey(workspaceFolder, relativePath);
		const draft = this.badgeDescriptionDrafts.get(key);
		if (!draft) {
			return badge;
		}
		const identityTransition = baseHalfTransitionBadgeDraftIdentity(
			draft,
			this.badgeDescriptionRecoveryDrafts.get(key) ?? [],
			this.workspaceMutationCoordinator.captureResource(workspaceFolder, relativePath),
			resourceIdentity
		);
		if (identityTransition.identityChanged) {
			draft.recovery = 'identity-changed';
			this.badgeDescriptionRecoveryDrafts.set(key, [...identityTransition.retained]);
			this.badgeDescriptionDrafts.delete(key);
			this.setBadgeDescriptionSaveState(draft.node, 'error');
			return badge;
		}
		return {
			description: draft.value,
			references: badge?.references ?? [],
			referenced_by: badge?.referenced_by ?? [],
			orphan: badge?.orphan
		};
	}

	private setBadgeDescriptionSaveState(node: IBaseHalfBadgeNode, state: BaseHalfBadgeDescriptionSaveState): void {
		const key = this.badgeDescriptionKey(node.workspaceFolder, node.relativePath);
		this.badgeDescriptionSaveStates.set(key, state);
		const face = this.renderedCardElementsByPath.get(node.relativePath)
			?.querySelector<HTMLElement>('.basehalf-canvas-card-badge-face');
		if (face) {
			face.setAttribute('data-badge-save-state', state);
			face.setAttribute('aria-busy', String(state === 'pending' || state === 'retrying'));
		}
	}

	private scheduleBadgeDescriptionWrite(
		node: IBaseHalfBadgeNode,
		value: string,
		guard: IBaseHalfCanvasMutationGuard,
		retryAttempt = 0
	): void {
		const key = this.badgeDescriptionKey(node.workspaceFolder, node.relativePath);
		if (guard.workspaceKey !== node.workspaceFolder.toString()) {
			return;
		}
		const existingDraft = this.badgeDescriptionDrafts.get(key);
		const identityTransition = baseHalfTransitionBadgeDraftIdentity(
			existingDraft,
			this.badgeDescriptionRecoveryDrafts.get(key) ?? [],
			guard.resourceStamp,
			guard.resourceIdentity
		);
		if (identityTransition.identityChanged) {
			// A path can disappear and later be recreated. Keep the original draft
			// recoverable, but never retarget it to the new resource identity.
			// The incoming value was edited in the old draft surface, so retain that
			// latest keystroke as part of the archived draft before showing the new
			// resource's canonical value.
			existingDraft!.value = value;
			existingDraft!.recovery = 'identity-changed';
			this.badgeDescriptionRecoveryDrafts.set(key, [...identityTransition.retained]);
			this.badgeDescriptionDrafts.delete(key);
			this.setBadgeDescriptionSaveState(existingDraft!.node, 'error');
			this.scheduleBackgroundRender();
			return;
		}
		if (existingDraft?.recovery === 'identity-changed') {
			this.setBadgeDescriptionSaveState(existingDraft.node, 'error');
			return;
		}
		this.badgeDescriptionDrafts.set(key, {
			node,
			guard,
			identityStamp: guard.resourceStamp,
			resourceIdentity: guard.resourceIdentity,
			value
		});
		this.setBadgeDescriptionSaveState(node, retryAttempt > 0 ? 'retrying' : 'pending');
		const existing = this.badgeDescriptionTimers.get(key);
		if (existing !== undefined) {
			mainWindow.clearTimeout(existing);
			this.badgeDescriptionTimers.delete(key);
		}
		const current = this.badgeDescriptionPending.get(key);
		if (current) {
			if (!baseHalfResourceMutationStampsEqual(current.identityStamp, guard.resourceStamp)
				|| current.resourceIdentity !== guard.resourceIdentity) {
				return;
			}
			current.value = value;
			if (retryAttempt === 0) {
				current.retryAttempt = 0;
			}
			if (!current.delayReleased) {
				this.badgeDescriptionTimers.set(key, mainWindow.setTimeout(() => this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath), BASEHALF_AUTO_SAVE_DELAY_MS));
			}
			return;
		}

		let releaseDelay!: () => void;
		const delay = new Promise<void>(resolve => releaseDelay = resolve);
		const pending: IBaseHalfBadgeDescriptionPending = {
			node,
			guard,
			identityStamp: guard.resourceStamp,
			resourceIdentity: guard.resourceIdentity,
			value,
			retryAttempt,
			delayReleased: false,
			delay,
			releaseDelay
		};
		this.badgeDescriptionPending.set(key, pending);
		// Badge notes debounce at the same cadence as file auto-save so every
		// user edit reaches disk with one perceived delay. The workspace FIFO is
		// reserved NOW, so a later rename waits for this authored note and then
		// carries it instead of letting a timer recreate the old path afterwards.
		this.badgeDescriptionTimers.set(key, mainWindow.setTimeout(() => this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath), BASEHALF_AUTO_SAVE_DELAY_MS));
		let writtenValue: string | undefined;
		pending.write = guard.run(async lease => {
			await delay;
			if (this.badgeDescriptionPending.get(key) !== pending) {
				return;
			}
			writtenValue = pending.value;
			const live = await this.resolveLiveWorkspaceNodes(node.workspaceFolder, [{ path: node.relativePath, kind: node.kind }]);
			await this.badgeGraphService.updateDescription(live.get(node.relativePath)!, writtenValue, lease);
		}).then(() => {
			if (this.badgeDescriptionPending.get(key) === pending) {
				this.badgeDescriptionPending.delete(key);
			}
			this.clearBadgeDescriptionTimer(key);
			const draft = this.badgeDescriptionDrafts.get(key);
			if (writtenValue !== undefined && draft?.value === writtenValue) {
				this.badgeDescriptionDrafts.delete(key);
				this.setBadgeDescriptionSaveState(node, this.badgeDescriptionRecoveryDrafts.has(key) ? 'error' : 'saved');
			} else if (draft) {
				this.scheduleBadgeDescriptionWrite(draft.node, draft.value, draft.guard);
			}
			this.scheduleBackgroundRender();
		}).catch(async error => {
			if (this.badgeDescriptionPending.get(key) === pending) {
				this.badgeDescriptionPending.delete(key);
			}
			this.clearBadgeDescriptionTimer(key);
			this.logService.error(error);
			await this.recoverBadgeDescriptionWrite(key, pending, error);
		});
	}

	private async recoverBadgeDescriptionWrite(
		key: string,
		failed: IBaseHalfBadgeDescriptionPending,
		error: unknown
	): Promise<void> {
		const draft = this.badgeDescriptionDrafts.get(key);
		if (!draft) {
			return;
		}
		if (!baseHalfResourceMutationStampsEqual(draft.identityStamp, failed.identityStamp)
			|| draft.resourceIdentity !== failed.resourceIdentity) {
			// The failed write belongs to an older path identity. The active draft
			// was authored against the replacement and can start its own guarded
			// transaction now that the old pending slot has settled.
			if (!draft.recovery) {
				this.scheduleBadgeDescriptionWrite(draft.node, draft.value, draft.guard);
				this.flushBadgeDescriptionWrite(draft.node.workspaceFolder, draft.node.relativePath);
			}
			return;
		}
		let live = false;
		let liveResourceIdentity: string | undefined;
		try {
			const stat = await this.fileService.stat(draft.node.resource);
			live = draft.node.kind === 'folder' ? stat.isDirectory : stat.isFile;
			if (live) {
				liveResourceIdentity = baseHalfBadgeResourceIdentity(stat);
			}
		} catch {
			live = false;
		}
		const identityCurrent = this.workspaceMutationCoordinator.isResourceStampCurrent(
			draft.node.workspaceFolder,
			draft.identityStamp
		) && draft.resourceIdentity === liveResourceIdentity;
		const disposition = baseHalfBadgeDraftFailureDisposition(live, identityCurrent, failed.retryAttempt);
		if (disposition === 'archive-missing') {
			draft.recovery = 'resource-missing';
			this.archiveBadgeDescriptionDraft(key, draft);
			if (this.badgeDescriptionDrafts.get(key) === draft) {
				this.badgeDescriptionDrafts.delete(key);
			}
			this.setBadgeDescriptionSaveState(draft.node, 'error');
			this.queueCanvasWarning(`Badge prompt was not saved because '${draft.node.relativePath}' no longer exists. Recreate the path to copy or discard the retained draft.`);
			const recoveryAction = await this.dialogService.prompt<'copy' | 'discard'>({
				type: 'warning',
				message: `Badge draft retained for missing '${draft.node.relativePath}'`,
				detail: 'The draft was not written anywhere. You can copy it now, keep it until this path is restored, or explicitly discard it.',
				buttons: [
					{ label: 'Copy draft', run: () => 'copy' },
					{ label: 'Discard draft', run: () => 'discard' }
				],
				cancelButton: 'Keep draft'
			});
			if (recoveryAction.result === 'copy') {
				await this.copyBadgeDescriptionRecovery(draft.value);
			} else if (recoveryAction.result === 'discard') {
				this.discardBadgeDescriptionRecovery(key, draft);
			}
			this.scheduleBackgroundRender();
			return;
		}
		if (disposition === 'archive-replaced') {
			draft.recovery = 'identity-changed';
			this.archiveBadgeDescriptionDraft(key, draft);
			if (this.badgeDescriptionDrafts.get(key) === draft) {
				this.badgeDescriptionDrafts.delete(key);
			}
			this.setBadgeDescriptionSaveState(draft.node, 'error');
			this.queueCanvasWarning(`Badge prompt was not saved because '${draft.node.relativePath}' was replaced. The draft is still available to copy or discard.`);
			this.scheduleBackgroundRender();
			return;
		}

		if (disposition === 'retry') {
			await new Promise<void>(resolve => mainWindow.setTimeout(resolve, 50 * (failed.retryAttempt + 1)));
			const latest = this.badgeDescriptionDrafts.get(key);
			if (latest
				&& !latest.recovery
				&& baseHalfResourceMutationStampsEqual(latest.identityStamp, failed.identityStamp)
				&& latest.resourceIdentity === failed.resourceIdentity) {
				this.scheduleBadgeDescriptionWrite(
					latest.node,
					latest.value,
					latest.guard,
					failed.retryAttempt + 1
				);
				this.flushBadgeDescriptionWrite(latest.node.workspaceFolder, latest.node.relativePath);
				return;
			}
		}

		draft.recovery = 'retry-exhausted';
		this.setBadgeDescriptionSaveState(draft.node, 'error');
		this.queueCanvasWarning(`Badge prompt could not be saved after retrying. The draft is still available: ${error instanceof Error ? error.message : String(error)}`);
		this.scheduleBackgroundRender();
	}

	private archiveBadgeDescriptionDraft(key: string, draft: IBaseHalfBadgeDescriptionDraft): void {
		let archived = this.badgeDescriptionRecoveryDrafts.get(key);
		if (!archived) {
			archived = [];
			this.badgeDescriptionRecoveryDrafts.set(key, archived);
		}
		if (!archived.includes(draft)) {
			archived.push(draft);
		}
	}

	private discardBadgeDescriptionRecovery(key: string, draft: IBaseHalfBadgeDescriptionDraft): void {
		if (this.badgeDescriptionDrafts.get(key) === draft) {
			this.badgeDescriptionDrafts.delete(key);
		}
		const archived = this.badgeDescriptionRecoveryDrafts.get(key);
		if (archived?.includes(draft)) {
			const remaining = baseHalfDiscardRetainedBadgeDraft(archived, draft);
			if (remaining.length > 0) {
				this.badgeDescriptionRecoveryDrafts.set(key, [...remaining]);
			} else {
				this.badgeDescriptionRecoveryDrafts.delete(key);
			}
		}
		if (!this.badgeDescriptionDrafts.has(key) && !this.badgeDescriptionRecoveryDrafts.has(key)) {
			this.badgeDescriptionSaveStates.delete(key);
		}
		this.clearBadgeDescriptionTimer(key);
	}

	private clearBadgeDescriptionTimer(key: string): void {
		const timer = this.badgeDescriptionTimers.get(key);
		if (timer !== undefined) {
			mainWindow.clearTimeout(timer);
			this.badgeDescriptionTimers.delete(key);
		}
	}

	private flushBadgeDescriptionWrite(workspaceFolder: URI, path: string): void {
		const key = this.badgeDescriptionKey(workspaceFolder, path);
		let pending = this.badgeDescriptionPending.get(key);
		if (!pending) {
			const draft = this.badgeDescriptionDrafts.get(key);
			if (draft && !draft.recovery) {
				this.scheduleBadgeDescriptionWrite(draft.node, draft.value, draft.guard);
				pending = this.badgeDescriptionPending.get(key);
			}
		}
		if (!pending) {
			return;
		}
		this.clearBadgeDescriptionTimer(key);
		pending.delayReleased = true;
		pending.releaseDelay();
	}

	private async flushAllBadgeDescriptionWrites(): Promise<void> {
		for (const [key, draft] of this.badgeDescriptionDrafts) {
			if (!draft.recovery && !this.badgeDescriptionPending.has(key)) {
				this.scheduleBadgeDescriptionWrite(draft.node, draft.value, draft.guard);
			}
		}
		while (this.badgeDescriptionPending.size > 0) {
			const pending = [...this.badgeDescriptionPending.values()];
			for (const write of pending) {
				this.flushBadgeDescriptionWrite(write.node.workspaceFolder, write.node.relativePath);
			}
			await Promise.all(pending.map(write => write.write).filter((write): write is Promise<void> => !!write));
			if (pending.every(write => this.badgeDescriptionPending.get(this.badgeDescriptionKey(write.node.workspaceFolder, write.node.relativePath)) === write)) {
				break;
			}
		}
	}

	private async vetoShutdownForUnsavedCanvasDrafts(): Promise<boolean> {
		if (!await this.canvasNavigationService.flushActiveEditor()) {
			return true;
		}
		const nodeSurface = this.activeNodeLocalSurface;
		if (nodeSurface?.hasDraftChanges() && !await nodeSurface.closeForShutdown()) {
			return true;
		}
		return this.vetoShutdownForUnsavedBadgeDrafts();
	}

	private async vetoShutdownForUnsavedBadgeDrafts(): Promise<boolean> {
		await this.flushAllBadgeDescriptionWrites();
		const activeRecoveries = [...this.badgeDescriptionDrafts.values()].filter(draft => !!draft.recovery);
		const archivedRecoveries = [...this.badgeDescriptionRecoveryDrafts.values()].flat();
		const recoveries = [...activeRecoveries, ...archivedRecoveries];
		const count = recoveries.length;
		if (count === 0) {
			return false;
		}

		const result = await this.dialogService.prompt<'stay' | 'discard'>({
			type: 'warning',
			message: count === 1 ? 'A Badge draft is not saved' : `${count} Badge drafts are not saved`,
			detail: 'Stay to retry visible drafts or restore missing paths. You can also copy every retained draft with its path. Closing now requires explicitly discarding them.',
			buttons: [
				{ label: 'Stay and review', run: () => 'stay' },
				{
					label: count === 1 ? 'Copy draft' : 'Copy drafts',
					run: async () => {
						await this.copyBadgeDescriptionRecovery(recoveries.map(draft => (
							`# ${draft.node.relativePath}\n\n${draft.value}`
						)).join('\n\n---\n\n'));
						return 'stay' as const;
					}
				},
				{ label: count === 1 ? 'Discard draft and close' : 'Discard drafts and close', run: () => 'discard' }
			],
			cancelButton: true
		});
		if (baseHalfShouldVetoForBadgeDrafts(count, result.result)) {
			return true;
		}

		for (const [key, draft] of this.badgeDescriptionDrafts) {
			if (draft.recovery) {
				this.badgeDescriptionDrafts.delete(key);
				this.badgeDescriptionSaveStates.delete(key);
			}
		}
		for (const key of this.badgeDescriptionRecoveryDrafts.keys()) {
			this.badgeDescriptionSaveStates.delete(key);
		}
		this.badgeDescriptionRecoveryDrafts.clear();
		return false;
	}

	private copyBadgeDescriptionRecovery(value: string): Promise<boolean> {
		return baseHalfCopyRetainedBadgeDraft(
			() => this.clipboardService.writeText(value),
			error => {
				this.logService.error(error instanceof Error ? error : String(error));
				this.queueCanvasWarning(`Could not copy the retained Badge draft. It is still available: ${error instanceof Error ? error.message : String(error)}`);
				this.scheduleBackgroundRender();
			}
		);
	}

	private async repairBadgeRelationshipIssue(
		node: IBaseHalfBadgeNode,
		issue: IBaseHalfCanvasBadgeRelationshipIssue,
		guard: IBaseHalfCanvasMutationGuard,
		relatedStamps: readonly IBaseHalfWorkspaceResourceMutationStamp[]
	): Promise<boolean> {
		if (issue.reason !== 'incomplete' || guard.workspaceKey !== node.workspaceFolder.toString()
			|| (issue.from !== node.relativePath && issue.to !== node.relativePath)) {
			return false;
		}
		this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath);
		return guard.run(async lease => {
			let live: ReadonlyMap<string, IBaseHalfBadgeNode>;
			try {
				live = await this.resolveLiveRelationshipNodes(node.workspaceFolder, issue.from, issue.to);
			} catch (error) {
				throw new Error(`Cannot repair ${issue.from} → ${issue.to} because one of its cards is unavailable. Restore or create both cards, then retry; otherwise Discard this incomplete reference.`, { cause: error });
			}
			return this.badgeGraphService.repairIncompleteReference(live.get(issue.from)!, live.get(issue.to)!, lease);
		}, relatedStamps);
	}

	private async discardBadgeRelationshipIssue(
		node: IBaseHalfBadgeNode,
		issue: IBaseHalfCanvasBadgeRelationshipIssue,
		badges: ReadonlyMap<string, IBaseHalfBadgeFile>,
		guard: IBaseHalfCanvasMutationGuard,
		relatedStamps: readonly IBaseHalfWorkspaceResourceMutationStamp[]
	): Promise<boolean> {
		if (issue.reason !== 'incomplete' || guard.workspaceKey !== node.workspaceFolder.toString()
			|| (issue.from !== node.relativePath && issue.to !== node.relativePath)) {
			return false;
		}
		this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath);
		const canvasFolder = this.getCurrentFolder();
		const source = this.badgeNodeForPath(node.workspaceFolder, issue.from, badges, issue.from === node.relativePath ? node.kind : undefined);
		const target = this.badgeNodeForPath(node.workspaceFolder, issue.to, badges, issue.to === node.relativePath ? node.kind : undefined);
		return guard.run(async lease => {
			const changed = await this.badgeGraphService.discardIncompleteReference(source, target, lease);
			if (changed && canvasFolder?.workspaceFolder.toString() === node.workspaceFolder.toString()) {
				try {
					await this.canvasMirrorService.removeCanvasEdge(canvasFolder, { from: issue.from, to: issue.to }, lease);
				} catch (error) {
					// The graph cleanup already succeeded. A stale anchor row is inert
					// and can be reported without turning Discard into a false failure.
					this.logService.warn(error);
					this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				}
			}
			return changed;
		}, relatedStamps);
	}

	private async resolveLiveRelationshipNodes(
		workspaceFolder: URI,
		from: string,
		to: string
	): Promise<ReadonlyMap<string, IBaseHalfBadgeNode>> {
		const live = new Map<string, IBaseHalfBadgeNode>();
		for (const path of [from, to]) {
			const resource = joinPath(workspaceFolder, ...path.split('/'));
			const stat = await this.fileService.stat(resource);
			if (!stat.isDirectory && !stat.isFile) {
				throw new Error(`Reference endpoint is not a file or folder: ${path}`);
			}
			live.set(path, {
				resource,
				workspaceFolder,
				relativePath: path,
				kind: stat.isDirectory ? 'folder' : 'file'
			});
		}
		return live;
	}

	private badgeNodeForPath(
		workspaceFolder: URI,
		path: string,
		badges: ReadonlyMap<string, IBaseHalfBadgeFile>,
		fallbackKind: IBaseHalfCanvasItem['kind'] = 'file'
	): IBaseHalfBadgeNode {
		return {
			resource: joinPath(workspaceFolder, ...path.split('/')),
			workspaceFolder,
			relativePath: path,
			kind: badges.get(path)?.kind ?? this.renderedItemsByPath.get(path)?.kind ?? fallbackKind
		};
	}

	private async openBadgeMetadata(workspaceFolder: URI, relativePath: string, resource = baseHalfMirrorResource(workspaceFolder, relativePath, 'badge.yaml')): Promise<void> {
		// Opening in the default text editor must honor the same no-symlink
		// boundary as mirror reads/writes; otherwise a planted mirror ancestor
		// could turn this diagnostic escape hatch into an outside-workspace read.
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		await this.editorService.openEditor({
			resource,
			options: { pinned: true, override: DEFAULT_EDITOR_ASSOCIATION.id }
		});
	}

	private async addBadgeReference(
		source: IBaseHalfBadgeNode,
		currentReferences: readonly string[],
		allCandidates: readonly IBaseHalfStampedReferenceCandidate[],
		guard: IBaseHalfCanvasMutationGuard
	): Promise<boolean> {
		if (guard.workspaceKey !== source.workspaceFolder.toString()) {
			return false;
		}
		this.flushBadgeDescriptionWrite(source.workspaceFolder, source.relativePath);
		const existing = new Set(currentReferences);
		// Files AND folders are both first-class reference targets — a folder is
		// a badge too, and pointing at one is often exactly the annotation.
		const candidates = allCandidates.filter(({ candidate }) => candidate.path !== source.relativePath && !existing.has(candidate.path));
		if (candidates.length === 0) {
			await this.quickInputService.pick([{ label: 'Nothing else to reference here.' }], { placeHolder: 'Add a reference' });
			return false;
		}

		type RefPick = IQuickPickItem & IBaseHalfStampedReferenceCandidate;
		const picked = await this.quickInputService.pick<RefPick>(candidates.map(({ candidate, stamp }) => ({
			label: basename(candidate.stat.resource),
			description: candidate.path,
			detail: candidate.badge?.description,
			candidate,
			stamp
		})), {
			placeHolder: `Add a reference from ${source.relativePath || 'the workspace root'}...`,
			matchOnDescription: true,
			matchOnDetail: true
		});
		if (!picked) {
			return false;
		}

		await guard.run(async lease => {
			const live = await this.resolveLiveWorkspaceNodes(source.workspaceFolder, [
				{ path: source.relativePath, kind: source.kind },
				{ path: picked.candidate.path, kind: picked.candidate.kind }
			]);
			await this.badgeGraphService.addReference(live.get(source.relativePath)!, live.get(picked.candidate.path)!, lease);
		}, [picked.stamp]);
		return true;
	}

	private referenceCandidates(item: IBaseHalfCanvasItem): IBaseHalfCanvasItem[] {
		if (item.kind === 'folder') {
			return (item.stat.children ?? [])
				.filter(child => child.isFile || child.isDirectory)
				.map(child => {
					const name = basename(child.resource);
					return {
						path: canvasChildPath(item.path, name),
						name,
						kind: child.isDirectory ? 'folder' : 'file',
						stat: child
					};
				});
		}
		return [...this.renderedItemsByPath.values()];
	}

	private async removeBadgeReference(
		source: IBaseHalfBadgeNode,
		to: string,
		guard: IBaseHalfCanvasMutationGuard,
		targetStamp: IBaseHalfWorkspaceResourceMutationStamp
	): Promise<boolean> {
		if (guard.workspaceKey !== source.workspaceFolder.toString()) {
			return false;
		}
		const canvasFolder = this.getCurrentFolder();
		if (!canvasFolder || canvasFolder.workspaceFolder.toString() !== source.workspaceFolder.toString()) {
			return false;
		}
		this.flushBadgeDescriptionWrite(source.workspaceFolder, source.relativePath);
		const targetResource = joinPath(source.workspaceFolder, ...to.split('/'));
		const targetStat = await this.fileService.stat(targetResource);
		const targetKind: IBaseHalfCanvasItem['kind'] = targetStat.isDirectory ? 'folder' : 'file';
		let nodeUpdate: IBaseHalfCanvasNodeDocumentTransition | undefined;
		if (targetKind === 'file' && to.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			if (this.workingCopyService.isDirty(targetResource) || this.nodeExecutionService.getActiveRun(targetResource)) {
					throw new Error(`Save '${to}' and finish its active attempt before removing this connection.`);
			}
			const content = await this.fileService.readFile(targetResource, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			const document = parseBaseHalfNodeDocumentBytes(content.value.buffer);
			if (document.attempts.some(attempt => attempt.status === 'running')) {
					throw new Error(`Finish '${to}' active attempt before removing this connection.`);
				}
				if (document.recipe?.inputBindings.some(binding => binding.sourcePath === source.relativePath)) {
					if (document.result || document.attempts.length > 0) {
						throw new Error(`'${to}' already has an attempt or sealed Result. Its recipe inputs cannot be disconnected.`);
					}
				const inputBindings = normalizeNodeInputBindings(document.recipe.inputBindings
					.filter(binding => binding.sourcePath !== source.relativePath));
				nodeUpdate = {
					resource: targetResource,
					expected: content.value,
					next: VSBuffer.fromString(serializeBaseHalfNodeDocument({
						...document,
						recipe: { ...document.recipe, inputBindings }
					}))
				};
			}
		}
		let committedTransition: IBaseHalfCanvasConnectionTransition | undefined;
		await guard.run(async lease => {
			const nodes: IBaseHalfCanvasUndoNode[] = [
				{ path: source.relativePath, kind: source.kind },
				{ path: to, kind: targetKind }
			];
			const live = await this.resolveLiveWorkspaceNodes(source.workspaceFolder, nodes);
			const canvasTransitions = baseHalfPersistedCanvasEdgeRemoval(
				(await this.canvasMirrorService.readCanvas(canvasFolder))?.edges ?? [],
				source.relativePath,
				to
			);
			let referenceTransition: Awaited<ReturnType<IBaseHalfBadgeGraphService['removeReferenceWithState']>> | undefined;
			let canvasApplied = false;
			try {
				referenceTransition = await removeCompleteBaseHalfCanvasReference(
					() => this.badgeGraphService.removeReferenceWithState(
						live.get(source.relativePath)!,
						live.get(to)!,
						lease
					),
					transition => this.badgeGraphService.transitionReferenceStates([{
						source: live.get(source.relativePath)!,
						target: live.get(to)!,
						expected: transition.after,
						next: transition.before
					}], lease),
					`The reference ${source.relativePath} → ${to} changed before it could be removed.`,
					!!nodeUpdate
				);
				if (canvasTransitions.length > 0) {
					await this.canvasMirrorService.transitionCanvasState(canvasFolder, { edges: canvasTransitions }, lease);
					canvasApplied = true;
				}
				if (nodeUpdate) {
					await this.fileService.writeFileWithExpectedContents(
						nodeUpdate.resource,
						nodeUpdate.next,
						nodeUpdate.expected,
						{ atomic: { postfix: '.basehalf-node-unbind-tmp' } }
					);
				}
				committedTransition = {
					folder: canvasFolder,
					nodes,
					references: [{
						source: nodes[0],
						target: nodes[1],
						expected: referenceTransition.before,
						next: referenceTransition.after
					}],
					canvas: { edges: canvasTransitions },
					documents: nodeUpdate ? [nodeUpdate] : []
				};
			} catch (error) {
				const rollbackErrors: unknown[] = [];
				if (canvasApplied) {
					try {
						await this.canvasMirrorService.transitionCanvasState(
							canvasFolder,
							reverseCanvasStateTransition({ edges: canvasTransitions }, true),
							lease
						);
					} catch (rollbackError) {
						rollbackErrors.push(rollbackError);
					}
				}
				if (referenceTransition) {
					try {
						await this.badgeGraphService.transitionReferenceStates([{
							source: live.get(source.relativePath)!,
							target: live.get(to)!,
							expected: referenceTransition.after,
							next: referenceTransition.before
						}], lease);
					} catch (rollbackError) {
						rollbackErrors.push(rollbackError);
					}
				}
				if (rollbackErrors.length > 0) {
					throw new AggregateError([error, ...rollbackErrors], 'The connection removal and its safe rollback both failed. Reopen the project before continuing.');
				}
				throw error;
			}
		}, [targetStamp]);
		if (committedTransition && canvasConnectionTransitionChangesAnything(committedTransition)) {
			this.pushCanvasUndoElement(
				localize('basehalf.canvas.badgeDisconnect.undo', "Disconnect canvas nodes"),
				canvasFolder,
				committedTransition.nodes,
				committedTransition.documents,
				(reverse, lease) => this.applyCanvasConnectionTransition(committedTransition!, reverse, lease)
			);
		}
		return true;
	}

	private renderTruncated(heldBack: number): void {
		const truncated = append(this.canvasOverlay, $('.basehalf-canvas-truncated'));
		truncated.textContent = `+${heldBack} more`;
	}

	private renderCanvasWarning(message: string): void {
		const displayMessage = baseHalfCanvasWarningDisplayMessage(message);
		const warnings = [...this.canvasOverlay.querySelectorAll<HTMLElement>('.basehalf-canvas-warning')];
		const duplicate = warnings.some(warning => warning.textContent === displayMessage);
		if (duplicate) {
			return;
		}
		const warning = append(this.canvasOverlay, $('.basehalf-canvas-warning'));
		warning.style.top = `${58 + warnings.length * 30}px`;
		warning.textContent = displayMessage;
	}

	private showCanvasNoteSaveWarning(path: string): void {
		const message = localize(
			'basehalf.canvas.note.saveFailed',
			"Couldn't save {0}. The editor is still open so your text is not lost.",
			path
		);
		const duplicate = [...this.canvasOverlay.querySelectorAll<HTMLElement>('.basehalf-canvas-warning')]
			.some(warning => warning.textContent === message);
		if (!duplicate) {
			this.renderCanvasWarning(message);
		}
	}

	private queueCanvasWarning(message: string): void {
		if (!this.pendingCanvasWarnings.includes(message)) {
			this.pendingCanvasWarnings.push(message);
		}
	}

	private reportCanvasMutationError(error: unknown): void {
		this.logService.error(error instanceof Error ? error : String(error));
		this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
		this.requestRender();
	}

	private renderEmpty(message: string): void {
		const empty = append(this.canvasOverlay, $('.basehalf-canvas-empty'));
		empty.textContent = message;
	}

	private renderCanvasEmptyState(folder: IBaseHalfCanvasFolderState): void {
		const empty = append(this.canvasOverlay, $('.basehalf-canvas-empty-state'));
		const title = append(empty, $('span.basehalf-canvas-empty-title'));
		title.textContent = localize('basehalf.canvas.empty.title', "No content cards yet");
		const actions = append(empty, $('.basehalf-canvas-empty-actions'));
		const note = append(actions, $('button.basehalf-canvas-empty-note')) as HTMLButtonElement;
		note.type = 'button';
		const noteIcon = append(note, $('span.codicon.codicon-new-file'));
		noteIcon.setAttribute('aria-hidden', 'true');
		const noteLabel = append(note, $('span.basehalf-canvas-empty-note-label'));
		noteLabel.textContent = localize('basehalf.canvas.empty.createNote', "Create a note");
		note.title = localize('basehalf.canvas.empty.createNoteTitle', "Create a Markdown note and start writing");
		this.cardListeners.add(this.addDisposableListener(note, 'click', () => void this.canvasEditingService.requestCreate(undefined, 'note').catch(error => this.reportCanvasMutationError(error))));

		const importButton = append(actions, $('button.basehalf-canvas-empty-import')) as HTMLButtonElement;
		importButton.type = 'button';
		const importIcon = append(importButton, $('span.codicon.codicon-folder-opened'));
		importIcon.setAttribute('aria-hidden', 'true');
		const importLabel = append(importButton, $('span'));
		importLabel.textContent = localize('basehalf.canvas.empty.import', "Import files...");
		this.cardListeners.add(this.addDisposableListener(importButton, 'click', () => void (async () => {
			try {
				const current = this.getCurrentFolder();
				if (!current || !this.uriIdentityService.extUri.isEqual(current.resource, folder.resource)) {
					return;
				}
				const context = await this.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
				await this.canvasEditingService.requestImport(context);
			} catch (error) {
				this.reportCanvasMutationError(error);
			}
		})()));
	}

	private async reconcileRetainedDetailIdentity(
		openedDetail: IBaseHalfCardDetailState,
		effect: Exclude<BaseHalfStructuralResourceOutcome, { readonly kind: 'none' }>
	): Promise<void> {
		const resourceKey = openedDetail.resource.toString();
		if (this.canvasNavigationService.state.cardDetail !== openedDetail) {
			return;
		}

		const seq = ++this.detailIdentityReconcileSeq;
		this.detailIdentityPendingResourceKey = resourceKey;
		this.flushBadgeDescriptionWrite(openedDetail.workspaceFolder, openedDetail.relativePath);
		this.detailResourceMutationStamp = undefined;
		this.detailBadgeResourceKey = undefined;
		this.detailBadgeOpen = false;
		this.detailBadgeRefreshAfterFocusLeaves = false;
		this.detailBadgeSeq++;
		this.detailBadgeDisposables.clear();
		clearNode(this.detailBadgeZone);
		this.detailChromeDisposables.clear();
		this.detailTitleDisposables.clear();
		clearNode(this.detailProjectionActions);
		this.disposeDetailSurfaces();
		this.setDetailSaveStatus(undefined);

		if (effect.kind === 'close') {
			await this.closeInvalidatedDetail(seq, resourceKey, openedDetail);
			return;
		}

		const nextResource = effect.kind === 'move' ? effect.resource : openedDetail.resource;
		let stat: IFileStat;
		try {
			stat = await this.fileService.resolve(nextResource);
		} catch {
			await this.closeInvalidatedDetail(seq, resourceKey, openedDetail);
			return;
		}
		if (!this.isPendingDetailIdentity(seq, resourceKey, openedDetail)) {
			return;
		}
		if (!stat.isFile) {
			await this.closeInvalidatedDetail(seq, resourceKey, openedDetail);
			return;
		}

		if (effect.kind === 'move') {
			const result = await this.canvasNavigationService.openCardDetail(nextResource, {
				source: openedDetail.source,
				selection: openedDetail.selection,
				preserveFocus: openedDetail.preserveFocus,
				pinned: openedDetail.pinned,
				projection: openedDetail.projection,
				history: 'replace',
				expectedCardDetail: openedDetail
			});
			if (!result.handled && this.isPendingDetailIdentity(seq, resourceKey, openedDetail)) {
				await this.closeInvalidatedDetail(seq, resourceKey, openedDetail);
			}
			return;
		}

		// No member touching this URI completed. Rebuild only after the URI has
		// been resolved as a file; the old retained model/webview never inherits
		// a freshly captured generation.
		this.detailIdentityPendingResourceKey = undefined;
		this.requestRender();
	}

	private isPendingDetailIdentity(
		seq: number,
		resourceKey: string,
		openedDetail: IBaseHalfCardDetailState
	): boolean {
		return !this.disposed
			&& seq === this.detailIdentityReconcileSeq
			&& this.detailIdentityPendingResourceKey === resourceKey
			&& this.canvasNavigationService.state.cardDetail === openedDetail;
	}

	private async closeInvalidatedDetail(
		seq: number,
		resourceKey: string,
		openedDetail: IBaseHalfCardDetailState
	): Promise<void> {
		if (!this.isPendingDetailIdentity(seq, resourceKey, openedDetail)) {
			return;
		}
		await this.canvasNavigationService.closeCardDetail({ history: 'replace', expectedCardDetail: openedDetail });
	}

	private renderDetail(): void {
		const cardDetail = this.canvasNavigationService.state.cardDetail;
		const chromeHidden = !!cardDetail || !this.getCurrentFolder();
		if (chromeHidden && this.zoomMenuOpen) {
			this.closeCanvasZoomMenu(false);
		}
		this.detail.classList.toggle('visible', !!cardDetail);
		this.createButton.classList.toggle('hidden', chromeHidden);
		this.chrome.classList.toggle('hidden', chromeHidden);
		if (cardDetail) {
			this.fileDragDepth = 0;
			this.root.classList.remove('basehalf-canvas-file-dragging');
		}
		this.syncDetailScrollLock(!!cardDetail);
		if (!cardDetail) {
			this.pendingDetailNameEditResourceKey = undefined;
			this.pendingDetailEditorFocusResourceKey = undefined;
			this.detail.inert = false;
			this.detail.removeAttribute('aria-busy');
			this.detailIdentityReconcileSeq++;
			this.detailIdentityPendingResourceKey = undefined;
			const wasOpen = this.detailSurfaceResourceKey !== undefined;
			this.detailBadgeOpen = false;
			this.detailBadgeRefreshAfterFocusLeaves = false;
			this.detailBadgeResourceKey = undefined;
			this.detailResourceMutationStamp = undefined;
			this.disposeDetailSurfaces();
			this.detailChromeDisposables.clear();
			this.detailTitleDisposables.clear();
			this.detailBadgeSeq++;
			this.detailBadgeDisposables.clear();
			clearNode(this.detailBadgeZone);
			this.setDetailSaveStatus(undefined);
			clearNode(this.detailProjectionActions);
			// Projection surfaces own and remove their hosts on dispose; there is
			// deliberately no document-less rich editor parked in this container.
			clearNode(this.detailTitle);
			this.detailMeta.textContent = '';
			// Re-assert folder focus only on the open→closed TRANSITION. An
			// unconditional write here would race the initial-framing restore:
			// renderDetail runs before the canvas pipeline, so a 0ms write of
			// the not-yet-framed viewport would land in focus.yaml first and
			// the restore would then faithfully restore the unframed state.
				if (wasOpen) {
					// Selected Notes were rendered as static previews underneath the detail
					// surface. Recreate the retained cards once so the static selected Note
					// and its controls are current when detail closes.
				this.renderedCardsByPath = new Map();
				this.scheduleFolderFocusWrite(0);
			}
			return;
		}

		const resourceKey = cardDetail.resource.toString();
		if (this.detailIdentityPendingResourceKey && this.detailIdentityPendingResourceKey !== resourceKey) {
			this.detailIdentityReconcileSeq++;
			this.detailIdentityPendingResourceKey = undefined;
		}
		if (this.detailIdentityPendingResourceKey === resourceKey) {
			return;
		}
		this.syncDetailMutationFence();

		this.renderDetailTitle(cardDetail);
		this.detailMeta.textContent = this.detailSelectionMetaFor(cardDetail.selection);
		this.renderProjectionActions(cardDetail);
		const detailBadgeResourceKey = resourceKey;
		if (this.detailBadgeResourceKey !== detailBadgeResourceKey) {
			// A detail switch owns a new badge focus/defer lifecycle. Retire the
			// previous resource's listeners before its focused prompt can suppress
			// the first render of the new badge.
			this.detailBadgeSeq++;
			this.detailBadgeDisposables.clear();
			this.detailBadgeRefreshAfterFocusLeaves = false;
			clearNode(this.detailBadgeZone);
			this.detailBadgeResourceKey = detailBadgeResourceKey;
			this.detailResourceMutationStamp = this.workspaceMutationCoordinator.captureResource(cardDetail.workspaceFolder, cardDetail.relativePath);
			this.detailBadgeOpen = false;
		}
		void this.renderDetailBadge(cardDetail);

		this.renderDetailSurface(cardDetail);
		this.focusPendingDetailEditor(cardDetail);
	}

	private reconcileCardProjectionRegistrations(): void {
		if (this.disposed) {
			return;
		}
		const cardDetail = this.canvasNavigationService.state.cardDetail;
		if (!cardDetail) {
			this.requestRender();
			return;
		}

		const normalized = this.cardProjectionRegistryService.normalizeProjection(cardDetail.resource, cardDetail.projection);
		const projection = this.cardDetailSurfaceRegistryService.hasProvider(normalized) ? normalized : 'source';
		if (projection === cardDetail.projection) {
			this.requestRender();
			return;
		}

		void this.canvasNavigationService.openCardDetail(cardDetail.resource, {
			source: 'api',
			selection: cardDetail.selection,
			preserveFocus: cardDetail.preserveFocus,
			pinned: cardDetail.pinned,
			projection,
			history: 'replace'
		});
	}

	private renderDetailTitle(cardDetail: IBaseHalfCardDetailState): void {
		this.detailTitleDisposables.clear();
		clearNode(this.detailTitle);
		const resourceKey = cardDetail.resource.toString();
		if (this.pendingDetailNameEditResourceKey !== resourceKey) {
			const button = append(this.detailTitle, $('button.basehalf-card-detail-title-button')) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = basename(cardDetail.resource);
			button.title = localize('basehalf.cardDetail.rename', "Rename...");
			button.setAttribute('aria-label', localize('basehalf.cardDetail.renameFile', "Rename {0}", basename(cardDetail.resource)));
			this.detailTitleDisposables.add(this.addDisposableListener(button, 'click', () => {
				this.pendingDetailNameEditResourceKey = resourceKey;
				this.requestRender();
			}));
			return;
		}

		const initialValue = basename(cardDetail.resource);
		const inputHost = append(this.detailTitle, $('.basehalf-card-detail-title-input'));
		const inputBox = new InputBox(inputHost, this.contextViewService, {
			ariaLabel: localize('basehalf.cardDetail.nameInput', "File name. Press Enter to confirm or Escape to keep the current name."),
			inputBoxStyles: defaultInputBoxStyles
		});
		this.detailTitleDisposables.add(inputBox);
		inputBox.value = initialValue;
		let finishing = false;
		let validationSequence = 0;

		const validate = async (show: boolean): Promise<{ readonly content: string; readonly type: MessageType } | undefined> => {
			const sequence = ++validationSequence;
			const result = await this.validateCanvasEntryName(dirname(cardDetail.resource), inputBox.value, cardDetail.resource);
			if (sequence === validationSequence && this.pendingDetailNameEditResourceKey === resourceKey && show) {
				if (result) {
					inputBox.showMessage({ content: result.content, type: result.type });
				} else {
					inputBox.hideMessage();
				}
			}
			return result;
		};

		const cancel = () => {
			if (this.pendingDetailNameEditResourceKey !== resourceKey) {
				return;
			}
			this.pendingDetailNameEditResourceKey = undefined;
			this.pendingDetailEditorFocusResourceKey = resourceKey;
			this.requestRender();
		};
		const finish = async (keepOpenOnError: boolean) => {
			if (finishing || this.pendingDetailNameEditResourceKey !== resourceKey) {
				return;
			}
			finishing = true;
			inputBox.disable();
			let validation: { readonly content: string; readonly type: MessageType } | undefined;
			try {
				validation = await validate(false);
			} catch (error) {
				validation = { content: error instanceof Error ? error.message : String(error), type: MessageType.ERROR };
			}
			if (this.pendingDetailNameEditResourceKey !== resourceKey) {
				return;
			}
			if (validation?.type === MessageType.ERROR) {
				finishing = false;
				if (!keepOpenOnError) {
					cancel();
					return;
				}
				inputBox.enable();
				inputBox.showMessage({ content: validation.content, type: validation.type }, true);
				inputBox.focus();
				return;
			}

			const name = inputBox.value;
			if (name === initialValue) {
				cancel();
				return;
			}
			const target = joinPath(dirname(cardDetail.resource), name);
			this.pendingDetailNameEditResourceKey = undefined;
			this.pendingDetailEditorFocusResourceKey = target.toString();
			try {
				await this.explorerService.applyBulkEdit([new ResourceFileEdit(cardDetail.resource, target)], {
					undoLabel: localize('basehalf.cardDetail.rename.undo', "Rename {0} to {1}", initialValue, name),
					progressLabel: localize('basehalf.cardDetail.rename.progress', "Renaming {0}", initialValue),
					confirmBeforeUndo: this.confirmExplorerUndo()
				});
			} catch (error) {
				this.pendingDetailEditorFocusResourceKey = undefined;
				this.pendingDetailNameEditResourceKey = resourceKey;
				finishing = false;
				if (inputBox.element.isConnected) {
					inputBox.enable();
					inputBox.showMessage({ content: error instanceof Error ? error.message : String(error), type: MessageType.ERROR }, true);
					inputBox.focus();
				} else {
					this.requestRender();
				}
			}
		};

		this.detailTitleDisposables.add(inputBox.onDidChange(() => void validate(true)));
		this.detailTitleDisposables.add(DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.KEY_DOWN, (event: IKeyboardEvent) => {
			event.stopPropagation();
			const browserEvent = event.browserEvent;
			const action = baseHalfCanvasInlineEditKeyAction({
				key: browserEvent.key === 'Enter' ? 'Enter' : browserEvent.key === 'Escape' || browserEvent.key === 'Esc' ? 'Escape' : '',
				isComposing: browserEvent.isComposing,
				keyCode: browserEvent.keyCode
			});
			if (!action) {
				return;
			}
			event.preventDefault();
			if (action === 'accept') {
				void finish(true);
			} else {
				cancel();
			}
		}));
		this.detailTitleDisposables.add(this.addDisposableListener(inputBox.inputElement, 'blur', () => {
			mainWindow.setTimeout(() => {
				if (inputBox.element.isConnected && !finishing && this.pendingDetailNameEditResourceKey === resourceKey
					&& inputBox.inputElement.ownerDocument.activeElement !== inputBox.inputElement) {
					void finish(false);
				}
			}, 0);
		}));
		mainWindow.setTimeout(() => {
			if (this.pendingDetailNameEditResourceKey !== resourceKey || !inputBox.element.isConnected) {
				return;
			}
			inputBox.focus();
			const extension = extname(cardDetail.resource);
			inputBox.select({ start: 0, end: extension.length > 0 ? initialValue.length - extension.length : initialValue.length });
		}, 0);
	}

	private focusPendingDetailEditor(cardDetail: IBaseHalfCardDetailState): void {
		const resourceKey = cardDetail.resource.toString();
		if (this.pendingDetailEditorFocusResourceKey !== resourceKey) {
			return;
		}
		this.pendingDetailEditorFocusResourceKey = undefined;
		const surface = this.detailSurfaces.get(cardDetail.projection);
		if (!surface) {
			return;
		}
		void surface.whenRendered.then(() => {
			if (this.canvasNavigationService.state.cardDetail?.resource.toString() !== resourceKey) {
				return;
			}
			surface.instance.focus?.();
		});
	}

	private syncDetailMutationFence(): void {
		const detail = this.canvasNavigationService.state.cardDetail;
		const fenced = !!detail && this.workspaceMutationCoordinator.isResourceMutationFenced(detail.workspaceFolder, detail.relativePath);
		this.detail.inert = fenced;
		this.detail.toggleAttribute('aria-busy', fenced);
		for (const surface of this.detailSurfaces.values()) {
			surface.instance.setStructuralFrozen?.(fenced);
		}
		const activeNote = this.activeCanvasNoteEditor;
		if (activeNote) {
			const noteFenced = this.workspaceMutationCoordinator.isResourceMutationFenced(
				activeNote.state.workspaceFolder,
				activeNote.state.relativePath
			);
			activeNote.card.toggleAttribute('aria-busy', noteFenced);
			activeNote.instance.setStructuralFrozen(noteFenced);
		}
	}

	/**
	 * Projection surfaces are retained-mode objects (a webview is an
	 * out-of-process iframe, Monaco a heavyweight widget), so the card detail
	 * keeps one layered surface per projection of the open document instead
	 * of clearing and rebuilding on every switch. Retention is correct by
	 * construction: all projections are views over the same text model, and
	 * each already reconciles external content changes. Switching to a
	 * retained projection is an instant layer swap; a first boot stays
	 * hidden until its open() resolves at the first meaningful frame, then
	 * swaps atomically — the previous projection stays visible throughout.
	 * Surfaces are disposed together when the card closes or the resource
	 * changes.
	 */
	private renderDetailSurface(cardDetail: IBaseHalfCardDetailState): void {
		const resourceKey = cardDetail.resource.toString();
		if (this.detailSurfaceResourceKey !== resourceKey) {
			this.disposeDetailSurfaces();
			this.detailSurfaceResourceKey = resourceKey;
		}

		const projection = cardDetail.projection;
		const existing = this.detailSurfaces.get(projection);
		if (existing) {
			if (this.activeDetailProjection === projection) {
				existing.instance.applySelection(cardDetail.selection);
			} else {
				this.detailSwapSeq++;
				existing.instance.activate(cardDetail);
				this.setActiveDetailSurface(projection);
			}
			return;
		}

		const seq = ++this.detailSwapSeq;
		const surface = this.createDetailSurface(projection, cardDetail);
		this.detailSurfaces.set(projection, surface);
		if (this.activeDetailProjection === undefined) {
			// First surface for this card: there is no previous content to
			// hold on screen, so show the boot immediately — opening responds
			// instantly, and a visible iframe loads at normal priority
			// (hidden ones are deprioritized, which starves a cold boot).
			this.setActiveDetailSurface(projection);
			return;
		}
		// Switching projections: hold the swap until the new surface has its
		// first frame, so the current projection stays visible throughout and
		// nothing half-drawn ever appears.
		void surface.whenRendered.then(() => {
			if (!this.disposed && seq === this.detailSwapSeq && this.detailSurfaces.get(projection) === surface) {
				this.setActiveDetailSurface(projection);
			}
		});
	}

	private createDetailSurface(projection: BaseHalfCardDetailProjection, cardDetail: IBaseHalfCardDetailState): IBaseHalfCardDetailSurface {
		const created = this.cardDetailSurfaceRegistryService.create(projection, this.detailBody, cardDetail);
		const { host, instance } = created;
		const store = new DisposableStore();
		store.add(toDisposable(() => host.remove()));
		store.add(instance);

		const whenRendered = instance.open(cardDetail).catch(error => this.logService.error(error));
		instance.setStructuralFrozen?.(this.workspaceMutationCoordinator.isResourceMutationFenced(cardDetail.workspaceFolder, cardDetail.relativePath));
		return { host, store, instance, whenRendered };
	}

	private registerCardDetailSurfaceProviders(): void {
		this._register(this.cardDetailSurfaceRegistryService.registerProvider('rich', {
			create: (parent, state) => {
				const host = append(parent, $('.basehalf-card-detail-surface'));
				const instance = this.instantiationService.createInstance(
					BaseHalfMarkdownRichCardDetail,
					host,
					() => this.closeDetailBadgePopover(state, false),
					status => this.setDetailSaveStatus(status),
					{}
				);
				for (const command of this.takeMarkdownRichFormatCommands(state.resource)) {
					instance.runEditorCommand(command);
				}
				return {
					host,
					instance
				};
			}
		}));
		this._register(this.cardDetailSurfaceRegistryService.registerProvider('preview', {
			create: parent => {
				const host = append(parent, $('.basehalf-card-detail-surface'));
				return {
					host,
					instance: this.instantiationService.createInstance(
						BaseHalfMarkdownPreviewCardDetail,
						host,
						status => this.setDetailSaveStatus(status)
					)
				};
			}
		}));
		this._register(this.cardDetailSurfaceRegistryService.registerProvider('media', {
			create: parent => {
				const host = append(parent, $('.basehalf-card-detail-surface'));
				this.setDetailSaveStatus('saved');
				return {
					host,
					instance: this.instantiationService.createInstance(
						BaseHalfMediaCardDetail,
						host,
						(resource, selection) => this.createPdfBranch(resource, selection),
						() => this.markCanvasUserInteraction()
					)
				};
			}
		}));
		this._register(this.cardDetailSurfaceRegistryService.registerProvider('source', {
			create: parent => {
				const host = append(parent, $('.basehalf-card-detail-surface'));
				return {
					host,
					instance: this.instantiationService.createInstance(
						BaseHalfSourceCardDetail,
						host,
						status => this.setDetailSaveStatus(status)
					)
				};
			}
		}));
	}

	private setActiveDetailSurface(projection: BaseHalfCardDetailProjection): void {
		this.activeDetailProjection = projection;
		for (const [key, surface] of this.detailSurfaces) {
			const active = key === projection;
			surface.host.classList.toggle('active', active);
			surface.instance.setVisible(active);
		}
	}

	private disposeDetailSurfaces(): void {
		this.detailSwapSeq++;
		this.activeDetailProjection = undefined;
		this.detailSurfaceResourceKey = undefined;
		for (const surface of this.detailSurfaces.values()) {
			surface.store.dispose();
		}
		this.detailSurfaces.clear();
	}

	private setDetailSaveStatus(status: BaseHalfCardDetailSaveStatus | undefined): void {
		if (status === 'error') {
			const label = 'Not saved';
			this.detailSaveStatusIcon.className = 'basehalf-card-detail-save-status-icon codicon codicon-warning';
			this.detailSaveStatusLabel.textContent = label;
			this.detailSaveStatus.setAttribute('data-save-state', 'error');
			this.detailSaveStatus.title = 'Changes could not be saved to disk. Click to retry saving.';
			this.detailSaveStatus.setAttribute('aria-label', this.detailSaveStatus.title);
			this.detailSaveStatus.removeAttribute('aria-hidden');
			return;
		}

		// 'saving'/'saved' intentionally render nothing: auto-save is the
		// product surface, not a status ticker.
		this.detailSaveStatusIcon.className = 'basehalf-card-detail-save-status-icon codicon';
		this.detailSaveStatusLabel.textContent = '';
		this.detailSaveStatus.removeAttribute('data-save-state');
		this.detailSaveStatus.removeAttribute('title');
		this.detailSaveStatus.removeAttribute('aria-label');
		this.detailSaveStatus.setAttribute('aria-hidden', 'true');
	}

	/**
	 * The card detail's Badge zone: the SAME badge that flips on the canvas
	 * card, editable from the detail header while reading the file. This is
	 * where "this file has a human note" stays visible without pushing the
	 * document down, including who points at it.
	 */
	private async renderDetailBadge(
		cardDetail: IBaseHalfCardDetailState,
		openOverride?: boolean,
		focusToggle = false,
		focusEditorControl?: BaseHalfBadgeEditorFocusTarget
	): Promise<void> {
		const seq = ++this.detailBadgeSeq;
		const structuralStamp = this.detailResourceMutationStamp;
		if (!structuralStamp || structuralStamp.relativePath !== cardDetail.relativePath
			|| !this.workspaceMutationCoordinator.isResourceStampCurrent(cardDetail.workspaceFolder, structuralStamp)) {
			return;
		}
		const bodyId = `basehalf-card-detail-badge-popover-${seq}`;
		const node: IBaseHalfBadgeNode = {
			resource: cardDetail.resource,
			workspaceFolder: cardDetail.workspaceFolder,
			relativePath: cardDetail.relativePath,
			kind: 'file'
		};
		let resourceIdentity: string;
		try {
			const stat = await this.fileService.stat(node.resource);
			if (!stat.isFile) {
				return;
			}
			resourceIdentity = baseHalfBadgeResourceIdentity(stat);
		} catch {
			return;
		}

		let badge: IBaseHalfBadgeFile | null;
		let badges: ReadonlyMap<string, IBaseHalfBadgeFile>;
		let problems: ReadonlyMap<string, IBaseHalfBadgeReadProblem>;
		try {
			const badgeRead = await this.badgeGraphService.readBadgeNeighborhood(node);
			badges = badgeRead.badges;
			badge = badges.get(node.relativePath) ?? null;
			problems = new Map(badgeRead.problems.map(problem => [problem.relativePath, problem]));
			for (const problem of badgeRead.problems) {
				this.logService.warn(`BaseHalf badge metadata issue for ${problem.relativePath}: ${problem.message}`);
			}
		} catch (error) {
			this.logService.warn(`BaseHalf card detail badge graph unreadable for ${node.relativePath}`, error);
			// Keep the last rendered Badge intact. A transient provider failure
			// must not turn a known-good graph snapshot into an empty UI.
			if (!this.disposed && seq === this.detailBadgeSeq && !this.detailBadgeZone.hasChildNodes()
				&& this.workspaceMutationCoordinator.isResourceStampCurrent(cardDetail.workspaceFolder, structuralStamp)) {
				this.detailBadgeDisposables.clear();
				this.detailBadgeOpen = false;
				this.detailBadgeZone.classList.remove('open');
				const retry = append(this.detailBadgeZone, $('button.basehalf-card-detail-badge-toggle.issue')) as HTMLButtonElement;
				retry.type = 'button';
				retry.title = 'Badge metadata unavailable - retry';
				retry.setAttribute('aria-label', 'Badge metadata unavailable. Retry');
				retry.setAttribute('aria-expanded', 'false');
				retry.setAttribute('data-testid', 'card-detail-badge-toggle');
				retry.setAttribute('data-badge-unavailable', 'true');
				this.renderGlyph(retry, 'badge', 'var(--vscode-editorWarning-foreground)', 15);
				this.detailBadgeDisposables.add(this.addDisposableListener(retry, 'click', () => void this.renderDetailBadge(cardDetail, false, true)));
			}
			return;
		}
		if (this.disposed || seq !== this.detailBadgeSeq
			|| !this.workspaceMutationCoordinator.isResourceStampCurrent(cardDetail.workspaceFolder, structuralStamp)) {
			return;
		}
		try {
			if (baseHalfBadgeResourceIdentity(await this.fileService.stat(node.resource)) !== resourceIdentity) {
				this.scheduleBackgroundRender();
				return;
			}
		} catch {
			return;
		}
		const badgeForDisplay = this.badgeMetadataWithDraft(cardDetail.workspaceFolder, node.relativePath, badge ?? undefined, resourceIdentity);
		// Never rebuild under the user's cursor during a background refresh. This
		// protects textarea edits AND keyboard navigation among Badge controls.
		// The collapsed toggle is the exception: it has no editable state, so its
		// summary may refresh in place while keyboard focus is restored to the new
		// toggle. Explicit open/close renders pass openOverride and may rebuild.
		const active = this.detailBadgeZone.ownerDocument.activeElement;
		const restoreCollapsedToggleFocus = openOverride === undefined
			&& !this.detailBadgeOpen
			&& isHTMLElement(active)
			&& active.getAttribute('data-testid') === 'card-detail-badge-toggle';
		if (openOverride === undefined && active && this.detailBadgeZone.contains(active) && !restoreCollapsedToggleFocus) {
			this.refreshDetailBadgeAfterFocusLeaves(cardDetail);
			return;
		}
		this.detailBadgeRefreshAfterFocusLeaves = false;

		this.detailBadgeDisposables.clear();
		clearNode(this.detailBadgeZone);
		const open = openOverride ?? this.detailBadgeOpen;
		this.detailBadgeOpen = open;
		this.detailBadgeZone.classList.toggle('open', open);

		const toggle = append(this.detailBadgeZone, $('button.basehalf-card-detail-badge-toggle')) as HTMLButtonElement;
		toggle.type = 'button';
		toggle.title = open ? 'Hide Badge' : 'Show Badge';
		toggle.setAttribute('aria-label', open ? 'Hide Badge' : 'Show Badge');
		toggle.setAttribute('aria-expanded', String(open));
		toggle.setAttribute('aria-haspopup', 'dialog');
		toggle.setAttribute('data-testid', 'card-detail-badge-toggle');
		if (open) {
			toggle.setAttribute('aria-controls', bodyId);
		}
		// The badge glyph is the toolbar action's identity: accent-toned once
		// the file carries a note or references, ghost while empty.
		const relationships = baseHalfCanvasBadgeRelationships(node.relativePath, badgeForDisplay, badges, problems);
		const badgeIssueCount = relationships.issues.length + (problems.has(node.relativePath) ? 1 : 0);
		const hasRelationships = relationships.references.length > 0 || relationships.referencedBy.length > 0;
		const hasContent = !!badgeForDisplay?.description?.trim() || hasRelationships || badgeIssueCount > 0;
		toggle.classList.toggle('issue', badgeIssueCount > 0);
		toggle.setAttribute('data-reference-issue-count', String(badgeIssueCount));
		toggle.title = badgeIssueCount > 0
			? `${badgeIssueCount} reference metadata issue${badgeIssueCount === 1 ? '' : 's'} - ${open ? 'hide' : 'show'} Badge`
			: open ? 'Hide Badge' : 'Show Badge';
		toggle.setAttribute('aria-label', badgeIssueCount > 0
			? `${open ? 'Hide' : 'Show'} Badge, ${badgeIssueCount} reference metadata issue${badgeIssueCount === 1 ? '' : 's'}`
			: open ? 'Hide Badge' : 'Show Badge');
		this.renderGlyph(toggle, 'badge', badgeIssueCount > 0 ? 'var(--vscode-editorWarning-foreground)' : hasContent ? 'var(--vscode-textLink-foreground)' : 'var(--basehalf-detail-badge-ghost)', 15);
		if (badgeIssueCount > 0) {
			const marker = append(toggle, $('.basehalf-reference-issue-marker.detail'));
			marker.setAttribute('data-testid', 'card-detail-reference-issue-marker');
			marker.setAttribute('data-reference-issue-count', String(badgeIssueCount));
			marker.setAttribute('aria-hidden', 'true');
		}
		const title = append(toggle, $('span.basehalf-card-detail-badge-title'));
		title.textContent = 'Badge';
		const chevron = append(toggle, $('span.basehalf-card-detail-badge-chevron.codicon.codicon-chevron-down'));
		chevron.setAttribute('aria-hidden', 'true');
		const summary = append(toggle, $('span.basehalf-card-detail-badge-summary'));
		if (!open) {
			const inboundCount = relationships.referencedBy.length;
			summary.textContent = badgeIssueCount > 0
				? `${badgeIssueCount} reference metadata issue${badgeIssueCount === 1 ? '' : 's'}`
				: badgeForDisplay?.description
				?? (hasRelationships
					? `${relationships.references.length} reference${relationships.references.length === 1 ? '' : 's'}${inboundCount > 0 ? ` · ← ${inboundCount}` : ''}`
					: 'What agents should know about this file');
			summary.classList.toggle('empty', !badgeForDisplay?.description && !hasRelationships && badgeIssueCount === 0);
		}
		this.detailBadgeDisposables.add(this.addDisposableListener(toggle, 'click', () => {
			if (open) {
				this.closeDetailBadgePopover(cardDetail, true);
				return;
			}

			this.detailBadgeOpen = true;
			void this.renderDetailBadge(cardDetail, true, false, 'prompt');
		}));
		if (focusToggle || restoreCollapsedToggleFocus) {
			mainWindow.setTimeout(() => {
				if (!this.disposed && seq === this.detailBadgeSeq && this.detailBadgeZone.contains(toggle)) {
					toggle.focus();
				}
			}, 0);
		}

		if (!open) {
			return;
		}

		const body = append(this.detailBadgeZone, $('.basehalf-card-detail-badge-body'));
		body.id = bodyId;
		body.tabIndex = -1;
		body.setAttribute('role', 'dialog');
		body.setAttribute('aria-label', 'Badge');
		const editorControls = this.renderBadgeEditorContent(
			body,
			node,
			badgeForDisplay,
			badges,
			problems,
			this.resourceMutationGuard(cardDetail.workspaceFolder, structuralStamp, resourceIdentity),
			disposable => this.detailBadgeDisposables.add(disposable),
			() => [...this.renderedItemsByPath.values()],
			focusTarget => {
				const current = this.canvasNavigationService.state.cardDetail;
				if (!current || current.resource.toString() !== cardDetail.resource.toString()) {
					this.requestRender();
					return;
				}
				const open = this.detailBadgeOpen;
				void this.renderDetailBadge(current, open, false, open ? focusTarget : undefined);
			}
		);
		if (focusEditorControl) {
			mainWindow.setTimeout(() => {
				if (this.disposed || seq !== this.detailBadgeSeq) {
					return;
				}
				const target = focusEditorControl === 'prompt'
					? editorControls.prompt
					: focusEditorControl === 'add-reference'
						? editorControls.addReference
						: editorControls.inboundToggle;
				(target ?? toggle).focus();
			}, 0);
		}
		this.detailBadgeDisposables.add(this.addDisposableListener(body.ownerDocument, 'pointerdown', event => {
			const target = event.target;
			if (target instanceof Node && this.detailBadgeZone.contains(target)) {
				return;
			}
			this.closeDetailBadgePopover(cardDetail, false);
		}, true));
		this.detailBadgeDisposables.add(this.addDisposableListener(mainWindow, 'keydown', event => {
			if (event.key !== 'Escape' || event.isComposing) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.closeDetailBadgePopover(cardDetail, true);
		}, true));
	}

	/** A disk refresh never replaces a focused control inside the Badge zone.
	 * Keep one deferred refresh while the user Tabs between its controls, then
	 * apply the latest graph snapshot once focus leaves the zone. If that exit
	 * releases an authored description write, its completion already schedules
	 * the canonical refresh. */
	private refreshDetailBadgeAfterFocusLeaves(cardDetail: IBaseHalfCardDetailState): void {
		if (this.detailBadgeRefreshAfterFocusLeaves) {
			return;
		}
		this.detailBadgeRefreshAfterFocusLeaves = true;
		const listener = this.addDisposableListener(this.detailBadgeZone, 'focusout', () => {
			mainWindow.setTimeout(() => {
				if (!this.detailBadgeRefreshAfterFocusLeaves) {
					return;
				}
				const active = this.detailBadgeZone.ownerDocument.activeElement;
				if (active && this.detailBadgeZone.contains(active)) {
					return;
				}
				listener?.dispose();
				this.detailBadgeRefreshAfterFocusLeaves = false;
				if (this.badgeDescriptionPending.has(this.badgeDescriptionKey(cardDetail.workspaceFolder, cardDetail.relativePath))) {
					return;
				}
				const current = this.canvasNavigationService.state.cardDetail;
				if (!this.disposed && current
					&& current.workspaceFolder.toString() === cardDetail.workspaceFolder.toString()
					&& current.relativePath === cardDetail.relativePath) {
					void this.renderDetailBadge(current);
				}
			}, 0);
		});
		this.detailBadgeDisposables.add(listener);
	}

	private closeDetailBadgePopover(cardDetail: IBaseHalfCardDetailState, restoreFocus: boolean): void {
		if (!this.detailBadgeOpen) {
			return;
		}

		const key = this.badgeDescriptionKey(cardDetail.workspaceFolder, cardDetail.relativePath);
		const draft = this.badgeDescriptionDrafts.get(key);
		const prompt = this.detailBadgeZone.querySelector<HTMLTextAreaElement>('.basehalf-canvas-card-badge-prompt');
		if (draft && prompt) {
			this.scheduleBadgeDescriptionWrite(draft.node, prompt.value, draft.guard);
		}
		this.flushBadgeDescriptionWrite(cardDetail.workspaceFolder, cardDetail.relativePath);
		this.detailBadgeOpen = false;
		this.hideDetailBadgePopoverNow();
		void this.renderDetailBadge(cardDetail, false, restoreFocus);
	}

	private hideDetailBadgePopoverNow(): void {
		this.detailBadgeZone.classList.remove('open');
		this.detailBadgeZone.querySelector('.basehalf-card-detail-badge-body')?.remove();
		const toggle = this.detailBadgeZone.querySelector<HTMLButtonElement>('[data-testid="card-detail-badge-toggle"]');
		if (!toggle) {
			return;
		}

		toggle.title = 'Show Badge';
		toggle.setAttribute('aria-label', 'Show Badge');
		toggle.setAttribute('aria-expanded', 'false');
		toggle.removeAttribute('aria-controls');
	}

	private syncDetailScrollLock(detailVisible: boolean): void {
		this.root.classList.toggle('basehalf-card-detail-open', detailVisible);
	}

	private renderProjectionActions(cardDetail: IBaseHalfCardDetailState): void {
		this.detailChromeDisposables.clear();
		clearNode(this.detailProjectionActions);
		const projections = this.cardProjectionRegistryService.getProjections(cardDetail.resource);
		this.detailProjectionActions.classList.toggle('visible', projections.length > 1);
		if (projections.length <= 1) {
			return;
		}

		for (const projection of projections) {
			this.renderProjectionButton(cardDetail, projection.id, projection.label, projection.icon);
		}
	}

	private renderProjectionButton(cardDetail: IBaseHalfCardDetailState, projection: BaseHalfCardDetailProjection, title: string, icon: string): void {
		const button = append(this.detailProjectionActions, $(`button.basehalf-card-detail-projection.codicon.${icon}`)) as HTMLButtonElement;
		button.type = 'button';
		button.title = title;
		button.setAttribute('aria-label', title);
		button.setAttribute('aria-pressed', String(cardDetail.projection === projection));
		button.classList.toggle('checked', cardDetail.projection === projection);
		this.detailChromeDisposables.add(this.addDisposableListener(button, 'click', () => {
			if (cardDetail.projection === projection) {
				return;
			}

			void this.canvasNavigationService.openCardDetail(cardDetail.resource, {
				source: 'api',
				selection: cardDetail.selection,
				preserveFocus: cardDetail.preserveFocus,
				pinned: cardDetail.pinned,
				projection,
				history: 'replace'
			});
		}));
	}

	private detailSelectionMetaFor(selection: { startLineNumber: number; startColumn: number } | undefined): string {
		if (!selection) {
			return '';
		}

		return `L${selection.startLineNumber}:${selection.startColumn}`;
	}


	private toggleCanvasSnap(): void {
		this.canvasSnapEnabled = !this.canvasSnapEnabled;
		this.canvasScene.setSnapEnabled(this.canvasSnapEnabled);
		this.updateCanvasSnapChrome();
	}

	private updateCanvasSnapChrome(): void {
		const label = localize('basehalf.canvas.snapToCards', "Snap to cards");
		this.snapToggle.title = label;
		this.snapToggle.setAttribute('aria-label', label);
		this.snapToggle.setAttribute('aria-pressed', String(this.canvasSnapEnabled));
		this.snapToggle.classList.toggle('active', this.canvasSnapEnabled);
	}

	private toggleCanvasZoomMenu(): void {
		if (this.zoomMenuOpen) {
			this.closeCanvasZoomMenu(true);
			return;
		}

		this.showCanvasZoomMenu();
	}

	private showCanvasZoomMenu(): void {
		let focusZoomInput = () => { };
		this.zoomMenuOpen = true;
		this.zoomValue.classList.add('open');
		this.zoomValue.setAttribute('aria-expanded', 'true');

		const delegate: IContextViewDelegate = {
			getAnchor: () => this.zoomControls,
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
			anchorPosition: AnchorPosition.ABOVE,
			canRelayout: true,
			focus: () => focusZoomInput(),
			render: contextContainer => {
				const store = new DisposableStore();
				const menu = append(contextContainer, $('.basehalf-canvas-zoom-menu'));
				menu.id = 'basehalf-canvas-zoom-menu';
				menu.setAttribute('role', 'dialog');
				menu.setAttribute('aria-label', localize('basehalf.canvas.zoomOptions', "Canvas zoom options"));
				menu.setAttribute('data-testid', 'canvas-zoom-menu');

				const inputShell = append(menu, $('.basehalf-canvas-zoom-input-shell'));
				const input = append(inputShell, $('input.basehalf-canvas-zoom-input')) as HTMLInputElement;
				input.type = 'text';
				input.inputMode = 'decimal';
				input.autocomplete = 'off';
				input.spellcheck = false;
				input.value = formatBaseHalfCanvasZoomPercent(this.canvasZoom);
				input.setAttribute('aria-label', localize(
					'basehalf.canvas.zoomPercentageInput',
					"Zoom percentage, from {0}% to {1}%",
					Math.round(BASEHALF_CANVAS_MIN_ZOOM * 100),
					Math.round(BASEHALF_CANVAS_MAX_ZOOM * 100)
				));
				input.setAttribute('data-testid', 'canvas-zoom-input');
				const inputSuffix = append(inputShell, $('span.basehalf-canvas-zoom-input-suffix'));
				inputSuffix.textContent = '%';
				inputSuffix.setAttribute('aria-hidden', 'true');

				const actionList = append(menu, $('.basehalf-canvas-zoom-menu-actions'));
				actionList.setAttribute('role', 'menu');
				const actionButtons: HTMLButtonElement[] = [];
				const addAction = (
					label: string,
					shortcut: string | undefined,
					action: () => void,
					options?: { readonly actionId?: string; readonly zoomTarget?: number }
				): HTMLButtonElement => {
					const button = append(actionList, $('button.basehalf-canvas-zoom-menu-action')) as HTMLButtonElement;
					button.type = 'button';
					button.setAttribute('role', 'menuitem');
					button.setAttribute('aria-label', label);
					button.dataset.zoomAction = options?.actionId;
					if (options?.zoomTarget !== undefined) {
						button.dataset.zoomTarget = String(options.zoomTarget);
					}
					const actionLabel = append(button, $('span.basehalf-canvas-zoom-menu-label'));
					actionLabel.textContent = label;
					if (shortcut) {
						const shortcutLabel = append(button, $('span.basehalf-canvas-zoom-menu-shortcut'));
						shortcutLabel.textContent = shortcut;
						shortcutLabel.setAttribute('aria-hidden', 'true');
					}
					store.add(this.addDisposableListener(button, 'click', event => {
						event.preventDefault();
						event.stopPropagation();
						this.closeCanvasZoomMenu(event.detail === 0);
						action();
					}));
					actionButtons.push(button);
					return button;
				};

				const commandKey = isMacintosh ? '⌘' : localize('basehalf.canvas.controlKey', "Ctrl");
				this.zoomMenuInAction = addAction(localize('basehalf.canvas.zoomIn', "Zoom In"), `${commandKey} +`, () => this.zoomBy(1), { actionId: 'in' });
				this.zoomMenuOutAction = addAction(localize('basehalf.canvas.zoomOut', "Zoom Out"), `${commandKey} -`, () => this.zoomBy(-1), { actionId: 'out' });
				addAction(localize('basehalf.canvas.fitToScreen', "Fit to Screen"), undefined, () => this.fitCanvasToScreen(), { actionId: 'fit' });

				const separator = append(actionList, $('.basehalf-canvas-zoom-menu-separator'));
				separator.setAttribute('role', 'separator');

				const presetPercentages = [50, 100, Math.round(BASEHALF_CANVAS_MAX_ZOOM * 100)];
				const presetActions: { readonly button: HTMLButtonElement; readonly zoom: number }[] = [];
				for (const percentage of [...new Set(presetPercentages)]) {
					const zoom = percentage / 100;
					const button = addAction(
						localize('basehalf.canvas.zoomToPercentage', "Zoom to {0}%", percentage),
						percentage === 100 ? `${commandKey} 0` : undefined,
						() => this.setCanvasZoom(zoom),
						{ actionId: percentage === 100 ? 'reset' : `preset-${percentage}`, zoomTarget: zoom }
					);
					presetActions.push({ button, zoom });
				}
				this.zoomMenuPresetActions = presetActions;

				const markInputValid = (): void => {
					input.removeAttribute('aria-invalid');
					inputShell.classList.remove('invalid');
					input.title = '';
				};
				const commitInput = (): void => {
					const zoom = baseHalfCanvasZoomFromPercentInput(input.value);
					if (zoom === undefined) {
						const message = localize(
							'basehalf.canvas.zoomPercentageRange',
							"Enter a value from {0}% to {1}%.",
							Math.round(BASEHALF_CANVAS_MIN_ZOOM * 100),
							Math.round(BASEHALF_CANVAS_MAX_ZOOM * 100)
						);
						input.setAttribute('aria-invalid', 'true');
						inputShell.classList.add('invalid');
						input.title = message;
						input.select();
						return;
					}
					markInputValid();
					this.closeCanvasZoomMenu(true);
					this.setCanvasZoom(zoom);
				};
				store.add(this.addDisposableListener(input, 'input', markInputValid));
				store.add(this.addDisposableListener(menu, 'keydown', event => {
					if (event.key === 'Escape') {
						event.preventDefault();
						event.stopPropagation();
						this.closeCanvasZoomMenu(true);
						return;
					}
					if ((event.metaKey || event.ctrlKey) && !event.altKey
						&& (event.key === '=' || event.key === '+' || event.key === '-' || event.key === '0')) {
						event.preventDefault();
						event.stopPropagation();
						this.closeCanvasZoomMenu(true);
						if (event.key === '0') {
							this.setCanvasZoom(1);
						} else {
							this.zoomBy(event.key === '-' ? -1 : 1);
						}
						return;
					}
					const enabledActionButtons = actionButtons.filter(button => !button.disabled);
					if (isHTMLInputElement(event.target)) {
						if (event.key === 'Enter') {
							event.preventDefault();
							commitInput();
						} else if (event.key === 'ArrowDown' && enabledActionButtons.length > 0) {
							event.preventDefault();
							enabledActionButtons[0].focus();
						} else if (event.key === 'ArrowUp' && enabledActionButtons.length > 0) {
							event.preventDefault();
							enabledActionButtons[enabledActionButtons.length - 1].focus();
						}
						return;
					}
					const target = isHTMLElement(event.target) && event.target.tagName === 'BUTTON'
						? event.target as HTMLButtonElement
						: undefined;
					const index = target ? enabledActionButtons.indexOf(target) : -1;
					if (index < 0) {
						return;
					}
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						const delta = event.key === 'ArrowDown' ? 1 : -1;
						enabledActionButtons[(index + delta + enabledActionButtons.length) % enabledActionButtons.length].focus();
					} else if (event.key === 'Home' || event.key === 'End') {
						event.preventDefault();
						enabledActionButtons[event.key === 'Home' ? 0 : enabledActionButtons.length - 1].focus();
					}
				}));
				store.add(this.addDisposableListener(menu, 'focusout', event => {
					const next = event.relatedTarget;
					if ((isHTMLElement(next) || isSVGElement(next))
						&& (menu.contains(next) || this.zoomValue.contains(next))) {
						return;
					}
					this.closeCanvasZoomMenu(false);
				}));
				store.add(this.addDisposableListener(menu.ownerDocument, 'pointerdown', event => {
					const target = event.target;
					if ((isHTMLElement(target) || isSVGElement(target))
						&& (menu.contains(target) || this.zoomValue.contains(target))) {
						return;
					}
					this.closeCanvasZoomMenu(false);
				}, true));

				this.zoomMenu = menu;
				this.zoomMenuInput = input;
				this.zoomValue.setAttribute('aria-controls', menu.id);
				this.updateCanvasZoomMenuChrome();
				focusZoomInput = () => {
					input.focus({ preventScroll: true });
					input.select();
				};
				store.add(toDisposable(() => {
					focusZoomInput = () => { };
					if (this.zoomMenu === menu) {
						this.zoomMenu = undefined;
						this.zoomMenuInput = undefined;
						this.zoomMenuInAction = undefined;
						this.zoomMenuOutAction = undefined;
						this.zoomMenuPresetActions = [];
					}
				}));
				return store;
			},
			onHide: data => {
				this.zoomMenuOpen = false;
				this.zoomValue.classList.remove('open');
				this.zoomValue.setAttribute('aria-expanded', 'false');
				this.zoomValue.removeAttribute('aria-controls');
				if ((data as { readonly restoreFocus?: boolean } | undefined)?.restoreFocus && this.zoomValue.isConnected) {
					this.zoomValue.focus({ preventScroll: true });
				}
			}
		};

		this.contextViewService.showContextView(delegate);
	}

	private closeCanvasZoomMenu(restoreFocus: boolean): void {
		if (!this.zoomMenuOpen) {
			return;
		}
		this.contextViewService.hideContextView({ restoreFocus });
	}

	private updateCanvasZoomChrome(): void {
		const zoom = normalizeCanvasZoom(this.canvasZoom);
		this.canvasZoom = zoom;
		this.root.style.setProperty('--basehalf-canvas-zoom', String(zoom));
		this.root.dataset.zoom = String(zoom);
		const percentage = Math.round(zoom * 100);
		this.zoomValue.textContent = `${percentage}%`;
		const zoomLabel = localize('basehalf.canvas.zoomMenuAtPercentage', "Zoom options, {0}%", percentage);
		this.zoomValue.title = zoomLabel;
		this.zoomValue.setAttribute('aria-label', zoomLabel);
		this.updateCanvasZoomMenuChrome();
	}

	private updateCanvasZoomMenuChrome(): void {
		if (!this.zoomMenu) {
			return;
		}
		const zoom = normalizeCanvasZoom(this.canvasZoom);
		if (this.zoomMenuOutAction) {
			this.zoomMenuOutAction.disabled = zoom <= BASEHALF_CANVAS_MIN_ZOOM;
		}
		if (this.zoomMenuInAction) {
			this.zoomMenuInAction.disabled = zoom >= BASEHALF_CANVAS_MAX_ZOOM;
		}
		for (const { button, zoom: targetZoom } of this.zoomMenuPresetActions) {
			const current = Math.abs(targetZoom - zoom) < 0.0001;
			button.classList.toggle('current', current);
			if (current) {
				button.setAttribute('aria-current', 'true');
			} else {
				button.removeAttribute('aria-current');
			}
		}
		if (this.zoomMenuInput && this.zoomMenuInput.ownerDocument.activeElement !== this.zoomMenuInput) {
			this.zoomMenuInput.value = formatBaseHalfCanvasZoomPercent(zoom);
		}
	}

	private zoomBy(direction: -1 | 1): void {
		this.setCanvasZoom(this.canvasZoom + direction * BASEHALF_CANVAS_ZOOM_STEP);
	}

	private fitCanvasToScreen(): void {
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		this.folderFocusRestoreGeneration++;
		const sceneKey = this.sceneKey(folder);
		void this.canvasScene.fit(undefined, {
			padding: 0.12,
			maxZoom: 1
		}).then(() => {
			if (this.isCurrentSceneKey(sceneKey)) {
				this.scheduleFolderFocusWrite(0, { folder, viewport: this.canvasScene.getViewport() });
			}
		}).catch(error => this.logService.error(error));
	}

	private onCanvasKeyDown(event: KeyboardEvent): void {
		if (this.canvasNavigationService.state.cardDetail || !(event.metaKey || event.ctrlKey) || event.altKey) {
			return;
		}

		if (event.key === '=' || event.key === '+') {
			event.preventDefault();
			event.stopPropagation();
			this.zoomBy(1);
		} else if (event.key === '-') {
			event.preventDefault();
			event.stopPropagation();
			this.zoomBy(-1);
		} else if (event.key === '0') {
			event.preventDefault();
			event.stopPropagation();
			this.setCanvasZoom(1);
		}
	}


	private setCanvasZoom(value: number): void {
		const nextZoom = normalizeCanvasZoom(value);
		if (nextZoom === this.canvasZoom) {
			return;
		}
		this.folderFocusRestoreGeneration++;
		const folder = this.getCurrentFolder();
		const sceneKey = folder ? this.sceneKey(folder) : undefined;
		this.canvasZoom = nextZoom;
		this.updateCanvasZoomChrome();
		void this.canvasScene.setZoom(nextZoom).then(() => {
			if (folder && sceneKey && this.isCurrentSceneKey(sceneKey)) {
				this.scheduleFolderFocusWrite(0, { folder, viewport: this.canvasScene.getViewport() });
			}
		}).catch(() => {
			if (sceneKey && this.isCurrentSceneKey(sceneKey) && this.canvasZoom === nextZoom) {
				this.canvasZoom = normalizeCanvasZoom(this.canvasScene.getViewport().zoom);
				this.updateCanvasZoomChrome();
			}
		});
	}


	private flushRenderQueuedBehindGesture(): void {
		for (const resolve of this.canvasInteractionEndWaiters) {
			resolve();
		}
		this.canvasInteractionEndWaiters.clear();
		if (this.canvasLayoutReconcileQueuedBehindGesture) {
			this.canvasLayoutReconcileQueuedBehindGesture = false;
			this.scheduleCanvasLayoutReconciliation();
		}
		if (this.renderQueuedBehindGesture) {
			this.renderQueuedBehindGesture = false;
			this.requestRender();
		}
	}

	private waitForCanvasSceneInteractionEnd(): Promise<void> {
		if (!this.canvasScene.isInteracting() || this.disposed) {
			return Promise.resolve();
		}
		return new Promise(resolve => {
			const finish = () => {
				this.canvasInteractionEndWaiters.delete(finish);
				resolve();
			};
			this.canvasInteractionEndWaiters.add(finish);
		});
	}

	private deferRenderForSceneInteraction(): boolean {
		if (!this.canvasScene.isInteracting()) {
			return false;
		}
		this.renderQueuedBehindGesture = true;
		return true;
	}


	private folderFocusViewportCenter(viewport: IBaseHalfCanvasSceneViewport): { x: number; y: number } {
		return {
			x: (this.root.clientWidth / 2 - viewport.x) / viewport.zoom,
			y: (this.root.clientHeight / 2 - viewport.y) / viewport.zoom
		};
	}

	private scheduleFolderFocusWrite(
		delay = 200,
		context?: { readonly folder: IBaseHalfCanvasFolderState; readonly viewport: IBaseHalfCanvasSceneViewport }
	): void {
		const folder = context?.folder ?? this.getCurrentFolder();
		if (!folder) {
			return;
		}
		const viewport = context?.viewport ?? this.canvasScene.getViewport();
		this.pendingFolderFocusWrite = {
			folder,
			sceneKey: this.sceneKey(folder),
			structuralStamp: this.workspaceMutationCoordinator.capture(folder.workspaceFolder),
			fields: {
				viewport_center: mapCanvasPoint(this.folderFocusViewportCenter(viewport), roundCanvasPosition),
				zoom: viewport.zoom
			}
		};
		if (this.folderFocusTimer !== undefined) {
			mainWindow.clearTimeout(this.folderFocusTimer);
		}

		this.folderFocusTimer = mainWindow.setTimeout(() => {
			this.folderFocusTimer = undefined;
			this.flushFolderFocusWrite();
		}, delay);
	}

	private restoreOrWriteFolderFocus(folder: IBaseHalfCanvasFolderState, seq: number): void {
		if (this.canvasNavigationService.state.cardDetail) {
			return;
		}

		const key = `${folder.workspaceFolder.toString()}::${folder.relativePath}`;
		if (this.restoredFolderFocusKey === key) {
			this.scheduleFolderFocusWrite(0);
			return;
		}

		this.restoredFolderFocusKey = key;
		const restoreGeneration = this.folderFocusRestoreGeneration;
		void this.focusMirrorService.readFolderFocus(folder).then(async fields => {
			if (seq !== this.renderSeq || this.canvasNavigationService.state.cardDetail || restoreGeneration !== this.folderFocusRestoreGeneration) {
				return;
			}

			if (!fields) {
				this.frameFreshFolderView(folder, seq);
				return;
			}

			this.canvasZoom = fields.zoom;
			this.updateCanvasZoomChrome();
			await this.canvasScene.setViewportCenter(fields.viewport_center.x, fields.viewport_center.y, fields.zoom);
			if (seq === this.renderSeq && !this.canvasNavigationService.state.cardDetail) {
				this.scheduleFolderFocusWrite(0);
			}
		}).catch(error => {
			this.logService.warn(error);
			if (seq === this.renderSeq && !this.canvasNavigationService.state.cardDetail) {
				this.frameFreshFolderView(folder, seq);
			}
		});
	}

	private frameFreshFolderView(folder: IBaseHalfCanvasFolderState, seq: number): void {
		const maxZoom = Math.min(1, this.defaultCanvasZoom(folder));
		void this.canvasScene.fit(undefined, { maxZoom, padding: 0.12 }).then(() => {
			if (seq !== this.renderSeq || this.canvasNavigationService.state.cardDetail) {
				return;
			}
			this.scheduleFolderFocusWrite(0);
		}).catch(error => this.logService.error(error));
	}

	private defaultCanvasZoom(folder: IBaseHalfCanvasFolderState): number {
		return normalizeBaseHalfCanvasZoom(this.configurationService.getValue(BaseHalfSetting.CanvasDefaultZoom, { resource: folder.resource }));
	}

	private flushFolderFocusWrite(): void {
		const pending = this.pendingFolderFocusWrite;
		this.pendingFolderFocusWrite = undefined;
		if (!pending || this.canvasNavigationService.state.cardDetail || !this.isCurrentSceneKey(pending.sceneKey)) {
			return;
		}

		const key = `${pending.sceneKey}::${pending.structuralStamp.structuralEpoch}::${JSON.stringify(pending.fields)}`;
		if (key === this.lastFolderFocusKey) {
			return;
		}

		void this.workspaceMutationCoordinator.runSceneMutation(
			pending.folder.workspaceFolder,
			pending.structuralStamp,
			async lease => {
				if (!this.isCurrentSceneKey(pending.sceneKey)) {
					return;
				}
				await this.focusMirrorService.writeFolderFocus(pending.folder, pending.fields, lease);
			}
		).then(() => this.lastFolderFocusKey = key).catch(error => this.logService.error(error));
	}
}

registerWorkbenchContribution2(BaseHalfCanvasWorkbenchContribution.ID, BaseHalfCanvasWorkbenchContribution, WorkbenchPhase.AfterRestored);

const BASEHALF_CANVAS_ZOOM_STEP = 0.1;

function reverseCanvasStateTransition(transition: IBaseHalfCanvasStateTransition, reverse: boolean): IBaseHalfCanvasStateTransition {
	if (!reverse) {
		return transition;
	}
	return {
		cards: transition.cards?.map(card => ({ ...card, expected: card.next, next: card.expected })),
		edges: transition.edges?.map(edge => ({ ...edge, expected: edge.next, next: edge.expected }))
	};
}

function reverseReferenceTransitions(
	transitions: readonly IBaseHalfCanvasReferenceTransition[],
	reverse: boolean
): readonly IBaseHalfCanvasReferenceTransition[] {
	return reverse
		? transitions.map(transition => ({ ...transition, expected: transition.next, next: transition.expected }))
		: transitions;
}

function reverseDocumentTransitions(
	transitions: readonly IBaseHalfCanvasNodeDocumentTransition[],
	reverse: boolean
): readonly IBaseHalfCanvasNodeDocumentTransition[] {
	return reverse
		? transitions.map(transition => ({ ...transition, expected: transition.next, next: transition.expected }))
		: transitions;
}

function canvasReconnectStateTransitions(previous: IBaseHalfCanvasEdge, next: IBaseHalfCanvasEdge): readonly IBaseHalfCanvasEdgeStateTransition[] {
	const previousEdge: IBaseHalfCanvasEdge = {
		from: previous.from,
		from_anchor: previous.from_anchor,
		to: previous.to,
		to_anchor: previous.to_anchor
	};
	if (previous.from === next.from && previous.to === next.to) {
		return [{ from: previous.from, to: previous.to, expected: previousEdge, next }];
	}
	return [
		{ from: previous.from, to: previous.to, expected: previousEdge, next: null },
		{ from: next.from, to: next.to, expected: null, next }
	];
}

function canvasStateTransitionChangesAnything(transition: IBaseHalfCanvasStateTransition): boolean {
	return (transition.cards ?? []).some(card => !canvasCardsEqual(card.expected, card.next))
		|| (transition.edges ?? []).some(edge => !canvasEdgesEqual(edge.expected, edge.next));
}

function canvasConnectionTransitionChangesAnything(transition: IBaseHalfCanvasConnectionTransition): boolean {
	return transition.documents.some(document => !document.expected.equals(document.next))
		|| transition.references.some(reference => !referenceStatesEqual(reference.expected, reference.next))
		|| canvasStateTransitionChangesAnything(transition.canvas);
}

function canvasCardsEqual(left: IBaseHalfCanvasCardStateTransition['expected'], right: IBaseHalfCanvasCardStateTransition['next']): boolean {
	return left === right || !!left && !!right
		&& left.path === right.path
		&& left.kind === right.kind
		&& left.x === right.x
		&& left.y === right.y
		&& left.width === right.width
		&& left.height === right.height;
}

function canvasEdgesEqual(left: IBaseHalfCanvasEdgeStateTransition['expected'], right: IBaseHalfCanvasEdgeStateTransition['next']): boolean {
	return left === right || !!left && !!right
		&& left.from === right.from
		&& left.from_anchor === right.from_anchor
		&& left.to === right.to
		&& left.to_anchor === right.to_anchor;
}

function connectionTargetSnapshotsEqual(
	left: IBaseHalfCanvasConnectionTargetSnapshot,
	right: IBaseHalfCanvasConnectionTargetSnapshot
): boolean {
	if (left.path !== right.path || left.kind !== right.kind
		|| left.directSourcePaths.length !== right.directSourcePaths.length
		|| left.directSourcePaths.some((path, index) => path !== right.directSourcePaths[index])
		|| left.inputKinds.size !== right.inputKinds.size
		|| [...left.inputKinds].some(([path, kind]) => right.inputKinds.get(path) !== kind)) {
		return false;
	}
	if (!left.node || !right.node) {
		return left.node === right.node;
	}
	return left.node.resource.toString() === right.node.resource.toString()
		&& left.node.contents.equals(right.node.contents)
		&& left.node.recipe === right.node.recipe;
}

function referenceStatesEqual(left: IBaseHalfReferenceState, right: IBaseHalfReferenceState): boolean {
	return left.forward === right.forward && left.backlink === right.backlink;
}

function uniqueCanvasUndoNodes(nodes: readonly IBaseHalfCanvasUndoNode[]): readonly IBaseHalfCanvasUndoNode[] {
	const result = new Map<string, IBaseHalfCanvasUndoNode>();
	for (const node of nodes) {
		const existing = result.get(node.path);
		if (existing && existing.kind !== node.kind) {
			throw new Error(`Canvas node kind changed while preparing undo: ${node.path}`);
		}
		result.set(node.path, node);
	}
	return [...result.values()];
}

function uniqueUris(resources: readonly URI[]): readonly URI[] {
	return [...new Map(resources.map(resource => [resource.toString(), resource])).values()];
}

function roundCanvasPosition(value: number): number {
	return Number(value.toFixed(2));
}

function oppositeCanvasAnchor(anchor: IBaseHalfCanvasEdge['from_anchor']): IBaseHalfCanvasEdge['to_anchor'] {
	switch (anchor) {
		case 'north': return 'south';
		case 'east': return 'west';
		case 'south': return 'north';
		case 'west': return 'east';
	}
}

function normalizeCanvasZoom(value: number): number {
	return Number(normalizeBaseHalfCanvasZoom(value).toFixed(4));
}

export function baseHalfCanvasZoomFromPercentInput(value: string): number | undefined {
	const match = /^(\d+(?:\.\d+)?)\s*%?$/.exec(value.trim());
	if (!match) {
		return undefined;
	}
	const zoom = Number(match[1]) / 100;
	if (!Number.isFinite(zoom) || zoom < BASEHALF_CANVAS_MIN_ZOOM || zoom > BASEHALF_CANVAS_MAX_ZOOM) {
		return undefined;
	}
	return normalizeCanvasZoom(zoom);
}

export function formatBaseHalfCanvasZoomPercent(zoom: number): string {
	return String(Number((normalizeCanvasZoom(zoom) * 100).toFixed(2)));
}

function mapCanvasPoint(point: { readonly x: number; readonly y: number }, map: (value: number) => number): { readonly x: number; readonly y: number } {
	return {
		x: map(point.x),
		y: map(point.y)
	};
}

function isBaseHalfFocusMirrorResource(resource: URI): boolean {
	const name = basename(resource);
	if (name !== 'focus.yaml' && name !== 'current_focus.yaml') {
		return false;
	}

	return resource.path.includes('/.bh/');
}

function mediaPreview(name: string): { readonly kind: 'image' | 'video' | 'audio' | 'pdf'; readonly label: string } | undefined {
	const lower = name.toLowerCase();
	if (/\.(png|jpg|jpeg|gif|webp|svg|avif)$/.test(lower)) {
		return { kind: 'image', label: 'Image file' };
	}
	if (/\.pdf$/.test(lower)) {
		return { kind: 'pdf', label: 'PDF document' };
	}
	if (/\.(mp4|mov|webm|mkv)$/.test(lower)) {
		return { kind: 'video', label: 'Video file' };
	}
	if (/\.(mp3|wav|m4a|flac|ogg)$/.test(lower)) {
		return { kind: 'audio', label: 'Audio file' };
	}
	return undefined;
}

function mediaPreviewFromArtifact(kind: BaseHalfNodeArtifactKind, label: string): { readonly kind: 'image' | 'video' | 'audio' | 'pdf'; readonly label: string } | undefined {
	if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
		return { kind, label };
	}
	return undefined;
}

function markdownPreviewKind(name: string): 'markdown' | 'text' | 'code' {
	if (/\.(md|markdown|mdx)$/i.test(name)) {
		return 'markdown';
	}
	return badgeType(name, false) === 'code' ? 'code' : 'text';
}

function cleanCardPreviewText(name: string, raw: string): string {
	let text = raw.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
	if (/\.mdx?$/i.test(name)) {
		text = text
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/^\s{0,3}#{1,6}\s+/gm, '')
			.replace(/^\s{0,3}>\s?/gm, '')
			.replace(/[*_`~]/g, '')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
	}

	const lines = text
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean)
		.slice(0, 8);
	const preview = lines.join('\n');
	return preview.length > 520 ? `${preview.slice(0, 517)}...` : preview;
}

function baseHalfReferenceLabel(relativePath: string): string {
	const trimmed = relativePath.replace(/\/+$/, '');
	if (!trimmed) {
		return 'Workspace root';
	}

	const slash = trimmed.lastIndexOf('/');
	return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function edgeId(from: string, to: string): string {
	return `${from}\u0000${to}`;
}

function cardDisplayName(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined): string {
	return preview?.kind === 'node' ? preview.document.title : item.name;
}

function baseHalfNodeIdentityProblem(title: string, role: string): string | undefined {
	if (!title.trim()) {
		return 'Enter a title for this node.';
	}
	if (title.length > 240 || title.includes('\u0000')) {
		return 'The node title is invalid.';
	}
	if (!role.trim()) {
		return 'Describe this node\'s role.';
	}
	if (role.length > 120 || role.includes('\u0000')) {
		return 'The node role is invalid.';
	}
	return undefined;
}

function nodeKindLabel(kind: IBaseHalfNodeDocument['kind']): string {
	return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

function nodeAttemptStatusLabel(status: IBaseHalfNodeDocument['attempts'][number]['status']): string {
	switch (status) {
		case 'running': return 'Running';
		case 'succeeded': return 'Succeeded';
		case 'failed': return 'Failed';
		case 'cancelled': return 'Cancelled';
		case 'interrupted': return 'Interrupted';
	}
}

function formatNodeAttemptTime(value: string): string {
	const time = Date.parse(value);
	if (Number.isNaN(time)) {
		return value;
	}
	return nodeAttemptDateFormatter.value.format(time);
}

function nodeResultLabel(document: IBaseHalfNodeDocument, outputText?: string): string {
	const text = outputText?.trim().replace(/\s+/g, ' ');
	if (text) {
		return text.length > 240 ? `${text.slice(0, 237)}...` : text;
	}
	const artifact = getBaseHalfNodeResultArtifact(document);
	if (artifact) {
		return baseHalfReferenceLabel(artifact.path);
	}
	return document.attempts.length > 0 ? 'No Result' : 'Empty Draft';
}

function nodePreviewResultLabel(preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>): string {
	return preview.verificationPending && !!preview.document.result
		? 'Checking Result…'
		: nodeResultLabel(preview.document, preview.resultOutputText);
}

function nodeResultTitle(document: IBaseHalfNodeDocument, outputText?: string): string {
	if (outputText?.trim()) {
		const text = outputText.trim();
		return text.length > 1024 ? `${text.slice(0, 1021)}...` : text;
	}
	return getBaseHalfNodeResultArtifact(document)?.path ?? (document.attempts.length > 0 ? 'No Result was produced' : 'Empty Draft');
}

function normalizeNodeInputBindings(bindings: readonly IBaseHalfNodeInputBinding[]): readonly IBaseHalfNodeInputBinding[] {
	return bindings
		.slice()
		.sort((left, right) => left.order - right.order || left.sourcePath.localeCompare(right.sourcePath) || left.slot.localeCompare(right.slot))
		.map((binding, order) => ({ ...binding, order }));
}

function nodeLocalStateForCardPreview(preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>) {
	return getBaseHalfNodeLocalState(preview.document, {
		recipe: preview.recipe,
		...(preview.videoConfiguration ? { videoConfiguration: preview.videoConfiguration } : {}),
		modelServices: preview.modelServices,
		execution: preview.execution,
		resultIntegrity: preview.resultIntegrity,
		dirty: preview.dirty,
		graphProblem: preview.graphProblem,
		directSourcePaths: preview.directSourcePaths,
		directSourceProblems: preview.directSourceProblems,
		verificationPending: preview.verificationPending,
		inputKinds: preview.inputKinds,
		matchingRecipeCount: preview.matchingRecipeCount
	});
}

function canvasChildPath(parent: string, name: string): string {
	return parent ? `${parent}/${name}` : name;
}

function baseHalfBadgeResourceIdentity(stat: Pick<IFileStat, 'ctime' | 'isFile' | 'isDirectory' | 'isSymbolicLink'>): string {
	const kind = stat.isFile ? 'file' : stat.isDirectory ? 'folder' : 'other';
	// Local providers expose creation time, which stays stable across ordinary
	// writes but changes when a path is deleted and recreated. Providers that
	// report zero fall back to the structural path epoch carried separately.
	const creation = typeof stat.ctime === 'number' && stat.ctime > 0 ? stat.ctime : 'unavailable';
	return `${kind}:${stat.isSymbolicLink ? 'link' : 'direct'}:${creation}`;
}

function badgeType(label: string, isFolder: boolean): BaseHalfCanvasGlyphType {
	if (isFolder) {
		return 'folder';
	}
	const lower = label.toLowerCase();
	const dot = lower.lastIndexOf('.');
	const ext = dot === -1 || dot === lower.length - 1 ? '' : lower.slice(dot + 1);
	const base = dot === -1 ? lower : lower.slice(0, dot);
	if (['md', 'markdown', 'mdx', 'txt', 'rst', 'org', 'gitignore', 'dockerignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc', 'csv', 'tsv', 'log', 'text'].includes(ext) || ['readme', 'license', 'changelog', 'authors', 'notice', 'copying'].includes(base)) {
		return 'text';
	}
	if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif', 'ico', 'tiff'].includes(ext)) {
		return 'image';
	}
	if (['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'opus'].includes(ext)) {
		return 'audio';
	}
	if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'].includes(ext)) {
		return 'video';
	}
	if (ext === 'pdf') {
		return 'pdf';
	}
	if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'rb', 'c', 'cpp', 'h', 'cs', 'php', 'swift', 'kt', 'json', 'yaml', 'yml', 'toml', 'css', 'scss', 'html', 'xml', 'sh', 'sql', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'ini', 'conf', 'cfg', 'env', 'properties', 'lock', 'lua', 'pl', 'r', 'gradle', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'proto'].includes(ext) || ['dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile', 'jenkinsfile', 'vagrantfile'].includes(base)) {
		return 'code';
	}
	return 'generic';
}

function glyphTone(type: BaseHalfCanvasGlyphType, orphan: boolean): string {
	if (orphan) {
		return 'var(--bh-card-danger)';
	}
	if (type === 'folder') {
		return 'var(--bh-card-folder-glyph)';
	}
	return 'var(--bh-card-text-tertiary)';
}

function renderGlyphPath(svg: SVGElement, type: BaseHalfCanvasGlyphType): void {
	const appendPath = (d: string) => {
		const path = $.SVG('path');
		path.setAttribute('d', d);
		svg.appendChild(path);
	};
	if (type === 'text') {
		appendPath('M3.5 4h9M3.5 7h9M3.5 10h9M3.5 13h5.5');
		return;
	}
	if (type === 'image') {
		const rect = $.SVG('rect');
		rect.setAttribute('x', '2.5');
		rect.setAttribute('y', '3');
		rect.setAttribute('width', '11');
		rect.setAttribute('height', '10');
		rect.setAttribute('rx', '1.6');
		svg.appendChild(rect);
		const circle = $.SVG('circle');
		circle.setAttribute('cx', '5.8');
		circle.setAttribute('cy', '6.3');
		circle.setAttribute('r', '1.1');
		svg.appendChild(circle);
		appendPath('M3 12l3-3 2.3 2.3L11 8l2.2 2.2');
		return;
	}
	if (type === 'audio') {
		appendPath('M4 7v2M6.5 4.8v6.4M9 3.2v9.6M11.5 5.6v4.8');
		return;
	}
	if (type === 'video') {
		const rect = $.SVG('rect');
		rect.setAttribute('x', '2.5');
		rect.setAttribute('y', '3.5');
		rect.setAttribute('width', '11');
		rect.setAttribute('height', '9');
		rect.setAttribute('rx', '1.6');
		svg.appendChild(rect);
		const path = $.SVG('path');
		path.setAttribute('d', 'M6.8 6.3l3 1.7-3 1.7z');
		path.setAttribute('fill', 'currentColor');
		path.setAttribute('stroke', 'none');
		svg.appendChild(path);
		return;
	}
	if (type === 'pdf' || type === 'presentation' || type === 'file' || type === 'generic') {
		appendPath('M4 2.5h4.5l3 3V13H4z');
		appendPath('M8.5 2.5v3h3');
		if (type === 'pdf' || type === 'presentation') {
			appendPath('M5.8 9h4M5.8 11h4');
		}
		return;
	}
	if (type === 'code') {
		appendPath('M6 5L3 8l3 3M10 5l3 3-3 3');
		return;
	}
	if (type === 'badge') {
		appendPath('M6 2.5h4M7 2.5v2M9 2.5v2');
		const rect = $.SVG('rect');
		rect.setAttribute('x', '3.5');
		rect.setAttribute('y', '4.4');
		rect.setAttribute('width', '9');
		rect.setAttribute('height', '9');
		rect.setAttribute('rx', '1.5');
		svg.appendChild(rect);
		const circle = $.SVG('circle');
		circle.setAttribute('cx', '6.4');
		circle.setAttribute('cy', '8');
		circle.setAttribute('r', '1');
		svg.appendChild(circle);
		appendPath('M8.6 7.4h2.2M8.6 9.5h2.5M5.4 11.7h5.2');
		return;
	}
	appendPath('M2.5 4.7a1 1 0 0 1 1-1h2.7a1 1 0 0 1 .72.3l.86.9a1 1 0 0 0 .72.3h4a1 1 0 0 1 1 1v5.3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z');
}
