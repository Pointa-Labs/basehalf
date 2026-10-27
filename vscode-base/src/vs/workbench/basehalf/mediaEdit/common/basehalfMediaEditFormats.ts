/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { extname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { BASEHALF_MEDIA_FILE_EXTENSIONS } from '../../../../platform/protocol/common/basehalfMediaFiles.js';
import { BaseHalfMediaKind, IBaseHalfMediaChoices } from './basehalfEditRecord.js';

/**
 * The media files that Card Detail edits (editing media, "Terms"), and why
 * it does not edit the others that it shows.
 */

const EXTENSIONS: Readonly<Record<BaseHalfMediaKind, ReadonlySet<string>>> = Object.freeze({
	video: new Set(['mp4', 'mov', 'm4v', 'webm']),
	image: new Set(['png', 'jpg', 'jpeg', 'webp']),
	sound: new Set(['mp3', 'wav', 'flac', 'm4a', 'ogg'])
});

/** The extension of a file, without its dot, in lower case. */
export function baseHalfMediaEditExtension(resource: URI): string {
	return extname(resource).slice(1).toLowerCase();
}

/** The kind of a media file that Card Detail edits; nothing for any other file. */
export function baseHalfMediaEditKind(resource: URI): BaseHalfMediaKind | undefined {
	const extension = baseHalfMediaEditExtension(resource);
	for (const kind of ['video', 'image', 'sound'] as const) {
		if (EXTENSIONS[kind].has(extension)) {
			return kind;
		}
	}
	return undefined;
}

/** Why Card Detail does not edit a file, in the words of Edit's hover: by its format for a media file it shows. */
export function baseHalfMediaEditRefusal(resource: URI): string {
	const extension = `.${baseHalfMediaEditExtension(resource)}`;
	for (const kind of ['image', 'video', 'audio'] as const) {
		if (BASEHALF_MEDIA_FILE_EXTENSIONS[kind].includes(extension)) {
			return baseHalfMediaEditFormatRefusal(kind, resource);
		}
	}
	return localize('basehalf.mediaEdit.unavailable.kind', "BaseHalf can't edit this file.");
}

/** Why a media file of a kind that Card Detail shows is not edited, in the words of Edit's hover. */
export function baseHalfMediaEditFormatRefusal(kind: 'image' | 'video' | 'audio', resource: URI): string {
	const format = baseHalfMediaEditExtension(resource).toUpperCase() || localize('basehalf.mediaEdit.format.unknown', "this");
	switch (kind) {
		case 'image': return localize('basehalf.mediaEdit.format.image', "BaseHalf can't edit {0} images", format);
		case 'video': return localize('basehalf.mediaEdit.format.video', "BaseHalf can't edit {0} videos", format);
		case 'audio': return localize('basehalf.mediaEdit.format.sound', "BaseHalf can't edit {0} sounds", format);
	}
}

/** Whether choices leave the original as it is: no part cut, no turn, no crop, and no sound taken away. */
export function baseHalfMediaChoicesAreNoEdit(choices: IBaseHalfMediaChoices): boolean {
	return !choices.keep && !choices.turn && !choices.flip && !choices.straighten && !choices.crop;
}
