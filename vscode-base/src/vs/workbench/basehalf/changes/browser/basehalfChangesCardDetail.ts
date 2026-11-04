/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfChanges.css';
import { $, addDisposableListener, append, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { isEqual } from '../../../../base/common/resources.js';
import { deepClone } from '../../../../base/common/objects.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { DiffEditorWidget } from '../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import { IDiffEditorOptions, IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { ScrollType } from '../../../../editor/common/editorCommon.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ITextEditorSelection, TextEditorSelectionRevealType, TextEditorSelectionSource } from '../../../../platform/editor/common/editor.js';
import { TooLargeFileOperationError } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { emptyProgressRunner, IEditorProgressService, IProgressRunner } from '../../../../platform/progress/common/progress.js';
import { applyTextEditorOptions } from '../../../common/editor/editorOptions.js';
import { TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';
import { BASEHALF_AGENT_SELECTION_TEXT_LIMIT, IBaseHalfAgentSelectionText } from '../../agentArea/common/basehalfAgentSelection.js';
import { IBaseHalfCardDetailSurfaceInstance } from '../../cardDetail/browser/basehalfCardDetailSurface.js';
import { BaseHalfCardDetailSaveState, BaseHalfTextFileSaving } from '../../cardDetail/browser/basehalfTextFileSaving.js';
import { BASEHALF_NOTE_COPY_SOURCE } from '../../markdown/common/basehalfNoteFileLinks.js';
import { IBaseHalfCardDetailState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { setBaseHalfHover } from '../../shell/browser/basehalfHover.js';
import { BASEHALF_CHANGES_PROJECTION_ID, IBaseHalfFileChange, IBaseHalfFileChangesService } from '../common/basehalfFileChanges.js';

const RENDER_SIDE_BY_SIDE_SETTING = 'diffEditor.renderSideBySide';

/**
 * The Changes view of a text file in Card Detail (the changes of a file, rules 10
 * to 15): VS Code's diff, as the multi-file diff embeds it, over the file's text
 * model and its version in git.
 */
export class BaseHalfChangesCardDetail extends Disposable implements IBaseHalfCardDetailSurfaceInstance {
	private readonly root: HTMLElement;
	private readonly editorHost: HTMLElement;
	private readonly actions: HTMLElement;
	private readonly inlineButton: HTMLButtonElement;
	private readonly saving: BaseHalfTextFileSaving;
	private readonly shownStore = this._register(new MutableDisposable<DisposableStore>());

	private editor: DiffEditorWidget | undefined;
	private state: IBaseHalfCardDetailState | undefined;
	private shown: IBaseHalfFileChange | undefined;
	/** A comparison being opened, so that a later one wins. */
	private showSeq = 0;
	private visible = false;
	private disposed = false;

	constructor(
		container: HTMLElement,
		private readonly onSaveStatusChange: (status: BaseHalfCardDetailSaveState) => void,
		private readonly onSelectionChange: (selected: IBaseHalfAgentSelectionText | undefined) => void,
		actionsSlot: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IBaseHalfFileChangesService private readonly changes: IBaseHalfFileChangesService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.root = append(container, $('.basehalf-card-detail-source'));
		this.editorHost = append(this.root, $('.basehalf-card-detail-source-editor'));
		this.saving = this._register(this.instantiationService.createInstance(
			BaseHalfTextFileSaving,
			BASEHALF_CHANGES_PROJECTION_ID,
			() => this.shown?.modified.scheme === Schemas.file ? this.shown.modified : undefined,
			() => this.visible,
			status => this.onSaveStatusChange(status)
		));

		// Previous Change, Next Change, and one column or two, while this view shows.
		this.actions = append(actionsSlot, $('.basehalf-card-detail-changes-actions'));
		this._register(toDisposable(() => this.actions.remove()));
		this.actions.hidden = true;
		this.actionButton('codicon-arrow-up', localize('basehalf.changes.previous', "Previous Change"), () => this.editor?.goToDiff('previous'));
		this.actionButton('codicon-arrow-down', localize('basehalf.changes.next', "Next Change"), () => this.editor?.goToDiff('next'));
		this.inlineButton = this.actionButton('codicon-diff-single', localize('basehalf.changes.inline', "Inline View"), () => {
			const sideBySide = this.configurationService.getValue<boolean>(RENDER_SIDE_BY_SIDE_SETTING) !== false;
			void this.configurationService.updateValue(RENDER_SIDE_BY_SIDE_SETTING, !sideBySide);
		});
		this.syncInlineButton();

		this._register(addDisposableListener(this.root, EventType.KEY_DOWN, event => {
			if (event.altKey && event.key === 'F5') {
				event.preventDefault();
				event.stopPropagation();
				this.editor?.goToDiff(event.shiftKey ? 'previous' : 'next');
			} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				event.stopPropagation();
				void this.saving.save();
			}
		}));
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('diffEditor') || event.affectsConfiguration('editor')) {
				this.syncInlineButton();
				this.editor?.updateOptions(this.editorOptions());
			}
		}));
		// What is staged or committed changed under the view, as when a block was staged.
		this._register(this.changes.onDidChange(() => this.followChange()));

		const resizeObserver = new ResizeObserver(() => this.layout());
		resizeObserver.observe(this.editorHost);
		this._register(toDisposable(() => resizeObserver.disconnect()));
	}

	readonly drawsInTransitions = true;

	private actionButton(icon: string, label: string, run: () => void): HTMLButtonElement {
		const button = append(this.actions, $<HTMLButtonElement>(`button.basehalf-card-detail-projection.codicon.${icon}`));
		button.type = 'button';
		button.setAttribute('aria-label', label);
		setBaseHalfHover(button, label);
		// Pressed with the pointer, it leaves the keyboard in the diff.
		this._register(addDisposableListener(button, 'mousedown', event => event.preventDefault()));
		this._register(addDisposableListener(button, 'click', run));
		return button;
	}

	private syncInlineButton(): void {
		const inline = this.configurationService.getValue<boolean>(RENDER_SIDE_BY_SIDE_SETTING) === false;
		this.inlineButton.classList.toggle('checked', inline);
		this.inlineButton.setAttribute('aria-pressed', String(inline));
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.state = state;
		const change = this.changes.changeOf(state.resource, state.changesGroup);
		if (!change) {
			this.renderNotice(localize('basehalf.changes.none', "This file has no changes to show."));
			return;
		}
		await this.show(change, state);
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => {
			this.layout();
			resolve();
		}));
	}

	activate(state: IBaseHalfCardDetailState): void {
		this.state = state;
		this.layout();
		this.followChange();
		this.applySelection(state.selection, ScrollType.Immediate);
	}

	update(state: IBaseHalfCardDetailState): void {
		this.state = state;
		this.followChange();
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		this.actions.hidden = !visible;
	}

	focus(): void {
		this.editor?.getModifiedEditor().focus();
	}

	applySelection(selection: ITextEditorSelection | undefined, scrollType: ScrollType = ScrollType.Smooth): void {
		const modified = this.editor?.getModifiedEditor();
		if (selection && modified?.hasModel()) {
			applyTextEditorOptions({
				selection,
				selectionRevealType: TextEditorSelectionRevealType.CenterIfOutsideViewport,
				selectionSource: TextEditorSelectionSource.NAVIGATION
			}, modified, scrollType);
		}
	}

	override dispose(): void {
		this.disposed = true;
		this.onSelectionChange(undefined);
		super.dispose();
	}

	/** A row of another group may have asked, or what is staged moved: the versions compared change. */
	private followChange(): void {
		const state = this.state;
		if (!state || !this.shown) {
			return;
		}
		const change = this.changes.changeOf(state.resource, state.changesGroup);
		if (change && (!isEqual(change.original, this.shown.original) || !isEqual(change.modified, this.shown.modified))) {
			void this.show(change, state);
		}
	}

	private async show(change: IBaseHalfFileChange, state: IBaseHalfCardDetailState): Promise<void> {
		const seq = ++this.showSeq;
		const store = new DisposableStore();
		let original;
		let modified;
		try {
			original = store.add(await this.textModelService.createModelReference(change.original));
			modified = store.add(await this.textModelService.createModelReference(change.modified));
		} catch (error) {
			store.dispose();
			if (!this.disposed && seq === this.showSeq) {
				this.renderOpenError(error, state);
			}
			return;
		}
		if (this.disposed || seq !== this.showSeq) {
			store.dispose();
			return;
		}

		const firstOpen = !this.editor;
		const editor = this.editor ??= this.createEditor(state);
		this.shown = change;
		editor.updateOptions({ ...this.editorOptions(), readOnly: this.isReadonly(modified.object) });
		editor.setModel({ original: original.object.textEditorModel, modified: modified.object.textEditorModel });
		this.shownStore.value = store;
		store.add(modified.object.textEditorModel.onDidChangeContent(() => this.saving.updateStatus()));
		if (firstOpen) {
			this.saving.registerFlushers(state.resource.toString());
			if (state.selection) {
				this.applySelection(state.selection, ScrollType.Immediate);
			} else {
				// The first change in sight, as VS Code's diff opens; its changes are computed after this.
				const reveal = store.add(new MutableDisposable());
				reveal.value = editor.onDidUpdateDiff(() => {
					reveal.clear();
					editor.revealFirstDiff();
				});
			}
		}
		this.saving.updateStatus();
	}

	private createEditor(state: IBaseHalfCardDetailState): DiffEditorWidget {
		// VS Code's editor panes give their editors this service; here nothing shows a progress bar.
		const scoped = this._register(this.instantiationService.createChild(new ServiceCollection([IEditorProgressService, new class implements IEditorProgressService {
			declare readonly _serviceBrand: undefined;
			show(): IProgressRunner {
				return emptyProgressRunner;
			}
			async showWhile(promise: Promise<unknown>): Promise<void> {
				await promise;
			}
		}])));
		const editor = this._register(scoped.createInstance(DiffEditorWidget, this.editorHost, this.editorOptions(), {}));
		if (/\.(?:md|markdown)$/i.test(state.resource.path)) {
			// A copy of a note's text names the note, so that Rich in another note rebases its links (files in notes, rule 35).
			const note = state.resource.toString();
			const nameNote = (event: ClipboardEvent) => event.clipboardData?.setData(BASEHALF_NOTE_COPY_SOURCE, note);
			this._register(addDisposableListener(this.editorHost, 'copy', nameNote, true));
			this._register(addDisposableListener(this.editorHost, 'cut', nameNote, true));
		}
		// Read once the selection settles: a drag over a long file changes it with every move.
		const reportSelection = this._register(new RunOnceScheduler(() => this.reportSelection(), 30));
		this._register(editor.getModifiedEditor().onDidChangeCursorSelection(() => reportSelection.schedule()));
		this._register(editor.getOriginalEditor().onDidChangeCursorSelection(() => reportSelection.schedule()));
		this._register(editor.getModifiedEditor().onDidFocusEditorText(() => reportSelection.schedule()));
		this._register(editor.getOriginalEditor().onDidFocusEditorText(() => reportSelection.schedule()));
		return editor;
	}

	/** What is selected on the side that has the keyboard (the selection agents can see). */
	private reportSelection(): void {
		const state = this.state;
		const editor = this.editor;
		if (!state || !editor) {
			return;
		}
		const left = editor.getOriginalEditor().hasTextFocus();
		const side: ICodeEditor = left ? editor.getOriginalEditor() : editor.getModifiedEditor();
		const model = side.getModel();
		const selection = side.getSelection();
		if (!model || !selection || selection.isEmpty()) {
			this.onSelectionChange(undefined);
			return;
		}
		// The record keeps at most the limit; one more character says it was cut.
		const start = selection.getStartPosition();
		const limitedEnd = model.modifyPosition(start, Math.min(BASEHALF_AGENT_SELECTION_TEXT_LIMIT + 1, model.getOffsetAt(selection.getEndPosition()) - model.getOffsetAt(start)));
		const text = model.getValueInRange({ startLineNumber: selection.startLineNumber, startColumn: selection.startColumn, endLineNumber: limitedEnd.lineNumber, endColumn: limitedEnd.column });
		// A selection that ends at the start of a line does not hold that line.
		const lastLine = selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber ? selection.endLineNumber - 1 : selection.endLineNumber;
		if (text.trim().length === 0) {
			this.onSelectionChange(undefined);
			return;
		}
		// Only the file itself has lines of the file now: anything else is an earlier version.
		const committed = left || model.uri.scheme !== Schemas.file;
		this.onSelectionChange({ path: state.relativePath, text, firstLine: selection.startLineNumber, lastLine, ...(committed ? { committed: true } : {}) });
	}

	/** The diff's own options, as VS Code's diff editor reads them from the settings. */
	private editorOptions(): IDiffEditorOptions & IEditorOptions {
		const resource = this.state?.resource;
		const editorSettings = this.textResourceConfigurationService.getValue<IEditorOptions>(resource, 'editor') ?? {};
		const settings = deepClone(this.textResourceConfigurationService.getValue<IDiffEditorOptions & { codeLens?: boolean; wordWrap?: 'off' | 'on' | 'inherit' }>(resource, 'diffEditor') ?? {});
		const options: IDiffEditorOptions = settings;
		// `diffEditor.codeLens` and `diffEditor.wordWrap` are named apart from those of `editor`, as in VS Code's diff editor.
		if (settings.codeLens !== undefined) {
			options.diffCodeLens = settings.codeLens;
			delete settings.codeLens;
		}
		if (settings.wordWrap !== undefined) {
			options.diffWordWrap = settings.wordWrap;
			delete settings.wordWrap;
		}
		return {
			...editorSettings,
			...options,
			automaticLayout: false,
			originalEditable: false,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			fixedOverflowWidgets: true
		};
	}

	private isReadonly(model: IResolvedTextEditorModel): boolean {
		return model.isReadonly() !== false;
	}

	private renderOpenError(error: unknown, state: IBaseHalfCardDetailState): void {
		if (TextFileOperationError.isTextFileOperationError(error) && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			// It is not a file this view can show: Card Detail goes to its usual view (rule 8).
			this.changes.markNotText(state.resource);
			return;
		}
		if (error instanceof TooLargeFileOperationError) {
			this.renderNotice(localize('basehalf.changes.tooLarge', "This file is too large to compare here."));
			return;
		}
		this.logService.error('[BaseHalf] the changes of a file could not be opened', error);
		this.renderNotice(localize('basehalf.changes.cannotOpen', "Unable to compare this file. {0}", toErrorMessage(error)));
	}

	private renderNotice(message: string): void {
		this.editorHost.remove();
		append(this.root, $('.basehalf-card-detail-source-notice')).textContent = message;
		this.onSaveStatusChange('saved');
	}

	private layout(): void {
		this.editor?.layout({ width: Math.max(0, this.editorHost.clientWidth), height: Math.max(0, this.editorHost.clientHeight) });
	}
}
