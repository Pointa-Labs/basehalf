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
	baseHalfCanvasModelFromStat,
	baseHalfCanvasPosition,
	IBaseHalfCanvasFile,
	IBaseHalfCanvasItem
} from '../common/basehalfCanvasModel.js';
import { BaseHalfCanvasMirrorCorrupt, IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService, IBaseHalfCardDetailState } from '../common/basehalfCanvasNavigation.js';
import { BaseHalfCardDetailProjection, isBaseHalfMarkdownResource } from '../common/basehalfCardDetail.js';
import { IBaseHalfFocusMirrorService } from '../common/basehalfFocusMirrorService.js';
import { BaseHalfMarkdownPreviewCardDetail } from './cardDetail/basehalfMarkdownPreviewCardDetail.js';
import { BaseHalfSourceCardDetail } from './cardDetail/basehalfSourceCardDetail.js';

const DEFAULT_CARD_WIDTH = 220;
const DEFAULT_CARD_HEIGHT = 112;

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
	private sourceDetail: BaseHalfSourceCardDetail | undefined;
	private markdownPreviewDetail: BaseHalfMarkdownPreviewCardDetail | undefined;
	private folderFocusTimer: number | undefined;
	private lastFolderFocusKey: string | undefined;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IEditorService editorService: IEditorService,
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
		this._register(this.addDisposableListener(close, 'click', () => this.canvasNavigationService.closeCardDetail()));
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
			this.canvasNavigationService.closeCardDetail();
			this.updateCanvasLayer(editorService);
		}));
		this._register(this.addDisposableListener(this.root, 'keydown', event => {
			if (event.key === 'Escape') {
				this.canvasNavigationService.closeCardDetail();
			}
		}));
		this._register(this.addDisposableListener(this.root, 'scroll', () => this.scheduleFolderFocusWrite()));
		this._register(toDisposable(() => {
			if (this.folderFocusTimer !== undefined) {
				mainWindow.clearTimeout(this.folderFocusTimer);
				this.folderFocusTimer = undefined;
			}
		}));

		this.updateCanvasLayer(editorService);
		void this.render();
	}

	private addDisposableListener<K extends keyof HTMLElementEventMap>(node: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void) {
		node.addEventListener(type, listener);
		return {
			dispose: () => node.removeEventListener(type, listener)
		};
	}

	private async render(): Promise<void> {
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
			if (seq !== this.renderSeq) {
				return;
			}
			clearNode(this.cards);
			this.renderEmpty(error instanceof Error ? error.message : String(error));
			this.renderDetail();
			return;
		}

		if (seq !== this.renderSeq) {
			return;
		}

		let canvas: IBaseHalfCanvasFile | null = null;
		let canvasWarning: string | undefined;
		try {
			canvas = await this.canvasMirrorService.readCanvas(folder);
		} catch (error) {
			canvasWarning = error instanceof BaseHalfCanvasMirrorCorrupt ? 'Corrupt canvas.yaml' : 'Unable to read canvas.yaml';
		}

		const model = baseHalfCanvasModelFromStat(stat, {
			rootLevel: folder.relativePath.length === 0,
			folderRelativePath: folder.relativePath,
			canvas
		});
		const items = model.items;
		clearNode(this.cards);
		this.cardListeners.clear();
		if (items.length === 0) {
			this.renderEmpty('No files');
		} else {
			for (let i = 0; i < items.length; i++) {
				this.renderCard(items[i], i, items.length);
			}
			if (model.truncated > 0) {
				this.renderTruncated(model.truncated);
			}
			const size = this.canvasSize(items);
			this.cards.style.width = `${size.width}px`;
			this.cards.style.height = `${size.height}px`;
		}
		if (canvasWarning) {
			this.renderCanvasWarning(canvasWarning);
		}

		this.renderDetail();
		this.scheduleFolderFocusWrite(0);
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
		const fallbackPosition = baseHalfCanvasPosition(index, total);
		const x = item.card?.x ?? fallbackPosition.x;
		const y = item.card?.y ?? fallbackPosition.y;
		const width = item.card?.width ?? DEFAULT_CARD_WIDTH;
		const height = item.card?.height ?? DEFAULT_CARD_HEIGHT;
		const card = append(this.cards, $('button.basehalf-canvas-card')) as HTMLButtonElement;
		card.type = 'button';
		card.style.transform = `translate(${x}px, ${y}px)`;
		card.style.width = `${width}px`;
		card.style.height = `${height}px`;
		card.setAttribute('aria-label', item.name);

		const icon = append(card, $('.basehalf-canvas-card-icon.codicon'));
		icon.classList.add(item.kind === 'folder' ? 'codicon-folder' : 'codicon-file');
		const label = append(card, $('.basehalf-canvas-card-label'));
		label.textContent = item.name;
		const meta = append(card, $('.basehalf-canvas-card-meta'));
		meta.textContent = item.kind;

		this.cardListeners.add(this.addDisposableListener(card, 'click', () => {
			void this.canvasNavigationService.openResource(item.stat.resource, { source: 'api', pinned: true });
		}));
	}

	private renderTruncated(heldBack: number): void {
		const truncated = append(this.cards, $('.basehalf-canvas-truncated'));
		truncated.textContent = `+${heldBack} more`;
	}

	private renderCanvasWarning(message: string): void {
		const warning = append(this.cards, $('.basehalf-canvas-warning'));
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
		this.markdownPreviewDetail = undefined;
		this.detailDisposables.clear();

		if (cardDetail.projection === 'preview') {
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

			this.canvasNavigationService.openCardDetail(cardDetail.resource, {
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

	private canvasSize(items: readonly IBaseHalfCanvasItem[]): Dimension {
		if (items.length === 0) {
			return new Dimension(800, 480);
		}

		let maxX = 0;
		let maxY = 0;
		for (let index = 0; index < items.length; index++) {
			const fallback = baseHalfCanvasPosition(index, items.length);
			const item = items[index];
			const x = item.card?.x ?? fallback.x;
			const y = item.card?.y ?? fallback.y;
			const width = item.card?.width ?? DEFAULT_CARD_WIDTH;
			const height = item.card?.height ?? DEFAULT_CARD_HEIGHT;
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
			zoom: 1
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
