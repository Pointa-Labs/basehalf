/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { asWebviewUri, webviewGenericCspSource } from '../../../contrib/webview/common/webview.js';
import { IBaseHalfBookReaderLabels, IBaseHalfBookReaderPreferences, IBaseHalfBookViewState } from '../common/basehalfBookReaderProtocol.js';

/** The words of the book reader, in the workbench's language. */
export function baseHalfBookReaderLabels(): IBaseHalfBookReaderLabels {
	return {
		contents: localize('basehalf.book.contents', "Contents"),
		search: localize('basehalf.book.search', "Search in Book"),
		searchPlaceholder: localize('basehalf.book.searchPlaceholder', "Search in book"),
		searching: localize('basehalf.book.searching', "Searching… {0}"),
		noMatches: localize('basehalf.book.noMatches', "No matches"),
		oneMatch: localize('basehalf.book.oneMatch', "1 match"),
		matches: localize('basehalf.book.matches', "{0} matches"),
		smallerText: localize('basehalf.book.smallerText', "Smaller Text"),
		largerText: localize('basehalf.book.largerText', "Larger Text"),
		pages: localize('basehalf.book.pages', "Pages"),
		scroll: localize('basehalf.book.scroll', "One Scroll"),
		previousPage: localize('basehalf.book.previousPage', "Previous Page"),
		nextPage: localize('basehalf.book.nextPage', "Next Page"),
		place: localize('basehalf.book.place', "Place in the book"),
		opening: localize('basehalf.book.opening', "Opening book…"),
		failed: localize('basehalf.book.failed', "BaseHalf could not open this book."),
		growBranch: localize('basehalf.pdf.branch.action', "Grow branch"),
		untitledSection: localize('basehalf.book.untitledSection', "Untitled section")
	};
}

export interface IBaseHalfBookReaderPageOptions {
	/** The book, which the page reads through the webview's resource loader. */
	readonly resource: URI;
	readonly script: URI;
	readonly style: URI;
	readonly viewState: IBaseHalfBookViewState;
	readonly preferences: IBaseHalfBookReaderPreferences;
	readonly locale: string;
	readonly labels: IBaseHalfBookReaderLabels;
}

/**
 * The page of the book reader (PDFs and books, "The book reader"). Its content
 * security policy runs only the reader's own script, which carries the nonce:
 * a book's pages inherit it, so no script of a book runs, and a book loads
 * nothing from the network, only what its own file holds.
 */
export function baseHalfBookReaderHtml(options: IBaseHalfBookReaderPageOptions): string {
	const nonce = generateUuid();
	const attribute = (value: string) => escapeAttribute(value);
	const csp = [
		`default-src 'none'`,
		`script-src 'nonce-${nonce}'`,
		`style-src ${webviewGenericCspSource} 'unsafe-inline' blob:`,
		`img-src blob: data:`,
		`font-src blob: data:`,
		`media-src blob: data:`,
		`frame-src blob:`,
		`connect-src ${webviewGenericCspSource} blob:`,
		`form-action 'none'`,
		`base-uri 'none'`
	].join('; ');
	return `<!DOCTYPE html>
<html lang="${attribute(options.locale)}">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${attribute(csp)};">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${attribute(asWebviewUri(options.style).toString(true))}">
</head>
<body>
	<div id="basehalf-book-reader" data-status="loading"
		data-source="${attribute(asWebviewUri(options.resource).toString(true))}"
		data-name="${attribute(basename(options.resource))}"
		data-location="${attribute(options.viewState.location ?? '')}"
		data-text-size="${options.preferences.textSize}"
		data-flow="${options.preferences.flow}"
		data-locale="${attribute(options.locale)}"
		data-labels="${attribute(JSON.stringify(options.labels))}">
		<header class="bar top">
			<button id="contents" class="icon" type="button" aria-expanded="false"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01"/></svg></button>
			<div id="chapter" class="chapter"></div>
			<div class="actions">
				<button id="search" class="icon" type="button" aria-expanded="false"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2l3.3 3.3"/></svg></button>
				<button id="smaller" class="icon text-size" type="button">A</button>
				<button id="larger" class="icon text-size larger" type="button">A</button>
				<button id="flow" class="icon" type="button"><svg class="pages-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4.2C6.8 3.4 5 3 2.5 3.1v8.8c2.5-.1 4.3.3 5.5 1.1M8 4.2c1.2-.8 3-1.2 5.5-1.1v8.8c-2.5-.1-4.3.3-5.5 1.1z"/></svg><svg class="scroll-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h7v11h-7zM6.5 5.5h3M6.5 8h3M6.5 10.5h3"/></svg></button>
			</div>
		</header>
		<main id="book"></main>
		<footer class="bar bottom">
			<button id="previous" class="icon" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg></button>
			<input id="progress" type="range" min="0" max="1000" step="1" value="0">
			<span id="percent"></span>
			<button id="next" class="icon" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg></button>
		</footer>
		<aside id="panel" hidden>
			<div id="search-box" hidden>
				<input id="search-input" type="search" spellcheck="false">
				<div id="search-status" role="status" aria-live="polite"></div>
			</div>
			<nav id="toc"></nav>
			<ol id="results" hidden></ol>
		</aside>
		<button id="grow" type="button" hidden></button>
		<div id="hover" role="tooltip" hidden></div>
		<div id="status" class="status loading" role="status" aria-live="polite">
			<div class="status-content">
				<div class="status-placeholder" aria-hidden="true"></div>
				<p id="status-message" class="status-message"></p>
			</div>
		</div>
	</div>
	<script nonce="${nonce}" type="module" src="${attribute(asWebviewUri(options.script).toString(true))}"></script>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
	return value.replace(/[&<>"']/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		'\'': '&#39;'
	}[character]!));
}
