/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { BlockNoteEditor } from '@blocknote/core';
import { CellSelection } from 'prosemirror-tables';
import { writeBaseHalfNoteInline, type BaseHalfNoteInlineContent } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteInline.js';
import { baseHalfNotePaletteAlias, baseHalfNoteSpanStyle } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNotePalette.js';
import { writeBaseHalfNoteBlocks } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteWriter.js';

// Copy out of Rich (note formats, rules 75 to 77): Command-C, Command-X,
// Copy and Cut in Rich's menu, and a drag of blocks out of Rich put on the
// clipboard, as text, the Markdown the note stores for what they carry, and
// for another application its HTML with the palette's values.

type NoteEditor = BlockNoteEditor<any, any, any>;

/**
 * The Markdown the note would store for the selection: of the blocks it
 * covers, cut at its ends, with toggles closed (rule 77) and fixed blocks as
 * their text; of a selection within one block, its text with its inline
 * formats. None for a selection in code, whose copy is its code, and in a
 * table's cells.
 */
function selectionMarkdown(editor: NoteEditor): string | undefined {
	const view = editor.prosemirrorView;
	const { selection } = view.state;
	if (selection.empty || selection instanceof CellSelection) {
		return undefined;
	}
	const { $from, $to } = selection;
	if ($from.sameParent($to) && $from.parent.type.spec.code) {
		return undefined;
	}
	const { blocks } = editor.getSelectionCutBlocks();
	if ($from.sameParent($to) && $from.parent.inlineContent && blocks.length === 1) {
		const content = (blocks[0] as { readonly content?: unknown }).content;
		return Array.isArray(content) ? writeBaseHalfNoteInline(content as BaseHalfNoteInlineContent) : undefined;
	}
	return writeBaseHalfNoteBlocks(blocks, { isOpen: () => false });
}

/** The HTML of a copy with the palette's values in the note's spelling instead of the editor's own palette. */
function withPaletteColors(html: string): string {
	const template = document.createElement('template');
	template.innerHTML = html;
	for (const span of template.content.querySelectorAll<HTMLElement>('span[style]')) {
		const text = span.style.color ? baseHalfNotePaletteAlias('text', span.style.color) : undefined;
		const background = span.style.backgroundColor ? baseHalfNotePaletteAlias('background', span.style.backgroundColor) : undefined;
		if (text || background) {
			span.setAttribute('style', baseHalfNoteSpanStyle(text, background));
		}
	}
	return template.innerHTML;
}

/**
 * Makes a copy, a cut, and a drag of blocks out of Rich carry the note's
 * Markdown as their text. The text is read before the editor copies, and
 * before a cut deletes what it copied; it takes the place of the editor's
 * own text after the editor copied. A copy the editor leaves to the page,
 * as within a fixed block, is left as it is. Returns what removes it.
 */
export function installBaseHalfNoteCopy(editor: NoteEditor, container: HTMLElement): () => void {
	let text: string | undefined;
	const read = (): void => {
		try {
			text = selectionMarkdown(editor);
		} catch (error) {
			text = undefined;
			console.error('[basehalf] Rich could not write the selection as the note stores it; the editor\'s copy stands.', error);
		}
	};
	const write = (data: DataTransfer | null): void => {
		if (data && text !== undefined) {
			data.setData('text/plain', text);
			const html = data.getData('text/html');
			if (html) {
				data.setData('text/html', withPaletteColors(html));
			}
		}
		text = undefined;
	};
	const onBeforeCopy = (): void => read();
	const onCopied = (event: ClipboardEvent): void => {
		if (event.defaultPrevented) {
			write(event.clipboardData);
		} else {
			text = undefined;
		}
	};
	// A drag of blocks, from the side menu or of a selected block, after the editor filled it.
	const onDragged = (event: DragEvent): void => {
		const dragging = editor.prosemirrorView?.dragging;
		if (!dragging || !event.dataTransfer?.types.includes('blocknote/html')) {
			return;
		}
		try {
			const blocks = editor.tryParseHTMLToBlocks(event.dataTransfer.getData('blocknote/html'));
			text = writeBaseHalfNoteBlocks(blocks, { isOpen: () => false });
		} catch (error) {
			text = undefined;
			console.error('[basehalf] Rich could not write the dragged blocks as the note stores them.', error);
		}
		write(event.dataTransfer);
	};
	container.addEventListener('copy', onBeforeCopy, true);
	container.addEventListener('cut', onBeforeCopy, true);
	container.addEventListener('copy', onCopied);
	container.addEventListener('cut', onCopied);
	const page = container.ownerDocument.defaultView;
	page?.addEventListener('dragstart', onDragged);
	return () => {
		container.removeEventListener('copy', onBeforeCopy, true);
		container.removeEventListener('cut', onBeforeCopy, true);
		container.removeEventListener('copy', onCopied);
		container.removeEventListener('cut', onCopied);
		page?.removeEventListener('dragstart', onDragged);
	};
}
