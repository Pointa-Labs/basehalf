/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfVideoInputKind, findBaseHalfVideoLabelTokens, IBaseHalfVideoLabelToken } from './basehalfVideoCatalog.js';

/**
 * The names in a prompt (generation cards, "Inputs" and "Names follow their
 * inputs", D68): which input each name means, the chips the prompt shows, and
 * the names written again after a change of the card's list. A name is text
 * (`图片1`, `Image 1`): what `generation.yaml` stores, what agents write, and
 * what a provider receives. Pure.
 */

/** The kinds of input a prompt can name. */
export type BaseHalfNamedInputKind = 'image' | 'video' | 'audio';

/** One entry of a card's list as the names see it: who it is and its kind. */
export interface IBaseHalfInputListEntry {
	/**
	 * Says which input the entry is, so that the same input is found in the
	 * list before and after a change: the path's comparison key, which ignores
	 * case where the volume does.
	 */
	readonly key: string;
	readonly kind: BaseHalfVideoInputKind;
}

/** An entry that a replace put in place of another, by their keys. */
export interface IBaseHalfInputReplacement {
	readonly from: string;
	readonly to: string;
}

/** A name in a prompt, and the input of the list it means when there is one. */
export interface IBaseHalfPromptName extends IBaseHalfVideoLabelToken {
	/** The index in the list of the input it names; absent when it names none. */
	readonly index?: number;
}

/** Whether inputs of this kind have names. */
export function isBaseHalfNamedInputKind(kind: BaseHalfVideoInputKind): kind is BaseHalfNamedInputKind {
	return kind === 'image' || kind === 'video' || kind === 'audio';
}

/**
 * The number of each entry's name, by kind in list order, used or not
 * (`1` for 图片1); `undefined` for an entry without a name.
 */
export function baseHalfInputNameOrdinals(entries: readonly { readonly kind: BaseHalfVideoInputKind }[]): readonly (number | undefined)[] {
	const counts = { image: 0, video: 0, audio: 0 };
	return entries.map(entry => isBaseHalfNamedInputKind(entry.kind) ? ++counts[entry.kind] : undefined);
}

/** The names in a prompt, each with the index of the input of `entries` it means. */
export function baseHalfPromptNames(prompt: string, entries: readonly { readonly kind: BaseHalfVideoInputKind }[]): readonly IBaseHalfPromptName[] {
	const byName = nameIndex(entries);
	return Object.freeze(findBaseHalfVideoLabelTokens(prompt).map(token => {
		const index = byName.get(nameKey(token.kind, token.ordinal));
		return Object.freeze(index === undefined ? { ...token } : { ...token, index });
	}));
}

/**
 * The prompt with its names written again for a change of the card's list
 * from `before` to `after`, or `undefined` when no name changes:
 *
 * - a name of an input that is still in the list takes the input's new
 *   number, in the form it was written in (`图片2` or `Image 2`);
 * - a name of an input that is no longer in the list is taken out, with the
 *   one space after it, or the one before it when none follows;
 * - a name that meant no input of `before` stays as it is.
 *
 * An input is found again by its key; an entry that a replace put in place of
 * another is the same input when it is of the same kind.
 */
export function rewriteBaseHalfPromptNames(
	prompt: string,
	before: readonly IBaseHalfInputListEntry[],
	after: readonly IBaseHalfInputListEntry[],
	replacements: readonly IBaseHalfInputReplacement[] = []
): string | undefined {
	const tokens = findBaseHalfVideoLabelTokens(prompt);
	if (tokens.length === 0) {
		return undefined;
	}
	const mapping = baseHalfInputNameMapping(before, after, replacements);
	let changed = false;
	let output = '';
	let offset = 0;
	for (const token of tokens) {
		if (token.start < offset) {
			// The space before this name went with the name before it.
			continue;
		}
		const key = nameKey(token.kind, token.ordinal);
		if (!mapping.has(key)) {
			continue;
		}
		const next = mapping.get(key);
		const text = prompt.slice(token.start, token.end);
		if (next === undefined) {
			changed = true;
			let start = token.start;
			let end = token.end;
			if (prompt.charAt(end) === ' ') {
				end++;
			} else if (start > offset && prompt.charAt(start - 1) === ' ') {
				start--;
			}
			output += prompt.slice(offset, start);
			offset = end;
			continue;
		}
		if (next === token.ordinal) {
			continue;
		}
		changed = true;
		output += prompt.slice(offset, token.start) + renumbered(text, next);
		offset = token.end;
	}
	if (!changed) {
		return undefined;
	}
	return output + prompt.slice(offset);
}

/**
 * For every name of `before`, the number its input has in `after`, or
 * `undefined` when the input is not in `after` any more. Keys are
 * `<kind>:<number>`.
 */
export function baseHalfInputNameMapping(
	before: readonly IBaseHalfInputListEntry[],
	after: readonly IBaseHalfInputListEntry[],
	replacements: readonly IBaseHalfInputReplacement[] = []
): ReadonlyMap<string, number | undefined> {
	const beforeOrdinals = baseHalfInputNameOrdinals(before);
	const afterOrdinals = baseHalfInputNameOrdinals(after);
	const replaced = new Map(replacements.map(replacement => [replacement.from, replacement.to]));
	const taken = new Set<number>();
	const find = (key: string): number | undefined => {
		for (let index = 0; index < after.length; index++) {
			if (!taken.has(index) && after[index].key === key) {
				return index;
			}
		}
		return undefined;
	};
	const mapping = new Map<string, number | undefined>();
	// An entry that stays in the list finds itself before a replacement takes
	// its key, so that a replace never takes the place of an input that stays.
	const found = before.map(entry => {
		const index = replaced.has(entry.key) ? undefined : find(entry.key);
		if (index !== undefined) {
			taken.add(index);
		}
		return index;
	});
	before.forEach((entry, position) => {
		if (found[position] !== undefined || !replaced.has(entry.key)) {
			return;
		}
		const index = find(replaced.get(entry.key)!);
		if (index !== undefined) {
			taken.add(index);
			found[position] = index;
		}
	});
	before.forEach((entry, position) => {
		const ordinal = beforeOrdinals[position];
		if (ordinal === undefined || !isBaseHalfNamedInputKind(entry.kind)) {
			return;
		}
		const index = found[position];
		mapping.set(nameKey(entry.kind, ordinal), index !== undefined && after[index].kind === entry.kind ? afterOrdinals[index] : undefined);
	});
	return mapping;
}

function nameIndex(entries: readonly { readonly kind: BaseHalfVideoInputKind }[]): ReadonlyMap<string, number> {
	const ordinals = baseHalfInputNameOrdinals(entries);
	const byName = new Map<string, number>();
	entries.forEach((entry, index) => {
		const ordinal = ordinals[index];
		if (ordinal !== undefined && isBaseHalfNamedInputKind(entry.kind)) {
			byName.set(nameKey(entry.kind, ordinal), index);
		}
	});
	return byName;
}

function nameKey(kind: BaseHalfNamedInputKind, ordinal: number): string {
	return `${kind}:${ordinal}`;
}

/** The name with another number, in the form it was written in. */
function renumbered(text: string, ordinal: number): string {
	return text.replace(/\d+$/, String(ordinal));
}
