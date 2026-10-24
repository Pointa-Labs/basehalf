/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileStat } from '../../../../platform/files/common/files.js';
import { baseHalfRenderableContentKind } from '../../cardDetail/common/basehalfContentRendering.js';
import type { BaseHalfGenerationKind } from '../../video/common/basehalfGenerationInfo.js';

export const BASEHALF_CANVAS_CHILD_LIMIT = 300;
export const BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH = 300;
export const BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT = 220;
export const BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH = 248;
export const BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT = 188;
/**
 * The short side of the card of an image or a video, whose picture's ratio
 * gives the long side (canvas card placement, "The card of an image or a
 * video has its picture's shape").
 */
export const BASEHALF_CANVAS_PICTURE_CARD_SHORT_SIDE = 300;
/** The long side of such a card is at most this many times its short side: a longer picture is fitted inside. */
export const BASEHALF_CANVAS_PICTURE_CARD_MAX_RATIO = 3;
/** The ratio, width to height, of a picture that is not known yet, and of a draft whose settings choose none. */
export const BASEHALF_CANVAS_PICTURE_DEFAULT_RATIO: Readonly<Record<'image' | 'video', number>> = Object.freeze({ image: 1, video: 16 / 9 });
export const BASEHALF_CANVAS_MIN_CARD_WIDTH = 140;
export const BASEHALF_CANVAS_MIN_CARD_HEIGHT = 48;
export const BASEHALF_CANVAS_DEFAULT_WIDTH = 2400;
export const BASEHALF_CANVAS_DEFAULT_HEIGHT = 1600;
export const BASEHALF_CANVAS_GRID_COLUMN_GAP = 40;
export const BASEHALF_CANVAS_GRID_ROW_GAP = 60;
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
	/**
	 * BaseHalf chose this place and the user has not changed it since (canvas
	 * card placement). Only such a row gives way to the row that follows a
	 * moved item, and only such a row is removed when its item is gone.
	 */
	readonly auto?: true;
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

/** The workspace-relative path of `name` in the folder at `parent`; `name` itself at the root. */
export function baseHalfCanvasChildPath(parent: string, name: string): string {
	return parent ? `${parent}/${name}` : name;
}

/** What the canvas knows of a generation card (generation cards): what it makes, and whether it has its file yet. */
export interface IBaseHalfCanvasGenerationCard {
	readonly kind: BaseHalfGenerationKind;
	/** A draft has no file: the item's stat is made from its path ({@link baseHalfCanvasDraftStat}). */
	readonly draft: boolean;
}

export interface IBaseHalfCanvasItem {
	readonly path: string;
	readonly name: string;
	readonly kind: BaseHalfCanvasItemKind;
	readonly stat: IFileStat;
	/** Present when the item is a generation card: a draft, or a file with generation information. */
	readonly generation?: IBaseHalfCanvasGenerationCard;
	/**
	 * The card's row. Every item of a folder model has one: the row of the
	 * layout, or the place BaseHalf chose for a card that appeared (canvas card
	 * placement).
	 */
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
		|| !!previous.generation?.draft !== !!current.generation?.draft
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
	/**
	 * The rows of the shown cards that the layout does not hold, in list order:
	 * the cards that appeared in this model and the ones whose place still waits
	 * for a write.
	 */
	readonly appeared: readonly IBaseHalfCanvasCard[];
	/** The rows whose item is spelled differently now, on a volume where both spellings are the same path. */
	readonly respelled: readonly { readonly from: string; readonly to: string }[];
	/**
	 * The rows of the layout whose card changed size in this model to have its
	 * picture's shape, with the new size and the same place: they are saved
	 * with the next write, so that the layout stores what the canvas shows.
	 */
	readonly reshaped: readonly IBaseHalfCanvasCard[];
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
	/** The places BaseHalf chose for this folder and could not save yet, by path. */
	readonly waiting?: ReadonlyMap<string, IBaseHalfCanvasCard>;
	/**
	 * The generation cards of the folder by path, from the card store. A draft
	 * is among the folder's children with a stat made from its path
	 * ({@link baseHalfCanvasFolderWithDrafts}).
	 */
	readonly generationCards?: ReadonlyMap<string, IBaseHalfCanvasGenerationCard>;
	/**
	 * The ratio, width to height, of the picture of each image or video item
	 * whose ratio the caller knows, by path: measured for a file, chosen by its
	 * settings for a draft. A card that appears is placed with its full shape
	 * ({@link baseHalfCanvasPictureCardSize}); a card that has a place takes
	 * the shape there as large as the room allows
	 * ({@link baseHalfCanvasPictureCardSizeAt}).
	 */
	readonly pictureRatios?: ReadonlyMap<string, number>;
	/** Maps a path to what two spellings of the same path share. Defaults to the path. */
	readonly pathKey?: (path: string) => string;
	/**
	 * Paths of rows that BaseHalf chose and whose items are gone. The next save
	 * removes them, so their places are open for a card that appears.
	 */
	readonly released?: ReadonlySet<string>;
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

/**
 * Whether the canvas could show the item at `relativePath` below a workspace
 * folder: every segment of the path is one the canvas shows as a card.
 */
export function baseHalfIsCanvasEligiblePath(workspaceFolder: URI, relativePath: string, isDirectory: boolean): boolean {
	const segments = relativePath.split('/');
	let current = workspaceFolder;
	for (let position = 0; position < segments.length; position++) {
		current = URI.joinPath(current, segments[position]);
		const directory = position < segments.length - 1 || isDirectory;
		const stat: IFileStat = { resource: current, name: segments[position], isFile: !directory, isDirectory: directory, isSymbolicLink: false, children: undefined };
		if (!isBaseHalfCanvasEntry(stat, position === 0)) {
			return false;
		}
	}
	return true;
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

	const pathKey = options.pathKey ?? (path => path);
	const cardByPath = new Map((options.canvas?.cards ?? []).map(card => [pathKey(card.path), card]));
	const respelled: { from: string; to: string }[] = [];
	const folderRelativePath = options.folderRelativePath ?? '';
	const allItems = eligibleChildren.map(stat => {
		const name = basename(stat.resource);
		const path = childPath(folderRelativePath, name);
		const kind: BaseHalfCanvasItemKind = stat.isDirectory ? 'folder' : 'file';
		// A row belongs to an item when their paths are the same path. An item
		// that was renamed in letter case only, on a volume that ignores case, is
		// still that item: it keeps its row, which takes the new spelling.
		const row = cardByPath.get(pathKey(path));
		if (row && row.path !== path) {
			respelled.push({ from: row.path, to: path });
		}
		const card = row ? (row.path === path ? row : { ...row, path }) : options.waiting?.get(path);
		const badge = options.badges?.get(path);
		const relationships = options.relationships?.get(path);
		const generation = kind === 'file' ? options.generationCards?.get(path) : undefined;
		return {
			path,
			name,
			kind,
			stat,
			...(generation ? { generation } : {}),
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

	// The card of a picture has the picture's shape where it is, as large as
	// the room at its corner allows up to the full shape (canvas card
	// placement, "The card of an image or a video has its picture's shape").
	// A row of the layout that changes size is saved again.
	const reshaped = new Map<string, IBaseHalfCanvasCard>();
	const ratios = options.pictureRatios;
	if (ratios?.size) {
		const stored = new Set((options.canvas?.cards ?? []).map(card => pathKey(card.path)));
		const rects = new Map<string, IBaseHalfCanvasBounds>();
		for (const card of options.canvas?.cards ?? []) {
			if (!options.released?.has(card.path)) {
				rects.set(pathKey(card.path), card);
			}
		}
		for (const item of items) {
			if (item.card) {
				rects.set(pathKey(item.path), item.card);
			}
		}
		items = items.map(item => {
			const ratio = ratios.get(item.path);
			if (!item.card || ratio === undefined) {
				return item;
			}
			const key = pathKey(item.path);
			const others = [...rects].filter(([other]) => other !== key).map(([, rect]) => rect);
			const size = baseHalfCanvasPictureCardSizeAt(item.card, ratio, others);
			if (size.width === item.card.width && size.height === item.card.height) {
				return item;
			}
			const card = { ...item.card, ...size };
			rects.set(key, card);
			if (stored.has(key)) {
				reshaped.set(key, card);
			}
			return { ...item, card };
		});
	}

	// Every card has a place (canvas card placement). A card without a row
	// appears: it gets its place now, at the end of the canvas, and keeps it.
	// What is taken is every row of the layout, also of an item that is gone,
	// and the places that still wait for a write. A row that is about to be
	// removed takes nothing.
	const rows = (options.canvas?.cards ?? [])
		.filter(card => !options.released?.has(card.path))
		.map(card => reshaped.get(pathKey(card.path)) ?? card);
	const inLayout = new Set(rows.map(card => pathKey(card.path)));
	const isWaiting = (item: IBaseHalfCanvasItem) => item.card !== undefined && !inLayout.has(pathKey(item.path));
	const chosen = new Map(baseHalfCanvasPlaceAppearing(
		items.filter(item => !item.card).map(item => {
			const ratio = ratios?.get(item.path);
			return { path: item.path, kind: item.kind, ...(ratio !== undefined ? baseHalfCanvasPictureCardSize(ratio) : baseHalfCanvasNewCardSize(item)) };
		}),
		[...rows, ...items.flatMap(item => isWaiting(item) ? [item.card!] : [])]
	).map(card => [card.path, card]));
	items = items.map(item => item.card ? item : { ...item, card: chosen.get(item.path) });
	return {
		items,
		edges: deriveCanvasEdges(items, options.canvas?.edges ?? []),
		truncated: Math.max(0, allItems.length - items.length),
		size: options.canvas?.size,
		appeared: items.flatMap(item => isWaiting(item) ? [item.card!] : []),
		respelled: respelled.filter(row => items.some(item => item.path === row.to)),
		reshaped: [...reshaped.values()]
	};
}

/** Whether a card has any connection or connection issue worth keeping on the canvas. */
export function baseHalfCanvasRelationshipsArePresent(relationships: IBaseHalfCanvasItemRelationships): boolean {
	return relationships.upstream.length > 0 || relationships.downstream.length > 0 || relationships.issueCount > 0;
}

/**
 * What of a card's connections its element is built from: all of them while
 * its badge face lists them, and else only the number of its issues. What
 * else it shows of them is its badge toggle's, which is drawn again in place,
 * so a connection drawn or removed keeps the card (canvas card interaction
 * continuity, "A change of connections").
 */
export function baseHalfCanvasCardBuiltConnections(relationships: IBaseHalfCanvasItemRelationships | undefined, badgeOpen: boolean): IBaseHalfCanvasItemRelationships | number | undefined {
	return badgeOpen ? relationships : relationships?.issueCount ?? 0;
}

/** What a card's badge toggle shows of its connections: how many it has upstream and downstream. */
export function baseHalfCanvasCardToggleConnections(relationships: IBaseHalfCanvasItemRelationships | undefined): string {
	return relationships ? `${relationships.upstream.length} ${relationships.downstream.length}` : '';
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

const BASEHALF_CANVAS_CELL_WIDTH = BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH + BASEHALF_CANVAS_GRID_COLUMN_GAP;
const BASEHALF_CANVAS_CELL_HEIGHT = BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT + BASEHALF_CANVAS_GRID_ROW_GAP;
/** A row of new cards is at least this wide: five cells without the last gap. */
const BASEHALF_CANVAS_MIN_ROW_WIDTH = 5 * BASEHALF_CANVAS_CELL_WIDTH - BASEHALF_CANVAS_GRID_COLUMN_GAP;

/** The number of columns of the plain grid for this many cards. */
export function baseHalfCanvasPlainGridColumns(total: number): number {
	return Math.max(5, Math.ceil(Math.sqrt(1.34 * Math.max(1, total))));
}

/** The grid of a folder whose cards all appear together. */
function plainGrid(total: number): { readonly cols: number; readonly originX: number; readonly originY: number; readonly width: number } {
	const cols = baseHalfCanvasPlainGridColumns(total);
	const usedCols = Math.max(1, Math.min(total, cols));
	const rows = Math.max(1, Math.ceil(Math.max(1, total) / cols));
	const width = (usedCols - 1) * BASEHALF_CANVAS_CELL_WIDTH + BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH;
	const height = (rows - 1) * BASEHALF_CANVAS_CELL_HEIGHT + BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT;
	return {
		cols,
		originX: Math.max(BASEHALF_CANVAS_DEFAULT_PADDING, (BASEHALF_CANVAS_DEFAULT_WIDTH - width) / 2),
		originY: Math.max(BASEHALF_CANVAS_DEFAULT_PADDING, (BASEHALF_CANVAS_DEFAULT_HEIGHT - height) / 2),
		width
	};
}

export function baseHalfCanvasPosition(index: number, total: number): IBaseHalfCanvasPosition {
	const grid = plainGrid(total);
	return {
		x: roundCanvasNumber(grid.originX + (index % grid.cols) * BASEHALF_CANVAS_CELL_WIDTH),
		y: roundCanvasNumber(grid.originY + Math.floor(index / grid.cols) * BASEHALF_CANVAS_CELL_HEIGHT)
	};
}

/** The left and right edge of the rows that the new cards of one drawing continue. */
export interface IBaseHalfCanvasRowSpan {
	readonly start: number;
	readonly end: number;
	/** Where the first card goes when nothing is taken. */
	readonly first: IBaseHalfCanvasPosition;
}

/**
 * The rows that new cards continue, fixed for one drawing from what is taken
 * when it starts. With cards on the canvas the rows are as wide as those
 * cards, and at least five cells. On an empty canvas they are the plain grid
 * for the cards that appear together.
 */
export function baseHalfCanvasRowSpan(taken: readonly IBaseHalfCanvasBounds[], appearing: number): IBaseHalfCanvasRowSpan {
	const grid = plainGrid(appearing);
	const first = { x: roundCanvasNumber(grid.originX), y: roundCanvasNumber(grid.originY) };
	if (taken.length === 0) {
		return { start: first.x, end: roundCanvasNumber(grid.originX + grid.width), first };
	}
	const start = Math.min(...taken.map(bounds => bounds.x));
	return { start, end: Math.max(Math.max(...taken.map(bounds => bounds.x + bounds.width)), start + BASEHALF_CANVAS_MIN_ROW_WIDTH), first };
}

/**
 * Where a card goes that nobody pointed at: the end of the canvas. That is
 * beside the last card, the one furthest down and then furthest right, or at
 * the start of a new row below everything. Nothing is put between the cards
 * that are there: an empty stretch between the user's cards is theirs.
 */
export function baseHalfCanvasEndPlace(taken: readonly IBaseHalfCanvasBounds[], size: IBaseHalfCanvasSize, span: IBaseHalfCanvasRowSpan): IBaseHalfCanvasPosition {
	if (taken.length === 0) {
		return span.first;
	}
	const last = taken.reduce((found, bounds) => bounds.y > found.y || (bounds.y === found.y && bounds.x > found.x) ? bounds : found);
	const beside = {
		x: roundCanvasNumber(Math.max(last.x + BASEHALF_CANVAS_CELL_WIDTH, last.x + last.width + BASEHALF_CANVAS_GRID_COLUMN_GAP)),
		y: last.y
	};
	if (beside.x + size.width <= span.end && baseHalfCanvasIsOpen({ ...beside, ...size }, taken)) {
		return beside;
	}
	const bottom = Math.max(...taken.map(bounds => bounds.y + bounds.height));
	return {
		x: span.start,
		y: roundCanvasNumber(Math.max(last.y + BASEHALF_CANVAS_CELL_HEIGHT, bottom + BASEHALF_CANVAS_GRID_ROW_GAP))
	};
}

/**
 * The rows of the cards that appear in one drawing, in the order given. Each
 * goes to the end of the canvas and counts as taken for the next. They are
 * chosen rows: BaseHalf picked the place, not the user.
 */
export function baseHalfCanvasPlaceAppearing(
	appearing: readonly (IBaseHalfCanvasSize & { readonly path: string; readonly kind: BaseHalfCanvasItemKind })[],
	taken: readonly IBaseHalfCanvasBounds[]
): IBaseHalfCanvasCard[] {
	const span = baseHalfCanvasRowSpan(taken, appearing.length);
	const all = [...taken];
	return appearing.map(item => {
		const size = { width: item.width, height: item.height };
		const card: IBaseHalfCanvasCard = { path: item.path, kind: item.kind, ...baseHalfCanvasEndPlace(all, size, span), ...size, auto: true };
		all.push(card);
		return card;
	});
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
 * The places of a group that the user dropped at one point. The group keeps
 * its block where the block is open: the cards whose slots are open take them
 * first, then the others take, in order, the nearest open place to their slot.
 */
export function baseHalfCanvasTransferPlaces(origin: IBaseHalfCanvasPosition, sizes: readonly IBaseHalfCanvasSize[], taken: readonly IBaseHalfCanvasBounds[]): IBaseHalfCanvasPosition[] {
	const slots = sizes.map((_, index) => baseHalfCanvasTransferPosition(origin, index, sizes.length));
	const inSlot = slots.map((slot, index) => baseHalfCanvasIsOpen({ ...slot, ...sizes[index] }, taken));
	const all = [...taken, ...slots.flatMap((slot, index) => inSlot[index] ? [{ ...slot, ...sizes[index] }] : [])];
	return slots.map((slot, index) => {
		if (inSlot[index]) {
			return slot;
		}
		const place = baseHalfCanvasOpenPosition(slot, sizes[index], all);
		all.push({ ...place, ...sizes[index] });
		return place;
	});
}

/**
 * The top left corner of a card of `size` that is centered on `center`: the
 * place BaseHalf computes for a card the user creates without a point is the
 * middle of the visible part of the canvas (canvas card placement,
 * "Pointing").
 */
export function baseHalfCanvasCenteredPlace(center: IBaseHalfCanvasPosition, size: IBaseHalfCanvasSize): IBaseHalfCanvasPosition {
	return { x: roundCanvasNumber(center.x - size.width / 2), y: roundCanvasNumber(center.y - size.height / 2) };
}

/**
 * Finds a readable position for a newly created card without moving existing
 * user-authored geometry. Candidates grow to the right first because default
 * context-flow edges leave a source card from its east anchor. With a
 * `viewport`, only places inside it count, and a step that reaches past one
 * of its edges is moved back inside along that edge, so that the room in
 * sight is found also for a card as large as a video card (canvas card
 * placement, "The nearest open place").
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
	// A card larger than the visible part has no place inside it.
	const fits = !viewport || (size.width <= viewport.width && size.height <= viewport.height);
	for (const [column, row] of fits ? offsets : []) {
		const step = {
			x: roundCanvasNumber(preferred.x + column * columnStep),
			y: roundCanvasNumber(preferred.y + row * rowStep)
		};
		const candidate = viewport ? baseHalfCanvasInside(step, size, viewport) : step;
		const bounds = { ...candidate, ...size };
		if ((!viewport || canvasBoundsContain(viewport, bounds)) && occupied.every(other => !canvasBoundsOverlap(bounds, other))) {
			return candidate;
		}
	}
	// Nothing near the point is open: the card goes where any new card goes.
	return baseHalfCanvasEndPlace(occupied, size, baseHalfCanvasRowSpan(occupied, 1));
}

/** `position` moved inside `viewport` along the edges it reaches past, rounded inward so that the card stays inside. */
function baseHalfCanvasInside(position: IBaseHalfCanvasPosition, size: { readonly width: number; readonly height: number }, viewport: IBaseHalfCanvasBounds): IBaseHalfCanvasPosition {
	const inward = (value: number, min: number, max: number) => Math.min(Math.max(value, Math.ceil(min * 10_000) / 10_000), Math.floor(max * 10_000) / 10_000);
	return {
		x: inward(position.x, viewport.x, viewport.x + viewport.width - size.width),
		y: inward(position.y, viewport.y, viewport.y + viewport.height - size.height)
	};
}

/** Whether two cards lie over each other: they share more than an edge. */
export function baseHalfCanvasBoundsCross(a: IBaseHalfCanvasBounds, b: IBaseHalfCanvasBounds): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Whether a card can be put somewhere: it is at least the column gap away to
 * the side, or the row gap away above or below, from everything that is taken.
 */
export function baseHalfCanvasIsOpen(bounds: IBaseHalfCanvasBounds, taken: readonly IBaseHalfCanvasBounds[]): boolean {
	return taken.every(other => !canvasBoundsOverlap(bounds, other));
}

/** The size at which a card of a kind is drawn when it is new. */
export function baseHalfCanvasDefaultCardSize(kind: BaseHalfCanvasItemKind): IBaseHalfCanvasSize {
	return { width: defaultCardWidth(kind), height: defaultCardHeight(kind) };
}

/**
 * The size of the card of a picture `ratio` times as wide as it is high: a
 * short side of 300, and a long side that follows the ratio up to three times
 * the short side (canvas card placement, "The card of an image or a video has
 * its picture's shape"). A ratio that is not a number gives a square.
 */
export function baseHalfCanvasPictureCardSize(ratio: number): IBaseHalfCanvasSize {
	const short = BASEHALF_CANVAS_PICTURE_CARD_SHORT_SIDE;
	const bounded = boundedPictureRatio(ratio);
	return bounded >= 1
		? { width: Math.round(short * bounded), height: short }
		: { width: short, height: Math.round(short / bounded) };
}

/** The ratio of the card of a picture of `ratio`: the picture's, at most three times as long as high either way, and square for a ratio that is no number. */
function boundedPictureRatio(ratio: number): number {
	const longest = BASEHALF_CANVAS_PICTURE_CARD_MAX_RATIO;
	return Number.isFinite(ratio) && ratio > 0 ? Math.min(Math.max(ratio, 1 / longest), longest) : 1;
}

/**
 * The size of the card of a picture of `ratio` where the card is (canvas card
 * placement, "The card of an image or a video has its picture's shape"):
 * from its top left corner, the shape of `ratio` as large as it can be up to
 * the full shape, without coming closer to a card of `taken` than the gaps
 * of the plain grid (40 to the side, 60 above or below), or than it already
 * is. It is never smaller than that shape fitted into the card as it is, as
 * far as the full shape goes, which is also its size when it already reaches
 * into a card of `taken`. So a card grows when room comes free at its corner,
 * and keeps its size when a card comes near it. Like every card it is at
 * least 140 × 48: a picture whose shape would be smaller is fitted inside.
 */
export function baseHalfCanvasPictureCardSizeAt(card: IBaseHalfCanvasBounds, ratio: number, taken: readonly IBaseHalfCanvasBounds[]): IBaseHalfCanvasSize {
	const short = BASEHALF_CANVAS_PICTURE_CARD_SHORT_SIDE;
	const bounded = boundedPictureRatio(ratio);
	// The full shape before it is rounded, so that each size of it has the ratio.
	const full = bounded >= 1 ? { width: short * bounded, height: short } : { width: short, height: short / bounded };
	const right = card.x + card.width;
	const bottom = card.y + card.height;
	let scale = 1;
	for (const other of taken) {
		// Left of the card or above it, a card stays as far away as it is, however large the card grows.
		if (other.x + other.width <= card.x || other.y + other.height <= card.y) {
			continue;
		}
		// A card it reaches into already: it grows no further into it.
		if (other.x < right && other.y < bottom) {
			scale = 0;
			break;
		}
		// Clear of it to its left or above it, by the grid's gap or by the less it had: as large as one of the two allows.
		const besideGap = other.x >= right ? Math.min(BASEHALF_CANVAS_GRID_COLUMN_GAP, other.x - right) : BASEHALF_CANVAS_GRID_COLUMN_GAP;
		const aboveGap = other.y >= bottom ? Math.min(BASEHALF_CANVAS_GRID_ROW_GAP, other.y - bottom) : BASEHALF_CANVAS_GRID_ROW_GAP;
		scale = Math.min(scale, Math.max((other.x - besideGap - card.x) / full.width, (other.y - aboveGap - card.y) / full.height));
	}
	const fitted = Math.min(1, Math.max(scale, Math.min(card.width / full.width, card.height / full.height)));
	return {
		width: Math.max(Math.round(full.width * fitted), BASEHALF_CANVAS_MIN_CARD_WIDTH),
		height: Math.max(Math.round(full.height * fitted), BASEHALF_CANVAS_MIN_CARD_HEIGHT)
	};
}

/**
 * The size of a generation card of a kind: the shape of `ratio`, the ratio of
 * its picture or, for a draft, the one its settings choose, and the ratio of
 * its kind while that is not known. A sound has no picture: its card has the
 * size of a file card (canvas card placement, "The card of an image or a
 * video has its picture's shape").
 */
export function baseHalfCanvasGenerationCardSize(kind: BaseHalfGenerationKind, ratio?: number): IBaseHalfCanvasSize {
	return kind === 'audio'
		? baseHalfCanvasDefaultCardSize('file')
		: baseHalfCanvasPictureCardSize(ratio ?? BASEHALF_CANVAS_PICTURE_DEFAULT_RATIO[kind]);
}

/** What decides the shape of an item's card: its kind, its file's name, and whether it is a generation card. */
export type BaseHalfCanvasShapedItem = Pick<IBaseHalfCanvasItem, 'kind' | 'generation'> & { readonly stat: Pick<IFileStat, 'resource'> };

/** The kind of the picture that the card of an item shows: an image or a video file, a generation card among them. A sound shows none. */
export function baseHalfCanvasPictureKind(item: BaseHalfCanvasShapedItem): 'image' | 'video' | undefined {
	if (item.kind !== 'file') {
		return undefined;
	}
	if (item.generation) {
		return item.generation.kind === 'audio' ? undefined : item.generation.kind;
	}
	const kind = baseHalfRenderableContentKind(item.stat.resource);
	return kind === 'image' || kind === 'video' ? kind : undefined;
}

/**
 * Whether the user resizes the card of an item: the card of a note, of
 * another text or code file, of a PDF, of another file, and of a folder. The
 * card of an image, a video, or a sound keeps its shape (canvas card resize,
 * "Which cards resize").
 */
export function baseHalfCanvasCardResizes(item: BaseHalfCanvasShapedItem): boolean {
	return baseHalfCanvasPictureKind(item) === undefined
		&& !(item.kind === 'file' && baseHalfRenderableContentKind(item.stat.resource) === 'audio');
}

/** The size at which the card of an item is drawn when it appears and the shape of its picture is not known: the ratio of its kind for a picture. */
export function baseHalfCanvasNewCardSize(item: BaseHalfCanvasShapedItem): IBaseHalfCanvasSize {
	const picture = baseHalfCanvasPictureKind(item);
	return picture ? baseHalfCanvasGenerationCardSize(picture) : baseHalfCanvasDefaultCardSize(item.kind);
}

/** The version every draft's made-up stat has: a draft has no file whose content could change. */
const DRAFT_STAT_ETAG = 'basehalf-draft';

/**
 * The stat of a draft, made from its path: a file that is not there yet
 * (generation cards, "Drafts and missing files"). Its version never changes,
 * so the card of a draft keeps its element while the folder is drawn again.
 */
export function baseHalfCanvasDraftStat(resource: URI, name: string): IFileStat {
	return { resource, name, isFile: true, isDirectory: false, isSymbolicLink: false, children: undefined, etag: DRAFT_STAT_ETAG };
}

/** The folder's stat with its drafts among its children, after its items; a name an item has is not a draft. */
export function baseHalfCanvasFolderWithDrafts(folder: IFileStat, drafts: readonly { readonly resource: URI; readonly name: string }[]): IFileStat {
	if (!drafts.length) {
		return folder;
	}
	const names = new Set((folder.children ?? []).map(child => basename(child.resource).toLowerCase()));
	const added = drafts.filter(draft => !names.has(draft.name.toLowerCase())).map(draft => baseHalfCanvasDraftStat(draft.resource, draft.name));
	return added.length ? { ...folder, children: [...(folder.children ?? []), ...added] } : folder;
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

/**
 * The cubic curve of an edge: its two ends and, between them, the control
 * points that leave each end at a right angle to its card's side.
 */
export function baseHalfCanvasEdgeCurve(
	from: IBaseHalfCanvasPosition,
	fromAnchor: IBaseHalfCanvasEdge['from_anchor'],
	to: IBaseHalfCanvasPosition,
	toAnchor: IBaseHalfCanvasEdge['to_anchor']
): readonly [IBaseHalfCanvasPosition, IBaseHalfCanvasPosition, IBaseHalfCanvasPosition, IBaseHalfCanvasPosition] {
	const distance = Math.min(220, Math.max(48, (Math.abs(to.x - from.x) + Math.abs(to.y - from.y)) / 2));
	return [from, controlPoint(from, fromAnchor, distance), controlPoint(to, toAnchor, distance), to];
}

export function baseHalfCanvasEdgePath(
	from: IBaseHalfCanvasPosition,
	fromAnchor: IBaseHalfCanvasEdge['from_anchor'],
	to: IBaseHalfCanvasPosition,
	toAnchor: IBaseHalfCanvasEdge['to_anchor']
): string {
	const [, fromControl, toControl] = baseHalfCanvasEdgeCurve(from, fromAnchor, to, toAnchor);
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
