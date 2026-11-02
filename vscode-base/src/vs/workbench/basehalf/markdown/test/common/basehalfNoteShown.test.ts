/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { decodeBaseHalfSmallCharacterReferences } from '../../common/basehalfNoteMarkdownText.js';
import { baseHalfMarkdownShownSignature, baseHalfMarkdownShowsSame, IBaseHalfShownContext } from '../../common/basehalfNoteShown.js';

type ShownCase = readonly [name: string, source: string, written: string, context?: IBaseHalfShownContext];

function assertSame(cases: readonly ShownCase[]): void {
	for (const [name, source, written, context] of cases) {
		assert.ok(baseHalfMarkdownShowsSame(source, written, context), `${name}: ${JSON.stringify(source)} and ${JSON.stringify(written)} should show the same\n${baseHalfMarkdownShownSignature(source, context)}\n${baseHalfMarkdownShownSignature(written, context)}`);
		assert.ok(baseHalfMarkdownShowsSame(written, source, context), `${name}, the other way`);
	}
}

function assertDifferent(cases: readonly ShownCase[]): void {
	for (const [name, source, written, context] of cases) {
		assert.ok(!baseHalfMarkdownShowsSame(source, written, context), `${name}: ${JSON.stringify(source)} and ${JSON.stringify(written)} should not show the same\n${baseHalfMarkdownShownSignature(source, context)}`);
	}
}

const docs = { href: 'https://example.com/docs' };

suite('BaseHalfNoteShown', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('baseHalfMarkdownShowsSame', () => {
		test('is the same for equal text, whatever its line endings', () => {
			assertSame([
				['equal', '<u>x</u>', '<u>x</u>'],
				['line endings', '- a\r\n- b', '- a\n- b'],
				['an address with & and itself', '[API](https://example.com/api?id=1&param=2)', '[API](https://example.com/api?id=1&param=2)'],
				['an & that starts no reference and itself', '&copy 2024', '&copy 2024'],
				// Read once, as a page reads them, these are the same in another spelling too.
				['an address with & in HTML', '[API](https://example.com/api?id=1&param=2)', '<a href="https://example.com/api?id=1&amp;param=2">API</a>'],
				['an & that starts no reference, escaped', '&copy 2024', '&amp;copy 2024']
			]);
		});

		test('reads every spelling of a format as the same, and their nesting in any order', () => {
			assertSame([
				['nesting order', '**<u>x</u>**', '<u>**x**</u>'],
				['b, i, s, and strike tags', '<b>x</b> and <i>y</i> and <s>z</s> <strike>w</strike>', '**x** and *y* and ~~z~~ ~~w~~'],
				['strong, em, del, and code tags', 'a <strong>b</strong> <em>c</em> <del>d</del> <code>e</code>', 'a **b** *c* ~~d~~ `e`'],
				['underscores', '_x_ and __y__', '*x* and **y**'],
				['a palette span in either case of hex', 'a <span style="color:#E8706B;">x</span> b', 'a <span style="color:#e8706b;">x</span> b'],
				['two spans and one', '<span style="color:#e8706b;"><span style="background-color:#4a401d;">x</span></span>', '<span style="color:#e8706b;background-color:#4a401d;">x</span>'],
				['an HTML link with only an address', 'a <a href="doc.md">doc</a> c', 'a [doc](doc.md) c'],
				['a soft and a hard line break', 'a\nb', 'a\\\nb'],
				['a <br> and a hard line break', 'a<br/>b', 'a\\\nb'],
				['bold across a soft line break', '**a\nb**', '**a**\\\n**b**'],
				['bold across <br>', '<strong>a<br>b</strong>', '**a**\\\n**b**'],
				['a link across a line break', '[a\nb](u)', '[a<br>b](u)'],
				['a line break that ends a paragraph, where its line ends anyway', 'a<br>', 'a'],
				['a line break that ends a cell, and a cell of one', '| a<br> | <br> |\n| --- | --- |', '| a   |     |\n| --- | --- |'],
				['white space at the edges of bold', '<strong>a </strong>b', '**a** b'],
				['white space at the edges of italic', 'a<em> x</em>', 'a *x*'],
				['a run of spaces', 'a  b', 'a b'],
				['character references', 'a&nbsp;b &#58; &amp;', 'a&#160;b : &'],
				['escaped and plain punctuation', '\\# not a heading and 2 \\* 3', '\\# not a heading and 2 * 3']
			]);
		});

		test('reads every spelling of a link\'s address as the same', () => {
			assertSame([
				['an address in angle brackets', '[my note](<my note.md>)', '[my note](my%20note.md)'],
				['a bare address', 'see https://example.com', 'see [https://example.com](https://example.com)'],
				['a bare www address', 'see www.example.com', 'see [www.example.com](http://www.example.com)'],
				['an address in angle brackets alone', '<https://example.com>', 'https://example.com'],
				['an e-mail address', 'me@example.com', '[me@example.com](mailto:me@example.com)'],
				['a reference link without a title', '[the docs][docs]', '[the docs](https://example.com/docs)', { definitions: { docs } }]
			]);
		});

		test('reads pictures, videos, and sounds by kind, address, width, name, and caption, written in Markdown or HTML', () => {
			assertSame([
				['a picture as a tag', '<img src="x.png">', '![](x.png)'],
				['an empty name', '<img alt="" src="x.png">', '![](x.png)'],
				['attribute order', '<img src="a.png" alt="A" width="320">', '<img alt="A" src="a.png" width="320">'],
				['attribute quotes and a closing slash', '<img alt=\'A\' src=a.png width=320 />', '<img alt="A" src="a.png" width="320">'],
				['a video as a Markdown picture', '![](clip.mp4)', '<video src="clip.mp4" controls></video>'],
				['a named video as a Markdown picture', '![clip](clip.mp4)', '<video src="clip.mp4" controls></video>'],
				['a sound as a Markdown picture', '![s](s.ogg)', '<audio src="s.ogg" controls></audio>'],
				['a figure on several lines', '<figure>\n<img src="a.png" alt="A">\n<figcaption>c</figcaption>\n</figure>', '<figure><img alt="A" src="a.png"><figcaption>c</figcaption></figure>'],
				['a caption before the picture, in either spelling', '<figure><figcaption>c</figcaption><img alt="A" src="a.png"></figure>', '<figure>\n<figcaption>c</figcaption>\n<img src="a.png" alt="A">\n</figure>'],
				['a figure without a caption', '<figure><img alt="A" src="a.png"></figure>', '![A](a.png)'],
				['an empty caption', '<figure><img alt="A" src="a.png"><figcaption></figcaption></figure>', '![A](a.png)'],
				['a video\'s figure', '<figure><video src="clip.mp4" controls></video><figcaption>c</figcaption></figure>', '<figure><video controls src="clip.mp4"></video><figcaption>c</figcaption></figure>'],
				['a caption with a reference', '<figure><img alt="A" src="a.png"><figcaption>R&amp;D notes</figcaption></figure>', '<figure><img alt="A" src="a.png"><figcaption>R&#38;D notes</figcaption></figure>'],
				['an address with &', '<img src="chart.png?v=2&times=3">', '![](chart.png?v=2&times=3)']
			]);
		});

		test('reads toggles, headings, lists, code, quotes, and tables by what they show', () => {
			assertSame([
				['a toggle\'s first lines', '<details>\n<summary>Title</summary>', '<DETAILS>\n<summary>Title</summary>\n'],
				['open, with a value', '<details open="">\n<summary>T</summary>\n</details>', '<details open>\n<summary>T</summary>\n</details>'],
				['formats in a toggle\'s title', '<details>\n<summary><b>Bold</b> &amp; co</summary>\n</details>', '<details>\n<summary><strong>Bold</strong> &amp; co</summary>\n</details>'],
				['a toggle heading', '<details>\n<summary><h2>T</h2></summary>\n\nbody\n\n</details>', '<details>\n<summary><h2>T</h2></summary>\n\nbody\n\n</details>\n'],
				['an underlined heading', 'Title\n=====', '# Title'],
				['closing hashes', '## T ##', '## T'],
				['* bullets', '- a\n- b', '* a\n* b'],
				['+ bullets', '+ a\n+ b', '- a\n- b'],
				['numbers with )', '1) a\n2) b', '1. a\n2. b'],
				['numbers after the first', '3. a\n3. b', '3. a\n4. b'],
				['check items', '- [ ] a\n- [x] b', '* [ ] a\n* [x] b'],
				// An item's text that shows nothing is no text.
				['an empty item', '-', '- &#32;'],
				['an empty check item', '- [ ] ', '- [ ] &#32;'],
				['an empty item holding a list', '-\n  - b', '- &#32;\n  - b'],
				['an empty check item holding a list', '- [x] \n  - b', '- [x] &#32;\n  - b'],
				['a hand-wrapped list item', '- a\n  b', '- a\\\n  b'],
				['a lazy quote line', '> a\nb', '> a\\\n> b'],
				['the language text', '```text\nx\n```', '```\nx\n```'],
				['a tilde fence', '~~~js\nx\n~~~', '```js\nx\n```'],
				['indented code', '    x', '```\nx\n```'],
				['a column aligned left', '| a |\n|:---|\n| b |', '| a   |\n| --- |\n| b   |'],
				['a padded table', '| a | b |\n|---|:-:|\n| 1 | 2 |', '| a   | b   |\n| --- | :-: |\n| 1   | 2   |'],
				['a rule', '***', '---']
			]);
		});

		test('is not the same where a title, an element, an attribute, or a comment would be lost', () => {
			assertDifferent([
				['a link\'s title', '[a](u "T")', '[a](u)'],
				['a picture\'s title', '![A](a.png "T")', '![A](a.png)'],
				['a reference link whose definition has a title, written inline', '[the docs][docs]', '[the docs](https://example.com/docs)', { definitions: { docs: { ...docs, title: 'Docs' } } }],
				['a width in %', '<img alt="A" src="a.png" width="50%">', '![A](a.png)'],
				['a width in % and in pixels', '<img alt="A" src="a.png" width="50%">', '<img alt="A" src="a.png" width="50">'],
				['a span of another color', 'a <span style="color:#123456;">x</span> b', 'a x b'],
				['a span of another spelling', 'a <span style="color: #e8706b;">x</span> b', 'a <span style="color:#e8706b;">x</span> b'],
				['class on a picture', '<img class="c" src="a.png">', '![](a.png)'],
				['height on a picture', '<img src="a.png" height="20">', '![](a.png)'],
				['a changed comment', 'a <!-- c --> b', 'a <!-- d --> b'],
				['a comment written as text', 'a <!-- c --> b', 'a &lt;!-- c --> b'],
				['List<String> written as text', 'use List<String> here', 'use List&lt;String> here'],
				['mark', 'a <mark>x</mark> b', 'a x b'],
				['a link with a class', 'a <a href="doc.md" class="x">doc</a> c', 'a [doc](doc.md) c'],
				['a div', '<div>hi <b>there</b></div>', 'hi **there**'],
				['a table in HTML', '<table><tr><td>a</td></tr></table>', '| a   |\n| --- |'],
				['a toggle with a class', '<details class="x">\n<summary>T</summary>\n</details>', '<details>\n<summary>T</summary>\n</details>'],
				['a video that plays itself', '<video src="clip.mp4" controls autoplay></video>', '<video src="clip.mp4" controls></video>'],
				['a video with a source', '<video controls><source src="clip.mp4"></video>', '<video src="clip.mp4" controls></video>'],
				['a fence\'s info string', '```js title="x"\na\n```', '```js\na\n```'],
				['a definition', '[docs]: https://example.com/docs', ''],
				['a footnote', '[^1]: Note.', ''],
				['an end tag that closes nothing', 'a </u> b', 'a  b'],
				['a tag that is never closed', 'a <u>b', 'a <u>b</u>'],
				['formats in a caption', '<figure><img src="a.png"><figcaption>a <b>b</b></figcaption></figure>', '<figure><img src="a.png"><figcaption>a b</figcaption></figure>']
			]);
		});

		test('is not the same where the card shows something else', () => {
			assertDifferent([
				['a picture inside text', 'text ![A](a.png) more', 'text  more'],
				['a picture inside a link', '[![A](a.png)](https://example.com)', '![A](a.png)'],
				['a picture inside a link and the link', '[![A](a.png)](https://example.com)', '[](https://example.com)'],
				['two pictures on a line', '![A](a.png) ![B](b.png)', '![A](a.png)\n\n![B](b.png)'],
				['a loose and a tight list', '- a\n\n- b', '- a\n- b'],
				['a first number', '4. four', '1. four'],
				['a quote of two paragraphs', '> one\n>\n> two', '> one\\\n> two'],
				['a quote with a list', '> quote\n>\n> - in quote', '> quotein quote'],
				['a toggle with text right after its title', '<details>\n<summary>T</summary>\nbody\n</details>', '<details>\n<summary>T</summary>\n\nbody\n\n</details>'],
				['a centered column', '| a |\n|:-:|\n| b |', '| a   |\n| --- |\n| b   |'],
				['an address', '[a](x.md)', '[a](y.md)'],
				['strikethrough', 'a ~~b~~', 'a b'],
				['a heading\'s level', '## T', '### T'],
				['code', '```\na\n```', '```\nb\n```'],
				['a language', '```js\na\n```', '```\na\n```'],
				['a check', '- [ ] a', '- [x] a'],
				['a line break alone', '<br>', ''],
				['two line breaks that end a paragraph, the first of which shows', 'a<br><br>', 'a'],
				['a row of cells of line breaks alone, as tall as a line', '| a |\n| --- |\n| <br> |', '| a   |\n| --- |\n|     |'],
				['a toggle\'s open state', '<details open>\n<summary>T</summary>\n</details>', '<details>\n<summary>T</summary>\n</details>'],
				['a picture\'s width', '<img alt="A" src="a.png" width="320">', '<img alt="A" src="a.png" width="321">'],
				['a picture\'s name', '![A](a.png)', '![B](a.png)'],
				['a caption', '<figure><img src="a.png"><figcaption>a</figcaption></figure>', '<figure><img src="a.png"><figcaption>b</figcaption></figure>'],
				['a video and a picture', '<video src="clip.mp4" controls></video>', '<img src="clip.mp4">'],
				['a video without its controls', '<video src="clip.mp4"></video>', '<video src="clip.mp4" controls></video>'],
				// The card shows a caption that comes first above the picture, and Rich writes it below.
				['a caption before the picture', '<figure><figcaption>c</figcaption><img alt="A" src="a.png"></figure>', '<figure><img alt="A" src="a.png"><figcaption>c</figcaption></figure>'],
				['a caption before a video', '<figure>\n<figcaption>c</figcaption>\n<video src="clip.mp4" controls></video>\n</figure>', '<figure><video src="clip.mp4" controls></video><figcaption>c</figcaption></figure>'],
				// The card shows a Markdown picture whose address holds `|` at the address before it, at the width after it.
				['a picture with its width after a pipe', '![x](x.png|width=50)', '<img alt="x" src="x.png" width="50">'],
				['a picture whose address holds a pipe', '![chart](charts/a|b.png)', '<img alt="chart" src="charts/a|b.png">'],
				// A first paragraph that shows nothing makes the item loose.
				['an empty first paragraph', '- &#32;\n\n  para', '- para']
			]);
		});

		test('decodes character references with the decoder it is given', () => {
			const decode = (value: string) => decodeBaseHalfSmallCharacterReferences(value).replace(/&copy;/g, '\u{00a9}');
			assert.deepStrictEqual([
				baseHalfMarkdownShowsSame('a &copy; b', 'a \u{00a9} b'),
				baseHalfMarkdownShowsSame('a &copy; b', 'a \u{00a9} b', { decodeCharacterReferences: decode })
			], [false, true]);
		});
	});

	suite('baseHalfMarkdownShownSignature', () => {
		test('holds the blocks, the formats, and what Rich cannot write', () => {
			assert.deepStrictEqual(baseHalfMarkdownShownSignature('# T\n\na **b** <!-- c -->\n\n[docs]: https://example.com/docs "D"').split('\n'), [
				'heading 1',
				'text [["T","","","",null,""]]',
				'paragraph',
				'text [["a ","","","",null,""],["b","b","","",null,""],[" ","","","",null,""],["","","","",null,"","<!-- c -->",""]]',
				'definition ["docs","https://example.com/docs","D"]'
			]);
		});
	});
});
