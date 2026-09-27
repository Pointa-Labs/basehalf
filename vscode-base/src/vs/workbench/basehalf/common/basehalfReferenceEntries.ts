/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IExtUri } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';

/**
 * Upstream entry grammar and identity (reference graph, D37).
 *
 * An entry is the source text of one item of a downstream node's `upstream`
 * list. Plain YAML scalars are never type-resolved, so `2024` names the path
 * `2024`. One trailing `/` is removed before validation.
 */

/** The largest upstream list a `.bhnode` document may be written with. */
export const BASEHALF_UPSTREAM_MAX_NODE_ENTRIES = 64;

/**
 * Why one upstream item is not a valid entry.
 * - `empty`: an empty item, an empty string, or `~`.
 * - `notScalar`: a mapping or sequence item.
 * - `notString`: a non-string `.bhnode` item.
 * - `absolute`: starts with `/`.
 * - `backslash`: contains `\`.
 * - `controlCharacter`: contains NUL or another control character.
 * - `invalidSegment`: an empty, `.`, or `..` segment.
 * - `metadata`: the first segment is `.bh`.
 * - `self`: names the downstream node itself.
 * - `duplicate`: repeats an earlier entry.
 * - `overLimit`: a `.bhnode` entry past the 64th.
 */
export type BaseHalfUpstreamEntryProblem =
	| 'empty'
	| 'notScalar'
	| 'notString'
	| 'absolute'
	| 'backslash'
	| 'controlCharacter'
	| 'invalidSegment'
	| 'metadata'
	| 'self'
	| 'duplicate'
	| 'overLimit';

/** The value of one upstream item, independent of its store. */
export interface IBaseHalfUpstreamItemValue {
	/**
	 * For a scalar item, the decoded scalar text (plain scalars are taken
	 * verbatim, quoted scalars are unescaped). For every other item (`~`, an
	 * empty item, a mapping, a sequence, a non-string `.bhnode` value) the raw
	 * source text of the item (JSON text for `.bhnode`).
	 */
	readonly text: string;
	/** True when `text` is an entry string that BaseHalf may re-quote. */
	readonly scalar: boolean;
}

/** One analyzed item of an upstream list. */
export interface IBaseHalfUpstreamItem extends IBaseHalfUpstreamItemValue {
	/** Zero-based position in the list. */
	readonly index: number;
	/** The entry path after removing one trailing `/`, when the item is a valid entry. */
	readonly path: string | undefined;
	/** Why the item is not a valid entry; `undefined` for a valid entry. */
	readonly problem: BaseHalfUpstreamEntryProblem | undefined;
}

/**
 * Identity of workspace-relative paths inside one workspace folder. Entries
 * and file names are compared after NFC normalization, then with the
 * `IUriIdentityService` comparison of the folder's file system.
 */
export interface IBaseHalfUpstreamIdentity {
	/** Comparison key for a normalized workspace-relative path. */
	key(path: string): string;
}

/** NFC, case-sensitive identity for pure code and tests. */
export const BASEHALF_EXACT_UPSTREAM_IDENTITY: IBaseHalfUpstreamIdentity = Object.freeze({
	key: (path: string) => path.normalize('NFC')
});

/**
 * The identity used by the reference services: NFC normalization, then the
 * `extUri` comparison key of the path joined to the workspace folder, so a
 * case-only difference matches on a case-insensitive file system.
 */
export function baseHalfUpstreamIdentity(workspaceFolder: URI, extUri: IExtUri): IBaseHalfUpstreamIdentity {
	return Object.freeze({
		key: (path: string) => {
			const normalized = path.normalize('NFC');
			return extUri.getComparisonKey(normalized ? URI.joinPath(workspaceFolder, ...normalized.split('/')) : workspaceFolder);
		}
	});
}

/** Comparison key of a node resource under the same rules as {@link baseHalfUpstreamIdentity}. */
export function baseHalfUpstreamResourceKey(resource: URI, extUri: IExtUri): string {
	return extUri.getComparisonKey(resource.with({ path: resource.path.normalize('NFC') }));
}

/** Removes one trailing `/`, the only normalization applied before validation. */
export function baseHalfNormalizeUpstreamEntry(entry: string): string {
	return entry.endsWith('/') ? entry.slice(0, -1) : entry;
}

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Validates the path grammar of one entry, without self or duplicate checks.
 * Characters the file system accepts in a name (`?`, `:`, `*`, `"`, `<`, `>`,
 * `|`, non-ASCII text, …) are valid.
 */
export function baseHalfUpstreamEntryGrammarProblem(entry: string): BaseHalfUpstreamEntryProblem | undefined {
	const path = baseHalfNormalizeUpstreamEntry(entry);
	if (path === '') {
		return entry === '' ? 'empty' : 'absolute';
	}
	if (path.startsWith('/')) {
		return 'absolute';
	}
	if (path.includes('\\')) {
		return 'backslash';
	}
	if (CONTROL_CHARACTER.test(path)) {
		return 'controlCharacter';
	}
	const segments = path.split('/');
	if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
		return 'invalidSegment';
	}
	if (segments[0].toLowerCase() === '.bh') {
		return 'metadata';
	}
	return undefined;
}

/**
 * Validates one entry against the grammar and the downstream node itself.
 * `nodePath` is the downstream node's workspace-relative path.
 */
export function baseHalfUpstreamEntryProblem(
	entry: string,
	nodePath: string | undefined,
	identity: IBaseHalfUpstreamIdentity = BASEHALF_EXACT_UPSTREAM_IDENTITY
): BaseHalfUpstreamEntryProblem | undefined {
	const problem = baseHalfUpstreamEntryGrammarProblem(entry);
	if (problem) {
		return problem;
	}
	if (nodePath !== undefined && identity.key(baseHalfNormalizeUpstreamEntry(entry)) === identity.key(nodePath)) {
		return 'self';
	}
	return undefined;
}

/**
 * Analyzes an ordered list of item values. Validation is per item: one
 * invalid item never hides the valid items of the same list. A later
 * duplicate of an earlier entry is invalid. `maxEntries` marks every item past
 * that position as `overLimit` (the `.bhnode` rule).
 */
export function baseHalfAnalyzeUpstreamItems(
	values: readonly IBaseHalfUpstreamItemValue[],
	nodePath: string | undefined,
	identity: IBaseHalfUpstreamIdentity = BASEHALF_EXACT_UPSTREAM_IDENTITY,
	options: { readonly maxEntries?: number; readonly nonScalarProblem?: BaseHalfUpstreamEntryProblem } = {}
): IBaseHalfUpstreamItem[] {
	const seen = new Set<string>();
	return values.map((value, index): IBaseHalfUpstreamItem => {
		let problem: BaseHalfUpstreamEntryProblem | undefined;
		let path: string | undefined;
		if (!value.scalar) {
			problem = options.nonScalarProblem ?? (value.text === '' || value.text === '~' ? 'empty' : 'notScalar');
		} else {
			problem = baseHalfUpstreamEntryProblem(value.text, nodePath, identity);
			if (!problem) {
				path = baseHalfNormalizeUpstreamEntry(value.text);
				const key = identity.key(path);
				if (seen.has(key)) {
					problem = 'duplicate';
				}
				seen.add(key);
			} else if (problem === 'self') {
				seen.add(identity.key(baseHalfNormalizeUpstreamEntry(value.text)));
			}
		}
		if (!problem && options.maxEntries !== undefined && index >= options.maxEntries) {
			problem = 'overLimit';
		}
		return Object.freeze({
			index,
			text: value.text,
			scalar: value.scalar,
			path: problem ? undefined : path,
			problem
		});
	});
}

/**
 * Reads an entry relative to the downstream node's parent folder, as agents
 * and people often write it (`./x.md`, `../overview.md`, `sub\\x.md`). Returns
 * the workspace-relative path it names, or `undefined` when it escapes the
 * workspace folder, names the root, or is not a relative path. Callers offer
 * "Use <workspace path>" only when this path names an existing node.
 */
export function baseHalfResolveFileRelativeUpstreamEntry(entry: string, nodePath: string): string | undefined {
	const normalized = baseHalfNormalizeUpstreamEntry(entry.replace(/\\/g, '/'));
	if (normalized === '' || normalized.startsWith('/') || CONTROL_CHARACTER.test(normalized)) {
		return undefined;
	}
	const parent = nodePath.includes('/') ? nodePath.slice(0, nodePath.lastIndexOf('/')).split('/') : [];
	const segments = [...parent];
	for (const segment of normalized.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}
		if (segment === '..') {
			if (segments.length === 0) {
				return undefined;
			}
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	const resolved = segments.join('/');
	if (resolved === '' || baseHalfUpstreamEntryGrammarProblem(resolved)) {
		return undefined;
	}
	return resolved;
}

const YAML_INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`]/;
const YAML_NULL = /^(?:~|null|Null|NULL)$/;
const YAML_BOOL = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const YAML_INT = new RegExp([
	'^[-+]?0b[0-1_]+$',
	'^[-+]?0o?[0-7_]+$',
	'^[-+]?(?:0|[1-9][0-9_]*)$',
	'^[-+]?[0-9]+$',
	'^[-+]?0x[0-9a-fA-F_]+$',
	'^[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+$'
].join('|'));
const YAML_FLOAT = new RegExp([
	'^[-+]?(?:[0-9][0-9_]*)?\\.[0-9._]*(?:[eE][-+]?[0-9]+)?$',
	'^[-+]?(?:\\.[0-9]+|[0-9]+(?:\\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$',
	'^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\\.[0-9_]*$',
	'^[-+]?\\.(?:inf|Inf|INF)$',
	'^\\.(?:nan|NaN|NAN)$'
].join('|'));
const YAML_TIMESTAMP = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:(?:[Tt]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9]{1,2}(?::[0-9]{2})?))?)?$/;
const YAML_OTHER_TYPED = /^(?:<<|=)$/;

/**
 * Returns whether an entry must be written as a double-quoted YAML scalar:
 * it starts with an indicator or whitespace, ends with whitespace or `:`,
 * contains `: `, ` #`, `,`, a bracket, a brace, a quote, a tab, or a control
 * character, or matches a YAML 1.1 or 1.2 null, bool, int, float, or timestamp
 * form. Everything else is written plain.
 */
export function baseHalfUpstreamEntryNeedsQuotes(entry: string): boolean {
	if (entry === '') {
		return true;
	}
	if (YAML_INDICATOR_START.test(entry) || /^\s/.test(entry) || /\s$/.test(entry) || entry.endsWith(':')) {
		return true;
	}
	if (/: |\s#|[,[\]{}"'\t]/.test(entry) || CONTROL_CHARACTER.test(entry) || /[\u2028\u2029\uFEFF]/.test(entry)) {
		return true;
	}
	return YAML_NULL.test(entry)
		|| YAML_BOOL.test(entry)
		|| YAML_INT.test(entry)
		|| YAML_FLOAT.test(entry)
		|| YAML_TIMESTAMP.test(entry)
		|| YAML_OTHER_TYPED.test(entry)
		|| entry.startsWith('---')
		|| entry.startsWith('...');
}

/** Formats one entry as a YAML scalar under the quoting rule. */
export function baseHalfFormatUpstreamEntry(entry: string): string {
	return baseHalfUpstreamEntryNeedsQuotes(entry) ? JSON.stringify(entry) : entry;
}
