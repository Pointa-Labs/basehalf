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
import { DEFAULT_BASEHALF_READER_PANEL_STATE, IBaseHalfReaderLabels, IBaseHalfReaderPanelState } from '../common/basehalfReaderProtocol.js';

/** The words of the book reader's page of its own, in the workbench's language. */
export function baseHalfBookReaderLabels(): IBaseHalfBookReaderLabels {
	return {
		opening: localize('basehalf.book.opening', "Opening book…"),
		failed: localize('basehalf.book.failed', "BaseHalf could not open this book."),
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
	/** The words of the reader that PDFs and books share. */
	readonly reader?: IBaseHalfReaderLabels;
	/** Whether the panel is open, and its tab, as when the last book closed. */
	readonly panel?: IBaseHalfReaderPanelState;
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
	<div id="basehalf-reader" class="reader book" data-status="loading"
		data-source="${attribute(asWebviewUri(options.resource).toString(true))}"
		data-name="${attribute(basename(options.resource))}"
		data-location="${attribute(options.viewState.location ?? '')}"
		data-text-size="${options.preferences.textSize}"
		data-flow="${options.preferences.flow}"
		data-locale="${attribute(options.locale)}"
		data-panel="${attribute(JSON.stringify(options.panel ?? DEFAULT_BASEHALF_READER_PANEL_STATE))}"
		data-labels="${attribute(JSON.stringify(options.labels))}"
		data-reader-labels="${attribute(JSON.stringify(options.reader ?? {}))}">
		<main id="book"></main>
		<div class="turn left" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg></div>
		<div class="turn right" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5"/></svg></div>
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
