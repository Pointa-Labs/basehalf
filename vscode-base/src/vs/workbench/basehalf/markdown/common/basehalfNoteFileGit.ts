/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { dirname, isEqual, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { BASEHALF_NOTE_FILES_STORE_PATH } from './basehalfNoteFiles.js';

// Whether git keeps a home's store (files in notes, rule 46): the ignore
// files git reads for it, read as git reads them.

/** The two lines early versions of BaseHalf wrote into a user's `.gitignore`. */
export const BASEHALF_EARLY_GIT_IGNORE_LINES: readonly [string, string] = ['# BaseHalf derived cache', '.bh/'];

/** One line of an ignore file that names paths. */
interface IIgnoreRule {
	readonly negated: boolean;
	readonly directoryOnly: boolean;
	readonly pattern: RegExp;
	/** The line, counted from 1. */
	readonly line: number;
}

/** An ignore file and the folder, relative to the repository's root, whose paths its lines name. */
interface IIgnoreSource {
	readonly file: URI;
	readonly folder: string;
	readonly rules: readonly IIgnoreRule[];
}

/**
 * The lines of an ignore file that name paths, as git reads them: no blank
 * line or comment; `\#` and `\!` as the characters; a trailing space only
 * when escaped; `!` turning a line around; a trailing `/` for folders only;
 * a line with a `/` before its end read from the file's folder, any other
 * matching a name at any depth below it; `*`, `?`, `[…]`, and `**`.
 */
export function parseBaseHalfGitIgnore(text: string): IIgnoreRule[] {
	const rules: IIgnoreRule[] = [];
	text.split('\n').forEach((raw, index) => {
		let line = raw.replace(/\r$/, '');
		if (line === '' || line.startsWith('#')) {
			return;
		}
		line = line.replace(/(?<!\\)[ \t]+$/, '');
		let negated = false;
		if (line.startsWith('!')) {
			negated = true;
			line = line.slice(1);
		} else if (line.startsWith('\\!') || line.startsWith('\\#')) {
			line = line.slice(1);
		}
		const directoryOnly = line.endsWith('/');
		if (directoryOnly) {
			line = line.slice(0, -1);
		}
		if (line === '') {
			return;
		}
		const anchored = line.includes('/');
		const source = globSource(line.startsWith('/') ? line.slice(1) : line);
		rules.push({ negated, directoryOnly, pattern: new RegExp(anchored ? `^${source}$` : `^(?:.*/)?${source}$`), line: index + 1 });
	});
	return rules;
}

function globSource(pattern: string): string {
	let source = '';
	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index];
		if (character === '*' && pattern[index + 1] === '*' && (index === 0 || pattern[index - 1] === '/') && (index + 2 === pattern.length || pattern[index + 2] === '/')) {
			// `**/` is any number of folders, and a trailing `/**` all that is inside.
			source += index + 2 === pattern.length ? '.*' : '(?:.*/)?';
			index += index + 2 === pattern.length ? 1 : 2;
		} else if (character === '*') {
			source += '[^/]*';
		} else if (character === '?') {
			source += '[^/]';
		} else if (character === '[') {
			const end = pattern.indexOf(']', index + 2);
			if (end < 0) {
				source += '\\[';
			} else {
				const range = pattern.slice(index + 1, end);
				source += `[${range.startsWith('!') ? `^${range.slice(1)}` : range}]`.replace(/\\(?!\])/g, '\\\\');
				index = end;
			}
		} else if (character === '\\' && index + 1 < pattern.length) {
			source += escapeRegExp(pattern[++index]);
		} else {
			source += escapeRegExp(character);
		}
	}
	return source;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * The line that decides whether git leaves out the path `path`, relative to
 * the repository's root, a folder or not: of the sources that name it, the
 * first in their order, and in it the last line that matches; none when no
 * line does. A folder left out leaves out all it holds, so the folders
 * above the path are asked first.
 */
function decidingLine(sources: readonly IIgnoreSource[], path: string, isDirectory: boolean): { readonly source: IIgnoreSource; readonly rule: IIgnoreRule } | undefined {
	const segments = path.split('/');
	for (let length = 1; length <= segments.length; length++) {
		const part = segments.slice(0, length).join('/');
		const directory = length < segments.length || isDirectory;
		// The `.gitignore` files of the folders above the part, the deepest first, then `info/exclude` and the global file.
		const applying = sources.filter(source => source.folder === '' || part.startsWith(`${source.folder}/`));
		for (const source of applying) {
			const relative = source.folder === '' ? part : part.slice(source.folder.length + 1);
			const rule = [...source.rules].reverse().find(candidate => (!candidate.directoryOnly || directory) && candidate.pattern.test(relative));
			if (rule) {
				if (!rule.negated) {
					return { source, rule };
				}
				break;
			}
		}
	}
	return undefined;
}

export interface IBaseHalfNoteStoreGitCheck {
	/** Whether git leaves the store out. */
	readonly ignored: boolean;
	/** The ignore file and its line that leave it out. */
	readonly cause?: { readonly file: URI; readonly line: number };
	/** The first of the two lines early versions wrote, when they are the cause. */
	readonly early?: { readonly file: URI; readonly line: number };
}

export interface IBaseHalfNoteFileGitServices {
	readonly fileService: IFileService;
	/** The user's home folder, where git's global settings are. */
	readonly userHome?: URI;
}

/**
 * Whether the ignore files git reads leave the store of `home` out: the
 * `.gitignore` files from the repository's root down to the store,
 * `info/exclude`, and the global ignore file. Kept when `home` is in no
 * repository.
 */
export async function baseHalfNoteStoreGitCheck(services: IBaseHalfNoteFileGitServices, home: URI): Promise<IBaseHalfNoteStoreGitCheck> {
	const { fileService } = services;
	let root: URI | undefined;
	for (let folder = home; ; folder = dirname(folder)) {
		if (await fileService.exists(joinPath(folder, '.git'))) {
			root = folder;
			break;
		}
		if (isEqual(dirname(folder), folder)) {
			break;
		}
	}
	const homePath = root ? relativePath(root, home) : undefined;
	if (!root || homePath === undefined) {
		return { ignored: false };
	}
	const store = [homePath, ...BASEHALF_NOTE_FILES_STORE_PATH].filter(segment => segment !== '').join('/');
	const sources: IIgnoreSource[] = [];
	const read = async (file: URI, folder: string): Promise<string | undefined> => {
		try {
			const text = (await fileService.readFile(file)).value.toString();
			sources.push({ file, folder, rules: parseBaseHalfGitIgnore(text) });
			return text;
		} catch {
			return undefined;
		}
	};
	// The `.gitignore` files of the folders down to the store's, the deepest first.
	const segments = store.split('/');
	const folders = Array.from({ length: segments.length + 1 }, (_, index) => segments.slice(0, index).join('/'));
	for (const folder of folders.reverse()) {
		await read(joinPath(root, ...folder.split('/').filter(Boolean), '.gitignore'), folder);
	}
	await read(joinPath(await gitFolder(fileService, root), 'info', 'exclude'), '');
	const global = await globalIgnoreFile(services);
	if (global) {
		await read(global, '');
	}
	// The store, one of its folders, and a file in one.
	const deciding = decidingLine(sources, `${store}/0000000000/file`, false);
	if (!deciding) {
		return { ignored: false };
	}
	const cause = { file: deciding.source.file, line: deciding.rule.line };
	const lines = deciding.source.folder !== '' || deciding.source.file.path.endsWith('/.gitignore')
		? (await fileService.readFile(deciding.source.file).catch(() => undefined))?.value.toString().split('\n').map(line => line.replace(/\r$/, ''))
		: undefined;
	const early = lines && lines[cause.line - 1]?.trim() === BASEHALF_EARLY_GIT_IGNORE_LINES[1] && lines[cause.line - 2]?.trim() === BASEHALF_EARLY_GIT_IGNORE_LINES[0]
		? { file: cause.file, line: cause.line - 1 }
		: undefined;
	return { ignored: true, cause, ...(early ? { early } : {}) };
}

/**
 * `text` without the two lines early versions wrote at `line`, counted from
 * 1, and nothing else; none when they are not there any more.
 */
export function baseHalfWithoutEarlyGitIgnoreLines(text: string, line: number): string | undefined {
	const lines = text.split('\n');
	const first = lines[line - 1]?.replace(/\r$/, '').trim();
	const second = lines[line]?.replace(/\r$/, '').trim();
	if (first !== BASEHALF_EARLY_GIT_IGNORE_LINES[0] || second !== BASEHALF_EARLY_GIT_IGNORE_LINES[1]) {
		return undefined;
	}
	lines.splice(line - 1, 2);
	return lines.join('\n');
}

/** The repository's own folder: `.git`, or where a `.git` file of a worktree points, whose common folder holds `info/`. */
async function gitFolder(fileService: IFileService, root: URI): Promise<URI> {
	const git = joinPath(root, '.git');
	const stat = await fileService.stat(git).catch(() => undefined);
	if (!stat || stat.isDirectory) {
		return git;
	}
	const pointer = /^gitdir:\s*(.+?)\s*$/m.exec((await fileService.readFile(git).catch(() => undefined))?.value.toString() ?? '')?.[1];
	if (!pointer) {
		return git;
	}
	const folder = pointer.startsWith('/') ? git.with({ path: pointer }) : joinPath(root, pointer);
	const common = (await fileService.readFile(joinPath(folder, 'commondir')).catch(() => undefined))?.value.toString().trim();
	return common ? (common.startsWith('/') ? folder.with({ path: common }) : joinPath(folder, common)) : folder;
}

/** The global ignore file: `core.excludesFile` of the user's git settings, or git's own place for it. */
async function globalIgnoreFile(services: IBaseHalfNoteFileGitServices): Promise<URI | undefined> {
	const { fileService, userHome } = services;
	if (!userHome) {
		return undefined;
	}
	for (const config of [joinPath(userHome, '.gitconfig'), joinPath(userHome, '.config', 'git', 'config')]) {
		const text = (await fileService.readFile(config).catch(() => undefined))?.value.toString();
		const value = text && excludesFile(text);
		if (value) {
			return value.startsWith('~/') ? joinPath(userHome, value.slice(2)) : value.startsWith('/') ? userHome.with({ path: value }) : joinPath(userHome, value);
		}
	}
	return joinPath(userHome, '.config', 'git', 'ignore');
}

/** `core.excludesFile` of a git settings file. */
function excludesFile(text: string): string | undefined {
	let core = false;
	let found: string | undefined;
	for (const raw of text.split('\n')) {
		const line = raw.replace(/[#;].*$/, '').trim();
		const section = /^\[\s*([^\]\s"]+)/.exec(line)?.[1];
		if (section !== undefined) {
			core = section.toLowerCase() === 'core';
			continue;
		}
		const setting = core ? /^excludesfile\s*=\s*(.*)$/i.exec(line) : undefined;
		if (setting) {
			found = setting[1].replace(/^"(.*)"$/, '$1');
		}
	}
	return found;
}
