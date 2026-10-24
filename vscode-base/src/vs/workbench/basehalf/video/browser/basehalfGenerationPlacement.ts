/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import {
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	BASEHALF_CANVAS_GRID_COLUMN_GAP,
	baseHalfCanvasOpenPosition,
	IBaseHalfCanvasCard,
	IBaseHalfCanvasFile
} from '../../canvas/common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState, IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { IBaseHalfWorkspaceMutationLease } from '../../workspace/common/basehalfWorkspaceMutation.js';
import { BaseHalfGenerationKind } from '../common/basehalfGenerationInfo.js';

/** The size a new card of each kind is drawn at (generation cards, "Creating a generation card"): a sound has the size of a file card. */
export const BASEHALF_GENERATION_CARD_SIZE: Readonly<Record<BaseHalfGenerationKind, { readonly width: number; readonly height: number }>> = Object.freeze({
	image: Object.freeze({ width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT }),
	video: Object.freeze({ width: 720, height: 405 }),
	audio: Object.freeze({ width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT })
});

/** A card to place, by its workspace-relative path, at the size it is drawn. */
export interface IBaseHalfPlacedCard {
	readonly path: string;
	readonly size: { readonly width: number; readonly height: number };
}

/** What placing a card beside another needs. */
export interface IBaseHalfPlacementServices {
	readonly fileService: IFileService;
	readonly canvasMirrorService: IBaseHalfCanvasMirrorService;
	readonly logService: ILogService;
}

/** The canvas of the folder that holds a card. */
export function baseHalfParentCanvasFolder(item: IBaseHalfWorkspaceResource): IBaseHalfCanvasFolderState {
	const slash = item.relativePath.lastIndexOf('/');
	const relativePath = slash < 0 ? '' : item.relativePath.slice(0, slash);
	return {
		resource: relativePath ? URI.joinPath(item.workspaceFolder, ...relativePath.split('/')) : item.workspaceFolder,
		workspaceFolder: item.workspaceFolder,
		relativePath,
		source: 'api'
	};
}

/**
 * Puts the cards of new items in a row to the right of the card they were
 * made from, each 40 to the right of the one before, at the nearest open
 * place (canvas card placement, "Pointing" and "The nearest open place"). The
 * user's action made them, so the rows are the user's, not chosen rows.
 * Without a row of the original card, the new cards appear at the end of the
 * canvas like any other. A marked folder gets no rows. A row that cannot be
 * saved is logged: its item exists, and its card appears at the end of the
 * canvas instead. With a lease, the rows are written inside it.
 */
export async function placeBaseHalfCardsBeside(
	services: IBaseHalfPlacementServices,
	folder: IBaseHalfCanvasFolderState,
	originalPath: string,
	cards: readonly IBaseHalfPlacedCard[],
	options?: { readonly layout?: IBaseHalfCanvasFile | null; readonly lease?: IBaseHalfWorkspaceMutationLease }
): Promise<void> {
	if (!cards.length) {
		return;
	}
	try {
		const layout = options?.layout !== undefined ? options.layout : await services.canvasMirrorService.readCanvas(folder);
		const original = layout?.cards.find(card => card.path === originalPath);
		if (!layout || !original || await baseHalfIsWorkspaceFolderMarked(services.fileService, folder.workspaceFolder)) {
			return;
		}
		const placing = new Set(cards.map(card => card.path));
		const taken: IBaseHalfCanvasCard[] = layout.cards.filter(card => !placing.has(card.path));
		let previous: { readonly x: number; readonly y: number; readonly width: number } = original;
		const rows: IBaseHalfCanvasCard[] = [];
		for (const card of cards) {
			const place = baseHalfCanvasOpenPosition({ x: previous.x + previous.width + BASEHALF_CANVAS_GRID_COLUMN_GAP, y: original.y }, card.size, taken);
			const row: IBaseHalfCanvasCard = { path: card.path, kind: 'file', x: place.x, y: place.y, ...card.size };
			rows.push(row);
			taken.push(row);
			previous = row;
		}
		await services.canvasMirrorService.updateCardGeometries(folder, rows, options?.lease);
	} catch (error) {
		services.logService.warn(`[BaseHalf] could not place ${cards.map(card => card.path).join(', ')} beside ${originalPath}`, error);
	}
}
