/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { type Token, type Tokens } from '../../../../../base/common/marked/marked.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfNoteBlock, IBaseHalfNoteListHint } from '../../common/basehalfNoteBlocks.js';
import { baseHalfCardLexer, IBaseHalfNoteLink, IBaseHalfNoteStyledText, IBaseHalfNoteTextStyles } from '../../common/basehalfNoteInline.js';
import { baseHalfNoteListHints, postProcessBaseHalfNoteBlocks } from '../../common/basehalfNoteStructure.js';
import {
	baseHalfNoteBlockKind,
	baseHalfNoteDisplayWidth,
	baseHalfNoteFewestLineBreaks,
	baseHalfNoteFollowingListItem,
	baseHalfNoteListItemMarker,
	baseHalfNoteRequiredLineBreaks,
	IBaseHalfNoteWriteHints,
	writeBaseHalfNoteBlock,
	writeBaseHalfNoteBlocks,
	writeBaseHalfToggleHeader
} from '../../common/basehalfNoteWriter.js';

interface ITestBlock {
	readonly id?: string;
	readonly type: string;
	readonly props: Record<string, unknown>;
	readonly content?: unknown;
	readonly children: ITestBlock[];
	readonly basehalfOpen?: boolean;
	readonly basehalfHints?: IBaseHalfNoteListHint;
}

function text(value: string, styles: IBaseHalfNoteTextStyles = {}): IBaseHalfNoteStyledText {
	return { type: 'text', text: value, styles };
}

function link(href: string, ...content: IBaseHalfNoteStyledText[]): IBaseHalfNoteLink {
	return { type: 'link', href, content };
}

function block(type: string, props: Record<string, unknown> = {}, content?: unknown, children: ITestBlock[] = []): ITestBlock {
	return { type, props, content, children };
}

function withId(id: string, value: ITestBlock): ITestBlock {
	return { ...value, id };
}

const paragraph = (...content: (IBaseHalfNoteStyledText | IBaseHalfNoteLink)[]) => block('paragraph', {}, content);
const words = (value: string) => [text(value)];
const bullet = (value: string, ...children: ITestBlock[]) => block('bulletListItem', {}, words(value), children);
const numbered = (value: string, ...children: ITestBlock[]) => block('numberedListItem', {}, words(value), children);
const check = (value: string, checked = false, ...children: ITestBlock[]) => block('checkListItem', { checked }, words(value), children);
const toggle = (title: unknown, ...children: ITestBlock[]) => block('toggleListItem', {}, title, children);
const cell = (content: unknown, textAlignment?: string) => ({ type: 'tableCell', props: textAlignment ? { textAlignment } : {}, content });
const table = (...rows: unknown[][]) => block('table', {}, { type: 'tableContent', columnWidths: [], rows: rows.map(cells => ({ cells })) });

/** Blocks as the reader's block pass gives them, with what the file wrote of each list item. */
function read(markdown: string, blocks: readonly ITestBlock[]): IBaseHalfNoteBlock[] {
	return postProcessBaseHalfNoteBlocks(blocks, { listHints: baseHalfNoteListHints(baseHalfCardLexer().lex(markdown)), source: markdown });
}

/** Gives every block an id, in the order of the document, so that the hints can name them. */
function withIds(blocks: readonly ITestBlock[], prefix = 'b'): ITestBlock[] {
	return blocks.map((value, index) => withId(`${prefix}${index}`, { ...value, children: withIds(value.children, `${prefix}${index}.`) }));
}

/** A copy of a block of `blocks` at `path`, changed. */
function changed(blocks: readonly IBaseHalfNoteBlock[], path: readonly number[], change: (value: IBaseHalfNoteBlock) => IBaseHalfNoteBlock): IBaseHalfNoteBlock[] {
	const [index, ...rest] = path;
	return blocks.map((value, at) => at !== index ? value : rest.length === 0 ? change(value) : { ...value, children: changed(value.children ?? [], rest, change) });
}

/** A seeded sequence of numbers in [0, 1), so that every run tests the same trees. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
}

suite('BaseHalfNoteWriter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('writes every block example of the design byte for byte', () => {
		const rows: [string, ITestBlock[], string][] = [
			['a closed toggle', [toggle(words('Title'), bullet('a'), bullet('b'))], '<details>\n<summary>Title</summary>\n\n- a\n- b\n\n</details>'],
			['an open toggle', [{ ...toggle(words('Title'), paragraph(text('body'))), basehalfOpen: true }], '<details open>\n<summary>Title</summary>\n\nbody\n\n</details>'],
			['a toggle heading', [block('heading', { level: 2, isToggleable: true }, words('Title'), [paragraph(text('body'))])], '<details>\n<summary><h2>Title</h2></summary>\n\nbody\n\n</details>'],
			[
				'nested toggles',
				[toggle(words('Outer'), toggle(words('Inner'), paragraph(text('inner body'))))],
				'<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\ninner body\n\n</details>\n\n</details>'
			],
			['a toggle without children', [toggle(words('Title'))], '<details>\n<summary>Title</summary>\n</details>'],
			['a toggle without a title', [toggle([])], '<details>\n<summary></summary>\n</details>'],
			[
				'a toggle with a formatted title',
				[toggle([text('Bold', { bold: true }), text(' and '), text('u', { underline: true }), text(' '), text('red', { textColor: 'red' }), text(' '), link('a b.md', text('doc')), text(' '), text('x<y', { code: true }), text(' & co')], paragraph(text('body')))],
				'<details>\n<summary><strong>Bold</strong> and <u>u</u> <span style="color:#e8706b;">red</span> <a href="a%20b.md">doc</a> <code>x&lt;y</code> &amp; co</summary>\n\nbody\n\n</details>'
			],
			[
				'a toggle heading holding a video and a list',
				[block('heading', { level: 3, isToggleable: true }, words('H'), [block('video', { url: 'v.webm' }), bullet('x'), bullet('y')])],
				'<details>\n<summary><h3>H</h3></summary>\n\n<video src="v.webm" controls></video>\n\n- x\n- y\n\n</details>'
			],
			['a toggle in a list item', [bullet('item', toggle(words('T'), paragraph(text('body'))))], '- item\n\n  <details>\n  <summary>T</summary>\n\n  body\n\n  </details>'],
			['a numbered item holding a paragraph', [numbered('Step', paragraph(text('Explanation')))], '1. Step\n\n   Explanation'],
			['an item holding code', [bullet('item', block('codeBlock', { language: 'js' }, words('const a = 1;')))], '- item\n\n  ```js\n  const a = 1;\n  ```'],
			['an item holding a picture', [bullet('item', block('image', { url: 'a.png', name: 'A' }))], '- item\n\n  ![A](a.png)'],
			['a paragraph under a nested item', [bullet('a', bullet('b', paragraph(text('para under b'))))], '- a\n  - b\n\n    para under b'],
			['a tight nested list', [bullet('a', bullet('b'), bullet('c'))], '- a\n  - b\n  - c'],
			['a list and a paragraph under an item', [bullet('a', bullet('sub'), paragraph(text('para')))], '- a\n  - sub\n\n  para'],
			['a check item holding a paragraph', [check('todo', false, paragraph(text('para')))], '- [ ] todo\n\n  para'],
			['a line break in a list item', [bullet('line one\nline two')], '- line one\\\n  line two'],
			['check items', [block('checkListItem', {}, [text('todo '), text('x', { underline: true })]), check('done', true)], '- [ ] todo <u>x</u>\n- [x] done'],
			['a heading with a line break', [block('heading', { level: 2 }, words('a\nb'))], '## a<br>b'],
			['a heading ending in #', [block('heading', { level: 3 }, words('C#'))], '### C\\#'],
			['a quote with a format and a line break', [block('quote', {}, [text('a '), text('b', { underline: true }), text('\nc')])], '> a <u>b</u>\\\n> c'],
			['a picture', [block('image', { url: 'a.png', name: 'A' })], '![A](a.png)'],
			['a picture 320 pixels wide', [block('image', { url: 'a.png', name: 'A', previewWidth: 320 })], '<img alt="A" src="a.png" width="320">'],
			['a picture with a width and a caption', [block('image', { url: 'a.png', name: 'A', previewWidth: 320, caption: 'c' })], '<figure><img alt="A" src="a.png" width="320"><figcaption>c</figcaption></figure>'],
			['a picture named with a bracket', [block('image', { url: 'a.png', name: 'a ] c' })], '<img alt="a ] c" src="a.png">'],
			['a caption with & and <', [block('image', { url: 'a.png', name: 'A', caption: 'Salt & Pepper <3' })], '<figure><img alt="A" src="a.png"><figcaption>Salt &amp; Pepper &lt;3</figcaption></figure>'],
			['a video', [block('video', { url: 'clip.mp4' })], '<video src="clip.mp4" controls></video>'],
			['a video 480 pixels wide', [block('video', { url: 'clip.mp4', previewWidth: 480 })], '<video src="clip.mp4" width="480" controls></video>'],
			['a video with a caption', [block('video', { url: 'clip.mp4', caption: 'c' })], '<figure><video src="clip.mp4" controls></video><figcaption>c</figcaption></figure>'],
			['a sound', [block('audio', { url: 'sound.mp3' })], '<audio src="sound.mp3" controls></audio>'],
			['a sound with a caption', [block('audio', { url: 'sound.mp3', caption: 'c' })], '<figure><audio src="sound.mp3" controls></audio><figcaption>c</figcaption></figure>'],
			['a file named as its address', [block('file', { url: 'handout.pdf', name: 'handout.pdf' })], '[handout.pdf](handout.pdf)'],
			['a file with a space', [block('file', { url: 'attachments/my%20handout.pdf', name: 'my handout.pdf' })], '[my handout.pdf](attachments/my%20handout.pdf)'],
			['an empty picture between two paragraphs', [paragraph(text('before')), block('image', { url: '' }), paragraph(text('after'))], 'before\n\nafter'],
			[
				'a table with a centered and a right-aligned column',
				[table([cell(words('L')), cell(words('C'), 'center'), cell(words('R'), 'right')], [cell(words('1')), cell(words('2'), 'center'), cell(words('3'), 'right')])],
				'| L   | C   | R   |\n| --- | :-: | --: |\n| 1   | 2   | 3   |'
			],
			['a table with an empty header row', [table([cell([]), cell([])], [cell(words('a')), cell(words('b'))])], '|     |     |\n| --- | --- |\n| a   | b   |'],
			['a pipe and a line break in cells', [table([cell(words('a')), cell(words('b'))], [cell(words('x | y')), cell(words('one\ntwo'))])], '| a      | b          |\n| ------ | ---------- |\n| x \\| y | one<br>two |'],
			['wide characters in a table', [table([cell(words('名称')), cell(words('Qty'))], [cell(words('橙子')), cell(words('1'))])], '| 名称 | Qty |\n| ---- | --- |\n| 橙子 | 1   |'],
			['code in the language text', [block('codeBlock', { language: 'text' }, words('plain'))], '```\nplain\n```'],
			['a divider between paragraphs', [paragraph(text('above')), block('divider'), paragraph(text('below'))], 'above\n\n---\n\nbelow'],
			['two toggles', [toggle(words('Q1'), paragraph(text('A1'))), toggle(words('Q2'), paragraph(text('A2')))], '<details>\n<summary>Q1</summary>\n\nA1\n\n</details>\n\n<details>\n<summary>Q2</summary>\n\nA2\n\n</details>']
		];
		for (const [name, blocks, expected] of rows) {
			assert.strictEqual(writeBaseHalfNoteBlocks(blocks), expected, name);
		}
		// Each toggle of two on adjacent lines is written alone; the line between them is the file's (rule 67).
		assert.strictEqual(writeBaseHalfNoteBlock(toggle(words('Q2'), paragraph(text('A2')))), '<details>\n<summary>Q2</summary>\n\nA2\n\n</details>');
	});

	test('keeps the marker, number, indentation, and line breaks the file gave a list item', () => {
		const rows: [string, ITestBlock[]][] = [
			['* a\n* b', [bullet('a'), bullet('b')]],
			['+ a\n  + b', [bullet('a', bullet('b'))]],
			['1) one\n2) two', [numbered('one'), numbered('two')]],
			// The editor reads no start for this item; the file's number stays.
			['4. four\n   - sub', [numbered('four', bullet('sub'))]],
			['1. a\n1. b\n1. c', [numbered('a'), numbered('b'), numbered('c')]],
			['- a\n    - b\n    - c', [bullet('a', bullet('b'), bullet('c'))]],
			['- a\n\n  - b\n\n  - c', [bullet('a', bullet('b'), bullet('c'))]],
			['1. Install\n\n   - npm install\n   - npm test', [numbered('Install', bullet('npm install'), bullet('npm test'))]],
			['- a\n\n\n  para', [bullet('a', paragraph(text('para')))]],
			['* a\n  + b\n  + c\n\n  para', [bullet('a', bullet('b'), bullet('c'), paragraph(text('para')))]],
			['- a\n\n  para\n\n  - sub\n\n  after', [bullet('a', paragraph(text('para')), bullet('sub'), paragraph(text('after')))]],
			['10. ten\n\n    para', [{ ...numbered('ten', paragraph(text('para'))), props: { start: 10 } }]],
			['- [ ] todo\n\n  para', [check('todo', false, paragraph(text('para')))]],
			['- line one\\\n  line two', [bullet('line one\nline two')]],
			['- a\n  - b\\\n    c', [bullet('a', bullet('b\nc'))]],
			['- a\n  # h\n  para', [bullet('a', block('heading', { level: 1 }, words('h')), paragraph(text('para')))]]
		];
		for (const [markdown, blocks] of rows) {
			assert.strictEqual(writeBaseHalfNoteBlocks(read(markdown, withIds(blocks))), markdown, markdown);
		}
	});

	test('keeps the line breaks between untouched children of an edited item, while they keep their kinds', () => {
		const spaced = read('- a\n\n  - b\n\n  - c', withIds([bullet('a', bullet('b'), bullet('c'))]));
		const rename = (value: IBaseHalfNoteBlock) => ({ ...value, content: words('B') });
		assert.strictEqual(writeBaseHalfNoteBlocks(changed(spaced, [0, 0], rename)), '- a\n\n  - B\n\n  - c');
		assert.strictEqual(writeBaseHalfNoteBlocks(changed(spaced, [0], value => ({ ...value, content: words('A') }))), '- A\n\n  - b\n\n  - c');
		// A pair of which one changed its kind gets the line breaks Markdown needs.
		const tight = read('- a\n  - b\n  - c', withIds([bullet('a', bullet('b'), bullet('c'))]));
		const toParagraph = (value: IBaseHalfNoteBlock) => ({ ...value, type: 'paragraph', props: {} });
		assert.strictEqual(writeBaseHalfNoteBlocks(changed(tight, [0, 0], toParagraph)), '- a\n\n  b\n\n  - c');
		assert.strictEqual(writeBaseHalfNoteBlocks(changed(tight, [0, 1], value => ({ ...value, type: 'numberedListItem' }))), '- a\n  - b\n\n  1. c');
		assert.strictEqual(writeBaseHalfNoteBlocks(changed(tight, [0, 0], value => ({ ...value, basehalfHints: { marker: '*' } }))), '- a\n  * b\n\n  - c');
		// Children that become neighbours, or move, get the line breaks Markdown needs.
		const [item] = tight;
		const [b, c] = item.children!;
		assert.strictEqual(writeBaseHalfNoteBlocks([{ ...item, children: [c, b] }]), '- a\n  - c\n  - b');
		assert.strictEqual(writeBaseHalfNoteBlocks([{ ...item, children: [b, c, paragraph(text('new'))] }]), '- a\n  - b\n  - c\n\n  new');
		assert.strictEqual(writeBaseHalfNoteBlocks([{ ...item, children: [paragraph(text('new')), b, c] }]), '- a\n\n  new\n\n  - b\n  - c');
		// A number that a list item starts at stays through an edit of its text.
		const four = read('4. four\n   - sub', withIds([numbered('four', bullet('sub'))]));
		assert.strictEqual(writeBaseHalfNoteBlocks(changed(four, [0], value => ({ ...value, content: words('four!') }))), '4. four!\n   - sub');
	});

	test('numbers a new item after the items before it, continuing or repeating their numbers', () => {
		const item = numbered('new');
		const marker = (hints: IBaseHalfNoteWriteHints, value: ITestBlock = item) => writeBaseHalfNoteBlock(value, hints).split(' ')[0];
		assert.strictEqual(marker({}), '1.', 'a new first item');
		assert.strictEqual(marker({}, { ...item, props: { start: 5 } }), '5.', 'the number typed');
		assert.strictEqual(marker({ previousListItem: { marker: '2.', numbers: [1, 2] } }), '3.', 'continuing');
		assert.strictEqual(marker({ previousListItem: { marker: '1.', numbers: [1, 1] } }), '1.', 'repeating');
		assert.strictEqual(marker({ previousListItem: { marker: '3)', numbers: [3] } }), '4)', 'the delimiter before it');
		assert.strictEqual(marker({ previousListItem: { marker: '-', numbers: [] } }), '1.', 'after a bullet, a new run');
		// In one container, each item continues the run before it.
		const lazy = read('1. a\n1. b', withIds([numbered('a'), numbered('b')]));
		assert.strictEqual(writeBaseHalfNoteBlocks([...lazy, numbered('c')]), '1. a\n1. b\n1. c');
		const counted = read('1. a\n2. b', withIds([numbered('a'), numbered('b')]));
		assert.strictEqual(writeBaseHalfNoteBlocks([...counted, numbered('c')]), '1. a\n2. b\n3. c');
		assert.strictEqual(writeBaseHalfNoteBlocks([counted[0], numbered('new'), counted[1]]), '1. a\n2. new\n2. b');
		// Between two items of one number, a new item takes that number too.
		assert.strictEqual(writeBaseHalfNoteBlocks([lazy[0], numbered('new'), lazy[1]]), '1. a\n1. new\n1. b');
		const nested = read('- list\n  1. a\n  1. b\n  1. c', withIds([bullet('list', numbered('a'), numbered('b'), numbered('c'))]));
		const [first, ...others] = nested[0].children!;
		assert.strictEqual(writeBaseHalfNoteBlocks([{ ...nested[0], children: [first, numbered('new'), ...others] }]), '- list\n  1. a\n  1. new\n  1. b\n  1. c');
		assert.strictEqual(marker({ previousListItem: { marker: '1.', numbers: [1] }, nextListItem: { marker: '1.' } }), '1.', 'repeating the item after it');
		assert.strictEqual(marker({ previousListItem: { marker: '1.', numbers: [1] }, nextListItem: { marker: '2.' } }), '2.', 'continuing to the item after it');
		assert.strictEqual(marker({ previousListItem: { marker: '1.', numbers: [1] }, nextListItem: { marker: '1)' } }), '2.', 'an item after it of another list');
		// An item that becomes the first of its run shows the number its list starts at.
		assert.strictEqual(writeBaseHalfNoteBlocks([counted[1], counted[0]]), '1. b\n1. a');
		const followed = baseHalfNoteFollowingListItem(counted[1], { previousListItem: baseHalfNoteFollowingListItem(counted[0]) });
		assert.deepStrictEqual(followed, { marker: '2.', numbers: [1, 2] });
		assert.strictEqual(baseHalfNoteFollowingListItem(paragraph(text('x')), { previousListItem: followed }), undefined);
		assert.strictEqual(baseHalfNoteListItemMarker(item, { previousListItem: followed }), '3.');
		assert.strictEqual(baseHalfNoteListItemMarker(paragraph(text('x'))), undefined);
	});

	test('gives a new bullet the marker of the item before it', () => {
		assert.strictEqual(writeBaseHalfNoteBlock(bullet('x'), { previousListItem: { marker: '*', numbers: [] } }), '* x');
		assert.strictEqual(writeBaseHalfNoteBlock(check('x'), { previousListItem: { marker: '+', numbers: [] } }), '+ [ ] x');
		assert.strictEqual(writeBaseHalfNoteBlock(bullet('x'), { previousListItem: { marker: '1.', numbers: [1] } }), '- x');
		const stars = read('* a', withIds([bullet('a')]));
		assert.strictEqual(writeBaseHalfNoteBlocks([...stars, bullet('b'), check('c')]), '* a\n* b\n* [ ] c');
		// An item whose kind changed takes the marker of a new item.
		assert.strictEqual(writeBaseHalfNoteBlocks([{ ...stars[0], type: 'numberedListItem' }]), '1. a');
		assert.deepStrictEqual(baseHalfNoteBlockKind(stars[0]), { type: 'bulletListItem', marker: '*', task: false });
		assert.deepStrictEqual(baseHalfNoteBlockKind(numbered('n'), { previousListItem: { marker: '4)', numbers: [4] } }), { type: 'numberedListItem', marker: ')', task: false });
		assert.deepStrictEqual(baseHalfNoteBlockKind(block('heading', { level: 2, isToggleable: true })), { type: 'heading', toggle: true });
	});

	test('fences code with more backticks than any run that starts a line of it', () => {
		const code = (value: string, language = '') => writeBaseHalfNoteBlock(block('codeBlock', { language }, words(value)));
		assert.strictEqual(code('Example:\n  ```js\n  let a = 1;\n  ```\nDone.', 'markdown'), '````markdown\nExample:\n  ```js\n  let a = 1;\n  ```\nDone.\n````');
		assert.strictEqual(code('````\nx'), '`````\n````\nx\n`````');
		// Four spaces before backticks are no fence, and backticks inside a line close nothing.
		assert.strictEqual(code('    ```\nx ``` y\n``'), '```\n    ```\nx ``` y\n``\n```');
		assert.strictEqual(code('\tgo build ./...', 'make'), '```make\n\tgo build ./...\n```');
		assert.strictEqual(code(''), '```\n```');
		assert.strictEqual(code('a\n'), '```\na\n\n```');
		// A fence's info string takes no backtick; a tilde fence holds one.
		assert.strictEqual(code('~~~\nx', 'a`b'), '~~~~a`b\n~~~\nx\n~~~~');
		assert.strictEqual(code('x', 'js extra words'), '```js\nx\n```');
		const fence = writeBaseHalfNoteBlock(bullet('item', block('codeBlock', {}, words('  ```\nin'))));
		assert.strictEqual(fence, '- item\n\n  ````\n    ```\n  in\n  ````');
		assert.deepStrictEqual(baseHalfCardLexer().lex(fence).map(token => token.type), ['list']);
	});

	test('writes an empty check item with a space after its box that nothing takes away', () => {
		assert.strictEqual(writeBaseHalfNoteBlock(check('')), '- [ ] &#32;');
		assert.strictEqual(writeBaseHalfNoteBlock(check('', true)), '- [x] &#32;');
		assert.strictEqual(writeBaseHalfNoteBlock(bullet('')), '-');
		assert.strictEqual(writeBaseHalfNoteBlock(numbered('')), '1.');
		const nested = writeBaseHalfNoteBlock(bullet('a', check('')));
		assert.strictEqual(nested, '- a\n  - [ ] &#32;');
		// It stays a check item where the projection cuts the white space off the end of a block, and where a tool trims lines.
		const blocks = writeBaseHalfNoteBlocks([check(''), paragraph(text('next'))]);
		assert.strictEqual(blocks, '- [ ] &#32;\n\nnext');
		for (const markdown of [nested, blocks.split('\n')[0].trimEnd()]) {
			let list = baseHalfCardLexer().lex(markdown)[0] as Tokens.List;
			if (markdown === nested) {
				list = list.items[0].tokens[1] as Tokens.List;
			}
			assert.ok(list.items[0].task, markdown);
		}
		// A lone `-` under an item's text would make the text a heading.
		assert.strictEqual(writeBaseHalfNoteBlock(bullet('a', bullet(''))), '- a\n\n  -');
	});

	test('writes an item without text so that it holds its children, and they stay its children', () => {
		const empty = (type: string, ...children: ITestBlock[]) => block(type, type === 'checkListItem' ? { checked: false } : {}, [], children);
		const rows: [string, ITestBlock, string][] = [
			// What starts a block of its own stands right under the marker.
			['a list', empty('bulletListItem', bullet('child')), '-\n  - child'],
			['a numbered list', empty('numberedListItem', numbered('child')), '1.\n   1. child'],
			['a heading', empty('bulletListItem', block('heading', { level: 2 }, words('T'))), '-\n  ## T'],
			['a quote', empty('bulletListItem', block('quote', {}, words('q'))), '-\n  > q'],
			['code', empty('bulletListItem', block('codeBlock', { language: 'js' }, words('x = 1'))), '-\n  ```js\n  x = 1\n  ```'],
			['a toggle', empty('bulletListItem', toggle(words('T'), paragraph(text('in')))), '-\n  <details>\n  <summary>T</summary>\n\n  in\n\n  </details>'],
			['a picture', empty('bulletListItem', block('image', { url: 'a.png', name: 'A' })), '-\n  ![A](a.png)'],
			// A paragraph or a file there would be the item's text, and a rule would make a heading of the text above:
			// the item keeps a line of its own.
			['a paragraph', empty('bulletListItem', paragraph(text('para'))), '- &#32;\n\n  para'],
			['a divider', empty('numberedListItem', block('divider')), '1. &#32;\n\n   ---'],
			['a file', empty('numberedListItem', block('file', { url: 'f.pdf', name: 'f.pdf' })), '1. &#32;\n\n   [f.pdf](f.pdf)'],
			['a fixed block', empty('bulletListItem', block('rawPassthrough', { source: 'a <mark>b</mark>' })), '- &#32;\n\n  a <mark>b</mark>'],
			['a paragraph, then a list', empty('bulletListItem', paragraph(text('para')), bullet('x')), '- &#32;\n\n  para\n\n  - x'],
			// A check item always keeps its line.
			['a check item holding a list', empty('checkListItem', bullet('child')), '- [ ] &#32;\n  - child'],
			['a check item holding a paragraph', empty('checkListItem', paragraph(text('para'))), '- [ ] &#32;\n\n  para']
		];
		for (const [name, value, expected] of rows) {
			const written = writeBaseHalfNoteBlock(value);
			assert.strictEqual(written, expected, name);
			// The card reads one item, whose own text is no child of it: a space, or a picture, which the item holds as a block.
			const lists = baseHalfCardLexer().lex(written);
			assert.deepStrictEqual(lists.map(token => token.type), ['list'], name);
			const items = (lists[0] as Tokens.List).items;
			assert.strictEqual(items.length, 1, name);
			const [own] = items[0].tokens;
			const ownText = own.type === 'text' || own.type === 'paragraph' ? own.raw.trim() : undefined;
			assert.ok(ownText === undefined || ownText === '&#32;' || /^!\[/.test(ownText), `${name}: ${JSON.stringify(ownText)}`);
		}
		// The line breaks the file had before the first child stay, while it keeps its kind.
		const loose = read('- &#32;\n\n  - child', withIds([empty('bulletListItem', bullet('child'))]));
		assert.deepStrictEqual(loose[0].basehalfHints?.separators, ['\n\n']);
		assert.strictEqual(writeBaseHalfNoteBlocks(loose), '- &#32;\n\n  - child');
		const tight = read('-\n  - child', withIds([empty('bulletListItem', bullet('child'))]));
		assert.strictEqual(writeBaseHalfNoteBlocks(tight), '-\n  - child');
		// Under an item's text, the reader starts a list at any marker, but a rule under a marker alone makes a heading.
		const under = writeBaseHalfNoteBlock(numbered('a', empty('numberedListItem', block('divider')), block('numberedListItem', { start: 15 }, [])));
		assert.strictEqual(under, '1. a\n   1. &#32;\n\n      ---\n   2.');
		const [outer] = (baseHalfCardLexer().lex(under)[0] as Tokens.List).items;
		assert.deepStrictEqual(outer.tokens.filter(token => token.type !== 'space').map(token => token.type), ['text', 'list']);
		assert.strictEqual(writeBaseHalfNoteBlock(bullet('A test of a row that\ncriteria 12 to', block('numberedListItem', { start: 15 }, []))), '- A test of a row that\\\n  criteria 12 to\n  15.');
		// So does an empty bullet's lone `-` under a marker alone.
		const nested = writeBaseHalfNoteBlock(bullet('a', empty('numberedListItem', empty('bulletListItem', bullet('x')))));
		assert.strictEqual(nested, '- a\n  1. &#32;\n\n     -\n       - x');
		const shape = (tokens: readonly Token[]): string => tokens.filter(token => token.type !== 'space').map(token => token.type === 'list' ? `list(${(token as Tokens.List).items.map(item => shape(item.tokens)).join('|')})` : token.type).join(',');
		assert.strictEqual(shape(baseHalfCardLexer().lex(nested)), 'list(text,list(text,list(list(text))))');
	});

	test('keeps the full-width space that ends a list\'s last item in that item', () => {
		// The card's reader trims the end of a list's last item, and would read the space as a paragraph after the list.
		for (const [value, expected] of [
			[bullet('item', paragraph(text('中文段落\u{3000}'))), '- item\n\n  中文段落&#12288;'],
			[bullet('item', block('quote', {}, words('引文\u{3000}'))), '- item\n\n  > 引文&#12288;'],
			[numbered('item', bullet('子项', paragraph(text('段落\u{3000}')))), '1. item\n   - 子项\n\n     段落&#12288;']
		] as const) {
			const written = writeBaseHalfNoteBlocks([value]);
			assert.strictEqual(written, expected);
			assert.deepStrictEqual(baseHalfCardLexer().lex(written).filter(token => token.type !== 'space').map(token => token.type), ['list'], expected);
		}
	});

	test('ends every line with the note\'s line ending', () => {
		const blocks = [
			bullet('a\nb', paragraph(text('child')), check('task')),
			toggle(words('T'), paragraph(text('one\ntwo')), table([cell(words('x'))], [cell(words('y'))])),
			block('codeBlock', {}, words('l1\r\nl2\nl3')),
			block('quote', {}, words('q1\nq2'))
		];
		const lf = writeBaseHalfNoteBlocks(blocks);
		const crlf = writeBaseHalfNoteBlocks(blocks, { eol: '\r\n' });
		assert.strictEqual(crlf, lf.replace(/\n/g, '\r\n'));
		assert.ok(!lf.includes('\r'));
		assert.ok(!/(^|[^\r])\n/.test(crlf));
		assert.strictEqual(writeBaseHalfToggleHeader(toggle(words('T')), { eol: '\r\n' }), '<details>\r\n<summary>T</summary>');
		// A fixed block keeps its own bytes.
		assert.strictEqual(writeBaseHalfNoteBlocks([paragraph(text('a')), block('rawPassthrough', { source: '<mark>x</mark>\nrest', raw: '\n<mark>x</mark>\nrest\n\n' })], { eol: '\r\n' }), 'a\r\n\r\n<mark>x</mark>\nrest');
	});

	test('writes nothing for empty media and empty paragraphs', () => {
		for (const type of ['image', 'video', 'audio', 'file']) {
			assert.strictEqual(writeBaseHalfNoteBlock(block(type, { url: '', name: 'n', caption: 'c' })), '', type);
		}
		assert.strictEqual(writeBaseHalfNoteBlock(paragraph()), '');
		assert.strictEqual(writeBaseHalfNoteBlock(paragraph(text('  \n '))), '');
		assert.strictEqual(writeBaseHalfNoteBlocks([bullet('a'), paragraph(), bullet('b')]), '- a\n- b');
		assert.strictEqual(writeBaseHalfNoteBlocks([]), '');
		assert.strictEqual(writeBaseHalfNoteBlock(bullet('a', paragraph(), block('image', {}))), '- a');
		assert.strictEqual(writeBaseHalfNoteBlock(toggle(words('T'), paragraph())), '<details>\n<summary>T</summary>\n</details>');
	});

	test('writes a reference link inline, and escapes text that would read as one', () => {
		assert.strictEqual(writeBaseHalfNoteBlock(paragraph(link('https://example.com/docs', text('the docs')))), '[the docs](https://example.com/docs)');
		const referenceLabels = new Set(['docs']);
		assert.strictEqual(writeBaseHalfNoteBlock(paragraph(text('see [docs] and [other]')), { referenceLabels }), 'see \\[docs\\] and [other]');
		assert.strictEqual(writeBaseHalfNoteBlock(bullet('[docs]'), { referenceLabels }), '- \\[docs\\]');
	});

	test('writes pictures, videos, sounds, and files with their addresses as a note stores them', () => {
		const image = (props: Record<string, unknown>) => writeBaseHalfNoteBlock(block('image', { url: 'a.png', ...props }));
		assert.strictEqual(image({ url: 'my pic.png' }), '![](my%20pic.png)');
		assert.strictEqual(image({ url: 'chart.png?v=2&times=3', name: 'R&amp;D' }), '![R&amp;amp;D](chart.png?v=2&times=3)');
		assert.strictEqual(image({ url: 'a "b".png', previewWidth: 12.6 }), '<img src="a%20&quot;b&quot;.png" width="13">');
		assert.strictEqual(image({ name: 'a\\b' }), '<img alt="a\\b" src="a.png">');
		assert.strictEqual(image({ name: 'a`b' }), '<img alt="a`b" src="a.png">');
		assert.strictEqual(image({ name: 'line\nbreak' }), '<img alt="line&#10;break" src="a.png">');
		// The card's renderer of a Markdown picture reads what follows a `|` in its address as its width and height.
		assert.strictEqual(image({ url: 'charts/a|b.png', name: 'chart' }), '<img alt="chart" src="charts/a|b.png">');
		assert.strictEqual(image({ url: 'https://chart.example.com/chart?cht=p3&chl=Hello|World' }), '<img src="https://chart.example.com/chart?cht=p3&amp;chl=Hello|World">');
		// A caption is one line, as the rich editor reads and shows it.
		assert.strictEqual(image({ caption: 'a\nb\r\nc' }), '<figure><img src="a.png"><figcaption>a b c</figcaption></figure>');
		for (const width of [0, -3, 100000, Number.NaN, '320']) {
			assert.strictEqual(image({ previewWidth: width }), '![](a.png)', String(width));
		}
		assert.strictEqual(writeBaseHalfNoteBlock(block('audio', { url: 's.ogg', previewWidth: 300, name: 'n' })), '<audio src="s.ogg" controls></audio>');
		assert.strictEqual(writeBaseHalfNoteBlock(block('file', { url: 'docs/lecture%20%231.pdf' })), '[lecture #1.pdf](docs/lecture%20%231.pdf)');
		assert.strictEqual(writeBaseHalfNoteBlock(block('file', { url: 'r.pdf', name: 'report [final]' })), '[report &#91;final&#93;](r.pdf)');
		// A file is never a bare address.
		assert.strictEqual(writeBaseHalfNoteBlock(block('file', { url: 'https://example.com/x.pdf', name: 'https://example.com/x.pdf' })), '[https://example.com/x.pdf](https://example.com/x.pdf)');
		const bare = baseHalfCardLexer().lex('[https://example.com/x.pdf](https://example.com/x.pdf)')[0] as Tokens.Paragraph;
		assert.deepStrictEqual(bare.tokens.map(token => token.type), ['link']);
	});

	test('writes headings, quotes, and blocks of other types', () => {
		assert.strictEqual(writeBaseHalfNoteBlock(block('heading', { level: 4 }, [])), '####');
		assert.strictEqual(writeBaseHalfNoteBlock(block('heading', { level: 9 }, words('x'))), '# x');
		assert.strictEqual(writeBaseHalfNoteBlock(block('heading', { level: 5, isToggleable: true }, words('T'))), '<details>\n<summary><h5>T</h5></summary>\n</details>');
		assert.strictEqual(writeBaseHalfNoteBlock(block('quote', {}, [])), '>');
		assert.strictEqual(writeBaseHalfNoteBlock(block('unknownBlock', {}, words('kept'))), 'kept');
		assert.strictEqual(writeBaseHalfNoteBlock(block('unknownBlock')), '');
		assert.strictEqual(writeBaseHalfNoteBlock(block('table', {}, { type: 'tableContent', rows: [] })), '');
		assert.strictEqual(writeBaseHalfNoteBlock(table([cell(words('a')), cell(words('b'))], [cell(words('c'))])), '| a   | b   |\n| --- | --- |\n| c   |     |');
		// The editor may hold a cell as its content alone.
		assert.strictEqual(writeBaseHalfNoteBlock(table([words('h')], [[text('v', { bold: true })]])), '| h     |\n| ----- |\n| **v** |');
		// The column's alignment is its first cell's that is not left.
		assert.strictEqual(writeBaseHalfNoteBlock(table([cell(words('a'))], [cell(words('b'), 'right')])), '| a   |\n| --: |\n| b   |');
		for (const value of [undefined, null, 3, 'text', [], { type: 3 }]) {
			assert.strictEqual(writeBaseHalfNoteBlock(value), '');
		}
		assert.strictEqual(writeBaseHalfNoteBlocks([null, paragraph(text('x')), 'text']), 'x');
	});

	test('writes the blocks under a block that may hold none after it, so that nothing is lost', () => {
		assert.strictEqual(writeBaseHalfNoteBlock(block('paragraph', {}, words('a'), [paragraph(text('b')), bullet('c', paragraph(text('d')))])), 'a\n\nb\n\n- c\n\n  d');
		assert.strictEqual(writeBaseHalfNoteBlock(bullet('item', block('quote', {}, words('q'), [bullet('x')]))), '- item\n\n  > q\n\n  - x');
		assert.strictEqual(writeBaseHalfNoteBlocks([block('image', { url: '' }, undefined, [paragraph(text('kept'))])]), 'kept');
	});

	test('writes a toggle\'s header alone', () => {
		assert.strictEqual(writeBaseHalfToggleHeader(toggle(words('T'), paragraph(text('body')))), '<details>\n<summary>T</summary>');
		assert.strictEqual(writeBaseHalfToggleHeader({ ...toggle(words('T')), basehalfOpen: true }), '<details open>\n<summary>T</summary>');
		assert.strictEqual(writeBaseHalfToggleHeader({ ...toggle(words('T')), basehalfOpen: true }, { isOpen: () => false }), '<details>\n<summary>T</summary>');
		assert.strictEqual(writeBaseHalfToggleHeader(block('heading', { level: 3, isToggleable: true }, [text('a & b', { italic: true })]), { isOpen: () => true }), '<details open>\n<summary><h3><em>a &amp; b</em></h3></summary>');
		assert.strictEqual(writeBaseHalfToggleHeader(block('heading', { level: 3 }, words('x'))), '');
		// A new toggle has no flag and is stored closed; a copied one has none either.
		assert.strictEqual(writeBaseHalfNoteBlock({ ...toggle(words('T')), id: 'n' }, { isOpen: value => value.id === 'open' }), '<details>\n<summary>T</summary>\n</details>');
	});

	test('takes list hints by id, and the hints on the blocks where there are none', () => {
		const item = withId('x', bullet('a', bullet('b')));
		assert.strictEqual(writeBaseHalfNoteBlock(item, { listHint: id => id === 'x' ? { marker: '+', childIndent: 4 } : undefined }), '+ a\n    - b');
		assert.strictEqual(writeBaseHalfNoteBlock({ ...item, basehalfHints: { marker: '*' } }, { listHint: () => undefined }), '* a\n  - b');
		// A hint that would end the item, or make code of its children, is not used.
		assert.strictEqual(writeBaseHalfNoteBlock({ ...item, basehalfHints: { marker: '-', childIndent: 1 } }), '- a\n  - b');
		assert.strictEqual(writeBaseHalfNoteBlock({ ...item, basehalfHints: { marker: '-', childIndent: 6 } }), '- a\n  - b');
		assert.strictEqual(writeBaseHalfNoteBlock({ ...item, basehalfHints: { marker: 'x' } as IBaseHalfNoteListHint }), '- a\n  - b');
		assert.strictEqual(writeBaseHalfNoteBlock({ ...item, basehalfHints: 'odd' as unknown as IBaseHalfNoteListHint }), '- a\n  - b');
	});

	test('puts between two blocks the fewest line breaks that keep both blocks', () => {
		const samples: Record<string, ITestBlock> = {
			paragraph: paragraph(text('para')),
			heading: block('heading', { level: 2 }, words('H')),
			quote: block('quote', {}, words('q')),
			bullet: bullet('b'),
			emptyBullet: bullet(''),
			numberedTwo: { ...numbered('n'), props: { start: 2 } },
			check: check('t'),
			code: block('codeBlock', {}, words('c')),
			divider: block('divider'),
			table: table([cell(words('x'))], [cell(words('y'))]),
			toggle: toggle(words('T')),
			picture: block('image', { url: 'a.png' }),
			sizedPicture: block('image', { url: 'a.png', previewWidth: 30 }),
			video: block('video', { url: 'v.mp4' }),
			file: block('file', { url: 'f.pdf' }),
			fixed: block('rawPassthrough', { source: '<mark>m</mark>' })
		};
		const kinds = (markdown: string) => baseHalfCardLexer().lex(markdown).filter(token => token.type !== 'space').map(token => token.type === 'list' ? `list${(token as Tokens.List).items.length}` : token.type);
		let pairs = 0;
		for (const [previousName, previous] of Object.entries(samples)) {
			for (const [nextName, next] of Object.entries(samples)) {
				const before = { kind: baseHalfNoteBlockKind(previous), text: writeBaseHalfNoteBlock(previous) };
				const after = { kind: baseHalfNoteBlockKind(next), text: writeBaseHalfNoteBlock(next) };
				const fewest = baseHalfNoteFewestLineBreaks(before, after);
				const apart = [...kinds(before.text), ...kinds(after.text)];
				const listPair = apart.length === 2 && apart.every(kind => kind === 'list1');
				const name = `${previousName} then ${nextName}`;
				// One line between two lists of one kind joins them into one list, as it should.
				if (!listPair || fewest === 2) {
					assert.deepStrictEqual(kinds(before.text + '\n'.repeat(fewest) + after.text), apart, name);
				}
				if (fewest === 2 && previousName !== 'fixed') {
					assert.notDeepStrictEqual(kinds(before.text + '\n' + after.text), apart, `${name}: one line break would do`);
				}
				assert.ok(baseHalfNoteRequiredLineBreaks(before, after) >= fewest, name);
				pairs++;
			}
		}
		assert.strictEqual(pairs, 256);
		const kind = (value: ITestBlock) => ({ kind: baseHalfNoteBlockKind(value), text: writeBaseHalfNoteBlock(value) });
		assert.strictEqual(baseHalfNoteRequiredLineBreaks(kind(bullet('a')), kind(check('b'))), 1);
		assert.strictEqual(baseHalfNoteRequiredLineBreaks(kind(bullet('a')), kind(numbered('b'))), 2);
		assert.strictEqual(baseHalfNoteRequiredLineBreaks(kind(numbered('a')), kind(numbered('b'))), 1);
		assert.strictEqual(baseHalfNoteRequiredLineBreaks(kind(paragraph(text('a'))), kind(paragraph(text('b')))), 2);
	});

	test('measures text in the columns of a monospaced font', () => {
		assert.strictEqual(baseHalfNoteDisplayWidth('abc'), 3);
		assert.strictEqual(baseHalfNoteDisplayWidth('名称'), 4);
		assert.strictEqual(baseHalfNoteDisplayWidth('😀'), 2);
		assert.strictEqual(baseHalfNoteDisplayWidth('e\u0301'), 1);
		assert.strictEqual(baseHalfNoteDisplayWidth('ｱｲ'), 2);
		assert.strictEqual(baseHalfNoteDisplayWidth('ＡＢ'), 4);
	});

	test('writes 1,000 random block trees without throwing, and the card reads each with the same blocks', () => {
		const random = seededRandom(20261103);
		const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
		const pieces = ['alpha', 'beta', '重点', 'x*y', 'a_b', '#tag', '[x]', '<u>', '&amp;', 'a | b', '`c`', '1.', '-', '>', 'https://example.com', 'me@example.com', '~~', '\\', '😀', '[[Note]]', '---'];
		const inlineContent = (lineBreaks: boolean) => Array.from({ length: 1 + Math.floor(random() * 4) }, () => {
			const styles: IBaseHalfNoteTextStyles = {
				bold: random() < 0.2, italic: random() < 0.15, underline: random() < 0.15, strike: random() < 0.1, code: random() < 0.08,
				...(random() < 0.1 ? { textColor: pick(['red', 'blue', 'default', '#123456']) } : {})
			};
			let value = pick(pieces) + (random() < 0.5 ? ' ' : '') + (random() < 0.3 ? pick(pieces) : '');
			if (lineBreaks && random() < 0.1) {
				value += `\n${pick(pieces)}`;
			}
			return random() < 0.12 ? link(pick(['https://example.com/a', 'doc.md', 'my file.md', 'a(b).md']), text(value, styles)) : text(value, styles);
		});
		const listTypes = ['bulletListItem', 'numberedListItem', 'checkListItem'];
		const tree = (depth: number): ITestBlock => {
			if (depth < 3 && random() < 0.4) {
				const children = Array.from({ length: Math.floor(random() * 4) }, () => tree(depth + 1));
				const type = pick([...listTypes, 'toggleListItem', 'toggleHeading']);
				if (type === 'toggleHeading') {
					return { ...block('heading', { level: 1 + Math.floor(random() * 3), isToggleable: true }, inlineContent(false), children), basehalfOpen: random() < 0.3 };
				}
				if (type === 'toggleListItem') {
					return { ...toggle(inlineContent(false), ...children), basehalfOpen: random() < 0.3 };
				}
				return block(type, type === 'checkListItem' ? { checked: random() < 0.5 } : {}, random() < 0.12 ? [] : inlineContent(true), children);
			}
			switch (pick(['paragraph', 'heading', 'quote', 'codeBlock', 'divider', 'table', 'image', 'video', 'audio', 'file'])) {
				case 'paragraph': return block('paragraph', {}, random() < 0.05 ? [] : inlineContent(true));
				case 'heading': return block('heading', { level: 1 + Math.floor(random() * 6) }, inlineContent(true));
				case 'quote': return block('quote', {}, inlineContent(true));
				case 'codeBlock': return block('codeBlock', { language: pick(['text', 'js', '']) }, words(pick(['x = 1', 'a\n  ```js\n  b\n  ```', '\tgo\n\n  tab', '', '~~~\nq'])));
				case 'divider': return block('divider');
				case 'table': {
					const columns = 1 + Math.floor(random() * 3);
					return table(...Array.from({ length: 1 + Math.floor(random() * 3) }, () => Array.from({ length: columns }, () => cell(random() < 0.2 ? [] : inlineContent(true), pick(['left', 'center', 'right'])))));
				}
				case 'image': return block('image', { url: pick(['a.png', 'my pic.png', '']), name: pick(['', 'A', 'a ] b']), caption: pick(['', 'cap & <c>']), previewWidth: pick([undefined, 320, 12.6]) });
				case 'video': return block('video', { url: pick(['clip.mp4', 'my clip.webm']), caption: pick(['', 'c']) });
				case 'audio': return block('audio', { url: pick(['s.mp3', 's.ogg']), caption: pick(['', 'c']) });
				default: return block('file', { url: pick(['handout.pdf', 'docs/lecture #1.pdf', 'https://example.com/x.pdf']), name: pick(['', 'my [file].pdf']) });
			}
		};
		// The blocks as the card's reader should find them: each list a run of items of one marker character or delimiter.
		const expected = (blocks: readonly ITestBlock[]): string[] => {
			const shapes: string[] = [];
			let list: { key: string; items: string[] } | undefined;
			let previousListItem: IBaseHalfNoteWriteHints['previousListItem'];
			for (const value of blocks) {
				const hints = { previousListItem };
				if (writeBaseHalfNoteBlock(value, hints) === '') {
					continue;
				}
				const kind = baseHalfNoteBlockKind(value, hints);
				previousListItem = baseHalfNoteFollowingListItem(value, hints);
				if (kind.marker !== undefined) {
					const item = `${kind.task ? 'task' : 'item'}(${expected(value.children).join(',')})`;
					if (list?.key === kind.marker) {
						list.items.push(item);
					} else {
						list = { key: kind.marker, items: [item] };
						shapes.push('');
					}
					shapes[shapes.length - 1] = `list[${list.items.join(',')}]`;
					continue;
				}
				list = undefined;
				if (kind.toggle) {
					shapes.push(`toggle(${expected(value.children).join(',')})`);
				} else {
					shapes.push(({ paragraph: 'paragraph', file: 'paragraph', heading: `heading${value.props.level}`, quote: 'quote', codeBlock: 'code', divider: 'hr', table: 'table' } as Record<string, string>)[value.type] ?? 'media');
				}
			}
			return shapes;
		};
		const detailsDepth = (raw: string) => (raw.match(/<details(?=[\s>])/g)?.length ?? 0) - (raw.match(/<\/details>/g)?.length ?? 0);
		const isMedia = (token: Token) => {
			const inner = ((token as Tokens.Paragraph).tokens ?? []).filter(part => !(part.type === 'text' && part.raw.trim() === ''));
			return (inner.length === 1 && inner[0].type === 'image') || (inner.length > 0 && inner.every(part => part.type === 'html') && /^<(?:video|audio)\b/.test(inner[0].raw));
		};
		const actual = (tokens: readonly Token[]): string[] => {
			const shapes: string[] = [];
			for (let index = 0; index < tokens.length; index++) {
				const token = tokens[index];
				switch (token.type) {
					case 'space': break;
					case 'paragraph': case 'text': shapes.push(isMedia(token) ? 'media' : 'paragraph'); break;
					case 'heading': shapes.push(`heading${(token as Tokens.Heading).depth}`); break;
					case 'blockquote': shapes.push('quote'); break;
					case 'code': shapes.push('code'); break;
					case 'hr': shapes.push('hr'); break;
					case 'table': shapes.push('table'); break;
					case 'list':
						shapes.push(`list[${(token as Tokens.List).items.map(item => {
							// An item's own text is its first text, but a picture alone, which it holds as a block.
							const first = item.tokens[0];
							const own = first && (first.type === 'text' || first.type === 'paragraph') && !isMedia(first) ? 1 : 0;
							return `${item.task ? 'task' : 'item'}(${actual(item.tokens.slice(own)).join(',')})`;
						}).join(',')}]`);
						break;
					case 'html': {
						if (!/^<details[\s>]/.test(token.raw)) {
							shapes.push('media');
							break;
						}
						// A toggle runs from its `<details>` to the `</details>` that closes it.
						let depth = detailsDepth(token.raw);
						const inner: Token[] = [];
						while (depth > 0 && index + 1 < tokens.length) {
							const next = tokens[++index];
							depth += next.type === 'html' ? detailsDepth(next.raw) : 0;
							if (depth > 0) {
								inner.push(next);
							}
						}
						shapes.push(`toggle(${actual(inner).join(',')})`);
						break;
					}
					default: shapes.push(`other ${token.type}`);
				}
			}
			return shapes;
		};
		let unreadable = 0;
		for (let index = 0; index < 1000; index++) {
			const blocks = Array.from({ length: 1 + Math.floor(random() * 5) }, () => tree(0));
			const markdown = writeBaseHalfNoteBlocks(blocks, { onUnreadable: () => unreadable++ });
			assert.strictEqual(actual(baseHalfCardLexer().lex(markdown)).join(','), expected(blocks).join(','), `tree ${index}:\n${markdown}`);
		}
		assert.strictEqual(unreadable, 0);
	});
});
