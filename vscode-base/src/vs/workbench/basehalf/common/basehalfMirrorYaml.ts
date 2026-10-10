/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { parse as parseYaml, YamlMapNode, YamlNode, YamlParseError } from '../../../base/common/yaml.js';

/**
 * The one value grammar of `canvas.yaml`, `badge.yaml`, and `adhd.yaml`
 * (mirror file resilience, "Value grammar"). A field is read by the type its
 * schema gives it, never by what its text looks like: a string field takes the
 * text of any scalar, so `"09"`, `'09'`, and `09` all read as the string `09`.
 * Strings are always written double-quoted, and the write check of each mirror
 * service reads its bytes back through these readers before committing them.
 */

const DECIMAL_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * The write check refused bytes: the reader did not accept all of them or did
 * not return the value that was serialized. Nothing was written. This marks a
 * defect in BaseHalf, not a problem with the user's data.
 */
export class BaseHalfMirrorWriteRejected extends Error {
	override readonly name = 'BaseHalfMirrorWriteRejected';

	constructor(readonly resource: URI, readonly reason: string) {
		super(`BaseHalf refused to write ${resource.toString()} because it could not read the result back: ${reason}`);
	}
}

/**
 * Whether the `path` a mirror file stores names the node whose mirror
 * directory the file was found in. A stored path that differs only in letter
 * case or Unicode normalization still does: that is what a rename made outside
 * BaseHalf leaves behind on a file system that ignores those differences
 * (mirror file resilience, "The stored path"). The file is read as the node's
 * own, and the next write stores the current spelling.
 */
export function baseHalfMirrorPathNamesNode(stored: string, expected: string): boolean {
	return stored === expected || stored.normalize('NFC').toLowerCase() === expected.normalize('NFC').toLowerCase();
}

/** The bytes cannot be read as a mirror document at all: a content failure. */
export class BaseHalfMirrorYamlUnreadable extends Error {
	override readonly name = 'BaseHalfMirrorYamlUnreadable';

	constructor(readonly reason: string) {
		super(reason);
	}
}

export interface IBaseHalfMirrorYamlDocument {
	/** The root mapping, or `null` for an empty document. */
	readonly root: YamlMapNode | null;
	/**
	 * Set when the parser stopped before the end of the text, with the line it
	 * stopped at. `root` holds only what came before; the rest was not read.
	 */
	readonly unparsed?: string;
}

/**
 * Parses a mirror document. Throws {@link BaseHalfMirrorYamlUnreadable} on a
 * YAML syntax error or a root that is not a mapping; `label` names the
 * document in that reason.
 */
export function baseHalfParseMirrorYaml(raw: string, label: string): IBaseHalfMirrorYamlDocument {
	// An editor may have saved the file with a byte order mark.
	const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
	const errors: YamlParseError[] = [];
	const node = parseYaml(text, errors);
	// `key:` and `- ` without a value are valid YAML for an empty value. The
	// parser reports them and still yields an empty plain scalar there.
	const failure = errors.find(error => error.code !== 'missing-value');
	if (failure) {
		throw new BaseHalfMirrorYamlUnreadable(failure.message);
	}
	if (node && node.type !== 'map') {
		throw new BaseHalfMirrorYamlUnreadable(`${label} root must be an object`);
	}
	// The parser stops at text it cannot place, such as the markers of a merge
	// conflict, and reports nothing. What follows was never read, so a caller
	// must not take the document for a complete one.
	const stoppedAt = firstUnparsedLine(text, node?.endOffset ?? 0);
	if (!node) {
		if (stoppedAt !== undefined) {
			throw new BaseHalfMirrorYamlUnreadable(`line ${stoppedAt} is not YAML`);
		}
		return { root: null };
	}
	return stoppedAt === undefined ? { root: node } : { root: node, unparsed: `line ${stoppedAt} and what follows could not be read` };
}

/** The first line at or after `offset` that holds more than white space, a comment, or a document marker. */
function firstUnparsedLine(text: string, offset: number): number | undefined {
	let line = 1;
	for (let index = text.indexOf('\n'); index !== -1 && index < offset; index = text.indexOf('\n', index + 1)) {
		line++;
	}
	for (const rest of text.slice(offset).split('\n')) {
		const content = rest.trim();
		if (content !== '' && !content.startsWith('#') && content !== '...' && content !== '---') {
			return line;
		}
		line++;
	}
	return undefined;
}

/** The value of `key` in a mapping. */
export function baseHalfMirrorYamlProperty(map: YamlMapNode, key: string): YamlNode | undefined {
	let value: YamlNode | undefined;
	for (const property of map.properties) {
		if (property.key.value === key) {
			value = property.value;
		}
	}
	return value;
}

export function baseHalfMirrorYamlMap(node: YamlNode | undefined): YamlMapNode | undefined {
	return node?.type === 'map' ? node : undefined;
}

/** Whether a key has no value: it is missing, or a plain `~` or `null`. */
export function baseHalfMirrorYamlAbsent(node: YamlNode | undefined): boolean {
	return !node || (node.type === 'scalar' && node.format === 'none' && (node.value === '~' || node.value === 'null'));
}

/** The text of any scalar. */
export function baseHalfMirrorYamlString(node: YamlNode | undefined): string | undefined {
	if (node?.type !== 'scalar' || baseHalfMirrorYamlAbsent(node)) {
		return undefined;
	}
	return node.value;
}

/** A finite number from a scalar whose text is a decimal number. */
export function baseHalfMirrorYamlNumber(node: YamlNode | undefined): number | undefined {
	if (node?.type !== 'scalar') {
		return undefined;
	}
	const text = node.value.trim();
	if (!DECIMAL_NUMBER.test(text)) {
		return undefined;
	}
	const value = Number(text);
	return Number.isFinite(value) ? value : undefined;
}

export function baseHalfMirrorYamlBoolean(node: YamlNode | undefined): boolean | undefined {
	if (node?.type !== 'scalar') {
		return undefined;
	}
	const text = node.value.trim();
	return text === 'true' ? true : text === 'false' ? false : undefined;
}

/**
 * The items of a list. An absent or plain empty value is an empty list; any
 * other value that is not a sequence is `undefined`.
 */
export function baseHalfMirrorYamlItems(node: YamlNode | undefined): readonly YamlNode[] | undefined {
	if (!node || baseHalfMirrorYamlAbsent(node)) {
		return [];
	}
	if (node.type === 'sequence') {
		return node.items;
	}
	return node.type === 'scalar' && node.format === 'none' && node.value === '' ? [] : undefined;
}

/** A string as every mirror file writes it: double-quoted with JSON escapes. */
export function baseHalfMirrorYamlQuote(value: string): string {
	return JSON.stringify(value);
}
