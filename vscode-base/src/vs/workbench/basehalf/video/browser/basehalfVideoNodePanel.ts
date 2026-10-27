/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoNode.css';
import { $, addDisposableListener, append, clearNode, getWindow, isHTMLButtonElement, isHTMLElement, isHTMLInputElement } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { DeferredPromise, RunOnceScheduler, TimeoutTimer } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { compareFileNames } from '../../../../base/common/comparers.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { basename, dirname, isEqual, joinPath } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IBaseHalfCanvasCardPick, IBaseHalfCanvasCardPickCard } from '../../canvas/common/basehalfCanvasCardPick.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import { BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, IBaseHalfCanvasSceneVideoPanelLayout } from '../../canvas/common/basehalfCanvasScene.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfUserFacingErrorMessage } from '../../shell/common/basehalfPlainFailureReason.js';
import { BaseHalfReferenceEditFailure, BaseHalfReferenceEditRefusal, IBaseHalfReferenceEditResult, IBaseHalfReferenceEditService } from '../../references/common/basehalfReferenceEdit.js';
import {
	BASEHALF_VIDEO_IMAGE_FORMATS,
	BaseHalfModelKind,
	BaseHalfTakenInputKind,
	BaseHalfVideoImageFormat,
	BaseHalfVideoModeId,
	BaseHalfVideoParamValue,
	baseHalfVideoAddedInputRefusal,
	baseHalfVideoChangeParam,
	baseHalfVideoChooseMode,
	baseHalfVideoChooseModel,
	baseHalfVideoInputKindOfPath,
	BaseHalfVideoInputKind,
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
	IBaseHalfGenerationCardActions,
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
	baseHalfGenerationDraftRenameExtension,
	baseHalfGenerationNameOrdinal,
	baseHalfGenerationNameParts,
	IBaseHalfGenerationInfo,
	setBaseHalfGenerationChoice,
	setBaseHalfGenerationPrompt
} from '../common/basehalfGenerationInfo.js';
import { baseHalfUpstreamSidecarResource } from '../../references/common/basehalfReferenceStore.js';
import {
	BaseHalfVideoPanelControl,
	baseHalfVideoPanelInputFileName,
	baseHalfVideoPanelPlaceholder,
	createBaseHalfVideoPanelPresentation,
	IBaseHalfVideoPanelAuto,
	IBaseHalfVideoPanelChoice,
	IBaseHalfVideoPanelInputItem,
	IBaseHalfVideoPanelPresentation
} from '../common/basehalfVideoNodePanelPresentation.js';
import { baseHalfPromptMention, IBaseHalfPromptMention } from '../common/basehalfGenerationMentions.js';
import { BaseHalfReferenceMenuKind, IBaseHalfReferenceMenuItem, IBaseHalfReferenceMenuKindList, IBaseHalfReferenceMenuModel } from '../common/basehalfGenerationReferenceMenu.js';
import { baseHalfVoiceNeedsList, IBaseHalfGenerationVoiceService } from '../common/basehalfGenerationVoices.js';
import { BaseHalfGenerationAddButtons } from './basehalfGenerationAddButtons.js';
import { BaseHalfGenerationInputRow, IBaseHalfInputRowModel, IBaseHalfInputTile } from './basehalfGenerationInputRow.js';
import { BaseHalfGenerationPromptEditor, baseHalfPromptChip, IBaseHalfPromptChip } from './basehalfGenerationPromptEditor.js';
import { BaseHalfGenerationReferenceMenu } from './basehalfGenerationReferenceMenu.js';
import { BaseHalfGenerationVoiceMenu, IBaseHalfVoiceMenuTarget } from './basehalfGenerationVoiceMenu.js';
import { readBaseHalfVideoTextInput } from './basehalfVideoGenerationService.js';
import { baseHalfCanvasMediaUrlAt, baseHalfCanvasMediaVersion } from '../../canvas/browser/basehalfCanvasCardMedia.js';
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
const PROMPT_LINE_HEIGHT = 20;
const PROMPT_PADDING = 4;
const PROMPT_MIN_LINES = 3;
const PROMPT_MAX_LINES = 5;
/** The voice menu is as wide as the model menu (D78). */
const MENU_WIDTHS = { add: 200, model: 300, voice: 300, settings: 300 } as const;
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
	/** The voice menu, which draws its own rows and keeps its search while the panel changes. */
	voice?: BaseHalfGenerationVoiceMenu;
}

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
 * parts are the card's inputs, the two buttons that add one, its prompt, and
 * a footer with the model of the card's kind, the voice of a model that
 * speaks, the settings, and Generate, all drawn from the model catalog. It
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

	readonly element: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<number>());
	/** Fires when the panel's height changes; the workbench publishes the scene surface again. */
	readonly onDidChangeHeight: Event<number> = this._onDidChangeHeight.event;

	/** Settles when the first read of the card and its inputs is drawn, or could not be made. */
	private readonly firstRead = new DeferredPromise<void>();

	/** The card's connections as tiles (D68). */
	private readonly inputRow: BaseHalfGenerationInputRow;
	/** Pick on Canvas and Import File…, where the card's kind places them (D71, D91). */
	private readonly addButtons: BaseHalfGenerationAddButtons;
	private readonly promptBox: HTMLElement;
	/** The prompt, whose names of inputs are chips (D68). */
	private readonly editor: BaseHalfGenerationPromptEditor;
	private readonly promptState: HTMLElement;
	private readonly notice: HTMLElement;
	private readonly reason: HTMLElement;
	private readonly reasonText: HTMLElement;
	private readonly reasonAction: HTMLButtonElement;
	private readonly modelButton: HTMLButtonElement;
	private readonly modelLabel: HTMLElement;
	/** The voice of a model that speaks, after the model (D78). */
	private readonly voiceButton: HTMLButtonElement;
	private readonly voiceLabel: HTMLElement;
	private readonly settingsButton: HTMLButtonElement;
	private readonly settingsLabel: HTMLElement;
	private readonly generateButton: HTMLButtonElement;
	private readonly generateIcon: HTMLElement;
	private readonly layer: HTMLElement;

	private readonly menu = this._register(new MutableDisposable<DisposableStore>());
	/** The reference menu that `@` opened, and where its `@` is in the prompt. */
	private readonly referenceMenu = this._register(new MutableDisposable<BaseHalfGenerationReferenceMenu>());
	private mentionAt: number | undefined;
	/** The cards of the canvas of the card's folder, as the reference menu last read them. */
	private canvasCards: readonly IBaseHalfReferenceMenuKindList[] | undefined;
	/** The inputs the chips of the prompt were drawn for. */
	private chipInputsKey: string | undefined;
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
	/** The upstream list whose inputs the panel drew last, as the host was told it. */
	private shownUpstream: string | undefined;
	private readonly refreshScheduler = this._register(new RunOnceScheduler(() => { void this.refresh(); }, 0));
	private writeQueue: Promise<unknown> = Promise.resolve();
	private savedPrompt: string | undefined;
	private promptDirty = false;
	private notSaved: string | undefined;
	private promptLines = PROMPT_MIN_LINES;
	private currentHeight: number;
	private layout: IBaseHalfCanvasSceneVideoPanelLayout | undefined;
	private focusWhenShown: boolean;
	private starting = false;
	/** What the Generate button was drawn as last: Generate or Stop. */
	private generateKind: 'generate' | 'stop' | undefined;
	private modelTitle: string | undefined;
	/** Pick on Canvas while it is on (D69). */
	private readonly pick = this._register(new MutableDisposable<IDisposable>());
	private readonly _onDidChangePick = this._register(new Emitter<void>());
	/** What a click on each card does depends on this: when it changes, the canvas asks again. */
	private pickKey: string | undefined;
	/** The cards whose click is being carried out: a second click on one of them does nothing. */
	private readonly picksRunning = new Set<string>();
	/** The clicks of Pick on Canvas, carried out one after the other. */
	private pickQueue: Promise<unknown> = Promise.resolve();
	/** The panel's width when the prompt was last measured. */
	private measuredWidth: number | undefined;
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
		@IBaseHalfGenerationCardActions private readonly cardActions: IBaseHalfGenerationCardActions,
		@IBaseHalfGenerationVoiceService private readonly voiceService: IBaseHalfGenerationVoiceService,
		@IBaseHalfReferenceEditService private readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IHoverService private readonly hoverService: IHoverService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
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

		// Menus and the look at an input lie over everything else of the panel; the layer is added last.
		this.layer = $('.bh-video-panel-layer');
		this.inputRow = this._register(new BaseHalfGenerationInputRow({
			remove: path => { void this.disconnect(path); },
			insertMention: path => this.insertMention(path),
			move: (path, before) => { void this.moveInput(path, before); },
			swap: () => {
				const order = this.presentation?.inputRow?.swappedUpstream;
				if (order) {
					void this.reorder(order);
				}
			},
			openAddMenu: (trigger, byPointer) => {
				// An empty frame while picking ends picking, as Pick on Canvas does.
				if (this.picking) {
					this.endPick();
				} else {
					this.toggleMenu('add', trigger, byPointer);
				}
			},
			canvasBounds: () => this.canvasRect(this.element.getBoundingClientRect())
		}, this.layer));
		this.inputRow.element.hidden = true;
		this.addButtons = this._register(new BaseHalfGenerationAddButtons({
			togglePick: () => {
				this.closeMenu(false);
				if (this.picking) {
					this.endPick();
				} else {
					this.startPick();
				}
			},
			importFile: () => {
				this.closeMenu(false);
				void this.importFile();
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
			chipOf: mention => this.chipOf(mention)
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
		this.saveTextParam();
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
		this.saveTextParam();
		this.disposed = true;
		this.closeMenu(false);
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

		this._register(addDisposableListener(this.modelButton, 'click', event => this.toggleMenu('model', this.modelButton, clickedByPointer(event))));
		this._register(addDisposableListener(this.voiceButton, 'click', event => this.toggleMenu('voice', this.voiceButton, clickedByPointer(event))));
		this._register(addDisposableListener(this.settingsButton, 'click', event => this.toggleMenu('settings', this.settingsButton, clickedByPointer(event))));
		this._register(addDisposableListener(this.generateButton, 'click', () => { void this.generate(); }));
		this._register(addDisposableListener(this.reasonAction, 'click', () => {
			const action = this.presentation?.reason?.action;
			if (action) {
				void this.providerSettings.openSettings(action.provider).catch(error => this.logService.error(error));
			}
		}));
		this._register(addDisposableListener(this.element, 'keydown', event => this.onPanelKeyDown(event)));
	}

	private didLayout(layout: IBaseHalfCanvasSceneVideoPanelLayout): void {
		this.layout = layout;
		this.element.dataset.placement = layout.placement;
		if (!layout.visible || layout.following) {
			this.closeMenu(false);
			this.closeReferenceMenu(false);
		} else {
			if (this.openMenu) {
				this.placeMenu(this.openMenu);
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
		this.openReferenceMenuAtCaret();
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
			this.closeMenu(true);
			return;
		}
		if (this.referenceMenu.value) {
			this.closeReferenceMenu(true);
			return;
		}
		if (this.picking) {
			this.endPick();
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
			this.closeReferenceMenu(false);
			if (this.openMenu) {
				this.closeMenu(false);
			}
			this.pick.clear();
		}
		this.renderInputRow();
		this.renderReason();
		this.renderFooter();
		this.refreshMenu();
		this.updateHeight();
		if (this.pick.value) {
			const key = this.pickStateKey();
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
	private isLocked(): boolean {
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
		this.addButtons.update(this.picking);
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
			picking: this.picking
		});
	}

	/** Which inputs the card has, and their files: what the chips of the prompt are drawn from. */
	private inputsKey(): string {
		return JSON.stringify(this.inputs.length
			? this.inputs.map(input => [input.path, input.kind, input.available, input.file?.toString() ?? ''])
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

	//#endregion

	//#region Menus

	private toggleMenu(kind: BaseHalfVideoPanelMenuKind, trigger: HTMLElement, byPointer: boolean): void {
		if (this.openMenu?.kind === kind && this.openMenu.trigger === trigger) {
			this.closeMenu(true);
			return;
		}
		// While the draft generates, the model and the settings show their values and open nothing (D67).
		if (this.isLocked()) {
			return;
		}
		this.closeReferenceMenu(false);
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
			anchor: () => this.menuAnchor(kind, trigger),
			align: 'start',
			byPointer
		};
		this.openMenu = menu;
		this.menu.value = store;
		trigger.setAttribute('aria-expanded', 'true');
		store.add(toDisposable(() => trigger.setAttribute('aria-expanded', 'false')));
		store.add(addDisposableListener(element, 'focusout', event => {
			const next = event.relatedTarget;
			if (isHTMLElement(next) && !element.contains(next) && next !== trigger) {
				this.closeMenu(false);
			}
		}));
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
		this.focusFirstMenuItem(menu);
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
		this.menu.clear();
		if (restoreFocus) {
			menu.trigger.focus({ preventScroll: true });
		}
	}

	private refreshMenu(): void {
		const menu = this.openMenu;
		if (!menu) {
			return;
		}
		if (!menu.trigger.isConnected) {
			// The control it opened from was drawn again: open from the new one.
			const key = menu.trigger.dataset.key;
			const replacement = key ? this.findByKey(this.inputRow.element, key) : undefined;
			if (!replacement) {
				this.closeMenu(false);
				return;
			}
			this.showMenu(menu.kind, replacement, menu.byPointer);
			return;
		}
		if (menu.kind === 'voice') {
			// The voice menu keeps its search and draws its own rows: it learns the card's voice and model.
			const target = this.voiceTarget();
			if (target) {
				menu.voice?.update(target);
			} else {
				this.closeMenu(false);
			}
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
			case 'voice': return this.fillVoiceMenu(menu);
			case 'settings': return this.fillSettings(menu.element);
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
		if (kind !== 'model' && kind !== 'voice' && kind !== 'settings') {
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
		// The settings follow their controls, and the voice menu its search field.
		if (menu.kind === 'settings' || menu.kind === 'voice') {
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
		if (menu.voice) {
			// The search field has the keyboard, with the card's voice current.
			menu.voice.focus();
			return;
		}
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
			this.startPick();
		}, { key: 'pick', icon: Codicon.inspect });
		this.menuItem(element, localize('basehalf.video.panel.importFile', "Import File…"), () => {
			this.closeMenu(false);
			void this.importFile();
		}, { key: 'import', icon: Codicon.attach });
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

	/**
	 * The voice menu (D78): the voices of the card's model, which it asks the
	 * provider for each time it opens. Choosing one saves it as any value of
	 * the settings is saved, closes the menu, and gives the keyboard back.
	 */
	private fillVoiceMenu(menu: IOpenMenu): void {
		const target = this.voiceTarget();
		if (!target) {
			return;
		}
		menu.voice = menu.content.add(this.instantiationService.createInstance(BaseHalfGenerationVoiceMenu, menu.element, target, {
			choose: voice => {
				this.closeMenu(true);
				this.changeParam(target.parameter.name, voice);
			},
			dismiss: () => this.closeMenu(true),
			layout: () => {
				if (this.openMenu === menu) {
					this.placeMenu(menu);
				}
			}
		}));
	}

	/** What the voice menu lists from: the card's model and its voice, while the model speaks. */
	private voiceTarget(): IBaseHalfVoiceMenuTarget | undefined {
		const presentation = this.presentation;
		const voice = presentation?.voice;
		return presentation?.ref && voice
			? Object.freeze({ provider: presentation.ref.provider, model: presentation.ref.model, parameter: voice.parameter, voice: voice.value })
			: undefined;
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
	 * generation card"): an image or an audio model that delivers another
	 * format renames the draft to that format's extension at once, with the
	 * next free number when that name is taken, as a rename does.
	 */
	private async followModelFormat(model: IBaseHalfVideoCatalogModel): Promise<void> {
		const snapshot = this.snapshot;
		const extension = !this.disposed && snapshot && !snapshot.hasFile && !snapshot.made ? baseHalfGenerationDraftRenameExtension(snapshot.path, snapshot.kind, model) : undefined;
		if (extension === undefined) {
			return;
		}
		const name = basename(this.resource);
		const folder = dirname(this.resource);
		try {
			const next = await this.store.nextFreeName(folder, baseHalfGenerationNameParts(name).base, extension, baseHalfGenerationNameOrdinal(name));
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

	/**
	 * Why a number goes less far than its model declares, under it, and read
	 * with its slider or field (generation cards, "Settings"; D70). A button
	 * beyond the range has the reason itself.
	 */
	private renderLimit(section: HTMLElement, control: BaseHalfVideoPanelControl, described?: HTMLElement): void {
		if (control.limit) {
			append(section, $('.bh-video-panel-setting-note.limit')).textContent = control.limit;
			described?.setAttribute('aria-description', control.limit);
		}
	}

	/** One parameter, drawn as the specification says for its kind (generation cards, "Settings"). */
	private renderControl(parent: HTMLElement, control: BaseHalfVideoPanelControl): void {
		switch (control.kind) {
			case 'buttons':
			case 'list':
			case 'ratio': {
				const section = this.radioGroup(parent, control.label, control.choices, control.kind, value => this.changeParam(control.name, value), control.tooltip, control.columns);
				section.dataset.parameter = control.name;
				this.renderLimit(section, control);
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
				this.renderLimit(section, control, slider);
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
				this.renderLimit(section, control, field);
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
		tooltip?: string,
		columns?: number
	): HTMLElement {
		// Returns the section, which holds the label and the choices.
		const section = this.settingSection(parent, label, tooltip);
		section.classList.add(kind === 'ratio' ? 'ratios' : kind);
		const group = append(section, $('.bh-video-panel-choices'));
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-label', label);
		if (columns) {
			// Buttons that wrap into rows, as a long count's (D91).
			group.classList.add('rows');
			group.style.setProperty('--bh-video-panel-choice-columns', String(columns));
		}
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

	//#region Names and the reference menu

	/**
	 * Opens the reference menu when the user typed `@` at the caret (generation
	 * cards, "The panel", D68): after the start of the prompt, a space, or
	 * anything that is not a Latin letter or digit, so that an e-mail address
	 * does not; a full-width `＠` too.
	 */
	private openReferenceMenuAtCaret(): void {
		if (this.isLocked() || this.referenceMenu.value || !this.editor.hasFocus()) {
			return;
		}
		const selection = this.editor.selection();
		if (!selection || selection.start !== selection.end || selection.start === 0) {
			return;
		}
		const text = this.editor.value;
		const at = selection.start - 1;
		const mark = text.charAt(at);
		if (mark !== '@' && mark !== '\uff20') {
			return;
		}
		if (at > 0 && /[A-Za-z0-9._%+-]/.test(text.charAt(at - 1))) {
			return;
		}
		this.openReferenceMenu(at);
	}

	private openReferenceMenu(at: number): void {
		this.closeMenu(false);
		// Where the menu opens, kept relative to the panel, so that it follows the panel when the canvas moves.
		const caret = this.editor.caretRect();
		const panel = this.element.getBoundingClientRect();
		const offset = caret ? { left: caret.left - panel.left, top: caret.top - panel.top, width: caret.width, height: caret.height } : undefined;
		const anchor = (): DOMRect | undefined => {
			if (!offset) {
				return undefined;
			}
			const now = this.element.getBoundingClientRect();
			const DOMRectConstructor = getWindow(this.element).DOMRect;
			return new DOMRectConstructor(now.left + offset.left, now.top + offset.top, Math.max(1, offset.width), offset.height || PROMPT_LINE_HEIGHT);
		};
		this.mentionAt = at;
		const menu = new BaseHalfGenerationReferenceMenu(this.referenceMenuModel(), {
			choose: item => { void this.chooseReference(item); },
			dismiss: () => this.closeReferenceMenu(true),
			canvasBounds: () => this.canvasRect(this.element.getBoundingClientRect())
		}, this.layer, anchor);
		this.referenceMenu.value = menu;
		menu.focus();
		void this.readCanvasCards().then(cards => {
			if (cards && this.referenceMenu.value === menu) {
				this.canvasCards = cards;
				menu.update(this.referenceMenuModel());
			}
		});
	}

	/** Closes the reference menu; with `restoreFocus`, the caret goes back after the `@`, which stays as typed. */
	private closeReferenceMenu(restoreFocus: boolean): void {
		if (!this.referenceMenu.value) {
			return;
		}
		const at = this.mentionAt;
		this.referenceMenu.clear();
		this.mentionAt = undefined;
		if (restoreFocus && !this.disposed) {
			this.editor.focus(at !== undefined ? at + 1 : undefined);
		}
	}

	/** The card's images, videos, sounds, and notes, in the order of the input row, then the canvas's cards by kind, as the menu lists them. */
	private referenceMenuModel(): IBaseHalfReferenceMenuModel {
		const row = this.presentation?.inputRow;
		const connected: IBaseHalfReferenceMenuItem[] = [];
		for (const item of row ? [...row.slots.flatMap(slot => slot.item ? [slot.item] : []), ...row.items] : []) {
			if (isReferenceMenuKind(item.kind)) {
				const input = this.inputs[item.index];
				connected.push(Object.freeze<IBaseHalfReferenceMenuItem>({
					path: item.path,
					kind: item.kind,
					title: item.fileName,
					connected: true,
					...pictureOf(item.kind, input?.available ? input.file : undefined, input?.fileVersion)
				}));
			}
		}
		const upstream = new Set(this.snapshot?.upstream ?? []);
		const canvas = (this.canvasCards ?? EMPTY_CANVAS_CARDS).map(list => Object.freeze({
			...list,
			items: list.items.map(item => upstream.has(item.path) ? Object.freeze({ ...item, connected: true }) : item)
		}));
		return Object.freeze({ connected, canvas });
	}

	/**
	 * Reads the images, videos, audio, and notes of the card's folder, drafts
	 * too, apart from the card itself, and asks for each kind whether the
	 * draft's model takes one more. `undefined` when the folder cannot be read.
	 */
	private async readCanvasCards(): Promise<readonly IBaseHalfReferenceMenuKindList[] | undefined> {
		const snapshot = this.snapshot;
		if (!snapshot) {
			return undefined;
		}
		const folder = dirname(this.resource);
		const slash = snapshot.path.lastIndexOf('/');
		const folderPath = slash < 0 ? '' : snapshot.path.slice(0, slash);
		const items: IBaseHalfReferenceMenuItem[] = [];
		try {
			const [stat, drafts] = await Promise.all([this.fileService.resolve(folder), this.store.listDrafts(folder)]);
			const entries = [
				...(stat.children ?? []).filter(child => !child.isDirectory).map(child => ({ name: child.name, file: child.resource as URI | undefined, version: baseHalfCanvasMediaVersion(child) as string | undefined })),
				...drafts.map(draft => ({ name: draft.name, file: undefined, version: undefined }))
			];
			for (const entry of entries) {
				const path = folderPath ? `${folderPath}/${entry.name}` : entry.name;
				const kind = baseHalfVideoInputKindOfPath(path);
				if (path === snapshot.path || entry.name.startsWith('.') || !isReferenceMenuKind(kind)) {
					continue;
				}
				items.push(Object.freeze({ path, kind, title: baseHalfVideoPanelInputFileName(path), ...pictureOf(kind, entry.file, entry.version) }));
			}
		} catch (error) {
			this.logService.warn('[BaseHalf] the reference menu could not read the cards of the canvas', error);
			return undefined;
		}
		// In the order of Files.
		items.sort((left, right) => compareFileNames(left.title, right.title));
		const connected = new Set(snapshot.upstream);
		const lists: IBaseHalfReferenceMenuKindList[] = [];
		// A kind that no model of the card's kind takes is not listed: an image card lists images and notes (D90).
		for (const kind of this.presentation?.inputKinds ?? (['image', 'video', 'audio', 'text'] as const)) {
			const ofKind = items.filter(item => item.kind === kind);
			// The model takes one more of a kind or none, whichever card it is: asked once, for the first that is not connected.
			const candidate = ofKind.find(item => !connected.has(item.path));
			let disabled: string | undefined;
			try {
				disabled = candidate ? await this.cardActions.inputRefusal(this.resource, { add: candidate.path }) : undefined;
			} catch (error) {
				this.logService.warn('[BaseHalf] the reference menu could not ask whether the model takes an input', error);
			}
			lists.push(Object.freeze({ kind, items: ofKind, ...(disabled ? { disabled } : {}) }));
		}
		return lists;
	}

	/**
	 * Puts the chosen input's mention in place of the `@` (D74). A card that is
	 * not connected is connected first, as a connection on the canvas is, or
	 * the reason it cannot be is shown and the `@` stays.
	 */
	private async chooseReference(item: IBaseHalfReferenceMenuItem): Promise<void> {
		const at = this.mentionAt;
		this.referenceMenu.clear();
		this.mentionAt = undefined;
		if (!this.snapshot?.upstream.includes(item.path)) {
			const connected = await this.acceptInput(item.path) && await this.connect(item.path);
			if (this.disposed) {
				return;
			}
			if (!connected) {
				this.editor.focus(at !== undefined ? at + 1 : undefined);
				return;
			}
			// The chip is drawn with the new input once the panel has read it.
			await this.refresh();
		}
		this.replaceMention(at, item.path);
	}

	/** Puts the mention of `path` and a space in place of the `@` at `at`, or at the caret when it is not there any more. */
	private replaceMention(at: number | undefined, path: string): void {
		const text = this.editor.value;
		if (at !== undefined && (text.charAt(at) === '@' || text.charAt(at) === '\uff20')) {
			this.editor.focus(at + 1);
			this.editor.replace(at, at + 1, `${baseHalfPromptMention(path)} `);
			return;
		}
		this.insertMention(path);
	}

	/** Puts the mention of an input into the prompt at its caret, or at the end, with a space after it, and gives the prompt the keyboard. */
	private insertMention(path: string): void {
		if (this.isLocked()) {
			return;
		}
		const selection = this.editor.hasFocus() ? this.editor.selection() : undefined;
		const end = this.editor.value.length;
		const start = selection?.start ?? end;
		this.editor.focus(start);
		this.editor.replace(start, selection?.end ?? end, `${baseHalfPromptMention(path)} `);
	}

	//#endregion

	//#region Inputs

	private async reorder(upstream: readonly string[]): Promise<void> {
		try {
			// The names of the prompt follow their inputs from what was typed last (D68).
			await this.flush();
			const snapshot = await this.store.reorderUpstream(this.resource, upstream);
			if (!this.disposed) {
				this.snapshot = snapshot;
				this.scheduleRefresh();
			}
		} catch (error) {
			this.reportReferenceError(error);
		}
	}

	/** Moves an input to the place of `before` in the list, or last, as a dragged tile does. */
	private async moveInput(path: string, before: string | undefined): Promise<void> {
		const upstream = this.snapshot?.upstream;
		if (!upstream?.includes(path)) {
			return;
		}
		const rest = upstream.filter(entry => entry !== path);
		const index = before === undefined ? rest.length : rest.indexOf(before);
		if (index < 0) {
			return;
		}
		const order = [...rest.slice(0, index), path, ...rest.slice(index)];
		if (order.every((entry, position) => entry === upstream[position])) {
			return;
		}
		await this.reorder(order);
	}

	//#region Pick on Canvas

	private get picking(): boolean {
		return !!this.pick.value;
	}

	/**
	 * Starts Pick on Canvas (D69): until it is ended, a click on a card of the
	 * canvas connects it, or removes it when it is connected.
	 */
	private startPick(): void {
		if (this.pick.value || this.isLocked() || !this.snapshot || this.disposed) {
			return;
		}
		this.pickKey = this.pickStateKey();
		this.pick.value = this.host.startPick({
			title: localize('basehalf.video.panel.pickTitle', "Click cards to connect them to {0}, or a connected card to remove it.", baseHalfVideoPanelInputFileName(this.snapshot.path)),
			cardOf: (path, folder) => this.pickCardOf(path, folder),
			pick: path => this.pickCard(path),
			ended: () => this.endPick(),
			onDidChange: this._onDidChangePick.event
		});
		this.render();
	}

	private endPick(): void {
		if (!this.pick.value) {
			return;
		}
		this.pick.clear();
		this.render();
	}

	/** What a click on the card at `path` does while picking, as a connection drawn on the canvas would be refused (D67). */
	private pickCardOf(path: string, folder: boolean): IBaseHalfCanvasCardPickCard {
		const snapshot = this.snapshot;
		if (!snapshot || path === snapshot.path) {
			return PICK_SELF;
		}
		if (folder) {
			return Object.freeze({ action: 'refused', label: localize('basehalf.video.panel.pickFolder', "A folder cannot be an input.") });
		}
		const name = baseHalfVideoPanelInputFileName(path);
		if (snapshot.upstream.includes(path)) {
			return Object.freeze({ action: 'remove', label: localize('basehalf.video.panel.pickRemove', "Remove {0}", name) });
		}
		const reason = baseHalfVideoAddedInputRefusal(this.model(), snapshot.upstream, path);
		return Object.freeze(reason
			? { action: 'refused', label: reason }
			: { action: 'connect', label: localize('basehalf.video.panel.pickConnect', "Connect {0}", name) });
	}

	/** What `pickCardOf` answers from: the card, its list, and its model. */
	private pickStateKey(): string {
		const info = this.info();
		return JSON.stringify([this.snapshot?.path, this.snapshot?.upstream, info.provider, info.model, this.catalogService.state.kind]);
	}

	/** The draft's model, as the panel shows it. */
	private model(): IBaseHalfVideoCatalogModel | undefined {
		const catalog = this.catalogService.state;
		const info = this.info();
		return catalog.kind === 'ready' ? findBaseHalfVideoModel(catalog.catalog, info.provider, info.model)?.model : undefined;
	}

	/**
	 * A click while picking: connects the card at the end of the list, or
	 * removes a connected one. Clicks are carried out one after the other,
	 * each from the list as the one before left it.
	 */
	private pickCard(path: string): void {
		if (this.picksRunning.has(path)) {
			return;
		}
		this.picksRunning.add(path);
		const run = async () => {
			try {
				const snapshot = this.snapshot;
				if (!snapshot || this.disposed || this.isLocked()) {
					return;
				}
				if (snapshot.upstream.includes(path)) {
					await this.disconnect(path);
				} else if (!await this.acceptInput(path) || !await this.connect(path)) {
					return;
				}
				await this.refresh();
			} finally {
				this.picksRunning.delete(path);
			}
		};
		this.pickQueue = this.pickQueue.then(run, run);
	}

	//#endregion

	private async importFile(): Promise<void> {
		let path: string | undefined;
		try {
			// Nothing is copied for a file the model cannot use (D67).
			path = await this.host.importFile(candidate => this.acceptInput(candidate), this.presentation?.inputKinds ?? ['image', 'video', 'audio', 'text']);
		} catch (error) {
			this.reportReferenceError(error);
			return;
		}
		if (path && !this.disposed) {
			await this.connect(path);
		}
	}

	/**
	 * Whether the draft takes `path` as one more input; when it does not, the
	 * reason is shown, as for a connection on the canvas (D67).
	 */
	private async acceptInput(path: string): Promise<boolean> {
		let reason: string | undefined;
		try {
			reason = await this.cardActions.inputRefusal(this.resource, { add: path });
		} catch (error) {
			this.logService.warn('[BaseHalf] the panel could not ask whether the model takes an input', error);
		}
		if (reason && !this.disposed) {
			this.notificationService.notify({ severity: Severity.Warning, message: reason });
		}
		return !reason;
	}

	/** Connects an input; resolves with whether it was connected. */
	private async connect(entry: string): Promise<boolean> {
		const node = this.workspaceNode();
		if (!node || entry === node.relativePath) {
			return false;
		}
		const label = localize('basehalf.video.panel.connectUndo', "Connect Input");
		return this.runReferenceEdit(label, () => this.referenceEditService.add(node, entry, { label }));
	}

	private async disconnect(entry: string): Promise<void> {
		const node = this.workspaceNode();
		if (!node) {
			return;
		}
		// The names of the prompt follow their inputs from what was typed last (D68).
		await this.flush();
		const label = localize('basehalf.video.panel.disconnectUndo', "Remove Input");
		await this.runReferenceEdit(label, () => this.referenceEditService.remove(node, entry, { label }));
	}

	/** Runs a connection edit as one step of the canvas undo stack, and says why one did not run. Resolves with whether it ran. */
	private async runReferenceEdit(label: string, operation: () => Promise<IBaseHalfReferenceEditResult>): Promise<boolean> {
		const node = this.workspaceNode();
		if (!node) {
			return false;
		}
		try {
			this.pushUndo(await operation(), label, node);
			return true;
		} catch (error) {
			if (error instanceof BaseHalfReferenceEditFailure) {
				this.pushUndo(error.result, label, node);
			} else {
				this.reportReferenceError(error);
			}
			return false;
		} finally {
			this.scheduleRefresh();
			this.host.didChangeConnections?.();
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
			onDidRun: () => {
				this.scheduleRefresh();
				this.host.didChangeConnections?.();
			}
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
		return this.editor.hasFocus();
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
/** The draft itself, while it picks: a click on it does nothing, and nothing says so. */
const PICK_SELF: IBaseHalfCanvasCardPickCard = Object.freeze({ action: 'self' });

/** The canvas's cards before the reference menu read them. */
const EMPTY_CANVAS_CARDS: readonly IBaseHalfReferenceMenuKindList[] = Object.freeze([
	Object.freeze({ kind: 'image' as const, items: [] }),
	Object.freeze({ kind: 'video' as const, items: [] }),
	Object.freeze({ kind: 'audio' as const, items: [] })
]);

/** The picture of an image the window can show, at its file's version; a video and audio have their glyph. */
function pictureOf(kind: BaseHalfReferenceMenuKind, file: URI | undefined, version: string | undefined): { readonly picture?: string } {
	return kind === 'image' && file ? { picture: baseHalfCanvasMediaUrlAt(file, version) } : {};
}

/** The kinds of input the reference menu lists: images, videos, sounds, and notes. */
function isReferenceMenuKind(kind: BaseHalfVideoInputKind): kind is BaseHalfReferenceMenuKind {
	return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'text';
}

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
