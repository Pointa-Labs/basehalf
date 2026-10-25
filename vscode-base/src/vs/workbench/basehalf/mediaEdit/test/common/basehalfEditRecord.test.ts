/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BaseHalfEditRecordError,
	baseHalfEditOriginalName,
	baseHalfEditSummary,
	baseHalfIsEditOriginalName,
	normalizeBaseHalfMediaChoices,
	parseBaseHalfEditRecord,
	serializeBaseHalfEditRecord
} from '../../common/basehalfEditRecord.js';
import { baseHalfMediaChoicesAreNoEdit, baseHalfMediaEditFormatRefusal, baseHalfMediaEditKind } from '../../common/basehalfMediaEditFormats.js';

const HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

suite('BaseHalfEditRecord', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('writes the record of a video and of an image, with the fields at their defaults left out, and reads it back (D84)', () => {
		const video = serializeBaseHalfEditRecord({ original: 'original.mp4', result: { size: 120_000, hash: HASH }, keep: [{ start: 1.0334, end: 4.5671 }], mute: true });
		const image = serializeBaseHalfEditRecord({ original: 'original.png', result: { size: 9, hash: HASH }, turn: 1, flip: true, straighten: -2.54, crop: { x: 1024, y: 600.004, width: 1600, height: 900 } });
		const plain = serializeBaseHalfEditRecord({ original: 'original.wav', result: { size: 9, hash: HASH }, keep: [{ start: 0, end: 1 }, { start: 2, end: 3 }], mute: false, turn: 4 as 1, flip: false, straighten: 0.04 });
		assert.deepStrictEqual({ video, image, plain, readBack: [parseBaseHalfEditRecord(video), parseBaseHalfEditRecord(image)] }, {
			video: [
				'original: "original.mp4"',
				'result:',
				'  size: 120000',
				`  hash: "${HASH}"`,
				'keep:',
				'  - start: 1.033',
				'    end: 4.567',
				'mute: true',
				''
			].join('\n'),
			image: [
				'original: "original.png"',
				'result:',
				'  size: 9',
				`  hash: "${HASH}"`,
				'turn: 1',
				'flip: true',
				'straighten: -2.5',
				'crop:',
				'  x: 1024',
				'  y: 600',
				'  width: 1600',
				'  height: 900',
				''
			].join('\n'),
			// A whole turn is no turn, and an angle under a twentieth of a degree is none.
			plain: [
				'original: "original.wav"',
				'result:',
				'  size: 9',
				`  hash: "${HASH}"`,
				'keep:',
				'  - start: 0',
				'    end: 1',
				'  - start: 2',
				'    end: 3',
				''
			].join('\n'),
			readBack: [
				{ original: 'original.mp4', result: { size: 120_000, hash: HASH }, keep: [{ start: 1.033, end: 4.567 }], mute: true },
				{ original: 'original.png', result: { size: 9, hash: HASH }, turn: 1, flip: true, straighten: -2.5, crop: { x: 1024, y: 600, width: 1600, height: 900 } }
			]
		});
	});

	test('a record that cannot be read whole is no record: it is left as it is (D84)', () => {
		const good = serializeBaseHalfEditRecord({ original: 'original.mp4', result: { size: 9, hash: HASH }, keep: [{ start: 1, end: 2 }] });
		assert.deepStrictEqual([
			parseBaseHalfEditRecord('<<<<<<< HEAD\noriginal: "original.mp4"\n'),
			parseBaseHalfEditRecord(good.replace('original.mp4', '../shot.mp4')),
			parseBaseHalfEditRecord(good.replace(HASH, 'abc')),
			parseBaseHalfEditRecord(good.replace('  size: 9', '  size: -1')),
			parseBaseHalfEditRecord(good.replace('    end: 2', '    end: 0.5')),
			parseBaseHalfEditRecord(good.replace('keep:\n  - start: 1\n    end: 2\n', 'keep: 3\n')),
			parseBaseHalfEditRecord(`${good}straighten: 46\n`),
			parseBaseHalfEditRecord(`${good}crop:\n  x: 1\n  y: 1\n  width: 2.5\n  height: 3\n`),
			parseBaseHalfEditRecord('')
		], [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
	});

	test('choices are in order, rounded as a record holds them, and refused when a part, a turn, an angle, or a crop cannot be (D84)', () => {
		assert.deepStrictEqual(normalizeBaseHalfMediaChoices({ keep: [{ start: 0.0004, end: 1 }, { start: 1, end: 2.0006 }], turn: -1 as 3 }), { keep: [{ start: 0, end: 1 }, { start: 1, end: 2.001 }], turn: 3 });
		for (const choices of [
			{ keep: [] },
			{ keep: [{ start: 2, end: 3 }, { start: 1, end: 4 }] },
			{ keep: [{ start: 1, end: 1 }] },
			{ keep: [{ start: 0, end: 25 * 60 * 60 }] },
			{ turn: 1.5 as 1 },
			{ straighten: 45.1 },
			{ crop: { x: 0, y: 0, width: 0, height: 10 } }
		]) {
			assert.throws(() => normalizeBaseHalfMediaChoices(choices), BaseHalfEditRecordError, JSON.stringify(choices));
		}
	});

	test('names the original by the extension of its file, and says what an edit did, in tenths never above the time (D84)', () => {
		assert.deepStrictEqual({
			names: [baseHalfEditOriginalName('mp4'), baseHalfIsEditOriginalName('original.webm'), baseHalfIsEditOriginalName('original.mp4.tmp'), baseHalfIsEditOriginalName('original'), baseHalfIsEditOriginalName('shot.mp4')],
			summaries: [
				baseHalfEditSummary({ keep: [{ start: 1.049, end: 4.567 }] }),
				baseHalfEditSummary({ keep: [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 5 }], mute: true }),
				baseHalfEditSummary({ turn: 2, flip: true, straighten: 3.5, crop: { x: 800, y: 450, width: 1600, height: 900 } }),
				baseHalfEditSummary({})
			]
		}, {
			names: ['original.mp4', true, false, false, false],
			summaries: [
				'Trimmed to 1.0s–4.5s',
				'Trimmed to 3 parts · Without sound',
				'Turned · Flipped · Straightened by 3.5° · Cropped to 1600 × 900',
				undefined
			]
		});
	});

	test('edits videos, images, and sounds of the formats it writes, and says why it edits no other (D84)', () => {
		const kinds = ['shot.MP4', 'clip.mov', 'clip.m4v', 'clip.webm', 'still.png', 'still.JPG', 'still.jpeg', 'still.webp', 'song.mp3', 'take.wav', 'take.flac', 'voice.m4a', 'voice.ogg', 'loop.gif', 'still.avif', 'clip.mkv', 'voice.oga', 'note.md']
			.map(name => baseHalfMediaEditKind(URI.file(`/workspace/${name}`)) ?? '-');
		assert.deepStrictEqual({
			kinds,
			refusals: [baseHalfMediaEditFormatRefusal('image', URI.file('/workspace/loop.gif')), baseHalfMediaEditFormatRefusal('video', URI.file('/workspace/clip.mkv'))],
			noEdit: [baseHalfMediaChoicesAreNoEdit({}), baseHalfMediaChoicesAreNoEdit({ mute: true }), baseHalfMediaChoicesAreNoEdit({ crop: { x: 1, y: 1, width: 2, height: 2 } })]
		}, {
			kinds: ['video', 'video', 'video', 'video', 'image', 'image', 'image', 'image', 'sound', 'sound', 'sound', 'sound', 'sound', '-', '-', '-', '-', '-'],
			refusals: ['BaseHalf can\'t edit GIF images', 'BaseHalf can\'t edit MKV videos'],
			noEdit: [true, false, false]
		});
	});
});
