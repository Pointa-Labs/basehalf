/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfImageCropView.css';
import { $, addDisposableListener, append, getWindow } from '../../../../base/browser/dom.js';
import { toAction, Separator } from '../../../../base/common/actions.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { BASEHALF_EDIT_MAX_STRAIGHTEN, IBaseHalfMediaChoices, normalizeBaseHalfMediaChoices } from '../common/basehalfEditRecord.js';
import {
	BASEHALF_CROP_RATIOS,
	BaseHalfCropCorner,
	BaseHalfCropRatio,
	BaseHalfCropSide,
	baseHalfApplyCropRatio,
	baseHalfCropChoices,
	baseHalfCropMinSize,
	baseHalfCropStateOf,
	baseHalfDragCropCorner,
	baseHalfDragCropSide,
	baseHalfFlipCrop,
	baseHalfMoveCrop,
	baseHalfPictureTransform,
	baseHalfRotate,
	baseHalfSameRatio,
	baseHalfStraightenCrop,
	baseHalfTurnCropLeft,
	baseHalfTurnedSize,
	baseHalfZoomCrop,
	IBaseHalfCropState,
	IBaseHalfPoint,
	IBaseHalfSize
} from '../common/basehalfImageCrop.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { baseHalfNoteZoomFactor, isBaseHalfNoteZoomWheel } from '../../cardDetail/common/basehalfNoteZoom.js';
import { BASEHALF_EDGE_FOLLOW_MARGIN, BASEHALF_PAGE_AT_REST, BASEHALF_TIME_ZOOM_REST_MS, baseHalfClampPageZoom, baseHalfEdgeFollowRate, baseHalfMovePage, baseHalfPictureMaxZoom, baseHalfWheelMove, baseHalfZoomPageAround, IBaseHalfPageZoom } from '../common/basehalfMediaZoom.js';
import { BaseHalfMediaChange, IBaseHalfMediaEditor } from './basehalfMediaEditor.js';

/**
 * The crop view of an image in Card Detail (editing media, "Cropping an
 * image"): the picture as its edit makes it, the original turned, flipped,
 * and straightened as the choices say and only the part kept, as large as
 * fits; the crop frame on its edges, which shows while the pointer is over
 * the picture or the keyboard is on it; and a row of tools under it (Turn
 * Left, Flip, Ratio, and the Straighten dial). While editing, the rest of the
 * original shows dimmed around the frame (D97). A corner or a side pushed
 * into the view's margin stops there, and the picture follows, moving and
 * shrinking around the corner or side across from it; when a drag ends, the
 * frame waits a second and then glides with the picture until it is at rest
 * again. While editing, a pinch zooms the picture under the frame and a
 * two-finger swipe moves it, which changes the part kept. While viewing
 * ("Viewing and editing"), it shows the picture as the file holds it, with no
 * frame and no tools, whose room stays empty, and a pinch zooms the view.
 */

/** The frames and timers of a crop view, which a test runs when it says. */
export interface IBaseHalfImageCropClock {
	frame(callback: () => void): IDisposable;
	timeout(callback: () => void, milliseconds: number): IDisposable;
	now(): number;
}

export interface IBaseHalfImageCropViewOptions {
	/** The copy of the original of an edited image, or of the image, that the editor reads. */
	readonly source: URI;
	/** Its size, upright as its camera gave it. */
	readonly size: IBaseHalfSize;
	/** The choices that the view starts with: those of the edit before. */
	readonly choices: IBaseHalfMediaChoices;
	readonly clock?: IBaseHalfImageCropClock;
}

/** The room between the frame at rest and the edges of the view, and the margin in which a pushed handle makes the picture follow (D97). */
const MARGIN = BASEHALF_EDGE_FOLLOW_MARGIN;
const GLIDE_MILLISECONDS = 200;
/** How long the frame stays where a drag let it go before it glides to rest, as a phone's photo editor waits (D97). */
const REST_DELAY_MILLISECONDS = 1000;
/** How near a frame's edge counts as at the margin, in pixels of the screen. */
const EDGE_TOUCH_PIXELS = 0.5;
/** Pixels of the dial for each degree. */
const DIAL_PIXELS_PER_DEGREE = 6;
/** Within this of 0°, a turn of the dial rests at 0°. */
const DIAL_SNAP_DEGREES = 0.4;
/** How long keys that move a corner or the picture wait before the frame comes to rest: keys within it are one change. */
const KEY_REST_MILLISECONDS = 600;
/** The smallest the frame may be on screen while it is dragged. */
const MIN_FRAME_PIXELS = 48;

/** Where the picture is on screen: the point of the picture at the middle of the view, and the screen pixels for each pixel of the picture. */
interface IMapping {
	readonly center: IBaseHalfPoint;
	readonly scale: number;
}

type RatioId = 'free' | 'original' | string;

type DragKind = { readonly kind: 'corner'; readonly corner: BaseHalfCropCorner } | { readonly kind: 'side'; readonly side: BaseHalfCropSide } | { readonly kind: 'move' } | { readonly kind: 'dial' } | { readonly kind: 'pan' };

interface IDrag {
	readonly what: DragKind;
	readonly pointerId: number;
	readonly startX: number;
	readonly startY: number;
	/** What the view held when the drag started, which Escape puts back. */
	readonly before: IBaseHalfCropState;
	/** The screen offset from the pointer to the point it holds: a corner's or a side's place. */
	readonly grabX: number;
	readonly grabY: number;
	/** Where the picture is for the drag: as it started, or as the picture followed a handle pushed to the edge. */
	mapping: IMapping;
	/** The zoom of the view when the drag started, which a drag of the zoomed view moves. */
	readonly page: IBaseHalfPageZoom;
	/** The point of the picture that keeps its place while a corner or a side is dragged: the corner across, or the middle of the side across. */
	readonly anchor?: IBaseHalfPoint;
	/** Where the pointer holds the handle on screen, before the margin stops it. */
	held?: IBaseHalfPoint;
	/** When the picture last followed the handle. */
	followedAt?: number;
}

/** The ways a handle moves the frame outwards on screen, along each axis: −1 to the left or the top, 1 to the right or the bottom. */
function outwards(what: DragKind): IBaseHalfPoint {
	switch (what.kind) {
		case 'corner':
			return { x: what.corner === 'topLeft' || what.corner === 'bottomLeft' ? -1 : 1, y: what.corner === 'topLeft' || what.corner === 'topRight' ? -1 : 1 };
		case 'side':
			return what.side === 'left' ? { x: -1, y: 0 } : what.side === 'right' ? { x: 1, y: 0 } : what.side === 'top' ? { x: 0, y: -1 } : { x: 0, y: 1 };
		default:
			return { x: 0, y: 0 };
	}
}

const OPPOSITE_CORNER: Record<BaseHalfCropCorner, BaseHalfCropCorner> = { topLeft: 'bottomRight', topRight: 'bottomLeft', bottomLeft: 'topRight', bottomRight: 'topLeft' };
const OPPOSITE_SIDE: Record<BaseHalfCropSide, BaseHalfCropSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

export class BaseHalfImageCropView extends Disposable implements IBaseHalfMediaEditor {

	readonly element: HTMLElement;
	/** The picture is loaded, or could not be. */
	readonly drawn: Promise<void>;
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
	private readonly tools: HTMLElement;

	private readonly onDidChangeEmitter = this._register(new Emitter<BaseHalfMediaChange>());
	readonly onDidChange = this.onDidChangeEmitter.event;

	private readonly original: IBaseHalfSize;
	private state: IBaseHalfCropState;
	private ratio: RatioId = 'free';
	private tall = false;
	private mapping: IMapping = { center: { x: 0, y: 0 }, scale: 1 };
	private viewSize: IBaseHalfSize = { width: 0, height: 0 };
	/** The view zoomed as a browser zooms its page, around a pinch (D96). */
	private page: IBaseHalfPageZoom = BASEHALF_PAGE_AT_REST;
	private drag: IDrag | undefined;
	private readonly clock: IBaseHalfImageCropClock;
	private readonly glideFrame = this._register(new MutableDisposable());
	/** The wait after a drag before the frame glides to rest (D97). */
	private readonly restWait = this._register(new MutableDisposable());
	/** The next frame in which the picture follows a handle pushed to the edge. */
	private readonly followFrame = this._register(new MutableDisposable());
	/** What the view held when a pinch or a swipe while editing started, for one change, and the wait for it to rest. */
	private gestureBefore: IBaseHalfCropState | undefined;
	private readonly gestureRest = this._register(new MutableDisposable());
	private keyRest: ReturnType<typeof setTimeout> | undefined;
	/** What the view held when keys started to move a corner or the picture, for one change. */
	private keyBefore: IBaseHalfCropState | undefined;
	/** The view edits the picture; otherwise it views the file as it is. */
	private editing = false;
	private disposed = false;

	constructor(
		container: HTMLElement,
		options: IBaseHalfImageCropViewOptions,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IHoverService private readonly hoverService: IHoverService
	) {
		super();
		const targetWindow = getWindow(container);
		this.clock = options.clock ?? {
			frame: callback => {
				const handle = targetWindow.requestAnimationFrame(() => callback());
				return toDisposable(() => targetWindow.cancelAnimationFrame(handle));
			},
			timeout: (callback, milliseconds) => {
				const handle = targetWindow.setTimeout(callback, milliseconds);
				return toDisposable(() => targetWindow.clearTimeout(handle));
			},
			now: () => targetWindow.performance.now()
		};
		this.original = options.size;
		this.state = baseHalfCropStateOf(this.original, options.choices);
		this.setRatioOf(options.choices);

		this.element = append(container, $('.basehalf-image-crop.viewing'));
		this.element.setAttribute('role', 'group');
		this.view = append(this.element, $('.basehalf-image-crop-view'));
		// While viewing, the keyboard is on the picture.
		this.view.tabIndex = -1;
		this.picture = append(this.view, $<HTMLImageElement>('img.basehalf-image-crop-picture'));
		this.picture.alt = '';
		this.picture.draggable = false;
		this.drawn = new Promise<void>(resolve => {
			this._register(addDisposableListener(this.picture, 'load', () => resolve()));
			this._register(addDisposableListener(this.picture, 'error', () => resolve()));
			this._register(toDisposable(resolve));
		});
		this.picture.src = FileAccess.uriToBrowserUri(options.source).toString(true);
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

		const tools = this.tools = append(this.element, $('.basehalf-image-crop-tools'));
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

		this._register(toDisposable(() => {
			this.disposed = true;
			this.stopGlide();
			if (this.keyRest !== undefined) {
				clearTimeout(this.keyRest);
			}
		}));
		this.registerListeners();
		this.showControls();
		this.layout();
	}

	get choices(): IBaseHalfMediaChoices {
		return baseHalfCropChoices(this.original, this.state);
	}

	focus(): void {
		(this.editing ? this.frame : this.view).focus({ preventScroll: true });
	}

	setEditing(editing: boolean): void {
		if (editing === this.editing) {
			return;
		}
		this.endDrag();
		this.settleKeys();
		this.endGesture();
		this.restWait.clear();
		this.editing = editing;
		this.showControls();
		// While editing, a pinch is the crop's: a zoom of the view glides back to as it fits, as a phone's photo
		// editor shows the whole picture to crop it (D97); a frame that waited to rest comes to rest now.
		if (this.page.zoom > 1 || !this.atRest()) {
			this.resetZoom();
			this.glideToRest();
		} else {
			this.render();
		}
	}

	/** While viewing, the frame, its corners, and the tools take no keyboard and no pointer, and do not show. */
	private showControls(): void {
		this.element.classList.toggle('viewing', !this.editing);
		this.element.setAttribute('aria-label', this.editing
			? localize('basehalf.mediaEdit.image.label', "Crop")
			: localize('basehalf.mediaEdit.image.viewLabel', "Picture"));
		this.frame.tabIndex = this.editing ? 0 : -1;
		for (const corner of this.corners.values()) {
			corner.tabIndex = this.editing ? 0 : -1;
		}
		if (!this.editing) {
			this.frame.classList.remove('keyboard');
		}
		// The room of the tools stays while viewing, empty: the picture does not move when they come.
		this.tools.toggleAttribute('inert', !this.editing);
		if (this.editing) {
			this.tools.removeAttribute('aria-hidden');
		} else {
			this.tools.setAttribute('aria-hidden', 'true');
		}
	}

	setChoices(choices: IBaseHalfMediaChoices): void {
		if (sameChoices(choices, this.choices)) {
			return;
		}
		this.endDrag();
		this.dropKeys();
		this.dropGesture();
		this.restWait.clear();
		this.stopGlide();
		this.state = baseHalfCropStateOf(this.original, choices);
		this.setRatioOf(choices);
		this.resetZoom();
		this.mapping = this.restMapping();
		this.render();
	}

	// #region The state

	private pictureSize(state = this.state): IBaseHalfSize {
		return baseHalfTurnedSize(this.original, state.turn);
	}

	/** The ratio that the choices kept: the picture's own, or one of the menu's; any other is freeform. */
	private setRatioOf(choices: IBaseHalfMediaChoices): void {
		const picture = this.pictureSize();
		this.tall = picture.height > picture.width;
		this.ratio = 'free';
		const crop = choices.crop;
		if (!crop) {
			return;
		}
		const ratio = crop.width / crop.height;
		const preset = BASEHALF_CROP_RATIOS.find(candidate => baseHalfSameRatio(ratio, candidate.width / candidate.height, crop.width) || baseHalfSameRatio(ratio, candidate.height / candidate.width, crop.width));
		if (baseHalfSameRatio(ratio, picture.width / picture.height, crop.width)) {
			this.ratio = 'original';
		} else if (preset) {
			this.ratio = preset.id;
			this.tall = crop.height > crop.width;
		}
	}

	/** The ratio the frame keeps: none when freeform. */
	private ratioValue(choice: { readonly ratio: RatioId; readonly tall: boolean } = { ratio: this.ratio, tall: this.tall }): BaseHalfCropRatio {
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

	/** A tool's change: the view shows it at rest, and its choices are a change when they differ. */
	private change(kind: BaseHalfMediaChange, next: IBaseHalfCropState, glide: boolean, ratio = this.ratio, tall = this.tall): void {
		const before = this.state;
		this.state = next;
		this.ratio = ratio;
		this.tall = tall;
		this.resetZoom();
		this.restWait.clear();
		if (glide) {
			this.glideToRest();
		} else {
			this.stopGlide();
			this.mapping = this.restMapping();
			this.render();
		}
		this.changed(kind, before);
	}

	private changed(kind: BaseHalfMediaChange, before: IBaseHalfCropState): void {
		if (!sameChoices(baseHalfCropChoices(this.original, before), this.choices)) {
			this.onDidChangeEmitter.fire(kind);
		}
	}

	// #endregion

	// #region The screen

	/** The mapping at rest: the part kept as large as fits, in the middle of the view. */
	private restMapping(state = this.state): IMapping {
		const room = { width: Math.max(1, this.viewSize.width - 2 * MARGIN), height: Math.max(1, this.viewSize.height - 2 * MARGIN) };
		return { center: { x: state.crop.x, y: state.crop.y }, scale: Math.min(room.width / state.crop.width, room.height / state.crop.height) };
	}

	/** The mapping of the view: at rest, or the view at rest zoomed as a page, with what was at a point `p` now at `origin + zoom × p`. */
	private viewMapping(): IMapping {
		const rest = this.restMapping();
		if (this.page.zoom <= 1) {
			return rest;
		}
		// What shows at the middle of the view stood at rest where the zoom takes it from.
		const middle = { x: (this.viewSize.width / 2 - this.page.origin.x) / this.page.zoom, y: (this.viewSize.height / 2 - this.page.origin.y) / this.page.zoom };
		return { center: this.toPicture(middle, rest), scale: rest.scale * this.page.zoom };
	}

	/** Zooms the view by `factor` around a point of it, which keeps the point of the picture under it. */
	private zoomAround(at: IBaseHalfPoint, factor: number): void {
		this.page = baseHalfZoomPageAround(this.page, at, factor, this.maxZoom(), this.viewSize);
		this.stopGlide();
		this.mapping = this.viewMapping();
		this.render();
	}

	private resetZoom(): void {
		this.page = BASEHALF_PAGE_AT_REST;
	}

	/** The largest zoom: 5 times as the picture fits, or twice its pixels when that is more. */
	private maxZoom(): number {
		return baseHalfPictureMaxZoom(this.restMapping().scale);
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
			this.page = baseHalfClampPageZoom(this.page, this.viewSize);
			this.mapping = this.viewMapping();
		}
		this.render();
	}

	private glideToRest(): void {
		this.stopGlide();
		const from = this.mapping;
		const to = this.restMapping();
		const window = getWindow(this.element);
		const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		if (reduced || sameMapping(from, to)) {
			this.mapping = to;
			this.render();
			return;
		}
		const start = this.clock.now();
		const tick = () => {
			const t = Math.min(1, (this.clock.now() - start) / GLIDE_MILLISECONDS);
			const eased = 1 - Math.pow(1 - t, 3);
			this.mapping = {
				center: { x: from.center.x + (to.center.x - from.center.x) * eased, y: from.center.y + (to.center.y - from.center.y) * eased },
				scale: Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * eased)
			};
			this.render();
			if (t < 1 && !this.disposed) {
				this.glideFrame.value = this.clock.frame(tick);
			} else {
				this.glideFrame.clear();
			}
		};
		this.glideFrame.value = this.clock.frame(tick);
	}

	private stopGlide(): void {
		this.glideFrame.clear();
	}

	/** The frame and the picture are where they rest: the part kept as large as fits, at the middle of the view. */
	private atRest(): boolean {
		return this.page.zoom <= 1 && sameMapping(this.mapping, this.restMapping());
	}

	/** The frame stays where a drag let it go for a second, then glides to rest, as a phone's photo editor waits (D97). */
	private restLater(): void {
		this.restWait.value = this.clock.timeout(() => {
			this.restWait.clear();
			if (!this.drag) {
				this.glideToRest();
			}
		}, REST_DELAY_MILLISECONDS);
	}

	/** The mapping at `scale` that shows the point `point` of the picture at the point `screen` of the view. */
	private mappingAt(point: IBaseHalfPoint, screen: IBaseHalfPoint, scale: number): IMapping {
		const back = baseHalfRotate({ x: (screen.x - this.viewSize.width / 2) / scale, y: (screen.y - this.viewSize.height / 2) / scale }, -this.state.straighten);
		return { center: { x: point.x - back.x, y: point.y - back.y }, scale };
	}

	/** The room of the frame: the view inside its margin, where the frame rests and where a pushed handle stops. */
	private room(): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } {
		const left = Math.min(MARGIN, this.viewSize.width / 2);
		const top = Math.min(MARGIN, this.viewSize.height / 2);
		return { left, top, right: this.viewSize.width - left, bottom: this.viewSize.height - top };
	}

	/** The frame of a part kept on screen, upright. */
	private frameOf(state: IBaseHalfCropState, mapping: IMapping): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } {
		const center = this.toScreen(state.crop, mapping);
		const width = state.crop.width * mapping.scale;
		const height = state.crop.height * mapping.scale;
		return { left: center.x - width / 2, top: center.y - height / 2, right: center.x + width / 2, bottom: center.y + height / 2 };
	}

	/** The scale at which the whole picture, at its angle, fits the room: the picture follows a handle no further. */
	private fitScale(): number {
		const picture = this.pictureSize();
		const radians = this.state.straighten * Math.PI / 180;
		const c = Math.abs(Math.cos(radians));
		const s = Math.abs(Math.sin(radians));
		const room = this.room();
		return Math.min((room.right - room.left) / (picture.width * c + picture.height * s), (room.bottom - room.top) / (picture.width * s + picture.height * c));
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
		this._register(addDisposableListener(this.view, 'dblclick', event => this.onDoubleClick(event)));
		this._register(addDisposableListener(this.dial, 'dblclick', () => {
			if (!this.drag) {
				this.settleKeys();
				this.change('straighten', baseHalfStraightenCrop(this.original, this.state, 0), false);
			}
		}));
		this._register(addDisposableListener(getWindow(this.element), 'keydown', event => {
			// Escape during a drag ends it and puts back what it changed; Card Detail stays (editing media, "The keyboard").
			if (event.key === 'Escape' && this.drag) {
				event.preventDefault();
				event.stopPropagation();
				this.cancelDrag();
			}
		}, true));
		this._register(addDisposableListener(this.element, 'keydown', event => this.onKeyDown(event)));
		// The frame shows while the keyboard is on it, not after a click on it.
		this._register(addDisposableListener(this.frame, 'focusin', event => this.frame.classList.toggle('keyboard', (event.target as Element).matches(':focus-visible'))));
		this._register(addDisposableListener(this.frame, 'focusout', event => {
			if (!this.frame.contains(event.relatedTarget as Node | null)) {
				this.frame.classList.remove('keyboard');
			}
		}));
		// A turn to the left turns a set ratio with the frame: a wide one becomes tall.
		this._register(addDisposableListener(this.turnButton, 'click', () => this.run(() => this.change('turn', baseHalfTurnCropLeft(this.original, this.state), false, this.ratio, !this.tall))));
		this._register(addDisposableListener(this.flipButton, 'click', () => this.run(() => this.change('flip', baseHalfFlipCrop(this.original, this.state), false))));
		this._register(addDisposableListener(this.ratioButton, 'click', () => this.run(() => this.showRatioMenu())));
		this._register(addDisposableListener(this.picture, 'load', () => this.render()));
		const ResizeObserverConstructor = getWindow(this.element).ResizeObserver;
		if (ResizeObserverConstructor) {
			const observer = new ResizeObserverConstructor(() => this.layout());
			observer.observe(this.view);
			this._register(toDisposable(() => observer.disconnect()));
		}
	}

	/** Runs a tool's action unless a drag runs. */
	private run(action: () => void): void {
		if (!this.drag) {
			this.settleKeys();
			action();
		}
	}

	private onPointerDown(event: PointerEvent, forced?: DragKind): void {
		if (event.button !== 0) {
			return;
		}
		const target = event.target as Element | null;
		let what: DragKind | undefined = forced;
		let grabbed: IBaseHalfPoint | undefined;
		let anchor: IBaseHalfPoint | undefined;
		if (!what && this.page.zoom > 1) {
			// While the view is zoomed in, a drag moves the view.
			what = { kind: 'pan' };
		} else if (!what && !this.editing) {
			// While viewing, a picture as it fits has nothing to drag.
			return;
		} else if (!what) {
			const corner = [...this.corners].find(([, element]) => element.contains(target))?.[0];
			const side = [...this.sides].find(([, element]) => element.contains(target))?.[0];
			if (corner) {
				what = { kind: 'corner', corner };
				grabbed = this.cornerPoint(corner);
				anchor = this.cornerPoint(OPPOSITE_CORNER[corner]);
			} else if (side) {
				what = { kind: 'side', side };
				grabbed = this.sidePoint(side);
				anchor = this.sidePoint(OPPOSITE_SIDE[side]);
			} else if (this.frame.contains(target) || target === this.picture || target === this.view) {
				what = { kind: 'move' };
			}
		}
		if (!what) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.settleKeys();
		this.endGesture();
		// A press within the second after a drag starts from where the frame and the picture are (D97).
		this.restWait.clear();
		this.stopGlide();
		const at = this.viewPoint(event);
		const grab = grabbed ? this.toScreen(grabbed) : at;
		this.drag = { what, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, before: this.state, grabX: grab.x - at.x, grabY: grab.y - at.y, mapping: this.mapping, page: this.page, anchor };
		const capture = what.kind === 'dial' ? this.dial : this.view;
		try {
			capture.setPointerCapture(event.pointerId);
		} catch {
			// A pointer that is no longer active cannot be captured; the press still counts.
		}
		this.element.classList.toggle('adjusting', what.kind !== 'pan');
		this.element.classList.toggle('panning', what.kind === 'pan');
		this.render();
	}

	private onPointerMove(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		const at = this.viewPoint(event);
		const held = { x: at.x + drag.grabX, y: at.y + drag.grabY };
		const before = drag.before;
		switch (drag.what.kind) {
			case 'corner':
			case 'side':
				// The frame stops at the margin of the view, and a handle held there makes the picture follow (D97).
				drag.held = held;
				this.holdFrame(drag);
				this.followEdge(drag);
				break;
			case 'move': {
				// The frame stays where it is and the picture moves under it.
				const moved = baseHalfRotate({ x: -(event.clientX - drag.startX) / drag.mapping.scale, y: -(event.clientY - drag.startY) / drag.mapping.scale }, -before.straighten);
				this.state = baseHalfMoveCrop(this.original, before, moved);
				this.mapping = this.mappingAt(this.state.crop, this.toScreen(before.crop, drag.mapping), drag.mapping.scale);
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
			case 'pan':
				this.page = baseHalfMovePage(drag.page, { x: event.clientX - drag.startX, y: event.clientY - drag.startY }, this.viewSize);
				this.mapping = this.viewMapping();
				break;
		}
		this.render();
	}

	private onPointerUp(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}
		this.drag = undefined;
		this.followFrame.clear();
		this.element.classList.remove('adjusting', 'panning');
		if (drag.what.kind === 'pan') {
			this.render();
			return;
		}
		if (drag.what.kind === 'dial') {
			this.mapping = this.restMapping();
		} else if (!this.atRest()) {
			// The frame stays where it was let go for a second, then glides to rest (D97).
			this.restLater();
		}
		this.render();
		this.changed(drag.what.kind === 'dial' ? 'straighten' : 'crop', drag.before);
	}

	/** Escape during a drag: what it changed goes back, and the picture with it. */
	private cancelDrag(): void {
		const drag = this.endDrag();
		if (drag) {
			this.state = drag.before;
			this.page = drag.page;
			if (drag.what.kind === 'pan') {
				this.mapping = this.viewMapping();
				this.render();
			} else {
				this.glideToRest();
			}
		}
	}

	/** Ends a drag where it is, as when an undo sets other choices. */
	private endDrag(): IDrag | undefined {
		const drag = this.drag;
		if (!drag) {
			return undefined;
		}
		this.drag = undefined;
		this.followFrame.clear();
		this.element.classList.remove('adjusting', 'panning');
		for (const target of [this.view, this.dial]) {
			try {
				target.releasePointerCapture(drag.pointerId);
			} catch {
				// Released already, or held by the other.
			}
		}
		return drag;
	}

	/** The frame of a corner or a side dragged to the pointer, stopped at the margin of the view (D97). */
	private holdFrame(drag: IDrag): void {
		const held = drag.held;
		if (!held || (drag.what.kind !== 'corner' && drag.what.kind !== 'side')) {
			return;
		}
		const room = this.room();
		const at = { x: Math.min(Math.max(held.x, room.left), room.right), y: Math.min(Math.max(held.y, room.top), room.bottom) };
		// While the frame is dragged it is never smaller on screen than its handles need.
		const minimum = Math.max(baseHalfCropMinSize(this.pictureSize(drag.before)), MIN_FRAME_PIXELS / drag.mapping.scale);
		const to = this.toPicture(at, drag.mapping);
		const state = drag.what.kind === 'corner'
			? baseHalfDragCropCorner(this.original, drag.before, drag.what.corner, to, this.ratioValue(), minimum)
			: baseHalfDragCropSide(this.original, drag.before, drag.what.side, to, this.ratioValue(), minimum);
		this.state = drag.anchor ? this.withinRoom(state, drag.anchor, drag.mapping) : state;
		this.mapping = drag.mapping;
	}

	/** A part whose frame reaches past the margin, as a ratio can take it across the drag, made smaller about the anchor until it stands inside. */
	private withinRoom(state: IBaseHalfCropState, anchor: IBaseHalfPoint, mapping: IMapping): IBaseHalfCropState {
		const frame = this.frameOf(state, mapping);
		const room = this.room();
		const a = this.toScreen(anchor, mapping);
		let shrink = 1;
		if (frame.left < room.left - EDGE_TOUCH_PIXELS && a.x > frame.left) {
			shrink = Math.min(shrink, (a.x - room.left) / (a.x - frame.left));
		}
		if (frame.right > room.right + EDGE_TOUCH_PIXELS && frame.right > a.x) {
			shrink = Math.min(shrink, (room.right - a.x) / (frame.right - a.x));
		}
		if (frame.top < room.top - EDGE_TOUCH_PIXELS && a.y > frame.top) {
			shrink = Math.min(shrink, (a.y - room.top) / (a.y - frame.top));
		}
		if (frame.bottom > room.bottom + EDGE_TOUCH_PIXELS && frame.bottom > a.y) {
			shrink = Math.min(shrink, (room.bottom - a.y) / (frame.bottom - a.y));
		}
		if (!(shrink < 1) || !(shrink > 0)) {
			return state;
		}
		const { crop } = state;
		return { ...state, crop: { x: anchor.x + (crop.x - anchor.x) * shrink, y: anchor.y + (crop.y - anchor.y) * shrink, width: crop.width * shrink, height: crop.height * shrink } };
	}

	/**
	 * How deep a handle is in the margin of the view, or past it, along the
	 * ways it pushes the frame out, while the frame stands at the margin on a
	 * side it is pushed toward: with a ratio, a side held at the margin keeps
	 * the frame from growing toward the other. 0 when the pointer is inside the
	 * room, or the picture's own edges hold the frame back first.
	 */
	private edgeDepth(drag: IDrag): number {
		const held = drag.held;
		if (!held) {
			return 0;
		}
		const out = outwards(drag.what);
		const room = this.room();
		const frame = this.frameOf(this.state, drag.mapping);
		const atMargin = (out.x < 0 && frame.left <= room.left + EDGE_TOUCH_PIXELS)
			|| (out.x > 0 && frame.right >= room.right - EDGE_TOUCH_PIXELS)
			|| (out.y < 0 && frame.top <= room.top + EDGE_TOUCH_PIXELS)
			|| (out.y > 0 && frame.bottom >= room.bottom - EDGE_TOUCH_PIXELS);
		if (!atMargin) {
			return 0;
		}
		const depthX = out.x < 0 ? room.left - held.x : out.x > 0 ? held.x - room.right : 0;
		const depthY = out.y < 0 ? room.top - held.y : out.y > 0 ? held.y - room.bottom : 0;
		return Math.max(0, depthX, depthY);
	}

	/** A handle held in the margin of the view or past it: the picture follows it in every frame of the screen (D97). */
	private followEdge(drag: IDrag): void {
		if (this.edgeDepth(drag) > 0 && this.drag === drag) {
			if (!this.followFrame.value) {
				drag.followedAt = this.clock.now();
				this.followFrame.value = this.clock.frame(() => this.stepFollow());
			}
		} else {
			this.followFrame.clear();
			drag.followedAt = undefined;
		}
	}

	/**
	 * One frame of following: the picture shrinks around the corner or the
	 * side across from the handle, which keeps its place on screen, by e^(−r)
	 * of its size each second, r growing with the depth of the handle, down to
	 * the whole picture as it fits; the frame then takes in what the handle
	 * reaches.
	 */
	private stepFollow(): void {
		this.followFrame.clear();
		const drag = this.drag;
		if (!drag?.anchor || drag.followedAt === undefined) {
			return;
		}
		const now = this.clock.now();
		const elapsed = Math.max(0, now - drag.followedAt);
		drag.followedAt = now;
		const depth = this.edgeDepth(drag);
		const fit = this.fitScale();
		if (depth <= 0 || drag.mapping.scale <= fit) {
			drag.followedAt = undefined;
			return;
		}
		// A handle deeper in the margin, or past it, shrinks the picture faster, as a strip moves along (D97, D98).
		const rate = baseHalfEdgeFollowRate(depth);
		const scale = Math.max(fit, drag.mapping.scale * Math.exp(-rate * elapsed / 1000));
		drag.mapping = this.mappingAt(drag.anchor, this.toScreen(drag.anchor, drag.mapping), scale);
		this.holdFrame(drag);
		this.render();
		this.followFrame.value = this.clock.frame(() => this.stepFollow());
	}

	/** A pinch or a swipe while editing goes on: what the view held before it is kept, for one change once it rests. */
	private gesturing(): void {
		this.settleKeys();
		this.restWait.clear();
		this.stopGlide();
		if (!this.gestureBefore) {
			this.gestureBefore = this.state;
		}
		this.element.classList.add('gesturing');
		this.gestureRest.value = this.clock.timeout(() => this.endGesture(), BASEHALF_TIME_ZOOM_REST_MS);
	}

	/** A pinch or a swipe has rested: it is one change, and a frame away from its rest glides there a second later. */
	private endGesture(): void {
		const before = this.gestureBefore;
		this.dropGesture();
		if (before) {
			if (!this.atRest()) {
				this.restLater();
			}
			this.render();
			this.changed('crop', before);
		}
	}

	private dropGesture(): void {
		this.gestureBefore = undefined;
		this.gestureRest.clear();
		this.element.classList.remove('gesturing');
	}

	/** A pinch while editing: the picture zooms under the frame around a point of the view, and the part kept changes with it (D97). */
	private zoomCropAround(at: IBaseHalfPoint, factor: number): void {
		const frame = this.frameOf(this.state, this.mapping);
		const center = { x: (frame.left + frame.right) / 2, y: (frame.top + frame.bottom) / 2 };
		this.state = baseHalfZoomCrop(this.original, this.state, factor, this.toPicture(at));
		// The frame keeps its place and size: the picture's scale follows the part.
		this.mapping = this.mappingAt(this.state.crop, center, (frame.right - frame.left) / this.state.crop.width);
		this.render();
	}

	/** A swipe while editing: the picture moves under the frame with the fingers, as a drag inside the frame moves it. */
	private moveCropBy(move: IBaseHalfPoint): void {
		const scale = this.mapping.scale;
		const frame = this.frameOf(this.state, this.mapping);
		const center = { x: (frame.left + frame.right) / 2, y: (frame.top + frame.bottom) / 2 };
		const moved = baseHalfRotate({ x: -move.x / scale, y: -move.y / scale }, -this.state.straighten);
		this.state = baseHalfMoveCrop(this.original, this.state, moved);
		this.mapping = this.mappingAt(this.state.crop, center, scale);
		this.render();
	}

	/**
	 * While viewing, a pinch, or the wheel with the zoom key, over the picture
	 * zooms the view around the pointer as a browser zooms its page, and a
	 * two-finger swipe and the wheel move it while it is zoomed in, as on the
	 * canvas (D96). While editing, they zoom and move the picture under the
	 * crop frame instead, which changes the part kept (D97).
	 */
	private onWheel(event: WheelEvent): void {
		if (this.drag) {
			return;
		}
		const zoom = isBaseHalfNoteZoomWheel(event, isMacintosh);
		if (this.editing) {
			if (!zoom && this.element.classList.contains('whole')) {
				// The whole picture kept: there is nothing to move under the frame.
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.gesturing();
			if (zoom) {
				this.zoomCropAround(this.viewPoint(event), baseHalfNoteZoomFactor(event));
			} else {
				this.moveCropBy(baseHalfWheelMove(event));
			}
			return;
		}
		if (zoom) {
			event.preventDefault();
			event.stopPropagation();
			this.settleKeys();
			this.zoomAround(this.viewPoint(event), baseHalfNoteZoomFactor(event));
			return;
		}
		if (this.page.zoom <= 1) {
			// As it fits, there is nothing to move.
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.page = baseHalfMovePage(this.page, baseHalfWheelMove(event), this.viewSize);
		this.stopGlide();
		this.mapping = this.viewMapping();
		this.render();
	}

	/** While viewing, a double click shows the picture as it fits, or, as it fits, at its own pixels around the pointer; while editing it does nothing (D97). */
	private onDoubleClick(event: MouseEvent): void {
		if (this.drag || this.editing) {
			return;
		}
		this.settleKeys();
		const ownPixels = 1 / this.restMapping().scale;
		const target = this.page.zoom > 1 ? 1 : Math.min(this.maxZoom(), ownPixels > 1 ? ownPixels : this.maxZoom());
		this.zoomAround(this.viewPoint(event), target / this.page.zoom);
	}

	// #endregion

	// #region The keyboard

	private onKeyDown(event: KeyboardEvent): void {
		if (event.isComposing) {
			return;
		}
		const target = event.target as Element | null;
		const arrows: Record<string, IBaseHalfPoint> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
		const arrow = arrows[event.key];
		if (!arrow || this.drag || !this.editing) {
			return;
		}
		if (target === this.dial) {
			if (arrow.y !== 0) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.settleKeys();
			// Each key is a change; keys that repeat are one step of undo.
			this.change('straighten', baseHalfStraightenCrop(this.original, this.state, this.state.straighten + arrow.x * (event.shiftKey ? 1 : 0.1)), false);
			return;
		}
		const corner = [...this.corners].find(([, element]) => element === target)?.[0];
		if (!corner && target !== this.frame) {
			return;
		}
		// The arrow keys in the crop view move no card.
		event.preventDefault();
		event.stopPropagation();
		this.frame.classList.add('keyboard');
		this.stopGlide();
		this.endGesture();
		this.restWait.clear();
		if (!this.atRest()) {
			this.resetZoom();
			this.mapping = this.restMapping();
		}
		if (!this.keyBefore) {
			this.keyBefore = this.state;
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
		this.keyRest = setTimeout(() => this.settleKeys(), KEY_REST_MILLISECONDS);
	}

	/** Ends a sequence of keys: the frame comes to rest, and what they did is one change. */
	private settleKeys(): void {
		const before = this.keyBefore;
		this.dropKeys();
		if (before) {
			this.glideToRest();
			this.changed('crop', before);
		}
	}

	private dropKeys(): void {
		if (this.keyRest !== undefined) {
			clearTimeout(this.keyRest);
			this.keyRest = undefined;
		}
		this.keyBefore = undefined;
	}

	// #endregion

	// #region The ratio menu

	private showRatioMenu(): void {
		const choose = (ratio: RatioId, tall = this.tall) => {
			const value = this.ratioValue({ ratio, tall });
			this.change('crop', baseHalfApplyCropRatio(this.original, this.state, value), true, ratio, tall);
		};
		// Wide and Tall of a ratio that has no other shape change only what the menu says.
		const shape = (tall: boolean) => this.ratio === 'free' || this.ratio === 'original' || this.ratio === 'square'
			? this.change('crop', this.state, false, this.ratio, tall)
			: choose(this.ratio, tall);
		const presets = BASEHALF_CROP_RATIOS.map(preset => toAction({
			id: `basehalf.mediaEdit.ratio.${preset.id}`,
			label: preset.id === 'square' ? localize('basehalf.mediaEdit.image.square', "Square") : this.tall ? `${preset.height}:${preset.width}` : preset.id,
			checked: this.ratio === preset.id,
			run: () => choose(preset.id)
		}));
		this.contextMenuService.showContextMenu({
			getAnchor: () => this.ratioButton,
			getActions: () => [
				toAction({ id: 'basehalf.mediaEdit.ratio.wide', label: localize('basehalf.mediaEdit.image.wide', "Wide"), checked: !this.tall, run: () => shape(false) }),
				toAction({ id: 'basehalf.mediaEdit.ratio.tall', label: localize('basehalf.mediaEdit.image.tall', "Tall"), checked: this.tall, run: () => shape(true) }),
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
		// While the view is zoomed in, the frame does not show, and a drag moves the view.
		this.element.classList.toggle('zoomed', this.page.zoom > 1);
		// While the part is the whole picture, a drag inside it moves nothing.
		this.element.classList.toggle('whole', !choices.crop && !straighten);
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

function sameChoices(a: IBaseHalfMediaChoices, b: IBaseHalfMediaChoices): boolean {
	return JSON.stringify(normalizeBaseHalfMediaChoices(a)) === JSON.stringify(normalizeBaseHalfMediaChoices(b));
}

/** Whether two mappings put the picture in the same place, within a hundredth of a pixel of a picture of 10,000 pixels. */
function sameMapping(a: IMapping, b: IMapping): boolean {
	return Math.abs(a.scale - b.scale) <= 1e-6 * Math.max(a.scale, b.scale)
		&& Math.abs(a.center.x - b.center.x) * a.scale <= 0.01
		&& Math.abs(a.center.y - b.center.y) * a.scale <= 0.01;
}
