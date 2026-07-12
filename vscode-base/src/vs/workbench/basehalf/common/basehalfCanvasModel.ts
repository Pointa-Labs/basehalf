/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../base/common/resources.js';
import { IFileStat } from '../../../platform/files/common/files.js';
import type { IBaseHalfBadgeReadProblem } from './basehalfBadgeMirror.js';

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

export interface IBaseHalfCanvasBadgeMetadata {
	readonly description?: string;
	readonly references: readonly string[];
	readonly referenced_by: readonly string[];
	readonly orphan?: boolean;
}

export interface IBaseHalfCanvasBadgeRelationships {
	readonly references: readonly string[];
	readonly referencedBy: readonly string[];
	readonly issues: readonly IBaseHalfCanvasBadgeRelationshipIssue[];
}

export type BaseHalfCanvasBadgeRelationshipIssueDirection = 'outbound' | 'inbound';
export type BaseHalfCanvasBadgeRelationshipIssueReason = 'incomplete' | 'unreadable';

export interface IBaseHalfCanvasBadgeRelationshipIssue {
	/** Direction relative to the badge passed to `baseHalfCanvasBadgeRelationships`. */
	readonly direction: BaseHalfCanvasBadgeRelationshipIssueDirection;
	readonly from: string;
	readonly to: string;
	readonly reason: BaseHalfCanvasBadgeRelationshipIssueReason;
	/** Present when the missing reciprocal endpoint could not be read. */
	readonly problem?: IBaseHalfBadgeReadProblem;
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
	readonly badges?: ReadonlyMap<string, IBaseHalfCanvasBadgeMetadata>;
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
		return {
			path,
			name,
			kind,
			stat,
			...(card ? { card } : {}),
			...(badge ? { badge } : {})
		};
	});

	// The child cap only ever cuts UN-annotated filler: a child the user has
	// touched — described, linked, placed, or orphaned — is part of the curated
	// set and always survives, no matter how large the flat folder is.
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
		edges: deriveCanvasEdges(items, options.canvas?.edges ?? [], options.badges ?? new Map()),
		truncated: Math.max(0, allItems.length - items.length),
		size: options.canvas?.size
	};
}

/**
 * Resolve only fully recorded context-flow relationships for one badge. Agent
 * writes can update the two mirror files sequentially, so every product surface
 * must fail closed during the one-sided interval instead of presenting a
 * relationship that the canvas cannot draw.
 */
export function baseHalfCanvasBadgeRelationships(
	path: string,
	badge: IBaseHalfCanvasBadgeMetadata | undefined,
	badges: ReadonlyMap<string, IBaseHalfCanvasBadgeMetadata>,
	problems?: ReadonlyMap<string, IBaseHalfBadgeReadProblem>
): IBaseHalfCanvasBadgeRelationships {
	const references: string[] = [];
	const referencedBy: string[] = [];
	const issues: IBaseHalfCanvasBadgeRelationshipIssue[] = [];
	for (const to of new Set(badge?.references ?? [])) {
		if (to === path) {
			continue;
		}
		if (badges.get(to)?.referenced_by.includes(path)) {
			references.push(to);
			continue;
		}
		const problem = problems?.get(to);
		issues.push({
			direction: 'outbound',
			from: path,
			to,
			reason: problem ? 'unreadable' : 'incomplete',
			...(problem ? { problem } : {})
		});
	}
	for (const from of new Set(badge?.referenced_by ?? [])) {
		if (from === path) {
			continue;
		}
		if (badges.get(from)?.references.includes(path)) {
			referencedBy.push(from);
			continue;
		}
		const problem = problems?.get(from);
		issues.push({
			direction: 'inbound',
			from,
			to: path,
			reason: problem ? 'unreadable' : 'incomplete',
			...(problem ? { problem } : {})
		});
	}
	return {
		references,
		referencedBy,
		issues
	};
}

function isAnnotatedItem(item: IBaseHalfCanvasItem): boolean {
	return item.card !== undefined
		|| item.badge !== undefined; // badges are pruned when empty, so presence = authored content
}

/**
 * The edge set is DERIVED from the reference graph: an edge exists iff a child
 * REFERENCES a sibling child and that sibling records the reciprocal
 * REFERENCED_BY (both present on this canvas). A -> B means A's context flows
 * into B. The canvas.yaml `edges` supply only non-derivable anchor placement.
 * This keeps the drawing a strict visual projection of the
 * semantic graph: a reference an agent writes straight into badge.yaml draws
 * immediately (with default anchors), a reference removed anywhere never
 * leaves a phantom line, and a rename that rewrites the graph keeps its lines
 * even where the anchor placement went stale.
 */
function deriveCanvasEdges(
	items: readonly IBaseHalfCanvasItem[],
	styled: readonly IBaseHalfCanvasEdge[],
	badges: ReadonlyMap<string, IBaseHalfCanvasBadgeMetadata>
): IBaseHalfCanvasEdge[] {
	const itemPaths = new Set(items.map(item => item.path));
	const styleByPair = new Map(styled.map(edge => [edgePairKey(edge.from, edge.to), edge]));
	const edges: IBaseHalfCanvasEdge[] = [];
	for (const item of items) {
		for (const to of baseHalfCanvasBadgeRelationships(item.path, item.badge, badges).references) {
			if (!itemPaths.has(to)) {
				// Not a sibling on this canvas (e.g. a cross-folder reference):
				// semantic-only, listed in the badge face, not drawable here.
				continue;
			}

			edges.push(styleByPair.get(edgePairKey(item.path, to)) ?? {
				from: item.path,
				from_anchor: 'east',
				to,
				to_anchor: 'west'
			});
		}
	}

	return edges;
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
