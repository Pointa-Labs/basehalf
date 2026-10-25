/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BASEHALF_EDIT_MAX_STRAIGHTEN, IBaseHalfImageCrop, IBaseHalfMediaChoices } from './basehalfEditRecord.js';

/**
 * The geometry of cropping an image (editing media, "Cropping an image"):
 * the original, turned by quarter turns to the left and then mirrored left to
 * right, is the picture; the part kept is a rectangle of the picture, turned
 * by the angle the picture is straightened by about its center, that holds
 * only picture. Lengths are in pixels of the picture.
 *
 * On screen the part kept is upright and the picture is turned clockwise by
 * the angle under it: a point `p` of the picture shows at `R(θ)(p − c)` from
 * the center `c` of the part, `R(θ)` turning clockwise in coordinates whose y
 * grows downwards. The part's own axes in the picture are therefore `R(−θ)`
 * of the screen's.
 */

export interface IBaseHalfSize {
	readonly width: number;
	readonly height: number;
}

export interface IBaseHalfPoint {
	readonly x: number;
	readonly y: number;
}

/** What the crop view holds: the picture's turn, flip, and angle, and the part kept, its center and size in pixels of the picture. */
export interface IBaseHalfCropState {
	readonly turn: 0 | 1 | 2 | 3;
	readonly flip: boolean;
	/** Degrees, clockwise when positive. */
	readonly straighten: number;
	readonly crop: IBaseHalfImageCrop;
}

/** A ratio the frame keeps, width over height; none is freeform. */
export type BaseHalfCropRatio = number | undefined;

export type BaseHalfCropCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
export type BaseHalfCropSide = 'top' | 'right' | 'bottom' | 'left';

/** The shortest side the part kept may have, in pixels of the picture, unless the picture is shorter. */
export const BASEHALF_CROP_MIN_SIZE = 64;

/** The ratios of the ratio menu, wide; Tall gives each its height over its width. */
export const BASEHALF_CROP_RATIOS: readonly { readonly id: string; readonly width: number; readonly height: number }[] = Object.freeze([
	{ id: 'square', width: 1, height: 1 },
	{ id: '16:9', width: 16, height: 9 },
	{ id: '5:4', width: 5, height: 4 },
	{ id: '7:5', width: 7, height: 5 },
	{ id: '4:3', width: 4, height: 3 },
	{ id: '5:3', width: 5, height: 3 },
	{ id: '3:2', width: 3, height: 2 }
]);

const EPSILON = 1e-9;
/** How far a part may reach past the picture and still hold only picture: less than any pixel. */
const TOLERANCE = 1e-6;

/** The picture's size after its turn: a quarter turn swaps the sides. */
export function baseHalfTurnedSize(original: IBaseHalfSize, turn: number): IBaseHalfSize {
	return turn % 2 ? { width: original.height, height: original.width } : original;
}

/**
 * The affine map from a point of the original to the picture, as
 * `[a, b, c, d, e, f]` with `x' = a x + c y + e` and `y' = b x + d y + f`,
 * as a canvas's `transform` and a CSS `matrix` take it.
 */
export function baseHalfPictureTransform(original: IBaseHalfSize, turn: number, flip: boolean): readonly [number, number, number, number, number, number] {
	const { width: W, height: H } = original;
	// A quarter turn to the left takes the top right corner to the top left.
	let m: [number, number, number, number, number, number];
	switch (((turn % 4) + 4) % 4) {
		case 1: m = [0, -1, 1, 0, 0, W]; break;
		case 2: m = [-1, 0, 0, -1, W, H]; break;
		case 3: m = [0, 1, -1, 0, H, 0]; break;
		default: m = [1, 0, 0, 1, 0, 0];
	}
	if (flip) {
		// Then mirrored left to right across the turned picture's width.
		const width = baseHalfTurnedSize(original, turn).width;
		m = [-m[0], m[1], -m[2], m[3], width - m[4], m[5]];
	}
	return m;
}

/** A vector turned clockwise by an angle, in coordinates whose y grows downwards. */
export function baseHalfRotate(point: IBaseHalfPoint, degrees: number): IBaseHalfPoint {
	const radians = degrees * Math.PI / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function add(a: IBaseHalfPoint, b: IBaseHalfPoint, scale = 1): IBaseHalfPoint {
	return { x: a.x + b.x * scale, y: a.y + b.y * scale };
}

/** How far the part reaches from its center along each axis of the picture, at its angle. */
function reach(width: number, height: number, degrees: number): IBaseHalfPoint {
	const radians = degrees * Math.PI / 180;
	const c = Math.abs(Math.cos(radians));
	const s = Math.abs(Math.sin(radians));
	return { x: width / 2 * c + height / 2 * s, y: width / 2 * s + height / 2 * c };
}

/** Whether the part kept holds only picture. */
export function baseHalfCropHoldsOnlyPicture(picture: IBaseHalfSize, crop: IBaseHalfImageCrop, degrees: number): boolean {
	const r = reach(crop.width, crop.height, degrees);
	return crop.x - r.x >= -TOLERANCE && crop.x + r.x <= picture.width + TOLERANCE
		&& crop.y - r.y >= -TOLERANCE && crop.y + r.y <= picture.height + TOLERANCE;
}

/** The center nearest to `crop`'s at which a part of its size holds only picture, or the picture's center when none does. */
export function baseHalfClampCropCenter(picture: IBaseHalfSize, crop: IBaseHalfImageCrop, degrees: number): IBaseHalfImageCrop {
	const r = reach(crop.width, crop.height, degrees);
	const clamp = (value: number, low: number, high: number) => low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high);
	return { ...crop, x: clamp(crop.x, r.x, picture.width - r.x), y: clamp(crop.y, r.y, picture.height - r.y) };
}

/** The shortest side a part kept may have in a picture. */
export function baseHalfCropMinSize(picture: IBaseHalfSize): number {
	return Math.min(BASEHALF_CROP_MIN_SIZE, picture.width, picture.height);
}

/**
 * The largest part of a ratio around a center that holds only picture at an
 * angle, at most `limit` wide; around the picture's center when `center` is
 * left out.
 */
export function baseHalfLargestCrop(picture: IBaseHalfSize, ratio: number, degrees: number, center?: IBaseHalfPoint, limit = Infinity): IBaseHalfImageCrop {
	const radians = degrees * Math.PI / 180;
	const c = Math.abs(Math.cos(radians));
	const s = Math.abs(Math.sin(radians));
	const at = center ?? { x: picture.width / 2, y: picture.height / 2 };
	// The part reaches w/2·c + h/2·s along x and w/2·s + h/2·c along y, with h = w / ratio.
	const roomX = 2 * Math.max(0, Math.min(at.x, picture.width - at.x));
	const roomY = 2 * Math.max(0, Math.min(at.y, picture.height - at.y));
	const width = Math.max(0, Math.min(limit, roomX / (c + s / ratio), roomY / (s + c / ratio)));
	return { x: at.x, y: at.y, width, height: width / ratio };
}

/** The whole picture, upright: the part kept when nothing is cropped. */
export function baseHalfWholeCrop(picture: IBaseHalfSize): IBaseHalfImageCrop {
	return { x: picture.width / 2, y: picture.height / 2, width: picture.width, height: picture.height };
}

/**
 * The largest `t` from 0 to `limit` for which every point moved by `t` times
 * a vector stays in the picture. Every point is in the picture at first.
 */
function largestStep(picture: IBaseHalfSize, points: readonly IBaseHalfPoint[], direction: IBaseHalfPoint, limit: number): number {
	let t = limit;
	for (const point of points) {
		for (const [base, move, length] of [[point.x, direction.x, picture.width], [point.y, direction.y, picture.height]] as const) {
			if (move > EPSILON) {
				t = Math.min(t, (length - base) / move);
			} else if (move < -EPSILON) {
				t = Math.min(t, base / -move);
			}
		}
	}
	return Math.max(0, t);
}

/** The state of the crop view for the choices of an edit of an original of this size. */
export function baseHalfCropStateOf(original: IBaseHalfSize, choices: IBaseHalfMediaChoices): IBaseHalfCropState {
	const turn = choices.turn ?? 0;
	const picture = baseHalfTurnedSize(original, turn);
	const straighten = Math.max(-BASEHALF_EDIT_MAX_STRAIGHTEN, Math.min(BASEHALF_EDIT_MAX_STRAIGHTEN, choices.straighten ?? 0));
	let crop = choices.crop ?? baseHalfWholeCrop(picture);
	if (!baseHalfCropHoldsOnlyPicture(picture, crop, straighten)) {
		// A part that no longer fits, as of an original of another size, is the largest of its ratio that does.
		crop = baseHalfLargestCrop(picture, crop.width / crop.height, straighten, baseHalfClampCropCenter(picture, crop, straighten), crop.width);
	}
	return { turn, flip: !!choices.flip, straighten, crop };
}

/**
 * The choices of an edit that the crop view's state makes, each field at its
 * default left out. The part kept is in whole pixels, and without an angle it
 * starts on a whole pixel, so that every pixel kept is one of the original's;
 * the whole upright picture is no crop.
 */
export function baseHalfCropChoices(original: IBaseHalfSize, state: IBaseHalfCropState): IBaseHalfMediaChoices {
	const picture = baseHalfTurnedSize(original, state.turn);
	const straighten = Math.round(state.straighten * 10) / 10;
	let width = Math.max(1, Math.min(picture.width, Math.round(state.crop.width)));
	let height = Math.max(1, Math.min(picture.height, Math.round(state.crop.height)));
	let x: number;
	let y: number;
	if (straighten === 0) {
		x = Math.min(Math.max(Math.round(state.crop.x - width / 2), 0), picture.width - width) + width / 2;
		y = Math.min(Math.max(Math.round(state.crop.y - height / 2), 0), picture.height - height) + height / 2;
	} else {
		// Rounded to whole pixels, the part may reach a hair past the picture: it is a pixel smaller until it does not.
		let fitted = baseHalfClampCropCenter(picture, { x: state.crop.x, y: state.crop.y, width, height }, straighten);
		for (let attempt = 0; attempt < 4 && !baseHalfCropHoldsOnlyPicture(picture, fitted, straighten); attempt++) {
			width = Math.max(1, width - 1);
			height = Math.max(1, height - 1);
			fitted = baseHalfClampCropCenter(picture, { x: state.crop.x, y: state.crop.y, width, height }, straighten);
		}
		({ x, y } = fitted);
	}
	const whole = straighten === 0 && width === picture.width && height === picture.height;
	return {
		...(state.turn ? { turn: state.turn } : {}),
		...(state.flip ? { flip: true } : {}),
		...(straighten ? { straighten } : {}),
		...(whole ? {} : { crop: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, width, height } })
	};
}

/** Whether a state crops, turns, flips, or straightens nothing. */
export function baseHalfCropIsOriginal(original: IBaseHalfSize, state: IBaseHalfCropState): boolean {
	const choices = baseHalfCropChoices(original, state);
	return !choices.turn && !choices.flip && !choices.straighten && !choices.crop;
}

/** Turns the picture and the part kept a quarter to the left, as they show. */
export function baseHalfTurnCropLeft(original: IBaseHalfSize, state: IBaseHalfCropState): IBaseHalfCropState {
	const picture = baseHalfTurnedSize(original, state.turn);
	// Mirrored, a turn to the left of what shows is a turn to the right of the original.
	const turn = (state.flip ? (state.turn + 3) % 4 : (state.turn + 1) % 4) as 0 | 1 | 2 | 3;
	const { x, y, width, height } = state.crop;
	return { turn, flip: state.flip, straighten: state.straighten, crop: { x: y, y: picture.width - x, width: height, height: width } };
}

/** Mirrors the picture and the part kept left to right, as they show: the angle turns the other way. */
export function baseHalfFlipCrop(original: IBaseHalfSize, state: IBaseHalfCropState): IBaseHalfCropState {
	const picture = baseHalfTurnedSize(original, state.turn);
	return { ...state, flip: !state.flip, straighten: state.straighten ? -state.straighten : 0, crop: { ...state.crop, x: picture.width - state.crop.x } };
}

/**
 * Straightens the picture by an angle: the part keeps its center and its
 * ratio, and is as large as `size`, or as much smaller as it must be to hold
 * only picture, so that a dial turned back gives back the size it had when
 * the dial was taken.
 */
export function baseHalfStraightenCrop(original: IBaseHalfSize, state: IBaseHalfCropState, degrees: number, size: IBaseHalfSize = state.crop): IBaseHalfCropState {
	const picture = baseHalfTurnedSize(original, state.turn);
	const straighten = Math.max(-BASEHALF_EDIT_MAX_STRAIGHTEN, Math.min(BASEHALF_EDIT_MAX_STRAIGHTEN, Math.round(degrees * 10) / 10));
	return { ...state, straighten, crop: baseHalfLargestCrop(picture, size.width / size.height, straighten, state.crop, size.width) };
}

/** The largest part of a ratio around the part's center that holds only picture; Freeform keeps the part. */
export function baseHalfApplyCropRatio(original: IBaseHalfSize, state: IBaseHalfCropState, ratio: BaseHalfCropRatio): IBaseHalfCropState {
	if (ratio === undefined) {
		return state;
	}
	const picture = baseHalfTurnedSize(original, state.turn);
	return { ...state, crop: baseHalfLargestCrop(picture, ratio, state.straighten, state.crop) };
}

/** Moves the part kept across the picture by a vector of the picture, as far as its edges go. */
export function baseHalfMoveCrop(original: IBaseHalfSize, state: IBaseHalfCropState, delta: IBaseHalfPoint): IBaseHalfCropState {
	const picture = baseHalfTurnedSize(original, state.turn);
	return { ...state, crop: baseHalfClampCropCenter(picture, { ...state.crop, x: state.crop.x + delta.x, y: state.crop.y + delta.y }, state.straighten) };
}

/** The part's own axes in the picture, towards the signs given along them. */
function axes(degrees: number, signX: number, signY: number): { readonly across: IBaseHalfPoint; readonly down: IBaseHalfPoint } {
	return { across: baseHalfRotate({ x: signX, y: 0 }, -degrees), down: baseHalfRotate({ x: 0, y: signY }, -degrees) };
}

/**
 * Moves a corner of the part kept to a point of the picture: the opposite
 * corner stays, the part keeps a ratio when one is set, and it is never
 * smaller than its shortest side, nor reaches past the picture. A freeform
 * part stops at an edge along each side alone.
 */
export function baseHalfDragCropCorner(original: IBaseHalfSize, state: IBaseHalfCropState, corner: BaseHalfCropCorner, to: IBaseHalfPoint, ratio: BaseHalfCropRatio, minimum = baseHalfCropMinSize(baseHalfTurnedSize(original, state.turn))): IBaseHalfCropState {
	const picture = baseHalfTurnedSize(original, state.turn);
	const { crop, straighten } = state;
	const signX = corner === 'topRight' || corner === 'bottomRight' ? 1 : -1;
	const signY = corner === 'bottomLeft' || corner === 'bottomRight' ? 1 : -1;
	const { across, down } = axes(straighten, signX, signY);
	// The opposite corner stays where it is.
	const anchor = add(add(crop, across, -crop.width / 2), down, -crop.height / 2);
	const pull = baseHalfRotate({ x: to.x - anchor.x, y: to.y - anchor.y }, straighten);
	let width = Math.max(minimum, pull.x * signX);
	let height = Math.max(minimum, pull.y * signY);
	if (ratio !== undefined) {
		// The longer pull sets the size, and the shorter side is at least the shortest a part may have.
		width = Math.max(width, height * ratio, minimum * Math.max(1, ratio));
		height = width / ratio;
		const t = Math.min(
			largestStep(picture, [anchor], { x: across.x * width, y: across.y * width }, 1),
			largestStep(picture, [anchor], { x: down.x * height, y: down.y * height }, 1),
			largestStep(picture, [anchor], add({ x: across.x * width, y: across.y * width }, down, height), 1)
		);
		width *= t;
		height *= t;
	} else {
		width *= largestStep(picture, [anchor], { x: across.x * width, y: across.y * width }, 1);
		height *= largestStep(picture, [anchor], { x: down.x * height, y: down.y * height }, 1);
		// Straightened, the far corner can reach past the picture before the sides do: then the part is smaller as a whole.
		const t = largestStep(picture, [anchor], add({ x: across.x * width, y: across.y * width }, down, height), 1);
		width *= t;
		height *= t;
	}
	return { ...state, crop: { ...add(add(anchor, across, width / 2), down, height / 2), width, height } };
}

/**
 * Moves a side of the part kept to a point of the picture: the opposite side
 * stays; with a ratio, the part also grows or shrinks across the side, about
 * its middle.
 */
export function baseHalfDragCropSide(original: IBaseHalfSize, state: IBaseHalfCropState, side: BaseHalfCropSide, to: IBaseHalfPoint, ratio: BaseHalfCropRatio, minimum = baseHalfCropMinSize(baseHalfTurnedSize(original, state.turn))): IBaseHalfCropState {
	const picture = baseHalfTurnedSize(original, state.turn);
	const { crop, straighten } = state;
	const horizontal = side === 'left' || side === 'right';
	const sign = side === 'right' || side === 'bottom' ? 1 : -1;
	const { across, down } = axes(straighten, 1, 1);
	// The side moves along `out`; `wide` runs along it.
	const out = horizontal ? { x: across.x * sign, y: across.y * sign } : { x: down.x * sign, y: down.y * sign };
	const wide = horizontal ? down : across;
	const length = horizontal ? crop.width : crop.height;
	const breadth = horizontal ? crop.height : crop.width;
	// The middle of the opposite side stays where it is.
	const anchor = add(crop, out, -length / 2);
	const pull = baseHalfRotate({ x: to.x - anchor.x, y: to.y - anchor.y }, straighten);
	let reachOut = Math.max(minimum, (horizontal ? pull.x : pull.y) * sign);
	let span = breadth;
	if (ratio !== undefined) {
		span = horizontal ? reachOut / ratio : reachOut * ratio;
		if (span < minimum) {
			reachOut *= minimum / span;
			span = minimum;
		}
		// The part grows about the anchor: each of its corners moves from the anchor by `t` times where it would be.
		const outwards = { x: out.x * reachOut, y: out.y * reachOut };
		const t = Math.min(
			largestStep(picture, [anchor], { x: wide.x * span / 2, y: wide.y * span / 2 }, 1),
			largestStep(picture, [anchor], { x: -wide.x * span / 2, y: -wide.y * span / 2 }, 1),
			largestStep(picture, [anchor], add(outwards, wide, span / 2), 1),
			largestStep(picture, [anchor], add(outwards, wide, -span / 2), 1)
		);
		reachOut *= t;
		span *= t;
	} else {
		reachOut *= largestStep(picture, [add(anchor, wide, -span / 2), add(anchor, wide, span / 2)], { x: out.x * reachOut, y: out.y * reachOut }, 1);
	}
	const width = horizontal ? reachOut : span;
	const height = horizontal ? span : reachOut;
	return { ...state, crop: { ...add(anchor, out, reachOut / 2), width, height } };
}

/** Whether two ratios are the same within a pixel of a part of this size. */
export function baseHalfSameRatio(a: number, b: number, size = 4096): boolean {
	return Math.abs(a - b) * size / Math.max(a, b, 1) < 1;
}
