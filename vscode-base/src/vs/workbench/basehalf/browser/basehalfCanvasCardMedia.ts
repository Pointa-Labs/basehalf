/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export function releaseBaseHalfCanvasCardMedia(media: HTMLMediaElement): void {
	media.pause();
	media.removeAttribute('src');
	media.load();
}
