/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Limiter } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { getCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IFileQuery, ISearchService, QueryType } from '../../../services/search/common/search.js';
import { IBaseHalfCanvasNavigationService } from '../../navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfProjectFileTransitionService } from '../../workspace/common/basehalfProjectFileTransitions.js';
import { inspectBaseHalfGenerationCard, isBaseHalfOrdinaryFileInside } from '../../video/common/basehalfGenerationCardInspection.js';
import { IBaseHalfGenerationCardStore } from '../../video/common/basehalfVideoGeneration.js';
import {
	addBaseHalfSequenceItem,
	BASEHALF_SEQUENCE_FILE_NAME,
	BASEHALF_SEQUENCE_INSPECTION_CONCURRENCY,
	BaseHalfSequenceRelocation,
	baseHalfSequenceVideoPathOf,
	IBaseHalfSequenceDocument,
	IBaseHalfSequenceInspection,
	IBaseHalfSequenceItem,
	IBaseHalfSequenceItemInspection,
	IBaseHalfSequenceVideoState,
	inspectBaseHalfSequence,
	isBaseHalfPlainLocalFile,
	isBaseHalfSequenceVideoPath,
	moveBaseHalfSequenceItem,
	parseBaseHalfSequenceDocument,
	removeBaseHalfSequenceItem,
	resolveBaseHalfSequenceVideo,
	resolveBaseHalfSequenceVideoCard,
	serializeBaseHalfSequenceDocument,
	updateBaseHalfSequenceItemPath
} from '../common/basehalfSequence.js';

/** How many videos below the folder of a Sequence the search for a moved clip looks at. */
const MAX_RELOCATION_SCAN_RESULTS = 256;
const MAX_SEQUENCE_DOCUMENT_BYTES = 4 * 1024 * 1024;
/** How many Sequence files the search for one looks at. */
const MAX_SEQUENCE_SEARCH_RESULTS = 100;
/** How many videos Add Video Result to Sequence offers. */
const MAX_ADD_CANDIDATES = 1_000;

export interface IBaseHalfSequenceEditResult {
	readonly operation: 'added' | 'removed';
	readonly resource: URI;
	readonly item: IBaseHalfSequenceItem;
	readonly document: IBaseHalfSequenceDocument;
	readonly inspection: IBaseHalfSequenceInspection;
}

export interface IBaseHalfLoadedSequence {
	readonly resource: URI;
	readonly source: string;
	readonly sequence: IBaseHalfSequenceDocument;
}

export const IBaseHalfSequenceService = createDecorator<IBaseHalfSequenceService>('baseHalfSequenceService');

/**
 * The Sequence operations (Video Sequence, "Sequence operations"). Each takes
 * the argument of its command: none from the Command Palette, which asks for
 * what it needs, or the structured arguments an agent's operation or the
 * Sequence view passes, with every resource as a URI. A cancelled token
 * stops an inspection and every change before it is written.
 */
export interface IBaseHalfSequenceService {
	readonly _serviceBrand: undefined;
	inspect(argument?: unknown, token?: CancellationToken): Promise<IBaseHalfSequenceInspection | undefined>;
	add(argument?: unknown, token?: CancellationToken): Promise<IBaseHalfSequenceEditResult | undefined>;
	move(argument?: unknown, token?: CancellationToken): Promise<IBaseHalfSequenceDocument | undefined>;
	remove(argument?: unknown, token?: CancellationToken): Promise<IBaseHalfSequenceEditResult | undefined>;
	repair(argument?: unknown, token?: CancellationToken): Promise<IBaseHalfSequenceInspection | undefined>;
	/** Add Video Result to Sequence from the Sequence view: it asks for the video and the title. */
	addFromView(sequence: URI): Promise<IBaseHalfSequenceEditResult | undefined>;
	load(sequence: URI): Promise<IBaseHalfLoadedSequence>;
	inspectLoaded(loaded: IBaseHalfLoadedSequence, token?: CancellationToken): Promise<IBaseHalfSequenceInspection>;
}

interface ISequenceArguments {
	readonly sequence?: URI;
	readonly itemId?: string;
	readonly direction?: 'up' | 'down';
	readonly video?: URI;
	readonly title?: string;
}

interface IVideoCandidate {
	readonly resource: URI;
	readonly videoPath: string;
	readonly generationId?: string;
	readonly suggestedTitle: string;
}

interface IGenerationIndex {
	readonly truncated: boolean;
	readonly byGeneration: ReadonlyMap<string, readonly URI[]>;
}

export class BaseHalfSequenceService extends Disposable implements IBaseHalfSequenceService {
	declare readonly _serviceBrand: undefined;

	/** One ceiling for every inspection of every Sequence. */
	private readonly inspectionLimiter = this._register(new Limiter<IBaseHalfSequenceVideoState>(BASEHALF_SEQUENCE_INSPECTION_CONCURRENCY));

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IBaseHalfGenerationCardStore private readonly generationCardStore: IBaseHalfGenerationCardStore,
		@IBaseHalfProjectFileTransitionService private readonly projectFileTransitionService: IBaseHalfProjectFileTransitionService,
		@ISearchService private readonly searchService: ISearchService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService,
		@IBaseHalfCanvasNavigationService private readonly navigationService: IBaseHalfCanvasNavigationService,
		@ILabelService private readonly labelService: ILabelService
	) {
		super();
	}

	async inspect(argument?: unknown, token?: CancellationToken): Promise<IBaseHalfSequenceInspection | undefined> {
		throwIfCancelled(token);
		const args = sequenceArguments(argument);
		requireStructuredArguments(argument, args, ['sequence']);
		const resource = await this.resolveSequence(args.sequence);
		if (!resource) {
			return undefined;
		}
		const inspection = await this.inspectLoaded(await this.load(resource), token);
		if (argument === undefined) {
			const selected = await this.showInspection(inspection);
			if (selected?.repairCandidatePath) {
				const title = selected.item.title;
				this.notificationService.prompt(Severity.Info, localize('basehalf.sequence.moved', "'{0}' moved to '{1}'.", title, selected.repairCandidatePath), [{
					label: localize('basehalf.sequence.repairPath', "Repair Path"),
					run: () => this.repair({ sequence: resource, itemId: selected.item.id }).then(repaired => {
						if (repaired) {
							this.notificationService.info(localize('basehalf.sequence.repaired', "Repaired the saved path for '{0}'.", title));
						}
					}, error => this.notificationService.error(error))
				}]);
			}
		}
		return inspection;
	}

	async add(argument?: unknown, token?: CancellationToken): Promise<IBaseHalfSequenceEditResult | undefined> {
		throwIfCancelled(token);
		const args = sequenceArguments(argument);
		requireStructuredArguments(argument, args, ['sequence', 'video', 'itemId']);
		return this.addVideo(args, argument === undefined, token);
	}

	addFromView(sequence: URI): Promise<IBaseHalfSequenceEditResult | undefined> {
		return this.addVideo({ sequence }, true);
	}

	private async addVideo(args: ISequenceArguments, interactive: boolean, token?: CancellationToken): Promise<IBaseHalfSequenceEditResult | undefined> {
		const resource = await this.resolveSequence(args.sequence);
		if (!resource) {
			return undefined;
		}
		const workflowRoot = dirname(resource);
		const selected = args.video
			? await this.loadVideoCandidate(workflowRoot, args.video)
			: await this.pickVideoCandidate(workflowRoot);
		if (!selected) {
			return undefined;
		}
		const title = args.title ?? (interactive ? await this.promptForTitle(selected.suggestedTitle) : selected.suggestedTitle);
		if (title === undefined) {
			return undefined;
		}

		const loaded = await this.load(resource);
		const candidate = await this.loadVideoCandidate(workflowRoot, selected.resource);
		const item: IBaseHalfSequenceItem = Object.freeze({
			id: args.itemId ?? uniqueItemId(loaded.sequence),
			title,
			videoPath: candidate.videoPath,
			...(candidate.generationId === undefined ? {} : { generationId: candidate.generationId })
		});
		const saved = await this.save(loaded, addBaseHalfSequenceItem(loaded.sequence, item), token);
		const inspection = await this.inspectLoaded(saved);
		const addedItem = saved.sequence.items.find(candidate => candidate.id === item.id);
		if (!addedItem) {
			throw new Error(`Sequence item '${item.id}' was not saved.`);
		}
		if (interactive) {
			this.notificationService.info(localize('basehalf.sequence.added', "Added '{0}' to the Video Sequence.", addedItem.title));
		}
		return Object.freeze({ operation: 'added', resource, item: addedItem, document: saved.sequence, inspection });
	}

	async move(argument?: unknown, token?: CancellationToken): Promise<IBaseHalfSequenceDocument | undefined> {
		throwIfCancelled(token);
		const args = sequenceArguments(argument);
		requireStructuredArguments(argument, args, ['sequence', 'itemId', 'direction']);
		const resource = await this.resolveSequence(args.sequence);
		if (!resource) {
			return undefined;
		}
		const loaded = await this.load(resource);
		if (loaded.sequence.items.length < 2) {
			if (argument === undefined) {
				this.notificationService.info(localize('basehalf.sequence.moveNeedsTwo', "Add at least two clips before changing playback order."));
			}
			return loaded.sequence;
		}
		const itemId = args.itemId ?? await this.pickItem(loaded.sequence, localize('basehalf.sequence.pickMove', "Choose a clip to move"));
		if (!itemId) {
			return undefined;
		}
		const index = loaded.sequence.items.findIndex(item => item.id === itemId);
		if (index < 0) {
			throw new Error(`Sequence item '${itemId}' does not exist.`);
		}
		const direction = args.direction ?? await this.pickDirection(index, loaded.sequence.items.length);
		if (!direction) {
			return undefined;
		}
		if ((direction === 'up' && index === 0) || (direction === 'down' && index === loaded.sequence.items.length - 1)) {
			return loaded.sequence;
		}
		return (await this.save(loaded, moveBaseHalfSequenceItem(loaded.sequence, itemId, direction), token)).sequence;
	}

	async remove(argument?: unknown, token?: CancellationToken): Promise<IBaseHalfSequenceEditResult | undefined> {
		throwIfCancelled(token);
		const args = sequenceArguments(argument);
		requireStructuredArguments(argument, args, ['sequence', 'itemId']);
		const resource = await this.resolveSequence(args.sequence);
		if (!resource) {
			return undefined;
		}
		const initial = await this.load(resource);
		if (initial.sequence.items.length === 0) {
			if (argument === undefined) {
				this.notificationService.info(localize('basehalf.sequence.nothingToRemove', "Sequence has no clips to remove."));
			}
			return undefined;
		}
		const itemId = args.itemId ?? await this.pickItem(initial.sequence, localize('basehalf.sequence.pickRemove', "Choose a clip to remove. Its video is kept."));
		if (!itemId) {
			return undefined;
		}

		const loaded = await this.load(resource);
		const removedItem = loaded.sequence.items.find(item => item.id === itemId);
		if (!removedItem) {
			throw new Error(`Sequence item '${itemId}' no longer exists.`);
		}
		const saved = await this.save(loaded, removeBaseHalfSequenceItem(loaded.sequence, itemId), token);
		const inspection = await this.inspectLoaded(saved);
		if (argument === undefined) {
			this.notificationService.info(localize('basehalf.sequence.removed', "Removed '{0}' from the Video Sequence. Its video was kept.", removedItem.title));
		}
		return Object.freeze({ operation: 'removed', resource, item: removedItem, document: saved.sequence, inspection });
	}

	async repair(argument?: unknown, token?: CancellationToken): Promise<IBaseHalfSequenceInspection | undefined> {
		throwIfCancelled(token);
		const args = sequenceArguments(argument);
		requireStructuredArguments(argument, args, ['sequence', 'itemId']);
		const resource = await this.resolveSequence(args.sequence);
		if (!resource) {
			return undefined;
		}
		const initialInspection = await this.inspectLoaded(await this.load(resource));
		const opportunities = initialInspection.items.filter(item => item.repairCandidatePath !== undefined);
		if (opportunities.length === 0) {
			if (argument === undefined) {
				this.notificationService.info(localize('basehalf.sequence.nothingToRepair', "No Sequence item has a unique verified path repair available."));
			}
			return initialInspection;
		}
		const itemId = args.itemId ?? await this.pickInspection(opportunities, localize('basehalf.sequence.pickRepair', "Choose a moved clip path to repair"));
		if (!itemId) {
			return undefined;
		}

		// Read and verify the moved video by its generation again right before
		// the compare-and-save edit. Inspection never edits a Sequence by itself.
		const loaded = await this.load(resource);
		const inspection = await this.inspectLoaded(loaded);
		const selected = inspection.items.find(item => item.item.id === itemId);
		if (!selected) {
			throw new Error(`Sequence item '${itemId}' no longer exists.`);
		}
		if (!selected.repairCandidatePath) {
			throw new Error(`Sequence item '${itemId}' no longer has a unique verified path repair.`);
		}
		const saved = await this.save(loaded, updateBaseHalfSequenceItemPath(loaded.sequence, itemId, selected.repairCandidatePath), token);
		const result = await this.inspectLoaded(saved);
		if (argument === undefined) {
			this.notificationService.info(localize('basehalf.sequence.repaired', "Repaired the saved path for '{0}'.", selected.item.title));
		}
		return result;
	}

	async load(resource: URI): Promise<IBaseHalfLoadedSequence> {
		await this.assertSequenceResource(resource);
		const source = await this.readSequenceSource(resource);
		return { resource, source, sequence: parseBaseHalfSequenceDocument(source) };
	}

	async inspectLoaded(loaded: IBaseHalfLoadedSequence, token?: CancellationToken): Promise<IBaseHalfSequenceInspection> {
		const workflowRoot = dirname(loaded.resource);
		const inspectVideo = (resource: URI) => this.inspectionLimiter.queue(async () => {
			throwIfCancelled(token);
			const result = await this.inspectVideoFile(resource);
			throwIfCancelled(token);
			return result;
		});
		return inspectBaseHalfSequence(
			loaded.sequence,
			videoPath => inspectVideo(resolveBaseHalfSequenceVideo(loaded.resource, videoPath)),
			this.movedVideoLocator(workflowRoot, inspectVideo, token),
			() => throwIfCancelled(token)
		);
	}

	/**
	 * Finds the one video below the folder of the Sequence whose `made.yaml`
	 * has an item's `generationId`: a bounded scan of the video files there,
	 * each read through the card store. Nothing under `.bh/` is read.
	 */
	private movedVideoLocator(
		workflowRoot: URI,
		inspectVideo: (resource: URI) => Promise<IBaseHalfSequenceVideoState>,
		token: CancellationToken | undefined
	): (item: IBaseHalfSequenceItem) => Promise<BaseHalfSequenceRelocation | undefined> {
		let index: Promise<IGenerationIndex> | undefined;
		return async item => {
			throwIfCancelled(token);
			if (item.generationId === undefined) {
				return undefined;
			}
			index ??= this.generationIndex(workflowRoot, inspectVideo, token);
			const result = await index;
			throwIfCancelled(token);
			if (result.truncated) {
				return { kind: 'scanLimit', maximum: MAX_RELOCATION_SCAN_RESULTS };
			}
			const matches = result.byGeneration.get(item.generationId) ?? [];
			if (matches.length === 0) {
				return undefined;
			}
			if (matches.length !== 1) {
				return { kind: 'ambiguous', matchCount: matches.length };
			}
			const video = await inspectVideo(matches[0]);
			if (!video.isVideoFile || video.generationId !== item.generationId) {
				return undefined;
			}
			return { kind: 'unique', videoPath: baseHalfSequenceVideoPathOf(workflowRoot, matches[0]) };
		};
	}

	private async generationIndex(
		workflowRoot: URI,
		inspectVideo: (resource: URI) => Promise<IBaseHalfSequenceVideoState>,
		token: CancellationToken | undefined
	): Promise<IGenerationIndex> {
		throwIfCancelled(token);
		if (!this.workspaceContextService.getWorkspaceFolder(workflowRoot)) {
			return { truncated: false, byGeneration: new Map() };
		}
		const resources = await this.findVideoFiles(workflowRoot, MAX_RELOCATION_SCAN_RESULTS + 1);
		throwIfCancelled(token);
		if (resources.length > MAX_RELOCATION_SCAN_RESULTS) {
			return { truncated: true, byGeneration: new Map() };
		}
		const byGeneration = new Map<string, URI[]>();
		await Promise.all(resources.map(async resource => {
			try {
				const video = await inspectVideo(resource);
				if (video.isVideoFile && video.generationId !== undefined) {
					const matches = byGeneration.get(video.generationId) ?? [];
					matches.push(resource);
					byGeneration.set(video.generationId, matches);
				}
			} catch {
				throwIfCancelled(token);
				// A file that cannot be inspected cannot be a safe repair.
			}
		}));
		throwIfCancelled(token);
		return { truncated: false, byGeneration };
	}

	/** The video files below a folder, never under `.bh/`, by their extensions in any case. */
	private async findVideoFiles(folder: URI, maxResults: number): Promise<URI[]> {
		return this.findFiles([folder], '**/*.{mp4,mov,m4v,webm}', maxResults);
	}

	private async findFiles(folders: readonly URI[], include: string, maxResults: number): Promise<URI[]> {
		const query: IFileQuery = {
			type: QueryType.File,
			_reason: 'basehalfSequence',
			folderQueries: folders.map(folder => ({
				folder,
				disregardIgnoreFiles: true,
				disregardGlobalIgnoreFiles: true,
				disregardParentIgnoreFiles: true,
				ignoreSymlinks: true,
				ignoreGlobCase: true
			})),
			includePattern: { [include]: true },
			excludePattern: { '**/.bh': true },
			ignoreGlobCase: true,
			maxResults
		};
		const complete = await this.searchService.fileSearch(query, CancellationToken.None);
		return complete.results.map(match => match.resource);
	}

	/**
	 * What a clip's path holds: whether it is a regular video file inside its
	 * open workspace folder, and the `id` of its `made.yaml`, which the card
	 * store answers for a generation card with its file.
	 */
	private async inspectVideoFile(resource: URI): Promise<IBaseHalfSequenceVideoState> {
		if (!await this.isRegularVideoFile(resource)) {
			return Object.freeze({ isVideoFile: false });
		}
		const card = await this.inspectCard(resource);
		return Object.freeze({
			isVideoFile: true,
			resource,
			...(card?.hasFile && card.generationId !== undefined ? { generationId: card.generationId } : {})
		});
	}

	private inspectCard(resource: URI) {
		return inspectBaseHalfGenerationCard(resource, this.fileService, this.workspaceContextService, this.generationCardStore);
	}

	private async isRegularVideoFile(resource: URI): Promise<boolean> {
		if (!isBaseHalfPlainLocalFile(resource) || !isBaseHalfSequenceVideoPath(resource.path)) {
			return false;
		}
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(resource)?.uri;
		return !!workspaceFolder && workspaceFolder.scheme === Schemas.file && isBaseHalfOrdinaryFileInside(this.fileService, workspaceFolder, resource);
	}

	private async assertSequenceResource(resource: URI): Promise<void> {
		if (!isBaseHalfPlainLocalFile(resource)) {
			throw new Error('Sequence must be an ordinary local file in an open workspace folder.');
		}
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(resource)?.uri;
		if (!workspaceFolder || workspaceFolder.scheme !== Schemas.file) {
			throw new Error('Sequence must be inside an open local workspace folder.');
		}
		if (!await isBaseHalfOrdinaryFileInside(this.fileService, workspaceFolder, resource)) {
			throw new Error('Sequence must be an existing ordinary file contained by its open workspace folder.');
		}
	}

	private async readSequenceSource(resource: URI): Promise<string> {
		const content = await this.fileService.readFile(resource, { limits: { size: MAX_SEQUENCE_DOCUMENT_BYTES } });
		return new TextDecoder('utf-8', { fatal: true }).decode(content.value.buffer);
	}

	/**
	 * The Sequence a command without one acts on: the one open in Card Detail
	 * or in the active editor, else the one Sequence of the workspace, else
	 * the one the user picks.
	 */
	private async resolveSequence(explicit: URI | undefined): Promise<URI | undefined> {
		if (explicit) {
			await this.assertSequenceResource(explicit);
			return explicit;
		}
		const open = this.navigationService.state.cardDetail?.resource;
		if (open && await this.isSequence(open)) {
			return open;
		}
		const model = getCodeEditor(this.editorService.activeTextEditorControl)?.getModel();
		if (model && isSequenceSource(model.getValue())) {
			await this.assertSequenceResource(model.uri);
			return model.uri;
		}
		const folders = this.workspaceContextService.getWorkspace().folders.map(folder => folder.uri).filter(folder => folder.scheme === Schemas.file);
		const candidates = folders.length ? await this.findFiles(folders, `**/${BASEHALF_SEQUENCE_FILE_NAME}`, MAX_SEQUENCE_SEARCH_RESULTS) : [];
		const sequences: URI[] = [];
		for (const candidate of candidates) {
			// A file of the same name is not a Sequence unless it parses.
			if (await this.isSequence(candidate)) {
				sequences.push(candidate);
			}
		}
		if (sequences.length === 0) {
			this.notificationService.info(localize('basehalf.sequence.noneFound', "No {0} was found in this project.", BASEHALF_SEQUENCE_FILE_NAME));
			return undefined;
		}
		if (sequences.length === 1) {
			return sequences[0];
		}
		const picked = await this.quickInputService.pick(sequences.map(resource => ({
			label: this.labelService.getUriLabel(resource, { relative: true }),
			resource
		})), { placeHolder: localize('basehalf.sequence.pickSequence', "Choose a video sequence") });
		return picked?.resource;
	}

	private async isSequence(resource: URI): Promise<boolean> {
		try {
			await this.load(resource);
			return true;
		} catch {
			return false;
		}
	}

	private async save(loaded: IBaseHalfLoadedSequence, sequence: IBaseHalfSequenceDocument, token: CancellationToken | undefined): Promise<IBaseHalfLoadedSequence> {
		const contents = serializeBaseHalfSequenceDocument(sequence);
		// An agent's operation gets its token as the command's second argument:
		// a request already cancelled must never write later.
		throwIfCancelled(token);
		// Not BaseHalf's own operation: the transition may change no upstream value (D37).
		await this.projectFileTransitionService.apply({
			resource: loaded.resource,
			expected: VSBuffer.fromString(loaded.source),
			next: VSBuffer.fromString(contents),
			label: localize('basehalf.sequence.editLabel', "Edit video playback order")
		});
		const saved = await this.load(loaded.resource);
		if (serializeBaseHalfSequenceDocument(saved.sequence) !== contents) {
			throw new Error('The saved Sequence no longer matches this action. Review the file and try again.');
		}
		return saved;
	}

	private async pickVideoCandidate(workflowRoot: URI): Promise<IVideoCandidate | undefined> {
		const candidates: { readonly resource: URI; readonly videoPath: string }[] = [];
		for (const resource of await this.findVideoFiles(workflowRoot, MAX_ADD_CANDIDATES)) {
			try {
				if (await this.isRegularVideoFile(resource)) {
					candidates.push({ resource, videoPath: baseHalfSequenceVideoPathOf(workflowRoot, resource) });
				}
			} catch {
				// Only a video file below the folder of the Sequence can be a clip.
			}
		}
		candidates.sort((left, right) => left.videoPath.localeCompare(right.videoPath));
		if (candidates.length === 0) {
			this.notificationService.info(localize('basehalf.sequence.noVideo', "No video is available to add."));
			return undefined;
		}
		const selected = candidates.length === 1
			? candidates[0]
			: (await this.quickInputService.pick(candidates.map(candidate => ({
				label: suggestedTitle(candidate.videoPath),
				description: candidate.videoPath,
				candidate
			})), { placeHolder: localize('basehalf.sequence.pickVideo', "Choose a video to add to playback order") }))?.candidate;
		return selected ? this.loadVideoCandidate(workflowRoot, selected.resource) : undefined;
	}

	private async loadVideoCandidate(workflowRoot: URI, resource: URI): Promise<IVideoCandidate> {
		if (!isBaseHalfPlainLocalFile(resource)) {
			throw new Error('The video must be an ordinary local file below the folder of the Sequence.');
		}
		const sequenceWorkspace = this.workspaceContextService.getWorkspaceFolder(workflowRoot);
		const candidateWorkspace = this.workspaceContextService.getWorkspaceFolder(resource);
		if (!sequenceWorkspace || !candidateWorkspace || sequenceWorkspace.uri.toString() !== candidateWorkspace.uri.toString()) {
			throw new Error('The video and the Sequence must belong to the same open workspace folder.');
		}
		const videoPath = baseHalfSequenceVideoPathOf(workflowRoot, resource);
		const [card, isVideoFile] = await Promise.all([this.inspectCard(resource), this.isRegularVideoFile(resource)]);
		const { generationId } = resolveBaseHalfSequenceVideoCard(videoPath, isVideoFile, card);
		return Object.freeze({
			resource,
			videoPath,
			...(generationId === undefined ? {} : { generationId }),
			suggestedTitle: suggestedTitle(videoPath)
		});
	}

	private promptForTitle(value: string): Promise<string | undefined> {
		return this.quickInputService.input({
			title: localize('basehalf.sequence.addTitle', "Add Video Result to Sequence"),
			prompt: localize('basehalf.sequence.namePrompt', "Name this clip in playback order"),
			value,
			validateInput: async input => {
				if (!input.trim()) {
					return localize('basehalf.sequence.nameRequired', "Enter a clip name.");
				}
				if (input.includes('\u0000') || input.length > 240) {
					return localize('basehalf.sequence.nameTooLong', "Use no more than 240 characters.");
				}
				return undefined;
			}
		});
	}

	private async showInspection(inspection: IBaseHalfSequenceInspection): Promise<IBaseHalfSequenceItemInspection | undefined> {
		if (inspection.items.length === 0) {
			this.notificationService.info(localize('basehalf.sequence.empty', "Sequence has no clips yet."));
			return undefined;
		}
		const picked = await this.quickInputService.pick(inspection.items.map((item, index) => ({
			label: `${stateIcon(item)} ${index + 1}. ${item.item.title}`,
			description: stateLabel(item),
			detail: item.message,
			item
		})), {
			placeHolder: inspection.valid
				? localize('basehalf.sequence.allAvailable', "All clips are available")
				: localize('basehalf.sequence.needsAttention', "One or more clips need attention")
		});
		return picked?.item;
	}

	private async pickItem(sequence: IBaseHalfSequenceDocument, placeHolder: string): Promise<string | undefined> {
		const picked = await this.quickInputService.pick(sequence.items.map((item, index) => ({
			label: `${index + 1}. ${item.title}`,
			description: item.videoPath,
			itemId: item.id
		})), { placeHolder });
		return picked?.itemId;
	}

	private async pickInspection(items: readonly IBaseHalfSequenceItemInspection[], placeHolder: string): Promise<string | undefined> {
		const picked = await this.quickInputService.pick(items.map(item => ({
			label: item.item.title,
			description: item.item.videoPath,
			detail: item.message,
			itemId: item.item.id
		})), { placeHolder });
		return picked?.itemId;
	}

	private async pickDirection(index: number, total: number): Promise<'up' | 'down' | undefined> {
		const choices: (IQuickPickItem & { readonly direction: 'up' | 'down' })[] = [];
		if (index > 0) {
			choices.push({ label: localize('basehalf.sequence.moveEarlier', "Move earlier"), direction: 'up' });
		}
		if (index < total - 1) {
			choices.push({ label: localize('basehalf.sequence.moveLater', "Move later"), direction: 'down' });
		}
		return (await this.quickInputService.pick(choices, { placeHolder: localize('basehalf.sequence.pickDirection', "Choose playback order") }))?.direction;
	}
}

function sequenceArguments(argument: unknown): ISequenceArguments {
	if (URI.isUri(argument)) {
		return { sequence: argument };
	}
	if (!argument || typeof argument !== 'object' || Array.isArray(argument)) {
		return {};
	}
	const candidate = argument as Record<string, unknown>;
	const supportedKeys = new Set(['sequence', 'video', 'itemId', 'title', 'direction']);
	for (const key of Object.keys(candidate)) {
		if (!supportedKeys.has(key)) {
			throw new Error(`Sequence command argument '${key}' is not supported.`);
		}
	}
	for (const key of ['sequence', 'video']) {
		if (candidate[key] !== undefined && !URI.isUri(candidate[key])) {
			throw new Error(`Sequence command argument '${key}' must be a URI.`);
		}
	}
	for (const key of ['itemId', 'title']) {
		if (candidate[key] !== undefined && typeof candidate[key] !== 'string') {
			throw new Error(`Sequence command argument '${key}' must be text.`);
		}
	}
	if (candidate.direction !== undefined && candidate.direction !== 'up' && candidate.direction !== 'down') {
		throw new Error(`Sequence command argument 'direction' must be 'up' or 'down'.`);
	}
	return {
		...(URI.isUri(candidate.sequence) ? { sequence: candidate.sequence } : {}),
		...(typeof candidate.itemId === 'string' ? { itemId: candidate.itemId } : {}),
		...(candidate.direction === 'up' || candidate.direction === 'down' ? { direction: candidate.direction } : {}),
		...(URI.isUri(candidate.video) ? { video: candidate.video } : {}),
		...(typeof candidate.title === 'string' ? { title: candidate.title } : {})
	};
}

/** An argument the command got must name everything the command needs; only the Command Palette asks. */
function requireStructuredArguments(argument: unknown, args: ISequenceArguments, keys: readonly (keyof ISequenceArguments)[]): void {
	if (argument === undefined) {
		return;
	}
	for (const key of keys) {
		if (args[key] === undefined || args[key] === '') {
			throw new Error(`Structured Sequence arguments must include '${key}'.`);
		}
	}
}

function isSequenceSource(source: string): boolean {
	try {
		parseBaseHalfSequenceDocument(source);
		return true;
	} catch {
		return false;
	}
}

function throwIfCancelled(token: CancellationToken | undefined): void {
	if (token?.isCancellationRequested) {
		throw new CancellationError();
	}
}

function suggestedTitle(videoPath: string): string {
	const segments = videoPath.split('/');
	const fileName = segments[segments.length - 1].replace(/\.[^.]+$/, '') || 'Clip';
	const source = /^(clip|video)$/i.test(fileName) && segments.length > 1 ? segments[segments.length - 2] : fileName;
	const words = source.replace(/[-_]+/g, ' ').trim();
	return words ? words.replace(/^\p{Ll}/u, character => character.toUpperCase()) : 'Clip';
}

function uniqueItemId(sequence: IBaseHalfSequenceDocument): string {
	const ids = new Set(sequence.items.map(item => item.id));
	for (let attempt = 0; attempt < 10; attempt++) {
		const candidate = `sequence-item-${generateUuid()}`;
		if (!ids.has(candidate)) {
			return candidate;
		}
	}
	throw new Error('A unique Sequence item id could not be created. Try again.');
}

function stateIcon(item: IBaseHalfSequenceItemInspection): string {
	switch (item.state) {
		case 'available': return '$(check)';
		case 'changed': return '$(warning)';
		case 'missing': return '$(error)';
	}
}

function stateLabel(item: IBaseHalfSequenceItemInspection): string {
	switch (item.state) {
		case 'available': return localize('basehalf.sequence.available', "Available");
		case 'changed': return localize('basehalf.sequence.changed', "Changed");
		case 'missing': return localize('basehalf.sequence.missing', "Missing");
	}
}

registerSingleton(IBaseHalfSequenceService, BaseHalfSequenceService, InstantiationType.Delayed);
