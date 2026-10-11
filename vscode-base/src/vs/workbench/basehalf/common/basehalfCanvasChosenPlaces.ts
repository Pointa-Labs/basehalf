/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IBaseHalfCanvasMirrorService } from './basehalfCanvasMirror.js';
import { IBaseHalfCanvasCard, IBaseHalfCanvasFile } from './basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from './basehalfCanvasNavigation.js';
import { baseHalfIsWorkspaceFolderMarked } from './basehalfLegacyCleanup.js';
import { IBaseHalfWorkspaceMutationLease } from './basehalfWorkspaceMutation.js';

export interface IBaseHalfCanvasChosenPlacesSaveOptions {
	/** Maps a path to what two spellings of the same path share. Defaults to the path. */
	readonly pathKey?: (path: string) => string;
	/** The rows whose item is spelled differently now. Each takes the new spelling. */
	readonly respelled?: readonly { readonly from: string; readonly to: string }[];
}

/** What following moved items knows about the items of a workspace folder. */
export interface IBaseHalfCanvasPlacesMovedItems {
	isSettled(workspaceFolder: URI): boolean;
	isMoving(workspaceFolder: URI, path: string): boolean;
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

	constructor(
		private readonly fileService: IFileService,
		private readonly canvasMirrorService: Pick<IBaseHalfCanvasMirrorService, 'saveAppearedCards'>,
		private readonly movedItems: IBaseHalfCanvasPlacesMovedItems,
		private readonly logService: ILogService
	) { }

	/** The places that wait for this canvas, by path. A drawing passes them to the model so that their cards stay. */
	waitingFor(folder: IBaseHalfCanvasFolderState): ReadonlyMap<string, IBaseHalfCanvasCard> | undefined {
		return this.waiting.get(keyOf(folder));
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
	 * Saves by itself what waits for this canvas, and removes the rows BaseHalf
	 * chose for items that are no longer in the folder.
	 *
	 * - `children` are the paths of everything in the folder, shown or not.
	 * - `layout` is the layout the canvas was drawn from. It was read in full:
	 *   BaseHalf does not write over content it could not read by itself.
	 * - Nothing is written in a marked folder.
	 * - A row leaves only once following moved items has given its item up: the
	 *   row of a renamed file is moved to the new name, not removed.
	 * - A file that changed only in letter case, on a volume that ignores it, is
	 *   still there: its row takes the new spelling.
	 * - A failure is logged and shown to nobody, because nothing the user did is
	 *   waiting. The places keep waiting and the next drawing tries again.
	 */
	save(folder: IBaseHalfCanvasFolderState, children: readonly string[], layout: IBaseHalfCanvasFile | null, options: IBaseHalfCanvasChosenPlacesSaveOptions = {}): Promise<void> {
		const key = keyOf(folder);
		const pathKey = options.pathKey ?? (path => path);
		const respelled = options.respelled ?? [];
		const there = new Set(children.map(pathKey));
		const gone = this.movedItems.isSettled(folder.workspaceFolder)
			? (layout?.cards ?? []).filter(card => card.auto && !there.has(pathKey(card.path)) && !this.movedItems.isMoving(folder.workspaceFolder, card.path)).map(card => card.path)
			: [];
		if (!this.waiting.get(key)?.size && gone.length === 0 && respelled.length === 0) {
			return this.saves.get(key) ?? Promise.resolve();
		}
		const save = (this.saves.get(key) ?? Promise.resolve()).then(async () => {
			if (await baseHalfIsWorkspaceFolderMarked(this.fileService, folder.workspaceFolder)) {
				return;
			}
			await this.write(folder, gone, undefined, false, respelled);
		}).catch(error => {
			this.logService.warn(`BaseHalf could not save the places of new cards in '${folder.relativePath}'`, error);
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
}

function keyOf(folder: IBaseHalfCanvasFolderState): string {
	return `${folder.workspaceFolder.toString()}\u0000${folder.relativePath}`;
}
