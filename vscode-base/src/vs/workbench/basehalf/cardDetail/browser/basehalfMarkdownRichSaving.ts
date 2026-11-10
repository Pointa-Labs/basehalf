/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IBaseHalfEditorFlushOptions } from '../../navigation/common/basehalfEditorFlush.js';
import { baseHalfMarkdownRichColdFlushResult, baseHalfMarkdownRichNeedsSaveRequest } from '../../markdown/common/basehalfMarkdownRichFlush.js';
import { applyBaseHalfMarkdownRichTextModelContent, BaseHalfMarkdownRichTextModelDisk } from '../../markdown/common/basehalfMarkdownRichTextModel.js';
import { baseHalfMarkdownRichBody } from '../../markdown/common/basehalfMarkdownRichSession.js';
import { BaseHalfMarkdownRichWebviewBridge } from '../../markdown/common/basehalfMarkdownRichWebviewBridge.js';
import { BaseHalfMarkdownRichSaveRequestedMessage, BaseHalfMarkdownRichWebviewSaveCoordinator, planBaseHalfMarkdownRichProjectionHandoff } from '../../markdown/common/basehalfMarkdownRichWebviewSaveCoordinator.js';
import { markdownRichProjectionSaves, type IBaseHalfMarkdownRichProjectionSave } from './basehalfMarkdownRichShared.js';
import type { BaseHalfMarkdownRichCardDetail } from './basehalfMarkdownRichCardDetail.js';

/**
 * What the Rich editor wrote reaches the note's file: the flush before Card Detail is left, closed, or handed to
 * another projection, and the save that the editor asks for, with what was written while it ran.
 *
 * A part of the Rich projection of Card Detail (`basehalfMarkdownRichCardDetail.ts`): it keeps its own state,
 * and reaches the projection's as `detail`.
 */
export class BaseHalfMarkdownRichSaving {
	private readonly coordinator = new BaseHalfMarkdownRichWebviewSaveCoordinator();
	/** Bodies of rich saves the host is writing now. */
	private readonly pendingEditorSaveBodies: string[] = [];
	private pendingProjectionSave: Promise<boolean> | undefined;

	constructor(private readonly detail: BaseHalfMarkdownRichCardDetail) { }

	async flush(options: IBaseHalfEditorFlushOptions = {}): Promise<boolean> {
		const structural = options.structural === true;
		if (!this.detail.bridge) {
			return !structural;
		}
		// A canvas-to-detail handoff can finish opening while its shared working
		// copy is still saving. That durable write remains part of this surface's
		// close contract even though the newly mounted webview is not dirty.
		if ((this.pendingProjectionSave || this.detail.projectionSaveFailed) && !await this.ensureProjectionSaved()) {
			return false;
		}
		const coldFlushResult = baseHalfMarkdownRichColdFlushResult(this.detail.editorReady, this.detail.dirty);
		if (coldFlushResult !== undefined) {
			return coldFlushResult;
		}
		if (!baseHalfMarkdownRichNeedsSaveRequest(this.detail.dirty, this.detail.visible, options)) {
			return true;
		}
		if (structural && (!this.detail.structuralFrozen || !await this.detail.waitForStructuralFreeze())) {
			return false;
		}

		const requestId = `flush-${generateUuid()}`;
		return new Promise<boolean>(resolve => {
			const timer = mainWindow.setTimeout(() => {
				this.detail.pendingFlushes.delete(requestId);
				resolve(false);
			}, 15000);
			const pending = { resolve, timer };
			this.detail.pendingFlushes.set(requestId, pending);
			void this.detail.bridge!.sendSave(requestId, {
				forceSerialize: options.forceSerialize ?? true,
				forceWrite: options.forceWrite ?? false,
				structural,
				handoff: false
			}).then(posted => {
				if (!posted && this.detail.pendingFlushes.get(requestId) === pending) {
					this.detail.pendingFlushes.delete(requestId);
					mainWindow.clearTimeout(timer);
					resolve(false);
				}
			}, () => {
				if (this.detail.pendingFlushes.get(requestId) === pending) {
					this.detail.pendingFlushes.delete(requestId);
					mainWindow.clearTimeout(timer);
					resolve(false);
				}
			});
		});
	}

	async doPrepareToClose(): Promise<boolean> {
		this.detail.setStructuralFrozen(true);
		if (!await this.detail.waitForStructuralFreeze()) {
			if (!this.detail.disposed) {
				this.detail.pendingPrepareToClose = undefined;
				this.detail.setStructuralFrozen(false);
			}
			return false;
		}
		if (this.detail.pendingProjectionHandoff) {
			if (!await this.detail.pendingProjectionHandoff || !await this.ensureProjectionSaved()) {
				if (!this.detail.disposed) {
					this.detail.pendingPrepareToClose = undefined;
					this.detail.setStructuralFrozen(false);
				}
				return false;
			}
			return true;
		}
		if (!this.detail.editorReady) {
			return true;
		}
		const saved = await this.flush({
			forceSerialize: true,
			forceWrite: false,
			rejectOnError: true,
			structural: true
		});
		if (!saved && !this.detail.disposed) {
			this.detail.pendingPrepareToClose = undefined;
			this.detail.setStructuralFrozen(false);
		}
		return saved;
	}

	async doPrepareProjectionHandoff(): Promise<boolean> {
		this.detail.setStructuralFrozen(true);
		if (!await this.detail.waitForStructuralFreeze()) {
			if (!this.detail.disposed) {
				this.detail.pendingPrepareToClose = undefined;
				this.detail.setStructuralFrozen(false);
			}
			return false;
		}
		if (!this.detail.editorReady) {
			return true;
		}

		const captured = await this.captureProjectionHandoff();
		if (!captured && !this.detail.disposed) {
			this.detail.pendingProjectionHandoff = undefined;
			this.detail.setStructuralFrozen(false);
		}
		return captured;
	}

	private async captureProjectionHandoff(): Promise<boolean> {
		const bridge = this.detail.bridge;
		if (!bridge) {
			return false;
		}
		const requestId = `handoff-${generateUuid()}`;
		return new Promise<boolean>(resolve => {
			const timer = mainWindow.setTimeout(() => {
				this.detail.pendingFlushes.delete(requestId);
				resolve(false);
			}, 15000);
			const pending = { resolve, timer, handoff: true as const };
			this.detail.pendingFlushes.set(requestId, pending);
			void bridge.sendSave(requestId, {
				forceSerialize: true,
				forceWrite: false,
				structural: true,
				handoff: true
			}).then(posted => {
				if (!posted && this.detail.pendingFlushes.get(requestId) === pending) {
					this.detail.pendingFlushes.delete(requestId);
					mainWindow.clearTimeout(timer);
					resolve(false);
				}
			}, () => {
				if (this.detail.pendingFlushes.get(requestId) === pending) {
					this.detail.pendingFlushes.delete(requestId);
					mainWindow.clearTimeout(timer);
					resolve(false);
				}
			});
		});
	}

	async handleSaveRequested(message: BaseHalfMarkdownRichSaveRequestedMessage, model: ITextModel): Promise<void> {
		const bridge = this.detail.bridge;
		if (!bridge) {
			return;
		}
		const pendingHandoff = this.detail.pendingFlushes.get(message.requestId);
		if (pendingHandoff?.handoff) {
			await this.handleProjectionHandoff(message, model, bridge, pendingHandoff);
			return;
		}

		this.detail.setSaveStatus('saving');
		this.pendingEditorSaveBodies.push(message.body);
		try {
			await this.detail.modelWriteGate.run(async () => {
				const outcome = await this.coordinator.handleSaveRequested(
					message,
					new BaseHalfMarkdownRichTextModelDisk(model, this.detail.textFileAdapter()),
					bridge
				);
				if (outcome.result === 'saved' || outcome.result === 'noop') {
					this.detail.lastSentContent = outcome.content ?? model.getValue();
					this.detail.lastAcceptedEditorContent = this.detail.lastSentContent;
					this.detail.dirty = false;
					if (!this.detail.textFileService.isDirty(model.uri)) {
						this.detail.projectionSaveFailed = false;
						if (this.detail.documentKey) {
							markdownRichProjectionSaves.delete(this.detail.documentKey);
						}
					}
				}
				const pending = this.detail.pendingFlushes.get(message.requestId);
				if (pending) {
					this.detail.pendingFlushes.delete(message.requestId);
					mainWindow.clearTimeout(pending.timer);
					pending.resolve(outcome.okToLeave);
				}
			});
		} finally {
			const index = this.pendingEditorSaveBodies.indexOf(message.body);
			if (index >= 0) {
				this.pendingEditorSaveBodies.splice(index, 1);
			}
			this.detail.updateStatus();
		}
		await this.readWritesMadeDuringSave(model.uri);
	}

	/**
	 * Reads the note's file again once a save of Rich's has ended. The text
	 * model reads no change of the file that comes while a save makes it
	 * dirty or runs, and a save takes the file's state after its write as
	 * its own, also when another write came between: a change written
	 * outside in that moment would not reach Rich, which would go on showing
	 * the note as it was, and the next save would write over it. The file's
	 * text is read whatever its state says.
	 */
	private async readWritesMadeDuringSave(resource: URI): Promise<void> {
		try {
			await this.detail.textFileService.files.get(resource)?.resolve({ forceReadFromFile: true });
		} catch (error) {
			this.detail.logService.warn('[BaseHalf] rich Markdown could not read the note again after a save', error);
		}
	}

	/**
	 * Hands the rich body to the shared text model synchronously, under the
	 * model's current frontmatter, and starts the durable save in the
	 * background.
	 */
	private async handleProjectionHandoff(
		message: BaseHalfMarkdownRichSaveRequestedMessage,
		model: ITextModel,
		bridge: BaseHalfMarkdownRichWebviewBridge,
		pending: { readonly resolve: (ok: boolean) => void; readonly timer: number; readonly handoff?: true }
	): Promise<void> {
		let ok = false;
		this.detail.setSaveStatus('saving');
		try {
			await this.detail.modelWriteGate.run(async () => {
				const current = model.getValue();
				const plan = planBaseHalfMarkdownRichProjectionHandoff(current, message, this.acceptedEditorBodies());
				if (plan.kind === 'conflict') {
					await bridge.sendSaveResult(message.requestId, 'blockedByConflict', { disk: plan.disk });
					return;
				}
				const content = plan.changed ? applyBaseHalfMarkdownRichTextModelContent(model, plan.content) : current;
				this.detail.lastSentContent = content;
				this.detail.lastAcceptedEditorContent = content;
				this.detail.dirty = false;
				this.pendingProjectionSave = this.startProjectionSave(model);
				await bridge.sendSaveResult(message.requestId, content === current ? 'noop' : 'saved', { content });
				ok = true;
			});
		} catch (error) {
			await bridge.sendSaveResult(message.requestId, 'writeFailed', { message: toErrorMessage(error) });
		} finally {
			if (this.detail.pendingFlushes.get(message.requestId) === pending) {
				this.detail.pendingFlushes.delete(message.requestId);
				mainWindow.clearTimeout(pending.timer);
				pending.resolve(ok);
			}
			this.detail.updateStatus();
		}
	}

	/** Bodies this editor wrote or is writing, which a lagging handoff baseline may not reflect yet. */
	private acceptedEditorBodies(): string[] {
		const bodies = [...this.pendingEditorSaveBodies];
		if (this.detail.lastAcceptedEditorContent !== undefined) {
			bodies.push(baseHalfMarkdownRichBody(this.detail.lastAcceptedEditorContent));
		}
		return bodies;
	}

	private startProjectionSave(model: ITextModel): Promise<boolean> {
		if (this.detail.textFileAdapter().isReadonly(model.uri) || !this.detail.textFileService.isDirty(model.uri)) {
			this.detail.projectionSaveFailed = false;
			return Promise.resolve(true);
		}
		const documentKey = this.detail.documentKey;
		if (!documentKey) {
			return Promise.resolve(false);
		}
		const record: IBaseHalfMarkdownRichProjectionSave = { promise: Promise.resolve(false) };
		record.promise = this.detail.textFileService.save(model.uri, { ignoreErrorHandler: true }).then(async () => {
			const saved = !this.detail.textFileService.isDirty(model.uri);
			if (saved) {
				await this.readWritesMadeDuringSave(model.uri);
			}
			if (!saved) {
				record.error = 'Changes could not be saved to disk.';
			}
			return saved;
		}, error => {
			record.error = toErrorMessage(error);
			this.detail.logService.error(error);
			return false;
		}).then(saved => {
			if (markdownRichProjectionSaves.get(documentKey) === record) {
				if (saved) {
					markdownRichProjectionSaves.delete(documentKey);
				} else {
					this.detail.projectionSaveFailed = true;
				}
			}
			if (!this.detail.disposed && this.detail.documentKey === documentKey) {
				this.detail.updateStatus();
			}
			return saved;
		});
		markdownRichProjectionSaves.set(documentKey, record);
		return record.promise;
	}

	async ensureProjectionSaved(): Promise<boolean> {
		if (this.pendingProjectionSave && await this.pendingProjectionSave) {
			return true;
		}
		const state = this.detail.state;
		if (!state || this.detail.textFileAdapter().isReadonly(state.resource) || !this.detail.textFileService.isDirty(state.resource)) {
			this.detail.projectionSaveFailed = false;
			return true;
		}
		const saved = await this.detail.textFileService.save(state.resource, { ignoreErrorHandler: true }).then(
			() => !this.detail.textFileService.isDirty(state.resource),
			error => {
				this.detail.logService.error(error);
				return false;
			}
		);
		this.detail.projectionSaveFailed = !saved;
		if (saved && this.detail.documentKey) {
			markdownRichProjectionSaves.delete(this.detail.documentKey);
		}
		return saved;
	}

	observeProjectionSave(): void {
		const documentKey = this.detail.documentKey;
		if (!documentKey) {
			return;
		}
		const record = markdownRichProjectionSaves.get(documentKey);
		if (!record) {
			return;
		}
		this.pendingProjectionSave = record.promise;
		void record.promise.then(saved => {
			if (this.detail.disposed || this.detail.documentKey !== documentKey) {
				return;
			}
			this.detail.projectionSaveFailed = !saved;
			this.detail.updateStatus();
		});
	}
}
