/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { renderBaseHalfCanvasStoredMarkdown } from '../../browser/basehalfCanvasMarkdownInlineEditor.js';
import {
	BASEHALF_CANVAS_NOTE_PART_CLASS,
	buildAllBaseHalfCanvasNoteParts,
	buildBaseHalfCanvasNotePartsTo,
	renderBaseHalfCanvasNoteInParts
} from '../../browser/basehalfCanvasNoteParts.js';
import { planBaseHalfCanvasNoteParts } from '../../common/basehalfCanvasPreview.js';

suite('BaseHalfCanvasNoteParts', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const resource = URI.file('/notes/note.md');
	const builtParts = (container: HTMLElement) => [...container.children].filter(child => child.classList.contains(BASEHALF_CANVAS_NOTE_PART_CLASS));
	// Space between two blocks is no part of what a note shows.
	const markup = (html: string) => html.replace(/>\s+</g, '><').trim();

	/** Every construct whose rendering could depend on the blocks around it. */
	const corpus = [
		'# A note of every kind of block',
		'',
		'See [the guide][guide] and [the list][list] before the table.',
		'',
		'Title of a part',
		'===============',
		'',
		'<details>',
		'<summary>More</summary>',
		'',
		'Hidden **text** that the summary folds.',
		'',
		'More hidden text.',
		'',
		'</details>',
		'',
		'- one',
		'',
		'- two, after a blank line',
		'',
		'- three',
		'',
		'3. three',
		'4. four',
		'',
		'- [ ] open',
		'- [x] done',
		'',
		'```js',
		'const a = 1;',
		'',
		'const b = 2;',
		'```',
		'',
		'    indented code',
		'',
		'| a | b |',
		'|:---|---:|',
		'| 1<br>2 | H<sub>2</sub>O |',
		'',
		'> one',
		'>',
		'> two',
		'',
		'line one  ',
		'line two',
		'',
		'<!-- a comment -->',
		'',
		'![picture](images/p.png)',
		'',
		'<div><script>alert(1)</script></div>',
		'',
		'A List<String> and <kbd>Cmd</kbd>.',
		'',
		'[list]: https://example.com/list',
		'',
		'The last paragraph links to [the guide][guide] again.',
		'',
		'[guide]: docs/guide.md "Guide"',
		'',
		'```',
		'a code block that is never closed',
		''
	].join('\n');

	test('a note built in parts shows the same elements as the note built whole', () => {
		const whole = document.createElement('div');
		const wholeRendering = renderBaseHalfCanvasStoredMarkdown(whole, resource, corpus);
		const inParts = document.createElement('div');
		const partsRendering = renderBaseHalfCanvasNoteInParts(inParts, resource, corpus, undefined, 40)!;
		try {
			buildAllBaseHalfCanvasNoteParts(inParts);
			const parts = builtParts(inParts);
			assert.deepStrictEqual({
				parts: parts.length,
				markup: markup(parts.map(part => part.innerHTML).join(''))
			}, {
				parts: planBaseHalfCanvasNoteParts(corpus, 40)!.parts.length,
				markup: markup(whole.innerHTML)
			});
			assert.ok(parts.length >= 10);
		} finally {
			wholeRendering.dispose();
			partsRendering.dispose();
		}
	});

	test('a link in a later part opens as it does in a note built whole', () => {
		const opened: string[] = [];
		const container = document.createElement('div');
		const rendering = renderBaseHalfCanvasNoteInParts(container, resource, corpus, href => opened.push(href), 40)!;
		try {
			buildAllBaseHalfCanvasNoteParts(container);
			const parts = builtParts(container);
			const lastWithLink = parts.findLastIndex(part => part.querySelector('a[data-href]'));
			parts[lastWithLink]?.querySelector<HTMLElement>('a[data-href]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
			assert.deepStrictEqual({ laterPart: lastWithLink > 0, opened }, { laterPart: true, opened: ['file:///notes/docs/guide.md'] });
		} finally {
			rendering.dispose();
		}
	});

	test('builds the parts its box shows and two heights below, and further ones as it is scrolled', () => {
		const container = document.createElement('div');
		container.style.cssText = 'height: 100px; width: 300px; overflow: hidden; font: 13px/20px sans-serif;';
		mainWindow.document.body.appendChild(container);
		const source = `${Array.from({ length: 300 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n')}\n`;
		const partCount = planBaseHalfCanvasNoteParts(source, 200)!.parts.length;
		const rendering = renderBaseHalfCanvasNoteInParts(container, resource, source, undefined, 200)!;
		try {
			const drawn = builtParts(container).length;
			buildBaseHalfCanvasNotePartsTo(container, 0);
			const filled = { parts: builtParts(container).length, height: container.scrollHeight };
			buildBaseHalfCanvasNotePartsTo(container, 2000);
			const scrolled = { parts: builtParts(container).length, height: container.scrollHeight };
			buildAllBaseHalfCanvasNoteParts(container);
			assert.deepStrictEqual({
				drawn,
				filledTwoHeightsBelow: filled.height >= 300,
				filledNotAll: filled.parts < partCount,
				scrolledTwoHeightsBelow: scrolled.height >= 2300,
				scrolledNotAll: scrolled.parts < partCount,
				all: builtParts(container).length,
				last: container.textContent?.trim().endsWith('Paragraph 300.')
			}, {
				drawn: 1,
				filledTwoHeightsBelow: true,
				filledNotAll: true,
				scrolledTwoHeightsBelow: true,
				scrolledNotAll: true,
				all: partCount,
				last: true
			});
		} finally {
			rendering.dispose();
			container.remove();
		}
	});

	test('a note with a block that no part can hold is not built', () => {
		const container = document.createElement('div');
		assert.strictEqual(renderBaseHalfCanvasNoteInParts(container, resource, 'a'.repeat(90_001)), undefined);
		assert.strictEqual(container.childElementCount, 0);
	});

	test('the resting projection builds the frontmatter-free body that the inline editor edits', () => {
		const source = '---\r\ntitle: Hidden metadata\r\ntags:\r\n  - test\r\n---\r\n# Visible body\r\n\r\nBody text  \r\n';
		const before = source;
		const container = document.createElement('div');
		const rendering = renderBaseHalfCanvasNoteInParts(container, URI.file('/notes/frontmatter.md'), source)!;
		try {
			assert.deepStrictEqual({
				hidden: container.textContent?.includes('Hidden metadata'),
				heading: container.textContent?.includes('Visible body'),
				body: container.textContent?.includes('Body text'),
				unchanged: source === before
			}, { hidden: false, heading: true, body: true, unchanged: true });
		} finally {
			rendering.dispose();
		}
	});

	test('a note of only frontmatter builds nothing', () => {
		const container = document.createElement('div');
		const rendering = renderBaseHalfCanvasNoteInParts(container, URI.file('/notes/metadata-only.md'), '---\ntitle: Hidden metadata\n---\n')!;
		try {
			assert.strictEqual(container.textContent, '');
		} finally {
			rendering.dispose();
		}
	});
});
