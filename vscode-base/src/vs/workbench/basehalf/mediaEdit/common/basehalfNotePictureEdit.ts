/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A picture edited in its note (D113): the editor of the picture's card,
// drawn by the window over the picture where the note shows it, with room
// that the note makes under the picture for the tools. Rich's page imports
// this module: it imports nothing.

/** The margin in which the crop view's frame rests inside its view (`BASEHALF_EDGE_FOLLOW_MARGIN` in basehalfMediaZoom.ts). */
export const BASEHALF_IMAGE_CROP_MARGIN = 24;

/** The height of the crop view's row of tools (`.basehalf-image-crop-tools` in basehalfImageCropView.css). */
export const BASEHALF_IMAGE_CROP_TOOLS_HEIGHT = 56;

/** The height of the line under the editor of a picture, with its foot (basehalfMediaEditing.css and basehalfNotePictureEditing.css). */
export const BASEHALF_MEDIA_EDIT_LINE_HEIGHT = 28;

/** The room a note makes under a picture while it is edited: the part of the editor below the picture. */
export const BASEHALF_NOTE_PICTURE_EDIT_ROOM = BASEHALF_IMAGE_CROP_MARGIN + BASEHALF_IMAGE_CROP_TOOLS_HEIGHT + BASEHALF_MEDIA_EDIT_LINE_HEIGHT;

export interface IBaseHalfNotePictureBox {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/**
 * Where the editor of a picture of a note stands, for the picture's box in
 * the note: the box with the crop frame's margin around it, and the tools and
 * the line under it. The crop view fits the part kept into its view less that
 * margin, so the picture of the editor stands where the note shows the
 * picture, and nothing moves when the editor comes.
 */
export function baseHalfNotePictureEditorBox(picture: IBaseHalfNotePictureBox): IBaseHalfNotePictureBox {
	return {
		left: picture.left - BASEHALF_IMAGE_CROP_MARGIN,
		top: picture.top - BASEHALF_IMAGE_CROP_MARGIN,
		width: picture.width + 2 * BASEHALF_IMAGE_CROP_MARGIN,
		height: picture.height + BASEHALF_IMAGE_CROP_MARGIN + BASEHALF_NOTE_PICTURE_EDIT_ROOM,
	};
}

/**
 * Where the editor of a picture of a note draws the picture while it edits,
 * in a view `viewHeight` tall from the top of the page's frame: the picture's
 * box when the editor fits the view, its margin above and its room below;
 * otherwise as large as fits between the picture's top, or the margin under
 * the view's top when the picture's top is above it, and the room above the
 * view's bottom, its middle across where the picture's is, so that the tools
 * never fall below the view, which does not scroll while the editor is open.
 */
export function baseHalfNotePictureEditorFit(picture: IBaseHalfNotePictureBox, viewHeight: number): IBaseHalfNotePictureBox {
	const top = Math.max(picture.top, BASEHALF_IMAGE_CROP_MARGIN);
	const room = viewHeight - BASEHALF_NOTE_PICTURE_EDIT_ROOM - top;
	// A scroll of the page lands on whole pixels of the screen: a fraction of a pixel more is no reason to move.
	if (top === picture.top && picture.height <= room + 1) {
		return picture;
	}
	const scale = Math.min(1, Math.max(1, room) / picture.height);
	const width = picture.width * scale;
	return { left: picture.left + (picture.width - width) / 2, top, width, height: picture.height * scale };
}
