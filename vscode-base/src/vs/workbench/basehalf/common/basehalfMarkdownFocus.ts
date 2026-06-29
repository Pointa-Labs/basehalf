/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BASEHALF_RAW_PASSTHROUGH_BLOCK, IBaseHalfMarkdownReuseEntry } from './basehalfMarkdownProjection.js';

export interface IBaseHalfMarkdownFocusBlock {
	readonly id: string;
	readonly type?: string;
	readonly props?: { readonly raw?: string };
	readonly children?: readonly IBaseHalfMarkdownFocusBlock[];
}

export type BaseHalfMarkdownLinePrecision = 'exact' | 'block_start' | 'estimated';

export interface IBaseHalfMarkdownCursorInput {
	readonly blockId: string;
	readonly column: number;
	readonly codeWithinOffset?: number | null;
}

export interface IBaseHalfMarkdownFocusFields {
	readonly visible_lines?: { readonly start: number };
	readonly visible_blocks?: { readonly start: number };
	readonly cursor?: {
		readonly line: number;
		readonly column: number;
		readonly line_precision: BaseHalfMarkdownLinePrecision;
		readonly block?: number;
	};
}

const LIST_ITEM_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem']);

export function countBaseHalfMarkdownNewlines(source: string): number {
	let count = 0;
	for (let i = 0; i < source.length; i++) {
		if (source.charCodeAt(i) === 10) {
			count++;
		}
	}
	return count;
}

export function baseHalfMarkdownBlockFileLine(
	blocks: readonly IBaseHalfMarkdownFocusBlock[],
	targetId: string,
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	frontmatterLines: number
): number | null {
	let before = 0;
	for (const block of blocks) {
		if (baseHalfMarkdownSubtreeHasId(block, targetId)) {
			const entry = block.type === BASEHALF_RAW_PASSTHROUGH_BLOCK ? undefined : byId.get(block.id);
			const prefixNewlines = entry ? countBaseHalfMarkdownNewlines(entry.prefix) : 0;
			return frontmatterLines + before + prefixNewlines + 1;
		}
		before += baseHalfMarkdownTileNewlines(block, byId);
	}
	return null;
}

export function baseHalfMarkdownBlockOrdinal(blocks: readonly IBaseHalfMarkdownFocusBlock[], targetId: string): number | null {
	let seen = 0;
	const walk = (list: readonly IBaseHalfMarkdownFocusBlock[]): number | null => {
		for (const block of list) {
			seen++;
			if (block.id === targetId) {
				return seen;
			}
			if (block.children) {
				const found = walk(block.children);
				if (found !== null) {
					return found;
				}
			}
		}
		return null;
	};
	return walk(blocks);
}

export function baseHalfMarkdownTopLevelBlockOf(
	blocks: readonly IBaseHalfMarkdownFocusBlock[],
	targetId: string
): { readonly block: IBaseHalfMarkdownFocusBlock; readonly direct: boolean } | null {
	for (const block of blocks) {
		if (block.id === targetId) {
			return { block, direct: true };
		}
		if (block.children && baseHalfMarkdownSubtreeHasId(block, targetId)) {
			return { block, direct: false };
		}
	}
	return null;
}

export function baseHalfMarkdownTileSourceNewlines(entry: IBaseHalfMarkdownReuseEntry): number {
	return (
		countBaseHalfMarkdownNewlines(entry.raw)
		- countBaseHalfMarkdownNewlines(entry.prefix)
		- countBaseHalfMarkdownNewlines(entry.sep)
	);
}

export function refineBaseHalfMarkdownCursorLine(args: {
	readonly blockStart: number;
	readonly hasEntry: boolean;
	readonly blockSourceNewlines: number;
	readonly directHit: boolean;
	readonly codeWithinOffset: number | null;
}): { readonly line: number; readonly precision: BaseHalfMarkdownLinePrecision } {
	const { blockStart, hasEntry, blockSourceNewlines, directHit, codeWithinOffset } = args;
	if (!hasEntry) {
		return { line: blockStart, precision: 'estimated' };
	}
	if (blockSourceNewlines === 0) {
		return { line: blockStart, precision: 'exact' };
	}
	if (directHit && codeWithinOffset !== null) {
		return { line: blockStart + 1 + codeWithinOffset, precision: 'exact' };
	}
	return { line: blockStart, precision: 'block_start' };
}

export function baseHalfMarkdownBlockSourceSpan(
	blocks: readonly IBaseHalfMarkdownFocusBlock[],
	targetId: string,
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	frontmatterLines: number
): { readonly start: number; readonly end: number } | null {
	const start = baseHalfMarkdownBlockFileLine(blocks, targetId, byId, frontmatterLines);
	if (start === null) {
		return null;
	}

	const topLevel = baseHalfMarkdownTopLevelBlockOf(blocks, targetId);
	const entry = topLevel && topLevel.block.type !== BASEHALF_RAW_PASSTHROUGH_BLOCK ? byId.get(topLevel.block.id) : undefined;
	return { start, end: entry ? start + baseHalfMarkdownTileSourceNewlines(entry) : start };
}

export function baseHalfMarkdownBlockReadSpan(
	blocks: readonly IBaseHalfMarkdownFocusBlock[],
	targetId: string,
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	frontmatterLines: number
): { readonly start: number; readonly end: number } | null {
	const span = baseHalfMarkdownBlockSourceSpan(blocks, targetId, byId, frontmatterLines);
	if (span === null) {
		return null;
	}

	const topLevel = baseHalfMarkdownTopLevelBlockOf(blocks, targetId);
	if (!topLevel) {
		return span;
	}

	const index = blocks.findIndex(block => block.id === topLevel.block.id);
	const next = index >= 0 ? blocks[index + 1] : undefined;
	if (!next) {
		return span;
	}

	const nextStart = baseHalfMarkdownBlockFileLine(blocks, next.id, byId, frontmatterLines);
	if (nextStart === null) {
		return span;
	}

	return { start: span.start, end: Math.max(span.end, nextStart - 1) };
}

export function baseHalfMarkdownLinesToBlockIds(
	blocks: readonly IBaseHalfMarkdownFocusBlock[],
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>,
	frontmatterLines: number,
	ranges: readonly (readonly [number, number])[]
): string[] {
	if (ranges.length === 0) {
		return [];
	}

	const ids: string[] = [];
	let before = 0;
	for (const block of blocks) {
		const entry = block.type === BASEHALF_RAW_PASSTHROUGH_BLOCK ? undefined : byId.get(block.id);
		const prefixNewlines = entry ? countBaseHalfMarkdownNewlines(entry.prefix) : 0;
		const start = frontmatterLines + before + prefixNewlines + 1;
		const end = entry ? start + baseHalfMarkdownTileSourceNewlines(entry) : start;
		if (ranges.some(([rangeStart, rangeEnd]) => start <= rangeEnd && end >= rangeStart)) {
			ids.push(block.id);
		}
		before += baseHalfMarkdownTileNewlines(block, byId);
	}
	return ids;
}

export function buildBaseHalfMarkdownFocusFields(args: {
	readonly blocks: readonly IBaseHalfMarkdownFocusBlock[];
	readonly byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>;
	readonly frontmatterLines: number;
	readonly cursor?: IBaseHalfMarkdownCursorInput;
	readonly visibleBlockId?: string;
}): IBaseHalfMarkdownFocusFields {
	const fields: {
		visible_lines?: { start: number };
		visible_blocks?: { start: number };
		cursor?: { line: number; column: number; line_precision: BaseHalfMarkdownLinePrecision; block?: number };
	} = {};

	if (args.cursor) {
		const topLevel = baseHalfMarkdownTopLevelBlockOf(args.blocks, args.cursor.blockId);
		const blockStart = baseHalfMarkdownBlockFileLine(args.blocks, args.cursor.blockId, args.byId, args.frontmatterLines);
		if (topLevel && blockStart !== null) {
			const entry = topLevel.block.type === BASEHALF_RAW_PASSTHROUGH_BLOCK ? undefined : args.byId.get(topLevel.block.id);
			const refined = refineBaseHalfMarkdownCursorLine({
				blockStart,
				hasEntry: entry !== undefined,
				blockSourceNewlines: entry ? baseHalfMarkdownTileSourceNewlines(entry) : 0,
				directHit: topLevel.direct,
				codeWithinOffset: args.cursor.codeWithinOffset ?? null
			});
			const ordinal = baseHalfMarkdownBlockOrdinal(args.blocks, args.cursor.blockId);
			fields.cursor = {
				line: refined.line,
				column: args.cursor.column,
				line_precision: refined.precision,
				...(ordinal !== null ? { block: ordinal } : {})
			};
		}
	}

	if (args.visibleBlockId) {
		const line = baseHalfMarkdownBlockFileLine(args.blocks, args.visibleBlockId, args.byId, args.frontmatterLines);
		if (line !== null) {
			fields.visible_lines = { start: line };
		}
		const ordinal = baseHalfMarkdownBlockOrdinal(args.blocks, args.visibleBlockId);
		if (ordinal !== null) {
			fields.visible_blocks = { start: ordinal };
		}
	}

	return fields;
}

function baseHalfMarkdownTileNewlines(
	block: IBaseHalfMarkdownFocusBlock,
	byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>
): number {
	if (block.type === BASEHALF_RAW_PASSTHROUGH_BLOCK) {
		return countBaseHalfMarkdownNewlines(block.props?.raw ?? '');
	}
	const entry = byId.get(block.id);
	if (entry) {
		return countBaseHalfMarkdownNewlines(entry.raw);
	}
	return LIST_ITEM_TYPES.has(block.type ?? '') ? 1 : 2;
}

function baseHalfMarkdownSubtreeHasId(block: IBaseHalfMarkdownFocusBlock, targetId: string): boolean {
	if (block.id === targetId) {
		return true;
	}
	if (!block.children) {
		return false;
	}
	return block.children.some(child => baseHalfMarkdownSubtreeHasId(child, targetId));
}
