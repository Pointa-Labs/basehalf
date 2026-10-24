/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfGenerationInputRow.css';
import { $, addDisposableListener, append, clearNode, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { BaseHalfVideoInputKind } from '../common/basehalfVideoCatalog.js';

/** One input of the row (generation cards, "The panel", D68). */
export interface IBaseHalfInputTile {
	/** The upstream entry: who the input is. */
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	/** The number of its name, `1` for 图片1; absent for an input without a name. */
	readonly number?: number;
	/** Its name, such as 图片1; absent for an input without a name. */
	readonly label?: string;
	/** The name of its file, as BaseHalf shows names. */
	readonly fileName: string;
	/** The file it shows: an image, or a video's first frame. Absent while it has none. */
	readonly file?: URI;
	/** Dimmed: it cannot be used, it is gone, or it has no file yet. */
	readonly dimmed: boolean;
	/** What its look says under its names: why it cannot be used, or that it is gone. */
	readonly note?: string;
	/** The start or the end frame, as its foot says. */
	readonly frame?: 'start' | 'end';
}

/** An empty start or end frame, which opens a menu of the two buttons' actions. */
export interface IBaseHalfInputFrameSlot {
	readonly role: 'start' | 'end';
	readonly tile?: IBaseHalfInputTile;
	/** The accessible name of an empty slot. */
	readonly addLabel: string;
}

export interface IBaseHalfInputRowModel {
	/** The start and the end frame, shown first and joined by the swap arrow. */
	readonly frames?: readonly IBaseHalfInputFrameSlot[];
	/** Whether the swap arrow can exchange the two frames. */
	readonly canSwap?: boolean;
	/** The other inputs, in the order of the list. */
	readonly tiles: readonly IBaseHalfInputTile[];
	/** What a row without inputs says. */
	readonly hint?: string;
	/** The inputs can be removed, named, reordered, and added to: a draft that does not generate. */
	readonly editable: boolean;
	/** Pick on Canvas is on (D69): its button is highlighted, and a click on it ends picking (D71). */
	readonly picking?: boolean;
}

/** What the row asks of the panel. */
export interface IBaseHalfInputRowDelegate {
	/** Removes the input's connection. */
	remove(path: string): void;
	/** Puts the input's name into the prompt. */
	insertName(label: string): void;
	/** Moves the input to the place of the input `before` in the list, or last. */
	move(path: string, before: string | undefined): void;
	/** Exchanges the start and the end frame. */
	swap(): void;
	/** Opens the menu of an empty frame from `trigger`: Pick on Canvas and Import File…. */
	openAddMenu(trigger: HTMLElement, byPointer: boolean): void;
	/** Starts Pick on Canvas, or ends it while it is on (D71). */
	togglePick(): void;
	/** Copies a file into the card's folder and connects it (D71). */
	importFile(): void;
	/** Gives `element` BaseHalf's tooltip. */
	setupHover(element: HTMLElement, content: string): IDisposable;
	/** The canvas in window coordinates, for keeping the look inside it. */
	canvasBounds(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}

/** What a drag does when the tile is let go. */
type InputDrop = { readonly kind: 'swap' } | { readonly kind: 'move'; readonly before: string | undefined };

/** The look at most, in screen pixels: the picture in its own shape. */
export const BASEHALF_INPUT_LOOK_MAX_WIDTH = 176;
export const BASEHALF_INPUT_LOOK_MAX_HEIGHT = 132;
/** A press that moves less than this, in screen pixels, is a click. */
const DRAG_THRESHOLD = 4;
/** How many pictures of inputs that left the row are kept for their coming back. */
const KEPT_GONE_PICTURES = 4;
const LOOK_GAP = 8;
const LOOK_MARGIN = 12;

/**
 * The input row of a generation card's panel (generation cards, "The panel",
 * D68): the card's connections as tiles, in the order of its list, and at its
 * right end, the panel's top right, Pick on Canvas and Import File… (D71). A
 * tile shows the input's picture, the number of its name, and on a frame its
 * mark; pointing at it shows a larger look above it, a cross that removes the
 * connection, and an `@` that puts its name into the prompt; a drag moves it
 * in the list. The row is read only for a card that generates and for the
 * panel of a card with its file.
 */
export class BaseHalfGenerationInputRow extends Disposable {

	readonly element: HTMLElement;

	private readonly rowStore = this._register(new DisposableStore());
	/**
	 * The pictures of the tiles, kept while their inputs are in the row:
	 * drawing the row again, as after a connection is made or removed, then
	 * decodes no picture and loads no video again, and nothing blinks.
	 */
	private readonly pictures = new Map<string, { readonly element: HTMLElement; readonly store: DisposableStore }>();
	private readonly drawnPictures = new Set<string>();
	/**
	 * The pictures of the last inputs that left the row, the latest last: an
	 * input connected again, as by a second click of Pick on Canvas or by
	 * undo, shows its picture at once.
	 */
	private readonly gonePictures = new Map<string, { readonly element: HTMLElement; readonly store: DisposableStore }>();
	/** How long each video and sound lasts, as its file told it, by picture key (D70). */
	private readonly lengths = new Map<string, number>();
	/** The length labels of the tiles drawn last, by picture key, to fill in when a file tells its length. */
	private lengthLabels = new Map<string, { readonly tile: HTMLElement; readonly label: HTMLElement; readonly data: IBaseHalfInputTile }>();
	private readonly lookStore = this._register(new DisposableStore());
	private readonly dragStore = this._register(new DisposableStore());
	private list: HTMLElement | undefined;
	private look: HTMLElement | undefined;
	private lookFor: string | undefined;
	/** What the look shows, to keep it while the row is drawn again for the same input (D71). */
	private lookKey: string | undefined;
	/** The look was shown for the keyboard's focus, which takes it away when it leaves the row. */
	private lookByFocus = false;
	private model: IBaseHalfInputRowModel | undefined;
	private renderedKey: string | undefined;
	/** The control of the row that takes its one tab stop. */
	private focusKey: string | undefined;
	private dragging = false;

	constructor(
		private readonly delegate: IBaseHalfInputRowDelegate,
		/** Where the look is put: a layer of the panel that is not clipped. */
		private readonly layer: HTMLElement
	) {
		super();
		this.element = $('.bh-input-row');
		this.element.setAttribute('role', 'group');
		this.element.setAttribute('aria-label', localize('basehalf.generation.inputRow', "Inputs"));
		this._register(toDisposable(() => {
			for (const kept of [...this.pictures.values(), ...this.gonePictures.values()]) {
				kept.store.dispose();
			}
			this.pictures.clear();
			this.gonePictures.clear();
		}));
		this._register(addDisposableListener(this.element, 'keydown', event => this.onKeyDown(event)));
		this._register(addDisposableListener(this.element, 'focusin', event => {
			const target = event.target;
			if (isHTMLElement(target) && target.dataset.key) {
				this.focusKey = target.dataset.key;
				this.updateTabStop();
				const tile = this.tileOf(target);
				if (tile && target.matches(':focus-visible')) {
					this.showLook(target, tile, true);
				}
			}
		}));
		// A look the pointer shows stays when the focus leaves, as when a tile's `@` gives the prompt the keyboard.
		this._register(addDisposableListener(this.element, 'focusout', () => {
			if (this.lookByFocus) {
				this.hideLook();
			}
		}));
		this._register(addDisposableListener(this.element, 'wheel', event => {
			// A vertical wheel scrolls the tiles sideways.
			const list = this.list;
			if (list && Math.abs(event.deltaY) > Math.abs(event.deltaX) && list.scrollWidth > list.clientWidth) {
				list.scrollLeft += event.deltaY;
				event.preventDefault();
			}
		}, { passive: false }));
	}

	/** Draws the row for `model`. Nothing is drawn again while it is the same, so pictures stay loaded. */
	update(model: IBaseHalfInputRowModel | undefined): void {
		const key = rowKey(model);
		if (key === this.renderedKey) {
			return;
		}
		this.renderedKey = key;
		this.model = model;
		const focused = this.focusedKey();
		// The tiles scrolled sideways stay where they were.
		const scrolled = this.list?.scrollLeft ?? 0;
		// The look stays when its input's tile is drawn again where it was, with what the look shows (D71).
		const looked = this.lookFor !== undefined ? this.findByKey(`tile:${this.lookFor}`)?.getBoundingClientRect() : undefined;
		this.rowStore.clear();
		clearNode(this.element);
		this.list = undefined;
		this.drawnPictures.clear();
		this.lengthLabels = new Map();
		this.element.hidden = !model;
		if (!model) {
			this.hideLook();
			this.dropUndrawnPictures();
			return;
		}
		this.element.classList.toggle('editable', model.editable);
		this.element.classList.toggle('picking', !!model.picking);
		const list = append(this.element, $('.bh-input-row-list'));
		this.list = list;
		this.rowStore.add(addDisposableListener(list, 'scroll', () => {
			this.updateOverflow();
			this.hideLook();
		}));
		model.frames?.forEach((slot, index) => {
			if (index === 1) {
				this.renderSwap(list, model);
			}
			if (slot.tile) {
				this.renderTile(list, slot.tile, model);
			} else {
				this.renderEmptyFrame(list, slot, model);
			}
		});
		for (const tile of model.tiles) {
			this.renderTile(list, tile, model);
		}
		const hint = model.picking
			? localize('basehalf.generation.inputRow.picking', "Click cards on the canvas. Escape or Done ends.")
			: model.hint;
		if (hint) {
			const text = append(this.element, $('span.bh-input-row-hint'));
			text.textContent = hint;
			if (model.picking) {
				text.setAttribute('role', 'status');
			}
		}
		if (model.editable) {
			// At the panel's top right (D71).
			const actions = append(this.element, $('.bh-input-row-actions'));
			const pick = this.renderAction(actions, 'pick', Codicon.inspect, localize('basehalf.generation.inputRow.pick', "Pick on Canvas"), () => this.delegate.togglePick());
			pick.setAttribute('aria-pressed', String(!!model.picking));
			this.renderAction(actions, 'import', Codicon.cloudUpload, localize('basehalf.generation.inputRow.import', "Import File…"), () => this.delegate.importFile());
		}
		this.dropUndrawnPictures();
		list.scrollLeft = scrolled;
		this.keepOrHideLook(looked);
		this.updateTabStop();
		if (focused) {
			this.findByKey(focused)?.focus({ preventScroll: true });
		}
		this.updateOverflow();
	}

	/** Fits the row to its width again: the fades at its edges and the look's place. */
	layout(): void {
		this.updateOverflow();
		const tile = this.lookFor ? this.findByKey(`tile:${this.lookFor}`) : undefined;
		if (tile) {
			this.placeLook(tile);
		}
	}

	override dispose(): void {
		this.hideLook();
		super.dispose();
	}

	//#region Tiles

	private renderTile(parent: HTMLElement, tile: IBaseHalfInputTile, model: IBaseHalfInputRowModel): void {
		const element = append(parent, $<HTMLElement>('.bh-input-tile'));
		element.dataset.key = `tile:${tile.path}`;
		element.dataset.path = tile.path;
		element.dataset.kind = tile.kind;
		if (tile.label) {
			element.dataset.label = tile.label;
		}
		element.tabIndex = -1;
		element.setAttribute('role', 'button');
		element.setAttribute('aria-label', tileLabel(tile));
		element.classList.toggle('dimmed', tile.dimmed);
		if (tile.frame) {
			element.dataset.frame = tile.frame;
		}
		element.append(this.picture(tile));
		if (tile.kind === 'text' || tile.kind === 'other') {
			append(element, $('span.bh-input-tile-caption')).textContent = tile.fileName;
		}
		if ((tile.kind === 'video' || tile.kind === 'audio') && tile.file) {
			// Its length, which a model's limits count (D70), once its file tells it.
			const label = append(element, $('span.bh-input-tile-length'));
			label.setAttribute('aria-hidden', 'true');
			const key = pictureKey(tile);
			this.lengthLabels.set(key, { tile: element, label, data: tile });
			this.showLength(key);
		}
		if (tile.number !== undefined) {
			append(element, $('span.bh-input-tile-number')).textContent = String(tile.number);
		}
		if (tile.frame) {
			append(element, $('span.bh-input-tile-mark')).textContent = frameMark(tile.frame);
		}
		if (model.editable) {
			const remove = append(element, $<HTMLButtonElement>('button.bh-input-tile-remove'));
			remove.type = 'button';
			remove.tabIndex = -1;
			remove.setAttribute('aria-label', localize('basehalf.generation.inputRow.remove', "Remove {0}", tile.label ?? tile.fileName));
			remove.append(renderGlyph(Codicon.close));
			this.rowStore.add(addDisposableListener(remove, 'pointerdown', event => event.stopPropagation()));
			this.rowStore.add(addDisposableListener(remove, 'click', event => {
				event.stopPropagation();
				this.hideLook();
				this.delegate.remove(tile.path);
			}));
			if (tile.label) {
				const label = tile.label;
				const name = append(element, $<HTMLButtonElement>('button.bh-input-tile-name'));
				name.type = 'button';
				name.tabIndex = -1;
				name.textContent = '@';
				name.setAttribute('aria-label', localize('basehalf.generation.inputRow.insertName', "Put {0} into the Prompt", label));
				this.rowStore.add(addDisposableListener(name, 'pointerdown', event => {
					// The prompt keeps its caret.
					event.preventDefault();
					event.stopPropagation();
				}));
				this.rowStore.add(addDisposableListener(name, 'click', event => {
					event.stopPropagation();
					this.delegate.insertName(label);
				}));
			}
			this.rowStore.add(addDisposableListener(element, 'pointerdown', event => this.startDrag(event, element, tile)));
		}
		this.rowStore.add(addDisposableListener(element, 'pointerenter', () => {
			if (!this.dragging) {
				this.showLook(element, tile, false);
			}
		}));
		this.rowStore.add(addDisposableListener(element, 'pointerleave', () => {
			if (this.lookFor === tile.path && getWindow(element).document.activeElement !== element) {
				this.hideLook();
			}
		}));
	}

	/** A button at the row's right end: an icon whose name is its tooltip and its accessible name. */
	private renderAction(parent: HTMLElement, key: string, icon: ThemeIcon, name: string, run: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.bh-input-row-action'));
		button.type = 'button';
		button.dataset.key = key;
		button.setAttribute('aria-label', name);
		button.append(renderGlyph(icon));
		this.rowStore.add(this.delegate.setupHover(button, name));
		this.rowStore.add(addDisposableListener(button, 'click', () => run()));
		return button;
	}

	private renderEmptyFrame(parent: HTMLElement, slot: IBaseHalfInputFrameSlot, model: IBaseHalfInputRowModel): void {
		const element = append(parent, $<HTMLButtonElement>('button.bh-input-tile.empty'));
		element.type = 'button';
		element.dataset.key = `slot:${slot.role}`;
		element.dataset.frame = slot.role;
		element.setAttribute('aria-label', slot.addLabel);
		element.disabled = !model.editable;
		element.append(renderGlyph(Codicon.add));
		append(element, $('span.bh-input-tile-mark')).textContent = frameMark(slot.role);
		if (model.editable) {
			element.setAttribute('aria-haspopup', 'menu');
			this.rowStore.add(addDisposableListener(element, 'click', event => this.delegate.openAddMenu(element, event.detail > 0)));
		}
	}

	private renderSwap(parent: HTMLElement, model: IBaseHalfInputRowModel): void {
		if (!model.editable) {
			append(parent, $('span.bh-input-row-arrow')).append(renderGlyph(Codicon.arrowRight));
			return;
		}
		const swap = append(parent, $<HTMLButtonElement>('button.bh-input-row-swap'));
		swap.type = 'button';
		swap.dataset.key = 'swap';
		swap.disabled = !model.canSwap;
		swap.setAttribute('aria-label', localize('basehalf.generation.inputRow.swap', "Swap Start and End Frames"));
		swap.append(renderGlyph(Codicon.arrowSwap));
		this.rowStore.add(addDisposableListener(swap, 'click', () => this.delegate.swap()));
	}

	/** Shows the length of the tile at `key`, once its file has told it. */
	private showLength(key: string): void {
		const drawn = this.lengthLabels.get(key);
		const seconds = this.lengths.get(key);
		if (!drawn) {
			return;
		}
		drawn.label.hidden = seconds === undefined;
		drawn.label.textContent = seconds === undefined ? '' : formatLength(seconds);
		drawn.tile.setAttribute('aria-label', tileLabel(drawn.data, seconds));
	}

	/** The picture of a tile: the one drawn before for the same file, while there is one. */
	private picture(tile: IBaseHalfInputTile): HTMLElement {
		const key = pictureKey(tile);
		this.drawnPictures.add(key);
		let kept = this.pictures.get(key) ?? this.gonePictures.get(key);
		if (!kept) {
			const element = $('.bh-input-tile-picture');
			const store = new DisposableStore();
			this.renderPicture(element, tile, false, store, seconds => {
				this.lengths.set(key, seconds);
				this.showLength(key);
			});
			kept = { element, store };
		}
		this.gonePictures.delete(key);
		this.pictures.set(key, kept);
		return kept.element;
	}

	/** Lets go of the pictures of the inputs that left the row. */
	private dropUndrawnPictures(): void {
		for (const [key, kept] of this.pictures) {
			if (!this.drawnPictures.has(key)) {
				this.pictures.delete(key);
				this.gonePictures.set(key, kept);
			}
		}
		for (const [key, kept] of this.gonePictures) {
			if (this.gonePictures.size <= KEPT_GONE_PICTURES) {
				break;
			}
			kept.store.dispose();
			this.gonePictures.delete(key);
			this.lengths.delete(key);
		}
	}

	private renderPicture(container: HTMLElement, tile: IBaseHalfInputTile, large: boolean, store: DisposableStore, onLength?: (seconds: number) => void): void {
		const glyph = () => {
			clearNode(container);
			container.append(renderGlyph(glyphOf(tile.kind)));
		};
		const length = (media: HTMLMediaElement) => {
			if (onLength) {
				media.addEventListener('loadedmetadata', () => {
					if (Number.isFinite(media.duration) && media.duration > 0) {
						onLength(media.duration);
					}
				}, { once: true });
			}
		};
		if (tile.kind === 'audio' && tile.file && onLength) {
			// A sound shows its glyph; its file, which draws nothing without controls, is read for its length alone.
			glyph();
			const sound = append(container, $<HTMLAudioElement>('audio'));
			sound.preload = 'metadata';
			sound.setAttribute('aria-hidden', 'true');
			length(sound);
			sound.src = FileAccess.uriToBrowserUri(tile.file).toString(true);
			store.add(toDisposable(() => {
				sound.removeAttribute('src');
				sound.load();
			}));
			return;
		}
		if (!tile.file || (tile.kind !== 'image' && tile.kind !== 'video')) {
			glyph();
			return;
		}
		const source = FileAccess.uriToBrowserUri(tile.file).toString(true);
		if (tile.kind === 'image') {
			const image = append(container, $<HTMLImageElement>('img'));
			image.alt = '';
			image.draggable = false;
			image.decoding = 'async';
			image.addEventListener('error', glyph, { once: true });
			if (large) {
				image.addEventListener('load', () => this.fitLook(image.naturalWidth, image.naturalHeight), { once: true });
			}
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
		if (large) {
			video.addEventListener('loadedmetadata', () => this.fitLook(video.videoWidth, video.videoHeight), { once: true });
		}
		length(video);
		// The first frame stands for the video.
		video.src = `${source}#t=0.1`;
		store.add(toDisposable(() => {
			video.removeAttribute('src');
			video.load();
		}));
	}

	//#endregion

	//#region The look

	private showLook(tileElement: HTMLElement, tile: IBaseHalfInputTile, byFocus: boolean): void {
		if (this.lookFor === tile.path && this.look?.isConnected) {
			this.lookByFocus &&= byFocus;
			return;
		}
		this.hideLook();
		this.lookFor = tile.path;
		this.lookKey = lookKey(tile);
		this.lookByFocus = byFocus;
		const look = append(this.layer, $('.bh-input-look'));
		look.setAttribute('aria-hidden', 'true');
		this.look = look;
		this.lookStore.add(toDisposable(() => look.remove()));
		const pictured = !!tile.file && (tile.kind === 'image' || tile.kind === 'video');
		if (pictured) {
			const picture = append(look, $('.bh-input-look-picture'));
			// A 16:9 frame until the picture says its shape.
			picture.style.width = `${BASEHALF_INPUT_LOOK_MAX_WIDTH}px`;
			picture.style.height = `${Math.round(BASEHALF_INPUT_LOOK_MAX_WIDTH * 9 / 16)}px`;
			this.renderPicture(picture, tile, true, this.lookStore);
		}
		const names = append(look, $('.bh-input-look-names'));
		if (tile.label) {
			append(names, $('span.bh-input-look-label')).textContent = tile.frame ? `${tile.label} · ${frameMark(tile.frame)}` : tile.label;
		}
		append(names, $('span.bh-input-look-file')).textContent = tile.fileName;
		if (tile.note) {
			append(look, $('.bh-input-look-note')).textContent = tile.note;
		}
		this.placeLook(tileElement);
	}

	/** Gives the picture of the look its own shape, at most the look's size. */
	private fitLook(width: number, height: number): void {
		const picture = this.look?.firstElementChild;
		if (!isHTMLElement(picture) || !picture.classList.contains('bh-input-look-picture') || width <= 0 || height <= 0) {
			return;
		}
		const scale = Math.min(BASEHALF_INPUT_LOOK_MAX_WIDTH / width, BASEHALF_INPUT_LOOK_MAX_HEIGHT / height);
		picture.style.width = `${Math.max(1, Math.round(width * scale))}px`;
		picture.style.height = `${Math.max(1, Math.round(height * scale))}px`;
		const tileElement = this.lookFor ? this.findByKey(`tile:${this.lookFor}`) : undefined;
		if (tileElement) {
			this.placeLook(tileElement);
		}
	}

	/** Above the tile, or below the row when there is no room above inside the canvas; never outside it. */
	private placeLook(tileElement: HTMLElement): void {
		const look = this.look;
		if (!look || !tileElement.isConnected) {
			return;
		}
		const origin = this.layer.getBoundingClientRect();
		const tile = tileElement.getBoundingClientRect();
		const row = this.element.getBoundingClientRect();
		const canvas = this.delegate.canvasBounds();
		const width = look.offsetWidth;
		const height = look.offsetHeight;
		let top = tile.top - LOOK_GAP - height;
		let side: 'above' | 'below' = 'above';
		if (top < canvas.top + LOOK_MARGIN) {
			top = row.bottom + LOOK_GAP;
			side = 'below';
		}
		const left = Math.max(canvas.left + LOOK_MARGIN, Math.min(tile.left, canvas.left + canvas.width - LOOK_MARGIN - width));
		look.dataset.side = side;
		look.style.left = `${Math.round(left - origin.left)}px`;
		look.style.top = `${Math.round(top - origin.top)}px`;
	}

	private hideLook(): void {
		this.lookFor = undefined;
		this.lookKey = undefined;
		this.lookByFocus = false;
		this.look = undefined;
		this.lookStore.clear();
	}

	/**
	 * After the row is drawn again: keeps the look when its input's tile is
	 * where it was, `before`, and the look would show the same, so that it does
	 * not blink; the pointer is still on that tile. Otherwise takes it away.
	 */
	private keepOrHideLook(before: DOMRect | undefined): void {
		const path = this.lookFor;
		if (path === undefined) {
			return;
		}
		const tile = this.tileOf(this.findByKey(`tile:${path}`));
		const element = tile && this.findByKey(`tile:${path}`);
		const now = element?.getBoundingClientRect();
		const samePlace = !!before && !!now && Math.abs(before.left - now.left) < 0.5 && Math.abs(before.top - now.top) < 0.5;
		if (!tile || !element || !samePlace || lookKey(tile) !== this.lookKey || !this.look?.isConnected) {
			this.hideLook();
			return;
		}
		this.placeLook(element);
	}

	//#endregion

	//#region Dragging

	private startDrag(event: PointerEvent, element: HTMLElement, tile: IBaseHalfInputTile): void {
		if (event.button !== 0 || !this.model?.editable) {
			return;
		}
		event.stopPropagation();
		this.dragStore.clear();
		const startX = event.clientX;
		const startY = event.clientY;
		const pointerId = event.pointerId;
		let moved = false;
		let drop: InputDrop | undefined;
		const marker = $('.bh-input-row-drop');
		this.dragStore.add(toDisposable(() => {
			marker.remove();
			element.classList.remove('dragging');
			this.element.classList.remove('dragging');
			this.dragging = false;
			if (element.hasPointerCapture(pointerId)) {
				element.releasePointerCapture(pointerId);
			}
		}));
		this.dragStore.add(addDisposableListener(element, 'pointermove', move => {
			if (move.pointerId !== pointerId) {
				return;
			}
			if (!moved && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) {
				return;
			}
			if (!moved) {
				moved = true;
				this.dragging = true;
				this.hideLook();
				try {
					element.setPointerCapture(pointerId);
				} catch {
					// A pointer that is no longer down: the drag ends at its next event.
				}
				element.classList.add('dragging');
				this.element.classList.add('dragging');
			}
			drop = this.dropPlace(move.clientX, tile, marker);
		}));
		const finish = (end: PointerEvent, apply: boolean) => {
			if (end.pointerId !== pointerId) {
				return;
			}
			const target = drop;
			const didMove = moved;
			this.dragStore.clear();
			if (!apply || !didMove || !target) {
				return;
			}
			if (target.kind === 'swap') {
				this.delegate.swap();
			} else {
				this.delegate.move(tile.path, target.before);
			}
		};
		this.dragStore.add(addDisposableListener(element, 'pointerup', end => finish(end, true)));
		this.dragStore.add(addDisposableListener(element, 'pointercancel', end => finish(end, false)));
	}

	/**
	 * Where a drag at `x` puts the tile: before the input whose tile's middle
	 * is right of `x`, or last; nothing when that is where it is. The frames
	 * and the other inputs are two groups: a frame dragged past the other
	 * exchanges them, and another input moves among the others.
	 */
	private dropPlace(x: number, dragged: IBaseHalfInputTile, marker: HTMLElement): InputDrop | undefined {
		const model = this.model;
		const list = this.list;
		if (!model || !list) {
			return undefined;
		}
		const group = dragged.frame
			? (model.frames ?? []).flatMap(slot => slot.tile ? [slot.tile] : [])
			: model.tiles;
		const elements = group.map(tile => this.findByKey(`tile:${tile.path}`));
		let index = group.length;
		for (let position = 0; position < group.length; position++) {
			const rect = elements[position]?.getBoundingClientRect();
			if (rect && x < rect.left + rect.width / 2) {
				index = position;
				break;
			}
		}
		const from = group.indexOf(dragged);
		if (index === from || index === from + 1) {
			marker.remove();
			return undefined;
		}
		// The marker stands in the gap the tile would go to.
		const anchor = elements[index] ?? elements[group.length - 1];
		if (anchor) {
			const listRect = list.getBoundingClientRect();
			const rect = anchor.getBoundingClientRect();
			marker.style.left = `${Math.round((index < group.length ? rect.left - 4 : rect.right + 2) - listRect.left + list.scrollLeft)}px`;
			if (!marker.isConnected) {
				list.append(marker);
			}
		}
		if (dragged.frame) {
			return model.canSwap ? { kind: 'swap' } : undefined;
		}
		return { kind: 'move', before: index < group.length ? group[index].path : undefined };
	}

	//#endregion

	//#region Keyboard

	private onKeyDown(event: KeyboardEvent): void {
		const controls = this.controls();
		const index = controls.findIndex(control => control === event.target);
		if (index < 0) {
			return;
		}
		const control = controls[index];
		const tile = this.tileOf(control);
		if (tile && this.model?.editable) {
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				event.stopPropagation();
				this.delegate.remove(tile.path);
				return;
			}
			if (event.key === 'Enter' && tile.label) {
				event.preventDefault();
				event.stopPropagation();
				this.delegate.insertName(tile.label);
				return;
			}
			if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
				event.preventDefault();
				event.stopPropagation();
				this.moveByKey(tile, event.key === 'ArrowLeft' ? -1 : 1);
				return;
			}
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

	/** Moves a tile one place among its group: the frames, or the other inputs. */
	private moveByKey(tile: IBaseHalfInputTile, step: -1 | 1): void {
		const model = this.model;
		if (!model) {
			return;
		}
		if (tile.frame) {
			if (model.canSwap) {
				this.delegate.swap();
			}
			return;
		}
		const index = model.tiles.indexOf(tile);
		const target = index + step;
		if (index < 0 || target < 0 || target >= model.tiles.length) {
			return;
		}
		this.delegate.move(tile.path, step < 0 ? model.tiles[target].path : model.tiles[target + 1]?.path);
	}

	/** The tiles and buttons of the row, in order. The row is one tab stop; the arrow keys move between them. */
	private controls(): HTMLElement[] {
		const controls: HTMLElement[] = [];
		const visit = (parent: Element) => {
			for (const child of parent.children) {
				if (isHTMLElement(child) && child.dataset.key && !(child as HTMLButtonElement).disabled) {
					controls.push(child);
					continue;
				}
				visit(child);
			}
		};
		visit(this.element);
		return controls;
	}

	private updateTabStop(): void {
		const controls = this.controls();
		const current = controls.find(control => control.dataset.key === this.focusKey) ?? controls[0];
		for (const control of controls) {
			control.tabIndex = control === current ? 0 : -1;
		}
	}

	//#endregion

	private tileOf(element: HTMLElement | undefined): IBaseHalfInputTile | undefined {
		const path = element?.dataset.path;
		if (!element || path === undefined || !element.classList.contains('bh-input-tile')) {
			return undefined;
		}
		const model = this.model;
		return model?.tiles.find(tile => tile.path === path) ?? model?.frames?.find(slot => slot.tile?.path === path)?.tile;
	}

	private focusedKey(): string | undefined {
		const active = getWindow(this.element).document.activeElement;
		return isHTMLElement(active) && this.element.contains(active) ? active.dataset.key : undefined;
	}

	private findByKey(key: string): HTMLElement | undefined {
		const visit = (parent: Element): HTMLElement | undefined => {
			for (const child of parent.children) {
				if (isHTMLElement(child)) {
					if (child.dataset.key === key) {
						return child;
					}
					const found = visit(child);
					if (found) {
						return found;
					}
				}
			}
			return undefined;
		};
		return visit(this.element);
	}

	/** Fades the edge of the tiles where more of them are scrolled out of sight. */
	private updateOverflow(): void {
		const list = this.list;
		if (!list?.isConnected) {
			return;
		}
		list.classList.toggle('overflow-start', list.scrollLeft > 1);
		list.classList.toggle('overflow-end', list.scrollLeft + list.clientWidth < list.scrollWidth - 1);
	}
}

/** What identifies a tile's picture: its input and its file. */
function pictureKey(tile: IBaseHalfInputTile): string {
	return `${tile.path}\0${tile.kind}\0${tile.file?.toString() ?? ''}`;
}

/** What the look at a tile shows: its picture and its names. */
function lookKey(tile: IBaseHalfInputTile): string {
	return JSON.stringify([pictureKey(tile), tile.label ?? '', tile.frame ?? '', tile.fileName, tile.note ?? '']);
}

/**
 * What the row shows, as a key: two models with the same key draw the same
 * row. A file counts by its address alone: a URI's JSON carries the fields it
 * caches, which reading its path adds and reading the inputs again drops, and
 * they would draw the row again for nothing (D71).
 */
function rowKey(model: IBaseHalfInputRowModel | undefined): string {
	if (!model) {
		return 'null';
	}
	const tile = (value: IBaseHalfInputTile) => ({ ...value, file: value.file?.toString() });
	return JSON.stringify({
		...model,
		frames: model.frames?.map(slot => ({ ...slot, tile: slot.tile && tile(slot.tile) })),
		tiles: model.tiles.map(tile)
	});
}

/** A length as a tile shows it: 6.8s. */
function formatLength(seconds: number): string {
	return localize('basehalf.generation.inputRow.length', "{0}s", seconds.toFixed(1));
}

function tileLabel(tile: IBaseHalfInputTile, seconds?: number): string {
	const name = tile.label ?? tile.fileName;
	const parts = [tile.frame ? `${name}, ${frameMark(tile.frame)}` : name];
	if (tile.label) {
		parts.push(tile.fileName);
	}
	if (seconds !== undefined) {
		parts.push(localize('basehalf.generation.inputRow.lengthSpoken', "{0} seconds", seconds.toFixed(1)));
	}
	if (tile.note) {
		parts.push(tile.note);
	}
	return parts.join(', ');
}

function frameMark(frame: 'start' | 'end'): string {
	return frame === 'start'
		? localize('basehalf.generation.inputRow.start', "Start")
		: localize('basehalf.generation.inputRow.end', "End");
}

function glyphOf(kind: BaseHalfVideoInputKind): ThemeIcon {
	switch (kind) {
		case 'image': return Codicon.fileMedia;
		case 'video': return Codicon.play;
		case 'audio': return Codicon.unmute;
		case 'text': return Codicon.fileText;
		default: return Codicon.file;
	}
}

function renderGlyph(icon: ThemeIcon): HTMLElement {
	const element = renderIcon(icon);
	element.setAttribute('aria-hidden', 'true');
	return element;
}
