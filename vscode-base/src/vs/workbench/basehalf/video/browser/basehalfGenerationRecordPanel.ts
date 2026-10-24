/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoNode.css';
import './media/basehalfGenerationRecordPanel.css';
import { $, addDisposableListener, append, getWindow } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { basename, isEqual } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, IBaseHalfCanvasSceneVideoPanelLayout } from '../../canvas/common/basehalfCanvasScene.js';
import { baseHalfUserFacingErrorMessage } from '../../shell/common/basehalfPlainFailureReason.js';
import { BASEHALF_GENERATION_PROMPT_MAX_LENGTH } from '../common/basehalfGenerationInfo.js';
import { baseHalfInputNameOrdinals } from '../common/basehalfGenerationInputNames.js';
import { createBaseHalfGenerationRecordPresentation, IBaseHalfGenerationRecordInput, IBaseHalfGenerationRecordPresentation } from '../common/basehalfGenerationRecordPresentation.js';
import { IBaseHalfVideoLabelToken } from '../common/basehalfVideoCatalog.js';
import {
	IBaseHalfGenerationCardActions,
	IBaseHalfGenerationCardSnapshot,
	IBaseHalfGenerationCardStore,
	IBaseHalfVideoCatalogService,
	IBaseHalfVideoResolvedInput
} from '../common/basehalfVideoGeneration.js';
import { baseHalfVideoPanelInputFileName } from '../common/basehalfVideoNodePanelPresentation.js';
import { BASEHALF_VIDEO_PANEL_MAX_HEIGHT, BASEHALF_VIDEO_PANEL_MIN_HEIGHT } from '../common/basehalfVideoNodePanelPlacement.js';
import { BaseHalfGenerationInputRow, IBaseHalfInputFrameSlot, IBaseHalfInputRowModel, IBaseHalfInputTile } from './basehalfGenerationInputRow.js';
import { BaseHalfGenerationPromptEditor, IBaseHalfPromptChip } from './basehalfGenerationPromptEditor.js';

/** What the panel of a card with its file needs from the canvas. The workbench implements it. */
export interface IBaseHalfGenerationRecordPanelHost {
	/** Moves the focus to the card: Escape. */
	focusCard(): void;
	/** New Version made a draft: the workbench selects it, with its panel open and its prompt focused. */
	didMakeNewVersion(draft: URI): void;
}

const PANEL_PADDING = 12;
const SECTION_GAP = 8;
const INPUT_ROW_HEIGHT = 48;
const LINE_HEIGHT = 16;
const FOOTER_HEIGHT = 32;
const PROMPT_LINE_HEIGHT = 20;
const PROMPT_PADDING = 4;
const PROMPT_MIN_LINES = 3;
const PROMPT_MAX_LINES = 5;
const HOVER_GROUP = 'basehalf-video-panel';

/**
 * The panel under a selected card with its file (D67, generation cards, "The
 * panel of a card with its file"): what made the file, from its `made.yaml`,
 * where a draft's panel has the same parts. The inputs in order as the tiles
 * of a draft's input row, and the prompt with its names as chips (D68), both
 * read only; the prompt can be selected and copied. Then which image of how
 * many it is or that it is a copy, and a footer with the model and the
 * settings as text and New Version where a draft has Generate. Nothing in it
 * changes the card.
 *
 * The workbench creates one for the only selected card with its file, gives
 * the scene its {@link element} and {@link height}, and disposes it.
 */
export class BaseHalfGenerationRecordPanel extends Disposable {

	readonly element: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<number>());
	/** Fires when the panel's height changes; the workbench publishes the scene surface again. */
	readonly onDidChangeHeight: Event<number> = this._onDidChangeHeight.event;

	/** The look at an input lies over everything else of the panel; the layer is added last. */
	private readonly layer: HTMLElement;
	private readonly inputRow: BaseHalfGenerationInputRow;
	private readonly promptBox: HTMLElement;
	private readonly editor: BaseHalfGenerationPromptEditor;
	private readonly line: HTMLElement;
	private readonly notice: HTMLElement;
	private readonly footer: HTMLElement;
	private readonly modelLabel: HTMLElement;
	private readonly settingsLabel: HTMLElement;
	private readonly newVersionButton: HTMLButtonElement;

	private readonly refreshScheduler = this._register(new RunOnceScheduler(() => { void this.refresh(); }, 0));
	private snapshot: IBaseHalfGenerationCardSnapshot | undefined;
	private inputs: readonly IBaseHalfVideoResolvedInput[] = [];
	private presentation: IBaseHalfGenerationRecordPresentation | undefined;
	private readError: string | undefined;
	private refreshSequence = 0;
	/** The inputs the chips of the prompt were drawn from, so they are drawn again only when that changes. */
	private renderedChipsKey: string | undefined;
	private promptLines = PROMPT_MIN_LINES;
	private currentHeight: number;
	private layout: IBaseHalfCanvasSceneVideoPanelLayout | undefined;
	/** The panel's width when the prompt was last measured. */
	private measuredWidth: number | undefined;
	private making = false;
	private disposed = false;

	constructor(
		private readonly resource: URI,
		private readonly host: IBaseHalfGenerationRecordPanelHost,
		@IBaseHalfGenerationCardStore private readonly store: IBaseHalfGenerationCardStore,
		@IBaseHalfGenerationCardActions private readonly cardActions: IBaseHalfGenerationCardActions,
		@IBaseHalfVideoCatalogService private readonly catalogService: IBaseHalfVideoCatalogService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IHoverService private readonly hoverService: IHoverService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		// The names of the model and its settings come from the catalog when it has them.
		this.catalogService.load();

		this.element = $('.bh-video-panel.bh-record-panel');
		this.element.setAttribute('role', 'group');
		this.element.dataset.state = 'loading';

		this.layer = $('.bh-video-panel-layer');
		// Read only: no plus, cross, `@`, swap, or dragging, and nothing that the row asks for changes the card.
		this.inputRow = this._register(new BaseHalfGenerationInputRow({
			remove: () => { },
			insertName: () => { },
			move: () => { },
			swap: () => { },
			openAddMenu: () => { },
			togglePick: () => { },
			importFile: () => { },
			setupHover: (element, content) => this.hoverService.setupDelayedHover(element, () => ({ content }), { groupId: HOVER_GROUP }),
			canvasBounds: () => this.canvasRect(this.element.getBoundingClientRect())
		}, this.layer));
		this.inputRow.element.hidden = true;
		append(this.element, this.inputRow.element);

		this.promptBox = append(this.element, $('.bh-video-panel-prompt'));
		this.editor = this._register(new BaseHalfGenerationPromptEditor({
			ariaLabel: localize('basehalf.generation.record.prompt', "Prompt it was made with"),
			placeholder: localize('basehalf.generation.record.noPrompt', "No prompt"),
			maxLength: BASEHALF_GENERATION_PROMPT_MAX_LENGTH,
			chipOf: name => this.chipOf(name)
		}));
		// A field that can be read, selected, and copied with the keyboard, and not changed.
		this.editor.readOnly = true;
		this.editor.element.tabIndex = 0;
		Object.assign(this.editor.element.style, {
			height: 'auto',
			minHeight: `${PROMPT_MIN_LINES * PROMPT_LINE_HEIGHT + PROMPT_PADDING * 2}px`,
			maxHeight: `${PROMPT_MAX_LINES * PROMPT_LINE_HEIGHT + PROMPT_PADDING * 2}px`
		});
		this.promptBox.append(this.editor.element);

		this.line = append(this.element, $('.bh-record-panel-line'));
		this.line.hidden = true;

		this.notice = append(this.element, $('.bh-video-panel-notice'));
		this.notice.hidden = true;

		this.footer = append(this.element, $('.bh-video-panel-footer'));
		this.modelLabel = append(this.footer, $('span.bh-record-panel-model'));
		this.settingsLabel = append(this.footer, $('span.bh-record-panel-settings'));
		append(this.footer, $('.bh-video-panel-footer-space'));
		this.newVersionButton = append(this.footer, $<HTMLButtonElement>('button.bh-record-panel-new-version'));
		this.newVersionButton.type = 'button';
		this.newVersionButton.append(renderCodicon(Codicon.versions));
		append(this.newVersionButton, $('span')).textContent = localize('basehalf.generation.record.newVersion', "New Version");
		const newVersionTitle = localize('basehalf.generation.record.newVersionTitle', "Make a new draft beside this card from what made it.");
		this.newVersionButton.setAttribute('aria-description', newVersionTitle);
		this._register(this.hoverService.setupDelayedHover(this.modelLabel, () => ({ content: this.presentation?.modelTitle ?? '' }), { groupId: HOVER_GROUP }));
		this._register(this.hoverService.setupDelayedHover(this.settingsLabel, () => ({ content: this.presentation?.settingsTitle ?? '' }), { groupId: HOVER_GROUP }));
		this._register(this.hoverService.setupDelayedHover(this.newVersionButton, () => ({ content: newVersionTitle }), { groupId: HOVER_GROUP }));

		append(this.element, this.layer);

		this.currentHeight = this.computeHeight();
		this.element.style.height = `${this.currentHeight}px`;

		this.registerListeners();
		void this.refresh();
	}

	/** The panel's height in screen pixels, from 132 to 268 as for a draft's panel. */
	get height(): number {
		return this.currentHeight;
	}

	/** Nothing in the panel is saved: it changes nothing. */
	async flush(): Promise<void> { }

	/** Reads the card and the inputs its record names again. */
	async refresh(): Promise<void> {
		const sequence = ++this.refreshSequence;
		try {
			const snapshot = await this.store.read(this.resource);
			// The inputs of the record, as they are on disk now: one that is gone says so.
			const inputs = await this.store.resolveInputs({ ...snapshot, upstream: snapshot.made?.inputs ?? [] });
			if (this.disposed || sequence !== this.refreshSequence) {
				return;
			}
			this.snapshot = snapshot;
			this.inputs = inputs;
			this.readError = undefined;
			this.render();
		} catch (error) {
			if (this.disposed || sequence !== this.refreshSequence) {
				return;
			}
			this.logService.warn('[BaseHalf] the panel could not read its card', error);
			this.readError = baseHalfUserFacingErrorMessage(error);
			this.render();
		}
	}

	/** New Version: a draft beside the card from what made it, which the workbench then selects. */
	async newVersion(): Promise<void> {
		if (this.making || this.disposed || !this.presentation?.readable) {
			return;
		}
		this.making = true;
		this.render();
		try {
			const draft = await this.cardActions.newVersion(this.resource);
			if (!this.disposed) {
				this.host.didMakeNewVersion(draft);
			}
		} catch (error) {
			this.notificationService.notify({ severity: Severity.Warning, message: baseHalfUserFacingErrorMessage(error) });
		} finally {
			this.making = false;
			if (!this.disposed) {
				this.render();
			}
		}
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}

	private scheduleRefresh(): void {
		if (!this.disposed && !this.refreshScheduler.isScheduled()) {
			this.refreshScheduler.schedule();
		}
	}

	private registerListeners(): void {
		this._register(this.store.onDidChange(resource => {
			if (isEqual(resource, this.resource)) {
				this.scheduleRefresh();
			}
		}));
		this._register(this.fileService.onDidFilesChange(event => {
			// An input that is deleted, or comes back, changes what the row says of it.
			if (event.affects(this.resource) || this.snapshot?.made?.inputs.some(path => event.affects(this.entryResource(path)))) {
				this.scheduleRefresh();
			}
		}));
		this._register(this.catalogService.onDidChange(() => this.render()));
		this._register(addDisposableListener(this.element, BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, (event: CustomEvent<IBaseHalfCanvasSceneVideoPanelLayout | undefined>) => {
			if (event.detail) {
				this.didLayout(event.detail);
			}
		}));
		this._register(addDisposableListener(this.newVersionButton, 'click', () => { void this.newVersion(); }));
		this._register(addDisposableListener(this.element, 'keydown', event => {
			if (event.key === 'Escape' && !event.isComposing) {
				event.preventDefault();
				event.stopPropagation();
				this.host.focusCard();
			}
		}));
	}

	private entryResource(entry: string): URI {
		const folder = this.workspaceContextService.getWorkspaceFolder(this.resource);
		return folder ? URI.joinPath(folder.uri, ...entry.split('/')) : this.resource;
	}

	private didLayout(layout: IBaseHalfCanvasSceneVideoPanelLayout): void {
		this.layout = layout;
		this.element.dataset.placement = layout.placement;
		// The scene reports a layout at every frame of a pan; the text wraps differently only when the width changes.
		if (layout.width !== this.measuredWidth) {
			this.measuredWidth = layout.width;
			this.updatePromptLines();
			this.inputRow.layout();
		}
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

	private render(): void {
		if (this.disposed) {
			return;
		}
		const snapshot = this.snapshot;
		if (!snapshot) {
			this.element.dataset.state = this.readError ? 'unreadable' : 'loading';
			this.notice.hidden = this.readError === undefined;
			this.notice.textContent = this.readError !== undefined ? localize('basehalf.generation.record.cardUnreadable', "This card cannot be read: {0}", this.readError) : '';
			this.promptBox.hidden = this.readError !== undefined;
			this.footer.hidden = this.readError !== undefined;
			this.updateHeight();
			return;
		}
		const presentation = this.presentation = createBaseHalfGenerationRecordPresentation({
			kind: snapshot.kind,
			...(snapshot.made ? { made: snapshot.made } : {}),
			inputs: this.inputs,
			catalog: this.catalogService.state
		});
		// The card was read; whether its record could be is a state of its own.
		this.element.dataset.state = 'ready';
		this.element.dataset.record = presentation.readable ? 'readable' : 'unreadable';
		this.element.dataset.kind = snapshot.kind;
		const name = basename(this.resource);
		this.element.setAttribute('aria-label', snapshot.kind === 'image'
			? localize('basehalf.generation.record.imageLabel', "What made the image {0}", name)
			: localize('basehalf.generation.record.videoLabel', "What made the video {0}", name));
		// A record that cannot be read is left as it is; the panel says so and offers nothing to make from it.
		this.notice.hidden = presentation.readable;
		this.notice.textContent = presentation.readable ? '' : localize('basehalf.generation.record.unreadable', "BaseHalf could not read what made this file.");
		this.promptBox.hidden = !presentation.readable;
		this.footer.hidden = !presentation.readable;
		this.inputRow.update(this.inputRowModel(presentation));
		this.renderPrompt(presentation);
		this.line.hidden = presentation.line === undefined;
		this.line.textContent = presentation.line ?? '';
		this.modelLabel.textContent = presentation.model;
		this.modelLabel.setAttribute('aria-label', localize('basehalf.generation.record.model', "Model: {0}", presentation.model));
		this.settingsLabel.textContent = presentation.settings;
		this.settingsLabel.setAttribute('aria-label', localize('basehalf.generation.record.settingsLabel', "Settings: {0}", presentation.settings));
		this.newVersionButton.setAttribute('aria-disabled', String(this.making));
		this.newVersionButton.classList.toggle('busy', this.making);
		this.updateHeight();
	}

	/**
	 * The inputs it was made from, as the tiles of a draft's input row (D68):
	 * the frames first, with the numbers of their names and the marks of the
	 * mode that made it, read only. An input that is gone shows its glyph, and
	 * its look says so.
	 */
	private inputRowModel(presentation: IBaseHalfGenerationRecordPresentation): IBaseHalfInputRowModel | undefined {
		if (!presentation.inputs.length) {
			return undefined;
		}
		const ordinals = baseHalfInputNameOrdinals(presentation.inputs);
		const tile = (item: IBaseHalfGenerationRecordInput): IBaseHalfInputTile => {
			const file = item.gone ? undefined : this.inputs[item.index]?.file;
			const number = ordinals[item.index];
			return Object.freeze({
				path: item.path,
				kind: item.kind,
				...(item.label !== undefined && number !== undefined ? { label: item.label, number } : {}),
				fileName: baseHalfVideoPanelInputFileName(item.path),
				...(file ? { file } : {}),
				dimmed: item.gone,
				...(item.gone ? { note: localize('basehalf.generation.record.inputGone', "Not there any more.") } : {}),
				...(item.frame ? { frame: item.frame } : {})
			});
		};
		const frames: IBaseHalfInputFrameSlot[] = [];
		const tiles: IBaseHalfInputTile[] = [];
		for (const item of presentation.inputs) {
			if (item.frame) {
				frames.push(Object.freeze({ role: item.frame, addLabel: '', tile: tile(item) }));
			} else {
				tiles.push(tile(item));
			}
		}
		return Object.freeze({
			...(frames.length ? { frames } : {}),
			tiles,
			editable: false
		});
	}

	private renderPrompt(presentation: IBaseHalfGenerationRecordPresentation): void {
		const prompt = presentation.prompt.trim() ? presentation.prompt : '';
		// The chips show the pictures of the inputs, which change when one is gone or comes back.
		const chipsKey = JSON.stringify(this.inputs.map(input => [input.path, input.available, input.file?.toString() ?? '']));
		if (this.editor.value !== prompt) {
			this.renderedChipsKey = chipsKey;
			this.editor.setValue(prompt);
			this.updatePromptLines();
		} else if (chipsKey !== this.renderedChipsKey) {
			this.renderedChipsKey = chipsKey;
			this.editor.refreshChips();
		}
	}

	/** The chip of a name in the prompt: the input it was made from of that kind and number, with its picture while it is there (D68). */
	private chipOf(name: IBaseHalfVideoLabelToken): IBaseHalfPromptChip | undefined {
		const ordinals = baseHalfInputNameOrdinals(this.inputs);
		const index = this.inputs.findIndex((input, position) => input.kind === name.kind && ordinals[position] === name.ordinal);
		if (index < 0) {
			return undefined;
		}
		const input = this.inputs[index];
		const picture = name.kind === 'image' && input.available && input.file ? FileAccess.uriToBrowserUri(input.file).toString(true) : undefined;
		return Object.freeze({ kind: name.kind, ...(picture ? { picture } : {}) });
	}

	/** The lines the prompt takes, from three to five; beyond five it scrolls. */
	private updatePromptLines(): void {
		const element = this.editor.element;
		if (element.isConnected && element.clientWidth > 0) {
			// The text's own height, whatever height the field has now.
			const height = this.editor.contentHeight() - PROMPT_PADDING * 2;
			this.promptLines = Math.min(PROMPT_MAX_LINES, Math.max(PROMPT_MIN_LINES, Math.round(height / PROMPT_LINE_HEIGHT)));
		}
		this.promptBox.style.height = `${this.promptLines * PROMPT_LINE_HEIGHT + PROMPT_PADDING * 2}px`;
		this.updateHeight();
	}

	private computeHeight(): number {
		const readable = this.presentation?.readable ?? true;
		const row = !this.inputRow.element.hidden ? INPUT_ROW_HEIGHT + SECTION_GAP : 0;
		const prompt = readable ? this.promptLines * PROMPT_LINE_HEIGHT + PROMPT_PADDING * 2 + SECTION_GAP : 0;
		const line = !this.line.hidden ? LINE_HEIGHT + SECTION_GAP : 0;
		const height = PANEL_PADDING + row + prompt + line + FOOTER_HEIGHT + PANEL_PADDING;
		return Math.min(BASEHALF_VIDEO_PANEL_MAX_HEIGHT, Math.max(BASEHALF_VIDEO_PANEL_MIN_HEIGHT, height));
	}

	private updateHeight(): void {
		const height = this.computeHeight();
		if (height === this.currentHeight) {
			return;
		}
		this.currentHeight = height;
		this.element.style.height = `${height}px`;
		this._onDidChangeHeight.fire(height);
	}
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
