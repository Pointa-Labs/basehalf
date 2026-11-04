/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasCodeCards.css';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Limiter, raceTimeout, RunOnceScheduler } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IReference, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { IQuickDiffModelService } from '../../../../contrib/scm/browser/quickDiffModel.js';
import { IBaseHalfCanvasCodeCards, IBaseHalfCanvasCodeFace, IBaseHalfCanvasCodeFaceContext, IBaseHalfCanvasContribution, IBaseHalfCanvasContributionContext, IBaseHalfCanvasView, registerBaseHalfCanvasContribution } from '../../../canvas/browser/basehalfCanvasExtensions.js';
import { BaseHalfCanvasCardPreview, IBaseHalfCanvasCodePreview } from '../../../canvas/common/basehalfCanvasCardPreview.js';
import { IBaseHalfCanvasItem } from '../../../canvas/common/basehalfCanvasModel.js';
import { IBaseHalfFilePlace, IBaseHalfFilePlacesService } from '../../../cardDetail/common/basehalfFilePlaces.js';
import { IBaseHalfFileChangesService } from '../../../changes/common/basehalfFileChanges.js';
import { IBaseHalfActiveCanvasEditor, IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfCanvasCodeCardEditor } from './basehalfCanvasCodeCardEditor.js';
import { BaseHalfCanvasCodeFace, IBaseHalfCanvasCodeFaceHost } from './basehalfCanvasCodeFace.js';
import { BASEHALF_CODE_CARD_LARGEST_FILE_BYTES, BASEHALF_CODE_FACE_NO_MARKS, baseHalfCodeFaceMarks } from '../common/basehalfCanvasCodeFaceLayout.js';

/** Text models that faces hold at most: a canvas can show hundreds of files (code cards, "Limits"). */
const MOST_MODELS_HELD = 24;
/** Whether a code card is being edited where it stands. */
const BaseHalfCodeCardEditingContext = new RawContextKey<boolean>('basehalfCodeCardEditing', false);

/** What Source Control knows comes in bursts. */
const CHANGES_SETTLE_MS = 100;
/** Files whose marks are worked out at once: each reads its earlier version from git, and a canvas can show many (code cards, rule 12). */
const MARKS_ASKED_AT_ONCE = 4;
/** How long a file's first marks are waited for before the next file's turn: a file git says nothing about has none to give. */
const MARKS_COME_WITHIN_MS = 3_000;

/**
 * Code cards: what they draw at rest, their text models and marks, and editing on the card
 * (a code file on its card and in Card Detail). The canvas draws a code card through this.
 */
export class BaseHalfCanvasCodeCards extends Disposable implements IBaseHalfCanvasContribution, IBaseHalfCanvasCodeCards, IBaseHalfCanvasCodeFaceHost {
	static readonly ID = 'basehalf.canvas.codeCards';

	private readonly canvas: IBaseHalfCanvasView;
	private readonly faces = new Set<BaseHalfCanvasCodeFace>();
	private readonly facesByPath = new Map<string, BaseHalfCanvasCodeFace>();
	/** Faces that hold a model, used last at the end. */
	private readonly holdingModels: BaseHalfCanvasCodeFace[] = [];
	private readonly markStores = new Map<BaseHalfCanvasCodeFace, DisposableStore>();
	/** Faces that lost their model to the limit: their marks stay as they were until they are used again (code cards, "Limits"). */
	private readonly marksAtRest = new Set<BaseHalfCanvasCodeFace>();
	private readonly marksAsked = this._register(new Limiter<void>(MARKS_ASKED_AT_ONCE));
	private readonly changesSettled = this._register(new RunOnceScheduler(() => this.followChanges(), CHANGES_SETTLE_MS));

	private static current: BaseHalfCanvasCodeCards | undefined;
	/** Command-W ends the editing on a card, as it closes Card Detail: with no editor open it would close the window. */
	static endEditing(): void {
		void BaseHalfCanvasCodeCards.current?.finish(true);
	}

	private readonly editingKey: IContextKey<boolean>;
	private editing: { readonly path: string; readonly editor: BaseHalfCanvasCodeCardEditor; readonly inNavigation: IBaseHalfActiveCanvasEditor | undefined } | undefined;
	private finishing: Promise<void> | undefined;
	/** The last card asked to be edited: one that had to wait gives way to it. */
	private editAsked = 0;
	private measuredFont: { readonly family: string; readonly digitWidth: number } | undefined;
	private selectedPaths: readonly string[] = [];

	constructor(
		context: IBaseHalfCanvasContributionContext,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IQuickDiffModelService private readonly quickDiffModelService: IQuickDiffModelService,
		@IBaseHalfFilePlacesService private readonly places: IBaseHalfFilePlacesService,
		@IBaseHalfFileChangesService private readonly changes: IBaseHalfFileChangesService,
		@IBaseHalfCanvasNavigationService private readonly navigation: IBaseHalfCanvasNavigationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this.canvas = context.canvas;
		BaseHalfCanvasCodeCards.current = this;
		this._register(toDisposable(() => {
			if (BaseHalfCanvasCodeCards.current === this) {
				BaseHalfCanvasCodeCards.current = undefined;
			}
		}));
		this.editingKey = BaseHalfCodeCardEditingContext.bindTo(contextKeyService);
		this._register(this.canvas.takeCodeCards(this));
		this._register(this.changes.onDidChange(() => this.changesSettled.schedule()));
		this._register(this.canvas.onDidChangeScene(() => {
			if (this.editing && !this.canvas.getItem(this.editing.path)) {
				void this.finish(false);
			}
		}));
		this._register(this.navigation.onDidChangeState(state => {
			if (state.cardDetail) {
				void this.finish(false);
			}
		}));
		this._register(lifecycleService.onBeforeShutdown(event => event.veto(this.finish(false).then(() => false), 'veto.basehalfCodeCardEditor')));
		this._register(this.canvas.onDidChangeSelection(selection => {
			this.selectedPaths = selection.paths;
		}));
		// Enter edits the selected code card from its place, wherever on the card the keyboard is (code cards, rule 18).
		this._register(this.canvas.onKeyDown(event => this.onCanvasKey(event)));
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('editor.fontFamily')) {
				this.measuredFont = undefined;
				for (const face of this.faces) {
					face.fontChanged();
				}
				this.editing?.editor.fontChanged();
			}
		}));
		this._register(toDisposable(() => {
			void this.finish(false);
			for (const store of this.markStores.values()) {
				store.dispose();
			}
			this.markStores.clear();
		}));
	}

	// The face's host.

	get fontFamily(): string {
		return this.font(mainWindow.document.body).family;
	}

	get digitWidth(): number {
		return this.font(mainWindow.document.body).digitWidth;
	}

	private font(reference: HTMLElement): { readonly family: string; readonly digitWidth: number } {
		if (!this.measuredFont) {
			const family = this.configurationService.getValue<string>('editor.fontFamily') || 'monospace';
			this.measuredFont = { family, digitWidth: BaseHalfCanvasCodeFace.measureDigitWidth(reference, family) };
		}
		return this.measuredFont;
	}

	async acquireModel(resource: URI): Promise<IReference<IResolvedTextEditorModel> | undefined> {
		try {
			return await this.textModelService.createModelReference(resource);
		} catch {
			// A file that turns out not to be text, or that cannot be read: its card keeps what it read of it.
			return undefined;
		}
	}

	didUseModel(face: BaseHalfCanvasCodeFace): void {
		const index = this.holdingModels.indexOf(face);
		if (index >= 0) {
			this.holdingModels.splice(index, 1);
		}
		this.holdingModels.push(face);
		while (this.holdingModels.length > MOST_MODELS_HELD) {
			const oldest = this.holdingModels.shift();
			if (oldest && oldest !== this.editing?.editor.face) {
				this.letMarksGo(oldest);
				oldest.letModelGo();
				this.marksAtRest.add(oldest);
			}
		}
		if (this.marksAtRest.delete(face)) {
			this.followChangesOf(face);
		}
	}

	headLines(preview: IBaseHalfCanvasCodePreview, count: number) {
		return this.canvas.codePreviewLines(preview, count);
	}

	placeOf(resource: URI): IBaseHalfFilePlace | undefined {
		return this.places.placeOf(resource);
	}

	setPlace(resource: URI, line: number, from: object): void {
		this.places.setPlace(resource, { top: line }, from);
	}

	onDidChangePlace(resource: URI, listener: () => void, from: object) {
		return this.places.onDidChange(event => {
			if (event.from !== from && event.resource.toString() === resource.toString()) {
				listener();
			}
		});
	}

	// What the canvas asks.

	drawFace(context: IBaseHalfCanvasCodeFaceContext): IBaseHalfCanvasCodeFace {
		const { item, preview } = context;
		const face = new BaseHalfCanvasCodeFace(context.container, item.path, item.stat.resource, item.stat.size, preview, this);
		context.listeners.add(face);
		this.faces.add(face);
		this.facesByPath.set(item.path, face);
		context.listeners.add(toDisposable(() => {
			this.faces.delete(face);
			if (this.facesByPath.get(item.path) === face) {
				this.facesByPath.delete(item.path);
			}
			const index = this.holdingModels.indexOf(face);
			if (index >= 0) {
				this.holdingModels.splice(index, 1);
			}
			this.marksAtRest.delete(face);
			this.letMarksGo(face);
		}));
		this.followChangesOf(face);
		return face;
	}

	editsOnCard(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined): boolean {
		// A file that was just written is being read again, and its card keeps its face meanwhile.
		const code = preview?.kind === 'code' || (preview?.kind === 'loading' && this.facesByPath.has(item.path));
		return code && (item.stat.size ?? 0) <= BASEHALF_CODE_CARD_LARGEST_FILE_BYTES;
	}

	isEditing(path: string): boolean {
		return this.editing?.path === path;
	}

	async edit(path: string, point?: { readonly clientX: number; readonly clientY: number }): Promise<void> {
		if (this.editing?.path === path) {
			return;
		}
		const asked = ++this.editAsked;
		await this.finish(false);
		// One editor stands on a canvas at a time, as a note's, which writes its text first and stays when it cannot.
		if (!await this.navigation.flushActiveEditor() || asked !== this.editAsked) {
			return;
		}
		const face = this.facesByPath.get(path);
		if (!face) {
			return;
		}
		const editor = this.instantiationService.createInstance(BaseHalfCanvasCodeCardEditor, face, {
			reportSelection: selected => this.canvas.setCardSelectedText(selected),
			onSaveState: error => this.canvas.setCardSaveError(path, error),
			requestEnd: keyboardToCanvas => void this.finish(keyboardToCanvas)
		});
		// Whatever leaves the canvas waits for this one to write its text and leave its place.
		const folder = this.canvas.getFolder();
		const inNavigation: IBaseHalfActiveCanvasEditor | undefined = folder && {
			resource: face.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: path,
			supportsCanvasProjectionHandoff: false,
			prepareToClose: () => this.finish(false).then(() => true)
		};
		const editing = this.editing = { path, editor, inNavigation };
		this.navigation.setActiveCanvasEditor(inNavigation);
		this.editingKey.set(true);
		const opened = await editor.open(point);
		// The editing ended while the file was being read, as by a press elsewhere.
		if (this.editing !== editing) {
			return;
		}
		if (!opened) {
			// The file cannot be held as text here: Card Detail says why.
			await this.finish(false);
			await this.canvas.openCard(path);
		}
	}

	private finish(keyboardToCanvas: boolean): Promise<void> {
		const editing = this.editing;
		if (!editing) {
			return this.finishing ?? Promise.resolve();
		}
		this.editing = undefined;
		this.editingKey.set(false);
		const finishing: Promise<void> = this.endEditing(editing, keyboardToCanvas).finally(() => {
			if (this.finishing === finishing) {
				this.finishing = undefined;
			}
		});
		this.finishing = finishing;
		return finishing;
	}

	private async endEditing(editing: NonNullable<BaseHalfCanvasCodeCards['editing']>, keyboardToCanvas: boolean): Promise<void> {
		await editing.editor.end();
		if (editing.inNavigation && this.navigation.activeCanvasEditor === editing.inNavigation) {
			this.navigation.setActiveCanvasEditor(undefined);
		}
		if (keyboardToCanvas) {
			// On the card itself, where its keys work.
			editing.editor.face.container.closest<HTMLElement>('.basehalf-canvas-card')?.focus({ preventScroll: true });
		}
		if (!this._store.isDisposed) {
			this.canvas.requestRender();
		}
	}

	private onCanvasKey(event: KeyboardEvent): void {
		const target = event.target;
		// Card Detail stands over the canvas, and its keys are its own.
		if (event.key !== 'Enter' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || this.selectedPaths.length !== 1
			|| this.navigation.state.cardDetail
			|| !(target instanceof Element) || target.closest('input, textarea, button, [contenteditable="true"], .monaco-editor')) {
			return;
		}
		const path = this.selectedPaths[0];
		const item = this.canvas.getItem(path);
		if (item && this.editsOnCard(item, this.canvas.getCardPreview(path))) {
			event.preventDefault();
			event.stopPropagation();
			void this.edit(path);
		}
	}

	// Marks.

	private followChanges(): void {
		for (const face of this.faces) {
			this.followChangesOf(face);
		}
	}

	private followChangesOf(face: BaseHalfCanvasCodeFace): void {
		const changed = this.changes.isChanged(face.resource);
		if (!changed) {
			this.marksAtRest.delete(face);
			this.letMarksGo(face);
			face.setMarks(BASEHALF_CODE_FACE_NO_MARKS);
			return;
		}
		if (this.markStores.has(face) || this.marksAtRest.has(face) || !face.canHoldModel) {
			return;
		}
		const store = new DisposableStore();
		this.markStores.set(face, store);
		void this.marksAsked.queue(async () => {
			if (this.markStores.get(face) !== store || !await face.ensureModel() || this.markStores.get(face) !== store) {
				return;
			}
			const reference = this.quickDiffModelService.createQuickDiffModelReference(face.resource);
			if (!reference) {
				return;
			}
			store.add(reference);
			const draw = () => face.setMarks(baseHalfCodeFaceMarks(reference.object.changes.map(change => change.change)));
			store.add(reference.object.onDidChange(draw));
			draw();
			// The turn ends when its marks are there, which is what a face must have before the limit takes its model.
			if (reference.object.changes.length === 0) {
				await raceTimeout(Event.toPromise(reference.object.onDidChange, store), MARKS_COME_WITHIN_MS);
			}
		});
	}

	private letMarksGo(face: BaseHalfCanvasCodeFace): void {
		this.markStores.get(face)?.dispose();
		this.markStores.delete(face);
	}
}

registerBaseHalfCanvasContribution(BaseHalfCanvasCodeCards.ID, BaseHalfCanvasCodeCards);

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'basehalf.codeCards.endEditing',
	weight: KeybindingWeight.WorkbenchContrib + 50,
	primary: KeyMod.CtrlCmd | KeyCode.KeyW,
	win: { primary: KeyMod.CtrlCmd | KeyCode.F4, secondary: [KeyMod.CtrlCmd | KeyCode.KeyW] },
	when: ContextKeyExpr.has('basehalfCodeCardEditing'),
	handler: () => BaseHalfCanvasCodeCards.endEditing()
});
