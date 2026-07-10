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
import { baseHalfEditorProjectionCanFlush, BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushOptions, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { IBaseHalfFocusMirrorService } from '../../common/basehalfFocusMirrorService.js';
import { BaseHalfMarkdownRichTextModelDisk } from '../../common/basehalfMarkdownRichTextModel.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceResourceMutationStamp } from '../../common/basehalfWorkspaceMutation.js';

export class BaseHalfMarkdownPreviewCardDetail extends Disposable {
	private readonly previewScroll: HTMLElement;
	private readonly previewContent: HTMLElement;
	private readonly rendered = this._register(new DisposableStore());

	private model: ITextModel | undefined;
	private state: IBaseHalfCardDetailState | undefined;
	private resourceKey: string | undefined;
	private renderTimer: number | undefined;
	private focusTimer: number | undefined;
	private focusStamp: IBaseHalfWorkspaceResourceMutationStamp | undefined;
	private selectionRevealTimer: number | undefined;
	private lastFocusKey: string | undefined;
	private disposed = false;
	private visible = false;
	private pendingRender = false;

	constructor(
		private readonly container: HTMLElement,
		private readonly onSaveStatusChange: (status: 'saving' | 'saved') => void,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@IBaseHalfFocusMirrorService private readonly focusMirrorService: IBaseHalfFocusMirrorService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@ILogService private readonly logService: ILogService
	) {
		super();

		const root = append(this.container, $('.basehalf-card-detail-markdown-preview'));
		this.previewScroll = append(root, $('.basehalf-card-detail-markdown-preview-scroll'));
		this.previewContent = append(this.previewScroll, $('.basehalf-card-detail-markdown-preview-content'));
		this.setSaveStatus('saving');

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
		this.focusStamp = this.workspaceMutationCoordinator.captureResource(state.workspaceFolder, state.relativePath);
		this.resourceKey = state.resource.toString();
		this.setSaveStatus('saving');

		try {
			const modelReference = await this.textModelService.createModelReference(state.resource);
			if (this.disposed || this.resourceKey !== state.resource.toString()) {
				modelReference.dispose();
				return;
			}
			this._register(modelReference);
			this.model = modelReference.object.textEditorModel;
			this._register(this.model.onDidChangeContent(() => this.scheduleRender()));
			this._register(this.editorFlushService.registerPaneFlusher(BASEHALF_CARD_DETAIL_PANE_ID, options => this.flush(options)));
			this._register(this.editorFlushService.registerDocumentFlusher(state.resource.toString(), options => this.flush(options)));
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

	/**
	 * Re-entry hook for a retained (hidden) surface becoming the visible
	 * projection again: adopt the latest navigation state and re-assert this
	 * projection in the focus mirror (the previous projection owned it while
	 * this one was hidden).
	 */
	activate(state: IBaseHalfCardDetailState): void {
		this.state = state;
		if (state.selection) {
			this.revealSelection();
		}
		this.lastFocusKey = undefined;
		this.flushFocusWrite();
	}

	applySelection(selection: IBaseHalfCardDetailState['selection']): void {
		if (!selection || !this.state) {
			return;
		}

		this.state = { ...this.state, selection };
		this.revealSelection();
		this.flushFocusWrite();
	}

	/**
	 * While hidden, re-rendering the whole preview per content change of a
	 * sibling projection is wasted work; suspend and render once on show.
	 */
	setVisible(visible: boolean): void {
		if (this.visible === visible) {
			return;
		}
		this.visible = visible;
		if (visible && this.pendingRender) {
			this.pendingRender = false;
			this.renderNow();
		}
	}

	/** Preview is read-only UI but still owns the shared TextModel while it is
	 * the active projection. Workspace edits can dirty that model even when a
	 * Source surface was never instantiated, so structural preflight must save
	 * it here rather than relying on a hidden Monaco flusher. */
	private async flush(options: IBaseHalfEditorFlushOptions = {}): Promise<boolean> {
		if (!baseHalfEditorProjectionCanFlush('preview', this.visible, options)) {
			return true;
		}
		const model = this.model;
		if (!model || !this.textFileService.isDirty(model.uri)) {
			this.updateStatus();
			return true;
		}
		try {
			await new BaseHalfMarkdownRichTextModelDisk(model, {
				isDirty: resource => this.textFileService.isDirty(resource),
				isReadonly: resource => !!this.textFileService.files.get(resource)?.isReadonly(),
				save: (resource, saveOptions) => this.textFileService.save(resource, saveOptions)
			}).write(model.getValue());
			this.updateStatus();
			return true;
		} catch (error) {
			this.logService.error('[BaseHalf] preview shared TextModel save failed', error);
			this.updateStatus();
			return false;
		}
	}

	private scheduleRender(delay = 80): void {
		if (this.renderTimer !== undefined) {
			mainWindow.clearTimeout(this.renderTimer);
		}

		this.renderTimer = mainWindow.setTimeout(() => {
			this.renderTimer = undefined;
			if (!this.visible) {
				this.pendingRender = true;
				return;
			}
			this.renderNow();
		}, delay);
	}

	private renderNow(): void {
		const state = this.state;
		const model = this.model;
		if (!state || !model) {
			this.setSaveStatus('saving');
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
			this.setSaveStatus('saving');
			return;
		}

		const textFileModel = this.textFileService.files.get(model.uri);
		if (textFileModel?.isReadonly()) {
			this.setSaveStatus('saved');
			return;
		}

		this.setSaveStatus(this.textFileService.isDirty(model.uri) ? 'saving' : 'saved');
	}

	private setSaveStatus(status: 'saving' | 'saved'): void {
		this.onSaveStatusChange(status);
	}

	private renderError(error: unknown): void {
		this.rendered.clear();
		clearNode(this.previewContent);

		if (error instanceof TooLargeFileOperationError) {
			this.setSaveStatus('saved');
			return;
		}

		if (TextFileOperationError.isTextFileOperationError(error) && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			this.setSaveStatus('saved');
			return;
		}

		const message = error instanceof Error ? error.message : String(error);
		this.setSaveStatus('saving');
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
		const stamp = this.focusStamp;
		if (!state || !stamp) {
			return;
		}

		const fields = state.selection
			? {
				projection: state.projection,
				visible_lines: { start: state.selection.startLineNumber },
				cursor: {
					line: state.selection.startLineNumber,
					column: state.selection.startColumn,
					line_precision: 'exact' as const
				}
			}
			: { projection: state.projection };
		const key = `${stamp.structuralEpoch}:${JSON.stringify(fields)}`;
		if (key === this.lastFocusKey) {
			return;
		}

		void this.workspaceMutationCoordinator.runResourceMutation(state.workspaceFolder, stamp, lease =>
			this.focusMirrorService.writeFileFocus(state, fields, lease)
		).then(() => this.lastFocusKey = key).catch(error => this.logService.error(error));
	}
}
