/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { parse as parseYaml, YamlMapNode, YamlNode, YamlParseError } from '../../../base/common/yaml.js';
import { isBaseHalfMarkdownFrontmatterMapping } from './basehalfMarkdownProjection.js';
import { baseHalfMirrorResource } from './basehalfMirrorTree.js';
import { BASEHALF_NODE_DOCUMENT_EXTENSION, baseHalfIsReservedOutputTreePath, baseHalfNodeUpstreamItemValues, extractBaseHalfNodeUpstreamLenient } from './basehalfNodeDocument.js';
import {
	BASEHALF_EXACT_UPSTREAM_IDENTITY,
	baseHalfAnalyzeUpstreamItems,
	baseHalfFormatUpstreamEntry,
	baseHalfNormalizeUpstreamEntry,
	baseHalfUpstreamEntryProblem,
	IBaseHalfUpstreamIdentity,
	IBaseHalfUpstreamItem,
	IBaseHalfUpstreamItemValue
} from './basehalfReferenceEntries.js';

/**
 * Pure reader and minimal-edit planner for the two YAML upstream stores:
 * the `upstream` frontmatter key of a Markdown document and the
 * `.bh/mirror/<path>/upstream.yaml` sidecar. Both use the same value rules.
 * Nothing here re-serializes a mapping: every plan is a text edit limited to
 * the `upstream` key's lines, so other keys, their order, comments, quoting,
 * the body, the BOM, and the line endings stay byte-identical.
 */

/** Frontmatter must close within this many UTF-8 bytes of the document start. */
export const BASEHALF_UPSTREAM_FRONTMATTER_WINDOW_BYTES = 64 * 1024;

export type BaseHalfUpstreamStoreKind = 'markdown' | 'node' | 'sidecar';

/** The file name of a sidecar store inside a node's mirror directory. */
export const BASEHALF_UPSTREAM_SIDECAR_FILE_NAME = 'upstream.yaml';

/** Whether a file name has a Markdown extension (`.md` or `.markdown`, any case). */
export function isBaseHalfUpstreamMarkdownName(name: string): boolean {
	return /\.(?:md|markdown)$/i.test(name);
}

/** Whether a file name has the `.bhnode` extension (any case). */
export function isBaseHalfUpstreamNodeDocumentName(name: string): boolean {
	return name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION);
}

/**
 * Where a downstream node keeps its upstream list: Markdown files in their
 * frontmatter, `.bhnode` documents in their `upstream` field, and every other
 * node (folders included) in `.bh/mirror/<path>/upstream.yaml`.
 */
export function baseHalfUpstreamStoreKind(relativePath: string, isDirectory: boolean): BaseHalfUpstreamStoreKind {
	if (isDirectory) {
		return 'sidecar';
	}
	const name = relativePath.slice(relativePath.lastIndexOf('/') + 1);
	if (isBaseHalfUpstreamMarkdownName(name)) {
		return 'markdown';
	}
	return isBaseHalfUpstreamNodeDocumentName(name) ? 'node' : 'sidecar';
}

/** The sidecar store resource of a node. */
export function baseHalfUpstreamSidecarResource(workspaceFolder: URI, relativePath: string): URI {
	return baseHalfMirrorResource(workspaceFolder, relativePath, BASEHALF_UPSTREAM_SIDECAR_FILE_NAME);
}

/** Whether a node can never receive upstream context because it lives in the
 * reserved outputs tree (first segment `outputs`, any case). Sealed and
 * imported Result artifacts are the other upstream-only nodes; the reference
 * index reports them. */
export function isBaseHalfUpstreamReservedOutput(relativePath: string): boolean {
	return baseHalfIsReservedOutputTreePath(relativePath) || relativePath.split('/')[0].toLowerCase() === 'outputs';
}

/**
 * Store-level condition.
 * Unreadable (no edges, writes refused): `mappingValue`, `duplicateKey`,
 * `anchorAliasTag`, `blockScalar`, `invalidDocument`.
 * Used by another tool (no edges, writes refused): `foreignValue`.
 * Not writable (readable when possible, writes refused): `frontmatterRejected`,
 * `tomlFrontmatter`, `mappingNotBlock`, `frontmatterBeyondWindow`, `multilineItem`.
 */
export type BaseHalfUpstreamStoreProblem =
	| 'mappingValue'
	| 'duplicateKey'
	| 'anchorAliasTag'
	| 'blockScalar'
	| 'invalidDocument'
	| 'foreignValue'
	| 'frontmatterRejected'
	| 'tomlFrontmatter'
	| 'mappingNotBlock'
	| 'frontmatterBeyondWindow'
	| 'multilineItem';

/** The result of reading one store's text. */
export interface IBaseHalfUpstreamStoreRead {
	/** False when the store contributes no edges (unreadable or foreign). */
	readonly readable: boolean;
	/** False when BaseHalf refuses to write the store. */
	readonly writable: boolean;
	/** Every item of the list, valid and invalid; empty when not readable. */
	readonly items: readonly IBaseHalfUpstreamItem[];
	/** True when an `upstream` key (or sidecar file content) is present. */
	readonly hasKey: boolean;
	readonly problem?: BaseHalfUpstreamStoreProblem;
	/** Whether the store-level problem is shown as an issue. A Markdown
	 * document BaseHalf does not write is an issue only while its leading
	 * block holds entries BaseHalf can read (`blockEntries`). */
	readonly issue: boolean;
	/**
	 * Markdown only: the valid entries of an `upstream` key written inside a
	 * leading block BaseHalf does not recognize as frontmatter. They are not
	 * this store's items. BaseHalf carries them into the note's sidecar on its
	 * first write there, and on Rebuild List.
	 */
	readonly blockEntries?: readonly string[];
}

export interface IBaseHalfUpstreamReadOptions {
	/** The downstream node's workspace-relative path, for self detection. */
	readonly nodePath?: string;
	readonly identity?: IBaseHalfUpstreamIdentity;
}

/** A primitive or whole-list change of one upstream list. */
export type BaseHalfUpstreamListOperation =
	/** Appends an entry; succeeds without writing when an item already names it. */
	| { readonly kind: 'add'; readonly entry: string }
	/** Removes every item that names the entry; succeeds without writing when none does. */
	| { readonly kind: 'remove'; readonly entry: string }
	/** Replaces the first item naming `from` in place. When `to` is already
	 * listed, the `from` item is removed instead. When `from` is not listed and
	 * `to` is, succeeds without writing; when neither is, the plan is refused
	 * with `entryMissing`. */
	| { readonly kind: 'replace'; readonly from: string; readonly to: string }
	/** Removes the item at `index` when it still has `expected` as its text. */
	| { readonly kind: 'removeAt'; readonly index: number; readonly expected: string }
	/** Replaces the item at `index` (which must still have `expected` as its text) in place. */
	| { readonly kind: 'replaceAt'; readonly index: number; readonly expected: string; readonly to: string }
	/** Makes the list exactly `items`, keeping the source text of unchanged items (undo and redo). */
	| { readonly kind: 'set'; readonly items: readonly IBaseHalfUpstreamItemValue[] }
	/** **Rebuild List**: writes a list BaseHalf cannot read, or will not edit in
	 * place, again as one block list of the valid entries it holds. A store
	 * that is readable and writable is left as it is. */
	| { readonly kind: 'rebuild' };

export type BaseHalfUpstreamPlanRefusal =
	| BaseHalfUpstreamStoreProblem
	/** A `replace` whose source entry is not listed, or a positional edit whose item changed. */
	| 'entryMissing';

/** A single minimal replacement in the planned text (offsets in UTF-16 code units). */
export interface IBaseHalfUpstreamTextEdit {
	readonly offset: number;
	readonly length: number;
	readonly text: string;
}

export type BaseHalfUpstreamTextPlan =
	| { readonly kind: 'noop' }
	| {
		readonly kind: 'edit';
		/** The complete next text. */
		readonly text: string;
		/** One minimal replacement that turns the current text into `text`. */
		readonly edit: IBaseHalfUpstreamTextEdit;
		/** True when a frontmatter block was inserted into a document that had none. */
		readonly createdFrontmatter: boolean;
	}
	/** Sidecar only: the last entry was removed and nothing but whitespace remains. */
	| { readonly kind: 'delete' }
	| { readonly kind: 'refused'; readonly reason: BaseHalfUpstreamPlanRefusal };

export interface IBaseHalfUpstreamPlanOptions extends IBaseHalfUpstreamReadOptions {
	/** Line ending for a text that has none yet. Defaults to `\n`. */
	readonly defaultEol?: string;
}

//#region Syntax

type ValueKind = 'empty' | 'null' | 'scalar' | 'flow' | 'block';

interface ISyntaxItem {
	readonly value: IBaseHalfUpstreamItemValue;
	/** Source offsets of the item node (absolute in the analyzed text). */
	readonly start: number;
	readonly end: number;
	readonly startLine: number;
	readonly endLine: number;
	readonly raw: string;
}

interface IUpstreamSyntax {
	readonly keyLine: number;
	readonly keyColumn: number;
	readonly colonEnd: number;
	readonly valueKind: ValueKind;
	readonly valueStart: number;
	readonly valueEnd: number;
	readonly valueEndLine: number;
	readonly items: readonly ISyntaxItem[];
	/** Leading whitespace of a block list's item lines. */
	readonly listIndent: string;
}

interface IYamlRegionSyntax {
	readonly readable: boolean;
	readonly problem?: BaseHalfUpstreamStoreProblem;
	readonly upstream?: IUpstreamSyntax;
	/** False when the root is a flow mapping, which BaseHalf never edits. */
	readonly block: boolean;
	/** True when the root is a block mapping whose keys start in column 0, so
	 * a missing `upstream` key can be inserted. */
	readonly columnZero: boolean;
}

class LineIndex {
	private readonly starts: number[] = [0];

	constructor(readonly text: string) {
		for (let index = 0; index < text.length; index++) {
			const code = text.charCodeAt(index);
			if (code === 10) {
				this.starts.push(index + 1);
			} else if (code === 13 && text.charCodeAt(index + 1) !== 10) {
				this.starts.push(index + 1);
			}
		}
	}

	get lineCount(): number {
		return this.starts.length;
	}

	lineOf(offset: number): number {
		let low = 0;
		let high = this.starts.length - 1;
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if (this.starts[middle] <= offset) {
				low = middle;
			} else {
				high = middle - 1;
			}
		}
		return low;
	}

	start(line: number): number {
		return line < this.starts.length ? this.starts[line] : this.text.length;
	}

	/** Offset of the end of the line's content, before its line break. */
	contentEnd(line: number): number {
		let end = line + 1 < this.starts.length ? this.starts[line + 1] : this.text.length;
		if (end > this.start(line) && this.text.charCodeAt(end - 1) === 10) {
			end--;
		}
		if (end > this.start(line) && this.text.charCodeAt(end - 1) === 13) {
			end--;
		}
		return end;
	}

	/** Offset after the line's line break (or the end of the text). */
	end(line: number): number {
		return line + 1 < this.starts.length ? this.starts[line + 1] : this.text.length;
	}

	hasLineBreak(line: number): boolean {
		return line + 1 < this.starts.length;
	}
}

function detectEol(text: string, fallback: string | undefined): string {
	const index = text.search(/\r\n|\n|\r/);
	if (index < 0) {
		return fallback ?? '\n';
	}
	if (text.charCodeAt(index) === 13) {
		return text.charCodeAt(index + 1) === 10 ? '\r\n' : '\r';
	}
	return '\n';
}

function startsWithNodeProperty(value: string): boolean {
	return /^[&*!]/.test(value);
}

/** Whether a whole YAML file is a mapping BaseHalf can read: the same
 * tolerance as the frontmatter recognizer, without its first-line rule. */
function isYamlFileMapping(region: string, allowDuplicateKeys: boolean): boolean {
	const errors: YamlParseError[] = [];
	const root = parseYaml(region, errors, { allowDuplicateKeys });
	return root?.type === 'map'
		&& errors.every(error => error.code === 'missing-value' && region.charAt(error.startOffset) === ':');
}

/**
 * Parses the YAML region `text.slice(regionStart, regionEnd)` (frontmatter
 * content or a whole sidecar file) and locates its `upstream` key. `strict`
 * rejects YAML errors the frontmatter recognizer would have rejected; the
 * Markdown path has already run the recognizer.
 */
function analyzeYamlRegion(text: string, lines: LineIndex, regionStart: number, regionEnd: number, strict: boolean): IYamlRegionSyntax {
	const region = text.slice(regionStart, regionEnd);
	if (region.trim() === '' || region.split(/\r\n|\n|\r/).every(line => line.trim() === '' || /^[ \t]*#/.test(line))) {
		return { readable: true, block: true, columnZero: true };
	}
	if (strict && !isYamlFileMapping(region, true)) {
		return { readable: false, problem: 'invalidDocument', block: false, columnZero: false };
	}
	const errors: YamlParseError[] = [];
	const root = parseYaml(region, errors, { allowDuplicateKeys: true });
	if (root?.type !== 'map') {
		return { readable: false, problem: 'invalidDocument', block: false, columnZero: false };
	}
	const block = root.style === 'block';
	const columnZero = block && root.properties.every(property => {
		const offset = regionStart + property.key.startOffset;
		return offset === lines.start(lines.lineOf(offset));
	});
	const properties = root.properties.filter(property => property.key.value === 'upstream');
	if (properties.length === 0) {
		return { readable: true, block, columnZero };
	}
	if (properties.length > 1) {
		return { readable: false, problem: 'duplicateKey', block, columnZero };
	}
	return analyzeUpstreamProperty(text, lines, regionStart, region, properties[0], block, columnZero);
}

function analyzeUpstreamProperty(
	text: string,
	lines: LineIndex,
	regionStart: number,
	region: string,
	property: YamlMapNode['properties'][number],
	block: boolean,
	columnZero: boolean
): IYamlRegionSyntax {
	const keyStart = regionStart + property.key.startOffset;
	const keyLine = lines.lineOf(keyStart);
	const keyColumn = keyStart - lines.start(keyLine);
	const colon = region.indexOf(':', property.key.endOffset);
	const colonEnd = regionStart + (colon < 0 ? property.key.endOffset : colon + 1);
	const value = property.value;
	const base = { keyLine, keyColumn, colonEnd, listIndent: '' };
	const unreadable = (problem: BaseHalfUpstreamStoreProblem): IYamlRegionSyntax => ({ readable: false, problem, block, columnZero });

	if (value.type === 'map') {
		return unreadable('mappingValue');
	}
	if (value.type === 'scalar') {
		if (value.format === 'literal' || value.format === 'folded') {
			return unreadable('blockScalar');
		}
		if (value.format === 'none' && value.rawValue === '') {
			return {
				readable: true,
				block,
				columnZero,
				upstream: { ...base, valueKind: 'empty', valueStart: colonEnd, valueEnd: colonEnd, valueEndLine: keyLine, items: [] }
			};
		}
		const valueStart = regionStart + value.startOffset;
		const valueEnd = regionStart + value.endOffset;
		const valueEndLine = lines.lineOf(Math.max(valueStart, valueEnd - 1));
		if (value.format === 'none') {
			if (startsWithNodeProperty(value.value)) {
				return unreadable('anchorAliasTag');
			}
			if (/^(?:~|null|Null|NULL)$/.test(value.value)) {
				return {
					readable: true,
					block,
					columnZero,
					upstream: { ...base, valueKind: 'null', valueStart, valueEnd, valueEndLine, items: [] }
				};
			}
		}
		const item: ISyntaxItem = {
			value: { text: value.value, scalar: true },
			start: valueStart,
			end: valueEnd,
			startLine: lines.lineOf(valueStart),
			endLine: valueEndLine,
			raw: text.slice(valueStart, valueEnd)
		};
		return {
			readable: true,
			block,
			columnZero,
			upstream: { ...base, valueKind: 'scalar', valueStart, valueEnd, valueEndLine, items: [item] }
		};
	}

	const items: ISyntaxItem[] = [];
	let previousEnd = regionStart + value.startOffset;
	for (const node of value.items) {
		const syntax = analyzeItem(text, lines, regionStart, node, value.style === 'block' ? previousEnd : undefined);
		if (typeof syntax === 'string') {
			return unreadable(syntax);
		}
		items.push(syntax);
		previousEnd = syntax.end;
	}
	const valueStart = regionStart + value.startOffset;
	const valueEnd = regionStart + value.endOffset;
	const valueEndLine = value.style === 'block' && items.length > 0
		? items[items.length - 1].endLine
		: lines.lineOf(Math.max(valueStart, valueEnd - 1));
	let listIndent = '';
	if (value.style === 'block' && items.length > 0) {
		const firstLineStart = lines.start(items[0].startLine);
		listIndent = /^[ \t]*/.exec(text.slice(firstLineStart, lines.contentEnd(items[0].startLine)))![0];
	}
	return {
		readable: true,
		block,
		columnZero,
		upstream: {
			...base,
			listIndent,
			valueKind: value.style === 'block' ? 'block' : 'flow',
			valueStart,
			valueEnd,
			valueEndLine,
			items
		}
	};
}

function analyzeItem(text: string, lines: LineIndex, regionStart: number, node: YamlNode, blockSearchStart: number | undefined): ISyntaxItem | BaseHalfUpstreamStoreProblem {
	const start = regionStart + node.startOffset;
	const end = regionStart + node.endOffset;
	let startLine = lines.lineOf(start);
	if (blockSearchStart !== undefined) {
		// A block item's value may start on the line after its dash.
		const dash = text.lastIndexOf('-', start - 1);
		if (dash >= blockSearchStart) {
			startLine = lines.lineOf(dash);
		}
	}
	const endLine = lines.lineOf(Math.max(start, end - 1));
	const raw = text.slice(start, end);
	let value: IBaseHalfUpstreamItemValue;
	if (node.type === 'scalar') {
		if (node.format === 'literal' || node.format === 'folded') {
			return 'blockScalar';
		}
		if (node.format === 'none') {
			if (startsWithNodeProperty(node.value)) {
				return 'anchorAliasTag';
			}
			value = node.rawValue === '' || node.value === '~'
				? { text: node.rawValue === '' ? '' : '~', scalar: false }
				: { text: node.value, scalar: true };
		} else {
			value = { text: node.value, scalar: true };
		}
	} else {
		value = { text: raw, scalar: false };
	}
	return { value, start, end, startLine, endLine: Math.max(startLine, endLine), raw };
}

//#endregion

//#region Markdown document layout

type FrontmatterKind = 'none' | 'recognized' | 'rejected' | 'duplicateKey' | 'toml' | 'beyondWindow';

interface IMarkdownLayout {
	readonly bomLength: number;
	readonly kind: FrontmatterKind;
	/** Offset of the first content character after the opening fence line. */
	readonly contentStart: number;
	/** Offset of the line break that precedes the closing fence. */
	readonly contentEnd: number;
	/** Offset after the closing fence line, including its line break. */
	readonly blockEnd: number;
	/** The leading block contains a line matching `^upstream\s*:`. */
	readonly upstreamLine: boolean;
}

const UPSTREAM_LINE = /^upstream\s*:/m;

function utf8Length(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code < 0x80) {
			bytes += 1;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
			bytes += 4;
			index++;
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

function withinWindow(text: string, end: number): boolean {
	if (end * 3 <= BASEHALF_UPSTREAM_FRONTMATTER_WINDOW_BYTES) {
		return true;
	}
	return utf8Length(text.slice(0, end)) <= BASEHALF_UPSTREAM_FRONTMATTER_WINDOW_BYTES;
}

function layoutMarkdown(text: string): IMarkdownLayout {
	const bomLength = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
	const none: IMarkdownLayout = { bomLength, kind: 'none', contentStart: bomLength, contentEnd: bomLength, blockEnd: bomLength, upstreamLine: false };
	const body = bomLength ? text.slice(bomLength) : text;
	const fence = /^(---|\+\+\+)[ \t]*\r?\n/.exec(body);
	if (!fence) {
		return none;
	}
	const marker = fence[1] === '---' ? '---' : '\\+\\+\\+';
	const openLineEnd = body.indexOf('\n');
	const close = new RegExp(`\\r?\\n${marker}[ \\t]*(?:\\r?\\n|$)`, 'g');
	close.lastIndex = openLineEnd;
	const match = close.exec(body);
	if (!match) {
		return none;
	}
	const contentStart = bomLength + openLineEnd + 1;
	const contentEnd = bomLength + match.index;
	const blockEnd = bomLength + match.index + match[0].length;
	const candidate = text.slice(contentStart, contentEnd);
	const upstreamLine = UPSTREAM_LINE.test(candidate);
	const closeLineEnd = blockEnd - (/\r?\n$/.exec(match[0])?.[0].length ?? 0);
	if (!withinWindow(text, closeLineEnd)) {
		return { ...none, kind: fence[1] === '---' ? 'beyondWindow' : 'none' };
	}
	if (fence[1] !== '---') {
		return { bomLength, kind: 'toml', contentStart, contentEnd, blockEnd, upstreamLine };
	}
	if (isBaseHalfMarkdownFrontmatterMapping(candidate)) {
		return { bomLength, kind: 'recognized', contentStart, contentEnd, blockEnd, upstreamLine };
	}
	if (isBaseHalfMarkdownFrontmatterMapping(candidate, { allowDuplicateKeys: true })) {
		const errors: YamlParseError[] = [];
		const root = parseYaml(candidate, errors, { allowDuplicateKeys: true });
		const duplicates = root?.type === 'map' ? root.properties.filter(property => property.key.value === 'upstream').length : 0;
		if (duplicates > 1) {
			return { bomLength, kind: 'duplicateKey', contentStart, contentEnd, blockEnd, upstreamLine };
		}
	}
	return { bomLength, kind: 'rejected', contentStart, contentEnd, blockEnd, upstreamLine };
}

//#endregion

//#region Reading

function toRead(region: IYamlRegionSyntax, options: IBaseHalfUpstreamReadOptions): IBaseHalfUpstreamStoreRead {
	if (!region.readable) {
		return { readable: false, writable: false, items: [], hasKey: true, problem: region.problem, issue: true };
	}
	const upstream = region.upstream;
	if (!upstream) {
		// A missing key can be inserted only into a block mapping in column 0.
		return region.columnZero
			? { readable: true, writable: true, items: [], hasKey: false, issue: false }
			: { readable: true, writable: false, items: [], hasKey: false, problem: 'mappingNotBlock', issue: false };
	}
	const identity = options.identity ?? BASEHALF_EXACT_UPSTREAM_IDENTITY;
	if (upstream.valueKind === 'scalar') {
		const entry = upstream.items[0].value.text;
		if (baseHalfUpstreamEntryProblem(entry, options.nodePath, identity)) {
			return { readable: false, writable: false, items: [], hasKey: true, problem: 'foreignValue', issue: true };
		}
	}
	const items = baseHalfAnalyzeUpstreamItems(upstream.items.map(item => item.value), options.nodePath, identity);
	const problem = region.block ? multilineProblem(upstream) : 'mappingNotBlock';
	return problem
		? { readable: true, writable: false, items, hasKey: true, problem, issue: true }
		: { readable: true, writable: true, items, hasKey: true, issue: false };
}

function multilineProblem(upstream: IUpstreamSyntax): BaseHalfUpstreamStoreProblem | undefined {
	return upstream.valueKind === 'flow' && upstream.items.some(item => /[\r\n]/.test(item.raw)) ? 'multilineItem' : undefined;
}

/**
 * The valid entries of an `upstream` key inside a leading block that is not
 * recognized as frontmatter. The key's own lines are read as a list, whatever
 * the rest of the block holds, so an error elsewhere in the block does not
 * hide the connections it lists.
 */
function unrecognizedBlockEntries(text: string, layout: IMarkdownLayout, options: IBaseHalfUpstreamReadOptions): readonly string[] {
	if (!layout.upstreamLine) {
		return [];
	}
	const lines = text.slice(layout.contentStart, layout.contentEnd).split(/\r\n|\n|\r/);
	const first = lines.findIndex(line => /^upstream\s*:/.test(line));
	// The key's lines run until a line starts another key.
	let last = first;
	while (last + 1 < lines.length && /^(?:[ \t]|-|#|$)/.test(lines[last + 1])) {
		last++;
	}
	return baseHalfReadableSidecarUpstreamEntries(lines.slice(first, last + 1).map(line => `${line}\n`).join(''), options);
}

/**
 * Whether a Markdown note keeps its upstream list in its sidecar
 * `upstream.yaml` instead of its frontmatter (reference graph, "A note that
 * cannot hold its list"). It does while it has no `upstream` key of its own
 * and either cannot take one or already has a sidecar. `own` is the note's
 * own read.
 */
export function baseHalfMarkdownNoteUsesSidecar(own: Pick<IBaseHalfUpstreamStoreRead, 'hasKey' | 'writable'>, sidecarExists: boolean): boolean {
	return !own.hasKey && (sidecarExists || !own.writable);
}

/**
 * Reads the `upstream` frontmatter key of a Markdown document. `text` may be
 * the complete document or its first 64 KiB, and may start with a BOM.
 */
export function readBaseHalfMarkdownUpstream(text: string, options: IBaseHalfUpstreamReadOptions = {}): IBaseHalfUpstreamStoreRead {
	const layout = layoutMarkdown(text);
	switch (layout.kind) {
		case 'none':
			return { readable: true, writable: true, items: [], hasKey: false, issue: false };
		case 'beyondWindow':
			return { readable: true, writable: false, items: [], hasKey: false, problem: 'frontmatterBeyondWindow', issue: false };
		// BaseHalf does not treat these blocks as frontmatter and never writes
		// into them: the note's list is kept in its sidecar
		// (`baseHalfMarkdownNoteUsesSidecar`).
		case 'toml':
		case 'rejected': {
			const blockEntries = unrecognizedBlockEntries(text, layout, options);
			return {
				readable: true,
				writable: false,
				items: [],
				hasKey: false,
				problem: layout.kind === 'toml' ? 'tomlFrontmatter' : 'frontmatterRejected',
				issue: blockEntries.length > 0,
				...(blockEntries.length > 0 ? { blockEntries } : {})
			};
		}
		case 'duplicateKey':
			return { readable: false, writable: false, items: [], hasKey: true, problem: 'duplicateKey', issue: true };
	}
	const lines = new LineIndex(text);
	return toRead(analyzeYamlRegion(text, lines, layout.contentStart, layout.contentEnd, false), options);
}

/**
 * Reads a `.bh/mirror/<path>/upstream.yaml` sidecar. The only recognized key
 * is `upstream`; `undefined` text means the file does not exist.
 */
export function readBaseHalfSidecarUpstream(text: string | undefined, options: IBaseHalfUpstreamReadOptions = {}): IBaseHalfUpstreamStoreRead {
	if (text === undefined) {
		return { readable: true, writable: true, items: [], hasKey: false, issue: false };
	}
	const bomLength = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
	const read = toRead(analyzeYamlRegion(text, new LineIndex(text), bomLength, text.length, true), options);
	// A sidecar BaseHalf will not edit in place is always reported, so that
	// Rebuild List is offered wherever a write would be refused.
	return read.writable || read.issue ? read : { ...read, issue: true };
}

/** The ordered raw entry strings of a read, or `undefined` when unreadable.
 * This is the state the plugin guard and canvas undo compare. */
export function baseHalfUpstreamReadState(read: IBaseHalfUpstreamStoreRead): readonly IBaseHalfUpstreamItemValue[] | undefined {
	return read.readable ? read.items.map(item => ({ text: item.text, scalar: item.scalar })) : undefined;
}

/** Whether two item lists are identical (same texts and kinds in the same order). */
export function baseHalfUpstreamItemsEqual(left: readonly IBaseHalfUpstreamItemValue[] | undefined, right: readonly IBaseHalfUpstreamItemValue[] | undefined): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}
	return left.length === right.length && left.every((item, index) => item.text === right[index].text && item.scalar === right[index].scalar);
}

//#endregion

//#region Planning

type TargetItem =
	| { readonly kind: 'keep'; readonly index: number }
	| { readonly kind: 'replace'; readonly index: number; readonly value: IBaseHalfUpstreamItemValue }
	| { readonly kind: 'new'; readonly value: IBaseHalfUpstreamItemValue };

type TargetResult = { readonly kind: 'noop' } | { readonly kind: 'refused'; readonly reason: BaseHalfUpstreamPlanRefusal } | { readonly kind: 'target'; readonly target: readonly TargetItem[] };

function computeTarget(
	items: readonly IBaseHalfUpstreamItemValue[],
	operation: BaseHalfUpstreamListOperation,
	identity: IBaseHalfUpstreamIdentity
): TargetResult {
	const keyOf = (value: IBaseHalfUpstreamItemValue): string | undefined => value.scalar ? identity.key(baseHalfNormalizeUpstreamEntry(value.text)) : undefined;
	const keep = (): TargetItem[] => items.map((_, index) => ({ kind: 'keep', index }));
	switch (operation.kind) {
		case 'add': {
			const key = identity.key(baseHalfNormalizeUpstreamEntry(operation.entry));
			if (items.some(item => keyOf(item) === key)) {
				return { kind: 'noop' };
			}
			return { kind: 'target', target: [...keep(), { kind: 'new', value: { text: operation.entry, scalar: true } }] };
		}
		case 'remove': {
			const key = identity.key(baseHalfNormalizeUpstreamEntry(operation.entry));
			const target = keep().filter(item => item.kind !== 'keep' || keyOf(items[item.index]) !== key);
			return target.length === items.length ? { kind: 'noop' } : { kind: 'target', target };
		}
		case 'replace': {
			const fromKey = identity.key(baseHalfNormalizeUpstreamEntry(operation.from));
			const toKey = identity.key(baseHalfNormalizeUpstreamEntry(operation.to));
			const index = items.findIndex(item => keyOf(item) === fromKey);
			const toIndex = items.findIndex(item => keyOf(item) === toKey);
			if (index < 0) {
				return toIndex >= 0 ? { kind: 'noop' } : { kind: 'refused', reason: 'entryMissing' };
			}
			return replaceAt(items, index, operation.to, toIndex >= 0 && toIndex !== index);
		}
		case 'removeAt': {
			if (items[operation.index]?.text !== operation.expected) {
				return { kind: 'refused', reason: 'entryMissing' };
			}
			return { kind: 'target', target: keep().filter((_, index) => index !== operation.index) };
		}
		case 'replaceAt': {
			if (items[operation.index]?.text !== operation.expected) {
				return { kind: 'refused', reason: 'entryMissing' };
			}
			const toKey = identity.key(baseHalfNormalizeUpstreamEntry(operation.to));
			const duplicate = items.some((item, index) => index !== operation.index && keyOf(item) === toKey);
			return replaceAt(items, operation.index, operation.to, duplicate);
		}
		case 'set':
			return setTarget(items, operation.items);
		case 'rebuild':
			// The planners handle a rebuild before any target is computed.
			return { kind: 'noop' };
	}
}

function replaceAt(items: readonly IBaseHalfUpstreamItemValue[], index: number, to: string, removeInstead: boolean): TargetResult {
	if (!removeInstead && items[index].scalar && items[index].text === to) {
		return { kind: 'noop' };
	}
	const target: TargetItem[] = [];
	items.forEach((_, candidate) => {
		if (candidate !== index) {
			target.push({ kind: 'keep', index: candidate });
		} else if (!removeInstead) {
			target.push({ kind: 'replace', index, value: { text: to, scalar: true } });
		}
	});
	return { kind: 'target', target };
}

/** Longest common subsequence of item values, so unchanged items keep their source text. */
function setTarget(items: readonly IBaseHalfUpstreamItemValue[], next: readonly IBaseHalfUpstreamItemValue[]): TargetResult {
	const same = (left: IBaseHalfUpstreamItemValue, right: IBaseHalfUpstreamItemValue) => left.text === right.text && left.scalar === right.scalar;
	if (items.length === next.length && items.every((item, index) => same(item, next[index]))) {
		return { kind: 'noop' };
	}
	const rows = items.length + 1;
	const columns = next.length + 1;
	const table = new Array<number>(rows * columns).fill(0);
	for (let row = items.length - 1; row >= 0; row--) {
		for (let column = next.length - 1; column >= 0; column--) {
			table[row * columns + column] = same(items[row], next[column])
				? table[(row + 1) * columns + column + 1] + 1
				: Math.max(table[(row + 1) * columns + column], table[row * columns + column + 1]);
		}
	}
	const target: TargetItem[] = [];
	let row = 0;
	let column = 0;
	while (row < items.length || column < next.length) {
		if (row < items.length && column < next.length && same(items[row], next[column])) {
			target.push({ kind: 'keep', index: row });
			row++;
			column++;
		} else if (column < next.length && (row === items.length || table[row * columns + column + 1] >= table[(row + 1) * columns + column])) {
			target.push({ kind: 'new', value: next[column] });
			column++;
		} else {
			row++;
		}
	}
	return { kind: 'target', target };
}

function formatItem(value: IBaseHalfUpstreamItemValue): string {
	return value.scalar ? baseHalfFormatUpstreamEntry(value.text) : value.text;
}

interface IRawEdit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

function applyEdits(text: string, edits: readonly IRawEdit[]): string {
	const sorted = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
	let result = '';
	let cursor = 0;
	for (const edit of sorted) {
		// Adjacent line deletions may share one line break; never re-emit it.
		const start = Math.max(edit.start, cursor);
		result += text.slice(cursor, start) + edit.text;
		cursor = Math.max(cursor, edit.end);
	}
	return result + text.slice(cursor);
}

function minimalEdit(before: string, after: string): IBaseHalfUpstreamTextEdit {
	let prefix = 0;
	const limit = Math.min(before.length, after.length);
	while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) {
		prefix++;
	}
	let suffix = 0;
	while (suffix < limit - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) {
		suffix++;
	}
	return { offset: prefix, length: before.length - prefix - suffix, text: after.slice(prefix, after.length - suffix) };
}

function editPlan(before: string, edits: readonly IRawEdit[], createdFrontmatter = false): BaseHalfUpstreamTextPlan {
	const after = applyEdits(before, edits);
	return after === before ? { kind: 'noop' } : { kind: 'edit', text: after, edit: minimalEdit(before, after), createdFrontmatter };
}

/** Deletes whole lines `[first, last]` including their line breaks. */
function deleteLines(lines: LineIndex, first: number, last: number): IRawEdit {
	if (lines.hasLineBreak(last) || first === 0) {
		return { start: lines.start(first), end: lines.end(last), text: '' };
	}
	// The last line of a text without a final line break: take the preceding one.
	return { start: lines.contentEnd(first - 1), end: lines.end(last), text: '' };
}

interface IRegionContext {
	readonly text: string;
	readonly lines: LineIndex;
	readonly regionStart: number;
	readonly regionEnd: number;
	readonly eol: string;
	readonly upstream: IUpstreamSyntax;
	/** Whether the region text (without the upstream key) is acceptable as is. */
	readonly remainderAccepted: (remainder: string) => boolean;
	/** The whole-store edit used when nothing but whitespace remains. */
	readonly removeWhole: () => BaseHalfUpstreamTextPlan;
}

/** Plans the change of an existing `upstream` key to `target`. */
function planExistingKey(context: IRegionContext, target: readonly TargetItem[]): BaseHalfUpstreamTextPlan {
	const { text, lines, upstream, eol } = context;
	const items = upstream.items;
	if (target.length === 0) {
		return planRemoveKey(context);
	}
	if (upstream.valueKind === 'block') {
		const edits: IRawEdit[] = [];
		const referenced = new Set<number>();
		for (const item of target) {
			if (item.kind !== 'new') {
				referenced.add(item.index);
			}
		}
		items.forEach((item, index) => {
			if (!referenced.has(index)) {
				edits.push(deleteLines(lines, item.startLine, item.endLine));
			}
		});
		let anchorLine = upstream.keyLine;
		let pending: string[] = [];
		const flush = () => {
			if (pending.length > 0) {
				edits.push({ start: lines.contentEnd(anchorLine), end: lines.contentEnd(anchorLine), text: pending.map(line => eol + line).join('') });
				pending = [];
			}
		};
		for (const item of target) {
			if (item.kind === 'new') {
				pending.push(`${upstream.listIndent}- ${formatItem(item.value)}`);
				continue;
			}
			flush();
			const current = items[item.index];
			if (item.kind === 'replace') {
				edits.push({ start: current.start, end: current.end, text: formatItem(item.value) });
			}
			anchorLine = current.endLine;
		}
		flush();
		return editPlan(text, edits);
	}
	if (upstream.valueKind === 'flow' && items.some(item => /[\r\n]/.test(item.raw))) {
		return { kind: 'refused', reason: 'multilineItem' };
	}
	const indent = ' '.repeat(upstream.keyColumn + 2);
	const values = target.map(item => item.kind === 'keep' ? items[item.index].value : item.value);
	const block = values.map(value => `${eol}${indent}- ${formatItem(value)}`).join('');
	if (upstream.valueKind === 'empty') {
		const end = lines.contentEnd(upstream.keyLine);
		return editPlan(text, [{ start: end, end, text: block }]);
	}
	return editPlan(text, [{ start: upstream.colonEnd, end: upstream.valueEnd, text: block }]);
}

/** Removes the key and its item lines, keeping comment lines (last entry removed). */
function planRemoveKey(context: IRegionContext): BaseHalfUpstreamTextPlan {
	const { text, lines, upstream } = context;
	if (upstream.items.length === 0) {
		return { kind: 'noop' };
	}
	const removals: IRawEdit[] = [];
	if (upstream.valueKind === 'block') {
		removals.push(deleteLines(lines, upstream.keyLine, upstream.keyLine));
		for (const item of upstream.items) {
			removals.push(deleteLines(lines, item.startLine, item.endLine));
		}
	} else {
		removals.push(deleteLines(lines, upstream.keyLine, upstream.valueEndLine));
	}
	const after = applyEdits(text, removals);
	const remainder = after.slice(context.regionStart, context.regionEnd - (text.length - after.length));
	if (remainder.trim() === '') {
		return context.removeWhole();
	}
	if (context.remainderAccepted(remainder)) {
		return editPlan(text, removals);
	}
	// Only comments or unrecognizable text would remain: keep every byte and
	// leave an explicit empty list so the block stays recognizable.
	if (upstream.valueKind === 'block') {
		return editPlan(text, [
			{ start: upstream.colonEnd, end: upstream.colonEnd, text: ' []' },
			...upstream.items.map(item => deleteLines(lines, item.startLine, item.endLine))
		]);
	}
	return editPlan(text, [{ start: upstream.colonEnd, end: upstream.valueEnd, text: ' []' }]);
}

function refusedByRead(read: IBaseHalfUpstreamStoreRead): BaseHalfUpstreamTextPlan | undefined {
	if (!read.writable) {
		return { kind: 'refused', reason: read.problem ?? 'invalidDocument' };
	}
	return undefined;
}

/**
 * The scalar values of one `upstream` key that can still be read when the
 * value as a whole cannot: an anchor or tag in front of an item is dropped
 * and the item kept, and an alias, which names a value defined elsewhere, is
 * skipped.
 */
function readableUpstreamValues(text: string, lines: LineIndex, regionStart: number, region: string, property: YamlMapNode['properties'][number]): IBaseHalfUpstreamItemValue[] {
	const syntax = analyzeUpstreamProperty(text, lines, regionStart, region, property, true, true);
	if (syntax.readable) {
		return syntax.upstream?.items.map(candidate => candidate.value) ?? [];
	}
	if (syntax.problem !== 'anchorAliasTag') {
		return [];
	}
	const nodes = property.value.type === 'sequence' ? property.value.items : [property.value];
	const values: IBaseHalfUpstreamItemValue[] = [];
	for (const node of nodes) {
		if (node.type !== 'scalar' || node.format === 'literal' || node.format === 'folded') {
			continue;
		}
		let value = node.value;
		while (node.format === 'none' && /^[&!]\S*\s+/.test(value)) {
			value = value.replace(/^[&!]\S*\s+/, '');
		}
		if (node.format !== 'none' || !startsWithNodeProperty(value)) {
			values.push({ text: value, scalar: true });
		}
	}
	return values;
}

/**
 * The valid entries of every `upstream` key of a sidecar's text, once each and
 * in order, read as tolerantly as the text allows: the file need not be a
 * block mapping in column 0, and it may start with a BOM.
 */
function readableSidecarEntries(text: string, options: IBaseHalfUpstreamReadOptions): readonly string[] {
	const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
	const root = parseYaml(body, [], { allowDuplicateKeys: true });
	if (root?.type !== 'map') {
		return [];
	}
	const identity = options.identity ?? BASEHALF_EXACT_UPSTREAM_IDENTITY;
	const lines = new LineIndex(body);
	const entries: string[] = [];
	const seen = new Set<string>();
	for (const property of root.properties) {
		if (property.key.value !== 'upstream') {
			continue;
		}
		for (const item of baseHalfAnalyzeUpstreamItems(readableUpstreamValues(body, lines, 0, body, property), options.nodePath, identity)) {
			const key = item.path === undefined ? undefined : identity.key(item.path);
			if (item.path !== undefined && key !== undefined && !seen.has(key)) {
				seen.add(key);
				entries.push(item.path);
			}
		}
	}
	return entries;
}

/**
 * The valid entries of every top-level `upstream` key of a YAML region, in
 * order and without repeats, with the lines each key occupies. `undefined`
 * when the region is not a block mapping whose keys start in column 0, which
 * is the only shape BaseHalf removes whole key lines from.
 */
function locateUpstreamKeys(
	text: string,
	lines: LineIndex,
	regionStart: number,
	regionEnd: number,
	options: IBaseHalfUpstreamReadOptions
): { readonly keys: readonly { readonly firstLine: number; readonly lastLine: number }[]; readonly entries: readonly string[] } | undefined {
	const region = text.slice(regionStart, regionEnd);
	const root = parseYaml(region, [], { allowDuplicateKeys: true });
	if (root?.type !== 'map' || root.style !== 'block') {
		return undefined;
	}
	const columnZero = root.properties.every(property => {
		const offset = regionStart + property.key.startOffset;
		return offset === lines.start(lines.lineOf(offset));
	});
	if (!columnZero) {
		return undefined;
	}
	const identity = options.identity ?? BASEHALF_EXACT_UPSTREAM_IDENTITY;
	const keys: { firstLine: number; lastLine: number }[] = [];
	const entries: string[] = [];
	const seen = new Set<string>();
	root.properties.forEach((property, index) => {
		if (property.key.value !== 'upstream') {
			return;
		}
		const firstLine = lines.lineOf(regionStart + property.key.startOffset);
		// The key's lines run to the line before the next key, without the
		// blank and comment lines that lead up to that key.
		const next = root.properties[index + 1];
		let lastLine = next
			? lines.lineOf(regionStart + next.key.startOffset) - 1
			: lines.lineOf(Math.max(regionStart, regionEnd - 1));
		while (lastLine > firstLine && /^[ \t]*(?:#.*)?$/.test(text.slice(lines.start(lastLine), lines.contentEnd(lastLine)))) {
			lastLine--;
		}
		keys.push({ firstLine, lastLine });
		for (const item of baseHalfAnalyzeUpstreamItems(readableUpstreamValues(text, lines, regionStart, region, property), options.nodePath, identity)) {
			if (item.path === undefined) {
				continue;
			}
			const key = identity.key(item.path);
			if (!seen.has(key)) {
				seen.add(key);
				entries.push(item.path);
			}
		}
	});
	return { keys, entries };
}

function rebuiltListLines(entries: readonly string[], eol: string): string {
	return entries.length === 0 ? '' : ['upstream:', ...entries.map(entry => `  - ${baseHalfFormatUpstreamEntry(entry)}`)].map(line => line + eol).join('');
}

/** The text of a sidecar `upstream.yaml` that lists `entries`. */
export function baseHalfSidecarUpstreamText(entries: readonly string[]): string {
	return rebuiltListLines(entries, '\n');
}

/** **Rebuild List** for a Markdown document (reference graph, "Rebuilding a list"). */
function planMarkdownRebuild(
	text: string,
	lines: LineIndex,
	layout: IMarkdownLayout,
	read: IBaseHalfUpstreamStoreRead,
	options: IBaseHalfUpstreamPlanOptions
): BaseHalfUpstreamTextPlan {
	if (read.readable && read.writable) {
		return { kind: 'noop' };
	}
	if (layout.kind !== 'recognized' && layout.kind !== 'duplicateKey') {
		// TOML, a rejected block, or one beyond the window: not a document BaseHalf edits.
		return { kind: 'refused', reason: read.problem ?? 'frontmatterRejected' };
	}
	const located = locateUpstreamKeys(text, lines, layout.contentStart, layout.contentEnd, options);
	if (!located) {
		return { kind: 'refused', reason: 'mappingNotBlock' };
	}
	if (located.keys.length === 0) {
		return { kind: 'noop' };
	}
	const eol = detectEol(text, options.defaultEol);
	const [first, ...others] = located.keys;
	const edits: IRawEdit[] = [
		{ start: lines.start(first.firstLine), end: lines.end(first.lastLine), text: rebuiltListLines(located.entries, eol) },
		...others.map(key => deleteLines(lines, key.firstLine, key.lastLine))
	];
	const remainderOf = (after: string) => after.slice(layout.contentStart, layout.contentEnd - (text.length - after.length));
	const remainder = remainderOf(applyEdits(text, edits));
	if (remainder.trim() === '') {
		return editPlan(text, [{ start: layout.bomLength, end: layout.blockEnd, text: '' }]);
	}
	if (isBaseHalfMarkdownFrontmatterMapping(remainder)) {
		return editPlan(text, edits);
	}
	// Removing the key would leave something the recognizer rejects, such as
	// only comments or a leading blank line: keep an empty key in its place, as
	// removing the last entry does.
	const kept: IRawEdit[] = located.entries.length === 0
		? [{ ...edits[0], text: `upstream: []${eol}` }, ...edits.slice(1)]
		: edits;
	// The block may hold another repeated key and stay unrecognized, as it
	// was before. Its list is then one key that reads, which a later Rebuild
	// List carries into the note's sidecar.
	return isBaseHalfMarkdownFrontmatterMapping(remainderOf(applyEdits(text, kept)), { allowDuplicateKeys: true })
		? editPlan(text, kept)
		: { kind: 'refused', reason: 'frontmatterRejected' };
}

/** **Rebuild List** for a sidecar: the valid entries it holds, or no file at all. */
function planSidecarRebuild(
	text: string | undefined,
	read: IBaseHalfUpstreamStoreRead,
	options: IBaseHalfUpstreamPlanOptions
): BaseHalfUpstreamTextPlan {
	if (text === undefined || (read.readable && read.writable)) {
		return { kind: 'noop' };
	}
	// A list BaseHalf reads but will not edit in place (a flow mapping, a
	// BOM, indented keys) keeps every entry it reads. One it cannot read keeps
	// the entries of the keys that still read.
	const entries = read.readable
		? read.items.flatMap(item => item.path === undefined ? [] : [item.path])
		: baseHalfReadableSidecarUpstreamEntries(text, options);
	if (entries.length === 0) {
		return { kind: 'delete' };
	}
	return editPlan(text, [{ start: 0, end: text.length, text: rebuiltListLines(entries, detectEol(text, options.defaultEol)) }]);
}

/**
 * The valid entries BaseHalf can read from a sidecar's text, once each and in
 * order, when the file as a whole cannot be read as a list.
 */
export function baseHalfReadableSidecarUpstreamEntries(text: string, options: IBaseHalfUpstreamReadOptions = {}): readonly string[] {
	return readableSidecarEntries(text, options);
}

/**
 * Plans the minimal text edit of a Markdown document's `upstream` key. The
 * text is the complete document (a text model value, or bytes with a BOM).
 */
export function planBaseHalfMarkdownUpstreamEdit(
	text: string,
	operation: BaseHalfUpstreamListOperation,
	options: IBaseHalfUpstreamPlanOptions = {}
): BaseHalfUpstreamTextPlan {
	const identity = options.identity ?? BASEHALF_EXACT_UPSTREAM_IDENTITY;
	const read = readBaseHalfMarkdownUpstream(text, options);
	const layout = layoutMarkdown(text);
	const lines = new LineIndex(text);
	if (operation.kind === 'rebuild') {
		return planMarkdownRebuild(text, lines, layout, read, options);
	}
	const region = layout.kind === 'recognized' ? analyzeYamlRegion(text, lines, layout.contentStart, layout.contentEnd, false) : undefined;
	const refusal = refusedByRead(read);
	if (refusal) {
		// A foreign or not-writable store may still accept a no-op.
		const target = computeTarget(read.items, operation, identity);
		return target.kind === 'noop' && read.readable ? target : refusal;
	}
	const target = computeTarget(read.items, operation, identity);
	if (target.kind !== 'target') {
		return target;
	}
	const eol = detectEol(text, options.defaultEol);
	const values = target.target.map(item => item.kind === 'keep' ? read.items[item.index] : item.value);
	if (layout.kind === 'none') {
		if (values.length === 0) {
			return { kind: 'noop' };
		}
		const block = ['---', 'upstream:', ...values.map(value => `  - ${formatItem(value)}`), '---'].map(line => line + eol).join('');
		return editPlan(text, [{ start: layout.bomLength, end: layout.bomLength, text: block }], true);
	}
	const upstream = region?.upstream;
	if (!upstream) {
		if (values.length === 0) {
			return { kind: 'noop' };
		}
		if (!region?.columnZero) {
			return { kind: 'refused', reason: 'mappingNotBlock' };
		}
		const insertion = ['upstream:', ...values.map(value => `  - ${formatItem(value)}`)].map(line => line + eol).join('');
		// `contentEnd` is the line break before the closing fence.
		const at = lines.start(lines.lineOf(layout.contentEnd) + 1);
		return editPlan(text, [{ start: at, end: at, text: insertion }]);
	}
	return planExistingKey({
		text,
		lines,
		regionStart: layout.contentStart,
		regionEnd: layout.contentEnd,
		eol,
		upstream,
		remainderAccepted: remainder => isBaseHalfMarkdownFrontmatterMapping(remainder),
		removeWhole: () => editPlan(text, [{ start: layout.bomLength, end: layout.blockEnd, text: '' }])
	}, target.target);
}

/**
 * Plans the change of a sidecar `upstream.yaml`. `undefined` text means the
 * file does not exist yet. A `delete` plan means the file should be removed.
 */
export function planBaseHalfSidecarUpstreamEdit(
	text: string | undefined,
	operation: BaseHalfUpstreamListOperation,
	options: IBaseHalfUpstreamPlanOptions = {}
): BaseHalfUpstreamTextPlan {
	const identity = options.identity ?? BASEHALF_EXACT_UPSTREAM_IDENTITY;
	const read = readBaseHalfSidecarUpstream(text, options);
	if (operation.kind === 'rebuild') {
		return planSidecarRebuild(text, read, options);
	}
	const refusal = refusedByRead(read);
	const target = computeTarget(read.items, operation, identity);
	if (refusal) {
		return target.kind === 'noop' && read.readable ? target : refusal;
	}
	if (target.kind !== 'target') {
		return target;
	}
	const current = text ?? '';
	const eol = detectEol(current, options.defaultEol);
	const values = target.target.map(item => item.kind === 'keep' ? read.items[item.index] : item.value);
	const bomLength = current.charCodeAt(0) === 0xFEFF ? 1 : 0;
	const lines = new LineIndex(current);
	const region = analyzeYamlRegion(current, lines, bomLength, current.length, true);
	const upstream = region.upstream;
	if (!upstream) {
		if (values.length === 0) {
			return { kind: 'noop' };
		}
		const insertion = ['upstream:', ...values.map(value => `  - ${formatItem(value)}`)].map(line => line + eol).join('');
		if (current.slice(bomLength).trim() === '') {
			return editPlan(current, [{ start: bomLength, end: current.length, text: insertion }]);
		}
		const separator = /(?:\r\n|\n|\r)$/.test(current) ? '' : eol;
		return editPlan(current, [{ start: current.length, end: current.length, text: separator + insertion }]);
	}
	return planExistingKey({
		text: current,
		lines,
		regionStart: bomLength,
		regionEnd: current.length,
		eol,
		upstream,
		remainderAccepted: remainder => isYamlFileMapping(remainder, false),
		removeWhole: () => ({ kind: 'delete' })
	}, target.target);
}

//#endregion

//#region Plugin guard

/**
 * The upstream state the plugin guard compares: either unreadable, or the
 * ordered list of raw entry strings, valid and invalid.
 */
export type BaseHalfUpstreamRawState =
	| { readonly readable: false }
	| { readonly readable: true; readonly entries: readonly string[] };

/**
 * Reads the upstream state of a project file's text with the index reader
 * (the lenient extractor for `.bhnode`). `undefined` text means the file is
 * absent, which reads as an empty list. Returns `undefined` for files that
 * are not Markdown or `.bhnode` stores.
 */
export function readBaseHalfUpstreamRawState(relativePath: string, text: string | undefined): BaseHalfUpstreamRawState | undefined {
	const storeKind = baseHalfUpstreamStoreKind(relativePath, false);
	if (storeKind === 'sidecar') {
		return undefined;
	}
	if (text === undefined) {
		return { readable: true, entries: [] };
	}
	if (storeKind === 'markdown') {
		const read = readBaseHalfMarkdownUpstream(text);
		return read.readable ? { readable: true, entries: read.items.map(item => item.text) } : { readable: false };
	}
	const extract = extractBaseHalfNodeUpstreamLenient(text);
	return extract.readable ? { readable: true, entries: baseHalfNodeUpstreamItemValues(extract.upstream).map(item => item.text) } : { readable: false };
}

/**
 * Whether a reviewed plugin's transition of a project file from `expected`
 * to `next` text changes an upstream value, including a change between
 * readable and unreadable. Host-originated operations are exempt from the
 * guard and do not call this.
 */
export function baseHalfTransitionChangesUpstream(relativePath: string, expected: string | undefined, next: string | undefined): boolean {
	const before = readBaseHalfUpstreamRawState(relativePath, expected);
	const after = readBaseHalfUpstreamRawState(relativePath, next);
	if (!before || !after) {
		return false;
	}
	if (!before.readable || !after.readable) {
		return before.readable !== after.readable;
	}
	return before.entries.length !== after.entries.length || before.entries.some((entry, index) => entry !== after.entries[index]);
}

//#endregion
