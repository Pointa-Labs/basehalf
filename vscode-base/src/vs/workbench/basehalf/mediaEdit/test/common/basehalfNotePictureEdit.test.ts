/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_EDGE_FOLLOW_MARGIN } from '../../common/basehalfMediaZoom.js';
import { BASEHALF_IMAGE_CROP_MARGIN, BASEHALF_NOTE_PICTURE_EDIT_ROOM, baseHalfNotePictureEditorBox, baseHalfNotePictureEditorFit } from '../../common/basehalfNotePictureEdit.js';

suite('BaseHalfNotePictureEdit', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the margin of the editor is the one the crop view rests its frame in', () => {
		// Rich's page imports the module of the margin, which imports nothing: the two values must stay one.
		assert.strictEqual(BASEHALF_IMAGE_CROP_MARGIN, BASEHALF_EDGE_FOLLOW_MARGIN);
	});

	test('the room under a picture is the margin, the row of tools, and the line under them', () => {
		assert.strictEqual(BASEHALF_NOTE_PICTURE_EDIT_ROOM, 24 + 56 + 28);
	});

	test('the editor stands around the picture so that its picture is where the note shows it', () => {
		assert.deepStrictEqual(baseHalfNotePictureEditorBox({ left: 200, top: 254, width: 712, height: 445 }), {
			left: 176,
			top: 230,
			width: 760,
			height: 445 + 24 + 108,
		});
		// A box of fractions keeps them: the editor's picture lands on the note's to the pixel's fraction.
		assert.deepStrictEqual(baseHalfNotePictureEditorBox({ left: 10.5, top: 0.25, width: 99.5, height: 50.75 }), {
			left: -13.5,
			top: -23.75,
			width: 147.5,
			height: 182.75,
		});
	});

	test('a picture whose editor would not fit the view is drawn as large as fits above the tools, its middle across where the picture\'s is', () => {
		// The editor fits a view of 1000 px, its margin above and its room below: the picture stays as it is.
		const picture = { left: 200, top: 254, width: 712, height: 445 };
		assert.strictEqual(baseHalfNotePictureEditorFit(picture, 1000), picture);
		// A page scrolled to whole pixels leaves a fraction of a pixel too little: the picture stays.
		const scrolled = { left: 189, top: 54, width: 712, height: 733.25 };
		assert.strictEqual(baseHalfNotePictureEditorFit(scrolled, 54 + 733 + BASEHALF_NOTE_PICTURE_EDIT_ROOM), scrolled);
		// A picture of 712 × 1112 at the margin of a view of 600 px: as large as fits down to the room above the bottom.
		const height = 600 - BASEHALF_NOTE_PICTURE_EDIT_ROOM - 24;
		const scale = height / 1112;
		const tall = baseHalfNotePictureEditorFit({ left: 200, top: 24, width: 712, height: 1112 }, 600);
		assert.deepStrictEqual(tall, { left: 200 + (712 - 712 * scale) / 2, top: 24, width: 712 * scale, height: 1112 * scale });
		assert.ok(Math.abs(tall.top + tall.height + BASEHALF_NOTE_PICTURE_EDIT_ROOM - 600) < 1e-9, 'the line under the tools ends at the view\'s bottom');
		// A picture whose top is above the view starts at the margin under the view's top.
		const above = 468 / 1000;
		assert.deepStrictEqual(baseHalfNotePictureEditorFit({ left: 0, top: -300, width: 400, height: 1000 }, 600), { left: (400 - 400 * above) / 2, top: 24, width: 400 * above, height: 1000 * above });
	});
});
