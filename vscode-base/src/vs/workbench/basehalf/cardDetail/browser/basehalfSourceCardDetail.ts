/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCardDetailProjections.css';
import { $, append, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
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
import { TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';
import { IBaseHalfCardDetailState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_AGENT_SELECTION_TEXT_LIMIT, IBaseHalfAgentSelectionText } from '../../agentArea/common/basehalfAgentSelection.js';
import { BASEHALF_NOTE_COPY_SOURCE } from '../../markdown/common/basehalfNoteFileLinks.js';
import { BaseHalfTextFileSaving } from './basehalfTextFileSaving.js';

export class BaseHalfSourceCardDetail extends Disposable {
	private readonly root: HTMLElement;
	private readonly editorHost: HTMLElement;

	private editor: CodeEditorWidget | undefined;
	private resourceKey: string | undefined;
	private readonly saving: BaseHalfTextFileSaving;
	private visible = false;
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
		private readonly onSaveStatusChange: (status: 'saving' | 'saved' | 'error') => void,
		/** The text the user selected, or `undefined` once nothing is (the selection agents can see). */
		private readonly onSelectionChange: ((selected: IBaseHalfAgentSelectionText | undefined) => void) | undefined,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.root = append(this.container, $('.basehalf-card-detail-source'));
		const root = this.root;
		this.editorHost = append(root, $('.basehalf-card-detail-source-editor'));
		this.saving = this._register(this.instantiationService.createInstance(
			BaseHalfTextFileSaving,
			'source',
			() => this.editor?.getModel()?.uri,
			() => this.visible,
			status => this.setSaveStatus(status)
		));
		this.setSaveStatus('saving');

		this._register(addDisposableListener(root, EventType.KEY_DOWN, event => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				event.stopPropagation();
				void this.save();
			}
		}));
		this.registerLayoutObserver();
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.resourceKey = state.resource.toString();
		this.setSaveStatus('saving');

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
			if (/\.(?:md|markdown)$/i.test(state.resource.path)) {
				// A copy of a note's text names the note, so that Rich in another note rebases its links (files in notes, rule 35).
				const note = state.resource.toString();
				const nameNote = (event: ClipboardEvent) => event.clipboardData?.setData(BASEHALF_NOTE_COPY_SOURCE, note);
				this._register(addDisposableListener(this.editorHost, 'copy', nameNote, true));
				this._register(addDisposableListener(this.editorHost, 'cut', nameNote, true));
			}
			this._register(editor.onDidChangeModelContent(() => this.saving.updateStatus()));
			// Read once the selection settles: a drag over a long note changes it
			// with every move.
			const reportSelection = this._register(new RunOnceScheduler(() => {
				const model = editor.getModel();
				const selection = editor.getSelection();
				if (!model || !selection || selection.isEmpty()) {
					this.onSelectionChange?.(undefined);
					return;
				}
				// The record keeps at most the limit; one more character says it was cut.
				const start = selection.getStartPosition();
				const limitedEnd = model.modifyPosition(start, Math.min(BASEHALF_AGENT_SELECTION_TEXT_LIMIT + 1, model.getOffsetAt(selection.getEndPosition()) - model.getOffsetAt(start)));
				const text = model.getValueInRange({ startLineNumber: selection.startLineNumber, startColumn: selection.startColumn, endLineNumber: limitedEnd.lineNumber, endColumn: limitedEnd.column });
				// A selection that ends at the start of a line does not hold that line.
				const lastLine = selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber ? selection.endLineNumber - 1 : selection.endLineNumber;
				this.onSelectionChange?.(text.trim().length > 0 ? { path: state.relativePath, text, firstLine: selection.startLineNumber, lastLine } : undefined);
			}, 30));
			this._register(editor.onDidChangeCursorSelection(() => reportSelection.schedule()));
			this.saving.registerFlushers(this.resourceKey);
			this.applySelection(state.selection, ScrollType.Immediate);
			this.saving.updateStatus();
			// open() resolves at the first meaningful frame: wait for the
			// layout pass so a projection swap held on this promise never
			// reveals an unmeasured, unpainted editor.
			await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => {
				this.layout();
				resolve();
			}));
		} catch (error) {
			if (this.disposed) {
				return;
			}
			this.renderError(error);
		}
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}

	/**
	 * Re-entry hook for a retained (hidden) surface becoming the visible
	 * projection again: adopt the latest navigation state, re-measure, and
	 * re-apply the navigation selection.
	 */
	activate(state: IBaseHalfCardDetailState): void {
		this.layout();
		this.applySelection(state.selection, ScrollType.Immediate);
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		// Monaco tracks its text model natively and stays cheap while the
		// layer is hidden; nothing to suspend.
	}

	focus(): void {
		this.editor?.focus();
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
	}

	async save(): Promise<void> {
		await this.saving.save();
	}

	private setSaveStatus(status: 'saving' | 'saved' | 'error'): void {
		this.onSaveStatusChange(status);
	}

	private renderError(error: unknown): void {
		this.editorHost.remove();

		if (error instanceof TooLargeFileOperationError) {
			this.renderNotice('The file is too large to open here.');
			this.setSaveStatus('saved');
			return;
		}

		if (TextFileOperationError.isTextFileOperationError(error) && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			this.renderNotice('The file is not displayed here because it is either binary or uses an unsupported text encoding.');
			this.setSaveStatus('saved');
			return;
		}

		this.logService.error('[BaseHalf] source card detail failed to open', error);
		this.renderNotice(`Unable to open the file. ${toErrorMessage(error)}`);
		this.setSaveStatus('saved');
	}

	private renderNotice(message: string): void {
		const notice = append(this.root, $('.basehalf-card-detail-source-notice'));
		notice.textContent = message;
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
}
