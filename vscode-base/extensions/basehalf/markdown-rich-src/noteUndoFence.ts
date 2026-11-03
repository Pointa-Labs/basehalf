/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { AddMarkStep, AddNodeMarkStep, AttrStep, RemoveMarkStep, RemoveNodeMarkStep, ReplaceAroundStep, ReplaceStep, type Step } from '@tiptap/pm/transform';
import { isBaseHalfNoteSharedChange } from './noteNormalizer.js';

// Steps of undo by the kind of a change (note formats, rule 78). Letters
// typed one after another are one step, as the shared document's undo
// gathers them; a format, a resize, a change of a block's kind, a nest, a
// move, a paste, a drop, and a cut are a step each, with what Rich adjusts
// after them. The letters typed into one caption, one change of the same
// attribute of the same block after another, are one step.

/** What a change is, for undo: text, a change that is a step of its own, or a change of one attribute of one block. */
type ChangeKind = 'text' | 'own' | `attribute ${number} ${string}`;

export interface IBaseHalfNoteUndoFence {
	/** Looks at a change before the shared document takes it, and starts a step of undo for it when its kind says so. */
	before(transaction: Transaction): void;
	/** Makes what `change` changes, such as a move of blocks by keys, a step of its own. */
	ownStep(change: () => void): void;
}

/** A fence over the undo manager that `manager` gives, which may change while the note is open. */
export function createBaseHalfNoteUndoFence(manager: () => { stopCapturing(): void } | undefined): IBaseHalfNoteUndoFence {
	let last: ChangeKind | undefined;
	let forced = false;
	return {
		before: transaction => {
			if (transaction.getMeta('appendedTransaction') !== undefined) {
				// What a plugin adds to a change is part of that change's step.
				return;
			}
			if (isBaseHalfNoteSharedChange(transaction)) {
				last = undefined;
				return;
			}
			if (!transaction.docChanged) {
				return;
			}
			const kind = forced ? 'own' : changeKind(transaction);
			forced = false;
			if (kind === 'own' || kind !== last) {
				manager()?.stopCapturing();
			}
			last = kind;
		},
		ownStep: change => {
			forced = true;
			try {
				change();
			} finally {
				forced = false;
			}
		},
	};
}

function changeKind(transaction: Transaction): ChangeKind {
	const event = transaction.getMeta('uiEvent');
	if (event === 'paste' || event === 'drop' || event === 'cut') {
		return 'own';
	}
	const attributes: string[] = [];
	for (let index = 0; index < transaction.steps.length; index++) {
		const change = markupChange(transaction.steps[index], transaction.docs[index]);
		if (change === 'text') {
			return 'text';
		}
		if (change === 'own') {
			return 'own';
		}
		attributes.push(...change);
	}
	return attributes.length === 1 ? attributes[0] as ChangeKind : 'own';
}

/**
 * What one step changes: text, its own step (marks, a block's kind, the
 * nesting of blocks), or attributes of blocks, named `attribute <position>
 * <name>`.
 */
function markupChange(step: Step, doc: ProseMirrorNode): 'text' | 'own' | string[] {
	if (step instanceof AddMarkStep || step instanceof RemoveMarkStep || step instanceof AddNodeMarkStep || step instanceof RemoveNodeMarkStep) {
		return 'own';
	}
	if (step instanceof AttrStep) {
		return [`attribute ${step.pos} ${step.attr}`];
	}
	if (step instanceof ReplaceAroundStep) {
		// A block's markup set anew around its content, or blocks nested, lifted, or wrapped.
		const node = step.slice.content.childCount === 1 && step.slice.openStart === 0 && step.slice.openEnd === 0 && step.gapFrom === step.from + 1 && step.gapTo === step.to - 1 && step.insert === 1
			? step.slice.content.firstChild
			: null;
		const old = node ? doc.nodeAt(step.from) : null;
		return node && old ? changedAttributes(step.from, old, node) : 'own';
	}
	if (step instanceof ReplaceStep) {
		// A leaf block set anew, such as a picture with another width or caption.
		const node = step.to - step.from === 1 && step.slice.openStart === 0 && step.slice.openEnd === 0 && step.slice.content.childCount === 1 ? step.slice.content.firstChild : null;
		const old = node ? doc.nodeAt(step.from) : null;
		return node && old && node.isLeaf && old.isLeaf && !node.isText && !old.isText ? changedAttributes(step.from, old, node) : 'text';
	}
	return 'text';
}

function changedAttributes(position: number, old: ProseMirrorNode, node: ProseMirrorNode): 'own' | string[] {
	if (old.type !== node.type) {
		return 'own';
	}
	const names = new Set([...Object.keys(old.attrs), ...Object.keys(node.attrs)]);
	return [...names].filter(name => JSON.stringify(old.attrs[name]) !== JSON.stringify(node.attrs[name])).map(name => `attribute ${position} ${name}`);
}
