/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { lexer, type Token, type Tokens } from '../../../base/common/marked/marked.js';

export const BASEHALF_RAW_PASSTHROUGH_BLOCK = 'rawPassthrough';

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
	return (
		baseHalfMarkdownContentTokens(source) !== baseHalfMarkdownContentTokens(normalized)
		|| htmlComments(source) !== htmlComments(normalized)
	);
}

export async function buildBaseHalfMarkdownLoadProjection(
	editor: IBaseHalfMarkdownEditorApi,
	body: string
): Promise<IBaseHalfMarkdownLoadProjection> {
	const segments = segmentBaseHalfMarkdownBody(body);
	const blocks: unknown[] = [];
	const byId = new Map<string, IBaseHalfMarkdownReuseEntry>();

	for (const segment of segments) {
		let parsed: unknown[] = [];
		try {
			parsed = await editor.tryParseMarkdownToBlocks(segment.source);
		} catch {
			parsed = [];
		}

		if (isDropped(parsed)) {
			blocks.push(passthroughBlock(segment));
			continue;
		}

		const key = await normalize(editor, parsed);
		if (baseHalfMarkdownLosesContent(segment.source, key)) {
			blocks.push(passthroughBlock(segment));
			continue;
		}

		if (parsed.length === 1) {
			const id = idOf(parsed[0]);
			if (id) {
				byId.set(id, { key, raw: segment.raw, prefix: segment.prefix, sep: segment.sep });
			}
		} else {
			parsed.forEach((block, index) => {
				const id = idOf(block);
				if (!id) {
					return;
				}

				byId.set(
					id,
					index === parsed.length - 1
						? { key, raw: segment.raw, prefix: segment.prefix, sep: segment.sep, multi: true }
						: { key, raw: '', prefix: '', sep: '', multi: true }
				);
			});
		}

		for (const block of parsed) {
			blocks.push(block);
		}
	}

	const hasEditable = blocks.some(block => (block as { type?: string }).type !== BASEHALF_RAW_PASSTHROUGH_BLOCK);
	if (!hasEditable) {
		blocks.push({ type: 'paragraph' });
	}

	return { blocks, byId };
}

export async function spliceBaseHalfMarkdownSave(
	editor: IBaseHalfMarkdownEditorApi,
	document: readonly unknown[],
	frontmatter: string,
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>
): Promise<string> {
	let out = '';
	let lastSynthesized = false;
	for (const block of document) {
		const typedBlock = block as { type?: string; props?: { raw?: string } };
		if (typedBlock.type === BASEHALF_RAW_PASSTHROUGH_BLOCK) {
			out += typedBlock.props?.raw ?? '';
			lastSynthesized = false;
			continue;
		}

		const id = idOf(block);
		const found = id ? byId.get(id) : undefined;
		const entry = found && !found.multi ? found : undefined;
		if (entry && (await normalize(editor, [block])) === entry.key) {
			out += entry.raw;
			lastSynthesized = false;
			continue;
		}

		const fresh = (await editor.blocksToMarkdownLossy([block])).trimEnd();
		if (entry) {
			out += entry.prefix + fresh + entry.sep;
			lastSynthesized = false;
		} else {
			out += fresh + defaultSep(block);
			lastSynthesized = true;
		}
	}

	if (lastSynthesized) {
		out = out.replace(/\n+$/, '\n');
	}

	if (frontmatter !== '' && out !== '' && !/\n$/.test(frontmatter)) {
		const eol = frontmatter.includes('\r\n') ? '\r\n' : '\n';
		return frontmatter + eol + out;
	}

	return frontmatter + out;
}

function collectUnits(body: string): IBaseHalfMarkdownUnit[] {
	let tokens: Token[];
	try {
		tokens = [...lexer(body, { gfm: true })];
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

		const start = body.indexOf(raw, offset);
		if (start < 0) {
			return [{ start: 0, end: body.length }];
		}

		const end = start + raw.length;
		offset = end;
		if (token.type === 'space') {
			continue;
		}

		if (isListToken(token) && token.items.length > 0) {
			const listUnits = collectListItemUnits(body, token, start, end);
			if (listUnits.length === token.items.length) {
				units.push(...listUnits);
			} else {
				units.push({ start, end: trimTrailingLineBreaks(body, start, end) });
			}
			continue;
		}

		units.push({ start, end: trimTrailingLineBreaks(body, start, end) });
	}

	return units.filter(unit => unit.start < unit.end);
}

function isListToken(token: Token): token is Tokens.List {
	return token.type === 'list' && Array.isArray((token as Partial<Tokens.List>).items);
}

function collectListItemUnits(body: string, token: Tokens.List, listStart: number, listEnd: number): IBaseHalfMarkdownUnit[] {
	const units: IBaseHalfMarkdownUnit[] = [];
	let itemOffset = listStart;
	for (const item of token.items) {
		const start = body.indexOf(item.raw, itemOffset);
		if (start < itemOffset || start >= listEnd) {
			return [];
		}

		const rawEnd = start + item.raw.length;
		if (rawEnd > listEnd) {
			return [];
		}

		const end = trimTrailingLineBreaks(body, start, rawEnd);
		if (start < end) {
			units.push({ start, end });
		}
		itemOffset = rawEnd;
	}

	return units;
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
