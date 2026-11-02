/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { renderMarkdown } from '../../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfNoteRenderOptions, removeBaseHalfNoteLinkTitles } from '../../browser/basehalfNoteRenderOptions.js';

suite('BaseHalfNoteRenderOptions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function rendered(source: string): { readonly root: HTMLElement; readonly dispose: () => void } {
		const markdown = new MarkdownString(source, { isTrusted: false, supportHtml: true });
		markdown.baseUri = URI.file('/notes/note.md');
		const root = document.createElement('div');
		const rendering = renderMarkdown(markdown, baseHalfNoteRenderOptions(), root);
		removeBaseHalfNoteLinkTitles(rendering.element);
		return { root, dispose: () => rendering.dispose() };
	}

	test('Preview and the card draw a note with the same rules (note formats, rule 81)', () => {
		const note = rendered([
			'one',
			'two',
			'',
			'<audio src="sound.mp3" controls></audio>',
			'',
			'<details open>',
			'<summary>Open</summary>',
			'',
			'Inside.',
			'',
			'</details>',
			'',
			'A <span style="color:#4ba3dc;background-color:#1f4157;">blue</span> word and <x-note>other</x-note> HTML.',
			'',
			'[a link](other.md "Title")',
			''
		].join('\n'));
		try {
			const span = note.root.querySelector<HTMLElement>('span[style]');
			assert.deepStrictEqual({
				lineBreak: note.root.querySelector('p')?.innerHTML.includes('<br>'),
				sound: note.root.querySelectorAll('audio').length,
				open: note.root.querySelector('details')?.hasAttribute('open'),
				color: span?.style.color,
				background: span?.style.backgroundColor,
				otherHtmlAsWritten: note.root.textContent?.includes('<x-note>other</x-note>'),
				titles: note.root.querySelectorAll('[title]').length,
			}, {
				lineBreak: true,
				sound: 1,
				open: true,
				color: 'rgb(75, 163, 220)',
				background: 'rgb(31, 65, 87)',
				otherHtmlAsWritten: true,
				titles: 0,
			});
		} finally {
			note.dispose();
		}
	});
});
