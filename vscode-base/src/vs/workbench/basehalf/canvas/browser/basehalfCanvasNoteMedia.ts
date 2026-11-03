/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { pauseBaseHalfCanvasMedia } from './basehalfCanvasCardMedia.js';
import { createBaseHalfCanvasCardVideoPlayer } from './basehalfCanvasCardVideoPlayer.js';

/**
 * The version of each video and sound file of a note that an edit where the
 * note shows it changed (D114), by file: a note's player loads that version by
 * an address of its own, as the canvas loads every version of a media file,
 * so that the window does not show what it loaded of the file before.
 */
const editedVersions = new Map<string, string>();
const onDidEditVersion = new Emitter<string>();

function fileKey(resource: URI): string {
	return resource.with({ query: '', fragment: '' }).toString();
}

/**
 * A video or a sound of a note was edited where the note shows it, and its
 * file is now at `version` (`baseHalfCanvasMediaVersion`): every note's player
 * of the file loads that version, at once and in every drawing after (D114).
 */
export function noteBaseHalfNoteMediaVersion(resource: URI, version: string): void {
	const key = fileKey(resource);
	if (editedVersions.get(key) !== version) {
		editedVersions.set(key, version);
		onDidEditVersion.fire(key);
	}
}

/** The source a note's player plays for the file at `src`: at the version an edit of it left, by the query that names it. */
function noteMediaSource(src: string): URI {
	const file = FileAccess.uriToFileUri(URI.parse(src));
	const version = editedVersions.get(fileKey(file));
	return version ? file.with({ query: `basehalfCanvasVersion=${version}` }) : file;
}

/**
 * Plays each video and sound of a rendered note in BaseHalf's own player, the
 * player of a video's card (note formats, rule 52): on the note's card and in
 * the card's editor (`'card'`) the picture is the card's, and in Preview
 * (`'page'`) a click on it plays and pauses it. A video keeps the width the
 * note gives it. One that cannot be played is shown again as the note's
 * renderer drew it. One whose file an edit in the note changed plays anew
 * from the file's new version (D114).
 */
export function playBaseHalfNoteMedia(element: HTMLElement, where: 'card' | 'page'): IDisposable {
	const players = new DisposableStore();
	const play = (media: HTMLMediaElement, src: string, parent: HTMLElement, before: Node | null): void => {
		const edits = new DisposableStore();
		const player = createBaseHalfCanvasCardVideoPlayer(parent, before, {
			// The renderer gives the element the address the window loads; the player asks for the file by its own.
			source: noteMediaSource(src),
			videoClasses: [],
			sound: media.tagName === 'AUDIO',
			note: where,
			open: () => { /* A note's player opens nothing: a double click is the card's. */ },
			onError: () => {
				media.setAttribute('src', src);
				player.element.replaceWith(media);
				players.delete(edits);
				players.delete(player);
			},
		});
		const width = media.tagName === 'VIDEO' ? media.getAttribute('width') : null;
		if (width) {
			player.video.setAttribute('width', width);
		}
		players.add(player);
		players.add(edits);
		const key = fileKey(FileAccess.uriToFileUri(URI.parse(src)));
		edits.add(onDidEditVersion.event(edited => {
			const at = player.element.parentElement;
			if (edited === key && at) {
				// The file was edited: a player of its new version takes the place of this one.
				play(media, src, at, player.element);
				players.delete(edits);
				players.delete(player);
			}
		}));
	};
	// The videos and sounds are drawn by the note's renderer, not built here.
	// eslint-disable-next-line no-restricted-syntax
	for (const media of Array.from(element.querySelectorAll<HTMLMediaElement>('video[src], audio[src]'))) {
		const parent = media.parentElement;
		const src = media.getAttribute('src');
		if (!parent || !src || media.classList.contains('basehalf-canvas-video-player-video')) {
			continue;
		}
		play(media, src, parent, media);
		// The element the player stands in for loads nothing while it waits.
		media.remove();
		media.removeAttribute('src');
		media.load();
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
