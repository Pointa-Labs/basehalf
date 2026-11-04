/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { EncodedTokenizationResult, ILanguageIdCodec, IState, ITokenizationSupport, TokenizationResult } from '../../../../../editor/common/languages.js';
import { NullState } from '../../../../../editor/common/languages/nullTokenize.js';
import { MetadataConsts } from '../../../../../editor/common/encodedTokenAttributes.js';
import { LineTokens } from '../../../../../editor/common/tokens/lineTokens.js';
import { IBaseHalfCanvasCodePreview } from '../../common/basehalfCanvasCardPreview.js';
import { BaseHalfCodePreviewTokens, baseHalfCodePiecesOfLine, baseHalfCodePreviewLines, baseHalfCodePreviewLinesFor, baseHalfTokenizeCodePreview } from '../../common/basehalfCanvasCodePreview.js';

const CODEC: ILanguageIdCodec = {
	encodeLanguageId: () => 1,
	decodeLanguageId: () => 'test'
};

/** Colors each word with a color of its own length, and counts its calls. */
function wordSupport(): ITokenizationSupport & { calls: number } {
	const support = {
		calls: 0,
		getInitialState: (): IState => NullState,
		tokenize: (): TokenizationResult => { throw new Error('not used'); },
		tokenizeEncoded(line: string, _hasEOL: boolean, state: IState): EncodedTokenizationResult {
			support.calls++;
			const starts: number[] = [];
			for (const match of line.matchAll(/\S+\s*/g)) {
				starts.push(match.index, (match[0].trimEnd().length << MetadataConsts.FOREGROUND_OFFSET) | (1 << MetadataConsts.LANGUAGEID_OFFSET));
			}
			if (starts.length === 0) {
				starts.push(0, 1 << MetadataConsts.FOREGROUND_OFFSET);
			}
			return new EncodedTokenizationResult(new Uint32Array(starts), [], state);
		}
	};
	return support;
}

suite('BaseHalf code card preview', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps a file as it is: indentation, blank lines, and its first line', () => {
		const head = '/* Copyright */\n\nimport a;\n\n\tif (a) {\n\t\tb();\n\t}\n';
		assert.deepStrictEqual(baseHalfCodePreviewLines(head, true), ['/* Copyright */', '', 'import a;', '', '\tif (a) {', '\t\tb();', '\t}', '']);
	});

	test('a head that a read cut off loses the line it ends in', () => {
		assert.deepStrictEqual(baseHalfCodePreviewLines('one\ntwo\nthr', false), ['one', 'two']);
		assert.deepStrictEqual(baseHalfCodePreviewLines('one\ntwo\nthr', true), ['one', 'two', 'thr']);
	});

	test('has the lines the editor has: every kind of line ending, blank lines at the end, and line 1 of an empty file', () => {
		assert.deepStrictEqual(baseHalfCodePreviewLines('a\r\nb\rc\n  \n\n', true), ['a', 'b', 'c', '  ', '', '']);
		assert.deepStrictEqual(baseHalfCodePreviewLines(' \n\n', true), [' ', '', '']);
		assert.deepStrictEqual(baseHalfCodePreviewLines('', true), ['']);
	});

	test('a minified line stops far past the edge of any card', () => {
		const [line] = baseHalfCodePreviewLines('x'.repeat(5000), true);
		assert.strictEqual(line.length, 400);
	});

	test('a file of one long line, whose head a read cut off, shows that line and is not empty', () => {
		assert.deepStrictEqual(baseHalfCodePreviewLines('x'.repeat(8192), false).map(line => line.length), [400]);
	});

	test('lines for a height hold part of the last one', () => {
		assert.strictEqual(baseHalfCodePreviewLinesFor(216), 13);
		assert.strictEqual(baseHalfCodePreviewLinesFor(217), 14);
	});

	test('colors runs of a line with the classes of the editor, and joins equal ones', () => {
		const lines = baseHalfTokenizeCodePreview(['\tif  (a) bb', 'cc dd', ''], 3, wordSupport(), CODEC);
		assert.deepStrictEqual(lines[1], [{ text: 'cc dd', className: 'mtk2' }]);
		assert.strictEqual(lines[0].map(piece => piece.text).join(''), '\tif  (a) bb');
		assert.deepStrictEqual(lines[2], []);
	});

	test('colors as many lines as are asked for, and only once', () => {
		const support = wordSupport();
		const tokens = new BaseHalfCodePreviewTokens(CODEC, () => support);
		const preview: IBaseHalfCanvasCodePreview = { kind: 'code', wholeFile: true, text: 'a\nb\nc', lines: ['a', 'b', 'c'], languageId: 'test', tabSize: 4 };
		assert.strictEqual(tokens.linesOf(preview, 2)?.length, 2);
		assert.strictEqual(support.calls, 2);
		assert.strictEqual(tokens.linesOf(preview, 2)?.length, 2);
		assert.strictEqual(tokens.linesOf(preview, 1)?.length, 2);
		assert.strictEqual(support.calls, 2);
		// A card that grew colors the lines it now shows.
		assert.strictEqual(tokens.linesOf(preview, 9)?.length, 3);
		assert.strictEqual(support.calls, 5);
	});

	test('a language without a grammar has no colors', () => {
		const tokens = new BaseHalfCodePreviewTokens(CODEC, () => null);
		assert.strictEqual(tokens.linesOf({ kind: 'code', wholeFile: true, text: 'a', lines: ['a'], languageId: 'zig', tabSize: 4 }, 1), undefined);
		assert.strictEqual(tokens.linesOf({ kind: 'code', wholeFile: true, text: 'a', lines: ['a'], tabSize: 4 }, 1), undefined);
	});

	test('a line cut short of what its tokens were read from has the colors of what is left of it', () => {
		const line = 'abcdefgh';
		const tokens = new Uint32Array([4, 1 << MetadataConsts.FOREGROUND_OFFSET, 8, 2 << MetadataConsts.FOREGROUND_OFFSET]);
		const lineTokens = new LineTokens(tokens, line, CODEC);
		assert.deepStrictEqual(baseHalfCodePiecesOfLine('abcdef', lineTokens).map(piece => piece.text), ['abcd', 'ef']);
		assert.deepStrictEqual(baseHalfCodePiecesOfLine('abc', lineTokens).map(piece => piece.text), ['abc']);
		assert.deepStrictEqual(baseHalfCodePiecesOfLine('', lineTokens), []);
	});
});
