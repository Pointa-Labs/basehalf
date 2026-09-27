/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../base/common/resources.js';
import { IFileStat } from '../../../platform/files/common/files.js';

export const BASEHALF_CANVAS_CHILD_LIMIT = 300;
export const BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH = 300;
export const BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT = 220;
export const BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH = 248;
export const BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT = 188;
export const BASEHALF_CANVAS_MIN_CARD_WIDTH = 140;
export const BASEHALF_CANVAS_MIN_CARD_HEIGHT = 48;
export const BASEHALF_CANVAS_DEFAULT_WIDTH = 2400;
export const BASEHALF_CANVAS_DEFAULT_HEIGHT = 1600;
const BASEHALF_CANVAS_GRID_COLUMN_GAP = 40;
const BASEHALF_CANVAS_GRID_ROW_GAP = 60;
const BASEHALF_CANVAS_DEFAULT_PADDING = 96;

const SKIP_NAMES = new Set([
	'.git',
	'.bh',
	'.DS_Store',
	'Thumbs.db',
	'.idea',
	'.vscode',
	'.turbo',
	'.next',
	'.nuxt',
	'.svelte-kit',
	'node_modules',
	'dist',
	'build',
	'out',
	'__pycache__',
	'.pytest_cache',
	'target',
	'vendor'
]);

const HIDDEN_FILE_NAMES = new Set([
	'.DS_Store',
	'Thumbs.db',
	'desktop.ini'
]);

const AGENT_HINT_FILES = new Set(['CLAUDE.md', 'AGENTS.md']);

export type BaseHalfCanvasItemKind = 'file' | 'folder';
export type BaseHalfCanvasAnchor = 'north' | 'east' | 'south' | 'west';

export interface IBaseHalfCanvasSize {
	readonly width: number;
	readonly height: number;
}

export interface IBaseHalfCanvasCard {
	readonly path: string;
	readonly kind: BaseHalfCanvasItemKind;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * The human-authored part of a node's `badge.yaml`: its one-line description
 * and the orphan flag. References are not badge metadata (D37); they live in
 * the downstream node's own upstream list.
 */
export interface IBaseHalfCanvasBadgeMetadata {
	readonly description?: string;
	readonly orphan?: boolean;
}

/**
 * A card's connections, derived from the reference index (D37). The canvas
 * never stores them.
 */
export interface IBaseHalfCanvasItemRelationships {
	/**
	 * Workspace-relative paths of the nodes this card's valid, non-dangling
	 * upstream entries name, in list order. An entry that names a sibling card
	 * is spelled exactly like that card's path, so edges can be derived by path.
	 */
	readonly upstream: readonly string[];
	/** Workspace-relative paths of the nodes whose upstream lists name this card. */
	readonly downstream: readonly string[];
	/** Warning rows of this card's Upstream list plus store-level issues. */
	readonly issueCount: number;
}

export interface IBaseHalfCanvasEdge {
	readonly from: string;
	readonly from_anchor: BaseHalfCanvasAnchor;
	readonly to: string;
	readonly to_anchor: BaseHalfCanvasAnchor;
}

export interface IBaseHalfCanvasFile {
	readonly path: string;
	readonly size?: IBaseHalfCanvasSize;
	readonly cards: readonly IBaseHalfCanvasCard[];
	readonly edges: readonly IBaseHalfCanvasEdge[];
}

export interface IBaseHalfCanvasItem {
	readonly path: string;
	readonly name: string;
	readonly kind: BaseHalfCanvasItemKind;
	readonly stat: IFileStat;
	readonly card?: IBaseHalfCanvasCard;
	readonly badge?: IBaseHalfCanvasBadgeMetadata;
	/** Present when the card has upstream or downstream connections or issues. */
	readonly relationships?: IBaseHalfCanvasItemRelationships;
}

/**
 * A canvas geometry or badge refresh rebuilds the scene model even when the
 * underlying file did not change. In that case the already-hydrated preview is
 * still valid and must be kept instead of flashing the loading placeholder.
 *
 * Providers do not have to expose an etag. Fall back to resolved modification
 * metadata, but fail closed when there is no usable version signal.
 */
export function baseHalfCanvasItemsSharePreviewVersion(
	previous: IBaseHalfCanvasItem,
	current: IBaseHalfCanvasItem
): boolean {
	if (previous.path !== current.path
		|| previous.name !== current.name
		|| previous.kind !== current.kind
		|| previous.stat.resource.toString() !== current.stat.resource.toString()
		|| previous.stat.isFile !== current.stat.isFile
		|| previous.stat.isDirectory !== current.stat.isDirectory
		|| previous.stat.isSymbolicLink !== current.stat.isSymbolicLink) {
		return false;
	}

	const previousEtag = previous.stat.etag;
	const currentEtag = current.stat.etag;
	if (previousEtag !== undefined || currentEtag !== undefined) {
		return previousEtag !== undefined && previousEtag === currentEtag;
	}
	if (previous.stat.mtime === undefined || current.stat.mtime === undefined
		|| previous.stat.mtime !== current.stat.mtime) {
		return false;
	}
	if (current.stat.isFile) {
		return previous.stat.size !== undefined
			&& previous.stat.size === current.stat.size;
	}
	return true;
}

export interface IBaseHalfCanvasPosition {
	readonly x: number;
	readonly y: number;
}

export interface IBaseHalfCanvasBounds extends IBaseHalfCanvasPosition {
	readonly width: number;
	readonly height: number;
}

export interface IBaseHalfCanvasEdgeLayout {
	readonly edge: IBaseHalfCanvasEdge;
	readonly from: IBaseHalfCanvasPosition;
	readonly to: IBaseHalfCanvasPosition;
	readonly path: string;
}

export interface IBaseHalfCanvasEdgeLayoutResult {
	readonly edges: readonly IBaseHalfCanvasEdgeLayout[];
	readonly dropped: number;
}

export interface IBaseHalfCanvasFolderModel {
	readonly items: readonly IBaseHalfCanvasItem[];
	readonly edges: readonly IBaseHalfCanvasEdge[];
	readonly truncated: number;
	readonly size?: IBaseHalfCanvasSize;
}

export interface IBaseHalfCanvasModelOptions {
	readonly rootLevel: boolean;
	readonly folderRelativePath?: string;
	readonly canvas?: IBaseHalfCanvasFile | null;
	/** Badge descriptions by workspace-relative path. */
	readonly badges?: ReadonlyMap<string, IBaseHalfCanvasBadgeMetadata>;
	/** Connections by workspace-relative path, from the reference index. Edges
	 *  are drawn only from these; omit them while the index is building. */
	readonly relationships?: ReadonlyMap<string, IBaseHalfCanvasItemRelationships>;
}

export function isBaseHalfCanvasEntry(stat: IFileStat, rootLevel: boolean): boolean {
	const name = basename(stat.resource);
	if (stat.isDirectory) {
		return !SKIP_NAMES.has(name);
	}

	if (!stat.isFile) {
		return false;
	}

	if (rootLevel && AGENT_HINT_FILES.has(name)) {
		return false;
	}

	return !HIDDEN_FILE_NAMES.has(name);
}

/** Directory names the canvas never shows as cards (and never walks into). */
export const BASEHALF_CANVAS_SKIP_NAMES: ReadonlySet<string> = SKIP_NAMES;

/**
 * Whether every segment of a workspace-relative path is one the canvas could
 * show as a card, by name alone (the same rules as {@link isBaseHalfCanvasEntry}).
 */
export function isBaseHalfCanvasPathEligible(relativePath: string, isDirectory: boolean): boolean {
	if (!relativePath) {
		return false;
	}
	const segments = relativePath.split('/');
	return segments.every((name, index) => {
		if (!name) {
			return false;
		}
		if (index < segments.length - 1 || isDirectory) {
			return !SKIP_NAMES.has(name);
		}
		if (index === 0 && AGENT_HINT_FILES.has(name)) {
			return false;
		}
		return !HIDDEN_FILE_NAMES.has(name);
	});
}

export function baseHalfCanvasModelFromStat(folder: IFileStat, options: IBaseHalfCanvasModelOptions): IBaseHalfCanvasFolderModel {
	const eligibleChildren = (folder.children ?? [])
		.filter(child => isBaseHalfCanvasEntry(child, options.rootLevel))
		.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}

			return basename(a.resource).localeCompare(basename(b.resource));
		});

	const cardByPath = new Map((options.canvas?.cards ?? []).map(card => [card.path, card]));
	const folderRelativePath = options.folderRelativePath ?? '';
	const allItems = eligibleChildren.map(stat => {
		const name = basename(stat.resource);
		const path = childPath(folderRelativePath, name);
		const kind: BaseHalfCanvasItemKind = stat.isDirectory ? 'folder' : 'file';
		const card = cardByPath.get(path);
		const badge = options.badges?.get(path);
		const relationships = options.relationships?.get(path);
		return {
			path,
			name,
			kind,
			stat,
			...(card ? { card } : {}),
			...(badge ? { badge } : {}),
			...(relationships && baseHalfCanvasRelationshipsArePresent(relationships) ? { relationships } : {})
		};
	});

	// The child cap only ever cuts UN-annotated filler: a child the user has
	// touched — described, connected, placed, or orphaned — is part of the
	// curated set and always survives, no matter how large the flat folder is.
	let items = allItems;
	if (allItems.length > BASEHALF_CANVAS_CHILD_LIMIT) {
		const annotated = allItems.filter(item => isAnnotatedItem(item));
		const plain = allItems.filter(item => !isAnnotatedItem(item));
		items = [...annotated, ...plain.slice(0, Math.max(0, BASEHALF_CANVAS_CHILD_LIMIT - annotated.length))]
			.sort((a, b) => {
				if (a.kind !== b.kind) {
					return a.kind === 'folder' ? -1 : 1;
				}

				return a.name.localeCompare(b.name);
			});
	}

	return {
		items,
		edges: deriveCanvasEdges(items, options.canvas?.edges ?? []),
		truncated: Math.max(0, allItems.length - items.length),
		size: options.canvas?.size
	};
}

/** Whether a card has any connection or connection issue worth keeping on the canvas. */
export function baseHalfCanvasRelationshipsArePresent(relationships: IBaseHalfCanvasItemRelationships): boolean {
	return relationships.upstream.length > 0 || relationships.downstream.length > 0 || relationships.issueCount > 0;
}

function isAnnotatedItem(item: IBaseHalfCanvasItem): boolean {
	return item.card !== undefined
		|| item.badge !== undefined // badges are pruned when empty, so presence = authored content
		|| item.relationships !== undefined; // a connected card is never cut by the child cap
}

/**
 * The edge set is DERIVED from the downstream-owned upstream lists (D37): for
 * each card `T` and each valid, non-dangling upstream entry `F` of `T` that is
 * a sibling card, the canvas draws `F -> T` (context flows from F into T).
 * `canvas.yaml` edge rows are anchor memory only: a row supplies the anchors
 * of its pair when that pair is drawn, and a row with no live reference is
 * ignored (and kept). Entries naming nodes outside this folder draw nothing;
 * they appear in the badge editor and the toggle counts.
 */
function deriveCanvasEdges(
	items: readonly IBaseHalfCanvasItem[],
	styled: readonly IBaseHalfCanvasEdge[]
): IBaseHalfCanvasEdge[] {
	const itemPaths = new Set(items.map(item => item.path));
	const boundsByPath = new Map(items.map((item, index) => [item.path, baseHalfCanvasItemBounds(item, index, items.length)]));
	const styleByPair = new Map(styled.map(edge => [edgePairKey(edge.from, edge.to), edge]));
	const edges: IBaseHalfCanvasEdge[] = [];
	const drawn = new Set<string>();
	for (const target of items) {
		for (const from of target.relationships?.upstream ?? []) {
			const key = edgePairKey(from, target.path);
			if (from === target.path || !itemPaths.has(from) || drawn.has(key)) {
				continue;
			}
			drawn.add(key);
			const styledEdge = styleByPair.get(key);
			edges.push(styledEdge ?? baseHalfCanvasDefaultEdge(from, target.path, boundsByPath.get(from)!, boundsByPath.get(target.path)!));
		}
	}

	return edges;
}

function baseHalfCanvasDefaultEdge(from: string, to: string, fromBounds: IBaseHalfCanvasBounds, toBounds: IBaseHalfCanvasBounds): IBaseHalfCanvasEdge {
	const deltaX = toBounds.x + toBounds.width / 2 - (fromBounds.x + fromBounds.width / 2);
	const deltaY = toBounds.y + toBounds.height / 2 - (fromBounds.y + fromBounds.height / 2);
	if (Math.abs(deltaX) >= Math.abs(deltaY)) {
		return deltaX >= 0
			? { from, from_anchor: 'east', to, to_anchor: 'west' }
			: { from, from_anchor: 'west', to, to_anchor: 'east' };
	}
	return deltaY >= 0
		? { from, from_anchor: 'south', to, to_anchor: 'north' }
		: { from, from_anchor: 'north', to, to_anchor: 'south' };
}

function edgePairKey(from: string, to: string): string {
	// JSON framing so paths containing spaces cannot collide across the pair.
	return JSON.stringify([from, to]);
}

export function baseHalfCanvasItemsFromStat(folder: IFileStat, rootLevel: boolean): IBaseHalfCanvasItem[] {
	return [...baseHalfCanvasModelFromStat(folder, { rootLevel }).items];
}

export function baseHalfCanvasPosition(index: number, total: number): IBaseHalfCanvasPosition {
	const cols = Math.max(5, Math.ceil(Math.sqrt(1.34 * Math.max(1, total))));
	const usedCols = Math.max(1, Math.min(total, cols));
	const rows = Math.max(1, Math.ceil(Math.max(1, total) / cols));
	const cellWidth = BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH + BASEHALF_CANVAS_GRID_COLUMN_GAP;
	const cellHeight = BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT + BASEHALF_CANVAS_GRID_ROW_GAP;
	const gridWidth = (usedCols - 1) * cellWidth + BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH;
	const gridHeight = (rows - 1) * cellHeight + BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT;
	const originX = Math.max(BASEHALF_CANVAS_DEFAULT_PADDING, (BASEHALF_CANVAS_DEFAULT_WIDTH - gridWidth) / 2);
	const originY = Math.max(BASEHALF_CANVAS_DEFAULT_PADDING, (BASEHALF_CANVAS_DEFAULT_HEIGHT - gridHeight) / 2);

	return {
		x: roundCanvasNumber(originX + (index % cols) * cellWidth),
		y: roundCanvasNumber(originY + Math.floor(index / cols) * cellHeight)
	};
}

/** Places a group imported at one pointer location as a readable compact grid. */
export function baseHalfCanvasTransferPosition(origin: IBaseHalfCanvasPosition, index: number, total: number): IBaseHalfCanvasPosition {
	const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, total)))));
	return {
		x: roundCanvasNumber(origin.x + (index % cols) * (BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH + BASEHALF_CANVAS_GRID_COLUMN_GAP)),
		y: roundCanvasNumber(origin.y + Math.floor(index / cols) * (BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT + BASEHALF_CANVAS_GRID_ROW_GAP))
	};
}

/**
 * Finds a readable position for a newly created card without moving existing
 * user-authored geometry. Candidates grow to the right first because default
 * context-flow edges leave a source card from its east anchor.
 */
export function baseHalfCanvasOpenPosition(
	preferred: IBaseHalfCanvasPosition,
	size: { readonly width: number; readonly height: number },
	occupied: readonly IBaseHalfCanvasBounds[],
	viewport?: IBaseHalfCanvasBounds
): IBaseHalfCanvasPosition {
	const columnStep = size.width + BASEHALF_CANVAS_GRID_COLUMN_GAP;
	const rowStep = size.height + BASEHALF_CANVAS_GRID_ROW_GAP;
	const offsets: [number, number][] = [[0, 0]];
	for (let ring = 1; ring < 32; ring++) {
		offsets.push(
			[ring, 0], [0, ring], [0, -ring], [-ring, 0],
			[ring, ring], [ring, -ring], [-ring, ring], [-ring, -ring]
		);
	}
	for (const [column, row] of offsets) {
			const candidate = {
				x: roundCanvasNumber(preferred.x + column * columnStep),
				y: roundCanvasNumber(preferred.y + row * rowStep)
			};
			const bounds = { ...candidate, ...size };
			if ((!viewport || canvasBoundsContain(viewport, bounds)) && occupied.every(other => !canvasBoundsOverlap(bounds, other))) {
				return candidate;
			}
	}
	return {
		x: roundCanvasNumber(preferred.x + (occupied.length + 1) * columnStep),
		y: preferred.y
	};
}

function canvasBoundsContain(container: IBaseHalfCanvasBounds, child: IBaseHalfCanvasBounds): boolean {
	return child.x >= container.x
		&& child.y >= container.y
		&& child.x + child.width <= container.x + container.width
		&& child.y + child.height <= container.y + container.height;
}

function canvasBoundsOverlap(a: IBaseHalfCanvasBounds, b: IBaseHalfCanvasBounds): boolean {
	return a.x < b.x + b.width + BASEHALF_CANVAS_GRID_COLUMN_GAP
		&& a.x + a.width + BASEHALF_CANVAS_GRID_COLUMN_GAP > b.x
		&& a.y < b.y + b.height + BASEHALF_CANVAS_GRID_ROW_GAP
		&& a.y + a.height + BASEHALF_CANVAS_GRID_ROW_GAP > b.y;
}

export function baseHalfCanvasItemBounds(item: IBaseHalfCanvasItem, index: number, total: number): IBaseHalfCanvasBounds {
	const fallbackPosition = baseHalfCanvasPosition(index, total);
	return {
		x: item.card?.x ?? fallbackPosition.x,
		y: item.card?.y ?? fallbackPosition.y,
		width: Math.max(item.card?.width ?? defaultCardWidth(item.kind), BASEHALF_CANVAS_MIN_CARD_WIDTH),
		height: Math.max(item.card?.height ?? defaultCardHeight(item.kind), BASEHALF_CANVAS_MIN_CARD_HEIGHT)
	};
}

function defaultCardWidth(kind: BaseHalfCanvasItemKind): number {
	return kind === 'folder' ? BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH : BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH;
}

function defaultCardHeight(kind: BaseHalfCanvasItemKind): number {
	return kind === 'folder' ? BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT : BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT;
}

export function baseHalfCanvasEdgeLayouts(edges: readonly IBaseHalfCanvasEdge[], items: readonly IBaseHalfCanvasItem[]): IBaseHalfCanvasEdgeLayoutResult {
	const boundsByPath = new Map<string, IBaseHalfCanvasBounds>();
	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		boundsByPath.set(item.path, baseHalfCanvasItemBounds(item, index, items.length));
	}

	const layouts: IBaseHalfCanvasEdgeLayout[] = [];
	let dropped = 0;
	for (const edge of edges) {
		const fromBounds = boundsByPath.get(edge.from);
		const toBounds = boundsByPath.get(edge.to);
		if (!fromBounds || !toBounds) {
			dropped++;
			continue;
		}

		const from = baseHalfCanvasAnchorPoint(fromBounds, edge.from_anchor);
		const to = baseHalfCanvasAnchorPoint(toBounds, edge.to_anchor);

		layouts.push({
			edge,
			from,
			to,
			path: baseHalfCanvasEdgePath(from, edge.from_anchor, to, edge.to_anchor)
		});
	}

	return { edges: layouts, dropped };
}

export function baseHalfCanvasAnchorPoint(bounds: IBaseHalfCanvasBounds, anchor: IBaseHalfCanvasEdge['from_anchor']): IBaseHalfCanvasPosition {
	switch (anchor) {
		case 'north':
			return { x: roundCanvasNumber(bounds.x + bounds.width / 2), y: roundCanvasNumber(bounds.y) };
		case 'east':
			return { x: roundCanvasNumber(bounds.x + bounds.width), y: roundCanvasNumber(bounds.y + bounds.height / 2) };
		case 'south':
			return { x: roundCanvasNumber(bounds.x + bounds.width / 2), y: roundCanvasNumber(bounds.y + bounds.height) };
		case 'west':
			return { x: roundCanvasNumber(bounds.x), y: roundCanvasNumber(bounds.y + bounds.height / 2) };
	}
}

export function baseHalfCanvasEdgePath(
	from: IBaseHalfCanvasPosition,
	fromAnchor: IBaseHalfCanvasEdge['from_anchor'],
	to: IBaseHalfCanvasPosition,
	toAnchor: IBaseHalfCanvasEdge['to_anchor']
): string {
	const distance = Math.min(220, Math.max(48, (Math.abs(to.x - from.x) + Math.abs(to.y - from.y)) / 2));
	const fromControl = controlPoint(from, fromAnchor, distance);
	const toControl = controlPoint(to, toAnchor, distance);
	return [
		'M',
		formatCanvasNumber(from.x),
		formatCanvasNumber(from.y),
		'C',
		formatCanvasNumber(fromControl.x),
		formatCanvasNumber(fromControl.y),
		formatCanvasNumber(toControl.x),
		formatCanvasNumber(toControl.y),
		formatCanvasNumber(to.x),
		formatCanvasNumber(to.y)
	].join(' ');
}

function childPath(folderRelativePath: string, name: string): string {
	return folderRelativePath ? `${folderRelativePath}/${name}` : name;
}

function controlPoint(point: IBaseHalfCanvasPosition, anchor: IBaseHalfCanvasEdge['from_anchor'], distance: number): IBaseHalfCanvasPosition {
	switch (anchor) {
		case 'north':
			return { x: point.x, y: roundCanvasNumber(point.y - distance) };
		case 'east':
			return { x: roundCanvasNumber(point.x + distance), y: point.y };
		case 'south':
			return { x: point.x, y: roundCanvasNumber(point.y + distance) };
		case 'west':
			return { x: roundCanvasNumber(point.x - distance), y: point.y };
	}
}

function formatCanvasNumber(value: number): string {
	return String(roundCanvasNumber(value));
}

function roundCanvasNumber(value: number): number {
	return Number(value.toFixed(4));
}
