/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { pauseBaseHalfCanvasMedia } from './basehalfCanvasCardMedia.js';
import { createBaseHalfCanvasCardVideoPlayer } from './basehalfCanvasCardVideoPlayer.js';

/**
 * Plays each video and sound of a rendered note in BaseHalf's own player, the
 * player of a video's card (note formats, rule 52): on the note's card and in
 * the card's editor (`'card'`) the picture is the card's, and in Preview
 * (`'page'`) a click on it plays and pauses it. A video keeps the width the
 * note gives it. One that cannot be played is shown again as the note's
 * renderer drew it.
 */
export function playBaseHalfNoteMedia(element: HTMLElement, where: 'card' | 'page'): IDisposable {
	const players = new DisposableStore();
	// The videos and sounds are drawn by the note's renderer, not built here.
	// eslint-disable-next-line no-restricted-syntax
	for (const media of Array.from(element.querySelectorAll<HTMLMediaElement>('video[src], audio[src]'))) {
		const parent = media.parentElement;
		const src = media.getAttribute('src');
		if (!parent || !src || media.classList.contains('basehalf-canvas-video-player-video')) {
			continue;
		}
		const player = createBaseHalfCanvasCardVideoPlayer(parent, media, {
			// The renderer gives the element the address the window loads; the player asks for the file by its own.
			source: FileAccess.uriToFileUri(URI.parse(src)),
			videoClasses: [],
			sound: media.tagName === 'AUDIO',
			note: where,
			open: () => { /* A note's player opens nothing: a double click is the card's. */ },
			onError: () => {
				media.setAttribute('src', src);
				player.element.replaceWith(media);
				players.delete(player);
			},
		});
		const width = media.tagName === 'VIDEO' ? media.getAttribute('width') : null;
		if (width) {
			player.video.setAttribute('width', width);
		}
		// The element the player stands in for loads nothing while it waits.
		media.remove();
		media.removeAttribute('src');
		media.load();
		players.add(player);
	}
	return players;
}

/** Pauses the players of a rendered note, as when the card's editor covers it. */
export function pauseBaseHalfNoteMedia(element: HTMLElement): void {
	// eslint-disable-next-line no-restricted-syntax
	for (const video of Array.from(element.querySelectorAll<HTMLVideoElement>('video.basehalf-canvas-video-player-video'))) {
		pauseBaseHalfCanvasMedia(video);
	}
}
