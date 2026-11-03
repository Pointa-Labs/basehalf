/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { renderMarkdown } from '../../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfNoteRenderOptions, finishBaseHalfNoteRendering } from '../../browser/basehalfNoteRenderOptions.js';

suite('BaseHalfNoteRenderOptions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function rendered(source: string, note?: URI): { readonly root: HTMLElement; readonly dispose: () => void } {
		const markdown = new MarkdownString(source, { isTrusted: false, supportHtml: true });
		// The card and Preview read a note's pictures from the note's place.
		markdown.baseUri = note ?? URI.file('/notes/note.md');
		const root = document.createElement('div');
		const rendering = renderMarkdown(markdown, baseHalfNoteRenderOptions({ note }), root);
		finishBaseHalfNoteRendering(rendering.element);
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

	test('a link holds the address of what it names, read once (note formats, rule 55)', () => {
		const note = rendered([
			'[spaced](my%20file.md) [angled](<my file.md>) [part](other.md#part-two) [here](#setup) [web](https://example.com/a?b=c)',
			'',
			'<a href="my%20file.md">html</a> [中文](%E7%AC%94%E8%AE%B0.md)',
			''
		].join('\n'), URI.file('/notes/note.md'));
		try {
			const hrefs = Array.from(note.root.querySelectorAll<HTMLElement>('a[data-href]'), link => {
				const href = link.dataset.href ?? '';
				if (!href.startsWith('file:')) {
					return href;
				}
				const uri = URI.parse(href);
				return uri.fragment ? `${uri.path}#${uri.fragment}` : uri.path;
			});
			assert.deepStrictEqual(hrefs, [
				'/notes/my file.md',
				'/notes/my file.md',
				'/notes/other.md#part-two',
				'/notes/note.md#setup',
				'https://example.com/a?b=c',
				'/notes/my file.md',
				'/notes/笔记.md',
			]);
		} finally {
			note.dispose();
		}
	});

	test('a note of a subfolder\'s window draws its files from the store above the window\'s folder, and its file block opens one there (files in notes, rule 48)', () => {
		const note = rendered([
			'![photo](../.bh/attachments/7k3f9q2m1x/photo%202.png)',
			'',
			'![clip](../.bh/attachments/7k3f9q2m1x/clip.mp4)',
			'',
			'[handout.pdf](../.bh/attachments/7k3f9q2m1x/handout.pdf)',
			''
		].join('\n'), URI.file('/notes/reading/week 1.md'));
		try {
			// The window loads a picture, a video, or a sound from any folder by its kind (files in notes, rule 48).
			const loaded = (address: string | null | undefined) => {
				const uri = URI.parse(address ?? '');
				return `${uri.scheme} ${uri.path}`;
			};
			assert.deepStrictEqual({
				picture: loaded(note.root.querySelector('img')?.getAttribute('src')),
				video: loaded(note.root.querySelector('video')?.getAttribute('src')),
				block: URI.parse(note.root.querySelector<HTMLElement>('a.bh-md-file')?.dataset.href ?? '').path,
			}, {
				picture: 'vscode-file /notes/.bh/attachments/7k3f9q2m1x/photo 2.png',
				video: 'vscode-file /notes/.bh/attachments/7k3f9q2m1x/clip.mp4',
				block: '/notes/.bh/attachments/7k3f9q2m1x/handout.pdf',
			});
		} finally {
			note.dispose();
		}
	});

	test('a paragraph that is one link to a file is drawn as a file block that opens the file, and no other link is (note formats, rule 81)', () => {
		const note = rendered([
			'[handout.pdf](handout.pdf)',
			'',
			'<a href="slides.key">slides.key</a>',
			'',
			'- item',
			'',
			'  [nested.pdf](nested.pdf)',
			'',
			'See [inline.pdf](inline.pdf) here.',
			'',
			'[titled](titled.pdf "Title")',
			'',
			'[**bold**](bold.pdf)',
			'',
			'[a note](other.md)',
			'',
			'> [quoted.pdf](quoted.pdf)',
			''
		].join('\n'), URI.file('/notes/note.md'));
		try {
			const blocks = Array.from(note.root.querySelectorAll<HTMLElement>('a.bh-md-file'), link => ({
				name: link.textContent,
				opens: URI.parse(link.dataset.href ?? '').path,
				icon: link.firstElementChild?.matches('svg.bh-md-file-icon') ?? false,
				within: link.parentElement?.tagName,
			}));
			assert.deepStrictEqual({ blocks, links: note.root.querySelectorAll('a[data-href]').length, titles: note.root.querySelectorAll('[title]').length }, {
				blocks: [
					{ name: 'handout.pdf', opens: '/notes/handout.pdf', icon: true, within: 'P' },
					{ name: 'slides.key', opens: '/notes/slides.key', icon: true, within: 'P' },
					{ name: 'nested.pdf', opens: '/notes/nested.pdf', icon: true, within: 'P' },
				],
				links: 8,
				titles: 0,
			});
		} finally {
			note.dispose();
		}
	});
});
