/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { repairBaseHalfNoteHtml, tidyBaseHalfNoteHtml } from '../../browser/basehalfNoteHtmlRepair.js';
import type { BaseHalfNoteReadMode } from '../../common/basehalfNoteStructure.js';

/** The HTML the rich editor reads of `html`: tidied as the card's reader wrote it, for a note's Markdown, and repaired. */
function mended(html: string, mode: BaseHalfNoteReadMode = 'markdown'): string {
	const template = document.createElement('template');
	template.innerHTML = html;
	if (mode === 'markdown') {
		tidyBaseHalfNoteHtml(template.content);
	}
	repairBaseHalfNoteHtml(template.content, mode);
	return template.innerHTML;
}

const group = (inner: string) => `<div data-node-type="blockGroup">${inner}</div>`;

suite('BaseHalfNoteHtmlRepair', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('gives an item without text every block in it as its children, a list, a heading, a quote, code, and a toggle', () => {
		const rows: [string, string][] = [
			// `-\n  - b`: the editor would read the item as the list's item.
			['<ul><li><ul><li>b</li></ul></li></ul>', `<ul><div><li></li>${group('<ul><li><p>b</p></li></ul>')}</div></ul>`],
			// `-\n  ## T`: and a heading's text as the item's text.
			['<ul><li><h2>T</h2></li></ul>', `<ul><div><li></li>${group('<h2>T</h2>')}</div></ul>`],
			['<ul><li><blockquote><p>q</p></blockquote></li></ul>', `<ul><div><li></li>${group('<blockquote><p>q</p></blockquote>')}</div></ul>`],
			['<ul><li><pre><code>x\n</code></pre></li></ul>', `<ul><div><li></li>${group('<pre><code>x</code></pre>')}</div></ul>`],
			// A toggle stays the item's child, where a toggle in a <div> in the item made the editor throw.
			['<ul><li><details><summary>T</summary><p>body</p></details></li></ul>', `<ul><div><li></li>${group('<details><summary>T</summary><p>body</p></details>')}</div></ul>`],
			// `- &#32;\n  - b`: an item whose text shows nothing keeps it.
			['<ul><li> <ul><li>b</li></ul></li></ul>', `<ul><div><li> </li>${group('<ul><li><p>b</p></li></ul>')}</div></ul>`],
			// An item with text, as before.
			['<ul><li>a<ul><li>b</li></ul></li></ul>', `<ul><div><li><p>a</p></li>${group('<ul><li><p>b</p></li></ul>')}</div></ul>`]
		];
		for (const [html, expected] of rows) {
			assert.strictEqual(mended(html), expected, html);
		}
		// Another element that starts an item, as another application pastes it, holds the item's text.
		assert.strictEqual(mended('<ul><li><div>Item</div></li></ul>', 'paste'), '<ul><li><div>Item</div></li></ul>');
	});

	test('reads a paragraph after a block in a tight item as a paragraph, without the line break before it', () => {
		// The card's reader writes the paragraph's text right after the block, a line break first.
		assert.strictEqual(
			mended('<ul><li><figure><img src="a.png"></figure>\n\na\tb <strong>c</strong></li></ul>'),
			`<ul><div><li></li>${group('<figure data-url="a.png"><img src="a.png" data-url="a.png"></figure><p>a\tb <strong>c</strong></p>')}</div></ul>`
		);
		// White space between two inline elements is a space, also where a paste holds them in an item.
		assert.strictEqual(mended('<ul><li><p>a</p><a href="u">l</a> <b>b</b></li></ul>', 'paste'), `<ul><div><li><p>a</p></li>${group('<a href="u">l</a> <b>b</b>')}</div></ul>`);
		// In an inline element a line break is a space.
		assert.strictEqual(mended('<p>a<em>\nb</em></p>'), '<p>a<em>\nb</em></p>');
	});

	test('reads a line break in a caption as the space the editor shows', () => {
		const caption = (html: string) => {
			const template = document.createElement('template');
			template.innerHTML = mended(html);
			return template.content.querySelector('figcaption')?.textContent;
		};
		assert.strictEqual(caption('<figure><img src="a.png"><figcaption>a<br>b</figcaption></figure>'), 'a b');
		assert.strictEqual(caption('<figure><img src="a.png"><figcaption>a<br/><br>b</figcaption></figure>'), 'a  b');
	});
});
