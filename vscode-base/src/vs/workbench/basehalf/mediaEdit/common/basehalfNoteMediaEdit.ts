/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A picture, a video, or a sound edited in its note (D113, D114): the editor
// of the file's card, drawn by the window over the media where the note shows
// it, with room that the note makes under the media for the editor's tools.
// Rich's page imports this module: it imports nothing.

/** The media of a note that is edited where the note shows it: the kinds of Rich's blocks. */
export type BaseHalfNoteMediaKind = 'image' | 'video' | 'audio';

/** The margin in which the crop view's frame rests inside its view (`BASEHALF_EDGE_FOLLOW_MARGIN` in basehalfMediaZoom.ts). */
export const BASEHALF_IMAGE_CROP_MARGIN = 24;

/** The height of the crop view's row of tools (`.basehalf-image-crop-tools` in basehalfImageCropView.css). */
export const BASEHALF_IMAGE_CROP_TOOLS_HEIGHT = 56;

/** The height of the line under the editor of a picture, with its foot (basehalfMediaEditing.css and basehalfNoteMediaEditing.css). */
export const BASEHALF_MEDIA_EDIT_LINE_HEIGHT = 28;

/** The room a note makes under a picture while it is edited: the part of the editor below the picture. */
export const BASEHALF_NOTE_PICTURE_EDIT_ROOM = BASEHALF_IMAGE_CROP_MARGIN + BASEHALF_IMAGE_CROP_TOOLS_HEIGHT + BASEHALF_MEDIA_EDIT_LINE_HEIGHT;

/** The room between a video's picture and its edit bar, and between the bar and the line (`--basehalf-video-stage-gap` of Card Detail). */
export const BASEHALF_VIDEO_EDIT_GAP = 12;

/** The height of a video's edit bar: Play and the strip of the frame viewer (basehalfVideoFrameViewer.css). */
export const BASEHALF_VIDEO_EDIT_BAR_HEIGHT = 48;

/** The room a note makes under a video while it is edited: the edit bar and the line under it, the picture keeping its place (D114). */
export const BASEHALF_NOTE_VIDEO_EDIT_ROOM = BASEHALF_VIDEO_EDIT_GAP + BASEHALF_VIDEO_EDIT_BAR_HEIGHT + BASEHALF_VIDEO_EDIT_GAP + BASEHALF_MEDIA_EDIT_LINE_HEIGHT;

/** The height of a sound's waveform in a note: the least it has in Card Detail (basehalfSoundWaveform.css). */
export const BASEHALF_NOTE_SOUND_WAVEFORM_HEIGHT = 112;

/** The height of the row of Play and the time under a sound's waveform (`.basehalf-sound-waveform-play`). */
export const BASEHALF_SOUND_PLAY_ROW_HEIGHT = 32;

/** The room between the waveform, the row of Play, and the line (`.basehalf-sound-waveform` and basehalfNoteMediaEditing.css). */
export const BASEHALF_SOUND_EDIT_GAP = 12;

/** The height of the editor of a sound in a note: the waveform, the row of Play, and the line (D114). */
export const BASEHALF_NOTE_SOUND_EDITOR_HEIGHT = BASEHALF_NOTE_SOUND_WAVEFORM_HEIGHT + BASEHALF_SOUND_EDIT_GAP + BASEHALF_SOUND_PLAY_ROW_HEIGHT + BASEHALF_SOUND_EDIT_GAP + BASEHALF_MEDIA_EDIT_LINE_HEIGHT;

export interface IBaseHalfNoteMediaBox {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/**
 * The room a note makes under its media while the media is edited, in pixels
 * of the screen, for the media's box as the note shows it: what the editor
 * takes below the media. A sound's editor stands over its bar and takes the
 * rest of its height under it.
 */
export function baseHalfNoteMediaEditRoom(kind: BaseHalfNoteMediaKind, media: IBaseHalfNoteMediaBox): number {
	switch (kind) {
		case 'image': return BASEHALF_NOTE_PICTURE_EDIT_ROOM;
		case 'video': return BASEHALF_NOTE_VIDEO_EDIT_ROOM;
		case 'audio': return Math.max(0, BASEHALF_NOTE_SOUND_EDITOR_HEIGHT - media.height);
	}
}

/** What the editor takes above the media's box: the crop frame's margin of a picture; a video's player and a sound's waveform start at the media's top. */
export function baseHalfNoteMediaEditAbove(kind: BaseHalfNoteMediaKind): number {
	return kind === 'image' ? BASEHALF_IMAGE_CROP_MARGIN : 0;
}

/**
 * Where the editor of a picture of a note stands, for the picture's box in
 * the note: the box with the crop frame's margin around it, and the tools and
 * the line under it. The crop view fits the part kept into its view less that
 * margin, so the picture of the editor stands where the note shows the
 * picture, and nothing moves when the editor comes.
 */
export function baseHalfNotePictureEditorBox(picture: IBaseHalfNoteMediaBox): IBaseHalfNoteMediaBox {
	return {
		left: picture.left - BASEHALF_IMAGE_CROP_MARGIN,
		top: picture.top - BASEHALF_IMAGE_CROP_MARGIN,
		width: picture.width + 2 * BASEHALF_IMAGE_CROP_MARGIN,
		height: picture.height + BASEHALF_IMAGE_CROP_MARGIN + BASEHALF_NOTE_PICTURE_EDIT_ROOM,
	};
}

/**
 * Where the editor of a note's media stands, for the media's box as the editor
 * draws it: a picture's with the crop frame's margin around it and its room
 * under it; a video's player at the video's box with the edit bar and the line
 * under it; a sound's waveform at its bar's place, as wide, as tall as its
 * editor (D114).
 */
export function baseHalfNoteMediaEditorBox(kind: BaseHalfNoteMediaKind, media: IBaseHalfNoteMediaBox): IBaseHalfNoteMediaBox {
	switch (kind) {
		case 'image': return baseHalfNotePictureEditorBox(media);
		case 'video': return { left: media.left, top: media.top, width: media.width, height: media.height + BASEHALF_NOTE_VIDEO_EDIT_ROOM };
		case 'audio': return { left: media.left, top: media.top, width: media.width, height: BASEHALF_NOTE_SOUND_EDITOR_HEIGHT };
	}
}

/**
 * Where the editor of a note's picture or video draws it while it edits, in a
 * view `viewHeight` tall from the top of the page's frame: the media's box
 * when the editor fits the view, with what it takes above the box and its room
 * below; otherwise as large as fits between the media's top, or that much
 * under the view's top when the media's top is above it, and the room above
 * the view's bottom, its middle across where the media's is, so that the
 * tools never fall below the view, which does not scroll while the editor is
 * open. A sound's editor is drawn where its bar is.
 */
export function baseHalfNoteMediaEditorFit(kind: BaseHalfNoteMediaKind, media: IBaseHalfNoteMediaBox, viewHeight: number): IBaseHalfNoteMediaBox {
	if (kind === 'audio') {
		return media;
	}
	const top = Math.max(media.top, baseHalfNoteMediaEditAbove(kind));
	const room = viewHeight - baseHalfNoteMediaEditRoom(kind, media) - top;
	// A scroll of the page lands on whole pixels of the screen: a fraction of a pixel more is no reason to move.
	if (top === media.top && media.height <= room + 1) {
		return media;
	}
	const scale = Math.min(1, Math.max(1, room) / media.height);
	const width = media.width * scale;
	return { left: media.left + (media.width - width) / 2, top, width, height: media.height * scale };
}
