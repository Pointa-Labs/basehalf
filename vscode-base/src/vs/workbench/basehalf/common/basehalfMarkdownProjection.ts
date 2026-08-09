/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { lexer, type Token, type Tokens } from '../../../base/common/marked/marked.js';
import { parse as parseYaml, type YamlParseError } from '../../../base/common/yaml.js';

export const BASEHALF_RAW_PASSTHROUGH_BLOCK = 'rawPassthrough';

let nextGroupSequence = 1;

export interface IBaseHalfMarkdownSegment {
	readonly source: string;
	readonly raw: string;
	readonly prefix: string;
	readonly sep: string;
}

export interface IBaseHalfMarkdownEditorApi {
	tryParseMarkdownToBlocks(markdown: string): Promise<unknown[]> | unknown[];
	blocksToMarkdownLossy(blocks: unknown[]): Promise<string> | string;
}

export interface IBaseHalfMarkdownReuseEntry {
	readonly key: string;
	readonly raw: string;
	readonly prefix: string;
	readonly sep: string;
	readonly multi?: boolean;
	/** Identifies the block group a multi-block segment projected into. */
	readonly group?: string;
	/** Number of blocks the segment projected into. */
	readonly groupSize?: number;
	/** This block's own normalized form, for per-block change detection. */
	readonly blockKey?: string;
}

export interface IBaseHalfMarkdownLoadProjection {
	readonly blocks: unknown[];
	readonly byId: Map<string, IBaseHalfMarkdownReuseEntry>;
}

interface IBaseHalfMarkdownUnit {
	readonly start: number;
	readonly end: number;
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
	if (!isYamlMapping(candidate)) {
		return { frontmatter: '', body: content };
	}

	const end = match.index + match[0].length;
	return { frontmatter: content.slice(0, end), body: content.slice(end) };
}

function isYamlMapping(candidate: string): boolean {
	const firstLineEnd = candidate.search(/\r|\n/);
	const firstLine = firstLineEnd >= 0 ? candidate.slice(0, firstLineEnd) : candidate;
	if (firstLine.trim() === '') {
		return false;
	}
	const errors: YamlParseError[] = [];
	const node = parseYaml(candidate, errors);
	return errors.every(error => isUnsupportedYamlAnchorIndent(candidate, error))
		&& node?.type === 'map'
		&& yamlTriviaOnly(candidate.slice(0, node.startOffset))
		&& yamlTriviaOnly(candidate.slice(node.endOffset));
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

export function segmentBaseHalfMarkdownBody(body: string): IBaseHalfMarkdownSegment[] {
	return segmentBaseHalfMarkdownBodyWithListMode(body, true);
}

/**
 * Tiles a Markdown body at top-level block boundaries while preserving every
 * source byte. Unlike {@link segmentBaseHalfMarkdownBody}, a top-level list is
 * kept as one segment instead of being split into one segment per list item.
 */
export function segmentBaseHalfMarkdownTopLevelBody(body: string): IBaseHalfMarkdownSegment[] {
	return segmentBaseHalfMarkdownBodyWithListMode(body, false);
}

function segmentBaseHalfMarkdownBodyWithListMode(body: string, splitListItems: boolean): IBaseHalfMarkdownSegment[] {
	if (body === '') {
		return [];
	}

	const units = collectUnits(body, splitListItems);
	if (units.length === 0) {
		return [{ source: body, raw: body, prefix: '', sep: '' }];
	}

	return units.map((unit, index) => {
		const next = units[index + 1];
		const tileStart = index === 0 ? 0 : unit.start;
		const tileEnd = next ? next.start : body.length;
		return {
			source: body.slice(unit.start, unit.end),
			raw: body.slice(tileStart, tileEnd),
			prefix: body.slice(tileStart, unit.start),
			sep: body.slice(unit.end, tileEnd)
		};
	});
}

export function baseHalfMarkdownContentTokens(markdown: string): string {
	return (markdown.match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
}

export function baseHalfMarkdownLosesContent(source: string, normalized: string): boolean {
	// Standard Markdown can normalize substantially across BlockNote's parser and
	// serializer (wrapped blockquotes, link syntax, list markers) while still being
	// an editable block. Reserve passthrough for constructs BlockNote cannot model:
	// comments and raw HTML whose content would be dropped on edit.
	if (htmlComments(source) !== htmlComments(normalized)) {
		return true;
	}

	if (!containsRawHtml(source)) {
		return false;
	}

	return (
		baseHalfMarkdownContentTokens(source) !== baseHalfMarkdownContentTokens(normalized)
	);
}

export interface IBaseHalfMarkdownSegmentProjection {
	readonly blocks: unknown[];
	readonly entries: ReadonlyArray<readonly [string, IBaseHalfMarkdownReuseEntry]>;
}

export async function projectBaseHalfMarkdownSegment(
	editor: IBaseHalfMarkdownEditorApi,
	segment: IBaseHalfMarkdownSegment
): Promise<IBaseHalfMarkdownSegmentProjection> {
	const parsed: unknown[] = [];
	const paragraphParts = splitBaseHalfParagraphFileLinkLines(segment.source) ?? [segment.source];
	for (const part of paragraphParts) {
		let partBlocks: unknown[] = [];
		try {
			partBlocks = normalizeBaseHalfMarkdownSoftBreaks(await editor.tryParseMarkdownToBlocks(part));
		} catch {
			partBlocks = [];
		}
		parsed.push(...projectBaseHalfStandaloneFileLink(part, partBlocks));
	}

	if (isDropped(parsed)) {
		return { blocks: [passthroughBlock(segment)], entries: [] };
	}

	const key = await normalize(editor, parsed);
	if (baseHalfMarkdownLosesContent(segment.source, key)) {
		return { blocks: [passthroughBlock(segment)], entries: [] };
	}

	const entries: Array<readonly [string, IBaseHalfMarkdownReuseEntry]> = [];
	if (parsed.length === 1) {
		const id = idOf(parsed[0]);
		if (id) {
			entries.push([id, { key, raw: segment.raw, prefix: segment.prefix, sep: segment.sep }]);
		}
	} else {
		const group = `g${nextGroupSequence++}`;
		for (let index = 0; index < parsed.length; index++) {
			const id = idOf(parsed[index]);
			if (!id) {
				continue;
			}

			const shared = { multi: true, group, groupSize: parsed.length, blockKey: await normalize(editor, [parsed[index]]) };
			entries.push([
				id,
				index === parsed.length - 1
					? { key, raw: segment.raw, prefix: segment.prefix, sep: segment.sep, ...shared }
					: { key, raw: '', prefix: '', sep: '', ...shared }
			]);
		}
	}

	return { blocks: parsed, entries };
}

/**
 * Projects a standalone local Markdown file link as a BlockNote file block.
 * The source stays ordinary `[name](relative/path.ext)` Markdown; this is a
 * rich-only view over the same bytes, not a BaseHalf-specific file format.
 */
export function projectBaseHalfStandaloneFileLink(source: string, parsed: unknown[]): unknown[] {
	if (parsed.length !== 1) {
		return parsed;
	}
	const link = baseHalfStandaloneFileLink(source);
	if (!link) {
		return parsed;
	}

	const original = isRecord(parsed[0]) ? parsed[0] : {};
	const originalProps = isRecord(original.props) ? original.props : {};
	return [{
		...original,
		type: 'file',
		props: {
			backgroundColor: typeof originalProps.backgroundColor === 'string' ? originalProps.backgroundColor : 'default',
			name: link.text || attachmentNameFromHref(link.href),
			url: link.href,
			caption: ''
		},
		content: undefined,
		children: []
	}];
}

/**
 * BlockNote serializes adjacent rich blocks with one newline. CommonMark reads
 * `paragraph\n[file](...)` back as one soft-wrapped paragraph, so a close/open
 * cycle would erase the file-block projection. Split only a plain paragraph's
 * lines that are independently complete local file links; fenced code, quotes,
 * lists, and mixed inline content keep their original parsing.
 */
function splitBaseHalfParagraphFileLinkLines(source: string): string[] | undefined {
	const tokens = lexer(source).filter(token => token.type !== 'space');
	if (tokens.length !== 1 || tokens[0].type !== 'paragraph') {
		return undefined;
	}

	const lines = source.split(/\r?\n/);
	if (lines.length < 2 || !lines.some(isBaseHalfStandaloneFileLinkLine)) {
		return undefined;
	}

	const parts: string[] = [];
	let paragraph: string[] = [];
	const flushParagraph = () => {
		if (paragraph.length > 0) {
			parts.push(paragraph.join('\n'));
			paragraph = [];
		}
	};
	for (const line of lines) {
		if (isBaseHalfStandaloneFileLinkLine(line)) {
			flushParagraph();
			parts.push(line);
		} else {
			paragraph.push(line);
		}
	}
	flushParagraph();
	return parts;
}

function isBaseHalfStandaloneFileLinkLine(line: string): boolean {
	return line === line.trim() && !!baseHalfStandaloneFileLink(line);
}

function baseHalfStandaloneFileLink(source: string): Tokens.Link | undefined {
	const tokens = lexer(source).filter(token => token.type !== 'space');
	if (tokens.length !== 1 || tokens[0].type !== 'paragraph') {
		return undefined;
	}
	const paragraph = tokens[0] as Tokens.Paragraph;
	const inline = paragraph.tokens.filter(token => token.type !== 'space');
	if (inline.length !== 1 || inline[0].type !== 'link') {
		return undefined;
	}
	const link = inline[0] as Tokens.Link;
	return paragraph.text.trim() === link.raw.trim() && isBaseHalfLocalFileHref(link.href) ? link : undefined;
}

function isBaseHalfLocalFileHref(href: string): boolean {
	if (!href || href.startsWith('/') || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
		return false;
	}
	const path = href.split(/[?#]/, 1)[0];
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const extension = dot > 0 ? name.slice(dot).toLowerCase() : '';
	return !!extension && extension !== '.md' && extension !== '.markdown';
}

function attachmentNameFromHref(href: string): string {
	const path = href.split(/[?#]/, 1)[0];
	const name = path.slice(path.lastIndexOf('/') + 1);
	try {
		return decodeURIComponent(name);
	} catch {
		return name;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Removes the single formatting space BlockNote 0.51 inserts after every soft
 * line break while converting its intermediate `<br>\n` HTML back into block
 * content. Leaving that parser artifact in the document makes BlockNote's
 * required `white-space: pre-wrap` indent every continued line by one space.
 *
 * Code blocks keep their whitespace byte-for-byte. In inline-capable blocks we
 * remove exactly one parser-owned space, including when a style boundary puts
 * the line feed and following text in separate inline nodes.
 */
export function normalizeBaseHalfMarkdownSoftBreaks(blocks: unknown[]): unknown[] {
	return blocks.map(normalizeBaseHalfMarkdownSoftBreakBlock);
}

function normalizeBaseHalfMarkdownSoftBreakBlock(value: unknown): unknown {
	if (!isRecord(value) || value.type === 'codeBlock' || value.type === BASEHALF_RAW_PASSTHROUGH_BLOCK) {
		return value;
	}

	let changed = false;
	const normalized: Record<string, unknown> = { ...value };
	if (Array.isArray(value.content)) {
		const content = normalizeBaseHalfMarkdownInlineSoftBreaks(value.content);
		if (content !== value.content) {
			normalized.content = content;
			changed = true;
		}
	}
	const originalChildren = value.children;
	if (Array.isArray(originalChildren)) {
		const children = originalChildren.map(normalizeBaseHalfMarkdownSoftBreakBlock);
		if (children.some((child, index) => child !== originalChildren[index])) {
			normalized.children = children;
			changed = true;
		}
	}

	return changed ? normalized : value;
}

function normalizeBaseHalfMarkdownInlineSoftBreaks(content: unknown[]): unknown[] {
	let afterLineFeed = false;
	let changed = false;
	const normalized = content.map(value => {
		if (!isRecord(value) || value.type !== 'text' || typeof value.text !== 'string') {
			afterLineFeed = false;
			return value;
		}

		let text = value.text;
		if (afterLineFeed && text.startsWith(' ')) {
			text = text.slice(1);
		}
		text = text.replace(/\n /g, '\n');
		afterLineFeed = text.endsWith('\n');
		if (text === value.text) {
			return value;
		}

		changed = true;
		return { ...value, text };
	});
	return changed ? normalized : content;
}

export async function buildBaseHalfMarkdownLoadProjection(
	editor: IBaseHalfMarkdownEditorApi,
	body: string
): Promise<IBaseHalfMarkdownLoadProjection> {
	const segments = segmentBaseHalfMarkdownBody(body);
	const blocks: unknown[] = [];
	const byId = new Map<string, IBaseHalfMarkdownReuseEntry>();

	for (const segment of segments) {
		const projection = await projectBaseHalfMarkdownSegment(editor, segment);
		blocks.push(...projection.blocks);
		for (const [id, entry] of projection.entries) {
			byId.set(id, entry);
		}
	}

	const hasEditable = blocks.some(block => (block as { type?: string }).type !== BASEHALF_RAW_PASSTHROUGH_BLOCK);
	if (!hasEditable) {
		blocks.push({ type: 'paragraph' });
	}

	return { blocks, byId };
}

export interface IBaseHalfMarkdownSaveContribution {
	readonly id: string | undefined;
	readonly text: string;
}

/**
 * The exact per-block text each document block contributes to a save. Their
 * concatenation is what {@link spliceBaseHalfMarkdownSave} writes as the body,
 * which makes this the alignment basis for incremental external merges: while
 * the editor is not dirty, these contributions reproduce the on-disk body
 * byte for byte. Sole exception: when the final block is synthesized, the
 * save-time trailing-newline collapse can reach across block boundaries; the
 * per-block view then differs and merge alignment falls back to a rebuild.
 */
export async function collectBaseHalfMarkdownSaveContributions(
	editor: IBaseHalfMarkdownEditorApi,
	document: readonly unknown[],
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>
): Promise<IBaseHalfMarkdownSaveContribution[]> {
	const contributions = await collectContributions(editor, document, byId);
	const last = contributions[contributions.length - 1];
	if (last?.synthesized) {
		last.text = last.text.replace(/\n+$/, '\n');
	}

	return contributions.map(({ id, text }) => ({ id, text }));
}

export async function spliceBaseHalfMarkdownSave(
	editor: IBaseHalfMarkdownEditorApi,
	document: readonly unknown[],
	frontmatter: string,
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>
): Promise<string> {
	const contributions = await collectContributions(editor, document, byId);
	let out = contributions.map(contribution => contribution.text).join('');
	if (contributions[contributions.length - 1]?.synthesized) {
		out = out.replace(/\n+$/, '\n');
	}

	if (frontmatter !== '' && out !== '' && !/\n$/.test(frontmatter)) {
		const eol = frontmatter.includes('\r\n') ? '\r\n' : '\n';
		return frontmatter + eol + out;
	}

	return frontmatter + out;
}

async function collectContributions(
	editor: IBaseHalfMarkdownEditorApi,
	document: readonly unknown[],
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>
): Promise<Array<{ id: string | undefined; text: string; synthesized: boolean }>> {
	const contributions: Array<{ id: string | undefined; text: string; synthesized: boolean }> = [];
	let index = 0;
	while (index < document.length) {
		const block = document[index];
		const id = idOf(block);
		const typedBlock = block as { type?: string; props?: { raw?: string } };
		if (typedBlock.type === BASEHALF_RAW_PASSTHROUGH_BLOCK) {
			contributions.push({ id, text: typedBlock.props?.raw ?? '', synthesized: false });
			index++;
			continue;
		}

		const found = id ? byId.get(id) : undefined;
		if (found?.group) {
			const consumed = await spliceIntactGroup(editor, document, byId, index, found, contributions);
			if (consumed > 0) {
				index += consumed;
				continue;
			}
		}

		const entry = found && !found.multi ? found : undefined;
		if (entry && (await normalize(editor, [block])) === entry.key) {
			contributions.push({ id, text: entry.raw, synthesized: false });
			index++;
			continue;
		}

		const fresh = (await editor.blocksToMarkdownLossy([block])).trimEnd();
		const synthesized = ensureSynthesizedBlockBoundary(
			contributions[contributions.length - 1]?.text,
			document[index - 1],
			block,
			fresh
		);
		contributions.push(entry
			? { id, text: entry.prefix + fresh + entry.sep, synthesized: false }
			: { id, text: synthesized + defaultSep(block), synthesized: true });
		index++;
	}

	return contributions;
}

/**
 * A segment that projects into several blocks can only be spliced back
 * verbatim as a whole: when the full group is still present, in order, and
 * every member is unchanged, emit the members' stored raw texts (the final
 * member carries the segment bytes). Returns the number of blocks consumed,
 * or 0 when the group is broken and the caller must serialize block by block.
 */
async function spliceIntactGroup(
	editor: IBaseHalfMarkdownEditorApi,
	document: readonly unknown[],
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	start: number,
	first: IBaseHalfMarkdownReuseEntry,
	contributions: Array<{ id: string | undefined; text: string; synthesized: boolean }>
): Promise<number> {
	const run: Array<{ readonly id: string; readonly block: unknown; readonly entry: IBaseHalfMarkdownReuseEntry }> = [];
	for (let index = start; index < document.length; index++) {
		const id = idOf(document[index]);
		const entry = id ? byId.get(id) : undefined;
		if (!id || !entry || entry.group !== first.group) {
			break;
		}
		run.push({ id, block: document[index], entry });
	}

	if (run.length !== first.groupSize) {
		return 0;
	}

	for (const member of run) {
		if (member.entry.blockKey === undefined || (await normalize(editor, [member.block])) !== member.entry.blockKey) {
			return 0;
		}
	}

	for (const member of run) {
		contributions.push({ id: member.id, text: member.entry.raw, synthesized: false });
	}
	return run.length;
}

function collectUnits(body: string, splitListItems: boolean): IBaseHalfMarkdownUnit[] {
	// The lexer normalizes CR/CRLF to LF before tokenizing, so token raws can
	// only be located in an equally normalized view; the map converts matched
	// offsets back into positions in the original bytes.
	const { normalized, toOriginal } = normalizeLineEndings(body);

	let tokens: Token[];
	try {
		tokens = [...lexer(normalized, { gfm: true })];
	} catch {
		return [{ start: 0, end: body.length }];
	}

	const units: IBaseHalfMarkdownUnit[] = [];
	let offset = 0;
	for (const token of tokens) {
		const raw = typeof token.raw === 'string' ? token.raw : '';
		if (raw === '') {
			continue;
		}

		const start = normalized.indexOf(raw, offset);
		if (start < 0) {
			return [{ start: 0, end: body.length }];
		}

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

		units.push({ start: toOriginal(start), end: trimTrailingLineBreaks(body, toOriginal(start), toOriginal(end)) });
	}

	return units.filter(unit => unit.start < unit.end);
}

function normalizeLineEndings(body: string): { normalized: string; toOriginal: (index: number) => number } {
	if (!body.includes('\r')) {
		return { normalized: body, toOriginal: index => index };
	}

	const map: number[] = [];
	let normalized = '';
	let index = 0;
	while (index < body.length) {
		map.push(index);
		if (body.charCodeAt(index) === 13) {
			normalized += '\n';
			index += body.charCodeAt(index + 1) === 10 ? 2 : 1;
		} else {
			normalized += body[index];
			index += 1;
		}
	}
	map.push(body.length);

	return { normalized, toOriginal: position => map[Math.min(position, map.length - 1)] };
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

function htmlComments(markdown: string): string {
	return (markdown.match(/<!--[\s\S]*?-->/g) ?? []).join('\u0000');
}

function containsRawHtml(markdown: string): boolean {
	return /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?>/.test(markdown);
}

function isEmptyParagraph(block: { type?: string; content?: unknown }): boolean {
	if (!block || block.type !== 'paragraph') {
		return false;
	}

	const content = block.content;
	if (!Array.isArray(content) || content.length === 0) {
		return true;
	}

	return content.every(node =>
		(node as { type?: string; text?: string })?.type === 'text'
		&& ((node as { text?: string }).text ?? '') === ''
	);
}

function isDropped(blocks: readonly unknown[]): boolean {
	return blocks.length === 0 || blocks.every(block => isEmptyParagraph(block as { type?: string; content?: unknown }));
}

async function normalize(editor: IBaseHalfMarkdownEditorApi, blocks: unknown[]): Promise<string> {
	return (await editor.blocksToMarkdownLossy(blocks)).trimEnd();
}

function idOf(block: unknown): string | undefined {
	const id = (block as { id?: unknown }).id;
	return typeof id === 'string' ? id : undefined;
}

function isOwnMarker(source: string): boolean {
	return /^\s*<!--\s*bh:/.test(source);
}

function passthroughBlock(segment: IBaseHalfMarkdownSegment): unknown {
	return {
		type: BASEHALF_RAW_PASSTHROUGH_BLOCK,
		props: { raw: segment.raw, source: segment.source, hidden: isOwnMarker(segment.source) }
	};
}

const LIST_ITEM_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem']);

function ensureSynthesizedBlockBoundary(previousText: string | undefined, previousBlock: unknown, block: unknown, fresh: string): string {
	if (!previousText || fresh === '') {
		return fresh;
	}

	const previousType = (previousBlock as { type?: string } | undefined)?.type;
	const type = (block as { type?: string })?.type;
	const requiredBreaks = previousType === type && LIST_ITEM_TYPES.has(type ?? '') ? 1 : 2;
	const existingBreaks = countTrailingLineBreaks(previousText);
	if (existingBreaks >= requiredBreaks) {
		return fresh;
	}

	const eol = previousText.includes('\r\n') ? '\r\n' : '\n';
	return eol.repeat(requiredBreaks - existingBreaks) + fresh;
}

function countTrailingLineBreaks(value: string): number {
	let count = 0;
	let index = value.length;
	while (index > 0) {
		if (value.charCodeAt(index - 1) === 10) {
			index--;
			if (index > 0 && value.charCodeAt(index - 1) === 13) {
				index--;
			}
			count++;
			continue;
		}
		if (value.charCodeAt(index - 1) === 13) {
			index--;
			count++;
			continue;
		}
		break;
	}
	return count;
}

function defaultSep(block: unknown): string {
	return LIST_ITEM_TYPES.has((block as { type?: string }).type ?? '') ? '\n' : '\n\n';
}
