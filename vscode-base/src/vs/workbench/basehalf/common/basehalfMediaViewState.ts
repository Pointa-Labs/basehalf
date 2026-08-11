/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export interface IBaseHalfPdfViewState {
	readonly page: number;
	readonly zoom: number;
	readonly fitWidth: boolean;
}

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

export interface IBaseHalfPdfUserInteractionMessage {
	readonly type: 'basehalf.pdf.userInteraction';
}

export type BaseHalfPdfWebviewMessage = IBaseHalfPdfViewStateMessage | IBaseHalfPdfCreateBranchMessage | IBaseHalfPdfUserInteractionMessage;

export const DEFAULT_BASEHALF_PDF_VIEW_STATE: IBaseHalfPdfViewState = Object.freeze({
	page: 1,
	zoom: 1,
	fitWidth: true
});

/** Normalize both persisted state and messages received from an isolated webview. */
export function normalizeBaseHalfPdfViewState(value: unknown): IBaseHalfPdfViewState {
	if (!value || typeof value !== 'object') {
		return DEFAULT_BASEHALF_PDF_VIEW_STATE;
	}

	const candidate = value as Partial<IBaseHalfPdfViewState>;
	return {
		page: Number.isInteger(candidate.page) && candidate.page! >= 1 ? candidate.page! : 1,
		zoom: typeof candidate.zoom === 'number' && Number.isFinite(candidate.zoom)
			? Math.min(5, Math.max(0.25, candidate.zoom))
			: 1,
		fitWidth: typeof candidate.fitWidth === 'boolean' ? candidate.fitWidth : true
	};
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
export function baseHalfPdfSelectionFromMessage(value: unknown): IBaseHalfPdfSelection | undefined {
	if (!value || typeof value !== 'object' || (value as Partial<IBaseHalfPdfCreateBranchMessage>).type !== 'basehalf.pdf.createBranch') {
		return undefined;
	}

	const selection = (value as Partial<IBaseHalfPdfCreateBranchMessage>).selection;
	if (!selection || typeof selection !== 'object' || typeof selection.text !== 'string') {
		return undefined;
	}

	const text = selection.text.trim().slice(0, 50_000);
	if (!text || !Array.isArray(selection.pages)) {
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

export function isBaseHalfPdfUserInteractionMessage(value: unknown): value is IBaseHalfPdfUserInteractionMessage {
	return !!value
		&& typeof value === 'object'
		&& (value as Partial<IBaseHalfPdfUserInteractionMessage>).type === 'basehalf.pdf.userInteraction';
}
