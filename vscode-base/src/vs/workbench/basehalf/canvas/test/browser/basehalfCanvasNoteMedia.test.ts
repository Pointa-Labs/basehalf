/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { renderBaseHalfCanvasStoredMarkdown } from '../../browser/basehalfCanvasMarkdownInlineEditor.js';
import { noteBaseHalfNoteMediaVersion, playBaseHalfNoteMedia } from '../../browser/basehalfCanvasNoteMedia.js';

suite('BaseHalfCanvasNoteMedia', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('a note\'s videos and sounds play in BaseHalf\'s player, a video at the width the note gives it, and none is left in the system\'s controls (note formats, rule 52)', () => {
		const container = mainWindow.document.createElement('div');
		container.className = 'monaco-workbench';
		mainWindow.document.body.appendChild(container);
		try {
			store.add(renderBaseHalfCanvasStoredMarkdown(container, URI.file('/notes/note.md'), [
				'![clip](clip.mp4)',
				'',
				'<figure>',
				'<video src="media/wide.mp4" width="480" controls></video>',
				'<figcaption>Wide</figcaption>',
				'</figure>',
				'',
				'<audio src="tone.wav" controls></audio>',
				''
			].join('\n')));
			const players = store.add(playBaseHalfNoteMedia(container, 'card'));
			const shown = Array.from(container.querySelectorAll<HTMLElement>('.basehalf-canvas-video-player'), player => {
				const video = player.querySelector('video')!;
				return {
					kind: player.classList.contains('sound') ? 'sound' : 'video',
					note: player.classList.contains('note'),
					file: URI.parse(video.getAttribute('src')!.replace(/#.*$/, '')).path,
					width: video.getAttribute('width'),
					within: player.parentElement?.tagName,
				};
			});
			const systemControls = container.querySelectorAll('video[controls], audio').length;
			players.dispose();
			assert.deepStrictEqual({ shown, systemControls, left: container.querySelectorAll('.basehalf-canvas-video-player').length }, {
				shown: [
					{ kind: 'video', note: true, file: '/notes/clip.mp4', width: null, within: 'P' },
					{ kind: 'video', note: true, file: '/notes/media/wide.mp4', width: '480', within: 'FIGURE' },
					{ kind: 'sound', note: true, file: '/notes/tone.wav', width: null, within: 'P' },
				],
				systemControls: 0,
				left: 0,
			});
		} finally {
			container.remove();
		}
	});

	test('a video of a note that an edit in the note changed plays anew from its file\'s new version, by an address of its own (D114)', () => {
		const container = mainWindow.document.createElement('div');
		container.className = 'monaco-workbench';
		mainWindow.document.body.appendChild(container);
		try {
			store.add(renderBaseHalfCanvasStoredMarkdown(container, URI.file('/notes/edited.md'), ['<video src="trimmed.mp4" controls></video>', '', '<audio src="other.wav" controls></audio>', ''].join('\n')));
			const players = store.add(playBaseHalfNoteMedia(container, 'card'));
			const sources = () => Array.from(container.querySelectorAll('.basehalf-canvas-video-player video'), video => decodeURIComponent(video.getAttribute('src')!.replace(/#.*$/, '').replace(/^.*\//, '')));
			const before = sources();
			noteBaseHalfNoteMediaVersion(URI.file('/notes/trimmed.mp4'), '1793707530681-1723642');
			const after = sources();
			players.dispose();
			assert.deepStrictEqual({ before, after, left: container.querySelectorAll('.basehalf-canvas-video-player').length }, {
				before: ['trimmed.mp4', 'other.wav'],
				after: ['trimmed.mp4?basehalfCanvasVersion=1793707530681-1723642', 'other.wav'],
				left: 0,
			});
		} finally {
			container.remove();
		}
	});
});
