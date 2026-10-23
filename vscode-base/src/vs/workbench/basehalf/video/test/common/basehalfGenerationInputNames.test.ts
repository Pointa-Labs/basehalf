/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfVideoInputKind } from '../../common/basehalfVideoCatalog.js';
import {
	baseHalfInputNameMapping,
	baseHalfInputNameOrdinals,
	baseHalfPromptNames,
	IBaseHalfInputListEntry,
	rewriteBaseHalfPromptNames
} from '../../common/basehalfGenerationInputNames.js';

function entry(key: string, kind: BaseHalfVideoInputKind = 'image'): IBaseHalfInputListEntry {
	return { key, kind };
}

suite('BaseHalf generation input names (D68)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('numbers each named input by kind in list order, and leaves text and other inputs without a number', () => {
		assert.deepStrictEqual(baseHalfInputNameOrdinals([
			entry('a.png'), entry('b.mp4', 'video'), entry('note.md', 'text'), entry('c.png'), entry('d.pdf', 'other'), entry('e.wav', 'audio')
		]), [1, 1, undefined, 2, undefined, 1]);
	});

	test('finds the input each name of a prompt means, in both languages', () => {
		const names = baseHalfPromptNames('图片2 rides past Video 1, 图片3 and Audio 1', [entry('a.png'), entry('b.png'), entry('c.mp4', 'video')]);
		assert.deepStrictEqual(names.map(name => ({ text: name.kind + name.ordinal, index: name.index })), [
			{ text: 'image2', index: 1 },
			{ text: 'video1', index: 2 },
			{ text: 'image3', index: undefined },
			{ text: 'audio1', index: undefined }
		]);
	});

	test('takes out the name of a removed input and renumbers the names after it', () => {
		const before = [entry('a.png'), entry('b.png'), entry('c.png')];
		const after = [entry('b.png'), entry('c.png')];
		assert.strictEqual(rewriteBaseHalfPromptNames('图片1里的人骑车，背景是图片3', before, after), '里的人骑车，背景是图片2');
		assert.strictEqual(rewriteBaseHalfPromptNames('图片2 图片1 rides', before, after), '图片1 rides');
		assert.strictEqual(rewriteBaseHalfPromptNames('Image 3 beside Image 1', before, after), 'Image 2 beside');
	});

	test('takes one space with a removed name: the one after it, or else the one before it', () => {
		const before = [entry('a.png'), entry('b.png')];
		const after = [entry('b.png')];
		assert.strictEqual(rewriteBaseHalfPromptNames('see 图片1 now', before, after), 'see now');
		assert.strictEqual(rewriteBaseHalfPromptNames('see 图片1', before, after), 'see');
		assert.strictEqual(rewriteBaseHalfPromptNames('图片1, 图片2', before, after), ', 图片1');
		assert.strictEqual(rewriteBaseHalfPromptNames('图片1 图片1 图片2', before, after), '图片1');
	});

	test('swaps the names of two inputs that changed places, and changes nothing when the order stays', () => {
		const before = [entry('start.png'), entry('end.png')];
		assert.strictEqual(rewriteBaseHalfPromptNames('从图片1到图片2', before, [entry('end.png'), entry('start.png')]), '从图片2到图片1');
		assert.strictEqual(rewriteBaseHalfPromptNames('从图片1到图片2', before, before), undefined);
	});

	test('leaves the names of other kinds as they are when an input of one kind moves', () => {
		const before = [entry('a.png'), entry('clip.mp4', 'video'), entry('b.png')];
		const after = [entry('clip.mp4', 'video'), entry('b.png')];
		assert.strictEqual(rewriteBaseHalfPromptNames('视频1 with 图片2', before, after), '视频1 with 图片1');
	});

	test('adding an input last changes no name', () => {
		assert.strictEqual(rewriteBaseHalfPromptNames('图片1 and 视频1', [entry('a.png'), entry('v.mp4', 'video')], [entry('a.png'), entry('v.mp4', 'video'), entry('b.png')]), undefined);
	});

	test('leaves a name that meant no input as it is', () => {
		const before = [entry('a.png'), entry('b.png')];
		assert.strictEqual(rewriteBaseHalfPromptNames('图片9 and 图片2', before, [entry('b.png')]), '图片9 and 图片1');
	});

	test('a replaced entry of the same kind keeps its number, and one of another kind takes the old name out', () => {
		const before = [entry('a.png'), entry('b.png')];
		assert.strictEqual(rewriteBaseHalfPromptNames('图片1 then 图片2', before, [entry('z.png'), entry('b.png')], [{ from: 'a.png', to: 'z.png' }]), undefined);
		assert.strictEqual(rewriteBaseHalfPromptNames('图片1 then 图片2', before, [entry('z.mp4', 'video'), entry('b.png')], [{ from: 'a.png', to: 'z.mp4' }]), 'then 图片1');
	});

	test('maps every name of the list before to its number after, or to none', () => {
		const mapping = baseHalfInputNameMapping(
			[entry('a.png'), entry('clip.mp4', 'video'), entry('b.png'), entry('note.md', 'text')],
			[entry('b.png'), entry('note.md', 'text'), entry('clip.mp4', 'video')]
		);
		assert.deepStrictEqual([...mapping], [['image:1', undefined], ['video:1', 1], ['image:2', 1]]);
	});

	test('a prompt without names changes nothing', () => {
		assert.strictEqual(rewriteBaseHalfPromptNames('a quiet street at night', [entry('a.png')], []), undefined);
	});
});
