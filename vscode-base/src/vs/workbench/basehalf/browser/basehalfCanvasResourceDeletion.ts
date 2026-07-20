/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { URI } from '../../../base/common/uri.js';
import { ResourceFileEdit } from '../../../editor/browser/services/bulkEditService.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { UndoRedoGroup } from '../../../platform/undoRedo/common/undoRedo.js';
import { IExplorerService } from '../../contrib/files/browser/files.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../common/basehalfCanvasEditing.js';

const MAX_DELETE_RESOURCES = 512;

export interface IBaseHalfCanvasDeleteResource {
	readonly resource: URI;
	readonly folder: boolean;
	readonly maxSize: number;
}

export interface IBaseHalfCanvasDeleteOptions {
	readonly permanently: boolean;
	readonly undoLabel: string;
	readonly progressLabel: string;
	readonly confirmBeforeUndo: boolean;
}

export const IBaseHalfCanvasResourceDeletionService = createDecorator<IBaseHalfCanvasResourceDeletionService>('baseHalfCanvasResourceDeletionService');

export interface IBaseHalfCanvasResourceDeletionService {
	readonly _serviceBrand: undefined;
	delete(resources: readonly IBaseHalfCanvasDeleteResource[], options: IBaseHalfCanvasDeleteOptions, token?: CancellationToken): Promise<void>;
}

export class BaseHalfCanvasResourceDeletionService implements IBaseHalfCanvasResourceDeletionService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IExplorerService private readonly explorerService: IExplorerService
	) { }

	async delete(resources: readonly IBaseHalfCanvasDeleteResource[], options: IBaseHalfCanvasDeleteOptions, token = CancellationToken.None): Promise<void> {
		if (resources.length === 0) {
			return;
		}
		if (resources.length > MAX_DELETE_RESOURCES) {
			throw new Error(`A single canvas delete supports at most ${MAX_DELETE_RESOURCES} resources.`);
		}
		const keys = new Set<string>();
		for (const entry of resources) {
			const key = entry.resource.toString();
			if (keys.has(key)) {
				throw new Error(`The same canvas resource cannot be deleted twice: '${entry.resource.path}'.`);
			}
			keys.add(key);
		}
		const group = new UndoRedoGroup();
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		await this.explorerService.applyBulkEdit(resources.map(entry => new ResourceFileEdit(entry.resource, undefined, {
			recursive: true,
			folder: entry.folder,
			skipTrashBin: options.permanently,
			maxSize: entry.maxSize
		})), {
			undoLabel: options.undoLabel,
			progressLabel: options.progressLabel,
			confirmBeforeUndo: options.confirmBeforeUndo,
			undoRedoGroup: group,
			undoRedoSource: BASEHALF_CANVAS_UNDO_REDO_SOURCE
		});
	}
}

registerSingleton(IBaseHalfCanvasResourceDeletionService, BaseHalfCanvasResourceDeletionService, InstantiationType.Delayed);
