/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { ITextFileSaveParticipant } from '../../../services/textfile/common/textfiles.js';
import { isBaseHalfMarkdownResource } from '../../workspace/common/basehalfItems.js';

// A save writes a note as its editor holds it (formats of a note, rule 89).
// The settings that change the white space of a file when it is saved,
// `files.trimTrailingWhitespace`, `files.insertFinalNewline`, and
// `files.trimFinalNewlines`, are each a save participant of the base. Every
// way a note is saved runs them, since each saves the note's text file model,
// so the one exemption is where they are registered.

/**
 * The save participant that leaves a note as it is and gives every other file
 * to `participant`. Two spaces at the end of a line are a line break in
 * Markdown, and a note is plain text to the base, so the setting's own value
 * for Markdown never reaches it.
 */
export function baseHalfSaveParticipantExceptNotes(participant: ITextFileSaveParticipant): ITextFileSaveParticipant {
	return {
		ordinal: participant.ordinal,
		participate: async (model, context, progress, token) => {
			if (isBaseHalfMarkdownResource(model.resource)) {
				return;
			}
			await participant.participate(model, context, progress, token);
		}
	};
}
