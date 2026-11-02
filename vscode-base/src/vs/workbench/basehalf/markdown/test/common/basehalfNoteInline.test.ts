/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Lexer, type Token, type Tokens } from '../../../../../base/common/marked/marked.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BaseHalfNoteInlineContent,
	BaseHalfNoteInlinePlace,
	baseHalfInlineAtomsKey,
	baseHalfMarkdownInlineAtoms,
	baseHalfNoteInlineFormsReadForTesting,
	baseHalfNoteInlineModel,
	clearBaseHalfNoteInlineCacheForTesting,
	IBaseHalfInlineAtom,
	IBaseHalfNoteInlineContext,
	IBaseHalfNoteLink,
	IBaseHalfNoteStyledText,
	IBaseHalfNoteTextStyles,
	writeBaseHalfNoteInline
} from '../../common/basehalfNoteInline.js';
import { decodeBaseHalfSmallCharacterReferences } from '../../common/basehalfNoteMarkdownText.js';

function text(value: string, styles: IBaseHalfNoteTextStyles = {}): IBaseHalfNoteStyledText {
	return { type: 'text', text: value, styles };
}

function link(href: string, ...content: IBaseHalfNoteStyledText[]): IBaseHalfNoteLink {
	return { type: 'link', href, content };
}

/** Writes content, failing if no form of it read back, and checks that the card reads what was written as the content's model. */
function write(content: BaseHalfNoteInlineContent, context: IBaseHalfNoteInlineContext = {}): string {
	let unreadable: string | undefined;
	const written = writeBaseHalfNoteInline(content, { ...context, onUnreadable: form => { unreadable = form; } });
	assert.strictEqual(unreadable, undefined, `no form of ${JSON.stringify(content)} read back`);
	assertReadsBack(content, written, context);
	return written;
}

function assertReadsBack(content: BaseHalfNoteInlineContent, written: string, context: IBaseHalfNoteInlineContext = {}): void {
	const read = baseHalfMarkdownInlineAtoms(written, context);
	assert.strictEqual(read ? baseHalfInlineAtomsKey(read) : 'nothing', baseHalfInlineAtomsKey(baseHalfNoteInlineModel(content, context)), `${JSON.stringify(written)} read back as other content`);
}

/** Atoms in a short form for assertions: each run of characters with the same formats, with its formats, and what is no text. */
function runs(atoms: readonly IBaseHalfInlineAtom[] | undefined): string[] {
	if (!atoms) {
		return ['nothing'];
	}
	const groups: { text: string; readonly formats: string; readonly alone: boolean }[] = [];
	for (const atom of atoms) {
		if (atom.other !== undefined || atom.media) {
			groups.push({ text: atom.other !== undefined ? `other ${atom.other}` : `${atom.media!.kind} ${atom.media!.src}`, formats: '', alone: true });
			continue;
		}
		const { marks } = atom;
		const formats = [
			marks.bold ? 'b' : '', marks.italic ? 'i' : '', marks.strike ? 's' : '', marks.underline ? 'u' : '', marks.code ? 'c' : '',
			marks.textColor ? `color=${marks.textColor}` : '', marks.backgroundColor ? `bg=${marks.backgroundColor}` : '',
			marks.link !== undefined ? `link=${marks.link}` : '', marks.linkTitle !== undefined ? `title=${marks.linkTitle}` : ''
		].filter(format => format).join(',');
		const last = groups[groups.length - 1];
		if (last && !last.alone && last.formats === formats) {
			last.text += atom.text;
		} else {
			groups.push({ text: atom.text, formats, alone: false });
		}
	}
	return groups.map(group => group.formats ? `${group.text} [${group.formats}]` : group.text);
}

/** A seeded sequence of numbers in [0, 1), so that every run tests the same contents. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
}

suite('BaseHalfNoteInline', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('writeBaseHalfNoteInline', () => {
		test('writes every inline row of the design byte for byte', () => {
			const rows: [string, BaseHalfNoteInlineContent, string, IBaseHalfNoteInlineContext?][] = [
				['underline', [text('a '), text('x', { underline: true }), text(' b')], 'a <u>x</u> b'],
				['red text', [text('a '), text('x', { textColor: 'red' }), text(' b')], 'a <span style="color:#e8706b;">x</span> b'],
				['yellow background', [text('a '), text('x', { backgroundColor: 'yellow' }), text(' b')], 'a <span style="background-color:#4a401d;">x</span> b'],
				['both colors', [text('a '), text('x', { textColor: 'red', backgroundColor: 'yellow' }), text(' b')], 'a <span style="color:#e8706b;background-color:#4a401d;">x</span> b'],
				[
					'a bold sentence whose word is also underlined, red, and on yellow',
					[text('important ', { bold: true }), text('word', { bold: true, underline: true, textColor: 'red', backgroundColor: 'yellow' }), text(' here', { bold: true })],
					'**important <span style="color:#e8706b;background-color:#4a401d;"><u>word</u></span> here**'
				],
				['a bold sentence whose word is underlined', [text('important ', { bold: true }), text('word', { bold: true, underline: true }), text(' here', { bold: true })], '**important <u>word</u> here**'],
				['underline around a bold word', [text('a ', { underline: true }), text('b', { bold: true, underline: true }), text(' c', { underline: true })], '<u>a **b** c</u>'],
				['a and italic it after a space', [text('a'), text(' it', { italic: true })], 'a *it*'],
				['strikethrough ending in a space', [text('gone ', { strike: true }), text('kept')], '~~gone~~ kept'],
				['bold beside code', [text('a', { bold: true }), text('b', { code: true })], '**a**`b`'],
				['bold before Chinese punctuation', [text('这是'), text('重点，', { bold: true }), text('然后')], '这是<strong>重点，</strong>然后'],
				['bold in Chinese quotes', [text('中文'), text('「重点」', { bold: true }), text('中文')], '中文<strong>「重点」</strong>中文'],
				['a red run with an underlined end', [text('x', { textColor: 'red' }), text('y', { textColor: 'red', underline: true }), text('z', { underline: true })], '<span style="color:#e8706b;">x<u>y</u></span><u>z</u>'],
				['a link whose text is partly underlined', [link('https://example.com', text('a '), text('x', { underline: true }))], '[a <u>x</u>](https://example.com)'],
				['red over text and a link', [text('see ', { textColor: 'red' }), link('doc.md', text('doc', { textColor: 'red' })), text(' now', { textColor: 'red' })], '<span style="color:#e8706b;">see [doc](doc.md) now</span>'],
				['a heading with a line break', [text('a\nb')], 'a<br>b', { place: 'heading' }],
				['a heading ending in #', [text('C#')], 'C\\#', { place: 'heading' }],
				['a quote with a format and a break', [text('a '), text('b', { underline: true }), text('\nc')], 'a <u>b</u>\\\nc', { place: 'quote' }],
				['a check item', [text('todo '), text('x', { underline: true })], 'todo <u>x</u>', { place: 'listItem' }],
				['typed syntax', [text('*not italic* and <u>x</u> & &amp; 2 * 3 snake_case [a](b)')], '\\*not italic\\* and &lt;u>x&lt;/u> & &amp;amp; 2 \\* 3 snake_case \\[a\\](b)'],
				['typed line starts', [text('# not a heading\n1. not a list\n- not a bullet\n---')], '\\# not a heading\\\n1\\. not a list\\\n\\- not a bullet\\\n\\---'],
				['brackets that form no link', [text('see [[My Note]] here, Text[^1] and [!NOTE]')], 'see [[My Note]] here, Text[^1] and [!NOTE]'],
				['typed addresses that are not links', [text('see https://example.com and www.example.com or me@example.com')], 'see https&#58;//example.com and www&#46;example.com or me&#64;example.com'],
				['a typed address that Rich linked', [text('see '), link('https://example.com', text('https://example.com'))], 'see https://example.com'],
				['a reference link that was edited', [link('https://example.com/docs', text('the docs'))], '[the docs](https://example.com/docs)'],
				['a link [[ inserts to my file.md', [link('my%20file.md', text('my file.md'))], '[my file.md](my%20file.md)'],
				['a link [[ inserts to docs/lecture #1.pdf', [link('docs/lecture%20%231.pdf', text('lecture #1.pdf'))], '[lecture #1.pdf](docs/lecture%20%231.pdf)'],
				[
					'links by the destination rule',
					[link('other.md', text('other.md')), text(' '), link('my note.md', text('my note')), text(' '), link('https://example.com/wiki/Foo_(bar)', text('Foo')), text(' '), link('笔记/文件.md', text('文件')), text(' '), link('100%.md', text('pct')), text(' '), link('other.md#part-two', text('x'))],
					'[other.md](other.md) [my note](my%20note.md) [Foo](https://example.com/wiki/Foo_(bar)) [文件](笔记/文件.md) [pct](100%25.md) [x](other.md#part-two)'
				],
				[
					'a toggle\'s title with every format',
					[text('Bold', { bold: true }), text(' and '), text('u', { underline: true }), text(' '), text('red', { textColor: 'red' }), text(' '), link('a b.md', text('doc')), text(' '), text('x<y', { code: true }), text(' & co')],
					'<strong>Bold</strong> and <u>u</u> <span style="color:#e8706b;">red</span> <a href="a%20b.md">doc</a> <code>x&lt;y</code> &amp; co',
					{ place: 'html' }
				],
				['a caption', 'Salt & Pepper <3', 'Salt &amp; Pepper &lt;3', { place: 'html' }],
				['a table cell with a pipe and a break', [text('x | y\none')], 'x \\| y<br>one', { place: 'tableCell' }],
				['a reference label typed as text', [text('see [docs] and [the docs]')], 'see \\[docs\\] and [the docs]', { referenceLabels: new Set(['docs']) }]
			];
			for (const [name, content, stored, context] of rows) {
				assert.strictEqual(write(content, context), stored, name);
			}
		});

		test('writes bold that touches Chinese punctuation as <strong>, and bold between Chinese letters as **', () => {
			assert.deepStrictEqual([
				write([text('这是'), text('重点，', { bold: true }), text('然后')]),
				write([text('这是'), text('重点', { bold: true }), text('，然后')]),
				write([text('这是'), text('重点', { bold: true }), text('然后')]),
				write([text('（'), text('注', { italic: true }), text('）')]),
				write([text('中文'), text('「重点」', { strike: true }), text('中文')])
			], [
				'这是<strong>重点，</strong>然后',
				'这是**重点**，然后',
				'这是**重点**然后',
				'（*注*）',
				// Strikethrough follows the same flanking as bold and italic.
				'中文<del>「重点」</del>中文'
			]);
		});

		test('nests marks by their length, the link first among equals, and never cuts a link', () => {
			assert.deepStrictEqual([
				// The longer mark stands outside.
				write([text('a', { bold: true }), text('b', { bold: true, italic: true })]),
				write([text('a', { italic: true }), text('b', { bold: true, italic: true })]),
				// Equal lengths nest in the order link, color, underline, bold, italic, strikethrough, code.
				write([text('x', { bold: true, italic: true, strike: true, underline: true, textColor: 'blue' })]),
				write([link('u.md', text('x', { bold: true, underline: true }))]),
				// A mark that covers part of a link closes before it and opens again inside it.
				write([text('a ', { underline: true }), link('u.md', text('b', { underline: true }), text(' c'))]),
				// A mark opened inside a link closes at its end.
				write([link('u.md', text('a '), text('b', { bold: true })), text('c', { bold: true })]),
				// Code stands inside every other mark, and a mark inside code cuts it into code spans.
				write([text('ab', { code: true, underline: true }), text('c', { underline: true })]),
				write([text('a', { code: true }), text('b', { code: true, bold: true }), text('c', { code: true })])
			], [
				// Only `***x***` and `***x* y**` let two runs of one family touch.
				'**a<em>b</em>**',
				'*a<strong>b</strong>*',
				'<span style="color:#4ba3dc;"><u>***~~x~~***</u></span>',
				'[<u>**x**</u>](u.md)',
				'<u>a </u>[<u>b</u> c](u.md)',
				'[a **b**](u.md)**c**',
				'<u>`ab`c</u>',
				'`a`**`b`**`c`'
			]);
		});

		test('takes the next form where the reader pairs delimiters across the tags around them', () => {
			// Written with Markdown delimiters, the `*` before `</u>` and the one after the next line's `<u>` pair into
			// an `<em>` that a span crosses, and a page moves the second line's code out of its color.
			const gray = { italic: true, underline: true, code: true, textColor: 'gray' } as const;
			const content = [
				text('word 。', { bold: true, italic: true, underline: true, textColor: 'blue' }),
				text('snake_case {wordbeta', gray),
				text('\n'),
				text('[ ]', gray),
				text(' alpha', { textColor: 'green' })
			];
			assert.strictEqual(
				write(content),
				'<u><span style="color:#4ba3dc;">***word 。***</span><span style="color:#9b9a97;">*`snake_case {wordbeta`*</span></u>\\\n<span style="color:#9b9a97;"><u>*`[ ]`*</u></span><span style="color:#5cad83;"> alpha</span>'
			);
		});

		test('keeps white space at the edges of bold, italic, and strikethrough outside them, and drops what Markdown cannot hold', () => {
			assert.deepStrictEqual([
				write([text('a'), text(' b ', { bold: true }), text('c')]),
				write([text('a'), text(' b ', { underline: true }), text('c')]),
				write([text('  lead and trail  ')]),
				write([text('one\n   two\n\n')]),
				write([text('\n\nx')]),
				write([text('x\u{3000}')], { place: 'heading' }),
				write([text('x\u{3000}')]),
				write([text('x\u{3000}')], { place: 'listItem' }),
				write([text(' ', { code: true }), text('x')]),
				write([text('a\u{00a0}b')])
			], [
				'a **b** c',
				'a<u> b </u>c',
				'lead and trail',
				'one\\\ntwo',
				'x',
				'x',
				'x&#12288;',
				'x',
				'` `x',
				'a&nbsp;b'
			]);
		});

		test('writes white space that ends a paragraph or a quote as a character reference, which the card neither trims nor reads past', () => {
			// After a line break, white space alone to the end of the block would leave the backslash as text.
			assert.deepStrictEqual([
				write([text('第一行\n\u{3000}\u{3000}')]),
				write([text('a\n\u{3000}')], { place: 'quote' }),
				write([text('a\n\u{2003}')]),
				write([text('a\n\u{202f}\u{feff}')]),
				write([text('a\n\v')]),
				write([text('a\n\u{205f}')]),
				// At the end of a list's last item, the card's reader would trim it into a paragraph of its own.
				write([text('中文段落\u{3000}')]),
				// Only where the line ends: elsewhere it stays as typed.
				write([text('a\u{3000}b\u{3000}\nc')]),
				write([text('a\u{3000}'), text('b', { bold: true })])
			], [
				'第一行\\\n\u{3000}&#12288;',
				'a\\\n&#12288;',
				'a\\\n&#8195;',
				'a\\\n\u{202f}&#65279;',
				'a\\\n&#11;',
				'a\\\n&#8287;',
				'中文段落&#12288;',
				'a\u{3000}b\u{3000}\\\nc',
				'a\u{3000}**b**'
			]);
		});

		test('writes a line break as a backslash in a paragraph, a quote, and a list item, and as <br> elsewhere', () => {
			const content = [text('a\nb'), text('c\nd', { bold: true })];
			assert.deepStrictEqual((['paragraph', 'quote', 'listItem', 'heading', 'tableCell', 'html'] as const).map(place => write(content, { place })), [
				'a\\\nb**c**\\\n**d**',
				'a\\\nb**c**\\\n**d**',
				'a\\\nb**c**\\\n**d**',
				'a<br>b**c**<br>**d**',
				'a<br>b**c**<br>**d**',
				'a<br>b<strong>c</strong><br><strong>d</strong>'
			]);
			// A break inside a link stays in it; one at its end leaves it.
			assert.deepStrictEqual([
				write([link('u.md', text('a\nb'))]),
				write([link('u.md', text('a\n')), text('b')]),
				write([link('u.md', text('a\n\nb'))])
			], ['[a<br>b](u.md)', '[a](u.md)\\\nb', '[a<br><br>b](u.md)']);
		});

		test('writes a bare address only where the card links it the same', () => {
			assert.deepStrictEqual([
				write([text('see '), link('https://example.com', text('https://example.com'))]),
				write([text('see '), link('http://www.example.com', text('www.example.com'))]),
				write([text('mail '), link('mailto:me@example.com', text('me@example.com'))]),
				// A relative address never is.
				write([link('docs.md', text('docs.md'))]),
				// Text that would extend the address keeps the link's brackets.
				write([link('https://a.b', text('https://a.b')), text('c')]),
				// A format inside the link keeps its brackets too.
				write([link('https://a.b', text('https://a.b', { underline: true }))]),
				write([link('https://a.b/x', text('https://a.b'))])
			], [
				'see https://example.com',
				'see www.example.com',
				'mail me@example.com',
				'[docs.md](docs.md)',
				'[https://a.b](https://a.b)c',
				'[<u>https://a.b</u>](https://a.b)',
				'[https://a.b](https://a.b/x)'
			]);
		});

		test('writes code that reads back, and <code> where backticks would not', () => {
			assert.deepStrictEqual([
				write([text('a '), text('x`y', { code: true })]),
				write([text('a '), text('`x', { code: true })]),
				write([text('a '), text(' x ', { code: true })]),
				write([text('a '), text('``x', { code: true })]),
				// Three backticks at the start of a line would open a fenced block.
				write([text('``x', { code: true })]),
				write([text('``x', { code: true })], { place: 'listItem' }),
				// A line separator would end the line; the text around it keeps its own form.
				write([text('a. '), text('x\u{2028}y', { code: true })]),
				// In a cell, a pipe is escaped, and a backslash before a pipe needs <code>.
				write([text('a|b', { code: true })], { place: 'tableCell' }),
				write([text('a\\|b', { code: true })], { place: 'tableCell' }),
				// A backtick in code would end a link's text.
				write([text('see. '), link('u.md', text('a`b', { code: true }))])
			], [
				'a ``x`y``',
				'a `` `x ``',
				'a `  x  `',
				'a ``` ``x ```',
				'<code>\\`\\`x</code>',
				'<code>\\`\\`x</code>',
				'a. <code>x&#8232;y</code>',
				'`a\\|b`',
				'<code>a\\\\\\|b</code>',
				'see. [<code>a\\`b</code>](u.md)'
			]);
		});

		test('stores what the rich editor reads back of white space: a carriage return as a space, and none where its reader drops it', () => {
			assert.deepStrictEqual([
				// The card and the rich editor show a carriage return as a space.
				write([text('a\rb')]),
				write([text('a \r')]),
				write([text('a\rb', { code: true })]),
				// The reader of the rich editor drops the white space after a check item's box, a form feed among it.
				write([text('\f\u{1f600} x')], { place: 'listItem' }),
				// It drops the white space that ends a cell, in code too, but not the space that starts one.
				write([text('x  ', { code: true })], { place: 'tableCell' }),
				write([text('a'), text(' ', { code: true })], { place: 'tableCell' }),
				write([text('a '), text(' b ', { code: true })], { place: 'tableCell' }),
				write([text('x\t', { code: true })], { place: 'tableCell' }),
				write([text('  x', { code: true })], { place: 'tableCell' }),
				write([text('x\u{3000}', { code: true })], { place: 'tableCell' }),
				// Elsewhere code keeps its white space.
				write([text('x  ', { code: true })], { place: 'listItem' }),
				// A form feed is white space a page collapses, and a text of such white space alone, in code too, is none.
				write([text('a\n\f')], { place: 'quote' }),
				write([text('\f', { underline: true })]),
				write([text('  ', { code: true })]),
				write([text('\f', { code: true })], { place: 'listItem' }),
				write([text('\u{3000}', { code: true })])
			], [
				'a b',
				'a',
				'`a b`',
				'\u{1f600} x',
				'`x`',
				'a',
				'a ` b`',
				'`x`',
				'`  x`',
				'`x\u{3000}`',
				'`x  `',
				'a',
				'',
				'',
				'',
				'`\u{3000}`'
			]);
		});

		test('escapes typed characters that would pair with code or an address', () => {
			assert.deepStrictEqual([
				// The reader takes a ~ in text and one in code for strikethrough.
				write([text('Save to ~/notes or '), text('~/docs', { code: true })]),
				// A backtick in text would open code up to one in an address.
				write([text('a`b '), link('c`d.md', text('x'))]),
				// An _ in text would pair with one in an address the reader does not mask.
				write([text('see _a '), link('Foo_(bar)', text('x')), text(' b')])
			], [
				'Save to \\~/notes or `~/docs`',
				'a\\`b [x](c`d.md)',
				'see \\_a [x](Foo_(bar)) b'
			]);
		});

		test('tries the next form while a form reads back as anything else', () => {
			// Markdown delimiters where they read back.
			assert.strictEqual(write([text('a '), text('b', { bold: true }), text(' c')]), 'a **b** c');
			// Delimiters closed and opened again at a change of color, where they would not pair across it.
			assert.strictEqual(write([text('``', { bold: true }), text('*`', { bold: true, textColor: 'red' }), text('b', { code: true })]), '**\\`\\`**<span style="color:#e8706b;"><strong>\\*\\`</strong></span>`b`');
			// Tags, where the reader would pair the delimiters with something else: here it reads `\\**` as code.
			assert.strictEqual(write([text('`\\', { bold: true }), text(')', { code: true })]), '<strong>\\`\\\\</strong>`)`');
		});

		test('reads each written form once', () => {
			clearBaseHalfNoteInlineCacheForTesting();
			const content = [text('a '), text('b', { bold: true }), text(' c *d*')];
			const first = write(content);
			const reads = baseHalfNoteInlineFormsReadForTesting();
			assert.strictEqual(reads, 1);
			assert.strictEqual(write(content), first);
			assert.strictEqual(write([text('a '), text('b', { bold: true }), text(' c *d*')]), first);
			assert.strictEqual(baseHalfNoteInlineFormsReadForTesting(), reads);
			// Plain text needs no reading at all.
			write([text('plain words, and more.')]);
			assert.strictEqual(baseHalfNoteInlineFormsReadForTesting(), reads);
			write([text('a '), text('b', { italic: true })]);
			assert.strictEqual(baseHalfNoteInlineFormsReadForTesting(), reads + 1);
			clearBaseHalfNoteInlineCacheForTesting();
		});

		test('writes nothing for content without characters, and reads any content shape without throwing', () => {
			assert.deepStrictEqual([
				writeBaseHalfNoteInline(undefined),
				writeBaseHalfNoteInline([]),
				writeBaseHalfNoteInline([text(' \n ')]),
				writeBaseHalfNoteInline([link('u.md')] as unknown as BaseHalfNoteInlineContent),
				writeBaseHalfNoteInline([{ type: 'mention', content: 'Ada' }] as unknown as BaseHalfNoteInlineContent),
				writeBaseHalfNoteInline([text('x', { textColor: 'default', backgroundColor: '#123456' })]),
				writeBaseHalfNoteInline('plain *text*')
			], ['', '', '', '', 'Ada', 'x', 'plain \\*text\\*']);
		});

		test('writes seeded contents that read back as their model in every place', () => {
			const random = seededRandom(310);
			const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
			const pieces = [
				'a', 'word', 'Z9', '中文', '重点', '，', '。', '「', '」', '😀', 'é', 'e\u{0301}', ' ', ' ', '  ', '\t', '\u{00a0}', '\u{3000}', '\n', '\n\n', '*', '**', '_', '__',
				'~', '~~', '`', '```', '[', ']', '(', ')', '[x]', '[ ]', '![', '!', '<', '>', '&', '&amp;', '&copy;', '&#58;', '\\', '\\\\', '#', '##', '-', '---', '+', '=',
				'===', '|', ':', ':-:', '.', '1.', '2)', '@', 'https://', 'http://x.y', 'www.', 'www.ex.com', 'me@ex.com', 'a_b', '<u>', '</u>', '<br>', '<!--', '<?', '<div',
				'<1@x.io>', '<https://x.y>', '[[My Note]]', '[^1]', '[!NOTE]', '[docs]', '[a](b)', '{', '}', '"', '\'', '\u{2028}', '\r', 'HTTPS://ex.com', '_x_', '*x*',
				'`c`', '~s~', '\\*', '&nbsp;', '$', '%', '^', '\u{200b}', '\f', '\v'
			];
			const hrefs = ['other.md', 'my note.md', 'my%20note.md', 'https://example.com', 'https://example.com/a_b*c', 'http://www.ex.com', 'mailto:me@ex.com', 'Foo_(bar)', 'a(b', '笔记/文件.md', '100%.md', '#setup', 'a|b', 'a b(c).md', '', 'x"y', '<x>', 'a\\b', 'https://x.y/?a=1&b=2', 'a&amp;b', '~/x'];
			const colors = ['red', 'yellow', 'blue', 'default', 'nope', undefined];
			const styles = (): IBaseHalfNoteTextStyles => ({
				...(random() < 0.25 ? { bold: true } : {}),
				...(random() < 0.2 ? { italic: true } : {}),
				...(random() < 0.15 ? { strike: true } : {}),
				...(random() < 0.2 ? { underline: true } : {}),
				...(random() < 0.1 ? { code: true } : {}),
				...(random() < 0.15 ? { textColor: pick(colors) } : {}),
				...(random() < 0.1 ? { backgroundColor: pick(colors) } : {})
			});
			const characters = () => {
				let value = '';
				for (let count = 1 + Math.floor(random() * 4); count > 0; count--) {
					value += pick(pieces);
				}
				return value;
			};
			const labels = new Set(['docs', 'my note', '^1']);
			const places: readonly BaseHalfNoteInlinePlace[] = ['paragraph', 'quote', 'listItem', 'heading', 'tableCell', 'html'];
			for (let index = 0; index < 2000; index++) {
				const content: (IBaseHalfNoteStyledText | IBaseHalfNoteLink)[] = [];
				for (let count = 1 + Math.floor(random() * 6); count > 0; count--) {
					if (random() < 0.2) {
						const href = pick(hrefs);
						const inside: IBaseHalfNoteStyledText[] = [];
						for (let runs = 1 + Math.floor(random() * 3); runs > 0; runs--) {
							inside.push(text(random() < 0.3 ? href : characters(), styles()));
						}
						content.push(link(href, ...inside));
					} else {
						content.push(text(characters(), styles()));
					}
				}
				for (const place of places) {
					const context: IBaseHalfNoteInlineContext = { place, referenceLabels: index % 2 === 0 ? labels : undefined };
					write(content, context);
				}
			}
		});
	});

	suite('baseHalfMarkdownInlineAtoms', () => {
		test('reads each spelling of a format as the same characters with the same formats', () => {
			const read = (markdown: string) => runs(baseHalfMarkdownInlineAtoms(markdown));
			assert.deepStrictEqual([
				read('**b**__b__<b>b</b><strong>b</strong>'),
				read('*i*_i_<i>i</i><em>i</em>'),
				read('~~s~~ ~s~<s>s</s><del>s</del><strike>s</strike>'),
				read('<u>u</u><span style="color:#E8706B;">r</span><span style="color:#e8706b;">r</span>'),
				read('[d](my%20note.md)<a href="my note.md">d</a>[d](<my note.md>)'),
				read('a<br>b\\\nc\nd'),
				read('https://x.y <https://x.y> [https://x.y](https://x.y)'),
				read('a &amp; &#58; &lt; \\* \\&')
			], [
				['bbbb [b]'],
				['iiii [i]'],
				['s [s]', ' ', 'ssss [s]'],
				['u [u]', 'rr [color=red]'],
				['ddd [link=my%20note.md]'],
				['a\nb\nc\nd'],
				['https://x.y [link=https://x.y]', ' ', 'https://x.y [link=https://x.y]', ' ', 'https://x.y [link=https://x.y]'],
				['a & : < * &']
			]);
		});

		test('keeps what Rich cannot write as it is written', () => {
			const read = (markdown: string) => runs(baseHalfMarkdownInlineAtoms(markdown));
			assert.deepStrictEqual([
				read('a <mark>x</mark>'),
				read('a <!-- c --> b'),
				read('use List<String> here'),
				read('a <span style="color:#123456;">x</span>'),
				read('a <u class="k">x</u>'),
				read('a </u> b'),
				read('a <u>b'),
				read('[a](u.md "T")'),
				read('text ![A](a.png) more'),
				read('![](clip.mp4)'),
				// The card shows a picture whose address holds `|` at the address before it.
				read('![x](x.png|width=50)'),
				// A tag that crosses the edge of an element that Markdown writes, which a page builds otherwise.
				read('<u>*a</u>* b'),
				read('*<span style="color:#e8706b;">a*</span> b')
			], [
				['a ', 'other <mark>', 'x', 'other </mark>'],
				['a ', 'other <!-- c -->', ' b'],
				['use List', 'other <string>', ' here'],
				['a ', 'other <span style="color:#123456;">', 'x', 'other </span>'],
				['a ', 'other <u class="k">', 'x', 'other </u>'],
				['a ', 'other </u>', ' b'],
				['a ', 'b [u]', 'other <u> not closed'],
				['a [link=u.md,title=T]'],
				['text ', 'image a.png', ' more'],
				['video clip.mp4'],
				['other ![x](x.png|width=50)'],
				['a [i,u]', 'other </u> across a format', ' b'],
				['a [i,color=red]', 'other <span> across a format', 'other </span>', ' b']
			]);
		});

		test('reads nothing of text that is not one block of its place', () => {
			assert.deepStrictEqual([
				baseHalfMarkdownInlineAtoms('# x'),
				baseHalfMarkdownInlineAtoms('a\n\nb'),
				baseHalfMarkdownInlineAtoms('[ ] x', { place: 'listItem' }),
				baseHalfMarkdownInlineAtoms('a\n---', { place: 'quote' }),
				baseHalfMarkdownInlineAtoms('a | b', { place: 'tableCell' })
			], [undefined, undefined, undefined, undefined, undefined]);
			assert.deepStrictEqual(baseHalfMarkdownInlineAtoms(''), []);
		});

		test('decodes character references with the decoder it is given', () => {
			const decode = (value: string) => decodeBaseHalfSmallCharacterReferences(value).replace(/&copy;/g, '\u{00a9}');
			assert.deepStrictEqual([
				runs(baseHalfMarkdownInlineAtoms('a &copy; b')),
				runs(baseHalfMarkdownInlineAtoms('a &copy; b', { decodeCharacterReferences: decode }))
			], [['a &copy; b'], ['a \u{00a9} b']]);
		});
	});

	suite('backslash escapes', () => {
		/** Every escape token that `marked` reads in written Markdown: the escaped character and the character it reads. */
		function escapesIn(markdown: string, place: BaseHalfNoteInlinePlace): [string, string][] {
			const escapes: [string, string][] = [];
			const walk = (tokens: readonly Token[]) => {
				for (const token of tokens) {
					if (token.type === 'escape') {
						escapes.push([token.raw, decodeBaseHalfSmallCharacterReferences((token as Tokens.Escape).text)]);
					}
					const nested = (token as Tokens.Generic).tokens;
					if (Array.isArray(nested)) {
						walk(nested);
					}
				}
			};
			const source = place === 'heading' ? `# ${markdown}` : place === 'tableCell' ? `| h |\n| --- |\n| ${markdown} |` : markdown;
			for (const block of Lexer.lex(source, { gfm: true, breaks: true })) {
				walk([block]);
				if (block.type === 'table') {
					for (const row of [(block as Tokens.Table).header, ...(block as Tokens.Table).rows]) {
						row.forEach(cell => walk(cell.tokens));
					}
				}
			}
			return escapes;
		}

		test('every backslash escape the writer writes is one the card reads as the plain character, = included', () => {
			const contents: [BaseHalfNoteInlineContent, BaseHalfNoteInlinePlace][] = [
				[[text('a\n===')], 'paragraph'],
				[[text('a\n=')], 'paragraph'],
				[[text('a\n---\n- x\n+ y\n* z\n# h\n> q\n1. n\n2) m')], 'paragraph'],
				[[text('*x* _y_ ~z~ `c` [a](b) ![i](j) x!'), link('u.md', text('k'))], 'paragraph'],
				[[text('a | b \\* c#')], 'tableCell'],
				[[text('C#')], 'heading'],
				[[text('[ ] task')], 'listItem'],
				[[text('a\\'), text('b', { bold: true })], 'paragraph'],
				[[text('{x} (y) +z .w'), text('``', { code: true })], 'paragraph']
			];
			const seen = new Set<string>();
			for (const [content, place] of contents) {
				const written = write(content, { place });
				for (const [raw, read] of escapesIn(written, place)) {
					assert.strictEqual(raw.length, 2, raw);
					assert.strictEqual(read, raw[1], `${raw} in ${JSON.stringify(written)}`);
					seen.add(raw);
				}
			}
			for (const escape of ['\\=', '\\-', '\\+', '\\*', '\\#', '\\>', '\\.', '\\)', '\\_', '\\~', '\\`', '\\[', '\\]', '\\!', '\\\\']) {
				assert.ok(seen.has(escape), `${escape} was not written`);
			}
			// A cell's `\|` is read by the reader's splitting of the row, before the cell's text is read, as a plain `|`.
			assert.deepStrictEqual(runs(baseHalfMarkdownInlineAtoms(write([text('a | b')], { place: 'tableCell' }), { place: 'tableCell' })), ['a | b']);
		});

		test('every escape in seeded written text reads as the plain character', () => {
			const random = seededRandom(320);
			const pieces = ['a', ' ', '\n', '*', '_', '~', '`', '[', ']', '(', ')', '!', '<', '>', '&', '#', '-', '+', '=', '|', ':', '.', '1.', '2)', '\\', '{', '}', '中', '😀'];
			for (let index = 0; index < 400; index++) {
				let value = '';
				for (let count = 1 + Math.floor(random() * 8); count > 0; count--) {
					value += pieces[Math.floor(random() * pieces.length)];
				}
				for (const place of ['paragraph', 'heading', 'tableCell'] as const) {
					const written = write([text(value, random() < 0.5 ? {} : { bold: true })], { place });
					for (const [raw, read] of escapesIn(written, place)) {
						assert.strictEqual(read, raw[1], `${raw} in ${JSON.stringify(written)}`);
					}
				}
			}
		});
	});
});
