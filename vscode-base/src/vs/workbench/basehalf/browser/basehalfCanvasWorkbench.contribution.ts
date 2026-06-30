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

type BaseHalfCanvasCardPreview = { readonly kind: 'folder' | 'text' | 'media' | 'empty' | 'unavailable'; readonly text: string };
type BaseHalfCanvasConnectionTarget = { readonly item: IBaseHalfCanvasItem; readonly anchor: BaseHalfCanvasAnchor };
const CANVAS_CARD_ANCHORS: readonly BaseHalfCanvasAnchor[] = ['north', 'east', 'south', 'west'];
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
	private suppressNextCardClickForPath: string | undefined;
	private suppressNextCardClickTimer: number | undefined;
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
		@IBaseHalfFocusMirrorService private readonly focusMirrorService: IBaseHalfFocusMirrorService
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

	private addDisposableListener<K extends keyof HTMLElementEventMap>(node: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void) {
		node.addEventListener(type, listener);
		return {
			dispose: () => node.removeEventListener(type, listener)
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
			const children = (item.stat.children ?? [])
				.filter(child => child.isDirectory || child.isFile)
				.slice(0, 6)
				.map(child => `${child.isDirectory ? 'dir' : 'file'} ${basename(child.resource)}`);
			if (children.length === 0) {
				return { kind: 'empty', text: 'Empty folder' };
			}
			return { kind: 'folder', text: children.join('\n') };
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

			const text = cleanCardPreviewText(item.name, raw);
			return text ? { kind: 'text', text } : { kind: 'empty', text: 'Empty file' };
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
		this.applyCardBounds(card, bounds);
		card.setAttribute('aria-label', item.name);

		const header = append(card, $('.basehalf-canvas-card-header'));
		const icon = append(header, $('.basehalf-canvas-card-icon.codicon'));
		icon.classList.add(item.kind === 'folder' ? 'codicon-folder' : 'codicon-file');
		const title = append(header, $('.basehalf-canvas-card-title'));
		const label = append(title, $('.basehalf-canvas-card-label'));
		label.textContent = item.name;
		if (item.path.includes('/')) {
			const path = append(title, $('.basehalf-canvas-card-path'));
			path.textContent = item.path.slice(0, Math.max(0, item.path.length - item.name.length - 1));
		}

		const badge = append(card, $('.basehalf-canvas-card-badge'));
		const badgeLabel = append(badge, $('.basehalf-canvas-card-badge-label.codicon.codicon-tag'));
		badgeLabel.textContent = ' Badge';
		const description = append(badge, $('.basehalf-canvas-card-badge-description'));
		description.textContent = item.badge?.description || 'No badge description';
		description.classList.toggle('empty', !item.badge?.description);

		const previewNode = append(card, $('.basehalf-canvas-card-preview'));
		previewNode.classList.add(`kind-${preview?.kind ?? 'unavailable'}`);
		previewNode.textContent = preview?.text ?? 'Preview unavailable';

		const meta = append(card, $('.basehalf-canvas-card-meta'));
		this.renderMetaPills(meta, item);
		for (const anchor of CANVAS_CARD_ANCHORS) {
			this.renderConnectionHandle(card, item, bounds, anchor);
		}
		if (item.badge?.description) {
			card.title = `${item.name}\n${item.badge.description}`;
		}

		this.cardListeners.add(this.addDisposableListener(card, 'click', event => {
			if (event.target instanceof HTMLElement && event.target.closest('.basehalf-canvas-card-connect-handle')) {
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
	}

	private renderMetaPills(container: HTMLElement, item: IBaseHalfCanvasItem): void {
		const kind = append(container, $('.basehalf-canvas-card-pill.kind'));
		kind.textContent = item.kind;

		const references = item.badge?.references.length ?? 0;
		const referencedBy = item.badge?.referenced_by.length ?? 0;
		const refs = append(container, $('.basehalf-canvas-card-pill'));
		refs.textContent = `refs ${references}`;
		const inbound = append(container, $('.basehalf-canvas-card-pill'));
		inbound.textContent = `in ${referencedBy}`;

		if (item.badge?.orphan) {
			const orphan = append(container, $('.basehalf-canvas-card-pill.warning'));
			orphan.textContent = 'orphan';
		}
	}

	private renderConnectionHandle(card: HTMLElement, item: IBaseHalfCanvasItem, bounds: IBaseHalfCanvasBounds, anchor: BaseHalfCanvasAnchor): void {
		const handle = append(card, $(`span.basehalf-canvas-card-connect-handle.${anchor}`));
		handle.setAttribute('aria-hidden', 'true');
		this.cardListeners.add(this.addDisposableListener(handle, 'pointerdown', event => this.onConnectionPointerDown(event, handle, item, bounds, anchor)));
		this.cardListeners.add(this.addDisposableListener(handle, 'pointermove', event => this.onConnectionPointerMove(event)));
		this.cardListeners.add(this.addDisposableListener(handle, 'pointerup', event => this.onConnectionPointerUp(event)));
		this.cardListeners.add(this.addDisposableListener(handle, 'pointercancel', event => this.onConnectionPointerCancel(event)));
	}

	private onCardPointerDown(event: PointerEvent, card: HTMLElement, item: IBaseHalfCanvasItem, bounds: IBaseHalfCanvasBounds): void {
		if (event.button !== 0 || this.activeCardDrag || this.canvasNavigationService.state.cardDetail) {
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
		const element = mainWindow.document.elementFromPoint(clientX, clientY);
		const card = element instanceof HTMLElement ? element.closest<HTMLElement>('.basehalf-canvas-card') : undefined;
		const path = card?.dataset.basehalfCardPath;
		if (!card || !path || path === sourcePath) {
			return undefined;
		}

		const item = this.renderedItemsByPath.get(path);
		if (!item) {
			return undefined;
		}

		return {
			item,
			anchor: targetAnchorForPoint(card.getBoundingClientRect(), clientX, clientY)
		};
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
			const path = $.SVG('path');
			path.classList.add('basehalf-canvas-edge-path');
			path.setAttribute('d', edge.path);
			path.setAttribute('marker-end', `url(#${markerId})`);
			const title = $.SVG('title');
			title.textContent = edge.label?.text ? `${edge.edge.from} to ${edge.edge.to}: ${edge.label.text}` : `${edge.edge.from} to ${edge.edge.to}`;
			path.appendChild(title);
			svg.appendChild(path);

			if (edge.label) {
				const text = $.SVG('text');
				text.classList.add('basehalf-canvas-edge-label');
				text.setAttribute('x', `${edge.label.x}`);
				text.setAttribute('y', `${edge.label.y - 8}`);
				text.setAttribute('text-anchor', 'middle');
				text.textContent = edge.label.text;
				svg.appendChild(text);
			}
		}

		return { dropped: layoutResult.dropped };
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

function targetAnchorForPoint(rect: DOMRect, clientX: number, clientY: number): BaseHalfCanvasAnchor {
	const x = clientX - rect.left;
	const y = clientY - rect.top;
	const distances: Array<{ readonly anchor: BaseHalfCanvasAnchor; readonly distance: number }> = [
		{ anchor: 'north', distance: Math.abs(y) },
		{ anchor: 'east', distance: Math.abs(rect.width - x) },
		{ anchor: 'south', distance: Math.abs(rect.height - y) },
		{ anchor: 'west', distance: Math.abs(x) }
	];
	return distances.reduce((best, next) => next.distance < best.distance ? next : best).anchor;
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
