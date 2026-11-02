/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { lexer, type Token, type Tokens } from '../../../../base/common/marked/marked.js';
import { parse as parseYaml, type YamlParseError } from '../../../../base/common/yaml.js';
import { diffBaseHalfMarkdownSegments, groupBaseHalfMarkdownContributions } from './basehalfMarkdownMerge.js';
import {
	baseHalfNoteBlockChildren,
	baseHalfNoteBlockId,
	baseHalfNoteBlockProps,
	baseHalfNoteBlockType,
	baseHalfNoteKindOf,
	baseHalfNoteStringProp,
	IBaseHalfNoteBlock,
	IBaseHalfNoteBlockKind,
	IBaseHalfNoteListHint,
	isBaseHalfNoteListItemType,
	isBaseHalfNoteRecord,
	isBaseHalfNoteToggle,
	sameBaseHalfNoteBlockKind
} from './basehalfNoteBlocks.js';
import { baseHalfCardLexer, IBaseHalfNoteLinkDefinition } from './basehalfNoteInline.js';
import { baseHalfMarkdownShowsSame } from './basehalfNoteShown.js';
import { stripBaseHalfNoteReadHints } from './basehalfNoteStructure.js';
import {
	baseHalfNoteBlockKind,
	baseHalfNoteFollowingListItem,
	baseHalfNoteRequiredLineBreaks,
	IBaseHalfNotePreviousListItem,
	IBaseHalfNoteWriteHints,
	writeBaseHalfToggleHeader
} from './basehalfNoteWriter.js';

export const BASEHALF_RAW_PASSTHROUGH_BLOCK = 'rawPassthrough';

let nextGroupSequence = 1;
let nextFixedBlockSequence = 1;

export interface IBaseHalfMarkdownSegment {
	readonly source: string;
	readonly raw: string;
	readonly prefix: string;
	readonly sep: string;
	/**
	 * The place of the segment's first block of the file among the note's
	 * blocks of the file, in order (default 0), and how many it spans
	 * (default 1): a toggle spans its first lines, its blocks, and its last
	 * line.
	 */
	readonly unit?: number;
	readonly units?: number;
	/**
	 * A `<details>` whose parts are blocks of their own (note formats, rule
	 * 41): its first lines, its blocks, and its last line, which tile `raw`.
	 */
	readonly toggle?: {
		readonly header: IBaseHalfMarkdownSegment;
		readonly children: readonly IBaseHalfMarkdownSegment[];
		readonly footer: IBaseHalfMarkdownSegment;
	};
}

/** What Rich's reader needs to read a part of a note as the whole note reads it. */
export interface IBaseHalfNoteReadContext {
	/** The note's reference definitions, by label as `marked` keys them. */
	readonly definitions: Readonly<Record<string, IBaseHalfNoteLinkDefinition>>;
}

/**
 * Rich's reader and writer, which the projection reaches through the editor
 * (note formats, design 4.2). The webview reads with the page, and caches the
 * writer and backs it up; tests pass the pure modules.
 */
export interface IBaseHalfMarkdownEditorApi {
	/**
	 * The blocks of a part of a note as Rich reads it (note formats, rule 25),
	 * each with an id: toggles with `basehalfOpen` and list items with
	 * `basehalfHints`, from the reader's block pass.
	 */
	tryParseMarkdownToBlocks(markdown: string, context: IBaseHalfNoteReadContext): Promise<unknown[]> | unknown[];
	/**
	 * A block as the note stores it: `writeBaseHalfNoteBlock`. With `strict`,
	 * a block the writer cannot write throws, which makes its part of the note
	 * a fixed block at a load; without, the editor writes what it can of it
	 * instead, as a save does (design A5).
	 */
	writeBlock(block: unknown, hints: IBaseHalfNoteWriteHints, strict?: boolean): string;
	/** Decodes character references once, as a page does. */
	decodeCharacterReferences(text: string): string;
	/** A new id for a fixed block. Default: one of the projection's own. */
	newBlockId?(): string;
}

/**
 * What the projection keeps of a note from its load to the saves after it:
 * what each part of the note needs of the whole note.
 */
export interface IBaseHalfMarkdownNote {
	/** The note's line ending: CRLF when the file's first line break is CRLF (note formats, rule 24). */
	readonly eol: '\n' | '\r\n';
	/** The note's reference definitions, by label as `marked` keys them. */
	readonly definitions: Readonly<Record<string, IBaseHalfNoteLinkDefinition>>;
	readonly referenceLabels: ReadonlySet<string>;
	/** The ids of the toggles the file stores open (rule 40). */
	readonly open: Set<string>;
	/** What the file wrote of each list item, by id (rule 19). */
	readonly listHints: Map<string, IBaseHalfNoteListHint>;
}

/**
 * Where a block stood when the note was read (design C12): its container, the
 * blocks of the file it stood for, and its kind then. The blocks of one
 * segment share its slot.
 */
export interface IBaseHalfMarkdownSlot {
	/** `''` for the note itself, else the id of the toggle that holds it. */
	readonly container: string;
	/** The place of its first block of the file among the note's, and of its last. */
	readonly first: number;
	readonly last: number;
	/** The kind of the slot's first block, and of its last. */
	readonly kind: IBaseHalfNoteBlockKind;
	readonly endKind: IBaseHalfNoteBlockKind;
	/** Whether the note ended with it. */
	readonly end: boolean;
}

export interface IBaseHalfMarkdownReuseEntry {
	/** What the writer wrote of the block when the note was read; for a toggle in parts, of its first lines. */
	readonly key: string;
	readonly raw: string;
	readonly prefix: string;
	readonly sep: string;
	readonly multi?: boolean;
	/** Identifies the block group a multi-block segment projected into. */
	readonly group?: string;
	/** Number of blocks the segment projected into. */
	readonly groupSize?: number;
	/** What the writer wrote of this block alone, for per-block change detection. */
	readonly blockKey?: string;
	/** A fixed block, which stands for `raw` while it keeps its slot. */
	readonly fixed?: boolean;
	readonly slot?: IBaseHalfMarkdownSlot;
	/**
	 * A toggle whose parts are blocks of their own (rule 41): its first lines,
	 * and its last line. Its blocks have entries of their own.
	 */
	readonly toggle?: {
		readonly header: { readonly key: string; readonly raw: string; readonly prefix: string; readonly sep: string; readonly unit: number };
		readonly footer: { readonly source: string; readonly unit: number };
	};
}

export interface IBaseHalfMarkdownLoadProjection {
	readonly blocks: unknown[];
	readonly byId: Map<string, IBaseHalfMarkdownReuseEntry>;
	readonly note: IBaseHalfMarkdownNote;
}

interface IBaseHalfMarkdownUnit {
	readonly start: number;
	readonly end: number;
	/** What `marked` read as a block of HTML. */
	readonly html?: boolean;
}

export function splitBaseHalfMarkdownFrontmatter(content: string): { frontmatter: string; body: string } {
	if (!/^---[ \t]*\r?\n/.test(content)) {
		return { frontmatter: '', body: content };
	}

	const openLineEnd = content.indexOf('\n');
	const close = /\r?\n---[ \t]*(?:\r?\n|$)/g;
	close.lastIndex = openLineEnd;
	const match = close.exec(content);
	if (!match) {
		return { frontmatter: '', body: content };
	}

	// A pair of thematic breaks must not hide the Markdown between them. Limit
	// frontmatter recognition to the shape of a top-level YAML mapping.
	const candidate = content.slice(openLineEnd + 1, match.index);
	if (!isBaseHalfMarkdownFrontmatterMapping(candidate)) {
		return { frontmatter: '', body: content };
	}

	const end = match.index + match[0].length;
	return { frontmatter: content.slice(0, end), body: content.slice(end) };
}

/**
 * The number of lines the recognized frontmatter block occupies (its fences
 * included), `0` when the document has none. Body line 1 is the file line
 * after them. A leading BOM is ignored.
 */
export function baseHalfMarkdownFrontmatterLineCount(content: string): number {
	const { frontmatter } = splitBaseHalfMarkdownFrontmatter(content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content);
	let count = 0;
	for (let index = 0; index < frontmatter.length; index++) {
		if (frontmatter.charCodeAt(index) === 10) {
			count++;
		}
	}
	return count;
}

export interface IBaseHalfMarkdownFrontmatterMappingOptions {
	/** Accept a repeated mapping key. The projection recognizer never does; the
	 * upstream store reader uses it only to classify a duplicated `upstream`
	 * key as an unreadable store instead of a rejected block. */
	readonly allowDuplicateKeys?: boolean;
}

/**
 * The BaseHalf frontmatter recognizer: the text between the leading `---`
 * fences is frontmatter when it is a YAML block mapping. A mapping key whose
 * value is empty (YAML `missing-value` at a mapping colon) is accepted, so an
 * `upstream:` left behind by a person or an agent never turns the whole block
 * into body text.
 */
export function isBaseHalfMarkdownFrontmatterMapping(candidate: string, options?: IBaseHalfMarkdownFrontmatterMappingOptions): boolean {
	const firstLineEnd = candidate.search(/\r|\n/);
	const firstLine = firstLineEnd >= 0 ? candidate.slice(0, firstLineEnd) : candidate;
	if (firstLine.trim() === '') {
		return false;
	}
	const errors: YamlParseError[] = [];
	const node = parseYaml(candidate, errors, { allowDuplicateKeys: options?.allowDuplicateKeys });
	return errors.every(error => isUnsupportedYamlAnchorIndent(candidate, error) || isMappingMissingValue(candidate, error))
		&& node?.type === 'map'
		&& yamlTriviaOnly(candidate.slice(0, node.startOffset))
		&& yamlTriviaOnly(candidate.slice(node.endOffset));
}

/** `missing-value` is reported both at a mapping colon (`key:`) and at a
 * sequence dash (`-`). Only the mapping form is an empty value. */
function isMappingMissingValue(candidate: string, error: YamlParseError): boolean {
	return error.code === 'missing-value' && candidate.charAt(error.startOffset) === ':';
}

function isUnsupportedYamlAnchorIndent(candidate: string, error: YamlParseError): boolean {
	if (error.code !== 'unexpected-indentation') {
		return false;
	}
	const lines = candidate.slice(0, error.startOffset).split(/\r\n?|\n/);
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
		lines.pop();
	}
	const previousLine = lines.at(-1)?.trimEnd() ?? '';
	return /:\s*&[A-Za-z0-9_-]+(?:\s+#.*)?$/.test(previousLine);
}

/** The shared YAML parser intentionally leaves comments and blank lines outside
 * the root node's offsets. Require every otherwise-unconsumed byte to be YAML
 * trivia so a valid mapping followed by ordinary prose cannot masquerade as
 * frontmatter. */
function yamlTriviaOnly(value: string): boolean {
	return value.split(/\r\n?|\n/).every(line => line.trim() === '' || /^[ \t]*#/.test(line));
}

export function joinBaseHalfMarkdownFrontmatter(frontmatter: string, body: string): string {
	return frontmatter + body;
}

/**
 * Tiles a Markdown body at block boundaries while preserving every source
 * byte, as Rich projects it: each item of a top-level list on its own, and a
 * `<details>` whose parts are blocks of their own as one segment of them.
 */
export function segmentBaseHalfMarkdownBody(body: string): IBaseHalfMarkdownSegment[] {
	return segmentBaseHalfMarkdownBodyWithListMode(body, true, true);
}

/**
 * Tiles a Markdown body at top-level block boundaries while preserving every
 * source byte. Unlike {@link segmentBaseHalfMarkdownBody}, a top-level list is
 * kept as one segment instead of being split into one segment per list item.
 */
export function segmentBaseHalfMarkdownTopLevelBody(body: string): IBaseHalfMarkdownSegment[] {
	return segmentBaseHalfMarkdownBodyWithListMode(body, false, false);
}

function segmentBaseHalfMarkdownBodyWithListMode(body: string, splitListItems: boolean, groupToggles: boolean): IBaseHalfMarkdownSegment[] {
	if (body === '') {
		return [];
	}

	const units = collectUnits(body, splitListItems);
	if (units.length === 0) {
		return [{ source: body, raw: body, prefix: '', sep: '' }];
	}

	const items = groupToggles ? groupBaseHalfMarkdownUnits(body, units) : units.map(unit => ({ kind: 'unit', unit } as const));
	return segmentsOfItems(body, items, 0, body.length, 0);
}

/**
 * The segments of `items`, whose tiles run from `from`, the first item's
 * tile, to `to`, the last item's end; `unit` is the place of the first item's
 * first unit among the note's.
 */
function segmentsOfItems(body: string, items: readonly BaseHalfMarkdownUnitItem[], from: number, to: number, unit: number): IBaseHalfMarkdownSegment[] {
	const startOf = (item: BaseHalfMarkdownUnitItem) => item.kind === 'unit' ? item.unit.start : item.group.header.start;
	let next = unit;
	return items.map((item, index) => {
		const first = next;
		const start = startOf(item);
		const end = item.kind === 'unit' ? item.unit.end : item.group.footer.end;
		const tileStart = index === 0 ? from : start;
		const tileEnd = index + 1 < items.length ? startOf(items[index + 1]) : to;
		const segment = {
			source: body.slice(start, end),
			raw: body.slice(tileStart, tileEnd),
			prefix: body.slice(tileStart, start),
			sep: body.slice(end, tileEnd),
			unit: first
		};
		if (item.kind === 'unit') {
			next = first + 1;
			return { ...segment, units: 1 };
		}
		const { header, children, footer } = item.group;
		const childrenStart = children.length > 0 ? startOf(children[0]) : footer.start;
		const childSegments = segmentsOfItems(body, children, childrenStart, footer.start, first + 1);
		const footerUnit = first + 1 + childSegments.reduce((count, child) => count + (child.units ?? 1), 0);
		next = footerUnit + 1;
		return {
			...segment,
			units: next - first,
			toggle: {
				header: { source: body.slice(header.start, header.end), raw: body.slice(tileStart, childrenStart), prefix: body.slice(tileStart, header.start), sep: body.slice(header.end, childrenStart), unit: first, units: 1 },
				children: childSegments,
				footer: { source: body.slice(footer.start, footer.end), raw: body.slice(footer.start, tileEnd), prefix: '', sep: body.slice(footer.end, tileEnd), unit: footerUnit, units: 1 }
			}
		};
	});
}

/** How many of the note's blocks of the file `segments` span. */
function unitsOf(segments: readonly IBaseHalfMarkdownSegment[]): number {
	return segments.reduce((count, segment) => count + (segment.units ?? 1), 0);
}

// --- Rich's projection of a note (note formats, rules 25 to 37, 67, and 68)

/**
 * A note's own context at its load: its line ending, from `content`, the
 * whole file, and its reference definitions, from `body`.
 */
export function createBaseHalfMarkdownNote(body: string, content: string = body): IBaseHalfMarkdownNote {
	const lineFeed = content.indexOf('\n');
	const definitions = baseHalfMarkdownDefinitions(body);
	return {
		eol: lineFeed > 0 && content.charCodeAt(lineFeed - 1) === 13 ? '\r\n' : '\n',
		definitions,
		referenceLabels: new Set(Object.keys(definitions)),
		open: new Set(),
		listHints: new Map()
	};
}

/** The reference definitions of a note's body, by label as `marked` keys them. */
export function baseHalfMarkdownDefinitions(body: string): Record<string, IBaseHalfNoteLinkDefinition> {
	const definitions: Record<string, IBaseHalfNoteLinkDefinition> = {};
	try {
		const cardLexer = baseHalfCardLexer();
		cardLexer.lex(body);
		for (const [label, definition] of Object.entries(cardLexer.tokens.links)) {
			definitions[label] = { href: definition.href, title: definition.title };
		}
	} catch {
		// A body the card's reader cannot read has no definitions to read a part of it by.
	}
	return definitions;
}

/** Where a segment stands in the note. */
export interface IBaseHalfMarkdownSegmentPlace {
	/** `''` for the note itself, else the id of the toggle that holds it. */
	readonly container: string;
	/** The place of its first block of the file among the note's, and of its last. */
	readonly first: number;
	readonly last: number;
	/** Whether the note ends with it. */
	readonly end: boolean;
}

function placeOf(segment: IBaseHalfMarkdownSegment, container: string, units: number): IBaseHalfMarkdownSegmentPlace {
	const first = segment.unit ?? 0;
	const last = first + (segment.units ?? 1) - 1;
	return { container, first, last, end: last === units - 1 };
}

export interface IBaseHalfMarkdownSegmentProjection {
	/** The blocks for the editor, without what the reader learned of the file, which the note keeps. */
	readonly blocks: unknown[];
	readonly entries: ReadonlyArray<readonly [string, IBaseHalfMarkdownReuseEntry]>;
}

/**
 * Rich's blocks of one segment (note formats, rules 34 to 36), as if it were
 * alone in the note: what Rich reads of it when, written back, it shows the
 * same on the card, else one fixed block of its bytes. What the reader
 * learned of the file's toggles and list items goes into `note`.
 */
export async function projectBaseHalfMarkdownSegment(
	editor: IBaseHalfMarkdownEditorApi,
	segment: IBaseHalfMarkdownSegment,
	note: IBaseHalfMarkdownNote
): Promise<IBaseHalfMarkdownSegmentProjection> {
	const units = (segment.unit ?? 0) + (segment.units ?? 1);
	const projected = await projectSegments(editor, [{ segment, place: placeOf(segment, '', units) }], note, units);
	const { blocks, written } = writeProjected(editor, projected, note);
	return { blocks, entries: entriesOf(editor, projected, written, note) };
}

export async function buildBaseHalfMarkdownLoadProjection(
	editor: IBaseHalfMarkdownEditorApi,
	body: string,
	content: string = body
): Promise<IBaseHalfMarkdownLoadProjection> {
	const note = createBaseHalfMarkdownNote(body, content);
	const segments = segmentBaseHalfMarkdownBody(body);
	const units = unitsOf(segments);
	const projected = await projectSegments(editor, segments.map(segment => ({ segment, place: placeOf(segment, '', units) })), note, units);
	// Each key is what the writer writes of its block where it stands, as a
	// save writes it: a list item without a hint takes its marker from the
	// item before it.
	const { blocks, written } = writeProjected(editor, projected, note);
	const byId = new Map(entriesOf(editor, projected, written, note));

	if (!blocks.some(block => baseHalfNoteBlockType(block) !== BASEHALF_RAW_PASSTHROUGH_BLOCK)) {
		blocks.push({ type: 'paragraph' });
	}

	return { blocks, byId, note };
}

interface IProjectedSegment {
	readonly segment: IBaseHalfMarkdownSegment;
	readonly place: IBaseHalfMarkdownSegmentPlace;
	readonly blocks: readonly unknown[];
	readonly fixed: boolean;
	/** A toggle whose parts are blocks of their own: what the writer writes of its first lines, and its blocks, projected in it. */
	readonly toggle?: { readonly headerKey: string; readonly children: IProjectedSegment[] };
}

async function projectSegments(
	editor: IBaseHalfMarkdownEditorApi,
	segments: readonly { readonly segment: IBaseHalfMarkdownSegment; readonly place: IBaseHalfMarkdownSegmentPlace }[],
	note: IBaseHalfMarkdownNote,
	units: number
): Promise<IProjectedSegment[]> {
	const projected: IProjectedSegment[] = [];
	for (const { segment, place } of segments) {
		if (segment.toggle) {
			const toggle = await projectToggle(editor, segment, place, note, units);
			if (toggle) {
				projected.push(toggle);
				continue;
			}
			// Read as its parts, as before (rule 42): its first lines, its
			// blocks, and its last line, each at this level.
			const { header, children, footer } = segment.toggle;
			projected.push(...await projectSegments(editor, [header, ...children, footer].map(part => ({ segment: part, place: placeOf(part, place.container, units) })), note, units));
			continue;
		}
		const read = await readSegment(editor, segment, note);
		projected.push(read
			? { segment, place, blocks: takeReadHints(read, note), fixed: false }
			: { segment, place, blocks: [fixedBlock(editor, segment)], fixed: true });
	}
	return projected;
}

// One `<details>` or `<details open>` and one `<summary>`, and nothing else (rule 41).
const toggleHeaderForm = /^ {0,3}<details(?:[ \t\r\n]+open)?[ \t\r\n]*>[ \t\r\n]*<summary>(?:(?!<\/?(?:summary|details)\b)[\s\S])*<\/summary>\s*$/i;
const toggleFooterForm = /^\s*<\/details\s*>\s*$/i;

/**
 * A `<details>` whose parts are blocks of their own as one toggle (rule 41):
 * when its first lines alone read as one toggle without children that Rich
 * writes back showing the same, and its last line is `</details>`. Each of
 * its blocks is projected in it as in the note. Else nothing.
 */
async function projectToggle(
	editor: IBaseHalfMarkdownEditorApi,
	segment: IBaseHalfMarkdownSegment,
	place: IBaseHalfMarkdownSegmentPlace,
	note: IBaseHalfMarkdownNote,
	units: number
): Promise<IProjectedSegment | undefined> {
	const { header, children, footer } = segment.toggle!;
	if (!toggleHeaderForm.test(header.source) || !toggleFooterForm.test(footer.source)) {
		return undefined;
	}
	let title: IBaseHalfNoteBlock;
	let headerKey: string;
	try {
		const read = (await editor.tryParseMarkdownToBlocks(header.source, note)).filter(isBaseHalfNoteRecord) as unknown as IBaseHalfNoteBlock[];
		if (read.length !== 1 || !isBaseHalfNoteToggle(read[0]) || baseHalfNoteBlockChildren(read[0]).length > 0) {
			return undefined;
		}
		title = read[0];
		headerKey = writeBaseHalfToggleHeader(title, noteWriteHints(note));
		if (!baseHalfMarkdownShowsSame(header.source, headerKey, { definitions: note.definitions, decodeCharacterReferences: text => editor.decodeCharacterReferences(text) })) {
			return undefined;
		}
	} catch {
		return undefined;
	}
	const id = baseHalfNoteBlockId(title);
	if (id === undefined) {
		return undefined;
	}
	const projectedChildren = await projectSegments(editor, children.map(child => ({ segment: child, place: placeOf(child, id, units) })), note, units);
	const [toggleBlock] = takeReadHints([title], note);
	return {
		segment,
		place,
		blocks: [{ ...(toggleBlock as object), children: projectedChildren.flatMap(one => one.blocks) }],
		fixed: false,
		toggle: { headerKey, children: projectedChildren }
	};
}

/**
 * What Rich reads of a segment when, written back, it shows the same on the
 * card and keeps every element, attribute, comment, and title the file has
 * (rule 34); else nothing. A read, a write, or a comparison that throws
 * gives nothing too (design A5).
 */
async function readSegment(editor: IBaseHalfMarkdownEditorApi, segment: IBaseHalfMarkdownSegment, note: IBaseHalfMarkdownNote): Promise<IBaseHalfNoteBlock[] | undefined> {
	let blocks: IBaseHalfNoteBlock[];
	try {
		blocks = (await editor.tryParseMarkdownToBlocks(segment.source, note)).filter(isBaseHalfNoteRecord) as unknown as IBaseHalfNoteBlock[];
	} catch {
		return undefined;
	}
	if (isDropped(blocks)) {
		return undefined;
	}
	try {
		// The guard reads what a save would write: the same writer, in the same order.
		const written = writtenTogether(writeContainerBlocks(editor, blocks, note, true), note);
		return written !== undefined && written !== '' && baseHalfMarkdownShowsSame(segment.source, written, {
			definitions: note.definitions,
			decodeCharacterReferences: text => editor.decodeCharacterReferences(text)
		}) ? blocks : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Moves what the reader learned of the file's toggles and list items from the
 * blocks into the note, and returns the blocks without it: the editor's
 * schema holds none of it.
 */
function takeReadHints(blocks: readonly IBaseHalfNoteBlock[], note: IBaseHalfMarkdownNote): unknown[] {
	const visit = (list: readonly unknown[]) => {
		for (const block of list) {
			if (!isBaseHalfNoteRecord(block)) {
				continue;
			}
			const id = baseHalfNoteBlockId(block);
			if (id !== undefined) {
				if (block.basehalfOpen === true) {
					note.open.add(id);
				}
				const hint = block.basehalfHints;
				if (isBaseHalfNoteRecord(hint) && typeof hint.marker === 'string') {
					note.listHints.set(id, hint as unknown as IBaseHalfNoteListHint);
				}
			}
			visit(baseHalfNoteBlockChildren(block));
		}
	};
	visit(blocks);
	return stripBaseHalfNoteReadHints(blocks);
}

function fixedBlock(editor: IBaseHalfMarkdownEditorApi, segment: IBaseHalfMarkdownSegment): unknown {
	return {
		id: editor.newBlockId?.() ?? `basehalf-fixed-${nextFixedBlockSequence++}`,
		type: BASEHALF_RAW_PASSTHROUGH_BLOCK,
		props: { raw: segment.raw, source: segment.source, hidden: isOwnMarker(segment.source) }
	};
}

/** The ids of the toggles of projected segments that hold their parts. */
function groupedIdsOf(projected: readonly IProjectedSegment[]): Set<string> {
	const ids = new Set<string>();
	for (const one of projected) {
		const id = one.toggle ? baseHalfNoteBlockId(one.blocks[0]) : undefined;
		if (id !== undefined) {
			ids.add(id);
		}
	}
	return ids;
}

/**
 * The blocks of projected segments and what the writer writes of each where
 * it stands, `before` and `after` around them. A segment with a block the
 * writer cannot write becomes a fixed block of its bytes (design A5);
 * `projected` changes with it, the toggles' children first.
 */
function writeProjected(
	editor: IBaseHalfMarkdownEditorApi,
	projected: IProjectedSegment[],
	note: IBaseHalfMarkdownNote,
	before: readonly unknown[] = [],
	after: readonly unknown[] = [],
	grouped: (block: unknown) => boolean = () => false
): { blocks: unknown[]; written: IWrittenBlock[] } {
	projected.forEach((one, index) => {
		if (one.toggle) {
			const inner = writeProjected(editor, one.toggle.children, note);
			projected[index] = { ...one, blocks: [{ ...(one.blocks[0] as object), children: inner.blocks }] };
		}
	});
	for (let attempt = 0; ; attempt++) {
		const ids = groupedIdsOf(projected);
		const isGrouped = (block: unknown) => {
			const id = baseHalfNoteBlockId(block);
			return (id !== undefined && ids.has(id)) || grouped(block);
		};
		const blocks = projected.flatMap(one => one.blocks);
		const written = writeContainerBlocks(editor, [...before, ...blocks, ...after], note, true, isGrouped);
		let at = before.length;
		let failed = false;
		projected.forEach((one, index) => {
			if (written.slice(at, at + one.blocks.length).some(block => block.failed)) {
				projected[index] = { segment: one.segment, place: one.place, blocks: [fixedBlock(editor, one.segment)], fixed: true };
				failed = true;
			}
			at += one.blocks.length;
		});
		if (!failed) {
			return { blocks, written: written.slice(before.length, before.length + blocks.length) };
		}
		if (attempt > 0) {
			const settled = projected.flatMap(one => one.blocks);
			return { blocks: settled, written: writeContainerBlocks(editor, [...before, ...settled, ...after], note, true, isGrouped).slice(before.length, before.length + settled.length) };
		}
	}
}

/** The entries of projected segments, `written` holding what the writer writes of each of their blocks, in order. */
function entriesOf(
	editor: IBaseHalfMarkdownEditorApi,
	projected: readonly IProjectedSegment[],
	written: readonly IWrittenBlock[],
	note: IBaseHalfMarkdownNote
): Array<readonly [string, IBaseHalfMarkdownReuseEntry]> {
	const entries: Array<readonly [string, IBaseHalfMarkdownReuseEntry]> = [];
	let at = 0;
	for (const { segment, place, blocks, fixed, toggle } of projected) {
		const own = written.slice(at, at + blocks.length);
		at += blocks.length;
		if (own.length === 0) {
			continue;
		}
		const slot: IBaseHalfMarkdownSlot = { container: place.container, first: place.first, last: place.last, kind: own[0].kind, endKind: own[own.length - 1].kind, end: place.end };
		if (toggle && segment.toggle && own[0].id !== undefined) {
			const { header, footer } = segment.toggle;
			entries.push([own[0].id, {
				key: toggle.headerKey,
				raw: segment.raw,
				prefix: segment.prefix,
				sep: segment.sep,
				slot,
				toggle: {
					header: { key: toggle.headerKey, raw: header.raw, prefix: header.prefix, sep: header.sep, unit: header.unit ?? 0 },
					footer: { source: footer.source, unit: footer.unit ?? 0 }
				}
			}]);
			const childBlocks = toggle.children.flatMap(one => one.blocks);
			const ids = groupedIdsOf(toggle.children);
			entries.push(...entriesOf(editor, toggle.children, writeContainerBlocks(editor, childBlocks, note, true, block => ids.has(baseHalfNoteBlockId(block) ?? '')), note));
			continue;
		}
		if (own.length === 1) {
			const id = own[0].id;
			if (id !== undefined) {
				entries.push([id, { key: own[0].text, raw: segment.raw, prefix: segment.prefix, sep: segment.sep, ...(fixed ? { fixed: true } : {}), slot }]);
			}
			continue;
		}
		const group = `g${nextGroupSequence++}`;
		own.forEach((member, index) => {
			if (member.id === undefined) {
				return;
			}
			const shared = { multi: true, group, groupSize: own.length, blockKey: member.text, slot };
			entries.push([member.id, index === own.length - 1
				? { key: member.text, raw: segment.raw, prefix: segment.prefix, sep: segment.sep, ...shared }
				: { key: member.text, raw: '', prefix: '', sep: '', ...shared }]);
		});
	}
	return entries;
}

// --- Writing a container's blocks

/** The hints of the note for its writer: its line ending, its labels, and what the file wrote of toggles and list items. */
function noteWriteHints(note: IBaseHalfMarkdownNote): IBaseHalfNoteWriteHints {
	return {
		eol: note.eol,
		referenceLabels: note.referenceLabels,
		isOpen: block => block.basehalfOpen ?? (block.id !== undefined && note.open.has(block.id)),
		listHint: id => note.listHints.get(id)
	};
}

interface IWrittenBlock {
	readonly block: unknown;
	readonly id: string | undefined;
	readonly fixed: boolean;
	/**
	 * What the writer writes of the block, `''` for a fixed block, which
	 * stands for its own bytes; for a toggle in parts, its first lines.
	 */
	readonly text: string;
	readonly kind: IBaseHalfNoteBlockKind;
	/** The writer threw on the block. */
	readonly failed?: boolean;
	/** A toggle whose parts are blocks of their own, whose blocks are written in it. */
	readonly grouped?: boolean;
}

const fixedKind: IBaseHalfNoteBlockKind = Object.freeze({ type: BASEHALF_RAW_PASSTHROUGH_BLOCK });
const toggleEndKind: IBaseHalfNoteBlockKind = Object.freeze({ type: 'toggleEnd' });

/**
 * What the writer writes of each block of a container, in order: a list item
 * takes its marker and number from the item before it and the item after it
 * (rule 19). A toggle in parts stands here for its first lines.
 */
function writeContainerBlocks(
	editor: IBaseHalfMarkdownEditorApi,
	blocks: readonly unknown[],
	note: IBaseHalfMarkdownNote,
	strict = false,
	grouped: (block: unknown) => boolean = () => false
): IWrittenBlock[] {
	const base = noteWriteHints(note);
	let previousListItem: IBaseHalfNotePreviousListItem | undefined;
	return blocks.map((block, index) => {
		const id = baseHalfNoteBlockId(block);
		if (baseHalfNoteBlockType(block) === BASEHALF_RAW_PASSTHROUGH_BLOCK) {
			previousListItem = undefined;
			return { block, id, fixed: true, text: '', kind: fixedKind };
		}
		if (isBaseHalfNoteToggle(block) && grouped(block)) {
			previousListItem = undefined;
			try {
				return { block, id, fixed: false, text: writeBaseHalfToggleHeader(block, base), kind: baseHalfNoteKindOf(block, undefined), grouped: true };
			} catch {
				return { block, id, fixed: false, text: '', kind: baseHalfNoteKindOf(block, undefined), failed: true, grouped: true };
			}
		}
		const nextMarker = writtenListMarker(blocks[index + 1], note);
		const hints: IBaseHalfNoteWriteHints = { ...base, previousListItem, nextListItem: nextMarker === undefined ? undefined : { marker: nextMarker } };
		try {
			const text = editor.writeBlock(block, hints, strict);
			const kind = baseHalfNoteBlockKind(block, hints);
			if (text !== '') {
				previousListItem = baseHalfNoteFollowingListItem(block, hints);
			}
			return { block, id, fixed: false, text, kind };
		} catch {
			previousListItem = undefined;
			return { block, id, fixed: false, text: '', kind: { type: baseHalfNoteBlockType(block) }, failed: true };
		}
	});
}

/** Written blocks one after another, with the line breaks Markdown needs between them; none when one could not be written. */
function writtenTogether(written: readonly IWrittenBlock[], note: IBaseHalfMarkdownNote): string | undefined {
	let text = '';
	let before: IWrittenBlock | undefined;
	for (const one of written) {
		if (one.failed) {
			return undefined;
		}
		if (one.text === '') {
			continue;
		}
		if (before) {
			text += note.eol.repeat(baseHalfNoteRequiredLineBreaks(before, one));
		}
		text += one.text;
		before = one;
	}
	return text;
}

/** The marker the file wrote of `block`, when it is a list item the file wrote. */
function writtenListMarker(block: unknown, note: IBaseHalfMarkdownNote): string | undefined {
	if (!isBaseHalfNoteListItemType(baseHalfNoteBlockType(block))) {
		return undefined;
	}
	const id = baseHalfNoteBlockId(block);
	const hint: unknown = (id !== undefined ? note.listHints.get(id) : undefined) ?? (isBaseHalfNoteRecord(block) ? block.basehalfHints : undefined);
	return isBaseHalfNoteRecord(hint) && typeof hint.marker === 'string' ? hint.marker : undefined;
}

// --- Saving (design 4.3 and C12)

export interface IBaseHalfMarkdownSaveContribution {
	readonly id: string | undefined;
	readonly text: string;
	/**
	 * For a toggle whose parts are blocks of their own: what its first lines,
	 * each of its blocks, and its last line contribute, which tile `text`. The
	 * first lines carry the toggle's id, the last line none.
	 */
	readonly parts?: readonly IBaseHalfMarkdownSaveContribution[];
}

/**
 * The exact per-block text each document block contributes to a save. Their
 * concatenation is what {@link spliceBaseHalfMarkdownSave} writes as the body,
 * which makes this the alignment basis for incremental external merges: while
 * the editor is not dirty, these contributions reproduce the on-disk body
 * byte for byte.
 */
export async function collectBaseHalfMarkdownSaveContributions(
	editor: IBaseHalfMarkdownEditorApi,
	document: readonly unknown[],
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	note: IBaseHalfMarkdownNote = createBaseHalfMarkdownNote('')
): Promise<IBaseHalfMarkdownSaveContribution[]> {
	return collectContributions(editor, document, byId, note).map(savedContribution);
}

export async function spliceBaseHalfMarkdownSave(
	editor: IBaseHalfMarkdownEditorApi,
	document: readonly unknown[],
	frontmatter: string,
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	note: IBaseHalfMarkdownNote = createBaseHalfMarkdownNote('')
): Promise<string> {
	const out = collectContributions(editor, document, byId, note).map(contributionText).join('');
	if (frontmatter !== '' && out !== '' && !/\n$/.test(frontmatter)) {
		const eol = frontmatter.includes('\r\n') ? '\r\n' : '\n';
		return frontmatter + eol + out;
	}

	return frontmatter + out;
}

interface IContribution {
	readonly id: string | undefined;
	readonly prefix: string;
	/** The block's own text, without line breaks around it; `''` for a block that stores nothing. */
	readonly body: string;
	/** The line breaks after it. */
	sep: string;
	/** The kind of its first block, and of its last. */
	readonly kind: IBaseHalfNoteBlockKind;
	readonly endKind: IBaseHalfNoteBlockKind;
	readonly slot: IBaseHalfMarkdownSlot | undefined;
	readonly fixed: boolean;
	/** What the writer writes of the block now, the first lines of a toggle in parts; `''` for a fixed block. */
	readonly written: string;
	/** The group of a multi-block segment kept whole. */
	readonly group?: string;
	/** A toggle in parts: its first lines, its blocks, and its last line, in it. */
	readonly members?: readonly IContribution[];
}

function contributionText(contribution: IContribution): string {
	return contribution.prefix + contribution.body + contribution.sep;
}

function savedContribution(contribution: IContribution): IBaseHalfMarkdownSaveContribution {
	const text = contributionText(contribution);
	const members = contribution.members;
	if (!members) {
		return { id: contribution.id, text };
	}
	// The toggle's own line breaks after it go with its last line.
	const parts = members.map(savedContribution);
	const inner = parts.map(part => part.text).join('');
	parts[parts.length - 1] = { ...parts[parts.length - 1], text: parts[parts.length - 1].text + text.slice(inner.length) };
	return { id: contribution.id, text, parts };
}

/**
 * What each block of the note stands for in its file (design C12): a block
 * the user did not change, and a fixed block in its place, its bytes; a block
 * the user changed, what the writer writes of it between the line breaks the
 * file had around it; a new block, what the writer writes of it; a fixed
 * block pasted or copied within the note, its source; and a toggle in parts,
 * its first lines, its blocks, and its last line, each so.
 */
function collectContributions(
	editor: IBaseHalfMarkdownEditorApi,
	document: readonly unknown[],
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	note: IBaseHalfMarkdownNote
): IContribution[] {
	const contributions = contributionsOf(editor, document, byId, note);
	keepBlocksApart(contributions, note, '');
	return contributions;
}

/** A toggle in parts, as the entry of its first lines says, that is still a toggle. */
function isGroupedToggle(block: unknown, byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>): boolean {
	const id = baseHalfNoteBlockId(block);
	return id !== undefined && byId.get(id)?.toggle !== undefined && isBaseHalfNoteToggle(block);
}

function contributionsOf(
	editor: IBaseHalfMarkdownEditorApi,
	blocks: readonly unknown[],
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	note: IBaseHalfMarkdownNote
): IContribution[] {
	const written = writeContainerBlocks(editor, blocks, note, false, block => isGroupedToggle(block, byId));
	const contributions: IContribution[] = [];
	let index = 0;
	while (index < written.length) {
		const current = written[index];
		const entry = current.id !== undefined ? byId.get(current.id) : undefined;
		if (current.fixed) {
			contributions.push(fixedContribution(current, entry));
			index++;
			continue;
		}

		if (current.grouped && entry?.toggle) {
			contributions.push(toggleContribution(editor, current, entry, byId, note));
			index++;
			continue;
		}

		if (entry?.group !== undefined) {
			const run = intactGroupLength(written, byId, index, entry);
			if (run > 0) {
				for (let member = index; member < index + run; member++) {
					const memberEntry = byId.get(written[member].id!)!;
					const shared = { id: written[member].id, kind: written[index].kind, endKind: written[index + run - 1].kind, slot: memberEntry.slot, fixed: false, written: written[member].text, group: entry.group };
					contributions.push(member === index + run - 1
						? { ...shared, ...entryParts(memberEntry) }
						: { ...shared, prefix: '', body: '', sep: '' });
				}
				index += run;
				continue;
			}
		}

		const text = current.text;
		const kept = (text !== '' || current.failed) && entry !== undefined && !entry.multi && !entry.fixed;
		// A block the writer cannot write keeps the bytes it stood for (design A5).
		const parts = !kept ? { prefix: '', body: text, sep: '' } : text === entry.key || current.failed ? entryParts(entry) : { prefix: entry.prefix, body: text, sep: entry.sep };
		const slot = kept ? entry.slot : undefined;
		const kind = current.failed && slot ? slot.kind : current.kind;
		contributions.push({ id: current.id, ...parts, kind, endKind: current.failed && slot ? slot.endKind : kind, slot, fixed: false, written: text });
		index++;
	}
	return contributions;
}

/**
 * A toggle in parts (rule 41): its first lines, its own bytes while the
 * writer writes them as it did; its blocks, each as in the note; and its last
 * line. Its first lines and its last line are the first and the last members
 * of its container (design C12).
 */
function toggleContribution(
	editor: IBaseHalfMarkdownEditorApi,
	current: IWrittenBlock,
	entry: IBaseHalfMarkdownReuseEntry,
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	note: IBaseHalfMarkdownNote
): IContribution {
	const id = current.id!;
	const { header, footer } = entry.toggle!;
	const kindThen = entry.slot?.kind ?? current.kind;
	const headerBody = current.text === header.key || current.failed
		? header.raw.slice(header.prefix.length, header.raw.length - header.sep.length)
		: current.text;
	const first: IContribution = {
		id, prefix: header.prefix, body: headerBody, sep: header.sep, kind: current.kind, endKind: current.kind, fixed: false, written: current.text,
		slot: { container: id, first: header.unit, last: header.unit, kind: kindThen, endKind: kindThen, end: false }
	};
	const children = contributionsOf(editor, baseHalfNoteBlockChildren(current.block), byId, note);
	const last: IContribution = {
		id: undefined, prefix: '', body: footer.source, sep: '', kind: toggleEndKind, endKind: toggleEndKind, fixed: true, written: '',
		slot: { container: id, first: footer.unit, last: footer.unit, kind: toggleEndKind, endKind: toggleEndKind, end: false }
	};
	const members = [first, ...children, last];
	keepBlocksApart(members, note, id);
	return {
		id,
		prefix: first.prefix,
		body: first.body + first.sep + children.map(contributionText).join('') + last.body,
		sep: entry.sep,
		kind: current.kind,
		endKind: current.kind,
		slot: entry.slot,
		fixed: false,
		written: current.text,
		members
	};
}

function fixedContribution(current: IWrittenBlock, entry: IBaseHalfMarkdownReuseEntry | undefined): IContribution {
	if (entry?.fixed && entry.slot) {
		return { id: current.id, ...entryParts(entry), kind: fixedKind, endKind: fixedKind, slot: entry.slot, fixed: true, written: '' };
	}
	// A fixed block pasted or copied within the note stands for its source,
	// without the line breaks around the place it came from.
	const props = baseHalfNoteBlockProps(current.block);
	const source = baseHalfNoteStringProp(props, 'source') || baseHalfNoteStringProp(props, 'raw');
	return { id: current.id, prefix: '', body: source, sep: '', kind: fixedKind, endKind: fixedKind, slot: undefined, fixed: true, written: '' };
}

/** An entry's bytes as the line breaks before the block, its own text, and the line breaks after it. */
function entryParts(entry: IBaseHalfMarkdownReuseEntry): { readonly prefix: string; readonly body: string; readonly sep: string } {
	const { raw, prefix, sep } = entry;
	if (raw.length >= prefix.length + sep.length && raw.startsWith(prefix) && raw.endsWith(sep)) {
		return { prefix, body: raw.slice(prefix.length, raw.length - sep.length), sep };
	}
	return { prefix: '', body: raw, sep: '' };
}

/**
 * A segment that projects into several blocks can only be spliced back
 * verbatim as a whole: when the full group is still present, in order, and
 * every member is unchanged. Returns the number of blocks it holds, or 0 when
 * the group is broken and its blocks are written one by one.
 */
function intactGroupLength(
	written: readonly IWrittenBlock[],
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	start: number,
	first: IBaseHalfMarkdownReuseEntry
): number {
	let length = 0;
	for (let index = start; index < written.length; index++) {
		const id = written[index].id;
		const entry = id !== undefined ? byId.get(id) : undefined;
		if (!entry || entry.group !== first.group) {
			break;
		}
		if (entry.blockKey === undefined || written[index].text !== entry.blockKey) {
			return 0;
		}
		length++;
	}
	return length === first.groupSize ? length : 0;
}

/**
 * The line breaks between the blocks of a container (rule 67): two blocks
 * that were neighbours when the note was read, and still are with the kinds
 * they had, keep the line breaks the file has between them; any other two
 * get at least the line breaks Markdown needs between them, and Rich never
 * removes one. A note whose last block is not the one it ended with ends
 * with one line break (rule 68).
 */
function keepBlocksApart(contributions: readonly IContribution[], note: IBaseHalfMarkdownNote, container: string): void {
	let before: IContribution | undefined;
	for (const contribution of contributions) {
		if (contribution.body === '') {
			continue;
		}
		if (before && !originalNeighbours(before, contribution, container)) {
			const needed = baseHalfNoteRequiredLineBreaks({ kind: before.endKind, text: before.body }, { kind: contribution.kind, text: contribution.body });
			const present = countLineBreaks(before.sep) + countLineBreaks(contribution.prefix);
			if (present < needed) {
				before.sep += note.eol.repeat(needed - present);
			}
		}
		before = contribution;
	}
	if (container === '' && before && !(before.slot?.container === '' && before.slot.end)) {
		before.sep = note.eol;
	}
}

function originalNeighbours(before: IContribution, after: IContribution, container: string): boolean {
	const first = before.slot;
	const second = after.slot;
	return !!first && !!second
		&& first.container === container && second.container === container
		&& second.first === first.last + 1
		&& sameBaseHalfNoteBlockKind(first.endKind, before.endKind)
		&& sameBaseHalfNoteBlockKind(second.kind, after.kind);
}

function countLineBreaks(text: string): number {
	let count = 0;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code === 10 || (code === 13 && text.charCodeAt(index + 1) !== 10)) {
			count++;
		}
	}
	return count;
}

// --- A change of the note made outside Rich (design 4.3)

export interface IBaseHalfMarkdownMergePlan {
	/** The blocks to take out, in order. */
	readonly removeIds: readonly string[];
	/** The blocks read anew, for the editor. */
	readonly blocks: readonly unknown[];
	/** Where the blocks read anew go when no block is taken out. */
	readonly anchor: { readonly id: string; readonly placement: 'before' | 'after' } | undefined;
	/** The entries of the document after the change. */
	readonly byId: Map<string, IBaseHalfMarkdownReuseEntry>;
	readonly note: IBaseHalfMarkdownNote;
}

/**
 * How Rich's document takes a change of the note made outside Rich: the one
 * run of segments that changed is read anew, and every other block stays,
 * standing for the bytes it stands for in the new body. Returns nothing when
 * the document does not stand for `oldBody` exactly, when nothing changed,
 * when the change would leave no block, or when it changes the note's line
 * ending or its reference definitions, which every block is read with; the
 * caller then loads the note anew.
 */
export async function planBaseHalfMarkdownMerge(
	editor: IBaseHalfMarkdownEditorApi,
	document: readonly unknown[],
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	note: IBaseHalfMarkdownNote,
	oldBody: string,
	newBody: string,
	content: string = newBody
): Promise<IBaseHalfMarkdownMergePlan | undefined> {
	const read = createBaseHalfMarkdownNote(newBody, content);
	if (read.eol !== note.eol || JSON.stringify(read.definitions) !== JSON.stringify(note.definitions)) {
		return undefined;
	}
	const oldSegments = segmentBaseHalfMarkdownBody(oldBody);
	const newSegments = segmentBaseHalfMarkdownBody(newBody);
	const contributions = collectContributions(editor, document, byId, note);
	const groups = groupBaseHalfMarkdownContributions(contributions.map(contributionText), oldSegments.map(segment => segment.raw));
	if (!groups) {
		return undefined;
	}
	const region = diffBaseHalfMarkdownSegments(oldSegments.map(segment => segment.raw), newSegments.map(segment => segment.raw));
	if (!region) {
		return undefined;
	}

	const removeIds: string[] = [];
	for (let segment = region.oldStart; segment < region.oldEnd; segment++) {
		for (const at of groups[segment]) {
			const id = contributions[at].id;
			if (id === undefined) {
				return undefined;
			}
			removeIds.push(id);
		}
	}
	if (removeIds.length === contributions.length && region.newStart === region.newEnd) {
		return undefined;
	}

	const nextNote: IBaseHalfMarkdownNote = { ...note, open: new Set(note.open), listHints: new Map(note.listHints) };
	const newUnits = unitsOf(newSegments);
	const projected = await projectSegments(editor, newSegments.slice(region.newStart, region.newEnd).map(segment => ({ segment, place: placeOf(segment, '', newUnits) })), nextNote, newUnits);
	const keptAt = (from: number, to: number) => groups.slice(from, to).flat();
	const before = keptAt(0, region.oldStart);
	const after = keptAt(region.oldEnd, groups.length);
	const { blocks, written } = writeProjected(editor, projected, nextNote, before.map(at => document[at]), after.map(at => document[at]), block => isGroupedToggle(block, byId));

	let anchor: IBaseHalfMarkdownMergePlan['anchor'];
	if (removeIds.length === 0 && blocks.length > 0) {
		const neighbour = region.oldStart > 0 ? groups[region.oldStart - 1].at(-1) : groups[0]?.[0];
		const id = neighbour !== undefined ? contributions[neighbour].id : undefined;
		if (id === undefined) {
			return undefined;
		}
		anchor = { id, placement: region.oldStart > 0 ? 'after' : 'before' };
	}

	// Every block that stays now stands for what it contributed to the body
	// that changed, which the new body holds, at its segment's place there;
	// the blocks in a toggle that stays move with it.
	const nextById = new Map<string, IBaseHalfMarkdownReuseEntry>();
	groups.forEach((members, segmentIndex) => {
		if (segmentIndex >= region.oldStart && segmentIndex < region.oldEnd) {
			return;
		}
		const segment = newSegments[segmentIndex < region.oldStart ? segmentIndex : segmentIndex - region.oldEnd + region.newEnd];
		const place = placeOf(segment, '', newUnits);
		for (const at of members) {
			const contribution = contributions[at];
			const entry = contribution.id !== undefined ? byId.get(contribution.id) : undefined;
			if (contribution.id === undefined || !entry || (contribution.body === '' && contribution.group === undefined)) {
				continue;
			}
			const slot: IBaseHalfMarkdownSlot = { container: '', first: place.first, last: place.last, kind: contribution.kind, endKind: contribution.endKind, end: place.end };
			if (contribution.group !== undefined) {
				nextById.set(contribution.id, { ...entry, slot });
				continue;
			}
			const toggle = entry.toggle;
			if (toggle && contribution.members) {
				const shift = place.first - (entry.slot?.first ?? toggle.header.unit);
				moveToggleBlocks(document[at], byId, nextById, shift);
				nextById.set(contribution.id, {
					...entry,
					raw: contributionText(contribution),
					prefix: contribution.prefix,
					sep: contribution.sep,
					slot,
					toggle: { header: { ...toggle.header, unit: toggle.header.unit + shift }, footer: { ...toggle.footer, unit: toggle.footer.unit + shift } }
				});
				continue;
			}
			nextById.set(contribution.id, {
				key: contribution.written,
				raw: contributionText(contribution),
				prefix: contribution.prefix,
				sep: contribution.sep,
				...(contribution.fixed ? { fixed: true } : {}),
				slot
			});
		}
	});
	for (const [id, entry] of entriesOf(editor, projected, written, nextNote)) {
		nextById.set(id, entry);
	}

	return { removeIds, blocks, anchor, byId: nextById, note: nextNote };
}

/** The entries of the blocks in a toggle that stays, moved by `shift` places with it. */
function moveToggleBlocks(toggle: unknown, byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>, nextById: Map<string, IBaseHalfMarkdownReuseEntry>, shift: number): void {
	for (const child of baseHalfNoteBlockChildren(toggle)) {
		const id = baseHalfNoteBlockId(child);
		const entry = id !== undefined ? byId.get(id) : undefined;
		if (id !== undefined && entry) {
			const slot = entry.slot && { ...entry.slot, first: entry.slot.first + shift, last: entry.slot.last + shift };
			const inner = entry.toggle && { header: { ...entry.toggle.header, unit: entry.toggle.header.unit + shift }, footer: { ...entry.toggle.footer, unit: entry.toggle.footer.unit + shift } };
			nextById.set(id, { ...entry, ...(slot ? { slot } : {}), ...(inner ? { toggle: inner } : {}) });
		}
		moveToggleBlocks(child, byId, nextById, shift);
	}
}

// --- A document that already holds the note (design 4.4)

/**
 * The entries of a load projection for a document that already holds its
 * blocks under other ids: the same blocks in the same tree, written the
 * same. Returns nothing when the document holds other blocks.
 */
export function adoptBaseHalfMarkdownLoadProjection(
	editor: IBaseHalfMarkdownEditorApi,
	current: readonly unknown[],
	projection: IBaseHalfMarkdownLoadProjection
): { readonly byId: Map<string, IBaseHalfMarkdownReuseEntry>; readonly note: IBaseHalfMarkdownNote } | undefined {
	const ids = new Map<string, string>();
	const pair = (projected: readonly unknown[], held: readonly unknown[]): boolean => {
		if (projected.length !== held.length) {
			return false;
		}
		return projected.every((block, index) => {
			const other = held[index];
			const projectedId = baseHalfNoteBlockId(block);
			const heldId = baseHalfNoteBlockId(other);
			if (baseHalfNoteBlockType(block) !== baseHalfNoteBlockType(other) || (projectedId !== undefined && heldId === undefined)) {
				return false;
			}
			if (baseHalfNoteBlockType(block) === BASEHALF_RAW_PASSTHROUGH_BLOCK && JSON.stringify(baseHalfNoteBlockProps(block)) !== JSON.stringify(baseHalfNoteBlockProps(other))) {
				return false;
			}
			if (projectedId !== undefined && heldId !== undefined) {
				ids.set(projectedId, heldId);
			}
			return pair(baseHalfNoteBlockChildren(block), baseHalfNoteBlockChildren(other));
		});
	};
	if (!pair(projection.blocks, current)) {
		return undefined;
	}

	const moved = (id: string) => ids.get(id) ?? id;
	const note: IBaseHalfMarkdownNote = {
		...projection.note,
		open: new Set([...projection.note.open].map(moved)),
		listHints: new Map([...projection.note.listHints].map(([id, hint]) => [moved(id), hint.children ? { ...hint, children: hint.children.map(moved) } : hint]))
	};
	const byId = new Map<string, IBaseHalfMarkdownReuseEntry>();
	for (const [id, entry] of projection.byId) {
		byId.set(moved(id), entry.slot ? { ...entry, slot: { ...entry.slot, container: entry.slot.container === '' ? '' : moved(entry.slot.container) } } : entry);
	}
	// The document and the projection write the same bytes.
	const projectedText = collectContributions(editor, projection.blocks, projection.byId, projection.note).map(contributionText).join('');
	const heldText = collectContributions(editor, current, byId, note).map(contributionText).join('');
	return projectedText === heldText ? { byId, note } : undefined;
}

function collectUnits(body: string, splitListItems: boolean): IBaseHalfMarkdownUnit[] {
	// The lexer reads the body with its line endings LF and the tabs that
	// start its lines as spaces, so token raws can only be located in an
	// equally normalized view; the map converts matched offsets back into
	// positions in the original bytes.
	const { normalized, toOriginal } = normalizeForLexing(body);

	let tokens: Token[];
	try {
		tokens = [...lexer(normalized, { gfm: true })];
	} catch {
		return [{ start: 0, end: body.length }];
	}

	const units: IBaseHalfMarkdownUnit[] = [];
	let offset = 0;
	// Where a token begins that cannot be found: it is one unit up to the next
	// token that can, rather than the whole body one unit.
	let lost: number | undefined;
	const pushLost = (to: number) => {
		if (lost !== undefined) {
			const start = toOriginal(lost);
			units.push({ start, end: trimTrailingLineBreaks(body, start, to) });
			lost = undefined;
		}
	};
	for (const token of tokens) {
		const raw = typeof token.raw === 'string' ? token.raw : '';
		if (raw === '') {
			continue;
		}

		const start = normalized.indexOf(raw, offset);
		if (start < 0) {
			lost ??= offset;
			continue;
		}
		pushLost(toOriginal(start));

		const end = start + raw.length;
		offset = end;
		if (token.type === 'space') {
			continue;
		}

		if (splitListItems && isListToken(token) && token.items.length > 0) {
			const listUnits = collectListItemUnits(normalized, toOriginal, token, start, end);
			if (listUnits.length === token.items.length) {
				units.push(...listUnits);
				continue;
			}
		}

		units.push({ start: toOriginal(start), end: trimTrailingLineBreaks(body, toOriginal(start), toOriginal(end)), html: token.type === 'html' });
	}
	pushLost(body.length);

	return units.filter(unit => unit.start < unit.end);
}

/**
 * The body as `marked` lexes it: its line endings LF, and the tabs that start
 * a line after its spaces four spaces each (`Lexer.lex` in marked.js).
 */
function normalizeForLexing(body: string): { normalized: string; toOriginal: (index: number) => number } {
	if (!body.includes('\r') && !/^ *\t/m.test(body)) {
		return { normalized: body, toOriginal: index => index };
	}

	const map: number[] = [];
	let normalized = '';
	let index = 0;
	// Where the line is: in its leading spaces, in the tabs after them, or past both.
	let place: 'spaces' | 'tabs' | 'text' = 'spaces';
	while (index < body.length) {
		const code = body.charCodeAt(index);
		if (code === 13 || code === 10) {
			map.push(index);
			normalized += '\n';
			index += code === 13 && body.charCodeAt(index + 1) === 10 ? 2 : 1;
			place = 'spaces';
			continue;
		}
		if (code === 9 && place !== 'text') {
			map.push(index, index, index, index);
			normalized += '    ';
			index++;
			place = 'tabs';
			continue;
		}
		if (code !== 32 || place === 'tabs') {
			place = 'text';
		}
		map.push(index);
		normalized += body[index];
		index++;
	}
	map.push(body.length);

	return { normalized, toOriginal: position => map[Math.min(position, map.length - 1)] };
}

// --- Toggles whose parts are blocks of their own (note formats, rules 41 to 43)

/** A `<details>` whose first lines, blocks, and last line `marked` read as blocks of their own. */
interface IBaseHalfMarkdownUnitGroup {
	readonly header: IBaseHalfMarkdownUnit;
	readonly children: readonly BaseHalfMarkdownUnitItem[];
	readonly footer: IBaseHalfMarkdownUnit;
}

type BaseHalfMarkdownUnitItem =
	| { readonly kind: 'unit'; readonly unit: IBaseHalfMarkdownUnit }
	| { readonly kind: 'group'; readonly group: IBaseHalfMarkdownUnitGroup };

const detailsTags = /<details(?=[\s>])|<\/details\s*>/gi;
// Beyond these a `<details>` is read as parts, as a note is planned in parts on the canvas.
const maxToggleLength = 50_000;
const maxToggleUnits = 2_000;

/**
 * The units of a body with each `<details>` whose parts are blocks of their
 * own grouped: from a block of HTML that starts with `<details`, counting the
 * start and end tags of `details` line by line in the blocks of HTML that
 * follow, to the end of the line where they balance. A unit that goes on
 * past that line is cut there, and its rest may open the next toggle. A
 * toggle that never closes, closes more than it opens, closes inside a line
 * that goes on, or runs past the limits stays as its units.
 */
function groupBaseHalfMarkdownUnits(body: string, input: readonly IBaseHalfMarkdownUnit[]): BaseHalfMarkdownUnitItem[] {
	const units = [...input];
	const items: BaseHalfMarkdownUnitItem[] = [];
	let index = 0;
	while (index < units.length) {
		const unit = units[index];
		const closing = unit.html && /^ {0,3}<details(?=[\s>])/i.test(body.slice(unit.start, unit.end)) ? closeDetails(body, units, index) : undefined;
		if (!closing) {
			items.push({ kind: 'unit', unit });
			index++;
			continue;
		}
		items.push(closing.at === index
			? { kind: 'unit', unit: closing.footer }
			: { kind: 'group', group: { header: unit, children: groupBaseHalfMarkdownUnits(body, units.slice(index + 1, closing.at)), footer: closing.footer } });
		if (closing.rest) {
			units[closing.at] = closing.rest;
			index = closing.at;
		} else {
			index = closing.at + 1;
		}
	}
	return items;
}

/**
 * Where the `<details>` that opens `units[start]` closes: the unit `at` that
 * holds its last line, cut after that line, and the rest of that unit.
 */
function closeDetails(body: string, units: readonly IBaseHalfMarkdownUnit[], start: number): { at: number; footer: IBaseHalfMarkdownUnit; rest?: IBaseHalfMarkdownUnit } | undefined {
	let count = 0;
	for (let at = start; at < units.length && at - start < maxToggleUnits; at++) {
		const unit = units[at];
		if (!unit.html) {
			continue;
		}
		// A comment counts for nothing; it keeps its length so that offsets hold.
		const text = body.slice(unit.start, unit.end).replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\r\n]/g, ' '));
		let lineStart = 0;
		for (; ;) {
			const lineBreak = text.indexOf('\n', lineStart);
			const line = text.slice(lineStart, lineBreak < 0 ? text.length : lineBreak);
			for (const match of line.matchAll(detailsTags)) {
				count += match[0][1] === '/' ? -1 : 1;
				if (count < 0) {
					return undefined;
				}
				if (count === 0) {
					if (line.slice(match.index + match[0].length).trim() !== '') {
						return undefined;
					}
					const end = unit.start + lineStart + line.replace(/\s+$/, '').length;
					if (end - units[start].start > maxToggleLength) {
						return undefined;
					}
					const footer: IBaseHalfMarkdownUnit = { start: unit.start, end, html: true };
					const rest = lineBreak < 0 ? undefined : unit.start + lineBreak + 1;
					return rest === undefined || rest >= unit.end ? { at, footer } : { at, footer, rest: { start: rest, end: unit.end, html: true } };
				}
			}
			if (lineBreak < 0) {
				break;
			}
			lineStart = lineBreak + 1;
		}
	}
	return undefined;
}

function isListToken(token: Token): token is Tokens.List {
	return token.type === 'list' && Array.isArray((token as Partial<Tokens.List>).items);
}

function collectListItemUnits(
	normalized: string,
	toOriginal: (index: number) => number,
	token: Tokens.List,
	listStart: number,
	listEnd: number
): IBaseHalfMarkdownUnit[] {
	const units: IBaseHalfMarkdownUnit[] = [];
	let itemOffset = listStart;
	for (const item of token.items) {
		const start = normalized.indexOf(item.raw, itemOffset);
		if (start < itemOffset || start >= listEnd) {
			return [];
		}

		const rawEnd = start + item.raw.length;
		if (rawEnd > listEnd) {
			return [];
		}

		const originalStart = toOriginal(start);
		const end = trimTrailingLineBreaksInNormalized(normalized, toOriginal, start, rawEnd);
		if (originalStart < end) {
			units.push({ start: originalStart, end });
		}
		itemOffset = rawEnd;
	}

	return units;
}

function trimTrailingLineBreaksInNormalized(
	normalized: string,
	toOriginal: (index: number) => number,
	start: number,
	end: number
): number {
	let index = end;
	while (index > start && normalized.charCodeAt(index - 1) === 10) {
		index--;
	}
	return toOriginal(index);
}

function trimTrailingLineBreaks(source: string, start: number, end: number): number {
	let index = end;
	while (index > start && source.charCodeAt(index - 1) === 10) {
		index--;
		if (index > start && source.charCodeAt(index - 1) === 13) {
			index--;
		}
	}
	return index;
}

function isEmptyParagraph(block: unknown): boolean {
	if (baseHalfNoteBlockType(block) !== 'paragraph') {
		return false;
	}

	const content = isBaseHalfNoteRecord(block) ? block.content : undefined;
	if (!Array.isArray(content) || content.length === 0) {
		return true;
	}

	return content.every(node => isBaseHalfNoteRecord(node) && node.type === 'text' && (typeof node.text !== 'string' || node.text === ''));
}

function isDropped(blocks: readonly unknown[]): boolean {
	return blocks.length === 0 || blocks.every(isEmptyParagraph);
}

function isOwnMarker(source: string): boolean {
	return /^\s*<!--\s*bh:/.test(source);
}
