/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfPdfSelection } from './basehalfMediaViewState.js';

function withoutPdfExtension(value: string): string {
	return value.toLowerCase().endsWith('.pdf') ? value.slice(0, -4) : value;
}

/** A predictable, human-editable filename for a note grown from a PDF. */
export function baseHalfPdfBranchBaseName(sourceName: string): string {
	const normalized = withoutPdfExtension(sourceName)
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
		.replace(/\s+/g, ' ')
		.replace(/[. ]+$/g, '')
		.trim();
	const safe = [...normalized].slice(0, 72).join('');
	return `${safe || 'pdf'}-note`;
}

/** A branch should be recognizable on the canvas without repeating the PDF filename. */
export function baseHalfPdfBranchTitle(text: string): string {
	const normalized = text.replace(/\s+/gu, ' ').trim();
	if (!normalized) {
		return 'PDF note';
	}
	const sentence = normalized.match(/^(.{1,80}?(?:[。！？]|[.!?](?=\s|$)))/u)?.[1] ?? normalized;
	const characters = [...sentence];
	return characters.length <= 72
		? sentence
		: `${characters.slice(0, 69).join('').trimEnd()}…`;
}

function escapeMarkdownInline(value: string): string {
	return value.replace(/([\\`*_\[\]<>])/g, '\\$1');
}

/** The selected passage is authored as a normal Markdown note, not hidden app state. */
export function baseHalfPdfBranchMarkdown(sourceName: string, selection: IBaseHalfPdfSelection): string {
	const displayName = sourceName.replace(/[\r\n]+/g, ' ');
	const title = escapeMarkdownInline(baseHalfPdfBranchTitle(selection.text));
	const quote = selection.text.trim().split(/\r\n?|\n/).map(line => line.length > 0 ? `> ${line}` : '>').join('\n');
	const pageLabel = selection.pages.length === 1 ? `page ${selection.pages[0]}` : `pages ${selection.pages.join(', ')}`;
	const linkLabel = displayName.replace(/([\\\[\]])/g, '\\$1');
	const encodedSourceName = encodeURIComponent(sourceName).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
	const linkTarget = `./${encodedSourceName}`;
	return `# ${title}\n\n${quote}\n\nSource: [${linkLabel}](${linkTarget}), ${pageLabel}\n`;
}
