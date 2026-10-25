/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfImageCropView.css';
import { $, addDisposableListener, append, getWindow } from '../../../../base/browser/dom.js';
import { toAction, Separator } from '../../../../base/common/actions.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { BASEHALF_EDIT_MAX_STRAIGHTEN, IBaseHalfMediaChoices } from '../common/basehalfEditRecord.js';
import {
	BASEHALF_CROP_RATIOS,
	BaseHalfCropCorner,
	BaseHalfCropRatio,
	BaseHalfCropSide,
	baseHalfApplyCropRatio,
	baseHalfClampCropCenter,
	baseHalfCropChoices,
	baseHalfCropIsOriginal,
	baseHalfCropMinSize,
	baseHalfCropStateOf,
	baseHalfDragCropCorner,
	baseHalfDragCropSide,
	baseHalfFlipCrop,
	baseHalfLargestCrop,
	baseHalfMoveCrop,
	baseHalfPictureTransform,
	baseHalfRotate,
	baseHalfSameRatio,
	baseHalfStraightenCrop,
	baseHalfTurnCropLeft,
	baseHalfTurnedSize,
	baseHalfWholeCrop,
	IBaseHalfCropState,
	IBaseHalfPoint,
	IBaseHalfSize
} from '../common/basehalfImageCrop.js';
import { IBaseHalfMediaEditor, IBaseHalfMediaEditStatus } from './basehalfMediaEditor.js';

/**
 * The crop view of an image in Card Detail's edit mode (editing media,
 * "Cropping an image"): the original, turned, flipped, and straightened as
 * the choices say, under the crop frame, with the picture outside it dimmed;
 * a row of tools under it (Turn Left, Flip, Ratio, the Straighten dial, and
 * Reset), and a line of status. At rest the frame is as large as fits, in
 * the middle of the view; while a corner or a side is dragged the picture
 * stays and the frame moves, and when the drag ends both glide until the
 * frame is at rest again.
 */

export interface IBaseHalfImageCropViewOptions {
	/** The original of an edited image, or the image. */
	readonly source: URI;
	/** Its size, upright as its camera gave it. */
	readonly size: IBaseHalfSize;
	/** The choices that the view starts with: those of the edit before. */
	readonly choices: IBaseHalfMediaChoices;
}

/** The room between the frame at rest and the edges of the view. */
const MARGIN = 24;
const GLIDE_MILLISECONDS = 200;
/** Pixels of the dial for each degree. */
const DIAL_PIXELS_PER_DEGREE = 6;
/** Within this of 0°, a turn of the dial rests at 0°. */
const DIAL_SNAP_DEGREES = 0.4;
/** How long keys that move a corner or the picture wait before the frame comes to rest. */
const KEY_REST_MILLISECONDS = 600;
/** The smallest the frame may be on screen while it is dragged. */
const MIN_FRAME_PIXELS = 48;

/** Where the picture is on screen: the point of the picture at the middle of the view, and the screen pixels for each pixel of the picture. */
interface IMapping {
	readonly center: IBaseHalfPoint;
	readonly scale: number;
}

type RatioId = 'free' | 'original' | string;

interface ICropChoice {
	readonly state: IBaseHalfCropState;
	readonly ratio: RatioId;
	readonly tall: boolean;
}

type DragKind = { readonly kind: 'corner'; readonly corner: BaseHalfCropCorner } | { readonly kind: 'side'; readonly side: BaseHalfCropSide } | { readonly kind: 'move' } | { readonly kind: 'dial' };

interface IDrag {
	readonly what: DragKind;
	readonly pointerId: number;
	readonly startX: number;
	readonly startY: number;
	readonly before: ICropChoice;
	/** The screen offset from the pointer to the point it holds: a corner's or a side's place. */
	readonly grabX: number;
	readonly grabY: number;
	readonly mapping: IMapping;
}

export class BaseHalfImageCropView extends Disposable implements IBaseHalfMediaEditor {

	readonly element: HTMLElement;
	private readonly view: HTMLElement;
	private readonly picture: HTMLImageElement;
	private readonly frame: HTMLElement;
	private readonly sizeLabel: HTMLElement;
	private readonly corners = new Map<BaseHalfCropCorner, HTMLElement>();
	private readonly sides = new Map<BaseHalfCropSide, HTMLElement>();
	private readonly turnButton: HTMLButtonElement;
	private readonly flipButton: HTMLButtonElement;
	private readonly ratioButton: HTMLButtonElement;
	private readonly ratioText: HTMLElement;
	private readonly dial: HTMLElement;
	private readonly dialRuler: HTMLElement;
	private readonly dialValue: HTMLElement;
	private readonly resetButton: HTMLButtonElement;
	private readonly status: HTMLElement;

	private readonly onDidChangeEmitter = this._register(new Emitter<void>());
	readonly onDidChange = this.onDidChangeEmitter.event;
	private readonly onDidRequestSaveEmitter = this._register(new Emitter<void>());
	readonly onDidRequestSave = this.onDidRequestSaveEmitter.event;

	private readonly original: IBaseHalfSize;
	private state: IBaseHalfCropState;
	private ratio: RatioId;
	private tall: boolean;
	private mapping: IMapping = { center: { x: 0, y: 0 }, scale: 1 };
	private viewSize: IBaseHalfSize = { width: 0, height: 0 };
	private readonly undoStack: ICropChoice[] = [];
	private readonly redoStack: ICropChoice[] = [];
	private drag: IDrag | undefined;
	private busy = false;
	private glideFrame: number | undefined;
	private keyRest: ReturnType<typeof setTimeout> | undefined;
	/** What the view held when keys started to move a corner or the picture, for one step of its undo. */
	private keyBefore: ICropChoice | undefined;
	private wheelRest: ReturnType<typeof setTimeout> | undefined;
	private wheelBefore: ICropChoice | undefined;
	private disposed = false;

	constructor(
		container: HTMLElement,
		options: IBaseHalfImageCropViewOptions,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IHoverService private readonly hoverService: IHoverService
	) {
		super();
		this.original = options.size;
		this.state = baseHalfCropStateOf(this.original, options.choices);
		const picture = this.pictureSize();
		this.tall = picture.height > picture.width;
		this.ratio = 'free';
		// An edit that kept the picture's ratio, or one of the menu's, goes on with it; any other starts freeform.
		const crop = options.choices.crop;
		if (crop) {
			const ratio = crop.width / crop.height;
			const preset = BASEHALF_CROP_RATIOS.find(candidate => baseHalfSameRatio(ratio, candidate.width / candidate.height, crop.width) || baseHalfSameRatio(ratio, candidate.height / candidate.width, crop.width));
			if (baseHalfSameRatio(ratio, picture.width / picture.height, crop.width)) {
				this.ratio = 'original';
			} else if (preset) {
				this.ratio = preset.id;
				this.tall = crop.height > crop.width;
			}
		}

		this.element = append(container, $('.basehalf-image-crop'));
		this.element.setAttribute('role', 'group');
		this.element.setAttribute('aria-label', localize('basehalf.mediaEdit.image.label', "Crop"));
		this.view = append(this.element, $('.basehalf-image-crop-view'));
		this.picture = append(this.view, $<HTMLImageElement>('img.basehalf-image-crop-picture'));
		this.picture.alt = '';
		this.picture.draggable = false;
		this.picture.src = FileAccess.uriToBrowserUri(options.source.with({ query: [options.source.query, `basehalfMediaEdit=${Date.now()}`].filter(Boolean).join('&') })).toString(true);
		this.frame = append(this.view, $('.basehalf-image-crop-frame'));
		this.frame.tabIndex = 0;
		this.frame.setAttribute('role', 'application');
		this.frame.setAttribute('aria-roledescription', localize('basehalf.mediaEdit.image.frameRole', "crop frame"));
		for (const line of ['v1', 'v2', 'h1', 'h2']) {
			append(this.frame, $(`.basehalf-image-crop-grid.${line}`));
		}
		for (const side of ['top', 'right', 'bottom', 'left'] as const) {
			this.sides.set(side, append(this.frame, $(`.basehalf-image-crop-side.${side}`)));
		}
		for (const [corner, label] of [
			['topLeft', localize('basehalf.mediaEdit.image.topLeft', "Top Left Corner")],
			['topRight', localize('basehalf.mediaEdit.image.topRight', "Top Right Corner")],
			['bottomRight', localize('basehalf.mediaEdit.image.bottomRight', "Bottom Right Corner")],
			['bottomLeft', localize('basehalf.mediaEdit.image.bottomLeft', "Bottom Left Corner")]
		] as const) {
			const handle = append(this.frame, $(`.basehalf-image-crop-corner.${corner}`));
			handle.tabIndex = 0;
			handle.setAttribute('role', 'button');
			handle.setAttribute('aria-label', label);
			this.corners.set(corner, handle);
		}
		this.sizeLabel = append(this.view, $('.basehalf-image-crop-size'));

		const tools = append(this.element, $('.basehalf-image-crop-tools'));
		this.turnButton = this.toolButton(tools, 'turn', localize('basehalf.mediaEdit.image.turnLeft', "Turn Left"), TURN_LEFT_PATH);
		this.flipButton = this.toolButton(tools, 'flip', localize('basehalf.mediaEdit.image.flip', "Flip"), FLIP_PATH);
		this.ratioButton = this.toolButton(tools, 'ratio', localize('basehalf.mediaEdit.image.ratio', "Ratio"), RATIO_PATH);
		this.ratioText = append(this.ratioButton, $('span.basehalf-image-crop-ratio-label'));
		this.ratioButton.setAttribute('aria-haspopup', 'menu');
		this.dial = append(tools, $('.basehalf-image-crop-dial'));
		this.dial.tabIndex = 0;
		this.dial.setAttribute('role', 'slider');
		this.dial.setAttribute('aria-label', localize('basehalf.mediaEdit.image.straighten', "Straighten"));
		this.dial.setAttribute('aria-valuemin', String(-BASEHALF_EDIT_MAX_STRAIGHTEN));
		this.dial.setAttribute('aria-valuemax', String(BASEHALF_EDIT_MAX_STRAIGHTEN));
		this.dialValue = append(this.dial, $('.basehalf-image-crop-dial-value'));
		const window = append(this.dial, $('.basehalf-image-crop-dial-window'));
		this.dialRuler = append(window, $('.basehalf-image-crop-dial-ruler'));
		append(window, $('.basehalf-image-crop-dial-mark'));
		this._register(this.hoverService.setupDelayedHover(this.dial, () => ({ content: localize('basehalf.mediaEdit.image.straightenHover', "Straighten (double-click for 0°)") })));
		this.resetButton = append(tools, $<HTMLButtonElement>('button.basehalf-image-crop-reset'));
		this.resetButton.type = 'button';
		this.resetButton.textContent = localize('basehalf.mediaEdit.image.reset', "Reset");
		this.status = append(this.element, $('.basehalf-image-crop-status'));
		this.status.setAttribute('aria-live', 'polite');

		this._register(toDisposable(() => {
			this.disposed = true;
			this.stopGlide();
			if (this.keyRest !== undefined) {
				clearTimeout(this.keyRest);
			}
			if (this.wheelRest !== undefined) {
				clearTimeout(this.wheelRest);
			}
		}));
		this.registerListeners();
		this.layout();
	}

	get choices(): IBaseHalfMediaChoices {
		return baseHalfCropChoices(this.original, this.state);
	}

	focus(): void {
		this.corners.get('topLeft')!.focus({ preventScroll: true });
	}

	undo(): boolean {
		return this.step(this.undoStack, this.redoStack);
	}

	redo(): boolean {
		return this.step(this.redoStack, this.undoStack);
	}

	private step(from: ICropChoice[], to: ICropChoice[]): boolean {
		if (this.busy || this.drag || !from.length) {
			return false;
		}
		this.settlePending();
		to.push(this.current());
		this.restore(from.pop()!);
		this.onDidChangeEmitter.fire();
		return true;
	}

	setBusy(busy: boolean): void {
		this.busy = busy;
		if (busy) {
			this.cancelDrag();
		}
		this.render();
	}

	setStatus(status: IBaseHalfMediaEditStatus | undefined): void {
		this.status.textContent = status?.text ?? '';
		this.status.classList.toggle('error', !!status?.error);
	}

	// #region The state

	private pictureSize(state = this.state): IBaseHalfSize {
		return baseHalfTurnedSize(this.original, state.turn);
	}

	private current(): ICropChoice {
		return { state: this.state, ratio: this.ratio, tall: this.tall };
	}

	private restore(choice: ICropChoice): void {
		this.state = choice.state;
		this.ratio = choice.ratio;
		this.tall = choice.tall;
		this.mapping = this.restMapping();
		this.render();
	}

	/** Keeps what the view held before a change for its undo. */
	private remember(before: ICropChoice): void {
		if (JSON.stringify(before) === JSON.stringify(this.current())) {
			return;
		}
		this.undoStack.push(before);
		this.redoStack.length = 0;
		this.onDidChangeEmitter.fire();
	}

	/** The ratio the frame keeps: none when freeform. */
	private ratioValue(choice: Pick<ICropChoice, 'ratio' | 'tall'> = { ratio: this.ratio, tall: this.tall }): BaseHalfCropRatio {
		if (choice.ratio === 'free') {
			return undefined;
		}
		if (choice.ratio === 'original') {
			const picture = this.pictureSize();
			return picture.width / picture.height;
		}
		const preset = BASEHALF_CROP_RATIOS.find(candidate => candidate.id === choice.ratio);
		if (!preset) {
			return undefined;
		}
		return choice.tall ? preset.height / preset.width : preset.width / preset.height;
	}

	private change(next: IBaseHalfCropState, glide: boolean, ratio = this.ratio, tall = this.tall): void {
		const before = this.current();
		this.state = next;
		this.ratio = ratio;
		this.tall = tall;
		if (glide) {
			this.glideToRest();
		} else {
			this.mapping = this.restMapping();
			this.render();
		}
		this.remember(before);
	}

	// #endregion

	// #region The screen

	/** The mapping at rest: the part kept as large as fits, in the middle of the view. */
	private restMapping(state = this.state): IMapping {
		const room = { width: Math.max(1, this.viewSize.width - 2 * MARGIN), height: Math.max(1, this.viewSize.height - 2 * MARGIN) };
		return { center: { x: state.crop.x, y: state.crop.y }, scale: Math.min(room.width / state.crop.width, room.height / state.crop.height) };
	}

	/** Where a point of the picture shows, from the view's top left. */
	private toScreen(point: IBaseHalfPoint, mapping = this.mapping): IBaseHalfPoint {
		const turned = baseHalfRotate({ x: (point.x - mapping.center.x) * mapping.scale, y: (point.y - mapping.center.y) * mapping.scale }, this.state.straighten);
		return { x: this.viewSize.width / 2 + turned.x, y: this.viewSize.height / 2 + turned.y };
	}

	/** The point of the picture under a point of the view. */
	private toPicture(point: IBaseHalfPoint, mapping = this.mapping): IBaseHalfPoint {
		const back = baseHalfRotate({ x: (point.x - this.viewSize.width / 2) / mapping.scale, y: (point.y - this.viewSize.height / 2) / mapping.scale }, -this.state.straighten);
		return { x: mapping.center.x + back.x, y: mapping.center.y + back.y };
	}

	private viewPoint(event: { readonly clientX: number; readonly clientY: number }): IBaseHalfPoint {
		const bounds = this.view.getBoundingClientRect();
		return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
	}

	private layout(): void {
		const width = this.view.clientWidth;
		const height = this.view.clientHeight;
		if (width === this.viewSize.width && height === this.viewSize.height) {
			return;
		}
		this.viewSize = { width, height };
		if (!this.drag) {
			this.stopGlide();
			this.mapping = this.restMapping();
		}
		this.render();
	}

	private glideToRest(): void {
		this.stopGlide();
		const from = this.mapping;
		const to = this.restMapping();
		const window = getWindow(this.element);
		const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		if (reduced) {
			this.mapping = to;
			this.render();
			return;
		}
		const start = window.performance.now();
		const tick = () => {
			const t = Math.min(1, (window.performance.now() - start) / GLIDE_MILLISECONDS);
			const eased = 1 - Math.pow(1 - t, 3);
			this.mapping = {
				center: { x: from.center.x + (to.center.x - from.center.x) * eased, y: from.center.y + (to.center.y - from.center.y) * eased },
				scale: Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * eased)
			};
			this.render();
			this.glideFrame = t < 1 && !this.disposed ? window.requestAnimationFrame(tick) : undefined;
		};
		this.glideFrame = window.requestAnimationFrame(tick);
	}

	private stopGlide(): void {
		if (this.glideFrame !== undefined) {
			getWindow(this.element).cancelAnimationFrame(this.glideFrame);
			this.glideFrame = undefined;
		}
	}

	// #endregion

	// #region The pointer

	private registerListeners(): void {
		// A press in the crop view is the view's: it reaches neither Card Detail nor the canvas.
		for (const type of ['mousedown', 'click', 'dblclick'] as const) {
			this._register(addDisposableListener(this.element, type, event => event.stopPropagation()));
		}
		this._register(addDisposableListener(this.view, 'pointerdown', event => this.onPointerDown(event)));
		this._register(addDisposableListener(this.dial, 'pointerdown', event => this.onPointerDown(event, { kind: 'dial' })));
		this._register(addDisposableListener(this.view, 'pointermove', event => this.onPointerMove(event)));
		this._register(addDisposableListener(this.dial, 'pointermove', event => this.onPointerMove(event)));
		for (const target of [this.view, this.dial]) {
			for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
				this._register(addDisposableListener(target, type, event => this.onPointerUp(event)));
			}
		}
		this._register(addDisposableListener(this.view, 'wheel', event => this.onWheel(event), { passive: false }));
		this._register(addDisposableListener(this.dial, 'dblclick', () => {
			if (!this.busy) {
				this.settlePending();
				this.change(baseHalfStraightenCrop(this.original, this.state, 0), false);
			}
		}));
		this._register(addDisposableListener(getWindow(this.element), 'keydown', event => {
			// Escape during a drag ends it and puts back what it changed; edit mode stays (editing media, "The keyboard").
			if (event.key === 'Escape' && this.drag) {
				event.preventDefault();
				event.stopPropagation();
				this.cancelDrag();
			}
		}, true));
		this._register(addDisposableListener(this.element, 'keydown', event => this.onKeyDown(event)));
		// A turn to the left turns a set ratio with the frame: a wide one becomes tall.
		this._register(addDisposableListener(this.turnButton, 'click', () => this.run(() => this.change(baseHalfTurnCropLeft(this.original, this.state), false, this.ratio, !this.tall))));
		this._register(addDisposableListener(this.flipButton, 'click', () => this.run(() => this.change(baseHalfFlipCrop(this.original, this.state), false))));
		this._register(addDisposableListener(this.ratioButton, 'click', () => this.run(() => this.showRatioMenu())));
		this._register(addDisposableListener(this.resetButton, 'click', () => this.run(() => {
			if (!baseHalfCropIsOriginal(this.original, this.state)) {
				this.change({ turn: 0, flip: false, straighten: 0, crop: baseHalfWholeCrop(this.original) }, false, 'free', this.original.height > this.original.width);
			}
		})));
		this._register(addDisposableListener(this.picture, 'load', () => this.render()));
		const ResizeObserverConstructor = getWindow(this.element).ResizeObserver;
		if (ResizeObserverConstructor) {
			const observer = new ResizeObserverConstructor(() => this.layout());
			observer.observe(this.view);
			this._register(toDisposable(() => observer.disconnect()));
		}
	}

	/** Runs a tool's action unless a save runs. */
	private run(action: () => void): void {
		if (!this.busy && !this.drag) {
			this.settlePending();
			action();
		}
	}

	private onPointerDown(event: PointerEvent, forced?: DragKind): void {
		if (event.button !== 0 || this.busy) {
			return;
		}
		const target = event.target as Element | null;
		let what: DragKind | undefined = forced;
		let anchor: IBaseHalfPoint | undefined;
		if (!what) {
			const corner = [...this.corners].find(([, element]) => element.contains(target))?.[0];
			const side = [...this.sides].find(([, element]) => element.contains(target))?.[0];
			if (corner) {
				what = { kind: 'corner', corner };
				anchor = this.cornerPoint(corner);
			} else if (side) {
				what = { kind: 'side', side };
				anchor = this.sidePoint(side);
			} else if (this.frame.contains(target) || target === this.picture || target === this.view) {
				what = { kind: 'move' };
			}
		}
		if (!what) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.settlePending();
		this.stopGlide();
		const at = this.viewPoint(event);
		const grab = anchor ? this.toScreen(anchor) : at;
		this.drag = { what, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, before: this.current(), grabX: grab.x - at.x, grabY: grab.y - at.y, mapping: this.mapping };
		const capture = what.kind === 'dial' ? this.dial : this.view;
		try {
			capture.setPointerCapture(event.pointerId);
		} catch {
			// A pointer that is no longer active cannot be captured; the press still counts.
		}
		this.element.classList.add('adjusting');
		this.render();
	}

	private onPointerMove(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		const at = this.viewPoint(event);
		const held = { x: at.x + drag.grabX, y: at.y + drag.grabY };
		const before = drag.before.state;
		// While the frame is dragged it is never smaller on screen than its handles need.
		const minimum = Math.max(baseHalfCropMinSize(this.pictureSize(before)), MIN_FRAME_PIXELS / drag.mapping.scale);
		switch (drag.what.kind) {
			case 'corner':
				this.state = baseHalfDragCropCorner(this.original, before, drag.what.corner, this.toPicture(held, drag.mapping), this.ratioValue(drag.before), minimum);
				break;
			case 'side':
				this.state = baseHalfDragCropSide(this.original, before, drag.what.side, this.toPicture(held, drag.mapping), this.ratioValue(drag.before), minimum);
				break;
			case 'move': {
				// The frame stays where it is and the picture moves under it.
				const moved = baseHalfRotate({ x: -(event.clientX - drag.startX) / drag.mapping.scale, y: -(event.clientY - drag.startY) / drag.mapping.scale }, -before.straighten);
				this.state = baseHalfMoveCrop(this.original, before, moved);
				this.mapping = { center: { x: this.state.crop.x, y: this.state.crop.y }, scale: drag.mapping.scale };
				break;
			}
			case 'dial': {
				// The ruler moves with the pointer: the angle under the mark grows as it is moved to the left.
				let degrees = before.straighten - (event.clientX - drag.startX) / DIAL_PIXELS_PER_DEGREE;
				if (Math.abs(degrees) < DIAL_SNAP_DEGREES) {
					degrees = 0;
				}
				this.state = baseHalfStraightenCrop(this.original, before, degrees, before.crop);
				// The frame stays at rest and the picture grows under it as far as the angle needs.
				this.mapping = this.restMapping();
				break;
			}
		}
		this.render();
	}

	private onPointerUp(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		this.drag = undefined;
		this.element.classList.remove('adjusting');
		if (drag.what.kind === 'corner' || drag.what.kind === 'side') {
			this.glideToRest();
		} else {
			this.mapping = this.restMapping();
			this.render();
		}
		this.remember(drag.before);
	}

	private cancelDrag(): void {
		const drag = this.drag;
		if (!drag) {
			return;
		}
		this.drag = undefined;
		this.element.classList.remove('adjusting');
		this.restore(drag.before);
	}

	/**
	 * The wheel, or a pinch, over the picture shows the part larger or
	 * smaller: the frame keeps its place on screen while the part it holds
	 * gets smaller or larger around the pointer, from 64 pixels on its shorter
	 * side to the largest part of its shape that the picture holds.
	 */
	private onWheel(event: WheelEvent): void {
		if (this.busy || this.drag) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.stopGlide();
		if (!this.wheelBefore) {
			this.wheelBefore = this.current();
		}
		const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
		const { crop, straighten } = this.state;
		const picture = this.pictureSize();
		const ratio = crop.width / crop.height;
		const largest = baseHalfLargestCrop(picture, ratio, straighten).width;
		const smallest = baseHalfCropMinSize(picture) * Math.max(1, ratio);
		const width = Math.min(largest, Math.max(smallest, crop.width / factor));
		const scale = this.mapping.scale * crop.width / width;
		// The point of the picture under the pointer stays under it.
		const at = this.viewPoint(event);
		const held = this.toPicture(at);
		const offset = baseHalfRotate({ x: (at.x - this.viewSize.width / 2) / scale, y: (at.y - this.viewSize.height / 2) / scale }, -straighten);
		const next = baseHalfClampCropCenter(picture, { x: held.x - offset.x, y: held.y - offset.y, width, height: width / ratio }, straighten);
		this.state = { ...this.state, crop: next };
		this.mapping = { center: { x: next.x, y: next.y }, scale };
		this.render();
		if (this.wheelRest !== undefined) {
			clearTimeout(this.wheelRest);
		}
		this.wheelRest = setTimeout(() => this.settlePending(), KEY_REST_MILLISECONDS);
	}

	/** Ends a sequence of keys or of the wheel: the frame comes to rest, and the change is one step of the view's undo. */
	private settlePending(): void {
		if (this.keyRest !== undefined) {
			clearTimeout(this.keyRest);
			this.keyRest = undefined;
		}
		if (this.wheelRest !== undefined) {
			clearTimeout(this.wheelRest);
			this.wheelRest = undefined;
		}
		const before = this.keyBefore ?? this.wheelBefore;
		this.keyBefore = undefined;
		this.wheelBefore = undefined;
		if (before) {
			this.glideToRest();
			this.remember(before);
		}
	}

	// #endregion

	// #region The keyboard

	private onKeyDown(event: KeyboardEvent): void {
		if (event.isComposing) {
			return;
		}
		const target = event.target as Element | null;
		if (event.key === 'Enter' && target && (target === this.frame || this.frame.contains(target) || target === this.dial)) {
			// Enter on a control of the editor saves; on a button it presses the button.
			event.preventDefault();
			event.stopPropagation();
			this.settlePending();
			this.onDidRequestSaveEmitter.fire();
			return;
		}
		const arrows: Record<string, IBaseHalfPoint> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
		const arrow = arrows[event.key];
		if (!arrow || this.busy || this.drag) {
			return;
		}
		if (target === this.dial) {
			if (arrow.y !== 0) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.settlePending();
			this.change(baseHalfStraightenCrop(this.original, this.state, this.state.straighten + arrow.x * (event.shiftKey ? 1 : 0.1)), false);
			return;
		}
		const corner = [...this.corners].find(([, element]) => element === target)?.[0];
		if (!corner && target !== this.frame) {
			return;
		}
		// The arrow keys in the crop view move no card.
		event.preventDefault();
		event.stopPropagation();
		this.stopGlide();
		if (!this.keyBefore) {
			this.keyBefore = this.current();
		}
		const pixels = event.shiftKey ? 10 : 1;
		if (corner) {
			const at = this.toScreen(this.cornerPoint(corner));
			const minimum = Math.max(baseHalfCropMinSize(this.pictureSize()), MIN_FRAME_PIXELS / this.mapping.scale);
			this.state = baseHalfDragCropCorner(this.original, this.state, corner, this.toPicture({ x: at.x + arrow.x * pixels, y: at.y + arrow.y * pixels }), this.ratioValue(), minimum);
		} else {
			// Inside the frame the arrows move the picture, as a drag inside it does.
			const moved = baseHalfRotate({ x: -arrow.x * pixels / this.mapping.scale, y: -arrow.y * pixels / this.mapping.scale }, -this.state.straighten);
			this.state = baseHalfMoveCrop(this.original, this.state, moved);
			this.mapping = { ...this.mapping, center: { x: this.state.crop.x, y: this.state.crop.y } };
		}
		this.render();
		if (this.keyRest !== undefined) {
			clearTimeout(this.keyRest);
		}
		this.keyRest = setTimeout(() => this.settlePending(), KEY_REST_MILLISECONDS);
	}

	// #endregion

	// #region The ratio menu

	private showRatioMenu(): void {
		const choose = (ratio: RatioId, tall = this.tall) => {
			const value = this.ratioValue({ ratio, tall });
			this.change(baseHalfApplyCropRatio(this.original, this.state, value), true, ratio, tall);
		};
		const presets = BASEHALF_CROP_RATIOS.map(preset => toAction({
			id: `basehalf.mediaEdit.ratio.${preset.id}`,
			label: preset.id === 'square' ? localize('basehalf.mediaEdit.image.square', "Square") : this.tall ? `${preset.height}:${preset.width}` : preset.id,
			checked: this.ratio === preset.id,
			run: () => choose(preset.id)
		}));
		this.contextMenuService.showContextMenu({
			getAnchor: () => this.ratioButton,
			getActions: () => [
				toAction({ id: 'basehalf.mediaEdit.ratio.wide', label: localize('basehalf.mediaEdit.image.wide', "Wide"), checked: !this.tall, run: () => this.ratio === 'free' || this.ratio === 'original' || this.ratio === 'square' ? this.change(this.state, false, this.ratio, false) : choose(this.ratio, false) }),
				toAction({ id: 'basehalf.mediaEdit.ratio.tall', label: localize('basehalf.mediaEdit.image.tall', "Tall"), checked: this.tall, run: () => this.ratio === 'free' || this.ratio === 'original' || this.ratio === 'square' ? this.change(this.state, false, this.ratio, true) : choose(this.ratio, true) }),
				new Separator(),
				toAction({ id: 'basehalf.mediaEdit.ratio.free', label: localize('basehalf.mediaEdit.image.freeform', "Freeform"), checked: this.ratio === 'free', run: () => choose('free') }),
				toAction({ id: 'basehalf.mediaEdit.ratio.original', label: localize('basehalf.mediaEdit.image.original', "Original"), checked: this.ratio === 'original', run: () => choose('original') }),
				...presets
			]
		});
	}

	private ratioLabel(): string {
		switch (this.ratio) {
			case 'free': return localize('basehalf.mediaEdit.image.freeform', "Freeform");
			case 'original': return localize('basehalf.mediaEdit.image.original', "Original");
			case 'square': return localize('basehalf.mediaEdit.image.square', "Square");
			default: {
				const [width, height] = this.ratio.split(':');
				return this.tall ? `${height}:${width}` : this.ratio;
			}
		}
	}

	// #endregion

	// #region Drawing

	/** A corner of the part kept, in the picture. */
	private cornerPoint(corner: BaseHalfCropCorner): IBaseHalfPoint {
		const { crop, straighten } = this.state;
		const offset = baseHalfRotate({ x: (corner === 'topRight' || corner === 'bottomRight' ? 1 : -1) * crop.width / 2, y: (corner === 'bottomLeft' || corner === 'bottomRight' ? 1 : -1) * crop.height / 2 }, -straighten);
		return { x: crop.x + offset.x, y: crop.y + offset.y };
	}

	/** The middle of a side of the part kept, in the picture. */
	private sidePoint(side: BaseHalfCropSide): IBaseHalfPoint {
		const { crop, straighten } = this.state;
		const offset = baseHalfRotate(side === 'left' || side === 'right' ? { x: (side === 'right' ? 1 : -1) * crop.width / 2, y: 0 } : { x: 0, y: (side === 'bottom' ? 1 : -1) * crop.height / 2 }, -straighten);
		return { x: crop.x + offset.x, y: crop.y + offset.y };
	}

	private toolButton(container: HTMLElement, name: string, label: string, path: string): HTMLButtonElement {
		const button = append(container, $<HTMLButtonElement>(`button.basehalf-image-crop-tool.${name}`));
		button.type = 'button';
		button.setAttribute('aria-label', label);
		button.append(toolIcon(path));
		this._register(this.hoverService.setupDelayedHover(button, () => ({ content: label })));
		return button;
	}

	private render(): void {
		if (this.disposed || !this.viewSize.width) {
			return;
		}
		const { crop, straighten } = this.state;
		const mapping = this.mapping;
		// The picture: the original turned and flipped into the picture, turned by the angle, at its scale.
		const [a, b, c, d, e, f] = baseHalfPictureTransform(this.original, this.state.turn, this.state.flip);
		const radians = straighten * Math.PI / 180;
		const cos = Math.cos(radians) * mapping.scale;
		const sin = Math.sin(radians) * mapping.scale;
		const n11 = cos * a - sin * b;
		const n12 = cos * c - sin * d;
		const n21 = sin * a + cos * b;
		const n22 = sin * c + cos * d;
		const dx = e - mapping.center.x;
		const dy = f - mapping.center.y;
		const tx = this.viewSize.width / 2 + cos * dx - sin * dy;
		const ty = this.viewSize.height / 2 + sin * dx + cos * dy;
		this.picture.style.width = `${this.original.width}px`;
		this.picture.style.height = `${this.original.height}px`;
		this.picture.style.transform = `matrix(${n11}, ${n21}, ${n12}, ${n22}, ${tx}, ${ty})`;
		// The frame: upright on screen, around the part kept.
		const center = this.toScreen(crop);
		const width = crop.width * mapping.scale;
		const height = crop.height * mapping.scale;
		this.frame.style.left = `${center.x - width / 2}px`;
		this.frame.style.top = `${center.y - height / 2}px`;
		this.frame.style.width = `${width}px`;
		this.frame.style.height = `${height}px`;
		const choices = this.choices;
		const size = choices.crop ? `${choices.crop.width} × ${choices.crop.height}` : `${this.pictureSize().width} × ${this.pictureSize().height}`;
		this.sizeLabel.textContent = size;
		this.sizeLabel.style.left = `${center.x}px`;
		this.sizeLabel.style.top = `${center.y + height / 2 + 8}px`;
		this.frame.setAttribute('aria-label', localize('basehalf.mediaEdit.image.frameLabel', "Part kept: {0}. Arrow keys move the picture.", size));
		this.ratioText.textContent = this.ratioLabel();
		this.ratioButton.setAttribute('aria-label', localize('basehalf.mediaEdit.image.ratioLabel', "Ratio: {0}", this.ratioLabel()));
		// The dial: the ruler moves so that the angle stands under the mark.
		this.dialRuler.style.transform = `translateX(${-straighten * DIAL_PIXELS_PER_DEGREE}px)`;
		const shown = Math.round(straighten * 10) / 10;
		this.dialValue.textContent = shown === 0 ? '0°' : `${shown < 0 ? '−' : ''}${Math.abs(shown).toFixed(1)}°`;
		this.dial.setAttribute('aria-valuenow', String(shown));
		this.dial.setAttribute('aria-valuetext', this.dialValue.textContent);
		this.dial.classList.toggle('turned', shown !== 0);
		const original = baseHalfCropIsOriginal(this.original, this.state) && this.ratio === 'free';
		this.resetButton.classList.toggle('disabled', original);
		this.resetButton.setAttribute('aria-disabled', String(original));
		this.element.classList.toggle('busy', this.busy);
		for (const control of [this.turnButton, this.flipButton, this.ratioButton, this.dial]) {
			control.setAttribute('aria-disabled', String(this.busy));
		}
	}

	// #endregion
}

const TURN_LEFT_PATH = 'M7.5 3.5 4 7l3.5 3.5M4.5 7H12a5 5 0 0 1 0 10h-2M5 13.5h3.5V20H5z';
const FLIP_PATH = 'M12 3v18M9 7 4 17h5zM15 7l5 10h-5z';
const RATIO_PATH = 'M4 6h16v12H4zM8 10h3M8 10v3M16 14h-3M16 14v-3';

function toolIcon(path: string): SVGElement {
	const svg = $.SVG('svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	svg.classList.add('basehalf-image-crop-icon');
	const shape = $.SVG('path');
	shape.setAttribute('d', path);
	shape.setAttribute('fill', 'none');
	shape.setAttribute('stroke', 'currentColor');
	shape.setAttribute('stroke-width', '1.6');
	shape.setAttribute('stroke-linecap', 'round');
	shape.setAttribute('stroke-linejoin', 'round');
	svg.appendChild(shape);
	return svg;
}
