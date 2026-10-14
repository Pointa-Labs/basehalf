/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoNode.css';
import { $, addDisposableListener, append, clearNode, getWindow, isHTMLButtonElement, isHTMLElement } from '../../../base/browser/dom.js';
import { renderIcon } from '../../../base/browser/ui/iconLabel/iconLabels.js';
import { RunOnceScheduler, TimeoutTimer } from '../../../base/common/async.js';
import { Codicon } from '../../../base/common/codicons.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { FileAccess } from '../../../base/common/network.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { isEqual } from '../../../base/common/resources.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { localize } from '../../../nls.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, IBaseHalfCanvasSceneVideoPanelLayout } from '../common/basehalfCanvasScene.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { baseHalfUserFacingErrorMessage } from '../common/basehalfPlainFailureReason.js';
import { BaseHalfReferenceEditFailure, BaseHalfReferenceEditRefusal, IBaseHalfReferenceEditResult, IBaseHalfReferenceEditService } from '../common/basehalfReferenceEdit.js';
import {
	IBaseHalfVideoChannelService,
	IBaseHalfVideoGenerationService,
	IBaseHalfVideoNodeSnapshot,
	IBaseHalfVideoNodeStore,
	IBaseHalfVideoResolvedInput
} from '../common/basehalfVideoGeneration.js';
import {
	BASEHALF_VIDEO_AUTO_DURATION,
	BASEHALF_VIDEO_PROMPT_MAX_LENGTH,
	BaseHalfVideoMode,
	IBaseHalfVideoNodeFields,
	IBaseHalfVideoSettings,
	isBaseHalfVideoTaskActive,
	setBaseHalfVideoGenerationSettings,
	setBaseHalfVideoPrompt
} from '../common/basehalfVideoNode.js';
import {
	baseHalfVideoPanelChangeSettings,
	baseHalfVideoPanelChooseModel,
	baseHalfVideoPanelDurationLabel,
	baseHalfVideoPanelMentionQuery,
	baseHalfVideoPanelPromptMarks,
	baseHalfVideoPanelSoundLabel,
	createBaseHalfVideoPanelPresentation,
	filterBaseHalfVideoPanelNames,
	IBaseHalfVideoPanelChoice,
	IBaseHalfVideoPanelInputItem,
	IBaseHalfVideoPanelName,
	IBaseHalfVideoPanelPresentation
} from '../common/basehalfVideoNodePanelPresentation.js';
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
	 * Asks the user for a file, copies it into the node's folder, and resolves
	 * with the copy's workspace-relative path, or with `undefined` when they
	 * chose none. The panel connects it as an input.
	 */
	importFile(): Promise<string | undefined>;
	/** Moves the focus to the node's card: Escape with no menu open. */
	focusCard(): void;
	/**
	 * Generate ran in another node: a node with a video makes a new node beside
	 * it and generates there. The workbench selects that node's card.
	 */
	didGenerateInNode?(resource: URI): void;
}

export interface IBaseHalfVideoNodePanelOptions {
	/** The node as the workbench already read it, so the panel shows at once. */
	readonly snapshot?: IBaseHalfVideoNodeSnapshot;
	/** Focus the prompt when the panel first shows: the node was just created. */
	readonly focusPromptWhenShown?: boolean;
	/** How long after typing stops the prompt is saved. */
	readonly saveDelay?: number;
}

/** How long after typing stops the prompt is saved. */
export const BASEHALF_VIDEO_PANEL_PROMPT_SAVE_DELAY = 500;

const PANEL_PADDING = 12;
const SECTION_GAP = 8;
const INPUT_ROW_HEIGHT = 40;
const FOOTER_HEIGHT = 32;
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
	/** What the items show, so they are drawn again only when it changes. */
	contentKey?: string;
}

/**
 * The panel under a selected Video node (D58, video node specification, "The
 * panel"): the node's inputs, its prompt, and a footer with the model, the
 * settings, and Generate. It reads and writes the node through the node store,
 * edits its connections through the reference edit service, and keeps its
 * element and its prompt for as long as it lives: updates never replace the
 * prompt, so the text, the selection, and an input method keep their state.
 *
 * The workbench creates one panel for the only selected Video card, gives the
 * scene its {@link element} and {@link height}, calls {@link flush} when the
 * card is deselected, and disposes it.
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

	private snapshot: IBaseHalfVideoNodeSnapshot | undefined;
	private inputs: readonly IBaseHalfVideoResolvedInput[] = [];
	private optimistic: IBaseHalfVideoNodeFields | undefined;
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
		@IBaseHalfVideoNodeStore private readonly store: IBaseHalfVideoNodeStore,
		@IBaseHalfVideoChannelService private readonly channelService: IBaseHalfVideoChannelService,
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
		this.textarea.maxLength = BASEHALF_VIDEO_PROMPT_MAX_LENGTH;
		this.textarea.spellcheck = false;
		this.textarea.placeholder = localize('basehalf.video.panel.promptPlaceholder', "Describe the video. Type @ to name an input.");
		this.textarea.setAttribute('aria-label', localize('basehalf.video.panel.prompt', "Prompt"));
		this.textarea.setAttribute('aria-keyshortcuts', isMacintosh ? 'Meta+Enter' : 'Control+Enter');
		this.promptState = append(this.promptBox, $('.bh-video-panel-prompt-state'));
		this.promptState.append(renderCodicon(Codicon.warning));
		this.promptState.hidden = true;
		this._register(this.hoverService.setupDelayedHover(this.promptState, () => ({ content: this.notSaved ?? '' }), { groupId: HOVER_GROUP }));

		this.notice = append(this.element, $('.bh-video-panel-notice'));
		this.notice.hidden = true;

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

	/** The panel's height in screen pixels, from 132 without an input row to 220 with one. */
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
		await this.writeQueue.catch(() => undefined);
	}

	/** Moves the focus into the prompt, with the caret at the end. */
	focus(): void {
		this.textarea.focus({ preventScroll: true });
		const end = this.textarea.value.length;
		this.textarea.setSelectionRange(end, end);
	}

	/** Reads the node and its inputs again. */
	async refresh(): Promise<void> {
		const sequence = ++this.refreshSequence;
		try {
			const snapshot = await this.store.read(this.resource);
			const inputs = await this.store.resolveInputs(snapshot);
			if (this.disposed || sequence !== this.refreshSequence) {
				return;
			}
			this.applySnapshot(snapshot, inputs);
		} catch (error) {
			if (this.disposed || sequence !== this.refreshSequence) {
				return;
			}
			this.logService.warn('[BaseHalf] the Video panel could not read its node', error);
			this.readError = baseHalfUserFacingErrorMessage(error);
			this.render();
		}
	}

	/** What Generate does: generates when the node can, and stops a generation that runs. */
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
			const running = await this.generationService.generate(this.resource);
			if (!isEqual(running, this.resource)) {
				this.host.didGenerateInNode?.(running);
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
		this.disposed = true;
		this.closeMenu(false);
		super.dispose();
	}

	//#region Reading and writing

	private applySnapshot(snapshot: IBaseHalfVideoNodeSnapshot, inputs: readonly IBaseHalfVideoResolvedInput[] | undefined): void {
		const firstRead = !this.snapshot;
		this.snapshot = snapshot;
		this.readError = undefined;
		if (inputs) {
			this.inputs = inputs;
		}
		const prompt = snapshot.fields.prompt ?? '';
		if (firstRead) {
			this.savedPrompt = prompt;
		}
		if (!this.promptDirty && !this.composing && this.textarea.value !== prompt) {
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

	/** The fields the panel shows: the file's, or what a write on its way makes of them. */
	private fields(): IBaseHalfVideoNodeFields {
		return this.optimistic ?? this.snapshot?.fields ?? {};
	}

	/** Writes the node through the store, one write after the other. */
	private write(mutate: (fields: IBaseHalfVideoNodeFields) => IBaseHalfVideoNodeFields): Promise<IBaseHalfVideoNodeSnapshot> {
		const run = () => this.store.update(this.resource, mutate);
		const written = this.writeQueue.then(run, run);
		this.writeQueue = written.catch(() => undefined);
		return written;
	}

	/** Changes the settings or the model: shown at once, saved right after. */
	private async writeSettings(mutate: (fields: IBaseHalfVideoNodeFields) => IBaseHalfVideoNodeFields): Promise<void> {
		this.optimistic = mutate(this.fields());
		this.optimisticWrites++;
		this.render();
		try {
			const snapshot = await this.write(mutate);
			if (!this.disposed) {
				this.snapshot = snapshot;
				this.setNotSaved(undefined);
			}
		} catch (error) {
			this.logService.warn('[BaseHalf] the Video panel could not save the settings', error);
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
			const snapshot = await this.write(fields => setBaseHalfVideoPrompt(fields, value));
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
			this.logService.warn('[BaseHalf] the Video panel could not save the prompt', error);
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
		this._register(this.store.onDidWrite(resource => {
			if (isEqual(resource, this.resource)) {
				this.scheduleRefresh();
			}
		}));
		this._register(this.fileService.onDidFilesChange(event => {
			if (event.affects(this.resource) || this.inputs.some(input => input.file && event.affects(input.file))
				|| this.snapshot?.upstream.some(entry => event.affects(this.entryResource(entry)))) {
				this.scheduleRefresh();
			}
		}));
		this._register(this.channelService.onDidChange(() => this.render()));
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

		this._register(addDisposableListener(this.modelButton, 'click', () => this.toggleMenu('model', this.modelButton)));
		this._register(addDisposableListener(this.settingsButton, 'click', () => this.toggleMenu('settings', this.settingsButton)));
		this._register(addDisposableListener(this.generateButton, 'click', () => { void this.generate(); }));
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
		const fields = this.fields();
		const generation = fields.generation;
		const choice = this.channelService.resolve({
			...(generation?.channel !== undefined ? { channel: generation.channel } : {}),
			...(generation?.model !== undefined ? { model: generation.model } : {})
		});
		this.presentation = createBaseHalfVideoPanelPresentation({
			fields,
			inputs: this.inputs,
			channels: this.channelService.getChannels(),
			choice,
			generating: this.generationService.isGenerating(this.resource) || isBaseHalfVideoTaskActive(fields.task),
			prompt: this.textarea.value
		});
		this.element.dataset.state = 'ready';
		this.element.setAttribute('aria-label', localize('basehalf.video.panel.label', "Video panel for {0}", snapshot.title));
		this.renderNotice();
		this.renderInputRow();
		this.renderOverlay();
		this.renderFooter();
		this.refreshMenu();
		this.updateHeight();
	}

	private renderNotice(): void {
		const unreadable = !this.snapshot && this.readError !== undefined;
		this.notice.hidden = !unreadable;
		this.promptBox.hidden = unreadable;
		if (unreadable) {
			this.notice.textContent = localize('basehalf.video.panel.unreadable', "This Video node cannot be read: {0}", this.readError ?? '');
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
			this.rowStore.add(addDisposableListener(empty, 'click', () => this.toggleMenu('add', empty)));
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
		this.rowStore.add(addDisposableListener(add, 'click', () => this.toggleMenu('add', add)));
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
		this.overlay.append(`${text.slice(offset)}​`);
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
		this.settingsLabel.textContent = presentation.settingsView.summary;
		this.settingsButton.setAttribute('aria-label', this.settingsTitle());
		const generate = presentation.generate;
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

	private settingsTitle(): string {
		return this.presentation
			? localize('basehalf.video.panel.settingsLabel', "Settings: {0}", this.presentation.settingsView.summary)
			: localize('basehalf.video.panel.settings', "Settings");
	}

	private generateTitle(): string {
		return this.presentation?.generate.title ?? '';
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
		this.measure.textContent = `${this.textarea.value}​`;
		const height = this.measure.offsetHeight - PROMPT_PADDING * 2;
		const lines = Math.round(height / PROMPT_LINE_HEIGHT);
		return Math.min(PROMPT_MAX_LINES, Math.max(PROMPT_MIN_LINES, lines));
	}

	private computeHeight(withInputRow: boolean): number {
		const row = withInputRow ? INPUT_ROW_HEIGHT + SECTION_GAP : 0;
		const prompt = this.promptLines * PROMPT_LINE_HEIGHT + PROMPT_PADDING * 2;
		const height = PANEL_PADDING + row + prompt + SECTION_GAP + FOOTER_HEIGHT + PANEL_PADDING;
		return Math.min(BASEHALF_VIDEO_PANEL_MAX_HEIGHT, Math.max(BASEHALF_VIDEO_PANEL_MIN_HEIGHT, height));
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

	private toggleMenu(kind: Exclude<BaseHalfVideoPanelMenuKind, 'mention'>, trigger: HTMLElement): void {
		if (this.openMenu?.kind === kind && this.openMenu.trigger === trigger) {
			this.closeMenu(true);
			return;
		}
		this.showMenu(kind, trigger);
	}

	private showMenu(kind: BaseHalfVideoPanelMenuKind, trigger: HTMLElement): void {
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
			align: 'start'
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
			this.showMenu(menu.kind, replacement);
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
			case 'settings': return JSON.stringify([presentation?.profile.id, presentation?.settingsView]);
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
		const window = getWindow(this.element);
		return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
	}

	private onMenuKeyDown(event: KeyboardEvent, menu: IOpenMenu): void {
		if (menu.kind === 'settings' || menu.kind === 'mention') {
			return;
		}
		const items = this.menuItems(menu.element);
		const index = items.findIndex(item => item === getWindow(this.element).document.activeElement);
		let next: number | undefined;
		if (event.key === 'ArrowDown') {
			next = (index + 1) % items.length;
		} else if (event.key === 'ArrowUp') {
			next = (index - 1 + items.length) % items.length;
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

	private focusFirstMenuItem(menu: IOpenMenu): void {
		const items = this.menuItems(menu.element);
		const checked = items.find(item => item.getAttribute('aria-checked') === 'true');
		(checked ?? items[0])?.focus({ preventScroll: true });
	}

	private menuItem(parent: HTMLElement, label: string, run: () => void, options?: { readonly role?: string; readonly checked?: boolean; readonly key?: string; readonly title?: string; readonly icon?: ThemeIcon }): HTMLButtonElement {
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
		append(item, $('span.bh-video-panel-menu-label')).textContent = label;
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
		element.setAttribute('role', 'menu');
		element.setAttribute('aria-label', localize('basehalf.video.panel.models', "Models"));
		for (const group of presentation.modelMenu.groups) {
			const section = append(element, $('.bh-video-panel-menu-group'));
			section.setAttribute('role', 'group');
			section.setAttribute('aria-label', group.label);
			const heading = append(section, $('.bh-video-panel-menu-heading'));
			heading.setAttribute('aria-hidden', 'true');
			append(heading, $('span.bh-video-panel-menu-heading-label')).textContent = group.label;
			if (group.detail) {
				append(heading, $('span.bh-video-panel-menu-heading-detail')).textContent = group.detail;
			}
			if (group.empty) {
				append(section, $('.bh-video-panel-menu-empty')).textContent = group.empty;
			}
			for (const item of group.items) {
				this.menuItem(section, item.label, () => {
					this.closeMenu(true);
					const channel = this.channelService.getChannel(item.channel);
					if (channel) {
						void this.writeSettings(fields => setBaseHalfVideoGenerationSettings(fields, baseHalfVideoPanelChooseModel(fields.generation, channel, item.model)));
					}
				}, { role: 'menuitemradio', checked: item.checked, key: `model:${item.channel}:${item.model}`, title: item.title });
			}
		}
		if (presentation.modelMenu.groups.length) {
			append(element, $('.bh-video-panel-menu-separator')).setAttribute('role', 'separator');
		}
		this.menuItem(element, presentation.modelMenu.settingsLabel, () => {
			this.closeMenu(false);
			void this.channelService.openSettings().catch(error => this.logService.error(error));
		}, { key: 'providers', icon: presentation.modelMenu.groups.length ? Codicon.settingsGear : Codicon.add });
	}

	private fillSettings(element: HTMLElement): void {
		const presentation = this.presentation;
		if (!presentation) {
			return;
		}
		const view = presentation.settingsView;
		const profile = presentation.profile;
		element.setAttribute('role', 'dialog');
		element.setAttribute('aria-label', localize('basehalf.video.panel.settingsTitle', "Video Settings"));
		const change = (settings: Partial<IBaseHalfVideoSettings>) => {
			void this.writeSettings(fields => setBaseHalfVideoGenerationSettings(fields, baseHalfVideoPanelChangeSettings(fields.generation, settings, profile)));
		};
		if (view.modes) {
			this.radioGroup(element, 'mode', localize('basehalf.video.panel.setting.mode', "Mode"), view.modes, (mode: BaseHalfVideoMode) => change({ mode }));
		}
		if (view.ratios) {
			const section = this.radioGroup(element, 'ratio', localize('basehalf.video.panel.setting.ratio', "Ratio"), view.ratios.choices, (ratio: string) => change({ ratio }), (button, choice) => {
				const shape = append(button, $('span.bh-video-panel-ratio-shape'));
				const ratioChoice = view.ratios?.choices.find(candidate => candidate.value === choice.value);
				if (ratioChoice?.shape) {
					const scale = 16 / Math.max(ratioChoice.shape.width, ratioChoice.shape.height);
					shape.style.width = `${Math.max(4, Math.round(ratioChoice.shape.width * scale))}px`;
					shape.style.height = `${Math.max(4, Math.round(ratioChoice.shape.height * scale))}px`;
				} else {
					shape.classList.add('adaptive');
				}
			});
			section.classList.add('ratios');
			if (view.ratios.note) {
				append(section, $('.bh-video-panel-setting-note')).textContent = view.ratios.note;
			}
		}
		if (view.resolutions) {
			this.radioGroup(element, 'resolution', localize('basehalf.video.panel.setting.resolution', "Resolution"), view.resolutions, (resolution: string) => change({ resolution }));
		}
		const duration = view.duration;
		const durationLabel = localize('basehalf.video.panel.setting.duration', "Duration");
		if (duration.kind === 'choices') {
			this.radioGroup(element, 'duration', durationLabel, duration.choices, (value: number) => change({ duration: value }));
		} else {
			const section = this.settingSection(element, durationLabel);
			const row = append(section, $('.bh-video-panel-duration'));
			const slider = append(row, $<HTMLInputElement>('input.bh-video-panel-slider'));
			slider.type = 'range';
			slider.min = String(duration.min);
			slider.max = String(duration.max);
			slider.step = '1';
			slider.value = String(duration.value);
			slider.dataset.key = 'duration:slider';
			slider.setAttribute('aria-label', durationLabel);
			const auto = duration.auto?.selected === true;
			slider.disabled = auto;
			const value = append(row, $('span.bh-video-panel-duration-value'));
			value.textContent = duration.valueLabel;
			slider.addEventListener('input', () => {
				value.textContent = baseHalfVideoPanelDurationLabel(Number(slider.value));
			});
			slider.addEventListener('change', () => change({ duration: Number(slider.value) }));
			if (duration.auto) {
				const toggle = this.switchButton(row, duration.auto.label, auto, 'duration:auto', on => change({ duration: on ? BASEHALF_VIDEO_AUTO_DURATION : profile.defaults.duration }));
				toggle.classList.add('auto');
			}
		}
		if (view.sound) {
			const section = this.settingSection(element, localize('basehalf.video.panel.setting.sound', "Sound"));
			this.switchButton(section, baseHalfVideoPanelSoundLabel(view.sound.on), view.sound.on, 'sound', on => change({ audio: on }));
		}
	}

	private settingSection(parent: HTMLElement, label: string): HTMLElement {
		const section = append(parent, $('.bh-video-panel-setting'));
		append(section, $('.bh-video-panel-setting-label')).textContent = label;
		return section;
	}

	private radioGroup<T extends string | number>(
		parent: HTMLElement,
		key: string,
		label: string,
		choices: readonly IBaseHalfVideoPanelChoice<T>[],
		choose: (value: T) => void,
		decorate?: (button: HTMLElement, choice: IBaseHalfVideoPanelChoice<T>) => void
	): HTMLElement {
		// Returns the section, which holds the label, the choices, and any note.
		const section = this.settingSection(parent, label);
		const group = append(section, $('.bh-video-panel-choices'));
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-label', label);
		const buttons: HTMLButtonElement[] = [];
		const selectedIndex = Math.max(0, choices.findIndex(choice => choice.selected));
		choices.forEach((choice, index) => {
			const button = append(group, $<HTMLButtonElement>('button.bh-video-panel-choice'));
			button.type = 'button';
			button.dataset.key = `${key}:${choice.value}`;
			button.setAttribute('role', 'radio');
			button.setAttribute('aria-checked', String(choice.selected));
			button.tabIndex = index === selectedIndex ? 0 : -1;
			if (choice.disabled) {
				button.setAttribute('aria-disabled', 'true');
			}
			decorate?.(button, choice);
			append(button, $('span.bh-video-panel-choice-label')).textContent = choice.label;
			if (choice.title) {
				const title = choice.title;
				this.openMenu?.content.add(this.hoverService.setupDelayedHover(button, () => ({ content: title }), { groupId: HOVER_GROUP }));
			}
			button.addEventListener('click', () => {
				if (!choice.disabled && !choice.selected) {
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
			const choice = choices[next];
			if (!choice.disabled && !choice.selected) {
				choose(choice.value);
			}
		});
		return section;
	}

	private switchButton(parent: HTMLElement, label: string, on: boolean, key: string, toggle: (on: boolean) => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.bh-video-panel-switch'));
		button.type = 'button';
		button.dataset.key = key;
		button.setAttribute('role', 'switch');
		button.setAttribute('aria-checked', String(on));
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
		marker.textContent = '​';
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
