/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { renderBaseHalfCanvasStoredMarkdown } from '../../browser/basehalfCanvasMarkdownInlineEditor.js';
import { IBaseHalfNoteMediaDrawing, noteBaseHalfNoteMediaVersion, playBaseHalfNoteMedia, releaseWaitingBaseHalfNoteMedia } from '../../browser/basehalfCanvasNoteMedia.js';

suite('BaseHalfCanvasNoteMedia', () => {
	const frames: HTMLElement[] = [];
	/** The drawings of the test, which go before the check for leaks with the players that wait for a drawing, as at the next frame. */
	const shownDrawings: IDisposable[] = [];
	teardown(() => {
		for (const drawing of shownDrawings.splice(0)) {
			drawing.dispose();
		}
		releaseWaitingBaseHalfNoteMedia();
		for (const frame of frames.splice(0)) {
			frame.remove();
		}
	});
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const note = URI.file('/notes/note.md');

	function play(element: HTMLElement, drawing: IBaseHalfNoteMediaDrawing): IDisposable {
		const shown = playBaseHalfNoteMedia(element, drawing);
		shownDrawings.push(shown);
		return shown;
	}

	/** A place of the window that shows a note, rendered from `lines`; not shown yet with `shown` false. */
	function drawNote(lines: readonly string[], shown = true, resource = note): HTMLElement {
		const container = mainWindow.document.createElement('div');
		container.className = 'monaco-workbench';
		if (shown) {
			mainWindow.document.body.appendChild(container);
			frames.push(container);
		}
		store.add(renderBaseHalfCanvasStoredMarkdown(container, resource, [...lines, ''].join('\n')));
		return container;
	}

	function playersIn(container: HTMLElement): HTMLElement[] {
		return Array.from(container.querySelectorAll<HTMLElement>('.basehalf-canvas-video-player'));
	}

	test('a note\'s videos and sounds play in BaseHalf\'s player, a video at the width the note gives it, and none is left in the system\'s controls (note formats, rule 52)', () => {
		const container = drawNote([
			'![clip](clip.mp4)',
			'',
			'<figure>',
			'<video src="media/wide.mp4" width="480" controls></video>',
			'<figcaption>Wide</figcaption>',
			'</figure>',
			'',
			'<audio src="tone.wav" controls></audio>',
		]);
		const players = play(container, { note, surface: 'rest' });
		const shown = playersIn(container).map(player => {
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
		assert.deepStrictEqual({ shown, systemControls, left: playersIn(container).length }, {
			shown: [
				{ kind: 'video', note: true, file: '/notes/clip.mp4', width: null, within: 'P' },
				{ kind: 'video', note: true, file: '/notes/media/wide.mp4', width: '480', within: 'FIGURE' },
				{ kind: 'sound', note: true, file: '/notes/tone.wav', width: null, within: 'P' },
			],
			systemControls: 0,
			left: 0,
		});
	});

	test('a note drawn again takes over the players of the drawing before it, in their order, untouched; the player of a block that has left the note goes (note rendering, rule 4b)', () => {
		const first = drawNote(['![a](clip.mp4)', '', '![b](clip.mp4)', '', '<audio src="tone.wav" controls></audio>', '', '![c](other.mp4)']);
		const before = play(first, { note, surface: 'preview' });
		const players = playersIn(first);
		// What plays goes on playing: nothing pauses a video that is taken over.
		const pauses: number[] = players.map(() => 0);
		players.forEach((player, index) => {
			player.querySelector('video')!.pause = () => { pauses[index]++; };
		});
		before.dispose();
		first.replaceChildren();
		const second = drawNote(['Text.', '', '![a](clip.mp4)', '', '![b](clip.mp4)', '', '<audio src="tone.wav" controls></audio>']);
		play(second, { note, surface: 'preview' });
		const shown = playersIn(second);
		const waitingBeforeTheFrame = players[3].isConnected;
		releaseWaitingBaseHalfNoteMedia();
		assert.deepStrictEqual({
			taken: shown.map(player => players.indexOf(player)),
			pausedWhileTaken: pauses.slice(0, 3),
			waitingBeforeTheFrame,
			goneAfterIt: !players[3].isConnected && pauses[3] > 0,
		}, {
			taken: [0, 1, 2],
			pausedWhileTaken: [0, 0, 0],
			waitingBeforeTheFrame: true,
			goneAfterIt: true,
		});
	});

	test('a drawing built before it is shown, as a card\'s new element, gets stand-ins, whose places the players of the drawing it replaces take once it is shown and the other goes (note rendering, rule 4b)', () => {
		const lines = ['![a](clip.mp4)', '', '<audio src="tone.wav" controls></audio>'];
		const first = drawNote(lines);
		const before = play(first, { note, surface: 'rest' });
		const players = playersIn(first);
		const next = drawNote(lines, false);
		play(next, { note, surface: 'rest' });
		const standIns = playersIn(next);
		mainWindow.document.body.appendChild(next);
		frames.push(next);
		before.dispose();
		assert.deepStrictEqual({
			standIns: standIns.map(player => players.includes(player)),
			taken: playersIn(next).map(player => players.indexOf(player)),
			standInsGone: standIns.every(player => !player.isConnected),
		}, {
			standIns: [false, false],
			taken: [0, 1],
			standInsGone: true,
		});
	});

	test('a drawing of the note in another place, or of another note, takes over no player (note rendering, rule 4b)', () => {
		const lines = ['![a](clip.mp4)'];
		const first = drawNote(lines);
		const before = play(first, { note, surface: 'rest' });
		const [player] = playersIn(first);
		before.dispose();
		const preview = drawNote(lines);
		play(preview, { note, surface: 'preview' });
		const other = drawNote(lines, true, URI.file('/notes/other.md'));
		play(other, { note: URI.file('/notes/other.md'), surface: 'rest' });
		assert.deepStrictEqual({
			inPreview: playersIn(preview).includes(player),
			inOther: playersIn(other).includes(player),
			stillWaiting: player.isConnected,
		}, { inPreview: false, inOther: false, stillWaiting: true });
	});

	test('a video of a note that an edit in the note changed plays anew from its file\'s new version, by an address of its own, and a drawing after takes over no player of the version before (D114)', () => {
		const edited = URI.file('/notes/edited.md');
		const lines = ['<video src="trimmed.mp4" controls></video>', '', '<audio src="other.wav" controls></audio>'];
		const sources = (container: HTMLElement) => playersIn(container).map(player => decodeURIComponent(player.querySelector('video')!.getAttribute('src')!.replace(/#.*$/, '').replace(/^.*\//, '')));
		const first = drawNote(lines, true, edited);
		const shown = play(first, { note: edited, surface: 'rest' });
		const before = sources(first);
		const [video, sound] = playersIn(first);
		noteBaseHalfNoteMediaVersion(URI.file('/notes/trimmed.mp4'), '1793707530681-1723642');
		const after = sources(first);
		const [edit] = playersIn(first);
		shown.dispose();
		first.replaceChildren();
		const second = drawNote(lines, true, edited);
		const next = play(second, { note: edited, surface: 'rest' });
		const [takenVideo, takenSound] = playersIn(second);
		// A version that comes while the players wait: the drawing after plays it, and takes no player of the version before.
		next.dispose();
		second.replaceChildren();
		noteBaseHalfNoteMediaVersion(URI.file('/notes/trimmed.mp4'), '1793707600000-1500000');
		const third = drawNote(lines, true, edited);
		play(third, { note: edited, surface: 'rest' });
		const [thirdVideo] = playersIn(third);
		assert.deepStrictEqual({
			before,
			after,
			oldVideoGone: !video.isConnected,
			soundKept: playersIn(first).length === 0 && takenSound === sound,
			editedTaken: takenVideo === edit,
			afterWaiting: [thirdVideo === edit, sources(third)],
		}, {
			before: ['trimmed.mp4', 'other.wav'],
			after: ['trimmed.mp4?basehalfCanvasVersion=1793707530681-1723642', 'other.wav'],
			oldVideoGone: true,
			soundKept: true,
			editedTaken: true,
			afterWaiting: [false, ['trimmed.mp4?basehalfCanvasVersion=1793707600000-1500000', 'other.wav']],
		});
	});
});
