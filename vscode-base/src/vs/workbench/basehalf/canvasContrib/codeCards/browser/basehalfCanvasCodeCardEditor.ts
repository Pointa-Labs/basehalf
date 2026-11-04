/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { EditorExtensionsRegistry } from '../../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { ScrollType } from '../../../../../editor/common/editorCommon.js';
import { BracketMatchingController } from '../../../../../editor/contrib/bracketMatching/browser/bracketMatching.js';
import { ContextMenuController } from '../../../../../editor/contrib/contextmenu/browser/contextmenu.js';
import { CommonFindController } from '../../../../../editor/contrib/find/browser/findController.js';
import { MultiCursorSelectionController, SelectionHighlighter } from '../../../../../editor/contrib/multicursor/browser/multicursor.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { ResultKind } from '../../../../../platform/keybinding/common/keybindingResolver.js';
import { ITextEditorService } from '../../../../services/textfile/common/textEditorService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { MenuPreventer } from '../../../../contrib/codeEditor/browser/menuPreventer.js';
import { SelectionClipboardContributionID } from '../../../../contrib/codeEditor/browser/selectionClipboard.js';
import { BASEHALF_AGENT_SELECTION_TEXT_LIMIT, IBaseHalfAgentSelectionText } from '../../../agentArea/common/basehalfAgentSelection.js';
import { baseHalfEditorInstantiationService } from '../../../cardDetail/browser/basehalfEditorInstantiation.js';
import { BaseHalfTextFileSaving } from '../../../cardDetail/browser/basehalfTextFileSaving.js';
import { baseHalfShownTextEditors } from '../../../cardDetail/common/basehalfShownTextEditor.js';
import { BaseHalfCanvasCodeFace } from './basehalfCanvasCodeFace.js';
import { BASEHALF_CODE_FACE_BOTTOM_PADDING, BASEHALF_CODE_FACE_FONT_SIZE, BASEHALF_CODE_FACE_LINE_HEIGHT, BASEHALF_CODE_FACE_MARK_LANE, BASEHALF_CODE_FACE_TOP_PADDING } from '../common/basehalfCanvasCodeFaceLayout.js';

/** What Escape does in an editor without keeping the card's editor open: it ends the editing with text selected. */
const ESCAPE_THAT_ENDS_ANYWAY: ReadonlySet<string> = new Set(['cancelSelection']);

/**
 * VS Code's editor on a code card (code cards, "Editing on the card"): the same text model as
 * Source, laid out as the face is, so that no line moves when it comes and when it goes.
 */
export class BaseHalfCanvasCodeCardEditor extends Disposable {
	private readonly host: HTMLElement;
	private readonly saving: BaseHalfTextFileSaving;
	private readonly selectionSettled = this._register(new RunOnceScheduler(() => this.reportSelection(), 30));
	private editor: CodeEditorWidget | undefined;
	private ended: Promise<void> | undefined;

	constructor(
		readonly face: BaseHalfCanvasCodeFace,
		private readonly options: {
			readonly reportSelection: (selected: IBaseHalfAgentSelectionText | undefined) => void;
			readonly onSaveState: (error: boolean) => void;
			/** It asks to end: Escape, or a press outside it. */
			readonly requestEnd: (keyboardToCanvas: boolean) => void;
		},
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ITextEditorService private readonly textEditorService: ITextEditorService,
		@ITextFileService private readonly textFileService: ITextFileService,
	) {
		super();
		// The canvas takes neither a drag, nor the wheel, nor a double click of what is edited (code cards, rule 22).
		this.host = append(face.container, $('.basehalf-canvas-code-editor.nodrag.nopan.nowheel'));
		this._register(toDisposable(() => this.host.remove()));
		for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu']) {
			this._register(addDisposableListener(this.host, type, event => event.stopPropagation()));
		}
		this.saving = this._register(this.instantiationService.createInstance(
			BaseHalfTextFileSaving,
			'source',
			() => this.editor?.getModel()?.uri,
			() => true,
			status => options.onSaveState(status === 'error')
		));
		this._register(addDisposableListener(this.host, 'keydown', event => {
			if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				event.stopPropagation();
				void this.saving.save();
			} else if (event.key === 'Escape' && !this.escapeIsTheEditors(event)) {
				event.preventDefault();
				event.stopPropagation();
				options.requestEnd(true);
			}
		}));
		this._register(addDisposableListener(face.container.ownerDocument, 'pointerdown', event => {
			const target = event.target;
			// What the editor shows outside itself, as its menus, is its own.
			if (target instanceof Node && !this.host.contains(target) && !(target instanceof Element && target.closest('.context-view, .monaco-menu-container, .quick-input-widget'))) {
				options.requestEnd(false);
			}
		}, true));
		const resizeObserver = new ResizeObserver(() => this.layout());
		resizeObserver.observe(this.host);
		this._register(toDisposable(() => resizeObserver.disconnect()));
	}

	/** Comes over the face. `point` is where the card was pressed, in the window's coordinates. */
	async open(point: { readonly clientX: number; readonly clientY: number } | undefined): Promise<boolean> {
		const model = await this.face.ensureModel();
		if (!model || this._store.isDisposed) {
			return false;
		}
		const scoped = this._register(baseHalfEditorInstantiationService(this.instantiationService));
		const editor = this.editor = this._register(scoped.createInstance(CodeEditorWidget, this.host, this.editorOptions(), {
			isSimpleWidget: false,
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				MenuPreventer.ID,
				SelectionClipboardContributionID,
				ContextMenuController.ID,
				CommonFindController.ID,
				BracketMatchingController.ID,
				SelectionHighlighter.ID,
				MultiCursorSelectionController.ID
			]),
			telemetryData: { target: 'basehalf.canvas.codeCard' }
		}));
		editor.setModel(model);
		this.layout();
		editor.setScrollTop(this.face.scrollTop, ScrollType.Immediate);
		editor.setScrollLeft(this.face.scrollLeft, ScrollType.Immediate);
		editor.render(true);
		const target = point && editor.getTargetAtClientPoint(point.clientX, point.clientY);
		if (target?.position) {
			editor.setPosition(target.position);
			// A press beyond the view's lines puts the caret there without moving them.
			editor.setScrollTop(this.face.scrollTop, ScrollType.Immediate);
		} else {
			const visible = editor.getVisibleRanges()[0];
			if (visible) {
				editor.setPosition({ lineNumber: visible.startLineNumber, column: 1 });
				editor.setScrollTop(this.face.scrollTop, ScrollType.Immediate);
			}
		}
		// The editor is drawn in this task: the face goes in the frame the editor comes in.
		this.face.container.classList.add('editing');
		editor.focus();
		baseHalfShownTextEditors.set(this, { control: editor });
		// The status bar reads and changes the language and the encoding through this, once it is resolved.
		const input = this._register(this.textEditorService.createTextEditor({ resource: this.face.resource }));
		void input.resolve().then(() => {
			if (!this._store.isDisposed && !this.ended) {
				baseHalfShownTextEditors.set(this, { control: editor, input });
			}
		}, () => undefined);
		this.saving.registerFlushers(this.face.resource.toString());
		this._register(editor.onDidChangeModelContent(() => this.saving.updateStatus()));
		this._register(editor.onDidChangeCursorSelection(() => this.selectionSettled.schedule()));
		return true;
	}

	/** Writes what was typed, leaves the place on the face, and goes. What could not be written stays in the text model, marked on the card. */
	end(): Promise<void> {
		this.ended ??= (async () => {
			this.options.reportSelection(undefined);
			baseHalfShownTextEditors.clear(this);
			const written = await this.saving.save();
			this.options.onSaveState(!written);
			const editor = this.editor;
			if (editor && !this.face.isDisposed) {
				this.face.standAt(editor.getScrollTop(), editor.getScrollLeft());
			}
			this.face.container.classList.remove('editing');
			this.dispose();
		})();
		return this.ended;
	}

	private editorOptions(): IEditorOptions {
		return {
			automaticLayout: false,
			readOnly: !!this.textFileService.files.get(this.face.resource)?.isReadonly(),
			fontFamily: this.face.host.fontFamily,
			fontSize: BASEHALF_CODE_FACE_FONT_SIZE,
			lineHeight: BASEHALF_CODE_FACE_LINE_HEIGHT,
			padding: { top: BASEHALF_CODE_FACE_TOP_PADDING, bottom: BASEHALF_CODE_FACE_BOTTOM_PADDING },
			lineNumbers: 'on',
			lineNumbersMinChars: 3,
			lineDecorationsWidth: BASEHALF_CODE_FACE_MARK_LANE,
			glyphMargin: false,
			folding: false,
			minimap: { enabled: false },
			stickyScroll: { enabled: false },
			wordWrap: 'off',
			scrollBeyondLastLine: false,
			scrollbar: {
				verticalScrollbarSize: 8,
				horizontalScrollbarSize: 8,
				useShadows: false,
				ignoreHorizontalScrollbarInContentHeight: true,
				alwaysConsumeMouseWheel: true
			},
			overviewRulerLanes: 0,
			overviewRulerBorder: false,
			hideCursorInOverviewRuler: true,
			renderLineHighlight: 'none',
			guides: { indentation: false, bracketPairs: false },
			bracketPairColorization: { enabled: false },
			occurrencesHighlight: 'off',
			dragAndDrop: false,
			// Its widgets scale with the card, and its menus stand over the window, not inside the card.
			fixedOverflowWidgets: false,
			useShadowDOM: false,
			fontLigatures: false,
			renderValidationDecorations: 'off',
			ariaLabel: this.face.path
		};
	}

	private layout(): void {
		this.editor?.layout({ width: this.host.clientWidth, height: this.host.clientHeight });
	}

	/** Whether Escape has something to do in the editor before the editing ends, as with its Find. */
	private escapeIsTheEditors(event: KeyboardEvent): boolean {
		const result = this.keybindingService.softDispatch(new StandardKeyboardEvent(event), event.target as HTMLElement);
		return result.kind === ResultKind.KbFound && !!result.commandId && !ESCAPE_THAT_ENDS_ANYWAY.has(result.commandId);
	}

	/** What is selected reaches agents as a selection in Source does (code cards, rule 23). */
	private reportSelection(): void {
		const editor = this.editor;
		const model = editor?.getModel();
		const selection = editor?.getSelection();
		if (!model || !selection || selection.isEmpty()) {
			this.options.reportSelection(undefined);
			return;
		}
		// The record keeps at most the limit; one more character says it was cut.
		const start = selection.getStartPosition();
		const limitedEnd = model.modifyPosition(start, Math.min(BASEHALF_AGENT_SELECTION_TEXT_LIMIT + 1, model.getOffsetAt(selection.getEndPosition()) - model.getOffsetAt(start)));
		const text = model.getValueInRange({ startLineNumber: selection.startLineNumber, startColumn: selection.startColumn, endLineNumber: limitedEnd.lineNumber, endColumn: limitedEnd.column });
		const lastLine = selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber ? selection.endLineNumber - 1 : selection.endLineNumber;
		this.options.reportSelection(text.trim().length > 0 ? { path: this.face.path, text, firstLine: selection.startLineNumber, lastLine } : undefined);
	}
}
