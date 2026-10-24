/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * What can be the id of a voice (D78; providers, "Parameters", "Voices"), the
 * one rule of the provider service and the window: `check` takes such a value
 * for a `voice` parameter that is `listed` even when the catalog does not
 * declare it, since it may be a voice of the user's account, and `voices`
 * keeps only the listed voices whose ids are such values.
 */

/** The most characters of a voice's id. */
export const MAX_VOICE_ID_LENGTH = 256;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/** Whether a value can be the id of a voice: 1 to 256 characters, not only spaces, without control characters. */
export function isVoiceId(value: string): boolean {
	return value.trim().length > 0 && [...value].length <= MAX_VOICE_ID_LENGTH && !CONTROL_CHARACTERS.test(value);
}
