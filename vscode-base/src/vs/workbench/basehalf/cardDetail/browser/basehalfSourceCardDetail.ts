/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCardDetailProjections.css';
import { $, append, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { deepClone } from '../../../../base/common/objects.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { ScrollType } from '../../../../editor/common/editorCommon.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ResultKind } from '../../../../platform/keybinding/common/keybindingResolver.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { TooLargeFileOperationError } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextEditorSelection, TextEditorSelectionRevealType, TextEditorSelectionSource } from '../../../../platform/editor/common/editor.js';
import { applyTextEditorOptions } from '../../../common/editor/editorOptions.js';
import { ITextEditorService } from '../../../services/textfile/common/textEditorService.js';
import { ITextFileService, TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';
import { IBaseHalfCardDetailState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_AGENT_SELECTION_TEXT_LIMIT, IBaseHalfAgentSelectionText } from '../../agentArea/common/basehalfAgentSelection.js';
import { BASEHALF_NOTE_COPY_SOURCE } from '../../markdown/common/basehalfNoteFileLinks.js';
import { IBaseHalfFilePlacesService } from '../common/basehalfFilePlaces.js';
import { baseHalfEditorInstantiationService } from './basehalfEditorInstantiation.js';
import { baseHalfShownTextEditors, IBaseHalfShownTextEditor } from '../common/basehalfShownTextEditor.js';
import { BaseHalfTextFileSaving } from './basehalfTextFileSaving.js';

/** What Escape does in an editor without keeping Card Detail open: it closes from these, also with text selected. */
const ESCAPE_THAT_CLOSES_ANYWAY: ReadonlySet<string> = new Set(['cancelSelection', 'removeSecondaryCursors']);

export class BaseHalfSourceCardDetail extends Disposable {
	private readonly root: HTMLElement;
	private readonly editorHost: HTMLElement;

	private editor: CodeEditorWidget | undefined;
	private resourceKey: string | undefined;
	private readonly saving: BaseHalfTextFileSaving;
	private visible = false;
	private disposed = false;
	private shownEditor: IBaseHalfShownTextEditor | undefined;
	private goingToPlace = false;
	private state: IBaseHalfCardDetailState | undefined;
	constructor(
		private readonly container: HTMLElement,
		private readonly onSaveStatusChange: (status: 'saving' | 'saved' | 'error') => void,
		/** The text the user selected, or `undefined` once nothing is (the selection agents can see). */
		private readonly onSelectionChange: ((selected: IBaseHalfAgentSelectionText | undefined) => void) | undefined,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ILogService private readonly logService: ILogService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@ITextEditorService private readonly textEditorService: ITextEditorService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IBaseHalfFilePlacesService private readonly places: IBaseHalfFilePlacesService
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
			} else if (event.key === 'Escape' && this.escapeIsTheEditors(event)) {
				// A key that is prevented does not close Card Detail, and VS Code's keybinding still gets it.
				event.preventDefault();
			}
		}));
		this._register(this.textResourceConfigurationService.onDidChangeConfiguration(event => {
			const resource = this.state?.resource;
			if (resource && event.affectsConfiguration(resource, 'editor')) {
				this.editor?.updateOptions(this.editorOptions(resource));
			}
		}));
		this.registerLayoutObserver();
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.resourceKey = state.resource.toString();
		this.state = state;
		this.setSaveStatus('saving');

		try {
			const modelReference = await this.textModelService.createModelReference(state.resource);
			if (this.disposed || this.resourceKey !== state.resource.toString()) {
				modelReference.dispose();
				return;
			}
			this._register(modelReference);

			this._register(this.textFileService.files.onDidChangeReadonly(model => {
				if (model.resource.toString() === state.resource.toString()) {
					this.editor?.updateOptions({ readOnly: !!model.isReadonly() });
				}
			}));
			// VS Code's editor with all its features, as a text file's tab has it (code cards, rule 25).
			const scoped = this._register(baseHalfEditorInstantiationService(this.instantiationService));
			const editor = this._register(scoped.createInstance(CodeEditorWidget, this.editorHost, this.editorOptions(state.resource), {
				telemetryData: { target: 'basehalf.cardDetail.source' }
			}));
			this.editor = editor;
			editor.setModel(modelReference.object.textEditorModel);
			this.shownEditor = { control: editor };
			this.syncShownEditor();
			// The status bar reads and changes the language and the encoding through this, once it is resolved.
			const input = this._register(this.textEditorService.createTextEditor({ resource: state.resource }));
			void input.resolve().then(() => {
				if (!this.disposed) {
					this.shownEditor = { control: editor, input };
					this.syncShownEditor();
				}
			}, () => undefined);
			// What the view does by itself to come to the place moves nothing.
			this._register(editor.onDidScrollChange(event => {
				if (event.scrollTopChanged && !this.goingToPlace) {
					this.reportPlace();
				}
			}));
			this._register(editor.onDidChangeCursorPosition(event => {
				if (event.source !== 'api' && event.source !== 'modelChange') {
					this.reportPlace();
				}
			}));
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
			this.saving.updateStatus();
			// open() resolves at the first meaningful frame: wait for the
			// layout pass so a projection swap held on this promise never
			// reveals an unmeasured, unpainted editor.
			await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => {
				this.layout();
				// The editor is measured now, and a line's place in it can be read.
				if (state.selection && !state.keepsPlace) {
					this.applySelection(state.selection, ScrollType.Immediate);
				} else {
					this.goToPlace();
				}
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
		baseHalfShownTextEditors.clear(this);
		super.dispose();
	}

	/** The options of a text file's tab: the settings for the file and its language, and what VS Code's text editor sets over them. */
	private editorOptions(resource: URI): IEditorOptions {
		return {
			...deepClone(this.textResourceConfigurationService.getValue<IEditorOptions>(resource, 'editor')),
			readOnly: !!this.textFileService.files.get(resource)?.isReadonly(),
			automaticLayout: false,
			overviewRulerLanes: 3,
			lineNumbersMinChars: 3,
			fixedOverflowWidgets: true,
			renderValidationDecorations: 'on'
		};
	}

	private syncShownEditor(): void {
		if (this.visible && this.shownEditor) {
			baseHalfShownTextEditors.set(this, this.shownEditor);
		} else {
			baseHalfShownTextEditors.clear(this);
		}
	}

	/** Whether Escape has something to do in the editor before it closes Card Detail, as with its Find or a list (opening and closing Card Detail). */
	private escapeIsTheEditors(event: KeyboardEvent): boolean {
		const result = this.keybindingService.softDispatch(new StandardKeyboardEvent(event), event.target as HTMLElement);
		return result.kind === ResultKind.KbFound && !!result.commandId && !ESCAPE_THAT_CLOSES_ANYWAY.has(result.commandId);
	}

	/** The line the view stands at, for the file's card and its other views (code cards, "The place"). */
	private reportPlace(): void {
		const resource = this.state?.resource;
		const visible = this.editor?.getVisibleRanges()[0];
		if (this.visible && resource && visible) {
			// What is read here is the line of the caret when it is in view, or the middle of the view.
			const caret = this.editor?.getPosition()?.lineNumber;
			const focus = caret !== undefined && caret >= visible.startLineNumber && caret <= visible.endLineNumber ? caret : Math.round((visible.startLineNumber + visible.endLineNumber) / 2);
			this.places.setPlace(resource, { top: visible.startLineNumber, focus }, this);
		}
	}

	/**
	 * Re-entry hook for a retained (hidden) surface becoming the visible
	 * projection again: adopt the latest navigation state, re-measure, and
	 * re-apply the navigation selection.
	 */
	activate(state: IBaseHalfCardDetailState): void {
		this.state = state;
		this.layout();
		if (state.selection && !state.keepsPlace) {
			this.applySelection(state.selection, ScrollType.Immediate);
		} else {
			this.goToPlace();
		}
	}

	/** Comes to the file's place: another view of the file, or its card, moved it (code cards, rules 14 and 15). */
	private goToPlace(): void {
		const resource = this.state?.resource;
		if (resource && this.editor) {
			const line = this.places.placeOf(resource)?.top ?? 1;
			this.goingToPlace = true;
			this.editor.setScrollTop(line <= 1 ? 0 : this.editor.getTopForLineNumber(line), ScrollType.Immediate);
			this.goingToPlace = false;
		}
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		this.syncShownEditor();
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
