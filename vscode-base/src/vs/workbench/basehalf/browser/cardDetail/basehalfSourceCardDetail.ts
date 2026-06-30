/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { ScrollType } from '../../../../editor/common/editorCommon.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { TooLargeFileOperationError } from '../../../../platform/files/common/files.js';
import { ITextEditorSelection, TextEditorSelectionRevealType, TextEditorSelectionSource } from '../../../../platform/editor/common/editor.js';
import { applyTextEditorOptions } from '../../../common/editor/editorOptions.js';
import { getSimpleCodeEditorWidgetOptions } from '../../../contrib/codeEditor/browser/simpleEditorOptions.js';
import { ITextFileService, TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';
import { IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';
import { IBaseHalfFocusMirrorService } from '../../common/basehalfFocusMirrorService.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushOptions, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';

export class BaseHalfSourceCardDetail extends Disposable {
	private static readonly SAVE_SETTLE_TIMEOUT = 15000;

	private readonly toolbar: HTMLElement;
	private readonly status: HTMLElement;
	private readonly editorHost: HTMLElement;
	private readonly saveButton: HTMLButtonElement;

	private editor: CodeEditorWidget | undefined;
	private state: IBaseHalfCardDetailState | undefined;
	private resourceKey: string | undefined;
	private focusTimer: number | undefined;
	private lastFocusKey: string | undefined;
	private disposed = false;
	private readonly editorOptions: IEditorOptions = {
		automaticLayout: false,
		glyphMargin: true,
		lineNumbers: 'on',
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		renderLineHighlight: 'line',
		roundedSelection: false,
		overviewRulerLanes: 3
	};
	constructor(
		private readonly container: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IBaseHalfFocusMirrorService private readonly focusMirrorService: IBaseHalfFocusMirrorService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		clearNode(this.container);
		const root = append(this.container, $('.basehalf-card-detail-source'));
		this.toolbar = append(root, $('.basehalf-card-detail-source-toolbar'));
		this.saveButton = append(this.toolbar, $('button.basehalf-card-detail-source-save.codicon.codicon-save')) as HTMLButtonElement;
		this.saveButton.type = 'button';
		this.saveButton.title = 'Save';
		this.saveButton.setAttribute('aria-label', 'Save');
		this.status = append(this.toolbar, $('.basehalf-card-detail-source-status'));
		this.editorHost = append(root, $('.basehalf-card-detail-source-editor'));

		this._register(addDisposableListener(this.saveButton, EventType.CLICK, () => {
			void this.save();
		}));
		this._register(addDisposableListener(root, EventType.KEY_DOWN, event => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				event.stopPropagation();
				void this.save();
			}
		}));
		this._register(this.textFileService.files.onDidChangeDirty(model => {
			if (this.resourceKey && isEqual(model.resource, this.editor?.getModel()?.uri)) {
				this.updateStatus();
			}
		}));
		this._register(this.textFileService.files.onDidChangeReadonly(model => {
			if (this.resourceKey && isEqual(model.resource, this.editor?.getModel()?.uri)) {
				this.updateStatus();
			}
		}));

		this.registerLayoutObserver();
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.state = state;
		this.resourceKey = state.resource.toString();
		this.status.textContent = 'Loading source';
		this.saveButton.disabled = true;

		try {
			const modelReference = await this.textModelService.createModelReference(state.resource);
			if (this.disposed || this.resourceKey !== state.resource.toString()) {
				modelReference.dispose();
				return;
			}
			this._register(modelReference);

			const editor = this._register(this.instantiationService.createInstance(CodeEditorWidget, this.editorHost, this.editorOptions, {
				...getSimpleCodeEditorWidgetOptions(),
				telemetryData: { target: 'basehalf.cardDetail.source' }
			}));
			this.editor = editor;
			editor.setModel(modelReference.object.textEditorModel);
			this._register(editor.onDidChangeModelContent(() => this.updateStatus()));
			this._register(editor.onDidChangeCursorPosition(() => this.scheduleFocusWrite()));
			this._register(editor.onDidScrollChange(() => this.scheduleFocusWrite()));
			this._register(this.editorFlushService.registerPaneFlusher(BASEHALF_CARD_DETAIL_PANE_ID, options => this.flush(options)));
			this._register(this.editorFlushService.registerDocumentFlusher(this.resourceKey, options => this.flush(options)));
			this.applySelection(state.selection, ScrollType.Immediate);
			this.updateStatus();
			this.flushFocusWrite();
			mainWindow.requestAnimationFrame(() => this.layout());
		} catch (error) {
			if (this.disposed) {
				return;
			}
			this.renderError(error);
		}
	}

	override dispose(): void {
		this.disposed = true;
		if (this.focusTimer !== undefined) {
			mainWindow.clearTimeout(this.focusTimer);
			this.focusTimer = undefined;
		}
		super.dispose();
	}

	applySelection(selection: ITextEditorSelection | undefined, scrollType: ScrollType = ScrollType.Smooth): void {
		if (!selection || !this.editor?.hasModel()) {
			return;
		}

		applyTextEditorOptions({
			selection,
			selectionRevealType: TextEditorSelectionRevealType.CenterIfOutsideViewport,
			selectionSource: TextEditorSelectionSource.NAVIGATION
		}, this.editor, scrollType);
		this.scheduleFocusWrite(0);
	}

	async save(): Promise<void> {
		await this.flush({ forceSerialize: true });
	}

	private async flush(_options: IBaseHalfEditorFlushOptions = {}): Promise<boolean> {
		const resource = this.editor?.getModel()?.uri;
		if (!resource) {
			this.updateStatus();
			return true;
		}

		if (!this.textFileService.isDirty(resource)) {
			this.updateStatus();
			return true;
		}

		if (this.isReadonly()) {
			this.updateStatus();
			return false;
		}

		this.status.textContent = this.textFileService.isDirty(resource) ? 'Saving' : 'Saved';
		this.saveButton.disabled = true;
		try {
			const savedResource = await this.textFileService.save(resource, { ignoreErrorHandler: true });
			if (!savedResource && this.textFileService.isDirty(resource)) {
				this.updateStatus();
				return false;
			}
			const clean = await this.waitForClean(resource);
			this.updateStatus();
			return clean;
		} catch (error) {
			this.status.textContent = error instanceof Error ? `Save failed: ${error.message}` : `Save failed: ${String(error)}`;
			this.saveButton.disabled = false;
			return false;
		}
	}

	private async waitForClean(resource: URI): Promise<boolean> {
		if (!this.textFileService.isDirty(resource)) {
			return true;
		}

		return new Promise<boolean>(resolve => {
			let settled = false;
			const timer = mainWindow.setTimeout(() => settle(!this.textFileService.isDirty(resource)), BaseHalfSourceCardDetail.SAVE_SETTLE_TIMEOUT);
			const disposable = this.textFileService.files.onDidChangeDirty(model => {
				if (isEqual(model.resource, resource) && !model.isDirty()) {
					settle(true);
				}
			});

			const settle = (value: boolean) => {
				if (settled) {
					return;
				}
				settled = true;
				mainWindow.clearTimeout(timer);
				disposable.dispose();
				resolve(value);
			};
		});
	}

	private updateStatus(): void {
		const resource = this.editor?.getModel()?.uri;
		if (!resource) {
			this.status.textContent = 'No source model';
			this.saveButton.disabled = true;
			return;
		}

		if (this.isReadonly()) {
			this.status.textContent = 'Source • Readonly';
			this.saveButton.disabled = true;
			return;
		}

		if (this.textFileService.isDirty(resource)) {
			this.status.textContent = 'Source • Unsaved changes';
			this.saveButton.disabled = false;
		} else {
			this.status.textContent = 'Source • Saved';
			this.saveButton.disabled = false;
		}
	}

	private isReadonly(): boolean {
		const model = this.editor?.getModel();
		if (!model) {
			return false;
		}

		const textFileModel = this.textFileService.files.get(model.uri);
		return !!textFileModel?.isReadonly();
	}

	private renderError(error: unknown): void {
		this.editorHost.remove();
		this.saveButton.disabled = true;

		if (error instanceof TooLargeFileOperationError) {
			this.status.textContent = 'Too large';
			return;
		}

		if (TextFileOperationError.isTextFileOperationError(error) && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			this.status.textContent = 'Binary file';
			return;
		}

		this.status.textContent = error instanceof Error ? error.message : String(error);
	}

	private registerLayoutObserver(): void {
		if (typeof ResizeObserver !== 'undefined') {
			const resizeObserver = new ResizeObserver(() => this.layout());
			resizeObserver.observe(this.editorHost);
			this._register(toDisposable(() => resizeObserver.disconnect()));
			return;
		}

		this._register(addDisposableListener(mainWindow, EventType.RESIZE, () => this.layout()));
	}

	private layout(): void {
		if (!this.editor) {
			return;
		}

		this.editor.layout({
			width: Math.max(0, this.editorHost.clientWidth),
			height: Math.max(0, this.editorHost.clientHeight)
		});
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

	private flushFocusWrite(): void {
		const state = this.state;
		const editor = this.editor;
		if (!state || !editor?.hasModel()) {
			return;
		}

		const position = editor.getPosition();
		const firstVisibleLine = editor.getVisibleRanges()[0]?.startLineNumber ?? position?.lineNumber ?? 1;
		const fields = {
			projection: state.projection,
			visible_lines: { start: firstVisibleLine },
			...(position ? { cursor: { line: position.lineNumber, column: position.column, line_precision: 'exact' as const } } : {})
		};
		const key = JSON.stringify(fields);
		if (key === this.lastFocusKey) {
			return;
		}

		this.lastFocusKey = key;
		void this.focusMirrorService.writeFileFocus(state, fields).catch(error => this.logService.error(error));
	}
}
