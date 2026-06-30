/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasWorkbench.css';

import { $, append, clearNode, Dimension } from '../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { basename } from '../../../base/common/resources.js';
import { IFileService, IFileStat } from '../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../platform/label/common/label.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IWorkbenchLayoutService, Parts } from '../../services/layout/browser/layoutService.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { mainWindow } from '../../../base/browser/window.js';
import {
	baseHalfCanvasEdgeLayouts,
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

class BaseHalfCanvasWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.canvasWorkbench';

	private readonly root: HTMLElement;
	private readonly title: HTMLElement;
	private readonly subtitle: HTMLElement;
	private readonly cards: HTMLElement;
	private readonly detail: HTMLElement;
	private readonly detailTitle: HTMLElement;
	private readonly detailMeta: HTMLElement;
	private readonly detailProjectionActions: HTMLElement;
	private readonly detailBody: HTMLElement;
	private readonly editorContainer: HTMLElement;
	private readonly cardListeners = this._register(new DisposableStore());
	private readonly detailChromeDisposables = this._register(new DisposableStore());
	private readonly detailDisposables = this._register(new DisposableStore());

	private renderSeq = 0;
	private detailKey: string | undefined;
	private activeCardDrag: {
		readonly pointerId: number;
		readonly card: HTMLButtonElement;
		readonly item: IBaseHalfCanvasItem;
		readonly origin: IBaseHalfCanvasBounds;
		readonly startClientX: number;
		readonly startClientY: number;
		latest: IBaseHalfCanvasBounds;
		moved: boolean;
	} | undefined;
	private suppressNextCardClickForPath: string | undefined;
	private suppressNextCardClickTimer: number | undefined;
	private sourceDetail: BaseHalfSourceCardDetail | undefined;
	private markdownRichDetail: BaseHalfMarkdownRichCardDetail | undefined;
	private markdownPreviewDetail: BaseHalfMarkdownPreviewCardDetail | undefined;
	private folderFocusTimer: number | undefined;
	private lastFolderFocusKey: string | undefined;
	private restoredFolderFocusKey: string | undefined;
	private canvasZoom = 1;
	private disposed = false;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IEditorService editorService: IEditorService,
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

		const chrome = append(this.root, $('.basehalf-canvas-chrome'));
		this.title = append(chrome, $('.basehalf-canvas-title'));
		this.subtitle = append(chrome, $('.basehalf-canvas-subtitle'));
		this.cards = append(this.root, $('.basehalf-canvas-cards'));

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
		this._register(editorService.onDidVisibleEditorsChange(() => this.updateCanvasLayer(editorService)));
		this._register(editorService.onDidActiveEditorChange(() => {
			void this.canvasNavigationService.closeCardDetail();
			this.updateCanvasLayer(editorService);
		}));
		this._register(this.addDisposableListener(this.root, 'keydown', event => {
			if (event.key === 'Escape') {
				void this.canvasNavigationService.closeCardDetail();
			}
		}));
		this._register(this.addDisposableListener(this.root, 'scroll', () => this.scheduleFolderFocusWrite()));
		this._register(toDisposable(() => {
			if (this.folderFocusTimer !== undefined) {
				mainWindow.clearTimeout(this.folderFocusTimer);
				this.folderFocusTimer = undefined;
			}
			this.clearSuppressedCardClick();
		}));

		this.updateCanvasLayer(editorService);
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
			this.title.textContent = 'BaseHalf';
			this.subtitle.textContent = '';
			clearNode(this.cards);
			this.renderEmpty('No folder');
			this.renderDetail();
			return;
		}

		this.title.textContent = folder.relativePath || basename(folder.resource) || this.labelService.getUriLabel(folder.resource);
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
		clearNode(this.cards);
		this.cardListeners.clear();
		if (items.length === 0) {
			this.renderEmpty('No files');
		} else {
			const size = this.canvasSize(items, model.size);
			const layoutResult = this.renderEdges(model.edges, items, size);
			for (let i = 0; i < items.length; i++) {
				this.renderCard(items[i], i, items.length);
			}
			if (model.truncated > 0) {
				this.renderTruncated(model.truncated);
			}
			this.cards.style.width = `${size.width}px`;
			this.cards.style.height = `${size.height}px`;
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

	private updateCanvasLayer(editorService: IEditorService): void {
		this.editorContainer.classList.toggle('basehalf-canvas-on-top', editorService.visibleEditors.length === 0);
	}

	private renderCard(item: IBaseHalfCanvasItem, index: number, total: number): void {
		const bounds = baseHalfCanvasItemBounds(item, index, total);
		const card = append(this.cards, $('button.basehalf-canvas-card')) as HTMLButtonElement;
		card.type = 'button';
		this.applyCardBounds(card, bounds);
		card.setAttribute('aria-label', item.name);

		const icon = append(card, $('.basehalf-canvas-card-icon.codicon'));
		icon.classList.add(item.kind === 'folder' ? 'codicon-folder' : 'codicon-file');
		const label = append(card, $('.basehalf-canvas-card-label'));
		label.textContent = item.name;
		const description = append(card, $('.basehalf-canvas-card-description'));
		description.textContent = item.badge?.description ?? '';
		const meta = append(card, $('.basehalf-canvas-card-meta'));
		meta.textContent = this.cardMetaLabel(item);
		if (item.badge?.description) {
			card.title = `${item.name}\n${item.badge.description}`;
		}

		this.cardListeners.add(this.addDisposableListener(card, 'click', event => {
			if (this.suppressNextCardClickForPath === item.path) {
				event.preventDefault();
				event.stopPropagation();
				this.clearSuppressedCardClick();
				return;
			}

			void this.canvasNavigationService.openResource(item.stat.resource, { source: 'api', pinned: true });
		}));
		this.cardListeners.add(this.addDisposableListener(card, 'pointerdown', event => this.onCardPointerDown(event, card, item, bounds)));
		this.cardListeners.add(this.addDisposableListener(card, 'pointermove', event => this.onCardPointerMove(event)));
		this.cardListeners.add(this.addDisposableListener(card, 'pointerup', event => this.onCardPointerUp(event)));
		this.cardListeners.add(this.addDisposableListener(card, 'pointercancel', event => this.onCardPointerCancel(event)));
	}

	private onCardPointerDown(event: PointerEvent, card: HTMLButtonElement, item: IBaseHalfCanvasItem, bounds: IBaseHalfCanvasBounds): void {
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

		const dx = event.clientX - drag.startClientX;
		const dy = event.clientY - drag.startClientY;
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

	private applyCardBounds(card: HTMLElement, bounds: IBaseHalfCanvasBounds): void {
		card.style.transform = `translate(${bounds.x}px, ${bounds.y}px)`;
		card.style.width = `${bounds.width}px`;
		card.style.height = `${bounds.height}px`;
	}

	private cardMetaLabel(item: IBaseHalfCanvasItem): string {
		const parts: string[] = [item.kind];
		const references = item.badge?.references.length ?? 0;
		const referencedBy = item.badge?.referenced_by.length ?? 0;
		if (references > 0) {
			parts.push(`refs ${references}`);
		}
		if (referencedBy > 0) {
			parts.push(`in ${referencedBy}`);
		}
		if (item.badge?.orphan) {
			parts.push('orphan');
		}
		return parts.join(' · ');
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
		this.cards.style.width = '100%';
		this.cards.style.height = '100%';
	}

	private renderDetail(): void {
		const cardDetail = this.canvasNavigationService.state.cardDetail;
		this.detail.classList.toggle('visible', !!cardDetail);
		if (!cardDetail) {
			this.detailKey = undefined;
			this.sourceDetail = undefined;
			this.markdownRichDetail = undefined;
			this.markdownPreviewDetail = undefined;
			this.detailChromeDisposables.clear();
			this.detailDisposables.clear();
			clearNode(this.detailProjectionActions);
			clearNode(this.detailBody);
			this.detailTitle.textContent = '';
			this.detailMeta.textContent = '';
			this.scheduleFolderFocusWrite(0);
			return;
		}

		this.detailTitle.textContent = cardDetail.relativePath || basename(cardDetail.resource);
		this.detailMeta.textContent = this.detailMetaFor(cardDetail.projection, cardDetail.selection);
		this.renderProjectionActions(cardDetail);

		const detailKey = `${cardDetail.resource.toString()}::${cardDetail.projection}`;
		if (this.detailKey === detailKey) {
			this.sourceDetail?.applySelection(cardDetail.selection);
			return;
		}

		this.detailKey = detailKey;
		this.sourceDetail = undefined;
		this.markdownRichDetail = undefined;
		this.markdownPreviewDetail = undefined;
		this.detailDisposables.clear();

		if (cardDetail.projection === 'rich') {
			this.markdownRichDetail = this.detailDisposables.add(this.instantiationService.createInstance(BaseHalfMarkdownRichCardDetail, this.detailBody));
			void this.markdownRichDetail.open(cardDetail);
		} else if (cardDetail.projection === 'preview') {
			this.markdownPreviewDetail = this.detailDisposables.add(this.instantiationService.createInstance(BaseHalfMarkdownPreviewCardDetail, this.detailBody));
			void this.markdownPreviewDetail.open(cardDetail);
		} else if (cardDetail.projection === 'source') {
			this.sourceDetail = this.detailDisposables.add(this.instantiationService.createInstance(BaseHalfSourceCardDetail, this.detailBody));
			void this.sourceDetail.open(cardDetail);
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
				this.scheduleFolderFocusWrite(0);
				return;
			}

			this.canvasZoom = fields.zoom;
			mainWindow.requestAnimationFrame(() => {
				if (seq !== this.renderSeq || this.canvasNavigationService.state.cardDetail) {
					return;
				}

				this.root.scrollLeft = Math.max(0, fields.viewport_center.x - this.root.clientWidth / 2);
				this.root.scrollTop = Math.max(0, fields.viewport_center.y - this.root.clientHeight / 2);
				this.scheduleFolderFocusWrite(0);
			});
		}).catch(error => {
			this.logService.warn(error);
			if (seq === this.renderSeq && !this.canvasNavigationService.state.cardDetail) {
				this.canvasZoom = 1;
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
				x: this.root.scrollLeft + this.root.clientWidth / 2,
				y: this.root.scrollTop + this.root.clientHeight / 2
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

function roundCanvasPosition(value: number): number {
	return Number(value.toFixed(2));
}
