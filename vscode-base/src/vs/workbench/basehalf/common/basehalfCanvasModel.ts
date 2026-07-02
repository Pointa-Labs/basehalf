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

export interface IBaseHalfCanvasBadgeMetadata {
	readonly description?: string;
	readonly references: readonly string[];
	readonly referenced_by: readonly string[];
	readonly orphan?: boolean;
}

export interface IBaseHalfCanvasEdge {
	readonly from: string;
	readonly from_anchor: BaseHalfCanvasAnchor;
	readonly to: string;
	readonly to_anchor: BaseHalfCanvasAnchor;
	readonly label?: string;
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

export interface IBaseHalfCanvasEdgeLabelLayout extends IBaseHalfCanvasPosition {
	readonly text: string;
}

export interface IBaseHalfCanvasEdgeLayout {
	readonly edge: IBaseHalfCanvasEdge;
	readonly from: IBaseHalfCanvasPosition;
	readonly to: IBaseHalfCanvasPosition;
	readonly path: string;
	readonly label?: IBaseHalfCanvasEdgeLabelLayout;
}

export interface IBaseHalfCanvasEdgeLayoutResult {
	readonly edges: readonly IBaseHalfCanvasEdgeLayout[];
	readonly dropped: number;
}

export interface IBaseHalfCanvasFolderModel {
	readonly items: readonly IBaseHalfCanvasItem[];
	readonly edges: readonly IBaseHalfCanvasEdge[];
	readonly droppedEdges: number;
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
	const items = eligibleChildren.slice(0, BASEHALF_CANVAS_CHILD_LIMIT).map(stat => {
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

	const itemPaths = new Set(items.map(item => item.path));
	const allEdges = options.canvas?.edges ?? [];
	const edges = allEdges.filter(edge => itemPaths.has(edge.from) && itemPaths.has(edge.to));

	return {
		items,
		edges,
		droppedEdges: allEdges.length - edges.length,
		truncated: Math.max(0, eligibleChildren.length - items.length),
		size: options.canvas?.size
	};
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
		const label = edge.label ? {
			text: edge.label,
			x: roundCanvasNumber((from.x + to.x) / 2),
			y: roundCanvasNumber((from.y + to.y) / 2)
		} : undefined;

		layouts.push({
			edge,
			from,
			to,
			path: baseHalfCanvasEdgePath(from, edge.from_anchor, to, edge.to_anchor),
			...(label ? { label } : {})
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
