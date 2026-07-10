/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasWorkbench.css';

import { $, append, clearNode } from '../../../base/browser/dom.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { basename, isEqualOrParent, joinPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { FileChangesEvent, IFileService, IFileStat } from '../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IQuickInputService, IQuickPickItem } from '../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchLayoutService, Parts } from '../../services/layout/browser/layoutService.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { SideBySideEditor } from '../../common/editor.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { mainWindow } from '../../../base/browser/window.js';
import {
	baseHalfCanvasItemBounds,
	baseHalfCanvasModelFromStat,
	IBaseHalfCanvasBadgeMetadata,
	IBaseHalfCanvasBounds,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasFile,
	IBaseHalfCanvasItem
} from '../common/basehalfCanvasModel.js';
import { IBaseHalfBadgeGraphService } from '../common/basehalfBadgeGraph.js';
import { IBaseHalfBadgeFile, IBaseHalfBadgeNode } from '../common/basehalfBadgeMirror.js';
import { BaseHalfCanvasMirrorCorrupt, IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { baseHalfMirrorRoot } from '../common/basehalfMirrorTree.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService, IBaseHalfCardDetailState } from '../common/basehalfCanvasNavigation.js';
import { BaseHalfCardDetailProjection, isBaseHalfMarkdownResource } from '../common/basehalfCardDetail.js';
import { IBaseHalfFocusMirrorService } from '../common/basehalfFocusMirrorService.js';
import { BaseHalfMarkdownPreviewCardDetail } from './cardDetail/basehalfMarkdownPreviewCardDetail.js';
import { BaseHalfMarkdownRichCardDetail } from './cardDetail/basehalfMarkdownRichCardDetail.js';
import { BaseHalfMarkdownRichWebviewWarmup } from './cardDetail/basehalfMarkdownRichWebviewWarmup.js';
import { BaseHalfSourceCardDetail } from './cardDetail/basehalfSourceCardDetail.js';
import { BaseHalfCanvasReactScene } from './basehalfCanvasReactScene.js';
import { BASEHALF_CANVAS_MAX_ZOOM, BASEHALF_CANVAS_MIN_ZOOM, BaseHalfSetting, normalizeBaseHalfCanvasZoom } from '../common/basehalfConfiguration.js';
import { BASEHALF_AUTO_SAVE_DELAY_MS } from '../common/basehalfWorkbenchProfile.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from '../common/basehalfEditorFlush.js';
import {
	IBaseHalfCanvasSceneConnection,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneGeometry,
	IBaseHalfCanvasSceneReconnect,
	IBaseHalfCanvasSceneViewport
} from '../common/basehalfCanvasScene.js';
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
type BaseHalfCanvasCardLod = 'full' | 'mini';
type BaseHalfCanvasGlyphType = 'folder' | 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'code' | 'generic' | 'badge';
type BaseHalfCardDetailSaveStatus = 'saving' | 'saved' | 'error';
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
const CARD_LOD_MIN_HEIGHT_PX = 150;
const CARD_LOD_MIN_ZOOM = 0.5;
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
	private readonly detailChromeDisposables = this._register(new DisposableStore());

	private renderSeq = 0;
	private backgroundRenderTimer: number | undefined;
	private readonly badgeDescriptionTimers = new Map<string, number>();
	private readonly badgeDescriptionPending = new Map<string, {
		readonly node: IBaseHalfBadgeNode;
		readonly guard: IBaseHalfCanvasMutationGuard;
		value: string;
		delayReleased: boolean;
		readonly delay: Promise<void>;
		readonly releaseDelay: () => void;
	}>();
	private readonly pendingCanvasWarnings: string[] = [];
	private renderedBadges: ReadonlyMap<string, IBaseHalfBadgeFile> = new Map();
	private readonly detailBadgeDisposables: DisposableStore;
	private detailBadgeSeq = 0;
	private detailBadgeOpen = false;
	private detailBadgeResourceKey: string | undefined;
	private detailResourceMutationStamp: IBaseHalfWorkspaceResourceMutationStamp | undefined;
	private readonly expandedInboundBadges = new Set<string>();
	private readonly openBadgeFaces = new Set<string>();
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
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService
	) {
		super();
		this.detailBadgeDisposables = this._register(new DisposableStore());

		const editorContainer = this.layoutService.getContainer(mainWindow, Parts.EDITOR_PART);
		if (!editorContainer) {
			throw new Error('BaseHalf canvas requires the main editor part container.');
		}

		this.editorContainer = editorContainer;
		this.editorContainer.classList.add('basehalf-canvas-host');
		this.root = $('.basehalf-canvas-workbench');
		this.root.setAttribute('aria-label', 'BaseHalf canvas');
		// Focusable (not tabbable) for canvas keyboard shortcuts. Edge deletion is
		// scoped more narrowly to the React Flow scene host.
		this.root.tabIndex = -1;

		this.chrome = append(this.root, $('.basehalf-canvas-chrome'));
		const zoomControls = append(this.chrome, $('.basehalf-canvas-zoom-controls'));
		this.zoomOut = this.createZoomButton(zoomControls, 'Zoom Out', 'codicon-remove', () => this.zoomBy(-1));
		this.zoomValue = append(zoomControls, $('.basehalf-canvas-zoom-value'));
		this.zoomReset = this.createZoomButton(zoomControls, 'Reset Zoom', 'codicon-debug-restart', () => this.setCanvasZoom(1));
		this.zoomIn = this.createZoomButton(zoomControls, 'Zoom In', 'codicon-add', () => this.zoomBy(1));
		this.surface = append(this.root, $('.basehalf-canvas-surface'));
		this.cards = append(this.surface, $('.basehalf-canvas-cards'));
		this.canvasOverlay = append(this.surface, $('.basehalf-canvas-overlay'));
		this.canvasScene = this._register(new BaseHalfCanvasReactScene(this.cards, {
			commitGeometry: (sceneKey, structuralEpoch, geometries) => this.commitSceneGeometry(sceneKey, structuralEpoch, geometries),
			connect: (sceneKey, structuralEpoch, connection) => this.connectSceneEdge(sceneKey, structuralEpoch, connection),
			reconnect: (sceneKey, structuralEpoch, intent) => this.reconnectSceneEdge(sceneKey, structuralEpoch, intent),
			removeEdge: (sceneKey, structuralEpoch, edge) => this.removeEdgeFromScene(sceneKey, structuralEpoch, edge),
			editEdgeLabel: (sceneKey, structuralEpoch, edge) => this.editSceneEdgeLabel(sceneKey, structuralEpoch, edge),
			openCard: (sceneKey, structuralEpoch, path) => this.openSceneCard(sceneKey, structuralEpoch, path),
			reportViewport: (sceneKey, viewport, final) => this.onSceneViewport(sceneKey, viewport, final),
			didEndInteraction: () => this.flushRenderQueuedBehindGesture(),
			reportError: error => {
				this.logService.error(error instanceof Error ? error : String(error));
				this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				this.requestRender();
			}
		}));

		this.detail = append(this.root, $('.basehalf-card-detail'));
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
		this._register(this.fileService.onDidFilesChange(event => {
			const folder = this.getCurrentFolder();
			if (!folder) {
				return;
			}

			// The folder's mirror node lives under `<workspace>/.bh/mirror/<rel>`,
			// NOT under the folder resource itself — an agent editing badge.yaml
			// for a SUBFOLDER canvas must still re-render it.
			if ((event.affects(folder.resource) || event.affects(baseHalfMirrorRoot(folder.workspaceFolder))) && !this.isFocusMirrorOnlyChange(event, folder)) {
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
			for (const pending of this.badgeDescriptionPending.values()) {
				pending.releaseDelay();
			}
			this.badgeDescriptionTimers.clear();
			this.badgeDescriptionPending.clear();
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
			this.requestRender();
		}, 100);
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
		clearNode(this.canvasOverlay);
		const folder = this.getCurrentFolder();

		if (!folder) {
			this.renderedItemsByPath = new Map();
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
			this.renderedItemsByPath = new Map();
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

		this.renderedBadges = badgeRead.badges;
		this.renderedItemsByPath = new Map(items.map(item => [item.path, item]));
		this.cardListeners.clear();
		const sceneCards = items.map((item, index) => {
			const bounds = baseHalfCanvasItemBounds(item, index, items.length);
			return {
				path: item.path,
				kind: item.kind,
				...bounds,
				element: this.createCard(item, index, items.length, previews.get(item.path), structuralStamp)
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
					to_anchor: connection.toAnchor,
					...(previous.label !== undefined ? { label: previous.label } : {})
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

	private async editSceneEdgeLabel(sceneKey: string, structuralEpoch: number, edge: IBaseHalfCanvasSceneEdge): Promise<void> {
		const queuedFolder = this.folderForSceneMutation(sceneKey);
		const next = await this.quickInputService.input({
			title: 'Reference note',
			placeHolder: 'Say why these connect',
			value: edge.label ?? ''
		});
		if (next === undefined) {
			return;
		}
		await this.workspaceMutationCoordinator.runSceneMutation(
			queuedFolder.workspaceFolder,
			this.sceneMutationStamp(queuedFolder, structuralEpoch),
			async lease => {
				const folder = this.folderForSceneMutation(sceneKey);
					const live = await this.resolveLiveCanvasNodes(sceneKey, folder, [
						{ path: edge.from, kind: edge.fromKind },
						{ path: edge.to, kind: edge.toKind }
					]);
					const label = next.trim() || undefined;
					await this.badgeGraphService.runWithReference(live.get(edge.from)!, live.get(edge.to)!, async () => {
						if (label === undefined) {
							// Clearing a derived edge with no style is intentionally a no-op.
							await this.canvasMirrorService.setCanvasEdgeLabel(folder, edge, undefined, lease);
							return;
						}
						// A derived edge has no canvas row yet. Materialize its complete style
						// from the scene anchors instead of silently mapping over an empty list.
						await this.canvasMirrorService.upsertCanvasEdge(folder, {
							from: edge.from,
							from_anchor: edge.from_anchor,
							to: edge.to,
							to_anchor: edge.to_anchor,
							label
						}, lease);
					}, lease);
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
		let sawFolderChange = false;
		for (const resource of [...event.rawAdded, ...event.rawUpdated, ...event.rawDeleted]) {
			if (!isEqualOrParent(resource, folder.resource)) {
				continue;
			}
			sawFolderChange = true;
			if (!isBaseHalfFocusMirrorResource(resource)) {
				return false;
			}
		}
		return sawFolderChange;
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

	private createCard(
		item: IBaseHalfCanvasItem,
		index: number,
		total: number,
		preview: BaseHalfCanvasCardPreview | undefined,
		structuralStamp: IBaseHalfWorkspaceMutationStamp
	): HTMLElement {
		const bounds = baseHalfCanvasItemBounds(item, index, total);
		const card = $('.basehalf-canvas-card');
		card.tabIndex = 0;
		card.setAttribute('role', 'button');
		card.dataset.basehalfCardPath = item.path;
		card.dataset.cardHeight = String(bounds.height);
		card.dataset.lod = this.cardLod(bounds);
		card.classList.add(item.kind);
		card.classList.toggle('badge-open', this.openBadgeFaces.has(item.path));
		card.setAttribute('aria-label', `${item.name} card`);
		card.title = item.kind === 'folder'
			? `${item.path} - click to select; double-click to enter this folder`
			: `${item.path} - click to select; double-click to open the editor`;

		const type = badgeType(item.name, item.kind === 'folder');
		const orphan = item.badge?.orphan === true;
		const dirname = item.path.includes('/') ? item.path.slice(0, Math.max(0, item.path.length - item.name.length - 1)) : '';
		const content = append(card, $('.basehalf-canvas-card-content'));

		const mini = append(content, $('.basehalf-canvas-card-mini'));
		this.renderCardTitleChip(mini, type, item.name, orphan, bounds.height);

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
		const canShowBadgeFace = !(item.kind === 'folder' && orphan);
		if (canShowBadgeFace) {
			const badgeToggle = append(titleRow, $('button.basehalf-canvas-card-badge-toggle')) as HTMLButtonElement;
			badgeToggle.classList.add('nodrag', 'nopan', 'nowheel');
			badgeToggle.type = 'button';
			badgeToggle.title = this.openBadgeFaces.has(item.path) ? 'Hide the badge - back to the preview' : item.badge?.description ? 'Has a badge - edit it' : 'Edit Badge';
			badgeToggle.setAttribute('aria-label', `${this.openBadgeFaces.has(item.path) ? 'Hide' : 'Show'} badge for ${item.path}`);
			badgeToggle.setAttribute('aria-pressed', String(this.openBadgeFaces.has(item.path)));
			badgeToggle.classList.toggle('lit', !!item.badge?.description);
			badgeToggle.classList.toggle('pressed', this.openBadgeFaces.has(item.path));
			this.renderGlyph(badgeToggle, 'badge', item.badge?.description ? 'var(--bh-card-accent)' : 'var(--bh-card-text-tertiary)', 15);
			if (item.badge?.description && (item.badge.references.length > 0 || item.badge.referenced_by.length > 0)) {
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

		this.cardListeners.add(this.addDisposableListener(card, 'keydown', event => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				void this.canvasNavigationService.openResource(item.stat.resource, { source: 'api', pinned: true });
			}
		}));
		return card;
	}

	private renderCardTitleChip(container: HTMLElement, type: BaseHalfCanvasGlyphType, name: string, orphan: boolean, cardHeightPx: number): void {
		const capPx = Math.round(Math.max(MINI_LABEL_MIN_FLOW_PX, cardHeightPx * MINI_LABEL_CARD_HEIGHT_FRACTION));
		container.style.setProperty('--bh-mini-label-cap', `${capPx}px`);
		const flow = append(container, $('.basehalf-canvas-card-mini-flow'));
		const icon = append(flow, $('.basehalf-canvas-card-mini-icon'));
		this.renderGlyph(icon, type, glyphTone(type, orphan), '1.15em');
		const label = append(flow, $('.basehalf-canvas-card-mini-label'));
		label.textContent = name;
		label.classList.toggle('danger', orphan);
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
		this.cardListeners.add(this.addDisposableListener(face, 'dblclick', event => event.stopPropagation()));
		this.cardListeners.add(this.addDisposableListener(face, 'wheel', event => event.stopPropagation()));

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
		}, item.badge, mutationGuard, disposable => this.cardListeners.add(disposable), () => this.referenceCandidates(item));
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
		mutationGuard: IBaseHalfCanvasMutationGuard,
		addListener: (disposable: IDisposable) => void,
		candidates: () => readonly IBaseHalfCanvasItem[]
	): void {
		const prompt = append(body, $('textarea.basehalf-canvas-card-badge-prompt')) as HTMLTextAreaElement;
		prompt.value = badge?.description ?? '';
		prompt.placeholder = node.kind === 'folder' ? 'What agents should know about this folder...' : 'What agents should know about this file...';
		prompt.rows = 1;
		prompt.spellcheck = false;
		prompt.setAttribute('aria-label', `Badge prompt for ${node.relativePath}`);
		this.fitBadgePrompt(prompt);
		addListener(this.addDisposableListener(prompt, 'input', () => {
			this.fitBadgePrompt(prompt);
			this.scheduleBadgeDescriptionWrite(node, prompt.value, mutationGuard);
		}));
		addListener(this.addDisposableListener(prompt, 'blur', () => this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath)));
		addListener(this.addDisposableListener(prompt, 'keydown', event => {
			if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath);
				prompt.blur();
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}
			event.stopPropagation();
		}));

		const refs = badge?.references ?? [];
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
					void this.removeBadgeReference(node, to, mutationGuard, targetStamp).catch(error => this.reportCanvasMutationError(error));
				}));
			}
		}
		const add = append(refSection, $('button.basehalf-canvas-card-add-reference')) as HTMLButtonElement;
		add.type = 'button';
		add.textContent = '+ Add reference';
		addListener(this.addDisposableListener(add, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			void this.addBadgeReference(node, badge?.references ?? [], stampedCandidates, mutationGuard).catch(error => this.reportCanvasMutationError(error));
		}));

		const inbound = badge?.referenced_by ?? [];
		if (inbound.length > 0) {
			const inboundSection = append(body, $('.basehalf-canvas-card-badge-section'));
			const toggle = append(inboundSection, $('button.basehalf-canvas-card-inbound-toggle')) as HTMLButtonElement;
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
				this.requestRender();
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
	}

	private fitBadgePrompt(prompt: HTMLTextAreaElement): void {
		prompt.style.height = 'auto';
		prompt.style.height = `${prompt.scrollHeight}px`;
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
			this.openBadgeFaces.delete(path);
		} else {
			this.openBadgeFaces.add(path);
		}
		this.requestRender();
	}

	private cardLod(bounds: IBaseHalfCanvasBounds): BaseHalfCanvasCardLod {
		if (bounds.height < CARD_LOD_MIN_HEIGHT_PX) {
			return 'mini';
		}
		return this.canvasZoom >= CARD_LOD_MIN_ZOOM ? 'full' : 'mini';
	}


	private badgeDescriptionKey(workspaceFolder: URI, relativePath: string): string {
		return `${workspaceFolder.toString()}\0${relativePath}`;
	}

	private scheduleBadgeDescriptionWrite(node: IBaseHalfBadgeNode, value: string, guard: IBaseHalfCanvasMutationGuard): void {
		const key = this.badgeDescriptionKey(node.workspaceFolder, node.relativePath);
		const existing = this.badgeDescriptionTimers.get(key);
		if (existing !== undefined) {
			mainWindow.clearTimeout(existing);
		}
		const current = this.badgeDescriptionPending.get(key);
		if (current) {
			current.value = value;
			if (!current.delayReleased) {
				this.badgeDescriptionTimers.set(key, mainWindow.setTimeout(() => this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath), BASEHALF_AUTO_SAVE_DELAY_MS));
			}
			return;
		}

		if (guard.workspaceKey !== node.workspaceFolder.toString()) {
			return;
		}
		let releaseDelay!: () => void;
		const delay = new Promise<void>(resolve => releaseDelay = resolve);
		const pending = { node, guard, value, delayReleased: false, delay, releaseDelay };
		this.badgeDescriptionPending.set(key, pending);
		// Badge notes debounce at the same cadence as file auto-save so every
		// user edit reaches disk with one perceived delay. The workspace FIFO is
		// reserved NOW, so a later rename waits for this authored note and then
		// carries it instead of letting a timer recreate the old path afterwards.
		this.badgeDescriptionTimers.set(key, mainWindow.setTimeout(() => this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath), BASEHALF_AUTO_SAVE_DELAY_MS));
		void guard.run(async lease => {
			await delay;
			if (this.badgeDescriptionPending.get(key) !== pending) {
				return;
			}
			this.badgeDescriptionPending.delete(key);
			this.badgeDescriptionTimers.delete(key);
			const live = await this.resolveLiveWorkspaceNodes(node.workspaceFolder, [{ path: node.relativePath, kind: node.kind }]);
			await this.badgeGraphService.updateDescription(live.get(node.relativePath)!, pending.value, lease);
		}).then(() => this.scheduleBackgroundRender()).catch(error => {
			if (this.badgeDescriptionPending.get(key) === pending) {
				this.badgeDescriptionPending.delete(key);
				const timer = this.badgeDescriptionTimers.get(key);
				if (timer !== undefined) {
					mainWindow.clearTimeout(timer);
					this.badgeDescriptionTimers.delete(key);
				}
			}
			this.logService.error(error);
			this.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.requestRender();
		});
	}

	private flushBadgeDescriptionWrite(workspaceFolder: URI, path: string): void {
		const key = this.badgeDescriptionKey(workspaceFolder, path);
		const pending = this.badgeDescriptionPending.get(key);
		if (!pending) {
			return;
		}
		const timer = this.badgeDescriptionTimers.get(key);
		if (timer !== undefined) {
			mainWindow.clearTimeout(timer);
			this.badgeDescriptionTimers.delete(key);
		}
		pending.delayReleased = true;
		pending.releaseDelay();
	}

	private async addBadgeReference(
		source: IBaseHalfBadgeNode,
		currentReferences: readonly string[],
		allCandidates: readonly IBaseHalfStampedReferenceCandidate[],
		guard: IBaseHalfCanvasMutationGuard
	): Promise<void> {
		if (guard.workspaceKey !== source.workspaceFolder.toString()) {
			return;
		}
		this.flushBadgeDescriptionWrite(source.workspaceFolder, source.relativePath);
		const existing = new Set(currentReferences);
		// Files AND folders are both first-class reference targets — a folder is
		// a badge too, and pointing at one is often exactly the annotation.
		const candidates = allCandidates.filter(({ candidate }) => candidate.path !== source.relativePath && !existing.has(candidate.path));
		if (candidates.length === 0) {
			await this.quickInputService.pick([{ label: 'Nothing else to reference here.' }], { placeHolder: 'Add a reference' });
			return;
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
			return;
		}

		await guard.run(async lease => {
			const live = await this.resolveLiveWorkspaceNodes(source.workspaceFolder, [
				{ path: source.relativePath, kind: source.kind },
				{ path: picked.candidate.path, kind: picked.candidate.kind }
			]);
			await this.badgeGraphService.addReference(live.get(source.relativePath)!, live.get(picked.candidate.path)!, lease);
		}, [picked.stamp]);
		this.requestRender();
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
	): Promise<void> {
		if (guard.workspaceKey !== source.workspaceFolder.toString()) {
			return;
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
			// anchor/label entries.
			if (canvasFolder?.workspaceFolder.toString() === source.workspaceFolder.toString()) {
				await this.canvasMirrorService.removeCanvasEdge(canvasFolder, { from: source.relativePath, to }, lease);
			}
		}, [targetStamp]);
		this.requestRender();
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
	private async renderDetailBadge(cardDetail: IBaseHalfCardDetailState, openOverride?: boolean, focusToggle = false): Promise<void> {
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

		let badge: IBaseHalfBadgeFile | null = null;
		try {
			badge = await this.badgeGraphService.readBadge(node);
		} catch (error) {
			this.logService.warn(`BaseHalf card detail badge unreadable for ${node.relativePath}`, error);
		}
		if (this.disposed || seq !== this.detailBadgeSeq
			|| !this.workspaceMutationCoordinator.isResourceStampCurrent(cardDetail.workspaceFolder, structuralStamp)) {
			return;
		}
		// Never rebuild under the user's cursor — a mirror change while they are
		// typing in the prompt must not reset the textarea; the pending write
		// wins and the zone refreshes on the next render after blur. Only the
		// textarea blocks: a focused toggle button must not veto its own toggle.
		const active = this.detailBadgeZone.ownerDocument.activeElement;
		if (active instanceof HTMLTextAreaElement && this.detailBadgeZone.contains(active)) {
			return;
		}

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
		const hasContent = !!badge?.description?.trim() || (badge?.references.length ?? 0) > 0 || (badge?.referenced_by.length ?? 0) > 0;
		this.renderGlyph(toggle, 'badge', hasContent ? 'var(--vscode-textLink-foreground)' : 'var(--basehalf-detail-badge-ghost)', 15);
		const title = append(toggle, $('span.basehalf-card-detail-badge-title'));
		title.textContent = 'Badge';
		const chevron = append(toggle, $('span.basehalf-card-detail-badge-chevron.codicon.codicon-chevron-down'));
		chevron.setAttribute('aria-hidden', 'true');
		const summary = append(toggle, $('span.basehalf-card-detail-badge-summary'));
		if (!open) {
			const inboundCount = badge?.referenced_by.length ?? 0;
			summary.textContent = badge?.description
				?? (badge && badge.references.length + inboundCount > 0
					? `${badge.references.length} reference${badge.references.length === 1 ? '' : 's'}${inboundCount > 0 ? ` · ← ${inboundCount}` : ''}`
					: 'What agents should know about this file');
			summary.classList.toggle('empty', !badge?.description);
		}
		this.detailBadgeDisposables.add(this.addDisposableListener(toggle, 'click', () => {
			if (open) {
				this.closeDetailBadgePopover(cardDetail, true);
				return;
			}

			const nextOpen = !open;
			this.detailBadgeOpen = nextOpen;
			void this.renderDetailBadge(cardDetail, nextOpen, !nextOpen);
		}));
		if (focusToggle) {
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
		this.renderBadgeEditorContent(
			body,
			node,
			badge ?? undefined,
			this.resourceMutationGuard(cardDetail.workspaceFolder, structuralStamp),
			disposable => this.detailBadgeDisposables.add(disposable),
			() => [...this.renderedItemsByPath.values()]
		);
		this.detailBadgeDisposables.add(this.addDisposableListener(body.ownerDocument, 'pointerdown', event => {
			const target = event.target;
			if (target instanceof Node && this.detailBadgeZone.contains(target)) {
				return;
			}
			this.closeDetailBadgePopover(cardDetail, false);
		}, true));
		this.detailBadgeDisposables.add(this.addDisposableListener(mainWindow, 'keydown', event => {
			if (event.key !== 'Escape') {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.closeDetailBadgePopover(cardDetail, true);
		}, true));
	}

	private closeDetailBadgePopover(cardDetail: IBaseHalfCardDetailState, restoreFocus: boolean): void {
		if (!this.detailBadgeOpen) {
			return;
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
