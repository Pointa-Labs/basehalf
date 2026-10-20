/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { allowedMarkdownHtmlTags } from '../../../../../base/browser/markdownRenderer.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	computeBaseHalfCanvasMarkdownTextEdit,
	renderBaseHalfCanvasStoredMarkdown,
	resolveBaseHalfCanvasMarkdownInlineUnitAtPoint,
	transformBaseHalfCanvasMarkdownOffset
} from '../../browser/basehalfCanvasMarkdownInlineEditor.js';
import { collectBaseHalfCanvasMarkdownReferenceDefinitions } from '../../common/basehalfCanvasPreview.js';
import { BASEHALF_NOTE_HTML_TAGS, baseHalfNoteMarkdownToHtml } from '../../../markdown/common/basehalfNoteMarkdownHtml.js';

suite('BaseHalfCanvasMarkdownInlineEditor', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('relocates the live Markdown body across external changes with boundary affinity', () => {
		const replaceBefore = [{ rangeOffset: 1, rangeLength: 2, text: 'LONG' }];
		assert.strictEqual(transformBaseHalfCanvasMarkdownOffset(3, replaceBefore, 'before'), 5);
		assert.strictEqual(transformBaseHalfCanvasMarkdownOffset(6, replaceBefore, 'after'), 8);

		const insertAtBoundary = [{ rangeOffset: 3, rangeLength: 0, text: 'X' }];
		assert.strictEqual(transformBaseHalfCanvasMarkdownOffset(3, insertAtBoundary, 'before'), 3);
		assert.strictEqual(transformBaseHalfCanvasMarkdownOffset(3, insertAtBoundary, 'after'), 4);
	});

	test('reduces a document update to its smallest TextModel edit', () => {
		assert.deepStrictEqual(
			computeBaseHalfCanvasMarkdownTextEdit('first\n\nsecond\n', 'first changed\n\nsecond\n'),
			{ offset: 5, length: 0, text: ' changed' }
		);
		assert.deepStrictEqual(
			computeBaseHalfCanvasMarkdownTextEdit('first\r\n\r\nsecond', 'first\r\nsecond'),
			{ offset: 7, length: 2, text: '' }
		);
		assert.deepStrictEqual(
			computeBaseHalfCanvasMarkdownTextEdit('重复重复', '重复新重复'),
			{ offset: 2, length: 0, text: '新' }
		);
		assert.strictEqual(computeBaseHalfCanvasMarkdownTextEdit('same', 'same'), undefined);
	});

	test('restores the resting viewport before resolving the clicked Markdown unit', () => {
		const scroller = document.createElement('div');
		scroller.style.position = 'fixed';
		scroller.style.left = '0';
		scroller.style.top = '0';
		scroller.style.width = '120px';
		scroller.style.height = '40px';
		scroller.style.overflow = 'hidden';
		const units = Array.from({ length: 3 }, () => {
			const element = document.createElement('div');
			element.style.height = '40px';
			element.style.width = '120px';
			scroller.appendChild(element);
			return { element };
		});
		document.body.appendChild(scroller);
		try {
			const bounds = scroller.getBoundingClientRect();
			const point = { x: bounds.left + 10, y: bounds.top + 20 };
			assert.strictEqual(
				resolveBaseHalfCanvasMarkdownInlineUnitAtPoint(scroller, units, point.x, point.y, 0),
				units[0]
			);
			assert.strictEqual(
				resolveBaseHalfCanvasMarkdownInlineUnitAtPoint(scroller, units, point.x, point.y, 40),
				units[1]
			);
			assert.strictEqual(scroller.scrollTop, 40);
		} finally {
			scroller.remove();
		}
	});

	test('collects reference definitions without escaping a real code fence', () => {
		assert.strictEqual(
			collectBaseHalfCanvasMarkdownReferenceDefinitions('[guide]: docs/guide.md\n  "Guide"\n\n[text][guide]'),
			'[guide]: docs/guide.md\n  "Guide"'
		);
		assert.strictEqual(collectBaseHalfCanvasMarkdownReferenceDefinitions([
			'```ts',
			'```not-a-close',
			'[fake]: inside-code',
			'```',
			'',
			'[text][fake]'
		].join('\n')), '');
	});

	test('stored Markdown rendering never completes malformed emphasis', () => {
		const source = '春风吹过，城中的草木却长得异常茂盛**，';
		const unit = document.createElement('div');
		const rendering = renderBaseHalfCanvasStoredMarkdown(unit, URI.file('/notes/test.md'), source);
		try {
			assert.strictEqual(unit.textContent, source);
			assert.strictEqual(unit.textContent?.endsWith('**，******'), false);
		} finally {
			rendering.dispose();
		}
	});

	/** What a stored note shows: its elements by name, and the text a reader sees. */
	function renderedNote(source: string): { readonly elements: Record<string, number>; readonly text: string; readonly root: HTMLElement; readonly dispose: () => void } {
		const root = document.createElement('div');
		const rendering = renderBaseHalfCanvasStoredMarkdown(root, URI.file('/notes/note.md'), source);
		const elements: Record<string, number> = {};
		for (const element of root.querySelectorAll('*')) {
			const name = element.tagName.toLowerCase();
			elements[name] = (elements[name] ?? 0) + 1;
		}
		return { elements, text: root.textContent ?? '', root, dispose: () => rendering.dispose() };
	}

	test('a stored table is shown as a table and not as its tags', () => {
		const note = renderedNote([
			'| 开始时间 | close |',
			'|:---|---:|',
			'| 11:00 | **24,747.3** |',
			'| 12:00 | a<br>b |',
			''
		].join('\n'));
		try {
			assert.deepStrictEqual({
				elements: note.elements,
				cells: [...note.root.querySelectorAll('th, td')].map(cell => `${cell.getAttribute('align')}:${cell.textContent}`),
				tagsShownAsText: /<\/?(?:table|thead|tbody|tr|th|td|br)\b/.test(note.text)
			}, {
				elements: { table: 1, thead: 1, tbody: 1, tr: 3, th: 2, td: 4, strong: 1, br: 1 },
				cells: ['left:开始时间', 'right:close', 'left:11:00', 'right:24,747.3', 'left:12:00', 'right:ab'],
				tagsShownAsText: false
			});
		} finally {
			note.dispose();
		}
	});

	test('every Markdown construct of a stored note is shown rendered', () => {
		const note = renderedNote([
			'#### Four',
			'',
			'##### Five',
			'',
			'###### Six',
			'',
			'- [ ] open',
			'- [x] done',
			'- plain',
			'',
			'![picture](images/p.png)',
			'',
			'H<sub>2</sub>O and <kbd>Cmd</kbd>',
			''
		].join('\n'));
		try {
			const boxes = [...note.root.querySelectorAll<HTMLInputElement>('input')];
			assert.deepStrictEqual({
				elements: note.elements,
				boxes: boxes.map(box => `${box.type}:${box.checked}:${box.disabled}`),
				taskItems: [...note.root.querySelectorAll('li')].map(item => item.classList.contains('bh-md-task')),
				image: note.root.querySelector('img')?.getAttribute('src')?.endsWith('/notes/images/p.png'),
				tagsShownAsText: /<\/?[a-z][a-z0-9]*\b[^<>]*>/i.test(note.text)
			}, {
				elements: { h4: 1, h5: 1, h6: 1, ul: 1, li: 3, input: 2, p: 2, img: 1, sub: 1, kbd: 1 },
				boxes: ['checkbox:false:true', 'checkbox:true:true'],
				taskItems: [true, true, false],
				image: true,
				tagsShownAsText: false
			});
		} finally {
			note.dispose();
		}
	});

	test('the tables and code blocks of a stored note are the boxes the canvas scrolls sideways', () => {
		const note = renderedNote('| a |\n|---|\n| 1 |\n\ntext\n\n```python\nx = 1  # a comment\n```\n\n    indented\n');
		try {
			assert.deepStrictEqual(
				[...note.root.querySelectorAll('.basehalf-canvas-scroll-sideways')].map(box => `${box.tagName.toLowerCase()}: ${box.textContent?.replace(/\s+/g, ' ').trim()}`),
				['table: a 1', 'pre: x = 1 # a comment', 'pre: indented']
			);
		} finally {
			note.dispose();
		}
	});

	test('a stored note never becomes a live element or a command', () => {
		const source = [
			'<script>alert(1)</script>',
			'',
			'<iframe src="https://example.com"></iframe>',
			'',
			'A List<String> and <input type="text" value="typed">.',
			'',
			'<div><script>alert(2)</script></div>',
			'',
			'<!-- a comment -->',
			'',
			'[quit](command:workbench.action.quit)',
			''
		].join('\n');
		const note = renderedNote(source);
		try {
			assert.deepStrictEqual({
				live: ['script', 'iframe', 'input', 'string', 'div'].filter(name => note.elements[name]),
				shownAsWritten: [
					'<script>alert(1)</script>',
					'<iframe src="https://example.com"></iframe>',
					'A List<String> and <input type="text" value="typed">.',
					'<div><script>alert(2)</script></div>',
					'<!-- a comment -->'
				].filter(text => !note.text.includes(text)),
				commands: [...note.root.querySelectorAll<HTMLElement>('a')].map(link => link.dataset.href)
			}, {
				live: [],
				shownAsWritten: [],
				commands: []
			});
		} finally {
			note.dispose();
		}
	});

	test('a note shows the same elements wherever it is rendered', () => {
		const source = '| a | b |\n|---|---|\n| 1<br>2 | H<sub>2</sub>O |\n\n<script>x</script> and List<String>\n';
		const note = renderedNote(source);
		try {
			// Where the base renderer is not at hand, the same Markdown gives the same elements and text.
			const elsewhere = document.createElement('div');
			elsewhere.append(new DOMParser().parseFromString(baseHalfNoteMarkdownToHtml(source), 'text/html').body);
			assert.deepStrictEqual({
				tags: [...BASEHALF_NOTE_HTML_TAGS].sort(),
				elements: [...elsewhere.querySelectorAll('body *')].map(element => element.tagName.toLowerCase()),
				text: elsewhere.textContent?.replace(/\s+/g, ' ').trim()
			}, {
				tags: [...new Set(allowedMarkdownHtmlTags)].sort(),
				elements: [...note.root.querySelectorAll('*')].map(element => element.tagName.toLowerCase()),
				text: note.text.replace(/\s+/g, ' ').trim()
			});
		} finally {
			note.dispose();
		}
	});

});
