/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoNode.css';
import { $, addDisposableListener, append, getWindow, isHTMLElement, isHTMLInputElement } from '../../../../base/browser/dom.js';
import { DeferredPromise, RunOnceScheduler, TimeoutTimer } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { basename, isEqual } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IBaseHalfCanvasCardPick } from '../../canvas/common/basehalfCanvasCardPick.js';
import { IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import { BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, IBaseHalfCanvasSceneVideoPanelLayout } from '../../canvas/common/basehalfCanvasScene.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfUserFacingErrorMessage } from '../../workspace/common/basehalfPlainFailureReason.js';
import { IBaseHalfReferenceEditService } from '../../references/common/basehalfReferenceEdit.js';
import { BASEHALF_VIDEO_IMAGE_FORMATS, BaseHalfModelKind, BaseHalfTakenInputKind, BaseHalfVideoImageFormat, findBaseHalfVideoModel, IBaseHalfVideoCheckRequest, IBaseHalfVideoCheckResult, IBaseHalfVideoInputPlanItem } from '../common/basehalfVideoCatalog.js';
import { BaseHalfVideoGenerationError, IBaseHalfGenerationCardActions, IBaseHalfGenerationCardSnapshot, IBaseHalfGenerationCardStore, IBaseHalfVideoCatalogService, IBaseHalfVideoGenerationService, IBaseHalfVideoProviderSettingsService, IBaseHalfVideoResolvedInput } from '../common/basehalfVideoGeneration.js';
import { BASEHALF_GENERATION_PROMPT_MAX_LENGTH, IBaseHalfGenerationInfo, setBaseHalfGenerationPrompt } from '../common/basehalfGenerationInfo.js';
import { baseHalfUpstreamSidecarResource } from '../../references/common/basehalfReferenceStore.js';
import { baseHalfVideoPanelPlaceholder, createBaseHalfVideoPanelPresentation, IBaseHalfVideoPanelInputItem, IBaseHalfVideoPanelPresentation } from '../common/basehalfVideoNodePanelPresentation.js';
import { IBaseHalfPromptMention } from '../common/basehalfGenerationMentions.js';
import { baseHalfVoiceNeedsList, IBaseHalfGenerationVoiceService } from '../common/basehalfGenerationVoices.js';
import { BaseHalfGenerationAddButtons } from './basehalfGenerationAddButtons.js';
import { BaseHalfGenerationInputRow, IBaseHalfInputRowModel, IBaseHalfInputTile } from './basehalfGenerationInputRow.js';
import { BaseHalfGenerationPromptEditor, baseHalfPromptChip, IBaseHalfPromptChip } from './basehalfGenerationPromptEditor.js';
import { BaseHalfGenerationReferenceMenu } from './basehalfGenerationReferenceMenu.js';
import { IBaseHalfClipboardService } from '../../clipboard/common/basehalfClipboard.js';
import { baseHalfDragHoldsTransfer } from '../../clipboard/browser/basehalfTransfer.js';
import { BaseHalfTransferPart } from '../../clipboard/browser/basehalfTransferFiles.js';
import { BASEHALF_VIDEO_PANEL_MAX_HEIGHT, BASEHALF_VIDEO_PANEL_MIN_HEIGHT } from '../common/basehalfVideoNodePanelPlacement.js';
import { IBaseHalfDraftOperations } from '../../upkeep/common/basehalfDraftOperations.js';
import { readBaseHalfVideoTextInput } from './basehalfGenerationInputReading.js';
import { HOVER_GROUP, PROMPT_LINE_HEIGHT, renderCodicon, IOpenMenu } from './basehalfGenerationPanelShared.js';
import { BaseHalfGenerationPanelMenus } from './basehalfGenerationPanelMenus.js';
import { BaseHalfGenerationPanelChoices } from './basehalfGenerationPanelChoices.js';
import { BaseHalfGenerationPanelReferences } from './basehalfGenerationPanelReferences.js';
import { BaseHalfGenerationPanelInputs } from './basehalfGenerationPanelInputs.js';

/**
 * What the panel needs from the canvas. The workbench implements it.
 */
export interface IBaseHalfVideoNodePanelHost {
	/**
	 * Pick on Canvas (D69): until the result is disposed or the canvas calls
	 * `pick.ended`, a click on a card of the canvas goes to `pick`, which says
	 * what a click on each card does.
	 */
	startPick(pick: IBaseHalfCanvasCardPick): IDisposable;
	/**
	 * Asks the user for a file, copies it into the card's folder, and resolves
	 * with the copy's workspace-relative path, or with `undefined` when they
	 * chose none. `accept` is asked first with the path the file would have,
	 * and nothing is copied when it refuses. The panel connects it as an input.
	 */
	/** `kinds` are the kinds of input its dialog offers: those some model of the card's kind takes (D90). */
	importFile(accept: (path: string) => Promise<boolean>, kinds: readonly BaseHalfTakenInputKind[]): Promise<string | undefined>;
	/**
	 * The input that one thing of a paste or a drop gives (copy, paste, and
	 * drop, "The input row of a draft"), as a workspace-relative path: an item
	 * of the card's workspace folder where it is, a file from elsewhere copied
	 * into the card's folder, a picture or text made a file there. `accept` is
	 * asked first with the path, and nothing is copied or made when it refuses.
	 */
	takeInput(part: BaseHalfTransferPart, accept: (path: string) => Promise<boolean>): Promise<string | undefined>;
	/** Moves the focus to the card: Escape with no menu open. */
	focusCard(): void;
	/**
	 * The panel changed the card's connections, or such a change was undone or
	 * done again: the canvas reads the folder again at once, instead of
	 * waiting to learn of it from the file.
	 */
	didChangeConnections?(): void;
	/**
	 * The panel drew the card's inputs anew, for the card's upstream list
	 * `upstream`: the canvas draws the lines into the card from the same list
	 * at once, so that a line changes with its tile.
	 */
	didShowInputs?(upstream: readonly string[]): void;
	/**
	 * Generate ran on another card: a card with its file makes a new draft
	 * beside it and generates there. The workbench selects that card.
	 */
	didGenerateInNode?(resource: URI): void;
	/**
	 * The draft was renamed, as a model that delivers another format renames
	 * an image or an audio draft (generation cards, "Creating a generation
	 * card"). The workbench shows the panel of the card at its new name.
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

/**
 * The parts of a draft's panel (generation cards, "The panel"), which the
 * panel makes and keeps working and each kind's panel places (D91).
 */
export interface IBaseHalfDraftPanelParts {
	/** The card's connections as tiles (D68). */
	readonly inputRow: BaseHalfGenerationInputRow;
	/** Pick on Canvas and Import File… (D71). */
	readonly addButtons: BaseHalfGenerationAddButtons;
	/** The prompt, with the warning in its corner while it could not be saved. */
	readonly prompt: HTMLElement;
	/** What the panel says of a card it cannot read. */
	readonly notice: HTMLElement;
	/** Why Generate cannot run, with the action that fixes it (D70). */
	readonly reason: HTMLElement;
	/** The model of the card's kind and its menu. */
	readonly model: HTMLButtonElement;
	/** The voice of a model that speaks (D78). */
	readonly voice: HTMLButtonElement;
	/** The summary of the settings, which opens them. */
	readonly settings: HTMLButtonElement;
	/** Generate, or Stop while the card generates. */
	readonly generate: HTMLButtonElement;
}

/** How long after typing stops the prompt is saved. */
export const BASEHALF_VIDEO_PANEL_PROMPT_SAVE_DELAY = 500;
/** How long after the model, mode, values, prompt, or inputs change the panel asks for the problems. */
export const BASEHALF_VIDEO_PANEL_CHECK_DELAY = 250;

const PANEL_PADDING = 12;
const SECTION_GAP = 8;
const INPUT_ROW_HEIGHT = 48;
const FOOTER_HEIGHT = 32;
/** The reason line: one line beside its action, or two lines of text. */
const REASON_MIN_HEIGHT = 20;
const REASON_MAX_HEIGHT = 32;
const PROMPT_PADDING = 4;
const PROMPT_MIN_LINES = 3;
const PROMPT_MAX_LINES = 5;

/** A check the panel asks with the files a generation would send. */
interface IPendingCheck {
	readonly request: Omit<IBaseHalfVideoCheckRequest, 'inputs'>;
	readonly plan: readonly IBaseHalfVideoInputPlanItem[];
	readonly inputs: readonly IBaseHalfVideoResolvedInput[];
	readonly imageFormats: readonly BaseHalfVideoImageFormat[];
}

/**
 * The panel under a selected draft (D63, D64, D78, generation cards, "The
 * panel"), named for the Video node it began as: the parts every kind's panel
 * is made of and the rules they keep wherever a kind places them (D91). Its
 * parts are the card's inputs, its prompt, and a footer with the two buttons
 * that add an input at its start and the settings, the voice of a model that
 * speaks, the model of the card's kind, and Generate at its end (D106), all
 * drawn from the model catalog. It
 * reads and writes the card's generation information through the card store,
 * edits its connections through the reference edit service, and generates and
 * stops through the generation service. It keeps its element
 * and its prompt for as long as it lives: updates never replace the prompt
 * while the user types in it, so the text, the selection, and an input method
 * keep their state.
 *
 * Each kind's panel ({@link arrange}, {@link inputRowModel}) places the parts
 * and chooses what its input row shows: an image card's in
 * `basehalfImageDraftPanel.ts`, a video card's in `basehalfVideoDraftPanel.ts`,
 * and an audio card's in `basehalfAudioDraftPanel.ts`.
 *
 * The workbench creates one panel for the only selected generation card,
 * gives the scene its {@link element} and {@link height}, calls {@link flush}
 * when the card is deselected, and disposes it.
 */
export abstract class BaseHalfVideoNodePanel extends Disposable {

	// The parts, one concern each; they reach this object as `panel`.
	/** The menu that opens from a button of the panel */
	readonly menus = new BaseHalfGenerationPanelMenus(this);
	/** What the menus hold: what to add, the models, the voices, and the settings */
	readonly choices = new BaseHalfGenerationPanelChoices(this);
	/** The `@` menu and the mentions in the prompt */
	readonly references = new BaseHalfGenerationPanelReferences(this);
	/** Changing the card's inputs */
	readonly inputChanges = new BaseHalfGenerationPanelInputs(this);

	readonly element: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<number>());
	/** Fires when the panel's height changes; the workbench publishes the scene surface again. */
	readonly onDidChangeHeight: Event<number> = this._onDidChangeHeight.event;

	/** Settles when the first read of the card and its inputs is drawn, or could not be made. */
	private readonly firstRead = new DeferredPromise<void>();

	/** The card's connections as tiles (D68). */
	readonly inputRow: BaseHalfGenerationInputRow;
	/** Pick on Canvas and Import File…, at the start of the footer of every kind (D71, D106). */
	private readonly addButtons: BaseHalfGenerationAddButtons;
	private readonly promptBox: HTMLElement;
	/** The prompt, whose names of inputs are chips (D68). */
	readonly editor: BaseHalfGenerationPromptEditor;
	private readonly promptState: HTMLElement;
	private readonly notice: HTMLElement;
	private readonly reason: HTMLElement;
	private readonly reasonText: HTMLElement;
	private readonly reasonAction: HTMLButtonElement;
	private readonly modelButton: HTMLButtonElement;
	private readonly modelLabel: HTMLElement;
	/** The voice of a model that speaks, between the settings and the model (D78, D106). */
	private readonly voiceButton: HTMLButtonElement;
	private readonly voiceLabel: HTMLElement;
	private readonly settingsButton: HTMLButtonElement;
	private readonly settingsLabel: HTMLElement;
	private readonly generateButton: HTMLButtonElement;
	private readonly generateIcon: HTMLElement;
	readonly layer: HTMLElement;

	readonly menu = this._register(new MutableDisposable<DisposableStore>());
	/** The reference menu that `@` opened, and where its `@` is in the prompt. */
	readonly referenceMenu = this._register(new MutableDisposable<BaseHalfGenerationReferenceMenu>());
	/** The inputs the chips of the prompt were drawn for. */
	private chipInputsKey: string | undefined;
	private readonly saveTimer = this._register(new TimeoutTimer());
	private saveScheduled = false;
	openMenu: IOpenMenu | undefined;

	snapshot: IBaseHalfGenerationCardSnapshot | undefined;
	inputs: readonly IBaseHalfVideoResolvedInput[] = [];
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
	moreOpen = false;
	private optimistic: IBaseHalfGenerationInfo | undefined;
	private optimisticWrites = 0;
	presentation: IBaseHalfVideoPanelPresentation | undefined;
	private readError: string | undefined;
	private refreshSequence = 0;
	/** The upstream list whose inputs the panel drew last, as the host was told it. */
	private shownUpstream: string | undefined;
	private readonly refreshScheduler = this._register(new RunOnceScheduler(() => { void this.refresh(); }, 0));
	private writeQueue: Promise<unknown> = Promise.resolve();
	private savedPrompt: string | undefined;
	private promptDirty = false;
	private notSaved: string | undefined;
	private promptLines = PROMPT_MIN_LINES;
	private currentHeight: number;
	layout: IBaseHalfCanvasSceneVideoPanelLayout | undefined;
	private focusWhenShown: boolean;
	private starting = false;
	/** What the Generate button was drawn as last: Generate or Stop. */
	private generateKind: 'generate' | 'stop' | undefined;
	private modelTitle: string | undefined;
	/** Pick on Canvas while it is on (D69). */
	readonly pick = this._register(new MutableDisposable<IDisposable>());
	readonly _onDidChangePick = this._register(new Emitter<void>());
	/** What a click on each card does depends on this: when it changes, the canvas asks again. */
	pickKey: string | undefined;
	/** The panel's width when the prompt was last measured. */
	private measuredWidth: number | undefined;
	private readonly saveDelay: number;
	disposed = false;

	constructor(
		public readonly resource: URI,
		public readonly host: IBaseHalfVideoNodePanelHost,
		options: IBaseHalfVideoNodePanelOptions | undefined,
		@IBaseHalfGenerationCardStore public readonly store: IBaseHalfGenerationCardStore,
		@IBaseHalfDraftOperations public readonly draftOperations: IBaseHalfDraftOperations,
		@IBaseHalfVideoCatalogService public readonly catalogService: IBaseHalfVideoCatalogService,
		@IBaseHalfVideoProviderSettingsService public readonly providerSettings: IBaseHalfVideoProviderSettingsService,
		@IBaseHalfVideoGenerationService private readonly generationService: IBaseHalfVideoGenerationService,
		@IBaseHalfGenerationCardActions public readonly cardActions: IBaseHalfGenerationCardActions,
		@IBaseHalfGenerationVoiceService private readonly voiceService: IBaseHalfGenerationVoiceService,
		@IBaseHalfReferenceEditService public readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfCanvasMirrorService public readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService public readonly fileService: IFileService,
		@IHoverService public readonly hoverService: IHoverService,
		@INotificationService public readonly notificationService: INotificationService,
		@IInstantiationService public readonly instantiationService: IInstantiationService,
		@ILogService public readonly logService: ILogService,
		@IBaseHalfClipboardService public readonly clipboardService: IBaseHalfClipboardService
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
		// A press on the panel where it has no control gives it the keyboard,
		// so that a paste there goes into its inputs, not onto the canvas.
		this.element.tabIndex = -1;
		// A paste in the input row, and a drop anywhere on the panel but its
		// prompt, adds inputs (copy, paste, and drop, "The input row of a draft").
		this._register(addDisposableListener(this.element, 'paste', event => {
			if (event.defaultPrevented || this.editor.element.contains(event.target as Node) || isHTMLInputElement(event.target)) {
				return;
			}
			event.preventDefault();
			void this.inputChanges.pasteTransfer(false);
		}));
		this._register(addDisposableListener(this.element, 'dragover', event => {
			if (baseHalfDragHoldsTransfer(event.dataTransfer)) {
				event.preventDefault();
				event.dataTransfer!.dropEffect = 'copy';
			}
		}));
		this._register(addDisposableListener(this.element, 'drop', event => {
			if (event.defaultPrevented || !event.dataTransfer || !baseHalfDragHoldsTransfer(event.dataTransfer)) {
				return;
			}
			event.preventDefault();
			void this.inputChanges.dropTransfer(event.dataTransfer, false);
		}));

		// Menus and the look at an input lie over everything else of the panel; the layer is added last.
		this.layer = $('.bh-video-panel-layer');
		this.inputRow = this._register(new BaseHalfGenerationInputRow({
			remove: path => { void this.inputChanges.disconnect(path); },
			insertMention: path => this.references.insertMention(path),
			move: (path, before) => { void this.inputChanges.moveInput(path, before); },
			swap: () => {
				const order = this.presentation?.inputRow?.swappedUpstream;
				if (order) {
					void this.inputChanges.reorder(order);
				}
			},
			openAddMenu: (trigger, byPointer) => {
				// An empty frame while picking ends picking, as Pick on Canvas does.
				if (this.inputChanges.picking) {
					this.inputChanges.endPick();
				} else {
					this.menus.toggleMenu('add', trigger, byPointer);
				}
			},
			canvasBounds: () => this.menus.canvasRect(this.element.getBoundingClientRect())
		}, this.layer));
		this.inputRow.element.hidden = true;
		this.addButtons = this._register(new BaseHalfGenerationAddButtons({
			togglePick: () => {
				this.menus.closeMenu(false);
				if (this.inputChanges.picking) {
					this.inputChanges.endPick();
				} else {
					this.inputChanges.startPick();
				}
			},
			importFile: () => {
				this.menus.closeMenu(false);
				void this.inputChanges.importFile();
			},
			setupHover: (element, content) => this.hoverService.setupDelayedHover(element, () => ({ content }), { groupId: HOVER_GROUP })
		}));
		// Shown once the card is read, as the input row is.
		this.addButtons.element.hidden = true;

		this.promptBox = $('.bh-video-panel-prompt');
		this.editor = this._register(new BaseHalfGenerationPromptEditor({
			ariaLabel: localize('basehalf.video.panel.prompt', "Prompt"),
			placeholder: baseHalfVideoPanelPlaceholder(options?.snapshot?.kind ?? 'video'),
			maxLength: BASEHALF_GENERATION_PROMPT_MAX_LENGTH,
			chipOf: mention => this.chipOf(mention),
			// Files and pictures pasted or dropped into the prompt become inputs and are mentioned (copy, paste, and drop).
			pasteFiles: () => { void this.inputChanges.pasteTransfer(true); },
			dropTransfer: dataTransfer => { void this.inputChanges.dropTransfer(dataTransfer, true); }
		}));
		// The field grows with its text from three lines to five, and scrolls beyond.
		Object.assign(this.editor.element.style, {
			height: 'auto',
			minHeight: `${PROMPT_MIN_LINES * PROMPT_LINE_HEIGHT + PROMPT_PADDING * 2}px`,
			maxHeight: `${PROMPT_MAX_LINES * PROMPT_LINE_HEIGHT + PROMPT_PADDING * 2}px`
		});
		this.editor.element.setAttribute('aria-keyshortcuts', isMacintosh ? 'Meta+Enter' : 'Control+Enter');
		this.promptBox.append(this.editor.element);
		this.promptState = append(this.promptBox, $('.bh-video-panel-prompt-state'));
		this.promptState.append(renderCodicon(Codicon.warning));
		this.promptState.hidden = true;
		this._register(this.hoverService.setupDelayedHover(this.promptState, () => ({ content: this.notSaved ?? '' }), { groupId: HOVER_GROUP }));

		this.notice = $('.bh-video-panel-notice');
		this.notice.hidden = true;

		// Why Generate cannot run, with the action that fixes it.
		this.reason = $('.bh-video-panel-reason');
		this.reason.hidden = true;
		this.reason.append(renderCodicon(Codicon.warning, 'bh-video-panel-reason-icon'));
		this.reasonText = append(this.reason, $('span.bh-video-panel-reason-text'));
		this.reasonText.setAttribute('role', 'status');
		this.reasonAction = append(this.reason, $<HTMLButtonElement>('button.bh-video-panel-reason-action'));
		this.reasonAction.type = 'button';
		this.reasonAction.hidden = true;
		// The whole reason when two lines cut it.
		this._register(this.hoverService.setupDelayedHover(this.reasonText, () => ({ content: this.reasonText.scrollHeight > this.reasonText.clientHeight + 1 ? this.presentation?.reason?.text ?? '' : '' }), { groupId: HOVER_GROUP }));

		this.modelButton = $<HTMLButtonElement>('button.bh-video-panel-model');
		this.modelButton.type = 'button';
		this.modelButton.setAttribute('aria-haspopup', 'menu');
		this.modelButton.setAttribute('aria-expanded', 'false');
		this.modelLabel = append(this.modelButton, $('span.bh-video-panel-model-label'));
		this.modelButton.append(renderCodicon(Codicon.chevronDown, 'bh-video-panel-chevron'));
		// The glyph of a voice and the voice's name, for a model that has one (D78).
		this.voiceButton = $<HTMLButtonElement>('button.bh-video-panel-voice');
		this.voiceButton.type = 'button';
		this.voiceButton.hidden = true;
		this.voiceButton.setAttribute('aria-haspopup', 'dialog');
		this.voiceButton.setAttribute('aria-expanded', 'false');
		this.voiceButton.append(renderCodicon(Codicon.voiceMode, 'bh-video-panel-voice-icon'));
		this.voiceLabel = append(this.voiceButton, $('span.bh-video-panel-voice-label'));
		this.settingsButton = $<HTMLButtonElement>('button.bh-video-panel-settings');
		this.settingsButton.type = 'button';
		this.settingsButton.setAttribute('aria-haspopup', 'dialog');
		this.settingsButton.setAttribute('aria-expanded', 'false');
		this.settingsLabel = append(this.settingsButton, $('span.bh-video-panel-settings-label'));
		this.generateButton = $<HTMLButtonElement>('button.bh-video-panel-generate');
		this.generateButton.type = 'button';
		this.generateButton.setAttribute('aria-keyshortcuts', isMacintosh ? 'Meta+Enter' : 'Control+Enter');
		this.generateIcon = append(this.generateButton, renderCodicon(Codicon.arrowUp));
		this._register(this.hoverService.setupDelayedHover(this.modelButton, () => ({ content: this.presentation?.model.title ?? '' }), { groupId: HOVER_GROUP }));
		this._register(this.hoverService.setupDelayedHover(this.voiceButton, () => ({ content: this.presentation?.voice?.title ?? '' }), { groupId: HOVER_GROUP }));
		this._register(this.hoverService.setupDelayedHover(this.settingsButton, () => ({ content: this.settingsTitle() }), { groupId: HOVER_GROUP }));
		this._register(this.hoverService.setupDelayedHover(this.generateButton, () => ({ content: this.generateTitle() }), { groupId: HOVER_GROUP }));

		// The card's kind places the parts (D91).
		this.arrange(this.element, {
			inputRow: this.inputRow,
			addButtons: this.addButtons,
			prompt: this.promptBox,
			notice: this.notice,
			reason: this.reason,
			model: this.modelButton,
			voice: this.voiceButton,
			settings: this.settingsButton,
			generate: this.generateButton
		});
		append(this.element, this.layer);

		this.currentHeight = this.computeHeight(this.showsInputRowBeforeRead());
		this.element.style.height = `${this.currentHeight}px`;

		this.registerListeners();
		if (options?.snapshot && isEqual(options.snapshot.resource, resource)) {
			this.applySnapshot(options.snapshot, undefined);
		}
		void this.refresh();
	}

	/** The panel's height in screen pixels, from 132 without an input row to 268 with one and a reason line of two lines. */
	get height(): number {
		return this.currentHeight;
	}

	/**
	 * Settles once the panel has drawn its first read of the card and its
	 * inputs, or what kept it from reading them: from then on its parts and its
	 * height are the card's, and the workbench shows it (D91).
	 */
	get ready(): Promise<void> {
		return this.firstRead.p;
	}

	/**
	 * Places the parts in the panel's element, from top to bottom, as the
	 * card's kind does (generation cards, "The panel of each kind"; D91). Called
	 * once, while the panel is made.
	 */
	protected abstract arrange(element: HTMLElement, parts: IBaseHalfDraftPanelParts): void;

	/** Whether the input row shows before the card is read: what the kind's row does for a card that has no inputs yet. */
	protected abstract showsInputRowBeforeRead(): boolean;

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
		this.choices.saveTextParam();
		await this.writeQueue.catch(() => undefined);
	}

	/** Moves the focus into the prompt, with the caret at the end. */
	focus(): void {
		this.editor.focus();
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
		void this.firstRead.complete();
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
		this.choices.saveTextParam();
		this.disposed = true;
		this.menus.closeMenu(false);
		this.referenceMenu.clear();
		// Nobody waits for a panel that is gone.
		void this.firstRead.complete();
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
		const prompt = snapshot.info.prompt;
		if (firstRead) {
			this.savedPrompt = prompt;
		}
		// While the field has the focus it keeps what is in it; at rest it shows the prompt of the file.
		if (!this.promptDirty && !this.editor.composing && this.editor.value !== prompt && (firstRead || (!this.promptFocused() && !this.referenceMenu.value))) {
			this.chipInputsKey = this.inputsKey();
			this.editor.setValue(prompt);
		}
		if (!this.promptDirty && !this.editor.composing) {
			this.savedPrompt = prompt;
		}
		// The chips show the inputs: drawn again when the inputs change.
		const inputsKey = this.inputsKey();
		if (inputsKey !== this.chipInputsKey) {
			this.chipInputsKey = inputsKey;
			this.editor.refreshChips();
		}
		this.render();
		// The canvas draws the card's lines with its tiles (generation cards, "The line on the canvas changes with the tile").
		const upstream = JSON.stringify(snapshot.upstream);
		if (inputs && upstream !== this.shownUpstream) {
			this.shownUpstream = upstream;
			this.host.didShowInputs?.(snapshot.upstream);
		}
		if (firstRead && this.focusWhenShown && this.layout?.visible) {
			this.focusWhenShown = false;
			this.focus();
		}
	}

	scheduleRefresh(): void {
		if (!this.disposed && !this.refreshScheduler.isScheduled()) {
			this.refreshScheduler.schedule();
		}
	}

	/** The generation information the panel shows: the file's, or what a write on its way makes of it. */
	info(): IBaseHalfGenerationInfo {
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
	async writeSettings(mutate: (info: IBaseHalfGenerationInfo) => IBaseHalfGenerationInfo): Promise<void> {
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
		// While an input method composes, the text from before the composition.
		const value = this.editor.value;
		if (value === this.savedPrompt) {
			if (!this.editor.composing) {
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
			if (!this.editor.composing && this.editor.value === value) {
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
		// The voice button names the voice as the provider's last list does.
		this._register(this.voiceService.onDidChangeVoices(() => this.render()));
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

		this._register(this.editor.onDidChange(() => this.didEditPrompt()));
		// The composition is not saved until it ends.
		this._register(addDisposableListener(this.editor.element, 'compositionstart', () => this.cancelPromptSave()));
		this._register(this.editor.onDidEndComposition(() => this.didEditPrompt()));
		this._register(addDisposableListener(this.editor.element, 'focusout', () => {
			if (this.promptDirty) {
				void this.savePrompt();
			} else if (!this.editor.composing && !this.referenceMenu.value && this.snapshot && this.editor.value !== this.snapshot.info.prompt) {
				// The prompt changed underneath while the field had the focus: at rest the field shows it.
				this.editor.setValue(this.snapshot.info.prompt);
				this.render();
			}
		}));
		this._register(addDisposableListener(this.editor.element, 'keydown', event => this.onPromptKeyDown(event)));

		this._register(addDisposableListener(this.modelButton, 'click', event => this.menus.toggleMenu('model', this.modelButton, clickedByPointer(event))));
		this._register(addDisposableListener(this.voiceButton, 'click', event => this.menus.toggleMenu('voice', this.voiceButton, clickedByPointer(event))));
		this._register(addDisposableListener(this.settingsButton, 'click', event => this.menus.toggleMenu('settings', this.settingsButton, clickedByPointer(event))));
		this._register(addDisposableListener(this.generateButton, 'click', () => { void this.generate(); }));
		this._register(addDisposableListener(this.reasonAction, 'click', () => {
			const action = this.presentation?.reason?.action;
			if (action) {
				// Providers, at the card's type and the provider (D107).
				void this.providerSettings.openSettings(action.provider, this.snapshot?.kind).catch(error => this.logService.error(error));
			}
		}));
		this._register(addDisposableListener(this.element, 'keydown', event => this.onPanelKeyDown(event)));
	}

	private didLayout(layout: IBaseHalfCanvasSceneVideoPanelLayout): void {
		this.layout = layout;
		this.element.dataset.placement = layout.placement;
		if (!layout.visible || layout.following) {
			this.menus.closeMenu(false);
			this.references.closeReferenceMenu(false);
		} else {
			if (this.openMenu) {
				this.menus.placeMenu(this.openMenu);
			}
			this.referenceMenu.value?.layout();
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
			this.inputRow.layout();
		}
	}

	private didEditPrompt(): void {
		if (this.editor.composing) {
			return;
		}
		this.promptDirty = this.editor.value !== this.savedPrompt;
		if (this.promptDirty) {
			this.schedulePromptSave();
		} else {
			this.cancelPromptSave();
		}
		this.render();
		this.updatePromptLines();
		this.references.openReferenceMenuAtCaret();
	}

	private onPromptKeyDown(event: KeyboardEvent): void {
		if (event.isComposing || event.keyCode === 229) {
			return;
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
		event.preventDefault();
		event.stopPropagation();
		if (this.openMenu) {
			this.menus.closeMenu(true);
			return;
		}
		if (this.referenceMenu.value) {
			this.references.closeReferenceMenu(true);
			return;
		}
		if (this.inputChanges.picking) {
			this.inputChanges.endPick();
			return;
		}
		this.host.focusCard();
	}

	//#endregion

	//#region Rendering

	render(): void {
		if (this.disposed) {
			return;
		}
		const snapshot = this.snapshot;
		if (!snapshot) {
			this.element.dataset.state = this.readError ? 'unreadable' : 'loading';
			this.editor.readOnly = true;
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
			voices: (provider, region) => this.voiceService.voices(provider, region).list,
			...(this.lastCheck && this.lastCheck.model === modelKey ? { check: this.lastCheck.result } : {}),
			generating: this.generationService.isGenerating(this.resource),
			prompt: this.editor.value
		});
		this.scheduleCheck(this.presentation);
		this.element.dataset.state = 'ready';
		this.element.dataset.catalog = catalog.kind;
		this.element.dataset.kind = snapshot.kind;
		// What the prompt is follows the kind, what the model makes, and the mode that is used (D78).
		if (this.editor.element.dataset.placeholder !== this.presentation.placeholder) {
			this.editor.element.dataset.placeholder = this.presentation.placeholder;
		}
		this.element.setAttribute('aria-label', panelLabel(snapshot.kind, basename(this.resource)));
		this.renderNotice();
		// While the draft generates, what it generates cannot be changed (D67).
		const locked = this.isLocked();
		this.editor.readOnly = locked;
		this.element.classList.toggle('generating', locked);
		if (locked) {
			this.references.closeReferenceMenu(false);
			if (this.openMenu) {
				this.menus.closeMenu(false);
			}
			this.pick.clear();
		}
		this.renderInputRow();
		this.renderReason();
		this.renderFooter();
		this.menus.refreshMenu();
		this.updateHeight();
		if (this.pick.value) {
			const key = this.inputChanges.pickStateKey();
			if (key !== this.pickKey) {
				this.pickKey = key;
				this._onDidChangePick.fire();
			}
		}
		// A voice that only the provider's list names, as one of the account, even before the voice menu opened in this window (D78).
		const { ref, region, voice } = this.presentation;
		if (ref && region && voice && baseHalfVoiceNeedsList(voice.parameter, voice.value)) {
			void this.voiceService.askOnce(ref.provider, ref.model, region.id);
		}
	}

	/** The draft generates: its prompt, inputs, model, and settings show what is being generated and cannot be changed (D67). */
	isLocked(): boolean {
		return this.presentation?.generate.kind === 'stop';
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
		this.inputRow.update(this.inputRowModel());
		// Wherever the kind placed them, the two buttons show whether the draft picks, and go while it generates (D67, D69).
		this.addButtons.update(this.inputChanges.picking);
		this.addButtons.element.hidden = this.isLocked();
	}

	/**
	 * What the input row shows, from the presentation (D68): the frames, the
	 * other inputs as tiles, and what a row without inputs says, or nothing
	 * when the mode takes no input. A kind whose row shows less draws less
	 * (D91).
	 */
	protected inputRowModel(): IBaseHalfInputRowModel | undefined {
		const presentation = this.presentation;
		const row = presentation?.inputRow;
		if (!presentation || !row) {
			return undefined;
		}
		const tile = (item: IBaseHalfVideoPanelInputItem, frame?: 'start' | 'end'): IBaseHalfInputTile => {
			const input = this.inputs[item.index];
			const file = input?.available ? input.file : undefined;
			return Object.freeze({
				path: item.path,
				kind: item.kind,
				fileName: item.fileName,
				...(file ? { file, ...(input?.fileVersion ? { fileVersion: input.fileVersion } : {}) } : {}),
				dimmed: !item.used,
				...(item.reason ? { note: item.reason } : {}),
				...(frame ? { frame } : {})
			});
		};
		return Object.freeze({
			...(row.slots.length ? { frames: row.slots.map(slot => Object.freeze({ role: slot.role, addLabel: slot.addLabel, ...(slot.item ? { tile: tile(slot.item, slot.role) } : {}) })) } : {}),
			canSwap: !!row.swappedUpstream,
			tiles: row.items.map(item => tile(item)),
			...(row.emptyHint ? { hint: row.emptyHint } : {}),
			editable: !this.isLocked(),
			picking: this.inputChanges.picking
		});
	}

	/** Which inputs the card has, and their files: what the chips of the prompt are drawn from. */
	private inputsKey(): string {
		return JSON.stringify(this.inputs.length
			? this.inputs.map(input => [input.path, input.kind, input.available, input.file?.toString() ?? '', input.fileVersion ?? ''])
			: this.snapshot?.upstream ?? []);
	}

	/**
	 * The chip of a mention in the prompt (D74): its input's picture or glyph
	 * and its file's name, or, for a file that is not connected, its glyph and
	 * name with a warning. Until the inputs are read, the entries of the list
	 * stand for them, so a mention of an input is never shown as one of a file
	 * that is not connected.
	 */
	private chipOf(mention: IBaseHalfPromptMention): IBaseHalfPromptChip {
		const entries = this.inputs.length ? this.inputs.map(input => input.path) : (this.snapshot?.upstream ?? []);
		return baseHalfPromptChip(mention, entries, index => this.inputs[index]);
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
		// The voice of a model that speaks: the name the catalog or the provider's last list gives it, or its id (D78).
		const voice = presentation.voice;
		this.voiceButton.hidden = !voice;
		if (this.voiceLabel.textContent !== (voice?.label ?? '')) {
			this.voiceLabel.textContent = voice?.label ?? '';
		}
		this.voiceButton.setAttribute('aria-label', voice
			? localize('basehalf.video.panel.voiceLabel', "Voice: {0}", voice.label)
			: localize('basehalf.video.panel.voice', "Voice"));
		// While the draft generates, the model, the voice, and the settings show their values and open nothing (D67).
		const locked = this.isLocked();
		for (const button of [this.modelButton, this.voiceButton, this.settingsButton]) {
			button.classList.toggle('locked', locked);
			if (locked) {
				button.setAttribute('aria-disabled', 'true');
			} else {
				button.removeAttribute('aria-disabled');
			}
		}
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
		// So does the model button's: a model chosen from its menu is never followed by "Choose a model to generate." (D90).
		if (this.modelTitle !== undefined && this.modelTitle !== presentation.model.title && this.modelButton.matches(':hover')) {
			this.hoverService.hideHover(true);
		}
		this.modelTitle = presentation.model.title;
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
			// Nothing was asked, so no prompt was written.
			result = Object.freeze({ problems: Object.freeze([baseHalfUserFacingErrorMessage(error)]), prompt: '' });
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
		const element = this.editor.element;
		if (!element.isConnected || element.clientWidth === 0) {
			return this.promptLines;
		}
		const height = this.editor.contentHeight() - PROMPT_PADDING * 2;
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
		const height = this.computeHeight(this.snapshot ? !this.inputRow.element.hidden : this.showsInputRowBeforeRead());
		if (height === this.currentHeight) {
			return;
		}
		this.currentHeight = height;
		this.element.style.height = `${height}px`;
		this._onDidChangeHeight.fire(height);
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

	workspaceNode(): IBaseHalfWorkspaceResource | undefined {
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
		return this.editor.hasFocus();
	}

	//#endregion

	//#region Focus by key

	focusedKey(container: HTMLElement): string | undefined {
		const active = getWindow(this.element).document.activeElement;
		return isHTMLElement(active) && container.contains(active) ? active.dataset.key : undefined;
	}

	findByKey(container: HTMLElement, key: string): HTMLElement | undefined {
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

	restoreFocus(container: HTMLElement, key: string | undefined): void {
		if (key) {
			this.findByKey(container, key)?.focus({ preventScroll: true });
		}
	}

	//#endregion
}

const EMPTY_INFO: IBaseHalfGenerationInfo = Object.freeze({ prompt: '' });

/** The panel's name for assistive technology, by the card's kind. */
function panelLabel(kind: BaseHalfModelKind, name: string): string {
	switch (kind) {
		case 'image': return localize('basehalf.video.panel.imageLabel', "Image panel for {0}", name);
		case 'audio': return localize('basehalf.video.panel.audioLabel', "Audio panel for {0}", name);
		case 'video': return localize('basehalf.video.panel.label', "Video panel for {0}", name);
	}
}

/** A click of the mouse or a touch. A click that Enter or Space makes on a button has no count. */
function clickedByPointer(event: MouseEvent): boolean {
	return event.detail > 0;
}
