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

export interface IBaseHalfCanvasItem {
	readonly name: string;
	readonly kind: BaseHalfCanvasItemKind;
	readonly stat: IFileStat;
}

export interface IBaseHalfCanvasPosition {
	readonly x: number;
	readonly y: number;
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

export function baseHalfCanvasItemsFromStat(folder: IFileStat, rootLevel: boolean): IBaseHalfCanvasItem[] {
	const children = folder.children ?? [];
	return children
		.filter(child => isBaseHalfCanvasEntry(child, rootLevel))
		.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}

			return basename(a.resource).localeCompare(basename(b.resource));
		})
		.slice(0, BASEHALF_CANVAS_CHILD_LIMIT)
		.map(stat => ({
			name: basename(stat.resource),
			kind: stat.isDirectory ? 'folder' : 'file',
			stat
		}));
}

export function baseHalfCanvasPosition(index: number, total: number): IBaseHalfCanvasPosition {
	const cols = Math.max(5, Math.ceil(Math.sqrt(1.34 * Math.max(1, total))));
	return {
		x: 48 + (index % cols) * 260,
		y: 84 + Math.floor(index / cols) * 168
	};
}
