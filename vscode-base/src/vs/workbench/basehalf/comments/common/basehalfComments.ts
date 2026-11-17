/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The highlights and comments of a PDF, a book, or a note (comments, "The
// file"): entries of one list, a comment with words or replies and a
// highlight without either. The readers and the Rich editor import this
// module into their pages, so it imports nothing.

/** The colors of a highlight, in the order its tools show them. */
export const BASEHALF_COMMENT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;

export type BaseHalfCommentColor = typeof BASEHALF_COMMENT_COLORS[number];

/** The color of a highlight that names none, and the one color of every comment. */
export const BASEHALF_COMMENT_DEFAULT_COLOR: BaseHalfCommentColor = 'yellow';

/** The most characters of a comment's words, of a reply's, and of a passage. */
export const BASEHALF_COMMENT_TEXT_LIMIT = 10_000;

/** The most characters before and after a passage that tell apart a quote found more than once. */
export const BASEHALF_COMMENT_CONTEXT_LENGTH = 32;

/** Words under a comment, by the user or by an agent. */
export interface IBaseHalfCommentReply {
	readonly text: string;
	/** An agent's name; none for the user. */
	readonly by?: string;
	/** When it was written, ISO 8601 in UTC. */
	readonly at?: string;
}

/**
 * An entry of the file: a comment, a passage or a place on a page with words
 * and replies, or a highlight, a passage with a color. A comment has no color
 * of its own: it is yellow.
 */
export interface IBaseHalfComment {
	/** Eight lowercase letters and digits, unique in its file. */
	readonly id: string;
	/** The passage, as the reader shows its text. */
	readonly quote?: string;
	readonly before?: string;
	readonly after?: string;
	/** A PDF's page that the passage begins on, from 1. */
	readonly page?: number;
	/** A book's entry of the contents that the passage begins in. */
	readonly chapter?: string;
	/** A page comment's place: fractions of the page's width and height from its top left corner. */
	readonly place?: readonly [number, number];
	/** A highlight's color; kept, and not shown, on a comment. */
	readonly color: BaseHalfCommentColor;
	/** A comment's words; empty for a highlight. */
	readonly text: string;
	readonly by?: string;
	readonly at?: string;
	readonly replies: readonly IBaseHalfCommentReply[];
}

export function isBaseHalfCommentColor(value: unknown): value is BaseHalfCommentColor {
	return typeof value === 'string' && (BASEHALF_COMMENT_COLORS as readonly string[]).includes(value);
}

/** An entry without words and without replies is a highlight; one with either is a comment. */
export function isBaseHalfHighlight(comment: Pick<IBaseHalfComment, 'text' | 'replies'>): boolean {
	return !comment.text.trim() && comment.replies.length === 0;
}

/** Whether a comment can be shown: it has a passage, a place, or a page. */
export function isBaseHalfCommentShown(comment: Pick<IBaseHalfComment, 'quote' | 'place' | 'page'>): boolean {
	return !!comment.quote || !!comment.place || comment.page !== undefined;
}

const ID_CHARACTERS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new id of eight lowercase letters and digits that `taken` does not hold. */
export function newBaseHalfCommentId(taken: ReadonlySet<string> = new Set(), random: () => number = Math.random): string {
	for (; ;) {
		let id = '';
		for (let index = 0; index < 8; index++) {
			id += ID_CHARACTERS[Math.floor(random() * ID_CHARACTERS.length) % ID_CHARACTERS.length];
		}
		if (!taken.has(id)) {
			return id;
		}
	}
}

/** Whether `value` is an id that BaseHalf writes. */
export function isBaseHalfCommentId(value: unknown): value is string {
	return typeof value === 'string' && /^[a-z0-9]{8}$/.test(value);
}

/** Text cut at `limit` characters, never inside a character. */
export function baseHalfCommentCut(text: string, limit: number = BASEHALF_COMMENT_TEXT_LIMIT): string {
	if (text.length <= limit) {
		return text;
	}
	const code = text.charCodeAt(limit - 1);
	return text.slice(0, code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit);
}

/** The time of now as a comment holds it. */
export function baseHalfCommentTime(date: Date = new Date()): string {
	return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * A comment from a page's message, or undefined when it is not one: a page is
 * untrusted, so every field is checked and cut to its limit.
 */
export function baseHalfCommentFromMessage(value: unknown): IBaseHalfComment | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	if (!isBaseHalfCommentId(candidate.id)) {
		return undefined;
	}
	const text = typeof candidate.text === 'string' ? baseHalfCommentCut(candidate.text) : '';
	const quote = typeof candidate.quote === 'string' && candidate.quote.trim() ? baseHalfCommentCut(candidate.quote) : undefined;
	const page = typeof candidate.page === 'number' && Number.isInteger(candidate.page) && candidate.page >= 1 ? candidate.page : undefined;
	const place = baseHalfCommentPlace(candidate.place);
	const replies = Array.isArray(candidate.replies) ? candidate.replies.map(baseHalfCommentReplyFromMessage).filter((reply): reply is IBaseHalfCommentReply => !!reply) : [];
	const comment: IBaseHalfComment = {
		id: candidate.id as string,
		...(quote ? { quote } : {}),
		...(typeof candidate.before === 'string' && candidate.before ? { before: candidate.before.slice(-BASEHALF_COMMENT_CONTEXT_LENGTH) } : {}),
		...(typeof candidate.after === 'string' && candidate.after ? { after: candidate.after.slice(0, BASEHALF_COMMENT_CONTEXT_LENGTH) } : {}),
		...(page !== undefined ? { page } : {}),
		...(typeof candidate.chapter === 'string' && candidate.chapter.trim() ? { chapter: candidate.chapter.slice(0, 500) } : {}),
		...(place ? { place } : {}),
		color: isBaseHalfCommentColor(candidate.color) ? candidate.color : BASEHALF_COMMENT_DEFAULT_COLOR,
		text,
		...(typeof candidate.by === 'string' && candidate.by.trim() ? { by: candidate.by.slice(0, 100) } : {}),
		...(typeof candidate.at === 'string' && candidate.at ? { at: candidate.at.slice(0, 40) } : {}),
		replies
	};
	return isBaseHalfCommentShown(comment) ? comment : undefined;
}

function baseHalfCommentReplyFromMessage(value: unknown): IBaseHalfCommentReply | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.text !== 'string' || !candidate.text.trim()) {
		return undefined;
	}
	return {
		text: baseHalfCommentCut(candidate.text),
		...(typeof candidate.by === 'string' && candidate.by.trim() ? { by: candidate.by.slice(0, 100) } : {}),
		...(typeof candidate.at === 'string' && candidate.at ? { at: candidate.at.slice(0, 40) } : {})
	};
}

/** A place on a page, `[x, y]` with both from 0 to 1, or undefined. */
export function baseHalfCommentPlace(value: unknown): readonly [number, number] | undefined {
	if (!Array.isArray(value) || value.length !== 2) {
		return undefined;
	}
	const [x, y] = value;
	if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
		return undefined;
	}
	// Four decimals, as the file keeps them: a hundredth of a pixel on a page drawn 10,000 pixels wide.
	const clamp = (number: number) => Math.round(Math.min(1, Math.max(0, number)) * 10_000) / 10_000;
	return [clamp(x), clamp(y)];
}
