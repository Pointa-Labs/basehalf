/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { lexer, type Token, type Tokens } from '../../../base/common/marked/marked.js';

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

	const end = match.index + match[0].length;
	return { frontmatter: content.slice(0, end), body: content.slice(end) };
}

export function joinBaseHalfMarkdownFrontmatter(frontmatter: string, body: string): string {
	return frontmatter + body;
}

export function segmentBaseHalfMarkdownBody(body: string): IBaseHalfMarkdownSegment[] {
	if (body === '') {
		return [];
	}

	const units = collectUnits(body);
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
	let parsed: unknown[] = [];
	try {
		parsed = await editor.tryParseMarkdownToBlocks(segment.source);
	} catch {
		parsed = [];
	}
	parsed = projectBaseHalfStandaloneFileLink(segment.source, parsed);

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
	const tokens = lexer(source).filter(token => token.type !== 'space');
	if (tokens.length !== 1 || tokens[0].type !== 'paragraph') {
		return parsed;
	}
	const paragraph = tokens[0] as Tokens.Paragraph;
	const inline = paragraph.tokens.filter(token => token.type !== 'space');
	if (inline.length !== 1 || inline[0].type !== 'link') {
		return parsed;
	}
	const link = inline[0] as Tokens.Link;
	if (paragraph.text.trim() !== link.raw.trim() || !isBaseHalfLocalFileHref(link.href)) {
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
		contributions.push(entry
			? { id, text: entry.prefix + fresh + entry.sep, synthesized: false }
			: { id, text: fresh + defaultSep(block), synthesized: true });
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

function collectUnits(body: string): IBaseHalfMarkdownUnit[] {
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

		if (isListToken(token) && token.items.length > 0) {
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

function defaultSep(block: unknown): string {
	return LIST_ITEM_TYPES.has((block as { type?: string }).type ?? '') ? '\n' : '\n\n';
}
