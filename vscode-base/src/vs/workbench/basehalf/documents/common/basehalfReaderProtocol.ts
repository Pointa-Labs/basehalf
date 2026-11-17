/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What the reader of PDFs and books and Card Detail say to each other about
// the parts they share (PDFs and books, "The reader"). The pages import this
// module, so it imports nothing.

/** The tabs of the reader's panel at the left. A book has no Pages. */
export type BaseHalfReaderTab = 'pages' | 'contents';

const TABS = new Set<BaseHalfReaderTab>(['pages', 'contents']);

/**
 * Whether the panel at the left is open and its tab, and whether the
 * Comments panel at the right is open, kept on this computer for PDFs and
 * for books apart (PDFs and books, rule 18).
 */
export interface IBaseHalfReaderPanelState {
	readonly open: boolean;
	readonly tab: BaseHalfReaderTab;
	readonly comments: boolean;
}

export const DEFAULT_BASEHALF_READER_PANEL_STATE: IBaseHalfReaderPanelState = Object.freeze({ open: false, tab: 'contents', comments: false });

export function normalizeBaseHalfReaderPanelState(value: unknown): IBaseHalfReaderPanelState {
	if (!value || typeof value !== 'object') {
		return DEFAULT_BASEHALF_READER_PANEL_STATE;
	}
	const candidate = value as Partial<Record<keyof IBaseHalfReaderPanelState, unknown>>;
	return {
		open: candidate.open === true,
		tab: TABS.has(candidate.tab as BaseHalfReaderTab) ? candidate.tab as BaseHalfReaderTab : DEFAULT_BASEHALF_READER_PANEL_STATE.tab,
		comments: candidate.comments === true
	};
}

/** The page says how its panels stand, which Sidebar and Comments of the header show and Card Detail keeps. */
export interface IBaseHalfReaderPanelMessage {
	readonly type: 'basehalf.reader.panel';
	readonly state: IBaseHalfReaderPanelState;
}

/** A link of a PDF to a website, which the window opens after its question. */
export interface IBaseHalfReaderOpenLinkMessage {
	readonly type: 'basehalf.reader.openLink';
	readonly href: string;
}

/**
 * Whether a field of text of the page has the keyboard, such as a comment
 * note: there Cmd+Z undoes the typing, and elsewhere in the reader it undoes
 * the steps of the canvas, such as a highlight (comments, rule 26).
 */
export interface IBaseHalfReaderTextFocusMessage {
	readonly type: 'basehalf.reader.textFocus';
	readonly focused: boolean;
}

/** The title of the chapter a book shows, which the header shows after the name (PDFs and books, rule 15). */
export interface IBaseHalfReaderChapterMessage {
	readonly type: 'basehalf.reader.chapter';
	readonly title: string;
}

export type BaseHalfReaderPageMessage = IBaseHalfReaderPanelMessage | IBaseHalfReaderOpenLinkMessage | IBaseHalfReaderTextFocusMessage | IBaseHalfReaderChapterMessage;

/** A press of Sidebar, Find, or Comments in the header of Card Detail, which the page carries out. */
export interface IBaseHalfReaderCommandMessage {
	readonly type: 'basehalf.reader.command';
	readonly command: BaseHalfReaderCommand;
}

export type BaseHalfReaderCommand = 'toggleSidebar' | 'find' | 'toggleComments';

const COMMANDS = new Set<BaseHalfReaderCommand>(['toggleSidebar', 'find', 'toggleComments']);

/** The page's message about its panel or a link, or undefined: a page is untrusted. */
export function baseHalfReaderPageMessage(value: unknown): BaseHalfReaderPageMessage | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const message = value as Record<string, unknown>;
	if (message.type === 'basehalf.reader.panel') {
		return { type: 'basehalf.reader.panel', state: normalizeBaseHalfReaderPanelState(message.state) };
	}
	if (message.type === 'basehalf.reader.openLink' && typeof message.href === 'string' && message.href.length <= 8_192) {
		return { type: 'basehalf.reader.openLink', href: message.href };
	}
	if (message.type === 'basehalf.reader.textFocus') {
		return { type: 'basehalf.reader.textFocus', focused: message.focused === true };
	}
	if (message.type === 'basehalf.reader.chapter') {
		return { type: 'basehalf.reader.chapter', title: typeof message.title === 'string' ? message.title.replace(/\s+/g, ' ').trim().slice(0, 300) : '' };
	}
	return undefined;
}

/** The command of the header, as the page reads it. */
export function baseHalfReaderCommandMessage(value: unknown): IBaseHalfReaderCommandMessage | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const message = value as Record<string, unknown>;
	return message.type === 'basehalf.reader.command' && COMMANDS.has(message.command as BaseHalfReaderCommand)
		? { type: 'basehalf.reader.command', command: message.command as BaseHalfReaderCommand }
		: undefined;
}

/** The words of the reader and of its comments, in the workbench's language. */
export interface IBaseHalfReaderLabels {
	readonly pages: string;
	readonly contents: string;
	readonly comments: string;
	/** The field of the find bar. */
	readonly find: string;
	readonly previousMatch: string;
	readonly nextMatch: string;
	readonly close: string;
	/** "{0} of {1}": the match shown and how many there are. */
	readonly matchOf: string;
	readonly noResults: string;
	/** "Page {0}". */
	readonly page: string;
	readonly goToPage: string;
	readonly zoom: string;
	readonly zoomIn: string;
	readonly zoomOut: string;
	readonly fitWidth: string;
	readonly fitPage: string;
	/** "Zoom to {0}%". */
	readonly zoomTo: string;
	readonly zoomPercentage: string;
	readonly place: string;
	readonly textSize: string;
	readonly largerText: string;
	readonly smallerText: string;
	readonly pagesFlow: string;
	readonly scrollFlow: string;
	readonly untitledSection: string;
	readonly highlight: string;
	readonly comment: string;
	readonly growBranch: string;
	readonly copy: string;
	readonly addComment: string;
	readonly delete: string;
	readonly reply: string;
	readonly commentPlaceholder: string;
	readonly noComments: string;
	readonly commentsUnreadable: string;
	readonly passageNotFound: string;
	readonly yellow: string;
	readonly green: string;
	readonly blue: string;
	readonly pink: string;
	readonly purple: string;
	readonly opening: string;
	readonly failed: string;
	readonly password: string;
	readonly passwordWrong: string;
	readonly open: string;
	readonly cancel: string;
}
