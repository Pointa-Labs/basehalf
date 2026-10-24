/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import {
	BaseHalfGenerationKind,
	baseHalfGenerationDefaultBaseName,
	baseHalfGenerationDraftExtension,
	baseHalfGenerationNameOrdinal,
	baseHalfGenerationNameParts,
	IBaseHalfGenerationInfo,
	setBaseHalfGenerationChoice
} from '../common/basehalfGenerationInfo.js';
import {
	baseHalfVideoChoiceRatio,
	baseHalfVideoInitialGeneration,
	baseHalfVideoAddedInputRefusal,
	findBaseHalfVideoModel,
	IBaseHalfVideoCatalog
} from '../common/basehalfVideoCatalog.js';
import {
	baseHalfGenerationGeneratingInputsRefusal,
	baseHalfGenerationMadeInputsRefusal,
	IBaseHalfDraftOperations,
	IBaseHalfDraftSnapshot,
	IBaseHalfGenerationCardActions,
	IBaseHalfGenerationCardStore,
	IBaseHalfGenerationInputChange,
	IBaseHalfVideoCatalogService,
	IBaseHalfVideoGenerationService,
	IBaseHalfVideoProviderSettingsService
} from '../common/basehalfVideoGeneration.js';
import { BaseHalfDraftUndoChange, BaseHalfDraftUndoElement, IBaseHalfDraftUndoServices } from './basehalfDraftUndo.js';
import { createBaseHalfNewVersion } from './basehalfGenerationNewVersion.js';
import { baseHalfParentCanvasFolder } from './basehalfGenerationPlacement.js';

/** How long a new draft waits for a catalog that is still on its way, to know its model's format. */
const CATALOG_WAIT_MS = 2000;
/** How often a new name is chosen when another one took the name meanwhile. */
const NAME_ATTEMPTS = 3;

/**
 * What the user does with generation cards (generation cards, "Creating a
 * generation card", "Moving, renaming, copying, and undo", "Deleting", and
 * "The toolbar"), on the card store and the draft operations. Making,
 * renaming, moving, deleting, and copying a draft are each one step of the
 * canvas undo stack ({@link BaseHalfDraftUndoElement}).
 */
export class BaseHalfGenerationCardActions implements IBaseHalfGenerationCardActions {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IBaseHalfGenerationCardStore private readonly cardStore: IBaseHalfGenerationCardStore,
		@IBaseHalfDraftOperations private readonly draftOperations: IBaseHalfDraftOperations,
		@IBaseHalfVideoGenerationService private readonly generationService: IBaseHalfVideoGenerationService,
		@IBaseHalfVideoCatalogService private readonly catalogService: IBaseHalfVideoCatalogService,
		@IBaseHalfVideoProviderSettingsService private readonly providerSettings: IBaseHalfVideoProviderSettingsService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILogService private readonly logService: ILogService
	) { }

	async createDraft(folder: URI, kind: BaseHalfGenerationKind, upstream?: readonly string[]): Promise<URI> {
		const { info, extension } = await this.newDraftStart(kind);
		const base = baseHalfGenerationDefaultBaseName(kind);
		let draft: URI | undefined;
		for (let attempt = 1; !draft; attempt++) {
			const name = await this.cardStore.nextFreeName(folder, base, extension);
			try {
				draft = await this.cardStore.createDraft(folder, name, info, upstream);
			} catch (error) {
				// Another one took the name meanwhile: the next free one.
				if (attempt >= NAME_ATTEMPTS || await this.cardStore.nextFreeName(folder, base, extension) === name) {
					throw error;
				}
			}
		}
		await this.pushUndo(newDraftLabel(kind), 'basehalf.generation.newDraft', [draft], { kind: 'made', drafts: [draft] });
		return draft;
	}

	async moveDraft(draft: URI, target: URI): Promise<URI> {
		const moved = await this.draftOperations.move(draft, target);
		const label = this.uriIdentityService.extUri.isEqual(dirname(draft), dirname(target))
			? localize('basehalf.generation.actions.rename', "Rename {0} to {1}", basename(draft), basename(target))
			: localize('basehalf.generation.actions.move', "Move {0}", basename(draft));
		await this.pushUndo(label, 'basehalf.generation.moveDraft', [draft, target], { kind: 'moved', from: draft, to: target });
		return moved;
	}

	async deleteDrafts(drafts: readonly URI[]): Promise<void> {
		const snapshots: IBaseHalfDraftSnapshot[] = [];
		try {
			for (const draft of drafts) {
				// A generation that lands on it is stopped, or lands no file on it (generation cards, "Deleting").
				await this.generationService.releaseCard(draft);
				snapshots.push(await this.draftOperations.delete(draft));
			}
		} finally {
			if (snapshots.length) {
				// What was deleted comes back with undo, also when a later draft could not be deleted.
				await this.pushUndo(snapshots.length === 1
					? localize('basehalf.generation.actions.deleteOne', "Delete {0}", basename(snapshots[0].resource))
					: localize('basehalf.generation.actions.deleteMany', "Delete {0} items", snapshots.length), 'basehalf.generation.deleteDrafts', snapshots.map(snapshot => snapshot.resource), { kind: 'deleted', snapshots });
			}
		}
	}

	async copyDraft(draft: URI, folder: URI, undoLabel: string): Promise<URI> {
		const snapshot = await this.cardStore.read(draft);
		if (snapshot.hasFile || snapshot.made) {
			throw new Error(localize('basehalf.generation.actions.notDraft', "{0} is not a draft any more.", basename(draft)));
		}
		// Its own name where that is free, and the next free number after its own otherwise.
		const { base, extension } = baseHalfGenerationNameParts(basename(draft));
		for (let attempt = 1; ; attempt++) {
			const name = await this.cardStore.nextFreeName(folder, base, extension, baseHalfGenerationNameOrdinal(basename(draft)));
			const copy = joinPath(folder, name);
			// A draft has no record: the id of a copy's record is not used.
			if (await this.cardStore.writeCopy(draft, copy, '')) {
				await this.pushUndo(undoLabel, 'basehalf.generation.copyDraft', [copy], { kind: 'made', drafts: [copy] });
				return copy;
			}
			if (attempt >= NAME_ATTEMPTS) {
				throw new Error(localize('basehalf.generation.actions.copyFailed', "BaseHalf could not copy {0} there.", basename(draft)));
			}
		}
	}

	async newVersion(card: URI): Promise<URI> {
		const snapshot = await this.cardStore.read(card);
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(card)?.uri;
		if (!workspaceFolder) {
			throw new Error(localize('basehalf.generation.actions.outsideWorkspace', "{0} is not in an open folder.", basename(card)));
		}
		const draft = await createBaseHalfNewVersion({
			cardStore: this.cardStore,
			fileService: this.fileService,
			canvasMirrorService: this.canvasMirrorService,
			logService: this.logService
		}, snapshot, workspaceFolder, await this.catalog());
		await this.pushUndo(localize('basehalf.generation.actions.newVersion', "New Version"), 'basehalf.generation.newVersion', [draft], { kind: 'made', drafts: [draft] });
		return draft;
	}

	async inputRefusal(card: URI, change: IBaseHalfGenerationInputChange): Promise<string | undefined> {
		if (!await this.cardStore.isGenerationCard(card)) {
			return undefined;
		}
		const snapshot = await this.cardStore.read(card);
		if (snapshot.hasFile || snapshot.made || snapshot.madeUnreadable) {
			return baseHalfGenerationMadeInputsRefusal(basename(card));
		}
		if (this.generationService.isGenerating(card)) {
			return baseHalfGenerationGeneratingInputsRefusal(basename(card));
		}
		const added = change.add;
		if (added === undefined) {
			// Fewer inputs are always sent: disconnecting leaves no input that cannot be.
			return undefined;
		}
		const catalog = this.catalogService.state.kind === 'ready' ? this.catalogService.state.catalog : undefined;
		const model = findBaseHalfVideoModel(catalog, snapshot.info.provider, snapshot.info.model)?.model;
		return baseHalfVideoAddedInputRefusal(model, snapshot.upstream, added, change.remove);
	}

	/** The catalog, waiting a moment while it loads. */
	private async catalog(): Promise<IBaseHalfVideoCatalog | undefined> {
		const state = this.catalogService.state;
		return state.kind === 'ready'
			? state.catalog
			: state.kind === 'loading' ? await this.catalogService.whenReady(CATALOG_WAIT_MS).catch(() => undefined) : undefined;
	}

	newDraftRatio(kind: BaseHalfGenerationKind): number | undefined {
		const state = this.catalogService.state;
		// A sound has no picture: its card has the size of a file card.
		if (state.kind !== 'ready' || kind === 'audio') {
			return undefined;
		}
		const choice = baseHalfVideoInitialGeneration(this.providerSettings.getLastUsed(kind), state.catalog, kind, provider => this.providerSettings.getStatus(provider).region.id);
		return choice ? baseHalfVideoChoiceRatio(state.catalog, choice) : undefined;
	}

	/**
	 * What a new draft of a kind starts with: an empty prompt and the last
	 * values of that kind made legal for the catalog, and the extension of its
	 * model's output (`png` for an image and `mp3` for a sound without a model).
	 */
	private async newDraftStart(kind: BaseHalfGenerationKind): Promise<{ readonly info: IBaseHalfGenerationInfo; readonly extension: string }> {
		const state = this.catalogService.state;
		const catalog: IBaseHalfVideoCatalog | undefined = state.kind === 'ready'
			? state.catalog
			: state.kind === 'loading' ? await this.catalogService.whenReady(CATALOG_WAIT_MS).catch(() => undefined) : undefined;
		const choice = baseHalfVideoInitialGeneration(this.providerSettings.getLastUsed(kind), catalog, kind, provider => this.providerSettings.getStatus(provider).region.id);
		const ref = choice ? findBaseHalfVideoModel(catalog, choice.provider, choice.model) : undefined;
		let info: IBaseHalfGenerationInfo = { prompt: '' };
		if (choice) {
			try {
				info = setBaseHalfGenerationChoice(info, choice);
			} catch (error) {
				// Values stored by an earlier build that are no longer legal leave the card without a model.
				this.logService.warn('[BaseHalf generation] The last values used could not start a new card', error);
			}
		}
		return { info, extension: baseHalfGenerationDraftExtension(kind, ref?.model) };
	}

	private async pushUndo(label: string, code: string, cards: readonly URI[], change: BaseHalfDraftUndoChange): Promise<void> {
		const canvases = new Map<string, URI>();
		for (const card of cards) {
			const canvas = this.canvasOf(card);
			if (canvas) {
				canvases.set(canvas.toString(), canvas);
			}
		}
		await BaseHalfDraftUndoElement.push(label, code, [...canvases.values(), ...cards], change, this.undoServices());
	}

	/** The layout of the canvas the card is on, the resource its undo step goes with. */
	private canvasOf(card: URI): URI | undefined {
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(card)?.uri;
		const relativePath = workspaceFolder ? this.uriIdentityService.extUri.relativePath(workspaceFolder, card) : undefined;
		return workspaceFolder && relativePath ? this.canvasMirrorService.canvasResource(baseHalfParentCanvasFolder({ resource: card, workspaceFolder, relativePath })) : undefined;
	}

	private undoServices(): IBaseHalfDraftUndoServices {
		return {
			draftOperations: this.draftOperations,
			undoRedoService: this.undoRedoService,
			notificationService: this.notificationService,
			isGenerating: card => this.generationService.isGenerating(card),
			read: card => this.cardStore.read(card)
		};
	}
}

/** The name of the step of undo that makes a new draft of a kind: New Image, New Video, or New Audio. */
function newDraftLabel(kind: BaseHalfGenerationKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.generation.actions.newImage', "New Image");
		case 'video': return localize('basehalf.generation.actions.newVideo', "New Video");
		case 'audio': return localize('basehalf.generation.actions.newAudio', "New Audio");
	}
}

registerSingleton(IBaseHalfGenerationCardActions, BaseHalfGenerationCardActions, InstantiationType.Delayed);
