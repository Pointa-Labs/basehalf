/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Lexer, type Token, type Tokens } from '../../../../../base/common/marked/marked.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfHeadingSlug,
	baseHalfMarkdownDestination,
	baseHalfMarkdownPathHref,
	decodeBaseHalfSmallCharacterReferences,
	escapeBaseHalfHtmlAttribute,
	escapeBaseHalfHtmlText,
	escapeBaseHalfMarkdownText,
	IBaseHalfMarkdownTextContext
} from '../../common/basehalfNoteMarkdownText.js';

// The card reads a note with these options.
const cardOptions = { gfm: true, breaks: true };

/** What a page shows of inline tokens: their characters, a break as a line break, and any other markup named, so that an assertion shows it. */
function shownText(tokens: readonly Token[]): string {
	let text = '';
	for (const token of tokens) {
		if (token.type === 'text') {
			const nested = (token as Tokens.Text).tokens;
			text += nested ? shownText(nested) : decodeBaseHalfSmallCharacterReferences((token as Tokens.Text).text);
		} else if (token.type === 'escape') {
			text += decodeBaseHalfSmallCharacterReferences((token as Tokens.Escape).text);
		} else if (token.type === 'br' || (token.type === 'html' && token.raw === '<br>')) {
			text += '\n';
		} else {
			text += `{${token.type} ${token.raw}}`;
		}
	}
	return text;
}

function blocksOf(markdown: string): Token[] {
	return Lexer.lex(markdown, cardOptions).filter(token => token.type !== 'space');
}

/** The text one block of the card shows for `markdown`, or the kinds of blocks it reads instead. */
function shownBlock(markdown: string, type: string): string {
	const blocks = blocksOf(markdown);
	return blocks.length === 1 && blocks[0].type === type ? shownText((blocks[0] as Tokens.Paragraph | Tokens.Heading).tokens) : `{blocks ${blocks.map(block => block.type).join(' ')}}`;
}

const readers: Record<string, (markdown: string) => string> = {
	paragraph: markdown => shownBlock(markdown, 'paragraph'),
	heading: markdown => shownBlock(`## ${markdown}`, 'heading'),
	tableCell: markdown => {
		const blocks = blocksOf(`| h |\n| --- |\n| ${markdown} |`);
		const table = blocks[0] as Tokens.Table;
		return blocks.length === 1 && table.type === 'table' && table.rows.length === 1 && table.rows[0].length === 1 ? shownText(table.rows[0][0].tokens) : `{blocks ${blocks.map(block => block.type).join(' ')}}`;
	},
	link: markdown => {
		const blocks = blocksOf(`[${markdown}](u)`);
		const inline = blocks.length === 1 ? (blocks[0] as Tokens.Paragraph).tokens : [];
		const link = inline[0] as Tokens.Link | undefined;
		return inline.length === 1 && link?.type === 'link' && link.href === 'u' ? shownText(link.tokens) : `{not one link: ${markdown}}`;
	},
	listItem: markdown => {
		const blocks = blocksOf(`- ${markdown.replace(/\n/g, '\n  ')}`);
		const list = blocks[0] as Tokens.List;
		const item = list?.type === 'list' && list.items.length === 1 && !list.items[0].task ? list.items[0].tokens.filter(token => token.type !== 'space') : [];
		return blocks.length === 1 && item.length === 1 ? shownText((item[0] as Tokens.Text).tokens ?? []) : `{blocks ${blocks.map(block => block.type).join(' ')}}`;
	},
	quote: markdown => {
		const blocks = blocksOf(markdown.split('\n').map(line => `> ${line}`).join('\n'));
		const inner = blocks.length === 1 && blocks[0].type === 'blockquote' ? (blocks[0] as Tokens.Blockquote).tokens.filter(token => token.type !== 'space') : [];
		return inner.length === 1 && inner[0].type === 'paragraph' ? shownText((inner[0] as Tokens.Paragraph).tokens) : `{blocks ${blocks.map(block => block.type).join(' ')}}`;
	}
};

const referenceDefinitions = '\n\n[docs]: https://example.com/docs\n[my note]: my%20note.md\n[^1]: footnote.md';
const referenceLabels: ReadonlySet<string> = new Set(['docs', 'my note', '^1']);

interface IEscapeCase {
	readonly text: string;
	readonly written: string;
	readonly context?: IBaseHalfMarkdownTextContext;
	/** Markdown written after the text, which must read as itself. */
	readonly then?: string;
}

/** Checks the written form of each case, and that the card reads it back as the text. */
function assertEscapes(cases: readonly IEscapeCase[]): void {
	for (const { text, written, context, then } of cases) {
		assert.strictEqual(escapeBaseHalfMarkdownText(text, context), written, JSON.stringify(text));
		const block = context?.inLink ? 'link' : context?.block ?? 'paragraph';
		if (then !== undefined) {
			const tokens = (blocksOf(written + then)[0] as Tokens.Paragraph).tokens;
			const markup = tokens.pop();
			assert.deepStrictEqual([shownText(tokens), markup?.raw], [text, then], JSON.stringify(text));
		} else if (context?.referenceLabels) {
			assert.strictEqual(shownBlock(written + referenceDefinitions, 'paragraph'), text, JSON.stringify(text));
		} else {
			assert.strictEqual(readers[context?.listItemStart ? 'listItem' : block](written), text, JSON.stringify(text));
		}
	}
}

/** A seeded sequence of numbers in [0, 1), so that every run tests the same strings. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
}

function seededStrings(seed: number, count: number, pieces: readonly string[], length: number): string[] {
	const random = seededRandom(seed);
	return Array.from({ length: count }, () => {
		let text = '';
		const size = 1 + Math.floor(random() * length);
		for (let index = 0; index < size; index++) {
			text += pieces[Math.floor(random() * pieces.length)];
		}
		return text;
	});
}

suite('BaseHalfNoteMarkdownText', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('escapeBaseHalfMarkdownText', () => {
		test('writes typed text as the design\'s tables store it', () => {
			assertEscapes([
				{ text: '*not italic* and <u>x</u> & &amp; 2 * 3 snake_case [a](b)', written: '\\*not italic\\* and &lt;u>x&lt;/u> & &amp;amp; 2 \\* 3 snake_case \\[a\\](b)' },
				{ text: '# not a heading\n1. not a list\n- not a bullet\n---', written: '\\# not a heading\\\n1\\. not a list\\\n\\- not a bullet\\\n\\---' },
				{ text: 'see [[My Note]] here, Text[^1] and [!NOTE]', written: 'see [[My Note]] here, Text[^1] and [!NOTE]' },
				{ text: 'see https://example.com and www.example.com or me@example.com', written: 'see https&#58;//example.com and www&#46;example.com or me&#64;example.com' },
				{ text: 'a\n===', written: 'a\\\n\\===' },
				{ text: 'C#', written: 'C\\#', context: { block: 'heading', lineStart: false } },
				{ text: 'a\nb', written: 'a<br>b', context: { block: 'heading', lineStart: false } },
				{ text: 'x | y', written: 'x \\| y', context: { block: 'tableCell', lineStart: false } },
				{ text: 'one\ntwo', written: 'one<br>two', context: { block: 'tableCell', lineStart: false } },
				{ text: 'see [docs] and [the docs]', written: 'see \\[docs\\] and [the docs]', context: { referenceLabels } }
			]);
		});

		test('escapes a heading, a quote, a list, a rule, an underline, and a table row at the start of a line, and only there', () => {
			assertEscapes([
				{ text: '# x', written: '\\# x' },
				{ text: '###### x', written: '\\###### x' },
				{ text: '####### x', written: '####### x' },
				{ text: '#x', written: '#x' },
				{ text: '#', written: '\\#' },
				{ text: '#\tx', written: '\\#\tx' },
				{ text: '> x', written: '\\> x' },
				{ text: '>x', written: '\\>x' },
				{ text: '- x', written: '\\- x' },
				{ text: '+ x', written: '\\+ x' },
				{ text: '* x', written: '\\* x' },
				{ text: '-', written: '\\-' },
				{ text: '+', written: '\\+' },
				{ text: '*', written: '\\*' },
				{ text: '-x and +y', written: '-x and +y' },
				{ text: '1. x', written: '1\\. x' },
				{ text: '2) x', written: '2\\) x' },
				{ text: '10.', written: '10\\.' },
				{ text: '1.5 kg', written: '1.5 kg' },
				{ text: '1234567890. x', written: '1234567890. x' },
				{ text: '---', written: '\\---' },
				{ text: '- - -', written: '\\- - -' },
				{ text: 'a\n--', written: 'a\\\n\\--' },
				{ text: 'a\n-- -', written: 'a\\\n\\-- -' },
				{ text: '===', written: '\\===' },
				{ text: 'a\n=', written: 'a\\\n\\=' },
				{ text: '= =', written: '= =' },
				{ text: 'a | b\n--- | ---', written: 'a | b\\\n\\--- | ---' },
				{ text: 'a\n:-:', written: 'a\\\n\\:-:' },
				{ text: 'a\n|---|', written: 'a\\\n\\|---|' },
				{ text: 'a # b, a > b, a - b, a 1. b, a === b', written: 'a # b, a > b, a - b, a 1. b, a === b' },
				{ text: 'a\n# b', written: 'a\\\n\\# b' },
				{ text: 'a\n  # b', written: 'a\\\n  \\# b' }
			]);
			// A text in the middle of a line starts none; its lines after a break do.
			assert.deepStrictEqual([
				escapeBaseHalfMarkdownText('# x', { lineStart: false }),
				escapeBaseHalfMarkdownText('a\n# x', { lineStart: false }),
				escapeBaseHalfMarkdownText('# x', { block: 'heading', lineStart: false }),
				escapeBaseHalfMarkdownText('> x', { block: 'tableCell', lineStart: false })
			], ['# x', 'a\\\n\\# x', '# x', '> x']);
			// A line that goes on with markup after the text is no rule, heading, or list item.
			assert.deepStrictEqual(['#', '-', '1.', '---', '==='].map(text => escapeBaseHalfMarkdownText(text, { after: '*' })), ['#', '-', '1.', '---', '===']);
		});

		test('escapes the first [ ] or [x] of a list item\'s text, which would read as a check box', () => {
			assertEscapes([
				{ text: '[ ] x', written: '\\[ ] x', context: { listItemStart: true } },
				{ text: '[x] y', written: '\\[x] y', context: { listItemStart: true } },
				{ text: '[X] y', written: '\\[X] y', context: { listItemStart: true } },
				{ text: '[y] z', written: '[y] z', context: { listItemStart: true } },
				{ text: '1. [ ] x', written: '1\\. [ ] x', context: { listItemStart: true } }
			]);
			assert.strictEqual(escapeBaseHalfMarkdownText('[ ] x'), '[ ] x');
		});

		test('escapes *, _, ~, and a backtick where they could pair into markup', () => {
			assertEscapes([
				{ text: '2 * 3', written: '2 * 3' },
				{ text: '2 * 3 * 4', written: '2 \\* 3 \\* 4' },
				{ text: '2 * 3', written: '2 \\* 3', context: { blockDelimiters: '*' } },
				{ text: '2 * 3', written: '2 \\* 3', context: { blockText: '2 * 3 and 4 * 5' } },
				{ text: 'snake_case', written: 'snake_case' },
				{ text: 'a_b_c', written: 'a_b_c' },
				{ text: '_x_', written: '\\_x\\_' },
				{ text: '__init__', written: '\\_\\_init\\_\\_' },
				{ text: '中_文_字', written: '中_文_字' },
				{ text: '_a 中_,', written: '\\_a 中\\_,' },
				{ text: 'a_b_', written: 'a_b\\_' },
				{ text: '~', written: '~' },
				{ text: '~x~', written: '\\~x\\~' },
				{ text: 'a ~ b', written: 'a \\~ b', context: { blockDelimiters: '~' } },
				{ text: 'a ` b', written: 'a ` b' },
				{ text: '`x`', written: '\\`x\\`' },
				{ text: 'a ` b', written: 'a \\` b', context: { blockDelimiters: '`' } }
			]);
		});

		test('escapes < and & only where a page would read a tag, an address, or a reference', () => {
			assertEscapes([
				{ text: 'a<b', written: 'a&lt;b' },
				{ text: 'a < b and <3', written: 'a < b and <3' },
				{ text: 'a</b', written: 'a&lt;/b' },
				{ text: '<!-- c -->', written: '&lt;!-- c -->' },
				{ text: '<?php', written: '&lt;?php' },
				{ text: '<div is here', written: '&lt;div is here' },
				{ text: 'use List<String> here', written: 'use List&lt;String> here' },
				{ text: '<1@x.io>', written: '&lt;1&#64;x.io>' },
				{ text: '<#@x.io>', written: '&lt;#@x.io>' },
				{ text: '&copy; &#58; &#x41;', written: '&amp;copy; &amp;#58; &amp;#x41;' },
				{ text: '& co, &copy 2024, R&D, &a_b;', written: '& co, &copy 2024, R&D, &a_b;' },
				{ text: '&amp;amp;', written: '&amp;amp;amp;' }
			]);
		});

		test('escapes an address that the card would link, outside links', () => {
			assertEscapes([
				{ text: 'xhttps://a.b', written: 'xhttps&#58;//a.b' },
				{ text: 'HTTPS://x.y', written: 'HTTPS&#58;//x.y' },
				{ text: 'ftp://h', written: 'ftp&#58;//h' },
				{ text: 'see https:// and https:/x', written: 'see https:// and https:/x' },
				{ text: 'awww.b.c', written: 'awww&#46;b.c' },
				{ text: 'WWW.x.y', written: 'WWW&#46;x.y' },
				{ text: 'www.-', written: 'www&#46;-' },
				{ text: 'go to www.', written: 'go to www.' },
				{ text: 'a!b@c.io', written: 'a!b&#64;c.io' },
				{ text: 'me@host.1 and me@a_b.com', written: 'me&#64;host.1 and me&#64;a_b.com' },
				{ text: '@home, a@b, a @b.c', written: '@home, a@b, a @b.c' },
				{ text: 'see https://example.com or me@example.com', written: 'see https://example.com or me@example.com', context: { inLink: true, lineStart: false } }
			]);
		});

		test('escapes a bracket pair that would form a link, and leaves the others as typed', () => {
			assertEscapes([
				{ text: '[a][b]', written: '\\[a\\][b]' },
				{ text: '[x]: y', written: '\\[x\\]: y' },
				{ text: '![x](y)', written: '!\\[x\\](y)' },
				{ text: '![x] and [a [b] c](d)', written: '![x] and \\[a [b] c\\](d)' },
				{ text: '[[My Note]], Text[^1], [!NOTE], [DOCS]', written: '[\\[My Note\\]], Text\\[^1\\], [!NOTE], \\[DOCS\\]', context: { referenceLabels } },
				{ text: '[ docs ] and [my\tnote]', written: '[ docs ] and \\[my\tnote\\]', context: { referenceLabels } },
				{ text: 'x]', written: 'x\\]', then: '[y](z)', context: { after: '[' } },
				{ text: '!', written: '\\!', then: '[y](z)', context: { after: '[' } },
				{ text: 'a!', written: 'a\\!', then: '[y](z)', context: { after: '[' } }
			]);
		});

		test('writes a link\'s label so that it stays one link: brackets as references, every backtick escaped, a break as <br>', () => {
			assertEscapes([
				{ text: 'a [b] c', written: 'a &#91;b&#93; c', context: { inLink: true, lineStart: false } },
				{ text: '[a](b)', written: '&#91;a&#93;(b)', context: { inLink: true, lineStart: false } },
				{ text: 'a ` b', written: 'a \\` b', context: { inLink: true, lineStart: false } },
				{ text: 'a\nb', written: 'a<br>b', context: { inLink: true, lineStart: false } },
				{ text: '*x* and # y', written: '\\*x\\* and # y', context: { inLink: true, lineStart: false } },
				{ text: 'end\\', written: 'end\\\\', context: { inLink: true, lineStart: false, after: ']' } }
			]);
		});

		test('doubles a backslash before punctuation, a symbol, or the end of a line', () => {
			assertEscapes([
				{ text: 'a\\b and \\é and \\中', written: 'a\\b and \\é and \\中' },
				{ text: 'a\\*', written: 'a\\\\*' },
				{ text: 'a\\', written: 'a\\\\' },
				{ text: '\\\\', written: '\\\\\\\\' },
				{ text: 'a\\\u00a0b', written: 'a\\\\&nbsp;b' },
				{ text: '\\😀 and \\，', written: '\\\\😀 and \\\\，' },
				{ text: 'a\\\nb', written: 'a\\\\\\\nb' },
				{ text: 'a\\', written: 'a\\\\', then: '**b**', context: { after: '*', blockDelimiters: '*' } }
			]);
			// Before a letter written after the text, a backslash is one.
			assert.strictEqual(escapeBaseHalfMarkdownText('a\\', { after: 'h' }), 'a\\');
			assert.strictEqual(readers.paragraph('a\\https://x.y'), 'a\\{link https://x.y}');
			// After an emoji, a single backslash would shift what `marked` reads of emphasis written before it.
			const text = escapeBaseHalfMarkdownText('\\😀', { before: '*', lineStart: false, blockDelimiters: '*' });
			const tokens = (blocksOf(`**b**${text}`)[0] as Tokens.Paragraph).tokens;
			assert.deepStrictEqual([tokens[0].raw, shownText(tokens.slice(1))], ['**b**', '\\😀']);
		});

		test('writes characters that the reader would take for line endings, and a no-break space, as references', () => {
			assertEscapes([
				{ text: 'a\u00a0b', written: 'a&nbsp;b' },
				{ text: 'a\rb', written: 'a&#13;b' },
				{ text: 'a\u2028b\u2029c', written: 'a&#8232;b&#8233;c' },
				{ text: 'a\u2028b', written: 'a&#8232;b', context: { block: 'heading', lineStart: false } },
				{ text: '#\u00a0x', written: '#&nbsp;x' }
			]);
		});

		test('writes white space that ends the text where the line ends as a reference, which the reader does not trim', () => {
			assertEscapes([
				{ text: 'a\u3000', written: 'a&#12288;' },
				{ text: 'a\u3000\u3000', written: 'a\u3000&#12288;' },
				{ text: 'a\n\u3000', written: 'a\\\n&#12288;' },
				{ text: 'a\n\u2003\u2003', written: 'a\\\n\u2003&#8195;' },
				{ text: 'a\u1680', written: 'a&#5760;' },
				{ text: 'a\ufeff', written: 'a&#65279;' }
			]);
			// Where the text goes on with something on its line, the space stays as typed.
			assert.strictEqual(escapeBaseHalfMarkdownText('a\u3000', { after: '*', blockDelimiters: '*' }), 'a\u3000');
			assert.strictEqual(escapeBaseHalfMarkdownText('a\u3000b'), 'a\u3000b');
		});

		test('keeps a heading\'s final # out of its closing sequence', () => {
			assertEscapes([
				{ text: 'x #', written: 'x \\#', context: { block: 'heading', lineStart: false } },
				{ text: '##', written: '#\\#', context: { block: 'heading', lineStart: false } },
				{ text: 'a ##', written: 'a #\\#', context: { block: 'heading', lineStart: false } }
			]);
			assert.strictEqual(escapeBaseHalfMarkdownText('C#', { block: 'heading', lineStart: false, after: '*' }), 'C#');
		});

		test('escapes a last ~ or backtick before a code span or a strikethrough written after it', () => {
			assertEscapes([
				{ text: 'x~', written: 'x\\~', then: '`c`', context: { after: '`', blockDelimiters: '`' } },
				{ text: 'x`', written: 'x\\`', then: '~~s~~', context: { after: '~', blockDelimiters: '~' } }
			]);
		});

		test('escapes every Markdown character in the form of last resort', () => {
			assertEscapes([
				{ text: 'a.b-c (d) [e] #f +g !h ~i |j >k \\l {m} _n *o `p', written: 'a\\.b\\-c \\(d\\) \\[e\\] \\#f \\+g \\!h \\~i \\|j \\>k \\\\l \\{m\\} \\_n \\*o \\`p', context: { escapeAll: true } },
				{ text: '<u> & https://x.y', written: '&lt;u\\> & https&#58;//x\\.y', context: { escapeAll: true } }
			]);
		});

		test('writes seeded text that every block, a link, and text beside markup read back as the text', () => {
			const pieces = [
				'a', 'word', 'Z9', '中文', '，', '😀', 'é', 'e\u0301', ' ', ' ', '\t', '\u00a0', '\u3000', '\n', '*', '**', '_', '__', '~', '~~', '`', '```', '[', ']', '(', ')',
				'[x]', '[ ]', '![', '!', '<', '>', '&', '&amp;', '&copy;', '&#58;', '\\', '\\\\', '#', '##', '-', '---', '+', '=', '===', '|', ':', ':-:', '.', '1.', '2)',
				'@', 'https://', 'http://x.y', 'www.', 'www.ex.com', 'me@ex.com', 'a!b@c.io', 'a_b', '<u>', '</u>', '<br>', '<!--', '<?', '<div', '<1@x.io>', '<https://x.y>',
				'[[My Note]]', '[^1]', '[!NOTE]', '[docs]', '[a](b)', '{', '}', '"', '\'', '\u2028', '\r', 'HTTPS://ex.com', 'WWW.ex.com', '_x_', '*x*', '`c`', '~s~', '\\*', '&nbsp;'
			];
			// What Markdown cannot hold, white space at a line's start and at the block's ends, is dropped first.
			const texts = seededStrings(110, 600, pieces, 12)
				.map(text => text.split('\n').map(line => line.replace(/^[ \t]+/, '')).join('\n').replace(/^\s+|\s+$/g, ''))
				.filter(text => text.length > 0);
			const contexts: [string, IBaseHalfMarkdownTextContext, (written: string) => string][] = [
				['paragraph', {}, readers.paragraph],
				['heading', { block: 'heading', lineStart: false }, readers.heading],
				['tableCell', { block: 'tableCell', lineStart: false }, readers.tableCell],
				['link', { inLink: true, lineStart: false, after: ']' }, readers.link],
				['listItem', { listItemStart: true }, readers.listItem],
				['quote', {}, readers.quote],
				['escapeAll', { escapeAll: true }, readers.paragraph],
				['labels', { referenceLabels }, written => shownBlock(written + referenceDefinitions, 'paragraph')],
				['before strong', { before: '*', lineStart: false, blockDelimiters: '*' }, written => {
					const tokens = (blocksOf(`**b**${written}`)[0] as Tokens.Paragraph).tokens;
					return tokens[0].raw === '**b**' ? shownText(tokens.slice(1)) : `{${tokens[0].raw}}`;
				}],
				['before a link', { after: '[' }, written => {
					const tokens = (blocksOf(`${written}[y](z)`)[0] as Tokens.Paragraph).tokens;
					return tokens[tokens.length - 1].raw === '[y](z)' ? shownText(tokens.slice(0, -1)) : `{${tokens[tokens.length - 1].raw}}`;
				}],
				['before a code span', { after: '`', blockDelimiters: '`' }, written => {
					const tokens = (blocksOf(`${written}\`c\``)[0] as Tokens.Paragraph).tokens;
					return tokens[tokens.length - 1].raw === '`c`' ? shownText(tokens.slice(0, -1)) : `{${tokens[tokens.length - 1].raw}}`;
				}]
			];
			for (const [name, context, read] of contexts) {
				for (const text of texts) {
					// A heading and a cell drop the white space at their ends.
					const input = name === 'heading' || name === 'tableCell' || name === 'before strong' ? text.trim() : text;
					if (input) {
						assert.strictEqual(read(escapeBaseHalfMarkdownText(input, context)), input, `${name} ${JSON.stringify(input)}`);
					}
				}
			}
		});
	});

	suite('escapeBaseHalfHtmlText and escapeBaseHalfHtmlAttribute', () => {
		test('escape the characters that would act in HTML, and nothing else', () => {
			assert.deepStrictEqual([
				escapeBaseHalfHtmlText('Salt & Pepper <3'),
				escapeBaseHalfHtmlText('Use &lt;br&gt; here'),
				escapeBaseHalfHtmlText('a\nb\u00a0c\rd'),
				escapeBaseHalfHtmlText('see https://example.com, *x* [a](b) # h "q" \'s\''),
				escapeBaseHalfHtmlAttribute('a "b" <c> & d'),
				escapeBaseHalfHtmlAttribute('a\nb\r'),
				escapeBaseHalfHtmlAttribute('chart.png?v=2&times=3')
			], [
				'Salt &amp; Pepper &lt;3',
				'Use &amp;lt;br&amp;gt; here',
				'a<br>b&nbsp;c&#13;d',
				'see https://example.com, *x* [a](b) # h "q" \'s\'',
				'a &quot;b&quot; &lt;c&gt; &amp; d',
				'a&#10;b&#13;',
				'chart.png?v=2&amp;times=3'
			]);
		});

		test('read back in a toggle\'s title, a caption, and an attribute, each in one block of HTML', () => {
			const pieces = ['a', ' ', '中文', '&', '&amp;', '&lt;br&gt;', '<', '>', '<br>', '</summary>', '</figcaption>', '"', '\'', '\n', '\n\n', '\r', '\u00a0', '*x*', '# h', '[a](b)', 'https://x.y', '`', '\\'];
			for (const text of seededStrings(120, 300, pieces, 10)) {
				const title = blocksOf(`<details>\n<summary>${escapeBaseHalfHtmlText(text)}</summary>\n</details>`);
				const figure = blocksOf(`<figure><img alt="${escapeBaseHalfHtmlAttribute(text)}" src="a.png"><figcaption>${escapeBaseHalfHtmlText(text)}</figcaption></figure>`);
				assert.deepStrictEqual([title.map(block => block.type), figure.map(block => block.type)], [['html'], ['html']], JSON.stringify(text));
				const inner = (raw: string, pattern: RegExp) => decodeBaseHalfSmallCharacterReferences((pattern.exec(raw)?.[1] ?? '').replace(/<br>/g, '\n'));
				assert.deepStrictEqual([
					inner(title[0].raw, /<summary>([\s\S]*)<\/summary>/),
					inner(figure[0].raw, /<figcaption>([\s\S]*)<\/figcaption>/),
					decodeBaseHalfSmallCharacterReferences(/alt="([^"]*)"/.exec(figure[0].raw)?.[1] ?? '')
				], [text, text, text], JSON.stringify(text));
			}
		});
	});

	suite('baseHalfMarkdownDestination', () => {
		test('encodes what a destination cannot hold, and keeps letters of any script, #, ?, and balanced parentheses', () => {
			const cases: [string, string][] = [
				['my note.md', 'my%20note.md'],
				['my%20note.md', 'my%20note.md'],
				['a b(c.md', 'a%20b%28c.md'],
				['100%.md', '100%25.md'],
				['Foo_(bar)', 'Foo_(bar)'],
				['https://example.com/wiki/Foo_(bar)', 'https://example.com/wiki/Foo_(bar)'],
				['笔记/文件.md', '笔记/文件.md'],
				['other.md#part-two', 'other.md#part-two'],
				['https://example.com/api?id=1&param=2', 'https://example.com/api?id=1&param=2'],
				['%E4%B8%AD.md', '%E4%B8%AD.md'],
				['a<b>c\\d', 'a%3Cb%3Ec%5Cd'],
				[')(', '%29%28'],
				['(()', '%28()'],
				['%zz and %2', '%25zz%20and%20%252'],
				['a\tb\nc', 'a%09b%0Ac'],
				['a\u00a0b\u3000c\u0085d\u007fe', 'a%C2%A0b%E3%80%80c%C2%85d%7Fe']
			];
			assert.deepStrictEqual(cases.map(([href]) => baseHalfMarkdownDestination(href)), cases.map(([, written]) => written));
		});

		test('encodes an & that a page would decode as a character reference', () => {
			const cases: [string, string][] = [
				['a&amp;b', 'a%26amp;b'],
				['a&#38x', 'a%26#38x'],
				['a&#x26;', 'a%26#x26;'],
				['a&copy/', 'a%26copy/'],
				['?a=1&not', '?a=1%26not'],
				['a&b;c', 'a%26b;c'],
				['a&copyx', 'a&copyx'],
				['?a=1&not=2&amplitude=3', '?a=1&not=2&amplitude=3'],
				['R&D.md', 'R&D.md'],
				['a&#b', 'a&#b']
			];
			assert.deepStrictEqual(cases.map(([href]) => baseHalfMarkdownDestination(href)), cases.map(([, written]) => written));
		});

		test('is idempotent, and the card reads the destination as the whole address of the link', () => {
			const pieces = ['a', 'b.md', '笔记', ' ', '\t', '\u00a0', '\u3000', '(', ')', '((', '))', '[', ']', '<', '>', '\\', '%', '%20', '%2', '%E4%B8%AD', '#', '?', '&', '&amp;', '&amp', '&copy/', '&#38', '&lt', '"', '\'', '`', '*', '_', '!', '@', ':', '/', '..', 'https://x.y/', 'a=1&b=2', '😀'];
			for (const href of seededStrings(130, 200, pieces, 8)) {
				const written = baseHalfMarkdownDestination(href);
				assert.strictEqual(baseHalfMarkdownDestination(written), written, JSON.stringify(href));
				const inline = (blocksOf(`[x](${written})`)[0] as Tokens.Paragraph).tokens;
				assert.deepStrictEqual(inline.map(token => [token.type, (token as Tokens.Link).href]), [['link', written]], JSON.stringify(href));
			}
		});
	});

	suite('baseHalfMarkdownPathHref', () => {
		test('encodes every ASCII character but letters, digits, and -._~, and keeps letters of any script, in NFC', () => {
			const cases: [string, string][] = [
				['lecture #1.pdf', 'lecture%20%231.pdf'],
				['docs/lecture #1.pdf', 'docs/lecture%20%231.pdf'],
				['my file.md', 'my%20file.md'],
				['笔记/会议 记录.md', '笔记/会议%20记录.md'],
				['a(b).md', 'a%28b%29.md'],
				['../x y.md', '../x%20y.md'],
				['./a.md', './a.md'],
				['/abs/a b.md', '/abs/a%20b.md'],
				['a:b.md', 'a%3Ab.md'],
				['R&D.md', 'R%26D.md'],
				['100%.md', '100%25.md'],
				['[x].md', '%5Bx%5D.md'],
				['a?b#c.md', 'a%3Fb%23c.md'],
				['.bh/attachments/n/x y.pdf', '.bh/attachments/n/x%20y.pdf'],
				['a\u3000b.md', 'a%E3%80%80b.md'],
				['naïve café.md', 'naïve%20café.md'],
				['a\'b!c$d*e+f,g;h=i@j~k-l_m.md', 'a%27b%21c%24d%2Ae%2Bf%2Cg%3Bh%3Di%40j~k-l_m.md'],
				['e\u0301tude.md', '\u00e9tude.md'],
				['a\u200bb\u202ec.md', 'a%E2%80%8Bb%E2%80%AEc.md'],
				['报告 v2.pdf', '报告%20v2.pdf']
			];
			assert.deepStrictEqual(cases.map(([path]) => baseHalfMarkdownPathHref(path)), cases.map(([, written]) => written));
		});

		test('reads back as the path once decoded, needs no further encoding, and the card reads it whole', () => {
			const pieces = ['a', 'b.md', '笔记', '会议 记录', ' ', '#', '?', '%', '%20', '&', '&copy;', '(', ')', '[', ']', '<', '>', '\\', '"', '`', '{', '}', '|', '^', ':', ';', '=', '@', '+', ',', '\'', '!', '$', '*', '~', '/', '..', '.', '\u00a0', '\u3000', '\t', '😀', 'é'];
			for (const path of seededStrings(140, 200, pieces, 8)) {
				const href = baseHalfMarkdownPathHref(path);
				assert.strictEqual(href.split('/').map(segment => decodeURIComponent(segment)).join('/'), path, JSON.stringify(path));
				assert.strictEqual(baseHalfMarkdownDestination(href), href, JSON.stringify(path));
				const inline = (blocksOf(`[x](${href})`)[0] as Tokens.Paragraph).tokens;
				assert.deepStrictEqual(inline.map(token => [token.type, (token as Tokens.Link).href]), [['link', href]], JSON.stringify(path));
			}
		});
	});

	suite('baseHalfHeadingSlug', () => {
		test('slugs a heading\'s text, and numbers a slug that comes again', () => {
			const seen = new Map<string, number>();
			assert.deepStrictEqual([
				'Setup', 'Set up!', '中文 标题', 'Setup', 'Setup', 'Setup-1', 'A & B, C++', 'snake_case and-dash', 'Ünïcödé Ж', 'e\u0301tude', '🚀 Launch', 'Step 1: Install', '!!!', '!!!'
			].map(text => baseHalfHeadingSlug(text, seen)), [
				'setup', 'set-up', '中文-标题', 'setup-1', 'setup-2', 'setup-1-1', 'a--b-c', 'snake_case-and-dash', 'ünïcödé-ж', 'e\u0301tude', '-launch', 'step-1-install', '', '-1'
			]);
		});
	});

	suite('decodeBaseHalfSmallCharacterReferences', () => {
		test('decodes numeric references as a page does, and the small set of named ones, once', () => {
			assert.deepStrictEqual([
				'&amp;amp;', '&#58;', '&#x41;&#X41;&#65', '&#0;', '&#xD800;', '&#x110000;', '&#99999999999;', '&#128;&#150;&#x9F;', '&#x81;', '&#13;', '&#x1F600;',
				'&nbsp;', '&apos;&quot;&#39;', '&lt;&gt;', '&AMP;&LT;&GT;&QUOT;', '&APOS;', '&copy;', '&amp', '&#;&#x;'
			].map(decodeBaseHalfSmallCharacterReferences), [
				'&amp;', ':', 'AAA', '\ufffd', '\ufffd', '\ufffd', '\ufffd', '€–Ÿ', '\u0081', '\r', '😀',
				'\u00a0', '\'"\'', '<>', '&<>"', '&APOS;', '&copy;', '&amp', '&#;&#x;'
			]);
		});
	});
});
