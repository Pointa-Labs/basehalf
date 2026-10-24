/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	BASEHALF_CANVAS_DEFAULT_WIDTH,
	BASEHALF_CANVAS_GRID_COLUMN_GAP,
	BASEHALF_CANVAS_GRID_ROW_GAP,
	BaseHalfCanvasAnchor,
	baseHalfCanvasAnchorPoint,
	baseHalfCanvasEdgeCurve,
	baseHalfCanvasPlainGridColumns,
	IBaseHalfCanvasPosition
} from './basehalfCanvasModel.js';

/**
 * Selection geometry, the arrangements of a set, and the layout of a tidied
 * canvas (docs/specs/canvas-selection-and-arrangement.md). Every function
 * here works on plain rectangles in flow pixels and uses no service.
 */

/** A rectangle on a canvas, in flow pixels. */
export interface IBaseHalfCanvasArrangeRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** A card with the rectangle of its row. */
export interface IBaseHalfCanvasArrangeCard extends IBaseHalfCanvasArrangeRect {
	readonly path: string;
}

/** A connection between two cards of one canvas, from upstream to downstream. */
export interface IBaseHalfCanvasArrangeConnection {
	readonly from: string;
	readonly to: string;
}

/** The line of a connection: from an anchor of one card rectangle to an anchor of another. */
export interface IBaseHalfCanvasArrangeLine {
	readonly id: string;
	readonly from: IBaseHalfCanvasArrangeRect;
	readonly fromAnchor: BaseHalfCanvasAnchor;
	readonly to: IBaseHalfCanvasArrangeRect;
	readonly toAnchor: BaseHalfCanvasAnchor;
}

/** The place that an arrangement or a tidy gives a card. */
export interface IBaseHalfCanvasArrangePlace {
	readonly path: string;
	readonly x: number;
	readonly y: number;
}

export type BaseHalfCanvasArrangement = 'grid' | 'row' | 'column';

export type BaseHalfCanvasSelectionState = 'nothing' | 'card' | 'set' | 'connections';

/** The distance between the columns of a group and between the blocks of a tidied canvas. */
export const BASEHALF_CANVAS_TIDY_WIDE_GAP = 120;

/** A row of blocks is not made wider than this once it holds a block. */
const BASEHALF_CANVAS_TIDY_ROW_WIDTH = BASEHALF_CANVAS_DEFAULT_WIDTH;

/**
 * The state of a selection. It follows from what is selected alone, never from
 * how it was selected.
 */
export function baseHalfCanvasSelectionState(cardCount: number, connectionCount: number): BaseHalfCanvasSelectionState {
	if (cardCount >= 2) {
		return 'set';
	}
	if (cardCount === 1) {
		return 'card';
	}
	return connectionCount > 0 ? 'connections' : 'nothing';
}

/** Whether two rectangles share any area. Rectangles that only touch share none. */
export function baseHalfCanvasRectsShareArea(a: IBaseHalfCanvasArrangeRect, b: IBaseHalfCanvasArrangeRect): boolean {
	return a.x < b.x + b.width
		&& a.x + a.width > b.x
		&& a.y < b.y + b.height
		&& a.y + a.height > b.y;
}

/** The paths of the cards that a marquee touches, in the order of `cards`. */
export function baseHalfCanvasCardsInMarquee(cards: readonly IBaseHalfCanvasArrangeCard[], marquee: IBaseHalfCanvasArrangeRect): string[] {
	const paths: string[] = [];
	for (const card of cards) {
		if (baseHalfCanvasRectsShareArea(card, marquee)) {
			paths.push(card.path);
		}
	}
	return paths;
}

/** The straight pieces a line is cut into when it is tested against a marquee. */
const BASEHALF_CANVAS_LINE_PIECES = 64;

/**
 * The ids of the lines that a marquee crosses, in the order of `lines`. A line
 * is crossed when a point of the curve the canvas draws for it lies in the
 * marquee or on its border, also when that point is one of its ends.
 */
export function baseHalfCanvasLinesInMarquee(lines: readonly IBaseHalfCanvasArrangeLine[], marquee: IBaseHalfCanvasArrangeRect): string[] {
	const ids: string[] = [];
	for (const line of lines) {
		const curve = baseHalfCanvasEdgeCurve(
			baseHalfCanvasAnchorPoint(line.from, line.fromAnchor),
			line.fromAnchor,
			baseHalfCanvasAnchorPoint(line.to, line.toAnchor),
			line.toAnchor
		);
		if (curveCrossesRect(curve, marquee)) {
			ids.push(line.id);
		}
	}
	return ids;
}

function curveCrossesRect(curve: readonly IBaseHalfCanvasPosition[], rect: IBaseHalfCanvasArrangeRect): boolean {
	// The curve lies inside the rectangle that holds its four points.
	const xs = curve.map(point => point.x);
	const ys = curve.map(point => point.y);
	if (Math.max(...xs) < rect.x || Math.min(...xs) > rect.x + rect.width
		|| Math.max(...ys) < rect.y || Math.min(...ys) > rect.y + rect.height) {
		return false;
	}
	let previous = curve[0];
	for (let piece = 1; piece <= BASEHALF_CANVAS_LINE_PIECES; piece++) {
		const point = cubicPoint(curve, piece / BASEHALF_CANVAS_LINE_PIECES);
		if (segmentCrossesRect(previous, point, rect)) {
			return true;
		}
		previous = point;
	}
	return false;
}

function cubicPoint(curve: readonly IBaseHalfCanvasPosition[], t: number): IBaseHalfCanvasPosition {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return {
		x: a * curve[0].x + b * curve[1].x + c * curve[2].x + d * curve[3].x,
		y: a * curve[0].y + b * curve[1].y + c * curve[2].y + d * curve[3].y
	};
}

/** Whether a straight piece has a point in a rectangle or on its border (Liang–Barsky). */
function segmentCrossesRect(start: IBaseHalfCanvasPosition, end: IBaseHalfCanvasPosition, rect: IBaseHalfCanvasArrangeRect): boolean {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	let low = 0;
	let high = 1;
	const sides: readonly (readonly [number, number])[] = [
		[-dx, start.x - rect.x],
		[dx, rect.x + rect.width - start.x],
		[-dy, start.y - rect.y],
		[dy, rect.y + rect.height - start.y]
	];
	for (const [direction, room] of sides) {
		if (direction === 0) {
			if (room < 0) {
				return false;
			}
			continue;
		}
		const t = room / direction;
		if (direction < 0) {
			low = Math.max(low, t);
		} else {
			high = Math.min(high, t);
		}
		if (low > high) {
			return false;
		}
	}
	return true;
}

/** The smallest rectangle that holds all of `rects`. */
export function baseHalfCanvasBoundingRect(rects: readonly IBaseHalfCanvasArrangeRect[]): IBaseHalfCanvasArrangeRect | undefined {
	if (rects.length === 0) {
		return undefined;
	}
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const rect of rects) {
		left = Math.min(left, rect.x);
		top = Math.min(top, rect.y);
		right = Math.max(right, rect.x + rect.width);
		bottom = Math.max(bottom, rect.y + rect.height);
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The order in which an arrangement reads the cards of a set: row by row, and
 * from left to right in a row. A card belongs to the row of the card that
 * began it when its top edge is above that card's vertical middle. Cards that
 * are equal in every edge that counts keep the order of `cards`, which is
 * list order.
 */
export function baseHalfCanvasArrangeOrder<T extends IBaseHalfCanvasArrangeCard>(cards: readonly T[]): T[] {
	const indexed = cards.map((card, index) => ({ card, index }));
	indexed.sort((a, b) => a.card.y - b.card.y || a.card.x - b.card.x || a.index - b.index);
	const ordered: T[] = [];
	let row: typeof indexed = [];
	const flushRow = (): void => {
		row.sort((a, b) => a.card.x - b.card.x || a.index - b.index);
		for (const entry of row) {
			ordered.push(entry.card);
		}
		row = [];
	};
	for (const entry of indexed) {
		const first = row[0]?.card;
		if (first && entry.card.y >= first.y + first.height / 2) {
			flushRow();
		}
		row.push(entry);
	}
	flushRow();
	return ordered;
}

interface IGridLayout {
	readonly places: IBaseHalfCanvasArrangePlace[];
	readonly width: number;
	readonly height: number;
}

/**
 * A grid that `cards` fill row by row from `originX`, `originY`. A column is as
 * wide as its widest card and a row as high as its highest card. A card stands
 * at the left and the top of its cell.
 */
function gridLayout(cards: readonly IBaseHalfCanvasArrangeCard[], columns: number, originX: number, originY: number): IGridLayout {
	const cols = Math.max(1, Math.min(columns, cards.length));
	const columnWidths: number[] = [];
	const rowHeights: number[] = [];
	cards.forEach((card, index) => {
		const column = index % cols;
		const rowIndex = Math.floor(index / cols);
		columnWidths[column] = Math.max(columnWidths[column] ?? 0, card.width);
		rowHeights[rowIndex] = Math.max(rowHeights[rowIndex] ?? 0, card.height);
	});
	const columnLefts: number[] = [];
	let left = 0;
	for (const width of columnWidths) {
		columnLefts.push(left);
		left += width + BASEHALF_CANVAS_GRID_COLUMN_GAP;
	}
	const rowTops: number[] = [];
	let top = 0;
	for (const height of rowHeights) {
		rowTops.push(top);
		top += height + BASEHALF_CANVAS_GRID_ROW_GAP;
	}
	return {
		places: cards.map((card, index) => ({
			path: card.path,
			x: originX + columnLefts[index % cols],
			y: originY + rowTops[Math.floor(index / cols)]
		})),
		width: cards.length === 0 ? 0 : left - BASEHALF_CANVAS_GRID_COLUMN_GAP,
		height: cards.length === 0 ? 0 : top - BASEHALF_CANVAS_GRID_ROW_GAP
	};
}

/**
 * The places of the cards of a set after an arrangement. The result starts at
 * the upper left corner of the set's box. No size changes, and cards outside
 * the set are not looked at.
 */
export function baseHalfCanvasArrange(arrangement: BaseHalfCanvasArrangement, cards: readonly IBaseHalfCanvasArrangeCard[]): IBaseHalfCanvasArrangePlace[] {
	const box = baseHalfCanvasBoundingRect(cards);
	if (!box) {
		return [];
	}
	const ordered = baseHalfCanvasArrangeOrder(cards);
	if (arrangement === 'grid') {
		return gridLayout(ordered, Math.ceil(Math.sqrt(ordered.length)), box.x, box.y).places;
	}
	const places: IBaseHalfCanvasArrangePlace[] = [];
	let x = box.x;
	let y = box.y;
	for (const card of ordered) {
		places.push({ path: card.path, x, y });
		if (arrangement === 'row') {
			x += card.width + BASEHALF_CANVAS_GRID_COLUMN_GAP;
		} else {
			y += card.height + BASEHALF_CANVAS_GRID_ROW_GAP;
		}
	}
	return places;
}

interface IBlock {
	/** Places relative to the block's upper left corner. */
	readonly places: readonly IBaseHalfCanvasArrangePlace[];
	readonly width: number;
	readonly height: number;
}

/**
 * The connections of a group that its layout follows: each one once, and
 * without the ones that close a circle. Going through the cards in list order
 * and following each connection downstream, a connection that leads back to a
 * card on the way there is left out.
 */
function layoutConnections(group: readonly number[], downstream: ReadonlyMap<number, readonly number[]>): Map<number, number[]> {
	const kept = new Map<number, number[]>();
	const onTheWay = new Set<number>();
	const done = new Set<number>();
	const visit = (card: number): void => {
		onTheWay.add(card);
		const next: number[] = [];
		for (const target of downstream.get(card) ?? []) {
			if (onTheWay.has(target)) {
				continue;
			}
			next.push(target);
			if (!done.has(target)) {
				visit(target);
			}
		}
		kept.set(card, next);
		onTheWay.delete(card);
		done.add(card);
	};
	for (const card of group) {
		if (!done.has(card)) {
			visit(card);
		}
	}
	return kept;
}

/** A group laid out from left to right along its connections. */
function groupBlock(group: readonly number[], cards: readonly IBaseHalfCanvasArrangeCard[], downstream: ReadonlyMap<number, readonly number[]>): IBlock {
	const kept = layoutConnections(group, downstream);
	const upstream = new Map<number, number[]>();
	for (const card of group) {
		upstream.set(card, []);
	}
	for (const [from, targets] of kept) {
		for (const target of targets) {
			upstream.get(target)!.push(from);
		}
	}

	// A card that no connection leads to is in the first column. Every other
	// card is one column to the right of the rightmost card that leads to it.
	const columnOf = new Map<number, number>();
	const resolveColumn = (card: number): number => {
		const known = columnOf.get(card);
		if (known !== undefined) {
			return known;
		}
		let column = 0;
		for (const from of upstream.get(card)!) {
			column = Math.max(column, resolveColumn(from) + 1);
		}
		columnOf.set(card, column);
		return column;
	};
	const columns: number[][] = [];
	for (const card of group) {
		const column = resolveColumn(card);
		(columns[column] ??= []).push(card);
	}

	// The first column is in list order, which is the order of `group`. In every
	// further column a card comes first when the uppermost card that leads to it
	// from the column before stands higher.
	const rankOf = new Map<number, number>();
	columns.forEach((column, columnIndex) => {
		if (columnIndex > 0) {
			const leaderRank = (card: number): number => {
				let rank = Infinity;
				for (const from of upstream.get(card)!) {
					if (columnOf.get(from) === columnIndex - 1) {
						rank = Math.min(rank, rankOf.get(from)!);
					}
				}
				return rank;
			};
			column.sort((a, b) => leaderRank(a) - leaderRank(b) || a - b);
		}
		column.forEach((card, rank) => rankOf.set(card, rank));
	});

	const columnHeights = columns.map(column => column.reduce((sum, card) => sum + cards[card].height, 0)
		+ (column.length - 1) * BASEHALF_CANVAS_GRID_ROW_GAP);
	const height = Math.max(...columnHeights);
	const places: IBaseHalfCanvasArrangePlace[] = [];
	let left = 0;
	columns.forEach((column, columnIndex) => {
		// Every column is centred on the same horizontal line.
		let top = Math.round((height - columnHeights[columnIndex]) / 2);
		let width = 0;
		for (const card of column) {
			places.push({ path: cards[card].path, x: left, y: top });
			top += cards[card].height + BASEHALF_CANVAS_GRID_ROW_GAP;
			width = Math.max(width, cards[card].width);
		}
		left += width + BASEHALF_CANVAS_TIDY_WIDE_GAP;
	});
	return { places, width: left - BASEHALF_CANVAS_TIDY_WIDE_GAP, height };
}

/**
 * The places of all cards of a canvas after it is tidied. `cards` are in list
 * order. Each group of connected cards is laid out from left to right along
 * its connections, the groups follow each other in rows, and the cards without
 * a connection make a grid after them. The result starts at the upper left
 * corner of the smallest rectangle that held all cards before. The same cards,
 * sizes, connections, and order always give the same places, so tidying a
 * tidied canvas moves nothing.
 */
export function baseHalfCanvasTidy(cards: readonly IBaseHalfCanvasArrangeCard[], connections: readonly IBaseHalfCanvasArrangeConnection[]): IBaseHalfCanvasArrangePlace[] {
	const origin = baseHalfCanvasBoundingRect(cards);
	if (!origin) {
		return [];
	}
	const indexOf = new Map(cards.map((card, index) => [card.path, index]));
	const downstream = new Map<number, number[]>();
	const neighbours = new Map<number, Set<number>>();
	const link = (card: number, neighbour: number): void => {
		let known = neighbours.get(card);
		if (!known) {
			known = new Set();
			neighbours.set(card, known);
		}
		known.add(neighbour);
	};
	for (const connection of connections) {
		const from = indexOf.get(connection.from);
		const to = indexOf.get(connection.to);
		if (from === undefined || to === undefined || from === to) {
			continue;
		}
		const targets = downstream.get(from) ?? [];
		if (!targets.includes(to)) {
			targets.push(to);
			downstream.set(from, targets);
		}
		link(from, to);
		link(to, from);
	}
	for (const targets of downstream.values()) {
		targets.sort((a, b) => a - b);
	}

	// Groups in the list order of their first cards; the cards of a group in
	// list order.
	const groups: number[][] = [];
	const singles: number[] = [];
	const seen = new Set<number>();
	cards.forEach((_card, index) => {
		if (seen.has(index)) {
			return;
		}
		if (!neighbours.has(index)) {
			singles.push(index);
			return;
		}
		const group: number[] = [];
		const queue = [index];
		seen.add(index);
		while (queue.length > 0) {
			const card = queue.shift()!;
			group.push(card);
			for (const neighbour of neighbours.get(card) ?? []) {
				if (!seen.has(neighbour)) {
					seen.add(neighbour);
					queue.push(neighbour);
				}
			}
		}
		groups.push(group.sort((a, b) => a - b));
	});

	const blocks: IBlock[] = groups.map(group => groupBlock(group, cards, downstream));
	if (singles.length > 0) {
		blocks.push(gridLayout(singles.map(index => cards[index]), baseHalfCanvasPlainGridColumns(singles.length), 0, 0));
	}

	// Blocks stand side by side with their top edges level. A block begins a
	// new row when the row has a block and would become too wide with it.
	const places: IBaseHalfCanvasArrangePlace[] = [];
	let rowLeft = 0;
	let rowTop = 0;
	let rowHeight = 0;
	for (const block of blocks) {
		if (rowLeft > 0 && rowLeft + block.width > BASEHALF_CANVAS_TIDY_ROW_WIDTH) {
			rowTop += rowHeight + BASEHALF_CANVAS_TIDY_WIDE_GAP;
			rowLeft = 0;
			rowHeight = 0;
		}
		for (const place of block.places) {
			places.push({ path: place.path, x: origin.x + rowLeft + place.x, y: origin.y + rowTop + place.y });
		}
		rowLeft += block.width + BASEHALF_CANVAS_TIDY_WIDE_GAP;
		rowHeight = Math.max(rowHeight, block.height);
	}
	return places;
}
