/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasWorkbench.css';

import * as DOM from '../../../../base/browser/dom.js';
import { $, append, clearNode, isHTMLElement, isSVGElement } from '../../../../base/browser/dom.js';
import { InputBox, MessageType } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { IKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { DeferredPromise, RunOnceScheduler } from '../../../../base/common/async.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { stableStringify } from '../../../../base/common/objects.js';
import { IAction, Separator, toAction } from '../../../../base/common/actions.js';
import { basename, dirname, extname, isEqualOrParent, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileAccess } from '../../../../base/common/network.js';
import { ResourceFileEdit } from '../../../../editor/browser/services/bulkEditService.js';
import { RedoCommand, UndoCommand } from '../../../../editor/browser/editorExtensions.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IDialogService, IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { getPathForFile } from '../../../../platform/dnd/browser/dnd.js';
import { FileChangesEvent, FileOperationResult, FileSystemProviderCapabilities, IFileService, IFileStat, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IUndoRedoService, UndoRedoElementType } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IExplorerService } from '../../../contrib/files/browser/files.js';
import { clearExplorerFileClipboardCut, explorerFileClipboardShouldMove, findValidPasteFileTargetForResource, incrementFileName } from '../../../contrib/files/browser/fileActions.js';
import { IFilesConfiguration, UndoConfirmLevel } from '../../../contrib/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorsOrder, SideBySideEditor } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { mainWindow } from '../../../../base/browser/window.js';
import {
	baseHalfCanvasItemBounds,
	baseHalfCanvasItemsSharePreviewVersion,
	baseHalfCanvasModelFromStat,
	baseHalfCanvasOpenPosition,
	BASEHALF_CANVAS_GRID_COLUMN_GAP,
	baseHalfCanvasTransferPlaces,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH,
	IBaseHalfCanvasBadgeMetadata,
	IBaseHalfCanvasBounds,
	IBaseHalfCanvasCard,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasFile,
	IBaseHalfCanvasItem,
	IBaseHalfCanvasItemRelationships,
	isBaseHalfCanvasEntry
} from '../common/basehalfCanvasModel.js';
import { IBaseHalfBadgeFile, IBaseHalfBadgeMirrorService, IBaseHalfBadgeNode, IBaseHalfBadgeReadProblem } from '../../references/common/basehalfBadgeMirror.js';
import { BaseHalfCanvasChosenPlaces } from '../common/basehalfCanvasChosenPlaces.js';
import { baseHalfCanvasConnectionSummary, baseHalfCanvasDeleteImpact, baseHalfCanvasResolveSiblingUpstream, IBaseHalfCanvasDeleteImpactStore } from '../../references/common/basehalfCanvasUpstream.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { IBaseHalfReferenceEditResult, IBaseHalfReferenceEditService, IBaseHalfReferenceStoreEdit } from '../../references/common/basehalfReferenceEdit.js';
import { baseHalfNormalizeUpstreamEntry, baseHalfUpstreamIdentity, IBaseHalfUpstreamIdentity } from '../../references/common/basehalfReferenceEntries.js';
import { BaseHalfReferenceIndexState, IBaseHalfIndexedDownstream, IBaseHalfReferenceIndexService, IBaseHalfUpstreamView } from '../../references/common/basehalfReferenceIndex.js';
import { baseHalfUpstreamStoreKind, planBaseHalfMarkdownUpstreamEdit } from '../../references/common/basehalfReferenceStore.js';
import { BaseHalfBadgeConnectionsFocusTarget, BaseHalfUpstreamActions, IBaseHalfUpstreamActionContext, IBaseHalfUpstreamActionNode } from '../../references/browser/basehalfUpstreamActions.js';
import { IBaseHalfCanvasAppearanceService } from '../common/basehalfCanvasAppearance.js';
import { BaseHalfCanvasCardListenerStores } from '../common/basehalfCanvasCardListeners.js';
import {
	IBaseHalfCanvasCardStateTransition,
	IBaseHalfCanvasDamage,
	IBaseHalfCanvasEdgeStateTransition,
	IBaseHalfCanvasMirrorService,
	IBaseHalfCanvasStateTransition
} from '../common/basehalfCanvasMirror.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfIsMirrorSubtree, baseHalfMirrorResource, baseHalfMirrorRoot, baseHalfRemapSubtreeRel } from '../../workspace/common/basehalfMirrorTree.js';
import { IBaseHalfMovedItemsService } from '../../workspace/common/basehalfMovedItemsService.js';
import { IBaseHalfActiveCanvasEditor, IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService, IBaseHalfCanvasNavigationState, IBaseHalfCardDetailState, IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
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
	baseHalfCanvasMarkdownSourceFitsShown,
	BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES
} from '../common/basehalfCanvasPreview.js';
import { BaseHalfCanvasViewportPersister, BaseHalfCanvasViewportSource, baseHalfOpenCanvasViewport, IBaseHalfCanvasViewport, IBaseHalfCanvasViewportStateService } from '../common/basehalfCanvasViewportState.js';
import { BaseHalfCardDetailProjection, IBaseHalfCardProjectionRegistryService, baseHalfItemDisplayName, baseHalfNoteFileName, baseHalfNoteNameExtension, isBaseHalfMarkdownResource } from '../../cardDetail/common/basehalfCardDetail.js';
import { BaseHalfItemKindIcon, baseHalfItemIcon, IBaseHalfAgentSelectionCaption, IBaseHalfAgentSelectionService, IBaseHalfAgentSelectionText } from '../../agentArea/common/basehalfAgentSelection.js';
import { BaseHalfItemGlyph, renderBaseHalfItemGlyph } from '../../shell/browser/basehalfItemGlyph.js';
import { IBaseHalfPdfSelection } from '../../cardDetail/common/basehalfMediaViewState.js';
import { baseHalfPdfBranchBaseName, baseHalfPdfBranchMarkdown } from '../../cardDetail/common/basehalfPdfBranch.js';
import { baseHalfUserFacingErrorMessage } from '../../shell/common/basehalfPlainFailureReason.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	BaseHalfNodeDocumentError,
	BaseHalfNodeKind,
	createBaseHalfNodeDocument,
	getBaseHalfNodeResultArtifact,
	IBaseHalfNodeDocument,
	importBaseHalfNodeResult,
	parseBaseHalfNodeDocumentBytes,
	serializeBaseHalfNodeDocument
} from '../../video/common/basehalfNodeDocument.js';
import { baseHalfCanvasContentKindForPath, baseHalfNodeAcceptsContentKind } from '../common/basehalfCanvasContentKind.js';
import { baseHalfVideoNodePhase, IBaseHalfNodeArtifact, IBaseHalfVideoGeneration } from '../../video/common/basehalfVideoNode.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { BaseHalfVideoNodePanel, IBaseHalfVideoNodePanelHost } from '../../video/browser/basehalfVideoNodePanel.js';
import { IBaseHalfVideoCard, IBaseHalfVideoCardInput, renderBaseHalfVideoCard } from '../../video/browser/basehalfVideoCard.js';
import { captureBaseHalfVideoFrame, createBaseHalfVideoFrameReader } from '../../video/browser/basehalfVideoFrameCapture.js';
import { baseHalfVideoCardToolbarActions } from '../../video/common/basehalfVideoCardPresentation.js';
import { IBaseHalfVideoCatalogService, IBaseHalfVideoGenerationService, IBaseHalfVideoProviderSettingsService } from '../../video/common/basehalfVideoGeneration.js';
import { baseHalfVideoInitialGeneration } from '../../video/common/basehalfVideoCatalog.js';
import { BaseHalfCanvasCardPresentation } from '../common/basehalfCanvasCardPresentation.js';
import { BaseHalfCanvasPreviewHydrationQueue, BaseHalfCanvasPreviewVerificationQueue, IBaseHalfCanvasPreviewHydrationBatch } from '../common/basehalfCanvasPreviewHydration.js';
import { splitBaseHalfMarkdownFrontmatter } from '../../markdown/common/basehalfMarkdownProjection.js';
import { applyBaseHalfCanvasMarkdownSidewaysScroll, BaseHalfCanvasMarkdownInlineEditor, BaseHalfCanvasMarkdownRequiresRichEditorError, IBaseHalfCanvasMarkdownInlineSelection, readBaseHalfCanvasMarkdownSidewaysScroll } from './basehalfCanvasMarkdownInlineEditor.js';
import { buildAllBaseHalfCanvasNoteParts, buildBaseHalfCanvasNotePartsTo, renderBaseHalfCanvasNoteInParts } from './basehalfCanvasNoteParts.js';
import { BaseHalfMarkdownPreviewCardDetail } from '../../cardDetail/browser/basehalfMarkdownPreviewCardDetail.js';
import { BaseHalfMarkdownRichCardDetail } from '../../cardDetail/browser/basehalfMarkdownRichCardDetail.js';
import { BaseHalfSourceCardDetail } from '../../cardDetail/browser/basehalfSourceCardDetail.js';
import { IBaseHalfCardDetailSurfaceInstance, IBaseHalfCardDetailSurfaceRegistryService } from '../../cardDetail/browser/basehalfCardDetailSurface.js';
import { BaseHalfMediaCardDetail, rememberBaseHalfVideoDetailNode } from '../../cardDetail/browser/basehalfMediaCardDetail.js';
import { BaseHalfCanvasReactScene } from './basehalfCanvasReactScene.js';
import { releaseBaseHalfCanvasCardMedia } from './basehalfCanvasCardMedia.js';
import {
	BaseHalfCanvasInteractionRenderGate,
	baseHalfBadgeDraftFailureDisposition,
	baseHalfCopyRetainedBadgeDraft,
	baseHalfDiscardRetainedBadgeDraft,
	baseHalfResourceMutationStampsEqual,
	baseHalfShouldVetoForBadgeDrafts,
	baseHalfTransitionBadgeDraftIdentity
} from './basehalfCanvasConnectionTransaction.js';
import { BaseHalfSetting, normalizeBaseHalfCanvasZoom } from '../../shell/common/basehalfConfiguration.js';
import { BASEHALF_AUTO_SAVE_DELAY_MS } from '../../shell/common/basehalfWorkbenchProfile.js';
import { baseHalfActiveEditorFlushOptions, BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from '../../navigation/common/basehalfEditorFlush.js';
import {
	BaseHalfCanvasSceneContextMenuRequest,
	BaseHalfCanvasSceneSelectionAction,
	BaseHalfCanvasSceneCardControls,
	BaseHalfCanvasSceneVideoAction,
	BaseHalfCanvasSceneVideoFrame,
	BaseHalfCanvasNoteBackground,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT,
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
	BaseHalfCanvasSceneGeometryReason,
	IBaseHalfCanvasSceneGeometry,
	IBaseHalfCanvasSceneReconnect,
	IBaseHalfCanvasSceneViewport,
	baseHalfCanvasConnectionTargetOrigin,
	baseHalfCanvasOppositeAnchor
} from '../common/basehalfCanvasScene.js';
import type { BaseHalfMarkdownFormatCommand } from '../../markdown/common/basehalfMarkdownFormatting.js';
import { BASEHALF_CANVAS_CARD_CONTEXT_MENU, BASEHALF_CANVAS_OPEN_RESULT_NODE_COMMAND_ID, BASEHALF_CANVAS_PANE_CONTEXT_MENU } from './basehalfCanvasContextMenu.js';
import { BaseHalfCanvasCardPreview, baseHalfCanvasCardPreviewCanRetainElement, BaseHalfCanvasNodePreview, IBaseHalfCanvasMediaPreview } from '../common/basehalfCanvasCardPreview.js';
import { BaseHalfCanvasExtensionsRegistry, IBaseHalfCanvasMovedCard, IBaseHalfCanvasView, IBaseHalfCanvasViewScene } from './basehalfCanvasExtensions.js';
import { IBaseHalfCanvasResourceDeletionService } from './basehalfCanvasResourceDeletion.js';
import {
	BaseHalfStructuralResourceOutcome,
	baseHalfStructuralResourceOutcome,
	IBaseHalfWorkspaceMutationCoordinator,
	IBaseHalfWorkspaceMutationLease,
	IBaseHalfWorkspaceMutationStamp,
	IBaseHalfWorkspaceResourceMutationStamp
} from '../../workspace/common/basehalfWorkspaceMutation.js';

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

/** The panel under the selected Video card (D58) and what it lives on. */
interface IBaseHalfVideoPanelMount {
	readonly sceneKey: string;
	readonly path: string;
	readonly panel: BaseHalfVideoNodePanel;
	readonly store: DisposableStore;
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

/**
 * The one-line canvas notice for saved layout BaseHalf could not use (mirror
 * file resilience, "What the user sees"). The affected cards are placed as
 * cards that were never positioned, and every interaction keeps working.
 */
export function baseHalfCanvasLayoutNotice(damage: IBaseHalfCanvasDamage): string {
	return damage.kind === 'partial'
		? localize('basehalf.canvas.layout.partial', "Some saved card positions could not be read")
		: localize('basehalf.canvas.layout.unreadable', "This canvas's saved layout could not be read");
}

export function baseHalfCanvasPendingSelectionIsReady(
	paths: readonly string[],
	availablePaths: ReadonlySet<string>
): boolean {
	return paths.length > 0 && paths.every(path => availablePaths.has(path));
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
type BaseHalfCanvasGlyphType = BaseHalfItemGlyph;
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

type BaseHalfBadgeEditorFocusTarget = 'prompt' | BaseHalfBadgeConnectionsFocusTarget;
type BaseHalfCanvasBadgeFocusTarget = BaseHalfBadgeEditorFocusTarget | 'toggle';
interface IBaseHalfBadgeEditorControls {
	readonly prompt?: HTMLTextAreaElement;
	readonly addUpstream?: HTMLButtonElement;
	readonly addDownstream?: HTMLButtonElement;
}
/** A node's connections as the badge editor shows them (D37). */
interface IBaseHalfBadgeEditorConnections {
	/** The node's own Upstream list, or `undefined` when it could not be read. */
	readonly upstream: IBaseHalfUpstreamView | undefined;
	readonly downstream: readonly IBaseHalfIndexedDownstream[];
	readonly indexState: BaseHalfReferenceIndexState | undefined;
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

interface IBaseHalfCanvasNodeDocumentTransition {
	readonly resource: URI;
	readonly expected: VSBuffer;
	readonly next: VSBuffer;
}

/**
 * A canvas change that undo replays by exact states: card and anchor rows of
 * `canvas.yaml` and whole `.bhnode` documents (whose `upstream` list travels
 * inside the document bytes). Reference operations on other
 * stores use the reference edit service's own undo element instead.
 */
interface IBaseHalfCanvasConnectionTransition {
	readonly folder: IBaseHalfCanvasFolderState;
	readonly nodes: readonly IBaseHalfCanvasUndoNode[];
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

type BaseHalfCanvasInlineEdit =
	| {
		readonly kind: 'rename';
		readonly context: IBaseHalfCanvasActionContext;
		readonly resource: URI;
		readonly parent: URI;
		readonly path: string;
		/**
		 * The extension that the file of a note keeps. The editor then holds the
		 * name without it. Empty for an item that is renamed by its file name.
		 */
		readonly extension: string;
		readonly initialValue: string;
		value: string;
		selectionPending: boolean;
		/** Why the name could not be applied, until an editor has shown it. */
		failure?: string;
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
		/** Why the name could not be applied, until an editor has shown it. */
		failure?: string;
	};

/** An excerpt shows the first lines of a file, so only its head is read, whatever its size. */
const CARD_EXCERPT_READ_BYTES = 8192;
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
/** A node file is read to learn its kind before its card gets a place. A larger file keeps the default size. */
const BASEHALF_CANVAS_NEW_NODE_READ_LIMIT = 1024 * 1024;
const BASEHALF_CANVAS_NEW_NODE_KINDS_KEPT = 2000;

/**
 * The longest the canvas waits with a redraw for items that are being
 * recognized at a new path. A safeguard: the wait ends when their card
 * information has followed. It is also the latest that a comparison starts
 * after the first file event (following moved items, "What the user sees").
 */
const BASEHALF_CANVAS_MOVED_ITEMS_HOLD_MS = 10_000;
/** How long a place the user gave a card waits for the move of that card's item before it is saved. */
const BASEHALF_CANVAS_MOVED_ITEMS_EDIT_HOLD_MS = 2000;
/** After that limit, how long the canvas remembers that it already waited for a move that has not settled. */
const BASEHALF_CANVAS_MOVED_ITEMS_FORGET_MS = 120_000;
/** How long its first drawing waits for the comparison at open. */
const BASEHALF_CANVAS_MOVED_ITEMS_OPEN_HOLD_MS = 500;
/** How long a later redraw waits for the comparison at open: no change is on its way, the folder is only being read. */
const BASEHALF_CANVAS_MOVED_ITEMS_OPENING_HOLD_MS = 2000;

class BaseHalfCanvasWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.canvasWorkbench';

	private readonly root: HTMLElement;
	private readonly createButton: HTMLButtonElement;
	private readonly chrome: HTMLElement;
	private readonly viewControls: HTMLElement;
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
	private readonly cardListenerStores = this._register(new BaseHalfCanvasCardListenerStores());
	private readonly inlineEditListeners = this._register(new DisposableStore());
	/**
	 * The rename editor of a card. It lives as long as its edit: a card that
	 * shows it is kept across renders, and a card that is built anew takes it
	 * over when the scene mounts it. The input so keeps the keyboard, its caret,
	 * and a composition while other things on the canvas change.
	 */
	private inlineRenameEditor: {
		readonly edit: BaseHalfCanvasInlineEdit;
		readonly host: HTMLElement;
		readonly store: DisposableStore;
		readonly focus: () => void;
	} | undefined;
	private readonly detailChromeDisposables = this._register(new DisposableStore());
	private readonly detailTitleDisposables = this._register(new DisposableStore());
	private readonly canvasUndoRedoSource = BASEHALF_CANVAS_UNDO_REDO_SOURCE;

	private renderSeq = 0;
	/** Renders started by `requestRender` that have not resolved yet. */
	private rendersInFlight = 0;
	private backgroundRenderTimer: number | undefined;
	/** When the canvas first held a redraw for an item that is being recognized at a new path. */
	private movedItemsHoldStarted: number | undefined;
	/** The folder the hold was started for. */
	private movedItemsHoldFolder: string | undefined;
	private movedItemsHoldWaiting = false;
	/** The first drawing waits for the comparison at open for a shorter time. */
	private firstRenderHeld = false;
	/** A drawing for what the user did was asked for, and no drawing has been shown since. */
	private userRenderOwed = false;
	private readonly badgeDescriptionTimers = new Map<string, number>();
	private readonly badgeDescriptionDrafts = new Map<string, IBaseHalfBadgeDescriptionDraft>();
	private readonly badgeDescriptionRecoveryDrafts = new Map<string, IBaseHalfBadgeDescriptionDraft[]>();
	private readonly badgeDescriptionPending = new Map<string, IBaseHalfBadgeDescriptionPending>();
	private readonly badgeDescriptionSaveStates = new Map<string, BaseHalfBadgeDescriptionSaveState>();
	private readonly badgeInteractionRenderGate = new BaseHalfCanvasInteractionRenderGate();
	private badgeInteractionReleaseTimer: number | undefined;
	private readonly pendingCanvasWarnings: string[] = [];
	/** The canvas layout damage last written to the log, so a re-render does not repeat it. */
	private loggedCanvasDamage: string | undefined;
	/** Badge descriptions (and orphan flags) by path, from the last render. */
	private renderedBadges: ReadonlyMap<string, IBaseHalfBadgeFile> = new Map();
	private renderedBadgeProblems: ReadonlyMap<string, IBaseHalfBadgeReadProblem> = new Map();
	/** Connections of the rendered cards, from the reference index. */
	private renderedRelationships: ReadonlyMap<string, IBaseHalfCanvasItemRelationships> = new Map();
	/** Upstream lists of the rendered cards that have one (open badge faces read theirs from disk). */
	private renderedUpstreamViews: ReadonlyMap<string, IBaseHalfUpstreamView> = new Map();
	private renderedIndexState: BaseHalfReferenceIndexState | undefined;
	private readonly upstreamActions: BaseHalfUpstreamActions;
	private readonly detailBadgeDisposables: DisposableStore;
	private detailBadgeSeq = 0;
	private detailBadgeOpen = false;
	private detailBadgeRefreshAfterFocusLeaves = false;
	private detailBadgeResourceKey: string | undefined;
	private detailResourceMutationStamp: IBaseHalfWorkspaceResourceMutationStamp | undefined;
	private readonly openBadgeFaces = new Set<string>();
	private readonly canvasBadgeFocusRefresh: MutableDisposable<IDisposable>;
	private canvasBadgeRefreshAfterFocusLeaves = false;
	private pendingCanvasBadgeFocus: { readonly path: string; readonly target: BaseHalfCanvasBadgeFocusTarget } | undefined;
	private renderedItemsByPath = new Map<string, IBaseHalfCanvasItem>();
	private renderedCardPreviewsByPath = new Map<string, IBaseHalfCanvasCardPreviewCacheEntry>();
	private renderedCardsByPath = new Map<string, IBaseHalfCanvasCardRenderCacheEntry>();
	private renderedCardElementsByPath = new Map<string, HTMLElement>();
	private renderedSceneCards: readonly IBaseHalfCanvasSceneCard[] = [];
	private renderedSceneEdges: readonly IBaseHalfCanvasSceneEdge[] = [];
	private readonly cardPresentationUpdaters = new WeakMap<HTMLElement, (presentation: IBaseHalfCanvasSceneCardPresentation) => void>();
	private readonly cardPreviewHydrationQueue = new BaseHalfCanvasPreviewHydrationQueue();
	private cardPreviewHydrationTimer: number | undefined;
	private cardPreviewHydrationRunning = false;
	private readonly cardPreviewVerificationQueue = new BaseHalfCanvasPreviewVerificationQueue();
	private renderedSceneStructuralEpoch = 0;
	private readonly detailSurfaces = new Map<BaseHalfCardDetailProjection, IBaseHalfCardDetailSurface>();
	private detailSurfaceResourceKey: string | undefined;
	private activeDetailProjection: BaseHalfCardDetailProjection | undefined;
	private detailSwapSeq = 0;
	private detailIdentityReconcileSeq = 0;
	private detailIdentityPendingResourceKey: string | undefined;
	private readonly viewportPersister: BaseHalfCanvasViewportPersister;
	private restoredViewportSceneKey: string | undefined;
	/** Bumped by every user viewport change; invalidates stale async restores and fits. */
	private viewportRestoreGeneration = 0;
	/** Scene whose restore or automatic fit is driving the viewport: its scene
	 *  reports are not user changes and are persisted explicitly (or not at all). */
	private programmaticViewportSceneKey: string | undefined;
	/** The last automatic first fit that no user change has replaced yet. */
	private autoFramedViewport: { readonly sceneKey: string; readonly generation: number } | undefined;
	private canvasZoom = 1;
	/** The zoom the features of the canvas were last told about. */
	private reportedCanvasZoom: number | undefined;
	private readonly onDidChangeZoomEmitter = this._register(new Emitter<number>());
	private readonly onDidHideViewControlsEmitter = this._register(new Emitter<void>());
	private readonly onDidChangeSceneEmitter = this._register(new Emitter<IBaseHalfCanvasViewScene>());
	private readonly onKeyDownEmitter = this._register(new Emitter<KeyboardEvent>());
	private renderQueuedBehindGesture = false;
	private chosenCanvasPlacesInstance: BaseHalfCanvasChosenPlaces | undefined;
	/** The places BaseHalf chose for cards that appeared, until the layout holds them (canvas card placement). */
	private get chosenCanvasPlaces(): BaseHalfCanvasChosenPlaces {
		return this.chosenCanvasPlacesInstance ??= new BaseHalfCanvasChosenPlaces(this.fileService, this.canvasMirrorService, this.movedItemsService, this.logService);
	}
	/** Whether a node file is a video node, by resource, for the version of the file that was read. */
	private readonly newNodeKinds = new Map<string, { readonly version: string; readonly video: boolean }>();
	/** The rows of the layout that the shown canvas was last drawn from. A row takes its place also when its item is gone. */
	private renderedLayoutRows: readonly IBaseHalfCanvasCard[] = [];
	private canvasLayoutReconcileQueuedBehindGesture = false;
	private canvasLayoutReconcileGeneration = 0;
	private readonly canvasInteractionEndWaiters = new Set<() => void>();
	private inlineEdit: BaseHalfCanvasInlineEdit | undefined;
	private canvasInteractionEpoch = 0;
	private canvasNavigationEpoch = 0;
	private pendingCanvasSelection: IBaseHalfPendingCanvasSelection | undefined;
	/** The panel under the selected Video card. */
	private videoPanel: IBaseHalfVideoPanelMount | undefined;
	/** A Video node just created: its panel takes the focus when it first shows. */
	private videoPanelFocusPath: string | undefined;
	/** A Video node that Generate made beside a node with a video: its card is selected once it is drawn. */
	private pendingVideoNodeSelection: { readonly sceneKey: string; readonly path: string } | undefined;
	/** The drawn Video cards, for the time their players show. */
	private readonly videoCards = new Map<string, IBaseHalfVideoCard>();
	/** The Video card drawn in each card element. */
	private readonly videoCardBodies = new WeakMap<HTMLElement, IBaseHalfVideoCard>();
	/** Shows a newer state of its Video node in a card element, which is kept. */
	private readonly videoCardRetainers = new WeakMap<HTMLElement, (item: IBaseHalfCanvasItem, preview: BaseHalfCanvasNodePreview) => void>();
	/** Counts selections, so a panel that waits for a drag to end shows only for the latest one. */
	private videoPanelSelectionToken = 0;
	/** A single selected card whose preview is still loading: its panel shows once it is known to be a Video node. */
	private videoPanelWanted: { readonly sceneKey: string; readonly path: string; readonly token: number } | undefined;
	/** Pick on Canvas of the Video panel while it waits for a click. */
	private videoInputPick: { readonly store: DisposableStore; finish(path: string | undefined): void } | undefined;
	private pendingCanvasFit: IBaseHalfPendingCanvasFit | undefined;
	/** Cards the user just created that are shown to them once they are drawn (canvas card placement). */
	private pendingCanvasReveal: { readonly sceneKey: string; readonly paths: readonly string[]; readonly owner: IBaseHalfCanvasPostCreateOwner } | undefined;
	private pendingDetailNameEditResourceKey: string | undefined;
	private pendingDetailEditorFocusResourceKey: string | undefined;
	private fileDragDepth = 0;
	private lastCanvasContextMenu: {
		readonly context: IBaseHalfCanvasActionContext;
		readonly request: BaseHalfCanvasSceneContextMenuRequest;
		readonly createPosition?: { readonly x: number; readonly y: number };
		/** The create position is one BaseHalf worked out, not a point the user named with the pointer. */
		readonly createPositionComputed?: boolean;
	} | undefined;
	private activeCanvasNoteEditor: IBaseHalfActiveCanvasNoteEditor | undefined;
	private canvasNoteSurfacePath: string | undefined;
	/** The selected cards the scene reported last, and its scene (the selection agents can see). */
	private agentSelectionCards: { readonly sceneKey: string; readonly paths: readonly string[] } = { sceneKey: '', paths: [] };
	/** Text selected in the note being edited on its card. */
	private agentSelectionCardText: IBaseHalfAgentSelectionText | undefined;
	/** Text selected in each projection of Card Detail; the one shown counts. */
	private readonly agentSelectionDetailText = new Map<BaseHalfCardDetailProjection, IBaseHalfAgentSelectionText>();
	/** The note editor reports every change of its selection; its text is read once they settle. */
	private readonly agentSelectionCardTextReader = this._register(new RunOnceScheduler(() => {
		this.agentSelectionCardText = this.activeCanvasNoteEditor?.instance.getSelectedText();
		this.reportAgentSelection();
	}, 30));
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
	/** Bumped when a pending card open is cancelled: a late open that follows a selection that moved on does nothing. */
	private cardOpenIntent = 0;
	private disposed = false;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBaseHalfBadgeMirrorService private readonly badgeMirrorService: IBaseHalfBadgeMirrorService,
		@IBaseHalfReferenceIndexService private readonly referenceIndexService: IBaseHalfReferenceIndexService,
		@IBaseHalfReferenceEditService private readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfCanvasAppearanceService private readonly canvasAppearanceService: IBaseHalfCanvasAppearanceService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IBaseHalfCanvasViewportStateService private readonly viewportStateService: IBaseHalfCanvasViewportStateService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IConfigurationService private readonly configurationService: IConfigurationService,
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
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IBaseHalfCardProjectionRegistryService private readonly cardProjectionRegistryService: IBaseHalfCardProjectionRegistryService,
		@IBaseHalfCardDetailSurfaceRegistryService private readonly cardDetailSurfaceRegistryService: IBaseHalfCardDetailSurfaceRegistryService,
		@IBaseHalfCanvasResourceDeletionService private readonly canvasResourceDeletionService: IBaseHalfCanvasResourceDeletionService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IBaseHalfMovedItemsService private readonly movedItemsService: IBaseHalfMovedItemsService,
		@IBaseHalfAgentSelectionService private readonly agentSelectionService: IBaseHalfAgentSelectionService,
		@IHoverService private readonly hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@IBaseHalfVideoGenerationService private readonly videoGenerationService: IBaseHalfVideoGenerationService,
		@IBaseHalfVideoProviderSettingsService private readonly videoProviderSettings: IBaseHalfVideoProviderSettingsService,
		@IBaseHalfVideoCatalogService private readonly videoCatalogService: IBaseHalfVideoCatalogService
	) {
		super();
		// An item that was moved outside BaseHalf: the open canvas and the open
		// Card Detail follow it (following moved items, "What the user sees").
		this._register(this.movedItemsService.onDidRelocate(event => {
			for (const move of event.moves) {
				void this.followMovedItem(event.workspaceFolder, move.from, move.to).catch(error => this.logService.error(error));
			}
		}));
		// Flushes a pending settled viewport on dispose and when storage saves
		// state, so the last gesture before closing is not lost.
		this.viewportPersister = this._register(this.instantiationService.createInstance(BaseHalfCanvasViewportPersister));
		this.upstreamActions = this._register(this.instantiationService.createInstance(BaseHalfUpstreamActions));
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
		this._register(lifecycleService.onWillShutdown(event => event.join(
			this.videoPanel?.panel.flush() ?? Promise.resolve(),
			{ id: 'join.basehalfVideoPrompt', label: localize('join.basehalfVideoPrompt', "Saving the prompt of a Video node") }
		)));
		this._register(toDisposable(() => {
			this.cancelVideoInputPick();
			this.videoPanel?.store.dispose();
			this.videoPanel = undefined;
		}));

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
		this.viewControls = DOM.append(this.chrome, DOM.$('.basehalf-canvas-zoom-controls'));
		this.viewControls.setAttribute('role', 'group');
		this.viewControls.setAttribute('aria-label', localize('basehalf.canvas.viewControls', "Canvas view controls"));
		this._register(toDisposable(() => this.inlineRenameEditor?.store.dispose()));
		this.surface = DOM.append(this.root, DOM.$('.basehalf-canvas-surface'));
		this.cards = DOM.append(this.surface, DOM.$('.basehalf-canvas-cards'));
		this.inlineEditLayer = DOM.append(this.surface, DOM.$('.basehalf-canvas-inline-edit-layer'));
		this.canvasOverlay = DOM.append(this.surface, DOM.$('.basehalf-canvas-overlay'));
		this.canvasScene = this._register(new BaseHalfCanvasReactScene(this.cards, {
			commitGeometry: (sceneKey, structuralEpoch, geometries, reason) => this.commitSceneGeometry(sceneKey, structuralEpoch, geometries, reason),
			connect: (sceneKey, structuralEpoch, connection) => this.connectSceneEdge(sceneKey, structuralEpoch, connection),
			showConnectionCreateMenu: (sceneKey, structuralEpoch, drop) => this.showConnectionCreateMenu(sceneKey, structuralEpoch, drop),
			reconnect: (sceneKey, structuralEpoch, intent) => this.reconnectSceneEdge(sceneKey, structuralEpoch, intent),
			removeEdge: (sceneKey, structuralEpoch, edge) => this.removeEdgeFromScene(sceneKey, structuralEpoch, edge),
			performSelectionAction: (sceneKey, structuralEpoch, action, paths) => this.performSceneSelectionAction(sceneKey, structuralEpoch, action, paths),
			cancelPendingCardOpen: () => this.cancelPendingNodeActivation(),
			prepareSelectionChange: (sceneKey, structuralEpoch, paths) => this.prepareSceneSelectionChange(sceneKey, structuralEpoch, paths),
			didChangeSelection: (sceneKey, _structuralEpoch, paths) => {
				this.agentSelectionCards = { sceneKey, paths };
				this.reportAgentSelection();
			},
			focusNoteEditor: (sceneKey, structuralEpoch, path) => this.focusSceneNoteEditor(sceneKey, structuralEpoch, path),
			editNote: (sceneKey, structuralEpoch, path, point) => this.beginSceneNoteEdit(sceneKey, structuralEpoch, path, point),
			rememberNoteEditPoint: (sceneKey, structuralEpoch, path, point) => this.rememberSceneNoteEditPoint(sceneKey, structuralEpoch, path, point),
			formatNote: (sceneKey, structuralEpoch, path, command) => this.formatSceneNote(sceneKey, structuralEpoch, path, command),
			copyNote: (sceneKey, structuralEpoch, path) => this.copySceneNote(sceneKey, structuralEpoch, path),
			setNoteBackground: (sceneKey, structuralEpoch, path, background) => this.setSceneNoteBackground(sceneKey, structuralEpoch, path, background),
			openCard: (sceneKey, structuralEpoch, path) => this.openSceneCard(sceneKey, structuralEpoch, path),
			invokeVideoAction: (sceneKey, structuralEpoch, path, action, anchor, frame) => this.invokeSceneVideoAction(sceneKey, structuralEpoch, path, action, anchor, frame),
			showCreateMenu: (sceneKey, structuralEpoch, position) => this.showSceneContextMenu(
				sceneKey,
				structuralEpoch,
				{ kind: 'pane', anchor: position },
				position
			),
			showContextMenu: (sceneKey, structuralEpoch, request) => this.showSceneContextMenu(sceneKey, structuralEpoch, request),
			reportViewport: (sceneKey, viewport, final) => this.onSceneViewport(sceneKey, viewport, final),
			// The resting projection of a Note holds the whole note.
			cardScrollableContent: card => this.canvasNotePreviewMounts.get(card)?.fallback,
			didStartViewportInteraction: () => {
				this.viewportRestoreGeneration++;
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
		// No layout control here: the sidebar belongs to the window, and its
		// control is in the title bar (docs/specs/layout-controls.md).
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
			this.reportAgentSelection();
		}));
		this._register(this.cardProjectionRegistryService.onDidChangeProjections(() => this.reconcileCardProjectionRegistrations()));
		this._register(this.cardDetailSurfaceRegistryService.onDidChangeProviders(() => this.reconcileCardProjectionRegistrations()));
		this._register(this.canvasEditingService.registerHandler(request => this.beginCanvasInlineEdit(request)));
		this._register(this.fileService.onDidFilesChange(event => {
			const folder = this.getCurrentFolder();
			if (!folder || this.isWorkingFilesOnlyChange(event, folder)) {
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
			if (affectsVisibleSurface) {
				if (this.isCurrentCanvasLayoutOnlyChange(event, folder)) {
					this.scheduleCanvasLayoutReconciliation();
				} else {
					this.scheduleBackgroundRender();
				}
			}
		}));
		// Connections live in the downstream nodes' own stores anywhere in the
		// workspace folder (D37), so any store change of the folder can change
		// this canvas's edges, counts, or the open badge editor.
		this._register(this.referenceIndexService.onDidChange(event => {
			const folder = this.getCurrentFolder();
			if (folder && this.uriIdentityService.extUri.isEqual(event.workspaceFolder, folder.workspaceFolder)) {
				this.scheduleBackgroundRender();
			}
		}));
		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => {
			const folder = this.getCurrentFolder();
			if (folder && isEqualOrParent(workingCopy.resource, folder.workspaceFolder)) {
				this.scheduleBackgroundRender();
			}
		}));
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.reconcileActiveEditor()));
		this._register(this.editorService.onDidActiveEditorChange(() => this.reconcileActiveEditor()));
		this._register(this.addDisposableListener(this.root, 'keydown', event => {
			if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229) {
				void this.canvasNavigationService.closeCardDetail();
				return;
			}
			this.onKeyDownEmitter.fire(event);
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
		this._register(this.viewportStateService.onDidImport(folders => this.onDidImportViewports(folders)));
		this._register(toDisposable(() => {
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
		this.updateCanvasZoomChrome();
		this.createContributions();
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
			// The folder whose canvas is open was moved: the canvas shows it at its new path.
			const openFolder = this.canvasNavigationService.state.canvasFolder;
			const folderEffect = openFolder && !detail ? baseHalfStructuralResourceOutcome(outcome, openFolder.workspaceFolder, openFolder.relativePath, openFolder.resource) : undefined;
			if (openFolder && folderEffect?.kind === 'move') {
				outcome.waitUntil(this.followOpenFolder(openFolder, folderEffect.resource));
			}
			if (outcome.workspaces.some(workspace => this.getCurrentFolder()?.workspaceFolder.toString() === workspace.toString())) {
				this.requestRender();
			}
			void detailReconciliation?.catch(error => this.logService.error(error));
		}));
		this._register(this.workspaceMutationCoordinator.onDidChangeResourceMutationFence(() => this.syncDetailMutationFence()));
		// The first drawing waits a moment for the comparison at open.
		if (!this.holdRenderForMovedItems()) {
			this.requestRender();
		}
	}

	/**
	 * Creates the registered features of the canvas (docs/harness/code-organization.md),
	 * in the order of their registration, as VS Code's terminal creates its
	 * contributions. One that fails is left out and logged; the canvas and the
	 * other features work on.
	 */
	private createContributions(): void {
		const view = this.createCanvasView();
		for (const description of BaseHalfCanvasExtensionsRegistry.getCanvasContributions()) {
			try {
				this._register(this.instantiationService.createInstance(description.ctor, { canvas: view }));
			} catch (error) {
				onUnexpectedError(error);
			}
		}
	}

	/** The canvas as its features see it (IBaseHalfCanvasView). */
	private createCanvasView(): IBaseHalfCanvasView {
		const zoom = () => this.canvasZoom;
		const scene = () => this.canvasViewScene();
		return {
			get zoom() { return zoom(); },
			onDidChangeZoom: this.onDidChangeZoomEmitter.event,
			setZoom: zoom => this.setCanvasZoom(zoom),
			zoomBy: direction => this.zoomBy(direction),
			fitToScreen: () => this.fitCanvasToScreen(),
			getViewport: () => this.canvasScene.getViewport(),
			setViewport: (sceneKey, viewport) => this.showCanvasViewport(sceneKey, viewport),
			setSnapEnabled: enabled => this.canvasScene.setSnapEnabled(enabled),
			get scene() { return scene(); },
			onDidChangeScene: this.onDidChangeSceneEmitter.event,
			isCurrentScene: sceneKey => this.isCurrentSceneKey(sceneKey),
			// The scene draws what changed in its next frames.
			whenDrawn: () => new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => resolve()))),
			moveCards: (scene, places, undoLabel, onUndoOrRedo) => this.moveCanvasCards(scene, places, undoLabel, onUndoOrRedo),
			restoreCardPlaces: (sceneKey, rows, undoLabel) => this.restoreCanvasCardPlaces(sceneKey, rows, undoLabel),
			closeNoteEditor: () => this.closeActiveCanvasNoteEditorAfterFormats(),
			focus: () => this.cards.focus({ preventScroll: true }),
			onKeyDown: this.onKeyDownEmitter.event,
			reportError: error => this.reportCanvasMutationError(error),
			viewControls: this.viewControls,
			viewControlsCorner: this.chrome,
			onDidHideViewControls: this.onDidHideViewControlsEmitter.event,
		};
	}

	/** The scene that was drawn last, under the key of the canvas that is shown unless a key is given. */
	private canvasViewScene(sceneKey?: string): IBaseHalfCanvasViewScene {
		const folder = this.getCurrentFolder();
		return {
			key: sceneKey ?? (folder ? this.sceneKey(folder) : BASEHALF_CANVAS_NO_FOLDER_SCENE_KEY),
			structuralEpoch: this.renderedSceneStructuralEpoch,
			cards: this.renderedSceneCards,
			edges: this.renderedSceneEdges,
		};
	}

	/** Moves cards to new places and says which moved (IBaseHalfCanvasView.moveCards). */
	private async moveCanvasCards(
		scene: IBaseHalfCanvasViewScene,
		places: readonly IBaseHalfCanvasSceneGeometry[],
		undoLabel: string,
		onUndoOrRedo?: (undone: boolean) => void
	): Promise<readonly IBaseHalfCanvasMovedCard[]> {
		const transition = await this.commitCanvasGeometry(scene.key, scene.structuralEpoch, places, undoLabel, onUndoOrRedo, true);
		const moved: IBaseHalfCanvasMovedCard[] = [];
		for (const card of transition?.cards ?? []) {
			if (card.expected && card.next && (card.expected.x !== card.next.x || card.expected.y !== card.next.y)) {
				moved.push({ path: card.path, before: card.expected, after: card.next });
			}
		}
		return moved;
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
		this.cardListenerStores.clear();
		this.canvasNavigationService.setSurfaceActive(false);
		this.renderSeq++;
		this.disposeDetailSurfaces();
		if (this.backgroundRenderTimer !== undefined) {
			mainWindow.clearTimeout(this.backgroundRenderTimer);
			this.backgroundRenderTimer = undefined;
		}
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
			this.renderForDiskChange();
		}, 100);
	}

	/**
	 * A redraw for what happened on disk, not for what the user did on the
	 * canvas. It never replaces a description the user is typing, and it waits
	 * while an item of this folder is being recognized at a new path. Every
	 * such redraw goes through here, also the one that follows that wait:
	 * since every shown card is followed, the wait is common.
	 */
	private renderForDiskChange(): void {
		const cardDetail = this.canvasNavigationService.state.cardDetail;
		if (cardDetail) {
			void this.renderDetailBadge(cardDetail);
			return;
		}
		if (this.deferCanvasBadgeRefreshWhileFocused()) {
			return;
		}
		if (!this.holdRenderForMovedItems()) {
			this.requestRender(true);
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

	/**
	 * While an item of the folder that is shown is being recognized at a new
	 * path and its card information is on its way there, the canvas does not
	 * redraw for what happened on disk: the card would leave and come back. It
	 * waits until that is done, ten seconds at most, and then draws what is on
	 * disk. For the comparison at open its first drawing waits half a second
	 * and a later redraw two seconds. Navigation and the user's own edits are
	 * never held.
	 */
	private holdRenderForMovedItems(): boolean {
		const folder = this.getCurrentFolder();
		if (!folder || this.movedItemsService.isSettled(folder.workspaceFolder, folder.relativePath)) {
			this.movedItemsHoldStarted = undefined;
			this.firstRenderHeld = true;
			return false;
		}
		const now = Date.now();
		// Another folder is shown: what was waited for before says nothing about this one.
		const shown = folder.resource.toString();
		if (this.movedItemsHoldFolder !== shown) {
			this.movedItemsHoldFolder = shown;
			this.movedItemsHoldStarted = undefined;
		}
		this.movedItemsHoldStarted ??= now;
		const limit = !this.firstRenderHeld ? BASEHALF_CANVAS_MOVED_ITEMS_OPEN_HOLD_MS
			: this.movedItemsService.hasCompared(folder.workspaceFolder) ? BASEHALF_CANVAS_MOVED_ITEMS_HOLD_MS
				: BASEHALF_CANVAS_MOVED_ITEMS_OPENING_HOLD_MS;
		const remaining = limit - (now - this.movedItemsHoldStarted);
		if (remaining <= 0) {
			// The limit has passed: the canvas draws what is on disk, and is not
			// held again for the same move.
			this.firstRenderHeld = true;
			return false;
		}
		if (!this.movedItemsHoldWaiting) {
			this.movedItemsHoldWaiting = true;
			const started = this.movedItemsHoldStarted;
			const forget = () => {
				// The next change on disk starts a wait of its own.
				if (this.movedItemsHoldStarted === started && this.movedItemsService.isSettled(folder.workspaceFolder, folder.relativePath)) {
					this.movedItemsHoldStarted = undefined;
				}
			};
			void this.movedItemsService.whenSettled(folder.workspaceFolder, remaining, folder.relativePath).finally(() => {
				this.movedItemsHoldWaiting = false;
				if (this.disposed) {
					return;
				}
				forget();
				if (this.movedItemsHoldStarted === started) {
					// The limit ended the wait. Its start is forgotten once the move has
					// settled, however long that takes.
					void this.movedItemsService.whenSettled(folder.workspaceFolder, BASEHALF_CANVAS_MOVED_ITEMS_FORGET_MS, folder.relativePath).finally(forget);
				}
				// Still a redraw for what happened on disk: it keeps a description that is being typed.
				this.renderForDiskChange();
			});
		}
		return true;
	}

	/** The canvas shows the folder it had open at the folder's new path, with the view it had. */
	private async followOpenFolder(folder: IBaseHalfCanvasFolderState, resource: URI): Promise<void> {
		if (this.canvasNavigationService.state.canvasFolder !== folder) {
			return;
		}
		const viewport = this.viewportStateService.get(folder.resource);
		if (viewport) {
			this.viewportStateService.set(resource, viewport);
		}
		await this.canvasNavigationService.openFolderCanvas(resource, { source: folder.source, history: 'replace' });
	}

	private async followMovedItem(workspaceFolder: URI, from: string, to: string): Promise<void> {
		const state = this.canvasNavigationService.state;
		const moved = (item: IBaseHalfWorkspaceResource): URI | undefined => item.workspaceFolder.toString() === workspaceFolder.toString() && baseHalfIsMirrorSubtree(item.relativePath, from)
			? URI.joinPath(workspaceFolder, ...baseHalfRemapSubtreeRel(item.relativePath, from, to).split('/'))
			: undefined;
		// An editor that is open on the old path, without unsaved changes, shows the item at its new path.
		for (const { editor, groupId } of this.editorService.getEditors(EditorsOrder.SEQUENTIAL)) {
			const relativePath = editor.resource ? this.uriIdentityService.extUri.relativePath(workspaceFolder, editor.resource) : undefined;
			if (editor.resource && relativePath && baseHalfIsMirrorSubtree(relativePath, from) && !editor.isDirty()) {
				const resource = URI.joinPath(workspaceFolder, ...baseHalfRemapSubtreeRel(relativePath, from, to).split('/'));
				await this.editorService.replaceEditors([{ editor, replacement: { resource, options: { preserveFocus: true } } }], groupId);
			}
		}
		const detail = state.cardDetail;
		const detailResource = detail ? moved(detail) : undefined;
		if (detail && detailResource) {
			// One with unsaved changes is left as it is: it held the relocation back.
			if (!this.workingCopyService.isDirty(detail.resource)) {
				await this.canvasNavigationService.openCardDetail(detailResource, { source: detail.source, history: 'replace', expectedCardDetail: detail });
			}
			return;
		}
		const folder = state.canvasFolder;
		const folderResource = folder && folder.relativePath !== '' ? moved(folder) : undefined;
		if (folder && folderResource) {
			await this.followOpenFolder(folder, folderResource);
		}
	}

	/** `forDiskChange`: a redraw for what happened on disk, and not for what the user did. */
	private requestRender(forDiskChange = false): void {
		this.rendersInFlight++;
		// A drawing the user is waiting for is never left out, whatever takes its turn.
		this.userRenderOwed ||= !forDiskChange;
		void this.render(forDiskChange).catch(error => {
			if (this.disposed) {
				return;
			}
			this.logService.error(error);
			this.renderCanvasWarning(error instanceof Error ? error.message : String(error));
		}).finally(() => {
			this.rendersInFlight--;
		});
	}

	private async render(forDiskChange = false): Promise<void> {
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
			if (!this.isRenderCurrent(seq)) {
				return;
			}
			clearNode(this.canvasOverlay);
			clearNode(this.inlineEditLayer);
			this.inlineEditListeners.clear();
			this.inlineEdit = undefined;
			this.releaseEndedInlineRenameEditor();
			this.renderedBadges = new Map();
			this.renderedBadgeProblems = new Map();
			this.renderedRelationships = new Map();
			this.renderedUpstreamViews = new Map();
			this.renderedIndexState = undefined;
			this.renderedItemsByPath = new Map();
			this.renderedCardPreviewsByPath = new Map();
			this.renderedCardsByPath = new Map();
			this.renderedCardElementsByPath = new Map();
			this.renderedSceneCards = [];
			this.renderedSceneEdges = [];
			this.renderedSceneStructuralEpoch = 0;
			this.onDidChangeSceneEmitter.fire(this.canvasViewScene(BASEHALF_CANVAS_NO_FOLDER_SCENE_KEY));
			this.resetCanvasBadgeDeferredRefresh();
			this.cardListeners.clear();
			this.cardListenerStores.clear();
			this.canvasScene.update({ key: BASEHALF_CANVAS_NO_FOLDER_SCENE_KEY, structuralEpoch: 0, revision: seq, cards: [], edges: [] });
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
			this.renderedRelationships = new Map();
			this.renderedUpstreamViews = new Map();
			this.renderedIndexState = undefined;
			this.renderedItemsByPath = new Map();
			this.renderedCardPreviewsByPath = new Map();
			this.renderedCardsByPath = new Map();
			this.renderedCardElementsByPath = new Map();
			this.renderedSceneCards = [];
			this.renderedSceneEdges = [];
			this.renderedSceneStructuralEpoch = structuralStamp.structuralEpoch;
			this.onDidChangeSceneEmitter.fire(this.canvasViewScene(this.sceneKey(folder)));
			this.resetCanvasBadgeDeferredRefresh();
			this.cardListeners.clear();
			this.cardListenerStores.clear();
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

		// What waits for a write, as it is before the layout is read: a save that
		// lands while this drawing is prepared must not take a card out of it.
		const waitingPlaces = this.chosenCanvasPlaces.waitingFor(folder);
		let canvas: IBaseHalfCanvasFile | null = null;
		let canvasWarning: string | undefined;
		// BaseHalf saves the places it chooses only into a layout it could read in full.
		let canvasReadInFull = false;
		try {
			const read = await this.canvasMirrorService.inspectCanvas(folder);
			canvas = read.canvas;
			canvasReadInFull = read.damage === undefined;
			if (read.damage) {
				canvasWarning = baseHalfCanvasLayoutNotice(read.damage);
			}
			const damageKey = read.damage ? `${this.sceneKey(folder)}\0${read.damage.kind}\0${read.damage.reason}` : undefined;
			if (read.damage && damageKey !== this.loggedCanvasDamage) {
				this.logService.warn(`BaseHalf canvas layout of '${folder.relativePath}' is ${read.damage.kind === 'partial' ? 'partly unreadable' : 'unreadable'}: ${read.damage.reason}`);
			}
			this.loggedCanvasDamage = damageKey;
		} catch (error) {
			this.logService.warn(`BaseHalf canvas layout of '${folder.relativePath}' could not be loaded`, error);
			canvasWarning = localize('basehalf.canvas.layout.loadFailed', "The saved layout could not be loaded: {0}", baseHalfUserFacingErrorMessage(error));
		}
		if (!this.isRenderCurrent(seq)) {
			return;
		}

		// One sparse-mirror walk fetches every badge description in the
		// workspace, and the reference index supplies every card's connections
		// (D37): the model needs both BEFORE it builds items so the child cap can
		// keep annotated children and the edge set can derive from the
		// downstream nodes' upstream lists.
		const badgeRead = await this.badgeMirrorService.listBadges(folder.workspaceFolder);
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		const connections = await this.readCanvasConnections(folder, stat);
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

		// A card that appears gets its place in this drawing and keeps it (canvas
		// card placement). The place depends on its size, so BaseHalf reads first
		// what kind of node a new node file is.
		const pathKey = this.canvasPathKey(folder);
		const childPaths = (stat.children ?? []).map(child => canvasChildPath(folder.relativePath, basename(child.resource)));
		// This listing can be ahead of the file events for the same change. What
		// it shows of the cards that were here is told to following moved items,
		// so that a renamed file is not taken for a deleted one and a new one.
		const sameItem = pathKey ?? ((path: string) => path);
		const listed = new Set(childPaths.map(sameItem));
		const missingRows = (canvas?.cards ?? []).filter(card => !listed.has(sameItem(card.path))).map(card => ({ path: card.path, kind: card.kind }));
		if (missingRows.length > 0) {
			const rows = new Set((canvas?.cards ?? []).map(card => sameItem(card.path)));
			await this.movedItemsService.acceptListing(folder.workspaceFolder, missingRows, childPaths.filter(path => !rows.has(sameItem(path))));
			if (!this.isRenderCurrent(seq)) {
				return;
			}
			// A redraw for what happened on disk waits until the items are
			// recognized. Whether the folder is settled decides, and not whether
			// this drawing was the one that told: another drawing may have, and
			// have been overtaken by this one.
			if (forDiskChange && !this.userRenderOwed && this.holdRenderForMovedItems()) {
				return;
			}
		}
		const [newCardSizes, goneRows] = await Promise.all([
			this.sizesOfNewNodeCards(folder, stat, canvas, waitingPlaces),
			canvasReadInFull ? this.chosenCanvasPlaces.goneRows(folder, childPaths, canvas, pathKey) : []
		]);
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		const model = baseHalfCanvasModelFromStat(stat, {
			rootLevel: folder.relativePath.length === 0,
			folderRelativePath: folder.relativePath,
			canvas,
			badges: badgeRead.badges,
			relationships: connections.relationships,
			waiting: waitingPlaces,
			newCardSizes,
			pathKey,
			released: new Set(goneRows)
		});
		let badgeWarning: string | undefined;
		const folderPrefix = folder.relativePath.length === 0 ? '' : `${folder.relativePath}/`;
		const localProblems = badgeRead.problems.filter(problem => problem.relativePath.startsWith(folderPrefix));
		if (localProblems.length > 0) {
			badgeWarning = localProblems.length === 1
				? localize('basehalf.canvas.badge.oneNotLoaded', "1 description could not be loaded")
				: localize('basehalf.canvas.badge.someNotLoaded', "{0} descriptions could not be loaded", localProblems.length);
			for (const problem of localProblems) {
				this.logService.warn(`BaseHalf badge metadata issue for ${problem.relativePath}: ${problem.detail}`);
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
		clearNode(this.canvasOverlay);
		clearNode(this.inlineEditLayer);
		this.inlineEditListeners.clear();
		const previousRenderedCards = this.renderedCardsByPath;
		this.renderedBadges = badgeRead.badges;
		this.renderedBadgeProblems = new Map(badgeRead.problems.map(problem => [problem.relativePath, problem]));
		this.renderedRelationships = connections.relationships;
		this.renderedUpstreamViews = connections.views;
		this.renderedIndexState = connections.state;
		this.renderedItemsByPath = new Map(items.map(item => [item.path, item]));
		this.renderedCardPreviewsByPath = new Map(items.map(item => [
			item.path,
			{ item, preview: previews.get(item.path)! }
		]));
		this.renderedCardsByPath = new Map();
		this.renderedCardElementsByPath = new Map();
		if (this.inlineEdit?.kind === 'rename') {
			const editedItem = this.renderedItemsByPath.get(this.inlineEdit.path);
			if (!editedItem || !this.uriIdentityService.extUri.isEqual(editedItem.stat.resource, this.inlineEdit.resource)) {
				this.inlineEdit = undefined;
			}
		}
		this.releaseEndedInlineRenameEditor();
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
				|| this.retainVideoNodeCard(cached, displayedItem, preview, visualKey, currentSceneKey)
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
			return {
				path: item.path,
				kind: item.kind,
				...(controls ? { controls } : {}),
				...(item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) ? { renameChangesPathOnly: true as const } : {}),
				...bounds,
				element,
				updatePresentation: (presentation: IBaseHalfCanvasSceneCardPresentation) => this.cardPresentationUpdaters.get(element)?.(presentation),
				didMountElement: () => this.didMountCardElement(item.path, element),
				...(this.openBadgeFaces.has(item.path) || this.canvasNoteSurfacePath === item.path ? { forceInteractive: true as const } : {}),
				...(this.canvasNoteSurfacePath === item.path ? { noteEditing: true as const } : {}),
				...(connections.refusals.has(item.path) ? { upstreamRefusal: connections.refusals.get(item.path)! } : {})
			};
		});
		this.cardListenerStores.retain(new Set(items.map(item => item.path)));
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
		this.onDidChangeSceneEmitter.fire(this.canvasViewScene(currentSceneKey));
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
		this.syncVideoPanelAfterRender(currentSceneKey, pendingSelection);
		this.userRenderOwed = false;
		// The cards are drawn: the places BaseHalf chose for them are kept from
		// now on, and saved when the layout can take them.
		this.renderedLayoutRows = canvas?.cards ?? [];
		this.chosenCanvasPlaces.drawn(folder, model.appeared);
		if (canvasReadInFull) {
			void this.chosenCanvasPlaces.save(folder, goneRows, model.respelled);
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
		this.renderCanvasConnectionsStatus(connections.state);
		for (const warning of this.pendingCanvasWarnings.splice(0)) {
			this.renderCanvasWarning(warning);
		}

		this.revealCreatedCanvasCards(currentSceneKey);
		if (this.pendingCanvasFit
			&& (!this.isCanvasPostCreateOwnerCurrent(this.pendingCanvasFit.owner)
				|| this.pendingCanvasFit.viewportGeneration !== this.viewportRestoreGeneration)) {
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
					|| pendingFit.viewportGeneration !== this.viewportRestoreGeneration
					|| this.canvasNavigationService.state.cardDetail) {
					return;
				}
				void this.canvasScene.fit(pendingFit.paths, {
					maxZoom: Math.min(1, this.defaultCanvasZoom(folder)),
					padding: 0.16
				}).then(() => {
					if (this.isCurrentSceneKey(pendingFit.sceneKey)
						&& this.isCanvasPostCreateOwnerCurrent(pendingFit.owner)
						&& pendingFit.viewportGeneration === this.viewportRestoreGeneration
						&& !this.canvasNavigationService.state.cardDetail) {
						// Framing cards the user just created is a user change.
						this.scheduleViewportPersist(0, 'user');
					}
				}).catch(error => this.logService.error(error));
			});
		} else {
			this.restoreFolderViewport(folder);
		}
	}

	private sceneKey(folder: IBaseHalfCanvasFolderState): string {
		return `${folder.workspaceFolder.toString()}::${folder.relativePath}`;
	}

	private resetCardPreviewHydrationScene(): void {
		const folder = this.getCurrentFolder();
		this.cardPreviewHydrationQueue.resetScene(folder ? this.sceneKey(folder) : 'no-folder');
		this.cardPreviewVerificationQueue.reset();
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

	private upstreamIdentity(workspaceFolder: URI): IBaseHalfUpstreamIdentity {
		return baseHalfUpstreamIdentity(workspaceFolder, this.uriIdentityService.extUri);
	}

	private workspaceNode(workspaceFolder: URI, relativePath: string, kind: IBaseHalfCanvasItem['kind']): IBaseHalfUpstreamActionNode {
		return {
			resource: relativePath ? joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath,
			kind
		};
	}

	/**
	 * Reads the connections of a folder's cards from the reference index (D37).
	 * While the index is building, the canvas shows cards without edges. Cards
	 * whose badge face is open read their own store directly, so their Upstream
	 * list never depends on enumeration.
	 */
	private async readCanvasConnections(folder: IBaseHalfCanvasFolderState, stat: IFileStat): Promise<{
		readonly state: BaseHalfReferenceIndexState | undefined;
		readonly relationships: ReadonlyMap<string, IBaseHalfCanvasItemRelationships>;
		readonly views: ReadonlyMap<string, IBaseHalfUpstreamView>;
		readonly refusals: ReadonlyMap<string, string>;
	}> {
		const state = this.referenceIndexService.getState(folder.workspaceFolder);
		const relationships = new Map<string, IBaseHalfCanvasItemRelationships>();
		const views = new Map<string, IBaseHalfUpstreamView>();
		const refusals = new Map<string, string>();
		const rootLevel = folder.relativePath.length === 0;
		const children = (stat.children ?? []).filter(child => isBaseHalfCanvasEntry(child, rootLevel));
		const siblingPaths = children.map(child => canvasChildPath(folder.relativePath, basename(child.resource)));
		const marked = await baseHalfIsWorkspaceFolderMarked(this.fileService, folder.workspaceFolder);
		const identity = this.upstreamIdentity(folder.workspaceFolder);
		const misplaced = state === undefined || state === 'building'
			? new Set<string>()
			: new Set(this.referenceIndexService.getStores(folder.workspaceFolder)
				.filter(store => store.sidecarState === 'wrongOwner')
				.map(store => identity.key(store.node.relativePath)));
		await Promise.all(children.map(async (child, index) => {
			const path = siblingPaths[index];
			const node = this.workspaceNode(folder.workspaceFolder, path, child.isDirectory ? 'folder' : 'file');
			const refusal = this.canvasUpstreamRefusal(node, basename(child.resource), marked);
			if (refusal) {
				refusals.set(path, refusal);
			}
			const building = state === undefined || state === 'building';
			if (building && !this.openBadgeFaces.has(path)) {
				return;
			}
			let view: IBaseHalfUpstreamView | undefined;
			try {
				if (this.openBadgeFaces.has(path)) {
					view = await this.referenceIndexService.readUpstream(node);
				} else {
					const store = this.referenceIndexService.getStore(node);
					if ((store && (store.read.items.length > 0 || store.read.issue || !store.read.readable)) || misplaced.has(identity.key(path))) {
						view = await this.referenceIndexService.resolveUpstream(node);
					}
				}
			} catch (error) {
				this.logService.warn(`[BaseHalf] upstream list of ${path} could not be read`, error);
			}
			if (view) {
				views.set(path, view);
			}
			if (building) {
				// No edges or counts until the index is ready.
				return;
			}
			const upstream = view
				? baseHalfCanvasResolveSiblingUpstream(
					view.entries.flatMap(entry => entry.status === 'valid' && entry.path !== undefined ? [entry.path] : []),
					siblingPaths,
					identity
				)
				: [];
			const downstream = this.referenceIndexService.getDownstream(node).map(entry => entry.node.relativePath);
			relationships.set(path, { upstream, downstream, issueCount: view?.issueCount ?? 0 });
		}));
		return { state, relationships, views, refusals };
	}

	/** Why a card can never receive a connection right now, if it cannot. */
	private canvasUpstreamRefusal(node: IBaseHalfUpstreamActionNode, name: string, marked: boolean): string | undefined {
		if (this.referenceIndexService.getUpstreamOnlyReason(node)) {
			return localize('basehalf.canvas.connect.upstreamOnly', "{0} can't receive upstream context.", name);
		}
		if (marked && baseHalfUpstreamStoreKind(node.relativePath, node.kind === 'folder') === 'sidecar') {
			return localize('basehalf.canvas.connect.markedFolder', "{0} is in a folder BaseHalf is set to leave alone.", name);
		}
		return undefined;
	}

	/** The index state as the canvas shows it: loading, or partial with unscanned files. */
	private renderCanvasConnectionsStatus(state: BaseHalfReferenceIndexState | undefined): void {
		if (state !== 'building' && state !== 'partial') {
			return;
		}
		const status = append(this.canvasOverlay, $('.basehalf-canvas-connections-status'));
		status.setAttribute('role', 'status');
		status.setAttribute('data-testid', 'canvas-connections-status');
		status.setAttribute('data-index-state', state);
		status.textContent = state === 'building'
			? localize('basehalf.canvas.connections.building', "Loading connections…")
			: localize('basehalf.canvas.connections.partial', "Some files weren't scanned, so connections may be missing.");
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
		lease: IBaseHalfWorkspaceMutationLease
	): Promise<void> {
		const canvas = reverseCanvasStateTransition(transition.canvas, reverse);
		const documents = reverseDocumentTransitions(transition.documents, reverse);
		await this.resolveLiveWorkspaceNodes(transition.folder.workspaceFolder, transition.nodes);

		for (const document of documents) {
			if (this.workingCopyService.isDirty(document.resource)) {
				throw new Error(`Save '${basename(document.resource)}' before changing this connection.`);
			}
			const current = await this.fileService.readFile(document.resource, { atomic: true, limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } });
			if (!current.value.equals(document.expected)) {
				throw new Error(`'${basename(document.resource)}' changed before this connection update could be applied.`);
			}
		}

		let canvasApplied = false;
		const written: IBaseHalfCanvasNodeDocumentTransition[] = [];
		try {
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
			if (rollbackErrors.length > 0) {
				throw new AggregateError([error, ...rollbackErrors], 'The canvas connection and its safe rollback both failed. Reopen the project before continuing.');
			}
			throw error;
		}
	}

	private async commitSceneGeometry(sceneKey: string, structuralEpoch: number, requested: readonly IBaseHalfCanvasSceneGeometry[], reason?: BaseHalfCanvasSceneGeometryReason): Promise<void> {
		await this.commitCanvasGeometry(sceneKey, structuralEpoch, requested, reason === 'arrange'
			? localize('basehalf.canvas.arrange.undo', "Arrange canvas cards")
			: localize('basehalf.canvas.geometry.undo', "Move or resize canvas cards"));
	}

	/**
	 * Saves the places and sizes of cards in one change of the layout and one
	 * step of undo, and gives the scene the result. Returns what changed.
	 *
	 * With `placesOnly` the sizes in the layout stay as they are, and the change
	 * holds only the cards whose place is new. The caller then need not know
	 * what the layout holds: what the canvas draws can be a moment behind it,
	 * for example right after an undo.
	 */
	private async commitCanvasGeometry(
		sceneKey: string,
		structuralEpoch: number,
		requested: readonly IBaseHalfCanvasSceneGeometry[],
		undoLabel: string,
		didApplyUndoOrRedo?: (reverse: boolean) => void,
		placesOnly = false
	): Promise<IBaseHalfCanvasStateTransition | undefined> {
		if (requested.length === 0) {
			return undefined;
		}
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		// A card that is dragged while its item is being found at a new path is
		// saved under that path, once the item's card information is there. No
		// other card waits.
		if (requested.some(geometry => this.movedItemsService.isMoving(queuedFolder.workspaceFolder, geometry.path))) {
			await this.movedItemsService.whenSettled(queuedFolder.workspaceFolder, BASEHALF_CANVAS_MOVED_ITEMS_EDIT_HOLD_MS, queuedFolder.relativePath);
		}
		const geometries = requested.map(geometry => {
			const path = this.movedItemsService.resolveMovedPath(queuedFolder.workspaceFolder, geometry.path);
			return path === undefined ? geometry : { ...geometry, path };
		});
		let committedTransition: IBaseHalfCanvasStateTransition | undefined;
		let nodes = geometries.map(geometry => ({ path: geometry.path, kind: geometry.kind }));
		try {
			await this.workspaceMutationCoordinator.runSceneMutation(
				queuedFolder.workspaceFolder,
				this.sceneMutationStamp(queuedFolder, structuralEpoch),
				async lease => {
					const folder = this.folderForSceneMutation(sceneKey);
					await this.resolveLiveCanvasNodes(sceneKey, folder, geometries);
					// A change by the user writes the layout, and the places that wait are
					// saved with it: first, so that undo of this change puts the card back
					// at the place BaseHalf chose for it.
					await this.chosenCanvasPlaces.saveWithUserChange(folder, lease);
					const current = await this.canvasMirrorService.readCanvas(folder);
					const cards: IBaseHalfCanvasCardStateTransition[] = geometries.map(geometry => {
						const expected = current?.cards.find(card => card.path === geometry.path) ?? null;
						const width = placesOnly && expected ? expected.width : geometry.width;
						const height = placesOnly && expected ? expected.height : geometry.height;
						// A gesture that ends where it began changed nothing: a place
						// BaseHalf chose stays one BaseHalf chose.
						const unchanged = expected !== null && expected.kind === geometry.kind
							&& expected.x === geometry.x && expected.y === geometry.y
							&& expected.width === width && expected.height === height;
						return {
							path: geometry.path,
							expected,
							next: unchanged ? expected : {
								path: geometry.path,
								kind: geometry.kind,
								x: geometry.x,
								y: geometry.y,
								width,
								height
							}
						};
					});
					// A card whose row stays as it is takes no part in the change: undo
					// would otherwise refuse once such a card is moved afterwards.
					committedTransition = { cards: placesOnly ? cards.filter(card => card.next !== card.expected) : cards };
					await this.canvasMirrorService.transitionCanvasState(folder, committedTransition, lease);
					// Over a layout that could not be read in full they could not be saved
					// before. This write made it readable.
					await this.chosenCanvasPlaces.saveWithUserChange(folder, lease);
				}
			);
		} catch (error) {
			// The scene returns the cards to their saved positions; say why.
			// A storage error's own text names system error codes and files
			// under `.bh/`: the user gets the reason in plain words.
			throw new Error(localize('basehalf.canvas.geometry.saveFailed', "Couldn't save the card position: {0}", baseHalfUserFacingErrorMessage(error)), { cause: error });
		}
		if (committedTransition) {
			this.supersedeCanvasReadsBeforeGeometryCommit();
		}
		if (placesOnly && committedTransition) {
			const changed = new Set((committedTransition as IBaseHalfCanvasStateTransition).cards?.map(card => card.path));
			nodes = nodes.filter(node => changed.has(node.path));
		}
		if (committedTransition && canvasStateTransitionChangesAnything(committedTransition)) {
			this.pushCanvasUndoElement(
				undoLabel,
				queuedFolder,
				nodes,
				[],
				async (reverse, lease) => {
					await this.applyCanvasGeometryTransition(queuedFolder, nodes, committedTransition!, reverse, lease);
					didApplyUndoOrRedo?.(reverse);
				}
			);
		}
		if (this.isCurrentSceneKey(sceneKey) && this.renderedSceneStructuralEpoch === structuralEpoch) {
			// With `placesOnly` the scene gets the rows that were written, which
			// keep the sizes of the layout.
			const committedRows = placesOnly ? (committedTransition as IBaseHalfCanvasStateTransition | undefined)?.cards?.flatMap(card => card.next ? [card.next] : []) : undefined;
			const geometryByPath = new Map<string, Pick<IBaseHalfCanvasSceneGeometry, 'x' | 'y' | 'width' | 'height'>>((committedRows ?? geometries).map(geometry => [geometry.path, geometry]));
			this.renderedSceneCards = Object.freeze(this.renderedSceneCards.map(card => {
				const geometry = geometryByPath.get(card.path);
				return geometry ? { ...card, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height } : card;
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
		return committedTransition;
	}

	/**
	 * A render or layout reconciliation still in flight may have read
	 * canvas.yaml before a geometry commit wrote it. Resolving after the
	 * commit's scene update, it would publish the old geometry and snap the
	 * moved or resized cards back until the next reconciliation. Supersede
	 * both: an in-flight reconciliation is dropped (the commit's own
	 * canvas.yaml change schedules a fresh one), and an in-flight render is
	 * replaced by a new render that reads the committed file.
	 */
	private supersedeCanvasReadsBeforeGeometryCommit(): void {
		this.canvasLayoutReconcileGeneration++;
		if (this.rendersInFlight > 0) {
			this.renderSeq++;
			this.requestRender();
		}
	}

	/** The reference operation context of the current canvas: its undo stack and re-render. */
	private upstreamActionContext(folder: IBaseHalfCanvasFolderState | undefined, onDidChange: () => void): IBaseHalfUpstreamActionContext {
		return {
			canvasCardPaths: [...this.renderedItemsByPath.keys()],
			...(folder ? { undoResources: [this.canvasMirrorService.canvasResource(folder)] } : {}),
			onDidChange
		};
	}

	/**
	 * Runs one canvas reference operation (connect, disconnect, reconnect) and
	 * pushes its single canvas undo step. A refusal is shown with its reason
	 * and resolves `undefined`: the scene's optimistic edge is then reconciled
	 * by the next render.
	 */
	private async runCanvasReferenceOperation(
		folder: IBaseHalfCanvasFolderState,
		node: IBaseHalfUpstreamActionNode,
		label: string,
		operation: () => Promise<IBaseHalfReferenceEditResult>
	): Promise<IBaseHalfReferenceEditResult | undefined> {
		return this.upstreamActions.run(label, node, this.upstreamActionContext(folder, () => this.scheduleBackgroundRender()), operation);
	}

	/**
	 * `canvas.yaml` edge rows are anchor memory only (D37): a connect or
	 * reconnect upserts the row of its pair so undo or a later reconnect
	 * restores the anchors. In a folder marked with the source-tree marker
	 * nothing is written under `.bh/`; the edge uses default anchors.
	 */
	private async rememberCanvasEdgeAnchors(folder: IBaseHalfCanvasFolderState, sceneKey: string, structuralEpoch: number, edge: IBaseHalfCanvasEdge): Promise<void> {
		try {
			if (await baseHalfIsWorkspaceFolderMarked(this.fileService, folder.workspaceFolder)) {
				return;
			}
			await this.workspaceMutationCoordinator.runSceneMutation(
				folder.workspaceFolder,
				this.sceneMutationStamp(folder, structuralEpoch),
				async lease => {
					this.folderForSceneMutation(sceneKey);
					await this.canvasMirrorService.upsertCanvasEdge(folder, edge, lease);
				}
			);
		} catch (error) {
			// The connection itself is saved; its anchors fall back to defaults.
			this.logService.warn(`[BaseHalf] could not remember the anchors of ${edge.from} -> ${edge.to}`, error);
		}
	}

	/**
	 * Create from Connection: a drop on empty canvas opens the create menu at
	 * the release point. Every item creates a node whose first bytes list the
	 * source as upstream (D37); closing the menu writes nothing.
	 */
	private async showConnectionCreateMenu(
		sceneKey: string,
		structuralEpoch: number,
		drop: IBaseHalfCanvasSceneConnectionDrop
	): Promise<boolean> {
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		const stamp = this.sceneMutationStamp(queuedFolder, structuralEpoch);
		if (!this.workspaceMutationCoordinator.isStampCurrent(queuedFolder.workspaceFolder, stamp)) {
			return false;
		}
		this.markCanvasUserInteraction();

		// Resolves once the menu is closed: `true` after a chosen node was
		// created. The scene keeps the released line until then.
		return new Promise<boolean>(resolve => {
			let chosen: Promise<void> | undefined;
			const run = (create: () => Promise<void>) => () => {
				chosen = create().then(() => resolve(true), error => {
					this.reportCanvasMutationError(error);
					resolve(false);
				});
			};
			// Every kind takes any source as its first input: a Video node uses
			// it by its kind, and the other kinds keep it as context (D58).
			const nodeAction = (kind: BaseHalfNodeKind): IAction => toAction({
				id: `basehalf.canvas.createFromConnection.${kind}`,
				label: canvasResultNodeKindLabel(kind),
				run: run(() => this.createNodeFromConnection(sceneKey, structuralEpoch, drop, kind))
			});
			const actions: IAction[] = [
				toAction({
					id: 'basehalf.canvas.createFromConnection.note',
					label: localize('basehalf.canvas.createFromConnection.note', "Note"),
					run: run(() => this.createNoteFromConnection(sceneKey, structuralEpoch, drop))
				}),
				new Separator(),
				...(['image', 'video', 'audio'] as const).map(nodeAction),
				new Separator(),
				...(['file', 'pdf', 'presentation'] as const).map(nodeAction)
			];

			mainWindow.setTimeout(() => {
				if (this.disposed || !this.isCurrentSceneKey(sceneKey)
					|| !this.workspaceMutationCoordinator.isStampCurrent(queuedFolder.workspaceFolder, stamp)) {
					resolve(false);
					return;
				}
				this.lastCanvasContextMenu = undefined;
				this.contextMenuService.showContextMenu({
					getAnchor: () => drop.anchor,
					getActions: () => actions,
					onHide: wasCancelled => {
						if (wasCancelled) {
							this.cards.focus({ preventScroll: true });
							resolve(false);
							return;
						}
						// Both menus run a chosen action synchronously right after
						// hiding, and the native menu reports a dismissal as not
						// cancelled. Settle in the same task, so the kept line goes
						// away with the menu.
						queueMicrotask(() => {
							if (!chosen) {
								resolve(false);
							}
						});
					}
				});
			}, 0);
		});
	}

	/** Note from Connection: an untitled note whose only content is the
	 *  frontmatter that lists the source, opened for inline editing. */
	private async createNoteFromConnection(
		sceneKey: string,
		structuralEpoch: number,
		drop: IBaseHalfCanvasSceneConnectionDrop
	): Promise<void> {
		const folder = this.folderForSceneMutation(sceneKey);
		if (!this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		this.markCanvasUserInteraction();
		const createOwner = this.captureCanvasPostCreateOwner();
		const createFocusOrigin = this.root.ownerDocument.activeElement;
		const context = await this.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
		const toAnchor = baseHalfCanvasOppositeAnchor(drop.fromAnchor);
		// The user pointed: the card is where the line was released. It is not
		// moved for other cards or for the edge of the window, and neither is
		// the view (canvas card placement).
		const canvasPosition = baseHalfCanvasConnectionTargetOrigin(drop.position, toAnchor, {
			width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
			height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT
		});
		await this.createUntitledNote(folder, context, canvasPosition, createOwner, createFocusOrigin, undefined, {
			from: drop.from,
			fromAnchor: drop.fromAnchor,
			toAnchor
		});
	}

	private async createNodeFromConnection(
		sceneKey: string,
		structuralEpoch: number,
		drop: IBaseHalfCanvasSceneConnectionDrop,
		kind: BaseHalfNodeKind
	): Promise<void> {
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		const stamp = this.sceneMutationStamp(queuedFolder, structuralEpoch);
		if (!this.workspaceMutationCoordinator.isStampCurrent(queuedFolder.workspaceFolder, stamp) || !this.isCurrentSceneKey(sceneKey)) {
			return;
		}
		this.markCanvasUserInteraction();
		const postCreateOwner = this.captureCanvasPostCreateOwner();

		const name = await this.findAvailableConnectedNodeName(queuedFolder, kind);
		const targetPath = canvasChildPath(queuedFolder.relativePath, name);
		const targetResource = joinPath(queuedFolder.workspaceFolder, ...targetPath.split('/'));
		// The source is the node's only upstream entry in its first bytes (D37):
		// creating the file is the connection.
		const generation = kind === 'video' ? this.initialVideoGeneration() : undefined;
		const document = createBaseHalfNodeDocument({
			id: generateUuid(),
			kind,
			title: canvasResultNodeKindLabel(kind),
			upstream: [drop.from],
			...(generation ? { generation } : {})
		});
		if (kind === 'video') {
			this.videoPanelFocusPath = targetPath;
		}
		const targetSize = kind === 'video'
			? { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT }
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT };
		const contents = VSBuffer.fromString(serializeBaseHalfNodeDocument(document));
		const edge: IBaseHalfCanvasEdge = {
			from: drop.from,
			from_anchor: drop.fromAnchor,
			to: targetPath,
			to_anchor: baseHalfCanvasOppositeAnchor(drop.fromAnchor)
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
		const marked = await baseHalfIsWorkspaceFolderMarked(this.fileService, queuedFolder.workspaceFolder);
		let committed: IBaseHalfCanvasCreatedNodeTransition | undefined;
		let failure: unknown;
		await reservation.finish(async lease => {
			let fileCreated = false;
			let canvasApplied = false;
			let canvasTransition: IBaseHalfCanvasStateTransition | undefined;
			try {
				this.folderForSceneMutation(sceneKey);
				const currentCanvas = await this.canvasMirrorService.readCanvas(queuedFolder);
				if (await this.fileService.exists(baseHalfMirrorResource(queuedFolder.workspaceFolder, targetPath, 'badge.yaml'))
					|| currentCanvas?.cards.some(candidate => candidate.path === targetPath)) {
					throw new Error(`Project metadata for '${targetPath}' already exists.`);
				}
				// Edge rows are anchor memory: a stale row for this pair is replaced.
				const staleEdge = currentCanvas?.edges.find(candidate => candidate.from === edge.from && candidate.to === edge.to) ?? null;
				// The user pointed: the card is where the line was released.
				const canvasPosition = baseHalfCanvasConnectionTargetOrigin(drop.position, edge.to_anchor, targetSize);
				const card: NonNullable<IBaseHalfCanvasStateTransition['cards']>[number]['next'] = {
					path: targetPath,
					kind: 'file',
					x: roundCanvasPosition(canvasPosition.x),
					y: roundCanvasPosition(canvasPosition.y),
					width: targetSize.width,
					height: targetSize.height
				};
				canvasTransition = {
					cards: [{ path: targetPath, expected: null, next: card }],
					edges: marked ? [] : [{ from: edge.from, to: edge.to, expected: staleEdge, next: edge }]
				};
				await this.fileService.writeFileWithExpectedContents(
					targetResource,
					contents,
					null,
					{ atomic: { postfix: '.basehalf-node-create-tmp' } }
				);
				fileCreated = true;
				await this.resolveLiveWorkspaceNodes(queuedFolder.workspaceFolder, [
					{ path: drop.from, kind: drop.fromKind },
					{ path: targetPath, kind: 'file' }
				]);
				await this.canvasMirrorService.transitionCanvasState(queuedFolder, canvasTransition, lease);
				canvasApplied = true;
				const connection: IBaseHalfCanvasConnectionTransition = {
					folder: queuedFolder,
					nodes: [
						{ path: drop.from, kind: drop.fromKind },
						{ path: targetPath, kind: 'file' }
					],
					canvas: canvasTransition,
					documents: []
				};
				committed = { folder: queuedFolder, targetPath, targetResource, contents, stashResource, connection };
			} catch (error) {
				// The initial file is discarded rather than kept as undo state: no
				// user-visible operation was committed.
				const rollbackErrors = await settleEveryStep([
					[canvasApplied, async () => {
						if (canvasTransition) {
							await this.canvasMirrorService.transitionCanvasState(queuedFolder, reverseCanvasStateTransition(canvasTransition, true), lease);
						}
					}],
					[fileCreated, () => this.discardExactCanvasNodeFile(targetResource, contents)]
				]);
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
		// Show the new connection now instead of after the file watcher event.
		this.referenceIndexService.acceptSavedContent(
			{ resource: targetResource, workspaceFolder: queuedFolder.workspaceFolder, relativePath: targetPath },
			'node',
			contents.toString()
		);

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
				await this.moveExactCanvasNodeToStash(transition.folder.workspaceFolder, transition.targetResource, transition.contents, transition.stashResource);
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
				await this.moveExactCanvasNodeToStash(transition.folder.workspaceFolder, transition.targetResource, transition.contents, transition.stashResource);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], `Redo could not restore the connection and '${transition.targetPath}' changed before safe cleanup. The file was preserved.`);
			}
			throw error;
		}
	}

	private async assertExactCanvasNodeFile(resource: URI, expected: VSBuffer): Promise<void> {
		if (this.workingCopyService.isDirty(resource)) {
			throw new Error(`Save '${basename(resource)}' before changing this node.`);
		}
		const current = await this.fileService.readFile(resource, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		if (!current.value.equals(expected)) {
			throw new Error(`'${basename(resource)}' changed after it was created. Its file, connection, and canvas card were preserved.`);
		}
	}

	private async moveExactCanvasNodeToStash(workspaceFolder: URI, resource: URI, expected: VSBuffer, stash: URI): Promise<void> {
		await this.assertExactCanvasNodeFile(resource, expected);
		if (await this.fileService.exists(stash)) {
			throw new Error(`The private undo copy for '${basename(resource)}' already exists.`);
		}
		// An undo copy is a working file: git must not show it.
		await baseHalfEnsureMirrorIgnoreFile(this.fileService, workspaceFolder);
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

	/**
	 * Connect on the canvas (D37): lists `from` in `to`'s own upstream store
	 * (Markdown frontmatter, `.bhnode` `upstream`, or its sidecar) through the
	 * reference edit service, then remembers the gesture's anchors in the
	 * `canvas.yaml` row of the pair. The reference write is one canvas undo
	 * step; the anchor row is not part of undo.
	 */
	private async connectSceneEdge(sceneKey: string, structuralEpoch: number, connection: IBaseHalfCanvasSceneConnection): Promise<void> {
		if (connection.from === connection.to) {
			throw new Error('A node cannot provide context to itself.');
		}
		const folder = this.folderForSceneMutation(sceneKey);
		await this.resolveLiveCanvasNodes(sceneKey, folder, [
			{ path: connection.from, kind: connection.fromKind },
			{ path: connection.to, kind: connection.toKind }
		]);
		const target = this.workspaceNode(folder.workspaceFolder, connection.to, connection.toKind);
		this.folderForSceneMutation(sceneKey);
		const label = localize('basehalf.canvas.connect.undo', "Connect canvas nodes");
		const result = await this.runCanvasReferenceOperation(folder, target, label, () => this.referenceEditService.add(target, connection.from, { label }));
		if (result) {
			await this.rememberCanvasEdgeAnchors(folder, sceneKey, structuralEpoch, {
				from: connection.from,
				from_anchor: connection.fromAnchor,
				to: connection.to,
				to_anchor: connection.toAnchor
			});
		}
		this.requestRender();
	}

	/**
	 * Reconnect on the canvas (D37):
	 * - anchors only: upserts the anchor row;
	 * - source end: replaces the entry in place in the target's store;
	 * - target end: moves the entry to the new target's store (added there
	 *   before it is removed from the old one).
	 * Each is one canvas undo step, and the new pair's anchors are remembered.
	 */
	private async reconnectSceneEdge(sceneKey: string, structuralEpoch: number, intent: IBaseHalfCanvasSceneReconnect): Promise<void> {
		const { previous, next: connection } = intent;
		if (connection.from === connection.to) {
			throw new Error('A node cannot provide context to itself.');
		}
		const folder = this.folderForSceneMutation(sceneKey);
		const next: IBaseHalfCanvasEdge = {
			from: connection.from,
			from_anchor: connection.fromAnchor,
			to: connection.to,
			to_anchor: connection.toAnchor
		};
		if (previous.from === next.from && previous.to === next.to) {
			await this.rememberCanvasEdgeAnchors(folder, sceneKey, structuralEpoch, next);
			this.requestRender();
			return;
		}
		await this.resolveLiveCanvasNodes(sceneKey, folder, [
			{ path: previous.from, kind: previous.fromKind },
			{ path: previous.to, kind: previous.toKind },
			{ path: connection.from, kind: connection.fromKind },
			{ path: connection.to, kind: connection.toKind }
		]);
		const previousTarget = this.workspaceNode(folder.workspaceFolder, previous.to, previous.toKind);
		const nextTarget = this.workspaceNode(folder.workspaceFolder, connection.to, connection.toKind);
		const label = localize('basehalf.canvas.reconnect.undo', "Reconnect canvas nodes");
		// A source-end reconnect replaces the entry in place, so a Video node's
		// input keeps its place in the order; a target-end reconnect moves it.
		const operation: () => Promise<IBaseHalfReferenceEditResult> = previous.to === next.to
			? () => this.referenceEditService.replace(previousTarget, previous.from, next.from, { label })
			: previous.from === next.from
				? () => this.referenceEditService.move(next.from, previousTarget, nextTarget, { label })
				: () => this.referenceEditService.apply([
					{ node: nextTarget, operation: { kind: 'add', entry: next.from } },
					{ node: previousTarget, operation: { kind: 'remove', entry: previous.from } }
				], { label });
		this.folderForSceneMutation(sceneKey);
		const result = await this.runCanvasReferenceOperation(folder, nextTarget, label, operation);
		if (result) {
			await this.rememberCanvasEdgeAnchors(folder, sceneKey, structuralEpoch, next);
		}
		this.requestRender();
	}

	/** Disconnect on the canvas: removes `from` from `to`'s store. The anchor row is kept. */
	private async removeEdgeFromScene(sceneKey: string, _structuralEpoch: number, edge: IBaseHalfCanvasSceneEdge): Promise<void> {
		const folder = this.folderForSceneMutation(sceneKey);
		await this.resolveLiveCanvasNodes(sceneKey, folder, [
			{ path: edge.from, kind: edge.fromKind },
			{ path: edge.to, kind: edge.toKind }
		]);
		const target = this.workspaceNode(folder.workspaceFolder, edge.to, edge.toKind);
		const label = localize('basehalf.canvas.disconnect.undo', "Disconnect canvas nodes");
		await this.runCanvasReferenceOperation(folder, target, label, () => this.referenceEditService.remove(target, edge.from, { label }));
		this.requestRender();
	}

	private async prepareSceneSelectionChange(sceneKey: string, structuralEpoch: number, paths: readonly string[]): Promise<boolean> {
		const accepted = await this.prepareSceneNoteSelectionChange(sceneKey, structuralEpoch, paths);
		if (accepted) {
			this.followSelectionWithVideoPanel(sceneKey, paths);
		}
		return accepted;
	}

	private async prepareSceneNoteSelectionChange(sceneKey: string, structuralEpoch: number, paths: readonly string[]): Promise<boolean> {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return false;
		}
		const notePath = this.canvasNoteSurfacePath ?? this.activeCanvasNoteEditor?.path;
		const changesNote = notePath !== undefined && !(paths.length === 1 && paths[0] === notePath);
		if (!changesNote) {
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
			return this.closeActiveCanvasNoteEditorAfterFormats();
		}
		if (this.canvasNoteSurfacePath === notePath) {
			this.clearPendingCanvasNoteFocus(notePath);
			this.canvasNoteSurfacePath = undefined;
			this.requestRender();
		}
		return true;
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
		const markdownPreview = this.shownMarkdownPreview(path);
		if (baseHalfCanvasMarkdownEditTarget(item.stat.size, markdownPreview) === 'richDetail') {
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
		const markdownPreview = this.shownMarkdownPreview(path);
		if (baseHalfCanvasMarkdownEditTarget(item.stat.size, markdownPreview) === 'richDetail') {
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
			...(fitPaths?.length ? { fitViewportGeneration: this.viewportRestoreGeneration } : {})
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
		const sidewaysScroll = active.instance.getSidewaysScroll();
		const documentLength = active.instance.getDocumentLength();
		if (documentLength !== undefined && documentLength > BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES) {
			this.renderActiveCanvasNoteFullEditorFallback(active);
			return;
		}
		const text = active.instance.getDocumentText();
		if (text === undefined) {
			active.fallback.scrollTop = scrollTop;
			return;
		}
		if (!baseHalfCanvasMarkdownSourceFitsShown(text)) {
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
		// The editor holds every block. The projection it reveals holds as many,
		// so it shows the same place and the same sideways positions. A note that
		// has grown past the editor's size holds the parts down to that place.
		if (baseHalfCanvasMarkdownSourceFitsInline(text)) {
			buildAllBaseHalfCanvasNoteParts(active.fallback);
		} else {
			buildBaseHalfCanvasNotePartsTo(active.fallback, scrollTop);
		}
		active.fallback.scrollTop = scrollTop;
		applyBaseHalfCanvasMarkdownSidewaysScroll(active.fallback, sidewaysScroll);
	}

	private renderActiveCanvasNoteFullEditorFallback(active: IBaseHalfActiveCanvasNoteEditor): void {
		active.fallbackRendering.clear();
		clearNode(active.fallback);
		appendCanvasNoteFullEditorLabel(active.fallback);
		active.fallback.scrollTop = 0;
		const richRequiredPreview = { kind: 'richRequired', text: CANVAS_MARKDOWN_FULL_EDITOR_LABEL } as const;
		const mount = this.canvasNotePreviewMounts.get(active.card);
		if (mount?.fallback === active.fallback) {
			mount.preview = richRequiredPreview;
		}

		// The preview cache may still describe the snapshot from before
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
		this.agentSelectionCardTextReader.cancel();
		this.agentSelectionCardText = undefined;
		this.reportAgentSelection();
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
		const intent = this.cardOpenIntent;
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
		if (this.cardOpenIntent !== intent
			|| !currentStampValid
			|| !currentItem
			|| !this.uriIdentityService.extUri.isEqual(currentItem.stat.resource, item.stat.resource)) {
			return;
		}
		if (currentItem.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			void this.openResultNodeContent(currentFolder, currentItem);
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
		this.cardOpenIntent++;
	}

	private async openResultNodeFromActionContext(context: IBaseHalfCanvasActionContext): Promise<void> {
		await this.canvasActionContextService.assertCurrent(context);
		const folder = this.getCurrentFolder();
		const item = this.renderedItemsByPath.get(context.relativePath);
		if (!folder || !item
			|| !this.uriIdentityService.extUri.isEqual(folder.workspaceFolder, context.workspaceFolder)
			|| !this.uriIdentityService.extUri.isEqual(item.stat.resource, context.resource)
			|| !item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			throw new Error('The result node is no longer available on the current canvas.');
		}
		this.markCanvasUserInteraction();
		this.cancelPendingNodeActivation();
		await this.openResultNodeContent(folder, item);
	}

	/**
	 * Opens the file a node shows. A node that shows nothing yet stays
	 * selected on the canvas, where its card and panel are.
	 */
	private async openResultNodeContent(folder: IBaseHalfCanvasFolderState, item: IBaseHalfCanvasItem): Promise<void> {
		try {
			const content = await this.fileService.readFile(item.stat.resource, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			const artifact = getBaseHalfNodeResultArtifact(parseBaseHalfNodeDocumentBytes(content.value.buffer));
			if (!artifact) {
				return;
			}
			await this.openNodeArtifactPath(folder, artifact.path);
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
		}
	}

	private async invokeSceneVideoAction(
		sceneKey: string,
		structuralEpoch: number,
		path: string,
		action: BaseHalfCanvasSceneVideoAction,
		_anchor: HTMLElement,
		frame?: BaseHalfCanvasSceneVideoFrame
	): Promise<void> {
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
				await this.importCanvasNodeResult(item);
				return;
			case 'openFullPreview': {
				const video = this.videoFileOf(item, preview);
				if (video) {
					rememberBaseHalfVideoDetailNode(video, item.stat.resource);
				}
				await this.openResultNodeContent(folder, item);
				return;
			}
			case 'revealVideo': {
				const video = this.videoFileOf(item, preview);
				if (video) {
					await this.commandService.executeCommand('revealFileInOS', video);
				}
				return;
			}
			case 'captureFrame':
				await this.captureVideoFrame(folder, item, preview, frame ?? 'first');
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
		// A copied folder keeps its notes' bytes, so entries inside it that name
		// other items of the original folder still name the originals (D37).
		const internallyConnected = items.filter(item => item.kind === 'folder' && this.folderHasInternalUpstream(folder.workspaceFolder, item.path));
		if (internallyConnected.length > 0) {
			const confirmation = await this.dialogService.confirm({
				message: internallyConnected.length === 1
					? localize('basehalf.canvas.duplicate.connectedFolder.message', "Duplicate '{0}'?", internallyConnected[0].name)
					: localize('basehalf.canvas.duplicate.connectedFolders.message', "Duplicate {0} folders?", internallyConnected.length),
				detail: localize(
					'basehalf.canvas.duplicate.connectedFolder.detail',
					"Items in the copy keep their upstream entries, so entries that name other items in {0} still name the originals.",
					internallyConnected.map(item => `'${item.name}'`).join(', ')
				),
				primaryButton: localize('basehalf.canvas.duplicate.connectedFolder.primary', "&&Duplicate")
			});
			if (!confirmation.confirmed) {
				return;
			}
		}
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

	/** Whether a store inside the folder lists another item of the same folder as upstream. */
	private folderHasInternalUpstream(workspaceFolder: URI, folderPath: string): boolean {
		const state = this.referenceIndexService.getState(workspaceFolder);
		if (state === undefined || state === 'building') {
			return false;
		}
		const identity = this.upstreamIdentity(workspaceFolder);
		const prefix = identity.key(folderPath);
		const inside = (path: string) => {
			let current = path;
			while (current.includes('/')) {
				current = current.slice(0, current.lastIndexOf('/'));
				if (identity.key(current) === prefix) {
					return true;
				}
			}
			return false;
		};
		return this.referenceIndexService.getStores(workspaceFolder).some(store => inside(store.node.relativePath)
			&& (store.sidecarState === undefined || store.sidecarState === 'active')
			&& store.read.items.some(item => item.path !== undefined && inside(item.path)));
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
			? localize('basehalf.canvas.selection.deleteFolder.scopeUpstream', "Selected folders include all their contents. Other project files are not changed.")
			: localize('basehalf.canvas.selection.deleteFile.scopeUpstream', "Other project files are not changed.");
		const recoveryDetail = useTrash
			? localize('basehalf.canvas.selection.deleteTrash.recovery', "You can restore the selected items from the Trash.")
			: localize('basehalf.canvas.selection.deletePermanent.recovery', "This action cannot be undone from the Trash.");
		// Deleting a node never changes another node's store: entries that name
		// it become dangling (D37). The user may remove them in one separate step.
		const impact = this.canvasDeleteImpact(folder, items);
		const impactDetail = this.canvasDeleteImpactDetail(items, impact);
		const detailParts = [impactDetail, scopeDetail, recoveryDetail].filter(part => !!part).join(' ');
		const confirmation = await this.dialogService.confirm({
			type: 'warning',
			message: useTrash
				? localize('basehalf.canvas.selection.deleteTrash.message', "Move {0} to the Trash?", selectionLabel)
				: localize('basehalf.canvas.selection.deletePermanent.message', "Permanently delete {0}?", selectionLabel),
			detail: items.length === 1
				? detailParts
				: `${names.slice(0, 12).join('\n')}${names.length > 12 ? localize('basehalf.canvas.selection.delete.more', "\n+{0} more", names.length - 12) : ''}\n\n${detailParts}`,
			primaryButton: useTrash
				? localize('basehalf.canvas.selection.deleteTrash.primary', "&&Move to Trash")
				: localize('basehalf.canvas.selection.deletePermanent.primary', "&&Delete Permanently"),
			...(impact.stores.length > 0 ? {
				checkbox: {
					label: items.length === 1
						? localize('basehalf.canvas.selection.delete.removeUpstreamOne', "Also remove {0} from their upstream lists", items[0].name)
						: localize('basehalf.canvas.selection.delete.removeUpstreamMany', "Also remove the selected items from their upstream lists"),
					checked: false
				}
			} : {})
		});
		if (!confirmation.confirmed) {
			return;
		}
		const removeUpstreamEntries = confirmation.checkboxChecked === true && impact.stores.length > 0;
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
		if (removeUpstreamEntries) {
			await this.removeDeletedUpstreamEntries(folder, items, impact.stores);
		}
		this.requestRender();
	}

	/**
	 * The downstream stores that name the items about to be deleted. While the
	 * index is building the answer is unknown; while it is partial it is a
	 * lower bound.
	 */
	private canvasDeleteImpact(folder: IBaseHalfCanvasFolderState, items: readonly IBaseHalfCanvasItem[]): {
		readonly state: BaseHalfReferenceIndexState | undefined;
		readonly stores: readonly IBaseHalfCanvasDeleteImpactStore[];
	} {
		const state = this.referenceIndexService.getState(folder.workspaceFolder);
		if (state === undefined || state === 'building') {
			return { state, stores: [] };
		}
		return {
			state,
			stores: baseHalfCanvasDeleteImpact(
				// A sealed or imported Result artifact keeps the bytes its node
				// pins: its entries are never removed, so it is not offered.
				this.referenceIndexService.getStores(folder.workspaceFolder).filter(store => !this.referenceIndexService.getUpstreamOnlyReason(store.node)),
				items.map(item => item.path),
				this.upstreamIdentity(folder.workspaceFolder)
			)
		};
	}

	private canvasDeleteImpactDetail(
		items: readonly IBaseHalfCanvasItem[],
		impact: { readonly state: BaseHalfReferenceIndexState | undefined; readonly stores: readonly IBaseHalfCanvasDeleteImpactStore[] }
	): string {
		if (impact.state === 'building') {
			return localize('basehalf.canvas.selection.delete.checkingConnections', "Checking connections…");
		}
		const count = impact.stores.length;
		if (count === 0) {
			return '';
		}
		if (items.length > 1) {
			if (count === 1) {
				return impact.state === 'partial'
					? localize('basehalf.canvas.selection.delete.manyUpstreamOfAtLeastOne', "The selected items are upstream of at least 1 item. It will show a broken upstream entry that you can fix later.")
					: localize('basehalf.canvas.selection.delete.manyUpstreamOfOne', "The selected items are upstream of 1 item. It will show a broken upstream entry that you can fix later.");
			}
			return impact.state === 'partial'
				? localize('basehalf.canvas.selection.delete.manyUpstreamOfAtLeast', "The selected items are upstream of at least {0} items. They will show a broken upstream entry that you can fix later.", count)
				: localize('basehalf.canvas.selection.delete.manyUpstreamOf', "The selected items are upstream of {0} items. They will show a broken upstream entry that you can fix later.", count);
		}
		const name = items[0].name;
		if (impact.state === 'partial') {
			return count === 1
				? localize('basehalf.canvas.selection.delete.upstreamOfAtLeastOne', "{0} is upstream of at least 1 item. It will show a broken upstream entry that you can fix later.", name)
				: localize('basehalf.canvas.selection.delete.upstreamOfAtLeast', "{0} is upstream of at least {1} items. They will show a broken upstream entry that you can fix later.", name, count);
		}
		return count === 1
			? localize('basehalf.canvas.selection.delete.upstreamOfOne', "{0} is upstream of 1 item. It will show a broken upstream entry that you can fix later.", name)
			: localize('basehalf.canvas.selection.delete.upstreamOf', "{0} is upstream of {1} items. They will show a broken upstream entry that you can fix later.", name, count);
	}

	/**
	 * "Also remove <name> from their upstream lists": one bulk edit after the
	 * delete, as a separate canvas undo step.
	 */
	private async removeDeletedUpstreamEntries(
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
		stores: readonly IBaseHalfCanvasDeleteImpactStore[]
	): Promise<void> {
		const label = items.length === 1
			? localize('basehalf.canvas.selection.delete.removeUpstreamUndoOne', "Remove {0} from upstream lists", items[0].name)
			: localize('basehalf.canvas.selection.delete.removeUpstreamUndoMany', "Remove {0} items from upstream lists", items.length);
		const identity = this.upstreamIdentity(folder.workspaceFolder);
		const edits: IBaseHalfReferenceStoreEdit[] = [];
		for (const store of stores) {
			if (store.entries.length === 1) {
				edits.push({ node: store.node, operation: { kind: 'remove', entry: store.entries[0].path } });
				continue;
			}
			// One store may change only once per operation: remove all of its
			// entries that name deleted items in one transition.
			const snapshot = await this.referenceEditService.readSnapshot(store.node);
			if (!snapshot) {
				continue;
			}
			const removed = new Set(store.entries.map(entry => identity.key(entry.path)));
			edits.push({
				node: store.node,
				operation: {
					kind: 'transition',
					from: snapshot,
					to: {
						items: snapshot.items.filter(item => !(item.scalar && removed.has(identity.key(baseHalfNormalizeUpstreamEntry(item.text)))))
					}
				}
			});
		}
		if (edits.length === 0) {
			return;
		}
		const target = this.workspaceNode(folder.workspaceFolder, stores[0].node.relativePath, 'file');
		await this.upstreamActions.run(label, target, this.upstreamActionContext(folder, () => this.scheduleBackgroundRender()), () => this.referenceEditService.apply(edits, { label }));
	}

	private showSceneContextMenu(
		sceneKey: string,
		structuralEpoch: number,
		request: BaseHalfCanvasSceneContextMenuRequest,
		createPosition?: { readonly x: number; readonly y: number },
		createPositionComputed?: boolean
	): void {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		this.markCanvasUserInteraction();
		if (request.kind === 'edge') {
			mainWindow.setTimeout(() => {
				const current = this.getCurrentFolder();
				const edge = this.renderedSceneEdges.find(candidate => candidate.id === request.edge.id);
				if (this.disposed || !current || this.sceneKey(current) !== sceneKey || !edge
					|| !this.workspaceMutationCoordinator.isStampCurrent(current.workspaceFolder, this.sceneMutationStamp(current, structuralEpoch))) {
					return;
				}
				this.lastCanvasContextMenu = undefined;
				// An edge into a sealed or imported Result artifact can't be
				// disconnected: BaseHalf never changes that file's bytes.
				const upstreamOnly = !!this.referenceIndexService.getUpstreamOnlyReason(this.workspaceNode(current.workspaceFolder, edge.to, edge.toKind));
				this.contextMenuService.showContextMenu({
					getAnchor: () => request.anchor,
					getActions: () => [toAction({
						id: 'basehalf.canvas.disconnectSelection',
						label: localize('basehalf.canvas.edge.disconnect', "Disconnect"),
						enabled: !upstreamOnly,
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
			this.lastCanvasContextMenu = { context, request, createPosition, createPositionComputed };
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
			{ x: surfaceRect.left + surfaceRect.width / 2, y: surfaceRect.top + surfaceRect.height / 2 },
			true
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
			if (folder && this.programmaticViewportSceneKey !== sceneKey) {
				this.scheduleViewportPersist(200, 'user', { folder, viewport });
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

	/**
	 * Whether every change is under `.bh/cache/`: BaseHalf's working files,
	 * such as the record of the selection agents can see, which no card shows.
	 * The canvas of a workspace folder holds `.bh/`, so without this each
	 * write of the record would draw that canvas again.
	 */
	private isWorkingFilesOnlyChange(event: FileChangesEvent, folder: IBaseHalfCanvasFolderState): boolean {
		const cache = joinPath(folder.workspaceFolder, '.bh', 'cache');
		const resources = [...event.rawAdded, ...event.rawUpdated, ...event.rawDeleted];
		return resources.length > 0 && resources.every(resource => isEqualOrParent(resource, cache));
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
			|| cached.preview.kind === 'unavailable') {
			return undefined;
		}
		if (!baseHalfCanvasItemsSharePreviewVersion(cached.item, item)) {
			// The file of a Video node changes while the user works with it: the
			// panel saves the prompt and the settings, and a generation records its
			// task. Its card shows the last state until the new one is read, and then
			// changes in place, so a playing video goes on playing (video node, "The
			// card").
			return isVideoNodePreview(cached.preview)
				&& item.stat.isFile
				&& this.uriIdentityService.extUri.isEqual(cached.item.stat.resource, item.stat.resource)
				? cached.preview
				: undefined;
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
		const ownProblem = this.renderedBadgeProblems.get(item.path);
		// Whether the card shows the rename editor. What is typed there is the
		// editor's own state and rebuilds nothing.
		const inlineRename = this.inlineEdit?.kind === 'rename' && this.inlineEdit.path === item.path
			? true
			: undefined;
		const badgeOpen = this.openBadgeFaces.has(item.path);
		const view = badgeOpen ? this.renderedUpstreamViews.get(item.path) : undefined;
		return JSON.stringify({
			badge: item.badge ? { description: item.badge.description, orphan: item.badge.orphan } : undefined,
			badgeOpen,
			inlineRename,
			relationships: item.relationships,
			indexState: this.renderedIndexState,
			// An open face renders the full Upstream and Downstream lists.
			upstream: view ? {
				storeKind: view.storeKind,
				problem: view.problem,
				storeIssue: view.storeIssue,
				upstreamOnly: view.upstreamOnly,
				misplaced: !!view.misplacedSidecar,
				entries: view.entries.map(entry => [entry.index, entry.text, entry.status, entry.problem, entry.workspacePath, entry.target?.relativePath])
			} : undefined,
			ownProblem: ownProblem ? {
				relativePath: ownProblem.relativePath,
				message: ownProblem.message
			} : undefined
		});
	}

	/**
	 * Keeps the card of a Video node whose node changed and shows the new state
	 * in it, so that its player, and a video that plays in it, stay (video node,
	 * "The card"). Anything else that changed rebuilds the card as before.
	 */
	private retainVideoNodeCard(
		cached: IBaseHalfCanvasCardRenderCacheEntry | undefined,
		item: IBaseHalfCanvasItem,
		preview: BaseHalfCanvasCardPreview | undefined,
		visualKey: string,
		sceneKey: string
	): cached is IBaseHalfCanvasCardRenderCacheEntry {
		const retain = cached ? this.videoCardRetainers.get(cached.element) : undefined;
		if (!cached
			|| !retain
			|| !isVideoNodePreview(cached.preview)
			|| !isVideoNodePreview(preview)
			|| cached.sceneKey !== sceneKey
			|| cached.visualKey !== visualKey
			|| this.openBadgeFaces.has(item.path)
			|| (this.inlineEdit?.kind === 'rename' && this.inlineEdit.path === item.path)
			|| !this.uriIdentityService.extUri.isEqual(cached.item.stat.resource, item.stat.resource)) {
			return false;
		}
		retain(item, preview);
		return true;
	}

	private canReuseRenderedCard(
		cached: IBaseHalfCanvasCardRenderCacheEntry | undefined,
		item: IBaseHalfCanvasItem,
		preview: BaseHalfCanvasCardPreview | undefined,
		visualKey: string,
		sceneKey: string
	): cached is IBaseHalfCanvasCardRenderCacheEntry {
		const activeNote = this.activeCanvasNoteEditor;
		const renaming = this.inlineEdit?.kind === 'rename' && this.inlineEdit.path === item.path;
		// A card that shows the live rename editor is kept as any other card is.
		// A card that was built for the editor and has not taken it yet is not.
		const renameEditor = this.inlineRenameEditor;
		const renameKeepsElement = !renaming
			|| (!!cached && !!renameEditor && renameEditor.edit === this.inlineEdit && cached.element.contains(renameEditor.host));
		if (cached
			&& activeNote?.path === item.path
			&& activeNote.card === cached.element
			&& cached.sceneKey === sceneKey
			&& this.uriIdentityService.extUri.isEqual(activeNote.state.resource, item.stat.resource)
			&& !this.openBadgeFaces.has(item.path)
			&& !renaming) {
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
			&& renameKeepsElement
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
			&& renameKeepsElement
			&& previewUnchanged
			&& cached.visualKey === visualKey
			&& baseHalfCanvasItemsSharePreviewVersion(cached.item, item);
	}

	/**
	 * The sizes of the node cards that are about to appear and are not drawn at
	 * the default size. A video node is wider than a cell, and the place of a
	 * card depends on its size. A file that cannot be read keeps the default.
	 */
	private async sizesOfNewNodeCards(
		folder: IBaseHalfCanvasFolderState,
		stat: IFileStat,
		canvas: IBaseHalfCanvasFile | null,
		waiting: ReadonlyMap<string, IBaseHalfCanvasCard> | undefined
	): Promise<Map<string, { readonly width: number; readonly height: number }>> {
		const sizes = new Map<string, { readonly width: number; readonly height: number }>();
		const placed = new Set((canvas?.cards ?? []).map(card => card.path));
		await Promise.all((stat.children ?? []).map(async child => {
			const name = basename(child.resource);
			const path = canvasChildPath(folder.relativePath, name);
			if (child.isDirectory || !name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) || placed.has(path) || waiting?.has(path)) {
				return;
			}
			if (await this.isVideoNodeFile(child.resource, `${child.mtime ?? ''}:${child.size ?? ''}`)) {
				sizes.set(path, { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT });
			}
		}));
		return sizes;
	}

	/** The size at which the card of a new file is drawn: a video node is larger than other files. */
	private async sizeOfNewFileCard(resource: URI): Promise<{ readonly width: number; readonly height: number }> {
		return basename(resource).toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) && await this.isVideoNodeFile(resource)
			? { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT }
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT };
	}

	/**
	 * Whether a node file is a video node. With a `version` of the file the
	 * answer is kept, so that a node file that never gets a card, beyond what a
	 * canvas shows, is not read again at every drawing. A file that cannot be
	 * read as a node is not one.
	 */
	private async isVideoNodeFile(resource: URI, version?: string): Promise<boolean> {
		const key = resource.toString();
		const known = version === undefined ? undefined : this.newNodeKinds.get(key);
		if (known && known.version === version) {
			return known.video;
		}
		let video = false;
		try {
			const content = await this.fileService.readFile(resource, { limits: { size: BASEHALF_CANVAS_NEW_NODE_READ_LIMIT } });
			video = parseBaseHalfNodeDocumentBytes(content.value.buffer).kind === 'video';
		} catch {
			// Not a node BaseHalf can read: its card is drawn at the default size.
		}
		if (version !== undefined) {
			if (this.newNodeKinds.size >= BASEHALF_CANVAS_NEW_NODE_KINDS_KEPT) {
				this.newNodeKinds.clear();
			}
			this.newNodeKinds.set(key, { version, video });
		}
		return video;
	}

	/**
	 * A change the user made on this canvas writes its layout, and the places
	 * that wait are saved with it. When that fails it is logged: the user's own
	 * change is reported by its own write.
	 */
	private async saveWaitingCanvasPlacesWithUserChange(folder: IBaseHalfCanvasFolderState): Promise<void> {
		try {
			await this.chosenCanvasPlaces.saveWithUserChange(folder);
		} catch (error) {
			this.logService.warn(error);
		}
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
		// A layout that changes on disk while an item of this folder, or the
		// folder itself, is being recognized at a new path is drawn with it.
		if (this.holdRenderForMovedItems()) {
			return;
		}
		const generation = ++this.canvasLayoutReconcileGeneration;
		void this.reconcileCurrentCanvasLayout(generation).then(reconciled => {
			if (!reconciled && !this.disposed) {
				this.renderForDiskChange();
			}
		}).catch(error => {
			if (!this.disposed) {
				this.logService.warn(error);
				// The folder may be gone because it was just moved: that is not drawn as an error.
				this.renderForDiskChange();
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
		// Taken before the layout is read, as in a full drawing.
		const waitingPlaces = this.chosenCanvasPlaces.waitingFor(folder);
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
			badges: this.renderedBadges,
			relationships: this.renderedRelationships,
			// A card whose place is not saved yet stays where it was drawn.
			waiting: waitingPlaces,
			pathKey: this.canvasPathKey(folder)
		});
		this.renderedLayoutRows = canvas?.cards ?? [];
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
				const document = parseBaseHalfNodeDocumentBytes(raw);
				const folder = this.getCurrentFolder();
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
				// same result to a verification-pending face. Fresh hydration still
				// follows and replaces this retained result if its file went missing.
				const resultPreview = retainsVerifiedResultPreview
					? {
						...(previousPreview.resultMedia ? { resultMedia: previousPreview.resultMedia } : {}),
						...(previousPreview.resultOutputText ? { resultOutputText: previousPreview.resultOutputText } : {}),
						...(previousPreview.resultMissing ? { resultMissing: true as const } : {})
					}
					: folder ? await this.readNodeResultPreview(folder, document, verifyNodeState) : {};
				return {
					kind: 'node',
					document,
					...(verifyNodeState || retainsVerifiedResultPreview ? {} : { verificationPending: true }),
					dirty: this.workingCopyService.isDirty(item.stat.resource),
					...resultPreview
				};
			} catch (error) {
				// A node BaseHalf cannot read, a version 4 node among them, shows
				// that it is unreadable; nothing reads it as something else (D58).
				const reason = !(error instanceof BaseHalfNodeDocumentError)
					? localize('basehalf.canvas.node.unreadableReason', "The node could not be read.")
					: error.earlierVersion !== undefined
						? localize('basehalf.canvas.node.earlierVersion', "An earlier BaseHalf saved this node in a form this version no longer reads.")
						: error.message;
				return {
					kind: 'invalidNode',
					text: reason.slice(0, 240)
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
		if (kind === 'markdown' && item.stat.size !== undefined && item.stat.size > BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES) {
			return { kind: 'richRequired', text: CANVAS_MARKDOWN_FULL_EDITOR_LABEL };
		}
		try {
			// A note is all or nothing: an oversized Markdown file requires the
			// full editor; no partial source may masquerade as the stored projection.
			// The excerpt of any other text needs only the head of the file.
			const contents = await this.fileService.readFile(item.stat.resource, kind === 'markdown'
				? { limits: { size: BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES } }
				: { length: CARD_EXCERPT_READ_BYTES });
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

	private async hydrateCardPreviews(
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
		structuralStamp: IBaseHalfWorkspaceMutationStamp,
		seq: number,
		batch: IBaseHalfCanvasPreviewHydrationBatch
	): Promise<void> {
		// New nodes get a verification-pending face first. A node with a complete
		// cached face keeps that face until fresh verification completes, so its
		// media element is never downgraded to a loading or verification-pending
		// frame during unrelated canvas work.
		const initialItems = items.filter(item => {
			const preview = this.renderedCardPreviewsByPath.get(item.path)?.preview;
			return preview?.kind === 'loading' || preview?.kind === 'nodeLoading';
		});
		if (initialItems.length > 0
			&& !await this.hydrateCardPreviewItems(folder, initialItems, false, structuralStamp, seq, batch)) {
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
			await this.hydrateCardPreviewItems(folder, resultNodes, true, structuralStamp, seq, batch, isCurrent);
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
		if (preview.dirty || (preview.document.result && preview.verificationPending)) {
			return { kind: 'video', actions: Object.freeze([]) };
		}
		return {
			kind: 'video',
			actions: baseHalfVideoCardToolbarActions(preview.document, {
				generating: this.videoGenerationService.isGenerating(item.stat.resource),
				videoExists: preview.resultMissing ? false : undefined
			})
		};
	}

	private async hydrateCardPreviewItems(
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
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
					const preview = await this.readCardPreview(versionedItem, verifyNodeState);
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
					|| this.retainVideoNodeCard(cached, displayedItem, preview, visualKey, hydrationBatch.sceneKey)
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
					didMountElement: () => this.didMountCardElement(currentItem.path, element),
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
		}
		return true;
	}

	/** What a node's card shows of the file the node shows, and whether that file is there. */
	private async readNodeResultPreview(folder: IBaseHalfCanvasFolderState, document: IBaseHalfNodeDocument, verifyIntegrity: boolean): Promise<{
		readonly resultMedia?: IBaseHalfCanvasMediaPreview;
		readonly resultOutputText?: string;
		readonly resultMissing?: true;
	}> {
		const artifact = getBaseHalfNodeResultArtifact(document);
		if (!artifact || !verifyIntegrity) {
			return {};
		}
		const outputPath = artifact.path;
		const resource = joinPath(folder.workspaceFolder, ...outputPath.split('/'));
		let stat: IFileStat;
		try {
			stat = await this.fileService.resolve(resource, { resolveMetadata: true });
		} catch {
			return { resultMissing: true };
		}
		if (stat.isDirectory) {
			return { resultMissing: true };
		}
		const media = mediaPreviewFromArtifact(document.kind, baseHalfReferenceLabel(outputPath));
		if (media) {
			const resolvedResource = media.kind === 'pdf'
				? resource
				: resource.with({ query: `basehalfCanvasVersion=${stat.mtime ?? 0}-${stat.size ?? 0}` });
			return { resultMedia: { text: media.label, mediaKind: media.kind, resource: resolvedResource } };
		}
		const contentKind = baseHalfCanvasContentKindForPath(outputPath, false);
		if (document.kind !== 'file' || (contentKind !== 'text' && contentKind !== 'code')) {
			return {};
		}
		try {
			const contents = (await this.fileService.readFile(resource, { length: CARD_EXCERPT_READ_BYTES })).value;
			const raw = decodeTextExcerpt(contents);
			if (raw === undefined) {
				return {};
			}
			const text = markdownPreviewKind(outputPath) === 'markdown' ? raw : cleanCardPreviewText(outputPath, raw);
			return text ? { resultOutputText: text } : {};
		} catch {
			return { resultMissing: true };
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
		if (!active) {
			this.onDidHideViewControlsEmitter.fire();
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
			const fileName = basename(item.stat.resource);
			const shownName = baseHalfItemDisplayName(fileName, item.kind === 'folder');
			this.inlineEdit = {
				kind: 'rename',
				context,
				resource: item.stat.resource,
				parent: dirname(item.stat.resource),
				path: item.path,
				extension: item.kind === 'folder' ? '' : baseHalfNoteNameExtension(fileName),
				initialValue: shownName,
				value: shownName,
				selectionPending: true
			};
			// Changing a name is not selecting a card: the toolbar of a selected
			// card would stand over the name that is being typed.
			this.canvasScene.select({ cardPaths: [] });
			this.requestRender();
			return;
		}

		const initialPlacement = this.canvasCreatePlacement(placementContext ?? context);
		const createSize = request.kind === 'create' && request.createKind === 'resultNode' && request.resultKind === 'video'
			? { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT }
			: undefined;
		// A point the user named is taken as it is: the card is not moved for
		// other cards or for the edge of the window, and neither is the view. A
		// place BaseHalf computed goes to the nearest open place.
		const placement = request.kind === 'create' && !initialPlacement.pointed
			? this.avoidCanvasCreateOverlap(initialPlacement, request.createKind, createSize)
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
		// The user just created these cards. A card that nobody pointed at is at
		// the end of the canvas, which can be out of sight: it is shown to them.
		this.pendingCanvasReveal = { sceneKey: this.sceneKey(folder), paths, owner: this.captureCanvasPostCreateOwner() };
		this.requestRender();
	}

	/** The part of the canvas that the window shows, in canvas coordinates. */
	private visibleCanvasBounds(): IBaseHalfCanvasBounds {
		const surface = this.surface.getBoundingClientRect();
		const start = this.canvasScene.screenToCanvasPosition(surface.left, surface.top);
		const end = this.canvasScene.screenToCanvasPosition(surface.right, surface.bottom);
		return { x: start.x, y: start.y, width: Math.max(0, end.x - start.x), height: Math.max(0, end.y - start.y) };
	}

	/**
	 * Brings the cards the user just created into view when one of them is not
	 * fully inside the visible part of the canvas. It waits until all of them
	 * are drawn, and does nothing for cards that are in sight already.
	 */
	private revealCreatedCanvasCards(sceneKey: string): void {
		const reveal = this.pendingCanvasReveal;
		if (!reveal) {
			return;
		}
		if (reveal.sceneKey !== sceneKey || !this.isCanvasPostCreateOwnerCurrent(reveal.owner)) {
			this.pendingCanvasReveal = undefined;
			return;
		}
		const items = [...this.renderedItemsByPath.values()];
		const bounds = reveal.paths.map(path => {
			const index = items.findIndex(item => item.path === path);
			return index < 0 ? undefined : baseHalfCanvasItemBounds(items[index], index, items.length);
		});
		if (bounds.some(card => card === undefined)) {
			return;
		}
		this.pendingCanvasReveal = undefined;
		const visible = this.visibleCanvasBounds();
		const inSight = (card: IBaseHalfCanvasBounds) => card.x >= visible.x && card.y >= visible.y
			&& card.x + card.width <= visible.x + visible.width && card.y + card.height <= visible.y + visible.height;
		if (!this.pendingCanvasFit && bounds.some(card => !inSight(card!))) {
			this.pendingCanvasFit = { sceneKey, paths: reveal.paths, owner: reveal.owner, viewportGeneration: this.viewportRestoreGeneration };
		}
	}

	/**
	 * Where a card goes that is created now: the point the user named with the
	 * pointer when the create menu was opened there, and otherwise the middle of
	 * the visible canvas, which is a place BaseHalf computed (canvas card
	 * placement, "Pointing").
	 */
	private canvasCreatePlacement(context: IBaseHalfCanvasActionContext | undefined): {
		readonly screenPosition: { readonly x: number; readonly y: number };
		readonly canvasPosition: { readonly x: number; readonly y: number };
		readonly pointed: boolean;
	} {
		const menu = this.lastCanvasContextMenu;
		const surfaceRect = this.surface.getBoundingClientRect();
		const menuPosition = menu && context && menu.context === context && menu.request.kind === 'pane'
			? menu.createPosition ?? (!isHTMLElement(menu.request.anchor) ? menu.request.anchor : undefined)
			: undefined;
		const screenPosition = menuPosition ?? { x: surfaceRect.left + surfaceRect.width / 2, y: surfaceRect.top + surfaceRect.height / 2 };
		return {
			screenPosition,
			canvasPosition: this.canvasScene.screenToCanvasPosition(screenPosition.x, screenPosition.y),
			pointed: menuPosition !== undefined && !menu?.createPositionComputed
		};
	}

	/**
	 * What two spellings of one path share on this folder's volume, so that a
	 * file renamed in letter case only keeps its row (canvas card placement).
	 */
	private canvasPathKey(folder: IBaseHalfCanvasFolderState): ((path: string) => string) | undefined {
		// Asked once for the folder, not for every row: most volumes that ignore
		// letter case also ignore the Unicode form of a name.
		return this.uriIdentityService.extUri.ignorePathCasing(folder.workspaceFolder)
			? path => path.normalize('NFC').toLowerCase()
			: undefined;
	}

	/**
	 * What a new card must stay clear of on the shown canvas: the cards that are
	 * drawn, and the rows of the layout whose items are gone, which keep their
	 * places (canvas card placement, "Taken").
	 */
	private takenCanvasPlaces(except?: ReadonlySet<string>): IBaseHalfCanvasBounds[] {
		const items = [...this.renderedItemsByPath.values()];
		return [
			...items.flatMap((item, index) => except?.has(item.path) ? [] : [baseHalfCanvasItemBounds(item, index, items.length)]),
			...this.renderedLayoutRows.filter(row => !this.renderedItemsByPath.has(row.path) && !except?.has(row.path))
		];
	}

	private avoidCanvasCreateOverlap(
		placement: { readonly screenPosition: { readonly x: number; readonly y: number }; readonly canvasPosition: { readonly x: number; readonly y: number } },
		kind: BaseHalfCanvasCreateKind,
		sizeOverride?: { readonly width: number; readonly height: number }
	): { readonly screenPosition: { readonly x: number; readonly y: number }; readonly canvasPosition: { readonly x: number; readonly y: number } } {
		const occupied = this.takenCanvasPlaces();
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
		sourceDetail: IBaseHalfCardDetailState | undefined,
		connection?: {
			readonly from: string;
			readonly fromAnchor: IBaseHalfCanvasEdge['from_anchor'];
			readonly toAnchor: IBaseHalfCanvasEdge['to_anchor'];
		}
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
		const path = canvasChildPath(folder.relativePath, name);
		// From a connection, the note's first bytes list the source (D37): the
		// create is the connection.
		let connected: { readonly contents: VSBuffer; readonly edge: IBaseHalfCanvasEdge } | undefined;
		if (connection) {
			const plan = planBaseHalfMarkdownUpstreamEdit('', { kind: 'add', entry: connection.from }, { nodePath: path });
			if (plan.kind !== 'edit') {
				throw new Error(`The new note could not list '${connection.from}' as upstream.`);
			}
			connected = {
				contents: VSBuffer.fromString(plan.text),
				edge: { from: connection.from, from_anchor: connection.fromAnchor, to: path, to_anchor: connection.toAnchor }
			};
		}
		const target = await this.createCanvasEntry(folder, context, name, 'file', canvasPosition, {
			select: false,
			postCreateOwner: createOwner,
			contents: connected?.contents,
			edge: connected?.edge
		});
		if (connected) {
			// Show the new connection now instead of after the file watcher event.
			this.referenceIndexService.acceptSavedContent(
				{ resource: target, workspaceFolder: folder.workspaceFolder, relativePath: path },
				'markdown',
				connected.contents.toString()
			);
		}
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
		// An empty node of its kind; a Video node starts with an empty prompt and
		// the model and settings of the last generation on this computer.
		const generation = kind === 'video' ? this.initialVideoGeneration() : undefined;
		const document = createBaseHalfNodeDocument({
			id: generateUuid(),
			kind,
			title: label,
			...(generation ? { generation } : {})
		});
		if (kind === 'video') {
			this.videoPanelFocusPath = canvasChildPath(folder.relativePath, name);
		}
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
		// Every card has its place, so the PDF's card stays where it is when a
		// sibling is added (canvas card placement).
		const sourceBounds = sourceItem && sourceIndex >= 0
			? baseHalfCanvasItemBounds(sourceItem, sourceIndex, renderedItems.length)
			: undefined;

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
		// The note's first bytes list the PDF as upstream (D37): the create is
		// the connection, so there is no "created but not connected" state.
		const targetPath = canvasChildPath(folder.relativePath, name);
		const contents = VSBuffer.fromString(baseHalfPdfBranchMarkdown(sourceName, selection, {
			sourcePath: cardDetail.relativePath,
			notePath: targetPath
		}));
		const target = await this.createCanvasEntry(folder, context, name, 'file', placement.canvasPosition, {
			contents,
			select: false
		});

		// Frame the PDF's downstream set from the index, including the new note
		// once it is indexed; fall back to the PDF and the new note.
		let fittedPaths: readonly string[] = [cardDetail.relativePath, targetPath];
		try {
			const downstream = this.referenceIndexService.getDownstream({
				resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath: cardDetail.relativePath
			});
			fittedPaths = [...new Set([cardDetail.relativePath, ...downstream.map(entry => entry.node.relativePath), targetPath])];
		} catch (error) {
			// Framing is a view concern and must not turn a successful create
			// into an apparent action failure.
			this.logService.warn('[BaseHalf] failed to read the PDF downstream set for canvas framing', error);
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
		// The name is hidden. The editor comes when the scene mounts this
		// element: until then it stays in the element that is on screen.
		card.classList.add('inline-editing');
		if (this.inlineRenameEditor?.edit !== edit) {
			this.inlineRenameEditor?.store.dispose();
			const host = $('.basehalf-canvas-inline-name-editor');
			const store = new DisposableStore();
			// What is done inside the editor stays in the editor. The scene takes a
			// click on anything of a card for a click on the card and selects it,
			// and it answers a secondary click with the card's menu, which takes
			// the keyboard from the name.
			store.add(this.addDisposableListener(host, 'click', event => event.stopPropagation()));
			store.add(this.addDisposableListener(host, 'contextmenu', event => {
				event.preventDefault();
				event.stopPropagation();
			}));
			this.inlineRenameEditor = { edit, host, store, focus: this.renderInlineNameInput(host, edit, item.kind === 'folder', store) };
		}
	}

	/** The scene has put a card's element into the document in place of the previous one. */
	private didMountCardElement(path: string, element: HTMLElement): void {
		this.cardListenerStores.didMount(path, element);
		this.mountInlineRenameEditor(path, element);
	}

	/**
	 * Puts the rename editor into the card element the scene has just mounted
	 * and gives it the keyboard.
	 */
	private mountInlineRenameEditor(path: string, card: HTMLElement): void {
		const editor = this.inlineRenameEditor;
		if (!editor || editor.edit !== this.inlineEdit || editor.edit.kind !== 'rename' || editor.edit.path !== path
			|| !card.classList.contains('inline-editing')) {
			return;
		}
		if (!card.contains(editor.host)) {
			card.querySelector('.basehalf-canvas-card-caption-identity')?.append(editor.host);
		}
		editor.focus();
	}

	/** Releases the rename editor of an edit that was accepted, cancelled, or replaced. */
	private releaseEndedInlineRenameEditor(): void {
		if (this.inlineRenameEditor && this.inlineRenameEditor.edit !== this.inlineEdit) {
			// The element stays where it is: the card that shows it is replaced
			// by the render that follows.
			this.inlineRenameEditor.store.dispose();
			this.inlineRenameEditor = undefined;
		}
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
		const focus = this.renderInlineNameInput(host, edit, edit.createKind === 'folder', this.inlineEditListeners);
		mainWindow.setTimeout(focus, 0);
	}

	/**
	 * Builds the name input of an inline edit into `host`.
	 * @returns a function that gives the input the keyboard once it is in the
	 * document. An input that lost the keyboard because its card was replaced
	 * gets its caret back.
	 */
	private renderInlineNameInput(host: HTMLElement, edit: BaseHalfCanvasInlineEdit, folder: boolean, store: DisposableStore): () => void {
		host.classList.add('nodrag', 'nopan', 'nowheel');
		const icon = append(host, $(`span.basehalf-canvas-inline-name-icon.codicon.${folder ? 'codicon-folder' : 'codicon-file'}`));
		icon.setAttribute('aria-hidden', 'true');
		const inputHost = append(host, $('.basehalf-canvas-inline-name-input'));
		// A note is renamed by its name: the file keeps the extension it has.
		const noteExtension = edit.kind === 'rename' ? edit.extension : '';
		const fileNameOf = (typed: string) => noteExtension ? baseHalfNoteFileName(typed, noteExtension) : typed;
		// An empty name is refused as it is, before an extension makes it a name.
		const validateTyped = (typed: string) => this.validateCanvasEntryName(
			edit.parent,
			typed.trim().length === 0 ? typed : fileNameOf(typed),
			edit.kind === 'rename' ? edit.resource : undefined
		);
		const inputBox = new InputBox(inputHost, this.contextViewService, {
			ariaLabel: folder
				? localize('basehalf.canvas.folderNameInput', "Folder name. Press Enter to confirm or Escape to cancel.")
				: noteExtension
					? localize('basehalf.canvas.noteNameInput', "Note name. Press Enter to confirm or Escape to cancel.")
					: localize('basehalf.canvas.fileNameInput', "File name. Press Enter to confirm or Escape to cancel."),
			// The editor of a card's name is the name made editable: it has the
			// colors of the caption around it and no frame of its own.
			inputBoxStyles: edit.kind === 'rename'
				? { ...defaultInputBoxStyles, inputBackground: 'transparent', inputForeground: 'inherit', inputBorder: 'transparent' }
				: defaultInputBoxStyles,
			placeholder: folder
				? localize('basehalf.canvas.folderNamePlaceholder', "Folder name")
				: noteExtension
					? localize('basehalf.canvas.noteNamePlaceholder', "Note name")
					: localize('basehalf.canvas.fileNamePlaceholder', "filename.ext")
		});
		store.add(inputBox);
		inputBox.value = edit.value;
		const extension = folder || noteExtension ? '' : extname(URI.file(edit.initialValue));
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
				result = await validateTyped(candidate);
			} catch (error) {
				result = { content: error instanceof Error ? error.message : String(error), type: MessageType.ERROR };
			}
			if (sequence !== validationSequence || this.inlineEdit !== edit) {
				return;
			}
			if (edit.kind === 'rename') {
				// While the name of a card is typed, a name that cannot be used is
				// only marked in the text. The reason is said when Enter is refused:
				// a box that comes and goes with every letter is not editing in place.
				inputBox.hideMessage();
				host.classList.toggle('unusable', result?.type === MessageType.ERROR);
			} else if (result) {
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
			const postCreateOwner = edit.kind === 'create' || keepOpenOnError ? this.captureCanvasPostCreateOwner() : undefined;
			const name = inputBox.value;
			edit.value = name;
			inputBox.disable();
			let validation: { readonly content: string; readonly type: MessageType } | undefined;
			try {
				validation = await validateTyped(name);
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
			if (edit.kind === 'rename' && (name === edit.initialValue || fileNameOf(name) === basename(edit.resource))) {
				this.cancelCanvasInlineEdit(edit);
				return;
			}
			this.inlineEdit = undefined;
			try {
				await this.commitCanvasInlineEdit(edit, fileNameOf(name), postCreateOwner);
				this.lastCanvasContextMenu = undefined;
				this.requestRender();
				// Enter gives the keyboard back to the canvas, as Escape does, so
				// the renamed card answers the keys of a selected card.
				if (edit.kind === 'rename' && postCreateOwner && this.isCanvasPostCreateOwnerCurrent(postCreateOwner)) {
					this.cards.focus({ preventScroll: true });
				}
			} catch (error) {
				this.inlineEdit = edit;
				finishing = false;
				inputBox.enable();
				const failure = error instanceof Error ? error.message : String(error);
				// While the name was being applied, the card may have been drawn
				// without its editor, and a render may have released the editor.
				// The next render shows the editor again, and the failure with it.
				if (inputBox.element.isConnected && (edit.kind !== 'rename' || this.inlineRenameEditor?.edit === edit)) {
					inputBox.showMessage({ content: failure, type: MessageType.ERROR }, true);
					inputBox.focus();
				} else {
					edit.failure = failure;
					this.requestRender();
				}
			}
		};

		store.add(inputBox.onDidChange(value => {
			edit.value = value;
			void refreshValidation();
		}));
		store.add(DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.KEY_DOWN, (event: IKeyboardEvent) => {
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
		store.add(this.addDisposableListener(inputBox.inputElement, 'blur', () => {
			mainWindow.setTimeout(() => {
				if (inputBox.element.isConnected && !finishing && this.inlineEdit === edit
					&& inputBox.inputElement.ownerDocument.activeElement !== inputBox.inputElement) {
					void finish(false);
				}
			}, 0);
		}));
		let validated = false;
		return () => {
			if (this.inlineEdit !== edit || !inputBox.element.isConnected) {
				return;
			}
			const input = inputBox.inputElement;
			if (input.ownerDocument.activeElement !== input) {
				const { selectionStart, selectionEnd: caretEnd, selectionDirection } = input;
				inputBox.focus();
				if (!edit.selectionPending && selectionStart !== null && caretEnd !== null) {
					input.setSelectionRange(selectionStart, caretEnd, selectionDirection ?? undefined);
				}
			}
			if (edit.selectionPending) {
				edit.selectionPending = false;
				inputBox.select({ start: 0, end: selectionEnd });
				// A name longer than its room is shown from its beginning, as the
				// name at rest is.
				input.scrollLeft = 0;
			}
			if (edit.failure !== undefined) {
				inputBox.showMessage({ content: edit.failure, type: MessageType.ERROR }, true);
				edit.failure = undefined;
				validated = true;
			} else if (!validated) {
				// Once for every input: the create editor is built by every render.
				validated = true;
				void refreshValidation();
			}
		};
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
			// A name does not depend on what the file holds: an agent may write a
			// note while its name is edited. The stamp refuses an item that was
			// moved or removed, and one that another operation is changing.
			const gone = localize('basehalf.canvas.rename.gone', "This item was moved or removed while its name was edited.");
			if (!this.workspaceMutationCoordinator.isResourceStampCurrent(edit.context.workspaceFolder, edit.context.stamp)) {
				throw new Error(gone);
			}
			let isDirectory: boolean | undefined;
			try {
				isDirectory = (await this.fileService.stat(edit.resource)).isDirectory;
			} catch {
				// Not there: refused below.
			}
			if (isDirectory !== edit.context.snapshot.isDirectory
				|| !this.workspaceMutationCoordinator.isResourceStampCurrent(edit.context.workspaceFolder, edit.context.stamp)) {
				throw new Error(gone);
			}
			const fileName = basename(edit.resource);
			await this.explorerService.applyBulkEdit([new ResourceFileEdit(edit.resource, target)], {
				undoLabel: localize('basehalf.canvas.rename.undo', "Rename {0} to {1}", fileName, name),
				progressLabel: localize('basehalf.canvas.rename.progress', "Renaming {0}", fileName),
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
			/** The anchor row of a connection the new file's contents carry. */
			readonly edge?: IBaseHalfCanvasEdge;
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
		// A change by the user writes the layout, and the places that wait are
		// saved with it: before, as they were drawn, and after, for a layout that
		// only this write made readable.
		await this.saveWaitingCanvasPlacesWithUserChange(folder);
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
		await this.saveWaitingCanvasPlacesWithUserChange(folder);
		// Anchor memory only: in a marked folder the edge uses default anchors.
		if (options.edge && !await baseHalfIsWorkspaceFolderMarked(this.fileService, folder.workspaceFolder)) {
			try {
				await this.canvasMirrorService.upsertCanvasEdge(folder, options.edge);
			} catch (error) {
				this.logService.warn(`[BaseHalf] could not remember the anchors of ${options.edge.from} -> ${options.edge.to}`, error);
			}
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

		// The user pointed at a place: the group keeps its block there, and a card
		// whose slot is taken goes to the nearest open place (canvas card placement).
		const paths = transfers.map(transfer => canvasChildPath(folder.relativePath, basename(transfer.target)));
		// A card that was moved here keeps the size it had: its row came along.
		// A new card has the size of its kind, which for a node file is read.
		let carried = new Map<string, IBaseHalfCanvasCard>();
		try {
			carried = new Map(((await this.canvasMirrorService.readCanvas(folder))?.cards ?? []).map(row => [row.path, row]));
		} catch (error) {
			this.logService.warn(error);
		}
		const sizes = await Promise.all(transfers.map(async (transfer, index) => {
			const row = carried.get(paths[index]);
			if (row) {
				return { width: row.width, height: row.height };
			}
			return transfer.kind === 'folder'
				? { width: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT }
				: await this.sizeOfNewFileCard(transfer.target);
		}));
		const places = baseHalfCanvasTransferPlaces(canvasPosition, sizes, this.takenCanvasPlaces(new Set(paths)));
		await this.saveWaitingCanvasPlacesWithUserChange(folder);
		for (let index = 0; index < transfers.length; index++) {
			const transfer = transfers[index];
			const path = paths[index];
			try {
				await this.canvasMirrorService.updateCardGeometry(folder, {
					path,
					kind: transfer.kind,
					...places[index],
					...sizes[index]
				});
			} catch (error) {
				this.logService.warn(error);
				this.queueCanvasWarning(localize('basehalf.canvas.importGeometryFailed', "The items were imported, but some canvas positions could not be saved."));
			}
		}
		await this.saveWaitingCanvasPlacesWithUserChange(folder);
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
		const card = $('.basehalf-canvas-card');
		// The element this one replaces stays on screen, with its listeners,
		// until the scene mounts this one.
		const listeners = this.cardListenerStores.replace(item.path, card);
		const presentationListeners = new MutableDisposable<DisposableStore>();
		listeners.add(presentationListeners);
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
			? `${item.path} - click to select; double-click to open the file it shows`
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
		const badgeIssueCount = (item.relationships?.issueCount ?? 0) + (this.renderedBadgeProblems.has(item.path) ? 1 : 0);
		card.classList.toggle('has-reference-issues', badgeIssueCount > 0);
		card.dataset.referenceIssueCount = String(badgeIssueCount);
		const issueText = badgeIssueCount === 0
			? ''
			: badgeIssueCount === 1
				? localize('basehalf.canvas.card.oneIssue', "1 issue")
				: localize('basehalf.canvas.card.issues', "{0} issues", badgeIssueCount);
		card.setAttribute('aria-label', `${displayName} card${orphan ? ', missing' : ''}${issueText ? `, ${issueText}` : ''}`);
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
		// The name is the file name of a file that is there: a double click on
		// it renames in place. A video card shows the title of its document.
		label.classList.toggle('renamable', !orphan && !resultNode);
		if (!orphan && !resultNode) {
			// The name is text. A click on it selects no card: the first click of
			// the double click that edits it would bring the card's toolbar up
			// over the name. A drag from it still moves the card.
			listeners.add(this.addDisposableListener(label, 'click', event => event.stopPropagation()));
		}
		const captionActions = append(caption, $('.basehalf-canvas-card-caption-actions'));
		if (canShowBadgeFace) {
			this.renderCardBadgeToggle(captionActions, item, badgeIssueCount, listeners);
		}
		const content = append(card, $('.basehalf-canvas-card-content'));
		this.renderInlineRenameEditor(card, item);
		this.renderedCardElementsByPath.set(item.path, card);

		// What the card shows. The card of a Video node takes the new state of its
		// node in place (retainVideoNodeCard).
		const shown = { item, preview };
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
			// A Video card that is selected or deselected keeps its player: only
			// the player's controls come and go.
			if (renderedPresentation !== undefined && renderedPresentation !== 'shell' && presentationLevel !== 'shell'
				&& !badgeOpen && isVideoNodePreview(shown.preview) && this.videoCardBodies.has(card)) {
				renderedPresentation = presentationLevel;
				card.dataset.previewLevel = presentationLevel;
				this.updateVideoNodePreview(card, shown.item, shown.preview, presentationLevel === 'interactive');
				return;
			}
			renderedPresentation = presentationLevel;
			card.dataset.previewLevel = presentationLevel;
			const nextListeners = new DisposableStore();
			presentationListeners.value = nextListeners;
			clearNode(content);
			if (presentationLevel === 'shell') {
				return;
			}

			const active = append(content, $('.basehalf-canvas-card-active'));
			const body = append(active, $('.basehalf-canvas-card-body'));
			if (badgeOpen && canShowBadgeFace) {
				this.renderCardBadgeFace(body, item, nextListeners);
			} else {
				this.renderCardPreview(body, shown.item, shown.preview, orphan, presentationLevel === 'interactive', nextListeners, card);
			}
			this.renderFolderCoverage(active, shown.item, shown.preview);
			this.restorePendingCanvasBadgeFocus(card, item.path);
		};
		this.cardPresentationUpdaters.set(card, updatePresentation);
		if (isVideoNodePreview(preview)) {
			this.videoCardRetainers.set(card, (nextItem, nextPreview) => {
				shown.item = nextItem;
				shown.preview = nextPreview;
				const name = cardDisplayName(nextItem, nextPreview);
				label.textContent = name;
				label.title = name;
				if (renderedPresentation !== undefined && renderedPresentation !== 'shell' && !badgeOpen) {
					this.updateVideoNodePreview(card, nextItem, nextPreview, renderedPresentation === 'interactive');
				}
			});
		}
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
				if (resultNode) {
					this.selectCard(item.path);
					const folder = this.getCurrentFolder();
					if (folder) {
						this.cancelPendingNodeActivation();
						void this.openResultNodeContent(folder, item);
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
				case 'add-upstream':
					// Read-only upstream-only cards have no Add Upstream: fall back to Add Downstream.
					target = card.dataset.previewLevel !== 'shell'
						? card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-add-reference') ?? card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-add-downstream')
						: undefined;
					break;
				case 'add-downstream':
					target = card.dataset.previewLevel !== 'shell'
						? card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-add-downstream')
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
		badgeIssueCount: number,
		listeners: DisposableStore
	): void {
		const badgeOpen = this.openBadgeFaces.has(item.path);
		const relationships = item.relationships;
		const connected = !!relationships && (relationships.upstream.length > 0 || relationships.downstream.length > 0);
		const upstreamIssues = relationships?.issueCount ?? 0;
		const summary = connected || upstreamIssues > 0
			? baseHalfCanvasConnectionSummary({
				upstream: relationships?.upstream.length ?? 0,
				downstream: this.renderedIndexState === 'building' ? undefined : relationships?.downstream.length ?? 0,
				issues: upstreamIssues,
				incomplete: this.renderedIndexState === 'partial'
			})
			: undefined;
		const badgeToggle = append(container, $('button.basehalf-canvas-card-badge-toggle')) as HTMLButtonElement;
		badgeToggle.classList.add('nodrag', 'nopan', 'nowheel');
		badgeToggle.type = 'button';
		const action = badgeOpen
			? localize('basehalf.canvas.badge.hide', "Hide the badge - back to the preview")
			: item.badge?.description ? localize('basehalf.canvas.badge.edit', "Has a badge - edit it") : localize('basehalf.canvas.badge.show', "Edit Badge");
		badgeToggle.title = summary ? `${summary} - ${action}` : action;
		badgeToggle.setAttribute('aria-label', summary
			? localize('basehalf.canvas.badge.ariaSummary', "{0} badge for {1}, {2}", badgeOpen ? localize('basehalf.canvas.badge.hideVerb', "Hide") : localize('basehalf.canvas.badge.showVerb', "Show"), item.path, summary)
			: localize('basehalf.canvas.badge.aria', "{0} badge for {1}", badgeOpen ? localize('basehalf.canvas.badge.hideVerb', "Hide") : localize('basehalf.canvas.badge.showVerb', "Show"), item.path));
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
		} else if (item.badge?.description && connected) {
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
		renderBaseHalfItemGlyph(container, type, tone, size);
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
		title.textContent = localize('basehalf.canvas.node.unreadable', "Unreadable node");
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
		card.dataset.nodeLifecycle = preview.document.result ? 'result' : preview.document.task ? 'task' : 'empty';
		if (preview.document.kind === 'video') {
			this.renderVideoNodePreview(container, item, preview, interactive, listeners, card);
			return;
		}
		const result = append(container, $('.basehalf-canvas-node-result'));
		const resultLabel = append(result, $('.basehalf-canvas-node-result-label'));
		resultLabel.textContent = localize('basehalf.canvas.node.result', "Result");
		if (preview.resultMedia) {
			const media = append(result, $('.basehalf-canvas-node-result-media'));
			this.renderMediaPreview(media, { kind: 'media', ...preview.resultMedia }, interactive, listeners);
		} else {
			const resultValue = append(result, $('.basehalf-canvas-node-result-value'));
			resultValue.textContent = nodePreviewResultLabel(preview);
			resultValue.title = resultValue.textContent;
		}
		this.renderNodeActions(container, item, preview, listeners);
	}

	/**
	 * The card of a Video node, drawn by the Video card module in every phase
	 * (video node, "The card"). The card follows a generation in this window by
	 * itself, and continues one that the node's file records and no window
	 * follows.
	 */
	private renderVideoNodePreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: BaseHalfCanvasNodePreview,
		interactive: boolean,
		listeners: DisposableStore,
		card: HTMLElement
	): void {
		const handle = renderBaseHalfVideoCard(container, this.videoCardInput(item, preview, interactive), { hoverService: this.hoverService, generationService: this.videoGenerationService });
		listeners.add(handle);
		this.videoCards.set(item.path, handle);
		this.videoCardBodies.set(card, handle);
		listeners.add(toDisposable(() => {
			if (this.videoCards.get(item.path) === handle) {
				this.videoCards.delete(item.path);
			}
			if (this.videoCardBodies.get(card) === handle) {
				this.videoCardBodies.delete(card);
			}
		}));
		this.applyVideoNodeCardState(card, preview);
	}

	/** Shows a newer state of a Video node, or the card selected or not, in the Video card drawn in `card`. */
	private updateVideoNodePreview(card: HTMLElement, item: IBaseHalfCanvasItem, preview: BaseHalfCanvasNodePreview, interactive: boolean): void {
		const handle = this.videoCardBodies.get(card);
		if (!handle) {
			return;
		}
		card.dataset.nodeLifecycle = preview.document.result ? 'result' : preview.document.task ? 'task' : 'empty';
		handle.update(this.videoCardInput(item, preview, interactive));
		this.applyVideoNodeCardState(card, preview);
	}

	private videoCardInput(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasNodePreview, interactive: boolean): IBaseHalfVideoCardInput {
		const video = this.videoFileOf(item, preview);
		return {
			resource: item.stat.resource,
			title: preview.document.title,
			fields: preview.document,
			...(video ? { video } : {}),
			...(preview.resultMissing ? { videoExists: false } : {}),
			interactive
		};
	}

	private applyVideoNodeCardState(card: HTMLElement, preview: BaseHalfCanvasNodePreview): void {
		card.dataset.videoPhase = baseHalfVideoNodePhase(preview.document);
		card.classList.toggle('empty-video-draft', card.dataset.videoPhase === 'empty');
		card.setAttribute('aria-label', localize('basehalf.canvas.videoCard.label', "{0}, Video", preview.document.title));
	}

	// --- the Video node panel (D58, video node, "The panel") ---------------------------------

	/** The provider, model, mode, and values a new Video node starts with: those of the last generation on this computer, made legal for the model. */
	private initialVideoGeneration(): IBaseHalfVideoGeneration | undefined {
		const catalog = this.videoCatalogService.state;
		return baseHalfVideoInitialGeneration(this.videoProviderSettings.getLastUsed(), catalog.kind === 'ready' ? catalog.catalog : undefined);
	}

	/** The video file a Video node shows, in its workspace folder. */
	private videoFileOf(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined): URI | undefined {
		if (preview?.kind !== 'node' || !preview.document.result) {
			return undefined;
		}
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(item.stat.resource)?.uri;
		return workspaceFolder ? joinPath(workspaceFolder, ...preview.document.result.artifact.path.split('/')) : undefined;
	}

	/** Whether the card shows a Video node; a node whose preview is still loading counts when `loading` says so. */
	private isVideoNodeCard(path: string, loading: boolean): boolean | 'loading' {
		if (!this.renderedItemsByPath.has(path)) {
			return false;
		}
		const preview = this.renderedCardPreviewsByPath.get(path)?.preview;
		if (preview?.kind === 'node') {
			return preview.document.kind === 'video';
		}
		return loading && preview?.kind === 'nodeLoading' ? 'loading' : false;
	}

	/** Shows the panel for a single selected Video card and closes it for any other selection. */
	private followSelectionWithVideoPanel(sceneKey: string, paths: readonly string[]): void {
		const token = ++this.videoPanelSelectionToken;
		this.videoPanelWanted = undefined;
		const path = paths.length === 1 ? paths[0] : undefined;
		const video = path !== undefined ? this.isVideoNodeCard(path, true) : false;
		if (path === undefined || video === false) {
			void this.closeVideoPanel();
			return;
		}
		if (video === 'loading') {
			void this.closeVideoPanel();
			this.videoPanelWanted = { sceneKey, path, token };
			return;
		}
		const show = (): void => {
			if (this.disposed || token !== this.videoPanelSelectionToken || !this.isCurrentSceneKey(sceneKey)) {
				return;
			}
			// A drag that selected the card keeps the panel away until the pointer is released.
			if (this.canvasScene.isInteracting()) {
				mainWindow.requestAnimationFrame(show);
				return;
			}
			this.showVideoPanel(sceneKey, path);
		};
		show();
	}

	/** After a render: follows a selection the render applied, and keeps the open panel on its card. */
	private syncVideoPanelAfterRender(sceneKey: string, appliedSelection: readonly string[] | undefined): void {
		if (appliedSelection) {
			this.followSelectionWithVideoPanel(sceneKey, appliedSelection);
		}
		const pendingNode = this.pendingVideoNodeSelection;
		if (pendingNode && pendingNode.sceneKey === sceneKey && this.renderedItemsByPath.has(pendingNode.path)) {
			this.pendingVideoNodeSelection = undefined;
			this.canvasScene.select({ cardPaths: [pendingNode.path] });
			this.followSelectionWithVideoPanel(sceneKey, [pendingNode.path]);
		}
		const wanted = this.videoPanelWanted;
		if (wanted && (wanted.token !== this.videoPanelSelectionToken || wanted.sceneKey !== sceneKey)) {
			this.videoPanelWanted = undefined;
		} else if (wanted && this.isVideoNodeCard(wanted.path, false) === true) {
			this.videoPanelWanted = undefined;
			this.showVideoPanel(sceneKey, wanted.path);
		}
		const mount = this.videoPanel;
		if (!mount) {
			return;
		}
		if (mount.sceneKey !== sceneKey || this.canvasNavigationService.state.cardDetail || this.isVideoNodeCard(mount.path, true) === false) {
			void this.closeVideoPanel();
			return;
		}
		this.publishVideoPanel(mount);
	}

	private showVideoPanel(sceneKey: string, path: string): void {
		const current = this.videoPanel;
		if (current && current.sceneKey === sceneKey && current.path === path) {
			this.publishVideoPanel(current);
			return;
		}
		void this.closeVideoPanel();
		const item = this.renderedItemsByPath.get(path);
		if (!item) {
			return;
		}
		const focusPrompt = this.videoPanelFocusPath === path;
		if (focusPrompt) {
			this.videoPanelFocusPath = undefined;
		}
		const store = new DisposableStore();
		const panel = store.add(this.instantiationService.createInstance(BaseHalfVideoNodePanel, item.stat.resource, this.videoPanelHost(sceneKey, path), { focusPromptWhenShown: focusPrompt }));
		const mount: IBaseHalfVideoPanelMount = { sceneKey, path, panel, store };
		this.videoPanel = mount;
		store.add(panel.onDidChangeHeight(() => this.publishVideoPanel(mount)));
		this.publishVideoPanel(mount);
	}

	private publishVideoPanel(mount: IBaseHalfVideoPanelMount): void {
		if (this.videoPanel !== mount) {
			return;
		}
		this.canvasScene.setVideoPanelSurface({
			sceneKey: mount.sceneKey,
			structuralEpoch: this.renderedSceneStructuralEpoch,
			path: mount.path,
			element: mount.panel.element,
			screenHeight: mount.panel.height
		});
	}

	/** Saves the panel's prompt and takes the panel away. */
	private async closeVideoPanel(): Promise<void> {
		const mount = this.videoPanel;
		if (!mount) {
			return;
		}
		this.videoPanel = undefined;
		this.cancelVideoInputPick();
		this.canvasScene.clearVideoPanelSurface(mount.panel.element);
		try {
			await mount.panel.flush();
		} catch (error) {
			this.logService.warn(error);
		} finally {
			mount.store.dispose();
		}
	}

	private videoPanelHost(sceneKey: string, path: string): IBaseHalfVideoNodePanelHost {
		return {
			pickCard: () => this.pickCardForVideoInput(path),
			importFile: () => this.importFileForVideoInput(path),
			focusCard: () => this.renderedCardElementsByPath.get(path)?.closest<HTMLElement>('.react-flow__node')?.focus({ preventScroll: true }),
			didGenerateInNode: resource => this.selectVideoNodeWhenDrawn(sceneKey, resource)
		};
	}

	/** Selects a Video node that Generate made beside another, once its card is drawn. */
	private selectVideoNodeWhenDrawn(sceneKey: string, resource: URI): void {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey || !this.uriIdentityService.extUri.isEqual(dirname(resource), folder.resource)) {
			return;
		}
		const path = canvasChildPath(folder.relativePath, basename(resource));
		if (this.renderedItemsByPath.has(path)) {
			this.canvasScene.select({ cardPaths: [path] });
			this.followSelectionWithVideoPanel(sceneKey, [path]);
			return;
		}
		this.pendingVideoNodeSelection = { sceneKey, path };
		this.requestRender();
	}

	/**
	 * Pick on Canvas: the next click on a card connects it to the Video node.
	 * The gesture of that click never reaches the canvas, so it selects or
	 * moves nothing. A click on the blank canvas or Escape cancels; a click on
	 * the node itself or on a folder keeps waiting.
	 */
	private pickCardForVideoInput(targetPath: string): Promise<string | undefined> {
		this.cancelVideoInputPick();
		return new Promise<string | undefined>(resolve => {
			const store = new DisposableStore();
			const pick = {
				store,
				finish: (path: string | undefined) => {
					if (this.videoInputPick !== pick) {
						return;
					}
					this.videoInputPick = undefined;
					store.dispose();
					resolve(path);
				}
			};
			this.videoInputPick = pick;
			// The panel says what the next click does, where the user chose Pick on Canvas.
			this.cards.dataset.videoInputPickActive = 'true';
			store.add(toDisposable(() => delete this.cards.dataset.videoInputPickActive));
			let pressedPath: string | undefined | null = null;
			const onPointer = (event: Event): void => {
				const target = event.target;
				if (!DOM.isHTMLElement(target) && !DOM.isSVGElement(target)) {
					return;
				}
				if (!this.cards.contains(target) || target.closest('.bh-video-panel')) {
					return;
				}
				event.preventDefault();
				event.stopImmediatePropagation();
				if (event.type === 'pointerdown') {
					pressedPath = target.closest<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]')?.dataset.basehalfCardPath;
					return;
				}
				if (event.type !== 'click' || pressedPath === null) {
					return;
				}
				const path = pressedPath;
				pressedPath = null;
				if (path === undefined) {
					pick.finish(undefined);
				} else if (path !== targetPath && this.renderedItemsByPath.get(path)?.stat.isDirectory !== true) {
					pick.finish(path);
				}
			};
			const targetDocument = this.cards.ownerDocument;
			for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
				store.add(DOM.addDisposableListener(targetDocument, type, onPointer, true));
			}
			store.add(DOM.addDisposableListener(targetDocument, 'keydown', event => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopImmediatePropagation();
					pick.finish(undefined);
				}
			}, true));
		});
	}

	private cancelVideoInputPick(): void {
		this.videoInputPick?.finish(undefined);
	}

	/** Import File… of the Video panel: copies the chosen file into the node's folder and returns its path. */
	private async importFileForVideoInput(targetPath: string): Promise<string | undefined> {
		const item = this.renderedItemsByPath.get(targetPath);
		const folder = this.getCurrentFolder();
		if (!item || !folder) {
			return undefined;
		}
		const picked = await this.fileDialogService.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			title: localize('basehalf.canvas.video.importInput', "Import a File for the Video Node"),
			openLabel: localize('basehalf.canvas.video.importInputButton', "Import"),
			filters: [{
				name: localize('basehalf.canvas.video.importInputFilter', "Images, Videos, Audio, and Text"),
				extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'mp4', 'mov', 'm4v', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'md', 'markdown', 'txt']
			}]
		});
		const source = picked?.[0];
		if (!source) {
			return undefined;
		}
		const nodeFolder = dirname(item.stat.resource);
		const name = basename(source);
		if (this.uriIdentityService.extUri.isEqual(dirname(source), nodeFolder)) {
			return canvasChildPath(folder.relativePath, name);
		}
		const dot = name.lastIndexOf('.');
		const stem = dot > 0 ? name.slice(0, dot) : name;
		const extension = dot > 0 ? name.slice(dot) : '';
		for (let number = 1; number < 1000; number++) {
			const candidate = number === 1 ? name : `${stem} ${number}${extension}`;
			const target = joinPath(nodeFolder, candidate);
			if (await this.fileService.exists(target)) {
				continue;
			}
			await this.fileService.copy(source, target, false);
			return canvasChildPath(folder.relativePath, candidate);
		}
		return undefined;
	}

	/** Capture Frame: writes the frame as a PNG beside the node; its card appears to the right of the video card. */
	private async captureVideoFrame(folder: IBaseHalfCanvasFolderState, item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined, frame: BaseHalfCanvasSceneVideoFrame): Promise<void> {
		const video = this.videoFileOf(item, preview);
		if (!video || preview?.kind !== 'node') {
			return;
		}
		let image: URI;
		try {
			image = await captureBaseHalfVideoFrame(this.fileService, {
				video,
				node: item.stat.resource,
				title: preview.document.title,
				frame,
				currentTime: this.videoCards.get(item.path)?.currentTime
			}, createBaseHalfVideoFrameReader(mainWindow));
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning(localize('basehalf.canvas.video.captureFailed', "BaseHalf could not capture that frame: {0}", error instanceof Error ? error.message : String(error)));
			this.requestRender();
			return;
		}
		await this.placeNewCardBeside(folder, item.path, image);
	}

	/** Gives the card of a new file a place right of another card, or the next open place there. */
	private async placeNewCardBeside(folder: IBaseHalfCanvasFolderState, besidePath: string, resource: URI): Promise<void> {
		const path = canvasChildPath(folder.relativePath, basename(resource));
		try {
			if (await baseHalfIsWorkspaceFolderMarked(this.fileService, folder.workspaceFolder)) {
				return;
			}
			const layout = await this.canvasMirrorService.readCanvas(folder);
			const beside = layout?.cards.find(card => card.path === besidePath);
			if (!layout || !beside) {
				return;
			}
			const size = { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT };
			const place = baseHalfCanvasOpenPosition({ x: beside.x + beside.width + BASEHALF_CANVAS_GRID_COLUMN_GAP, y: beside.y }, size, layout.cards.filter(card => card.path !== path));
			await this.canvasMirrorService.updateCardGeometry(folder, { path, kind: 'file', x: place.x, y: place.y, ...size });
		} catch (error) {
			this.logService.warn(`[BaseHalf] could not place ${path} beside ${besidePath}`, error);
		}
	}

	/**
	 * The one action of an image, audio, file, PDF, or presentation node: an
	 * empty node takes a file the user brings in, and a node with a file opens it.
	 */
	private renderNodeActions(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>,
		listeners: DisposableStore
	): void {
		const document = preview.document;
		const actions = append(container, $('.basehalf-canvas-node-actions'));
		const action = append(actions, $('button.basehalf-canvas-node-action')) as HTMLButtonElement;
		action.classList.add('nodrag', 'nopan', 'nowheel');
		action.type = 'button';
		const opens = !!document.result;
		action.textContent = opens
			? localize('basehalf.canvas.node.open', "Open")
			: localize('basehalf.canvas.node.import', "Import {0}", canvasResultNodeKindLabel(document.kind));
		const unavailable = opens ? preview.resultMissing === true : preview.dirty;
		action.setAttribute('aria-disabled', String(unavailable));
		action.title = opens && preview.resultMissing
			? localize('basehalf.canvas.node.fileMissing', "The file this node shows is missing: {0}", document.result?.artifact.path ?? '')
			: action.textContent;
		action.setAttribute('aria-label', action.title);
		listeners.add(this.addDisposableListener(action, 'pointerdown', event => event.stopPropagation()));
		listeners.add(this.addDisposableListener(action, 'dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		}));
		listeners.add(this.addDisposableListener(action, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			if (action.getAttribute('aria-disabled') === 'true') {
				return;
			}
			this.selectCard(item.path);
			const folder = this.getCurrentFolder();
			if (opens && folder) {
				void this.openResultNodeContent(folder, item);
			} else if (!opens) {
				void this.importCanvasNodeResult(item);
			}
		}));
	}

	/**
	 * Brings a file the user chooses into an empty node as its result (Upload
	 * Video for a Video node): the file is copied to `assets/<node id>/` in the
	 * workspace folder and the node records it. Only a node with no result and,
	 * for a Video node, no generation takes one.
	 */
	private async importCanvasNodeResult(item: IBaseHalfCanvasItem): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder || this.canvasNavigationService.state.cardDetail) {
			return;
		}
		try {
			if (this.workingCopyService.isDirty(item.stat.resource)) {
				throw new Error(localize('basehalf.canvas.import.dirty', "Save {0} before importing a file into it.", item.name));
			}
			const content = await this.fileService.readFile(item.stat.resource, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			const document = parseBaseHalfNodeDocumentBytes(content.value.buffer);
			if (document.result || document.task) {
				throw new Error(localize('basehalf.canvas.import.notEmpty', "{0} already shows a file or has a generation. Import into a new empty node.", document.title));
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
		const importLabel = localize('basehalf.canvas.node.import', "Import {0}", canvasResultNodeKindLabel(document.kind));
		const resources = await this.fileDialogService.showOpenDialog({
			title: importLabel,
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
			if (this.workingCopyService.isDirty(item.stat.resource)) {
				throw new Error(localize('basehalf.canvas.import.dirty', "Save {0} before importing a file into it.", item.name));
			}
			const stat = await this.fileService.resolve(source, { resolveMetadata: true });
			if (!stat.isFile || stat.isSymbolicLink) {
				throw new Error(localize('basehalf.canvas.import.notFile', "Choose a regular file."));
			}
			const importedKind = baseHalfCanvasContentKindForPath(basename(source), false);
			if (!baseHalfNodeAcceptsContentKind(document.kind, importedKind)) {
				throw new Error(localize('basehalf.canvas.import.wrongKind', "Choose a file of the node's kind. {0} is not one.", basename(source)));
			}
			const incrementalNaming = this.configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
			const target = await findValidPasteFileTargetForResource(
				this.fileService,
				this.dialogService,
				joinPath(folder.workspaceFolder, 'assets', document.id),
				{ resource: source, isDirectory: false, allowOverwrite: false },
				incrementalNaming === 'disabled' ? 'smart' : incrementalNaming
			);
			if (!target) {
				return;
			}
			const targetPath = this.uriIdentityService.extUri.relativePath(folder.workspaceFolder, target);
			if (!targetPath || await this.fileService.exists(target)) {
				throw new Error(localize('basehalf.canvas.import.targetTaken', "The file could not be copied into this folder."));
			}
			const copied = await this.fileService.copy(source, target, false);
			const artifact: IBaseHalfNodeArtifact = { kind: document.kind, path: targetPath, size: copied.size };
			try {
				await this.fileService.writeFileWithExpectedContents(
					item.stat.resource,
					VSBuffer.fromString(serializeBaseHalfNodeDocument(importBaseHalfNodeResult(document, artifact))),
					expectedContents,
					{ atomic: { postfix: '.basehalf-node-import-tmp' } }
				);
			} catch (error) {
				throw new Error(localize('basehalf.canvas.import.changed', "{0} changed before the import could be saved. The copied file {1} was kept.", item.name, targetPath), { cause: error });
			}
			this.contextViewService.hideContextView();
			this.requestRender();
		} catch (error) {
			this.logService.warn(error);
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
		}
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
				const name = baseHalfItemDisplayName(child.name, child.kind === 'folder');
				label.textContent = child.kind === 'folder' ? `${name}/` : name;
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
		const markdownPreview = this.shownMarkdownPreview(path);
		if (!folder || !item || !card || !renderedCard || !mount
			|| !isBaseHalfMarkdownResource(item.stat.resource)
			|| baseHalfCanvasMarkdownEditTarget(item.stat.size, markdownPreview) !== 'inline'
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
		// The editor builds every block, and the projection under it stays the
		// frame its closing reveals: it holds every part too (note rendering).
		buildAllBaseHalfCanvasNoteParts(mount.fallback);
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
				onFormatStateChange: formatState => this.publishCanvasNoteFormatState(path, item.stat.resource, formatState),
				onSelectionChange: () => this.agentSelectionCardTextReader.schedule()
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
			// The resting note stays the shown projection until here, and a wheel
			// may have scrolled it since the editor began to open.
			active.instance.setScrollTop(active.fallback.scrollTop);
			active.instance.setSidewaysScroll(readBaseHalfCanvasMarkdownSidewaysScroll(active.fallback));
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
		const rendering = renderBaseHalfCanvasNoteInParts(
			container,
			resource,
			text,
			href => this.openStaticMarkdownPreviewLink(href)
		);
		if (rendering) {
			listeners.add(rendering);
		} else {
			appendCanvasNoteFullEditorLabel(container);
		}
	}

	/** The text of a note whose whole projection its card holds, if it holds one. */
	private shownMarkdownPreview(path: string): string | undefined {
		const preview = this.renderedCardPreviewsByPath.get(path)?.preview;
		return preview?.kind === 'markdown' ? preview.text : undefined;
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
		const node: IBaseHalfBadgeNode = {
			resource: item.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: item.path,
			kind: item.kind
		};

		this.renderBadgeEditorContent(body, node, item.badge, this.renderedBadgeProblems.get(item.path), {
			upstream: this.renderedUpstreamViews.get(item.path),
			downstream: this.renderedIndexState === 'building' ? [] : this.referenceIndexService.getDownstream(node),
			indexState: this.renderedIndexState
		}, mutationGuard,
		disposable => listeners.add(disposable),
		focusTarget => {
			this.pendingCanvasBadgeFocus = { path: item.path, target: focusTarget };
			this.requestRender();
		});
	}

	/**
	 * The shared badge editor — description, Upstream, Downstream — used by
	 * both the canvas card's flip face and the card detail's badge zone. The two
	 * surfaces differ only in their container chrome and listener lifetime, so
	 * they hand in a listener sink and a refresh callback. The node's own
	 * Upstream list is editable; the Downstream list is derived from the other
	 * nodes' stores (D37).
	 */
	private renderBadgeEditorContent(
		body: HTMLElement,
		node: IBaseHalfBadgeNode,
		badge: IBaseHalfCanvasBadgeMetadata | undefined,
		ownProblem: IBaseHalfBadgeReadProblem | undefined,
		connections: IBaseHalfBadgeEditorConnections,
		mutationGuard: IBaseHalfCanvasMutationGuard,
		addListener: (disposable: IDisposable) => void,
		refresh: (focusTarget: BaseHalfBadgeEditorFocusTarget) => void
	): IBaseHalfBadgeEditorControls {
		let prompt: HTMLTextAreaElement | undefined;
		if (ownProblem) {
			// The file system refuses to read the description's own storage, so
			// there is no description to edit. Say why in place of the field and
			// offer nothing that leads into `.bh/`: users are never sent to a
			// hidden file. A badge whose content cannot be read never gets
			// here: it reads as absent and the description field stays usable.
			const issueSection = append(body, $('.basehalf-canvas-card-badge-section.reference-issues'));
			issueSection.setAttribute('data-testid', 'badge-metadata-issue');
			const heading = append(issueSection, $('.basehalf-canvas-card-badge-issues-title'));
			heading.textContent = localize('basehalf.canvas.badge.descriptionIssue', "Description can't be read");
			const row = append(issueSection, $('.basehalf-canvas-card-badge-issue-row'));
			const message = append(row, $('span.basehalf-canvas-card-badge-issue-message'));
			message.textContent = localize('basehalf.canvas.badge.descriptionUnavailable', "BaseHalf could not load it: {0}", ownProblem.message);
		} else {
			prompt = this.renderBadgeDescriptionPrompt(body, node, badge, mutationGuard, addListener);
			this.renderBadgeDescriptionRecovery(body, node, addListener, refresh);
		}

		const context = this.upstreamActionContext(this.getCurrentFolder(), () => this.scheduleBackgroundRender());
		const controls = this.upstreamActions.renderConnections(body, {
			node,
			upstream: connections.upstream,
			downstream: connections.downstream,
			indexState: connections.indexState,
			context,
			addListener,
			openNode: relativePath => this.openWorkspaceRelative(node.workspaceFolder, relativePath),
			refresh: focus => {
				this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath);
				refresh(focus);
			}
		});
		return { ...(prompt ? { prompt } : {}), ...controls };
	}

	private renderBadgeDescriptionPrompt(
		body: HTMLElement,
		node: IBaseHalfBadgeNode,
		badge: IBaseHalfCanvasBadgeMetadata | undefined,
		mutationGuard: IBaseHalfCanvasMutationGuard,
		addListener: (disposable: IDisposable) => void
	): HTMLTextAreaElement {
		const prompt = append(body, $('textarea.basehalf-canvas-card-badge-prompt')) as HTMLTextAreaElement;
		prompt.value = badge?.description ?? '';
		prompt.placeholder = node.kind === 'folder'
			? localize('basehalf.canvas.badge.descriptionPlaceholderFolder', "One line about this folder…")
			: localize('basehalf.canvas.badge.descriptionPlaceholderFile', "One line about this file…");
		prompt.rows = 1;
		prompt.spellcheck = false;
		prompt.setAttribute('aria-label', localize('basehalf.canvas.badge.descriptionLabel', "Description of {0}", node.relativePath));
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
		return prompt;
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

	/**
	 * Writes a node's one-line description to its `badge.yaml` (under the
	 * caller's workspace mutation lease). `badge.yaml` holds no references
	 * (D37); the mirror keeps any legacy reference keys verbatim. An empty
	 * description on an otherwise-empty badge retires it.
	 */
	private writeBadgeDescription(node: IBaseHalfBadgeNode, description: string): Promise<IBaseHalfBadgeFile | null> {
		const trimmed = description.trim();
		return this.badgeMirrorService.patchBadge(node, current => {
			if (current === null && !trimmed) {
				return null;
			}
			const base: IBaseHalfBadgeFile = current ?? { path: node.relativePath, kind: node.kind };
			const next: IBaseHalfBadgeFile = { ...base, description: trimmed || undefined };
			return !next.description && next.orphan !== true ? null : next;
		});
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
			await this.writeBadgeDescription(live.get(node.relativePath)!, writtenValue);
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

	private renderTruncated(heldBack: number): void {
		const truncated = append(this.canvasOverlay, $('.basehalf-canvas-truncated'));
		truncated.textContent = `+${heldBack} more`;
	}

	private renderCanvasWarning(message: string): void {
		const warnings = [...this.canvasOverlay.querySelectorAll<HTMLElement>('.basehalf-canvas-warning')];
		const duplicate = warnings.some(warning => warning.textContent === message);
		if (duplicate) {
			return;
		}
		const warning = append(this.canvasOverlay, $('.basehalf-canvas-warning'));
		warning.style.top = `${58 + warnings.length * 30}px`;
		warning.textContent = message;
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
		this.queueCanvasWarning(baseHalfUserFacingErrorMessage(error));
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
		if (chromeHidden) {
			this.onDidHideViewControlsEmitter.fire();
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
			if (wasOpen) {
				// Selected Notes were rendered as static previews underneath the detail
				// surface. Recreate the retained cards once so the static selected Note
				// and its controls are current when detail closes.
				this.renderedCardsByPath = new Map();
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
			button.textContent = baseHalfItemDisplayName(basename(cardDetail.resource), false);
			button.title = localize('basehalf.cardDetail.rename', "Rename...");
			button.setAttribute('aria-label', localize('basehalf.cardDetail.renameFile', "Rename {0}", baseHalfItemDisplayName(basename(cardDetail.resource), false)));
			this.detailTitleDisposables.add(this.addDisposableListener(button, 'click', () => {
				this.pendingDetailNameEditResourceKey = resourceKey;
				this.requestRender();
			}));
			return;
		}

		// A note is renamed by its name, as on its card (canvas card name).
		const fileName = basename(cardDetail.resource);
		const noteExtension = baseHalfNoteNameExtension(fileName);
		const fileNameOf = (typed: string) => noteExtension ? baseHalfNoteFileName(typed, noteExtension) : typed;
		const initialValue = baseHalfItemDisplayName(fileName, false);
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
			const typed = inputBox.value;
			const result = await this.validateCanvasEntryName(dirname(cardDetail.resource), typed.trim().length === 0 ? typed : fileNameOf(typed), cardDetail.resource);
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

			const name = fileNameOf(inputBox.value);
			if (inputBox.value === initialValue || name === fileName) {
				cancel();
				return;
			}
			const target = joinPath(dirname(cardDetail.resource), name);
			this.pendingDetailNameEditResourceKey = undefined;
			this.pendingDetailEditorFocusResourceKey = target.toString();
			try {
				await this.explorerService.applyBulkEdit([new ResourceFileEdit(cardDetail.resource, target)], {
					undoLabel: localize('basehalf.cardDetail.rename.undo', "Rename {0} to {1}", fileName, name),
					progressLabel: localize('basehalf.cardDetail.rename.progress', "Renaming {0}", fileName),
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
			const extension = noteExtension ? '' : extname(cardDetail.resource);
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
					{ onSelectionChange: selected => this.setAgentSelectionDetailText('rich', selected) }
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
						status => this.setDetailSaveStatus(status),
						selected => this.setAgentSelectionDetailText('source', selected)
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
		// The projection shown now decides what agents can see.
		this.reportAgentSelection();
	}

	private disposeDetailSurfaces(): void {
		this.detailSwapSeq++;
		this.activeDetailProjection = undefined;
		this.detailSurfaceResourceKey = undefined;
		for (const surface of this.detailSurfaces.values()) {
			surface.store.dispose();
		}
		this.detailSurfaces.clear();
		if (this.agentSelectionDetailText.size > 0) {
			this.agentSelectionDetailText.clear();
			this.reportAgentSelection();
		}
	}

	private setAgentSelectionDetailText(projection: BaseHalfCardDetailProjection, selected: IBaseHalfAgentSelectionText | undefined): void {
		if (selected) {
			this.agentSelectionDetailText.set(projection, selected);
		} else if (!this.agentSelectionDetailText.delete(projection)) {
			return;
		}
		this.reportAgentSelection();
	}

	/**
	 * Tells the record of the selection agents can see what is selected now:
	 * the folder of the canvas, its selected cards, the card Card Detail
	 * shows, and the text selected in the note being edited.
	 */
	private reportAgentSelection(): void {
		if (this.disposed) {
			return;
		}
		const folder = this.getCurrentFolder();
		if (!folder) {
			this.agentSelectionService.update(undefined);
			return;
		}
		const detail = this.canvasNavigationService.state.cardDetail;
		const sceneKey = this.sceneKey(folder);
		// In the canvas's list order: folders first, then by name.
		const cards = (this.agentSelectionCards.sceneKey === sceneKey ? this.agentSelectionCards.paths : [])
			.map(path => {
				const item = this.renderedItemsByPath.get(path);
				return { path, isFolder: item?.kind === 'folder', name: item?.name ?? path.slice(path.lastIndexOf('/') + 1), caption: this.agentSelectionCaption(path) };
			})
			.sort((a, b) => a.isFolder !== b.isFolder ? (a.isFolder ? -1 : 1) : a.name.localeCompare(b.name))
			.map(({ path, isFolder, caption }) => ({ path, isFolder, caption }));
		let text: IBaseHalfAgentSelectionText | undefined;
		if (detail) {
			const detailText = this.activeDetailProjection ? this.agentSelectionDetailText.get(this.activeDetailProjection) : undefined;
			text = detailText?.path === detail.relativePath ? detailText : undefined;
		} else {
			const cardText = this.agentSelectionCardText;
			text = cardText && this.activeCanvasNoteEditor?.path === cardText.path ? cardText : undefined;
		}
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(folder.workspaceFolder);
		this.agentSelectionService.update({
			workspaceFolder: folder.workspaceFolder,
			workspaceFolderName: workspaceFolder?.name ?? basename(folder.workspaceFolder),
			folderPath: folder.relativePath || '.',
			cards,
			detail: detail && this.uriIdentityService.extUri.isEqual(detail.workspaceFolder, folder.workspaceFolder) ? { path: detail.relativePath, isFolder: false, caption: this.agentSelectionCaption(detail.relativePath) } : undefined,
			text
		});
	}

	/** The name and glyph a card's caption shows, while the canvas has the card. */
	private agentSelectionCaption(path: string): IBaseHalfAgentSelectionCaption | undefined {
		const item = this.renderedItemsByPath.get(path);
		if (!item) {
			return undefined;
		}
		const preview = this.renderedCardPreviewsByPath.get(path)?.preview;
		const icon = preview?.kind === 'node' ? preview.document.kind : preview?.kind === 'nodeLoading' ? 'generic' : badgeType(item.name, item.kind === 'folder');
		return { name: cardDisplayName(item, preview), icon };
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
		let ownProblem: IBaseHalfBadgeReadProblem | undefined;
		let upstream: IBaseHalfUpstreamView | undefined;
		try {
			// The description lives in badge.yaml; the connections come from the
			// node's own store, read directly so the Upstream list never depends
			// on enumeration (D37).
			const badgeRead = await this.badgeMirrorService.readBadges([node]);
			badge = badgeRead.badges.get(node.relativePath) ?? null;
			ownProblem = badgeRead.problems.find(problem => problem.relativePath === node.relativePath);
			if (ownProblem) {
				this.logService.warn(`BaseHalf badge metadata issue for ${ownProblem.relativePath}: ${ownProblem.detail}`);
			}
			try {
				upstream = await this.referenceIndexService.readUpstream(node);
			} catch (error) {
				this.logService.warn(`BaseHalf card detail upstream list unreadable for ${node.relativePath}`, error);
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
				retry.title = localize('basehalf.cardDetail.badge.unavailable', "Badge unavailable - retry");
				retry.setAttribute('aria-label', localize('basehalf.cardDetail.badge.unavailableAria', "Badge unavailable. Retry"));
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
		// the file carries a note or connections, ghost while empty.
		const indexState = this.referenceIndexService.getState(node.workspaceFolder);
		const downstream = indexState === 'building' ? [] : this.referenceIndexService.getDownstream(node);
		const upstreamCount = upstream?.entries.filter(entry => entry.status === 'valid').length ?? 0;
		const upstreamIssueCount = upstream?.issueCount ?? 0;
		const badgeIssueCount = upstreamIssueCount + (ownProblem ? 1 : 0);
		const hasRelationships = upstreamCount > 0 || downstream.length > 0;
		const hasContent = !!badgeForDisplay?.description?.trim() || hasRelationships || badgeIssueCount > 0;
		const connectionSummary = hasRelationships || upstreamIssueCount > 0 || indexState === 'building'
			? this.upstreamActions.summary(upstream, downstream, indexState)
			: undefined;
		toggle.classList.toggle('issue', badgeIssueCount > 0);
		toggle.setAttribute('data-reference-issue-count', String(badgeIssueCount));
		const toggleAction = open ? localize('basehalf.cardDetail.badge.hide', "Hide Badge") : localize('basehalf.cardDetail.badge.show', "Show Badge");
		toggle.title = connectionSummary ? `${connectionSummary} - ${toggleAction}` : toggleAction;
		toggle.setAttribute('aria-label', connectionSummary ? `${toggleAction}, ${connectionSummary}` : toggleAction);
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
			// "↑N upstream · ↓M downstream · K issues", after the description.
			const description = badgeForDisplay?.description;
			summary.textContent = description && connectionSummary
				? `${description} · ${connectionSummary}`
				: description ?? connectionSummary ?? localize('basehalf.cardDetail.badge.descriptionPlaceholder', "One line about this file…");
			summary.classList.toggle('empty', !description && !connectionSummary);
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
			ownProblem,
			{ upstream, downstream, indexState },
			this.resourceMutationGuard(cardDetail.workspaceFolder, structuralStamp, resourceIdentity),
			disposable => this.detailBadgeDisposables.add(disposable),
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
					: focusEditorControl === 'add-upstream'
						? editorControls.addUpstream ?? editorControls.addDownstream
						: editorControls.addDownstream;
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


	/**
	 * Puts cards back at the places of their rows, also a card that was moved
	 * again since, as one change of the layout and one step of undo. Only
	 * places go back: a size that changed since stays, a card that is gone is
	 * passed over, and a place that BaseHalf had chosen is again a chosen row
	 * (IBaseHalfCanvasView.restoreCardPlaces).
	 */
	private async restoreCanvasCardPlaces(sceneKey: string, previous: ReadonlyMap<string, IBaseHalfCanvasCard>, undoLabel: string): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey) {
			return;
		}
		const structuralEpoch = this.renderedSceneStructuralEpoch;
		const shown = new Set(this.renderedSceneCards.map(card => card.path));
		let reverted: IBaseHalfCanvasStateTransition | undefined;
		await this.workspaceMutationCoordinator.runSceneMutation(
			folder.workspaceFolder,
			this.sceneMutationStamp(folder, structuralEpoch),
			async lease => {
				await this.chosenCanvasPlaces.saveWithUserChange(folder, lease);
				const current = await this.canvasMirrorService.readCanvas(folder);
				const cards: IBaseHalfCanvasCardStateTransition[] = [];
				for (const [path, before] of previous) {
					const now = current?.cards.find(card => card.path === path);
					if (!now || !shown.has(path) || (now.x === before.x && now.y === before.y && now.auto === before.auto)) {
						continue;
					}
					// The row is again what it was: a place that BaseHalf had
					// chosen is again a chosen row.
					cards.push({
						path,
						expected: now,
						next: { path, kind: now.kind, x: before.x, y: before.y, width: now.width, height: now.height, ...(before.auto ? { auto: true as const } : {}) }
					});
				}
				if (cards.length > 0) {
					reverted = { cards };
					await this.canvasMirrorService.transitionCanvasState(folder, reverted, lease);
				}
			}
		);
		const transition = reverted;
		if (transition?.cards) {
			const rows = new Map(transition.cards.map(card => [card.path, card.next!]));
			const nodes = [...rows.values()].map(row => ({ path: row.path, kind: row.kind }));
			this.supersedeCanvasReadsBeforeGeometryCommit();
			this.pushCanvasUndoElement(
				undoLabel,
				folder,
				nodes,
				[],
				(reverse, lease) => this.applyCanvasGeometryTransition(folder, nodes, transition, reverse, lease)
			);
			if (this.isCurrentSceneKey(sceneKey) && this.renderedSceneStructuralEpoch === structuralEpoch) {
				this.renderedSceneCards = Object.freeze(this.renderedSceneCards.map(card => {
					const row = rows.get(card.path);
					return row ? { ...card, x: row.x, y: row.y } : card;
				}));
				this.canvasScene.update({
					key: sceneKey,
					structuralEpoch,
					revision: this.renderSeq,
					cards: this.renderedSceneCards,
					edges: this.renderedSceneEdges
				});
			}
		}
	}

	/** Shows the canvas of the scene at a viewport the user had, and saves it as theirs (IBaseHalfCanvasView.setViewport). */
	private async showCanvasViewport(sceneKey: string, viewport: IBaseHalfCanvasSceneViewport): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey) {
			return;
		}
		this.viewportRestoreGeneration++;
		const { x, y, zoom } = viewport;
		await this.canvasScene.setViewportCenter((this.cards.clientWidth / 2 - x) / zoom, (this.cards.clientHeight / 2 - y) / zoom, zoom);
		if (this.isCurrentSceneKey(sceneKey)) {
			this.scheduleViewportPersist(0, 'user', { folder, viewport: this.canvasScene.getViewport() });
		}
	}

	/**
	 * Shows the zoom on the canvas, whose sizes in screen pixels follow it, and
	 * tells the features of the canvas when it changed.
	 */
	private updateCanvasZoomChrome(): void {
		const zoom = normalizeCanvasZoom(this.canvasZoom);
		this.canvasZoom = zoom;
		this.root.style.setProperty('--basehalf-canvas-zoom', String(zoom));
		this.root.dataset.zoom = String(zoom);
		if (zoom !== this.reportedCanvasZoom) {
			this.reportedCanvasZoom = zoom;
			this.onDidChangeZoomEmitter.fire(zoom);
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
		this.viewportRestoreGeneration++;
		const sceneKey = this.sceneKey(folder);
		void this.canvasScene.fit(undefined, {
			padding: 0.12,
			maxZoom: 1
		}).then(() => {
			if (this.isCurrentSceneKey(sceneKey)) {
				this.scheduleViewportPersist(0, 'user', { folder, viewport: this.canvasScene.getViewport() });
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
		this.viewportRestoreGeneration++;
		const folder = this.getCurrentFolder();
		const sceneKey = folder ? this.sceneKey(folder) : undefined;
		this.canvasZoom = nextZoom;
		this.updateCanvasZoomChrome();
		void this.canvasScene.setZoom(nextZoom).then(() => {
			if (folder && sceneKey && this.isCurrentSceneKey(sceneKey)) {
				this.scheduleViewportPersist(0, 'user', { folder, viewport: this.canvasScene.getViewport() });
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


	/** Canvas-space center of the visible area, independent of window size.
	 *  Undefined while the canvas has no size: that center would be wrong. */
	private canvasViewportCenter(viewport: IBaseHalfCanvasSceneViewport): { x: number; y: number } | undefined {
		const width = this.root.clientWidth;
		const height = this.root.clientHeight;
		if (width <= 0 || height <= 0 || !(viewport.zoom > 0)) {
			return undefined;
		}
		return {
			x: roundCanvasPosition((width / 2 - viewport.x) / viewport.zoom),
			y: roundCanvasPosition((height / 2 - viewport.y) / viewport.zoom)
		};
	}

	private scheduleViewportPersist(
		delay: number,
		source: BaseHalfCanvasViewportSource,
		context?: { readonly folder: IBaseHalfCanvasFolderState; readonly viewport: IBaseHalfCanvasSceneViewport }
	): void {
		const folder = context?.folder ?? this.getCurrentFolder();
		if (!folder) {
			return;
		}
		const viewport = context?.viewport ?? this.canvasScene.getViewport();
		const center = this.canvasViewportCenter(viewport);
		if (!center) {
			return;
		}
		if (source !== 'auto') {
			this.autoFramedViewport = undefined;
		}
		const sceneKey = this.sceneKey(folder);
		const structuralStamp = this.workspaceMutationCoordinator.capture(folder.workspaceFolder);
		const settled: IBaseHalfCanvasViewport = { x: center.x, y: center.y, zoom: viewport.zoom, source };
		this.viewportPersister.schedule(delay, {
			folder: folder.resource,
			viewport: settled,
			// A write whose scene is no longer current, or whose workspace saw a
			// structural change (its folder may have moved), is dropped: it
			// would recreate a key the move forgot.
			isCurrent: () => this.isCurrentSceneKey(sceneKey)
				&& this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)
		});
	}

	/**
	 * Restore the folder's stored viewport once per scene, or fit its content
	 * when none is stored. The first restore of a workspace folder waits
	 * (bounded) for the legacy viewport import so an imported viewport is not
	 * missed by a race with cleanup.
	 */
	private restoreFolderViewport(folder: IBaseHalfCanvasFolderState): void {
		if (this.canvasNavigationService.state.cardDetail) {
			return;
		}

		const sceneKey = this.sceneKey(folder);
		if (this.restoredViewportSceneKey === sceneKey) {
			return;
		}

		this.restoredViewportSceneKey = sceneKey;
		const generation = this.viewportRestoreGeneration;
		void (async () => {
			const outcome = await baseHalfOpenCanvasViewport(this.viewportStateService, folder.resource, folder.workspaceFolder, {
				isCurrent: () => this.isViewportRestoreCurrent(sceneKey, generation),
				restore: stored => this.applyStoredViewport(sceneKey, stored),
				fit: () => this.frameFreshFolderView(folder, sceneKey),
				persistFit: () => {
					this.scheduleViewportPersist(0, 'auto', { folder, viewport: this.canvasScene.getViewport() });
					this.autoFramedViewport = { sceneKey, generation };
				}
			});
			if (outcome === 'stale'
				&& !this.disposed
				&& this.restoredViewportSceneKey === sceneKey
				&& this.isCurrentSceneKey(sceneKey)
				&& generation === this.viewportRestoreGeneration) {
				// Only Card Detail blocked it: retry on the next canvas render.
				this.restoredViewportSceneKey = undefined;
			}
		})().catch(error => this.logService.error(error));
	}

	private isViewportRestoreCurrent(sceneKey: string, generation: number): boolean {
		return !this.disposed
			&& this.isCurrentSceneKey(sceneKey)
			&& generation === this.viewportRestoreGeneration
			&& !this.canvasNavigationService.state.cardDetail;
	}

	private async applyStoredViewport(sceneKey: string, stored: IBaseHalfCanvasViewport): Promise<void> {
		const zoom = normalizeCanvasZoom(stored.zoom);
		this.canvasZoom = zoom;
		this.updateCanvasZoomChrome();
		this.autoFramedViewport = undefined;
		this.programmaticViewportSceneKey = sceneKey;
		try {
			await this.canvasScene.setViewportCenter(stored.x, stored.y, zoom);
		} finally {
			if (this.programmaticViewportSceneKey === sceneKey) {
				this.programmaticViewportSceneKey = undefined;
			}
		}
	}

	private async frameFreshFolderView(folder: IBaseHalfCanvasFolderState, sceneKey: string): Promise<void> {
		const maxZoom = Math.min(1, this.defaultCanvasZoom(folder));
		this.programmaticViewportSceneKey = sceneKey;
		try {
			await this.canvasScene.fit(undefined, { maxZoom, padding: 0.12 });
		} finally {
			if (this.programmaticViewportSceneKey === sceneKey) {
				this.programmaticViewportSceneKey = undefined;
			}
		}
	}

	/** A legacy viewport imported after this scene's automatic first fit wins
	 *  over it, as long as the user has not changed the viewport since. */
	private onDidImportViewports(folders: readonly URI[]): void {
		const auto = this.autoFramedViewport;
		const folder = this.getCurrentFolder();
		if (!auto || !folder || !this.isViewportRestoreCurrent(auto.sceneKey, auto.generation)) {
			return;
		}
		if (!folders.some(imported => this.uriIdentityService.extUri.isEqual(imported, folder.resource))) {
			return;
		}
		const stored = this.viewportStateService.get(folder.resource);
		if (stored?.source !== 'import') {
			return;
		}
		void this.applyStoredViewport(auto.sceneKey, stored).catch(error => this.logService.error(error));
	}

	private defaultCanvasZoom(folder: IBaseHalfCanvasFolderState): number {
		return normalizeBaseHalfCanvasZoom(this.configurationService.getValue(BaseHalfSetting.CanvasDefaultZoom, { resource: folder.resource }));
	}
}

registerWorkbenchContribution2(BaseHalfCanvasWorkbenchContribution.ID, BaseHalfCanvasWorkbenchContribution, WorkbenchPhase.AfterRestored);

const BASEHALF_CANVAS_ZOOM_STEP = 0.1;
/** The key of the scene the canvas shows when no folder is open. */
const BASEHALF_CANVAS_NO_FOLDER_SCENE_KEY = 'no-folder';

/**
 * Runs every step whose condition holds, in order, also after one fails, and
 * returns every failure so none hides the first one.
 */
async function settleEveryStep(steps: readonly (readonly [boolean, () => Promise<void>])[]): Promise<readonly unknown[]> {
	const errors: unknown[] = [];
	for (const [applies, step] of steps) {
		if (!applies) {
			continue;
		}
		try {
			await step();
		} catch (error) {
			errors.push(error);
		}
	}
	return errors;
}

/**
 * The head of a text file. The head may end inside a character; streaming
 * leaves that character out instead of refusing the head.
 */
function decodeTextExcerpt(contents: VSBuffer): string | undefined {
	try {
		const raw = new TextDecoder('utf-8', { fatal: true }).decode(contents.buffer, { stream: true });
		return raw.includes('\u0000') ? undefined : raw;
	} catch {
		return undefined;
	}
}

function reverseCanvasStateTransition(transition: IBaseHalfCanvasStateTransition, reverse: boolean): IBaseHalfCanvasStateTransition {
	if (!reverse) {
		return transition;
	}
	return {
		cards: transition.cards?.map(card => ({ ...card, expected: card.next, next: card.expected })),
		edges: transition.edges?.map(edge => ({ ...edge, expected: edge.next, next: edge.expected }))
	};
}

function reverseDocumentTransitions(
	transitions: readonly IBaseHalfCanvasNodeDocumentTransition[],
	reverse: boolean
): readonly IBaseHalfCanvasNodeDocumentTransition[] {
	return reverse
		? transitions.map(transition => ({ ...transition, expected: transition.next, next: transition.expected }))
		: transitions;
}

function canvasStateTransitionChangesAnything(transition: IBaseHalfCanvasStateTransition): boolean {
	return (transition.cards ?? []).some(card => !canvasCardsEqual(card.expected, card.next))
		|| (transition.edges ?? []).some(edge => !canvasEdgesEqual(edge.expected, edge.next));
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

function normalizeCanvasZoom(value: number): number {
	return Number(normalizeBaseHalfCanvasZoom(value).toFixed(4));
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

function mediaPreviewFromArtifact(kind: BaseHalfNodeKind, label: string): { readonly kind: 'image' | 'video' | 'audio' | 'pdf'; readonly label: string } | undefined {
	if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
		return { kind, label };
	}
	return undefined;
}

/** The label a Note card shows instead of a note it cannot show. */
function appendCanvasNoteFullEditorLabel(container: HTMLElement): void {
	const label = append(container, $('span.basehalf-canvas-note-empty.basehalf-canvas-note-full-editor-required'));
	label.setAttribute('data-testid', 'canvas-note-full-editor-required');
	label.textContent = CANVAS_MARKDOWN_FULL_EDITOR_LABEL;
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

function isVideoNodePreview(preview: BaseHalfCanvasCardPreview | undefined): preview is BaseHalfCanvasNodePreview {
	return preview?.kind === 'node' && preview.document.kind === 'video';
}

function cardDisplayName(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined): string {
	return preview?.kind === 'node' ? preview.document.title : baseHalfItemDisplayName(item.name, item.kind === 'folder');
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
	return localize('basehalf.canvas.node.empty', "Empty");
}

function nodePreviewResultLabel(preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>): string {
	if (preview.document.result && preview.resultMissing) {
		return localize('basehalf.canvas.node.missing', "The file is missing");
	}
	return preview.verificationPending && !!preview.document.result
		? localize('basehalf.canvas.node.checking', "Checking the file…")
		: nodeResultLabel(preview.document, preview.resultOutputText);
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

function badgeType(label: string, isFolder: boolean): BaseHalfItemKindIcon {
	return baseHalfItemIcon(label, isFolder);
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
