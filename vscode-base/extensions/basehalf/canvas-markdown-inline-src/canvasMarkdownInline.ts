/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './canvasMarkdownInline.css';

import { baseKeymap, joinBackward, joinForward, setBlockType, toggleMark } from '@tiptap/pm/commands';
import { keymap } from '@tiptap/pm/keymap';
import {
	defaultMarkdownParser,
	defaultMarkdownSerializer,
	MarkdownParser,
	MarkdownSerializer,
	schema as commonmarkSchema,
} from '@tiptap/pm/markdown';
import { DOMParser as ProseMirrorDOMParser, Fragment, Schema, type MarkType, type Node as ProseMirrorNode, type NodeType, type ResolvedPos } from '@tiptap/pm/model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from '@tiptap/pm/schema-list';
import { EditorState, Selection, TextSelection, type Command, type Transaction } from '@tiptap/pm/state';
import { canJoin, canSplit } from '@tiptap/pm/transform';
import { EditorView } from '@tiptap/pm/view';
import type { BaseHalfMarkdownFormatBlockType, BaseHalfMarkdownFormatCommand, BaseHalfMarkdownFormatToggleState } from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownFormatting.js';

export interface CanvasMarkdownInlineSelection {
	readonly anchor: number;
	readonly head: number;
}

export interface CanvasMarkdownInlineFormatState {
	readonly ready: boolean;
	readonly editable: boolean;
	readonly blockType: BaseHalfMarkdownFormatBlockType;
	readonly bold: BaseHalfMarkdownFormatToggleState;
	readonly italic: BaseHalfMarkdownFormatToggleState;
}

export interface CanvasMarkdownInlineUnit {
	readonly id: string;
	readonly markdown: string;
	readonly prefix: string;
	readonly separator: string;
	readonly editable: boolean;
	/** Sanitized resting projection used only by a non-editable atom. */
	readonly element: HTMLElement;
}

export interface CanvasMarkdownInlineEditorOptions {
	readonly markdown: string;
	readonly units: readonly CanvasMarkdownInlineUnit[];
	/** Unit hit by the edit gesture; it must survive the projection parity gate. */
	readonly requiredEditableUnitId?: string;
	readonly readOnly?: boolean;
	readonly selection?: CanvasMarkdownInlineSelection;
	readonly onMarkdownChange?: (markdown: string) => void;
	readonly onCompositionChange?: (composing: boolean) => void;
	readonly onUndoRequest?: () => void;
	readonly onRedoRequest?: () => void;
	readonly onExitRequest?: () => void;
	readonly onToolbarRequest?: () => void;
	readonly onFormatStateChange?: (state: CanvasMarkdownInlineFormatState) => void;
}

export interface CanvasMarkdownInlineEditorRuntime {
	focusAtPoint(clientX: number, clientY: number): boolean;
	focus(): void;
	setReadOnly(readOnly: boolean): void;
	getSelection(): CanvasMarkdownInlineSelection;
	getMarkdown(): string;
	getFormatState(): CanvasMarkdownInlineFormatState;
	runFormatCommand(command: BaseHalfMarkdownFormatCommand): boolean;
	isComposing(): boolean;
	destroy(): void;
}

interface MarkdownToken {
	readonly type: string;
	readonly tag?: string;
	readonly content?: string;
	readonly info?: string;
	readonly map?: readonly [number, number] | null;
	readonly children?: readonly MarkdownToken[] | null;
	attrGet?(name: string): string | null;
}

let canvasNodes = commonmarkSchema.spec.nodes
	.remove('image')
	.update('heading', {
		...commonmarkSchema.spec.nodes.get('heading'),
		content: 'inline*',
		parseDOM: [
			{ tag: 'h1', attrs: { level: 1 } },
			{ tag: 'h2', attrs: { level: 2 } },
			{ tag: 'h3', attrs: { level: 3 } },
		],
	});

// Source tiles are document-level metadata, never Markdown content. Giving
// normal blocks a separate content group prevents native cross-block browser
// edits from nesting one tile wrapper inside another and handing that private
// node to the Markdown serializer.
for (const name of ['paragraph', 'blockquote', 'horizontal_rule', 'heading', 'code_block', 'ordered_list', 'bullet_list']) {
	const spec = canvasNodes.get(name);
	if (spec) {
		canvasNodes = canvasNodes.update(name, { ...spec, group: 'block top_block markdown_unit_content' });
	}
}

canvasNodes = canvasNodes
	.update('doc', { ...canvasNodes.get('doc'), content: 'top_block+' })
	.addBefore('paragraph', 'markdown_unit', {
		group: 'top_block',
		content: 'markdown_unit_content+',
		defining: true,
		attrs: { unitId: {} },
		toDOM: node => ['div', {
			class: 'basehalf-canvas-markdown-inline-unit',
			'data-basehalf-markdown-unit': node.attrs.unitId,
		}, 0],
	})
	.addBefore('paragraph', 'unsupported_markdown', {
		group: 'top_block',
		atom: true,
		selectable: true,
		attrs: { unitId: {} },
		toDOM: node => ['div', {
			class: 'basehalf-canvas-markdown-inline-unit unsupported',
			'data-basehalf-markdown-unit': node.attrs.unitId,
			contenteditable: 'false',
		}],
	})
	.addBefore('hard_break', 'soft_break', {
		inline: true,
		group: 'inline',
		selectable: false,
		parseDOM: [{ tag: 'br:not([data-basehalf-hard-break])', priority: 60 }],
		toDOM: () => ['br', { 'data-basehalf-soft-break': 'true' }],
	});

const canvasSchema = new Schema({
	nodes: canvasNodes,
	marks: commonmarkSchema.spec.marks.addToEnd('strike', {
		parseDOM: [{ tag: 'del' }, { tag: 's' }],
		toDOM: () => ['del', 0],
	}),
});

const canvasTokenizer = defaultMarkdownParser.tokenizer;
canvasTokenizer.enable('strikethrough');
canvasTokenizer.set({ linkify: true });
canvasTokenizer.enable('linkify');

const { image: _imageParser, ...baseParserTokens } = defaultMarkdownParser.tokens;
const canvasParser = new MarkdownParser(canvasSchema, canvasTokenizer, {
	...baseParserTokens,
	softbreak: { node: 'soft_break' },
	s: { mark: 'strike' },
});

const { image: _imageSerializer, ...baseSerializerNodes } = defaultMarkdownSerializer.nodes;
const canvasSerializer = new MarkdownSerializer({
	...baseSerializerNodes,
	soft_break(state) {
		state.write('\n');
	},
}, {
	...defaultMarkdownSerializer.marks,
	strike: {
		open: '~~',
		close: '~~',
		mixable: true,
		expelEnclosingWhitespace: true,
	},
});

const supportedBlockTokens = new Set([
	'blockquote_open',
	'blockquote_close',
	'paragraph_open',
	'paragraph_close',
	'list_item_open',
	'list_item_close',
	'bullet_list_open',
	'bullet_list_close',
	'ordered_list_open',
	'ordered_list_close',
	'heading_open',
	'heading_close',
	'code_block',
	'fence',
	'hr',
	'inline',
]);

const supportedInlineTokens = new Set([
	'text',
	'code_inline',
	'softbreak',
	'hardbreak',
	'em_open',
	'em_close',
	'strong_open',
	'strong_close',
	'link_open',
	'link_close',
	's_open',
	's_close',
]);

const htmlTagPattern = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*?)?\/?>/;
const htmlDeclarationPattern = /<!--|<![A-Z]|<\?[^>]*\?>|<!\[CDATA\[/i;

function containsUnsupportedHtml(text: string): boolean {
	return htmlDeclarationPattern.test(text) || htmlTagPattern.test(text);
}

function isTableDelimiterLine(line: string): boolean {
	const withoutQuote = line.replace(/^(?: {0,3}>[ \t]?)+/, '').trim();
	if (!withoutQuote.includes('|')) {
		return false;
	}

	const body = withoutQuote.replace(/^\|/, '').replace(/\|$/, '');
	const cells = body.split('|');
	return cells.length >= 1 && cells.every(cell => /^\s*:?-{1,}:?\s*$/.test(cell));
}

function containsUnsupportedTable(markdown: string, tokens: readonly MarkdownToken[]): boolean {
	const codeLines = new Set<number>();
	for (const token of tokens) {
		if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
			for (let line = token.map[0]; line < token.map[1]; line++) {
				codeLines.add(line);
			}
		}
	}

	const lines = markdown.split(/\r?\n/);
	for (let line = 1; line < lines.length; line++) {
		if (codeLines.has(line) || codeLines.has(line - 1) || !isTableDelimiterLine(lines[line])) {
			continue;
		}
		const header = lines[line - 1].replace(/^(?: {0,3}>[ \t]?)+/, '');
		if (header.includes('|')) {
			return true;
		}
	}
	return false;
}

function containsReferenceDefinition(markdown: string, tokens: readonly MarkdownToken[]): boolean {
	const codeLines = new Set<number>();
	for (const token of tokens) {
		if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
			for (let line = token.map[0]; line < token.map[1]; line++) {
				codeLines.add(line);
			}
		}
	}
	return markdown.split(/\r?\n/).some((line, index) => {
		return !codeLines.has(index) && /^\s{0,3}\[[^\]\n]+\]:/.test(line);
	});
}

function tokensAreSupported(tokens: readonly MarkdownToken[]): boolean {
	let listItemDepth = 0;
	for (const token of tokens) {
		if (!supportedBlockTokens.has(token.type)) {
			return false;
		}
		if (token.type === 'heading_open' && token.tag && !/^h[1-3]$/.test(token.tag)) {
			return false;
		}
		if (token.type === 'list_item_open') {
			listItemDepth++;
		} else if (token.type === 'list_item_close') {
			listItemDepth--;
		}

		if (!token.children) {
			continue;
		}

		let firstText = true;
		for (const child of token.children) {
			if (!supportedInlineTokens.has(child.type)) {
				return false;
			}
			if (child.type === 'link_open') {
				const href = child.attrGet?.('href') ?? '';
				if (/^(?:javascript|data|command|vscode|blob):/i.test(href.trim())) {
					return false;
				}
			}
			if (child.type === 'text') {
				const content = child.content ?? '';
				if (containsUnsupportedHtml(content)
					|| content.includes('![')
					// Reference links need definitions from the full document. A Canvas
					// unit is intentionally parsed in isolation, so accepting them here
					// would turn the first edit into a lossy normalization.
					|| /(^|[^\\])\[[^\]\n]+\](?:\s*\[[^\]\n]*\])?/.test(content)) {
					return false;
				}
				if (firstText && listItemDepth > 0 && /^\[[ xX]\](?:\s|$)/.test(content)) {
					return false;
				}
				firstText = false;
			} else if (child.type !== 'softbreak' && child.type !== 'hardbreak') {
				firstText = false;
			}
		}
	}
	return listItemDepth === 0;
}

function normalizeLineEndings(markdown: string): string {
	return markdown.replace(/\r\n?/g, '\n');
}

/** Returns whether a top-level Canvas Markdown unit can round-trip through the inline editor. */
export function canEditCanvasMarkdownUnit(markdown: string): boolean {
	try {
		const normalized = normalizeLineEndings(markdown);
		const tokens = canvasTokenizer.parse(normalized, {}) as readonly MarkdownToken[];
		if ((normalized.trim().length > 0 && tokens.length === 0)
			|| containsReferenceDefinition(normalized, tokens)
			|| !tokensAreSupported(tokens)
			|| containsUnsupportedTable(normalized, tokens)) {
			return false;
		}
		canvasParser.parse(normalized);
		return true;
	} catch {
		return false;
	}
}

function parseMarkdown(markdown: string): ProseMirrorNode {
	if (!canEditCanvasMarkdownUnit(markdown)) {
		throw new RangeError('This Markdown unit contains syntax that the Canvas inline editor cannot preserve.');
	}
	return canvasParser.parse(normalizeLineEndings(markdown));
}

interface CanvasMarkdownRuntimeUnit {
	readonly input: CanvasMarkdownInlineUnit;
	readonly initialNode: ProseMirrorNode;
	readonly staticElement: HTMLElement;
}

function canvasMarkdownProjectionIsEquivalent(renderedDocument: ProseMirrorNode, sourceDocument: ProseMirrorNode): boolean {
	const sameMarks = (rendered: ProseMirrorNode, source: ProseMirrorNode): boolean => {
		if (rendered.marks.length !== source.marks.length) {
			return false;
		}
		const renderedTypes = rendered.marks.map(mark => mark.type.name).sort();
		const sourceTypes = source.marks.map(mark => mark.type.name).sort();
		return renderedTypes.every((type, index) => type === sourceTypes[index]);
	};
	const sameNode = (rendered: ProseMirrorNode, source: ProseMirrorNode): boolean => {
		const renderedType = rendered.type.name;
		const sourceType = source.type.name;
		const sameBreak = (renderedType === 'soft_break' || renderedType === 'hard_break')
			&& (sourceType === 'soft_break' || sourceType === 'hard_break');
		if (renderedType !== sourceType && !sameBreak) {
			return false;
		}
		if (rendered.isText || source.isText) {
			return rendered.isText
				&& source.isText
				&& rendered.text === source.text
				&& sameMarks(rendered, source);
		}
		if (!sameMarks(rendered, source)) {
			return false;
		}
		// These attributes carry source fidelity but do not change the resting
		// glyph projection. Seed them from source after the visible tree matches.
		if (sourceType === 'heading' && rendered.attrs.level !== source.attrs.level) {
			return false;
		}
		if (sourceType === 'ordered_list' && rendered.attrs.order !== source.attrs.order) {
			return false;
		}
		if (rendered.childCount !== source.childCount) {
			return false;
		}
		for (let index = 0; index < rendered.childCount; index++) {
			if (!sameNode(rendered.child(index), source.child(index))) {
				return false;
			}
		}
		return true;
	};
	return sameNode(renderedDocument, sourceDocument);
}

function createDocumentUnits(units: readonly CanvasMarkdownInlineUnit[]): {
	readonly document: ProseMirrorNode;
	readonly records: ReadonlyMap<string, CanvasMarkdownRuntimeUnit>;
	readonly editableUnitIds: ReadonlySet<string>;
} {
	const records = new Map<string, CanvasMarkdownRuntimeUnit>();
	const nodes: ProseMirrorNode[] = [];
	const editableUnitIds = new Set<string>();
	for (const unit of units) {
		if (records.has(unit.id)) {
			throw new RangeError(`Duplicate Canvas Markdown unit id: ${unit.id}`);
		}
		const staticElement = unit.element.cloneNode(true) as HTMLElement;
		let node: ProseMirrorNode;
		if (unit.editable) {
			const sourceDocument = parseMarkdown(unit.markdown);
			const renderedDocument = unit.element.childNodes.length > 0
				? ProseMirrorDOMParser.fromSchema(canvasSchema).parse(unit.element)
				: sourceDocument;
			if (!canvasMarkdownProjectionIsEquivalent(renderedDocument, sourceDocument)) {
				// A renderer may decorate an incomplete or unsupported construct for
				// display, or parse the same text into different Markdown semantics.
				// Preserve that exact resting DOM as a read-only atom instead of
				// allowing presentation-only state into the editable source model.
				node = canvasSchema.nodes.unsupported_markdown.create({ unitId: unit.id });
			} else {
				const content = sourceDocument.childCount > 0 ? sourceDocument.content : canvasSchema.nodes.paragraph.create();
				node = canvasSchema.nodes.markdown_unit.create({ unitId: unit.id }, content);
				editableUnitIds.add(unit.id);
			}
		} else {
			node = canvasSchema.nodes.unsupported_markdown.create({ unitId: unit.id });
		}
		records.set(unit.id, { input: unit, initialNode: node, staticElement });
		nodes.push(node);
	}
	return {
		document: canvasSchema.nodes.doc.create(null, nodes),
		records,
		editableUnitIds,
	};
}

function serializeCanvasMarkdownUnit(document: ProseMirrorNode): string {
	let markdown = canvasSerializer.serialize(document);
	// Segment separators belong to the workbench projection. The serializer
	// may close a document with one LF; never leak that byte into the unit.
	let tail: ProseMirrorNode = document;
	while (tail.lastChild) {
		tail = tail.lastChild;
	}
	if (tail.type.name !== 'soft_break' && markdown.endsWith('\n')) {
		markdown = markdown.slice(0, -1);
	}
	return markdown;
}

function serializeCanvasMarkdownDocument(
	document: ProseMirrorNode,
	records: ReadonlyMap<string, CanvasMarkdownRuntimeUnit>,
	documentLineEnding: '\n' | '\r\n',
): string {
	let markdown = '';
	document.forEach(node => {
		const unitId = typeof node.attrs.unitId === 'string' ? node.attrs.unitId : undefined;
		const record = unitId ? records.get(unitId) : undefined;
		if (record) {
			let source = record.input.markdown;
			if (node.type === canvasSchema.nodes.markdown_unit && !node.content.eq(record.initialNode.content)) {
				source = serializeCanvasMarkdownUnit(canvasSchema.nodes.doc.create(null, node.content));
				if (record.input.markdown.includes('\r\n') || documentLineEnding === '\r\n') {
					source = source.replace(/\n/g, '\r\n');
				}
			}
			markdown += `${record.input.prefix}${source}${record.input.separator}`;
			return;
		}
		// Unit wrappers are document-only schema nodes. Preserve user content
		// defensively if a future command introduces a bare top-level block.
		const source = serializeCanvasMarkdownUnit(canvasSchema.nodes.doc.create(null, node));
		markdown += `${markdown.length > 0 ? '\n\n' : ''}${source}`;
	});
	return markdown;
}

function selectionForDocument(document: ProseMirrorNode, requested?: CanvasMarkdownInlineSelection): Selection {
	if (!requested) {
		return TextSelection.atEnd(document);
	}
	const limit = document.content.size;
	const anchor = Math.max(0, Math.min(limit, requested.anchor));
	const head = Math.max(0, Math.min(limit, requested.head));
	return TextSelection.between(document.resolve(anchor), document.resolve(head));
}

function selectionSnapshot(selection: Selection): CanvasMarkdownInlineSelection {
	return { anchor: selection.anchor, head: selection.head };
}

function insertSoftBreak(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
	if (dispatch) {
		dispatch(state.tr.replaceSelectionWith(canvasSchema.nodes.soft_break.create()).scrollIntoView());
	}
	return true;
}

function toggleTextMark(markType: MarkType): Command {
	// Match the rich projection's toggle behavior: a mixed selection becomes
	// uniformly styled on the first action, while a fully styled selection is
	// cleared. ProseMirror's default removes a mark when any selected text has it.
	return toggleMark(markType, null, { removeWhenPresent: false });
}

interface CanvasListContext {
	readonly type: 'bulletList' | 'orderedList';
	readonly nodePosition: number;
	readonly depth: number;
	readonly itemIndex: number;
}

interface CanvasBlockquoteContext {
	readonly nodePosition: number;
	readonly depth: number;
	readonly childIndex: number;
}

function listContextAt(position: ResolvedPos): CanvasListContext | undefined {
	for (let depth = position.depth; depth > 0; depth--) {
		const type = position.node(depth).type;
		if (type === canvasSchema.nodes.bullet_list) {
			return { type: 'bulletList', nodePosition: position.before(depth), depth, itemIndex: position.index(depth) };
		}
		if (type === canvasSchema.nodes.ordered_list) {
			return { type: 'orderedList', nodePosition: position.before(depth), depth, itemIndex: position.index(depth) };
		}
	}
	return undefined;
}

function listTypeAt(position: ResolvedPos): 'bulletList' | 'orderedList' | undefined {
	return listContextAt(position)?.type;
}

function blockquoteContextAt(position: ResolvedPos): CanvasBlockquoteContext | undefined {
	for (let depth = position.depth; depth > 0; depth--) {
		if (position.node(depth).type === canvasSchema.nodes.blockquote) {
			return { nodePosition: position.before(depth), depth, childIndex: position.index(depth) };
		}
	}
	return undefined;
}

function blockTypeAt(position: ResolvedPos): BaseHalfMarkdownFormatBlockType {
	const list = listTypeAt(position);
	if (list) {
		return list;
	}
	if (blockquoteContextAt(position)) {
		return 'other';
	}
	for (let depth = position.depth; depth > 0; depth--) {
		const node = position.node(depth);
		if (node.type === canvasSchema.nodes.heading) {
			return `heading${node.attrs.level}` as BaseHalfMarkdownFormatBlockType;
		}
		if (node.type === canvasSchema.nodes.paragraph) {
			return 'paragraph';
		}
	}
	return 'other';
}

function blockTypeForState(state: EditorState): BaseHalfMarkdownFormatBlockType {
	const types = new Set<BaseHalfMarkdownFormatBlockType>();
	const { from, to, $from } = state.selection;
	state.doc.nodesBetween(from, Math.max(from, to), (node, position) => {
		if (!node.isTextblock) {
			return;
		}
		const inside = Math.min(state.doc.content.size, position + 1);
		types.add(blockTypeAt(state.doc.resolve(inside)));
	});
	if (types.size === 0) {
		types.add(blockTypeAt($from));
	}
	return types.size === 1 ? [...types][0] : 'mixed';
}

function markStateForState(state: EditorState, markType: MarkType): BaseHalfMarkdownFormatToggleState {
	const { empty, from, to, $from } = state.selection;
	if (empty) {
		return !!markType.isInSet(state.storedMarks ?? $from.marks());
	}
	let marked = false;
	let unmarked = false;
	state.doc.nodesBetween(from, to, (node, position) => {
		if (!node.isText) {
			return;
		}
		const start = Math.max(from, position);
		const end = Math.min(to, position + node.nodeSize);
		if (end <= start) {
			return;
		}
		if (markType.isInSet(node.marks)) {
			marked = true;
		} else {
			unmarked = true;
		}
	});
	return marked && unmarked ? 'mixed' : marked;
}

function formatStateForEditor(state: EditorState, readOnly: boolean): CanvasMarkdownInlineFormatState {
	return {
		ready: true,
		editable: !readOnly,
		blockType: blockTypeForState(state),
		bold: markStateForState(state, canvasSchema.marks.strong),
		italic: markStateForState(state, canvasSchema.marks.em),
	};
}

function sameFormatState(a: CanvasMarkdownInlineFormatState | undefined, b: CanvasMarkdownInlineFormatState): boolean {
	return !!a
		&& a.ready === b.ready
		&& a.editable === b.editable
		&& a.blockType === b.blockType
		&& a.bold === b.bold
		&& a.italic === b.italic;
}

interface SelectedTextblock {
	readonly node: ProseMirrorNode;
	readonly position: number;
	readonly list: CanvasListContext | undefined;
	readonly blockquote: CanvasBlockquoteContext | undefined;
}

function selectedTextblocks(state: EditorState): readonly SelectedTextblock[] {
	const blocks: SelectedTextblock[] = [];
	const seen = new Set<number>();
	const add = (node: ProseMirrorNode, position: number): void => {
		if (!node.isTextblock || seen.has(position)) {
			return;
		}
		seen.add(position);
		blocks.push({
			node,
			position,
			list: listContextAt(state.doc.resolve(Math.min(state.doc.content.size, position + 1))),
			blockquote: blockquoteContextAt(state.doc.resolve(Math.min(state.doc.content.size, position + 1))),
		});
	};

	const { from, to, $from } = state.selection;
	state.doc.nodesBetween(from, to, (node, position) => add(node, position));
	if (blocks.length === 0) {
		for (let depth = $from.depth; depth > 0; depth--) {
			const node = $from.node(depth);
			if (node.isTextblock) {
				add(node, $from.before(depth));
				break;
			}
		}
	}
	return blocks;
}

function selectionHasList(state: EditorState): boolean {
	return selectedTextblocks(state).some(block => block.node.type !== canvasSchema.nodes.code_block && block.list !== undefined);
}

function selectionSupportsBlockTransform(state: EditorState): boolean {
	return selectedTextblocks(state).some(block => block.node.type !== canvasSchema.nodes.code_block);
}

interface SelectedBlockquoteGroup {
	readonly context: CanvasBlockquoteContext;
	readonly blocks: readonly SelectedTextblock[];
	readonly firstChildIndex: number;
	readonly lastChildIndex: number;
}

function selectedBlockquoteGroups(state: EditorState): readonly SelectedBlockquoteGroup[] {
	const grouped = new Map<number, SelectedTextblock[]>();
	for (const block of selectedTextblocks(state)) {
		if (block.node.type === canvasSchema.nodes.code_block || !block.blockquote) {
			continue;
		}
		const blocks = grouped.get(block.blockquote.nodePosition) ?? [];
		blocks.push(block);
		grouped.set(block.blockquote.nodePosition, blocks);
	}
	return [...grouped.values()].map(blocks => {
		const context = blocks[0].blockquote!;
		const childIndexes = blocks.map(block => block.blockquote!.childIndex);
		return {
			context,
			blocks,
			firstChildIndex: Math.min(...childIndexes),
			lastChildIndex: Math.max(...childIndexes),
		};
	}).sort((a, b) => b.context.depth - a.context.depth || a.context.nodePosition - b.context.nodePosition);
}

function liftSelectedBlockquoteGroup(state: EditorState, group: SelectedBlockquoteGroup): Transaction | undefined {
	const quote = state.doc.nodeAt(group.context.nodePosition);
	if (!quote || quote.type !== canvasSchema.nodes.blockquote) {
		return undefined;
	}
	const firstChildIndex = Math.max(0, Math.min(quote.childCount - 1, group.firstChildIndex));
	const lastChildIndex = Math.max(firstChildIndex, Math.min(quote.childCount - 1, group.lastChildIndex));
	const replacements: ProseMirrorNode[] = [];
	const movedChildren: Array<{ readonly oldStart: number; readonly newStart: number; readonly nodeSize: number }> = [];
	let oldChildStart = group.context.nodePosition + 1;
	for (let index = 0; index < firstChildIndex; index++) {
		oldChildStart += quote.child(index).nodeSize;
	}
	let newChildStart = group.context.nodePosition;
	if (firstChildIndex > 0) {
		const before = quote.copy(Fragment.fromArray(Array.from(
			{ length: firstChildIndex },
			(_, index) => quote.child(index),
		)));
		replacements.push(before);
		newChildStart += before.nodeSize;
	}
	for (let index = firstChildIndex; index <= lastChildIndex; index++) {
		const child = quote.child(index);
		replacements.push(child);
		movedChildren.push({ oldStart: oldChildStart, newStart: newChildStart, nodeSize: child.nodeSize });
		oldChildStart += child.nodeSize;
		newChildStart += child.nodeSize;
	}
	if (lastChildIndex < quote.childCount - 1) {
		replacements.push(quote.copy(Fragment.fromArray(Array.from(
			{ length: quote.childCount - lastChildIndex - 1 },
			(_, index) => quote.child(lastChildIndex + index + 1),
		))));
	}
	const transaction = state.tr.replaceWith(
		group.context.nodePosition,
		group.context.nodePosition + quote.nodeSize,
		Fragment.fromArray(replacements),
	);
	const mapPosition = (position: number, association: -1 | 1): number => {
		for (const moved of movedChildren) {
			if (position >= moved.oldStart && position <= moved.oldStart + moved.nodeSize) {
				return moved.newStart + position - moved.oldStart;
			}
		}
		return transaction.mapping.map(position, association);
	};
	const anchor = Math.max(0, Math.min(transaction.doc.content.size, mapPosition(state.selection.anchor, -1)));
	const head = Math.max(0, Math.min(transaction.doc.content.size, mapPosition(state.selection.head, 1)));
	return transaction.setSelection(TextSelection.between(transaction.doc.resolve(anchor), transaction.doc.resolve(head)));
}

function liftSelectionOutOfBlockquotes(state: EditorState, aggregate: Transaction): boolean {
	const maximumLifts = Math.max(1, state.doc.nodeSize);
	for (let pass = 0; pass < maximumLifts; pass++) {
		const intermediateState = state.apply(aggregate);
		const group = selectedBlockquoteGroups(intermediateState)[0];
		if (!group) {
			return true;
		}
		const produced = liftSelectedBlockquoteGroup(intermediateState, group);
		if (!produced || produced.steps.length === 0) {
			return false;
		}
		for (const step of produced.steps) {
			aggregate.step(step);
		}
		if (produced.selectionSet) {
			aggregate.setSelection(Selection.fromJSON(aggregate.doc, produced.selection.toJSON()));
		}
	}
	return selectedBlockquoteGroups(state.apply(aggregate)).length === 0;
}

interface SelectedListGroup {
	readonly context: CanvasListContext;
	readonly blocks: readonly SelectedTextblock[];
	readonly firstItemIndex: number;
	readonly lastItemIndex: number;
}

function selectedListGroups(state: EditorState): readonly SelectedListGroup[] {
	const grouped = new Map<number, SelectedTextblock[]>();
	for (const block of selectedTextblocks(state)) {
		if (block.node.type === canvasSchema.nodes.code_block || !block.list) {
			continue;
		}
		const blocks = grouped.get(block.list.nodePosition) ?? [];
		blocks.push(block);
		grouped.set(block.list.nodePosition, blocks);
	}
	return [...grouped.values()].map(blocks => {
		const context = blocks[0].list!;
		const itemIndexes = blocks.map(block => block.list!.itemIndex);
		return {
			context,
			blocks,
			firstItemIndex: Math.min(...itemIndexes),
			lastItemIndex: Math.max(...itemIndexes),
		};
	}).sort((a, b) => b.context.depth - a.context.depth || a.context.nodePosition - b.context.nodePosition);
}

function selectionForListGroup(state: EditorState, group: SelectedListGroup): Selection {
	const from = Math.min(...group.blocks.map(block => block.position + 1));
	const to = Math.max(...group.blocks.map(block => block.position + Math.max(1, block.node.nodeSize - 1)));
	return TextSelection.between(state.doc.resolve(from), state.doc.resolve(to));
}

function appendCommandTransactionAtSelection(
	state: EditorState,
	aggregate: Transaction,
	selection: Selection,
	command: Command,
): boolean {
	const intermediateState = state.apply(aggregate);
	const scopedState = intermediateState.apply(intermediateState.tr.setSelection(selection));
	let produced: Transaction | undefined;
	if (!command(scopedState, transaction => produced = transaction) || !produced) {
		return false;
	}
	for (const step of produced.steps) {
		aggregate.step(step);
	}
	return true;
}

function findJoinableListBoundary(document: ProseMirrorNode): number | undefined {
	const visit = (parent: ProseMirrorNode, contentStart: number): number | undefined => {
		let offset = 0;
		for (let index = 0; index < parent.childCount; index++) {
			const child = parent.child(index);
			const childPosition = contentStart + offset;
			if (index > 0) {
				const previous = parent.child(index - 1);
				const bothLists = (child.type === canvasSchema.nodes.bullet_list || child.type === canvasSchema.nodes.ordered_list)
					&& child.type === previous.type;
				const compatibleOrder = child.type !== canvasSchema.nodes.ordered_list
					|| child.attrs.order === previous.attrs.order
					|| child.attrs.order === previous.attrs.order + previous.childCount;
				if (bothLists
					&& child.attrs.tight === previous.attrs.tight
					&& compatibleOrder
					&& canJoin(document, childPosition)) {
					return childPosition;
				}
			}
			if (!child.isLeaf) {
				const nested = visit(child, childPosition + 1);
				if (nested !== undefined) {
					return nested;
				}
			}
			offset += child.nodeSize;
		}
		return undefined;
	};
	return visit(document, 0);
}

function joinAdjacentCompatibleLists(transaction: Transaction): void {
	for (let boundary = findJoinableListBoundary(transaction.doc); boundary !== undefined; boundary = findJoinableListBoundary(transaction.doc)) {
		transaction.join(boundary);
	}
}

function liftSelectionOutOfLists(state: EditorState, aggregate: Transaction): boolean {
	const maximumLifts = Math.max(1, state.doc.nodeSize);
	for (let pass = 0; pass < maximumLifts; pass++) {
		const intermediateState = state.apply(aggregate);
		const group = selectedListGroups(intermediateState)[0];
		if (!group) {
			joinAdjacentCompatibleLists(aggregate);
			return true;
		}
		const stepCount = aggregate.steps.length;
		if (!appendCommandTransactionAtSelection(
			state,
			aggregate,
			selectionForListGroup(intermediateState, group),
			liftListItem(canvasSchema.nodes.list_item),
		) || aggregate.steps.length === stepCount) {
			return false;
		}
	}
	return !selectionHasList(state.apply(aggregate));
}

function ensureSelectionBlockType(
	state: EditorState,
	aggregate: Transaction,
	target: NodeType,
	attrs: Readonly<Record<string, unknown>> | null = null,
): boolean {
	const maximumChanges = Math.max(1, state.doc.nodeSize);
	for (let pass = 0; pass < maximumChanges; pass++) {
		const intermediateState = state.apply(aggregate);
		const transformable = selectedParentBlocks(intermediateState)
			.filter(candidate => candidate.block.node.type !== canvasSchema.nodes.code_block);
		if (transformable.length === 0) {
			return false;
		}
		const remaining = transformable.filter(candidate => !candidate.block.node.hasMarkup(target, attrs));
		const first = remaining[0];
		if (!first) {
			return true;
		}
		const group = [first];
		for (const candidate of remaining.slice(1)) {
			const previous = group[group.length - 1];
			if (candidate.parentPosition !== first.parentPosition
				|| candidate.parentDepth !== first.parentDepth
				|| candidate.childIndex !== previous.childIndex + 1) {
				break;
			}
			group.push(candidate);
		}
		if (!group.every(({ block, childIndex }) => block.node.type === target
			|| intermediateState.doc.resolve(block.position).parent.canReplaceWith(childIndex, childIndex + 1, target))) {
			return false;
		}
		const from = Math.min(...group.map(candidate => candidate.block.position + 1));
		const to = Math.max(...group.map(candidate => candidate.block.position + Math.max(1, candidate.block.node.nodeSize - 1)));
		const stepCount = aggregate.steps.length;
		if (!appendCommandTransactionAtSelection(
			state,
			aggregate,
			TextSelection.between(intermediateState.doc.resolve(from), intermediateState.doc.resolve(to)),
			setBlockType(target, attrs),
		) || aggregate.steps.length === stepCount) {
			return false;
		}
	}
	return selectedTextblocks(state.apply(aggregate))
		.filter(block => block.node.type !== canvasSchema.nodes.code_block)
		.every(block => block.node.hasMarkup(target, attrs));
}

function setTextBlockKind(target: NodeType, attrs: Readonly<Record<string, unknown>> | null = null): Command {
	return (state, dispatch) => {
		if (!selectionSupportsBlockTransform(state)) {
			return false;
		}
		const aggregate = state.tr;
		if (selectedBlockquoteGroups(state).length > 0 && !liftSelectionOutOfBlockquotes(state, aggregate)) {
			return false;
		}
		if (selectionHasList(state) && !liftSelectionOutOfLists(state, aggregate)) {
			return false;
		}
		if (!ensureSelectionBlockType(state, aggregate, target, attrs)) {
			return false;
		}
		if (dispatch && aggregate.docChanged) {
			dispatch(aggregate.scrollIntoView());
		}
		return true;
	};
}

function listAttrs(target: NodeType, tight: boolean): Readonly<Record<string, unknown>> {
	return target === canvasSchema.nodes.ordered_list ? { order: 1, tight } : { tight };
}

function changeSelectedListGroupType(state: EditorState, group: SelectedListGroup, target: NodeType): Transaction | undefined {
	const list = state.doc.nodeAt(group.context.nodePosition);
	if (!list || (list.type !== canvasSchema.nodes.bullet_list && list.type !== canvasSchema.nodes.ordered_list)) {
		return undefined;
	}
	const firstItemIndex = Math.max(0, Math.min(list.childCount - 1, group.firstItemIndex));
	const lastItemIndex = Math.max(firstItemIndex, Math.min(list.childCount - 1, group.lastItemIndex));
	let selectedStart = group.context.nodePosition + 1;
	for (let index = 0; index < firstItemIndex; index++) {
		selectedStart += list.child(index).nodeSize;
	}
	let selectedEnd = selectedStart;
	for (let index = firstItemIndex; index <= lastItemIndex; index++) {
		selectedEnd += list.child(index).nodeSize;
	}

	const transaction = state.tr;
	const marker = group.blocks[0].position + 1;
	if (lastItemIndex < list.childCount - 1) {
		if (!canSplit(transaction.doc, selectedEnd, 1)) {
			return undefined;
		}
		transaction.split(selectedEnd, 1);
	}
	if (firstItemIndex > 0) {
		const mappedStart = transaction.mapping.map(selectedStart, -1);
		if (!canSplit(transaction.doc, mappedStart, 1)) {
			return undefined;
		}
		transaction.split(mappedStart, 1);
	}

	const selectedList = listContextAt(transaction.doc.resolve(transaction.mapping.map(marker)));
	if (!selectedList) {
		return undefined;
	}
	transaction.setNodeMarkup(
		selectedList.nodePosition,
		target,
		listAttrs(target, list.attrs.tight),
	);
	return transaction;
}

function convertSelectedListsInPlace(state: EditorState, aggregate: Transaction, target: NodeType): boolean {
	const targetName = target === canvasSchema.nodes.bullet_list ? 'bulletList' : 'orderedList';
	const maximumConversions = Math.max(1, state.doc.nodeSize);
	for (let pass = 0; pass < maximumConversions; pass++) {
		const intermediateState = state.apply(aggregate);
		const group = selectedListGroups(intermediateState).find(candidate => candidate.context.type !== targetName);
		if (!group) {
			joinAdjacentCompatibleLists(aggregate);
			return true;
		}
		const produced = changeSelectedListGroupType(intermediateState, group, target);
		if (!produced || produced.steps.length === 0) {
			return false;
		}
		for (const step of produced.steps) {
			aggregate.step(step);
		}
	}
	return false;
}

interface SelectedParentBlock {
	readonly block: SelectedTextblock;
	readonly parentPosition: number;
	readonly parentDepth: number;
	readonly childIndex: number;
}

function selectedParentBlocks(state: EditorState): readonly SelectedParentBlock[] {
	return selectedTextblocks(state).map(block => {
		const position = state.doc.resolve(block.position);
		return {
			block,
			parentPosition: position.depth > 0 ? position.before(position.depth) : -1,
			parentDepth: position.depth,
			childIndex: position.index(position.depth),
		};
	});
}

function wrapSelectionInLists(state: EditorState, aggregate: Transaction, target: NodeType): boolean {
	const maximumWraps = Math.max(1, state.doc.nodeSize);
	for (let pass = 0; pass < maximumWraps; pass++) {
		const intermediateState = state.apply(aggregate);
		const remaining = selectedParentBlocks(intermediateState).filter(candidate => candidate.block.node.type !== canvasSchema.nodes.code_block
			&& candidate.block.list === undefined);
		const first = remaining[0];
		if (!first) {
			return true;
		}
		const group = [first];
		for (const candidate of remaining.slice(1)) {
			const previous = group[group.length - 1];
			if (candidate.parentPosition !== first.parentPosition
				|| candidate.parentDepth !== first.parentDepth
				|| candidate.childIndex !== previous.childIndex + 1) {
				break;
			}
			group.push(candidate);
		}
		const from = Math.min(...group.map(candidate => candidate.block.position + 1));
		const to = Math.max(...group.map(candidate => candidate.block.position + Math.max(1, candidate.block.node.nodeSize - 1)));
		const stepCount = aggregate.steps.length;
		if (!appendCommandTransactionAtSelection(
			state,
			aggregate,
			TextSelection.between(intermediateState.doc.resolve(from), intermediateState.doc.resolve(to)),
			wrapInList(target, listAttrs(target, true)),
		) || aggregate.steps.length === stepCount) {
			return false;
		}
	}
	return selectedTextblocks(state.apply(aggregate))
		.filter(block => block.node.type !== canvasSchema.nodes.code_block)
		.every(block => block.list !== undefined);
}

function switchListType(target: NodeType): Command {
	return (state, dispatch) => {
		if (!selectionSupportsBlockTransform(state)) {
			return false;
		}
		const targetName = target === canvasSchema.nodes.bullet_list ? 'bulletList' : 'orderedList';
		const aggregate = state.tr;
		if (selectedBlockquoteGroups(state).length > 0 && !liftSelectionOutOfBlockquotes(state, aggregate)) {
			return false;
		}
		const initialBlocks = selectedTextblocks(state.apply(aggregate))
			.filter(block => block.node.type !== canvasSchema.nodes.code_block);
		if (initialBlocks.length === 0) {
			return false;
		}
		const listBlocks = initialBlocks.filter(block => block.list !== undefined);
		const allInTargetList = listBlocks.length === initialBlocks.length
			&& listBlocks.every(block => block.list?.type === targetName);
		if (allInTargetList) {
			if (!liftSelectionOutOfLists(state, aggregate)) {
				return false;
			}
		} else if (listBlocks.length === initialBlocks.length) {
			if (!convertSelectedListsInPlace(state, aggregate, target)) {
				return false;
			}
		} else {
			if (listBlocks.length > 0 && !liftSelectionOutOfLists(state, aggregate)) {
				return false;
			}
			if (!ensureSelectionBlockType(state, aggregate, canvasSchema.nodes.paragraph)
				|| !wrapSelectionInLists(state, aggregate, target)) {
				return false;
			}
		}
		joinAdjacentCompatibleLists(aggregate);
		if (!aggregate.docChanged) {
			return false;
		}
		if (dispatch) {
			dispatch(aggregate.scrollIntoView());
		}
		return true;
	};
}

function insertDividerAfterListItem(
	state: EditorState,
	context: CanvasListContext,
	dispatch?: (transaction: Transaction) => void,
): boolean {
	const list = state.doc.nodeAt(context.nodePosition);
	if (!list || context.itemIndex < 0 || context.itemIndex >= list.childCount) {
		return false;
	}
	if (!dispatch) {
		return true;
	}

	const item = list.child(context.itemIndex);
	const replaceEmptyItem = state.selection.empty
		&& item.childCount === 1
		&& !!item.firstChild?.isTextblock
		&& item.firstChild.content.size === 0;
	const beforeEnd = replaceEmptyItem ? context.itemIndex : context.itemIndex + 1;
	const afterStart = context.itemIndex + 1;
	const replacements: ProseMirrorNode[] = [];
	if (beforeEnd > 0) {
		replacements.push(list.copy(Fragment.fromArray(Array.from({ length: beforeEnd }, (_, index) => list.child(index)))));
	}
	const divider = canvasSchema.nodes.horizontal_rule.create();
	const dividerOffset = replacements.reduce((total, node) => total + node.nodeSize, 0);
	replacements.push(divider);
	if (afterStart < list.childCount) {
		replacements.push(list.copy(Fragment.fromArray(Array.from(
			{ length: list.childCount - afterStart },
			(_, index) => list.child(afterStart + index),
		))));
	}

	const transaction = state.tr.replaceWith(
		context.nodePosition,
		context.nodePosition + list.nodeSize,
		Fragment.fromArray(replacements),
	);
	let dividerEnd = context.nodePosition + dividerOffset + divider.nodeSize;
	let nextSelection = Selection.findFrom(transaction.doc.resolve(dividerEnd), 1, true);
	if (!nextSelection) {
		const paragraph = canvasSchema.nodes.paragraph.create();
		transaction.insert(dividerEnd, paragraph);
		dividerEnd += paragraph.nodeSize;
		nextSelection = TextSelection.near(transaction.doc.resolve(dividerEnd - 1), -1);
	}
	dispatch(transaction.setSelection(nextSelection).scrollIntoView());
	return true;
}

function insertDivider(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
	const { $head } = state.selection;
	const list = listContextAt($head);
	if (list) {
		return insertDividerAfterListItem(state, list, dispatch);
	}
	let unitDepth = $head.depth;
	while (unitDepth > 0 && $head.node(unitDepth).type !== canvasSchema.nodes.markdown_unit) {
		unitDepth--;
	}
	if (unitDepth === 0) {
		return false;
	}

	const unit = $head.node(unitDepth);
	const childIndex = Math.min(unit.childCount - 1, $head.index(unitDepth));
	if (childIndex < 0) {
		return false;
	}
	let childOffset = 0;
	for (let index = 0; index < childIndex; index++) {
		childOffset += unit.child(index).nodeSize;
	}
	const child = unit.child(childIndex);
	const childStart = $head.start(unitDepth) + childOffset;
	const childEnd = childStart + child.nodeSize;
	if (!dispatch) {
		return true;
	}

	const divider = canvasSchema.nodes.horizontal_rule.create();
	const replaceEmptyBlock = state.selection.empty && child.isTextblock && child.content.size === 0;
	const transaction = replaceEmptyBlock
		? state.tr.replaceWith(childStart, childEnd, divider)
		: state.tr.insert(childEnd, divider);
	let dividerEnd = (replaceEmptyBlock ? childStart : childEnd) + divider.nodeSize;
	let nextSelection = Selection.findFrom(transaction.doc.resolve(dividerEnd), 1, true);
	if (!nextSelection) {
		const paragraph = canvasSchema.nodes.paragraph.create();
		transaction.insert(dividerEnd, paragraph);
		dividerEnd += paragraph.nodeSize;
		nextSelection = TextSelection.near(transaction.doc.resolve(dividerEnd - 1), -1);
	}
	dispatch(transaction.setSelection(nextSelection).scrollIntoView());
	return true;
}

function commandForFormat(command: BaseHalfMarkdownFormatCommand): Command {
	switch (command) {
		case 'setHeading1': return setTextBlockKind(canvasSchema.nodes.heading, { level: 1 });
		case 'setHeading2': return setTextBlockKind(canvasSchema.nodes.heading, { level: 2 });
		case 'setHeading3': return setTextBlockKind(canvasSchema.nodes.heading, { level: 3 });
		case 'setParagraph': return setTextBlockKind(canvasSchema.nodes.paragraph);
		case 'toggleBold': return toggleTextMark(canvasSchema.marks.strong);
		case 'toggleItalic': return toggleTextMark(canvasSchema.marks.em);
		case 'toggleBulletList': return switchListType(canvasSchema.nodes.bullet_list);
		case 'toggleOrderedList': return switchListType(canvasSchema.nodes.ordered_list);
		case 'insertDivider': return insertDivider;
	}
}

function runCanvasFormatCommand(
	command: BaseHalfMarkdownFormatCommand,
	state: EditorState,
	dispatch: (transaction: Transaction) => void,
	view: EditorView,
	onHandled: () => void,
): boolean {
	const handled = commandForFormat(command)(state, dispatch, view);
	if (handled) {
		onHandled();
	}
	return handled;
}

/**
 * A source tile adds one transparent document level around ordinary Markdown
 * blocks. ProseMirror's standard join command correctly removes that level on
 * its first pass and joins the adjacent textblocks on its second pass. Keep
 * both passes in one user command so Backspace/Delete behaves exactly like a
 * normal editor while all selection and join semantics remain upstream-owned.
 */
function joinAcrossMarkdownUnit(direction: -1 | 1): Command {
	const join = direction < 0 ? joinBackward : joinForward;
	return (state, dispatch, view) => {
		const cursor = (state.selection as TextSelection).$cursor;
		if (!cursor) {
			return false;
		}
		let unitDepth = cursor.depth;
		while (unitDepth > 0 && cursor.node(unitDepth).type !== canvasSchema.nodes.markdown_unit) {
			unitDepth--;
		}
		if (unitDepth === 0) {
			return false;
		}
		const unit = cursor.node(unitDepth);
		const relativePosition = cursor.pos - cursor.start(unitDepth);
		const atBoundary = direction < 0
			? relativePosition === Selection.atStart(unit).from
			: relativePosition === Selection.atEnd(unit).from;
		const unitIndex = cursor.index(0);
		const neighborIndex = unitIndex + direction;
		if (!atBoundary
			|| neighborIndex < 0
			|| neighborIndex >= state.doc.childCount
			|| state.doc.child(neighborIndex).type !== canvasSchema.nodes.markdown_unit) {
			return false;
		}
		if (!dispatch) {
			return true;
		}
		if (!view || !join(state, dispatch, view)) {
			return false;
		}
		// `dispatch` updates EditorView synchronously. The second upstream pass
		// therefore sees the two Markdown blocks inside their newly joined tile.
		return join(view.state, dispatch, view);
	};
}

export function createCanvasMarkdownInlineEditor(
	host: HTMLElement,
	options: CanvasMarkdownInlineEditorOptions,
): CanvasMarkdownInlineEditorRuntime {
	let destroyed = false;
	let readOnly = options.readOnly ?? false;
	let compositionActive = false;
	let pendingMarkdownChange = false;
	let lastFormatState: CanvasMarkdownInlineFormatState | undefined;
	const documentLineEnding = options.markdown.includes('\r\n') ? '\r\n' : '\n';
	let lastReportedMarkdown = options.markdown;

	const whenEditable = (command: Command): Command => (state, dispatch, view) => {
		return readOnly ? false : command(state, dispatch, view);
	};
	const guardedBaseKeymap = Object.fromEntries(
		Object.entries(baseKeymap).map(([shortcut, command]) => [shortcut, whenEditable(command)]),
	);
	const listItem = canvasSchema.nodes.list_item;
	const plugins = [
		keymap({
			'Mod-b': whenEditable(toggleTextMark(canvasSchema.marks.strong)),
			'Mod-i': whenEditable(toggleTextMark(canvasSchema.marks.em)),
		}),
		keymap({
			Backspace: whenEditable(joinAcrossMarkdownUnit(-1)),
			Delete: whenEditable(joinAcrossMarkdownUnit(1)),
		}),
		keymap({
			Enter: whenEditable(splitListItem(listItem)),
			Tab: whenEditable(sinkListItem(listItem)),
			'Shift-Tab': whenEditable(liftListItem(listItem)),
			'Shift-Enter': whenEditable(insertSoftBreak),
		}),
		keymap(guardedBaseKeymap),
	];

	if (options.units.map(unit => `${unit.prefix}${unit.markdown}${unit.separator}`).join('') !== options.markdown) {
		throw new RangeError('Canvas Markdown units do not tile the document body.');
	}
	if (!options.units.some(unit => unit.editable)) {
		throw new RangeError('This Markdown document needs the full editor.');
	}
	const { document: initialDocument, records, editableUnitIds } = createDocumentUnits(options.units);
	if (editableUnitIds.size === 0
		|| (options.requiredEditableUnitId !== undefined && !editableUnitIds.has(options.requiredEditableUnitId))) {
		throw new RangeError('This Markdown document needs the full editor.');
	}
	const initialState = EditorState.create({
		doc: initialDocument,
		selection: selectionForDocument(initialDocument, options.selection),
		plugins,
	});

	const emitMarkdownChange = (): void => {
		pendingMarkdownChange = false;
		const markdown = serializeCanvasMarkdownDocument(view.state.doc, records, documentLineEnding);
		if (markdown === lastReportedMarkdown) {
			return;
		}
		lastReportedMarkdown = markdown;
		options.onMarkdownChange?.(markdown);
	};
	const requestHistoryAction = (event: Event, redo: boolean): boolean => {
		event.preventDefault();
		event.stopPropagation();
		if (redo) {
			options.onRedoRequest?.();
		} else {
			options.onUndoRequest?.();
		}
		return true;
	};
	const emitFormatState = (): CanvasMarkdownInlineFormatState => {
		const state = formatStateForEditor(view.state, readOnly);
		if (!sameFormatState(lastFormatState, state)) {
			lastFormatState = state;
			options.onFormatStateChange?.(state);
		}
		return state;
	};

	host.replaceChildren();
	const view = new EditorView(host, {
		state: initialState,
		editable: () => !readOnly,
		nodeViews: {
			unsupported_markdown(node) {
				const unitId = typeof node.attrs.unitId === 'string' ? node.attrs.unitId : '';
				const record = records.get(unitId);
				const dom = record?.staticElement ?? host.ownerDocument.createElement('div');
				dom.classList.add('basehalf-canvas-markdown-inline-unit', 'unsupported');
				dom.dataset.basehalfMarkdownUnit = unitId;
				dom.contentEditable = 'false';
				dom.title = 'Use Expand to edit this Markdown block.';
				return { dom };
			},
		},
		dispatchTransaction(transaction) {
			const nextState = view.state.apply(transaction);
			view.updateState(nextState);
			emitFormatState();
			if (!transaction.docChanged) {
				return;
			}
			if (compositionActive || view.composing) {
				pendingMarkdownChange = true;
				return;
			}
			emitMarkdownChange();
		},
		handleKeyDown(_view, event) {
			const modifier = event.metaKey || event.ctrlKey;
			if (modifier && !event.altKey && event.key.toLowerCase() === 'z') {
				return requestHistoryAction(event, event.shiftKey);
			}
			if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'y') {
				return requestHistoryAction(event, true);
			}
			if (event.key === 'Escape' && !compositionActive && !view.composing) {
				event.preventDefault();
				event.stopPropagation();
				options.onExitRequest?.();
				return true;
			}
			if (event.altKey && !event.metaKey && !event.ctrlKey && event.key === 'F10') {
				event.preventDefault();
				event.stopPropagation();
				options.onToolbarRequest?.();
				return true;
			}
			return false;
		},
		handleDOMEvents: {
			beforeinput(_view, event) {
				const inputType = (event as InputEvent).inputType;
				if (inputType === 'historyUndo') {
					return requestHistoryAction(event, false);
				}
				if (inputType === 'historyRedo') {
					return requestHistoryAction(event, true);
				}
				return false;
			},
		},
	});
	emitFormatState();

	const onCompositionStart = (): void => {
		if (compositionActive) {
			return;
		}
		compositionActive = true;
		options.onCompositionChange?.(true);
	};
	const onCompositionEnd = (): void => {
		queueMicrotask(() => {
			if (destroyed || !compositionActive) {
				return;
			}
			// Publish the final IME transaction while the host still considers the
			// composition active. A close/rename fence may already be logically
			// read-only, but it must accept this last user-authored transaction
			// before the host freezes and saves the TextModel.
			if (pendingMarkdownChange) {
				emitMarkdownChange();
			}
			compositionActive = false;
			options.onCompositionChange?.(false);
		});
	};
	view.dom.addEventListener('compositionstart', onCompositionStart);
	view.dom.addEventListener('compositionend', onCompositionEnd);

	return {
		focusAtPoint(clientX, clientY) {
			const result = view.posAtCoords({ left: clientX, top: clientY });
			if (!result) {
				view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
				view.focus();
				emitFormatState();
				return false;
			}
			const position = Math.max(0, Math.min(view.state.doc.content.size, result.pos));
			const selection = TextSelection.between(view.state.doc.resolve(position), view.state.doc.resolve(position));
			view.dispatch(view.state.tr.setSelection(selection));
			view.focus();
			emitFormatState();
			return true;
		},
		focus() {
			view.focus();
			emitFormatState();
		},
		setReadOnly(value) {
			if (readOnly === value) {
				return;
			}
			readOnly = value;
			view.setProps({ editable: () => !readOnly });
			emitFormatState();
		},
		getSelection() {
			return selectionSnapshot(view.state.selection);
		},
		getMarkdown() {
			return serializeCanvasMarkdownDocument(view.state.doc, records, documentLineEnding);
		},
		getFormatState() {
			return emitFormatState();
		},
		runFormatCommand(command) {
			if (destroyed || readOnly) {
				return false;
			}
			return runCanvasFormatCommand(
				command,
				view.state,
				transaction => view.dispatch(transaction),
				view,
				emitFormatState,
			);
		},
		isComposing() {
			return compositionActive || view.composing;
		},
		destroy() {
			if (destroyed) {
				return;
			}
			destroyed = true;
			view.dom.removeEventListener('compositionstart', onCompositionStart);
			view.dom.removeEventListener('compositionend', onCompositionEnd);
			if (compositionActive) {
				compositionActive = false;
				options.onCompositionChange?.(false);
			}
			view.destroy();
		},
	};
}
