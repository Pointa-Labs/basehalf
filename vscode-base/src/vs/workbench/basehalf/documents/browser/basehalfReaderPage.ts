/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { webviewGenericCspSource } from '../../../contrib/webview/common/webview.js';
import { IBaseHalfReaderLabels, IBaseHalfReaderPanelState } from '../common/basehalfReaderProtocol.js';

/** The words of the reader of PDFs and books and of its comments, in the workbench's language. */
export function baseHalfReaderLabels(): IBaseHalfReaderLabels {
	return {
		pages: localize('basehalf.reader.pages', "Pages"),
		contents: localize('basehalf.reader.contents', "Contents"),
		comments: localize('basehalf.reader.comments', "Comments"),
		find: localize('basehalf.reader.find', "Find"),
		previousMatch: localize('basehalf.reader.previousMatch', "Previous Match"),
		nextMatch: localize('basehalf.reader.nextMatch', "Next Match"),
		close: localize('basehalf.reader.close', "Close"),
		matchOf: localize('basehalf.reader.matchOf', "{0} of {1}"),
		noResults: localize('basehalf.reader.noResults', "No results"),
		page: localize('basehalf.reader.page', "Page {0}"),
		goToPage: localize('basehalf.reader.goToPage', "Go to Page"),
		zoom: localize('basehalf.reader.zoom', "Zoom"),
		zoomIn: localize('basehalf.reader.zoomIn', "Zoom In"),
		zoomOut: localize('basehalf.reader.zoomOut', "Zoom Out"),
		fitWidth: localize('basehalf.reader.fitWidth', "Fit Width"),
		fitPage: localize('basehalf.reader.fitPage', "Fit Page"),
		zoomTo: localize('basehalf.reader.zoomTo', "Zoom to {0}%"),
		zoomPercentage: localize('basehalf.reader.zoomPercentage', "Zoom percentage, {0}"),
		place: localize('basehalf.reader.place', "Place in the Book"),
		textSize: localize('basehalf.reader.textSize', "Text Size"),
		largerText: localize('basehalf.reader.largerText', "Larger Text"),
		smallerText: localize('basehalf.reader.smallerText', "Smaller Text"),
		pagesFlow: localize('basehalf.reader.pagesFlow', "Pages"),
		scrollFlow: localize('basehalf.reader.scrollFlow', "One Scroll"),
		untitledSection: localize('basehalf.reader.untitledSection', "Untitled section"),
		highlight: localize('basehalf.reader.highlight', "Highlight"),
		comment: localize('basehalf.reader.comment', "Comment"),
		growBranch: localize('basehalf.pdf.branch.action', "Grow branch"),
		copy: localize('basehalf.reader.copy', "Copy"),
		addComment: localize('basehalf.reader.addComment', "Add Comment"),
		delete: localize('basehalf.reader.delete', "Delete"),
		reply: localize('basehalf.reader.reply', "Reply"),
		commentPlaceholder: localize('basehalf.reader.commentPlaceholder', "Comment"),
		noComments: localize('basehalf.reader.noComments', "No highlights or comments"),
		commentsUnreadable: localize('basehalf.reader.commentsUnreadable', "Comments can't be read"),
		passageNotFound: localize('basehalf.reader.passageNotFound', "Passage not found"),
		yellow: localize('basehalf.reader.yellow', "Yellow"),
		green: localize('basehalf.reader.green', "Green"),
		blue: localize('basehalf.reader.blue', "Blue"),
		pink: localize('basehalf.reader.pink', "Pink"),
		purple: localize('basehalf.reader.purple', "Purple"),
		opening: localize('basehalf.reader.openingPdf', "Opening PDF..."),
		failed: localize('basehalf.pdf.failed', "BaseHalf could not open this PDF."),
		password: localize('basehalf.reader.password', "This PDF is protected with a password."),
		passwordWrong: localize('basehalf.reader.passwordWrong', "The password is not right."),
		open: localize('basehalf.reader.open', "Open"),
		cancel: localize('basehalf.reader.cancel', "Cancel")
	};
}

export interface IBaseHalfPdfReaderPageOptions {
	/** The PDF, as the webview's resource loader serves it. */
	readonly source: string;
	readonly script: string;
	readonly style: string;
	readonly wasm: string;
	readonly fontSc: string;
	readonly name: string;
	readonly locale: string;
	readonly page: number;
	readonly zoom: string;
	readonly panel: IBaseHalfReaderPanelState;
	readonly labels: IBaseHalfReaderLabels;
}

/**
 * The page of the PDF reader (PDFs and books, "The PDF reader"). It runs only
 * its own script and the engine's worker, and loads the PDF, the engine, and a
 * font from the reader's own folder.
 */
export function baseHalfPdfReaderHtml(options: IBaseHalfPdfReaderPageOptions): string {
	const nonce = generateUuid();
	const attribute = escapeAttribute;
	const csp = [
		`default-src 'none'`,
		`connect-src blob: ${webviewGenericCspSource}`,
		`img-src blob: data: ${webviewGenericCspSource}`,
		`style-src ${webviewGenericCspSource} 'unsafe-inline'`,
		`font-src blob: data: ${webviewGenericCspSource}`,
		`script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${webviewGenericCspSource}`,
		`worker-src blob: ${webviewGenericCspSource}`,
		`form-action 'none'`,
		`base-uri 'none'`
	].join('; ');
	return `<!DOCTYPE html>
<html lang="${attribute(options.locale)}">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${attribute(csp)};">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${attribute(options.style)}">
</head>
<body>
	<div id="basehalf-reader" class="reader pdf" data-status="loading"
		data-source="${options.source}"
		data-wasm="${attribute(options.wasm)}"
		data-font-sc="${attribute(options.fontSc)}"
		data-name="${attribute(options.name)}"
		data-locale="${attribute(options.locale)}"
		data-page="${options.page}"
		data-zoom="${attribute(options.zoom)}"
		data-panel="${attribute(JSON.stringify(options.panel))}"
		data-labels="${attribute(JSON.stringify(options.labels))}">
		<div id="basehalf-pdf-document"></div>
		<div class="status loading" id="basehalf-pdf-status" role="status" aria-live="polite">
			<div class="status-content">
				<div class="status-placeholder" aria-hidden="true"></div>
				<p class="status-message" id="basehalf-pdf-status-message">${escapeText(options.labels.opening)}</p>
			</div>
		</div>
	</div>
	<script nonce="${nonce}" type="module" src="${attribute(options.script)}"></script>
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

function escapeText(value: string): string {
	return value.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]!));
}
