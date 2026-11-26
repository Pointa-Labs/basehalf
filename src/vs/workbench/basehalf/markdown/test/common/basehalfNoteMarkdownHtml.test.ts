/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { removeMarkdownEscapes } from '../../../../../base/common/htmlContent.js';
import { Lexer, Marked, type Token, type Tokens } from '../../../../../base/common/marked/marked.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfNoteAddress } from '../../common/basehalfNoteInline.js';
import { baseHalfNoteMarkedExtension } from '../../common/basehalfNoteMarkdownHtml.js';
import { decodeBaseHalfSmallCharacterReferences } from '../../common/basehalfNoteMarkdownText.js';
import { baseHalfMarkdownShowsSame } from '../../common/basehalfNoteShown.js';

/** The links of Markdown as the card's lexer reads them, after the walk of `walkTokens`, if any. */
function linksOf(markdown: string, walkTokens?: (token: Token) => void): Tokens.Link[] {
	const tokens = new Lexer({ gfm: true, breaks: true }).lex(markdown);
	if (walkTokens) {
		new Marked().walkTokens(tokens, walkTokens);
	}
	const links: Tokens.Link[] = [];
	const visit = (list: readonly Token[]) => {
		for (const token of list) {
			if (token.type === 'link') {
				links.push(token as Tokens.Link);
			}
			const nested = (token as Tokens.Generic).tokens;
			if (Array.isArray(nested)) {
				visit(nested);
			}
		}
	};
	visit(tokens);
	return links;
}

/**
 * The address a page opens for a link the base renderer writes: it takes the
 * backslash escapes off the address again and writes every `&` as `&amp;`, and
 * the page decodes the attribute once.
 */
function addressOnTheCard(link: Tokens.Link): string {
	return decodeBaseHalfSmallCharacterReferences(removeMarkdownEscapes(link.href).replace(/&/g, '&amp;'));
}

suite('BaseHalfNoteMarkdownHtml', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('gives a Markdown link the address that Rich and the guard read, which the base renderer leaves as it is', () => {
		const extension = baseHalfNoteMarkedExtension();
		const rows: [string, string][] = [
			['[x](a&amp;b.md)', 'a&b.md'],
			['[x](a&b.md)', 'a&b.md'],
			['[API](https://example.com/api?id=1&amp;page=2)', 'https://example.com/api?id=1&page=2'],
			['[x](a\\\\_b.md)', 'a%5C_b.md'],
			['[x](<my file.md>)', 'my%20file.md'],
			['[x](a&amp;copy;b.md)', 'a%26copy;b.md'],
			['see https://example.com/a\\_b', 'https://example.com/a%5C_b']
		];
		for (const [markdown, address] of rows) {
			const [read] = linksOf(markdown);
			const [link] = linksOf(markdown, extension.walkTokens!);
			assert.strictEqual(link.href, address, markdown);
			// The guard reads the address so, and the card opens it so.
			assert.strictEqual(baseHalfNoteAddress(read.href), address, markdown);
			assert.strictEqual(addressOnTheCard(link), address, markdown);
		}
		// Two spellings of one address that the guard calls the same go to one address on the card too.
		assert.ok(baseHalfMarkdownShowsSame('[x](a&amp;b.md)', '[x](a&b.md)'));
		const [entity, plain] = ['[x](a&amp;b.md)', '[x](a&b.md)'].map(markdown => addressOnTheCard(linksOf(markdown, extension.walkTokens!)[0]));
		assert.strictEqual(entity, plain);
	});

	test('keeps the text of a bare address with a backslash as written, apart from its address', () => {
		// The base renderer takes the escapes off a link's text where the text is its address.
		const [link] = linksOf('see https://example.com/a\\_b', baseHalfNoteMarkedExtension().walkTokens!);
		assert.strictEqual(link.text, 'https://example.com/a\\_b');
		assert.notStrictEqual(link.href, link.text);
		// An address without escapes stays its own text.
		const [plain] = linksOf('see https://example.com/a_b', baseHalfNoteMarkedExtension().walkTokens!);
		assert.strictEqual(plain.href, plain.text);
	});

	test('decodes the address with the decoder it is given', () => {
		const decode = (value: string) => decodeBaseHalfSmallCharacterReferences(value).replace(/&copy;/g, '\u{00a9}');
		const [small] = linksOf('[x](a&copy;b.md)', baseHalfNoteMarkedExtension().walkTokens!);
		const [page] = linksOf('[x](a&copy;b.md)', baseHalfNoteMarkedExtension({ decodeCharacterReferences: decode }).walkTokens!);
		assert.deepStrictEqual([small.href, page.href], ['a%26copy;b.md', 'a\u{00a9}b.md']);
	});
});
