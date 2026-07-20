/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	baseHalfCanvasReconnectEndForPath,
	baseHalfCanvasReconnectSnapForHit,
	IBaseHalfCanvasPathSample,
	nearestBaseHalfCanvasPathRatio,
	resolveBaseHalfCanvasReconnectPoint
} from '../../common/basehalfCanvasEdgeReconnect.js';

suite('BaseHalfCanvasEdgeReconnect', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const backtrackingPath: readonly IBaseHalfCanvasPathSample[] = [
		{ x: 0, y: 0, ratio: 0 },
		{ x: 80, y: 0, ratio: 0.25 },
		{ x: 20, y: 60, ratio: 0.5 },
		{ x: -30, y: 10, ratio: 0.75 },
		{ x: 40, y: 0, ratio: 1 }
	];

	test('chooses the directed path half nearest the pointer, not a screen axis', () => {
		assert.strictEqual(baseHalfCanvasReconnectEndForPath(backtrackingPath, { x: 78, y: 2 }), 'source');
		assert.strictEqual(baseHalfCanvasReconnectEndForPath(backtrackingPath, { x: -29, y: 11 }), 'target');
	});

	test('assigns the exact midpoint to the target half', () => {
		assert.strictEqual(baseHalfCanvasReconnectEndForPath(backtrackingPath, { x: 20, y: 60 }), 'target');
	});

	test('ignores invalid samples and reports an empty path', () => {
		assert.strictEqual(nearestBaseHalfCanvasPathRatio([
			{ x: Number.NaN, y: 0, ratio: 0.2 },
			{ x: 0, y: 0, ratio: Number.POSITIVE_INFINITY }
		], { x: 0, y: 0 }), undefined);
		assert.strictEqual(baseHalfCanvasReconnectEndForPath([], { x: 0, y: 0 }), undefined);
	});

	test('snaps to the nearest eligible card and its pointer-facing side', () => {
		const hit = resolveBaseHalfCanvasReconnectPoint({ x: 206, y: 60 }, [
			{ nodeId: 'far', left: 0, top: 0, width: 100, height: 100 },
			{ nodeId: 'near', left: 200, top: 20, width: 120, height: 80 }
		], new Set());

		assert.deepStrictEqual(hit, {
			kind: 'snap',
			snap: {
				nodeId: 'near',
				anchor: 'west',
				clientPoint: { x: 200, y: 60 },
				distance: 0
			}
		});
	});

	test('excludes the opposite endpoint while retaining the dragged endpoint card', () => {
		const rects = [
			{ nodeId: 'source', left: 0, top: 0, width: 100, height: 100 },
			{ nodeId: 'target', left: 150, top: 0, width: 100, height: 100 }
		];
		assert.deepStrictEqual(
			resolveBaseHalfCanvasReconnectPoint({ x: 150, y: 50 }, rects, new Set(['target'])),
			{ kind: 'invalid-card' }
		);
		assert.deepStrictEqual(
			resolveBaseHalfCanvasReconnectPoint({ x: 100, y: 50 }, rects, new Set(['target'])),
			{
				kind: 'snap',
				snap: {
					nodeId: 'source',
					anchor: 'east',
					clientPoint: { x: 100, y: 50 },
					distance: 0
				}
			}
		);
	});

	test('returns blank outside the reconnect target depth', () => {
		assert.deepStrictEqual(resolveBaseHalfCanvasReconnectPoint({ x: 140, y: 140 }, [
			{ nodeId: 'card', left: 0, top: 0, width: 100, height: 100 }
		], new Set()), { kind: 'blank' });
	});

	test('cancels reconnect drops on blank or invalid cards instead of deleting the edge', () => {
		assert.strictEqual(baseHalfCanvasReconnectSnapForHit({ kind: 'blank' }), undefined);
		assert.strictEqual(baseHalfCanvasReconnectSnapForHit({ kind: 'invalid-card' }), undefined);
		const snap = {
			nodeId: 'target',
			anchor: 'west' as const,
			clientPoint: { x: 200, y: 60 },
			distance: 0
		};
		assert.strictEqual(baseHalfCanvasReconnectSnapForHit({ kind: 'snap', snap }), snap);
	});
});
