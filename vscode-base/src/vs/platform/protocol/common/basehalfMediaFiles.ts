/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The files that BaseHalf shows as an image, a PDF, a book, a sound, or a
 * video, on a card of the canvas and in Card Detail alike, by their extension
 * with the dot, in lower case (architecture invariants, "Product shell"). One
 * list, so that a file that one of them shows the other shows as well.
 */
export const BASEHALF_MEDIA_FILE_EXTENSIONS = Object.freeze({
	image: Object.freeze(['.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp']),
	pdf: Object.freeze(['.pdf']),
	// EPUB, Kindle, FictionBook, and comic book archives (PDFs and books, "The formats").
	book: Object.freeze(['.azw', '.azw3', '.cbz', '.epub', '.fb2', '.fbz', '.mobi']),
	audio: Object.freeze(['.flac', '.m4a', '.mp3', '.oga', '.ogg', '.wav']),
	video: Object.freeze(['.m4v', '.mkv', '.mov', '.mp4', '.webm'])
});

/**
 * The media files that the window loads itself, from any folder, through its
 * file protocol: the image of a card, the sound and the video that a card
 * and Card Detail play in BaseHalf's player, and the PDF whose first page the
 * window's worker draws for its card. A PDF and a book are read in a page of
 * their own.
 */
export const BASEHALF_WINDOW_MEDIA_FILE_EXTENSIONS: readonly string[] = Object.freeze([
	...BASEHALF_MEDIA_FILE_EXTENSIONS.image,
	...BASEHALF_MEDIA_FILE_EXTENSIONS.pdf,
	...BASEHALF_MEDIA_FILE_EXTENSIONS.audio,
	...BASEHALF_MEDIA_FILE_EXTENSIONS.video
]);
