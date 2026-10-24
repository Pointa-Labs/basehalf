/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * How the user zoomed a PDF: a scale, or one of the viewer's fits. A PDF that
 * the user has not zoomed opens at the width of Card Detail, at most 125 %
 * (PDFs and books, "The PDF reader").
 */
export type BaseHalfPdfZoom = number | 'fit-width' | 'fit-page';

export interface IBaseHalfPdfViewState {
	readonly page: number;
	readonly zoom?: BaseHalfPdfZoom;
}

/** The largest zoom of a PDF that the user has not zoomed. */
export const BASEHALF_PDF_AUTOMATIC_ZOOM_MAX = 1.25;

export interface IBaseHalfPdfViewStateMessage {
	readonly type: 'basehalf.pdf.viewState';
	readonly state: IBaseHalfPdfViewState;
}

export interface IBaseHalfPdfSelection {
	readonly text: string;
	/** One-based page numbers touched by the selection. */
	readonly pages: readonly number[];
}

export interface IBaseHalfPdfCreateBranchMessage {
	readonly type: 'basehalf.pdf.createBranch';
	readonly selection: IBaseHalfPdfSelection;
}

/**
 * The text selected in a PDF, 30 ms after it stops changing, and none when
 * the selection ends: what agents can see (PDFs and books, "What agents can
 * see").
 */
export interface IBaseHalfPdfSelectionChangedMessage {
	readonly type: 'basehalf.pdf.selectionChanged';
	readonly selection?: IBaseHalfPdfSelection;
}

export interface IBaseHalfPdfUserInteractionMessage {
	readonly type: 'basehalf.pdf.userInteraction';
}

/** A PDF that did not open for another reason than its password, with the reason for the log. */
export interface IBaseHalfPdfFailedMessage {
	readonly type: 'basehalf.pdf.failed';
	readonly message: string;
}

/**
 * Escape typed in the page of an image, a sound, or a PDF that nothing of the
 * page used: it closes Card Detail, as it does elsewhere in Card Detail
 * (opening and closing Card Detail, "The keyboard"). Keys typed in a webview
 * do not reach the window's own elements.
 */
export interface IBaseHalfMediaEscapeMessage {
	readonly type: 'basehalf.media.escape';
}

export type BaseHalfPdfWebviewMessage = IBaseHalfPdfViewStateMessage | IBaseHalfPdfCreateBranchMessage | IBaseHalfPdfSelectionChangedMessage | IBaseHalfPdfUserInteractionMessage | IBaseHalfPdfFailedMessage | IBaseHalfMediaEscapeMessage;

/** The longest text the page sends of a selection: one character more than the record of agents keeps. */
export const BASEHALF_PDF_SELECTION_TEXT_LIMIT = 10_001;

export const DEFAULT_BASEHALF_PDF_VIEW_STATE: IBaseHalfPdfViewState = Object.freeze({ page: 1 });

/** Normalize both persisted state and messages received from an isolated webview. */
export function normalizeBaseHalfPdfViewState(value: unknown): IBaseHalfPdfViewState {
	if (!value || typeof value !== 'object') {
		return DEFAULT_BASEHALF_PDF_VIEW_STATE;
	}

	const candidate = value as Partial<Record<keyof IBaseHalfPdfViewState, unknown>>;
	const page = Number.isInteger(candidate.page) && (candidate.page as number) >= 1 ? candidate.page as number : 1;
	const zoom = typeof candidate.zoom === 'number' && Number.isFinite(candidate.zoom)
		? Math.min(5, Math.max(0.25, candidate.zoom))
		: candidate.zoom === 'fit-width' || candidate.zoom === 'fit-page' ? candidate.zoom : undefined;
	return zoom === undefined ? { page } : { page, zoom };
}

export function baseHalfPdfViewStateFromMessage(value: unknown): IBaseHalfPdfViewState | undefined {
	if (!value || typeof value !== 'object' || (value as Partial<IBaseHalfPdfViewStateMessage>).type !== 'basehalf.pdf.viewState') {
		return undefined;
	}

	const state = (value as Partial<IBaseHalfPdfViewStateMessage>).state;
	if (!state || typeof state !== 'object') {
		return undefined;
	}

	return normalizeBaseHalfPdfViewState(state);
}

/** Keep the webview boundary deliberately small: text plus one-based pages. */
function pdfSelectionOf(value: unknown, textLimit: number, trim: boolean): IBaseHalfPdfSelection | undefined {
	const selection = value as Partial<IBaseHalfPdfSelection> | null | undefined;
	if (!selection || typeof selection !== 'object' || typeof selection.text !== 'string') {
		return undefined;
	}

	const text = (trim ? selection.text.trim() : selection.text).slice(0, textLimit);
	if (!text.trim() || !Array.isArray(selection.pages)) {
		return undefined;
	}

	const pages = [...new Set(selection.pages
		.filter((page): page is number => Number.isInteger(page) && page >= 1 && page <= 1_000_000))]
		.sort((left, right) => left - right)
		.slice(0, 1_000);
	if (pages.length === 0) {
		return undefined;
	}

	return { text, pages };
}

/** The passage that Grow branch makes a note of. */
export function baseHalfPdfSelectionFromMessage(value: unknown): IBaseHalfPdfSelection | undefined {
	if (!value || typeof value !== 'object' || (value as Partial<IBaseHalfPdfCreateBranchMessage>).type !== 'basehalf.pdf.createBranch') {
		return undefined;
	}
	return pdfSelectionOf((value as Partial<IBaseHalfPdfCreateBranchMessage>).selection, 50_000, true);
}

/** The text selected in a PDF, or a selection that ended; undefined for any other message. */
export function baseHalfPdfSelectionChangeFromMessage(value: unknown): { readonly selection?: IBaseHalfPdfSelection } | undefined {
	if (!value || typeof value !== 'object' || (value as Partial<IBaseHalfPdfSelectionChangedMessage>).type !== 'basehalf.pdf.selectionChanged') {
		return undefined;
	}
	const selection = pdfSelectionOf((value as Partial<IBaseHalfPdfSelectionChangedMessage>).selection, BASEHALF_PDF_SELECTION_TEXT_LIMIT, false);
	return selection ? { selection } : {};
}

export function isBaseHalfPdfUserInteractionMessage(value: unknown): value is IBaseHalfPdfUserInteractionMessage {
	return !!value
		&& typeof value === 'object'
		&& (value as Partial<IBaseHalfPdfUserInteractionMessage>).type === 'basehalf.pdf.userInteraction';
}

/** The reason a PDF did not open, as the page says it: at most 500 characters, for the log. */
export function baseHalfPdfFailureFromMessage(value: unknown): string | undefined {
	if (!value || typeof value !== 'object' || (value as Partial<IBaseHalfPdfFailedMessage>).type !== 'basehalf.pdf.failed') {
		return undefined;
	}
	const message = (value as Partial<IBaseHalfPdfFailedMessage>).message;
	return typeof message === 'string' ? message.slice(0, 500) : '';
}

export function isBaseHalfMediaEscapeMessage(value: unknown): value is IBaseHalfMediaEscapeMessage {
	return !!value
		&& typeof value === 'object'
		&& (value as Partial<IBaseHalfMediaEscapeMessage>).type === 'basehalf.media.escape';
}
