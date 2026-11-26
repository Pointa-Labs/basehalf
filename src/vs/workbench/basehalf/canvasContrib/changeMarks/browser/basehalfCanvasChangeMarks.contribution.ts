/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IDecorationsService } from '../../../../services/decorations/common/decorations.js';
import { IBaseHalfCanvasCardMark, IBaseHalfCanvasContribution, IBaseHalfCanvasContributionContext, IBaseHalfCanvasMark, IBaseHalfCanvasView, registerBaseHalfCanvasContribution } from '../../../canvas/browser/basehalfCanvasExtensions.js';
import { BASEHALF_CHANGES_PROJECTION_ID, IBaseHalfFileChangesService } from '../../../changes/common/basehalfFileChanges.js';
import { IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';

/** Source Control fires per group and the decorations follow it: one drawing for all of it. */
const REFRESH_DELAY_MS = 100;

/**
 * Says on the canvas which files changed, with the letter and the color that Files
 * gives them (the changes of a file, rules 2 to 7). What a card shows of its file
 * does not depend on it.
 */
export class BaseHalfCanvasChangeMarks extends Disposable implements IBaseHalfCanvasContribution {

	static readonly ID = 'basehalf.canvas.changeMarks';

	private readonly canvas: IBaseHalfCanvasView;
	/** VS Code keeps the stylesheet rule of a decoration while someone holds the decoration. */
	private readonly heldDecorations = this._register(new MutableDisposable<DisposableStore>());
	private readonly refresh = this._register(new RunOnceScheduler(() => this.update(), REFRESH_DELAY_MS));

	constructor(
		context: IBaseHalfCanvasContributionContext,
		@IBaseHalfFileChangesService private readonly changes: IBaseHalfFileChangesService,
		@IDecorationsService private readonly decorations: IDecorationsService,
		@IBaseHalfCanvasNavigationService private readonly navigation: IBaseHalfCanvasNavigationService,
	) {
		super();
		this.canvas = context.canvas;
		this._register(this.canvas.onDidChangeScene(() => this.refresh.schedule()));
		this._register(this.changes.onDidChange(() => this.refresh.schedule()));
		this._register(this.decorations.onDidChangeDecorations(() => this.refresh.schedule()));
	}

	private update(): void {
		const held = new DisposableStore();
		const marks = new Map<string, IBaseHalfCanvasCardMark>();
		for (const card of this.canvas.scene.cards) {
			const item = this.canvas.getItem(card.path);
			// A draft has no file yet.
			if (!item || item.generation?.draft) {
				continue;
			}
			const resource = item.stat.resource;
			const isFolder = item.kind === 'folder';
			const mark = this.markOf(resource, isFolder, held);
			if (mark) {
				marks.set(card.path, isFolder
					? { ...mark, title: '', rowMark: (name, rowIsFolder) => this.markOf(joinPath(resource, name), rowIsFolder, held) }
					: { ...mark, title: localize('basehalf.changes.showChanges', "Show Changes"), open: () => this.open(resource) });
			}
		}
		this.canvas.setCardMarks(marks);
		// The cards hold the classes of the new marks by now, so the old rules can go.
		this.heldDecorations.value = held;
	}

	private markOf(resource: URI, isFolder: boolean, held: DisposableStore): IBaseHalfCanvasMark | undefined {
		if (!(isFolder ? this.changes.holdsChange(resource) : this.changes.isChanged(resource))) {
			return undefined;
		}
		// What Files shows of it. Source Control lists it, so it is no ignored file, and its letter comes when Git's decorations do.
		const decoration = this.decorations.getDecoration(resource, isFolder);
		if (!decoration) {
			return undefined;
		}
		held.add(decoration);
		return { labelClassName: decoration.labelClassName, badgeClassName: decoration.badgeClassName };
	}

	private open(resource: URI): void {
		void this.navigation.openCardDetail(resource, { source: 'api', pinned: true, projection: BASEHALF_CHANGES_PROJECTION_ID });
	}
}

registerBaseHalfCanvasContribution(BaseHalfCanvasChangeMarks.ID, BaseHalfCanvasChangeMarks);
