/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITextFileService, TextFileEditorModelState } from '../../../services/textfile/common/textfiles.js';
import { baseHalfEditorProjectionCanFlush, BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushOptions, IBaseHalfEditorFlushService } from '../../navigation/common/basehalfEditorFlush.js';
import { BaseHalfCardDetailProjection } from '../common/basehalfCardDetail.js';

export type BaseHalfCardDetailSaveState = 'saving' | 'saved' | 'error';

/**
 * Saves the file that a view of Card Detail edits in an editor of text: Source,
 * and the right side of Changes. Both edit the same text model, and the view that
 * shows is the one that saves it when Card Detail is left.
 */
export class BaseHalfTextFileSaving extends Disposable {
	private static readonly SAVE_SETTLE_TIMEOUT = 15000;

	private saving = false;

	constructor(
		private readonly projection: BaseHalfCardDetailProjection,
		/** The file the view edits; nothing while it edits none. */
		private readonly resourceOf: () => URI | undefined,
		private readonly isVisible: () => boolean,
		private readonly onStatus: (status: BaseHalfCardDetailSaveState) => void,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		const follow = (resource: URI) => {
			if (isEqual(resource, this.resourceOf())) {
				this.updateStatus();
			}
		};
		this._register(this.textFileService.files.onDidChangeDirty(model => follow(model.resource)));
		this._register(this.textFileService.files.onDidChangeReadonly(model => follow(model.resource)));
		this._register(this.textFileService.files.onDidSaveError(model => follow(model.resource)));
		this._register(this.textFileService.files.onDidSave(event => follow(event.model.resource)));
		this._register(this.textFileService.files.onDidRevert(model => follow(model.resource)));
	}

	/** The view shows this document from now on: a save asked of the pane or of the document reaches it. */
	registerFlushers(documentKey: string): void {
		this._register(this.editorFlushService.registerPaneFlusher(BASEHALF_CARD_DETAIL_PANE_ID, options => this.flush(options)));
		this._register(this.editorFlushService.registerDocumentFlusher(documentKey, options => this.flush(options)));
	}

	async save(): Promise<void> {
		await this.flush({ forceSerialize: true });
	}

	private async flush(options: IBaseHalfEditorFlushOptions = {}): Promise<boolean> {
		if (!baseHalfEditorProjectionCanFlush(this.projection, this.isVisible(), options)) {
			return true;
		}
		const resource = this.resourceOf();
		if (!resource) {
			this.updateStatus();
			return true;
		}

		if (!this.textFileService.isDirty(resource)) {
			this.updateStatus();
			return true;
		}

		if (this.isReadonly(resource)) {
			this.updateStatus();
			return false;
		}

		this.saving = true;
		this.onStatus('saving');
		try {
			const savedResource = await this.textFileService.save(resource);
			if (!savedResource && this.textFileService.isDirty(resource)) {
				this.saving = false;
				this.updateStatus();
				return false;
			}
			// A conflicted/erroring model never settles on its own (auto saves
			// are skipped in these states), so fail fast instead of burning the
			// settle timeout before refusing.
			if (this.hasUnsavableState(resource)) {
				this.saving = false;
				this.updateStatus();
				return false;
			}
			const clean = await this.waitForClean(resource);
			this.saving = false;
			this.updateStatus();
			return clean;
		} catch (error) {
			this.logService.error('[BaseHalf] card detail save failed', error);
			this.saving = false;
			this.onStatus('error');
			return false;
		}
	}

	private hasUnsavableState(resource: URI): boolean {
		const textFileModel = this.textFileService.files.get(resource);
		return !!textFileModel && (textFileModel.hasState(TextFileEditorModelState.CONFLICT) || textFileModel.hasState(TextFileEditorModelState.ERROR));
	}

	private async waitForClean(resource: URI): Promise<boolean> {
		if (!this.textFileService.isDirty(resource)) {
			return true;
		}

		return new Promise<boolean>(resolve => {
			let settled = false;
			const timer = mainWindow.setTimeout(() => settle(!this.textFileService.isDirty(resource)), BaseHalfTextFileSaving.SAVE_SETTLE_TIMEOUT);
			const disposable = this.textFileService.files.onDidChangeDirty(model => {
				if (isEqual(model.resource, resource) && !model.isDirty()) {
					settle(true);
				}
			});

			const settle = (value: boolean) => {
				if (settled) {
					return;
				}
				settled = true;
				mainWindow.clearTimeout(timer);
				disposable.dispose();
				resolve(value);
			};
		});
	}

	updateStatus(): void {
		const resource = this.resourceOf();
		if (!resource) {
			this.onStatus('saving');
			return;
		}

		if (this.isReadonly(resource)) {
			this.onStatus('saved');
			return;
		}

		if (this.saving) {
			this.onStatus('saving');
			return;
		}

		// CONFLICT/ERROR models skip all auto saves, so without a visible state
		// the user would keep typing into a card that silently stopped
		// persisting. Surface it and let the header indicator offer a retry.
		if (this.hasUnsavableState(resource)) {
			this.onStatus('error');
			return;
		}

		this.onStatus(this.textFileService.isDirty(resource) ? 'saving' : 'saved');
	}

	private isReadonly(resource: URI): boolean {
		return !!this.textFileService.files.get(resource)?.isReadonly();
	}
}
