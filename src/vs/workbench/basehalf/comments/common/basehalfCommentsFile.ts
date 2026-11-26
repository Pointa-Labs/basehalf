/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { hasKey } from '../../../../base/common/types.js';
import { YamlMapNode, YamlNode } from '../../../../base/common/yaml.js';
import { baseHalfMirrorYamlAbsent, baseHalfMirrorYamlItems, baseHalfMirrorYamlMap, baseHalfMirrorYamlNumber, baseHalfMirrorYamlQuote, baseHalfMirrorYamlString, baseHalfParseMirrorYaml, BaseHalfMirrorYamlUnreadable } from '../../workspace/common/basehalfMirrorYaml.js';
import { BASEHALF_COMMENT_CONTEXT_LENGTH, BASEHALF_COMMENT_DEFAULT_COLOR, baseHalfCommentCut, baseHalfCommentPlace, IBaseHalfComment, IBaseHalfCommentReply, isBaseHalfCommentColor, isBaseHalfCommentId, isBaseHalfCommentShown } from './basehalfComments.js';

/** The file of a commentable file's comments, in its mirror folder (comments, "The file"). */
export const BASEHALF_COMMENTS_FILE_NAME = 'comments.yaml';

const HEADER = '# Comments on this file, by BaseHalf and agents. See the basehalf skill.';

const COMMENT_FIELDS = new Set(['id', 'page', 'chapter', 'place', 'quote', 'before', 'after', 'color', 'text', 'by', 'at', 'replies']);
const REPLY_FIELDS = new Set(['text', 'by', 'at']);

/** A value BaseHalf does not know, as it was read, to be written back. */
type KeptValue = string | number | boolean | null | readonly KeptValue[] | { readonly [key: string]: KeptValue };

type KeptFields = readonly (readonly [string, KeptValue])[];

/** A reply as its file holds it. */
export type BaseHalfStoredReply =
	| { readonly reply: IBaseHalfCommentReply; readonly extra: KeptFields }
	/** An item of `replies` that is no reply: written back as it was, and not shown. */
	| { readonly kept: KeptValue };

/** A comment as its file holds it, with what BaseHalf does not know of it. */
export interface IBaseHalfStoredComment {
	readonly comment: IBaseHalfComment;
	/** Whether the file holds the id; an id given on reading is written with the next write. */
	readonly idStored: boolean;
	readonly extra: KeptFields;
	readonly replies: readonly BaseHalfStoredReply[];
}

/** An entry of the list: a comment, or an item that is no comment, which is written back as it was. */
export type BaseHalfCommentsEntry = IBaseHalfStoredComment | { readonly kept: KeptValue };

export interface IBaseHalfCommentsFile {
	readonly entries: readonly BaseHalfCommentsEntry[];
	/** Why the file could not be read at all; it then shows no comments. */
	readonly unreadable?: string;
	/** Fields of the file beside `comments`. */
	readonly extra: KeptFields;
}

export const EMPTY_BASEHALF_COMMENTS_FILE: IBaseHalfCommentsFile = Object.freeze({ entries: Object.freeze([]), extra: Object.freeze([]) });

export function isBaseHalfStoredComment(entry: BaseHalfCommentsEntry): entry is IBaseHalfStoredComment {
	return hasKey(entry, { comment: true });
}

/** The comments that can be shown, in the order of the file. */
export function baseHalfShownComments(file: IBaseHalfCommentsFile): IBaseHalfComment[] {
	return file.entries.filter(isBaseHalfStoredComment).map(entry => entry.comment).filter(isBaseHalfCommentShown);
}

/**
 * Reads `comments.yaml` field by field (comments, "Reading"): a field of the
 * wrong shape reads as absent, an item that is no comment is kept, and only a
 * file that is not YAML at all, such as one with the markers of a git
 * conflict, is unreadable.
 */
export function parseBaseHalfComments(raw: string): IBaseHalfCommentsFile {
	let root: YamlMapNode | null;
	try {
		const document = baseHalfParseMirrorYaml(raw, BASEHALF_COMMENTS_FILE_NAME);
		if (document.unparsed) {
			return { entries: [], extra: [], unreadable: document.unparsed };
		}
		root = document.root;
	} catch (error) {
		if (error instanceof BaseHalfMirrorYamlUnreadable) {
			return { entries: [], extra: [], unreadable: error.message };
		}
		throw error;
	}
	if (!root) {
		return EMPTY_BASEHALF_COMMENTS_FILE;
	}
	const extra: [string, KeptValue][] = [];
	let items: readonly YamlNode[] = [];
	for (const property of root.properties) {
		if (property.key.value === 'comments') {
			items = baseHalfMirrorYamlItems(property.value) ?? [];
		} else {
			extra.push([property.key.value, keptValue(property.value)]);
		}
	}
	const taken = new Set<string>();
	const entries: BaseHalfCommentsEntry[] = [];
	for (const item of items) {
		const map = baseHalfMirrorYamlMap(item);
		entries.push(map ? readComment(map, taken) : { kept: keptValue(item) });
	}
	return { entries, extra };
}

function readComment(map: YamlMapNode, taken: Set<string>): IBaseHalfStoredComment {
	const field = (key: string): YamlNode | undefined => propertyOf(map, key);
	const text = (key: string): string | undefined => baseHalfMirrorYamlString(field(key));
	const storedId = text('id');
	const page = baseHalfMirrorYamlNumber(field('page'));
	const placeNode = field('place');
	const place = placeNode?.type === 'sequence' ? baseHalfCommentPlace(placeNode.items.map(item => baseHalfMirrorYamlNumber(item))) : undefined;
	const color = text('color');
	const quote = text('quote')?.trim();
	const replies: BaseHalfStoredReply[] = [];
	for (const item of baseHalfMirrorYamlItems(field('replies')) ?? []) {
		const replyMap = baseHalfMirrorYamlMap(item);
		const replyText = replyMap ? baseHalfMirrorYamlString(propertyOf(replyMap, 'text')) : undefined;
		if (!replyMap || replyText === undefined || !replyText.trim()) {
			replies.push({ kept: keptValue(item) });
			continue;
		}
		const by = baseHalfMirrorYamlString(propertyOf(replyMap, 'by'))?.trim();
		const at = baseHalfMirrorYamlString(propertyOf(replyMap, 'at'))?.trim();
		replies.push({
			reply: { text: baseHalfCommentCut(replyText), ...(by ? { by } : {}), ...(at ? { at } : {}) },
			extra: replyMap.properties.filter(property => !REPLY_FIELDS.has(property.key.value)).map(property => [property.key.value, keptValue(property.value)] as const)
		});
	}
	const chapter = text('chapter')?.trim();
	const before = text('before');
	const after = text('after');
	const by = text('by')?.trim();
	const at = text('at')?.trim();
	const words = text('text') ?? '';
	const partial = {
		...(quote ? { quote: baseHalfCommentCut(quote) } : {}),
		...(before ? { before: before.slice(-BASEHALF_COMMENT_CONTEXT_LENGTH) } : {}),
		...(after ? { after: after.slice(0, BASEHALF_COMMENT_CONTEXT_LENGTH) } : {}),
		...(page !== undefined && Number.isInteger(page) && page >= 1 ? { page } : {}),
		...(chapter ? { chapter } : {}),
		...(place ? { place } : {}),
		color: isBaseHalfCommentColor(color) ? color : BASEHALF_COMMENT_DEFAULT_COLOR,
		text: baseHalfCommentCut(words),
		...(by ? { by } : {}),
		...(at ? { at } : {}),
		replies: replies.filter((entry): entry is { reply: IBaseHalfCommentReply; extra: KeptFields } => hasKey(entry, { reply: true })).map(entry => entry.reply)
	};
	// An id the file does not hold, or holds twice, is given from what the
	// comment holds, so that it stays the same from one read to the next.
	const idStored = isBaseHalfCommentId(storedId) && !taken.has(storedId);
	const id = idStored ? storedId! : contentId(partial, taken);
	taken.add(id);
	return {
		comment: { id, ...partial },
		idStored,
		extra: map.properties.filter(property => !COMMENT_FIELDS.has(property.key.value)).map(property => [property.key.value, keptValue(property.value)] as const),
		replies
	};
}

function propertyOf(map: YamlMapNode, key: string): YamlNode | undefined {
	let value: YamlNode | undefined;
	for (const property of map.properties) {
		if (property.key.value === key) {
			value = property.value;
		}
	}
	return value;
}

/** An id of eight lowercase letters and digits made from what a comment holds. */
function contentId(comment: Omit<IBaseHalfComment, 'id'>, taken: ReadonlySet<string>): string {
	const seed = JSON.stringify([comment.quote, comment.page, comment.chapter, comment.place, comment.text, comment.by, comment.at]);
	for (let attempt = 0; ; attempt++) {
		let first = 0x811c9dc5;
		let second = 0x01000193 ^ attempt;
		for (let index = 0; index < seed.length; index++) {
			const code = seed.charCodeAt(index);
			first = Math.imul(first ^ code, 0x01000193) >>> 0;
			second = Math.imul(second ^ code, 0x5bd1e995) >>> 0;
		}
		const id = (first.toString(36) + second.toString(36)).replace(/[^a-z0-9]/g, '').padEnd(8, '0').slice(0, 8);
		if (!taken.has(id)) {
			return id;
		}
	}
}

function keptValue(node: YamlNode): KeptValue {
	switch (node.type) {
		case 'scalar':
			if (node.format === 'none') {
				if (baseHalfMirrorYamlAbsent(node)) {
					return null;
				}
				if (node.value === 'true' || node.value === 'false') {
					return node.value === 'true';
				}
				const number = baseHalfMirrorYamlNumber(node);
				if (number !== undefined) {
					return number;
				}
			}
			return node.value;
		case 'sequence':
			return node.items.map(keptValue);
		case 'map': {
			const value: { [key: string]: KeptValue } = {};
			for (const property of node.properties) {
				value[property.key.value] = keptValue(property.value);
			}
			return value;
		}
	}
}

/** A change of one comment, by its id (comments, "Writing"). */
export type BaseHalfCommentChange =
	/** Adds a comment, or replaces the one with its id; a comment that was taken away comes back at `index`. */
	| { readonly kind: 'put'; readonly comment: IBaseHalfComment; readonly index?: number }
	| { readonly kind: 'remove'; readonly id: string };

/** The file with one comment changed, and the rest as it was. */
export function applyBaseHalfCommentChange(file: IBaseHalfCommentsFile, change: BaseHalfCommentChange): IBaseHalfCommentsFile {
	const entries = [...file.entries];
	const at = entries.findIndex(entry => isBaseHalfStoredComment(entry) && entry.comment.id === (change.kind === 'put' ? change.comment.id : change.id));
	if (change.kind === 'remove') {
		if (at !== -1) {
			entries.splice(at, 1);
		}
		return { entries, extra: file.extra };
	}
	const previous = at === -1 ? undefined : entries[at] as IBaseHalfStoredComment;
	const replies: BaseHalfStoredReply[] = change.comment.replies.map((reply, index) => {
		const before = previous?.replies.filter((entry): entry is { reply: IBaseHalfCommentReply; extra: KeptFields } => hasKey(entry, { reply: true }))[index];
		return { reply, extra: before && before.reply.text === reply.text ? before.extra : [] };
	});
	const stored: IBaseHalfStoredComment = {
		comment: change.comment,
		idStored: true,
		extra: previous?.extra ?? [],
		// Items of `replies` that are no replies stay at the end.
		replies: [...replies, ...(previous?.replies.filter(entry => hasKey(entry, { kept: true })) ?? [])]
	};
	if (at === -1) {
		const index = change.index === undefined ? entries.length : Math.min(Math.max(0, change.index), entries.length);
		entries.splice(index, 0, stored);
	} else {
		entries[at] = stored;
	}
	return { entries, extra: file.extra };
}

/** The place of a comment in its file's list, for an undo that brings it back where it was. */
export function baseHalfCommentIndex(file: IBaseHalfCommentsFile, id: string): number {
	return file.entries.findIndex(entry => isBaseHalfStoredComment(entry) && entry.comment.id === id);
}

/** The comment with `id`, as the file holds it. */
export function baseHalfStoredComment(file: IBaseHalfCommentsFile, id: string): IBaseHalfComment | undefined {
	const entry = file.entries.find(entry => isBaseHalfStoredComment(entry) && entry.comment.id === id);
	return entry && isBaseHalfStoredComment(entry) ? entry.comment : undefined;
}

/** The text of `comments.yaml`: every comment with its id, strings double-quoted, the fields in one order, and what BaseHalf does not know as it was. */
export function serializeBaseHalfComments(file: IBaseHalfCommentsFile): string {
	const lines = [HEADER];
	if (file.entries.length === 0) {
		lines.push('comments: []');
	} else {
		lines.push('comments:');
		for (const entry of file.entries) {
			if (!isBaseHalfStoredComment(entry)) {
				lines.push(`  - ${flow(entry.kept)}`);
				continue;
			}
			const comment = entry.comment;
			const fields: string[] = [`id: ${baseHalfMirrorYamlQuote(comment.id)}`];
			if (comment.page !== undefined) {
				fields.push(`page: ${comment.page}`);
			}
			if (comment.chapter !== undefined) {
				fields.push(`chapter: ${baseHalfMirrorYamlQuote(comment.chapter)}`);
			}
			if (comment.place) {
				fields.push(`place: [${comment.place[0]}, ${comment.place[1]}]`);
			}
			if (comment.quote !== undefined) {
				fields.push(`quote: ${baseHalfMirrorYamlQuote(comment.quote)}`);
			}
			if (comment.before) {
				fields.push(`before: ${baseHalfMirrorYamlQuote(comment.before)}`);
			}
			if (comment.after) {
				fields.push(`after: ${baseHalfMirrorYamlQuote(comment.after)}`);
			}
			if (comment.color !== BASEHALF_COMMENT_DEFAULT_COLOR) {
				fields.push(`color: ${baseHalfMirrorYamlQuote(comment.color)}`);
			}
			if (comment.text) {
				fields.push(`text: ${baseHalfMirrorYamlQuote(comment.text)}`);
			}
			if (comment.by) {
				fields.push(`by: ${baseHalfMirrorYamlQuote(comment.by)}`);
			}
			if (comment.at) {
				fields.push(`at: ${baseHalfMirrorYamlQuote(comment.at)}`);
			}
			if (entry.replies.length > 0) {
				fields.push('replies:');
				for (const reply of entry.replies) {
					if (hasKey(reply, { kept: true })) {
						fields.push(`  - ${flow(reply.kept)}`);
						continue;
					}
					const replyFields = [`text: ${baseHalfMirrorYamlQuote(reply.reply.text)}`];
					if (reply.reply.by) {
						replyFields.push(`by: ${baseHalfMirrorYamlQuote(reply.reply.by)}`);
					}
					if (reply.reply.at) {
						replyFields.push(`at: ${baseHalfMirrorYamlQuote(reply.reply.at)}`);
					}
					for (const [key, value] of reply.extra) {
						replyFields.push(`${key}: ${flow(value)}`);
					}
					replyFields.forEach((field, index) => fields.push(`${index === 0 ? '  - ' : '    '}${field}`));
				}
			}
			for (const [key, value] of entry.extra) {
				fields.push(`${key}: ${flow(value)}`);
			}
			fields.forEach((field, index) => lines.push(`${index === 0 ? '  - ' : '    '}${field}`));
		}
	}
	for (const [key, value] of file.extra) {
		lines.push(`${key}: ${flow(value)}`);
	}
	return `${lines.join('\n')}\n`;
}

/** A kept value in YAML's flow style, which JSON is. */
function flow(value: KeptValue): string {
	return value === null ? 'null' : typeof value === 'string' ? baseHalfMirrorYamlQuote(value) : JSON.stringify(value);
}
