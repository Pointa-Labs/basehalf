/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_EDGE_FOLLOW_MARGIN } from '../../common/basehalfMediaZoom.js';
import { BASEHALF_IMAGE_CROP_MARGIN, BASEHALF_NOTE_PICTURE_EDIT_ROOM, BASEHALF_NOTE_SOUND_EDITOR_HEIGHT, BASEHALF_NOTE_VIDEO_EDIT_ROOM, baseHalfNoteMediaEditorBox, baseHalfNoteMediaEditorFit, baseHalfNoteMediaEditRoom, baseHalfNotePictureEditorBox } from '../../common/basehalfNoteMediaEdit.js';

suite('BaseHalfNoteMediaEdit', () => {
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
		assert.strictEqual(baseHalfNoteMediaEditorFit('image', picture, 1000), picture);
		// A page scrolled to whole pixels leaves a fraction of a pixel too little: the picture stays.
		const scrolled = { left: 189, top: 54, width: 712, height: 733.25 };
		assert.strictEqual(baseHalfNoteMediaEditorFit('image', scrolled, 54 + 733 + BASEHALF_NOTE_PICTURE_EDIT_ROOM), scrolled);
		// A picture of 712 × 1112 at the margin of a view of 600 px: as large as fits down to the room above the bottom.
		const height = 600 - BASEHALF_NOTE_PICTURE_EDIT_ROOM - 24;
		const scale = height / 1112;
		const tall = baseHalfNoteMediaEditorFit('image', { left: 200, top: 24, width: 712, height: 1112 }, 600);
		assert.deepStrictEqual(tall, { left: 200 + (712 - 712 * scale) / 2, top: 24, width: 712 * scale, height: 1112 * scale });
		assert.ok(Math.abs(tall.top + tall.height + BASEHALF_NOTE_PICTURE_EDIT_ROOM - 600) < 1e-9, 'the line under the tools ends at the view\'s bottom');
		// A picture whose top is above the view starts at the margin under the view's top.
		const above = 468 / 1000;
		assert.deepStrictEqual(baseHalfNoteMediaEditorFit('image', { left: 0, top: -300, width: 400, height: 1000 }, 600), { left: (400 - 400 * above) / 2, top: 24, width: 400 * above, height: 1000 * above });
	});

	test('a video\'s editor stands at the video\'s box with the edit bar and the line under it, and a sound\'s over its bar as tall as its editor (D114)', () => {
		assert.strictEqual(BASEHALF_NOTE_VIDEO_EDIT_ROOM, 12 + 48 + 12 + 28);
		assert.strictEqual(BASEHALF_NOTE_SOUND_EDITOR_HEIGHT, 112 + 12 + 32 + 12 + 28);
		const video = { left: 189, top: 182, width: 712, height: 400.5 };
		const sound = { left: 189, top: 618.5, width: 712, height: 54 };
		assert.deepStrictEqual({
			rooms: [baseHalfNoteMediaEditRoom('image', video), baseHalfNoteMediaEditRoom('video', video), baseHalfNoteMediaEditRoom('audio', sound)],
			video: baseHalfNoteMediaEditorBox('video', video),
			sound: baseHalfNoteMediaEditorBox('audio', sound),
		}, {
			rooms: [BASEHALF_NOTE_PICTURE_EDIT_ROOM, BASEHALF_NOTE_VIDEO_EDIT_ROOM, BASEHALF_NOTE_SOUND_EDITOR_HEIGHT - 54],
			video: { left: 189, top: 182, width: 712, height: 400.5 + BASEHALF_NOTE_VIDEO_EDIT_ROOM },
			sound: { left: 189, top: 618.5, width: 712, height: BASEHALF_NOTE_SOUND_EDITOR_HEIGHT },
		});
		// A tall video glides as large as fits above its edit bar, from its own top: it has no margin above.
		const tall = { left: 189, top: 0, width: 712, height: 1266 };
		const fitted = baseHalfNoteMediaEditorFit('video', tall, 800);
		assert.ok(Math.abs(fitted.top + fitted.height + BASEHALF_NOTE_VIDEO_EDIT_ROOM - 800) < 1e-9 && fitted.top === 0);
		// A sound's editor is drawn where its bar is.
		assert.strictEqual(baseHalfNoteMediaEditorFit('audio', sound, 300), sound);
	});
});
