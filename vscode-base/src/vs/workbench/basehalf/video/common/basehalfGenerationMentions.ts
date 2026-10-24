/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isHighSurrogate } from '../../../../base/common/strings.js';
import { baseHalfItemDisplayName } from '../../cardDetail/common/basehalfCardDetail.js';
import { baseHalfSpokenNoteText, isBaseHalfMarkdownNotePath } from './basehalfGenerationSpokenText.js';
import { BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH, BaseHalfVideoPromptPart, IBaseHalfVideoInputPlanItem, IBaseHalfVideoPromptInput } from './basehalfVideoCatalog.js';

/**
 * The mentions in a prompt (generation cards, "Mentions", D74). A mention is
 * its input's file: `@[<entry>]`, the entry of the card's list that names the
 * input, with a `]` of it written `\]`. It is what `generation.yaml` stores,
 * what agents write, and what the panel shows as a chip. This module finds
 * the mentions, names them as chips and notes show them, writes them again
 * after a change of the card's list, and gives the prompt in the parts that
 * the provider service receives, where each provider module names the inputs as its model
 * reads them. Pure.
 */

/** A mention in a prompt. */
export interface IBaseHalfPromptMention {
	readonly start: number;
	readonly end: number;
	/** The entry it names, in Unicode NFC. */
	readonly path: string;
}

/** `@[`, the entry with `\]` for a `]` of it, and `]`. An entry holds no backslash and no line break. */
const MENTION = /@\[((?:\\\]|[^\]\n])+)\]/g;

/** The mentions of a prompt, in order. */
export function findBaseHalfPromptMentions(prompt: string): readonly IBaseHalfPromptMention[] {
	const mentions: IBaseHalfPromptMention[] = [];
	for (const match of prompt.matchAll(MENTION)) {
		mentions.push(Object.freeze({ start: match.index, end: match.index + match[0].length, path: match[1].replaceAll('\\]', ']').normalize('NFC') }));
	}
	return Object.freeze(mentions);
}

/** The mention of the input whose entry is `path`. */
export function baseHalfPromptMention(path: string): string {
	return `@[${path.replaceAll(']', '\\]')}]`;
}

/** The index of the entry of `paths` that a mention names: the same path in NFC. */
export function baseHalfMentionedIndex(mention: IBaseHalfPromptMention, paths: readonly string[]): number | undefined {
	const index = paths.findIndex(path => path.normalize('NFC') === mention.path);
	return index < 0 ? undefined : index;
}

/**
 * The name of each of `paths` as a chip or a note shows it: its name as
 * BaseHalf shows it, a note without `.md`, with as many of its folders before
 * it as tell it from another of `paths` with the same name (`a/hero.png`).
 */
export function baseHalfMentionLabels(paths: readonly string[]): ReadonlyMap<string, string> {
	const unique = [...new Set(paths)];
	const segments = new Map(unique.map(path => [path, path.split('/')]));
	const label = (parts: readonly string[], depth: number) => [...parts.slice(Math.max(0, parts.length - depth), -1), baseHalfItemDisplayName(parts[parts.length - 1], false)].join('/');
	const labels = new Map<string, string>();
	for (const path of unique) {
		const own = segments.get(path)!;
		let depth = 1;
		while (depth < own.length && unique.some(other => other !== path && label(segments.get(other)!, depth) === label(own, depth))) {
			depth++;
		}
		labels.set(path, label(own, depth));
	}
	return labels;
}

/**
 * The prompt as text to read where no chips are drawn, such as Card Detail:
 * each mention as its file's name, as its chip shows it among `entries`.
 */
export function baseHalfPromptAsText(prompt: string, entries: readonly string[]): string {
	const mentions = findBaseHalfPromptMentions(prompt);
	const labels = baseHalfMentionLabels([...entries, ...mentions.map(mention => mention.path)]);
	let output = '';
	let offset = 0;
	for (const mention of mentions) {
		const index = baseHalfMentionedIndex(mention, entries);
		output += prompt.slice(offset, mention.start) + (labels.get(index !== undefined ? entries[index] : mention.path) ?? mention.path);
		offset = mention.end;
	}
	return output + prompt.slice(offset);
}

//#region Following the list

/** One entry of a card's list as the mentions see it. */
export interface IBaseHalfMentionEntry {
	/** The entry as the list writes it. */
	readonly path: string;
	/** Says which input the entry is, before and after a change: the path's comparison key, which ignores case where the volume does. */
	readonly key: string;
}

/** An entry that a replace put in place of another, by their keys: a rename, a move, a relink, or a source moved to another card. */
export interface IBaseHalfMentionReplacement {
	readonly from: string;
	readonly to: string;
}

/**
 * The prompt with its mentions written again for a change of the card's list
 * from `before` to `after`, or `undefined` when no mention changes:
 *
 * - a mention of an entry that a replace rewrote takes the new path, and one
 *   of an entry that stays takes its spelling in `after`;
 * - a mention of an entry that is no longer in the list is taken out, with
 *   the one space after it, or the one before it when none follows;
 * - a mention whose path `before` did not name stays as it is.
 *
 * Adding and reordering change no mention.
 */
export function rewriteBaseHalfPromptMentions(
	prompt: string,
	before: readonly IBaseHalfMentionEntry[],
	after: readonly IBaseHalfMentionEntry[],
	replacements: readonly IBaseHalfMentionReplacement[] = []
): string | undefined {
	const mentions = findBaseHalfPromptMentions(prompt);
	if (mentions.length === 0) {
		return undefined;
	}
	const keyOf = new Map(before.map(entry => [entry.path.normalize('NFC'), entry.key]));
	const pathOf = new Map(after.map(entry => [entry.key, entry.path]));
	const replaced = new Map(replacements.map(replacement => [replacement.from, replacement.to]));
	let changed = false;
	let output = '';
	let offset = 0;
	for (const mention of mentions) {
		const key = keyOf.get(mention.path);
		if (key === undefined || mention.start < offset) {
			continue;
		}
		const to = replaced.get(key);
		const path = (to !== undefined ? pathOf.get(to) : undefined) ?? pathOf.get(key);
		if (path === undefined) {
			changed = true;
			let start = mention.start;
			let end = mention.end;
			if (prompt.charAt(end) === ' ') {
				end++;
			} else if (start > offset && prompt.charAt(start - 1) === ' ') {
				start--;
			}
			output += prompt.slice(offset, start);
			offset = end;
			continue;
		}
		const text = baseHalfPromptMention(path);
		if (text === prompt.slice(mention.start, mention.end)) {
			continue;
		}
		changed = true;
		output += prompt.slice(offset, mention.start) + text;
		offset = mention.end;
	}
	return changed ? output + prompt.slice(offset) : undefined;
}

/**
 * The prompt of New Version (generation cards, "Mentions"): each mention of
 * the n-th recorded input written for the card's n-th entry as it is now, so
 * that a mention of an input renamed since names it where it is. A record
 * whose inputs are not as many as the entries keeps its mentions.
 */
export function baseHalfPromptForEntries(prompt: string, recorded: readonly string[], entries: readonly string[]): string {
	if (recorded.length !== entries.length) {
		return prompt;
	}
	let output = '';
	let offset = 0;
	for (const mention of findBaseHalfPromptMentions(prompt)) {
		const index = baseHalfMentionedIndex(mention, recorded);
		if (index === undefined) {
			continue;
		}
		output += prompt.slice(offset, mention.start) + baseHalfPromptMention(entries[index]);
		offset = mention.end;
	}
	return output + prompt.slice(offset);
}

/**
 * The prompt of a template's draft with each mention of a path of the
 * template written for the workspace, by `rebase`, as its references are; a
 * mention `rebase` does not know stays as it is.
 */
export function rebaseBaseHalfPromptMentions(prompt: string, rebase: (path: string) => string | undefined): string {
	let output = '';
	let offset = 0;
	for (const mention of findBaseHalfPromptMentions(prompt)) {
		const path = rebase(mention.path);
		if (path === undefined) {
			continue;
		}
		output += prompt.slice(offset, mention.start) + baseHalfPromptMention(path);
		offset = mention.end;
	}
	return output + prompt.slice(offset);
}

//#endregion

//#region The prompt as sent

export interface IBaseHalfPromptParts {
	readonly parts: readonly BaseHalfVideoPromptPart[];
	/** The path of the first mention of a file that is not connected; Generate does not run while there is one. */
	readonly unconnected?: string;
	/** Nothing is sent as the prompt: no text and no mention. */
	readonly empty: boolean;
}

/** How the prompt is written for the provider service. */
export interface IBaseHalfPromptPartsOptions {
	/**
	 * The prompt is spoken or sung (generation cards, "Terms";
	 * `isBaseHalfSpokenOrSungPrompt`): a note joins it as its text alone,
	 * since the voice would say a name and the song would sing it.
	 */
	readonly spokenOrSung?: boolean;
}

/**
 * The prompt as the provider service receives it (generation cards, "Inputs" and
 * "Mentions"): the card's prompt without the spaces around it, with each
 * mention of an image, a video, or a sound that the request sends as that
 * input's place in it, and each mention of a note as the note's name in
 * double quotes; then the text of each note, in the order of the list, under
 * its name and a colon on a line of its own, separated by a blank line.
 * Neither square brackets nor `@` mark a note, since some models read those
 * as names of inputs or as commands of the camera. `plan` is the plan of the card's inputs in list order, and
 * `textOf` the text of a note that was read. A mention of an input that the
 * request does not send, such as one that is missing or that the mode does
 * not use, is written as its file's name; Generate does not run while there
 * is one, for the reason that input gives.
 *
 * In a prompt that is spoken or sung (`options.spokenOrSung`), a mention of a
 * note stands for the note's text, in its place, as often as it is
 * mentioned, and the text of each connected note that the prompt does not
 * mention follows the prompt, in order, after a blank line, without names.
 * A Markdown note's text is then its plain text, as a reader of its card says
 * it (`baseHalfSpokenNoteText`); the card's own prompt is sent as typed.
 *
 * A note adds at most 16 KiB, cut between characters.
 */
export function buildBaseHalfPromptParts(
	prompt: string,
	plan: readonly IBaseHalfVideoInputPlanItem[],
	textOf: (item: IBaseHalfVideoInputPlanItem, index: number) => string | undefined,
	options: IBaseHalfPromptPartsOptions = {}
): IBaseHalfPromptParts {
	const slots = new Map<number, IBaseHalfVideoPromptInput>();
	const counts = { image: 0, video: 0, audio: 0 };
	plan.forEach((item, index) => {
		switch (item.use) {
			case 'start-frame':
				slots.set(index, Object.freeze({ input: 'startFrame' }));
				break;
			case 'end-frame':
				slots.set(index, Object.freeze({ input: 'endFrame' }));
				break;
			case 'source':
				slots.set(index, Object.freeze({ input: 'source' }));
				break;
			case 'reference':
				if (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio') {
					const input = item.kind === 'image' ? 'images' : item.kind === 'video' ? 'videos' : 'audios';
					slots.set(index, Object.freeze({ input, index: counts[item.kind]++ }));
				}
				break;
		}
	});
	const noteNames = baseHalfMentionLabels(plan.filter(item => item.kind === 'text').map(item => item.path));
	const fileNames = baseHalfMentionLabels([...plan.map(item => item.path), ...findBaseHalfPromptMentions(prompt).map(mention => mention.path)]);
	const paths = plan.map(item => item.path);
	const parts: BaseHalfVideoPromptPart[] = [];
	const text = (value: string) => {
		if (!value) {
			return;
		}
		const last = parts.length - 1;
		if (last >= 0 && typeof parts[last] === 'string') {
			parts[last] = `${parts[last]}${value}`;
		} else {
			parts.push(value);
		}
	};
	let unconnected: string | undefined;
	const spokenOrSung = options.spokenOrSung === true;
	// The text a note adds: its head of at most 16 KiB, cut between characters, without the spaces around it;
	// in a prompt that is spoken or sung, a Markdown note's text as a reader of its card says it.
	const noteTexts = new Map<number, string>();
	const noteText = (index: number) => {
		let text = noteTexts.get(index);
		if (text === undefined) {
			const head = textHead(textOf(plan[index], index) ?? '', BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH);
			text = (spokenOrSung && isBaseHalfMarkdownNotePath(plan[index].path) ? textHead(baseHalfSpokenNoteText(head), BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH) : head).trim();
			noteTexts.set(index, text);
		}
		return text;
	};
	/** The notes that a spoken or sung prompt says in place: they do not follow it again. */
	const said = new Set<number>();
	const start = prompt.length - prompt.trimStart().length;
	const end = prompt.trimEnd().length;
	let offset = start;
	for (const mention of findBaseHalfPromptMentions(prompt)) {
		if (mention.start < start || mention.end > end) {
			continue;
		}
		text(prompt.slice(offset, mention.start));
		offset = mention.end;
		const index = baseHalfMentionedIndex(mention, paths);
		const slot = index !== undefined ? slots.get(index) : undefined;
		if (slot) {
			parts.push(slot);
		} else if (index !== undefined && plan[index].use === 'text') {
			if (spokenOrSung) {
				said.add(index);
				text(noteText(index));
			} else {
				text(`"${noteNames.get(plan[index].path)}"`);
			}
		} else {
			if (index === undefined) {
				unconnected ??= mention.path;
			}
			text(fileNames.get(mention.path) ?? mention.path);
		}
	}
	text(prompt.slice(offset, Math.max(offset, end)));
	const notes = plan.flatMap((item, index) => {
		if (item.use !== 'text' || said.has(index)) {
			return [];
		}
		const note = noteText(index);
		return !note ? [] : spokenOrSung ? [note] : [`${noteNames.get(item.path)}:\n${note}`];
	});
	if (notes.length) {
		text(`${parts.length ? '\n\n' : ''}${notes.join('\n\n')}`);
	}
	return Object.freeze({
		parts: Object.freeze(parts),
		...(unconnected !== undefined ? { unconnected } : {}),
		empty: parts.length === 0
	});
}

/** The head of a text of at most `max` UTF-16 units, cut between characters: never between the two units of one. */
function textHead(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	return text.slice(0, isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max);
}

//#endregion
