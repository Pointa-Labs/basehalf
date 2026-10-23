/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoNode.css';
import { $, addDisposableListener, append, clearNode, getWindow, isHTMLButtonElement, isHTMLElement, isHTMLInputElement } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { RunOnceScheduler, TimeoutTimer } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { basename, dirname, isEqual, joinPath } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import { BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, IBaseHalfCanvasSceneVideoPanelLayout } from '../../canvas/common/basehalfCanvasScene.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfUserFacingErrorMessage } from '../../shell/common/basehalfPlainFailureReason.js';
import { BaseHalfReferenceEditFailure, BaseHalfReferenceEditRefusal, IBaseHalfReferenceEditResult, IBaseHalfReferenceEditService } from '../../references/common/basehalfReferenceEdit.js';
import {
	BASEHALF_VIDEO_IMAGE_FORMATS,
	BaseHalfVideoImageFormat,
	BaseHalfVideoModeId,
	BaseHalfVideoParamValue,
	baseHalfModelFileExtension,
	baseHalfVideoChangeParam,
	baseHalfVideoChooseMode,
	baseHalfVideoChooseModel,
	findBaseHalfVideoModel,
	IBaseHalfVideoCatalogModel,
	IBaseHalfVideoCheckRequest,
	IBaseHalfVideoCheckResult,
	IBaseHalfVideoGenerationChoice,
	IBaseHalfVideoInputPlanItem,
	IBaseHalfVideoModelRef
} from '../common/basehalfVideoCatalog.js';
import {
	BaseHalfVideoGenerationError,
	IBaseHalfDraftOperations,
	IBaseHalfGenerationCardSnapshot,
	IBaseHalfGenerationCardStore,
	IBaseHalfVideoCatalogService,
	IBaseHalfVideoGenerationService,
	IBaseHalfVideoProviderSettingsService,
	IBaseHalfVideoResolvedInput
} from '../common/basehalfVideoGeneration.js';
import {
	BASEHALF_GENERATION_PROMPT_MAX_LENGTH,
	baseHalfGenerationChoice,
	baseHalfGenerationExtensionMatchesFormat,
	baseHalfGenerationNameOrdinal,
	baseHalfGenerationNameParts,
	IBaseHalfGenerationInfo,
	setBaseHalfGenerationChoice,
	setBaseHalfGenerationPrompt
} from '../common/basehalfGenerationInfo.js';
import { baseHalfUpstreamSidecarResource } from '../../references/common/basehalfReferenceStore.js';
import {
	BaseHalfVideoPanelControl,
	baseHalfVideoPanelMentionQuery,
	baseHalfVideoPanelPromptMarks,
	createBaseHalfVideoPanelPresentation,
	filterBaseHalfVideoPanelNames,
	IBaseHalfVideoPanelAuto,
	IBaseHalfVideoPanelChoice,
	IBaseHalfVideoPanelInputItem,
	IBaseHalfVideoPanelName,
	IBaseHalfVideoPanelPresentation
} from '../common/basehalfVideoNodePanelPresentation.js';
import { readBaseHalfVideoTextInput } from './basehalfVideoGenerationService.js';
import {
	BASEHALF_VIDEO_PANEL_MAX_HEIGHT,
	BASEHALF_VIDEO_PANEL_MIN_HEIGHT,
	IBaseHalfVideoPanelRect,
	resolveBaseHalfVideoPanelMenuPlacement
} from '../common/basehalfVideoNodePanelPlacement.js';

/**
 * What the panel needs from the canvas. The workbench implements it.
 */
export interface IBaseHalfVideoNodePanelHost {
	/**
	 * Lets the user click a card on the canvas and resolves with its
	 * workspace-relative path, or with `undefined` when they press Escape. The
	 * panel connects the card as an input.
	 */
	pickCard(): Promise<string | undefined>;
	/**
	 * Asks the user for a file, copies it into the card's folder, and resolves
	 * with the copy's workspace-relative path, or with `undefined` when they
	 * chose none. The panel connects it as an input.
	 */
	importFile(): Promise<string | undefined>;
	/** Moves the focus to the card: Escape with no menu open. */
	focusCard(): void;
	/**
	 * Generate ran on another card: a card with its file makes a new draft
	 * beside it and generates there. The workbench selects that card.
	 */
	didGenerateInNode?(resource: URI): void;
	/**
	 * The draft was renamed, as a model of another image format renames it
	 * (generation cards, "Creating a generation card"). The workbench shows the
	 * panel of the card at its new name.
	 */
	didRenameCard?(resource: URI): void;
}

export interface IBaseHalfVideoNodePanelOptions {
	/** The card as the workbench already read it, so the panel shows at once. */
	readonly snapshot?: IBaseHalfGenerationCardSnapshot;
	/** Focus the prompt when the panel first shows: the card was just created. */
	readonly focusPromptWhenShown?: boolean;
	/** How long after typing stops the prompt is saved. */
	readonly saveDelay?: number;
	/** How long after a change the panel asks for the problems. */
	readonly checkDelay?: number;
}

/** How long after typing stops the prompt is saved. */
export const BASEHALF_VIDEO_PANEL_PROMPT_SAVE_DELAY = 500;
/** How long after the model, mode, values, prompt, or inputs change the panel asks for the problems. */
export const BASEHALF_VIDEO_PANEL_CHECK_DELAY = 250;

const PANEL_PADDING = 12;
const SECTION_GAP = 8;
const INPUT_ROW_HEIGHT = 40;
const FOOTER_HEIGHT = 32;
/** The reason line: one line beside its action, or two lines of text. */
const REASON_MIN_HEIGHT = 20;
const REASON_MAX_HEIGHT = 32;
const PROMPT_LINE_HEIGHT = 20;
const PROMPT_PADDING = 4;
const PROMPT_MIN_LINES = 3;
const PROMPT_MAX_LINES = 5;
const MENU_WIDTHS = { add: 200, model: 300, settings: 300, mention: 240 } as const;
const HOVER_GROUP = 'basehalf-video-panel';

type BaseHalfVideoPanelMenuKind = keyof typeof MENU_WIDTHS;

interface IOpenMenu {
	readonly kind: BaseHalfVideoPanelMenuKind;
	readonly element: HTMLElement;
	/** Where the focus goes back when the menu closes. */
	readonly trigger: HTMLElement;
	readonly store: DisposableStore;
	/** What the menu's current items hold; cleared each time they are drawn again. */
	readonly content: DisposableStore;
	/** The control the menu opened from, for placing it. */
	readonly anchor: () => DOMRect | undefined;
	readonly align: 'start' | 'end';
	/** A click opened it, not a key: it has no current item until an arrow key chooses one. */
	readonly byPointer: boolean;
	/** What the items show, so they are drawn again only when it changes. */
	contentKey?: string;
}

/** A check the panel asks with the files a generation would send. */
interface IPendingCheck {
	readonly request: Omit<IBaseHalfVideoCheckRequest, 'inputs'>;
	readonly plan: readonly IBaseHalfVideoInputPlanItem[];
	readonly inputs: readonly IBaseHalfVideoResolvedInput[];
	readonly imageFormats: readonly BaseHalfVideoImageFormat[];
}

/**
 * The panel under a selected generation card (D63, D64, generation cards,
 * "The panel"): the card's inputs, its prompt, and a footer with the model of
 * the card's kind, the settings, and Generate, all drawn from the model
 * catalog. It reads and writes the card's generation information through the
 * card store, edits its connections through the reference edit service, and
 * generates and stops through the generation service. It keeps its element
 * and its prompt for as long as it lives: updates never replace the prompt
 * while the user types in it, so the text, the selection, and an input method
 * keep their state.
 *
 * The workbench creates one panel for the only selected generation card,
 * gives the scene its {@link element} and {@link height}, calls {@link flush}
 * when the card is deselected, and disposes it.
 */
export class BaseHalfVideoNodePanel extends Disposable {

	readonly element: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<number>());
	/** Fires when the panel's height changes; the workbench publishes the scene surface again. */
	readonly onDidChangeHeight: Event<number> = this._onDidChangeHeight.event;

	private readonly inputRowElement: HTMLElement;
	/** The inputs of the row, which scroll sideways when they do not fit; the plus follows them. */
	private inputList: HTMLElement | undefined;
	private readonly promptBox: HTMLElement;
	private readonly overlay: HTMLElement;
	private readonly measure: HTMLElement;
	private readonly textarea: HTMLTextAreaElement;
	private readonly promptState: HTMLElement;
	private readonly notice: HTMLElement;
	private readonly reason: HTMLElement;
	private readonly reasonText: HTMLElement;
	private readonly reasonAction: HTMLButtonElement;
	private readonly modelButton: HTMLButtonElement;
	private readonly modelLabel: HTMLElement;
	private readonly settingsButton: HTMLButtonElement;
	private readonly settingsLabel: HTMLElement;
	private readonly generateButton: HTMLButtonElement;
	private readonly generateIcon: HTMLElement;
	private readonly layer: HTMLElement;

	private readonly rowStore = this._register(new DisposableStore());
	private readonly menu = this._register(new MutableDisposable<DisposableStore>());
	private readonly saveTimer = this._register(new TimeoutTimer());
	private saveScheduled = false;
	private openMenu: IOpenMenu | undefined;

	private snapshot: IBaseHalfGenerationCardSnapshot | undefined;
	private inputs: readonly IBaseHalfVideoResolvedInput[] = [];
	/** The text of the text inputs, for the prompt that `check` sees. */
	private texts: ReadonlyMap<string, string> = new Map();
	/** What the panel asked `check` last, and the last answer for the node's model in its region. */
	private checkKey: string | undefined;
	private pendingCheck: IPendingCheck | undefined;
	/** Counts changes to the inputs' files, so that `check` measures them again. */
	private inputFilesVersion = 0;
	private lastCheck: { readonly model: string; readonly result: IBaseHalfVideoCheckResult } | undefined;
	private readonly checkScheduler: RunOnceScheduler;
	/** Whether the settings show the advanced parameters. */
	private moreOpen = false;
	/** A text value typed into the settings and not saved yet. */
	private pendingText: { readonly name: string; readonly value: string } | undefined;
	private optimistic: IBaseHalfGenerationInfo | undefined;
	private optimisticWrites = 0;
	private presentation: IBaseHalfVideoPanelPresentation | undefined;
	private readError: string | undefined;
	private refreshSequence = 0;
	private readonly refreshScheduler = this._register(new RunOnceScheduler(() => { void this.refresh(); }, 0));
	private writeQueue: Promise<unknown> = Promise.resolve();
	private savedPrompt: string | undefined;
	private promptDirty = false;
	private composing = false;
	private promptBeforeComposition = '';
	private notSaved: string | undefined;
	private promptLines = PROMPT_MIN_LINES;
	private currentHeight: number;
	private layout: IBaseHalfCanvasSceneVideoPanelLayout | undefined;
	private focusWhenShown: boolean;
	private starting = false;
	/** What the Generate button was drawn as last: Generate or Stop. */
	private generateKind: 'generate' | 'stop' | undefined;
	private picking = false;
	private mention: { readonly start: number; readonly query: string; readonly active: number } | undefined;
	/** The control of the input row that takes the row's one tab stop. */
	private rowFocusKey: string | undefined;
	/** What the input row shows, so it is drawn again only when that changes (thumbnails keep loaded). */
	private renderedRowKey: string | undefined;
	/** The panel's width when the prompt was last measured. */
	private measuredWidth: number | undefined;
	private readonly mentionId = `basehalf-video-panel-mention-${generateUuid()}`;
	private readonly saveDelay: number;
	private disposed = false;

	constructor(
		private readonly resource: URI,
		private readonly host: IBaseHalfVideoNodePanelHost,
		options: IBaseHalfVideoNodePanelOptions | undefined,
		@IBaseHalfGenerationCardStore private readonly store: IBaseHalfGenerationCardStore,
		@IBaseHalfDraftOperations private readonly draftOperations: IBaseHalfDraftOperations,
		@IBaseHalfVideoCatalogService private readonly catalogService: IBaseHalfVideoCatalogService,
		@IBaseHalfVideoProviderSettingsService private readonly providerSettings: IBaseHalfVideoProviderSettingsService,
		@IBaseHalfVideoGenerationService private readonly generationService: IBaseHalfVideoGenerationService,
		@IBaseHalfReferenceEditService private readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IHoverService private readonly hoverService: IHoverService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.saveDelay = options?.saveDelay ?? BASEHALF_VIDEO_PANEL_PROMPT_SAVE_DELAY;
		this.focusWhenShown = options?.focusPromptWhenShown === true;
		this.checkScheduler = this._register(new RunOnceScheduler(() => { void this.runCheck(); }, options?.checkDelay ?? BASEHALF_VIDEO_PANEL_CHECK_DELAY));
		// A catalog that could not be loaded is asked for again when a panel opens.
		this.catalogService.load();

		this.element = $('.bh-video-panel');
		this.element.setAttribute('role', 'group');
		this.element.dataset.state = 'loading';

		this.inputRowElement = append(this.element, $('.bh-video-panel-inputs'));
		this.inputRowElement.setAttribute('role', 'group');
		this.inputRowElement.setAttribute('aria-label', localize('basehalf.video.panel.inputs', "Inputs"));

		this.promptBox = append(this.element, $('.bh-video-panel-prompt'));
		this.overlay = append(this.promptBox, $('.bh-video-panel-prompt-overlay'));
		this.overlay.setAttribute('aria-hidden', 'true');
		this.measure = append(this.promptBox, $('.bh-video-panel-prompt-measure'));
		this.measure.setAttribute('aria-hidden', 'true');
		this.textarea = append(this.promptBox, $<HTMLTextAreaElement>('textarea.bh-video-panel-prompt-input'));
		this.textarea.rows = PROMPT_MIN_LINES;
		this.textarea.maxLength = BASEHALF_GENERATION_PROMPT_MAX_LENGTH;
		this.textarea.spellcheck = false;
		this.textarea.placeholder = placeholderOf(options?.snapshot?.kind ?? 'video');
		this.textarea.setAttribute('aria-label', localize('basehalf.video.panel.prompt', "Prompt"));
		this.textarea.setAttribute('aria-keyshortcuts', isMacintosh ? 'Meta+Enter' : 'Control+Enter');
		this.promptState = append(this.promptBox, $('.bh-video-panel-prompt-state'));
		this.promptState.append(renderCodicon(Codicon.warning));
		this.promptState.hidden = true;
		this._register(this.hoverService.setupDelayedHover(this.promptState, () => ({ content: this.notSaved ?? '' }), { groupId: HOVER_GROUP }));

		this.notice = append(this.element, $('.bh-video-panel-notice'));
		this.notice.hidden = true;

		// Why Generate cannot run, with the action that fixes it.
		this.reason = append(this.element, $('.bh-video-panel-reason'));
		this.reason.hidden = true;
		this.reason.append(renderCodicon(Codicon.warning, 'bh-video-panel-reason-icon'));
		this.reasonText = append(this.reason, $('span.bh-video-panel-reason-text'));
		this.reasonText.setAttribute('role', 'status');
		this.reasonAction = append(this.reason, $<HTMLButtonElement>('button.bh-video-panel-reason-action'));
		this.reasonAction.type = 'button';
		this.reasonAction.hidden = true;
		// The whole reason when two lines cut it.
		this._register(this.hoverService.setupDelayedHover(this.reasonText, () => ({ content: this.reasonText.scrollHeight > this.reasonText.clientHeight + 1 ? this.presentation?.reason?.text ?? '' : '' }), { groupId: HOVER_GROUP }));

		const footer = append(this.element, $('.bh-video-panel-footer'));
		this.modelButton = append(footer, $<HTMLButtonElement>('button.bh-video-panel-model'));
		this.modelButton.type = 'button';
		this.modelButton.setAttribute('aria-haspopup', 'menu');
		this.modelButton.setAttribute('aria-expanded', 'false');
		this.modelLabel = append(this.modelButton, $('span.bh-video-panel-model-label'));
		this.modelButton.append(renderCodicon(Codicon.chevronDown, 'bh-video-panel-chevron'));
		this.settingsButton = append(footer, $<HTMLButtonElement>('button.bh-video-panel-settings'));
		this.settingsButton.type = 'button';
		this.settingsButton.setAttribute('aria-haspopup', 'dialog');
		this.settingsButton.setAttribute('aria-expanded', 'false');
		this.settingsLabel = append(this.settingsButton, $('span.bh-video-panel-settings-label'));
		append(footer, $('.bh-video-panel-footer-space'));
		this.generateButton = append(footer, $<HTMLButtonElement>('button.bh-video-panel-generate'));
		this.generateButton.type = 'button';
		this.generateButton.setAttribute('aria-keyshortcuts', isMacintosh ? 'Meta+Enter' : 'Control+Enter');
		this.generateIcon = append(this.generateButton, renderCodicon(Codicon.arrowUp));
		this._register(this.hoverService.setupDelayedHover(this.modelButton, () => ({ content: this.presentation?.model.title ?? '' }), { groupId: HOVER_GROUP }));
		this._register(this.hoverService.setupDelayedHover(this.settingsButton, () => ({ content: this.settingsTitle() }), { groupId: HOVER_GROUP }));
		this._register(this.hoverService.setupDelayedHover(this.generateButton, () => ({ content: this.generateTitle() }), { groupId: HOVER_GROUP }));

		this.layer = append(this.element, $('.bh-video-panel-layer'));

		this.currentHeight = this.computeHeight(true);
		this.element.style.height = `${this.currentHeight}px`;

		this.registerListeners();
		if (options?.snapshot && isEqual(options.snapshot.resource, resource)) {
			this.applySnapshot(options.snapshot, undefined);
		}
		void this.refresh();
	}

	/** The panel's height in screen pixels, from 132 without an input row to 260 with one and a reason line of two lines. */
	get height(): number {
		return this.currentHeight;
	}

	/**
	 * Saves the prompt now and waits for every write the panel started. The
	 * workbench calls it when the card is deselected and before it generates.
	 * While an input method composes, the text from before the composition is
	 * saved and the composition itself is not.
	 */
	async flush(): Promise<void> {
		if (this.promptDirty || this.saveScheduled) {
			await this.savePrompt();
		}
		this.saveTextParam();
		await this.writeQueue.catch(() => undefined);
	}

	/** Moves the focus into the prompt, with the caret at the end. */
	focus(): void {
		this.textarea.focus({ preventScroll: true });
		const end = this.textarea.value.length;
		this.textarea.setSelectionRange(end, end);
	}

	/** Reads the card, its inputs, and the text of its text inputs again. */
	async refresh(): Promise<void> {
		const sequence = ++this.refreshSequence;
		try {
			const snapshot = await this.store.read(this.resource);
			const inputs = await this.store.resolveInputs(snapshot);
			const texts = await this.readTexts(inputs);
			if (this.disposed || sequence !== this.refreshSequence) {
				return;
			}
			this.texts = texts;
			this.applySnapshot(snapshot, inputs);
		} catch (error) {
			if (this.disposed || sequence !== this.refreshSequence) {
				return;
			}
			this.logService.warn('[BaseHalf] the panel could not read its card', error);
			this.readError = baseHalfUserFacingErrorMessage(error);
			this.render();
		}
	}

	/** What Generate does: generates when the card can, and stops a generation that runs. */
	async generate(): Promise<void> {
		const presentation = this.presentation;
		if (!presentation || this.starting || this.disposed) {
			return;
		}
		if (presentation.generate.kind === 'stop') {
			await this.stop();
			return;
		}
		if (!presentation.generate.enabled) {
			return;
		}
		this.starting = true;
		this.render();
		try {
			await this.flush();
			const [first] = await this.generationService.generate(this.resource);
			if (first && !isEqual(first, this.resource)) {
				this.host.didGenerateInNode?.(first);
			}
		} catch (error) {
			this.notificationService.notify({ severity: Severity.Warning, message: baseHalfUserFacingErrorMessage(error) });
		} finally {
			this.starting = false;
			if (!this.disposed) {
				this.render();
				this.scheduleRefresh();
			}
		}
	}

	override dispose(): void {
		this.saveTextParam();
		this.disposed = true;
		this.closeMenu(false);
		super.dispose();
	}

	//#region Reading and writing

	private applySnapshot(snapshot: IBaseHalfGenerationCardSnapshot, inputs: readonly IBaseHalfVideoResolvedInput[] | undefined): void {
		const firstRead = !this.snapshot;
		this.snapshot = snapshot;
		this.readError = undefined;
		if (inputs) {
			this.inputs = inputs;
		}
		this.textarea.placeholder = placeholderOf(snapshot.kind);
		const prompt = snapshot.info.prompt;
		if (firstRead) {
			this.savedPrompt = prompt;
		}
		// While the field has the focus it keeps what is in it; at rest it shows the prompt of the file.
		if (!this.promptDirty && !this.composing && this.textarea.value !== prompt && (firstRead || !this.promptFocused())) {
			this.replacePromptText(prompt);
		}
		if (!this.promptDirty && !this.composing) {
			this.savedPrompt = prompt;
		}
		this.textarea.readOnly = false;
		this.render();
		if (firstRead && this.focusWhenShown && this.layout?.visible) {
			this.focusWhenShown = false;
			this.focus();
		}
	}

	private scheduleRefresh(): void {
		if (!this.disposed && !this.refreshScheduler.isScheduled()) {
			this.refreshScheduler.schedule();
		}
	}

	/** The generation information the panel shows: the file's, or what a write on its way makes of it. */
	private info(): IBaseHalfGenerationInfo {
		return this.optimistic ?? this.snapshot?.info ?? EMPTY_INFO;
	}

	/** Writes the card's generation information through the store, one write after the other. */
	private write(mutate: (info: IBaseHalfGenerationInfo) => IBaseHalfGenerationInfo): Promise<IBaseHalfGenerationCardSnapshot> {
		const run = () => this.store.update(this.resource, mutate);
		const written = this.writeQueue.then(run, run);
		this.writeQueue = written.catch(() => undefined);
		return written;
	}

	/** Changes the settings or the model: shown at once, saved right after. */
	private async writeSettings(mutate: (info: IBaseHalfGenerationInfo) => IBaseHalfGenerationInfo): Promise<void> {
		this.optimistic = mutate(this.info());
		this.optimisticWrites++;
		this.render();
		try {
			const snapshot = await this.write(mutate);
			if (!this.disposed) {
				this.snapshot = snapshot;
				this.setNotSaved(undefined);
			}
		} catch (error) {
			this.logService.warn('[BaseHalf] the panel could not save the settings', error);
			this.setNotSaved(localize('basehalf.video.panel.settingsNotSaved', "The settings could not be saved: {0}", baseHalfUserFacingErrorMessage(error)));
		} finally {
			if (--this.optimisticWrites === 0) {
				this.optimistic = undefined;
			}
			if (!this.disposed) {
				this.render();
			}
		}
	}

	private schedulePromptSave(): void {
		this.saveScheduled = true;
		this.saveTimer.cancelAndSet(() => { void this.savePrompt(); }, this.saveDelay);
	}

	private cancelPromptSave(): void {
		this.saveScheduled = false;
		this.saveTimer.cancel();
	}

	private async savePrompt(): Promise<void> {
		this.cancelPromptSave();
		if (!this.snapshot) {
			return;
		}
		const value = this.composing ? this.promptBeforeComposition : this.textarea.value;
		if (value === this.savedPrompt) {
			if (!this.composing && this.textarea.value === value) {
				this.promptDirty = false;
			}
			return;
		}
		try {
			const snapshot = await this.write(info => setBaseHalfGenerationPrompt(info, value));
			if (this.disposed) {
				return;
			}
			this.snapshot = snapshot;
			this.savedPrompt = value;
			if (!this.composing && this.textarea.value === value) {
				this.promptDirty = false;
			}
			this.setNotSaved(undefined);
		} catch (error) {
			// Never a dialog: the text stays in the panel and is saved again with the next change.
			this.logService.warn('[BaseHalf] the panel could not save the prompt', error);
			if (!this.disposed) {
				this.setNotSaved(localize('basehalf.video.panel.promptNotSaved', "The prompt is not saved yet: {0} It stays here and is saved with your next change.", baseHalfUserFacingErrorMessage(error)));
			}
		}
	}

	private setNotSaved(message: string | undefined): void {
		this.notSaved = message;
		this.promptState.hidden = message === undefined;
		if (message === undefined) {
			this.promptState.removeAttribute('aria-label');
		} else {
			this.promptState.setAttribute('aria-label', message);
		}
	}

	//#endregion

	//#region Listeners

	private registerListeners(): void {
		this._register(this.store.onDidChange(resource => {
			if (isEqual(resource, this.resource)) {
				this.scheduleRefresh();
			}
		}));
		this._register(this.fileService.onDidFilesChange(event => {
			const inputFiles = this.inputs.some(input => input.file && event.affects(input.file));
			if (inputFiles) {
				// The files that `check` measures changed: it is asked again.
				this.inputFilesVersion++;
			}
			const upstream = this.upstreamResource();
			if (event.affects(this.resource) || inputFiles || (upstream && event.affects(upstream)) || this.snapshot?.upstream.some(entry => event.affects(this.entryResource(entry)))) {
				this.scheduleRefresh();
			}
		}));
		this._register(this.catalogService.onDidChange(() => {
			// The values of the settings are read by the types the catalog declares.
			this.render();
			this.scheduleRefresh();
		}));
		this._register(this.providerSettings.onDidChange(() => this.render()));
		this._register(this.generationService.onDidChangeProgress(resource => {
			if (isEqual(resource, this.resource)) {
				this.render();
			}
		}));
		this._register(addDisposableListener(this.element, BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, (event: CustomEvent<IBaseHalfCanvasSceneVideoPanelLayout | undefined>) => {
			// The scene dispatches the event from the panel's own window, which may be another one.
			if (event.detail) {
				this.didLayout(event.detail);
			}
		}));

		this._register(addDisposableListener(this.textarea, 'input', () => this.didEditPrompt()));
		this._register(addDisposableListener(this.textarea, 'compositionstart', () => {
			this.composing = true;
			this.cancelPromptSave();
			// What was typed before the composition; the composition is not saved until it ends.
			this.promptBeforeComposition = this.promptDirty ? this.textarea.value : (this.savedPrompt ?? this.textarea.value);
		}));
		this._register(addDisposableListener(this.textarea, 'compositionend', () => {
			this.composing = false;
			this.didEditPrompt();
		}));
		this._register(addDisposableListener(this.textarea, 'blur', () => {
			if (this.promptDirty) {
				void this.savePrompt();
			} else if (!this.composing && this.snapshot && this.textarea.value !== this.snapshot.info.prompt) {
				// The prompt changed underneath while the field had the focus: at rest the field shows it.
				this.replacePromptText(this.snapshot.info.prompt);
				this.render();
			}
		}));
		this._register(addDisposableListener(this.textarea, 'scroll', () => this.syncOverlayScroll()));
		this._register(addDisposableListener(this.textarea, 'keydown', event => this.onPromptKeyDown(event)));
		this._register(addDisposableListener(this.textarea, 'click', () => this.updateMention()));
		this._register(addDisposableListener(this.textarea, 'keyup', event => {
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
				this.updateMention();
			}
		}));

		this._register(addDisposableListener(this.modelButton, 'click', event => this.toggleMenu('model', this.modelButton, clickedByPointer(event))));
		this._register(addDisposableListener(this.settingsButton, 'click', event => this.toggleMenu('settings', this.settingsButton, clickedByPointer(event))));
		this._register(addDisposableListener(this.generateButton, 'click', () => { void this.generate(); }));
		this._register(addDisposableListener(this.reasonAction, 'click', () => {
			const action = this.presentation?.reason?.action;
			if (action) {
				void this.providerSettings.openSettings(action.provider).catch(error => this.logService.error(error));
			}
		}));
		this._register(addDisposableListener(this.element, 'keydown', event => this.onPanelKeyDown(event)));
		this._register(addDisposableListener(this.inputRowElement, 'keydown', event => this.onRowKeyDown(event)));
		this._register(addDisposableListener(this.inputRowElement, 'focusin', event => {
			const target = event.target;
			if (isHTMLButtonElement(target) && target.dataset.key) {
				this.rowFocusKey = target.dataset.key;
				this.updateRowTabStop();
			}
		}));
		this._register(addDisposableListener(this.inputRowElement, 'wheel', event => {
			// A vertical wheel scrolls the inputs sideways.
			const list = this.inputList;
			if (list && Math.abs(event.deltaY) > Math.abs(event.deltaX) && list.scrollWidth > list.clientWidth) {
				list.scrollLeft += event.deltaY;
				event.preventDefault();
			}
		}, { passive: false }));
	}

	private didLayout(layout: IBaseHalfCanvasSceneVideoPanelLayout): void {
		this.layout = layout;
		this.element.dataset.placement = layout.placement;
		if (!layout.visible || layout.following) {
			this.closeMenu(false);
		} else if (this.openMenu) {
			this.placeMenu(this.openMenu);
		}
		if (!layout.visible && this.promptDirty) {
			void this.savePrompt();
		}
		if (layout.visible && !layout.following && this.focusWhenShown && this.snapshot) {
			this.focusWhenShown = false;
			this.focus();
		}
		// The scene reports a layout at every frame of a pan; the text wraps
		// differently only when the panel's width changes.
		if (layout.width !== this.measuredWidth) {
			this.measuredWidth = layout.width;
			this.updatePromptLines();
			this.updateInputOverflow();
		}
	}

	private didEditPrompt(): void {
		if (this.composing) {
			this.renderOverlay();
			return;
		}
		this.promptDirty = this.textarea.value !== this.savedPrompt;
		if (this.promptDirty) {
			this.schedulePromptSave();
		} else {
			this.cancelPromptSave();
		}
		this.render();
		this.updateMention();
	}

	private onPromptKeyDown(event: KeyboardEvent): void {
		if (event.isComposing || event.keyCode === 229) {
			return;
		}
		const mention = this.mention;
		if (mention && this.openMenu?.kind === 'mention') {
			const names = this.mentionNames();
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				event.stopPropagation();
				if (names.length) {
					const step = event.key === 'ArrowDown' ? 1 : -1;
					this.mention = { ...mention, active: (mention.active + step + names.length) % names.length };
					this.renderMentionMenu();
				}
				return;
			}
			if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.metaKey && !event.ctrlKey && names.length) {
				event.preventDefault();
				event.stopPropagation();
				this.insertName(names[Math.min(mention.active, names.length - 1)]);
				return;
			}
			if (event.key === 'Home' || event.key === 'End') {
				if (names.length) {
					event.preventDefault();
					event.stopPropagation();
					this.mention = { ...mention, active: event.key === 'Home' ? 0 : names.length - 1 };
					this.renderMentionMenu();
				}
				return;
			}
		}
		if (event.key === 'Enter' && (isMacintosh ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey) {
			event.preventDefault();
			event.stopPropagation();
			void this.generate();
		}
	}

	private onPanelKeyDown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) {
			return;
		}
		if (this.picking) {
			// The canvas's pick owns Escape: it cancels the pick.
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (this.openMenu) {
			this.closeMenu(true);
			return;
		}
		this.host.focusCard();
	}

	//#endregion

	//#region Rendering

	private render(): void {
		if (this.disposed) {
			return;
		}
		const snapshot = this.snapshot;
		if (!snapshot) {
			this.element.dataset.state = this.readError ? 'unreadable' : 'loading';
			this.textarea.readOnly = true;
			this.renderNotice();
			this.updateHeight();
			return;
		}
		const info = this.info();
		const catalog = this.catalogService.state;
		const modelKey = this.checkModelKey(info);
		this.presentation = createBaseHalfVideoPanelPresentation({
			info,
			kind: snapshot.kind,
			inputs: this.inputs,
			texts: this.texts,
			catalog,
			setup: provider => this.providerSettings.getStatus(provider),
			...(this.lastCheck && this.lastCheck.model === modelKey ? { check: this.lastCheck.result } : {}),
			generating: this.generationService.isGenerating(this.resource),
			prompt: this.textarea.value
		});
		this.scheduleCheck(this.presentation);
		this.element.dataset.state = 'ready';
		this.element.dataset.catalog = catalog.kind;
		this.element.dataset.kind = snapshot.kind;
		const name = basename(this.resource);
		this.element.setAttribute('aria-label', snapshot.kind === 'image'
			? localize('basehalf.video.panel.imageLabel', "Image panel for {0}", name)
			: localize('basehalf.video.panel.label', "Video panel for {0}", name));
		this.renderNotice();
		this.renderInputRow();
		this.renderOverlay();
		this.renderReason();
		this.renderFooter();
		this.refreshMenu();
		this.updateHeight();
	}

	private renderNotice(): void {
		const unreadable = !this.snapshot && this.readError !== undefined;
		// A generation.yaml that is not YAML at all leaves the panel usable: a save keeps a copy of it first.
		const unreadableInfo = this.snapshot?.infoReadable === false;
		this.notice.hidden = !unreadable && !unreadableInfo;
		this.promptBox.hidden = unreadable;
		if (unreadable) {
			this.notice.textContent = localize('basehalf.video.panel.unreadable', "This card cannot be read: {0}", this.readError ?? '');
		} else if (unreadableInfo) {
			this.notice.textContent = localize('basehalf.video.panel.unreadableInfo', "BaseHalf could not read this card's prompt and settings.");
		}
	}

	private renderInputRow(): void {
		const presentation = this.presentation;
		const row = presentation?.inputRow;
		const key = JSON.stringify({
			row,
			files: this.inputs.map(input => input.file?.toString() ?? ''),
			picking: this.picking
		});
		if (key === this.renderedRowKey) {
			return;
		}
		this.renderedRowKey = key;
		const focusedKey = this.focusedKey(this.inputRowElement);
		this.rowStore.clear();
		clearNode(this.inputRowElement);
		this.inputList = undefined;
		this.inputRowElement.hidden = !row;
		if (!row || !presentation) {
			return;
		}
		this.inputRowElement.dataset.mode = row.mode;
		const list = append(this.inputRowElement, $('.bh-video-panel-inputs-list'));
		this.inputList = list;
		this.rowStore.add(addDisposableListener(list, 'scroll', () => this.updateInputOverflow()));
		row.slots.forEach((slot, index) => {
			if (index === 1) {
				const swap = append(list, $<HTMLButtonElement>('button.bh-video-panel-swap'));
				swap.type = 'button';
				swap.dataset.key = 'swap';
				swap.append(renderCodicon(Codicon.arrowSwap));
				const label = localize('basehalf.video.panel.swap', "Swap Start and End Frames");
				swap.setAttribute('aria-label', label);
				swap.disabled = !row.swappedUpstream;
				this.rowStore.add(this.hoverService.setupDelayedHover(swap, () => ({ content: label }), { groupId: HOVER_GROUP }));
				this.rowStore.add(addDisposableListener(swap, 'click', () => {
					const order = this.presentation?.inputRow?.swappedUpstream;
					if (order) {
						void this.reorder(order);
					}
				}));
			}
			if (slot.item) {
				this.renderInput(list, slot.item, slot.title);
				return;
			}
			const empty = append(list, $<HTMLButtonElement>('button.bh-video-panel-slot.empty'));
			empty.type = 'button';
			empty.dataset.key = `slot:${slot.role}`;
			empty.dataset.role = slot.role;
			empty.setAttribute('aria-label', slot.addLabel);
			empty.setAttribute('aria-haspopup', 'menu');
			empty.append(renderCodicon(Codicon.add));
			append(empty, $('span.bh-video-panel-slot-title')).textContent = slot.title;
			this.rowStore.add(this.hoverService.setupDelayedHover(empty, () => ({ content: slot.addLabel }), { groupId: HOVER_GROUP }));
			this.rowStore.add(addDisposableListener(empty, 'click', event => this.toggleMenu('add', empty, clickedByPointer(event))));
		});
		for (const item of row.items) {
			this.renderInput(list, item, undefined);
		}
		const add = append(this.inputRowElement, $<HTMLButtonElement>('button.bh-video-panel-add'));
		add.type = 'button';
		add.dataset.key = 'add';
		add.setAttribute('aria-haspopup', 'menu');
		add.setAttribute('aria-expanded', String(this.openMenu?.kind === 'add' && this.openMenu.trigger === add));
		const addLabel = addInputLabel();
		add.setAttribute('aria-label', addLabel);
		add.append(renderCodicon(Codicon.add));
		this.rowStore.add(this.hoverService.setupDelayedHover(add, () => ({ content: addLabel }), { groupId: HOVER_GROUP }));
		this.rowStore.add(addDisposableListener(add, 'click', event => this.toggleMenu('add', add, clickedByPointer(event))));
		const hint = this.picking
			? localize('basehalf.video.panel.picking', "Click a card to connect it. Escape cancels.")
			: row.emptyHint;
		if (hint) {
			const text = append(this.inputRowElement, $('span.bh-video-panel-inputs-hint'));
			text.textContent = hint;
			if (this.picking) {
				text.setAttribute('role', 'status');
			}
		}
		this.inputRowElement.classList.toggle('picking', this.picking);
		this.updateRowTabStop();
		this.restoreFocus(this.inputRowElement, focusedKey);
		this.updateInputOverflow();
	}

	/** Fades the edge of the inputs where more of them are scrolled out of sight. */
	private updateInputOverflow(): void {
		const list = this.inputList;
		if (!list?.isConnected) {
			return;
		}
		const start = list.scrollLeft > 1;
		const end = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
		list.classList.toggle('overflow-start', start);
		list.classList.toggle('overflow-end', end);
	}

	/** The buttons of the input row, in order. The row is one tab stop; the arrow keys move between them. */
	private rowControls(): HTMLButtonElement[] {
		const controls: HTMLButtonElement[] = [];
		const visit = (element: Element) => {
			for (const child of element.children) {
				if (isHTMLButtonElement(child) && child.dataset.key && !child.disabled) {
					controls.push(child);
				}
				visit(child);
			}
		};
		visit(this.inputRowElement);
		return controls;
	}

	private updateRowTabStop(): void {
		const controls = this.rowControls();
		const current = controls.find(control => control.dataset.key === this.rowFocusKey) ?? controls[0];
		for (const control of controls) {
			control.tabIndex = control === current ? 0 : -1;
		}
	}

	private onRowKeyDown(event: KeyboardEvent): void {
		const controls = this.rowControls();
		const index = controls.findIndex(control => control === event.target);
		if (index < 0) {
			return;
		}
		if ((event.key === 'Delete' || event.key === 'Backspace') && controls[index].classList.contains('bh-video-panel-remove')) {
			event.preventDefault();
			event.stopPropagation();
			controls[index].click();
			return;
		}
		let next: number | undefined;
		if (event.key === 'ArrowRight') {
			next = Math.min(controls.length - 1, index + 1);
		} else if (event.key === 'ArrowLeft') {
			next = Math.max(0, index - 1);
		} else if (event.key === 'Home') {
			next = 0;
		} else if (event.key === 'End') {
			next = controls.length - 1;
		}
		if (next === undefined) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		controls[next].focus({ preventScroll: false });
	}

	private renderInput(parent: HTMLElement, item: IBaseHalfVideoPanelInputItem, slotTitle: string | undefined): void {
		const element = append(parent, $(slotTitle !== undefined ? '.bh-video-panel-slot' : '.bh-video-panel-input'));
		element.dataset.kind = item.kind;
		element.dataset.use = item.use;
		element.classList.toggle('unused', !item.used);
		element.classList.toggle('chip', item.kind === 'text' || item.kind === 'other');
		const media = item.kind === 'image' || item.kind === 'video' || item.kind === 'audio';
		if (media) {
			const thumb = append(element, $('.bh-video-panel-thumb'));
			this.renderThumbnail(thumb, item.kind, this.inputs[item.index]);
		} else {
			element.append(renderCodicon(item.kind === 'text' ? Codicon.fileText : Codicon.file, 'bh-video-panel-input-icon'));
		}
		const text = append(element, $('.bh-video-panel-input-text'));
		if (slotTitle !== undefined) {
			append(text, $('span.bh-video-panel-slot-title')).textContent = slotTitle;
		}
		append(text, $('span.bh-video-panel-input-name')).textContent = item.name;
		this.rowStore.add(this.hoverService.setupDelayedHover(element, () => ({ content: item.tooltip }), { groupId: HOVER_GROUP }));

		const remove = append(element, $<HTMLButtonElement>('button.bh-video-panel-remove'));
		remove.type = 'button';
		remove.dataset.key = `remove:${item.path}`;
		remove.setAttribute('aria-label', localize('basehalf.video.panel.removeInput', "Remove {0}", item.name));
		remove.setAttribute('aria-description', item.tooltip);
		remove.append(renderCodicon(Codicon.close));
		this.rowStore.add(addDisposableListener(remove, 'click', event => {
			event.stopPropagation();
			void this.disconnect(item.path);
		}));
	}

	private renderThumbnail(container: HTMLElement, kind: 'image' | 'video' | 'audio', input: IBaseHalfVideoResolvedInput | undefined): void {
		const file = input?.file;
		const glyph = () => {
			clearNode(container);
			container.append(renderCodicon(kind === 'audio' ? Codicon.unmute : kind === 'video' ? Codicon.play : Codicon.fileMedia, 'bh-video-panel-thumb-glyph'));
		};
		if (!file || kind === 'audio' || input?.available === false) {
			glyph();
			return;
		}
		const source = FileAccess.uriToBrowserUri(file).toString(true);
		if (kind === 'image') {
			const image = append(container, $<HTMLImageElement>('img'));
			image.alt = '';
			image.draggable = false;
			image.decoding = 'async';
			image.loading = 'lazy';
			image.addEventListener('error', glyph, { once: true });
			image.src = source;
			return;
		}
		const video = append(container, $<HTMLVideoElement>('video'));
		video.muted = true;
		video.preload = 'metadata';
		video.playsInline = true;
		video.tabIndex = -1;
		video.setAttribute('aria-hidden', 'true');
		video.addEventListener('error', glyph, { once: true });
		// The first frame stands for the video.
		video.src = `${source}#t=0.1`;
		this.rowStore.add(toDisposable(() => {
			video.removeAttribute('src');
			video.load();
		}));
	}

	private renderOverlay(): void {
		const text = this.textarea.value;
		const marks = this.presentation ? baseHalfVideoPanelPromptMarks(text, this.presentation.plan) : [];
		clearNode(this.overlay);
		let offset = 0;
		for (const mark of marks) {
			if (mark.start > offset) {
				this.overlay.append(text.slice(offset, mark.start));
			}
			const span = append(this.overlay, $(mark.known ? 'span.bh-video-panel-name' : 'span.bh-video-panel-name.unknown'));
			span.textContent = text.slice(mark.start, mark.end);
			offset = mark.end;
		}
		// A last empty line still takes its height.
		this.overlay.append(`${text.slice(offset)}\u200b`);
		this.syncOverlayScroll();
		this.updatePromptLines();
	}

	private syncOverlayScroll(): void {
		this.overlay.scrollTop = this.textarea.scrollTop;
		this.overlay.scrollLeft = this.textarea.scrollLeft;
	}

	private renderFooter(): void {
		const presentation = this.presentation;
		if (!presentation) {
			return;
		}
		this.modelLabel.textContent = presentation.model.label;
		this.modelButton.classList.toggle('outlined', presentation.model.outlined);
		this.modelButton.classList.toggle('empty', !presentation.model.chosen);
		this.modelButton.setAttribute('aria-label', presentation.model.outlined
			? localize('basehalf.video.panel.modelProblem', "Model: {0}. {1}", presentation.model.label, presentation.model.title)
			: localize('basehalf.video.panel.modelLabel', "Model: {0}", presentation.model.label));
		// Settings exist once the catalog has the node's model.
		this.settingsButton.hidden = !presentation.settingsView;
		this.settingsLabel.textContent = presentation.settingsView?.summary ?? '';
		this.settingsButton.setAttribute('aria-label', this.settingsTitle());
		const generate = presentation.generate;
		// The button changed under the pointer: a tooltip it shows names what it did before.
		if (this.generateKind !== undefined && this.generateKind !== generate.kind && this.generateButton.matches(':hover')) {
			this.hoverService.hideHover(true);
		}
		this.generateKind = generate.kind;
		const busy = this.starting && generate.kind === 'generate';
		const enabled = generate.enabled && !busy;
		this.generateButton.classList.toggle('stop', generate.kind === 'stop');
		this.generateButton.classList.toggle('busy', busy);
		this.generateButton.setAttribute('aria-disabled', String(!enabled));
		this.generateButton.setAttribute('aria-label', generate.label);
		if (busy) {
			this.generateButton.setAttribute('aria-busy', 'true');
		} else {
			this.generateButton.removeAttribute('aria-busy');
		}
		// The stop mark is a solid square of its own; the arrow is the codicon's.
		const iconClasses = generate.kind === 'stop' ? ['bh-video-panel-stop-mark'] : ThemeIcon.asClassNameArray(Codicon.arrowUp);
		if (!iconClasses.every(name => this.generateIcon.classList.contains(name))) {
			this.generateIcon.className = '';
			this.generateIcon.classList.add(...iconClasses);
		}
	}

	/** Why Generate cannot run, above the footer, with the action that fixes it. */
	private renderReason(): void {
		const reason = this.presentation?.reason;
		this.reason.hidden = !reason;
		const text = reason?.text ?? '';
		if (this.reasonText.textContent !== text) {
			this.reasonText.textContent = text;
		}
		const action = reason?.action;
		this.reasonAction.hidden = !action;
		if (this.reasonAction.textContent !== (action?.label ?? '')) {
			this.reasonAction.textContent = action?.label ?? '';
		}
		if (action) {
			this.reasonAction.setAttribute('aria-description', text);
		} else {
			this.reasonAction.removeAttribute('aria-description');
		}
	}

	private settingsTitle(): string {
		return this.presentation?.settingsView
			? localize('basehalf.video.panel.settingsLabel', "Settings: {0}", this.presentation.settingsView.summary)
			: localize('basehalf.video.panel.settings', "Settings");
	}

	private generateTitle(): string {
		return this.presentation?.generate.title ?? '';
	}

	//#endregion

	//#region The problems

	/** The model whose answers of `check` the panel shows: the card's, in the region of its provider. */
	private checkModelKey(info: IBaseHalfGenerationInfo): string | undefined {
		const catalog = this.catalogService.state;
		const ref = catalog.kind === 'ready' ? findBaseHalfVideoModel(catalog.catalog, info.provider, info.model) : undefined;
		return ref ? `${ref.provider.id}/${ref.model.id}/${this.providerSettings.getStatus(ref.provider).region.id}` : undefined;
	}

	/**
	 * Asks `check` a moment after what it is asked changes: the model, the
	 * values, the prompt, the inputs, or their files. The answer for the same
	 * model shows until the new one arrives.
	 */
	private scheduleCheck(presentation: IBaseHalfVideoPanelPresentation): void {
		const request = presentation.checkRequest;
		const pending: IPendingCheck | undefined = request ? {
			request,
			plan: presentation.plan,
			inputs: this.inputs,
			imageFormats: presentation.mode?.limits.imageFormats ?? BASEHALF_VIDEO_IMAGE_FORMATS
		} : undefined;
		const key = pending ? JSON.stringify({
			request,
			plan: pending.plan.map(item => [item.path, item.use]),
			files: pending.inputs.map(input => input.file?.toString() ?? ''),
			version: this.inputFilesVersion
		}) : undefined;
		if (key === this.checkKey) {
			return;
		}
		this.checkKey = key;
		this.pendingCheck = pending;
		if (pending) {
			this.checkScheduler.schedule();
		} else {
			this.checkScheduler.cancel();
		}
	}

	/**
	 * Asks `check` with the files a generation would send. An input that is
	 * missing, or that is not a file on this computer, is the answer's problem
	 * by name, and nothing is asked.
	 */
	private async runCheck(): Promise<void> {
		const pending = this.pendingCheck;
		const key = this.checkKey;
		if (!pending || this.disposed) {
			return;
		}
		let result: IBaseHalfVideoCheckResult | undefined;
		try {
			const inputs = await this.generationService.prepareInputMedia(pending.plan, pending.inputs, pending.imageFormats);
			if (this.disposed || key !== this.checkKey) {
				return;
			}
			result = await this.catalogService.check({ ...pending.request, inputs });
		} catch (error) {
			if (!(error instanceof BaseHalfVideoGenerationError)) {
				this.logService.warn('[BaseHalf] the panel could not prepare the inputs to check', error);
			}
			result = Object.freeze({ problems: Object.freeze([baseHalfUserFacingErrorMessage(error)]) });
		}
		if (this.disposed || key !== this.checkKey) {
			// A newer check is on its way.
			return;
		}
		const { request } = pending;
		const model = `${request.provider}/${request.model}/${request.region}`;
		this.lastCheck = result ? { model, result } : undefined;
		this.render();
	}

	private async readTexts(inputs: readonly IBaseHalfVideoResolvedInput[]): Promise<ReadonlyMap<string, string>> {
		const texts = new Map<string, string>();
		for (const input of inputs) {
			if (input.kind === 'text' && input.available && input.file) {
				try {
					texts.set(input.path, await readBaseHalfVideoTextInput(this.fileService, input.file));
				} catch {
					// A note that cannot be read adds nothing; Generate says that it is missing.
				}
			}
		}
		return texts;
	}

	//#endregion

	//#region Size

	private updatePromptLines(): void {
		const lines = this.measurePromptLines();
		if (lines !== this.promptLines) {
			this.promptLines = lines;
		}
		this.promptBox.style.height = `${this.promptLines * PROMPT_LINE_HEIGHT + PROMPT_PADDING * 2}px`;
		this.updateHeight();
	}

	/** The lines the prompt takes, from three to five; beyond five it scrolls. */
	private measurePromptLines(): number {
		if (!this.textarea.isConnected || this.measure.clientWidth === 0) {
			return this.promptLines;
		}
		this.measure.textContent = `${this.textarea.value}\u200b`;
		const height = this.measure.offsetHeight - PROMPT_PADDING * 2;
		const lines = Math.round(height / PROMPT_LINE_HEIGHT);
		return Math.min(PROMPT_MAX_LINES, Math.max(PROMPT_MIN_LINES, lines));
	}

	private computeHeight(withInputRow: boolean): number {
		const row = withInputRow ? INPUT_ROW_HEIGHT + SECTION_GAP : 0;
		const prompt = this.promptLines * PROMPT_LINE_HEIGHT + PROMPT_PADDING * 2;
		const reason = this.reason.hidden ? 0 : this.reasonHeight() + SECTION_GAP;
		const height = PANEL_PADDING + row + prompt + SECTION_GAP + reason + FOOTER_HEIGHT + PANEL_PADDING;
		return Math.min(BASEHALF_VIDEO_PANEL_MAX_HEIGHT, Math.max(BASEHALF_VIDEO_PANEL_MIN_HEIGHT, height));
	}

	/** The reason line as drawn, one or two lines; one line before the panel is drawn. */
	private reasonHeight(): number {
		const drawn = this.reason.offsetHeight;
		return drawn > 0 ? Math.min(REASON_MAX_HEIGHT, Math.max(REASON_MIN_HEIGHT, drawn)) : REASON_MIN_HEIGHT;
	}

	private updateHeight(): void {
		const height = this.computeHeight(this.snapshot ? !this.inputRowElement.hidden : true);
		if (height === this.currentHeight) {
			return;
		}
		this.currentHeight = height;
		this.element.style.height = `${height}px`;
		this._onDidChangeHeight.fire(height);
	}

	//#endregion

	//#region Menus

	private toggleMenu(kind: Exclude<BaseHalfVideoPanelMenuKind, 'mention'>, trigger: HTMLElement, byPointer: boolean): void {
		if (this.openMenu?.kind === kind && this.openMenu.trigger === trigger) {
			this.closeMenu(true);
			return;
		}
		this.showMenu(kind, trigger, byPointer);
	}

	private showMenu(kind: BaseHalfVideoPanelMenuKind, trigger: HTMLElement, byPointer = false): void {
		this.closeMenu(false);
		if (!this.presentation) {
			return;
		}
		const store = new DisposableStore();
		const element = append(this.layer, $(`.bh-video-panel-menu.${kind}`));
		element.style.width = `${MENU_WIDTHS[kind]}px`;
		store.add(toDisposable(() => element.remove()));
		const menu: IOpenMenu = {
			kind,
			element,
			trigger,
			store,
			content: store.add(new DisposableStore()),
			anchor: kind === 'mention' ? () => this.caretRect() : () => this.menuAnchor(kind, trigger),
			align: 'start',
			byPointer
		};
		this.openMenu = menu;
		this.menu.value = store;
		if (kind !== 'mention') {
			trigger.setAttribute('aria-expanded', 'true');
			store.add(toDisposable(() => trigger.setAttribute('aria-expanded', 'false')));
			store.add(addDisposableListener(element, 'focusout', event => {
				const next = event.relatedTarget;
				if (isHTMLElement(next) && !element.contains(next) && next !== trigger) {
					this.closeMenu(false);
				}
			}));
		}
		store.add(addDisposableListener(getWindow(this.element), 'pointerdown', event => {
			// A type check of this element's own window: the panel can live in an auxiliary window.
			const target = event.target;
			if (isHTMLElement(target) && (element.contains(target) || trigger.contains(target))) {
				return;
			}
			this.closeMenu(false);
		}, true));
		store.add(addDisposableListener(element, 'keydown', event => this.onMenuKeyDown(event, menu)));
		this.fillMenu(menu);
		this.placeMenu(menu);
		if (kind !== 'mention') {
			this.focusFirstMenuItem(menu);
		}
	}

	private closeMenu(restoreFocus: boolean): void {
		const menu = this.openMenu;
		if (!menu) {
			return;
		}
		this.openMenu = undefined;
		if (menu.kind === 'settings') {
			this.saveTextParam();
		}
		if (menu.kind === 'mention') {
			this.mention = undefined;
			this.textarea.removeAttribute('aria-activedescendant');
			this.textarea.removeAttribute('aria-controls');
		}
		this.menu.clear();
		if (restoreFocus) {
			(menu.kind === 'mention' ? this.textarea : menu.trigger).focus({ preventScroll: true });
		}
	}

	private refreshMenu(): void {
		const menu = this.openMenu;
		if (!menu || menu.kind === 'mention') {
			return;
		}
		if (!menu.trigger.isConnected) {
			// The control it opened from was drawn again: open from the new one.
			const key = menu.trigger.dataset.key;
			const replacement = key ? this.findByKey(this.inputRowElement, key) : undefined;
			if (!replacement) {
				this.closeMenu(false);
				return;
			}
			this.showMenu(menu.kind, replacement, menu.byPointer);
			return;
		}
		if (this.menuContentKey(menu.kind) === menu.contentKey) {
			return;
		}
		const focusedKey = this.focusedKey(menu.element);
		this.fillMenu(menu);
		this.placeMenu(menu);
		this.restoreFocus(menu.element, focusedKey);
	}

	private menuContentKey(kind: BaseHalfVideoPanelMenuKind): string {
		const presentation = this.presentation;
		switch (kind) {
			case 'model': return JSON.stringify(presentation?.modelMenu);
			case 'settings': return JSON.stringify([presentation?.ref?.provider.id, presentation?.ref?.model.id, presentation?.settingsView, this.moreOpen]);
			default: return kind;
		}
	}

	private fillMenu(menu: IOpenMenu): void {
		menu.contentKey = this.menuContentKey(menu.kind);
		menu.content.clear();
		clearNode(menu.element);
		switch (menu.kind) {
			case 'add': return this.fillAddMenu(menu.element);
			case 'model': return this.fillModelMenu(menu.element);
			case 'settings': return this.fillSettings(menu.element);
			case 'mention': return this.fillMentionMenu(menu.element);
		}
	}

	private placeMenu(menu: IOpenMenu): void {
		const anchor = menu.anchor();
		if (!anchor) {
			return;
		}
		const panel = this.element.getBoundingClientRect();
		const canvas = this.canvasRect(panel);
		const trigger: IBaseHalfVideoPanelRect = {
			left: anchor.left - canvas.left,
			top: anchor.top - canvas.top,
			right: anchor.right - canvas.left,
			bottom: anchor.bottom - canvas.top
		};
		menu.element.style.maxHeight = '';
		const wanted = menu.element.scrollHeight;
		const placement = resolveBaseHalfVideoPanelMenuPlacement(trigger, canvas, { width: MENU_WIDTHS[menu.kind], height: wanted }, { align: menu.align });
		menu.element.dataset.side = placement.side;
		menu.element.style.width = `${placement.width}px`;
		menu.element.style.maxHeight = `${placement.maxHeight}px`;
		menu.element.style.left = `${placement.left - (panel.left - canvas.left)}px`;
		menu.element.style.top = `${placement.top - (panel.top - canvas.top)}px`;
	}

	/**
	 * Where a menu opens from: its control. A menu of the footer that opens
	 * below opens below the panel, so it never covers the panel's edge; one that
	 * opens upward opens from the control, over the prompt.
	 */
	private menuAnchor(kind: BaseHalfVideoPanelMenuKind, trigger: HTMLElement): DOMRect | undefined {
		if (!trigger.isConnected) {
			return undefined;
		}
		const rect = trigger.getBoundingClientRect();
		if (kind !== 'model' && kind !== 'settings') {
			return rect;
		}
		const panel = this.element.getBoundingClientRect();
		const DOMRectConstructor = getWindow(this.element).DOMRect;
		return new DOMRectConstructor(rect.left, rect.top, rect.width, Math.max(rect.height, panel.bottom - rect.top));
	}

	/** The canvas in window coordinates: what the scene reported, or the window itself before the scene places the panel. */
	private canvasRect(panel: DOMRect): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } {
		const layout = this.layout;
		if (layout && layout.canvasWidth > 0 && layout.canvasHeight > 0) {
			return { left: panel.left - layout.left, top: panel.top - layout.top, width: layout.canvasWidth, height: layout.canvasHeight };
		}
		const targetWindow = getWindow(this.element);
		return { left: 0, top: 0, width: targetWindow.innerWidth, height: targetWindow.innerHeight };
	}

	private onMenuKeyDown(event: KeyboardEvent, menu: IOpenMenu): void {
		if (menu.kind === 'settings' || menu.kind === 'mention') {
			return;
		}
		const items = this.menuItems(menu.element);
		const index = items.findIndex(item => item === getWindow(this.element).document.activeElement);
		let next: number | undefined;
		// Without a current item (index -1), Down goes to the first item and Up to the last.
		if (event.key === 'ArrowDown') {
			next = (index + 1) % items.length;
		} else if (event.key === 'ArrowUp') {
			next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
		} else if (event.key === 'Home') {
			next = 0;
		} else if (event.key === 'End') {
			next = items.length - 1;
		} else if (event.key === 'Tab') {
			this.closeMenu(true);
			return;
		}
		if (next === undefined || items.length === 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		items[next].focus({ preventScroll: true });
	}

	private menuItems(container: HTMLElement): HTMLElement[] {
		const items: HTMLElement[] = [];
		const visit = (element: Element) => {
			for (const child of element.children) {
				if (isHTMLElement(child) && child.dataset.menuItem === 'true' && !child.hasAttribute('disabled')) {
					items.push(child);
				}
				visit(child);
			}
		};
		visit(container);
		return items;
	}

	/**
	 * A menu focuses its checked item. Without one, a menu opened from the
	 * keyboard focuses its first item, and a menu that a click opened holds the
	 * focus itself, with no current item, as the workbench's menus do: an item
	 * focused there would show no ring, and Enter would choose it unseen. The
	 * settings focus their first control.
	 */
	private focusFirstMenuItem(menu: IOpenMenu): void {
		const items = this.menuItems(menu.element);
		const checked = items.find(item => item.getAttribute('aria-checked') === 'true');
		if (!checked && menu.byPointer && items.length > 0) {
			menu.element.tabIndex = -1;
			menu.element.focus({ preventScroll: true });
			return;
		}
		(checked ?? items[0] ?? this.firstControl(menu.element))?.focus({ preventScroll: true });
	}

	private firstControl(container: HTMLElement): HTMLElement | undefined {
		for (const child of container.children) {
			if (!isHTMLElement(child)) {
				continue;
			}
			const control = (isHTMLButtonElement(child) || isHTMLInputElement(child)) && !child.disabled && child.tabIndex >= 0
				? child
				: this.firstControl(child);
			if (control) {
				return control;
			}
		}
		return undefined;
	}

	private menuItem(parent: HTMLElement, label: string, run: () => void, options?: { readonly role?: string; readonly checked?: boolean; readonly key?: string; readonly title?: string; readonly icon?: ThemeIcon; readonly detail?: string }): HTMLButtonElement {
		const item = append(parent, $<HTMLButtonElement>('button.bh-video-panel-menu-item'));
		item.type = 'button';
		item.tabIndex = -1;
		item.dataset.menuItem = 'true';
		item.dataset.key = options?.key ?? label;
		item.setAttribute('role', options?.role ?? 'menuitem');
		if (options?.checked !== undefined) {
			item.setAttribute('aria-checked', String(options.checked));
		}
		if (options?.icon) {
			item.append(renderCodicon(options.icon, 'bh-video-panel-menu-icon'));
		}
		if (options?.detail) {
			// A second line under the name; the item is named by its label alone.
			const text = append(item, $('span.bh-video-panel-menu-text'));
			append(text, $('span.bh-video-panel-menu-label')).textContent = label;
			append(text, $('span.bh-video-panel-menu-detail')).textContent = options.detail;
			item.classList.add('detailed');
			item.setAttribute('aria-label', label);
			item.setAttribute('aria-description', options.detail);
		} else {
			append(item, $('span.bh-video-panel-menu-label')).textContent = label;
		}
		if (options?.checked) {
			item.append(renderCodicon(Codicon.check, 'bh-video-panel-menu-check'));
		}
		if (options?.title) {
			const title = options.title;
			this.openMenu?.content.add(this.hoverService.setupDelayedHover(item, () => ({ content: title }), { groupId: HOVER_GROUP }));
		}
		item.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			run();
		});
		return item;
	}

	private fillAddMenu(element: HTMLElement): void {
		element.setAttribute('role', 'menu');
		element.setAttribute('aria-label', addInputLabel());
		this.menuItem(element, localize('basehalf.video.panel.pickOnCanvas', "Pick on Canvas"), () => {
			this.closeMenu(false);
			void this.pickOnCanvas();
		}, { key: 'pick', icon: Codicon.inspect });
		this.menuItem(element, localize('basehalf.video.panel.importFile', "Import File…"), () => {
			this.closeMenu(false);
			void this.importFile();
		}, { key: 'import', icon: Codicon.cloudUpload });
	}

	private fillModelMenu(element: HTMLElement): void {
		const presentation = this.presentation;
		if (!presentation) {
			return;
		}
		const menu = presentation.modelMenu;
		element.setAttribute('role', 'menu');
		element.setAttribute('aria-label', localize('basehalf.video.panel.models', "Models"));
		if (menu.message) {
			const message = append(element, $('.bh-video-panel-menu-empty'));
			message.textContent = menu.message;
			message.setAttribute('role', 'status');
		}
		for (const group of menu.groups) {
			const section = append(element, $('.bh-video-panel-menu-group'));
			section.setAttribute('role', 'group');
			section.setAttribute('aria-label', group.detail ? `${group.label}, ${group.detail}` : group.label);
			section.dataset.provider = group.provider;
			const heading = append(section, $('.bh-video-panel-menu-heading'));
			heading.setAttribute('aria-hidden', 'true');
			append(heading, $('span.bh-video-panel-menu-heading-label')).textContent = group.label;
			if (group.detail) {
				append(heading, $('span.bh-video-panel-menu-heading-detail')).textContent = group.detail;
			}
			for (const item of group.items) {
				const button = this.menuItem(section, item.label, () => {
					this.closeMenu(true);
					this.chooseModel(item.provider, item.model);
				}, { role: 'menuitemradio', checked: item.checked, key: `model:${item.provider}:${item.model}`, title: item.title, detail: item.detail });
				if (item.unavailable) {
					// Dimmed with the reason; it can still be chosen.
					button.classList.add('unavailable');
					button.setAttribute('aria-description', item.detail ? `${item.unavailable}. ${item.detail}` : item.unavailable);
				}
			}
		}
		append(element, $('.bh-video-panel-menu-separator')).setAttribute('role', 'separator');
		this.menuItem(element, menu.settingsLabel, () => {
			this.closeMenu(false);
			void this.providerSettings.openSettings(this.info().provider).catch(error => this.logService.error(error));
		}, { key: 'providers', icon: Codicon.settingsGear });
	}

	/** Chooses a model of the catalog: every value it accepts is kept, the others take its defaults. */
	private chooseModel(providerId: string, modelId: string): void {
		const catalog = this.catalogService.state;
		const ref = catalog.kind === 'ready' ? findBaseHalfVideoModel(catalog.catalog, providerId, modelId) : undefined;
		if (ref) {
			void this.writeSettings(info => setBaseHalfGenerationChoice(info, baseHalfVideoChooseModel(baseHalfGenerationChoice(info), ref)))
				.then(() => this.followModelFormat(ref.model));
		}
	}

	/**
	 * A draft's extension follows its model (generation cards, "Creating a
	 * generation card"): an image model that delivers another format renames
	 * the draft to that format's extension at once, with the next free number
	 * when that name is taken, as a rename does.
	 */
	private async followModelFormat(model: IBaseHalfVideoCatalogModel): Promise<void> {
		const snapshot = this.snapshot;
		if (this.disposed || !snapshot || snapshot.hasFile || snapshot.made || snapshot.kind !== 'image' || model.kind !== 'image' || !model.outputFormat
			|| baseHalfGenerationExtensionMatchesFormat(snapshot.path, model.outputFormat)) {
			return;
		}
		const name = basename(this.resource);
		const folder = dirname(this.resource);
		try {
			const next = await this.store.nextFreeName(folder, baseHalfGenerationNameParts(name).base, baseHalfModelFileExtension(model), baseHalfGenerationNameOrdinal(name));
			const target = joinPath(folder, next);
			await this.draftOperations.move(this.resource, target);
			this.host.didRenameCard?.(target);
		} catch (error) {
			this.logService.warn('[BaseHalf] the panel could not rename the draft to the format of its model', error);
			this.notificationService.notify({ severity: Severity.Warning, message: baseHalfUserFacingErrorMessage(error) });
		}
	}

	/** Saves one value of the card's model, for the mode that is used: the panel shows the change at once. */
	private changeParam(name: string, value: BaseHalfVideoParamValue | undefined): void {
		const ref = this.presentation?.ref;
		const usedMode = this.presentation?.mode?.id;
		if (ref) {
			void this.writeSettings(info => setBaseHalfGenerationChoice(info, baseHalfVideoChangeParam(this.generationOf(info, ref), ref.model, name, value, usedMode)));
		}
	}

	private changeMode(mode: BaseHalfVideoModeId): void {
		const ref = this.presentation?.ref;
		if (ref) {
			void this.writeSettings(info => setBaseHalfGenerationChoice(info, baseHalfVideoChooseMode(this.generationOf(info, ref), ref.model, mode)));
		}
	}

	/** The card's generation of `ref`, as a change starts from it. */
	private generationOf(info: IBaseHalfGenerationInfo, ref: IBaseHalfVideoModelRef): IBaseHalfVideoGenerationChoice {
		const choice = baseHalfGenerationChoice(info);
		return choice.model ? choice : { ...choice, provider: ref.provider.id, model: ref.model.id };
	}

	/** Saves a text value typed into the settings, now. */
	private saveTextParam(): void {
		const pending = this.pendingText;
		this.pendingText = undefined;
		if (pending) {
			this.changeParam(pending.name, pending.value);
		}
	}

	private fillSettings(element: HTMLElement): void {
		const view = this.presentation?.settingsView;
		if (!view) {
			return;
		}
		element.setAttribute('role', 'dialog');
		element.setAttribute('aria-label', localize('basehalf.video.panel.settingsTitle', "Settings"));
		if (view.modes) {
			this.radioGroup(element, localize('basehalf.video.panel.setting.mode', "Mode"), view.modes, 'buttons', mode => {
				if (mode !== undefined) {
					this.changeMode(mode);
				}
			});
		}
		for (const control of view.controls) {
			this.renderControl(element, control);
		}
		if (view.advanced.length) {
			const more = append(element, $<HTMLButtonElement>('button.bh-video-panel-more'));
			more.type = 'button';
			more.dataset.key = 'more';
			more.setAttribute('aria-expanded', String(this.moreOpen));
			more.append(renderCodicon(this.moreOpen ? Codicon.chevronDown : Codicon.chevronRight));
			append(more, $('span')).textContent = localize('basehalf.video.panel.more', "More");
			more.addEventListener('click', () => {
				this.moreOpen = !this.moreOpen;
				this.refreshMenu();
				this.findByKey(this.openMenu?.element ?? element, 'more')?.focus({ preventScroll: true });
			});
			if (this.moreOpen) {
				const advanced = append(element, $('.bh-video-panel-advanced'));
				for (const control of view.advanced) {
					this.renderControl(advanced, control);
				}
			}
		}
	}

	/** One parameter, drawn as the specification says for its kind (generation cards, "Settings"). */
	private renderControl(parent: HTMLElement, control: BaseHalfVideoPanelControl): void {
		switch (control.kind) {
			case 'buttons':
			case 'list':
			case 'ratio': {
				const section = this.radioGroup(parent, control.label, control.choices, control.kind, value => this.changeParam(control.name, value), control.tooltip);
				section.dataset.parameter = control.name;
				return;
			}
			case 'slider': {
				const section = this.settingSection(parent, control.label, control.tooltip);
				section.dataset.parameter = control.name;
				const row = append(section, $('.bh-video-panel-number'));
				const slider = append(row, $<HTMLInputElement>('input.bh-video-panel-slider'));
				slider.type = 'range';
				slider.min = String(control.min);
				slider.max = String(control.max);
				slider.step = String(control.step);
				slider.value = String(control.value);
				slider.dataset.key = `${control.name}:slider`;
				slider.setAttribute('aria-label', control.label);
				slider.disabled = control.auto?.selected === true;
				const value = append(row, $('span.bh-video-panel-number-value'));
				value.textContent = control.valueLabel;
				slider.addEventListener('input', () => {
					value.textContent = control.unit === 'seconds'
						? localize('basehalf.video.panel.secondsValue', "{0}s", slider.value)
						: slider.value;
				});
				slider.addEventListener('change', () => this.changeParam(control.name, Number(slider.value)));
				if (control.auto) {
					this.autoSwitch(row, control.name, control.auto);
				}
				return;
			}
			case 'number': {
				const section = this.settingSection(parent, control.label, control.tooltip);
				section.dataset.parameter = control.name;
				const row = append(section, $('.bh-video-panel-number'));
				const field = append(row, $<HTMLInputElement>('input.bh-video-panel-field'));
				field.type = 'text';
				field.inputMode = control.integer && control.min >= 0 ? 'numeric' : 'decimal';
				field.spellcheck = false;
				field.value = control.text;
				field.placeholder = control.placeholder;
				field.dataset.key = `${control.name}:field`;
				field.setAttribute('aria-label', control.unit === 'seconds' ? localize('basehalf.video.panel.secondsField', "{0}, in seconds", control.label) : control.label);
				field.disabled = control.auto?.selected === true;
				if (control.unit === 'seconds') {
					const unit = append(row, $('span.bh-video-panel-number-unit'));
					unit.textContent = localize('basehalf.video.panel.secondsUnit', "s");
					unit.setAttribute('aria-hidden', 'true');
				}
				const commit = () => {
					const text = field.value.trim();
					if (!text) {
						this.changeParam(control.name, undefined);
						return;
					}
					const number = Number(text);
					// A value the parameter does not take is given back its default by the normalization.
					this.changeParam(control.name, Number.isFinite(number) ? number : undefined);
				};
				field.addEventListener('change', commit);
				field.addEventListener('keydown', event => {
					if (event.key === 'Enter' && !event.isComposing) {
						event.preventDefault();
						commit();
					}
				});
				if (control.auto) {
					this.autoSwitch(row, control.name, control.auto);
				}
				return;
			}
			case 'fixed': {
				const section = this.settingSection(parent, control.label, control.tooltip);
				section.dataset.parameter = control.name;
				section.classList.add('fixed');
				append(section, $('.bh-video-panel-setting-note')).textContent = control.text;
				return;
			}
			case 'switch': {
				const section = this.settingSection(parent, control.label, control.tooltip);
				section.dataset.parameter = control.name;
				this.switchButton(section, control.on
					? localize('basehalf.video.panel.switchOn', "On")
					: localize('basehalf.video.panel.switchOff', "Off"), control.on, control.name, on => this.changeParam(control.name, on), control.label);
				return;
			}
			case 'text': {
				const section = this.settingSection(parent, control.label, control.tooltip);
				section.dataset.parameter = control.name;
				const field = control.multiline
					? append(section, $<HTMLTextAreaElement>('textarea.bh-video-panel-field.multiline'))
					: append(section, $<HTMLInputElement>('input.bh-video-panel-field'));
				field.value = this.pendingText?.name === control.name ? this.pendingText.value : control.text;
				field.maxLength = control.maxLength;
				field.spellcheck = false;
				field.dataset.key = `${control.name}:text`;
				field.setAttribute('aria-label', control.label);
				// Saved when the field loses the focus, on Enter, and when the popover
				// closes: a save draws the popover again, which must not happen while
				// the user types.
				field.addEventListener('input', () => {
					this.pendingText = { name: control.name, value: field.value };
				});
				field.addEventListener('change', () => this.saveTextParam());
				const element: HTMLElement = field;
				element.addEventListener('keydown', event => {
					if (event.key === 'Enter' && !event.isComposing && !control.multiline) {
						event.preventDefault();
						this.saveTextParam();
					}
				});
				return;
			}
		}
	}

	private autoSwitch(parent: HTMLElement, name: string, auto: IBaseHalfVideoPanelAuto): void {
		const toggle = this.switchButton(parent, auto.label, auto.selected, `${name}:auto`, on => this.changeParam(name, on ? auto.value : auto.fallback));
		toggle.classList.add('auto');
	}

	private settingSection(parent: HTMLElement, label: string, tooltip?: string): HTMLElement {
		const section = append(parent, $('.bh-video-panel-setting'));
		const title = append(section, $('.bh-video-panel-setting-label'));
		title.textContent = label;
		if (tooltip) {
			this.openMenu?.content.add(this.hoverService.setupDelayedHover(title, () => ({ content: tooltip }), { groupId: HOVER_GROUP }));
		}
		return section;
	}

	private radioGroup<T extends BaseHalfVideoParamValue>(
		parent: HTMLElement,
		label: string,
		choices: readonly IBaseHalfVideoPanelChoice<T>[],
		kind: 'buttons' | 'list' | 'ratio',
		choose: (value: T | undefined) => void,
		tooltip?: string
	): HTMLElement {
		// Returns the section, which holds the label and the choices.
		const section = this.settingSection(parent, label, tooltip);
		section.classList.add(kind === 'ratio' ? 'ratios' : kind);
		const group = append(section, $('.bh-video-panel-choices'));
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-label', label);
		const buttons: HTMLButtonElement[] = [];
		const selectedIndex = Math.max(0, choices.findIndex(choice => choice.selected));
		choices.forEach((choice, index) => {
			const button = append(group, $<HTMLButtonElement>('button.bh-video-panel-choice'));
			button.type = 'button';
			button.dataset.key = choice.key;
			button.setAttribute('role', 'radio');
			button.setAttribute('aria-checked', String(choice.selected));
			button.tabIndex = index === selectedIndex ? 0 : -1;
			if (kind === 'ratio') {
				const shape = append(button, $('span.bh-video-panel-ratio-shape'));
				if (choice.shape) {
					const scale = 16 / Math.max(choice.shape.width, choice.shape.height);
					shape.style.width = `${Math.max(4, Math.round(choice.shape.width * scale))}px`;
					shape.style.height = `${Math.max(4, Math.round(choice.shape.height * scale))}px`;
				} else {
					shape.classList.add('free');
				}
			}
			append(button, $('span.bh-video-panel-choice-label')).textContent = choice.label;
			const reason = choice.disabled ?? choice.unavailable;
			if (reason) {
				// Dimmed with the reason. A mode the region does not offer can still be chosen; one that cannot use every input cannot.
				button.classList.add('unavailable');
				button.setAttribute('aria-description', reason);
				this.openMenu?.content.add(this.hoverService.setupDelayedHover(button, () => ({ content: reason }), { groupId: HOVER_GROUP }));
			}
			if (choice.disabled) {
				button.setAttribute('aria-disabled', 'true');
			}
			button.addEventListener('click', () => {
				if (!choice.selected && !choice.disabled) {
					choose(choice.value);
				}
			});
			buttons.push(button);
		});
		group.addEventListener('keydown', event => {
			const index = buttons.findIndex(button => button === getWindow(this.element).document.activeElement);
			if (index < 0) {
				return;
			}
			let next: number | undefined;
			if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
				next = (index + 1) % buttons.length;
			} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
				next = (index - 1 + buttons.length) % buttons.length;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = buttons.length - 1;
			}
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			buttons[next].focus({ preventScroll: true });
			buttons[next].scrollIntoView({ block: 'nearest' });
			const choice = choices[next];
			if (!choice.selected && !choice.disabled) {
				choose(choice.value);
			}
		});
		return section;
	}

	private switchButton(parent: HTMLElement, label: string, on: boolean, key: string, toggle: (on: boolean) => void, accessibleName?: string): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.bh-video-panel-switch'));
		button.type = 'button';
		button.dataset.key = key;
		button.setAttribute('role', 'switch');
		button.setAttribute('aria-checked', String(on));
		if (accessibleName) {
			button.setAttribute('aria-label', accessibleName);
		}
		append(button, $('span.bh-video-panel-switch-track')).append($('span.bh-video-panel-switch-thumb'));
		append(button, $('span.bh-video-panel-switch-label')).textContent = label;
		button.addEventListener('click', () => toggle(!on));
		return button;
	}

	//#endregion

	//#region Names

	/** Opens, updates, or closes the `@` menu for the text before the caret. */
	private updateMention(): void {
		if (this.composing || !this.presentation) {
			return;
		}
		const caret = this.textarea.selectionStart === this.textarea.selectionEnd ? this.textarea.selectionStart : -1;
		const query = caret < 0 ? undefined : baseHalfVideoPanelMentionQuery(this.textarea.value, caret);
		if (!query) {
			if (this.openMenu?.kind === 'mention') {
				this.closeMenu(false);
			}
			return;
		}
		const sameQuery = this.mention?.start === query.start && this.mention.query === query.query;
		this.mention = { start: query.start, query: query.query, active: sameQuery ? this.mention?.active ?? 0 : 0 };
		if (this.openMenu?.kind !== 'mention') {
			this.showMenu('mention', this.textarea);
		} else {
			this.renderMentionMenu();
		}
	}

	private mentionNames(): readonly IBaseHalfVideoPanelName[] {
		return this.presentation && this.mention ? filterBaseHalfVideoPanelNames(this.presentation.names, this.mention.query) : [];
	}

	private renderMentionMenu(): void {
		const menu = this.openMenu;
		if (menu?.kind !== 'mention') {
			return;
		}
		this.fillMenu(menu);
		this.placeMenu(menu);
	}

	private fillMentionMenu(element: HTMLElement): void {
		element.id = this.mentionId;
		element.setAttribute('role', 'listbox');
		element.setAttribute('aria-label', localize('basehalf.video.panel.names', "Inputs to Name"));
		this.textarea.setAttribute('aria-controls', this.mentionId);
		const names = this.mentionNames();
		if (!names.length) {
			this.textarea.removeAttribute('aria-activedescendant');
			const empty = append(element, $('.bh-video-panel-menu-empty'));
			empty.textContent = this.presentation?.names.length
				? localize('basehalf.video.panel.namesNoMatch', "No input has that name.")
				: localize('basehalf.video.panel.namesNone', "Connect an image, a video, or audio to name it here.");
			return;
		}
		const active = Math.min(this.mention?.active ?? 0, names.length - 1);
		names.forEach((name, index) => {
			const option = append(element, $('.bh-video-panel-mention'));
			option.id = `${this.mentionId}-${index}`;
			option.setAttribute('role', 'option');
			option.setAttribute('aria-selected', String(index === active));
			option.classList.toggle('active', index === active);
			option.classList.toggle('unused', !name.used);
			const thumb = append(option, $('.bh-video-panel-thumb'));
			this.renderMentionThumbnail(thumb, name);
			append(option, $('span.bh-video-panel-mention-label')).textContent = name.label;
			append(option, $('span.bh-video-panel-mention-file')).textContent = name.fileName;
			option.addEventListener('pointerdown', event => {
				// The prompt keeps the focus and the caret.
				event.preventDefault();
			});
			option.addEventListener('click', () => this.insertName(name));
			if (index === active) {
				this.textarea.setAttribute('aria-activedescendant', option.id);
				option.scrollIntoView({ block: 'nearest' });
			}
		});
	}

	private renderMentionThumbnail(container: HTMLElement, name: IBaseHalfVideoPanelName): void {
		const input = this.inputs[name.index];
		const file = input?.file;
		if (name.kind === 'image' && file) {
			const image = append(container, $<HTMLImageElement>('img'));
			image.alt = '';
			image.draggable = false;
			image.decoding = 'async';
			image.addEventListener('error', () => {
				clearNode(container);
				container.append(renderCodicon(Codicon.fileMedia, 'bh-video-panel-thumb-glyph'));
			}, { once: true });
			image.src = FileAccess.uriToBrowserUri(file).toString(true);
			return;
		}
		container.append(renderCodicon(name.kind === 'audio' ? Codicon.unmute : name.kind === 'video' ? Codicon.play : Codicon.fileMedia, 'bh-video-panel-thumb-glyph'));
	}

	/** Types the input's name in place of `@` and what was typed after it. */
	private insertName(name: IBaseHalfVideoPanelName): void {
		const mention = this.mention;
		if (!mention) {
			return;
		}
		const end = mention.start + 1 + mention.query.length;
		this.closeMenu(false);
		this.textarea.focus({ preventScroll: true });
		this.textarea.setSelectionRange(mention.start, end);
		const targetWindow = getWindow(this.textarea);
		// `insertText` keeps the edit in the text field's own undo history.
		const inserted = targetWindow.document.execCommand('insertText', false, name.label);
		if (!inserted || this.textarea.value.slice(mention.start, mention.start + name.label.length) !== name.label) {
			this.textarea.setRangeText(name.label, mention.start, end, 'end');
			this.didEditPrompt();
		}
	}

	/** The caret's place in window coordinates, for the `@` menu. */
	private caretRect(): DOMRect | undefined {
		if (!this.textarea.isConnected) {
			return undefined;
		}
		const caret = this.textarea.selectionEnd;
		this.measure.textContent = this.textarea.value.slice(0, caret);
		const marker = append(this.measure, $('span'));
		marker.textContent = '\u200b';
		const box = this.measure.getBoundingClientRect();
		const textarea = this.textarea.getBoundingClientRect();
		const left = textarea.left + (marker.offsetLeft) - this.textarea.scrollLeft;
		const top = textarea.top + marker.offsetTop - this.textarea.scrollTop;
		marker.remove();
		const DOMRectConstructor = getWindow(this.textarea).DOMRect;
		return box.width > 0 ? new DOMRectConstructor(left, top, 1, PROMPT_LINE_HEIGHT) : undefined;
	}

	private replacePromptText(value: string): void {
		const focused = getWindow(this.textarea).document.activeElement === this.textarea;
		const start = this.textarea.selectionStart;
		const end = this.textarea.selectionEnd;
		this.textarea.value = value;
		if (focused) {
			this.textarea.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
		}
	}

	//#endregion

	//#region Inputs

	private async reorder(upstream: readonly string[]): Promise<void> {
		try {
			const snapshot = await this.store.reorderUpstream(this.resource, upstream);
			if (!this.disposed) {
				this.snapshot = snapshot;
				this.scheduleRefresh();
			}
		} catch (error) {
			this.reportReferenceError(error);
		}
	}

	private async pickOnCanvas(): Promise<void> {
		if (this.picking) {
			return;
		}
		this.picking = true;
		this.render();
		let path: string | undefined;
		try {
			path = await this.host.pickCard();
		} finally {
			this.picking = false;
			if (!this.disposed) {
				this.render();
			}
		}
		if (path && !this.disposed) {
			await this.connect(path);
		}
	}

	private async importFile(): Promise<void> {
		let path: string | undefined;
		try {
			path = await this.host.importFile();
		} catch (error) {
			this.reportReferenceError(error);
			return;
		}
		if (path && !this.disposed) {
			await this.connect(path);
		}
	}

	private async connect(entry: string): Promise<void> {
		const node = this.workspaceNode();
		if (!node || entry === node.relativePath) {
			return;
		}
		const label = localize('basehalf.video.panel.connectUndo', "Connect Input");
		await this.runReferenceEdit(label, () => this.referenceEditService.add(node, entry, { label }));
	}

	private async disconnect(entry: string): Promise<void> {
		const node = this.workspaceNode();
		if (!node) {
			return;
		}
		const label = localize('basehalf.video.panel.disconnectUndo', "Remove Input");
		await this.runReferenceEdit(label, () => this.referenceEditService.remove(node, entry, { label }));
	}

	/** Runs a connection edit as one step of the canvas undo stack, and says why one did not run. */
	private async runReferenceEdit(label: string, operation: () => Promise<IBaseHalfReferenceEditResult>): Promise<void> {
		const node = this.workspaceNode();
		if (!node) {
			return;
		}
		try {
			this.pushUndo(await operation(), label, node);
		} catch (error) {
			if (error instanceof BaseHalfReferenceEditFailure) {
				this.pushUndo(error.result, label, node);
			} else {
				this.reportReferenceError(error);
			}
		} finally {
			this.scheduleRefresh();
		}
	}

	private pushUndo(result: IBaseHalfReferenceEditResult, label: string, node: IBaseHalfWorkspaceResource): void {
		const slash = node.relativePath.lastIndexOf('/');
		const parent = slash < 0 ? '' : node.relativePath.slice(0, slash);
		const canvas = this.canvasMirrorService.canvasResource({
			resource: parent ? URI.joinPath(node.workspaceFolder, ...parent.split('/')) : node.workspaceFolder,
			workspaceFolder: node.workspaceFolder,
			relativePath: parent,
			source: 'api'
		});
		this.referenceEditService.pushUndoElement(result, {
			label,
			resources: [canvas],
			source: BASEHALF_CANVAS_UNDO_REDO_SOURCE,
			onDidRun: () => this.scheduleRefresh()
		});
	}

	private reportReferenceError(error: unknown): void {
		if (error instanceof BaseHalfReferenceEditFailure) {
			// The edit service already said which files changed.
			return;
		}
		if (error instanceof BaseHalfReferenceEditRefusal) {
			this.notificationService.prompt(Severity.Warning, error.message, []);
			return;
		}
		this.logService.error(error instanceof Error ? error : String(error));
		this.notificationService.error(baseHalfUserFacingErrorMessage(error));
	}

	private async stop(): Promise<void> {
		try {
			await this.generationService.stop(this.resource);
		} catch (error) {
			this.notificationService.notify({ severity: Severity.Warning, message: baseHalfUserFacingErrorMessage(error) });
		} finally {
			this.scheduleRefresh();
		}
	}

	private workspaceNode(): IBaseHalfWorkspaceResource | undefined {
		const snapshot = this.snapshot;
		const folder = this.workspaceContextService.getWorkspaceFolder(this.resource);
		return snapshot && folder ? { resource: this.resource, workspaceFolder: folder.uri, relativePath: snapshot.path } : undefined;
	}

	private entryResource(entry: string): URI {
		const folder = this.workspaceContextService.getWorkspaceFolder(this.resource);
		return folder ? URI.joinPath(folder.uri, ...entry.split('/')) : this.resource;
	}

	/** Where the card keeps its upstream list. */
	private upstreamResource(): URI | undefined {
		const folder = this.workspaceContextService.getWorkspaceFolder(this.resource);
		return folder && this.snapshot ? baseHalfUpstreamSidecarResource(folder.uri, this.snapshot.path) : undefined;
	}

	private promptFocused(): boolean {
		return getWindow(this.textarea).document.activeElement === this.textarea;
	}

	//#endregion

	//#region Focus by key

	private focusedKey(container: HTMLElement): string | undefined {
		const active = getWindow(this.element).document.activeElement;
		return isHTMLElement(active) && container.contains(active) ? active.dataset.key : undefined;
	}

	private findByKey(container: HTMLElement, key: string): HTMLElement | undefined {
		for (const child of container.children) {
			if (isHTMLElement(child)) {
				if (child.dataset.key === key) {
					return child;
				}
				const found = this.findByKey(child, key);
				if (found) {
					return found;
				}
			}
		}
		return undefined;
	}

	private restoreFocus(container: HTMLElement, key: string | undefined): void {
		if (key) {
			this.findByKey(container, key)?.focus({ preventScroll: true });
		}
	}

	//#endregion
}

/** An icon of the codicon font. Its element carries the icon's classes only, never a font of its own. */
function renderCodicon(icon: ThemeIcon, className?: string): HTMLElement {
	const element = renderIcon(icon);
	if (className) {
		element.classList.add(className);
	}
	element.setAttribute('aria-hidden', 'true');
	return element;
}

function addInputLabel(): string {
	return localize('basehalf.video.panel.addInput', "Add Input");
}

const EMPTY_INFO: IBaseHalfGenerationInfo = Object.freeze({ prompt: '' });

/** What the empty prompt of a card of a kind says. */
function placeholderOf(kind: 'image' | 'video'): string {
	return kind === 'image'
		? localize('basehalf.video.panel.imagePromptPlaceholder', "Describe the image. Type @ to name an input.")
		: localize('basehalf.video.panel.promptPlaceholder', "Describe the video. Type @ to name an input.");
}

/** A click of the mouse or a touch. A click that Enter or Space makes on a button has no count. */
function clickedByPointer(event: MouseEvent): boolean {
	return event.detail > 0;
}
