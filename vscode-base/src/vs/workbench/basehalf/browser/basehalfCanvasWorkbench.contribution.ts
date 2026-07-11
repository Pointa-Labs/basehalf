/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasWorkbench.css';

import * as DOM from '../../../base/browser/dom.js';
import { $, append, clearNode, isHTMLElement } from '../../../base/browser/dom.js';
import { InputBox, MessageType } from '../../../base/browser/ui/inputbox/inputBox.js';
import { IKeyboardEvent } from '../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { basename, dirname, extname, isEqualOrParent, joinPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { ResourceFileEdit } from '../../../editor/browser/services/bulkEditService.js';
import { localize } from '../../../nls.js';
import { FileChangesEvent, IFileService, IFileStat } from '../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IQuickInputService, IQuickPickItem } from '../../../platform/quickinput/common/quickInput.js';
import { IContextMenuService, IContextViewService } from '../../../platform/contextview/browser/contextView.js';
import { defaultInputBoxStyles } from '../../../platform/theme/browser/defaultStyles.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkbenchLayoutService, Parts } from '../../services/layout/browser/layoutService.js';
import { IExplorerService } from '../../contrib/files/browser/files.js';
import { IFilesConfiguration, UndoConfirmLevel } from '../../contrib/files/common/files.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { DEFAULT_EDITOR_ASSOCIATION, SideBySideEditor } from '../../common/editor.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { ILifecycleService } from '../../services/lifecycle/common/lifecycle.js';
import { IPathService } from '../../services/path/common/pathService.js';
import { mainWindow } from '../../../base/browser/window.js';
import {
	baseHalfCanvasBadgeRelationships,
	baseHalfCanvasItemBounds,
	baseHalfCanvasModelFromStat,
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
import { IBaseHalfBadgeGraphService } from '../common/basehalfBadgeGraph.js';
import { IBaseHalfBadgeFile, IBaseHalfBadgeNode, IBaseHalfBadgeReadProblem } from '../common/basehalfBadgeMirror.js';
import { BaseHalfCanvasMirrorCorrupt, IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorResource, baseHalfMirrorRoot } from '../common/basehalfMirrorTree.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService, IBaseHalfCardDetailState } from '../common/basehalfCanvasNavigation.js';
import { baseHalfCanvasInlineEditKeyAction, BaseHalfCanvasEditingRequest, IBaseHalfCanvasEditingService } from '../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasActionContext, IBaseHalfCanvasActionContextService } from '../common/basehalfCanvasActionContext.js';
import { BaseHalfCardDetailProjection, isBaseHalfMarkdownResource } from '../common/basehalfCardDetail.js';
import { IBaseHalfFocusMirrorService } from '../common/basehalfFocusMirrorService.js';
import {
	baseHalfCanvasCardLod,
	BASEHALF_CANVAS_CARD_FULL_MIN_HEIGHT,
	BaseHalfCanvasCardLod
} from '../common/basehalfCanvasCardLod.js';
import { BaseHalfMarkdownPreviewCardDetail } from './cardDetail/basehalfMarkdownPreviewCardDetail.js';
import { BaseHalfMarkdownRichCardDetail } from './cardDetail/basehalfMarkdownRichCardDetail.js';
import { BaseHalfMarkdownRichWebviewWarmup } from './cardDetail/basehalfMarkdownRichWebviewWarmup.js';
import { BaseHalfSourceCardDetail } from './cardDetail/basehalfSourceCardDetail.js';
import { BaseHalfCanvasReactScene } from './basehalfCanvasReactScene.js';
import { BASEHALF_CANVAS_MAX_ZOOM, BASEHALF_CANVAS_MIN_ZOOM, BaseHalfSetting, normalizeBaseHalfCanvasZoom } from '../common/basehalfConfiguration.js';
import { BASEHALF_AUTO_SAVE_DELAY_MS } from '../common/basehalfWorkbenchProfile.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from '../common/basehalfEditorFlush.js';
import {
	BaseHalfCanvasSceneContextMenuRequest,
	IBaseHalfCanvasSceneConnection,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneGeometry,
	IBaseHalfCanvasSceneReconnect,
	IBaseHalfCanvasSceneViewport
} from '../common/basehalfCanvasScene.js';
import { BASEHALF_CANVAS_CARD_CONTEXT_MENU, BASEHALF_CANVAS_PANE_CONTEXT_MENU } from './basehalfCanvasContextMenu.js';
import {
	BaseHalfStructuralResourceOutcome,
	baseHalfStructuralResourceOutcome,
	IBaseHalfWorkspaceMutationCoordinator,
	IBaseHalfWorkspaceMutationLease,
	IBaseHalfWorkspaceMutationStamp,
	IBaseHalfWorkspaceResourceMutationStamp
} from '../common/basehalfWorkspaceMutation.js';

type BaseHalfCanvasCardPreview =
	| { readonly kind: 'folder'; readonly total: number; readonly items: readonly BaseHalfCanvasFolderPreviewItem[] }
	| { readonly kind: 'text' | 'code' | 'markdown' | 'media' | 'empty' | 'unavailable'; readonly text: string };
type BaseHalfCanvasFolderPreviewItem = { readonly name: string; readonly kind: 'file' | 'folder' };
type BaseHalfCanvasGlyphType = 'folder' | 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'code' | 'generic' | 'badge';
type BaseHalfCardDetailSaveStatus = 'saving' | 'saved' | 'error';
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
	value: string;
}
interface IBaseHalfBadgeDescriptionPending extends IBaseHalfBadgeDescriptionDraft {
	delayReleased: boolean;
	readonly delay: Promise<void>;
	readonly releaseDelay: () => void;
	write?: Promise<void>;
}
interface IBaseHalfCardDetailSurface {
	readonly host: HTMLElement;
	readonly store: DisposableStore;
	readonly instance: BaseHalfSourceCardDetail | BaseHalfMarkdownRichCardDetail | BaseHalfMarkdownPreviewCardDetail;
	readonly whenRendered: Promise<unknown>;
}
interface IBaseHalfCanvasMutationGuard {
	readonly workspaceKey: string;
	run<T>(task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>, relatedStamps?: readonly IBaseHalfWorkspaceResourceMutationStamp[]): Promise<T>;
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
		readonly folder: boolean;
		readonly initialValue: string;
		readonly anchor: { readonly x: number; readonly y: number };
		readonly canvasPosition: { readonly x: number; readonly y: number };
		value: string;
		selectionPending: boolean;
	};

const MINI_LABEL_MIN_FLOW_PX = 12;
const MINI_LABEL_CARD_HEIGHT_FRACTION = 0.18;
const TEXT_PREVIEW_MAX_BYTES = 8192;
class BaseHalfCanvasWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.canvasWorkbench';

	private readonly root: HTMLElement;
	private readonly chrome: HTMLElement;
	private readonly zoomOut: HTMLButtonElement;
	private readonly zoomReset: HTMLButtonElement;
	private readonly zoomIn: HTMLButtonElement;
	private readonly zoomValue: HTMLElement;
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
	private readonly inlineEditListeners = this._register(new DisposableStore());
	private readonly detailChromeDisposables = this._register(new DisposableStore());

	private renderSeq = 0;
	private backgroundRenderTimer: number | undefined;
	private readonly badgeDescriptionTimers = new Map<string, number>();
	private readonly badgeDescriptionDrafts = new Map<string, IBaseHalfBadgeDescriptionDraft>();
	private readonly badgeDescriptionPending = new Map<string, IBaseHalfBadgeDescriptionPending>();
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
	private readonly richWebviewWarmup: BaseHalfMarkdownRichWebviewWarmup;
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
	private canvasZoom = 1;
	private renderQueuedBehindGesture = false;
	private inlineEdit: BaseHalfCanvasInlineEdit | undefined;
	private lastCanvasContextMenu: { readonly context: IBaseHalfCanvasActionContext; readonly request: BaseHalfCanvasSceneContextMenuRequest } | undefined;
	private disposed = false;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IEditorService private readonly editorService: IEditorService,
		@IBaseHalfBadgeGraphService private readonly badgeGraphService: IBaseHalfBadgeGraphService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IBaseHalfFocusMirrorService private readonly focusMirrorService: IBaseHalfFocusMirrorService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IPathService private readonly pathService: IPathService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IBaseHalfCanvasEditingService private readonly canvasEditingService: IBaseHalfCanvasEditingService,
		@IBaseHalfCanvasActionContextService private readonly canvasActionContextService: IBaseHalfCanvasActionContextService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@ILifecycleService lifecycleService: ILifecycleService
	) {
		super();
		this.detailBadgeDisposables = this._register(new DisposableStore());
		this.canvasBadgeFocusRefresh = this._register(new MutableDisposable());
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
		// Focusable (not tabbable) for canvas keyboard shortcuts. Edge deletion is
		// scoped more narrowly to the React Flow scene host.
		this.root.tabIndex = -1;

		this.chrome = DOM.append(this.root, DOM.$('.basehalf-canvas-chrome'));
		const zoomControls = DOM.append(this.chrome, DOM.$('.basehalf-canvas-zoom-controls'));
		this.zoomOut = this.createZoomButton(zoomControls, 'Zoom Out', 'codicon-remove', () => this.zoomBy(-1));
		this.zoomValue = DOM.append(zoomControls, DOM.$('.basehalf-canvas-zoom-value'));
		this.zoomReset = this.createZoomButton(zoomControls, 'Reset Zoom', 'codicon-debug-restart', () => this.setCanvasZoom(1));
		this.zoomIn = this.createZoomButton(zoomControls, 'Zoom In', 'codicon-add', () => this.zoomBy(1));
		this.surface = DOM.append(this.root, DOM.$('.basehalf-canvas-surface'));
		this.cards = DOM.append(this.surface, DOM.$('.basehalf-canvas-cards'));
		this.inlineEditLayer = DOM.append(this.surface, DOM.$('.basehalf-canvas-inline-edit-layer'));
		this.canvasOverlay = DOM.append(this.surface, DOM.$('.basehalf-canvas-overlay'));
		this.canvasScene = this._register(new BaseHalfCanvasReactScene(this.cards, {
			commitGeometry: (sceneKey, structuralEpoch, geometries) => this.commitSceneGeometry(sceneKey, structuralEpoch, geometries),
			connect: (sceneKey, structuralEpoch, connection) => this.connectSceneEdge(sceneKey, structuralEpoch, connection),
			reconnect: (sceneKey, structuralEpoch, intent) => this.reconnectSceneEdge(sceneKey, structuralEpoch, intent),
			removeEdge: (sceneKey, structuralEpoch, edge) => this.removeEdgeFromScene(sceneKey, structuralEpoch, edge),
			openCard: (sceneKey, structuralEpoch, path) => this.openSceneCard(sceneKey, structuralEpoch, path),
			showContextMenu: (sceneKey, structuralEpoch, request) => this.showSceneContextMenu(sceneKey, structuralEpoch, request),
			reportViewport: (sceneKey, viewport, final) => this.onSceneViewport(sceneKey, viewport, final),
			didEndInteraction: () => this.flushRenderQueuedBehindGesture(),
			reportError: error => {
				this.logService.error(error instanceof Error ? error : String(error));
				this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				this.requestRender();
			}
		}));

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
		const close = append(detailActions, $('button.basehalf-card-detail-close.codicon.codicon-close')) as HTMLButtonElement;
		close.type = 'button';
		close.title = 'Close';
		close.setAttribute('aria-label', 'Close');
		this._register(this.addDisposableListener(close, 'click', () => void this.canvasNavigationService.closeCardDetail()));
		this.detailBody = append(this.detail, $('.basehalf-card-detail-body'));
		this.richWebviewWarmup = this._register(this.instantiationService.createInstance(BaseHalfMarkdownRichWebviewWarmup, this.detailBody));

		this.editorContainer.prepend(this.root);

		this._register(this.canvasNavigationService.onDidChangeState(() => this.requestRender()));
		this._register(this.canvasEditingService.onDidRequestEdit(request => void this.beginCanvasInlineEdit(request)));
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
				this.scheduleBackgroundRender();
			}
		}));
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.reconcileActiveEditor()));
		this._register(this.editorService.onDidActiveEditorChange(() => this.reconcileActiveEditor()));
		this._register(this.addDisposableListener(this.root, 'keydown', event => {
			if (event.key === 'Escape') {
				void this.canvasNavigationService.closeCardDetail();
				return;
			}
			this.onCanvasKeyDown(event);
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
		this.renderSeq++;
		this.disposeDetailSurfaces();
		if (this.backgroundRenderTimer !== undefined) {
			mainWindow.clearTimeout(this.backgroundRenderTimer);
			this.backgroundRenderTimer = undefined;
		}
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
		// Card detail is navigation state, not scene data. It must react even if a
		// pointer gesture is still winding down on the canvas underneath.
		this.renderDetail();

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
			clearNode(this.canvasOverlay);
			clearNode(this.inlineEditLayer);
			this.inlineEditListeners.clear();
			this.inlineEdit = undefined;
			this.renderedBadges = new Map();
			this.renderedBadgeProblems = new Map();
			this.renderedItemsByPath = new Map();
			this.resetCanvasBadgeDeferredRefresh();
			this.cardListeners.clear();
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
			stat = await this.fileService.resolve(folder.resource);
		} catch (error) {
			if (!this.isRenderCurrent(seq)) {
				return;
			}
			if (this.deferRenderForSceneInteraction()) {
				return;
			}
			clearNode(this.canvasOverlay);
			clearNode(this.inlineEditLayer);
			this.inlineEditListeners.clear();
			this.renderedBadges = new Map();
			this.renderedBadgeProblems = new Map();
			this.renderedItemsByPath = new Map();
			this.resetCanvasBadgeDeferredRefresh();
			this.cardListeners.clear();
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
		const previews = await this.readCardPreviews(items);
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		if (this.deferRenderForSceneInteraction()) {
			return;
		}
		if (!this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
			return;
		}

		clearNode(this.canvasOverlay);
		clearNode(this.inlineEditLayer);
		this.inlineEditListeners.clear();
		this.renderedBadges = badgeRead.badges;
		this.renderedBadgeProblems = new Map(badgeRead.problems.map(problem => [problem.relativePath, problem]));
		this.renderedItemsByPath = new Map(items.map(item => [item.path, item]));
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
			const badge = this.badgeMetadataWithDraft(folder.workspaceFolder, item.path, item.badge);
			const displayedItem = badge === item.badge ? item : { ...item, badge };
			return {
				path: item.path,
				kind: item.kind,
				...bounds,
				element: this.createCard(displayedItem, bounds, preview, structuralStamp)
			};
		});
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
		this.canvasScene.update({
			key: this.sceneKey(folder),
			structuralEpoch: structuralStamp.structuralEpoch,
			revision: seq,
			cards: sceneCards,
			edges: sceneEdges
		});
		this.renderInlineCreateEditor(folder);
		if (items.length === 0) {
			this.renderEmpty('No files');
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

		this.restoreOrWriteFolderFocus(folder, seq);
	}

	private sceneKey(folder: IBaseHalfCanvasFolderState): string {
		return `${folder.workspaceFolder.toString()}::${folder.relativePath}`;
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

	private sceneMutationGuard(workspaceFolder: URI, stamp: IBaseHalfWorkspaceMutationStamp): IBaseHalfCanvasMutationGuard {
		return {
			workspaceKey: workspaceFolder.toString(),
			run: task => this.workspaceMutationCoordinator.runSceneMutation(workspaceFolder, stamp, task)
		};
	}

	private resourceMutationGuard(workspaceFolder: URI, stamp: IBaseHalfWorkspaceResourceMutationStamp): IBaseHalfCanvasMutationGuard {
		return {
			workspaceKey: workspaceFolder.toString(),
			run: (task, relatedStamps = []) => this.workspaceMutationCoordinator.runResourceMutation(workspaceFolder, [stamp, ...relatedStamps], task)
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

	private async commitSceneGeometry(sceneKey: string, structuralEpoch: number, geometries: readonly IBaseHalfCanvasSceneGeometry[]): Promise<void> {
		if (geometries.length === 0) {
			return;
		}
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		await this.workspaceMutationCoordinator.runSceneMutation(
			queuedFolder.workspaceFolder,
			this.sceneMutationStamp(queuedFolder, structuralEpoch),
			async lease => {
				const folder = this.folderForSceneMutation(sceneKey);
				await this.resolveLiveCanvasNodes(sceneKey, folder, geometries);
				await this.canvasMirrorService.updateCardGeometries(folder, geometries.map(geometry => ({
					path: geometry.path,
					kind: geometry.kind,
					x: geometry.x,
					y: geometry.y,
					width: geometry.width,
					height: geometry.height
				})), lease);
			}
		);
		this.requestRender();
	}

	private async connectSceneEdge(sceneKey: string, structuralEpoch: number, connection: IBaseHalfCanvasSceneConnection): Promise<void> {
		if (connection.from === connection.to) {
			return;
		}
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		await this.workspaceMutationCoordinator.runSceneMutation(
			queuedFolder.workspaceFolder,
			this.sceneMutationStamp(queuedFolder, structuralEpoch),
			async lease => {
				const folder = this.folderForSceneMutation(sceneKey);
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
				await this.badgeGraphService.addReference(live.get(edge.from)!, live.get(edge.to)!, lease);
				try {
					await this.canvasMirrorService.upsertCanvasEdge(folder, edge, lease);
				} catch (error) {
					// The semantic reference already landed, so the edge still exists and
					// will render with default anchors. Styling failure is recoverable.
					this.logService.warn(error);
					this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				}
			}
		);
		this.requestRender();
	}

	private async reconnectSceneEdge(sceneKey: string, structuralEpoch: number, intent: IBaseHalfCanvasSceneReconnect): Promise<void> {
		const { previous, next: connection } = intent;
		if (connection.from === connection.to) {
			return;
		}
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		await this.workspaceMutationCoordinator.runSceneMutation(
			queuedFolder.workspaceFolder,
			this.sceneMutationStamp(queuedFolder, structuralEpoch),
			async lease => {
				const folder = this.folderForSceneMutation(sceneKey);
				const live = await this.resolveLiveCanvasNodes(sceneKey, folder, [
					{ path: previous.from, kind: previous.fromKind },
					{ path: previous.to, kind: previous.toKind },
					{ path: connection.from, kind: connection.fromKind },
					{ path: connection.to, kind: connection.toKind }
				]);
				const next: IBaseHalfCanvasEdge = {
					from: connection.from,
					from_anchor: connection.fromAnchor,
					to: connection.to,
					to_anchor: connection.toAnchor
				};
				const endpointsChanged = previous.from !== next.from || previous.to !== next.to;
				if (endpointsChanged) {
					const semanticResult = await this.badgeGraphService.reconnectReference(
						live.get(previous.from)!,
						live.get(previous.to)!,
						live.get(next.from)!,
						live.get(next.to)!,
						lease
					);
					if (semanticResult === 'already-connected') {
						return;
					}
				}
				try {
					await this.canvasMirrorService.reconnectCanvasEdge(folder, previous, next, lease);
				} catch (error) {
					this.logService.warn(error);
					this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				}
			}
		);
		this.requestRender();
	}

	private async removeEdgeFromScene(sceneKey: string, structuralEpoch: number, edge: IBaseHalfCanvasSceneEdge): Promise<void> {
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		await this.workspaceMutationCoordinator.runSceneMutation(
			queuedFolder.workspaceFolder,
			this.sceneMutationStamp(queuedFolder, structuralEpoch),
			async lease => {
				const folder = this.folderForSceneMutation(sceneKey);
				const live = await this.resolveLiveCanvasNodes(sceneKey, folder, [
					{ path: edge.from, kind: edge.fromKind },
					{ path: edge.to, kind: edge.toKind }
				]);
				await this.badgeGraphService.removeReference(live.get(edge.from)!, live.get(edge.to)!, lease);
				try {
					await this.canvasMirrorService.removeCanvasEdge(folder, edge, lease);
				} catch (error) {
					this.logService.warn(error);
					this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				}
			}
		);
		this.requestRender();
	}

	private openSceneCard(sceneKey: string, structuralEpoch: number, path: string): void {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const item = this.renderedItemsByPath.get(path);
		if (item) {
			void this.canvasNavigationService.openResource(item.stat.resource, { source: 'api', pinned: true });
		}
	}

	private showSceneContextMenu(sceneKey: string, structuralEpoch: number, request: BaseHalfCanvasSceneContextMenuRequest): void {
		const folder = this.getCurrentFolder();
		if (!folder || this.sceneKey(folder) !== sceneKey
			|| !this.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.sceneMutationStamp(folder, structuralEpoch))) {
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
			this.lastCanvasContextMenu = { context, request };
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

	private onSceneViewport(sceneKey: string, viewport: IBaseHalfCanvasSceneViewport, final: boolean): void {
		if (!this.isCurrentSceneKey(sceneKey)) {
			return;
		}
		this.canvasZoom = viewport.zoom;
		this.updateCanvasZoomChrome();
		if (final) {
			const folder = this.getCurrentFolder();
			if (folder) {
				this.scheduleFolderFocusWrite(200, { folder, viewport });
			}
		}
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

	private async readCardPreviews(items: readonly IBaseHalfCanvasItem[]): Promise<ReadonlyMap<string, BaseHalfCanvasCardPreview>> {
		const entries = await Promise.all(items.map(async item => [item.path, await this.readCardPreview(item)] as const));
		return new Map(entries);
	}

	private async readCardPreview(item: IBaseHalfCanvasItem): Promise<BaseHalfCanvasCardPreview> {
		if (item.kind === 'folder') {
			const stat = item.stat.children ? item.stat : await this.fileService.resolve(item.stat.resource);
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

		const media = mediaPreviewLabel(item.name);
		if (media) {
			return { kind: 'media', text: media };
		}

		try {
			const raw = (await this.fileService.readFile(item.stat.resource, {
				limits: { size: TEXT_PREVIEW_MAX_BYTES }
			})).value.toString();
			if (raw.includes('\u0000')) {
				return { kind: 'media', text: 'Binary file' };
			}

			const kind = markdownPreviewKind(item.name);
			const text = kind === 'markdown' ? cleanMarkdownPreviewSource(raw) : cleanCardPreviewText(item.name, raw);
			return text ? { kind, text } : { kind: 'empty', text: 'Empty file' };
		} catch {
			return { kind: 'unavailable', text: 'Preview unavailable' };
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
		this.editorContainer.classList.toggle('basehalf-canvas-on-top', this.editorService.visibleEditors.length === 0);
	}

	private async beginCanvasInlineEdit(request: BaseHalfCanvasEditingRequest): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder || this.canvasNavigationService.state.cardDetail) {
			return;
		}
		try {
			await this.canvasActionContextService.assertCurrent(request.context);
		} catch (error) {
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
			return;
		}

		if (request.kind === 'rename') {
			const item = [...this.renderedItemsByPath.values()]
				.find(candidate => candidate.path === request.context.relativePath
					&& this.uriIdentityService.extUri.isEqual(candidate.stat.resource, request.context.resource));
			if (!item) {
				return;
			}
			this.inlineEdit = {
				kind: 'rename',
				context: request.context,
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

		if (!this.uriIdentityService.extUri.isEqual(request.context.resource, folder.resource)) {
			return;
		}
		const menu = this.lastCanvasContextMenu;
		const surfaceRect = this.surface.getBoundingClientRect();
		const anchor = menu && menu.context === request.context && menu.request.kind === 'pane'
			? isHTMLElement(menu.request.anchor)
				? (() => {
					const rect = menu.request.anchor.getBoundingClientRect();
					return { x: rect.left + Math.min(rect.width / 2, 180), y: rect.top + Math.min(rect.height / 2, 90) };
				})()
				: menu.request.anchor
			: { x: surfaceRect.left + surfaceRect.width / 2, y: surfaceRect.top + surfaceRect.height / 2 };
		const canvasPosition = this.canvasScene.screenToCanvasPosition(anchor.x, anchor.y);
		this.inlineEdit = {
			kind: 'create',
			context: request.context,
			parent: request.context.resource,
			folder: request.folder,
			initialValue: request.folder ? 'untitled folder' : 'untitled.md',
			anchor: { x: anchor.x - surfaceRect.left, y: anchor.y - surfaceRect.top },
			canvasPosition,
			value: request.folder ? 'untitled folder' : 'untitled.md',
			selectionPending: true
		};
		this.requestRender();
	}

	private renderInlineRenameEditor(card: HTMLElement, item: IBaseHalfCanvasItem): void {
		const edit = this.inlineEdit;
		if (!edit || edit.kind !== 'rename' || edit.path !== item.path
			|| !this.uriIdentityService.extUri.isEqual(edit.resource, item.stat.resource)) {
			return;
		}
		card.classList.add('inline-editing');
		const host = append(card, $('.basehalf-canvas-inline-name-editor'));
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
		this.renderInlineNameInput(host, edit, edit.folder);
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
			inputBoxStyles: defaultInputBoxStyles
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
				await this.commitCanvasInlineEdit(edit, name);
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
				if (!finishing && this.inlineEdit === edit && inputBox.inputElement.ownerDocument.activeElement !== inputBox.inputElement) {
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

	private async commitCanvasInlineEdit(edit: BaseHalfCanvasInlineEdit, name: string): Promise<void> {
		await this.canvasActionContextService.assertCurrent(edit.context);
		const target = joinPath(edit.parent, name);
		if (edit.kind === 'rename') {
			await this.fileService.stat(edit.resource);
			await this.explorerService.applyBulkEdit([new ResourceFileEdit(edit.resource, target)], {
				undoLabel: localize('basehalf.canvas.rename.undo', "Rename {0} to {1}", edit.initialValue, name),
				progressLabel: localize('basehalf.canvas.rename.progress', "Renaming {0}", edit.initialValue),
				confirmBeforeUndo: this.confirmExplorerUndo()
			});
			return;
		}
		await this.explorerService.applyBulkEdit([new ResourceFileEdit(undefined, target, { folder: edit.folder })], {
			undoLabel: edit.folder
				? localize('basehalf.canvas.newFolder.undo', "Create Folder {0}", name)
				: localize('basehalf.canvas.newFile.undo', "Create File {0}", name),
			progressLabel: edit.folder
				? localize('basehalf.canvas.newFolder.progress', "Creating folder {0}", name)
				: localize('basehalf.canvas.newFile.progress', "Creating file {0}", name),
			confirmBeforeUndo: this.confirmExplorerUndo()
		});
		const folder = this.getCurrentFolder();
		if (folder && this.uriIdentityService.extUri.isEqual(folder.resource, edit.parent)) {
			const path = canvasChildPath(folder.relativePath, name);
			try {
				await this.canvasMirrorService.updateCardGeometry(folder, {
					path,
					kind: edit.folder ? 'folder' : 'file',
					x: edit.canvasPosition.x,
					y: edit.canvasPosition.y,
					width: edit.folder ? BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH : BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
					height: edit.folder ? BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT : BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT
				});
			} catch (error) {
				this.logService.warn(error);
				this.queueCanvasWarning(localize('basehalf.canvas.createGeometryFailed', "The item was created, but its canvas position could not be saved."));
			}
		}
		await this.canvasNavigationService.openResource(target, { source: 'api', pinned: true });
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
			this.canvasEditingService.requestRename(context);
		} catch (error) {
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
		}
	}

	private createCard(
		item: IBaseHalfCanvasItem,
		bounds: IBaseHalfCanvasBounds,
		preview: BaseHalfCanvasCardPreview | undefined,
		structuralStamp: IBaseHalfWorkspaceMutationStamp
	): HTMLElement {
		const card = $('.basehalf-canvas-card');
		card.tabIndex = 0;
		card.setAttribute('role', 'button');
		card.dataset.basehalfCardPath = item.path;
		card.dataset.cardHeight = String(bounds.height);
		const badgeOpen = this.openBadgeFaces.has(item.path);
		card.dataset.lod = this.cardLod(bounds);
		card.dataset.projection = badgeOpen ? 'badge' : 'preview';
		card.classList.add(item.kind);
		card.classList.toggle('badge-open', badgeOpen);
		card.setAttribute('aria-label', `${item.name} card`);
		card.title = item.kind === 'folder'
			? `${item.path} - click to select; double-click to enter this folder`
			: `${item.path} - click to select; double-click to open the editor`;

		const type = badgeType(item.name, item.kind === 'folder');
		const orphan = item.badge?.orphan === true;
		const badgeRelationships = baseHalfCanvasBadgeRelationships(item.path, item.badge, this.renderedBadges, this.renderedBadgeProblems);
		const badgeIssueCount = badgeRelationships.issues.length + (this.renderedBadgeProblems.has(item.path) ? 1 : 0);
		card.classList.toggle('has-reference-issues', badgeIssueCount > 0);
		card.dataset.referenceIssueCount = String(badgeIssueCount);
		card.setAttribute('aria-label', `${item.name} card${badgeIssueCount > 0 ? `, ${badgeIssueCount} reference metadata issue${badgeIssueCount === 1 ? '' : 's'}` : ''}`);
		const dirname = item.path.includes('/') ? item.path.slice(0, Math.max(0, item.path.length - item.name.length - 1)) : '';
		const content = append(card, $('.basehalf-canvas-card-content'));
		const canShowBadgeFace = !(item.kind === 'folder' && orphan);

		const mini = append(content, $('.basehalf-canvas-card-mini'));
		this.renderCardTitleChip(mini, type, item.name, orphan, bounds.height, badgeIssueCount);

		const summary = append(content, $('.basehalf-canvas-card-summary'));
		this.renderCardSummary(summary, type, item, preview, orphan, badgeRelationships, badgeIssueCount, canShowBadgeFace);

		const full = append(content, $('.basehalf-canvas-card-full'));
		const header = append(full, $('.basehalf-canvas-card-header'));
		const icon = append(header, $('.basehalf-canvas-card-icon'));
		this.renderGlyph(icon, type, glyphTone(type, orphan), 15);
		const title = append(header, $('.basehalf-canvas-card-title'));
		const titleRow = append(title, $('.basehalf-canvas-card-title-row'));
		const label = append(titleRow, $('.basehalf-canvas-card-label'));
		label.textContent = item.name;
		if (preview?.kind === 'folder') {
			const count = append(titleRow, $('.basehalf-canvas-card-kind-chip.folder'));
			count.textContent = folderCountLabel(preview.total);
		}
		if (canShowBadgeFace) {
			this.renderCardBadgeToggle(titleRow, item, badgeRelationships, badgeIssueCount);
		}
		if (orphan) {
			const missing = append(titleRow, $('.basehalf-canvas-card-kind-chip.danger'));
			missing.textContent = 'Missing';
		}
		if (dirname) {
			const path = append(title, $('.basehalf-canvas-card-path'));
			path.textContent = `${dirname}/`;
		}

		const body = append(full, $('.basehalf-canvas-card-body'));
		if (this.openBadgeFaces.has(item.path) && canShowBadgeFace) {
			this.renderCardBadgeFace(body, item, structuralStamp);
		} else {
			this.renderCardPreview(body, item, preview, orphan);
		}
		this.renderFolderCoverage(full, item, preview);
		this.renderInlineRenameEditor(card, item);
		this.restorePendingCanvasBadgeFocus(card, item.path);

		this.cardListeners.add(this.addDisposableListener(card, 'keydown', event => {
			if (event.target !== card) {
				return;
			}
			if (event.key === 'F2') {
				event.preventDefault();
				event.stopPropagation();
				void this.requestInlineRename(item);
			} else if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				void this.canvasNavigationService.openResource(item.stat.resource, { source: 'api', pinned: true });
			}
		}));
		return card;
	}

	private restorePendingCanvasBadgeFocus(card: HTMLElement, path: string): void {
		const pending = this.pendingCanvasBadgeFocus;
		if (!pending || pending.path !== path) {
			return;
		}

		this.pendingCanvasBadgeFocus = undefined;
		let attempts = 0;
		const focus = () => {
			if (this.disposed) {
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
					target = card.dataset.lod === 'full'
						? card.querySelector<HTMLTextAreaElement>('.basehalf-canvas-card-badge-prompt')
						: undefined;
					break;
				case 'add-reference':
					target = card.dataset.lod === 'full'
						? card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-add-reference')
						: undefined;
					break;
				case 'inbound-toggle':
					target = card.dataset.lod === 'full'
						? card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-inbound-toggle')
						: undefined;
					break;
			}
			const projection = card.dataset.lod === 'full' ? '.basehalf-canvas-card-full' : '.basehalf-canvas-card-summary';
			(target ?? card.querySelector<HTMLButtonElement>(`${projection} .basehalf-canvas-card-badge-toggle`))?.focus();
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
		if (item.card || (preview?.kind !== 'empty' && !(preview?.kind === 'folder' && preview.total === 0))) {
			return bounds;
		}
		return { ...bounds, height: BASEHALF_CANVAS_CARD_FULL_MIN_HEIGHT };
	}

	private renderCardTitleChip(container: HTMLElement, type: BaseHalfCanvasGlyphType, name: string, orphan: boolean, cardHeightPx: number, badgeIssueCount: number): void {
		const capPx = Math.round(Math.max(MINI_LABEL_MIN_FLOW_PX, cardHeightPx * MINI_LABEL_CARD_HEIGHT_FRACTION));
		container.style.setProperty('--bh-mini-label-cap', `${capPx}px`);
		const flow = append(container, $('.basehalf-canvas-card-mini-flow'));
		const icon = append(flow, $('.basehalf-canvas-card-mini-icon'));
		this.renderGlyph(icon, type, glyphTone(type, orphan), '1.15em');
		const label = append(flow, $('.basehalf-canvas-card-mini-label'));
		label.textContent = name;
		label.classList.toggle('danger', orphan);
		if (badgeIssueCount > 0) {
			const marker = append(label, $('span.basehalf-reference-issue-marker.mini'));
			marker.setAttribute('data-testid', 'card-reference-issue-marker');
			marker.setAttribute('data-reference-issue-count', String(badgeIssueCount));
			marker.setAttribute('aria-hidden', 'true');
		}
	}

	private renderCardSummary(
		container: HTMLElement,
		type: BaseHalfCanvasGlyphType,
		item: IBaseHalfCanvasItem,
		preview: BaseHalfCanvasCardPreview | undefined,
		orphan: boolean,
		badgeRelationships: ReturnType<typeof baseHalfCanvasBadgeRelationships>,
		badgeIssueCount: number,
		canShowBadgeFace: boolean
	): void {
		const flow = append(container, $('.basehalf-canvas-card-summary-flow'));
		const identity = append(flow, $('.basehalf-canvas-card-summary-identity'));
		const icon = append(identity, $('.basehalf-canvas-card-summary-icon'));
		this.renderGlyph(icon, type, glyphTone(type, orphan), 15);
		const label = append(identity, $('.basehalf-canvas-card-summary-label'));
		label.textContent = item.name;
		label.classList.toggle('danger', orphan);
		if (canShowBadgeFace) {
			this.renderCardBadgeToggle(identity, item, badgeRelationships, badgeIssueCount);
		}

		const detail = append(flow, $('.basehalf-canvas-card-summary-detail'));
		detail.textContent = this.openBadgeFaces.has(item.path)
			? cardBadgeSummaryText(item, badgeRelationships, badgeIssueCount)
			: cardSummaryText(item, preview, orphan);
	}

	private renderCardBadgeToggle(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		badgeRelationships: ReturnType<typeof baseHalfCanvasBadgeRelationships>,
		badgeIssueCount: number
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
		this.cardListeners.add(this.addDisposableListener(badgeToggle, 'pointerdown', event => {
			event.stopPropagation();
		}));
		this.cardListeners.add(this.addDisposableListener(badgeToggle, 'dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		}));
		this.cardListeners.add(this.addDisposableListener(badgeToggle, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			this.selectCard(item.path);
			this.toggleBadgeFace(item.path);
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

	private renderCardPreview(container: HTMLElement, item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined, orphan: boolean): void {
		const previewNode = append(container, $('.basehalf-canvas-card-preview'));
		previewNode.classList.add(`kind-${preview?.kind ?? 'unavailable'}`);
		if (orphan) {
			previewNode.textContent = item.kind === 'folder' ? item.badge?.description ?? '' : 'Missing file';
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
			this.renderMarkdownPreview(previewNode, preview.text);
			return;
		}
		previewNode.textContent = preview.text;
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

	private renderMarkdownPreview(container: HTMLElement, text: string): void {
		const md = append(container, $('.bh-md-preview'));
		const lines = text.split('\n').slice(0, 10);
		for (const raw of lines) {
			const line = raw.trim();
			if (!line) {
				continue;
			}
			const heading = /^(#{1,3})\s+(.+)$/.exec(line);
			if (heading) {
				const h = append(md, heading[1].length === 1 ? $('h1') : heading[1].length === 2 ? $('h2') : $('h3'));
				h.textContent = stripMarkdownInline(heading[2]);
				continue;
			}
			const bullet = /^[-*+]\s+(.+)$/.exec(line);
			if (bullet) {
				const item = append(md, $('p.bullet'));
				item.textContent = `• ${stripMarkdownInline(bullet[1])}`;
				continue;
			}
			const paragraph = append(md, $('p'));
			paragraph.textContent = stripMarkdownInline(line);
		}
	}

	private renderCardBadgeFace(container: HTMLElement, item: IBaseHalfCanvasItem, structuralStamp: IBaseHalfWorkspaceMutationStamp): void {
		const face = append(container, $('.basehalf-canvas-card-badge-face'));
		face.classList.add('nowheel', 'nodrag');
		face.setAttribute('data-testid', `card-badge-face-${item.path}`);
		this.cardListeners.add(this.addDisposableListener(face, 'pointerdown', event => event.stopPropagation()));
		this.cardListeners.add(this.addDisposableListener(face, 'mousedown', event => event.stopPropagation()));
		this.cardListeners.add(this.addDisposableListener(face, 'dblclick', event => event.stopPropagation()));
		this.cardListeners.add(this.addDisposableListener(face, 'wheel', event => event.stopPropagation()));
		this.cardListeners.add(this.addDisposableListener(face, 'keydown', event => {
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
		const mutationGuard = this.sceneMutationGuard(folder.workspaceFolder, structuralStamp);

		this.renderBadgeEditorContent(body, {
			resource: item.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: item.path,
			kind: item.kind
		}, item.badge, this.renderedBadges, this.renderedBadgeProblems, mutationGuard,
		disposable => this.cardListeners.add(disposable),
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

	private cardLod(bounds: IBaseHalfCanvasBounds): BaseHalfCanvasCardLod {
		return baseHalfCanvasCardLod(bounds.height, this.canvasZoom);
	}


	private badgeDescriptionKey(workspaceFolder: URI, relativePath: string): string {
		return `${workspaceFolder.toString()}\0${relativePath}`;
	}

	private badgeMetadataWithDraft(
		workspaceFolder: URI,
		relativePath: string,
		badge: IBaseHalfCanvasBadgeMetadata | undefined
	): IBaseHalfCanvasBadgeMetadata | undefined {
		const draft = this.badgeDescriptionDrafts.get(this.badgeDescriptionKey(workspaceFolder, relativePath));
		if (!draft) {
			return badge;
		}
		return {
			description: draft.value,
			references: badge?.references ?? [],
			referenced_by: badge?.referenced_by ?? [],
			orphan: badge?.orphan
		};
	}

	private scheduleBadgeDescriptionWrite(node: IBaseHalfBadgeNode, value: string, guard: IBaseHalfCanvasMutationGuard): void {
		const key = this.badgeDescriptionKey(node.workspaceFolder, node.relativePath);
		if (guard.workspaceKey !== node.workspaceFolder.toString()) {
			return;
		}
		this.badgeDescriptionDrafts.set(key, { node, guard, value });
		const existing = this.badgeDescriptionTimers.get(key);
		if (existing !== undefined) {
			mainWindow.clearTimeout(existing);
			this.badgeDescriptionTimers.delete(key);
		}
		const current = this.badgeDescriptionPending.get(key);
		if (current) {
			current.value = value;
			if (!current.delayReleased) {
				this.badgeDescriptionTimers.set(key, mainWindow.setTimeout(() => this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath), BASEHALF_AUTO_SAVE_DELAY_MS));
			}
			return;
		}

		let releaseDelay!: () => void;
		const delay = new Promise<void>(resolve => releaseDelay = resolve);
		const pending: IBaseHalfBadgeDescriptionPending = { node, guard, value, delayReleased: false, delay, releaseDelay };
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
			} else if (draft) {
				this.scheduleBadgeDescriptionWrite(draft.node, draft.value, draft.guard);
			}
			this.scheduleBackgroundRender();
		}).catch(error => {
			if (this.badgeDescriptionPending.get(key) === pending) {
				this.badgeDescriptionPending.delete(key);
			}
			this.clearBadgeDescriptionTimer(key);
			this.logService.error(error);
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.scheduleBackgroundRender();
		});
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
			if (draft) {
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
			if (!this.badgeDescriptionPending.has(key)) {
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
		this.flushBadgeDescriptionWrite(source.workspaceFolder, source.relativePath);
		await guard.run(async lease => {
			const live = await this.resolveLiveWorkspaceNodes(source.workspaceFolder, [{ path: source.relativePath, kind: source.kind }]);
			const removed = await this.badgeGraphService.removeReference(live.get(source.relativePath)!, {
				resource: joinPath(source.workspaceFolder, ...to.split('/')),
				workspaceFolder: source.workspaceFolder,
				relativePath: to,
				kind: 'file'
			}, lease);
			if (!removed) {
				throw new Error(`The reference ${source.relativePath} → ${to} changed before it could be removed.`);
			}
			// Style cleanup only — with the edge set derived from references, the
			// line is already gone; this just keeps canvas.yaml from hoarding stale
			// anchor entries.
			if (canvasFolder?.workspaceFolder.toString() === source.workspaceFolder.toString()) {
				await this.canvasMirrorService.removeCanvasEdge(canvasFolder, { from: source.relativePath, to }, lease);
			}
		}, [targetStamp]);
		return true;
	}

	private renderTruncated(heldBack: number): void {
		const truncated = append(this.canvasOverlay, $('.basehalf-canvas-truncated'));
		truncated.textContent = `+${heldBack} more`;
	}

	private renderCanvasWarning(message: string): void {
		const warningIndex = this.canvasOverlay.querySelectorAll('.basehalf-canvas-warning').length;
		const warning = append(this.canvasOverlay, $('.basehalf-canvas-warning'));
		warning.style.top = `${58 + warningIndex * 30}px`;
		warning.textContent = message;
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

	private async reconcileRetainedDetailIdentity(
		openedDetail: IBaseHalfCardDetailState,
		effect: Exclude<BaseHalfStructuralResourceOutcome, { readonly kind: 'none' }>
	): Promise<void> {
		const resourceKey = openedDetail.resource.toString();
		if (this.canvasNavigationService.state.cardDetail?.resource.toString() !== resourceKey) {
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
		clearNode(this.detailProjectionActions);
		this.disposeDetailSurfaces();
		this.setDetailSaveStatus(undefined);

		if (effect.kind === 'close') {
			await this.closeInvalidatedDetail(seq, resourceKey);
			return;
		}

		const nextResource = effect.kind === 'move' ? effect.resource : openedDetail.resource;
		let stat: IFileStat;
		try {
			stat = await this.fileService.resolve(nextResource);
		} catch {
			await this.closeInvalidatedDetail(seq, resourceKey);
			return;
		}
		if (!this.isPendingDetailIdentity(seq, resourceKey)) {
			return;
		}
		if (!stat.isFile) {
			await this.closeInvalidatedDetail(seq, resourceKey);
			return;
		}

		if (effect.kind === 'move') {
			const result = await this.canvasNavigationService.openCardDetail(nextResource, {
				source: openedDetail.source,
				selection: openedDetail.selection,
				preserveFocus: openedDetail.preserveFocus,
				pinned: openedDetail.pinned,
				projection: openedDetail.projection
			});
			if (!result.handled && this.isPendingDetailIdentity(seq, resourceKey)) {
				await this.closeInvalidatedDetail(seq, resourceKey);
			}
			return;
		}

		// No member touching this URI completed. Rebuild only after the URI has
		// been resolved as a file; the old retained model/webview never inherits
		// a freshly captured generation.
		this.detailIdentityPendingResourceKey = undefined;
		this.requestRender();
	}

	private isPendingDetailIdentity(seq: number, resourceKey: string): boolean {
		return !this.disposed
			&& seq === this.detailIdentityReconcileSeq
			&& this.detailIdentityPendingResourceKey === resourceKey
			&& this.canvasNavigationService.state.cardDetail?.resource.toString() === resourceKey;
	}

	private async closeInvalidatedDetail(seq: number, resourceKey: string): Promise<void> {
		if (!this.isPendingDetailIdentity(seq, resourceKey)) {
			return;
		}
		await this.canvasNavigationService.closeCardDetail();
	}

	private renderDetail(): void {
		const cardDetail = this.canvasNavigationService.state.cardDetail;
		this.detail.classList.toggle('visible', !!cardDetail);
		this.syncDetailScrollLock(!!cardDetail);
		if (!cardDetail) {
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
			this.detailBadgeSeq++;
			this.detailBadgeDisposables.clear();
			clearNode(this.detailBadgeZone);
			this.setDetailSaveStatus(undefined);
			clearNode(this.detailProjectionActions);
			// detailBody is NOT cleared wholesale: surfaces remove their own
			// hosts on dispose, and the prewarmed shell parked in the body
			// must survive open/close cycles.
			clearNode(this.detailTitle);
			this.detailMeta.textContent = '';
			// Re-assert folder focus only on the open→closed TRANSITION. An
			// unconditional write here would race the initial-framing restore:
			// renderDetail runs before the canvas pipeline, so a 0ms write of
			// the not-yet-framed viewport would land in focus.yaml first and
			// the restore would then faithfully restore the unframed state.
			if (wasOpen) {
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

		this.detailTitle.textContent = basename(cardDetail.resource);
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
	}

	private syncDetailMutationFence(): void {
		const detail = this.canvasNavigationService.state.cardDetail;
		const fenced = !!detail && this.workspaceMutationCoordinator.isResourceMutationFenced(detail.workspaceFolder, detail.relativePath);
		this.detail.inert = fenced;
		this.detail.toggleAttribute('aria-busy', fenced);
		for (const surface of this.detailSurfaces.values()) {
			if (surface.instance instanceof BaseHalfMarkdownRichCardDetail) {
				surface.instance.setStructuralFrozen(fenced);
			}
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
		// The prewarmed shell's layer already sits in the detail body (its
		// iframe must never reparent); adopting it makes that layer THE
		// surface host for this card.
		const prewarmed = projection === 'rich' ? this.richWebviewWarmup.take() : undefined;
		const host = prewarmed ? prewarmed.host : append(this.detailBody, $('.basehalf-card-detail-surface'));
		const store = new DisposableStore();
		store.add(toDisposable(() => host.remove()));

		let instance: IBaseHalfCardDetailSurface['instance'];
		if (projection === 'rich') {
			instance = store.add(this.instantiationService.createInstance(
				BaseHalfMarkdownRichCardDetail,
				host,
				() => this.closeDetailBadgePopover(cardDetail, false),
				status => this.setDetailSaveStatus(status),
				prewarmed
			));
		} else if (projection === 'preview') {
			instance = store.add(this.instantiationService.createInstance(
				BaseHalfMarkdownPreviewCardDetail,
				host,
				status => this.setDetailSaveStatus(status)
			));
		} else {
			instance = store.add(this.instantiationService.createInstance(
				BaseHalfSourceCardDetail,
				host,
				status => this.setDetailSaveStatus(status)
			));
		}

		const whenRendered = instance.open(cardDetail).catch(error => this.logService.error(error));
		if (instance instanceof BaseHalfMarkdownRichCardDetail) {
			instance.setStructuralFrozen(this.workspaceMutationCoordinator.isResourceMutationFenced(cardDetail.workspaceFolder, cardDetail.relativePath));
		}
		return { host, store, instance, whenRendered };
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
		const badgeForDisplay = this.badgeMetadataWithDraft(cardDetail.workspaceFolder, node.relativePath, badge ?? undefined);
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
			this.resourceMutationGuard(cardDetail.workspaceFolder, structuralStamp),
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
		this.detailProjectionActions.classList.toggle('visible', isBaseHalfMarkdownResource(cardDetail.resource));
		if (!isBaseHalfMarkdownResource(cardDetail.resource)) {
			return;
		}

		this.renderProjectionButton(cardDetail, 'rich', 'Rich', 'codicon-edit');
		this.renderProjectionButton(cardDetail, 'preview', 'Preview', 'codicon-preview');
		this.renderProjectionButton(cardDetail, 'source', 'Source', 'codicon-code');
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
				projection
			});
		}));
	}

	private detailSelectionMetaFor(selection: { startLineNumber: number; startColumn: number } | undefined): string {
		if (!selection) {
			return '';
		}

		return `L${selection.startLineNumber}:${selection.startColumn}`;
	}


	private createZoomButton(container: HTMLElement, title: string, icon: string, action: () => void): HTMLButtonElement {
		const button = append(container, $(`button.basehalf-canvas-zoom-button.codicon.${icon}`)) as HTMLButtonElement;
		button.type = 'button';
		button.title = title;
		button.setAttribute('aria-label', title);
		this._register(this.addDisposableListener(button, 'click', () => action()));
		return button;
	}

	private updateCanvasZoomChrome(): void {
		const zoom = normalizeCanvasZoom(this.canvasZoom);
		this.canvasZoom = zoom;
		this.root.style.setProperty('--basehalf-canvas-zoom', String(zoom));
		this.root.dataset.zoom = String(zoom);
		this.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
		this.zoomOut.disabled = zoom <= BASEHALF_CANVAS_MIN_ZOOM;
		this.zoomIn.disabled = zoom >= BASEHALF_CANVAS_MAX_ZOOM;
		this.zoomReset.disabled = zoom === 1;
	}

	private zoomBy(direction: -1 | 1): void {
		this.setCanvasZoom(this.canvasZoom + direction * BASEHALF_CANVAS_ZOOM_STEP);
	}

	private onCanvasKeyDown(event: KeyboardEvent): void {
		if (!(event.metaKey || event.ctrlKey)) {
			return;
		}

		if (event.key === '=' || event.key === '+') {
			event.preventDefault();
			this.zoomBy(1);
		} else if (event.key === '-') {
			event.preventDefault();
			this.zoomBy(-1);
		} else if (event.key === '0') {
			event.preventDefault();
			this.setCanvasZoom(1);
		}
	}


	private setCanvasZoom(value: number): void {
		const nextZoom = normalizeCanvasZoom(value);
		if (nextZoom === this.canvasZoom) {
			return;
		}
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
		if (this.renderQueuedBehindGesture) {
			this.renderQueuedBehindGesture = false;
			this.requestRender();
		}
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
		void this.focusMirrorService.readFolderFocus(folder).then(async fields => {
			if (seq !== this.renderSeq || this.canvasNavigationService.state.cardDetail) {
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

function roundCanvasPosition(value: number): number {
	return Number(value.toFixed(2));
}

function normalizeCanvasZoom(value: number): number {
	return Number(normalizeBaseHalfCanvasZoom(value).toFixed(4));
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

function mediaPreviewLabel(name: string): string | undefined {
	const lower = name.toLowerCase();
	if (/\.(png|jpg|jpeg|gif|webp|svg|avif)$/.test(lower)) {
		return 'Image file';
	}
	if (/\.pdf$/.test(lower)) {
		return 'PDF document';
	}
	if (/\.(mp4|mov|webm|mkv)$/.test(lower)) {
		return 'Video file';
	}
	if (/\.(mp3|wav|m4a|flac|ogg)$/.test(lower)) {
		return 'Audio file';
	}
	return undefined;
}

function markdownPreviewKind(name: string): 'markdown' | 'text' | 'code' {
	if (/\.(md|markdown|mdx)$/i.test(name)) {
		return 'markdown';
	}
	return badgeType(name, false) === 'code' ? 'code' : 'text';
}

function cleanMarkdownPreviewSource(raw: string): string {
	const lines = raw.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
		.split('\n')
		.map(line => line.trimEnd())
		.filter(line => line.trim().length > 0)
		.slice(0, 12);
	const preview = lines.join('\n');
	return preview.length > 800 ? `${preview.slice(0, 797)}...` : preview;
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

function stripMarkdownInline(value: string): string {
	return value
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/[*_`~]/g, '')
		.trim();
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

function folderCountLabel(total: number): string {
	return total === 0 ? 'empty' : total === 1 ? '1 item' : `${total} items`;
}

function cardSummaryText(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined, orphan: boolean): string {
	if (orphan) {
		return item.kind === 'folder' ? item.badge?.description ?? 'Missing folder' : 'Missing file';
	}
	if (!preview) {
		return 'Preview unavailable';
	}
	if (preview.kind === 'folder') {
		const count = folderCountLabel(preview.total);
		const firstNames = preview.items.slice(0, 2).map(child => child.kind === 'folder' ? `${child.name}/` : child.name);
		return firstNames.length > 0 ? `${count}\n${firstNames.join(', ')}` : count;
	}
	const lines = preview.text.split(/\r?\n/)
		.map(line => stripMarkdownInline(line.trim().replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s{0,3}>\s?/, '')))
		.filter(Boolean)
		.slice(0, 3);
	return lines.length > 0 ? lines.join('\n') : 'Empty file';
}

function cardBadgeSummaryText(
	item: IBaseHalfCanvasItem,
	relationships: ReturnType<typeof baseHalfCanvasBadgeRelationships>,
	issueCount: number
): string {
	const lines = [item.badge?.description?.trim() || 'No Badge prompt'];
	if (issueCount > 0) {
		lines.push(`${issueCount} metadata issue${issueCount === 1 ? '' : 's'}`);
	}
	if (relationships.references.length > 0) {
		lines.push(`${relationships.references.length} reference${relationships.references.length === 1 ? '' : 's'}`);
	}
	if (relationships.referencedBy.length > 0) {
		lines.push(`${relationships.referencedBy.length} referenced by`);
	}
	return lines.slice(0, 3).join('\n');
}

function canvasChildPath(parent: string, name: string): string {
	return parent ? `${parent}/${name}` : name;
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
	if (type === 'pdf' || type === 'generic') {
		appendPath('M4 2.5h4.5l3 3V13H4z');
		appendPath('M8.5 2.5v3h3');
		if (type === 'pdf') {
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
