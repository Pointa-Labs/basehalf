/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfApplyCropRatio,
	baseHalfCropChoices,
	baseHalfCropHoldsOnlyPicture,
	baseHalfCropStateOf,
	baseHalfDragCropCorner,
	baseHalfDragCropSide,
	baseHalfFlipCrop,
	baseHalfLargestCrop,
	baseHalfMoveCrop,
	baseHalfPictureTransform,
	baseHalfRotate,
	baseHalfStraightenCrop,
	baseHalfTurnCropLeft,
	baseHalfTurnedSize,
	baseHalfZoomCrop,
	IBaseHalfCropState,
	IBaseHalfPoint
} from '../../common/basehalfImageCrop.js';

const ORIGINAL = { width: 4000, height: 3000 };

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundCrop = (state: IBaseHalfCropState) => ({ ...state, crop: { x: round(state.crop.x), y: round(state.crop.y), width: round(state.crop.width), height: round(state.crop.height) } });

/** Where a point of the original lands in the picture, by the transform. */
function apply(transform: readonly number[], point: IBaseHalfPoint): IBaseHalfPoint {
	const [a, b, c, d, e, f] = transform;
	return { x: round(a * point.x + c * point.y + e), y: round(b * point.x + d * point.y + f) };
}

suite('BaseHalfImageCrop', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('turns the original a quarter to the left at a time and mirrors it after: its corners land where they show (D84)', () => {
		const corners = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }];
		assert.deepStrictEqual({
			turned: [0, 1, 2, 3].map(turn => corners.map(point => apply(baseHalfPictureTransform(ORIGINAL, turn, false), point))),
			flipped: corners.map(point => apply(baseHalfPictureTransform(ORIGINAL, 1, true), point)),
			sizes: [0, 1].map(turn => baseHalfTurnedSize(ORIGINAL, turn))
		}, {
			turned: [
				[{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }],
				// A quarter to the left: the top right corner goes to the top left, the top left to the bottom left.
				[{ x: 0, y: 4000 }, { x: 0, y: 0 }, { x: 3000, y: 0 }],
				[{ x: 4000, y: 3000 }, { x: 0, y: 3000 }, { x: 0, y: 0 }],
				[{ x: 3000, y: 0 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 }]
			],
			flipped: [{ x: 3000, y: 4000 }, { x: 3000, y: 0 }, { x: 0, y: 0 }],
			sizes: [{ width: 4000, height: 3000 }, { width: 3000, height: 4000 }]
		});
	});

	test('a straightened part is as large as holds only picture, and turning the dial back gives back its size (D84)', () => {
		const whole = baseHalfCropStateOf(ORIGINAL, {});
		const turned = baseHalfStraightenCrop(ORIGINAL, whole, 10, whole.crop);
		const back = baseHalfStraightenCrop(ORIGINAL, turned, 0, whole.crop);
		// The largest 4:3 part at 10°: w·cos + h·sin ≤ 4000 and w·sin + h·cos ≤ 3000.
		const radians = 10 * Math.PI / 180;
		const expected = Math.min(4000 / (Math.cos(radians) + Math.sin(radians) * 3 / 4), 3000 / (Math.sin(radians) + Math.cos(radians) * 3 / 4));
		assert.deepStrictEqual({
			width: round(turned.crop.width),
			ratio: round(turned.crop.width / turned.crop.height),
			holds: baseHalfCropHoldsOnlyPicture(ORIGINAL, turned.crop, 10),
			slightlyLarger: baseHalfCropHoldsOnlyPicture(ORIGINAL, { ...turned.crop, width: turned.crop.width + 1, height: turned.crop.height + 0.75 }, 10),
			back: roundCrop(back).crop
		}, {
			width: round(expected),
			ratio: round(4 / 3),
			holds: true,
			slightlyLarger: false,
			back: { x: 2000, y: 1500, width: 4000, height: 3000 }
		});
	});

	test('a corner moves to the pointer, keeps a ratio when one is set, and stops at the edges of the picture; the opposite corner stays (D84)', () => {
		const whole = baseHalfCropStateOf(ORIGINAL, {});
		const free = baseHalfDragCropCorner(ORIGINAL, whole, 'topLeft', { x: 1000, y: 500 }, undefined);
		const square = baseHalfDragCropCorner(ORIGINAL, whole, 'topLeft', { x: 1000, y: 500 }, 1);
		const beyond = baseHalfDragCropCorner(ORIGINAL, free, 'bottomRight', { x: 5000, y: 2000 }, undefined);
		const tiny = baseHalfDragCropCorner(ORIGINAL, whole, 'topLeft', { x: 3990, y: 2995 }, undefined);
		assert.deepStrictEqual({
			free: roundCrop(free).crop,
			square: roundCrop(square).crop,
			// Past the right edge the corner stops there, and still follows the pointer down and up.
			beyond: roundCrop(beyond).crop,
			tiny: [round(tiny.crop.width), round(tiny.crop.height)]
		}, {
			free: { x: 2500, y: 1750, width: 3000, height: 2500 },
			square: { x: 2500, y: 1500, width: 3000, height: 3000 },
			beyond: { x: 2500, y: 1250, width: 3000, height: 1500 },
			tiny: [64, 64]
		});
	});

	test('a straightened corner stops where the far corner meets the picture, and the part holds only picture (D84)', () => {
		const state = baseHalfStraightenCrop(ORIGINAL, baseHalfCropStateOf(ORIGINAL, {}), 15);
		const dragged = baseHalfDragCropCorner(ORIGINAL, state, 'bottomRight', { x: 9000, y: 9000 }, undefined);
		const keyed = baseHalfDragCropCorner(ORIGINAL, state, 'topLeft', { x: -500, y: -500 }, 4 / 3);
		assert.deepStrictEqual([
			baseHalfCropHoldsOnlyPicture(ORIGINAL, dragged.crop, 15),
			baseHalfCropHoldsOnlyPicture(ORIGINAL, keyed.crop, 15),
			round(keyed.crop.width / keyed.crop.height)
		], [true, true, round(4 / 3)]);
	});

	test('a side moves alone when freeform, and with a ratio grows across about its middle (D84)', () => {
		const half = { ...baseHalfCropStateOf(ORIGINAL, {}), crop: { x: 2000, y: 1500, width: 2000, height: 1000 } };
		const right = baseHalfDragCropSide(ORIGINAL, half, 'right', { x: 3500, y: 0 }, undefined);
		const top = baseHalfDragCropSide(ORIGINAL, half, 'top', { x: 0, y: 500 }, 2);
		const pastEdge = baseHalfDragCropSide(ORIGINAL, half, 'left', { x: -900, y: 0 }, undefined);
		assert.deepStrictEqual([roundCrop(right).crop, roundCrop(top).crop, roundCrop(pastEdge).crop], [
			{ x: 2250, y: 1500, width: 2500, height: 1000 },
			// The bottom side stays at 2000; the part is 3000 wide at 2:1, about the middle of that side.
			{ x: 2000, y: 1250, width: 3000, height: 1500 },
			{ x: 1500, y: 1500, width: 3000, height: 1000 }
		]);
	});

	test('a ratio makes the largest part of it around the part\'s center; moving the part stops at the edges (D84)', () => {
		const whole = baseHalfCropStateOf(ORIGINAL, {});
		const wide = baseHalfApplyCropRatio(ORIGINAL, whole, 16 / 9);
		const tall = baseHalfApplyCropRatio(ORIGINAL, whole, 9 / 16);
		const moved = baseHalfMoveCrop(ORIGINAL, tall, { x: -5000, y: 10 });
		assert.deepStrictEqual([roundCrop(wide).crop, roundCrop(tall).crop, roundCrop(moved).crop], [
			{ x: 2000, y: 1500, width: 4000, height: 2250 },
			{ x: 2000, y: 1500, width: 1687.5, height: 3000 },
			{ x: 843.75, y: 1500, width: 1687.5, height: 3000 }
		]);
	});

	test('Turn Left and Flip turn and mirror the part with the picture, and the angle with a flip (D84)', () => {
		const state: IBaseHalfCropState = { turn: 0, flip: false, straighten: 5, crop: { x: 1000, y: 800, width: 1200, height: 900 } };
		const turned = baseHalfTurnCropLeft(ORIGINAL, state);
		const flipped = baseHalfFlipCrop(ORIGINAL, state);
		const flippedTurned = baseHalfTurnCropLeft(ORIGINAL, flipped);
		assert.deepStrictEqual({ turned, flipped, flippedTurn: flippedTurned.turn }, {
			turned: { turn: 1, flip: false, straighten: 5, crop: { x: 800, y: 3000, width: 900, height: 1200 } },
			flipped: { turn: 0, flip: true, straighten: -5, crop: { x: 3000, y: 800, width: 1200, height: 900 } },
			// Mirrored, a turn to the left of what shows is a turn to the right of the original.
			flippedTurn: 3
		});
		// What the turned part holds is what the part held: the original's point at its center is the same.
		const centerOf = (s: IBaseHalfCropState) => {
			const [a, b, c, d, e, f] = baseHalfPictureTransform(ORIGINAL, s.turn, s.flip);
			const det = a * d - b * c;
			const x = s.crop.x - e;
			const y = s.crop.y - f;
			return { x: round((d * x - c * y) / det), y: round((-b * x + a * y) / det) };
		};
		assert.deepStrictEqual([centerOf(turned), centerOf(flipped), centerOf(flippedTurned)], [centerOf(state), centerOf(state), centerOf(state)]);
	});

	test('the choices of a crop are in whole pixels, start on a whole pixel without an angle, and the whole picture is no crop (D84)', () => {
		const whole = baseHalfCropStateOf(ORIGINAL, {});
		const cropped = { ...whole, crop: { x: 1000.4, y: 700.6, width: 1599.6, height: 900.2 } };
		const straightened = baseHalfStraightenCrop(ORIGINAL, whole, -2.54);
		const choices = baseHalfCropChoices(ORIGINAL, straightened);
		assert.deepStrictEqual({
			whole: baseHalfCropChoices(ORIGINAL, whole),
			turnedWhole: baseHalfCropChoices(ORIGINAL, baseHalfTurnCropLeft(ORIGINAL, whole)),
			cropped: baseHalfCropChoices(ORIGINAL, cropped),
			straightened: [choices.straighten, Number.isInteger(choices.crop?.width), baseHalfCropHoldsOnlyPicture(ORIGINAL, choices.crop!, choices.straighten!)],
			readBack: roundCrop(baseHalfCropStateOf(ORIGINAL, baseHalfCropChoices(ORIGINAL, cropped))).crop
		}, {
			whole: {},
			turnedWhole: { turn: 1 },
			cropped: { crop: { x: 1000, y: 701, width: 1600, height: 900 } },
			straightened: [-2.5, true, true],
			readBack: { x: 1000, y: 701, width: 1600, height: 900 }
		});
	});

	test('the largest part of a ratio around a center reaches the nearest edge, and turns clockwise on screen as y grows downwards (D84)', () => {
		assert.deepStrictEqual({
			atCenter: roundCrop({ turn: 0, flip: false, straighten: 0, crop: baseHalfLargestCrop(ORIGINAL, 1, 0) }).crop,
			nearEdge: roundCrop({ turn: 0, flip: false, straighten: 0, crop: baseHalfLargestCrop(ORIGINAL, 1, 0, { x: 500, y: 1500 }) }).crop,
			rotated: [baseHalfRotate({ x: 1, y: 0 }, 90)].map(point => ({ x: round(point.x), y: round(point.y) }))
		}, {
			atCenter: { x: 2000, y: 1500, width: 3000, height: 3000 },
			nearEdge: { x: 500, y: 1500, width: 1000, height: 1000 },
			rotated: [{ x: 0, y: 1 }]
		});
	});

	test('a pinch while cropping zooms the picture under the frame: the part grows smaller about the point under the pointer, and larger as far as the picture holds its ratio (D97)', () => {
		const at = { x: 1000, y: 1000 };
		const part = { turn: 0, flip: false, straighten: 0, crop: { x: 2000, y: 1500, width: 2000, height: 1000 } } as const;
		assert.deepStrictEqual({
			// By 2: half as wide and high, and the point under the pointer keeps its place in the part.
			inByTwo: roundCrop(baseHalfZoomCrop(ORIGINAL, part, 2, at)).crop,
			// By ½ from a part of 2:1 in a picture of 4:3: as wide as the picture, no more.
			outByHalf: roundCrop(baseHalfZoomCrop(ORIGINAL, part, 0.5, at)).crop,
			// In as far as the shortest side the part may have, 64 pixels.
			inFar: roundCrop(baseHalfZoomCrop(ORIGINAL, part, 1000, at)).crop,
			// Out near an edge, the part slides so that it holds only picture.
			outNearEdge: roundCrop(baseHalfZoomCrop(ORIGINAL, { ...part, crop: { x: 600, y: 600, width: 1000, height: 1000 } }, 0.4, { x: 600, y: 600 })).crop
		}, {
			inByTwo: { x: 1500, y: 1250, width: 1000, height: 500 },
			outByHalf: { x: 2000, y: 2000, width: 4000, height: 2000 },
			inFar: { x: 1064, y: 1032, width: 128, height: 64 },
			outNearEdge: { x: 1250, y: 1250, width: 2500, height: 2500 }
		});
	});

	test('a pinch while cropping keeps the part all picture at an angle, and changes nothing when the part is as large as its ratio may be (D97)', () => {
		const straightened = baseHalfStraightenCrop(ORIGINAL, { turn: 0, flip: false, straighten: 0, crop: { x: 2000, y: 1500, width: 4000, height: 3000 } }, 10);
		const zoomedOut = baseHalfZoomCrop(ORIGINAL, straightened, 0.5, { x: 2000, y: 1500 });
		assert.ok(baseHalfCropHoldsOnlyPicture(ORIGINAL, zoomedOut.crop, 10));
		assert.deepStrictEqual(roundCrop(zoomedOut), roundCrop(straightened));
		const whole = { turn: 0, flip: false, straighten: 0, crop: { x: 2000, y: 1500, width: 4000, height: 3000 } } as const;
		assert.deepStrictEqual(roundCrop(baseHalfZoomCrop(ORIGINAL, whole, 0.7, { x: 100, y: 100 })), roundCrop(whole));
	});
});
