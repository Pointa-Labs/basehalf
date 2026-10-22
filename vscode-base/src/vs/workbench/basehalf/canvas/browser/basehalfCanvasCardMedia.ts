/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';

export function releaseBaseHalfCanvasCardMedia(media: HTMLMediaElement): void {
	media.pause();
	media.removeAttribute('src');
	media.load();
}

/**
 * One video or sound in `root` plays at a time (video node, "The player"):
 * one that starts pauses the others, on cards and in notes alike. Media
 * events do not bubble, so `root` hears them on their way down.
 */
export function playBaseHalfCanvasMediaOneAtATime(root: HTMLElement): IDisposable {
	const playing = new Set<HTMLMediaElement>();
	const store = new DisposableStore();
	const mediaOf = (event: Event): HTMLMediaElement | undefined => {
		const target = event.target as HTMLElement | null;
		return target?.tagName === 'VIDEO' || target?.tagName === 'AUDIO' ? target as HTMLMediaElement : undefined;
	};
	store.add(addDisposableListener(root, 'play', event => {
		const media = mediaOf(event);
		if (!media) {
			return;
		}
		for (const other of [...playing]) {
			if (other !== media) {
				playing.delete(other);
				other.pause();
			}
		}
		playing.add(media);
	}, true));
	store.add(addDisposableListener(root, 'pause', event => {
		const media = mediaOf(event);
		if (media) {
			playing.delete(media);
		}
	}, true));
	store.add(toDisposable(() => playing.clear()));
	return store;
}

/** How long a picture that never says it can be drawn keeps what stands in for it. */
export const BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS = 2000;
/** `HTMLMediaElement.HAVE_CURRENT_DATA`: the frame at the current position is there. */
const HAVE_CURRENT_DATA = 2;

/**
 * Calls `drawn` once, when the picture of `media` can be drawn: the image
 * loaded, or the video has its first frame, or either failed, and after
 * {@link BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS} at the latest. A card shows
 * what stands in for its picture until then, such as the Saving of a file
 * that was just saved (generation cards, "The card").
 */
export function whenBaseHalfCanvasMediaDrawn(media: HTMLImageElement | HTMLVideoElement, store: DisposableStore, drawn: () => void): void {
	const listeners = store.add(new DisposableStore());
	let done = false;
	const finish = () => {
		if (done) {
			return;
		}
		done = true;
		listeners.dispose();
		drawn();
	};
	const isVideo = media.tagName === 'VIDEO';
	for (const type of isVideo ? ['loadeddata', 'seeked', 'error'] : ['load', 'error']) {
		listeners.add(addDisposableListener(media, type, finish));
	}
	disposableTimeout(finish, BASEHALF_CANVAS_MEDIA_DRAWN_TIMEOUT_MS, listeners);
	// A picture that is there already.
	if (isVideo ? (media as HTMLVideoElement).readyState >= HAVE_CURRENT_DATA : (media as HTMLImageElement).complete && (media as HTMLImageElement).naturalWidth > 0) {
		finish();
	}
}
