/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename, extname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileStat } from '../../../../platform/files/common/files.js';
import { isBaseHalfRenderableContentResource } from './basehalfContentRendering.js';

// What BaseHalf knows of an item of a workspace by its path alone: whether it
// is a note or media, the name BaseHalf shows for it, the icon of its kind, and
// whether BaseHalf shows it at all. Every feature reads items this way.

//#region Notes, media, and the names BaseHalf shows

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/** Whether the file is a note. */
export function isBaseHalfMarkdownResource(resource: URI): boolean {
	return MARKDOWN_EXTENSIONS.has(extname(resource).toLowerCase());
}

/**
 * The extension of a note's file name as it is written, or the empty string
 * for a name that is not a note's. A name that is only the extension is not a
 * note's.
 */
export function baseHalfNoteNameExtension(fileName: string): string {
	const dot = fileName.lastIndexOf('.');
	if (dot <= 0) {
		return '';
	}
	const extension = fileName.slice(dot);
	return MARKDOWN_EXTENSIONS.has(extension.toLowerCase()) ? extension : '';
}

/**
 * The name BaseHalf shows for an item where it names the item (D55): a note
 * by its file name without the extension, every other file and every folder
 * by its file name.
 */
export function baseHalfItemDisplayName(fileName: string, isFolder: boolean): string {
	const extension = isFolder ? '' : baseHalfNoteNameExtension(fileName);
	return extension ? fileName.slice(0, -extension.length) : fileName;
}

/**
 * The file name for a name typed into the rename editor of a note whose file
 * has `extension`. A typed name that ends with the extension is the file name.
 */
export function baseHalfNoteFileName(typed: string, extension: string): string {
	return typed.length > extension.length && typed.toLowerCase().endsWith(extension.toLowerCase())
		? typed
		: `${typed}${extension}`;
}

/** Whether the file is a picture, a video, a sound, a PDF, or a book. */
export function isBaseHalfMediaResource(resource: URI): boolean {
	return isBaseHalfRenderableContentResource(resource);
}

//#endregion

//#region The icon of an item's kind

/** The icon of an item's kind, as the caption of its card draws it. */
export type BaseHalfItemKindIcon = 'folder' | 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'book' | 'code' | 'generic';

/**
 * The kind of an item by its name, as the caption of its card draws it. The
 * canvas and the status bar share it.
 */
export function baseHalfItemIcon(name: string, isFolder: boolean): BaseHalfItemKindIcon {
	if (isFolder) {
		return 'folder';
	}
	const lower = name.toLowerCase();
	const dot = lower.lastIndexOf('.');
	const ext = dot === -1 || dot === lower.length - 1 ? '' : lower.slice(dot + 1);
	const base = dot === -1 ? lower : lower.slice(0, dot);
	if (['md', 'markdown', 'mdx', 'txt', 'rst', 'org', 'gitignore', 'dockerignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc', 'csv', 'tsv', 'log', 'text'].includes(ext) || ['readme', 'license', 'changelog', 'authors', 'notice', 'copying'].includes(base)) {
		return 'text';
	}
	if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif', 'ico', 'tiff'].includes(ext)) {
		return 'image';
	}
	if (['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'opus'].includes(ext)) {
		return 'audio';
	}
	if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'].includes(ext)) {
		return 'video';
	}
	if (ext === 'pdf') {
		return 'pdf';
	}
	if (['epub', 'mobi', 'azw', 'azw3', 'fb2', 'fbz', 'cbz'].includes(ext)) {
		return 'book';
	}
	if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'rb', 'c', 'cpp', 'h', 'cs', 'php', 'swift', 'kt', 'json', 'yaml', 'yml', 'toml', 'css', 'scss', 'html', 'xml', 'sh', 'sql', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'ini', 'conf', 'cfg', 'env', 'properties', 'lock', 'lua', 'pl', 'r', 'gradle', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'proto'].includes(ext) || ['dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile', 'jenkinsfile', 'vagrantfile'].includes(base)) {
		return 'code';
	}
	return 'generic';
}

//#endregion

//#region The items BaseHalf shows

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

/** Whether the canvas shows the entry as a card: `rootLevel` for an entry of the workspace folder itself. */
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

//#endregion
