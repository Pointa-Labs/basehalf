/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BASEHALF_RAW_PASSTHROUGH_BLOCK, IBaseHalfMarkdownReuseEntry } from './basehalfMarkdownProjection.js';

/**
 * Source-line mapping for rich-editor blocks: which Markdown source lines a
 * rendered block occupies. ADHD reading aids (read spans and read-block
 * projection) and selection reveal use it.
 */
export interface IBaseHalfMarkdownBlockNode {
	readonly id: string;
	readonly type?: string;
	readonly props?: { readonly raw?: string };
	readonly children?: readonly IBaseHalfMarkdownBlockNode[];
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
	blocks: readonly IBaseHalfMarkdownBlockNode[],
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

export function baseHalfMarkdownTopLevelBlockOf(
	blocks: readonly IBaseHalfMarkdownBlockNode[],
	targetId: string
): { readonly block: IBaseHalfMarkdownBlockNode; readonly direct: boolean } | null {
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

export function baseHalfMarkdownBlockSourceSpan(
	blocks: readonly IBaseHalfMarkdownBlockNode[],
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
	blocks: readonly IBaseHalfMarkdownBlockNode[],
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
	blocks: readonly IBaseHalfMarkdownBlockNode[],
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

function baseHalfMarkdownTileNewlines(
	block: IBaseHalfMarkdownBlockNode,
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

function baseHalfMarkdownSubtreeHasId(block: IBaseHalfMarkdownBlockNode, targetId: string): boolean {
	if (block.id === targetId) {
		return true;
	}
	if (!block.children) {
		return false;
	}
	return block.children.some(child => baseHalfMarkdownSubtreeHasId(child, targetId));
}
