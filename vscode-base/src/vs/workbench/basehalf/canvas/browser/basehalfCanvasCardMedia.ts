/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
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
