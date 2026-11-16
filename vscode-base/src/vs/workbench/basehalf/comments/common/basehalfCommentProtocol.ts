/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What the pages that show comments (the readers and the Rich editor) and the
// window say to each other about them (comments). The pages import this
// module, so it imports only its siblings.

import { baseHalfCommentFromMessage, BaseHalfCommentColor, IBaseHalfComment, isBaseHalfCommentColor, isBaseHalfCommentId } from './basehalfComments.js';

/** What a change of the user is, which names its step of undo (exact undo, "Comments"). */
export type BaseHalfCommentStep = 'highlight' | 'comment' | 'edit' | 'color' | 'reply' | 'delete';

const STEPS = new Set<BaseHalfCommentStep>(['highlight', 'comment', 'edit', 'color', 'reply', 'delete']);

/** The window tells a page the comments of its file, after it opened and after every change. */
export interface IBaseHalfCommentsSetMessage {
	readonly type: 'basehalf.comments.set';
	readonly comments: readonly IBaseHalfComment[];
	/** The file could not be read: the Comments list says so. */
	readonly unreadable: boolean;
	/** The color of the next highlight: the one used last on this computer. */
	readonly color: BaseHalfCommentColor;
}

/** A page asks the window to keep a change of one comment. */
export interface IBaseHalfCommentsChangeMessage {
	readonly type: 'basehalf.comments.change';
	readonly step: BaseHalfCommentStep;
	/** The comment as it is to be; none when `remove` is set. */
	readonly comment?: IBaseHalfComment;
	readonly remove?: string;
}

/** A page says which comment's note is open, or that none is: what the record of the selection names. */
export interface IBaseHalfCommentsFocusMessage {
	readonly type: 'basehalf.comments.focus';
	readonly id?: string;
}

/** Grow branch of a comment. */
export interface IBaseHalfCommentsGrowMessage {
	readonly type: 'basehalf.comments.grow';
	readonly id: string;
}

export type BaseHalfCommentsPageMessage = IBaseHalfCommentsChangeMessage | IBaseHalfCommentsFocusMessage | IBaseHalfCommentsGrowMessage;

/** A page's message about comments, or undefined: a page is untrusted, so each field is checked. */
export function baseHalfCommentsPageMessage(value: unknown): BaseHalfCommentsPageMessage | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const message = value as Record<string, unknown>;
	switch (message.type) {
		case 'basehalf.comments.change': {
			const step = message.step as BaseHalfCommentStep;
			if (!STEPS.has(step)) {
				return undefined;
			}
			if (isBaseHalfCommentId(message.remove)) {
				return { type: 'basehalf.comments.change', step, remove: message.remove };
			}
			const comment = baseHalfCommentFromMessage(message.comment);
			return comment ? { type: 'basehalf.comments.change', step, comment } : undefined;
		}
		case 'basehalf.comments.focus':
			return { type: 'basehalf.comments.focus', ...(isBaseHalfCommentId(message.id) ? { id: message.id } : {}) };
		case 'basehalf.comments.grow':
			return isBaseHalfCommentId(message.id) ? { type: 'basehalf.comments.grow', id: message.id } : undefined;
	}
	return undefined;
}

/** The window's message with the comments of a file, as a page reads it. */
export function baseHalfCommentsSetMessage(value: unknown): IBaseHalfCommentsSetMessage | undefined {
	if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'basehalf.comments.set') {
		return undefined;
	}
	const message = value as Record<string, unknown>;
	const comments = Array.isArray(message.comments) ? message.comments.map(baseHalfCommentFromMessage).filter((comment): comment is IBaseHalfComment => !!comment) : [];
	return {
		type: 'basehalf.comments.set',
		comments,
		unreadable: message.unreadable === true,
		color: isBaseHalfCommentColor(message.color) ? message.color : 'yellow'
	};
}
