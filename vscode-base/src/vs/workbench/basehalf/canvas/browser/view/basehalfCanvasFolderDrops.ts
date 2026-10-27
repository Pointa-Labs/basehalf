/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_CANVAS_DROP_TARGET_ATTRIBUTE, BaseHalfCanvasDropFolder } from '../../common/basehalfCanvasFolderDrop.js';
import type { IBaseHalfCanvasFolderDrops } from '../basehalfCanvasExtensions.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';

/**
 * Dropping into a folder: the cards of the scene let go on a folder's card or
 * on a folder of the path in the title bar, and items from Files or files
 * from outside the window let go on a folder's card. The feature that moves
 * them takes them through `take` (IBaseHalfCanvasView.takeFolderDrops).
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasFolderDrops {
	private drops: IBaseHalfCanvasFolderDrops | undefined;
	private shownTarget: HTMLElement | undefined;

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	take(drops: IBaseHalfCanvasFolderDrops): IDisposable {
		this.drops = drops;
		return toDisposable(() => {
			if (this.drops === drops) {
				this.drops = undefined;
			}
		});
	}

	/** Cards of the scene let go on a folder (IBaseHalfCanvasSceneDelegate.dropCardsIntoFolder). */
	async dropSceneCards(sceneKey: string, structuralEpoch: number, paths: readonly string[], drop: BaseHalfCanvasDropFolder): Promise<void> {
		const folder = this.view.folderForSceneMutation(sceneKey);
		const target = this.targetOf(folder, drop);
		if (!this.view.isSceneStampCurrent(folder, structuralEpoch, drop.kind === 'card' ? [...paths, drop.path] : paths)) {
			throw new Error(localize('basehalf.canvas.folderDrop.changed', "The canvas changed before the cards could be moved. Try again."));
		}
		const resources: URI[] = [];
		for (const path of paths) {
			const item = this.view.renderedItemsByPath.get(path);
			if (!item) {
				throw new Error(localize('basehalf.canvas.folderDrop.gone', "One or more of the cards are no longer on the canvas."));
			}
			resources.push(item.stat.resource);
		}
		this.view.markCanvasUserInteraction();
		await this.put(resources, target, 'move');
	}

	/** Items from Files, or files from outside the window, let go on the folder's card at `path`. */
	async dropOnFolderCard(folder: IBaseHalfCanvasFolderState, resources: readonly URI[], path: string, operation: 'move' | 'copy'): Promise<void> {
		await this.put(resources, this.targetOf(folder, { kind: 'card', path }), operation);
	}

	/**
	 * Marks the folder's card under a point of the window as the one that
	 * takes a drag from Files or from outside, and returns its path; without a
	 * point, marks none.
	 */
	showDropTargetAt(clientX?: number, clientY?: number): string | undefined {
		const card = clientX === undefined || clientY === undefined
			? undefined
			: this.view.root.ownerDocument.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.basehalf-canvas-card.folder[data-basehalf-card-path]') ?? undefined;
		const element = card && this.view.cards.contains(card) ? card : undefined;
		if (element !== this.shownTarget) {
			this.shownTarget?.removeAttribute(BASEHALF_CANVAS_DROP_TARGET_ATTRIBUTE);
			element?.setAttribute(BASEHALF_CANVAS_DROP_TARGET_ATTRIBUTE, '');
			this.shownTarget = element;
		}
		return element?.dataset.basehalfCardPath;
	}

	/** The folder a drop goes into: a folder's card of this canvas, or the workspace folder or a folder above the shown one. */
	private targetOf(folder: IBaseHalfCanvasFolderState, drop: BaseHalfCanvasDropFolder): URI {
		if (drop.kind === 'card') {
			const item = this.view.renderedItemsByPath.get(drop.path);
			if (!item?.stat.isDirectory) {
				throw new Error(localize('basehalf.canvas.folderDrop.notFolder', "{0} is not a folder of this canvas any more.", drop.path));
			}
			return item.stat.resource;
		}
		const extUri = this.view.uriIdentityService.extUri;
		const resource = URI.parse(drop.resource);
		if (extUri.isEqual(resource, folder.resource) || !extUri.isEqualOrParent(folder.resource, resource) || !extUri.isEqualOrParent(resource, folder.workspaceFolder)) {
			throw new Error(localize('basehalf.canvas.folderDrop.notPath', "Cards can be dropped only into a folder above this one."));
		}
		return resource;
	}

	private async put(resources: readonly URI[], target: URI, operation: 'move' | 'copy'): Promise<void> {
		if (!this.drops) {
			throw new Error(localize('basehalf.canvas.folderDrop.unavailable', "Nothing can be dropped into a folder now."));
		}
		try {
			await this.drops.drop(resources, target, operation);
		} finally {
			this.view.requestRender();
		}
	}
}
