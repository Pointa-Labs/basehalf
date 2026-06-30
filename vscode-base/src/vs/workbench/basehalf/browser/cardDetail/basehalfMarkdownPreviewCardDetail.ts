/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { TooLargeFileOperationError } from '../../../../platform/files/common/files.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITextFileService, TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';
import { IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';
import { IBaseHalfFocusMirrorService } from '../../common/basehalfFocusMirrorService.js';

export class BaseHalfMarkdownPreviewCardDetail extends Disposable {
	private readonly status: HTMLElement;
	private readonly previewScroll: HTMLElement;
	private readonly previewContent: HTMLElement;
	private readonly rendered = this._register(new DisposableStore());

	private model: ITextModel | undefined;
	private state: IBaseHalfCardDetailState | undefined;
	private resourceKey: string | undefined;
	private renderTimer: number | undefined;
	private focusTimer: number | undefined;
	private selectionRevealTimer: number | undefined;
	private lastFocusKey: string | undefined;
	private disposed = false;

	constructor(
		private readonly container: HTMLElement,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@IBaseHalfFocusMirrorService private readonly focusMirrorService: IBaseHalfFocusMirrorService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		clearNode(this.container);
		const root = append(this.container, $('.basehalf-card-detail-markdown-preview'));
		const toolbar = append(root, $('.basehalf-card-detail-markdown-preview-toolbar'));
		this.status = append(toolbar, $('.basehalf-card-detail-markdown-preview-status'));
		this.previewScroll = append(root, $('.basehalf-card-detail-markdown-preview-scroll'));
		this.previewContent = append(this.previewScroll, $('.basehalf-card-detail-markdown-preview-content'));

		this._register(addDisposableListener(this.previewScroll, EventType.SCROLL, () => this.scheduleFocusWrite()));
		this._register(this.textFileService.files.onDidChangeDirty(model => {
			if (this.model && isEqual(model.resource, this.model.uri)) {
				this.updateStatus();
			}
		}));
		this._register(this.textFileService.files.onDidChangeReadonly(model => {
			if (this.model && isEqual(model.resource, this.model.uri)) {
				this.updateStatus();
			}
		}));
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.state = state;
		this.resourceKey = state.resource.toString();
		this.status.textContent = 'Loading preview';

		try {
			const modelReference = await this.textModelService.createModelReference(state.resource);
			if (this.disposed || this.resourceKey !== state.resource.toString()) {
				modelReference.dispose();
				return;
			}
			this._register(modelReference);
			this.model = modelReference.object.textEditorModel;
			this._register(this.model.onDidChangeContent(() => this.scheduleRender()));
			this.renderNow();
			this.flushFocusWrite();
		} catch (error) {
			if (this.disposed) {
				return;
			}
			this.renderError(error);
		}
	}

	override dispose(): void {
		this.disposed = true;
		if (this.renderTimer !== undefined) {
			mainWindow.clearTimeout(this.renderTimer);
			this.renderTimer = undefined;
		}
		if (this.focusTimer !== undefined) {
			mainWindow.clearTimeout(this.focusTimer);
			this.focusTimer = undefined;
		}
		if (this.selectionRevealTimer !== undefined) {
			mainWindow.clearTimeout(this.selectionRevealTimer);
			this.selectionRevealTimer = undefined;
		}
		super.dispose();
	}

	private scheduleRender(delay = 80): void {
		if (this.renderTimer !== undefined) {
			mainWindow.clearTimeout(this.renderTimer);
		}

		this.renderTimer = mainWindow.setTimeout(() => {
			this.renderTimer = undefined;
			this.renderNow();
		}, delay);
	}

	private renderNow(): void {
		const state = this.state;
		const model = this.model;
		if (!state || !model) {
			this.status.textContent = 'No preview model';
			return;
		}

		this.rendered.clear();
		const markdown = new MarkdownString(model.getValue(), {
			isTrusted: false,
			supportHtml: true
		});
		markdown.baseUri = state.resource;

		const rendered = this.markdownRendererService.render(markdown, {
			asyncRenderCallback: () => undefined
		}, this.previewContent);
		rendered.element.classList.add('basehalf-card-detail-markdown-preview-content');
		this.rendered.add(rendered);
		this.updateStatus();
		this.revealSelection();
		this.scheduleFocusWrite(0);
	}

	private updateStatus(): void {
		const model = this.model;
		if (!model) {
			this.status.textContent = 'No preview model';
			return;
		}

		const textFileModel = this.textFileService.files.get(model.uri);
		if (textFileModel?.isReadonly()) {
			this.status.textContent = 'Preview • Readonly source';
			return;
		}

		this.status.textContent = this.textFileService.isDirty(model.uri) ? 'Preview • Unsaved source changes' : 'Preview • Source saved';
	}

	private renderError(error: unknown): void {
		this.rendered.clear();
		clearNode(this.previewContent);

		if (error instanceof TooLargeFileOperationError) {
			this.status.textContent = 'Too large';
			return;
		}

		if (TextFileOperationError.isTextFileOperationError(error) && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			this.status.textContent = 'Binary file';
			return;
		}

		const message = error instanceof Error ? error.message : String(error);
		this.status.textContent = message;
		const node = append(this.previewContent, $('.basehalf-card-detail-status'));
		node.textContent = message;
	}

	private scheduleFocusWrite(delay = 200): void {
		if (this.focusTimer !== undefined) {
			mainWindow.clearTimeout(this.focusTimer);
		}

		this.focusTimer = mainWindow.setTimeout(() => {
			this.focusTimer = undefined;
			this.flushFocusWrite();
		}, delay);
	}

	private revealSelection(): void {
		const selection = this.state?.selection;
		const model = this.model;
		if (!selection || !model) {
			return;
		}

		const lineCount = Math.max(1, model.getLineCount());
		const ratio = Math.max(0, Math.min(1, (selection.startLineNumber - 1) / Math.max(1, lineCount - 1)));
		mainWindow.requestAnimationFrame(() => {
			const maxScroll = Math.max(0, this.previewScroll.scrollHeight - this.previewScroll.clientHeight);
			this.previewScroll.scrollTop = ratio * maxScroll;
			this.clearSelectionReveal();

			const anchor = this.closestRenderedBlockToViewportTop();
			anchor?.classList.add('basehalf-card-detail-markdown-preview-selection-reveal');
			if (this.selectionRevealTimer !== undefined) {
				mainWindow.clearTimeout(this.selectionRevealTimer);
			}
			this.selectionRevealTimer = mainWindow.setTimeout(() => {
				this.selectionRevealTimer = undefined;
				this.clearSelectionReveal();
			}, 1800);
			this.scheduleFocusWrite(0);
		});
	}

	private closestRenderedBlockToViewportTop(): HTMLElement | undefined {
		const viewportTop = this.previewScroll.getBoundingClientRect().top;
		const candidates = Array.from(this.previewContent.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,table'));
		let best: { readonly element: HTMLElement; readonly distance: number } | undefined;
		for (const candidate of candidates) {
			const rect = candidate.getBoundingClientRect();
			if (rect.bottom < viewportTop) {
				continue;
			}
			const distance = Math.abs(rect.top - viewportTop);
			if (!best || distance < best.distance) {
				best = { element: candidate, distance };
			}
		}
		return best?.element;
	}

	private clearSelectionReveal(): void {
		for (const element of Array.from(this.previewContent.querySelectorAll<HTMLElement>('.basehalf-card-detail-markdown-preview-selection-reveal'))) {
			element.classList.remove('basehalf-card-detail-markdown-preview-selection-reveal');
		}
	}

	private flushFocusWrite(): void {
		const state = this.state;
		if (!state) {
			return;
		}

		const fields = { projection: state.projection };
		const key = JSON.stringify(fields);
		if (key === this.lastFocusKey) {
			return;
		}

		this.lastFocusKey = key;
		void this.focusMirrorService.writeFileFocus(state, fields).catch(error => this.logService.error(error));
	}
}
