/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { blockToNode, type BlockNoteEditor } from '@blocknote/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { buildBaseHalfMarkdownLoadProjection, type IBaseHalfMarkdownEditorApi } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownProjection.js';
import { repairBaseHalfNoteHtml, tidyBaseHalfNoteHtml } from '../../../src/vs/workbench/basehalf/markdown/browser/basehalfNoteHtmlRepair.js';
import { baseHalfNoteBlockChildren, isBaseHalfNoteRecord } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteBlocks.js';
import { BASEHALF_NOTE_COPY_SOURCE, baseHalfNoteLinkDestinationRanges } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteFileLinks.js';
import { postProcessBaseHalfNoteBlocks, stripBaseHalfNoteReadHints, type BaseHalfNoteReadMode } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteStructure.js';
import { addBaseHalfNoteFiles, addBaseHalfNoteItems, baseHalfNoteTransferFiles, showBaseHalfNoteFailures, type BaseHalfNoteItemsRequest } from './noteMedia.js';

// Rich's paste (note formats, rules 72 to 74): HTML from another application
// and Markdown are read as a note's file is read, so what comes in is what
// the note can store. Command-V, Paste in Rich's menu, and a drop read a
// paste the same way.

/** What a paste needs of the editor. */
export interface IBaseHalfNotePasteEditor {
	tryParseHTMLToBlocks(html: string): unknown[];
	blocksToFullHTML(blocks: never[]): string;
	pasteHTML(html: string, raw?: boolean): void;
	pasteMarkdown(markdown: string): void | Promise<void>;
	pasteText(text: string): unknown;
}

/** What the editor gives the paste handler of its options. */
export interface IBaseHalfNotePasteEvent {
	readonly event: ClipboardEvent;
	readonly editor: BlockNoteEditor<any, any, any>;
	readonly defaultPasteHandler: (options?: { readonly prioritizeMarkdownOverHTML?: boolean; readonly plainTextAsMarkdown?: boolean }) => boolean | undefined;
}

const installed = new WeakSet<object>();

/** BlockNote's own HTML, of a copy within Rich or of what this paste made of a paste. */
const editorHtml = /\bdata-(?:node-type|content-type|pm-slice)=/;

/** HTML read as a note reads it, for a paste or a drop: tidied and repaired, the editor's reading, and the block pass. */
function readPastedHtml(editor: IBaseHalfNotePasteEditor, html: string, mode: BaseHalfNoteReadMode): unknown[] {
	const template = document.createElement('template');
	template.innerHTML = html;
	tidyBaseHalfNoteHtml(template.content);
	const { openFlags } = repairBaseHalfNoteHtml(template.content, mode);
	return postProcessBaseHalfNoteBlocks(editor.tryParseHTMLToBlocks(template.innerHTML), { mode, openFlags });
}

/** Blocks without their ids, so that what is pasted is new blocks, and a toggle among them is stored closed (rule 40). */
function withoutIds(blocks: readonly unknown[]): unknown[] {
	return blocks.map(block => {
		if (!isBaseHalfNoteRecord(block)) {
			return block;
		}
		const { id: _id, ...rest } = block;
		const children = baseHalfNoteBlockChildren(block);
		return children.length > 0 ? { ...rest, children: withoutIds(children) } : rest;
	});
}

/**
 * Makes the editor's paste of HTML from another application and of Markdown
 * read what it pastes as a note's file is read. Markdown that Rich cannot
 * edit comes in as a fixed block of the pasted text. Rich's own HTML comes
 * in as it is, and the normalizer gives it the note's shape. What the reader
 * cannot read, the editor pastes as before.
 */
export function installBaseHalfNotePaste(editor: IBaseHalfNotePasteEditor, api: IBaseHalfMarkdownEditorApi): void {
	if (installed.has(editor)) {
		return;
	}
	installed.add(editor);
	const pasteHTML = editor.pasteHTML.bind(editor);
	const pasteMarkdown = editor.pasteMarkdown.bind(editor);
	const pasteBlocks = (blocks: readonly unknown[]) => pasteHTML(editor.blocksToFullHTML(withoutIds(stripBaseHalfNoteReadHints(blocks)) as never[]), true);
	editor.pasteHTML = (html, raw = false) => {
		if (raw || editorHtml.test(html)) {
			pasteHTML(html, true);
			return;
		}
		let blocks: unknown[];
		try {
			blocks = readPastedHtml(editor, html, 'paste');
		} catch (error) {
			console.error('[basehalf] Rich could not read the pasted HTML as a note; the editor pastes it.', error);
			pasteHTML(html, false);
			return;
		}
		pasteBlocks(blocks);
	};
	editor.pasteMarkdown = async markdown => {
		let blocks: unknown[];
		try {
			// The projection of a note's file: what Rich cannot edit is a fixed block.
			const projected = (await buildBaseHalfMarkdownLoadProjection(api, markdown)).blocks;
			// A file of fixed blocks alone gets a paragraph to type in; a paste needs none.
			blocks = projected.filter(block => !(isBaseHalfNoteRecord(block) && Object.keys(block).length === 1 && block.type === 'paragraph'));
		} catch (error) {
			console.error('[basehalf] Rich could not read the pasted Markdown as a note; the editor pastes it.', error);
			await pasteMarkdown(markdown);
			return;
		}
		pasteBlocks(blocks);
	};
}

function vscodeEditorMode(data: DataTransfer): string | undefined {
	try {
		const mode = (JSON.parse(data.getData('vscode-editor-data')) as { readonly mode?: unknown } | null)?.mode;
		return typeof mode === 'string' ? mode : undefined;
	} catch {
		return undefined;
	}
}

/** Whether the caret is in a block of code, where a paste is text. */
function inCode(editor: BlockNoteEditor<any, any, any>): boolean {
	return editor.transact(transaction => !!transaction.selection.$from.parent.type.spec.code);
}

/** What an editor or a page copies: a clipboard that holds one of them holds no items. */
const notItems = ['vscode-editor-data', 'blocknote/html', 'text/markdown', 'text/html'];

/** A copy of what a paste holds, which can still be read once the paste is over. */
function copyOfTransfer(data: DataTransfer): DataTransfer {
	const copy = new DataTransfer();
	for (const type of data.types) {
		if (type !== 'Files') {
			copy.setData(type, data.getData(type));
		}
	}
	for (const file of Array.from(data.files)) {
		copy.items.add(file);
	}
	return copy;
}

/** Whether an address is a path read from the note's folder: no scheme, no heading of its own, not from the disk's root. */
function isRelative(address: string): boolean {
	return address !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(address) && !address.startsWith('#') && !address.startsWith('/');
}

/**
 * Blocks copied in another note, rebased to this one (files in notes, rule
 * 35): each relative address in the editor's own HTML of the copy is read
 * from the note it came from, and the host gives it from this note, with a
 * stored file of the other note's folder cloned into this note's folder.
 * What the host cannot clone stays the other note's, and says why.
 */
async function rebaseCopy(editor: BlockNoteEditor<any, any, any>, data: DataTransfer, source: string, requestItems: BaseHalfNoteItemsRequest): Promise<void> {
	const template = document.createElement('template');
	template.innerHTML = data.getData('blocknote/html');
	const places: { readonly element: Element; readonly attribute: string; readonly address: string }[] = [];
	for (const element of template.content.querySelectorAll('[data-url], [src], [href]')) {
		for (const attribute of ['data-url', 'src', 'href']) {
			const value = element.getAttribute(attribute);
			if (value && isRelative(value)) {
				places.push({ element, attribute, address: new URL(value, source).href });
			}
		}
	}
	const uris = [...new Set(places.map(place => place.address))];
	const rebased = uris.length > 0 ? await requestItems('rebase', { uris }) : undefined;
	if (!rebased) {
		return;
	}
	const urls = new Map(uris.map((uri, index) => [uri, rebased.items[index]?.url]));
	for (const place of places) {
		const url = urls.get(place.address);
		if (url) {
			place.element.setAttribute(place.attribute, url);
		}
	}
	data.setData('blocknote/html', template.innerHTML);
	showBaseHalfNoteFailures(editor, rebased.failures);
}

/**
 * Markdown copied out of another note's Source, rebased to this one as its
 * blocks would be (files in notes, rule 35): each relative destination of a
 * link or a picture is read from the note it came from, and the host gives
 * it from this note, with a stored file of the other note's folder cloned
 * into this note's folder. What the host cannot clone stays the other
 * note's, and says why.
 */
async function rebaseMarkdownCopy(editor: BlockNoteEditor<any, any, any>, data: DataTransfer, source: string, requestItems: BaseHalfNoteItemsRequest): Promise<void> {
	const markdown = data.getData('text/plain');
	const places = baseHalfNoteLinkDestinationRanges(markdown).flatMap(({ at, destination }) => {
		const path = destination.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination;
		if (!isRelative(path)) {
			return [];
		}
		try {
			return [{ at, length: destination.length, address: new URL(path, source).href }];
		} catch {
			return [];
		}
	});
	const uris = [...new Set(places.map(place => place.address))];
	const rebased = uris.length > 0 ? await requestItems('rebase', { uris }) : undefined;
	if (!rebased) {
		return;
	}
	const urls = new Map(uris.map((uri, index) => [uri, rebased.items[index]?.url]));
	let text = markdown;
	for (const place of [...places].sort((a, b) => b.at - a.at)) {
		const url = urls.get(place.address);
		if (url) {
			text = text.slice(0, place.at) + url + text.slice(place.at + place.length);
		}
	}
	data.setData('text/plain', text);
	showBaseHalfNoteFailures(editor, rebased.failures);
}

/**
 * The editor's paste handler with the clipboard's items (files in notes,
 * rules 12, 14, and 15): files that BaseHalf or a file manager copied and
 * cards copied on the canvas or in Files come with their paths, which only
 * the host can read, so the host is asked for them first, and puts them in
 * as their blocks. When the clipboard holds no items, the paste goes on as
 * `baseHalfNotePasteHandler` reads it, from a copy of what it held. A paste
 * of what an editor or a page copied, and a paste into code, are read at once.
 */
export function makeBaseHalfNotePasteHandler(requestItems: BaseHalfNoteItemsRequest, note: () => string | undefined = () => undefined): (paste: IBaseHalfNotePasteEvent) => boolean {
	const replays = new WeakSet<Event>();
	return paste => {
		const { event, editor } = paste;
		const data = event.clipboardData;
		const view = editor.prosemirrorView;
		if (replays.has(event) || !data || !view || data.types.length === 0 || inCode(editor)) {
			return baseHalfNotePasteHandler(paste);
		}
		const replay = (copy: DataTransfer): void => {
			if (view.isDestroyed) {
				return;
			}
			const again = new ClipboardEvent('paste', { clipboardData: copy, bubbles: true, cancelable: true });
			replays.add(again);
			view.dom.dispatchEvent(again);
		};
		// Blocks copied in another note keep working here (files in notes, rule 35); into the same note nothing changes.
		const source = data.types.includes(BASEHALF_NOTE_COPY_SOURCE) ? data.getData(BASEHALF_NOTE_COPY_SOURCE) : '';
		if (source && source !== note() && data.types.includes('blocknote/html')) {
			const copy = copyOfTransfer(data);
			void rebaseCopy(editor, copy, source, requestItems).catch(error => console.warn('[basehalf] The pasted blocks could not be read from the note they came from.', error)).then(() => replay(copy));
			return true;
		}
		// Markdown out of another note's Source keeps working here as its blocks would.
		if (source && source !== note() && vscodeEditorMode(data) === 'markdown') {
			const copy = copyOfTransfer(data);
			void rebaseMarkdownCopy(editor, copy, source, requestItems).catch(error => console.warn('[basehalf] The pasted Markdown could not be read from the note it came from.', error)).then(() => replay(copy));
			return true;
		}
		if (data.types.some(type => notItems.includes(type))) {
			return baseHalfNotePasteHandler(paste);
		}
		const copy = copyOfTransfer(data);
		void addBaseHalfNoteItems(editor, () => requestItems('paste')).then(added => added ? undefined : replay(copy));
		return true;
	};
}

/**
 * The editor's paste handler (rules 72 to 74): text that reads as Markdown is
 * Markdown, other text is text as typed, and Markdown copied from Source or
 * another code editor of Markdown is Markdown; code of another language
 * stays a code block. Files, and a picture copied from a page, are kept in
 * the note's own folder (files in notes, rules 12 and 13). The rest is the
 * editor's own choice of what to paste.
 */
export function baseHalfNotePasteHandler({ event, editor, defaultPasteHandler }: IBaseHalfNotePasteEvent): boolean {
	const data = event.clipboardData;
	const files = data ? baseHalfNoteTransferFiles(data) : [];
	if (files.length > 0) {
		void addBaseHalfNoteFiles(editor, files);
		return true;
	}
	const mode = data && !inCode(editor) && data.types.includes('vscode-editor-data') ? vscodeEditorMode(data) : undefined;
	const text = mode ? data?.getData('text/plain') : undefined;
	if (mode && text) {
		if (mode === 'markdown') {
			void editor.pasteMarkdown(text);
		} else {
			// One whole block of code: a line it is pasted into is cut in two around it.
			const view = editor.prosemirrorView;
			const block = blockToNode({ type: 'codeBlock', props: { language: mode }, content: text.replace(/\r\n?/g, '\n') }, view.state.schema);
			view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(block), 0, 0)).setMeta('uiEvent', 'paste').scrollIntoView());
		}
		return true;
	}
	return defaultPasteHandler({ prioritizeMarkdownOverHTML: true, plainTextAsMarkdown: false }) ?? true;
}

/**
 * HTML dropped from another application, repaired as a paste is: the editor
 * reads it with its own rules after this, and the normalizer gives it the
 * note's shape. Rich's own HTML, of a drag within Rich or of a paste, is
 * left as it is.
 */
export function repairBaseHalfNoteDroppedHtml(html: string): string {
	if (editorHtml.test(html)) {
		return html;
	}
	try {
		const template = document.createElement('template');
		template.innerHTML = html;
		tidyBaseHalfNoteHtml(template.content);
		repairBaseHalfNoteHtml(template.content, 'drop');
		return template.innerHTML;
	} catch (error) {
		console.error('[basehalf] Rich could not repair the dropped HTML; the editor reads it as it is.', error);
		return html;
	}
}
