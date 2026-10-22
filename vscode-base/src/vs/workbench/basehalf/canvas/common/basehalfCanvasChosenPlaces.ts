/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBaseHalfCanvasMirrorService } from './basehalfCanvasMirror.js';
import { IBaseHalfCanvasCard, IBaseHalfCanvasFile } from './basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfPathHoldsDraft } from '../../video/common/basehalfGenerationDraft.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { IBaseHalfWorkspaceMutationLease } from '../../workspace/common/basehalfWorkspaceMutation.js';

/** What following moved items knows about the items of a workspace folder. */
export interface IBaseHalfCanvasPlacesMovedItems {
	isSettled(workspaceFolder: URI): boolean;
	/** Whether the item that was at `path` may still be found at a new path. False when BaseHalf has given it up. */
	mayStillBeFollowed(workspaceFolder: URI, path: string): boolean;
}

/**
 * The places BaseHalf chose for cards that appeared, from the drawing that
 * chose them until the layout holds them (canvas card placement, "How a place
 * is saved" and "When a place cannot be saved").
 *
 * A place is saved in the drawing that chose it. Until it is saved it is kept
 * here, for as long as the window is open, so that the card does not move:
 * in a marked folder, over a layout that cannot be read in full, and after a
 * write that failed. A change the user makes on that canvas saves the places
 * that wait with it.
 */
export class BaseHalfCanvasChosenPlaces {
	private readonly waiting = new Map<string, Map<string, IBaseHalfCanvasCard>>();
	/** One save at a time for each canvas. */
	private readonly saves = new Map<string, Promise<void>>();
	/** The failure that was logged last for a canvas, so that one that repeats at every drawing is logged once. */
	private readonly logged = new Map<string, string>();

	constructor(
		private readonly fileService: IFileService,
		private readonly canvasMirrorService: Pick<IBaseHalfCanvasMirrorService, 'saveAppearedCards'>,
		private readonly movedItems: IBaseHalfCanvasPlacesMovedItems,
		private readonly logService: ILogService
	) { }

	/**
	 * The places that wait for this canvas, by path. A drawing passes them to
	 * the model so that their cards stay.
	 *
	 * It is a copy, and a drawing takes it before it reads the layout. A save
	 * that lands while the drawing is being prepared removes a card from what
	 * waits; with what waited when the drawing began, that card still has a
	 * place, whether the layout was read before the save or after.
	 */
	waitingFor(folder: IBaseHalfCanvasFolderState): ReadonlyMap<string, IBaseHalfCanvasCard> | undefined {
		const waiting = this.waiting.get(keyOf(folder));
		return waiting?.size ? new Map(waiting) : undefined;
	}

	/**
	 * The rows of `layout` that BaseHalf chose and whose items are no longer in
	 * the folder. They are removed with the next save, and their places are
	 * open for a card that appears.
	 *
	 * - `children` are the paths of everything in the folder, shown or not.
	 * - A row leaves only once following moved items has given its item up. The
	 *   row of a renamed file is moved to the new name, not removed, also when
	 *   the move is held back because the file has unsaved changes.
	 * - One listing is not enough to call a file gone: it can leave out a file
	 *   that a tool is rewriting. Each path is looked at again by itself.
	 * - A draft is an item without a file: its row is never removed as the row
	 *   of an item that is gone, also when `children` leaves it out (canvas
	 *   card placement, "A draft is an item"). A generated file that is gone
	 *   has a record and is no draft: its row goes like any other.
	 * - `pathKey` maps a path to what two spellings of the same path share.
	 */
	async goneRows(folder: IBaseHalfCanvasFolderState, children: readonly string[], layout: IBaseHalfCanvasFile | null, pathKey: (path: string) => string = path => path): Promise<string[]> {
		if (!layout || !this.movedItems.isSettled(folder.workspaceFolder)) {
			return [];
		}
		const there = new Set(children.map(pathKey));
		return this.absent(folder, layout.cards
			.filter(card => card.auto
				&& !there.has(pathKey(card.path))
				&& !this.movedItems.mayStillBeFollowed(folder.workspaceFolder, card.path))
			.map(card => card.path));
	}

	/** A canvas was drawn. `appeared` are the rows of its cards that the layout does not hold. */
	drawn(folder: IBaseHalfCanvasFolderState, appeared: readonly IBaseHalfCanvasCard[]): void {
		if (appeared.length > 0) {
			this.waiting.set(keyOf(folder), new Map(appeared.map(card => [card.path, card])));
		} else {
			this.waiting.delete(keyOf(folder));
		}
	}

	/**
	 * Saves by itself what waits for this canvas, and removes the rows of
	 * {@link goneRows}. The caller has read the layout in full: BaseHalf does
	 * not write over content it could not read by itself.
	 *
	 * - Nothing is written in a marked folder.
	 * - `respelled` are rows whose item is spelled differently now, on a volume
	 *   where both spellings are the same path. Each takes the new spelling.
	 * - A failure is logged and shown to nobody, because nothing the user did is
	 *   waiting. The places keep waiting and the next drawing tries again.
	 */
	save(folder: IBaseHalfCanvasFolderState, gone: readonly string[], respelled: readonly { readonly from: string; readonly to: string }[] = []): Promise<void> {
		const key = keyOf(folder);
		if (!this.waiting.get(key)?.size && gone.length === 0 && respelled.length === 0) {
			return this.saves.get(key) ?? Promise.resolve();
		}
		const save = (this.saves.get(key) ?? Promise.resolve()).then(async () => {
			if (await baseHalfIsWorkspaceFolderMarked(this.fileService, folder.workspaceFolder)) {
				return;
			}
			// This write can run later than the drawing that asked for it.
			await this.write(folder, await this.absent(folder, gone), undefined, false, respelled);
			this.logged.delete(key);
		}).catch(error => {
			const message = error instanceof Error ? error.message : String(error);
			if (this.logged.get(key) !== message) {
				this.logged.set(key, message);
				this.logService.warn(`BaseHalf could not save the places of new cards in '${folder.relativePath}'`, error);
			}
		});
		this.saves.set(key, save);
		return save;
	}

	/**
	 * Saves what waits for this canvas as part of a change the user made there.
	 * The user's action is what writes, so this also writes in a marked folder.
	 * A layout that cannot be read in full is still left as it is: the user's
	 * own write makes it readable, and a second call then saves the places.
	 */
	saveWithUserChange(folder: IBaseHalfCanvasFolderState, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		// The user saw the cards where they wait, and may have put one beside them on purpose.
		return this.write(folder, [], lease, true);
	}

	private async write(folder: IBaseHalfCanvasFolderState, gone: readonly string[], lease?: IBaseHalfWorkspaceMutationLease, asDrawn = false, respelled: readonly { readonly from: string; readonly to: string }[] = []): Promise<void> {
		const key = keyOf(folder);
		const cards = [...this.waiting.get(key)?.values() ?? []];
		if (cards.length === 0 && gone.length === 0 && respelled.length === 0) {
			return;
		}
		if (await this.canvasMirrorService.saveAppearedCards(folder, cards, gone, lease, { asDrawn, respelled }) === undefined) {
			return;
		}
		// Each of these paths has a row now: the one written here, or one that was there first.
		const waiting = this.waiting.get(key);
		for (const card of cards) {
			if (waiting?.get(card.path) === card) {
				waiting.delete(card.path);
			}
		}
	}

	/** The paths that name nothing on disk right now: no file, no folder, and no draft. */
	private async absent(folder: IBaseHalfCanvasFolderState, paths: readonly string[]): Promise<string[]> {
		const checked = await Promise.all(paths.map(async path => await this.fileService.exists(URI.joinPath(folder.workspaceFolder, ...path.split('/'))) || await baseHalfPathHoldsDraft(this.fileService, folder.workspaceFolder, path) ? undefined : path));
		return checked.filter((path): path is string => path !== undefined);
	}
}

function keyOf(folder: IBaseHalfCanvasFolderState): string {
	return `${folder.workspaceFolder.toString()}\u0000${folder.relativePath}`;
}
