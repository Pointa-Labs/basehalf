/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export type IBaseHalfAdhdLineRange = readonly [start: number, end: number];

/**
 * How `read_paragraphs` count lines. `body`: from the first body line after
 * the frontmatter the BaseHalf recognizer accepts, or from line 1 when there
 * is none, so upstream edits in the frontmatter never shift read ranges. A
 * file without `line_base` holds absolute file lines from earlier releases.
 */
export type BaseHalfAdhdLineBase = 'body';

/** The `line_base` every ADHD write records. */
export const BASEHALF_ADHD_LINE_BASE: BaseHalfAdhdLineBase = 'body';

export interface IBaseHalfAdhdFile {
	readonly path: string;
	readonly kind: 'file';
	/** Present (as `body`) whenever `read_paragraphs` is: the ranges are body-relative. */
	readonly line_base?: BaseHalfAdhdLineBase;
	readonly highlight_keywords?: readonly string[];
	readonly read_paragraphs?: readonly IBaseHalfAdhdLineRange[];
}

export type IBaseHalfAdhdCommand =
	| {
		readonly command: 'addKeyword' | 'removeKeyword';
		readonly keyword: string;
	}
	| {
		readonly command: 'markRead' | 'markUnread';
		readonly start: number;
		readonly end: number;
	};

export function assertBaseHalfAdhdRange(start: number, end: number): void {
	if (!Number.isInteger(start) || !Number.isInteger(end)) {
		throw new Error(`ADHD line ranges must use integers, got [${start}, ${end}]`);
	}
	if (start < 1) {
		throw new Error(`ADHD line ranges are 1-based, got start=${start}`);
	}
	if (end < start) {
		throw new Error(`ADHD range end (${end}) is before start (${start})`);
	}
}

export function normalizeBaseHalfAdhdRanges(ranges: readonly IBaseHalfAdhdLineRange[]): IBaseHalfAdhdLineRange[] {
	for (const range of ranges) {
		if (!Array.isArray(range) || range.length !== 2) {
			throw new Error(`ADHD read_paragraphs entries must be [start, end] pairs, got ${JSON.stringify(range)}`);
		}
		assertBaseHalfAdhdRange(range[0], range[1]);
	}

	const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const out: [number, number][] = [];
	for (const [start, end] of sorted) {
		const last = out[out.length - 1];
		if (last && start <= last[1] + 1) {
			last[1] = Math.max(last[1], end);
		} else {
			out.push([start, end]);
		}
	}
	return out;
}

export function mergeBaseHalfAdhdRange(
	ranges: readonly IBaseHalfAdhdLineRange[],
	start: number,
	end: number
): IBaseHalfAdhdLineRange[] {
	assertBaseHalfAdhdRange(start, end);
	return normalizeBaseHalfAdhdRanges([...ranges, [start, end]]);
}

export function subtractBaseHalfAdhdRange(
	ranges: readonly IBaseHalfAdhdLineRange[],
	start: number,
	end: number
): IBaseHalfAdhdLineRange[] {
	assertBaseHalfAdhdRange(start, end);
	const out: [number, number][] = [];
	for (const [currentStart, currentEnd] of normalizeBaseHalfAdhdRanges(ranges)) {
		if (currentEnd < start || currentStart > end) {
			out.push([currentStart, currentEnd]);
			continue;
		}
		if (currentStart < start) {
			out.push([currentStart, start - 1]);
		}
		if (currentEnd > end) {
			out.push([end + 1, currentEnd]);
		}
	}
	return out;
}

export function dedupeBaseHalfAdhdKeywords(keywords: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const keyword of keywords) {
		const trimmed = keyword.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

/**
 * Builds an ADHD file whose `read_paragraphs` are body-relative. Every
 * range-carrying file records `line_base: body`.
 */
export function buildBaseHalfAdhdFile(
	path: string,
	keywords: readonly string[] | undefined,
	ranges: readonly IBaseHalfAdhdLineRange[] | undefined
): IBaseHalfAdhdFile {
	const normalizedKeywords = keywords ? dedupeBaseHalfAdhdKeywords(keywords) : [];
	const normalizedRanges = ranges ? normalizeBaseHalfAdhdRanges(ranges) : [];
	return {
		path,
		kind: 'file',
		...(normalizedRanges.length > 0 ? { line_base: BASEHALF_ADHD_LINE_BASE } : {}),
		...(normalizedKeywords.length > 0 ? { highlight_keywords: normalizedKeywords } : {}),
		...(normalizedRanges.length > 0 ? { read_paragraphs: normalizedRanges } : {})
	};
}

/**
 * Converts the absolute file-line ranges of an `adhd.yaml` without
 * `line_base` (earlier releases) into body-relative ranges by subtracting the
 * document's current frontmatter line count. Lines inside the frontmatter
 * are not body lines: a range that ends there is dropped, and one that starts
 * there begins at body line 1.
 */
export function convertBaseHalfAdhdLegacyRanges(ranges: readonly IBaseHalfAdhdLineRange[], frontmatterLines: number): IBaseHalfAdhdLineRange[] {
	const shift = Math.max(0, Math.floor(frontmatterLines));
	const out: [number, number][] = [];
	for (const [start, end] of ranges) {
		const nextEnd = end - shift;
		if (nextEnd < 1) {
			continue;
		}
		out.push([Math.max(1, start - shift), nextEnd]);
	}
	return normalizeBaseHalfAdhdRanges(out);
}

export function isBaseHalfAdhdEmpty(file: IBaseHalfAdhdFile): boolean {
	return (file.highlight_keywords?.length ?? 0) === 0
		&& (file.read_paragraphs?.length ?? 0) === 0;
}

export function baseHalfAdhdKeywordHits(text: string, keywords: readonly string[]): Array<readonly [start: number, end: number]> {
	const normalized = keywords.map(keyword => keyword.trim()).filter(keyword => keyword.length > 0);
	if (text.length === 0 || normalized.length === 0) {
		return [];
	}

	const lower = text.toLowerCase();
	const hits: Array<[number, number]> = [];
	for (const keyword of normalized) {
		const needle = keyword.toLowerCase();
		let from = 0;
		while (from <= lower.length) {
			const index = lower.indexOf(needle, from);
			if (index === -1) {
				break;
			}
			hits.push([index, index + needle.length]);
			from = index + needle.length;
		}
	}

	if (hits.length === 0) {
		return [];
	}

	hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged: Array<[number, number]> = [];
	for (const [start, end] of hits) {
		const last = merged[merged.length - 1];
		if (last && start <= last[1]) {
			last[1] = Math.max(last[1], end);
		} else {
			merged.push([start, end]);
		}
	}
	return merged;
}

export function isBaseHalfAdhdFile(value: unknown): value is IBaseHalfAdhdFile {
	if (!isObject(value)) {
		return false;
	}

	const file = value as Partial<IBaseHalfAdhdFile>;
	return typeof file.path === 'string'
		&& file.kind === 'file'
		&& (file.line_base === undefined || file.line_base === BASEHALF_ADHD_LINE_BASE)
		&& (file.highlight_keywords === undefined || isStringArray(file.highlight_keywords))
		&& (file.read_paragraphs === undefined || isRangeArray(file.read_paragraphs));
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isRangeArray(value: unknown): value is readonly IBaseHalfAdhdLineRange[] {
	return Array.isArray(value) && value.every(item =>
		Array.isArray(item)
		&& item.length === 2
		&& Number.isInteger(item[0])
		&& Number.isInteger(item[1])
		&& item[0] > 0
		&& item[1] >= item[0]
	);
}

function isObject(value: unknown): value is object {
	return typeof value === 'object' && value !== null;
}
