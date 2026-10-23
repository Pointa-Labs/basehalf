/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { equals } from '../../../../base/common/objects.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { FileChangesEvent, FileOperationResult, IFileService, IFileStat, IFileStatWithPartialMetadata, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfReferenceEditService, IBaseHalfReferenceStoreResult } from '../../references/common/basehalfReferenceEdit.js';
import { baseHalfNormalizeUpstreamEntry, baseHalfUpstreamEntryProblem, baseHalfUpstreamIdentity, IBaseHalfUpstreamIdentity } from '../../references/common/basehalfReferenceEntries.js';
import { baseHalfUpstreamSidecarResource, readBaseHalfSidecarUpstream } from '../../references/common/basehalfReferenceStore.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfCommitMirrorFile } from '../../workspace/common/basehalfMirrorFileCommit.js';
import { baseHalfPreserveMirrorBytes } from '../../workspace/common/basehalfMirrorRecovery.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorPathSegments, baseHalfMirrorResource, baseHalfMirrorRoot } from '../../workspace/common/basehalfMirrorTree.js';
import { BaseHalfMirrorWriteRejected } from '../../workspace/common/basehalfMirrorYaml.js';
import { baseHalfIsDraft, baseHalfPathHoldsDraft, baseHalfReadDraftFacts } from '../common/basehalfGenerationDraft.js';
import {
	BASEHALF_GENERATION_FILE_MAX_BYTES,
	BASEHALF_GENERATION_INFO_FILE,
	BASEHALF_GENERATION_MADE_FILE,
	BaseHalfGenerationInfoError,
	BaseHalfGenerationKind,
	BaseHalfGenerationParamType,
	baseHalfGenerationInfoChangedFields,
	baseHalfGenerationKindOfPath,
	baseHalfGenerationMadeCopy,
	baseHalfGenerationNextFreeName,
	IBaseHalfGenerationInfo,
	IBaseHalfGenerationInfoRead,
	IBaseHalfGenerationMade,
	normalizeBaseHalfGenerationInfo,
	normalizeBaseHalfGenerationMade,
	parseBaseHalfGenerationInfo,
	parseBaseHalfGenerationMade,
	serializeBaseHalfGenerationMade,
	writeBaseHalfGenerationInfoFields
} from '../common/basehalfGenerationInfo.js';
import { baseHalfVideoInputKindOfPath, findBaseHalfVideoModel } from '../common/basehalfVideoCatalog.js';
import {
	IBaseHalfGenerationCardEntry,
	IBaseHalfGenerationCardSnapshot,
	IBaseHalfGenerationCardStore,
	IBaseHalfGenerationDraft,
	IBaseHalfVideoCatalogService,
	IBaseHalfVideoResolvedInput
} from '../common/basehalfVideoGeneration.js';

/** How often a write is planned again when the file changed under it. */
const MAX_WRITE_ATTEMPTS = 8;
/** An upstream list BaseHalf reads is at most this large, as the reference edit service reads it. */
const SIDECAR_MAX_BYTES = 64 * 1024;
const EMPTY_INFO: IBaseHalfGenerationInfo = Object.freeze({ prompt: '' });

/** A card located in its workspace folder. */
interface ICardLocation extends IBaseHalfWorkspaceResource {
	readonly kind: BaseHalfGenerationKind;
}

/** What a mirror file holds: its bytes, or why there are none. */
type MirrorBytes = { readonly kind: 'bytes'; readonly bytes: VSBuffer } | { readonly kind: 'absent' } | { readonly kind: 'tooLarge' };

/**
 * The generation information of cards (D63, generation cards, "Card
 * information"): `generation.yaml` and `made.yaml` under `.bh/mirror/<path>/`,
 * the drafts of a folder, and a card's inputs. Reading never fails because of
 * what a file holds. A change writes only the fields it changes, against the
 * bytes it read, and is planned again from new bytes when the file changed
 * underneath, so that a prompt typed in the panel and a model an agent wrote
 * meanwhile both stay. A file that is not YAML at all is kept as a recovery
 * copy before it is written over. `made.yaml`, a new draft, and its upstream
 * list are created only where nothing is. The store hears `.bh/mirror/`
 * through the workspace's own watcher, which watches it, and fires for the
 * card whose generation information changed, whoever wrote it.
 */
export class BaseHalfGenerationCardStore extends Disposable implements IBaseHalfGenerationCardStore {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<URI>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IBaseHalfReferenceEditService private readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfVideoCatalogService private readonly catalogService: IBaseHalfVideoCatalogService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(this.fileService.onDidFilesChange(event => this.onDidFilesChange(event)));
	}

	// --- reading ---------------------------------------------------------------------------------

	async isGenerationCard(resource: URI): Promise<boolean> {
		const card = this.locateQuietly(resource);
		if (!card) {
			return false;
		}
		const facts = await baseHalfReadDraftFacts(this.fileService, card.workspaceFolder, card.relativePath);
		if (!facts.itemExists) {
			// A draft, by the one rule; a draft whose folder is not on this computer is not shown.
			return baseHalfPathHoldsDraft(this.fileService, card.workspaceFolder, card.relativePath);
		}
		// A file is a generation card when BaseHalf made it: its record says so (D67).
		if (!facts.hasMade) {
			return false;
		}
		return !(await this.statQuietly(resource))?.isDirectory;
	}

	async read(resource: URI): Promise<IBaseHalfGenerationCardSnapshot> {
		const card = this.locate(resource);
		const [stat, info, made] = await Promise.all([
			this.statQuietly(resource),
			this.readMirror(card, BASEHALF_GENERATION_INFO_FILE),
			this.readMirror(card, BASEHALF_GENERATION_MADE_FILE)
		]);
		if (stat?.isDirectory || (info.kind === 'absent' && made.kind === 'absent')) {
			throw new Error(localize('basehalf.generation.store.notCard', "{0} is not an image or video card.", this.label(card)));
		}
		return this.snapshot(card, !!stat, this.readInfo(info), made);
	}

	async listDrafts(folder: URI): Promise<readonly IBaseHalfGenerationDraft[]> {
		const cards = await this.listCards(folder);
		return Object.freeze(cards.filter(card => !card.hasFile).map(({ resource, name, kind }) => Object.freeze({ resource, name, kind })));
	}

	async listCards(folder: URI): Promise<readonly IBaseHalfGenerationCardEntry[]> {
		const location = this.locateFolder(folder);
		if (!location) {
			return [];
		}
		const items = await this.childItems(folder);
		if (!items) {
			// A draft in a folder that does not exist on this computer is not shown.
			return [];
		}
		const cards: IBaseHalfGenerationCardEntry[] = [];
		for (const candidate of await this.generationDirectories(location)) {
			const item = items.get(this.nameKey(folder, candidate.name));
			if (item) {
				// The item's own spelling names its card; a folder is no generation card, and a file is one only with its record (D67).
				if (!item.isDirectory && candidate.holdsMade && baseHalfGenerationKindOfPath(item.name) === candidate.kind) {
					cards.push(Object.freeze({ resource: item.resource, name: item.name, kind: candidate.kind, hasFile: true }));
				}
				continue;
			}
			const path = location.relativePath ? `${location.relativePath}/${candidate.name}` : candidate.name;
			if (baseHalfIsDraft({ path, hasGenerationInfo: candidate.holdsInfo, hasMade: candidate.holdsMade, itemExists: false })) {
				cards.push(Object.freeze({ resource: URI.joinPath(folder, candidate.name), name: candidate.name, kind: candidate.kind, hasFile: false }));
			}
		}
		return Object.freeze(cards.sort((a, b) => a.name.localeCompare(b.name)));
	}

	async resolveInputs(snapshot: IBaseHalfGenerationCardSnapshot): Promise<readonly IBaseHalfVideoResolvedInput[]> {
		const card = this.locate(snapshot.resource);
		return Promise.all(snapshot.upstream.map(path => this.resolveInput(card.workspaceFolder, path)));
	}

	async nextFreeName(folder: URI, base: string, extension: string, startOrdinal = 1): Promise<string> {
		const taken = await this.takenNames(folder);
		const name = baseHalfGenerationNextFreeName(base, extension, candidate => taken.has(takenKey(candidate)), startOrdinal);
		if (!name) {
			throw new Error(localize('basehalf.generation.store.noFreeName', "Too many cards are named like {0}. Rename some of them and try again.", base));
		}
		return name;
	}

	// --- writing ---------------------------------------------------------------------------------

	async update(resource: URI, mutate: (info: IBaseHalfGenerationInfo) => IBaseHalfGenerationInfo): Promise<IBaseHalfGenerationCardSnapshot> {
		const card = this.locate(resource);
		const infoResource = baseHalfMirrorResource(card.workspaceFolder, card.relativePath, BASEHALF_GENERATION_INFO_FILE);
		for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
			const [stat, current, made] = await Promise.all([
				this.statQuietly(resource),
				this.readMirror(card, BASEHALF_GENERATION_INFO_FILE),
				this.readMirror(card, BASEHALF_GENERATION_MADE_FILE)
			]);
			if (stat?.isDirectory || (current.kind === 'absent' && made.kind === 'absent')) {
				throw new Error(localize('basehalf.generation.store.notCard', "{0} is not an image or video card.", this.label(card)));
			}
			if (current.kind === 'tooLarge') {
				throw new Error(localize('basehalf.generation.store.tooLarge', "BaseHalf cannot save the prompt and settings of {0}: what is saved for it is too large.", this.label(card)));
			}
			const read = this.readInfo(current);
			const next = normalizeBaseHalfGenerationInfo(mutate(read.info));
			if (baseHalfGenerationInfoChangedFields(read.info, next).length === 0) {
				return this.snapshot(card, !!stat, read, made);
			}
			const expected = current.kind === 'bytes' ? current.bytes : null;
			let text: string;
			try {
				// Bytes that are not YAML at all are replaced whole, after a copy is kept.
				text = writeBaseHalfGenerationInfoFields(read.readable && expected ? expected.toString() : undefined, read.readable ? read.info : EMPTY_INFO, next);
			} catch (error) {
				if (error instanceof BaseHalfGenerationInfoError) {
					this.logService.error(`[BaseHalf generation] ${error.message}`);
					throw new BaseHalfMirrorWriteRejected(infoResource, error.message);
				}
				throw error;
			}
			const bytes = VSBuffer.fromString(text);
			if (bytes.byteLength > BASEHALF_GENERATION_FILE_MAX_BYTES) {
				throw new Error(localize('basehalf.generation.store.tooLong', "The prompt and settings of {0} are longer than BaseHalf saves.", this.label(card)));
			}
			await this.assertNotMarked(card);
			let recoveryCopy: URI | undefined;
			if (!read.readable && expected) {
				recoveryCopy = await baseHalfPreserveMirrorBytes(this.fileService, card.workspaceFolder, infoResource, expected);
			}
			try {
				await this.commit(card, infoResource, bytes, expected);
			} catch (error) {
				if (isConcurrentChange(error)) {
					continue;
				}
				throw error;
			}
			if (recoveryCopy) {
				this.logService.warn(`[BaseHalf generation] replaced the generation.yaml of ${card.relativePath}, which was not YAML; its bytes are kept at ${recoveryCopy.toString()}`);
				// The copy is under the hidden `.bh/` folder, which the user never opens (D41).
				this.notificationService.info(localize('basehalf.generation.store.recovered', "BaseHalf could not read the saved prompt and settings of {0}, so it saved the new ones. A copy of the old ones is kept.", this.label(card)));
			}
			this._onDidChange.fire(resource);
			return this.snapshot(card, !!stat, { info: next, readable: true, ignored: [] }, made);
		}
		throw new Error(localize('basehalf.generation.store.busy', "The prompt and settings of {0} kept changing while BaseHalf saved them. Try again.", this.label(card)));
	}

	async reorderUpstream(resource: URI, upstream: readonly string[]): Promise<IBaseHalfGenerationCardSnapshot> {
		const card = this.locate(resource);
		const identity = this.identity(card.workspaceFolder);
		const sidecar = baseHalfUpstreamSidecarResource(card.workspaceFolder, card.relativePath);
		const text = await this.readText(card.workspaceFolder, sidecar);
		const read = readBaseHalfSidecarUpstream(text, { nodePath: card.relativePath, identity });
		const valid = read.items.filter(item => item.path !== undefined);
		const changed = () => new Error(localize('basehalf.generation.store.reorderChanged', "The inputs of {0} changed. Try again.", this.label(card)));
		if (!read.readable || upstream.length !== valid.length) {
			throw changed();
		}
		const byKey = new Map(valid.map(item => [identity.key(item.path!), item]));
		const reordered = [...read.items];
		upstream.forEach((entry, position) => {
			const key = identity.key(baseHalfNormalizeUpstreamEntry(entry));
			const item = byKey.get(key);
			if (!item) {
				throw changed();
			}
			byKey.delete(key);
			reordered[valid[position].index] = item;
		});
		const label = localize('basehalf.generation.store.reorderInputs', "Reorder Inputs");
		// Every item that is not a valid entry keeps its place; the valid ones take the places valid ones had.
		const result = await this.referenceEditService.apply([{
			node: card,
			operation: {
				kind: 'transition',
				from: { items: read.items.map(item => ({ text: item.text, scalar: item.scalar })) },
				to: { items: reordered.map(item => ({ text: item.text, scalar: item.scalar })) }
			}
		}], { label });
		this.referenceEditService.pushUndoElement(result, {
			label,
			resources: [this.canvasMirrorService.canvasResource({ ...this.parentOf(card), source: 'api' })],
			source: BASEHALF_CANVAS_UNDO_REDO_SOURCE,
			code: 'basehalf.generation.reorderInputs'
		});
		return this.read(resource);
	}

	async createDraft(folder: URI, name: string, info: IBaseHalfGenerationInfo, upstream?: readonly string[]): Promise<URI> {
		const location = this.locateFolder(folder);
		const kind = baseHalfGenerationKindOfPath(name);
		if (!location || !kind || name.includes('/') || name.includes('\\')) {
			throw new Error(localize('basehalf.generation.store.badDraftName', "{0} cannot be the name of an image or video card.", name));
		}
		const resource = URI.joinPath(folder, name);
		const card: ICardLocation = { resource, workspaceFolder: location.workspaceFolder, relativePath: location.relativePath ? `${location.relativePath}/${name}` : name, kind };
		await this.assertNotMarked(card);
		const taken = () => new Error(localize('basehalf.generation.store.taken', "{0} is already taken. Choose another name.", name));
		// A draft is made only where no item and no card information is.
		if (await this.fileService.exists(resource) || await this.holdsCardInformation(card)) {
			throw taken();
		}
		const text = writeBaseHalfGenerationInfoFields(undefined, EMPTY_INFO, info);
		const infoResource = baseHalfMirrorResource(card.workspaceFolder, card.relativePath, BASEHALF_GENERATION_INFO_FILE);
		// The upstream list first, so that the draft is never there without its connections.
		const connected = upstream?.length ? await this.connectNewDraft(card, upstream) : undefined;
		try {
			await this.commit(card, infoResource, VSBuffer.fromString(text), null);
		} catch (error) {
			if (connected) {
				await this.disconnectNewDraft(card, connected);
			}
			throw isConcurrentChange(error) ? taken() : error;
		}
		this._onDidChange.fire(resource);
		return resource;
	}

	async writeMade(resource: URI, made: IBaseHalfGenerationMade): Promise<void> {
		const card = this.locate(resource);
		const text = serializeBaseHalfGenerationMade(made);
		// The write check of the value grammar: the record reads back as it was written.
		if (!equals(parseBaseHalfGenerationMade(text), normalizeBaseHalfGenerationMade(made))) {
			throw new BaseHalfMirrorWriteRejected(resource, 'made.yaml does not read back as it was written');
		}
		const madeResource = baseHalfMirrorResource(card.workspaceFolder, card.relativePath, BASEHALF_GENERATION_MADE_FILE);
		try {
			await this.commit(card, madeResource, VSBuffer.fromString(text), null);
		} catch (error) {
			if (isConcurrentChange(error)) {
				throw new Error(localize('basehalf.generation.store.madeThere', "{0} already has the record of the generation that made it.", this.label(card)));
			}
			throw error;
		}
		this._onDidChange.fire(resource);
	}

	async writeCopy(source: URI, target: URI, newId: string): Promise<boolean> {
		const from = this.locate(source);
		const to = this.locateQuietly(target);
		if (!to || to.kind !== from.kind) {
			return false;
		}
		const [info, made, sourceStat, targetStat] = await Promise.all([
			this.readMirror(from, BASEHALF_GENERATION_INFO_FILE),
			this.readMirror(from, BASEHALF_GENERATION_MADE_FILE),
			this.statQuietly(source),
			this.statQuietly(target)
		]);
		const record = made.kind === 'bytes' ? parseBaseHalfGenerationMade(made.bytes.toString()) : undefined;
		if (info.kind === 'absent' && made.kind === 'absent') {
			return false;
		}
		if (targetStat?.isDirectory || sourceStat?.isDirectory) {
			return false;
		}
		if (!sourceStat) {
			// A copy of a draft is a draft where no item is, in a folder that exists;
			// a generated file that is gone is no draft and is not copied.
			if (made.kind !== 'absent' || info.kind !== 'bytes' || targetStat || !(await this.childItems(dirname(target)))) {
				return false;
			}
		} else if (!targetStat || !record) {
			// A file is a generation card only with a record that can be copied: one without it, or whose record cannot be read, is an ordinary file.
			return false;
		}
		if (!record && info.kind !== 'bytes') {
			return false;
		}
		await this.assertNotMarked(to);
		if (await this.holdsCardInformation(to)) {
			return false;
		}
		// The record of the copy first: a copied file is a generation card once either is there.
		if (record) {
			const copy = baseHalfGenerationMadeCopy(record, newId);
			await this.commit(to, baseHalfMirrorResource(to.workspaceFolder, to.relativePath, BASEHALF_GENERATION_MADE_FILE), VSBuffer.fromString(serializeBaseHalfGenerationMade(copy)), null);
		}
		// Only a draft has a generation.yaml: a copy of a generated file is its record alone.
		if (!sourceStat && info.kind === 'bytes') {
			await this.commit(to, baseHalfMirrorResource(to.workspaceFolder, to.relativePath, BASEHALF_GENERATION_INFO_FILE), info.bytes, null);
		}
		this._onDidChange.fire(target);
		return true;
	}

	async removeInfo(resource: URI): Promise<void> {
		const card = this.locate(resource);
		const infoResource = baseHalfMirrorResource(card.workspaceFolder, card.relativePath, BASEHALF_GENERATION_INFO_FILE);
		try {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, card.workspaceFolder, infoResource);
			await this.fileService.del(infoResource, { useTrash: false });
		} catch (error) {
			// Gone already, as after a landing that a crash cut short and that was finished again.
			if (toFileOperationResult(error as Error) !== FileOperationResult.FILE_NOT_FOUND) {
				throw error;
			}
			return;
		}
		this._onDidChange.fire(resource);
	}

	// --- events ----------------------------------------------------------------------------------

	/** Fires for every card whose `generation.yaml` or `made.yaml` changed, and for a card whose mirror directory was removed. */
	private onDidFilesChange(event: FileChangesEvent): void {
		const fired = new Set<string>();
		const consider = (resource: URI, deleted: boolean) => {
			const card = this.cardOfMirrorResource(resource, deleted);
			const key = card?.toString();
			if (card && key && !fired.has(key)) {
				fired.add(key);
				this._onDidChange.fire(card);
			}
		};
		for (const resource of event.rawAdded) {
			consider(resource, false);
		}
		for (const resource of event.rawUpdated) {
			consider(resource, false);
		}
		for (const resource of event.rawDeleted) {
			consider(resource, true);
		}
	}

	private cardOfMirrorResource(resource: URI, deleted: boolean): URI | undefined {
		const folder = this.workspaceContextService.getWorkspaceFolder(resource)?.uri;
		const relative = folder ? this.uriIdentityService.extUri.relativePath(baseHalfMirrorRoot(folder), resource) : undefined;
		if (!folder || !relative || relative.startsWith('../')) {
			return undefined;
		}
		const slash = relative.lastIndexOf('/');
		const name = relative.slice(slash + 1);
		const cardPath = name === BASEHALF_GENERATION_INFO_FILE || name === BASEHALF_GENERATION_MADE_FILE
			? (slash < 0 ? '' : relative.slice(0, slash))
			: deleted ? relative : '';
		return cardPath && baseHalfGenerationKindOfPath(cardPath) ? URI.joinPath(folder, ...cardPath.split('/')) : undefined;
	}

	// --- helpers ---------------------------------------------------------------------------------

	private snapshot(card: ICardLocation, hasFile: boolean, read: IBaseHalfGenerationInfoRead, madeBytes: MirrorBytes): Promise<IBaseHalfGenerationCardSnapshot> {
		const made = madeBytes.kind === 'bytes' ? parseBaseHalfGenerationMade(madeBytes.bytes.toString()) : undefined;
		return this.readUpstream(card).then(upstream => Object.freeze({
			resource: card.resource,
			path: card.relativePath,
			kind: card.kind,
			hasFile,
			info: read.info,
			infoReadable: read.readable,
			...(made ? { made } : {}),
			...(madeBytes.kind !== 'absent' && !made ? { madeUnreadable: true } : {}),
			upstream
		}));
	}

	/** Reads `generation.yaml` field by field, each value of `params` by the type its model declares when the catalog knows it. */
	private readInfo(bytes: MirrorBytes): IBaseHalfGenerationInfoRead {
		if (bytes.kind === 'absent') {
			return { info: EMPTY_INFO, readable: true, ignored: [] };
		}
		if (bytes.kind === 'tooLarge') {
			return { info: EMPTY_INFO, readable: false, ignored: [] };
		}
		const text = bytes.bytes.toString();
		const untyped = parseBaseHalfGenerationInfo(text);
		const catalog = this.catalogService.state;
		const ref = catalog.kind === 'ready' ? findBaseHalfVideoModel(catalog.catalog, untyped.info.provider, untyped.info.model) : undefined;
		if (!ref || !untyped.readable) {
			return untyped;
		}
		return parseBaseHalfGenerationInfo(text, (name): BaseHalfGenerationParamType | undefined => {
			const parameter = ref.model.parameters.find(candidate => candidate.name === name);
			switch (parameter?.kind) {
				case 'choice':
					return parameter.options.every(option => typeof option.value === 'number') ? 'number' : parameter.options.every(option => typeof option.value === 'string') ? 'string' : undefined;
				case 'integer':
				case 'number':
					return 'number';
				case 'boolean':
					return 'boolean';
				case 'text':
					return 'string';
				default:
					return undefined;
			}
		});
	}

	private async readUpstream(card: ICardLocation): Promise<readonly string[]> {
		try {
			const text = await this.readText(card.workspaceFolder, baseHalfUpstreamSidecarResource(card.workspaceFolder, card.relativePath));
			const read = readBaseHalfSidecarUpstream(text, { nodePath: card.relativePath, identity: this.identity(card.workspaceFolder) });
			return Object.freeze(read.items.flatMap(item => item.path !== undefined ? [item.path] : []));
		} catch (error) {
			this.logService.warn(`[BaseHalf generation] The inputs of ${card.relativePath} could not be read: ${getErrorMessage(error)}`);
			return Object.freeze([]);
		}
	}

	/**
	 * An entry stands for the file it names; one that names a draft, by the one
	 * rule of drafts, is of the draft's kind and has no file yet.
	 */
	private async resolveInput(workspaceFolder: URI, path: string): Promise<IBaseHalfVideoResolvedInput> {
		const resource = URI.joinPath(workspaceFolder, ...path.split('/'));
		const stat = await this.statQuietly(resource);
		if (stat?.isDirectory) {
			return Object.freeze({ path, kind: 'other', available: true });
		}
		if (stat) {
			return Object.freeze({ path, kind: baseHalfVideoInputKindOfPath(path), available: true, file: resource });
		}
		const kind = baseHalfGenerationKindOfPath(path);
		if (kind && await baseHalfPathHoldsDraft(this.fileService, workspaceFolder, path).catch(() => false)) {
			return Object.freeze({ path, kind, available: false, draft: true });
		}
		return Object.freeze({ path, kind: baseHalfVideoInputKindOfPath(path), available: false });
	}

	/**
	 * Writes the upstream list of a draft that is being made through the
	 * reference edit service, before its `generation.yaml` (reference graph,
	 * "Creating connected nodes"), so that the connections show with the
	 * draft. Resolves with what was written, for taking it back.
	 */
	private async connectNewDraft(card: ICardLocation, upstream: readonly string[]): Promise<IBaseHalfReferenceStoreResult | undefined> {
		const identity = this.identity(card.workspaceFolder);
		const entries: string[] = [];
		const seen = new Set<string>();
		for (const entry of upstream) {
			if (baseHalfUpstreamEntryProblem(entry, card.relativePath, identity)) {
				throw new Error(localize('basehalf.generation.store.badEntry', "'{0}' can't be listed as an input of {1}.", entry, this.label(card)));
			}
			const normalized = baseHalfNormalizeUpstreamEntry(entry);
			if (!seen.has(identity.key(normalized))) {
				seen.add(identity.key(normalized));
				entries.push(normalized);
			}
		}
		const result = await this.referenceEditService.apply([{ node: card, operation: { kind: 'append', entries } }], { label: connectLabel(), newDraft: true });
		return result.stores.find(store => store.outcome === 'changed');
	}

	/** Takes back the upstream list of a draft whose `generation.yaml` could not be made, when nothing changed it since. */
	private async disconnectNewDraft(card: ICardLocation, connected: IBaseHalfReferenceStoreResult): Promise<void> {
		try {
			await this.referenceEditService.apply([{ node: card, operation: { kind: 'transition', from: connected.next, to: connected.expected } }], { label: connectLabel(), newDraft: true, restoring: true });
		} catch (error) {
			this.logService.warn(`[BaseHalf generation] The upstream list of ${card.relativePath} could not be taken back: ${getErrorMessage(error)}`);
		}
	}

	/** Whether any card information is at the card's path: a file in its directory under `.bh/mirror/`. */
	private async holdsCardInformation(card: ICardLocation): Promise<boolean> {
		const directory = URI.joinPath(baseHalfMirrorRoot(card.workspaceFolder), ...baseHalfMirrorPathSegments(card.relativePath));
		try {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, card.workspaceFolder, directory);
			const stat = await this.fileService.resolve(directory);
			return !!stat.isDirectory && (stat.children ?? []).some(child => !child.isDirectory);
		} catch (error) {
			if (error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
				return false;
			}
			throw error;
		}
	}

	/** Writes a mirror file against the bytes that were read, or creates it where none is (`null`), under the symbolic-link guard. */
	private async commit(card: IBaseHalfWorkspaceResource, resource: URI, bytes: VSBuffer, expected: VSBuffer | null): Promise<void> {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, card.workspaceFolder, resource);
		await baseHalfCommitMirrorFile(this.fileService, resource, bytes, expected);
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, card.workspaceFolder, resource);
	}

	private async readMirror(card: IBaseHalfWorkspaceResource, fileName: string): Promise<MirrorBytes> {
		const resource = baseHalfMirrorResource(card.workspaceFolder, card.relativePath, fileName);
		try {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, card.workspaceFolder, resource);
			return { kind: 'bytes', bytes: (await this.fileService.readFile(resource, { atomic: true, limits: { size: BASEHALF_GENERATION_FILE_MAX_BYTES } })).value };
		} catch (error) {
			const result = error instanceof Error ? toFileOperationResult(error) : undefined;
			if (result === FileOperationResult.FILE_NOT_FOUND || result === FileOperationResult.FILE_IS_DIRECTORY) {
				return { kind: 'absent' };
			}
			if (result === FileOperationResult.FILE_TOO_LARGE) {
				return { kind: 'tooLarge' };
			}
			throw error;
		}
	}

	private async readText(workspaceFolder: URI, resource: URI): Promise<string | undefined> {
		try {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
			return (await this.fileService.readFile(resource, { limits: { size: SIDECAR_MAX_BYTES } })).value.toString();
		} catch (error) {
			if (error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
				return undefined;
			}
			throw error;
		}
	}

	/**
	 * The names that are taken in a folder: every file and folder in it, and
	 * every name that any card information is kept under in `.bh/mirror/` (a
	 * draft's, a missing file's, and what an item that is gone left), as a
	 * draft that moves aside counts them. Names that differ only in letter
	 * case count as the same name, so that a name stays free on every
	 * computer the workspace is on.
	 */
	private async takenNames(folder: URI): Promise<ReadonlySet<string>> {
		const taken = new Set<string>();
		const location = this.locateFolder(folder);
		const directories = [folder, ...(location ? [URI.joinPath(baseHalfMirrorRoot(location.workspaceFolder), ...baseHalfMirrorPathSegments(location.relativePath))] : [])];
		for (const directory of directories) {
			const stat = await this.fileService.resolve(directory).catch(() => undefined);
			for (const child of stat?.isDirectory ? stat.children ?? [] : []) {
				taken.add(takenKey(child.name));
			}
		}
		return taken;
	}

	/** The items of a folder by the comparison keys of their names, or `undefined` when it is not there. */
	private async childItems(folder: URI): Promise<Map<string, IFileStat> | undefined> {
		const stat = await this.fileService.resolve(folder).catch(() => undefined);
		if (!stat?.isDirectory) {
			return undefined;
		}
		return new Map((stat.children ?? []).map(child => [this.nameKey(folder, child.name), child]));
	}

	/** The mirror directories of a folder whose names have a generation extension, with what they hold. */
	private async generationDirectories(folder: IBaseHalfWorkspaceResource): Promise<readonly { readonly name: string; readonly kind: BaseHalfGenerationKind; readonly holdsInfo: boolean; readonly holdsMade: boolean }[]> {
		const mirror = folder.relativePath ? URI.joinPath(baseHalfMirrorRoot(folder.workspaceFolder), ...folder.relativePath.split('/')) : baseHalfMirrorRoot(folder.workspaceFolder);
		let children: readonly IFileStat[];
		try {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, folder.workspaceFolder, mirror);
			children = (await this.fileService.resolve(mirror)).children ?? [];
		} catch {
			return [];
		}
		const candidates = children.filter(child => child.isDirectory && !child.isSymbolicLink && baseHalfGenerationKindOfPath(child.name));
		return Promise.all(candidates.map(async child => {
			const names = await this.fileService.resolve(child.resource).then(stat => new Set((stat.children ?? []).filter(entry => entry.isFile).map(entry => entry.name)), () => new Set<string>());
			return { name: child.name, kind: baseHalfGenerationKindOfPath(child.name)!, holdsInfo: names.has(BASEHALF_GENERATION_INFO_FILE), holdsMade: names.has(BASEHALF_GENERATION_MADE_FILE) };
		}));
	}

	private async assertNotMarked(card: IBaseHalfWorkspaceResource): Promise<void> {
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, card.workspaceFolder)) {
			throw new Error(localize('basehalf.generation.store.marked', "{0} is in a folder BaseHalf is set to leave alone.", this.label(card)));
		}
	}

	private async statQuietly(resource: URI): Promise<IFileStatWithPartialMetadata | undefined> {
		try {
			return await this.fileService.stat(resource);
		} catch {
			return undefined;
		}
	}

	private locate(resource: URI): ICardLocation {
		const card = this.locateQuietly(resource);
		if (!card) {
			throw new Error(localize('basehalf.generation.store.notCardHere', "{0} is not an image or video card in the open folder.", this.uriIdentityService.extUri.basename(resource)));
		}
		return card;
	}

	private locateQuietly(resource: URI): ICardLocation | undefined {
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(resource)?.uri;
		const relativePath = workspaceFolder ? this.uriIdentityService.extUri.relativePath(workspaceFolder, resource) : undefined;
		const kind = relativePath ? baseHalfGenerationKindOfPath(relativePath) : undefined;
		// BaseHalf's own folder holds no cards.
		const own = relativePath === '.bh' || !!relativePath?.startsWith('.bh/');
		return workspaceFolder && relativePath && kind && !own ? { resource, workspaceFolder, relativePath, kind } : undefined;
	}

	private locateFolder(folder: URI): IBaseHalfWorkspaceResource | undefined {
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(folder)?.uri;
		const relativePath = workspaceFolder ? this.uriIdentityService.extUri.relativePath(workspaceFolder, folder) : undefined;
		return workspaceFolder && relativePath !== undefined && !relativePath.startsWith('../') && relativePath !== '..' ? { resource: folder, workspaceFolder, relativePath } : undefined;
	}

	private parentOf(card: IBaseHalfWorkspaceResource): IBaseHalfWorkspaceResource {
		const slash = card.relativePath.lastIndexOf('/');
		const relativePath = slash < 0 ? '' : card.relativePath.slice(0, slash);
		return { resource: relativePath ? URI.joinPath(card.workspaceFolder, ...relativePath.split('/')) : card.workspaceFolder, workspaceFolder: card.workspaceFolder, relativePath };
	}

	private nameKey(folder: URI, name: string): string {
		return this.uriIdentityService.extUri.getComparisonKey(URI.joinPath(folder, name.normalize('NFC')));
	}

	private identity(workspaceFolder: URI): IBaseHalfUpstreamIdentity {
		return baseHalfUpstreamIdentity(workspaceFolder, this.uriIdentityService.extUri);
	}

	private label(card: IBaseHalfWorkspaceResource): string {
		return card.relativePath.slice(card.relativePath.lastIndexOf('/') + 1) || card.relativePath;
	}
}

/** A name as the names that are taken are compared: in one Unicode form, and in lower case. */
function takenKey(name: string): string {
	return name.normalize('NFC').toLowerCase();
}

/** The label of the reference edit that writes a new draft's connections. */
function connectLabel(): string {
	return localize('basehalf.generation.store.connect', "Connect");
}

function isConcurrentChange(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const result = toFileOperationResult(error);
	return result === FileOperationResult.FILE_MODIFIED_SINCE || result === FileOperationResult.FILE_MOVE_CONFLICT || result === FileOperationResult.FILE_NOT_FOUND;
}

registerSingleton(IBaseHalfGenerationCardStore, BaseHalfGenerationCardStore, InstantiationType.Delayed);
