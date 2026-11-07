/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfCanvasCard, IBaseHalfCanvasEdge } from '../../canvas/common/basehalfCanvasModel.js';
import { IBaseHalfWorkspaceMutationLease } from '../../workspace/common/basehalfWorkspaceMutation.js';

/** What undoing a draft operation needs: every piece of the draft's card information. */
export interface IBaseHalfDraftSnapshot {
	readonly resource: URI;
	/** The draft's card information files by name (`generation.yaml`, `upstream.yaml`, `badge.yaml`, …), as bytes. */
	readonly files: ReadonlyMap<string, Uint8Array>;
	/** The draft's card row in the layout of its folder, when it had one: its place. */
	readonly row?: IBaseHalfCanvasCard;
	/** The edge anchor rows of that layout that name the draft. */
	readonly edges?: readonly IBaseHalfCanvasEdge[];
}

/** How a draft is moved. */
export interface IBaseHalfDraftMoveOptions {
	/**
	 * The workspace mutation lease of the draft's workspace folder, when the
	 * caller already holds it: following an item that was moved onto the
	 * draft's path moves the draft aside inside its own exclusive run. The move
	 * then takes no lease of its own, and does not wait for the entries that
	 * name the draft to be rewritten, which needs the lease.
	 */
	readonly lease?: IBaseHalfWorkspaceMutationLease;
	/**
	 * An item that was moved arrived at the draft's path, so the path names
	 * that item now: the draft's card information moves aside to `target`
	 * (following moved items, "Relocation"). Without it, a path that names an
	 * item is not a draft and the move is refused.
	 */
	readonly aside?: boolean;
}

export const IBaseHalfDraftOperations = createDecorator<IBaseHalfDraftOperations>('baseHalfDraftOperations');

/**
 * Renames, moves, and deletes drafts. A draft has no file, so these move or
 * remove its card information, its card row, and the task record that names
 * it, and rewrite the entries that name it, as a move of a file does
 * (generation cards, "Moving, renaming, copying, and undo").
 */
export interface IBaseHalfDraftOperations {
	readonly _serviceBrand: undefined;

	/**
	 * Renames or moves a draft to `target`, which must be free (no file, no
	 * folder, no draft, and no card information of a generated file that is
	 * in the trash or missing), in a folder that exists, in the same
	 * workspace folder, and keep the draft's kind. Its card information, card
	 * row, and task records move in one exclusive run under the workspace
	 * mutation lease, and the path the task records name holds the draft's
	 * `generation.yaml` throughout: a move that fails leaves the draft whole
	 * where it was. The entries that name it are rewritten right after, as
	 * after any move. Resolves with `target`.
	 */
	move(draft: URI, target: URI, options?: IBaseHalfDraftMoveOptions): Promise<URI>;

	/**
	 * Removes a draft's card information and card row in one exclusive run.
	 * Resolves with what an undo needs. Refuses, and changes nothing, while a
	 * generation that has not ended still lands on the draft: the caller
	 * releases the card first (generation cards, "Deleting").
	 */
	delete(draft: URI): Promise<IBaseHalfDraftSnapshot>;

	/** Writes back a deleted draft, for undo. Rejects, and writes nothing, when its path is taken. */
	restore(snapshot: IBaseHalfDraftSnapshot): Promise<void>;
}
