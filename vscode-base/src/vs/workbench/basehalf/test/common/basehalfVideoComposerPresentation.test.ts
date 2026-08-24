/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BASEHALF_VIDEO_COMPOSER_HEIGHT,
	BASEHALF_VIDEO_COMPOSER_WIDTH,
	baseHalfVideoComposerAnchorIsVisible,
	createBaseHalfVideoComposerFooterPresentation,
	createBaseHalfVideoComposerManipulationLock,
	followBaseHalfVideoComposerManipulation,
	resolveBaseHalfVideoComposerFirstMountPan,
	resolveBaseHalfVideoComposerPlacement
} from '../../common/basehalfVideoComposerPresentation.js';

suite('BaseHalfVideoComposerPresentation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('resolves canonical below, above, and clamped screen-space placements', () => {
		const viewport = { width: 1000, height: 800 };
		const below = resolveBaseHalfVideoComposerPlacement({ left: 350, top: 100, right: 650, bottom: 300 }, viewport);
		assert.strictEqual(below.placement, 'below');
		assert.strictEqual(below.top, 310);
		assert.strictEqual(below.left, 244);
		assert.strictEqual(below.screenWidth, BASEHALF_VIDEO_COMPOSER_WIDTH);
		assert.strictEqual(below.screenHeight, BASEHALF_VIDEO_COMPOSER_HEIGHT);

		const above = resolveBaseHalfVideoComposerPlacement({ left: 350, top: 610, right: 650, bottom: 790 }, viewport);
		assert.strictEqual(above.placement, 'above');
		assert.strictEqual(above.top, 440);

		const clamped = resolveBaseHalfVideoComposerPlacement({ left: 350, top: 150, right: 650, bottom: 300 }, { width: 1000, height: 420 });
		assert.strictEqual(clamped.placement, 'clamped-above');
		assert.strictEqual(clamped.top, 12);
	});

	test('keeps fixed dimensions across card scale and applies only the narrow viewport exception', () => {
		const smallCard = resolveBaseHalfVideoComposerPlacement({ left: 300, top: 100, right: 500, bottom: 220 }, { width: 1200, height: 900 });
		const largeCard = resolveBaseHalfVideoComposerPlacement({ left: 40, top: 100, right: 1160, bottom: 420 }, { width: 1200, height: 900 });
		assert.strictEqual(smallCard.screenWidth, 512);
		assert.strictEqual(largeCard.screenWidth, 512);
		assert.strictEqual(smallCard.screenHeight, 160);
		assert.strictEqual(largeCard.screenHeight, 160);

		const narrow = resolveBaseHalfVideoComposerPlacement({ left: 80, top: 40, right: 240, bottom: 120 }, { width: 320, height: 480 });
		assert.strictEqual(narrow.screenWidth, 296);
		assert.strictEqual(narrow.left, 12);
		assert.deepStrictEqual(createBaseHalfVideoComposerFooterPresentation(narrow.screenWidth), {
			density: 'narrow',
			controls: ['primary', 'status', 'model', 'settings', 'attempts', 'metadata'],
			modelMaximumWidth: 92,
			labelsTruncate: true
		});
	});

	test('requires a 24 by 24 anchor intersection and preserves exact mounted identity on re-entry', () => {
		const viewport = { width: 800, height: 600 };
		assert.strictEqual(baseHalfVideoComposerAnchorIsVisible({ left: -76, top: 100, right: 24, bottom: 200 }, viewport), true);
		assert.strictEqual(baseHalfVideoComposerAnchorIsVisible({ left: -77, top: 100, right: 23, bottom: 200 }, viewport), false);
		assert.strictEqual(resolveBaseHalfVideoComposerPlacement({ left: 900, top: 100, right: 1000, bottom: 200 }, viewport).visibility, 'anchor-offscreen');
		assert.strictEqual(resolveBaseHalfVideoComposerPlacement({ left: 100, top: 100, right: 200, bottom: 200 }, viewport).visibility, 'visible');
	});

	test('locks the manipulation side and translates without flipping or resizing', () => {
		const initialAnchor = { left: 300, top: 100, right: 500, bottom: 260 };
		const initial = resolveBaseHalfVideoComposerPlacement(initialAnchor, { width: 1000, height: 800 });
		const lock = createBaseHalfVideoComposerManipulationLock(initialAnchor, initial);
		const moved = followBaseHalfVideoComposerManipulation({ left: 430, top: 560, right: 630, bottom: 720 }, lock);
		assert.strictEqual(moved.placement, 'below');
		assert.strictEqual(moved.visibility, 'manipulating');
		assert.strictEqual(moved.left - initial.left, 130);
		assert.strictEqual(moved.top - initial.top, 460);
		assert.strictEqual(moved.screenWidth, 512);
		assert.strictEqual(moved.screenHeight, 160);
	});

	test('bounds first-mount pan and refuses a pan that cannot make the pair fit', () => {
		assert.deepStrictEqual(
			resolveBaseHalfVideoComposerFirstMountPan({ left: 250, top: 500, right: 550, bottom: 650 }, { width: 800, height: 800 }),
			{ x: 0, y: -32 }
		);
		assert.deepStrictEqual(
			resolveBaseHalfVideoComposerFirstMountPan({ left: 250, top: 740, right: 550, bottom: 890 }, { width: 800, height: 800 }),
			{ x: 0, y: 0 }
		);
		assert.deepStrictEqual(
			resolveBaseHalfVideoComposerFirstMountPan({ left: 80, top: 80, right: 280, bottom: 220 }, { width: 800, height: 800 }),
			{ x: 88, y: 0 }
		);
	});
});
