/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { IBaseHalfMarkdownEditorApi } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownProjection.js';
import { repairBaseHalfNoteHtml, tidyBaseHalfNoteHtml } from '../../../src/vs/workbench/basehalf/markdown/browser/basehalfNoteHtmlRepair.js';
import { baseHalfNoteBlockChildren, baseHalfNoteBlockId, isBaseHalfNoteRecord } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteBlocks.js';
import { baseHalfCardLexer } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteInline.js';
import { baseHalfNoteMarkdownToHtml } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteMarkdownHtml.js';
import { escapeBaseHalfMarkdownText } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteMarkdownText.js';
import { baseHalfNoteListHints, postProcessBaseHalfNoteBlocks } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteStructure.js';
import { IBaseHalfNoteWriteHints, writeBaseHalfNoteBlock } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteWriter.js';

// How Rich reads a note and writes it (note formats, design B1, A5, and A6):
// the card's Markdown reader and the note's rules for HTML, the editor's own
// reading of that HTML, and BaseHalf's writer.

/** What the reader and the writer need of the editor. */
export interface IBaseHalfNoteConversionEditor {
	tryParseHTMLToBlocks(html: string): unknown[];
	blocksToMarkdownLossy(blocks: never[]): string;
}

export interface IBaseHalfNoteWriteWarning {
	readonly blockId: string | undefined;
	readonly message: string;
	readonly stack: string | undefined;
}

export interface IBaseHalfNoteConversionOptions {
	/** Told when a save cannot write a block in its formats and writes its words alone (design A5). */
	readonly onWriteWarning?: (warning: IBaseHalfNoteWriteWarning) => void;
}

/**
 * Rich's reader and writer for the projection. The reader reads a part of a
 * note with the card's reader into HTML, tidies and repairs that HTML in an
 * inert template, lets the editor read it, and gives the blocks what the file
 * wrote of its toggles, list items, and code. The writer keeps what it wrote
 * of each block for the hints it wrote it with, while the editor hands back
 * the same block (design A6).
 */
export function createBaseHalfNoteEditorApi(editor: IBaseHalfNoteConversionEditor, options: IBaseHalfNoteConversionOptions = {}): IBaseHalfMarkdownEditorApi {
	const written = new WeakMap<object, Map<string, string>>();
	const decoder = document.createElement('textarea');
	return {
		tryParseMarkdownToBlocks(markdown, context) {
			const template = document.createElement('template');
			template.innerHTML = baseHalfNoteMarkdownToHtml(markdown, { definitions: context.definitions, forReading: true });
			tidyBaseHalfNoteHtml(template.content);
			const { openFlags } = repairBaseHalfNoteHtml(template.content, 'markdown');
			const blocks = editor.tryParseHTMLToBlocks(template.innerHTML);
			const listHints = baseHalfNoteListHints(baseHalfCardLexer(context.definitions).lex(markdown));
			return postProcessBaseHalfNoteBlocks(blocks, { mode: 'markdown', openFlags, listHints, source: markdown });
		},
		writeBlock(block, hints, strict) {
			const key = writeHintsKey(hints);
			const known = isBaseHalfNoteRecord(block) ? written.get(block)?.get(key) : undefined;
			if (known !== undefined) {
				return known;
			}
			let text: string;
			try {
				text = writeBaseHalfNoteBlock(block, hints);
			} catch (error) {
				if (strict) {
					throw error;
				}
				return writeWordsOf(editor, block, hints, error, options);
			}
			if (isBaseHalfNoteRecord(block)) {
				let byHints = written.get(block);
				if (!byHints) {
					byHints = new Map();
					written.set(block, byHints);
				}
				byHints.set(key, text);
			}
			return text;
		},
		decodeCharacterReferences(text) {
			// A textarea reads its text as text: no element is made, nothing loads.
			decoder.innerHTML = text.replace(/</g, '&lt;');
			return decoder.value;
		}
	};
}

const labelSetIds = new WeakMap<ReadonlySet<string>, number>();
let nextLabelSetId = 1;

/**
 * What a block's writing depends on beyond the block: the line ending, the
 * note's labels, and the list items around it. What the file wrote of the
 * block's toggles and list items is kept by id, and an id keeps it.
 */
function writeHintsKey(hints: IBaseHalfNoteWriteHints): string {
	let labels = 0;
	if (hints.referenceLabels) {
		labels = labelSetIds.get(hints.referenceLabels) ?? 0;
		if (labels === 0) {
			labels = nextLabelSetId++;
			labelSetIds.set(hints.referenceLabels, labels);
		}
	}
	const previous = hints.previousListItem;
	return `${hints.eol ?? '\n'}|${labels}|${previous ? `${previous.marker}:${previous.numbers.join(',')}` : ''}|${hints.nextListItem?.marker ?? ''}`;
}

/**
 * A block the writer cannot write in its formats, as words: the editor's own
 * writer, which keeps the words and drops formats, else the block's text with
 * every Markdown character escaped. The caller is told either way.
 */
function writeWordsOf(editor: IBaseHalfNoteConversionEditor, block: unknown, hints: IBaseHalfNoteWriteHints, error: unknown, options: IBaseHalfNoteConversionOptions): string {
	options.onWriteWarning?.({
		blockId: baseHalfNoteBlockId(block),
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined
	});
	try {
		return editor.blocksToMarkdownLossy([block as never]).trimEnd();
	} catch {
		const eol = hints.eol ?? '\n';
		return textsOf(block).map(text => escapeBaseHalfMarkdownText(text)).filter(text => text !== '').join(eol + eol);
	}
}

/** The text of a block and of the blocks it holds, one paragraph each. */
function textsOf(block: unknown): string[] {
	const own: string[] = [];
	const collect = (value: unknown): void => {
		if (typeof value === 'string') {
			own.push(value);
		} else if (Array.isArray(value)) {
			value.forEach(collect);
		} else if (isBaseHalfNoteRecord(value)) {
			if (typeof value.text === 'string') {
				own.push(value.text);
			}
			collect(value.content);
			collect(value.rows);
			collect(value.cells);
		}
	};
	collect(isBaseHalfNoteRecord(block) ? block.content : undefined);
	return [own.join(''), ...baseHalfNoteBlockChildren(block).flatMap(textsOf)];
}
