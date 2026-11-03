/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The names in the store of a note's files (files in notes, rules 8 to 11):
// the name of a note's folder, the cleaned name of a file, the name of a
// picture that came without one, and the number a taken name gets.

/** The folders of a home that hold the store. */
export const BASEHALF_NOTE_FILES_STORE_PATH: readonly string[] = ['.bh', 'attachments'];

/** The file that marks a folder in which BaseHalf sets nothing up. */
export const BASEHALF_NO_WORKSPACE_SETUP_MARKER = '.basehalf-no-workspace-setup';

const FOLDER_NAME_CHARACTERS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const FOLDER_NAME_LENGTH = 10;
const MAX_NAME_LENGTH = 160;

/** A new name for a note's folder: 10 random characters of `a-z` and `0-9` (rule 8). */
export function newBaseHalfNoteFolderName(randomBytes: (length: number) => Uint8Array = length => globalThis.crypto.getRandomValues(new Uint8Array(length))): string {
	let name = '';
	for (const byte of randomBytes(FOLDER_NAME_LENGTH)) {
		name += FOLDER_NAME_CHARACTERS[byte % FOLDER_NAME_CHARACTERS.length];
	}
	return name;
}

function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot) : '';
}

/**
 * A file's own name, cleaned for the store (rule 9): control characters and
 * the characters that some systems forbid in names become `-`, white space
 * becomes one space, trailing dots and spaces go, a device name gets `_`, and
 * a name keeps at most 160 characters with its extension. It is stored in
 * NFC; `[` and `]` become `(` and `)`, which links and pictures write without
 * escapes; and a name git reads as its own file gets `_` in front.
 */
export function baseHalfNoteFileName(value: string): string {
	const replaced = value
		.normalize('NFC')
		.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')
		.replace(/\[/g, '(')
		.replace(/\]/g, ')')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[. ]+$/g, '');
	let name = replaced && replaced !== '.' && replaced !== '..' ? replaced : 'file';
	const extension = extensionOf(name);
	const stem = name.slice(0, name.length - extension.length);
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) || /^\.git(?:ignore|attributes|modules)?$/i.test(name)) {
		name = `_${name}`;
	}
	if (name.length > MAX_NAME_LENGTH) {
		name = `${name.slice(0, Math.max(1, MAX_NAME_LENGTH - extension.length))}${extension}`;
	}
	return name;
}

const PICTURE_EXTENSIONS: Readonly<Record<string, string>> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/gif': '.gif',
	'image/webp': '.webp',
	'image/bmp': '.bmp',
	'image/tiff': '.tiff',
	'image/svg+xml': '.svg',
	'image/heic': '.heic',
	'image/avif': '.avif',
};

/**
 * Whether a file is a picture that came without a name of its own: a
 * screenshot or a picture copied from a page or an app, which the page names
 * `image.png` or leaves without a name (rule 10).
 */
export function isBaseHalfNoteUnnamedPicture(name: string, mediaType: string): boolean {
	if (!/^image\//i.test(mediaType)) {
		return false;
	}
	const trimmed = name.trim();
	return trimmed === '' || /^(?:image|blob)(?:\.[a-z0-9]+)?$/i.test(trimmed);
}

/** The name of a picture that came without one: the local time it was put in, `untitled 2026-11-03 15.30.12.png`. */
export function baseHalfNoteUntitledPictureName(at: Date, name: string, mediaType: string): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	const extension = PICTURE_EXTENSIONS[mediaType.toLowerCase()] ?? (extensionOf(name.trim()) || '.png');
	return `untitled ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}${extension}`;
}

/** A taken name with its number (rule 11): `cat.jpg`, then `cat 2.jpg`. */
export function baseHalfNoteNumberedName(name: string, number: number): string {
	const extension = extensionOf(name);
	return `${name.slice(0, name.length - extension.length)} ${Math.max(2, Math.trunc(number))}${extension}`;
}

/** The first name of `name` and its numbered names that `taken`, which compares without case, does not hold. */
export function baseHalfNoteFreeName(name: string, taken: ReadonlySet<string>): string {
	if (!taken.has(name.toLowerCase())) {
		return name;
	}
	for (let number = 2; ; number++) {
		const numbered = baseHalfNoteNumberedName(name, number);
		if (!taken.has(numbered.toLowerCase())) {
			return numbered;
		}
	}
}
