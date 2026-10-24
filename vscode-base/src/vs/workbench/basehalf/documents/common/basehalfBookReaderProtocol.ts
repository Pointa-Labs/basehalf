/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The messages between Card Detail and the page of the book reader (PDFs and
// books, "The book reader"). The page's bundle imports this module, so it
// imports nothing: whatever the page says is read as untrusted.

/** Where the user is in a book: its place, as an EPUB CFI, and how far into the book that is. */
export interface IBaseHalfBookViewState {
	readonly location?: string;
	readonly fraction?: number;
}

/** How the user reads every book on this computer. */
export interface IBaseHalfBookReaderPreferences {
	/** The size of the text, in percent of the book's own. */
	readonly textSize: number;
	readonly flow: 'paginated' | 'scrolled';
}

/** Text selected in a book. */
export interface IBaseHalfBookSelection {
	readonly text: string;
	/** The entry of the book's contents that the selection begins in. */
	readonly chapter?: string;
}

/** Why a book does not read: anything else is a message for the log. */
export type BaseHalfBookReaderMessage =
	| { readonly type: 'basehalf.book.viewState'; readonly state: IBaseHalfBookViewState }
	| { readonly type: 'basehalf.book.preferences'; readonly preferences: IBaseHalfBookReaderPreferences }
	| { readonly type: 'basehalf.book.createBranch'; readonly selection: IBaseHalfBookSelection }
	| { readonly type: 'basehalf.book.selectionChanged'; readonly selection?: IBaseHalfBookSelection }
	| { readonly type: 'basehalf.book.openLink'; readonly href: string }
	| { readonly type: 'basehalf.book.failed'; readonly message: string }
	| { readonly type: 'basehalf.book.userInteraction' }
	| { readonly type: 'basehalf.media.escape' };

/** The words of the reader's page, in the workbench's language. `{0}` stands for a number. */
export interface IBaseHalfBookReaderLabels {
	readonly contents: string;
	readonly search: string;
	readonly searchPlaceholder: string;
	readonly searching: string;
	readonly noMatches: string;
	readonly oneMatch: string;
	readonly matches: string;
	readonly smallerText: string;
	readonly largerText: string;
	readonly pages: string;
	readonly scroll: string;
	readonly previousPage: string;
	readonly nextPage: string;
	readonly place: string;
	readonly opening: string;
	readonly failed: string;
	readonly growBranch: string;
	readonly untitledSection: string;
}

export const BASEHALF_BOOK_TEXT_SIZES: readonly number[] = [70, 80, 90, 100, 110, 120, 135, 150, 170, 200];

export const DEFAULT_BASEHALF_BOOK_READER_PREFERENCES: IBaseHalfBookReaderPreferences = Object.freeze({ textSize: 100, flow: 'paginated' });

/** The longest text the page sends of a selection: one character more than the record of agents keeps. */
export const BASEHALF_BOOK_SELECTION_TEXT_LIMIT = 10_001;

/** The longest passage that grows a note. */
const BRANCH_TEXT_LIMIT = 50_000;

const CFI = /^epubcfi\(.{1,2000}\)$/s;

export function normalizeBaseHalfBookViewState(value: unknown): IBaseHalfBookViewState {
	const state = value as Partial<Record<keyof IBaseHalfBookViewState, unknown>> | null | undefined;
	if (!state || typeof state !== 'object') {
		return {};
	}
	return {
		...(typeof state.location === 'string' && CFI.test(state.location) ? { location: state.location } : {}),
		...(typeof state.fraction === 'number' && Number.isFinite(state.fraction) ? { fraction: Math.min(1, Math.max(0, state.fraction)) } : {})
	};
}

export function normalizeBaseHalfBookReaderPreferences(value: unknown): IBaseHalfBookReaderPreferences {
	const preferences = value as Partial<Record<keyof IBaseHalfBookReaderPreferences, unknown>> | null | undefined;
	return {
		textSize: typeof preferences?.textSize === 'number' && BASEHALF_BOOK_TEXT_SIZES.includes(preferences.textSize) ? preferences.textSize : DEFAULT_BASEHALF_BOOK_READER_PREFERENCES.textSize,
		flow: preferences?.flow === 'scrolled' ? 'scrolled' : 'paginated'
	};
}

function selectionOf(value: unknown, limit: number): IBaseHalfBookSelection | undefined {
	const selection = value as Partial<Record<keyof IBaseHalfBookSelection, unknown>> | null | undefined;
	if (!selection || typeof selection !== 'object' || typeof selection.text !== 'string') {
		return undefined;
	}
	const text = selection.text.slice(0, limit);
	if (!text.trim()) {
		return undefined;
	}
	const chapter = typeof selection.chapter === 'string' ? selection.chapter.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
	return { text, ...(chapter ? { chapter } : {}) };
}

/** A message of the page as it may be taken, or undefined for anything else. */
export function baseHalfBookReaderMessage(value: unknown): BaseHalfBookReaderMessage | undefined {
	const message = value as { readonly type?: unknown; readonly [key: string]: unknown } | null | undefined;
	switch (message?.type) {
		case 'basehalf.book.viewState':
			return { type: message.type, state: normalizeBaseHalfBookViewState(message.state) };
		case 'basehalf.book.preferences':
			return { type: message.type, preferences: normalizeBaseHalfBookReaderPreferences(message.preferences) };
		case 'basehalf.book.createBranch': {
			const selection = selectionOf(message.selection, BRANCH_TEXT_LIMIT);
			return selection ? { type: message.type, selection: { ...selection, text: selection.text.trim() } } : undefined;
		}
		case 'basehalf.book.selectionChanged': {
			const selection = message.selection === undefined ? undefined : selectionOf(message.selection, BASEHALF_BOOK_SELECTION_TEXT_LIMIT);
			return { type: message.type, ...(selection ? { selection } : {}) };
		}
		case 'basehalf.book.openLink':
			return typeof message.href === 'string' && message.href.length <= 4096 ? { type: message.type, href: message.href } : undefined;
		case 'basehalf.book.failed':
			return { type: message.type, message: typeof message.message === 'string' ? message.message.slice(0, 2000) : '' };
		case 'basehalf.book.userInteraction':
		case 'basehalf.media.escape':
			return { type: message.type };
		default:
			return undefined;
	}
}
