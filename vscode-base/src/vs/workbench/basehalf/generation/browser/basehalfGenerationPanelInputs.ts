/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { Severity } from '../../../../platform/notification/common/notification.js';
import { IBaseHalfCanvasCardPickCard } from '../../canvas/common/basehalfCanvasCardPick.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfUserFacingErrorMessage } from '../../workspace/common/basehalfPlainFailureReason.js';
import { BaseHalfReferenceEditFailure, BaseHalfReferenceEditRefusal, IBaseHalfReferenceEditResult } from '../../references/common/basehalfReferenceEdit.js';
import { findBaseHalfVideoModel, IBaseHalfVideoCatalogModel } from '../common/basehalfVideoCatalog.js';
import { baseHalfVideoPanelInputFileName } from '../common/basehalfVideoNodePanelPresentation.js';
import { BaseHalfTransfer } from '../../clipboard/common/basehalfClipboard.js';
import { baseHalfTransferFromDrop } from '../../clipboard/browser/basehalfTransfer.js';
import { baseHalfTransferParts } from '../../clipboard/browser/basehalfTransferFiles.js';
import type { BaseHalfVideoNodePanel } from './basehalfVideoNodePanel.js';
import { baseHalfVideoAddedInputRefusal } from '../common/basehalfGenerationInputs.js';

/** The draft itself, while it picks: a click on it does nothing, and nothing says so. */
const PICK_SELF: IBaseHalfCanvasCardPickCard = Object.freeze({ action: 'self' });

/**
 * Changing the inputs of the card: what is pasted or dropped onto the panel, the order of the tiles, Pick on
 * Canvas, Import, and connecting and disconnecting an input as a step of undo.
 *
 * A part of the panel under a generation card (`basehalfVideoNodePanel.ts`): it keeps its own state, and reaches
 * the panel's as `panel`.
 */
export class BaseHalfGenerationPanelInputs {
	/** The cards whose click is being carried out: a second click on one of them does nothing. */
	private readonly picksRunning = new Set<string>();
	/** The clicks of Pick on Canvas, carried out one after the other. */
	private pickQueue: Promise<unknown> = Promise.resolve();

	constructor(private readonly panel: BaseHalfVideoNodePanel) { }

	//#endregion

	//#region Paste and drop

	/** A paste in the panel: what the clipboard holds becomes inputs, and from the prompt is mentioned. */
	async pasteTransfer(mention: boolean): Promise<void> {
		let transfer: BaseHalfTransfer | undefined;
		try {
			transfer = await this.panel.clipboardService.read();
		} catch (error) {
			this.reportReferenceError(error);
			return;
		}
		if (!transfer || this.panel.disposed) {
			return;
		}
		// Text pasted into the prompt is typed, not made a note.
		if (mention && transfer.kind === 'text') {
			if (!this.panel.isLocked()) {
				this.panel.editor.insert(transfer.text);
			}
			return;
		}
		await this.takeTransfer(transfer, mention);
	}

	/** A drop on the panel, as a paste there; on the prompt, at the caret where it was let go. */
	async dropTransfer(dataTransfer: DataTransfer, mention: boolean): Promise<void> {
		let transfer: BaseHalfTransfer | undefined;
		try {
			transfer = await baseHalfTransferFromDrop(dataTransfer);
		} catch (error) {
			this.reportReferenceError(error);
			return;
		}
		if (!transfer || this.panel.disposed) {
			return;
		}
		if (mention && transfer.kind === 'text') {
			if (!this.panel.isLocked()) {
				this.panel.editor.insert(transfer.text);
			}
			return;
		}
		await this.takeTransfer(transfer, mention);
	}

	/**
	 * Each thing a paste or a drop hands over becomes an input, one after the
	 * other, as Pick on Canvas connects a card: what the model cannot use is
	 * refused with the reason, and an input that is connected already stays
	 * where it is. From the prompt, each is then mentioned at the caret (D74).
	 */
	private async takeTransfer(transfer: BaseHalfTransfer, mention: boolean): Promise<void> {
		if (this.panel.isLocked()) {
			return;
		}
		const taken: string[] = [];
		for (const part of baseHalfTransferParts(transfer)) {
			let path: string | undefined;
			try {
				path = await this.panel.host.takeInput(part, async candidate => this.panel.snapshot?.upstream.includes(candidate) || await this.acceptInput(candidate));
			} catch (error) {
				this.reportReferenceError(error);
				continue;
			}
			if (this.panel.disposed) {
				return;
			}
			if (!path || (!this.panel.snapshot?.upstream.includes(path) && !await this.connect(path))) {
				continue;
			}
			// The next one is asked about with this one among the inputs, and its chip is drawn.
			await this.panel.refresh();
			taken.push(path);
		}
		if (mention && !this.panel.disposed) {
			for (const path of taken) {
				this.panel.references.insertMention(path);
			}
		}
	}

	//#endregion

	//#region Inputs

	async reorder(upstream: readonly string[]): Promise<void> {
		try {
			// The names of the prompt follow their inputs from what was typed last (D68).
			await this.panel.flush();
			const snapshot = await this.panel.store.reorderUpstream(this.panel.resource, upstream);
			if (!this.panel.disposed) {
				this.panel.snapshot = snapshot;
				this.panel.scheduleRefresh();
			}
		} catch (error) {
			this.reportReferenceError(error);
		}
	}

	/** Moves an input to the place of `before` in the list, or last, as a dragged tile does. */
	async moveInput(path: string, before: string | undefined): Promise<void> {
		const upstream = this.panel.snapshot?.upstream;
		if (!upstream?.includes(path)) {
			return;
		}
		const rest = upstream.filter(entry => entry !== path);
		const index = before === undefined ? rest.length : rest.indexOf(before);
		if (index < 0) {
			return;
		}
		const order = [...rest.slice(0, index), path, ...rest.slice(index)];
		if (order.every((entry, position) => entry === upstream[position])) {
			return;
		}
		await this.reorder(order);
	}

	//#region Pick on Canvas

	get picking(): boolean {
		return !!this.panel.pick.value;
	}

	/**
	 * Starts Pick on Canvas (D69): until it is ended, a click on a card of the
	 * canvas connects it, or removes it when it is connected.
	 */
	startPick(): void {
		if (this.panel.pick.value || this.panel.isLocked() || !this.panel.snapshot || this.panel.disposed) {
			return;
		}
		this.panel.pickKey = this.pickStateKey();
		this.panel.pick.value = this.panel.host.startPick({
			title: localize('basehalf.video.panel.pickTitle', "Click cards to connect them to {0}, or a connected card to remove it.", baseHalfVideoPanelInputFileName(this.panel.snapshot.path)),
			cardOf: (path, folder) => this.pickCardOf(path, folder),
			pick: path => this.pickCard(path),
			ended: () => this.endPick(),
			onDidChange: this.panel._onDidChangePick.event
		});
		this.panel.render();
	}

	endPick(): void {
		if (!this.panel.pick.value) {
			return;
		}
		this.panel.pick.clear();
		this.panel.render();
	}

	/** What a click on the card at `path` does while picking, as a connection drawn on the canvas would be refused (D67). */
	private pickCardOf(path: string, folder: boolean): IBaseHalfCanvasCardPickCard {
		const snapshot = this.panel.snapshot;
		if (!snapshot || path === snapshot.path) {
			return PICK_SELF;
		}
		if (folder) {
			return Object.freeze({ action: 'refused', label: localize('basehalf.video.panel.pickFolder', "A folder cannot be an input.") });
		}
		const name = baseHalfVideoPanelInputFileName(path);
		if (snapshot.upstream.includes(path)) {
			return Object.freeze({ action: 'remove', label: localize('basehalf.video.panel.pickRemove', "Remove {0}", name) });
		}
		const reason = baseHalfVideoAddedInputRefusal(this.model(), snapshot.upstream, path);
		return Object.freeze(reason
			? { action: 'refused', label: reason }
			: { action: 'connect', label: localize('basehalf.video.panel.pickConnect', "Connect {0}", name) });
	}

	/** What `pickCardOf` answers from: the card, its list, and its model. */
	pickStateKey(): string {
		const info = this.panel.info();
		return JSON.stringify([this.panel.snapshot?.path, this.panel.snapshot?.upstream, info.provider, info.model, this.panel.catalogService.state.kind]);
	}

	/** The draft's model, as the panel shows it. */
	private model(): IBaseHalfVideoCatalogModel | undefined {
		const catalog = this.panel.catalogService.state;
		const info = this.panel.info();
		return catalog.kind === 'ready' ? findBaseHalfVideoModel(catalog.catalog, info.provider, info.model)?.model : undefined;
	}

	/**
	 * A click while picking: connects the card at the end of the list, or
	 * removes a connected one. Clicks are carried out one after the other,
	 * each from the list as the one before left it.
	 */
	private pickCard(path: string): void {
		if (this.picksRunning.has(path)) {
			return;
		}
		this.picksRunning.add(path);
		const run = async () => {
			try {
				const snapshot = this.panel.snapshot;
				if (!snapshot || this.panel.disposed || this.panel.isLocked()) {
					return;
				}
				if (snapshot.upstream.includes(path)) {
					await this.disconnect(path);
				} else if (!await this.acceptInput(path) || !await this.connect(path)) {
					return;
				}
				await this.panel.refresh();
			} finally {
				this.picksRunning.delete(path);
			}
		};
		this.pickQueue = this.pickQueue.then(run, run);
	}

	//#endregion

	async importFile(): Promise<void> {
		let path: string | undefined;
		try {
			// Nothing is copied for a file the model cannot use (D67).
			path = await this.panel.host.importFile(candidate => this.acceptInput(candidate), this.panel.presentation?.inputKinds ?? ['image', 'video', 'audio', 'text']);
		} catch (error) {
			this.reportReferenceError(error);
			return;
		}
		if (path && !this.panel.disposed) {
			await this.connect(path);
		}
	}

	/**
	 * Whether the draft takes `path` as one more input; when it does not, the
	 * reason is shown, as for a connection on the canvas (D67).
	 */
	async acceptInput(path: string): Promise<boolean> {
		let reason: string | undefined;
		try {
			reason = await this.panel.cardActions.inputRefusal(this.panel.resource, { add: path });
		} catch (error) {
			this.panel.logService.warn('[BaseHalf] the panel could not ask whether the model takes an input', error);
		}
		if (reason && !this.panel.disposed) {
			this.panel.notificationService.notify({ severity: Severity.Warning, message: reason });
		}
		return !reason;
	}

	/** Connects an input; resolves with whether it was connected. */
	async connect(entry: string): Promise<boolean> {
		const node = this.panel.workspaceNode();
		if (!node || entry === node.relativePath) {
			return false;
		}
		const label = localize('basehalf.video.panel.connectUndo', "Connect Input");
		return this.runReferenceEdit(label, () => this.panel.referenceEditService.add(node, entry, { label }));
	}

	async disconnect(entry: string): Promise<void> {
		const node = this.panel.workspaceNode();
		if (!node) {
			return;
		}
		// The names of the prompt follow their inputs from what was typed last (D68).
		await this.panel.flush();
		const label = localize('basehalf.video.panel.disconnectUndo', "Remove Input");
		await this.runReferenceEdit(label, () => this.panel.referenceEditService.remove(node, entry, { label }));
	}

	/** Runs a connection edit as one step of the canvas undo stack, and says why one did not run. Resolves with whether it ran. */
	private async runReferenceEdit(label: string, operation: () => Promise<IBaseHalfReferenceEditResult>): Promise<boolean> {
		const node = this.panel.workspaceNode();
		if (!node) {
			return false;
		}
		try {
			this.pushUndo(await operation(), label, node);
			return true;
		} catch (error) {
			if (error instanceof BaseHalfReferenceEditFailure) {
				this.pushUndo(error.result, label, node);
			} else {
				this.reportReferenceError(error);
			}
			return false;
		} finally {
			this.panel.scheduleRefresh();
			this.panel.host.didChangeConnections?.();
		}
	}

	private pushUndo(result: IBaseHalfReferenceEditResult, label: string, node: IBaseHalfWorkspaceResource): void {
		const slash = node.relativePath.lastIndexOf('/');
		const parent = slash < 0 ? '' : node.relativePath.slice(0, slash);
		const canvas = this.panel.canvasMirrorService.canvasResource({
			resource: parent ? URI.joinPath(node.workspaceFolder, ...parent.split('/')) : node.workspaceFolder,
			workspaceFolder: node.workspaceFolder,
			relativePath: parent,
			source: 'api'
		});
		this.panel.referenceEditService.pushUndoElement(result, {
			label,
			resources: [canvas],
			source: BASEHALF_CANVAS_UNDO_REDO_SOURCE,
			onDidRun: () => {
				this.panel.scheduleRefresh();
				this.panel.host.didChangeConnections?.();
			}
		});
	}

	private reportReferenceError(error: unknown): void {
		if (error instanceof BaseHalfReferenceEditFailure) {
			// The edit service already said which files changed.
			return;
		}
		if (error instanceof BaseHalfReferenceEditRefusal) {
			this.panel.notificationService.prompt(Severity.Warning, error.message, []);
			return;
		}
		this.panel.logService.error(error instanceof Error ? error : String(error));
		this.panel.notificationService.error(baseHalfUserFacingErrorMessage(error));
	}
}
