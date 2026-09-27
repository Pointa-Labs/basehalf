/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { extUriIgnorePathCase, extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	baseHalfAnalyzeUpstreamItems,
	baseHalfFormatUpstreamEntry,
	baseHalfNormalizeUpstreamEntry,
	baseHalfResolveFileRelativeUpstreamEntry,
	baseHalfUpstreamEntryGrammarProblem,
	baseHalfUpstreamEntryProblem,
	baseHalfUpstreamIdentity
} from '../../common/basehalfReferenceEntries.js';

suite('BaseHalfReferenceEntries', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('validates the path grammar per entry', () => {
		assert.deepStrictEqual(Object.fromEntries([
			'', '/', '/abs.md', 'a\\b.md', 'a\u0000b', 'a\u0007b', 'a//b', './a', 'a/../b', '..', '.',
			'.bh/mirror/x', '.BH/x', 'docs/.bh/x', 'docs/', 'docs//', 'why?.md', 'a:b*"<>|.md', '笔记/概念.md', '2024', 'x/y/z.md'
		].map(entry => [entry, baseHalfUpstreamEntryGrammarProblem(entry) ?? 'valid'])), {
			'': 'empty',
			'/': 'absolute',
			'/abs.md': 'absolute',
			'a\\b.md': 'backslash',
			'a\u0000b': 'controlCharacter',
			'a\u0007b': 'controlCharacter',
			'a//b': 'invalidSegment',
			'./a': 'invalidSegment',
			'a/../b': 'invalidSegment',
			'..': 'invalidSegment',
			'.': 'invalidSegment',
			'.bh/mirror/x': 'metadata',
			'.BH/x': 'metadata',
			'docs/.bh/x': 'valid',
			'docs/': 'valid',
			'docs//': 'invalidSegment',
			'why?.md': 'valid',
			'a:b*"<>|.md': 'valid',
			'笔记/概念.md': 'valid',
			'2024': 'valid',
			'x/y/z.md': 'valid'
		});
		assert.strictEqual(baseHalfNormalizeUpstreamEntry('docs/'), 'docs');
	});

	test('detects self entries with NFC and case-insensitive identity', () => {
		const folder = URI.file('/work');
		const insensitive = baseHalfUpstreamIdentity(folder, extUriIgnorePathCase);
		const sensitive = baseHalfUpstreamIdentity(folder, extUri);
		assert.strictEqual(baseHalfUpstreamEntryProblem('Notes/A.md', 'notes/a.md', insensitive), 'self');
		assert.strictEqual(baseHalfUpstreamEntryProblem('Notes/A.md', 'notes/a.md', sensitive), undefined);
		// NFD input compares equal to the NFC name on disk.
		assert.strictEqual(baseHalfUpstreamEntryProblem('cafe\u0301.md', 'caf\u00e9.md', sensitive), 'self');
		assert.strictEqual(baseHalfUpstreamEntryProblem('docs/', 'docs', sensitive), 'self');
	});

	test('keeps valid entries valid next to invalid, duplicate, and over-limit items', () => {
		const items = baseHalfAnalyzeUpstreamItems([
			{ text: 'a.md', scalar: true },
			{ text: '~', scalar: false },
			{ text: 'A.md', scalar: true },
			{ text: 'docs/', scalar: true },
			{ text: 'docs', scalar: true },
			{ text: '{a: b}', scalar: false },
			{ text: 'b.md', scalar: true }
		], 'self.md', baseHalfUpstreamIdentity(URI.file('/work'), extUriIgnorePathCase), { maxEntries: 6 });
		assert.deepStrictEqual(items.map(item => [item.text, item.path ?? null, item.problem ?? null]), [
			['a.md', 'a.md', null],
			['~', null, 'empty'],
			['A.md', null, 'duplicate'],
			['docs/', 'docs', null],
			['docs', null, 'duplicate'],
			['{a: b}', null, 'notScalar'],
			['b.md', null, 'overLimit']
		]);
	});

	test('quotes typed YAML forms, indicators, and separators, and writes other entries plain', () => {
		const cases = [
			'2024', 'true', 'null', 'a, b', 'why?.md', 'yes', 'off', '~', '01', '0x1F', '1e3', '.inf', '2024-01-01',
			'-a.md', '#tag.md', 'a: b', 'a #b', 'a#b', '[x]', 'x]', '{x}', '"q"', 'it\'s.md', 'tab\there', 'end:', ' lead', 'trail ',
			'docs', 'notes/a.md', '2024.md', '.github/x.md', '笔记.md', 'a:b.md', 'Null', 'NO', '<<', '1_000', '12:30'
		];
		assert.deepStrictEqual(Object.fromEntries(cases.map(entry => [entry, baseHalfFormatUpstreamEntry(entry)])), {
			'2024': '"2024"',
			'true': '"true"',
			'null': '"null"',
			'a, b': '"a, b"',
			'why?.md': 'why?.md',
			'yes': '"yes"',
			'off': '"off"',
			'~': '"~"',
			'01': '"01"',
			'0x1F': '"0x1F"',
			'1e3': '"1e3"',
			'.inf': '".inf"',
			'2024-01-01': '"2024-01-01"',
			'-a.md': '"-a.md"',
			'#tag.md': '"#tag.md"',
			'a: b': '"a: b"',
			'a #b': '"a #b"',
			'a#b': 'a#b',
			'[x]': '"[x]"',
			'x]': '"x]"',
			'{x}': '"{x}"',
			'"q"': '"\\"q\\""',
			'it\'s.md': '"it\'s.md"',
			'tab\there': '"tab\\there"',
			'end:': '"end:"',
			' lead': '" lead"',
			'trail ': '"trail "',
			'docs': 'docs',
			'notes/a.md': 'notes/a.md',
			'2024.md': '2024.md',
			'.github/x.md': '.github/x.md',
			'笔记.md': '笔记.md',
			'a:b.md': 'a:b.md',
			'Null': '"Null"',
			'NO': '"NO"',
			'<<': '"<<"',
			'1_000': '"1_000"',
			'12:30': '"12:30"'
		});
	});

	test('reads an entry relative to the downstream file for "Use workspace path"', () => {
		assert.deepStrictEqual([
			baseHalfResolveFileRelativeUpstreamEntry('../overview.md', 'a/b/note.md'),
			baseHalfResolveFileRelativeUpstreamEntry('./x.md', 'a/b/note.md'),
			baseHalfResolveFileRelativeUpstreamEntry('sub\\x.md', 'a/note.md'),
			baseHalfResolveFileRelativeUpstreamEntry('../../../x.md', 'a/b/note.md'),
			baseHalfResolveFileRelativeUpstreamEntry('..', 'a/note.md'),
			baseHalfResolveFileRelativeUpstreamEntry('/abs.md', 'a/note.md'),
			baseHalfResolveFileRelativeUpstreamEntry('../.bh/x', 'a/note.md')
		], ['a/overview.md', 'a/b/x.md', 'a/sub/x.md', undefined, undefined, undefined, undefined]);
	});
});
