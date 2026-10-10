/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfMirrorRecoveryResource } from '../../common/basehalfMirrorRecovery.js';
import {
	BaseHalfMirrorYamlUnreadable,
	baseHalfMirrorYamlAbsent,
	baseHalfMirrorYamlBoolean,
	baseHalfMirrorYamlItems,
	baseHalfMirrorYamlNumber,
	baseHalfMirrorYamlProperty,
	baseHalfMirrorYamlQuote,
	baseHalfMirrorYamlString,
	baseHalfParseMirrorYaml
} from '../../common/basehalfMirrorYaml.js';

suite('BaseHalf mirror YAML grammar', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function value(document: string, key = 'value') {
		return baseHalfMirrorYamlProperty(baseHalfParseMirrorYaml(document, 'test').root!, key);
	}

	test('every quoted string reads back as the string that was written', () => {
		const strings = [
			'09', '2024', '-3', '1.5', '1e21', '0x10', 'true', 'false', 'null', '~', '', ' lead', 'trail ',
			'a: b', 'a #b', '- x', '"q"', 'it\'s', 'back\\slash', 'tab\there', 'line\nbreak', 'cr\rhere',
			'nul\u0000x', 'bell\u0007', 'del\u007f', 'nel\u0085x', 'ls x', 'ps x', 'bom﻿x',
			'emoji😀', '中文/笔记.md', '[a]', '{a}', '&a', '*a', '!a', '|', '>', '---'
		];

		assert.deepStrictEqual(
			strings.map(text => baseHalfMirrorYamlString(value(`value: ${baseHalfMirrorYamlQuote(text)}\n`))),
			strings
		);
	});

	test('a string field takes the text of a scalar however it is quoted', () => {
		assert.deepStrictEqual(
			['"09"', '\'09\'', '09', 'true', '1.50', '', '~', 'null', '"null"', '[a]'].map(text => baseHalfMirrorYamlString(value(`value: ${text}\n`))),
			['09', '09', '09', 'true', '1.50', '', undefined, undefined, 'null', undefined]
		);
	});

	test('a number field takes decimal text and nothing else', () => {
		assert.deepStrictEqual(
			['12', '-362.0773', '1e+21', '.5', '"12"', '0x10', 'twelve', 'Infinity', '~', '[1]'].map(text => baseHalfMirrorYamlNumber(value(`value: ${text}\n`))),
			[12, -362.0773, 1e21, 0.5, 12, undefined, undefined, undefined, undefined, undefined]
		);
	});

	test('booleans, lists, and absent values follow the schema', () => {
		assert.deepStrictEqual({
			booleans: ['true', 'false', '"true"', 'yes', '1'].map(text => baseHalfMirrorYamlBoolean(value(`value: ${text}\n`))),
			lists: ['[]', '[a, b]', '', '~', 'text', '{ a: 1 }'].map(text => baseHalfMirrorYamlItems(value(`value: ${text}\n`))?.length),
			missingList: baseHalfMirrorYamlItems(value('other: 1\n'))?.length,
			absent: ['~', 'null', '"null"', '', '0'].map(text => baseHalfMirrorYamlAbsent(value(`value: ${text}\n`))),
			missing: baseHalfMirrorYamlAbsent(value('other: 1\n'))
		}, {
			booleans: [true, false, true, undefined, undefined],
			lists: [0, 2, 0, 0, undefined, undefined],
			missingList: 0,
			absent: [true, true, false, false, false],
			missing: true
		});
	});

	test('an empty document is null and anything that is not a mapping is unreadable', () => {
		assert.deepStrictEqual(
			['', '  \n\n', '# only a comment\n'].map(document => baseHalfParseMirrorYaml(document, 'test')),
			[{ root: null }, { root: null }, { root: null }]
		);
		for (const document of ['path: [unterminated', '- a\n- b\n', 'just text\n', 'a: 1\na: 2\n', '<<<<<<< HEAD\na: 1\n']) {
			assert.throws(() => baseHalfParseMirrorYaml(document, 'test'), BaseHalfMirrorYamlUnreadable, document);
		}
	});

	test('text the parser silently stops at is reported with its line, and harmless leftovers are not', () => {
		const complete = [
			'a: 1\nb: 2',
			'a: 1\nb: 2\n\n# trailing comment\n   \n',
			'a: 1\r\nb: 2\r\n',
			'---\na: 1\nb: 2\n...\n',
			'a: 1\nb:\n',
			'a: |\n  two\n  lines\n',
			'\ufeffa: 1\nb: 2\n'
		];
		const stopped = {
			'a: 1\n<<<<<<< HEAD\nb: 2\n=======\nb: 3\n>>>>>>> other\n': 'line 2 and what follows could not be read',
			'a: 1\nb:\n  - c: 1\n<<<<<<< HEAD\n    d: 2\n': 'line 4 and what follows could not be read',
			'a: 1\nthis line is not yaml\nb: 2\n': 'line 2 and what follows could not be read'
		};

		assert.deepStrictEqual({
			complete: complete.map(document => baseHalfParseMirrorYaml(document, 'test').unparsed),
			stopped: Object.keys(stopped).map(document => baseHalfParseMirrorYaml(document, 'test').unparsed),
			byteOrderMark: baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(baseHalfParseMirrorYaml('\ufeffpath: "09"\n', 'test').root!, 'path'))
		}, {
			complete: complete.map(() => undefined),
			stopped: Object.values(stopped),
			byteOrderMark: '09'
		});
	});

	test('a recovery copy is named by the digest of the bytes it holds', async () => {
		const workspaceFolder = URI.file('/work');
		const canvas = URI.file('/work/.bh/mirror/docs/canvas.yaml');

		const first = await baseHalfMirrorRecoveryResource(workspaceFolder, canvas, VSBuffer.fromString('path: [unterminated'));
		const same = await baseHalfMirrorRecoveryResource(workspaceFolder, canvas, VSBuffer.fromString('path: [unterminated'));
		const other = await baseHalfMirrorRecoveryResource(workspaceFolder, canvas, VSBuffer.fromString('path: {unterminated'));

		assert.deepStrictEqual({
			first: /^\/work\/\.bh\/cache\/recovered\/mirror\/docs\/canvas\.[0-9a-f]{12}\.yaml$/.test(first.fsPath),
			same: same.fsPath === first.fsPath,
			other: other.fsPath === first.fsPath
		}, { first: true, same: true, other: false });
		await assert.rejects(() => baseHalfMirrorRecoveryResource(workspaceFolder, URI.file('/work/note.md'), VSBuffer.fromString('')));
	});
});
