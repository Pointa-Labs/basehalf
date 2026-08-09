/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './canvasMarkdownInline.css';

import { baseKeymap, joinBackward, joinForward } from '@tiptap/pm/commands';
import { keymap } from '@tiptap/pm/keymap';
import {
	defaultMarkdownParser,
	defaultMarkdownSerializer,
	MarkdownParser,
	MarkdownSerializer,
	schema as commonmarkSchema,
} from '@tiptap/pm/markdown';
import { DOMParser as ProseMirrorDOMParser, Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { liftListItem, sinkListItem, splitListItem } from '@tiptap/pm/schema-list';
import { EditorState, Selection, TextSelection, type Command, type Transaction } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';

export interface CanvasMarkdownInlineSelection {
	readonly anchor: number;
	readonly head: number;
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
	readonly readOnly?: boolean;
	readonly selection?: CanvasMarkdownInlineSelection;
	readonly onMarkdownChange?: (markdown: string) => void;
	readonly onCompositionChange?: (composing: boolean) => void;
	readonly onUndoRequest?: () => void;
	readonly onRedoRequest?: () => void;
	readonly onExitRequest?: () => void;
	readonly onToolbarRequest?: () => void;
}

export interface CanvasMarkdownInlineEditorRuntime {
	focusAtPoint(clientX: number, clientY: number): boolean;
	focus(): void;
	setReadOnly(readOnly: boolean): void;
	getSelection(): CanvasMarkdownInlineSelection;
	getMarkdown(): string;
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

function sourceCarriesRendererHiddenSemantics(markdown: string): boolean {
	const tokens = canvasTokenizer.parse(normalizeLineEndings(markdown), {}) as readonly MarkdownToken[];
	for (const token of tokens) {
		if (token.type === 'fence'
			|| token.type === 'code_block'
			|| token.type === 'bullet_list_open'
			|| token.type === 'ordered_list_open') {
			return true;
		}
		if (token.children?.some(child => child.type === 'link_open' || child.type === 'hardbreak')) {
			return true;
		}
	}
	return false;
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

function createDocumentUnits(units: readonly CanvasMarkdownInlineUnit[]): {
	readonly document: ProseMirrorNode;
	readonly records: ReadonlyMap<string, CanvasMarkdownRuntimeUnit>;
} {
	const records = new Map<string, CanvasMarkdownRuntimeUnit>();
	const nodes: ProseMirrorNode[] = [];
	for (const unit of units) {
		if (records.has(unit.id)) {
			throw new RangeError(`Duplicate Canvas Markdown unit id: ${unit.id}`);
		}
		const staticElement = unit.element.cloneNode(true) as HTMLElement;
		let node: ProseMirrorNode;
		if (unit.editable) {
			const parsed = unit.element.childNodes.length > 0 && !sourceCarriesRendererHiddenSemantics(unit.markdown)
				? ProseMirrorDOMParser.fromSchema(canvasSchema).parse(unit.element)
				: parseMarkdown(unit.markdown);
			const content = parsed.childCount > 0 ? parsed.content : canvasSchema.nodes.paragraph.create();
			node = canvasSchema.nodes.markdown_unit.create({ unitId: unit.id }, content);
		} else {
			node = canvasSchema.nodes.unsupported_markdown.create({ unitId: unit.id });
		}
		records.set(unit.id, { input: unit, initialNode: node, staticElement });
		nodes.push(node);
	}
	return {
		document: canvasSchema.nodes.doc.create(null, nodes),
		records,
	};
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
	const { document: initialDocument, records } = createDocumentUnits(options.units);
	const initialState = EditorState.create({
		doc: initialDocument,
		selection: selectionForDocument(initialDocument, options.selection),
		plugins,
	});

	let view: EditorView;
	const serializeUnit = (document: ProseMirrorNode): string => {
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
	};
	const serializeDocument = (document: ProseMirrorNode): string => {
		let markdown = '';
		document.forEach(node => {
			const unitId = typeof node.attrs.unitId === 'string' ? node.attrs.unitId : undefined;
			const record = unitId ? records.get(unitId) : undefined;
			if (record) {
				let source = record.input.markdown;
				if (node.type === canvasSchema.nodes.markdown_unit && !node.content.eq(record.initialNode.content)) {
					source = serializeUnit(canvasSchema.nodes.doc.create(null, node.content));
					if (record.input.markdown.includes('\r\n') || documentLineEnding === '\r\n') {
						source = source.replace(/\n/g, '\r\n');
					}
				}
				markdown += `${record.input.prefix}${source}${record.input.separator}`;
				return;
			}
			// Unit wrappers are document-only schema nodes. Preserve user content
			// defensively if a future command introduces a bare top-level block.
			const source = serializeUnit(canvasSchema.nodes.doc.create(null, node));
			markdown += `${markdown.length > 0 ? '\n\n' : ''}${source}`;
		});
		return markdown;
	};
	const emitMarkdownChange = (): void => {
		pendingMarkdownChange = false;
		const markdown = serializeDocument(view.state.doc);
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

	host.replaceChildren();
	view = new EditorView(host, {
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
				return false;
			}
			const position = Math.max(0, Math.min(view.state.doc.content.size, result.pos));
			const selection = TextSelection.between(view.state.doc.resolve(position), view.state.doc.resolve(position));
			view.dispatch(view.state.tr.setSelection(selection));
			view.focus();
			return true;
		},
		focus() {
			view.focus();
		},
		setReadOnly(value) {
			if (readOnly === value) {
				return;
			}
			readOnly = value;
			view.setProps({ editable: () => !readOnly });
		},
		getSelection() {
			return selectionSnapshot(view.state.selection);
		},
		getMarkdown() {
			return serializeDocument(view.state.doc);
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
