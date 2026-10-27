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

/** The media that pause in a way of their own, such as a video whose sound goes down first. */
const ownPauses = new WeakMap<HTMLMediaElement, () => void>();

/** Gives `media` a pause of its own, which {@link pauseBaseHalfCanvasMedia} uses, until disposed. */
export function registerBaseHalfCanvasMediaPause(media: HTMLMediaElement, pause: () => void): IDisposable {
	ownPauses.set(media, pause);
	return toDisposable(() => {
		if (ownPauses.get(media) === pause) {
			ownPauses.delete(media);
		}
	});
}

/** Pauses `media` in its own way, or at once. */
export function pauseBaseHalfCanvasMedia(media: HTMLMediaElement): void {
	const pause = ownPauses.get(media);
	if (pause) {
		pause();
	} else {
		media.pause();
	}
}

/** Sounds that play without a media element, such as a voice's sample (D78): each stops when a video or a sound starts with its sound. */
const soundsInTurn = new Set<() => void>();
/** What each root that plays its media one at a time pauses when such a sound starts. */
const pausesForSounds = new Set<() => void>();

/** Whether a video or a sound gives sound while it plays: not muted, and not at no volume. */
function isAudible(media: HTMLMediaElement): boolean {
	return !media.muted && media.volume > 0;
}

/**
 * A sound that plays without a media element takes its turn, as the sample
 * of a voice does (generation cards, "The panel"): what plays in every root
 * of {@link playBaseHalfCanvasMediaOneAtATime} pauses now, and `stop` is
 * called when a video or a sound starts there with its sound, or its sound
 * comes on while it plays, until the result is disposed.
 */
export function playBaseHalfCanvasSoundInTurn(stop: () => void): IDisposable {
	for (const pause of [...pausesForSounds]) {
		pause();
	}
	soundsInTurn.add(stop);
	return toDisposable(() => soundsInTurn.delete(stop));
}

/**
 * One video or sound in `root` plays at a time (video node, "The player"):
 * one that starts pauses the others, on cards and in notes alike. One that
 * starts with its sound, or whose sound comes on while it plays, stops a
 * sound that plays in turn; a video that plays without sound, as the preview
 * of a card under the pointer does, lets it play (generation cards, "The
 * panel"). Media events do not bubble, so `root` hears them on their way
 * down.
 */
export function playBaseHalfCanvasMediaOneAtATime(root: HTMLElement): IDisposable {
	const playing = new Set<HTMLMediaElement>();
	const store = new DisposableStore();
	const mediaOf = (event: Event): HTMLMediaElement | undefined => {
		const target = event.target as HTMLElement | null;
		return target?.tagName === 'VIDEO' || target?.tagName === 'AUDIO' ? target as HTMLMediaElement : undefined;
	};
	const stopSoundsInTurn = () => {
		for (const stop of [...soundsInTurn]) {
			soundsInTurn.delete(stop);
			stop();
		}
	};
	const pauseAll = () => {
		for (const media of [...playing]) {
			playing.delete(media);
			pauseBaseHalfCanvasMedia(media);
		}
	};
	pausesForSounds.add(pauseAll);
	store.add(toDisposable(() => pausesForSounds.delete(pauseAll)));
	store.add(addDisposableListener(root, 'play', event => {
		const media = mediaOf(event);
		if (!media) {
			return;
		}
		for (const other of [...playing]) {
			if (other !== media) {
				playing.delete(other);
				pauseBaseHalfCanvasMedia(other);
			}
		}
		playing.add(media);
		if (isAudible(media)) {
			stopSoundsInTurn();
		}
	}, true));
	store.add(addDisposableListener(root, 'volumechange', event => {
		const media = mediaOf(event);
		if (media && !media.paused && isAudible(media)) {
			stopSoundsInTurn();
		}
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
/** The longer side of the copy of a card's picture that stands over the card that replaces it, in pixels. */
const PICTURE_COVER_MAX_SIDE = 1280;

/**
 * The query by which the card of an image or a video asks for its file: the
 * version of the file, its time of change and its size, so that a version
 * written anew is read anew.
 */
export function baseHalfCanvasMediaVersionQuery(stat: { readonly mtime?: number; readonly size?: number }): string {
	return `basehalfCanvasVersion=${stat.mtime ?? 0}-${stat.size ?? 0}`;
}

/**
 * The picture of a card, an image or the frame of a video, copied into a
 * canvas: the card drawn anew for a file written anew, as by an edit in Card
 * Detail, shows it over its own picture until that can be drawn
 * (`whenBaseHalfCanvasMediaDrawn`), so that no frame shows the card without a
 * picture. Nothing while the picture is not drawn.
 */
export function baseHalfCanvasPictureCover(picture: HTMLImageElement | HTMLVideoElement): HTMLCanvasElement | undefined {
	let width = 0;
	let height = 0;
	if (picture.tagName === 'VIDEO') {
		const video = picture as HTMLVideoElement;
		if (video.readyState >= HAVE_CURRENT_DATA) {
			width = video.videoWidth;
			height = video.videoHeight;
		}
	} else if ((picture as HTMLImageElement).complete) {
		width = (picture as HTMLImageElement).naturalWidth;
		height = (picture as HTMLImageElement).naturalHeight;
	}
	if (!width || !height) {
		return undefined;
	}
	const scale = Math.min(1, PICTURE_COVER_MAX_SIDE / Math.max(width, height));
	const cover = picture.ownerDocument.createElement('canvas');
	cover.className = 'basehalf-canvas-card-picture-cover';
	cover.setAttribute('aria-hidden', 'true');
	cover.width = Math.max(1, Math.round(width * scale));
	cover.height = Math.max(1, Math.round(height * scale));
	try {
		cover.getContext('2d')?.drawImage(picture, 0, 0, cover.width, cover.height);
	} catch {
		return undefined;
	}
	return cover;
}

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
