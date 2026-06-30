/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasWorkbench.css';

import { $, append, clearNode, Dimension } from '../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { basename, joinPath } from '../../../base/common/resources.js';
import { IFileService, IFileStat } from '../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../platform/label/common/label.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IQuickInputService, IQuickPickItem } from '../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchLayoutService, Parts } from '../../services/layout/browser/layoutService.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { SideBySideEditor } from '../../common/editor.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { mainWindow } from '../../../base/browser/window.js';
import {
	BaseHalfCanvasAnchor,
	baseHalfCanvasEdgeLayouts,
	baseHalfCanvasEdgePath,
	baseHalfCanvasAnchorPoint,
	baseHalfCanvasItemBounds,
	baseHalfCanvasModelFromStat,
	IBaseHalfCanvasBounds,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasFile,
	IBaseHalfCanvasItem,
	IBaseHalfCanvasSize
} from '../common/basehalfCanvasModel.js';
import { IBaseHalfBadgeMirrorService } from '../common/basehalfBadgeMirror.js';
import { BaseHalfCanvasMirrorCorrupt, IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService, IBaseHalfCardDetailState } from '../common/basehalfCanvasNavigation.js';
import { BaseHalfCardDetailProjection, isBaseHalfMarkdownResource } from '../common/basehalfCardDetail.js';
import { IBaseHalfFocusMirrorService } from '../common/basehalfFocusMirrorService.js';
import { BaseHalfMarkdownPreviewCardDetail } from './cardDetail/basehalfMarkdownPreviewCardDetail.js';
import { BaseHalfMarkdownRichCardDetail } from './cardDetail/basehalfMarkdownRichCardDetail.js';
import { BaseHalfSourceCardDetail } from './cardDetail/basehalfSourceCardDetail.js';

type BaseHalfCanvasCardPreview =
	| { readonly kind: 'folder'; readonly total: number; readonly items: readonly BaseHalfCanvasFolderPreviewItem[] }
	| { readonly kind: 'text' | 'code' | 'markdown' | 'media' | 'empty' | 'unavailable'; readonly text: string };
type BaseHalfCanvasFolderPreviewItem = { readonly name: string; readonly kind: 'file' | 'folder' };
type BaseHalfCanvasConnectionTarget = { readonly item: IBaseHalfCanvasItem; readonly anchor: BaseHalfCanvasAnchor };
type BaseHalfCanvasCardLod = 'full' | 'mini';
type BaseHalfCanvasResizeEdge = 'north' | 'east' | 'south' | 'west' | 'north-east' | 'south-east' | 'south-west' | 'north-west';
type BaseHalfCanvasEdgeEndpoint = 'source' | 'target';
type BaseHalfCanvasGlyphType = 'folder' | 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'code' | 'generic' | 'badge';
const CANVAS_CARD_ANCHORS: readonly BaseHalfCanvasAnchor[] = ['north', 'east', 'south', 'west'];
const CANVAS_CARD_RESIZE_EDGES: readonly BaseHalfCanvasResizeEdge[] = ['north', 'east', 'south', 'west', 'north-east', 'south-east', 'south-west', 'north-west'];
const CARD_LOD_MIN_HEIGHT_PX = 150;
const CARD_LOD_MIN_ZOOM = 0.5;
const MINI_LABEL_MIN_FLOW_PX = 12;
const MINI_LABEL_CARD_HEIGHT_FRACTION = 0.18;
const CANVAS_CONNECTION_EDGE_THRESHOLD = 22;
const CANVAS_CONNECTION_CORNER_GUARD = 18;
const CANVAS_CONNECTION_TARGET_HIT_DEPTH = 48;
const EDGE_RECONNECT_DRAG_THRESHOLD = 4;
const TEXT_PREVIEW_MAX_BYTES = 8192;

class BaseHalfCanvasWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.canvasWorkbench';

	private readonly root: HTMLElement;
	private readonly chrome: HTMLElement;
	private readonly title: HTMLElement;
	private readonly subtitle: HTMLElement;
	private readonly zoomOut: HTMLButtonElement;
	private readonly zoomReset: HTMLButtonElement;
	private readonly zoomIn: HTMLButtonElement;
	private readonly zoomValue: HTMLElement;
	private readonly surface: HTMLElement;
	private readonly cards: HTMLElement;
	private readonly detail: HTMLElement;
	private readonly detailTitle: HTMLElement;
	private readonly detailMeta: HTMLElement;
	private readonly detailProjectionActions: HTMLElement;
	private readonly detailBody: HTMLElement;
	private readonly editorContainer: HTMLElement;
	private readonly cardListeners = this._register(new DisposableStore());
	private readonly breadcrumbListeners = this._register(new DisposableStore());
	private readonly detailBreadcrumbListeners = this._register(new DisposableStore());
	private readonly detailChromeDisposables = this._register(new DisposableStore());
	private readonly detailDisposables = this._register(new DisposableStore());

	private renderSeq = 0;
	private detailKey: string | undefined;
	private activeCardDrag: {
		readonly pointerId: number;
		readonly card: HTMLElement;
		readonly item: IBaseHalfCanvasItem;
		readonly origin: IBaseHalfCanvasBounds;
		readonly startClientX: number;
		readonly startClientY: number;
		latest: IBaseHalfCanvasBounds;
		moved: boolean;
	} | undefined;
	private activeConnectionDrag: {
		readonly pointerId: number;
		readonly source: IBaseHalfCanvasItem;
		readonly sourceBounds: IBaseHalfCanvasBounds;
		readonly sourceAnchor: BaseHalfCanvasAnchor;
		readonly handle: HTMLElement;
		readonly svg: SVGSVGElement;
		readonly path: SVGPathElement;
		target?: BaseHalfCanvasConnectionTarget;
	} | undefined;
	private activeResizeDrag: {
		readonly pointerId: number;
		readonly card: HTMLElement;
		readonly item: IBaseHalfCanvasItem;
		readonly edge: BaseHalfCanvasResizeEdge;
		readonly origin: IBaseHalfCanvasBounds;
		readonly startClientX: number;
		readonly startClientY: number;
		latest: IBaseHalfCanvasBounds;
		moved: boolean;
	} | undefined;
	private activeEdgeReconnect: {
		readonly pointerId: number;
		readonly edge: IBaseHalfCanvasEdge;
		readonly endpoint: BaseHalfCanvasEdgeEndpoint;
		readonly startClientX: number;
		readonly startClientY: number;
		readonly staticPath: SVGPathElement;
		readonly previewPath: SVGPathElement;
		readonly sourceBounds: IBaseHalfCanvasBounds;
		readonly targetBounds: IBaseHalfCanvasBounds;
		started: boolean;
		target?: BaseHalfCanvasConnectionTarget;
	} | undefined;
	private selectedCardPath: string | undefined;
	private selectedEdgeId: string | undefined;
	private selectedEdge: Pick<IBaseHalfCanvasEdge, 'from' | 'to'> | undefined;
	private suppressNextCardClickForPath: string | undefined;
	private suppressNextCardClickTimer: number | undefined;
	private readonly badgeDescriptionTimers = new Map<string, number>();
	private readonly badgeDescriptionPending = new Map<string, { readonly item: IBaseHalfCanvasItem; readonly value: string }>();
	private readonly expandedInboundBadges = new Set<string>();
	private readonly openBadgeFaces = new Set<string>();
	private renderedItemsByPath = new Map<string, IBaseHalfCanvasItem>();
	private renderedBoundsByPath = new Map<string, IBaseHalfCanvasBounds>();
	private sourceDetail: BaseHalfSourceCardDetail | undefined;
	private markdownRichDetail: BaseHalfMarkdownRichCardDetail | undefined;
	private markdownPreviewDetail: BaseHalfMarkdownPreviewCardDetail | undefined;
	private folderFocusTimer: number | undefined;
	private lastFolderFocusKey: string | undefined;
	private restoredFolderFocusKey: string | undefined;
	private canvasScrollBeforeDetail: { readonly left: number; readonly top: number } | undefined;
	private canvasZoom = 1;
	private disposed = false;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IEditorService private readonly editorService: IEditorService,
		@IBaseHalfBadgeMirrorService private readonly badgeMirrorService: IBaseHalfBadgeMirrorService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IBaseHalfFocusMirrorService private readonly focusMirrorService: IBaseHalfFocusMirrorService,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super();

		const editorContainer = this.layoutService.getContainer(mainWindow, Parts.EDITOR_PART);
		if (!editorContainer) {
			throw new Error('BaseHalf canvas requires the main editor part container.');
		}

		this.editorContainer = editorContainer;
		this.editorContainer.classList.add('basehalf-canvas-host');
		this.root = $('.basehalf-canvas-workbench');
		this.root.setAttribute('aria-label', 'BaseHalf canvas');

		this.chrome = append(this.root, $('.basehalf-canvas-chrome'));
		this.title = append(this.chrome, $('.basehalf-canvas-title'));
		this.subtitle = append(this.chrome, $('.basehalf-canvas-subtitle'));
		const zoomControls = append(this.chrome, $('.basehalf-canvas-zoom-controls'));
		this.zoomOut = this.createZoomButton(zoomControls, 'Zoom Out', 'codicon-remove', () => this.zoomBy(-1));
		this.zoomValue = append(zoomControls, $('.basehalf-canvas-zoom-value'));
		this.zoomReset = this.createZoomButton(zoomControls, 'Reset Zoom', 'codicon-debug-restart', () => this.setCanvasZoom(1));
		this.zoomIn = this.createZoomButton(zoomControls, 'Zoom In', 'codicon-add', () => this.zoomBy(1));
		this.surface = append(this.root, $('.basehalf-canvas-surface'));
		this.cards = append(this.surface, $('.basehalf-canvas-cards'));

		this.detail = append(this.root, $('.basehalf-card-detail'));
		const detailHeader = append(this.detail, $('.basehalf-card-detail-header'));
		const detailTitleBlock = append(detailHeader, $('.basehalf-card-detail-title-block'));
		this.detailTitle = append(detailTitleBlock, $('.basehalf-card-detail-title'));
		this.detailMeta = append(detailTitleBlock, $('.basehalf-card-detail-meta'));
		const detailActions = append(detailHeader, $('.basehalf-card-detail-actions'));
		this.detailProjectionActions = append(detailActions, $('.basehalf-card-detail-projections'));
		const close = append(detailActions, $('button.basehalf-card-detail-close.codicon.codicon-close')) as HTMLButtonElement;
		close.type = 'button';
		close.title = 'Close';
		close.setAttribute('aria-label', 'Close');
		this._register(this.addDisposableListener(close, 'click', () => void this.canvasNavigationService.closeCardDetail()));
		this.detailBody = append(this.detail, $('.basehalf-card-detail-body'));

		this.editorContainer.prepend(this.root);

		this._register(this.canvasNavigationService.onDidChangeState(() => this.render()));
		this._register(this.fileService.onDidFilesChange(event => {
			const folder = this.getCurrentFolder();
			if (folder && event.affects(folder.resource)) {
				void this.render();
			}
		}));
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.reconcileActiveEditor()));
		this._register(this.editorService.onDidActiveEditorChange(() => this.reconcileActiveEditor()));
		this._register(this.addDisposableListener(this.root, 'keydown', event => {
			if (event.key === 'Escape') {
				void this.canvasNavigationService.closeCardDetail();
				return;
			}
			if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedEdgeId) {
				event.preventDefault();
				void this.removeSelectedEdge();
				return;
			}
			this.onCanvasKeyDown(event);
		}));
		this._register(this.addDisposableListener(this.root, 'wheel', event => this.onCanvasWheel(event)));
		this._register(this.addDisposableListener(this.root, 'scroll', () => this.scheduleFolderFocusWrite()));
		this._register(toDisposable(() => {
			if (this.folderFocusTimer !== undefined) {
				mainWindow.clearTimeout(this.folderFocusTimer);
				this.folderFocusTimer = undefined;
			}
			this.clearSuppressedCardClick();
			for (const timer of this.badgeDescriptionTimers.values()) {
				mainWindow.clearTimeout(timer);
			}
			this.badgeDescriptionTimers.clear();
			this.badgeDescriptionPending.clear();
		}));

		this.updateCanvasLayer();
		this.applyCanvasZoom();
		void this.render();
	}

	override dispose(): void {
		this.disposed = true;
		this.renderSeq++;
		super.dispose();
	}

	private addDisposableListener<K extends keyof HTMLElementEventMap>(node: HTMLElement | SVGElement, type: K, listener: (event: HTMLElementEventMap[K]) => void) {
		node.addEventListener(type, listener as EventListener);
		return {
			dispose: () => node.removeEventListener(type, listener as EventListener)
		};
	}

	private async render(): Promise<void> {
		if (this.disposed) {
			return;
		}

		const seq = ++this.renderSeq;
		const folder = this.getCurrentFolder();

		if (!folder) {
			this.renderBreadcrumbs(this.title, this.breadcrumbListeners);
			this.subtitle.textContent = '';
			clearNode(this.cards);
			this.renderEmpty('No folder');
			this.renderDetail();
			return;
		}

		this.renderBreadcrumbs(this.title, this.breadcrumbListeners, folder, this.canvasNavigationService.state.cardDetail);
		this.subtitle.textContent = folder.relativePath ? this.labelService.getUriLabel(folder.workspaceFolder) : '';

		let stat: IFileStat;
		try {
			stat = await this.fileService.resolve(folder.resource);
		} catch (error) {
			if (!this.isRenderCurrent(seq)) {
				return;
			}
			clearNode(this.cards);
			this.renderEmpty(error instanceof Error ? error.message : String(error));
			this.renderDetail();
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

		let model = baseHalfCanvasModelFromStat(stat, {
			rootLevel: folder.relativePath.length === 0,
			folderRelativePath: folder.relativePath,
			canvas
		});
		let badgeWarning: string | undefined;
		if (model.items.length > 0) {
			const badgeRead = await this.badgeMirrorService.readBadges(model.items.map(item => ({
				resource: item.stat.resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath: item.path,
				kind: item.kind
			})));
			if (!this.isRenderCurrent(seq)) {
				return;
			}

			if (badgeRead.badges.size > 0) {
				model = baseHalfCanvasModelFromStat(stat, {
					rootLevel: folder.relativePath.length === 0,
					folderRelativePath: folder.relativePath,
					canvas,
					badges: badgeRead.badges
				});
			}
			if (badgeRead.problems.length > 0) {
				badgeWarning = `${badgeRead.problems.length} badge metadata issue${badgeRead.problems.length === 1 ? '' : 's'}`;
				for (const problem of badgeRead.problems) {
					this.logService.warn(`BaseHalf badge metadata issue for ${problem.relativePath}: ${problem.message}`);
				}
			}
		}
		const items = model.items;
		const previews = await this.readCardPreviews(items);
		if (!this.isRenderCurrent(seq)) {
			return;
		}

		this.renderedItemsByPath = new Map(items.map(item => [item.path, item]));
		this.renderedBoundsByPath = new Map(items.map((item, index) => [item.path, baseHalfCanvasItemBounds(item, index, items.length)]));
		clearNode(this.cards);
		this.cardListeners.clear();
		if (items.length === 0) {
			this.renderEmpty('No files');
		} else {
			const size = this.canvasSize(items, model.size);
			const layoutResult = this.renderEdges(model.edges, items, size);
			for (let i = 0; i < items.length; i++) {
				this.renderCard(items[i], i, items.length, previews.get(items[i].path));
			}
			if (model.truncated > 0) {
				this.renderTruncated(model.truncated);
			}
			this.cards.style.width = `${size.width}px`;
			this.cards.style.height = `${size.height}px`;
			this.updateCanvasExtent(size);
			if (model.droppedEdges + layoutResult.dropped > 0) {
				this.renderCanvasWarning(`${model.droppedEdges + layoutResult.dropped} hidden connection${model.droppedEdges + layoutResult.dropped === 1 ? '' : 's'}`);
			}
		}
		if (canvasWarning) {
			this.renderCanvasWarning(canvasWarning);
		}
		if (badgeWarning) {
			this.renderCanvasWarning(badgeWarning);
		}

		this.renderDetail();
		this.restoreOrWriteFolderFocus(folder, seq);
	}

	private isRenderCurrent(seq: number): boolean {
		return !this.disposed && seq === this.renderSeq;
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

	private renderCard(item: IBaseHalfCanvasItem, index: number, total: number, preview: BaseHalfCanvasCardPreview | undefined): void {
		const bounds = baseHalfCanvasItemBounds(item, index, total);
		const card = append(this.cards, $('.basehalf-canvas-card'));
		card.tabIndex = 0;
		card.setAttribute('role', 'button');
		card.dataset.basehalfCardPath = item.path;
		card.dataset.cardHeight = String(bounds.height);
		card.dataset.lod = this.cardLod(bounds);
		card.classList.add(item.kind);
		card.classList.toggle('selected', this.selectedCardPath === item.path);
		card.classList.toggle('badge-open', this.openBadgeFaces.has(item.path));
		this.applyCardBounds(card, bounds);
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
			this.renderCardBadgeFace(body, item);
		} else {
			this.renderCardPreview(body, item, preview, orphan);
		}

		for (const anchor of CANVAS_CARD_ANCHORS) {
			this.renderConnectionHandle(card, item, bounds, anchor);
		}
		for (const edge of CANVAS_CARD_RESIZE_EDGES) {
			this.renderResizeHandle(card, item, bounds, edge);
		}

		this.cardListeners.add(this.addDisposableListener(card, 'click', event => {
			if (event.target instanceof HTMLElement && event.target.closest('.basehalf-canvas-card-connect-handle, .basehalf-canvas-card-resize-handle, button, textarea, input')) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			if (this.suppressNextCardClickForPath === item.path) {
				event.preventDefault();
				event.stopPropagation();
				this.clearSuppressedCardClick();
				return;
			}

			this.selectCard(item.path);
		}));
		this.cardListeners.add(this.addDisposableListener(card, 'dblclick', event => {
			if (event.target instanceof HTMLElement && event.target.closest('.basehalf-canvas-card-connect-handle, .basehalf-canvas-card-resize-handle, button, textarea, input')) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			void this.canvasNavigationService.openResource(item.stat.resource, { source: 'api', pinned: true });
		}));
		this.cardListeners.add(this.addDisposableListener(card, 'keydown', event => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				void this.canvasNavigationService.openResource(item.stat.resource, { source: 'api', pinned: true });
			}
		}));
		this.cardListeners.add(this.addDisposableListener(card, 'pointerdown', event => this.onCardPointerDown(event, card, item, bounds)));
		this.cardListeners.add(this.addDisposableListener(card, 'pointermove', event => this.onCardPointerMove(event)));
		this.cardListeners.add(this.addDisposableListener(card, 'pointerup', event => this.onCardPointerUp(event)));
		this.cardListeners.add(this.addDisposableListener(card, 'pointercancel', event => this.onCardPointerCancel(event)));
		this.cardListeners.add(this.addDisposableListener(card, 'pointerleave', () => this.clearSourceAffordance(card)));
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

	private renderCardBadgeFace(container: HTMLElement, item: IBaseHalfCanvasItem): void {
		const face = append(container, $('.basehalf-canvas-card-badge-face'));
		face.setAttribute('data-testid', `card-badge-face-${item.path}`);
		this.cardListeners.add(this.addDisposableListener(face, 'pointerdown', event => event.stopPropagation()));
		this.cardListeners.add(this.addDisposableListener(face, 'dblclick', event => event.stopPropagation()));
		this.cardListeners.add(this.addDisposableListener(face, 'wheel', event => event.stopPropagation()));

		const body = append(face, $('.basehalf-canvas-card-badge-scroll'));
		const prompt = append(body, $('textarea.basehalf-canvas-card-badge-prompt')) as HTMLTextAreaElement;
		prompt.value = item.badge?.description ?? '';
		prompt.placeholder = item.kind === 'folder' ? 'What agents should know about this folder...' : 'What agents should know about this file...';
		prompt.setAttribute('aria-label', `Badge prompt for ${item.path}`);
		this.cardListeners.add(this.addDisposableListener(prompt, 'input', () => this.scheduleBadgeDescriptionWrite(item, prompt.value)));
		this.cardListeners.add(this.addDisposableListener(prompt, 'blur', () => this.flushBadgeDescriptionWrite(item.path)));
		this.cardListeners.add(this.addDisposableListener(prompt, 'keydown', event => {
			event.stopPropagation();
			if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
				event.preventDefault();
				this.flushBadgeDescriptionWrite(item.path);
				prompt.blur();
			}
		}));

		const refs = item.badge?.references ?? [];
		const refSection = append(body, $('.basehalf-canvas-card-badge-section'));
		if (refs.length > 0) {
			const list = append(refSection, $('.basehalf-canvas-card-badge-list'));
			for (const to of refs) {
				const row = append(list, $('.basehalf-canvas-card-badge-row'));
				const label = append(row, $('button.basehalf-canvas-card-badge-link')) as HTMLButtonElement;
				label.type = 'button';
				label.textContent = to;
				label.title = to;
				this.cardListeners.add(this.addDisposableListener(label, 'click', event => {
					event.preventDefault();
					event.stopPropagation();
					const target = this.renderedItemsByPath.get(to);
					if (target) {
						void this.canvasNavigationService.openResource(target.stat.resource, { source: 'api', pinned: true });
					}
				}));
				const remove = append(row, $('button.basehalf-canvas-card-badge-remove.codicon.codicon-close')) as HTMLButtonElement;
				remove.type = 'button';
				remove.title = `Remove reference to ${to}`;
				remove.setAttribute('aria-label', `Remove reference to ${to}`);
				this.cardListeners.add(this.addDisposableListener(remove, 'click', event => {
					event.preventDefault();
					event.stopPropagation();
					void this.removeBadgeReference(item, to);
				}));
			}
		}
		const add = append(refSection, $('button.basehalf-canvas-card-add-reference')) as HTMLButtonElement;
		add.type = 'button';
		add.textContent = '+ Add reference';
		this.cardListeners.add(this.addDisposableListener(add, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			void this.addBadgeReference(item);
		}));

		const inbound = item.badge?.referenced_by ?? [];
		if (inbound.length > 0) {
			const inboundSection = append(body, $('.basehalf-canvas-card-badge-section'));
			const toggle = append(inboundSection, $('button.basehalf-canvas-card-inbound-toggle')) as HTMLButtonElement;
			toggle.type = 'button';
			toggle.textContent = `← ${inbound.length} referenced by`;
			toggle.setAttribute('aria-expanded', String(this.expandedInboundBadges.has(item.path)));
			this.cardListeners.add(this.addDisposableListener(toggle, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				if (this.expandedInboundBadges.has(item.path)) {
					this.expandedInboundBadges.delete(item.path);
				} else {
					this.expandedInboundBadges.add(item.path);
				}
				void this.render();
			}));
			if (this.expandedInboundBadges.has(item.path)) {
				const list = append(inboundSection, $('.basehalf-canvas-card-badge-list.inbound'));
				for (const from of inbound) {
					const row = append(list, $('.basehalf-canvas-card-badge-row'));
					const label = append(row, $('button.basehalf-canvas-card-badge-link')) as HTMLButtonElement;
					label.type = 'button';
					label.textContent = from;
					this.cardListeners.add(this.addDisposableListener(label, 'click', event => {
						event.preventDefault();
						event.stopPropagation();
						const target = this.renderedItemsByPath.get(from);
						if (target) {
							void this.canvasNavigationService.openResource(target.stat.resource, { source: 'api', pinned: true });
						}
					}));
				}
			}
		}
	}

	private renderConnectionHandle(card: HTMLElement, item: IBaseHalfCanvasItem, bounds: IBaseHalfCanvasBounds, anchor: BaseHalfCanvasAnchor): void {
		const handle = append(card, $(`span.basehalf-canvas-card-connect-handle.${anchor}`));
		handle.setAttribute('aria-hidden', 'true');
		handle.title = `Connect from ${anchor}`;
		this.cardListeners.add(this.addDisposableListener(handle, 'pointerdown', event => this.onConnectionPointerDown(event, handle, item, bounds, anchor)));
		this.cardListeners.add(this.addDisposableListener(handle, 'pointermove', event => this.onConnectionPointerMove(event)));
		this.cardListeners.add(this.addDisposableListener(handle, 'pointerup', event => this.onConnectionPointerUp(event)));
		this.cardListeners.add(this.addDisposableListener(handle, 'pointercancel', event => this.onConnectionPointerCancel(event)));
	}

	private renderResizeHandle(card: HTMLElement, item: IBaseHalfCanvasItem, bounds: IBaseHalfCanvasBounds, edge: BaseHalfCanvasResizeEdge): void {
		const handle = append(card, $(`span.basehalf-canvas-card-resize-handle.${edge}`));
		handle.setAttribute('aria-hidden', 'true');
		this.cardListeners.add(this.addDisposableListener(handle, 'pointerdown', event => this.onResizePointerDown(event, handle, card, item, bounds, edge)));
		this.cardListeners.add(this.addDisposableListener(handle, 'pointermove', event => this.onResizePointerMove(event)));
		this.cardListeners.add(this.addDisposableListener(handle, 'pointerup', event => this.onResizePointerUp(event)));
		this.cardListeners.add(this.addDisposableListener(handle, 'pointercancel', event => this.onResizePointerCancel(event)));
	}

	private onCardPointerDown(event: PointerEvent, card: HTMLElement, item: IBaseHalfCanvasItem, bounds: IBaseHalfCanvasBounds): void {
		if (event.target instanceof HTMLElement && event.target.closest('.basehalf-canvas-card-connect-handle, .basehalf-canvas-card-resize-handle, button, textarea, input')) {
			return;
		}
		const sourceAnchor = sourceAnchorForPointer(card.getBoundingClientRect(), event.clientX, event.clientY);
		if (sourceAnchor) {
			const handle = card.querySelector<HTMLElement>(`.basehalf-canvas-card-connect-handle.${sourceAnchor}`);
			if (handle) {
				this.onConnectionPointerDown(event, handle, item, bounds, sourceAnchor);
			}
			return;
		}
		if (event.button !== 0 || this.activeCardDrag || this.activeResizeDrag || this.canvasNavigationService.state.cardDetail) {
			return;
		}

		this.activeCardDrag = {
			pointerId: event.pointerId,
			card,
			item,
			origin: bounds,
			startClientX: event.clientX,
			startClientY: event.clientY,
			latest: bounds,
			moved: false
		};
		card.setPointerCapture(event.pointerId);
	}

	private onCardPointerMove(event: PointerEvent): void {
		const drag = this.activeCardDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			if (event.currentTarget instanceof HTMLElement) {
				this.updateSourceAffordance(event.currentTarget, event);
			}
			return;
		}

		const dx = (event.clientX - drag.startClientX) / this.canvasZoom;
		const dy = (event.clientY - drag.startClientY) / this.canvasZoom;
		if (!drag.moved && Math.hypot(dx, dy) < 4) {
			return;
		}

		event.preventDefault();
		drag.moved = true;
		drag.card.classList.add('dragging');
		drag.latest = {
			...drag.origin,
			x: roundCanvasPosition(Math.max(0, drag.origin.x + dx)),
			y: roundCanvasPosition(Math.max(0, drag.origin.y + dy))
		};
		this.applyCardBounds(drag.card, drag.latest);
	}

	private onCardPointerUp(event: PointerEvent): void {
		const drag = this.activeCardDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		this.activeCardDrag = undefined;
		drag.card.classList.remove('dragging');
		if (drag.card.hasPointerCapture(event.pointerId)) {
			drag.card.releasePointerCapture(event.pointerId);
		}

		if (!drag.moved) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.suppressNextCardClick(drag.item.path);
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}

		void this.canvasMirrorService.updateCardGeometry(folder, {
			path: drag.item.path,
			kind: drag.item.kind,
			x: drag.latest.x,
			y: drag.latest.y,
			width: drag.latest.width,
			height: drag.latest.height
		}).then(() => this.render()).catch(error => {
			this.logService.error(error);
			this.renderCanvasWarning(error instanceof Error ? error.message : String(error));
		});
	}

	private onCardPointerCancel(event: PointerEvent): void {
		const drag = this.activeCardDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		this.activeCardDrag = undefined;
		drag.card.classList.remove('dragging');
		this.applyCardBounds(drag.card, drag.origin);
		if (drag.card.hasPointerCapture(event.pointerId)) {
			drag.card.releasePointerCapture(event.pointerId);
		}
	}

	private onResizePointerDown(event: PointerEvent, handle: HTMLElement, card: HTMLElement, item: IBaseHalfCanvasItem, bounds: IBaseHalfCanvasBounds, edge: BaseHalfCanvasResizeEdge): void {
		if (event.button !== 0 || this.activeResizeDrag || this.activeCardDrag || this.canvasNavigationService.state.cardDetail) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.selectCard(item.path);
		this.suppressNextCardClick(item.path);
		this.activeResizeDrag = {
			pointerId: event.pointerId,
			card,
			item,
			edge,
			origin: bounds,
			startClientX: event.clientX,
			startClientY: event.clientY,
			latest: bounds,
			moved: false
		};
		handle.setPointerCapture(event.pointerId);
		card.classList.add('resizing');
	}

	private onResizePointerMove(event: PointerEvent): void {
		const drag = this.activeResizeDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const dx = (event.clientX - drag.startClientX) / this.canvasZoom;
		const dy = (event.clientY - drag.startClientY) / this.canvasZoom;
		if (!drag.moved && Math.hypot(dx, dy) < 3) {
			return;
		}

		drag.moved = true;
		drag.latest = resizeBounds(drag.origin, drag.edge, dx, dy);
		this.applyCardBounds(drag.card, drag.latest);
		drag.card.dataset.cardHeight = String(drag.latest.height);
		drag.card.dataset.lod = this.cardLod(drag.latest);
	}

	private onResizePointerUp(event: PointerEvent): void {
		const drag = this.activeResizeDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		this.activeResizeDrag = undefined;
		drag.card.classList.remove('resizing');
		if (event.target instanceof HTMLElement && event.target.hasPointerCapture(event.pointerId)) {
			event.target.releasePointerCapture(event.pointerId);
		}
		if (!drag.moved) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}

		void this.canvasMirrorService.updateCardGeometry(folder, {
			path: drag.item.path,
			kind: drag.item.kind,
			x: drag.latest.x,
			y: drag.latest.y,
			width: drag.latest.width,
			height: drag.latest.height
		}).then(() => this.render()).catch(error => {
			this.logService.error(error);
			this.renderCanvasWarning(error instanceof Error ? error.message : String(error));
		});
	}

	private onResizePointerCancel(event: PointerEvent): void {
		const drag = this.activeResizeDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		this.activeResizeDrag = undefined;
		drag.card.classList.remove('resizing');
		this.applyCardBounds(drag.card, drag.origin);
		drag.card.dataset.cardHeight = String(drag.origin.height);
		drag.card.dataset.lod = this.cardLod(drag.origin);
		if (event.target instanceof HTMLElement && event.target.hasPointerCapture(event.pointerId)) {
			event.target.releasePointerCapture(event.pointerId);
		}
	}

	private onConnectionPointerDown(event: PointerEvent, handle: HTMLElement, item: IBaseHalfCanvasItem, bounds: IBaseHalfCanvasBounds, anchor: BaseHalfCanvasAnchor): void {
		if (event.button !== 0 || this.activeConnectionDrag || this.canvasNavigationService.state.cardDetail) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const { svg, path } = this.createConnectionDraftSvg();
		this.activeConnectionDrag = {
			pointerId: event.pointerId,
			source: item,
			sourceBounds: bounds,
			sourceAnchor: anchor,
			handle,
			svg,
			path
		};
		this.suppressNextCardClick(item.path);
		handle.setPointerCapture(event.pointerId);
		handle.classList.add('active');
		this.root.classList.add('connecting');
		this.updateConnectionDraft(event);
	}

	private onConnectionPointerMove(event: PointerEvent): void {
		if (!this.activeConnectionDrag || this.activeConnectionDrag.pointerId !== event.pointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.updateConnectionDraft(event);
	}

	private onConnectionPointerUp(event: PointerEvent): void {
		const drag = this.activeConnectionDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.updateConnectionDraft(event);
		void this.finishConnectionDrag(drag);
	}

	private onConnectionPointerCancel(event: PointerEvent): void {
		const drag = this.activeConnectionDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		this.clearConnectionDrag(drag);
	}

	private createConnectionDraftSvg(): { readonly svg: SVGSVGElement; readonly path: SVGPathElement } {
		const width = Number.parseFloat(this.cards.style.width) || this.cards.scrollWidth || this.root.clientWidth;
		const height = Number.parseFloat(this.cards.style.height) || this.cards.scrollHeight || this.root.clientHeight;
		const svg = append(this.cards, $.SVG('svg')) as SVGSVGElement;
		svg.classList.add('basehalf-canvas-connection-draft');
		svg.setAttribute('width', `${width}`);
		svg.setAttribute('height', `${height}`);
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		svg.setAttribute('aria-hidden', 'true');
		const path = $.SVG('path') as SVGPathElement;
		path.classList.add('basehalf-canvas-connection-draft-path');
		svg.appendChild(path);
		return { svg, path };
	}

	private updateConnectionDraft(event: PointerEvent): void {
		const drag = this.activeConnectionDrag;
		if (!drag) {
			return;
		}

		const from = baseHalfCanvasAnchorPoint(drag.sourceBounds, drag.sourceAnchor);
		const target = this.connectionTargetForPoint(event.clientX, event.clientY, drag.source.path);
		drag.target = target;
		const targetBounds = target ? this.renderedBoundsByPath.get(target.item.path) : undefined;
		const to = target && targetBounds ? baseHalfCanvasAnchorPoint(targetBounds, target.anchor) : this.canvasPointFromClient(event.clientX, event.clientY);
		const toAnchor = target?.anchor ?? oppositeAnchor(drag.sourceAnchor);
		drag.path.setAttribute('d', baseHalfCanvasEdgePath(from, drag.sourceAnchor, to, toAnchor));
		this.markConnectionTarget(target);
	}

	private async finishConnectionDrag(drag: NonNullable<BaseHalfCanvasWorkbenchContribution['activeConnectionDrag']>): Promise<void> {
		const target = drag.target;
		this.clearConnectionDrag(drag);
		const folder = this.getCurrentFolder();
		if (!folder || !target || target.item.path === drag.source.path) {
			return;
		}

		const edge: IBaseHalfCanvasEdge = {
			from: drag.source.path,
			from_anchor: drag.sourceAnchor,
			to: target.item.path,
			to_anchor: target.anchor
		};

		try {
			await this.canvasMirrorService.upsertCanvasEdge(folder, edge);
			await this.badgeMirrorService.upsertReference({
				resource: drag.source.stat.resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath: drag.source.path,
				kind: drag.source.kind
			}, {
				resource: target.item.stat.resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath: target.item.path,
				kind: target.item.kind
			});
			this.selectedEdgeId = edgeId(edge.from, edge.to);
			this.selectedEdge = { from: edge.from, to: edge.to };
			await this.render();
		} catch (error) {
			this.logService.error(error);
			this.renderCanvasWarning(error instanceof Error ? error.message : String(error));
		}
	}

	private clearConnectionDrag(drag: NonNullable<BaseHalfCanvasWorkbenchContribution['activeConnectionDrag']>): void {
		if (drag.handle.hasPointerCapture(drag.pointerId)) {
			drag.handle.releasePointerCapture(drag.pointerId);
		}
		drag.handle.classList.remove('active');
		drag.svg.remove();
		this.activeConnectionDrag = undefined;
		this.root.classList.remove('connecting');
		this.markConnectionTarget(undefined);
	}

	private markConnectionTarget(target: BaseHalfCanvasConnectionTarget | undefined): void {
		for (const card of Array.from(this.cards.querySelectorAll<HTMLElement>('.basehalf-canvas-card.connection-target'))) {
			card.classList.remove('connection-target', 'north', 'east', 'south', 'west');
		}
		if (!target) {
			return;
		}

		const card = this.cards.querySelector<HTMLElement>(`.basehalf-canvas-card[data-basehalf-card-path="${cssStringEscape(target.item.path)}"]`);
		card?.classList.add('connection-target', target.anchor);
	}

	private connectionTargetForPoint(clientX: number, clientY: number, sourcePath: string): BaseHalfCanvasConnectionTarget | undefined {
		let best: { readonly item: IBaseHalfCanvasItem; readonly anchor: BaseHalfCanvasAnchor; readonly distance: number } | undefined;
		for (const card of Array.from(this.cards.querySelectorAll<HTMLElement>('.basehalf-canvas-card'))) {
			const path = card.dataset.basehalfCardPath;
			if (!path || path === sourcePath) {
				continue;
			}
			const item = this.renderedItemsByPath.get(path);
			if (!item) {
				continue;
			}
			const rect = card.getBoundingClientRect();
			const anchor = targetAnchorForPoint(rect, clientX, clientY);
			if (!anchor) {
				continue;
			}
			const distance = distanceToRect(rect, clientX, clientY);
			if (!best || distance < best.distance) {
				best = { item, anchor, distance };
			}
		}
		return best ? { item: best.item, anchor: best.anchor } : undefined;
	}

	private applyCardBounds(card: HTMLElement, bounds: IBaseHalfCanvasBounds): void {
		card.style.transform = `translate(${bounds.x}px, ${bounds.y}px)`;
		card.style.width = `${bounds.width}px`;
		card.style.height = `${bounds.height}px`;
	}

	private suppressNextCardClick(path: string): void {
		if (this.suppressNextCardClickTimer !== undefined) {
			mainWindow.clearTimeout(this.suppressNextCardClickTimer);
		}

		this.suppressNextCardClickForPath = path;
		this.suppressNextCardClickTimer = mainWindow.setTimeout(() => this.clearSuppressedCardClick(), 250);
	}

	private clearSuppressedCardClick(): void {
		if (this.suppressNextCardClickTimer !== undefined) {
			mainWindow.clearTimeout(this.suppressNextCardClickTimer);
			this.suppressNextCardClickTimer = undefined;
		}
		this.suppressNextCardClickForPath = undefined;
	}

	private selectCard(path: string): void {
		this.selectedCardPath = path;
		this.selectedEdgeId = undefined;
		this.selectedEdge = undefined;
		for (const card of Array.from(this.cards.querySelectorAll<HTMLElement>('.basehalf-canvas-card.selected'))) {
			card.classList.toggle('selected', card.dataset.basehalfCardPath === path);
		}
		for (const edge of Array.from(this.cards.querySelectorAll<SVGElement>('.basehalf-canvas-edge-path.selected, .basehalf-canvas-edge-hit.selected'))) {
			edge.classList.remove('selected');
		}
	}

	private selectEdge(edge: IBaseHalfCanvasEdge): void {
		this.selectedCardPath = undefined;
		this.selectedEdgeId = edgeId(edge.from, edge.to);
		this.selectedEdge = { from: edge.from, to: edge.to };
		for (const card of Array.from(this.cards.querySelectorAll<HTMLElement>('.basehalf-canvas-card.selected'))) {
			card.classList.remove('selected');
		}
		for (const edgeElement of Array.from(this.cards.querySelectorAll<SVGElement>('.basehalf-canvas-edge-path, .basehalf-canvas-edge-hit'))) {
			edgeElement.classList.toggle('selected', edgeElement.dataset.edgeId === this.selectedEdgeId);
		}
	}

	private toggleBadgeFace(path: string): void {
		if (this.openBadgeFaces.has(path)) {
			this.openBadgeFaces.delete(path);
		} else {
			this.openBadgeFaces.add(path);
		}
		void this.render();
	}

	private cardLod(bounds: IBaseHalfCanvasBounds): BaseHalfCanvasCardLod {
		if (bounds.height < CARD_LOD_MIN_HEIGHT_PX) {
			return 'mini';
		}
		return this.canvasZoom >= CARD_LOD_MIN_ZOOM ? 'full' : 'mini';
	}

	private updateCardLod(): void {
		for (const card of Array.from(this.cards.querySelectorAll<HTMLElement>('.basehalf-canvas-card'))) {
			const height = Number(card.dataset.cardHeight);
			card.dataset.lod = Number.isFinite(height) && height >= CARD_LOD_MIN_HEIGHT_PX && this.canvasZoom >= CARD_LOD_MIN_ZOOM ? 'full' : 'mini';
		}
	}

	private updateSourceAffordance(card: HTMLElement, event: PointerEvent): void {
		if (this.activeConnectionDrag || this.activeCardDrag || this.activeResizeDrag) {
			return;
		}
		if (event.target instanceof HTMLElement && event.target.closest('button, input, textarea')) {
			this.clearSourceAffordance(card);
			return;
		}

		const anchor = sourceAnchorForPointer(card.getBoundingClientRect(), event.clientX, event.clientY);
		card.dataset.sourceAffordance = anchor ?? '';
		for (const handle of Array.from(card.querySelectorAll<HTMLElement>('.basehalf-canvas-card-connect-handle'))) {
			handle.classList.toggle('active', !!anchor && handle.classList.contains(anchor));
		}
	}

	private clearSourceAffordance(card: HTMLElement): void {
		card.dataset.sourceAffordance = '';
		for (const handle of Array.from(card.querySelectorAll<HTMLElement>('.basehalf-canvas-card-connect-handle.active'))) {
			handle.classList.remove('active');
		}
	}

	private scheduleBadgeDescriptionWrite(item: IBaseHalfCanvasItem, value: string): void {
		const existing = this.badgeDescriptionTimers.get(item.path);
		if (existing !== undefined) {
			mainWindow.clearTimeout(existing);
		}
		this.badgeDescriptionPending.set(item.path, { item, value });
		this.badgeDescriptionTimers.set(item.path, mainWindow.setTimeout(() => this.flushBadgeDescriptionWrite(item.path), 500));
	}

	private flushBadgeDescriptionWrite(path: string): void {
		const pending = this.badgeDescriptionPending.get(path);
		if (!pending) {
			return;
		}
		const timer = this.badgeDescriptionTimers.get(path);
		if (timer !== undefined) {
			mainWindow.clearTimeout(timer);
			this.badgeDescriptionTimers.delete(path);
		}
		this.badgeDescriptionPending.delete(path);
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}

		void this.badgeMirrorService.updateDescription({
			resource: pending.item.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: pending.item.path,
			kind: pending.item.kind
		}, pending.value).then(() => this.render()).catch(error => {
			this.logService.error(error);
			this.renderCanvasWarning(error instanceof Error ? error.message : String(error));
		});
	}

	private async addBadgeReference(item: IBaseHalfCanvasItem): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		this.flushBadgeDescriptionWrite(item.path);
		const existing = new Set(item.badge?.references ?? []);
		const candidates = this.referenceCandidates(item)
			.filter(candidate => candidate.path !== item.path && candidate.kind === 'file' && !existing.has(candidate.path));
		if (candidates.length === 0) {
			await this.quickInputService.pick([{ label: 'No other files in this folder.' }], { placeHolder: 'Add a reference' });
			return;
		}

		type RefPick = IQuickPickItem & { readonly candidate: IBaseHalfCanvasItem };
		const picked = await this.quickInputService.pick<RefPick>(candidates.map(candidate => ({
			label: basename(candidate.stat.resource),
			description: candidate.path,
			detail: candidate.badge?.description,
			candidate
		})), {
			placeHolder: `Search ${item.kind === 'folder' ? `${item.path}/` : folder.relativePath ? `${folder.relativePath}/` : 'the workspace root'}...`,
			matchOnDescription: true,
			matchOnDetail: true
		});
		if (!picked) {
			return;
		}

		await this.badgeMirrorService.upsertReference({
			resource: item.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: item.path,
			kind: item.kind
		}, {
			resource: picked.candidate.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: picked.candidate.path,
			kind: picked.candidate.kind
		});
		await this.render();
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

	private async removeBadgeReference(item: IBaseHalfCanvasItem, to: string): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		this.flushBadgeDescriptionWrite(item.path);
		const target = await this.badgeNodeForPath(folder, to, 'file');
		await this.badgeMirrorService.removeReference({
			resource: item.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: item.path,
			kind: item.kind
		}, target);
		await this.canvasMirrorService.removeCanvasEdge(folder, { from: item.path, to });
		await this.render();
	}

	private async badgeNodeForPath(folder: IBaseHalfCanvasFolderState, relativePath: string, fallbackKind: 'file' | 'folder') {
		const rendered = this.renderedItemsByPath.get(relativePath);
		if (rendered) {
			return {
				resource: rendered.stat.resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath,
				kind: rendered.kind
			};
		}
		const resource = relativePath ? joinPath(folder.workspaceFolder, ...relativePath.split('/')) : folder.workspaceFolder;
		try {
			const stat = await this.fileService.stat(resource);
			return {
				resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath,
				kind: stat.isDirectory ? 'folder' as const : 'file' as const
			};
		} catch {
			return {
				resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath,
				kind: fallbackKind
			};
		}
	}

	private renderEdges(edges: readonly IBaseHalfCanvasEdge[], items: readonly IBaseHalfCanvasItem[], size: Dimension): { dropped: number } {
		const layoutResult = baseHalfCanvasEdgeLayouts(edges, items);
		if (layoutResult.edges.length === 0) {
			return { dropped: layoutResult.dropped };
		}

		const markerId = `basehalf-canvas-edge-arrow-${this.renderSeq}`;
		const svg = append(this.cards, $.SVG('svg')) as SVGSVGElement;
		svg.classList.add('basehalf-canvas-edges');
		svg.setAttribute('width', `${size.width}`);
		svg.setAttribute('height', `${size.height}`);
		svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
		svg.setAttribute('aria-hidden', 'true');

		const defs = $.SVG('defs');
		const marker = $.SVG('marker');
		marker.classList.add('basehalf-canvas-edge-arrow');
		marker.setAttribute('id', markerId);
		marker.setAttribute('viewBox', '0 0 10 10');
		marker.setAttribute('refX', '9');
		marker.setAttribute('refY', '5');
		marker.setAttribute('markerWidth', '6');
		marker.setAttribute('markerHeight', '6');
		marker.setAttribute('orient', 'auto-start-reverse');
		const arrow = $.SVG('path');
		arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
		marker.appendChild(arrow);
		defs.appendChild(marker);
		svg.appendChild(defs);

		for (const edge of layoutResult.edges) {
			const path = $.SVG('path') as SVGPathElement;
			path.classList.add('basehalf-canvas-edge-path');
			if (this.selectedEdgeId === edgeId(edge.edge.from, edge.edge.to)) {
				path.classList.add('selected');
			}
			path.dataset.edgeId = edgeId(edge.edge.from, edge.edge.to);
			path.setAttribute('d', edge.path);
			path.setAttribute('marker-end', `url(#${markerId})`);
			const title = $.SVG('title');
			title.textContent = edge.label?.text ? `${edge.edge.from} to ${edge.edge.to}: ${edge.label.text}` : `${edge.edge.from} to ${edge.edge.to}`;
			path.appendChild(title);
			svg.appendChild(path);

			const hit = $.SVG('path') as SVGPathElement;
			hit.classList.add('basehalf-canvas-edge-hit');
			if (this.selectedEdgeId === edgeId(edge.edge.from, edge.edge.to)) {
				hit.classList.add('selected');
			}
			hit.dataset.edgeId = edgeId(edge.edge.from, edge.edge.to);
			hit.setAttribute('d', edge.path);
			svg.appendChild(hit);

			const text = $.SVG('text');
			text.classList.add('basehalf-canvas-edge-label');
			text.classList.toggle('empty', !edge.label?.text);
			if (this.selectedEdgeId === edgeId(edge.edge.from, edge.edge.to)) {
				text.classList.add('selected');
			}
			text.dataset.edgeId = edgeId(edge.edge.from, edge.edge.to);
			text.setAttribute('x', `${edge.label?.x ?? (edge.from.x + edge.to.x) / 2}`);
			text.setAttribute('y', `${(edge.label?.y ?? (edge.from.y + edge.to.y) / 2) - 8}`);
			text.setAttribute('text-anchor', 'middle');
			text.textContent = edge.label?.text ?? 'Double-click to say why';
			svg.appendChild(text);

			const setHover = (hover: boolean) => {
				path.classList.toggle('hover', hover);
				hit.classList.toggle('hover', hover);
				text.classList.toggle('hover', hover);
			};
			this.cardListeners.add(this.addDisposableListener(hit, 'mouseenter', () => setHover(true)));
			this.cardListeners.add(this.addDisposableListener(hit, 'mouseleave', () => setHover(false)));
			this.cardListeners.add(this.addDisposableListener(hit, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				this.selectEdge(edge.edge);
			}));
			this.cardListeners.add(this.addDisposableListener(hit, 'dblclick', event => {
				event.preventDefault();
				event.stopPropagation();
				void this.editEdgeLabel(edge.edge);
			}));
			this.cardListeners.add(this.addDisposableListener(hit, 'pointerdown', event => this.onEdgePointerDown(event, edge.edge, hit, path)));
			this.cardListeners.add(this.addDisposableListener(hit, 'pointermove', event => this.onEdgePointerMove(event)));
			this.cardListeners.add(this.addDisposableListener(hit, 'pointerup', event => this.onEdgePointerUp(event)));
			this.cardListeners.add(this.addDisposableListener(hit, 'pointercancel', event => this.onEdgePointerCancel(event)));
		}

		return { dropped: layoutResult.dropped };
	}

	private onEdgePointerDown(event: PointerEvent, edge: IBaseHalfCanvasEdge, hitPath: SVGPathElement, staticPath: SVGPathElement): void {
		if (event.button !== 0 || this.activeEdgeReconnect || this.canvasNavigationService.state.cardDetail) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.selectEdge(edge);
		const sourceBounds = this.renderedBoundsByPath.get(edge.from);
		const targetBounds = this.renderedBoundsByPath.get(edge.to);
		if (!sourceBounds || !targetBounds) {
			return;
		}
		const { path } = this.createConnectionDraftSvg();
		path.classList.add('basehalf-canvas-edge-reconnect-preview');
		this.activeEdgeReconnect = {
			pointerId: event.pointerId,
			edge,
			endpoint: nearestPathRatio(hitPath, event.clientX, event.clientY) < 0.5 ? 'source' : 'target',
			startClientX: event.clientX,
			startClientY: event.clientY,
			staticPath,
			previewPath: path,
			sourceBounds,
			targetBounds,
			started: false
		};
		hitPath.setPointerCapture(event.pointerId);
	}

	private onEdgePointerMove(event: PointerEvent): void {
		const drag = this.activeEdgeReconnect;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const moved = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) >= EDGE_RECONNECT_DRAG_THRESHOLD;
		drag.started = drag.started || moved;
		if (!drag.started) {
			return;
		}

		const excluded = drag.endpoint === 'source' ? drag.edge.to : drag.edge.from;
		const target = this.connectionTargetForPoint(event.clientX, event.clientY, excluded);
		drag.target = target;
		const snappedBounds = target ? this.renderedBoundsByPath.get(target.item.path) : undefined;
		const pointerPoint = target && snappedBounds ? baseHalfCanvasAnchorPoint(snappedBounds, target.anchor) : this.canvasPointFromClient(event.clientX, event.clientY);
		const sourcePoint = drag.endpoint === 'source' ? pointerPoint : baseHalfCanvasAnchorPoint(drag.sourceBounds, drag.edge.from_anchor);
		const targetPoint = drag.endpoint === 'target' ? pointerPoint : baseHalfCanvasAnchorPoint(drag.targetBounds, drag.edge.to_anchor);
		const sourceAnchor = drag.endpoint === 'source' ? target?.anchor ?? drag.edge.from_anchor : drag.edge.from_anchor;
		const targetAnchor = drag.endpoint === 'target' ? target?.anchor ?? drag.edge.to_anchor : drag.edge.to_anchor;
		drag.previewPath.setAttribute('d', baseHalfCanvasEdgePath(sourcePoint, sourceAnchor, targetPoint, targetAnchor));
		drag.staticPath.classList.add('reconnecting');
		this.markConnectionTarget(target);
	}

	private onEdgePointerUp(event: PointerEvent): void {
		const drag = this.activeEdgeReconnect;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		if (event.target instanceof SVGElement && event.target.hasPointerCapture(event.pointerId)) {
			event.target.releasePointerCapture(event.pointerId);
		}
		void this.finishEdgeReconnect(drag);
	}

	private onEdgePointerCancel(event: PointerEvent): void {
		const drag = this.activeEdgeReconnect;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		this.clearEdgeReconnect(drag);
	}

	private async finishEdgeReconnect(drag: NonNullable<BaseHalfCanvasWorkbenchContribution['activeEdgeReconnect']>): Promise<void> {
		const folder = this.getCurrentFolder();
		const target = drag.target;
		const started = drag.started;
		this.clearEdgeReconnect(drag);
		if (!folder || !started) {
			return;
		}

		if (!target) {
			await this.removeEdge(folder, drag.edge);
			return;
		}

		const next: IBaseHalfCanvasEdge = drag.endpoint === 'source' ? {
			from: target.item.path,
			from_anchor: target.anchor,
			to: drag.edge.to,
			to_anchor: drag.edge.to_anchor,
			...(drag.edge.label !== undefined ? { label: drag.edge.label } : {})
		} : {
			from: drag.edge.from,
			from_anchor: drag.edge.from_anchor,
			to: target.item.path,
			to_anchor: target.anchor,
			...(drag.edge.label !== undefined ? { label: drag.edge.label } : {})
		};
		if (next.from === next.to) {
			return;
		}

		try {
			await this.canvasMirrorService.reconnectCanvasEdge(folder, { from: drag.edge.from, to: drag.edge.to }, next);
			if (drag.edge.from !== next.from || drag.edge.to !== next.to) {
				await this.badgeMirrorService.removeReference(
					await this.badgeNodeForPath(folder, drag.edge.from, 'file'),
					await this.badgeNodeForPath(folder, drag.edge.to, 'file')
				);
				await this.badgeMirrorService.upsertReference(
					await this.badgeNodeForPath(folder, next.from, 'file'),
					await this.badgeNodeForPath(folder, next.to, 'file')
				);
			}
			this.selectedEdgeId = edgeId(next.from, next.to);
			this.selectedEdge = { from: next.from, to: next.to };
			await this.render();
		} catch (error) {
			this.logService.error(error);
			this.renderCanvasWarning(error instanceof Error ? error.message : String(error));
		}
	}

	private clearEdgeReconnect(drag: NonNullable<BaseHalfCanvasWorkbenchContribution['activeEdgeReconnect']>): void {
		drag.previewPath.ownerSVGElement?.remove();
		drag.staticPath.classList.remove('reconnecting');
		this.activeEdgeReconnect = undefined;
		this.markConnectionTarget(undefined);
	}

	private async editEdgeLabel(edge: IBaseHalfCanvasEdge): Promise<void> {
		const next = await this.quickInputService.input({
			title: 'Reference note',
			placeHolder: 'Say why these connect',
			value: edge.label ?? ''
		});
		if (next === undefined) {
			return;
		}
		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}
		const label = next.trim();
		try {
			await this.canvasMirrorService.upsertCanvasEdge(folder, {
				from: edge.from,
				from_anchor: edge.from_anchor,
				to: edge.to,
				to_anchor: edge.to_anchor,
				...(label ? { label } : {})
			});
			this.selectedEdgeId = edgeId(edge.from, edge.to);
			this.selectedEdge = { from: edge.from, to: edge.to };
			await this.render();
		} catch (error) {
			this.logService.error(error);
			this.renderCanvasWarning(error instanceof Error ? error.message : String(error));
		}
	}

	private async removeSelectedEdge(): Promise<void> {
		const folder = this.getCurrentFolder();
		if (!folder || !this.selectedEdge) {
			return;
		}
		await this.removeEdge(folder, this.selectedEdge);
	}

	private async removeEdge(folder: IBaseHalfCanvasFolderState, edge: Pick<IBaseHalfCanvasEdge, 'from' | 'to'>): Promise<void> {
		try {
			await this.canvasMirrorService.removeCanvasEdge(folder, edge);
			await this.badgeMirrorService.removeReference(
				await this.badgeNodeForPath(folder, edge.from, 'file'),
				await this.badgeNodeForPath(folder, edge.to, 'file')
			);
			this.selectedEdgeId = undefined;
			this.selectedEdge = undefined;
			await this.render();
		} catch (error) {
			this.logService.error(error);
			this.renderCanvasWarning(error instanceof Error ? error.message : String(error));
		}
	}

	private renderTruncated(heldBack: number): void {
		const truncated = append(this.cards, $('.basehalf-canvas-truncated'));
		truncated.textContent = `+${heldBack} more`;
	}

	private renderCanvasWarning(message: string): void {
		const warningIndex = this.cards.querySelectorAll('.basehalf-canvas-warning').length;
		const warning = append(this.cards, $('.basehalf-canvas-warning'));
		warning.style.top = `${58 + warningIndex * 30}px`;
		warning.textContent = message;
	}

	private renderEmpty(message: string): void {
		clearNode(this.cards);
		const empty = append(this.cards, $('.basehalf-canvas-empty'));
		empty.textContent = message;
		this.updateCanvasExtent(new Dimension(Math.max(800, this.root.clientWidth), Math.max(480, this.root.clientHeight)));
	}

	private renderDetail(): void {
		const cardDetail = this.canvasNavigationService.state.cardDetail;
		this.detail.classList.toggle('visible', !!cardDetail);
		this.syncDetailScrollLock(!!cardDetail);
		if (!cardDetail) {
			this.detailKey = undefined;
			this.sourceDetail = undefined;
			this.markdownRichDetail = undefined;
			this.markdownPreviewDetail = undefined;
			this.detailChromeDisposables.clear();
			this.detailBreadcrumbListeners.clear();
			this.detailDisposables.clear();
			clearNode(this.detailProjectionActions);
			clearNode(this.detailBody);
			clearNode(this.detailTitle);
			this.detailMeta.textContent = '';
			this.scheduleFolderFocusWrite(0);
			return;
		}

		this.renderBreadcrumbs(this.detailTitle, this.detailBreadcrumbListeners, this.getCurrentFolder(), cardDetail);
		this.detailMeta.textContent = this.detailMetaFor(cardDetail.projection, cardDetail.selection);
		this.renderProjectionActions(cardDetail);

		const detailKey = `${cardDetail.resource.toString()}::${cardDetail.projection}`;
		if (this.detailKey === detailKey) {
			this.sourceDetail?.applySelection(cardDetail.selection);
			this.markdownRichDetail?.applySelection(cardDetail.selection);
			this.markdownPreviewDetail?.applySelection(cardDetail.selection);
			return;
		}

		this.detailKey = detailKey;
		this.sourceDetail = undefined;
		this.markdownRichDetail = undefined;
		this.markdownPreviewDetail = undefined;
		this.detailDisposables.clear();

		if (cardDetail.projection === 'rich') {
			this.markdownRichDetail = this.detailDisposables.add(this.instantiationService.createInstance(BaseHalfMarkdownRichCardDetail, this.detailBody, this.detailMeta));
			void this.markdownRichDetail.open(cardDetail);
		} else if (cardDetail.projection === 'preview') {
			this.markdownPreviewDetail = this.detailDisposables.add(this.instantiationService.createInstance(BaseHalfMarkdownPreviewCardDetail, this.detailBody));
			void this.markdownPreviewDetail.open(cardDetail);
		} else if (cardDetail.projection === 'source') {
			this.sourceDetail = this.detailDisposables.add(this.instantiationService.createInstance(BaseHalfSourceCardDetail, this.detailBody));
			void this.sourceDetail.open(cardDetail);
		}
	}

	private syncDetailScrollLock(detailVisible: boolean): void {
		this.root.classList.toggle('basehalf-card-detail-open', detailVisible);
		if (detailVisible) {
			if (!this.canvasScrollBeforeDetail) {
				this.canvasScrollBeforeDetail = {
					left: this.root.scrollLeft,
					top: this.root.scrollTop
				};
			}
			this.root.scrollLeft = 0;
			this.root.scrollTop = 0;
			return;
		}

		const scroll = this.canvasScrollBeforeDetail;
		this.canvasScrollBeforeDetail = undefined;
		if (scroll) {
			this.root.scrollLeft = scroll.left;
			this.root.scrollTop = scroll.top;
		}
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

	private detailMetaFor(projection: string, selection: { startLineNumber: number; startColumn: number } | undefined): string {
		const parts = [projection];
		if (!selection) {
			return parts.join(' • ');
		}

		parts.push(`L${selection.startLineNumber}:${selection.startColumn}`);
		return parts.join(' • ');
	}

	private canvasSize(items: readonly IBaseHalfCanvasItem[], savedSize: IBaseHalfCanvasSize | undefined): Dimension {
		if (items.length === 0) {
			return new Dimension(savedSize?.width ?? 800, savedSize?.height ?? 480);
		}

		let maxX = savedSize?.width ?? 0;
		let maxY = savedSize?.height ?? 0;
		for (let index = 0; index < items.length; index++) {
			const item = items[index];
			const { x, y, width, height } = baseHalfCanvasItemBounds(item, index, items.length);
			maxX = Math.max(maxX, x + width);
			maxY = Math.max(maxY, y + height);
		}
		return new Dimension(maxX + 48, maxY + 76);
	}

	private updateCanvasExtent(size: Dimension): void {
		this.cards.style.width = `${size.width}px`;
		this.cards.style.height = `${size.height}px`;
		this.surface.style.width = `${Math.max(size.width * this.canvasZoom, this.root.clientWidth)}px`;
		this.surface.style.height = `${Math.max(size.height * this.canvasZoom, Math.max(480, this.root.clientHeight - this.chrome.offsetHeight))}px`;
	}

	private createZoomButton(container: HTMLElement, title: string, icon: string, action: () => void): HTMLButtonElement {
		const button = append(container, $(`button.basehalf-canvas-zoom-button.codicon.${icon}`)) as HTMLButtonElement;
		button.type = 'button';
		button.title = title;
		button.setAttribute('aria-label', title);
		this._register(this.addDisposableListener(button, 'click', () => action()));
		return button;
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

	private onCanvasWheel(event: WheelEvent): void {
		if (!(event.metaKey || event.ctrlKey)) {
			return;
		}

		event.preventDefault();
		const delta = event.deltaY > 0 ? -1 : 1;
		this.setCanvasZoom(this.canvasZoom + delta * BASEHALF_CANVAS_ZOOM_STEP, {
			clientX: event.clientX,
			clientY: event.clientY
		});
	}

	private setCanvasZoom(value: number, anchor?: { readonly clientX: number; readonly clientY: number }): void {
		const nextZoom = normalizeCanvasZoom(value);
		if (nextZoom === this.canvasZoom) {
			return;
		}

		const anchorPoint = anchor ? this.canvasPointFromClient(anchor.clientX, anchor.clientY) : this.viewportCenterCanvasPoint();
		const anchorClientX = anchor ? anchor.clientX - this.root.getBoundingClientRect().left : this.root.clientWidth / 2;
		const anchorClientY = anchor ? anchor.clientY - this.root.getBoundingClientRect().top : this.root.clientHeight / 2;
		this.canvasZoom = nextZoom;
		this.applyCanvasZoom();
		this.root.scrollLeft = Math.max(0, anchorPoint.x * nextZoom - anchorClientX);
		this.root.scrollTop = Math.max(0, anchorPoint.y * nextZoom - anchorClientY);
		this.scheduleFolderFocusWrite(0);
	}

	private applyCanvasZoom(): void {
		const zoom = normalizeCanvasZoom(this.canvasZoom);
		this.canvasZoom = zoom;
		this.root.style.setProperty('--basehalf-canvas-zoom', String(zoom));
		this.root.dataset.zoom = String(zoom);
		this.cards.style.transform = `scale(${zoom})`;
		this.cards.style.transformOrigin = '0 0';
		this.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
		this.zoomOut.disabled = zoom <= BASEHALF_CANVAS_MIN_ZOOM;
		this.zoomIn.disabled = zoom >= BASEHALF_CANVAS_MAX_ZOOM;
		this.zoomReset.disabled = zoom === 1;
		this.updateCardLod();
		const width = parseFloat(this.cards.style.width);
		const height = parseFloat(this.cards.style.height);
		if (Number.isFinite(width) && Number.isFinite(height)) {
			this.updateCanvasExtent(new Dimension(width, height));
		}
	}

	private canvasPointFromClient(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this.root.getBoundingClientRect();
		return {
			x: (this.root.scrollLeft + clientX - rect.left) / this.canvasZoom,
			y: (this.root.scrollTop + clientY - rect.top) / this.canvasZoom
		};
	}

	private viewportCenterCanvasPoint(): { x: number; y: number } {
		return {
			x: (this.root.scrollLeft + this.root.clientWidth / 2) / this.canvasZoom,
			y: (this.root.scrollTop + this.root.clientHeight / 2) / this.canvasZoom
		};
	}

	private renderBreadcrumbs(
		container: HTMLElement,
		listeners: DisposableStore,
		folder?: IBaseHalfCanvasFolderState,
		cardDetail?: IBaseHalfCardDetailState
	): void {
		listeners.clear();
		clearNode(container);

		if (!folder) {
			const fallback = append(container, $('span.basehalf-breadcrumb-label.active'));
			fallback.textContent = 'BaseHalf';
			return;
		}

		const workspaceLabel = basename(folder.workspaceFolder) || this.labelService.getUriLabel(folder.workspaceFolder);
		this.renderBreadcrumbButton(container, listeners, workspaceLabel, folder.workspaceFolder, '', 'folder', !folder.relativePath && !cardDetail);

		const pathParts = (cardDetail?.relativePath ?? folder.relativePath).split('/').filter(Boolean);
		const folderPartCount = cardDetail ? Math.max(0, pathParts.length - 1) : pathParts.length;
		for (let index = 0; index < folderPartCount; index++) {
			const parts = pathParts.slice(0, index + 1);
			const relativePath = parts.join('/');
			this.renderBreadcrumbSeparator(container);
			this.renderBreadcrumbButton(
				container,
				listeners,
				pathParts[index],
				joinPath(folder.workspaceFolder, ...parts),
				relativePath,
				'folder',
				relativePath === folder.relativePath && !cardDetail
			);
		}

		if (cardDetail) {
			this.renderBreadcrumbSeparator(container);
			this.renderBreadcrumbButton(
				container,
				listeners,
				pathParts[pathParts.length - 1] ?? basename(cardDetail.resource),
				cardDetail.resource,
				cardDetail.relativePath,
				'file',
				true,
				cardDetail
			);
		}
	}

	private renderBreadcrumbSeparator(container: HTMLElement): void {
		append(container, $('span.basehalf-breadcrumb-separator.codicon.codicon-chevron-right'));
	}

	private renderBreadcrumbButton(
		container: HTMLElement,
		listeners: DisposableStore,
		label: string,
		resource: IBaseHalfCanvasFolderState['resource'],
		relativePath: string,
		kind: 'folder' | 'file',
		active: boolean,
		cardDetail?: IBaseHalfCardDetailState
	): void {
		const button = append(container, $('button.basehalf-breadcrumb')) as HTMLButtonElement;
		button.type = 'button';
		button.textContent = label;
		button.dataset.relativePath = relativePath;
		button.dataset.kind = kind;
		button.classList.toggle('active', active);
		button.title = kind === 'folder' ? `Open ${label}` : label;
		button.setAttribute('aria-current', active ? 'page' : 'false');
		listeners.add(this.addDisposableListener(button, 'click', () => {
			if (kind === 'folder') {
				void this.canvasNavigationService.openFolderCanvas(resource, { source: 'api' });
			} else {
				void this.canvasNavigationService.openCardDetail(resource, {
					source: 'api',
					selection: cardDetail?.selection,
					preserveFocus: cardDetail?.preserveFocus,
					pinned: cardDetail?.pinned,
					projection: cardDetail?.projection
				});
			}
		}));
	}

	private scheduleFolderFocusWrite(delay = 200): void {
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
		void this.focusMirrorService.readFolderFocus(folder).then(fields => {
			if (seq !== this.renderSeq || this.canvasNavigationService.state.cardDetail) {
				return;
			}

			if (!fields) {
				this.canvasZoom = 1;
				this.applyCanvasZoom();
				this.scheduleFolderFocusWrite(0);
				return;
			}

			this.canvasZoom = fields.zoom;
			this.applyCanvasZoom();
			mainWindow.requestAnimationFrame(() => {
				if (seq !== this.renderSeq || this.canvasNavigationService.state.cardDetail) {
					return;
				}

				this.root.scrollLeft = Math.max(0, fields.viewport_center.x * this.canvasZoom - this.root.clientWidth / 2);
				this.root.scrollTop = Math.max(0, fields.viewport_center.y * this.canvasZoom - this.root.clientHeight / 2);
				this.scheduleFolderFocusWrite(0);
			});
		}).catch(error => {
			this.logService.warn(error);
			if (seq === this.renderSeq && !this.canvasNavigationService.state.cardDetail) {
				this.canvasZoom = 1;
				this.applyCanvasZoom();
				this.scheduleFolderFocusWrite(0);
			}
		});
	}

	private flushFolderFocusWrite(): void {
		if (this.canvasNavigationService.state.cardDetail) {
			return;
		}

		const folder = this.getCurrentFolder();
		if (!folder) {
			return;
		}

		const fields = {
			viewport_center: {
				x: roundCanvasPosition((this.root.scrollLeft + this.root.clientWidth / 2) / this.canvasZoom),
				y: roundCanvasPosition((this.root.scrollTop + this.root.clientHeight / 2) / this.canvasZoom)
			},
			zoom: this.canvasZoom
		};
		const key = `${folder.workspaceFolder.toString()}::${folder.relativePath}::${JSON.stringify(fields)}`;
		if (key === this.lastFolderFocusKey) {
			return;
		}

		this.lastFolderFocusKey = key;
		void this.focusMirrorService.writeFolderFocus(folder, fields).catch(error => this.logService.error(error));
	}
}

registerWorkbenchContribution2(BaseHalfCanvasWorkbenchContribution.ID, BaseHalfCanvasWorkbenchContribution, WorkbenchPhase.AfterRestored);

const BASEHALF_CANVAS_MIN_ZOOM = 0.25;
const BASEHALF_CANVAS_MAX_ZOOM = 2;
const BASEHALF_CANVAS_ZOOM_STEP = 0.1;

function roundCanvasPosition(value: number): number {
	return Number(value.toFixed(2));
}

function normalizeCanvasZoom(value: number): number {
	if (!Number.isFinite(value)) {
		return 1;
	}
	return Number(Math.min(BASEHALF_CANVAS_MAX_ZOOM, Math.max(BASEHALF_CANVAS_MIN_ZOOM, value)).toFixed(2));
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

function sourceAnchorForPointer(rect: DOMRect, clientX: number, clientY: number): BaseHalfCanvasAnchor | undefined {
	const x = clientX - rect.left;
	const y = clientY - rect.top;
	if (
		(x < CANVAS_CONNECTION_CORNER_GUARD || x > rect.width - CANVAS_CONNECTION_CORNER_GUARD) &&
		(y < CANVAS_CONNECTION_CORNER_GUARD || y > rect.height - CANVAS_CONNECTION_CORNER_GUARD)
	) {
		return undefined;
	}

	const distances: Array<{ readonly anchor: BaseHalfCanvasAnchor; readonly distance: number }> = [
		{ anchor: 'north', distance: y },
		{ anchor: 'east', distance: rect.width - x },
		{ anchor: 'south', distance: rect.height - y },
		{ anchor: 'west', distance: x }
	];
	const nearest = distances.reduce((best, next) => next.distance < best.distance ? next : best);
	return nearest.distance <= CANVAS_CONNECTION_EDGE_THRESHOLD ? nearest.anchor : undefined;
}

function targetAnchorForPoint(rect: DOMRect, clientX: number, clientY: number): BaseHalfCanvasAnchor | undefined {
	const margin = CANVAS_CONNECTION_TARGET_HIT_DEPTH / 2;
	const x = clientX - rect.left;
	const y = clientY - rect.top;
	if (x < -margin || x > rect.width + margin || y < -margin || y > rect.height + margin) {
		return undefined;
	}

	if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
		if (y <= CANVAS_CONNECTION_TARGET_HIT_DEPTH) {
			return 'north';
		}
		if (y >= rect.height - CANVAS_CONNECTION_TARGET_HIT_DEPTH) {
			return 'south';
		}
		if (x <= CANVAS_CONNECTION_TARGET_HIT_DEPTH) {
			return 'west';
		}
		if (x >= rect.width - CANVAS_CONNECTION_TARGET_HIT_DEPTH) {
			return 'east';
		}
		return undefined;
	}

	const distances: Array<{ readonly anchor: BaseHalfCanvasAnchor; readonly distance: number }> = [
		{ anchor: 'north', distance: Math.abs(y) },
		{ anchor: 'east', distance: Math.abs(rect.width - x) },
		{ anchor: 'south', distance: Math.abs(rect.height - y) },
		{ anchor: 'west', distance: Math.abs(x) }
	];
	return distances.reduce((best, next) => next.distance < best.distance ? next : best).anchor;
}

function distanceToRect(rect: DOMRect, clientX: number, clientY: number): number {
	const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
	const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
	return Math.hypot(dx, dy);
}

function resizeBounds(origin: IBaseHalfCanvasBounds, edge: BaseHalfCanvasResizeEdge, dx: number, dy: number): IBaseHalfCanvasBounds {
	let x = origin.x;
	let y = origin.y;
	let width = origin.width;
	let height = origin.height;
	if (edge.includes('east')) {
		width = origin.width + dx;
	}
	if (edge.includes('south')) {
		height = origin.height + dy;
	}
	if (edge.includes('west')) {
		width = origin.width - dx;
		x = origin.x + dx;
	}
	if (edge.includes('north')) {
		height = origin.height - dy;
		y = origin.y + dy;
	}

	if (width < 140) {
		if (edge.includes('west')) {
			x -= 140 - width;
		}
		width = 140;
	}
	if (height < 48) {
		if (edge.includes('north')) {
			y -= 48 - height;
		}
		height = 48;
	}
	return {
		x: roundCanvasPosition(Math.max(0, x)),
		y: roundCanvasPosition(Math.max(0, y)),
		width: roundCanvasPosition(width),
		height: roundCanvasPosition(height)
	};
}

function edgeId(from: string, to: string): string {
	return `${from}\u0000${to}`;
}

function nearestPathRatio(path: SVGPathElement, clientX: number, clientY: number): number {
	const ctm = path.getScreenCTM();
	const total = path.getTotalLength();
	if (!ctm || total <= 0) {
		return 1;
	}
	let bestLength = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let i = 0; i <= 80; i++) {
		const length = total * i / 80;
		const point = path.getPointAtLength(length);
		const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(ctm);
		const distance = Math.hypot(screenPoint.x - clientX, screenPoint.y - clientY);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestLength = length;
		}
	}
	return bestLength / total;
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

function oppositeAnchor(anchor: BaseHalfCanvasAnchor): BaseHalfCanvasAnchor {
	switch (anchor) {
		case 'north':
			return 'south';
		case 'east':
			return 'west';
		case 'south':
			return 'north';
		case 'west':
			return 'east';
	}
}

function cssStringEscape(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
