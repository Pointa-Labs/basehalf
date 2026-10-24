/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { planBaseHalfMarkdownUpstreamEdit } from '../../references/common/basehalfReferenceStore.js';
import { BASEHALF_MEDIA_FILE_EXTENSIONS } from '../../../../platform/protocol/common/basehalfMediaFiles.js';

/**
 * A passage selected in a PDF or a book, which Grow branch makes a note of
 * (PDFs and books, "Grow branch from a book"): a PDF's passage is on pages, a
 * book's begins in a chapter of its contents.
 */
export interface IBaseHalfDocumentSelection {
	readonly text: string;
	/** One-based page numbers touched by the selection, in a PDF. */
	readonly pages?: readonly number[];
	/** The entry of a book's contents that the selection begins in. */
	readonly chapter?: string;
}

const DOCUMENT_EXTENSIONS = [...BASEHALF_MEDIA_FILE_EXTENSIONS.pdf, ...BASEHALF_MEDIA_FILE_EXTENSIONS.book];

function withoutDocumentExtension(value: string): string {
	const lower = value.toLowerCase();
	const extension = DOCUMENT_EXTENSIONS.find(candidate => lower.endsWith(candidate));
	return extension ? value.slice(0, -extension.length) : value;
}

/** A predictable, human-editable filename for a note grown from a PDF or a book. */
export function baseHalfDocumentBranchBaseName(sourceName: string): string {
	const normalized = withoutDocumentExtension(sourceName)
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
		.replace(/\s+/g, ' ')
		.replace(/[. ]+$/g, '')
		.trim();
	const safe = [...normalized].slice(0, 72).join('');
	return `${safe || 'document'}-note`;
}

/** A branch should be recognizable on the canvas without repeating the document's filename. */
export function baseHalfDocumentBranchTitle(text: string): string {
	const normalized = text.replace(/\s+/gu, ' ').trim();
	if (!normalized) {
		return 'Note';
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

/** Where in its document the passage is, after the `Source:` link: its pages, or its chapter. */
function placeOf(selection: IBaseHalfDocumentSelection): string | undefined {
	if (selection.pages?.length) {
		return selection.pages.length === 1 ? `page ${selection.pages[0]}` : `pages ${selection.pages.join(', ')}`;
	}
	const chapter = selection.chapter?.replace(/[\r\n]+/g, ' ').trim();
	return chapter ? escapeMarkdownInline(chapter) : undefined;
}

/**
 * The selected passage is authored as a normal Markdown note, not hidden app
 * state. When `upstream` names the document's workspace-relative path, the
 * note's first bytes carry that connection as an `upstream` frontmatter list
 * (D37), so creating the note is the connection: there is no second write.
 * The body's `Source:` link stays for navigation only.
 */
export function baseHalfDocumentBranchMarkdown(sourceName: string, selection: IBaseHalfDocumentSelection, upstream?: { readonly sourcePath: string; readonly notePath?: string }): string {
	const displayName = sourceName.replace(/[\r\n]+/g, ' ');
	const title = escapeMarkdownInline(baseHalfDocumentBranchTitle(selection.text));
	const quote = selection.text.trim().split(/\r\n?|\n/).map(line => line.length > 0 ? `> ${line}` : '>').join('\n');
	const place = placeOf(selection);
	const linkLabel = displayName.replace(/([\\\[\]])/g, '\\$1');
	const encodedSourceName = encodeURIComponent(sourceName).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
	const linkTarget = `./${encodedSourceName}`;
	const body = `# ${title}\n\n${quote}\n\nSource: [${linkLabel}](${linkTarget})${place ? `, ${place}` : ''}\n`;
	if (!upstream) {
		return body;
	}
	const plan = planBaseHalfMarkdownUpstreamEdit(body, { kind: 'add', entry: upstream.sourcePath }, { nodePath: upstream.notePath });
	if (plan.kind !== 'edit') {
		throw new Error(`The note grown from '${upstream.sourcePath}' could not list it as upstream.`);
	}
	return plan.text;
}
