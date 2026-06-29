/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasWorkbench.css';

import { $, append, clearNode, Dimension } from '../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { basename } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService, IFileStat, TooLargeFileOperationError } from '../../../platform/files/common/files.js';
import { ILabelService } from '../../../platform/label/common/label.js';
import { IWorkbenchLayoutService, Parts } from '../../services/layout/browser/layoutService.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { mainWindow } from '../../../base/browser/window.js';
import { baseHalfCanvasModelFromStat, baseHalfCanvasPosition, IBaseHalfCanvasItem } from '../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';

const MAX_DETAIL_PREVIEW_BYTES = 256 * 1024;
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
	private readonly detailBody: HTMLElement;
	private readonly cardListeners = this._register(new DisposableStore());

	private renderSeq = 0;
	private detailSeq = 0;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IEditorService editorService: IEditorService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService
	) {
		super();

		const editorContainer = this.layoutService.getContainer(mainWindow, Parts.EDITOR_PART);
		if (!editorContainer) {
			throw new Error('BaseHalf canvas requires the main editor part container.');
		}

		editorContainer.classList.add('basehalf-canvas-host');
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
		const close = append(detailHeader, $('button.basehalf-card-detail-close.codicon.codicon-close')) as HTMLButtonElement;
		close.type = 'button';
		close.title = 'Close';
		close.setAttribute('aria-label', 'Close');
		this._register(this.addDisposableListener(close, 'click', () => this.canvasNavigationService.closeCardDetail()));
		this.detailBody = append(this.detail, $('.basehalf-card-detail-body'));

		editorContainer.prepend(this.root);

		this._register(this.canvasNavigationService.onDidChangeState(() => this.render()));
		this._register(this.fileService.onDidFilesChange(event => {
			const folder = this.getCurrentFolder();
			if (folder && event.affects(folder.resource)) {
				void this.render();
			}
		}));
		this._register(editorService.onDidActiveEditorChange(() => this.canvasNavigationService.closeCardDetail()));
		this._register(this.addDisposableListener(this.root, 'keydown', event => {
			if (event.key === 'Escape') {
				this.canvasNavigationService.closeCardDetail();
			}
		}));

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

		const model = baseHalfCanvasModelFromStat(stat, {
			rootLevel: folder.relativePath.length === 0,
			folderRelativePath: folder.relativePath
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

		this.renderDetail();
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
			clearNode(this.detailBody);
			this.detailTitle.textContent = '';
			this.detailMeta.textContent = '';
			return;
		}

		this.detailTitle.textContent = cardDetail.relativePath || basename(cardDetail.resource);
		this.detailMeta.textContent = this.detailMetaFor(cardDetail.selection);
		void this.loadDetail(cardDetail.resource);
	}

	private async loadDetail(resource: URI): Promise<void> {
		const seq = ++this.detailSeq;
		clearNode(this.detailBody);
		const loading = append(this.detailBody, $('.basehalf-card-detail-status'));
		loading.textContent = 'Loading';

		try {
			const stat = await this.fileService.stat(resource);
			if (stat.size > MAX_DETAIL_PREVIEW_BYTES) {
				if (seq === this.detailSeq) {
					this.renderDetailStatus('Too large');
				}
				return;
			}

			const content = await this.fileService.readFile(resource, { limits: { size: MAX_DETAIL_PREVIEW_BYTES } });
			const text = content.value.toString();
			if (seq !== this.detailSeq) {
				return;
			}

			if (text.includes('\u0000')) {
				this.renderDetailStatus('Binary file');
				return;
			}

			clearNode(this.detailBody);
			const pre = append(this.detailBody, $('pre.basehalf-card-detail-preview'));
			pre.textContent = text || '';
		} catch (error) {
			if (seq !== this.detailSeq) {
				return;
			}

			if (error instanceof TooLargeFileOperationError) {
				this.renderDetailStatus('Too large');
			} else {
				this.renderDetailStatus(error instanceof Error ? error.message : String(error));
			}
		}
	}

	private renderDetailStatus(message: string): void {
		clearNode(this.detailBody);
		const status = append(this.detailBody, $('.basehalf-card-detail-status'));
		status.textContent = message;
	}

	private detailMetaFor(selection: { startLineNumber: number; startColumn: number } | undefined): string {
		if (!selection) {
			return '';
		}

		return `L${selection.startLineNumber}:${selection.startColumn}`;
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
}

registerWorkbenchContribution2(BaseHalfCanvasWorkbenchContribution.ID, BaseHalfCanvasWorkbenchContribution, WorkbenchPhase.AfterRestored);
