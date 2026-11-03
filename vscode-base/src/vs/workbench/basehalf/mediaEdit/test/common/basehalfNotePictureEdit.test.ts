/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_EDGE_FOLLOW_MARGIN } from '../../common/basehalfMediaZoom.js';
import { BASEHALF_IMAGE_CROP_MARGIN, BASEHALF_NOTE_PICTURE_EDIT_ROOM, baseHalfNotePictureEditorBox } from '../../common/basehalfNotePictureEdit.js';

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
});
