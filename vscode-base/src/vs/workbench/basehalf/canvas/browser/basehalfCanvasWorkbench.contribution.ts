/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasWorkbench.css';

import * as DOM from '../../../../base/browser/dom.js';
import { $, append, isHTMLElement, isSVGElement } from '../../../../base/browser/dom.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isEqualOrParent, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { RedoCommand, UndoCommand } from '../../../../editor/browser/editorExtensions.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IDialogService, IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IExplorerService } from '../../../contrib/files/browser/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorsOrder, SideBySideEditor } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IBaseHalfCanvasCard, IBaseHalfCanvasItem } from '../common/basehalfCanvasModel.js';
import { IBaseHalfBadgeFile, IBaseHalfBadgeMirrorService, IBaseHalfBadgeNode, IBaseHalfBadgeReadProblem } from '../../references/common/basehalfBadgeMirror.js';
import { BaseHalfCanvasChosenPlaces } from '../common/basehalfCanvasChosenPlaces.js';
import { IBaseHalfReferenceEditService } from '../../references/common/basehalfReferenceEdit.js';
import { baseHalfUpstreamIdentity, IBaseHalfUpstreamIdentity } from '../../references/common/basehalfReferenceEntries.js';
import { BaseHalfReferenceIndexState, IBaseHalfReferenceIndexService, IBaseHalfUpstreamView } from '../../references/common/basehalfReferenceIndex.js';
import { BaseHalfUpstreamActions, IBaseHalfUpstreamActionNode } from '../../references/browser/basehalfUpstreamActions.js';
import { IBaseHalfCanvasAppearanceService } from '../common/basehalfCanvasAppearance.js';
import { BaseHalfCanvasCardListenerStores } from '../common/basehalfCanvasCardListeners.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { baseHalfIsMirrorSubtree, baseHalfMirrorRoot, baseHalfRemapSubtreeRel } from '../../workspace/common/basehalfMirrorTree.js';
import { IBaseHalfMovedItemsService } from '../../workspace/common/basehalfMovedItemsService.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService, IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfCanvasNoteFocusLeaseOwner, BaseHalfCanvasNoteFormatSelectionBarrier, IBaseHalfCanvasNoteFocusLease } from '../common/basehalfCanvasNoteFormatLifecycle.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE, IBaseHalfCanvasEditingService } from '../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasActionContext, IBaseHalfCanvasActionContextService, isBaseHalfCanvasActionContext } from '../common/basehalfCanvasActionContext.js';
import { BaseHalfCanvasViewportPersister, IBaseHalfCanvasViewportStateService } from '../common/basehalfCanvasViewportState.js';
import { BaseHalfCardDetailProjection, IBaseHalfCardProjectionRegistryService } from '../../cardDetail/common/basehalfCardDetail.js';
import { IBaseHalfAgentSelectionService, IBaseHalfAgentSelectionText } from '../../agentArea/common/basehalfAgentSelection.js';
import { baseHalfUserFacingErrorMessage } from '../../shell/common/basehalfPlainFailureReason.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IBaseHalfVideoCatalogService, IBaseHalfVideoGenerationService, IBaseHalfVideoProviderSettingsService } from '../../video/common/basehalfVideoGeneration.js';
import { BaseHalfCanvasPreviewHydrationQueue, BaseHalfCanvasPreviewVerificationQueue } from '../common/basehalfCanvasPreviewHydration.js';
import { IBaseHalfCardDetailSurfaceRegistryService } from '../../cardDetail/browser/basehalfCardDetailSurface.js';
import { BaseHalfCanvasReactScene } from './basehalfCanvasReactScene.js';
import { BaseHalfCanvasInteractionRenderGate } from './basehalfCanvasConnectionTransaction.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from '../../navigation/common/basehalfEditorFlush.js';
import {
	BaseHalfCanvasSceneContextMenuRequest,
	BaseHalfCanvasNoteBackground,
	IBaseHalfCanvasNoteFormatState,
	IBaseHalfCanvasSceneCard,
	IBaseHalfCanvasSceneCardPresentation,
	IBaseHalfCanvasSceneEdge
} from '../common/basehalfCanvasScene.js';
import { BASEHALF_CANVAS_OPEN_RESULT_NODE_COMMAND_ID } from './basehalfCanvasContextMenu.js';
import { layoutBaseHalfCanvasCardVideoPlayers } from './basehalfCanvasCardVideoPlayer.js';
import { playBaseHalfCanvasMediaOneAtATime } from './basehalfCanvasCardMedia.js';
import { BaseHalfCanvasCardPreview, BaseHalfCanvasNodePreview } from '../common/basehalfCanvasCardPreview.js';
import { BaseHalfCanvasExtensionsRegistry, IBaseHalfCanvasView, IBaseHalfCanvasViewScene, IBaseHalfCanvasViewSceneChange, IBaseHalfCanvasViewSelection } from './basehalfCanvasExtensions.js';
import { IBaseHalfCanvasResourceDeletionService } from './basehalfCanvasResourceDeletion.js';
import { baseHalfStructuralResourceOutcome, IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationStamp, IBaseHalfWorkspaceResourceMutationStamp } from '../../workspace/common/basehalfWorkspaceMutation.js';
import { BaseHalfCanvasRenderer } from './view/basehalfCanvasRenderer.js';
import { BaseHalfCanvasPreviews } from './view/basehalfCanvasPreviews.js';
import { BaseHalfCanvasCardRenderer } from './view/basehalfCanvasCardRenderer.js';
import { BaseHalfCanvasBadgeEditor } from './view/basehalfCanvasBadgeEditor.js';
import { BaseHalfCanvasNoteEditing } from './view/basehalfCanvasNoteEditing.js';
import { BaseHalfCanvasConnections } from './view/basehalfCanvasConnections.js';
import { BaseHalfCanvasGeometry } from './view/basehalfCanvasGeometry.js';
import { BaseHalfCanvasSelectionActions } from './view/basehalfCanvasSelectionActions.js';
import { BaseHalfCanvasCreation } from './view/basehalfCanvasCreation.js';
import { BaseHalfCanvasCardDetailHost } from './view/basehalfCanvasCardDetailHost.js';
import { BASEHALF_CANVAS_NO_FOLDER_SCENE_KEY, BaseHalfCanvasInlineEdit, IBaseHalfActiveCanvasNoteEditor, IBaseHalfBadgeDescriptionPending, IBaseHalfCanvasCardRenderCacheEntry, IBaseHalfCanvasMutationGuard, IBaseHalfCanvasNotePreviewMount, IBaseHalfCanvasPostCreateOwner, IBaseHalfPendingCanvasNoteFocus, IBaseHalfPendingCanvasNoteFormatCommand, IBaseHalfPendingCanvasNoteNavigationGuard, baseHalfBadgeResourceIdentity, baseHalfCanvasPostCreateOwnerIsCurrent } from './view/basehalfCanvasViewShared.js';

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

interface IBaseHalfCanvasCardPreviewCacheEntry {
	readonly item: IBaseHalfCanvasItem;
	readonly preview: BaseHalfCanvasCardPreview;
}

const BASEHALF_CANVAS_UNDO_REDO_PRIORITY = 115;

const BASEHALF_CANVAS_NOTE_EDITOR_UNDO_REDO_PRIORITY = 10_000;

export class BaseHalfCanvasWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.canvasWorkbench';

	// The parts of the view, one concern each (view/README.md). They come first,
	// so that the fields below can reach them.
	readonly renderer = new BaseHalfCanvasRenderer(this);
	readonly previews = new BaseHalfCanvasPreviews(this);
	readonly cardRenderer = new BaseHalfCanvasCardRenderer(this);
	readonly badgeEditor = new BaseHalfCanvasBadgeEditor(this);
	readonly noteEditing = new BaseHalfCanvasNoteEditing(this);
	readonly connections = new BaseHalfCanvasConnections(this);
	readonly geometry = new BaseHalfCanvasGeometry(this);
	readonly selectionActions = new BaseHalfCanvasSelectionActions(this);
	readonly creation = new BaseHalfCanvasCreation(this);
	readonly cardDetailHost = new BaseHalfCanvasCardDetailHost(this);

	readonly root: HTMLElement;
	readonly createButton: HTMLButtonElement;
	readonly chrome: HTMLElement;
	private readonly viewControls: HTMLElement;
	readonly surface: HTMLElement;
	readonly cards: HTMLElement;
	readonly inlineEditLayer: HTMLElement;
	readonly canvasOverlay: HTMLElement;
	readonly canvasScene: BaseHalfCanvasReactScene;
	readonly detail: HTMLElement;
	readonly detailTitle: HTMLElement;
	readonly detailMeta: HTMLElement;
	readonly detailSaveStatus: HTMLButtonElement;
	readonly detailSaveStatusIcon: HTMLElement;
	readonly detailSaveStatusLabel: HTMLElement;
	readonly detailProjectionActions: HTMLElement;
	readonly detailBadgeZone: HTMLElement;
	readonly detailBody: HTMLElement;
	private readonly editorContainer: HTMLElement;
	readonly cardListenerStores = this._register(new BaseHalfCanvasCardListenerStores());
	readonly inlineEditListeners = this._register(new DisposableStore());
	/**
	 * The rename editor of a card. It lives as long as its edit: a card that
	 * shows it is kept across renders, and a card that is built anew takes it
	 * over when the scene mounts it. The input so keeps the keyboard, its caret,
	 * and a composition while other things on the canvas change.
	 */

	inlineRenameEditor: {
		readonly edit: BaseHalfCanvasInlineEdit;
		readonly host: HTMLElement;
		readonly store: DisposableStore;
		readonly focus: () => void;
	} | undefined;
	readonly canvasUndoRedoSource = BASEHALF_CANVAS_UNDO_REDO_SOURCE;

	renderSeq = 0;
	/** Renders started by `requestRender` that have not resolved yet. */
	rendersInFlight = 0;
	backgroundRenderTimer: number | undefined;
	/** A drawing for what the user did was asked for, and no drawing has been shown since. */
	userRenderOwed = false;
	readonly badgeDescriptionTimers = new Map<string, number>();
	readonly badgeDescriptionPending = new Map<string, IBaseHalfBadgeDescriptionPending>();
	readonly badgeInteractionRenderGate = new BaseHalfCanvasInteractionRenderGate();
	private badgeInteractionReleaseTimer: number | undefined;
	readonly pendingCanvasWarnings: string[] = [];
	/** Badge descriptions (and orphan flags) by path, from the last render. */
	renderedBadges: ReadonlyMap<string, IBaseHalfBadgeFile> = new Map();
	renderedBadgeProblems: ReadonlyMap<string, IBaseHalfBadgeReadProblem> = new Map();
	/** Upstream lists of the rendered cards that have one (open badge faces read theirs from disk). */
	renderedUpstreamViews: ReadonlyMap<string, IBaseHalfUpstreamView> = new Map();
	renderedIndexState: BaseHalfReferenceIndexState | undefined;
	readonly upstreamActions: BaseHalfUpstreamActions;
	readonly detailBadgeDisposables: DisposableStore;
	detailBadgeSeq = 0;
	detailBadgeOpen = false;
	detailBadgeRefreshAfterFocusLeaves = false;
	detailResourceMutationStamp: IBaseHalfWorkspaceResourceMutationStamp | undefined;
	readonly openBadgeFaces = new Set<string>();
	readonly canvasBadgeFocusRefresh: MutableDisposable<IDisposable>;
	renderedItemsByPath = new Map<string, IBaseHalfCanvasItem>();
	renderedCardPreviewsByPath = new Map<string, IBaseHalfCanvasCardPreviewCacheEntry>();
	renderedCardsByPath = new Map<string, IBaseHalfCanvasCardRenderCacheEntry>();
	renderedCardElementsByPath = new Map<string, HTMLElement>();
	renderedSceneCards: readonly IBaseHalfCanvasSceneCard[] = [];
	renderedSceneEdges: readonly IBaseHalfCanvasSceneEdge[] = [];
	readonly cardPresentationUpdaters = new WeakMap<HTMLElement, (presentation: IBaseHalfCanvasSceneCardPresentation) => void>();
	readonly cardPreviewHydrationQueue = new BaseHalfCanvasPreviewHydrationQueue();
	cardPreviewHydrationTimer: number | undefined;
	readonly cardPreviewVerificationQueue = new BaseHalfCanvasPreviewVerificationQueue();
	renderedSceneStructuralEpoch = 0;
	activeDetailProjection: BaseHalfCardDetailProjection | undefined;
	readonly viewportPersister: BaseHalfCanvasViewportPersister;
	/** Bumped by every user viewport change; invalidates stale async restores and fits. */
	viewportRestoreGeneration = 0;
	canvasZoom = 1;
	readonly onDidChangeZoomEmitter = this._register(new Emitter<number>());
	readonly onDidHideViewControlsEmitter = this._register(new Emitter<void>());
	readonly onDidChangeSceneEmitter = this._register(new Emitter<IBaseHalfCanvasViewSceneChange>());
	readonly onDidChangeSelectionEmitter = this._register(new Emitter<IBaseHalfCanvasViewSelection>());
	private readonly onKeyDownEmitter = this._register(new Emitter<KeyboardEvent>());
	private chosenCanvasPlacesInstance: BaseHalfCanvasChosenPlaces | undefined;
	/** The places BaseHalf chose for cards that appeared, until the layout holds them (canvas card placement). */
	get chosenCanvasPlaces(): BaseHalfCanvasChosenPlaces {
		return this.chosenCanvasPlacesInstance ??= new BaseHalfCanvasChosenPlaces(this.fileService, this.canvasMirrorService, this.movedItemsService, this.logService);
	}
	/** The rows of the layout that the shown canvas was last drawn from. A row takes its place also when its item is gone. */
	renderedLayoutRows: readonly IBaseHalfCanvasCard[] = [];
	canvasLayoutReconcileGeneration = 0;
	readonly canvasInteractionEndWaiters = new Set<() => void>();
	inlineEdit: BaseHalfCanvasInlineEdit | undefined;
	canvasInteractionEpoch = 0;
	canvasNavigationEpoch = 0;
	pendingCanvasSelection: IBaseHalfPendingCanvasSelection | undefined;
	/** A node the user just created: its panel takes the focus when it first shows (IBaseHalfCanvasView.takeCreatedNodeFocus). */
	createdNodeFocusPath: string | undefined;
	/** Shows a newer state of its Video node in a card element, which is kept. */
	readonly videoCardRetainers = new WeakMap<HTMLElement, (item: IBaseHalfCanvasItem, preview: BaseHalfCanvasNodePreview) => void>();
	pendingCanvasFit: IBaseHalfPendingCanvasFit | undefined;
	/** Cards the user just created that are shown to them once they are drawn (canvas card placement). */
	pendingCanvasReveal: { readonly sceneKey: string; readonly paths: readonly string[]; readonly owner: IBaseHalfCanvasPostCreateOwner } | undefined;
	fileDragDepth = 0;
	lastCanvasContextMenu: {
		readonly context: IBaseHalfCanvasActionContext;
		readonly request: BaseHalfCanvasSceneContextMenuRequest;
		readonly createPosition?: { readonly x: number; readonly y: number };
		/** The create position is one BaseHalf worked out, not a point the user named with the pointer. */
		readonly createPositionComputed?: boolean;
	} | undefined;
	activeCanvasNoteEditor: IBaseHalfActiveCanvasNoteEditor | undefined;
	canvasNoteSurfacePath: string | undefined;
	/** The selected cards the scene reported last, and its scene (the selection agents can see). */
	agentSelectionCards: { readonly sceneKey: string; readonly paths: readonly string[] } = { sceneKey: '', paths: [] };
	/** Text selected in the note being edited on its card. */
	agentSelectionCardText: IBaseHalfAgentSelectionText | undefined;
	/** Text selected in each projection of Card Detail; the one shown counts. */
	readonly agentSelectionDetailText = new Map<BaseHalfCardDetailProjection, IBaseHalfAgentSelectionText>();
	pendingCanvasNoteFocus: IBaseHalfPendingCanvasNoteFocus | undefined;
	pendingCreatedCanvasNoteActivation: IBaseHalfPendingCreatedCanvasNoteActivation | undefined;
	readonly canvasNotePreviewMounts = new WeakMap<HTMLElement, IBaseHalfCanvasNotePreviewMount>();
	renderedNoteBackgrounds: ReadonlyMap<string, BaseHalfCanvasNoteBackground> = new Map();
	readonly canvasNoteFormatStates = new Map<string, IBaseHalfCanvasNoteFormatState>();
	readonly pendingCanvasNoteFormatCommands: IBaseHalfPendingCanvasNoteFormatCommand[] = [];
	pendingCanvasNoteNavigationGuard: IBaseHalfPendingCanvasNoteNavigationGuard | undefined;
	readonly pendingCanvasSelectionFormatBarrier = new BaseHalfCanvasNoteFormatSelectionBarrier();
	readonly canvasNoteFocusLeaseOwner = new BaseHalfCanvasNoteFocusLeaseOwner();
	disposed = false;

	constructor(
		@IWorkbenchLayoutService public readonly layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService public readonly workspaceContextService: IWorkspaceContextService,
		@IFileService public readonly fileService: IFileService,
		@IInstantiationService public readonly instantiationService: IInstantiationService,
		@ILogService public readonly logService: ILogService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkingCopyService public readonly workingCopyService: IWorkingCopyService,
		@ITextFileService public readonly textFileService: ITextFileService,
		@IBaseHalfBadgeMirrorService public readonly badgeMirrorService: IBaseHalfBadgeMirrorService,
		@IBaseHalfReferenceIndexService public readonly referenceIndexService: IBaseHalfReferenceIndexService,
		@IBaseHalfReferenceEditService public readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfCanvasMirrorService public readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfCanvasAppearanceService public readonly canvasAppearanceService: IBaseHalfCanvasAppearanceService,
		@IBaseHalfCanvasNavigationService public readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IBaseHalfCanvasViewportStateService public readonly viewportStateService: IBaseHalfCanvasViewportStateService,
		@IBaseHalfWorkspaceMutationCoordinator public readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IConfigurationService public readonly configurationService: IConfigurationService,
		@IContextMenuService public readonly contextMenuService: IContextMenuService,
		@IContextViewService public readonly contextViewService: IContextViewService,
		@IDialogService public readonly dialogService: IDialogService,
		@IClipboardService public readonly clipboardService: IClipboardService,
		@IFileDialogService public readonly fileDialogService: IFileDialogService,
		@IExplorerService public readonly explorerService: IExplorerService,
		@IPathService public readonly pathService: IPathService,
		@IUriIdentityService public readonly uriIdentityService: IUriIdentityService,
		@IBaseHalfCanvasEditingService public readonly canvasEditingService: IBaseHalfCanvasEditingService,
		@IBaseHalfCanvasActionContextService public readonly canvasActionContextService: IBaseHalfCanvasActionContextService,
		@IBaseHalfEditorFlushService public readonly editorFlushService: IBaseHalfEditorFlushService,
		@IBaseHalfCardProjectionRegistryService public readonly cardProjectionRegistryService: IBaseHalfCardProjectionRegistryService,
		@IBaseHalfCardDetailSurfaceRegistryService public readonly cardDetailSurfaceRegistryService: IBaseHalfCardDetailSurfaceRegistryService,
		@IBaseHalfCanvasResourceDeletionService public readonly canvasResourceDeletionService: IBaseHalfCanvasResourceDeletionService,
		@IUndoRedoService public readonly undoRedoService: IUndoRedoService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IBaseHalfMovedItemsService public readonly movedItemsService: IBaseHalfMovedItemsService,
		@IBaseHalfAgentSelectionService public readonly agentSelectionService: IBaseHalfAgentSelectionService,
		@IHoverService public readonly hoverService: IHoverService,
		@ICommandService public readonly commandService: ICommandService,
		@IBaseHalfVideoGenerationService public readonly videoGenerationService: IBaseHalfVideoGenerationService,
		@IBaseHalfVideoProviderSettingsService public readonly videoProviderSettings: IBaseHalfVideoProviderSettingsService,
		@IBaseHalfVideoCatalogService public readonly videoCatalogService: IBaseHalfVideoCatalogService
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
			return this.selectionActions.openResultNodeFromActionContext(argument);
		}));
		this.detailBadgeDisposables = this._register(new DisposableStore());
		this.canvasBadgeFocusRefresh = this._register(new MutableDisposable());
		this._register(lifecycleService.onBeforeShutdown(event => event.veto(
			this.badgeEditor.vetoShutdownForUnsavedCanvasDrafts(),
			'veto.basehalfCanvasDrafts'
		)));
		this._register(lifecycleService.onWillShutdown(event => event.join(
			this.badgeEditor.flushAllBadgeDescriptionWrites(),
			{ id: 'join.basehalfBadgeDescriptions', label: localize('join.basehalfBadgeDescriptions', "Saving Badge prompts") }
		)));
		this._register(toDisposable(() => this.selectionActions.cancelCanvasCardPick()));

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
		this._register(this.addDisposableListener(this.createButton, 'click', () => this.selectionActions.showCanvasCreateMenu(this.createButton)));

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
			commitGeometry: (sceneKey, structuralEpoch, geometries, reason) => this.geometry.commitSceneGeometry(sceneKey, structuralEpoch, geometries, reason),
			connect: (sceneKey, structuralEpoch, connection) => this.connections.connectSceneEdge(sceneKey, structuralEpoch, connection),
			showConnectionCreateMenu: (sceneKey, structuralEpoch, drop) => this.connections.showConnectionCreateMenu(sceneKey, structuralEpoch, drop),
			reconnect: (sceneKey, structuralEpoch, intent) => this.connections.reconnectSceneEdge(sceneKey, structuralEpoch, intent),
			removeEdge: (sceneKey, structuralEpoch, edge) => this.connections.removeEdgeFromScene(sceneKey, structuralEpoch, edge),
			performSelectionAction: (sceneKey, structuralEpoch, action, paths) => this.selectionActions.performSceneSelectionAction(sceneKey, structuralEpoch, action, paths),
			cancelPendingCardOpen: () => this.selectionActions.cancelPendingNodeActivation(),
			prepareSelectionChange: (sceneKey, structuralEpoch, paths) => this.selectionActions.prepareSceneSelectionChange(sceneKey, structuralEpoch, paths),
			didChangeSelection: (sceneKey, _structuralEpoch, paths) => {
				this.agentSelectionCards = { sceneKey, paths };
				this.selectionActions.reportAgentSelection();
			},
			focusNoteEditor: (sceneKey, structuralEpoch, path) => this.noteEditing.focusSceneNoteEditor(sceneKey, structuralEpoch, path),
			editNote: (sceneKey, structuralEpoch, path, point) => this.noteEditing.beginSceneNoteEdit(sceneKey, structuralEpoch, path, point),
			rememberNoteEditPoint: (sceneKey, structuralEpoch, path, point) => this.noteEditing.rememberSceneNoteEditPoint(sceneKey, structuralEpoch, path, point),
			formatNote: (sceneKey, structuralEpoch, path, command) => this.noteEditing.formatSceneNote(sceneKey, structuralEpoch, path, command),
			copyNote: (sceneKey, structuralEpoch, path) => this.noteEditing.copySceneNote(sceneKey, structuralEpoch, path),
			setNoteBackground: (sceneKey, structuralEpoch, path, background) => this.noteEditing.setSceneNoteBackground(sceneKey, structuralEpoch, path, background),
			openCard: (sceneKey, structuralEpoch, path) => this.selectionActions.openSceneCard(sceneKey, structuralEpoch, path),
			invokeVideoAction: (sceneKey, structuralEpoch, path, action, anchor, frame) => this.cardRenderer.invokeSceneVideoAction(sceneKey, structuralEpoch, path, action, anchor, frame),
			showCreateMenu: (sceneKey, structuralEpoch, position) => this.selectionActions.showSceneContextMenu(
				sceneKey,
				structuralEpoch,
				{ kind: 'pane', anchor: position },
				position
			),
			showContextMenu: (sceneKey, structuralEpoch, request) => this.selectionActions.showSceneContextMenu(sceneKey, structuralEpoch, request),
			reportViewport: (sceneKey, viewport, final) => this.geometry.onSceneViewport(sceneKey, viewport, final),
			// The resting projection of a Note holds the whole note.
			cardScrollableContent: card => this.canvasNotePreviewMounts.get(card)?.fallback,
			didStartViewportInteraction: () => {
				this.viewportRestoreGeneration++;
				this.markCanvasUserInteraction();
			},
			didEndInteraction: () => this.renderer.flushRenderQueuedBehindGesture(),
			reportError: error => {
				this.logService.error(error instanceof Error ? error : String(error));
				this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				this.requestRender();
			}
		}));
		this._register(this.addDisposableListener(this.surface, DOM.EventType.DRAG_ENTER, event => this.creation.onCanvasFileDragEnter(event)));
		this._register(this.addDisposableListener(this.surface, DOM.EventType.DRAG_OVER, event => this.creation.onCanvasFileDragOver(event)));
		this._register(this.addDisposableListener(this.surface, DOM.EventType.DRAG_LEAVE, event => this.creation.onCanvasFileDragLeave(event)));
		this._register(this.addDisposableListener(this.surface, DOM.EventType.DROP, event => void this.creation.onCanvasFileDrop(event)));

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
		this.cardDetailHost.registerCardDetailSurfaceProviders();

		this.editorContainer.prepend(this.root);

		this.renderer.resetCardPreviewHydrationScene();
		this._register(this.canvasNavigationService.onDidChangeState(() => {
			this.canvasNavigationEpoch++;
			this.canvasEditingService.invalidatePostCreateIntents();
			this.renderer.resetCardPreviewHydrationScene();
			this.requestRender();
			this.selectionActions.reportAgentSelection();
		}));
		// The controls of a card's video player show on a picture wide enough on screen.
		this._register(this.onDidChangeZoomEmitter.event(() => layoutBaseHalfCanvasCardVideoPlayers()));
		this._register(playBaseHalfCanvasMediaOneAtATime(this.cards));
		this._register(this.cardProjectionRegistryService.onDidChangeProjections(() => this.cardDetailHost.reconcileCardProjectionRegistrations()));
		this._register(this.cardDetailSurfaceRegistryService.onDidChangeProviders(() => this.cardDetailHost.reconcileCardProjectionRegistrations()));
		this._register(this.canvasEditingService.registerHandler(request => this.creation.beginCanvasInlineEdit(request)));
		this._register(this.fileService.onDidFilesChange(event => {
			const folder = this.getCurrentFolder();
			if (!folder || this.renderer.isWorkingFilesOnlyChange(event, folder)) {
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
				if (this.renderer.isCurrentCanvasLayoutOnlyChange(event, folder)) {
					this.renderer.scheduleCanvasLayoutReconciliation();
				} else {
					this.renderer.scheduleBackgroundRender();
				}
			}
		}));
		// Connections live in the downstream nodes' own stores anywhere in the
		// workspace folder (D37), so any store change of the folder can change
		// this canvas's edges, counts, or the open badge editor.
		this._register(this.referenceIndexService.onDidChange(event => {
			const folder = this.getCurrentFolder();
			if (folder && this.uriIdentityService.extUri.isEqual(event.workspaceFolder, folder.workspaceFolder)) {
				this.renderer.scheduleBackgroundRender();
			}
		}));
		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => {
			const folder = this.getCurrentFolder();
			if (folder && isEqualOrParent(workingCopy.resource, folder.workspaceFolder)) {
				this.renderer.scheduleBackgroundRender();
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
			this.geometry.onCanvasKeyDown(event);
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
			if (!this.geometry.isCanvasUndoRedoActive() || !this.undoRedoService.canUndo(this.canvasUndoRedoSource)) {
				return false;
			}
			return Promise.resolve(this.undoRedoService.undo(this.canvasUndoRedoSource)).catch(error => this.reportCanvasMutationError(error));
		}));
		this._register(RedoCommand.addImplementation(BASEHALF_CANVAS_UNDO_REDO_PRIORITY, 'basehalfCanvas', () => {
			if (!this.geometry.isCanvasUndoRedoActive() || !this.undoRedoService.canRedo(this.canvasUndoRedoSource)) {
				return false;
			}
			return Promise.resolve(this.undoRedoService.redo(this.canvasUndoRedoSource)).catch(error => this.reportCanvasMutationError(error));
		}));
		this._register(this.viewportStateService.onDidImport(folders => this.geometry.onDidImportViewports(folders)));
		this._register(toDisposable(() => {
			for (const timer of this.badgeDescriptionTimers.values()) {
				mainWindow.clearTimeout(timer);
			}
			for (const [key, pending] of this.badgeDescriptionPending) {
				this.badgeEditor.flushBadgeDescriptionWrite(pending.node.workspaceFolder, pending.node.relativePath);
				this.logService.trace(`Flushing Badge prompt during canvas teardown: ${key}`);
			}
			this.badgeDescriptionTimers.clear();
		}));

		this.updateCanvasLayer();
		this.geometry.updateCanvasZoomChrome();
		this.createContributions();
		this._register(this.workspaceMutationCoordinator.onDidFinishStructuralMutation(outcome => {
			let detailReconciliation: Promise<void> | undefined;
			const detail = this.canvasNavigationService.state.cardDetail;
			if (detail) {
				const effect = baseHalfStructuralResourceOutcome(outcome, detail.workspaceFolder, detail.relativePath, detail.resource);
				if (effect.kind !== 'none') {
					detailReconciliation = this.cardDetailHost.reconcileRetainedDetailIdentity(detail, effect);
					outcome.waitUntil(detailReconciliation);
				}
			}
			// The folder whose canvas is open was moved: the canvas shows it at its
			// new path, after the file in Card Detail followed if it moved too.
			const openFolder = this.canvasNavigationService.state.canvasFolder;
			const folderEffect = openFolder ? baseHalfStructuralResourceOutcome(outcome, openFolder.workspaceFolder, openFolder.relativePath, openFolder.resource) : undefined;
			if (openFolder && folderEffect?.kind === 'move') {
				outcome.waitUntil((detailReconciliation ?? Promise.resolve()).then(() => this.followOpenFolder(openFolder, folderEffect.resource)));
			}
			if (outcome.workspaces.some(workspace => this.getCurrentFolder()?.workspaceFolder.toString() === workspace.toString())) {
				this.requestRender();
			}
			void detailReconciliation?.catch(error => this.logService.error(error));
		}));
		this._register(this.workspaceMutationCoordinator.onDidChangeResourceMutationFence(() => this.cardDetailHost.syncDetailMutationFence()));
		// The first drawing waits a moment for the comparison at open.
		if (!this.renderer.holdRenderForMovedItems()) {
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
			getFolder: () => this.getCurrentFolder(),
			getItem: path => this.renderedItemsByPath.get(path),
			getCardPreview: path => this.renderedCardPreviewsByPath.get(path)?.preview,
			requestRender: () => this.requestRender(),
			onDidChangeSelection: this.onDidChangeSelectionEmitter.event,
			select: paths => this.canvasScene.select({ cardPaths: paths }),
			isInteracting: () => this.canvasScene.isInteracting(),
			focusCard: path => this.renderedCardElementsByPath.get(path)?.closest<HTMLElement>('.react-flow__node')?.focus({ preventScroll: true }),
			pickCard: exceptPath => this.selectionActions.pickCanvasCard(exceptPath),
			cancelCardPick: () => this.selectionActions.cancelCanvasCardPick(),
			showCardPanel: (sceneKey, path, element, screenHeight) => this.canvasScene.setVideoPanelSurface({ sceneKey, structuralEpoch: this.renderedSceneStructuralEpoch, path, element, screenHeight }),
			clearCardPanel: element => this.canvasScene.clearVideoPanelSurface(element),
			takeCreatedNodeFocus: path => {
				if (this.createdNodeFocusPath !== path) {
					return false;
				}
				this.createdNodeFocusPath = undefined;
				return true;
			},
			setZoom: zoom => this.geometry.setCanvasZoom(zoom),
			zoomBy: direction => this.geometry.zoomBy(direction),
			fitToScreen: () => this.geometry.fitCanvasToScreen(),
			getViewport: () => this.canvasScene.getViewport(),
			setViewport: (sceneKey, viewport) => this.geometry.showCanvasViewport(sceneKey, viewport),
			setSnapEnabled: enabled => this.canvasScene.setSnapEnabled(enabled),
			get scene() { return scene(); },
			onDidChangeScene: this.onDidChangeSceneEmitter.event,
			isCurrentScene: sceneKey => this.isCurrentSceneKey(sceneKey),
			// The scene draws what changed in its next frames.
			whenDrawn: () => new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => resolve()))),
			moveCards: (scene, places, undoLabel, onUndoOrRedo) => this.geometry.moveCanvasCards(scene, places, undoLabel, onUndoOrRedo),
			restoreCardPlaces: (sceneKey, rows, undoLabel) => this.geometry.restoreCanvasCardPlaces(sceneKey, rows, undoLabel),
			closeNoteEditor: () => this.noteEditing.closeActiveCanvasNoteEditorAfterFormats(),
			focus: () => this.cards.focus({ preventScroll: true }),
			onKeyDown: this.onKeyDownEmitter.event,
			reportError: error => this.reportCanvasMutationError(error),
			viewControls: this.viewControls,
			viewControlsCorner: this.chrome,
			onDidHideViewControls: this.onDidHideViewControlsEmitter.event,
		};
	}

	/** The scene that was drawn last, under the key of the canvas that is shown unless a key is given. */
	canvasViewScene(sceneKey?: string): IBaseHalfCanvasViewScene {
		const folder = this.getCurrentFolder();
		return {
			key: sceneKey ?? (folder ? this.sceneKey(folder) : BASEHALF_CANVAS_NO_FOLDER_SCENE_KEY),
			structuralEpoch: this.renderedSceneStructuralEpoch,
			cards: this.renderedSceneCards,
			edges: this.renderedSceneEdges,
		};
	}

	/** Registers what a part of the view keeps, for the lifetime of the view. */
	register<T extends IDisposable>(disposable: T): T {
		return this._register(disposable);
	}

	override dispose(): void {
		this.disposed = true;
		this.noteEditing.cancelPendingCreatedCanvasNoteActivation();
		this.canvasNoteFocusLeaseOwner.revoke();
		this.pendingCanvasSelectionFormatBarrier.reset();
		this.noteEditing.cancelPendingCanvasNoteFormatCommands();
		if (this.pendingCanvasNoteNavigationGuard) {
			this.noteEditing.releaseCanvasNoteFormatNavigationGuard(this.pendingCanvasNoteNavigationGuard, true);
		}
		for (const resolve of this.canvasInteractionEndWaiters) {
			resolve();
		}
		this.canvasInteractionEndWaiters.clear();
		this.selectionActions.cancelPendingNodeActivation();
		const activeNote = this.activeCanvasNoteEditor;
		if (activeNote) {
			this.activeCanvasNoteEditor = undefined;
			this.canvasNoteSurfacePath = undefined;
			this.noteEditing.releaseCanvasNoteFocusIntent(activeNote.focusIntent);
			this.canvasNavigationService.setActiveCanvasEditor(undefined);
			this.noteEditing.detachCanvasNoteEditorMount(activeNote);
		}
		this.cardListenerStores.clear();
		this.canvasNavigationService.setSurfaceActive(false);
		this.renderSeq++;
		this.cardDetailHost.disposeDetailSurfaces();
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

	addDisposableListener<K extends keyof HTMLElementEventMap>(node: HTMLElement | SVGElement, type: K, listener: (event: HTMLElementEventMap[K]) => void, useCaptureOrOptions?: boolean | AddEventListenerOptions): { dispose(): void };
	addDisposableListener<K extends keyof DocumentEventMap>(node: Document, type: K, listener: (event: DocumentEventMap[K]) => void, useCaptureOrOptions?: boolean | AddEventListenerOptions): { dispose(): void };
	addDisposableListener<K extends keyof WindowEventMap>(node: Window, type: K, listener: (event: WindowEventMap[K]) => void, useCaptureOrOptions?: boolean | AddEventListenerOptions): { dispose(): void };
	addDisposableListener(node: EventTarget, type: string, listener: (event: Event) => void, useCaptureOrOptions?: boolean | AddEventListenerOptions) {
		node.addEventListener(type, listener as EventListener, useCaptureOrOptions);
		return {
			dispose: () => node.removeEventListener(type, listener as EventListener, useCaptureOrOptions)
		};
	}

	/** The canvas shows the folder it had open at the folder's new path, with the view it had. */
	/**
	 * The folder whose canvas is open moved to `resource`: the canvas shows it
	 * there. Card Detail open over it stays open, over the folder at its new
	 * path, as when its file lies outside that folder (D62).
	 */
	private async followOpenFolder(folder: IBaseHalfCanvasFolderState, resource: URI): Promise<void> {
		const { canvasFolder, cardDetail } = this.canvasNavigationService.state;
		if (!canvasFolder || !this.uriIdentityService.extUri.isEqual(canvasFolder.resource, folder.resource)) {
			return;
		}
		const viewport = this.viewportStateService.get(folder.resource);
		if (viewport) {
			this.viewportStateService.set(resource, viewport);
		}
		if (!cardDetail) {
			await this.canvasNavigationService.openFolderCanvas(resource, { source: folder.source, history: 'replace' });
			return;
		}
		// One with unsaved changes is left as it is.
		if (!this.workingCopyService.isDirty(cardDetail.resource)) {
			await this.canvasNavigationService.openCardDetail(cardDetail.resource, {
				source: cardDetail.source,
				selection: cardDetail.selection,
				preserveFocus: cardDetail.preserveFocus,
				pinned: cardDetail.pinned,
				projection: cardDetail.projection,
				history: 'replace',
				expectedCardDetail: cardDetail,
				canvasFolder: resource
			});
		}
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
		// One with unsaved changes is left as it is: it held the relocation back.
		if (detail && detailResource && !this.workingCopyService.isDirty(detail.resource)) {
			await this.canvasNavigationService.openCardDetail(detailResource, { source: detail.source, history: 'replace', expectedCardDetail: detail });
		}
		// The canvas follows its folder; when Card Detail of a file in that folder
		// followed its file, the canvas came along and nothing is left to do.
		const folder = state.canvasFolder;
		const folderResource = folder && folder.relativePath !== '' ? moved(folder) : undefined;
		if (folder && folderResource) {
			await this.followOpenFolder(folder, folderResource);
		}
	}

	/** `forDiskChange`: a redraw for what happened on disk, and not for what the user did. */
	requestRender(forDiskChange = false): void {
		this.rendersInFlight++;
		// A drawing the user is waiting for is never left out, whatever takes its turn.
		this.userRenderOwed ||= !forDiskChange;
		void this.renderer.render(forDiskChange).catch(error => {
			if (this.disposed) {
				return;
			}
			this.logService.error(error);
			this.renderer.renderCanvasWarning(error instanceof Error ? error.message : String(error));
		}).finally(() => {
			this.rendersInFlight--;
		});
	}

	sceneKey(folder: IBaseHalfCanvasFolderState): string {
		return `${folder.workspaceFolder.toString()}::${folder.relativePath}`;
	}

	isCurrentSceneKey(sceneKey: string): boolean {
		const folder = this.getCurrentFolder();
		return !!folder && this.sceneKey(folder) === sceneKey;
	}

	folderForSceneMutation(sceneKey: string): IBaseHalfCanvasFolderState {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey) {
			throw new Error('The canvas changed before this interaction completed.');
		}
		return folder;
	}

	sceneMutationStamp(folder: IBaseHalfCanvasFolderState, structuralEpoch: number): IBaseHalfWorkspaceMutationStamp {
		return { workspaceKey: folder.workspaceFolder.toString(), structuralEpoch };
	}

	upstreamIdentity(workspaceFolder: URI): IBaseHalfUpstreamIdentity {
		return baseHalfUpstreamIdentity(workspaceFolder, this.uriIdentityService.extUri);
	}

	workspaceNode(workspaceFolder: URI, relativePath: string, kind: IBaseHalfCanvasItem['kind']): IBaseHalfUpstreamActionNode {
		return {
			resource: relativePath ? joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath,
			kind
		};
	}

	resourceMutationGuard(
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

	async resolveLiveCanvasNodes(
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

	async resolveLiveWorkspaceNodes(
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

	captureCanvasPostCreateOwner(): IBaseHalfCanvasPostCreateOwner {
		return {
			interactionEpoch: this.canvasInteractionEpoch,
			navigationEpoch: this.canvasNavigationEpoch,
			navigationState: this.canvasNavigationService.state
		};
	}

	isCanvasPostCreateOwnerCurrent(owner: IBaseHalfCanvasPostCreateOwner): boolean {
		return baseHalfCanvasPostCreateOwnerIsCurrent(
			owner,
			this.canvasInteractionEpoch,
			this.canvasNavigationEpoch,
			this.canvasNavigationService.state
		);
	}

	markCanvasUserInteraction(): void {
		this.canvasInteractionEpoch++;
		this.canvasEditingService.invalidatePostCreateIntents();
		this.noteEditing.cancelPendingCreatedCanvasNoteActivation();
		this.pendingCanvasSelection = undefined;
		this.pendingCanvasFit = undefined;
		const promotedFocus = this.pendingCanvasNoteFocus;
		let clearedPromotedSurface = false;
		if (promotedFocus?.createOwner) {
			const path = promotedFocus.path;
			this.noteEditing.clearPendingCanvasNoteFocus(path);
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
		const expected = this.selectionActions.currentPostCreateSelectionPaths();
		if (targetPath && expected?.length === 1 && expected[0] === targetPath) {
			return;
		}
		this.markCanvasUserInteraction();
	}

	getCurrentFolder(): IBaseHalfCanvasFolderState | undefined {
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

	queueCanvasWarning(message: string): void {
		if (!this.pendingCanvasWarnings.includes(message)) {
			this.pendingCanvasWarnings.push(message);
		}
	}

	reportCanvasMutationError(error: unknown): void {
		this.logService.error(error instanceof Error ? error : String(error));
		this.queueCanvasWarning(baseHalfUserFacingErrorMessage(error));
		this.requestRender();
	}
}

registerWorkbenchContribution2(BaseHalfCanvasWorkbenchContribution.ID, BaseHalfCanvasWorkbenchContribution, WorkbenchPhase.AfterRestored);
