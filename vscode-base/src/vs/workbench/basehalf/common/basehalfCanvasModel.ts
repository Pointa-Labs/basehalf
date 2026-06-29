/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../base/common/resources.js';
import { IFileStat } from '../../../platform/files/common/files.js';

export const BASEHALF_CANVAS_CHILD_LIMIT = 300;

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

export interface IBaseHalfCanvasEdge {
	readonly from: string;
	readonly from_anchor: 'north' | 'east' | 'south' | 'west';
	readonly to: string;
	readonly to_anchor: 'north' | 'east' | 'south' | 'west';
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
}

export interface IBaseHalfCanvasPosition {
	readonly x: number;
	readonly y: number;
}

export interface IBaseHalfCanvasFolderModel {
	readonly items: readonly IBaseHalfCanvasItem[];
	readonly truncated: number;
	readonly size?: IBaseHalfCanvasSize;
}

export interface IBaseHalfCanvasModelOptions {
	readonly rootLevel: boolean;
	readonly folderRelativePath?: string;
	readonly canvas?: IBaseHalfCanvasFile | null;
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
		return {
			path,
			name,
			kind,
			stat,
			...(card ? { card } : {})
		};
	});

	return {
		items,
		truncated: Math.max(0, eligibleChildren.length - items.length),
		size: options.canvas?.size
	};
}

export function baseHalfCanvasItemsFromStat(folder: IFileStat, rootLevel: boolean): IBaseHalfCanvasItem[] {
	return [...baseHalfCanvasModelFromStat(folder, { rootLevel }).items];
}

export function baseHalfCanvasPosition(index: number, total: number): IBaseHalfCanvasPosition {
	const cols = Math.max(5, Math.ceil(Math.sqrt(1.34 * Math.max(1, total))));
	return {
		x: 48 + (index % cols) * 260,
		y: 84 + Math.floor(index / cols) * 168
	};
}

function childPath(folderRelativePath: string, name: string): string {
	return folderRelativePath ? `${folderRelativePath}/${name}` : name;
}
