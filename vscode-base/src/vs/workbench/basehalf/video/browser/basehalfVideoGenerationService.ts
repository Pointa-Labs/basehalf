/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { disposableTimeout, IntervalTimer } from '../../../../base/common/async.js';
import { decodeBase64, encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, dispose, IDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { basename, dirname, extname } from '../../../../base/common/resources.js';
import { hasKey } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IChecksumService } from '../../../../platform/checksum/common/checksumService.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUndoRedoService, IWorkspaceUndoRedoElement, UndoRedoElementType, UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from '../../workspace/common/basehalfWorkspaceMutation.js';
import { baseHalfIsDraftInformation, baseHalfReadDraftFacts } from '../common/basehalfGenerationDraft.js';
import {
	BASEHALF_GENERATION_HEARTBEAT_MS,
	BASEHALF_GENERATION_MAX_FILE_BYTES,
	BASEHALF_GENERATION_STALE_MS,
	baseHalfGenerationChoice,
	baseHalfGenerationClaimWinner,
	baseHalfGenerationExtensionMatchesFormat,
	baseHalfGenerationFileFormat,
	baseHalfGenerationFormatExtension,
	BaseHalfGenerationKind,
	baseHalfGenerationMadeOfTask,
	baseHalfGenerationNameOrdinal,
	baseHalfGenerationNameParts,
	baseHalfGenerationTaskNamesCard,
	createBaseHalfGenerationTask,
	createBaseHalfGenerationTaskId,
	failBaseHalfGenerationCard,
	failBaseHalfGenerationTask,
	heartbeatBaseHalfGenerationTask,
	IBaseHalfGenerationInfo,
	IBaseHalfGenerationRequest,
	IBaseHalfGenerationTask,
	isBaseHalfGenerationFileAccepted,
	isBaseHalfGenerationTaskEnded,
	isBaseHalfGenerationTaskSettled,
	isBaseHalfGenerationTaskStale,
	landBaseHalfGenerationTask,
	recordBaseHalfGenerationLanded,
	recordBaseHalfGenerationLanding,
	runBaseHalfGenerationTask,
	stopBaseHalfGenerationTask,
	submitBaseHalfGenerationTask
} from '../common/basehalfGenerationInfo.js';
import {
	BASEHALF_VIDEO_IMAGE_FORMATS,
	BASEHALF_VIDEO_PROVIDER_COMMANDS,
	BaseHalfVideoGenerateBlocker,
	baseHalfVideoGenerateBlockerText,
	BaseHalfVideoImageFormat,
	BaseHalfVideoMedia,
	baseHalfVideoModeOf,
	BaseHalfVideoModeId,
	BaseHalfVideoOutput,
	BaseHalfVideoOutputFormat,
	BaseHalfVideoParams,
	BaseHalfVideoPollState,
	BaseHalfVideoProviderErrorCode,
	baseHalfVideoRefusedParam,
	baseHalfVideoSentParams,
	buildBaseHalfVideoPrompt,
	findBaseHalfVideoModel,
	findBaseHalfVideoProvider,
	getBaseHalfVideoGenerateBlocker,
	IBaseHalfVideoCatalog,
	IBaseHalfVideoCatalogMode,
	IBaseHalfVideoDownloadResult,
	IBaseHalfVideoGenerationChoice,
	IBaseHalfVideoInputPlanItem,
	IBaseHalfVideoModelRef,
	IBaseHalfVideoPlannedMedia,
	IBaseHalfVideoProviderAccess,
	IBaseHalfVideoProviderError,
	IBaseHalfVideoSubmitRequest,
	IBaseHalfVideoSubmitResult,
	IBaseHalfVideoTaskRef,
	baseHalfModelFileExtension,
	baseHalfModelOutputCount,
	normalizeBaseHalfVideoParams,
	parseBaseHalfVideoCheckResult,
	planBaseHalfVideoInputs,
	stripBaseHalfMarkdownFrontMatter
} from '../common/basehalfVideoCatalog.js';
import {
	BaseHalfVideoGenerationError,
	BaseHalfVideoGenerationPhase,
	IBaseHalfDraftOperations,
	IBaseHalfDraftSnapshot,
	IBaseHalfGenerateOptions,
	IBaseHalfGenerationCardSnapshot,
	IBaseHalfGenerationCardStore,
	IBaseHalfGenerationTaskStore,
	IBaseHalfVideoCatalogService,
	IBaseHalfVideoGenerationProgress,
	IBaseHalfVideoGenerationService,
	IBaseHalfVideoProviderSettingsService,
	IBaseHalfVideoResolvedInput
} from '../common/basehalfVideoGeneration.js';
import { BASEHALF_GENERATION_CARD_SIZE, baseHalfParentCanvasFolder, placeBaseHalfCardsBeside } from './basehalfGenerationPlacement.js';

/** The first question to the provider comes this long after it accepted the task. */
export const BASEHALF_VIDEO_FIRST_POLL_DELAY = 3_000;
/** Then the provider is asked this often. */
export const BASEHALF_VIDEO_POLL_INTERVAL = 5_000;
/** Network errors while asking are retried for this long in a row. */
export const BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT = 30 * 60_000;
/** A generation that has not ended this long after its start fails. */
export const BASEHALF_VIDEO_TASK_TIME_LIMIT = 2 * 60 * 60_000;
/** How long a generation waits for the catalog while it loads. */
export const BASEHALF_VIDEO_CATALOG_WAIT = 30_000;
/** The largest image BaseHalf draws to PNG in the window. */
const RASTER_MAX_BYTES = 64 * 1024 * 1024;
/** A file of an output that could not be downloaded is tried this many times, asking the provider again between tries. */
const DOWNLOAD_ATTEMPTS = 3;
/** Answers to a question about the task that cannot be read end the generation after this many in a row. */
const UNREADABLE_ANSWERS = 3;
/** The head of a text input that is read: enough for front matter and 16 KiB of text. */
const TEXT_INPUT_READ_BYTES = 256 * 1024;
/** The longest side of an image drawn to PNG. */
const RASTER_MAX_SIDE = 4096;
/** How many images drawn to PNG the service keeps, so the panel's checks do not draw them again. */
const DRAWN_IMAGES_KEPT = 16;
/** A vector image without a useful size is drawn at least this large. */
const RASTER_VECTOR_SIDE = 1024;
/** The bytes a file's format is read from. */
const FORMAT_HEAD_BYTES = 16;
/** How often the landing of one file tries another name when its name was taken at the last moment. */
const LANDING_ATTEMPTS = 3;

const DIRECT_IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' });
const DIRECT_IMAGE_FORMATS: Readonly<Record<string, BaseHalfVideoImageFormat>> = Object.freeze({ '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' });
const RASTER_IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp' });
const VIDEO_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.webm': 'video/webm' });
const AUDIO_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac' });

const PROVIDER_ERROR_CODES: ReadonlySet<BaseHalfVideoProviderErrorCode> = new Set(['auth', 'rejected', 'rateLimited', 'balance', 'unknownOutcome', 'network', 'invalidResponse', 'notFound', 'notVideo', 'notImage', 'tooLarge', 'unknownProvider']);

/** Draws an image that providers do not take (SVG, GIF, AVIF, BMP) to a PNG data URL. */
export type BaseHalfVideoImageRasterizer = (bytes: VSBuffer, mimeType: string) => Promise<string>;

type ProviderAnswer<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: IBaseHalfVideoProviderError; /** AI Video did not answer at all. */ readonly unavailable?: boolean };

/** Where the file of one card comes from: an address to download, a file AI Video already wrote, or the provider's refusal of it alone. */
type LandingSource =
	| { readonly kind: 'download'; readonly url?: string }
	| { readonly kind: 'written'; readonly path: string }
	| { readonly kind: 'refused'; readonly reason: string };

interface IPreparedGeneration {
	readonly access: IBaseHalfVideoProviderAccess;
	readonly request: IBaseHalfVideoSubmitRequest;
	readonly record: IBaseHalfGenerationRequest;
	readonly sentPrompt: string;
	readonly lastUsed: IBaseHalfVideoGenerationChoice;
}

/** The cards a generation lands on (generation cards, "Starting", step 4). */
interface IPlannedCards {
	/** Workspace-relative paths, in the order of the outputs. */
	readonly paths: readonly string[];
	/** The drafts the generation makes, by name, in its folder. */
	readonly drafts: readonly string[];
}

/** One generation this window follows: from Generate, or taken over from another window. */
class FollowedGeneration {
	phase: BaseHalfVideoGenerationPhase = 'preparing';
	fraction: number | undefined;
	/** Where the provider is asked, with what, and about which catalog model. */
	access: IBaseHalfVideoProviderAccess | undefined;
	model: string | undefined;
	remoteId: string | undefined;
	/** The record has been written: from then on this window says it is alive. */
	recorded = false;
	/** What the generation used, remembered as the last values of its kind once a file lands. */
	lastUsed: IBaseHalfVideoGenerationChoice | undefined;
	stopped = false;
	ended = false;
	cancelSent = false;
	transientSince: number | undefined;
	unreadableAnswers = 0;
	/** Downloads of each card that failed for a reason that may pass. */
	readonly downloadFailures = new Map<number, number>();
	/** The cards' paths as last known, for the cards' events. */
	paths: readonly string[];
	timer: IDisposable | undefined;
	landing: Promise<void> | undefined;
	readonly preparation = new CancellationTokenSource();

	constructor(
		readonly taskId: string,
		readonly folder: URI,
		readonly kind: BaseHalfGenerationKind,
		readonly startedAt: number,
		paths: readonly string[]
	) {
		this.paths = paths;
	}

	/** The task as AI Video is asked about it; a provider that answered at once gave no task id, and its outputs are found by their addresses. */
	taskRef(): IBaseHalfVideoTaskRef {
		return { ...this.access!, model: this.model!, remoteId: this.remoteId ?? '' };
	}

	/** The credential values, which no message may hold. */
	secrets(): readonly string[] {
		return this.access ? Object.values(this.access.credentials) : [];
	}
}

/**
 * Runs the generations of generation cards (D63, D64, generation cards, "A
 * generation"): from Generate through a task record of this computer to the
 * files on their cards. The steps before the record is `submitting` write
 * nothing but the record and the drafts the generation makes, and a stop
 * there removes both. Requests go through the AI Video extension's provider
 * commands; a request that may have reached a provider is never sent again.
 * One window follows each generation and says every 30 seconds that it is
 * alive; another window takes a generation over only when that has not
 * happened for 90 seconds. Files land inside the workspace mutation lease.
 */
export class BaseHalfVideoGenerationService extends Disposable implements IBaseHalfVideoGenerationService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeProgress = this._register(new Emitter<URI>());
	readonly onDidChangeProgress = this._onDidChangeProgress.event;

	/** This window, as a task record names the window that follows it. */
	readonly follower = `w${generateUuid().replace(/-/g, '')}`;

	private readonly followed = new Map<string, FollowedGeneration>();
	private readonly heartbeat = this._register(new IntervalTimer());
	private heartbeatRunning = false;
	private readonly laterChecks = new Map<string, IDisposable>();
	private readonly takingOver = new Set<string>();
	/** The records as last seen, to tell the cards whose generation changed. */
	private seen = new Map<string, string>();
	private readonly rasterize: BaseHalfVideoImageRasterizer;
	/** Images drawn to PNG, by file, modification time, and size; the oldest goes first. */
	private readonly drawnImages = new Map<string, string>();

	constructor(
		rasterize: BaseHalfVideoImageRasterizer | undefined,
		@IBaseHalfGenerationCardStore private readonly cardStore: IBaseHalfGenerationCardStore,
		@IBaseHalfGenerationTaskStore private readonly taskStore: IBaseHalfGenerationTaskStore,
		@IBaseHalfDraftOperations private readonly draftOperations: IBaseHalfDraftOperations,
		@IBaseHalfVideoCatalogService private readonly catalogService: IBaseHalfVideoCatalogService,
		@IBaseHalfVideoProviderSettingsService private readonly providerSettings: IBaseHalfVideoProviderSettingsService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly mutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IChecksumService private readonly checksumService: IChecksumService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@ICommandService private readonly commandService: ICommandService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.rasterize = rasterize ?? rasterizeBaseHalfVideoImage;
		this._register(this.taskStore.onDidChange(() => this.onDidChangeRecords()));
		// Generations found when the window opens are continued, or settled.
		void this.taskStore.whenReady().then(() => this.onDidChangeRecords());
	}

	override dispose(): void {
		for (const follow of this.followed.values()) {
			follow.ended = true;
			follow.timer?.dispose();
			follow.preparation.dispose(true);
		}
		this.followed.clear();
		dispose(this.laterChecks.values());
		this.laterChecks.clear();
		super.dispose();
	}

	isGenerating(resource: URI): boolean {
		const located = this.locate(resource);
		const task = located ? this.taskStore.forCard(resource) : undefined;
		return !!task && !!located && !isBaseHalfGenerationTaskEnded(task) && task.cards.some(card => card.path === located.path && card.state === 'waiting');
	}

	getProgress(resource: URI): IBaseHalfVideoGenerationProgress | undefined {
		const located = this.locate(resource);
		const key = located?.folder.toString();
		const follow = located ? [...this.followed.values()].find(candidate => !candidate.ended && candidate.folder.toString() === key && candidate.paths.includes(located.path)) : undefined;
		if (!follow) {
			return undefined;
		}
		return Object.freeze({ phase: follow.phase, startedAt: follow.startedAt, ...(follow.fraction !== undefined ? { fraction: follow.fraction } : {}) });
	}

	// --- starting ------------------------------------------------------------------------------

	async generate(resource: URI, options: IBaseHalfGenerateOptions = {}): Promise<readonly URI[]> {
		// 1. The card's generation information; the panel saved its prompt.
		let snapshot: IBaseHalfGenerationCardSnapshot;
		try {
			snapshot = await this.cardStore.read(resource);
		} catch (error) {
			throw toGenerationError(error);
		}
		const folder = this.workspaceFolderOf(resource);
		// 2. A card that generates does not generate twice.
		await this.taskStore.refresh(folder);
		if (this.isGenerating(resource)) {
			throw generatingError();
		}
		// 3. The model, the provider's setup, and the blockers known without the inputs.
		const catalog = await this.catalog();
		const info = snapshot.info;
		const blocker = getBaseHalfVideoGenerateBlocker({
			generating: false,
			catalog: { kind: 'ready', catalog },
			generation: baseHalfGenerationChoice(info),
			kind: snapshot.kind,
			setup: provider => this.providerSettings.getStatus(provider),
			prompt: info.prompt
		});
		const ref = findBaseHalfVideoModel(catalog, info.provider, info.model);
		if (blocker || !ref) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText(blocker ?? { kind: 'noModel' }));
		}
		if (options.agent) {
			const refused = baseHalfVideoRefusedParam(ref.model, info.mode, info.params);
			if (refused) {
				throw new BaseHalfVideoGenerationError(refused);
			}
		}
		const mode = baseHalfVideoModeOf(ref.model, info.mode);
		const params = normalizeBaseHalfVideoParams(ref.model, mode.id, info.params);
		// 4. The cards it lands on.
		const planned = await this.planCards(snapshot, ref, mode.id, params);
		// 5. The record, which claims them, and the drafts it makes.
		const now = Date.now();
		const task = createBaseHalfGenerationTask({
			id: createBaseHalfGenerationTaskId(now, generateUuid),
			kind: snapshot.kind,
			cards: planned.paths,
			follower: this.follower,
			now: new Date(now).toISOString()
		});
		const follow = new FollowedGeneration(task.id, folder, snapshot.kind, now, planned.paths);
		this.track(follow);
		try {
			await this.taskStore.create(folder, task);
		} catch (error) {
			this.untrack(follow);
			throw toGenerationError(error);
		}
		follow.recorded = true;
		const made: URI[] = [];
		let prepared: IPreparedGeneration;
		try {
			await this.claim(task);
			await this.removeEndedRecordsOf(task);
			const parent = dirname(resource);
			for (const name of planned.drafts) {
				made.push(await this.cardStore.createDraft(parent, name, info, snapshot.upstream));
				this.throwIfStopped(follow);
			}
			if (made.length) {
				await placeBaseHalfCardsBeside(this.placementServices(), baseHalfParentCanvasFolder({ resource, workspaceFolder: folder, relativePath: snapshot.path }), snapshot.path,
					made.map(draft => ({ path: this.relativePath(folder, draft), size: BASEHALF_GENERATION_CARD_SIZE[snapshot.kind] })));
			}
			// 6. The inputs, the prompt, and the provider module's check, with the files.
			prepared = await this.prepare(follow, task, snapshot, ref, mode, follow.preparation.token);
			// 7. The request record; a claim made meanwhile by another window is seen by now.
			await this.claim(task);
			const submitted = await this.taskStore.update(task.id, current => current.state === 'preparing'
				? submitBaseHalfGenerationTask(current, prepared.record, prepared.sentPrompt, ref.model.answersAtOnce === true)
				: current);
			if (follow.stopped || submitted?.state !== 'submitting') {
				throw stoppedBeforeStartError();
			}
		} catch (error) {
			// A stop before the request leaves removes the record and leaves no card it made.
			this.untrack(follow);
			await this.taskStore.remove(task.id).catch(removeError => this.logService.warn(`[BaseHalf generation] The record ${task.id} could not be removed: ${getErrorMessage(removeError)}`));
			for (const draft of made) {
				await this.deleteDraftQuietly(draft);
			}
			throw toGenerationError(error);
		}
		if (made.length) {
			this.pushDraftsUndo(resource, made, info);
		}
		follow.access = prepared.access;
		follow.model = ref.model.id;
		this.setPhase(follow, 'waiting');
		this.startHeartbeat();
		void this.submit(follow, prepared.request, prepared.lastUsed).catch(error => this.submitFailedUnexpectedly(follow, error));
		return Object.freeze(planned.paths.map(path => this.resourceOf(folder, path)));
	}

	/**
	 * Step 4: the card itself when it is a draft, or a new draft beside it when
	 * it has its file, named like it with the next free number; and for an
	 * image `count` above 1, that many cards in all, the further ones named
	 * like the first with the next free numbers.
	 */
	private async planCards(snapshot: IBaseHalfGenerationCardSnapshot, ref: IBaseHalfVideoModelRef, modeId: BaseHalfVideoModeId, params: BaseHalfVideoParams): Promise<IPlannedCards> {
		const parent = dirname(snapshot.resource);
		const parentPath = snapshot.path.includes('/') ? snapshot.path.slice(0, snapshot.path.lastIndexOf('/')) : '';
		const name = basename(snapshot.resource);
		const parts = baseHalfGenerationNameParts(name);
		const modelExtension = baseHalfModelFileExtension(ref.model);
		const extension = snapshot.hasFile && !baseHalfGenerationExtensionMatchesFormat(name, modelExtension === 'jpg' ? 'jpeg' : modelExtension as BaseHalfVideoOutputFormat)
			? modelExtension
			: parts.extension;
		const count = baseHalfModelOutputCount(ref.model, modeId, params);
		const drafts: string[] = [];
		let ordinal = 1;
		const wanted = snapshot.hasFile ? count : count - 1;
		for (let index = 0; index < wanted; index++) {
			const next = await this.cardStore.nextFreeName(parent, parts.base, extension, ordinal);
			if (drafts.includes(next)) {
				throw new Error('The same name was chosen twice.');
			}
			drafts.push(next);
			ordinal = baseHalfGenerationNameOrdinal(next) + 1;
		}
		const childPath = (child: string) => parentPath ? `${parentPath}/${child}` : child;
		const paths = snapshot.hasFile ? drafts.map(childPath) : [snapshot.path, ...drafts.map(childPath)];
		return { paths: Object.freeze(paths), drafts: Object.freeze(drafts) };
	}

	/**
	 * Step 5 and again at step 7: of the records that are not ended and name
	 * one of the cards, the one written first keeps them. A record left in
	 * `preparing` by a window that is gone claims nothing: nothing was sent.
	 */
	private async claim(task: IBaseHalfGenerationTask): Promise<void> {
		const folder = this.taskStore.folderOf(task.id);
		await this.taskStore.refresh(folder);
		const now = Date.now();
		const rivals = this.taskStore.list().filter(other => other.id !== task.id
			&& this.taskStore.folderOf(other.id)?.toString() === folder?.toString()
			&& !isBaseHalfGenerationTaskEnded(other)
			&& !(other.state === 'preparing' && isBaseHalfGenerationTaskStale(other, now))
			&& task.cards.some(card => baseHalfGenerationTaskNamesCard(other, card.path)));
		if (rivals.length && baseHalfGenerationClaimWinner([this.taskStore.get(task.id) ?? task, ...rivals])?.id !== task.id) {
			throw generatingError();
		}
	}

	/** A card that generates again leaves the record of its earlier generation that ended without its file. */
	private async removeEndedRecordsOf(task: IBaseHalfGenerationTask): Promise<void> {
		const folder = this.taskStore.folderOf(task.id)?.toString();
		for (const other of this.taskStore.list()) {
			if (other.id !== task.id && isBaseHalfGenerationTaskEnded(other) && this.taskStore.folderOf(other.id)?.toString() === folder
				&& task.cards.some(card => baseHalfGenerationTaskNamesCard(other, card.path))) {
				await this.taskStore.remove(other.id);
			}
		}
	}

	/**
	 * Step 6: the access to the provider, the inputs planned from the mode's
	 * slots and read, the prompt, and the provider module's check of the
	 * planned generation with its files. Writes nothing.
	 */
	private async prepare(follow: FollowedGeneration, task: IBaseHalfGenerationTask, snapshot: IBaseHalfGenerationCardSnapshot, ref: IBaseHalfVideoModelRef, mode: IBaseHalfVideoCatalogMode, token: CancellationToken): Promise<IPreparedGeneration> {
		const info = snapshot.info;
		let access: IBaseHalfVideoProviderAccess | undefined;
		try {
			access = await this.providerSettings.getAccess(ref.provider);
		} catch (error) {
			throw new BaseHalfVideoGenerationError(getErrorMessage(error));
		}
		throwIfCancelled(token);
		if (!access) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'notSetUp', provider: ref.provider }));
		}
		const providerModel = ref.model.providerModels[access.region];
		if (!providerModel) {
			const region = ref.provider.regions.find(candidate => candidate.id === access.region) ?? ref.provider.regions[0];
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'region', model: ref.model, region }));
		}
		const resolved = await this.cardStore.resolveInputs(snapshot);
		throwIfCancelled(token);
		const plan = planBaseHalfVideoInputs(mode.inputs, resolved);
		const draft = plan.find(item => item.reason === 'draft');
		if (draft) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'draftInput', path: draft.path }));
		}
		const params = normalizeBaseHalfVideoParams(ref.model, mode.id, info.params);
		// What is sent and recorded: without the values a start frame sets.
		const sent = baseHalfVideoSentParams(ref.model, mode.id, params, plan.some(item => item.use === 'start-frame'));
		const texts: string[] = [];
		const used: string[] = [];
		for (const [index, item] of plan.entries()) {
			if (item.use === 'unused') {
				continue;
			}
			used.push(item.path);
			if (item.use === 'text') {
				texts.push(await this.readText(resolved[index], item));
				throwIfCancelled(token);
			}
		}
		const inputs = await this.prepareInputMedia(plan, resolved, mode.limits.imageFormats ?? BASEHALF_VIDEO_IMAGE_FORMATS, token);
		const sentPrompt = buildBaseHalfVideoPrompt(info.prompt, texts);
		if (!sentPrompt && !inputs.startFrame && !inputs.endFrame && !inputs.source && !inputs.images.length && !inputs.videos.length && !inputs.audios.length) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'nothingToSend' }));
		}
		// The provider module checks the planned generation with its files:
		// sizes, lengths, counts, the prompt, and the rules between values.
		const checked = await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.check, {
			provider: ref.provider.id,
			region: access.region,
			model: ref.model.id,
			mode: mode.id,
			params: sent,
			prompt: sentPrompt,
			inputs
		}, parseBaseHalfVideoCheckResult, false);
		throwIfCancelled(token);
		if (!checked.ok) {
			throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.checkFailed', "AI Video could not check the generation, and nothing was sent: {0}", errorDetail(checked.error, Object.values(access.credentials))));
		}
		const problem = checked.value.problems[0];
		if (problem) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'check', message: problem }));
		}
		const record: IBaseHalfGenerationRequest = {
			provider: ref.provider.id,
			region: access.region,
			model: ref.model.id,
			// The id the module would send, where the mode and inputs choose among several.
			providerModel: checked.value.providerModel ?? providerModel,
			mode: mode.id,
			params: sent,
			// The card's own prompt: the text of its notes stays on this computer.
			prompt: info.prompt,
			inputs: used
		};
		const request: IBaseHalfVideoSubmitRequest = {
			...access,
			model: ref.model.id,
			mode: mode.id,
			params: sent,
			prompt: sentPrompt,
			inputs,
			targets: task.cards.map((_card, index) => this.taskStore.partFile(task, index).fsPath)
		};
		return { access, request, record, sentPrompt, lastUsed: { provider: ref.provider.id, model: ref.model.id, mode: mode.id, params } };
	}

	/** The catalog, waiting while it loads; refuses with the reason it is not there. */
	private async catalog(): Promise<IBaseHalfVideoCatalog> {
		try {
			return await this.catalogService.whenReady(BASEHALF_VIDEO_CATALOG_WAIT);
		} catch (error) {
			const state = this.catalogService.state;
			const blocker: BaseHalfVideoGenerateBlocker = state.kind === 'failed'
				? { kind: 'catalogFailed', message: state.message }
				: state.kind === 'loading'
					? { kind: 'catalogLoading' }
					: { kind: 'catalogFailed', message: getErrorMessage(error) };
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText(blocker));
		}
	}

	private async readText(input: IBaseHalfVideoResolvedInput, item: IBaseHalfVideoInputPlanItem): Promise<string> {
		const file = input.file;
		if (!file) {
			throw new BaseHalfVideoGenerationError(missingInputMessage(item.path));
		}
		try {
			return await readBaseHalfVideoTextInput(this.fileService, file);
		} catch {
			throw new BaseHalfVideoGenerationError(missingInputMessage(item.path));
		}
	}

	async prepareInputMedia(plan: readonly IBaseHalfVideoInputPlanItem[], inputs: readonly IBaseHalfVideoResolvedInput[], imageFormats: readonly BaseHalfVideoImageFormat[], token: CancellationToken = CancellationToken.None): Promise<IBaseHalfVideoPlannedMedia> {
		const media: { startFrame?: BaseHalfVideoMedia; endFrame?: BaseHalfVideoMedia; source?: BaseHalfVideoMedia; images: BaseHalfVideoMedia[]; videos: BaseHalfVideoMedia[]; audios: BaseHalfVideoMedia[] } = { images: [], videos: [], audios: [] };
		for (const [index, item] of plan.entries()) {
			const input = inputs[index];
			switch (item.use) {
				case 'start-frame':
					media.startFrame = await this.prepareMedia(input, item, 'image', imageFormats);
					break;
				case 'end-frame':
					media.endFrame = await this.prepareMedia(input, item, 'image', imageFormats);
					break;
				case 'source':
					media.source = await this.prepareMedia(input, item, 'video');
					break;
				case 'reference':
					if (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio') {
						const prepared = await this.prepareMedia(input, item, item.kind, imageFormats);
						(item.kind === 'image' ? media.images : item.kind === 'video' ? media.videos : media.audios).push(prepared);
					}
					break;
			}
			throwIfCancelled(token);
		}
		return Object.freeze({
			...(media.startFrame ? { startFrame: media.startFrame } : {}),
			...(media.endFrame ? { endFrame: media.endFrame } : {}),
			images: Object.freeze(media.images),
			videos: Object.freeze(media.videos),
			audios: Object.freeze(media.audios),
			...(media.source ? { source: media.source } : {})
		});
	}

	/** An image as a local file of a format the mode takes, or drawn to PNG; a video or audio as a local file. The provider module measures them. */
	private async prepareMedia(input: IBaseHalfVideoResolvedInput, item: IBaseHalfVideoInputPlanItem, kind: 'image' | 'video' | 'audio', imageFormats: readonly BaseHalfVideoImageFormat[] = BASEHALF_VIDEO_IMAGE_FORMATS): Promise<BaseHalfVideoMedia> {
		const file = input.file;
		if (!file) {
			throw new BaseHalfVideoGenerationError(missingInputMessage(item.path));
		}
		let size: number;
		let mtime: number;
		try {
			const stat = await this.fileService.stat(file);
			if (stat.isDirectory) {
				throw new Error('directory');
			}
			size = stat.size;
			mtime = stat.mtime;
		} catch {
			throw new BaseHalfVideoGenerationError(missingInputMessage(item.path));
		}
		if (file.scheme !== Schemas.file) {
			throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.inputNotLocal', "{0} is not a file on this computer.", inputName(item.path)));
		}
		const extension = extname(file).toLowerCase();
		if (kind === 'image') {
			const direct = DIRECT_IMAGE_TYPES[extension];
			const format = DIRECT_IMAGE_FORMATS[extension];
			if (direct && format && imageFormats.includes(format)) {
				return { fsPath: file.fsPath, mimeType: direct };
			}
			if (size > RASTER_MAX_BYTES) {
				throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.imageTooLargeToDraw', "{0} is larger than 64 MiB, which BaseHalf does not draw as a PNG.", inputName(item.path)));
			}
			const key = `${file.toString()}|${mtime}|${size}`;
			const drawn = this.drawnImages.get(key);
			if (drawn) {
				return { dataUrl: drawn };
			}
			try {
				const bytes = (await this.fileService.readFile(file)).value;
				const dataUrl = await this.rasterize(bytes, direct ?? RASTER_IMAGE_TYPES[extension] ?? 'image/*');
				this.drawnImages.set(key, dataUrl);
				if (this.drawnImages.size > DRAWN_IMAGES_KEPT) {
					this.drawnImages.delete(this.drawnImages.keys().next().value!);
				}
				return { dataUrl };
			} catch (error) {
				this.logService.warn(`[BaseHalf generation] Could not draw ${item.path} to PNG: ${getErrorMessage(error)}`);
				throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.imageUnreadable', "BaseHalf could not read the image {0}.", inputName(item.path)));
			}
		}
		const types = kind === 'video' ? VIDEO_TYPES : AUDIO_TYPES;
		return { fsPath: file.fsPath, mimeType: types[extension] ?? 'application/octet-stream' };
	}

	// --- running -------------------------------------------------------------------------------

	/** Step 8: send the request once; record the provider's task id, or land what it answered with. */
	private async submit(follow: FollowedGeneration, request: IBaseHalfVideoSubmitRequest, lastUsed: IBaseHalfVideoGenerationChoice): Promise<void> {
		const answer = await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.submit, request, parseSubmitResult, true);
		if (answer.ok && hasKey(answer.value, { remoteId: true })) {
			follow.remoteId = answer.value.remoteId;
		}
		if (follow.stopped || follow.ended) {
			// Stopped while the request was on its way: a task the provider made
			// after all is cancelled, and files that came with the answer go.
			if (answer.ok && hasKey(answer.value, { remoteId: true })) {
				await this.cancelRemote(follow);
			}
			await this.deleteParts(follow);
			return;
		}
		if (!answer.ok) {
			await this.fail(follow, submitFailureMessage(answer, follow.secrets()));
			return;
		}
		follow.lastUsed = lastUsed;
		if (hasKey(answer.value, { outputs: true })) {
			await this.land(follow, answer.value.outputs.map(sourceOfOutput));
			return;
		}
		const remoteId = answer.value.remoteId;
		const running = await this.taskStore.update(follow.taskId, task => task.state === 'submitting' ? runBaseHalfGenerationTask(task, remoteId) : task);
		if (running?.state !== 'running' || running.follower !== this.follower) {
			// The record was stopped or taken meanwhile: nobody follows this task,
			// so it is cancelled where the provider allows it.
			this.logService.info(`[BaseHalf generation] ${follow.taskId} changed while its request was sent.`);
			await this.cancelRemote(follow);
			this.untrack(follow);
			return;
		}
		this.schedulePoll(follow, BASEHALF_VIDEO_FIRST_POLL_DELAY);
	}

	private schedulePoll(follow: FollowedGeneration, delay: number): void {
		follow.timer?.dispose();
		const timer = disposableTimeout(() => {
			timer.dispose();
			if (follow.timer === timer) {
				follow.timer = undefined;
			}
			void this.poll(follow).catch(error => this.pollFailedUnexpectedly(follow, error));
		}, delay);
		follow.timer = timer;
	}

	/** Something failed after the request may have left: it is never sent again. */
	private async submitFailedUnexpectedly(follow: FollowedGeneration, error: unknown): Promise<void> {
		this.logService.error(`[BaseHalf generation] The request of ${follow.taskId} failed: ${getErrorMessage(error)}`);
		if (!follow.stopped && !follow.ended) {
			await this.fail(follow, `${unknownOutcomeMessage()} (${plainDetail(getErrorMessage(error), follow.secrets())})`);
		}
	}

	/** Something failed while following the task: ask again later, as after a network error. */
	private async pollFailedUnexpectedly(follow: FollowedGeneration, error: unknown): Promise<void> {
		this.logService.warn(`[BaseHalf generation] Following ${follow.taskId} failed: ${getErrorMessage(error)}`);
		if (!follow.stopped && !follow.ended) {
			await this.pollFailed(follow, { ok: false, unavailable: true, error: { code: 'network', message: getErrorMessage(error) } });
		}
	}

	/** Step 9: ask the provider about the task. */
	private async poll(follow: FollowedGeneration): Promise<void> {
		if (follow.stopped || follow.ended) {
			return;
		}
		if (Date.now() - follow.startedAt >= BASEHALF_VIDEO_TASK_TIME_LIMIT) {
			await this.fail(follow, tooLongMessage(follow.kind));
			return;
		}
		if (!await this.stillFollowed(follow)) {
			return;
		}
		// A target is written only as a new file: one an earlier poll left is removed first.
		await this.deleteUnreceivedParts(follow);
		const answer = await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.poll, { ...follow.taskRef(), targets: this.targetsOf(follow) }, parsePollState, false);
		if (follow.stopped || follow.ended) {
			return;
		}
		if (!answer.ok) {
			await this.pollFailed(follow, answer);
			return;
		}
		follow.transientSince = undefined;
		follow.unreadableAnswers = 0;
		const state = answer.value;
		switch (state.state) {
			case 'pending':
			case 'running':
				this.setPhase(follow, state.state === 'pending' ? 'waiting' : 'generating', state.fraction);
				this.schedulePoll(follow, BASEHALF_VIDEO_POLL_INTERVAL);
				return;
			case 'failed':
				await this.fail(follow, localize('basehalf.video.generation.remoteFailed', "The provider could not make it: {0}", plainDetail(state.message, follow.secrets())));
				return;
			case 'cancelled':
				await this.fail(follow, localize('basehalf.video.generation.remoteCancelled', "The provider cancelled the generation: {0}", plainDetail(state.message, follow.secrets())));
				return;
			case 'succeeded':
				await this.land(follow, state.outputs ? state.outputs.map(sourceOfOutput) : [{ kind: 'download', ...(state.videoUrl ? { url: state.videoUrl } : {}) }]);
				return;
		}
	}

	private async pollFailed(follow: FollowedGeneration, answer: Extract<ProviderAnswer<unknown>, { ok: false }>): Promise<void> {
		const error = answer.error;
		const detail = errorDetail(error, follow.secrets());
		if (!answer.unavailable) {
			if (error.code === 'auth') {
				await this.fail(follow, localize('basehalf.video.generation.pollRefusedKey', "The provider refused the credentials while BaseHalf asked about the generation: {0}", detail));
				return;
			}
			if (error.code === 'notFound') {
				await this.fail(follow, localize('basehalf.video.generation.pollUnknownTask', "The provider does not know this task: {0}", detail));
				return;
			}
			if (error.code === 'rejected' || error.code === 'unknownProvider') {
				await this.fail(follow, localize('basehalf.video.generation.pollRejected', "The provider refused to tell about the generation: {0}", detail));
				return;
			}
			if (error.code === 'invalidResponse' && ++follow.unreadableAnswers >= UNREADABLE_ANSWERS) {
				await this.fail(follow, localize('basehalf.video.generation.pollUnreadable', "The provider answers about the generation in a form BaseHalf cannot read. Check the provider's console: {0}", detail));
				return;
			}
		}
		// A network error, an overloaded provider, or AI Video restarting: ask
		// again at the next interval, for up to 30 minutes in a row.
		const now = Date.now();
		follow.transientSince ??= now;
		if (now - follow.transientSince >= BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT) {
			await this.fail(follow, localize('basehalf.video.generation.lostContact', "BaseHalf could not reach the provider for 30 minutes. The generation may still finish there: check the provider's console. ({0})", detail));
			return;
		}
		this.schedulePoll(follow, BASEHALF_VIDEO_POLL_INTERVAL);
	}

	// --- landing -------------------------------------------------------------------------------

	/**
	 * Step 10: each file lands on its card in the order of the outputs. The
	 * record is `landing` from the moment the provider has the files. Each file
	 * that is received in full, downloaded or written by AI Video, is checked
	 * and its size and SHA-256 written into the record before it lands, so
	 * that a window that takes the record over lands it again without a second
	 * download; a file received only in part is asked for again. An output the
	 * provider refused fails its card alone, and the cards that no output
	 * reaches fail as the ones the provider made nothing for.
	 */
	private land(follow: FollowedGeneration, sources: readonly LandingSource[] | undefined): Promise<void> {
		const previous = follow.landing ?? Promise.resolve();
		const landing = previous.then(() => this.doLand(follow, sources));
		follow.landing = landing.catch(() => undefined);
		return landing;
	}

	private async doLand(follow: FollowedGeneration, sources: readonly LandingSource[] | undefined): Promise<void> {
		if (follow.stopped || follow.ended) {
			await this.deleteParts(follow);
			return;
		}
		this.setPhase(follow, 'saving');
		const task = await this.taskStore.update(follow.taskId, current => current.state === 'submitting' || current.state === 'running' ? landBaseHalfGenerationTask(current) : current);
		if (task?.state !== 'landing' || task.follower !== this.follower) {
			await this.deleteParts(follow);
			this.untrack(follow);
			return;
		}
		let retry = false;
		for (let index = 0; index < task.cards.length; index++) {
			if (follow.stopped || follow.ended) {
				break;
			}
			const card = this.taskStore.get(follow.taskId)?.cards[index];
			if (!card || card.state !== 'waiting') {
				continue;
			}
			try {
				if (card.landing) {
					await this.recoverLanding(follow, index);
					continue;
				}
				const received = sources ? await this.receive(follow, index, sources[index]) : await this.receiveAgain(follow, index);
				if (received === 'retry') {
					retry = true;
				} else if (received !== 'failed') {
					await this.landFile(follow, index, received.part, received.format);
				}
			} catch (error) {
				this.logService.error(`[BaseHalf generation] Card ${index + 1} of ${follow.taskId} could not land: ${getErrorMessage(error)}`);
				await this.failCard(follow, index, saveFailedMessage(follow.kind, error));
			}
		}
		if (follow.stopped || follow.ended) {
			await this.deleteParts(follow);
			return;
		}
		if (retry && follow.remoteId && follow.access) {
			// An address may have expired, or a file came only in part: the provider is asked again for what is left.
			this.schedulePoll(follow, BASEHALF_VIDEO_POLL_INTERVAL);
			return;
		}
		await this.settle(follow);
	}

	/**
	 * Receives the output of one card into its partial download: downloads it
	 * when it is an address, checks it, and writes its size and SHA-256 into
	 * the record.
	 */
	private async receive(follow: FollowedGeneration, index: number, source: LandingSource | undefined): Promise<{ readonly part: URI; readonly format: BaseHalfVideoOutputFormat } | 'failed' | 'retry'> {
		const task = this.taskStore.get(follow.taskId)!;
		const part = this.taskStore.partFile(task, index);
		if (!source) {
			await this.failCard(follow, index, follow.kind === 'image'
				? localize('basehalf.video.generation.fewerImages', "The provider made fewer images than asked.")
				: localize('basehalf.video.generation.noFile', "The provider answered without the file."));
			return 'failed';
		}
		if (source.kind === 'refused') {
			await this.deleteQuietly(part);
			await this.failCard(follow, index, localize('basehalf.video.generation.outputRefused', "The provider refused this one: {0}", plainDetail(source.reason, follow.secrets())));
			return 'failed';
		}
		if (source.kind === 'written') {
			if (!this.uriIdentityService.extUri.isEqual(URI.file(source.path), part)) {
				this.logService.warn(`[BaseHalf generation] AI Video wrote ${source.path}, not ${part.fsPath}.`);
			}
		} else {
			const downloaded = await this.download(follow, index, part, source.url);
			if (downloaded !== 'downloaded') {
				return downloaded;
			}
		}
		const checked = await this.checkFile(follow, part);
		if (hasKey(checked, { problem: true })) {
			await this.deleteQuietly(part);
			await this.failCard(follow, index, checked.problem);
			return 'failed';
		}
		const size = (await this.fileService.stat(part)).size;
		const sha256 = await this.sha256(part);
		const marked = await this.taskStore.update(follow.taskId, current => current.state === 'landing' && current.cards[index]?.state === 'waiting'
			? recordBaseHalfGenerationLanding(current, index, { path: current.cards[index].path, size, sha256 })
			: current);
		if (!marked?.cards[index]?.landing) {
			// Stopped, or this card was deleted meanwhile: its file is not kept.
			await this.deleteQuietly(part);
			return 'failed';
		}
		return { part, format: checked.format };
	}

	/**
	 * A card that a taken-over record lands on and whose file was not received
	 * in full: a partial download or a target of an earlier poll is removed,
	 * and the provider is asked again; a provider that answered at once cannot
	 * be asked again.
	 */
	private async receiveAgain(follow: FollowedGeneration, index: number): Promise<'failed' | 'retry'> {
		await this.deleteQuietly(this.taskStore.partFile(this.taskStore.get(follow.taskId)!, index));
		if (follow.remoteId && follow.access) {
			return 'retry';
		}
		await this.failCard(follow, index, closedWhileSavingMessage());
		return 'failed';
	}

	private async download(follow: FollowedGeneration, index: number, part: URI, url: string | undefined): Promise<'downloaded' | 'failed' | 'retry'> {
		if (!follow.access) {
			await this.failCard(follow, index, closedWhileSavingMessage());
			return 'failed';
		}
		// AI Video writes only a file that is not there: a download cut short before is gone first.
		await this.deleteQuietly(part);
		const answer = await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.download, {
			...follow.taskRef(),
			...(url !== undefined ? { url } : {}),
			kind: follow.kind,
			targetFsPath: part.fsPath
		}, parseDownloadResult, false);
		if (follow.stopped || follow.ended) {
			await this.deleteQuietly(part);
			return 'failed';
		}
		if (answer.ok) {
			return 'downloaded';
		}
		await this.deleteQuietly(part);
		const detail = errorDetail(answer.error, follow.secrets());
		if (!answer.unavailable && (answer.error.code === 'notVideo' || answer.error.code === 'notImage' || answer.error.code === 'tooLarge')) {
			await this.failCard(follow, index, notAcceptedMessage(follow.kind, detail));
			return 'failed';
		}
		const failures = (follow.downloadFailures.get(index) ?? 0) + 1;
		follow.downloadFailures.set(index, failures);
		if (failures >= DOWNLOAD_ATTEMPTS || !follow.remoteId) {
			await this.failCard(follow, index, localize('basehalf.video.generation.downloadFailed', "The provider made it, but BaseHalf could not download it. Check the provider's console: {0}", detail));
			return 'failed';
		}
		return 'retry';
	}

	/** Landing, step 1's check: the format and the size the kind takes. Returns the format, or why the file is not taken. */
	private async checkFile(follow: FollowedGeneration, part: URI): Promise<{ readonly format: BaseHalfVideoOutputFormat } | { readonly problem: string }> {
		let size: number;
		let head: Uint8Array;
		try {
			size = (await this.fileService.stat(part)).size;
			head = (await this.fileService.readFile(part, { length: FORMAT_HEAD_BYTES })).value.buffer;
		} catch (error) {
			return { problem: saveFailedMessage(follow.kind, error) };
		}
		const format = baseHalfGenerationFileFormat(head);
		if (!format || !isBaseHalfGenerationFileAccepted(follow.kind, format, size)) {
			return {
				problem: notAcceptedMessage(follow.kind, size > BASEHALF_GENERATION_MAX_FILE_BYTES[follow.kind]
					? localize('basehalf.video.generation.sizeDetail', "{0} bytes", size)
					: format ?? localize('basehalf.video.generation.unknownFormat', "an unknown format"))
			};
		}
		return { format };
	}

	/**
	 * Steps 2 to 6 of landing for one received file, inside the workspace
	 * mutation lease, so that no move or rename runs between deciding the
	 * file's place and moving it there. A format other than the draft's
	 * extension first renames the draft, which writes its new path into the
	 * record. Then the path is read from the record again; a draft that was
	 * deleted meanwhile gets no file; a folder that is gone is made again; the
	 * record says where the file is being moved; the file is moved into place
	 * without replacing anything, to the next free name beside the card with a
	 * copy of its `generation.yaml` when its path is taken by then; and
	 * `made.yaml` is written.
	 */
	private async landFile(follow: FollowedGeneration, index: number, part: URI, format: BaseHalfVideoOutputFormat): Promise<void> {
		await this.mutationCoordinator.runExclusive(follow.folder, async lease => {
			await this.renameForFormat(follow, index, format, lease);
			for (let attempt = 1; attempt <= LANDING_ATTEMPTS; attempt++) {
				const task = await this.taskStore.update(follow.taskId, current => current);
				const card = task?.cards[index];
				if (!task || !card?.landing || card.state !== 'waiting' || task.state !== 'landing' || task.follower !== this.follower || follow.stopped) {
					// Stopped, or this card was deleted meanwhile: its file is not kept.
					await this.deleteQuietly(part);
					return;
				}
				const resource = this.resourceOf(follow.folder, card.path);
				const facts = await baseHalfReadDraftFacts(this.fileService, follow.folder, card.path);
				if (!facts.itemExists && !baseHalfIsDraftInformation(facts)) {
					// The draft was deleted while it generated (generation cards, "Deleting"): its file is not landed.
					await this.deleteQuietly(part);
					await this.failCard(follow, index, cardDeletedMessage());
					return;
				}
				const parent = dirname(resource);
				if (!await this.fileService.exists(parent)) {
					await this.fileService.createFolder(parent);
				}
				const target = await this.fileService.exists(resource) ? await this.besideTakenCard(follow, resource) : resource;
				const landing = card.landing;
				const marked = await this.taskStore.update(follow.taskId, current => current.state === 'landing' && current.cards[index]?.state === 'waiting'
					? recordBaseHalfGenerationLanding(current, index, { path: this.relativePath(follow.folder, target), size: landing.size, sha256: landing.sha256 })
					: current);
				if (marked?.cards[index]?.landing?.path !== this.relativePath(follow.folder, target)) {
					await this.deleteQuietly(part);
					return;
				}
				try {
					await this.fileService.move(part, target, false);
				} catch (error) {
					if (isMoveConflict(error) && attempt < LANDING_ATTEMPTS) {
						// The name was taken at the last moment, outside BaseHalf: take the next one.
						continue;
					}
					throw error;
				}
				await this.finishLanding(follow, index, target);
				if (!this.uriIdentityService.extUri.isEqual(target, resource)) {
					await placeBaseHalfCardsBeside(this.placementServices(), baseHalfParentCanvasFolder({ resource, workspaceFolder: follow.folder, relativePath: card.path }), card.path,
						[{ path: this.relativePath(follow.folder, target), size: BASEHALF_GENERATION_CARD_SIZE[follow.kind] }], { lease });
				}
				return;
			}
		});
	}

	/**
	 * Landing, step 2: a file of another format than the draft's extension
	 * renames the draft to that format's extension, inside the lease that the
	 * landing holds.
	 */
	private async renameForFormat(follow: FollowedGeneration, index: number, format: BaseHalfVideoOutputFormat, lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		const card = this.taskStore.get(follow.taskId)?.cards[index];
		if (!card || baseHalfGenerationExtensionMatchesFormat(card.path, format)) {
			return;
		}
		const resource = this.resourceOf(follow.folder, card.path);
		const snapshot = await this.cardStore.read(resource).catch(() => undefined);
		if (!snapshot || snapshot.hasFile || snapshot.made) {
			// Not a draft any more: the file lands beside it under the card's name.
			return;
		}
		const name = basename(resource);
		const parts = baseHalfGenerationNameParts(name);
		const extension = baseHalfGenerationFormatExtension(format);
		const next = await this.cardStore.nextFreeName(dirname(resource), parts.base, extension, baseHalfGenerationNameOrdinal(name));
		try {
			await this.draftOperations.move(resource, URI.joinPath(dirname(resource), next), { lease });
		} catch (error) {
			// The file still lands, under the path the record holds.
			this.logService.warn(`[BaseHalf generation] ${card.path} could not be renamed to ${next}: ${getErrorMessage(error)}`);
		}
	}

	/** The next free name beside a card whose path is taken, with a copy of the card's `generation.yaml`. */
	private async besideTakenCard(follow: FollowedGeneration, resource: URI): Promise<URI> {
		const parent = dirname(resource);
		const name = basename(resource);
		const parts = baseHalfGenerationNameParts(name);
		const free = await this.cardStore.nextFreeName(parent, parts.base, parts.extension, baseHalfGenerationNameOrdinal(name));
		const info = await this.cardStore.read(resource).then(snapshot => snapshot.info, () => undefined);
		await this.cardStore.createDraft(parent, free, info ?? this.infoOfRecord(follow) ?? { prompt: '' });
		return URI.joinPath(parent, free);
	}

	/** What the generation used, as generation information: for a copy whose card has none. */
	private infoOfRecord(follow: FollowedGeneration): IBaseHalfGenerationInfo | undefined {
		const request = this.taskStore.get(follow.taskId)?.request;
		return request ? { prompt: request.prompt, provider: request.provider, model: request.model, mode: request.mode, params: request.params } : undefined;
	}

	/** Landing, step 6: `made.yaml`, and the card is landed. */
	private async finishLanding(follow: FollowedGeneration, index: number, target: URI): Promise<void> {
		const task = this.taskStore.get(follow.taskId);
		if (!task) {
			return;
		}
		const made = baseHalfGenerationMadeOfTask(task, index, new Date(Date.now()).toISOString());
		try {
			await this.cardStore.writeMade(target, made);
		} catch (error) {
			// Written before a crash: the record of this generation is there already.
			const existing = await this.cardStore.read(target).then(snapshot => snapshot.made, () => undefined);
			if (existing?.id !== made.id) {
				throw error;
			}
		}
		await this.taskStore.update(follow.taskId, current => current.cards[index]?.state === 'waiting' && current.state === 'landing' ? recordBaseHalfGenerationLanded(current, index) : current);
		this.fireCards(follow);
	}

	/**
	 * A card whose record says what was being landed (generation cards,
	 * "Landing"): the file at the recorded path with the recorded size and
	 * SHA-256 was moved into place before a crash, and only step 6 is left; a
	 * partial download that matches them was received in full and lands now.
	 */
	private async recoverLanding(follow: FollowedGeneration, index: number): Promise<void> {
		const task = this.taskStore.get(follow.taskId);
		const landing = task?.cards[index]?.landing;
		if (!task || !landing) {
			return;
		}
		const target = this.resourceOf(follow.folder, landing.path);
		const part = this.taskStore.partFile(task, index);
		if (await this.matches(target, landing.size, landing.sha256)) {
			await this.mutationCoordinator.runExclusive(follow.folder, () => this.finishLanding(follow, index, target));
			return;
		}
		if (await this.matches(part, landing.size, landing.sha256)) {
			const checked = await this.checkFile(follow, part);
			if (hasKey(checked, { format: true })) {
				await this.landFile(follow, index, part, checked.format);
				return;
			}
		}
		await this.failCard(follow, index, closedWhileSavingMessage());
	}

	private async matches(resource: URI, size: number, sha256: string): Promise<boolean> {
		try {
			return (await this.fileService.stat(resource)).size === size && await this.sha256(resource) === sha256;
		} catch {
			return false;
		}
	}

	/** The SHA-256 of a file in lower-case hex, read where the file is. */
	private async sha256(resource: URI): Promise<string> {
		const checksum = await this.checksumService.checksum(resource);
		return [...decodeBase64(checksum).buffer.subarray(0, 32)].map(byte => byte.toString(16).padStart(2, '0')).join('');
	}

	/**
	 * When every card has landed or failed: the record of a generation that
	 * landed every file is removed; one with a card that got no file stays, so
	 * that the card can say why, unless every such card is gone.
	 */
	private async settle(follow: FollowedGeneration): Promise<void> {
		const task = await this.taskStore.update(follow.taskId, current => current);
		if (!task || !isBaseHalfGenerationTaskSettled(task)) {
			return;
		}
		const landed = task.cards.filter(card => card.state === 'landed').length;
		if (landed && follow.lastUsed) {
			// Step 11.
			this.providerSettings.setLastUsed(follow.lastUsed, follow.kind);
		}
		let gone = true;
		for (const card of task.cards) {
			if (card.state !== 'landed' && await this.cardExists(follow.folder, card.path)) {
				gone = false;
				break;
			}
		}
		if (gone) {
			await this.taskStore.remove(follow.taskId);
		} else if (!isBaseHalfGenerationTaskEnded(task)) {
			const error = task.cards.find(card => card.error)?.error ?? localize('basehalf.video.generation.notAll', "The provider did not make every file.");
			await this.taskStore.update(follow.taskId, current => failBaseHalfGenerationTask(current, error, new Date(Date.now()).toISOString()));
		}
		await this.deleteParts(follow);
		this.untrack(follow);
	}

	/** Whether a card has its file or is a draft. */
	private async cardExists(folder: URI, path: string): Promise<boolean> {
		const resource = this.resourceOf(folder, path);
		if (await this.fileService.exists(resource).catch(() => true)) {
			return true;
		}
		const snapshot = await this.cardStore.read(resource).catch(() => undefined);
		return !!snapshot && !snapshot.made;
	}

	// --- ending --------------------------------------------------------------------------------

	async stop(resource: URI): Promise<void> {
		const task = this.taskStore.forCard(resource);
		if (!task || isBaseHalfGenerationTaskEnded(task)) {
			return;
		}
		const follow = this.followed.get(task.id);
		if (follow) {
			follow.stopped = true;
			follow.preparation.cancel();
			follow.timer?.dispose();
		}
		const endedAt = new Date(Date.now()).toISOString();
		let stopped: IBaseHalfGenerationTask | undefined;
		try {
			stopped = await this.taskStore.update(task.id, current => stopBaseHalfGenerationTask(current, endedAt));
		} catch (error) {
			this.logService.info(`[BaseHalf generation] Could not record the stop of ${task.id}: ${getErrorMessage(error)}`);
		}
		if (follow) {
			this.untrack(follow);
		}
		// The provider is asked to cancel where it can; nothing waits for it.
		const record = stopped ?? task;
		const remoteId = follow?.remoteId ?? record.remoteId;
		if (remoteId && record.request) {
			try {
				const access = follow?.access ?? await this.accessOfTask(record);
				if (access && !follow?.cancelSent) {
					if (follow) {
						follow.cancelSent = true;
					}
					await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.cancel, { ...access, model: record.request.model, remoteId }, parseAnything, false);
				}
			} catch (error) {
				this.logService.info(`[BaseHalf generation] Could not ask the provider to cancel ${remoteId}: ${getErrorMessage(error)}`);
			}
		}
		await this.deletePartsOf(record);
	}

	async releaseCard(resource: URI): Promise<void> {
		const located = this.locate(resource);
		const task = this.taskStore.forCard(resource);
		if (!located || !task || isBaseHalfGenerationTaskEnded(task)) {
			return;
		}
		const index = task.cards.findIndex(card => card.path === located.path);
		if (index < 0 || task.cards[index].state !== 'waiting') {
			return;
		}
		if (task.cards.filter(card => card.state === 'waiting').length === 1 && task.cards.length === 1) {
			await this.stop(resource);
			return;
		}
		await this.taskStore.update(task.id, current => current.cards[index]?.state === 'waiting' ? failBaseHalfGenerationCard(current, index, cardDeletedMessage()) : current);
		const follow = this.followed.get(task.id);
		if (follow && !follow.landing) {
			await this.settle(follow);
		}
	}

	/** Best effort: providers cancel only some tasks, and nothing waits for it. */
	private async cancelRemote(follow: FollowedGeneration): Promise<void> {
		if (follow.cancelSent || !follow.access || !follow.remoteId) {
			return;
		}
		follow.cancelSent = true;
		await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.cancel, follow.taskRef(), parseAnything, false);
	}

	private async fail(follow: FollowedGeneration, message: string): Promise<void> {
		follow.timer?.dispose();
		const endedAt = new Date(Date.now()).toISOString();
		try {
			await this.taskStore.update(follow.taskId, task => task.follower === this.follower ? failBaseHalfGenerationTask(task, message, endedAt) : task);
		} catch (error) {
			this.logService.info(`[BaseHalf generation] The failure of ${follow.taskId} was not written: ${getErrorMessage(error)}`);
		}
		await this.deleteParts(follow);
		this.untrack(follow);
	}

	private async failCard(follow: FollowedGeneration, index: number, message: string): Promise<void> {
		await this.taskStore.update(follow.taskId, task => task.cards[index]?.state === 'waiting' ? failBaseHalfGenerationCard(task, index, message) : task);
		this.fireCards(follow);
	}

	// --- continuing ----------------------------------------------------------------------------

	/**
	 * The records changed, in this window or another one: the cards whose
	 * generation changed hear it; a generation this window follows and that
	 * another window stopped or took over is let go; and a record that no
	 * window has said for 90 seconds it follows is taken over, settled, or
	 * removed (generation cards, "Continuing after a reload or a restart").
	 */
	private onDidChangeRecords(): void {
		if (this._store.isDisposed) {
			return;
		}
		const tasks = this.taskStore.list();
		const next = new Map(tasks.map(task => [task.id, JSON.stringify(task)]));
		for (const [id, text] of next) {
			if (this.seen.get(id) !== text) {
				this.fireTask(id, JSON.parse(text) as IBaseHalfGenerationTask);
				const previous = this.seen.get(id);
				if (previous) {
					this.fireTask(id, JSON.parse(previous) as IBaseHalfGenerationTask);
				}
			}
		}
		for (const [id, text] of this.seen) {
			if (!next.has(id)) {
				this.fireTask(id, JSON.parse(text) as IBaseHalfGenerationTask);
			}
		}
		this.seen = next;
		for (const follow of [...this.followed.values()]) {
			if (!follow.recorded || follow.ended) {
				continue;
			}
			const task = this.taskStore.get(follow.taskId);
			if (!task || isBaseHalfGenerationTaskEnded(task) || task.follower !== this.follower) {
				// Stopped, removed, or taken over elsewhere: this window lets it go.
				follow.stopped = !task || task.state === 'stopped' || follow.stopped;
				this.untrack(follow);
			} else {
				follow.paths = task.cards.map(card => card.path);
			}
		}
		for (const task of tasks) {
			if (!isBaseHalfGenerationTaskEnded(task) && !this.followed.has(task.id)) {
				this.considerTakeover(task);
			}
		}
	}

	private considerTakeover(task: IBaseHalfGenerationTask): void {
		if (this.takingOver.has(task.id)) {
			return;
		}
		const alive = Date.parse(task.aliveAt);
		const wait = (Number.isFinite(alive) ? alive : 0) + BASEHALF_GENERATION_STALE_MS - Date.now();
		if (wait > 0) {
			this.checkLater(task.id, wait + 1_000);
			return;
		}
		this.takingOver.add(task.id);
		void this.takeOver(task.id)
			.catch(error => this.logService.warn(`[BaseHalf generation] Could not continue ${task.id}: ${getErrorMessage(error)}`))
			.finally(() => this.takingOver.delete(task.id));
	}

	private async takeOver(taskId: string): Promise<void> {
		const task = this.taskStore.get(taskId);
		const folder = this.taskStore.folderOf(taskId);
		const now = Date.now();
		if (!task || !folder || isBaseHalfGenerationTaskEnded(task) || !isBaseHalfGenerationTaskStale(task, now) || this.followed.has(taskId)) {
			return;
		}
		const nowText = new Date(now).toISOString();
		const stale = (current: IBaseHalfGenerationTask) => !isBaseHalfGenerationTaskEnded(current) && isBaseHalfGenerationTaskStale(current, Date.now()) && current.follower === task.follower;
		switch (task.state) {
			case 'preparing':
				// Nothing was sent.
				if (stale((await this.taskStore.update(taskId, current => current)) ?? task)) {
					await this.taskStore.remove(taskId);
				}
				return;
			case 'submitting':
				// Never sent again: whether the provider has it is unknown.
				await this.taskStore.update(taskId, current => stale(current) && current.state === 'submitting'
					? failBaseHalfGenerationTask(current, current.answersAtOnce ? closedWhileAnsweringMessage() : orphanedSubmissionMessage(), nowText)
					: current);
				return;
		}
		const access = await this.accessOfTask(task);
		if (!access && task.state === 'running') {
			// The provider is not set up for this task on this computer: it waits
			// for a window that can follow it, until it is certainly over.
			if (now - Date.parse(task.startedAt) >= BASEHALF_VIDEO_TASK_TIME_LIMIT) {
				await this.taskStore.update(taskId, current => stale(current) ? failBaseHalfGenerationTask(current, tooLongMessage(current.kind), nowText) : current);
			} else {
				this.checkLater(taskId, BASEHALF_GENERATION_STALE_MS);
			}
			return;
		}
		const taken = await this.taskStore.update(taskId, current => stale(current) ? heartbeatBaseHalfGenerationTask(current, this.follower, nowText) : current);
		if (taken?.follower !== this.follower || this.followed.has(taskId)) {
			return;
		}
		const follow = new FollowedGeneration(taskId, folder, taken.kind, Date.parse(taken.startedAt) || now, taken.cards.map(card => card.path));
		follow.recorded = true;
		follow.access = access;
		follow.model = taken.request?.model;
		follow.remoteId = taken.remoteId;
		follow.lastUsed = taken.request ? { provider: taken.request.provider, model: taken.request.model, mode: taken.request.mode, params: taken.request.params } : undefined;
		this.track(follow);
		this.startHeartbeat();
		if (taken.state === 'running') {
			this.setPhase(follow, 'generating');
			this.schedulePoll(follow, BASEHALF_VIDEO_FIRST_POLL_DELAY);
		} else {
			void this.land(follow, undefined).catch(error => this.logService.warn(`[BaseHalf generation] Could not land ${taskId}: ${getErrorMessage(error)}`));
		}
	}

	private checkLater(taskId: string, delay: number): void {
		this.laterChecks.get(taskId)?.dispose();
		const timer = disposableTimeout(() => {
			timer.dispose();
			if (this.laterChecks.get(taskId) === timer) {
				this.laterChecks.delete(taskId);
			}
			const task = this.taskStore.get(taskId);
			if (task && !isBaseHalfGenerationTaskEnded(task) && !this.followed.has(taskId)) {
				this.considerTakeover(task);
			}
		}, delay);
		this.laterChecks.set(taskId, timer);
	}

	/** Every 30 seconds, while it follows generations, this window says it is alive in their records. */
	private startHeartbeat(): void {
		if (!this.heartbeatRunning) {
			this.heartbeatRunning = true;
			this.heartbeat.cancelAndSet(() => { void this.beat(); }, BASEHALF_GENERATION_HEARTBEAT_MS);
		}
	}

	private async beat(): Promise<void> {
		const follows = [...this.followed.values()].filter(follow => follow.recorded && !follow.ended);
		if (!follows.length) {
			this.heartbeatRunning = false;
			this.heartbeat.cancel();
			return;
		}
		const now = new Date(Date.now()).toISOString();
		for (const follow of follows) {
			try {
				const task = await this.taskStore.update(follow.taskId, current => current.follower === this.follower && !isBaseHalfGenerationTaskEnded(current)
					? heartbeatBaseHalfGenerationTask(current, this.follower, now)
					: current);
				if (!task || task.follower !== this.follower || isBaseHalfGenerationTaskEnded(task)) {
					follow.stopped = follow.stopped || !task || task.state === 'stopped';
					this.untrack(follow);
				}
			} catch (error) {
				this.logService.warn(`[BaseHalf generation] Could not say that ${follow.taskId} is followed: ${getErrorMessage(error)}`);
			}
		}
	}

	/** Whether this window still follows the generation: its record names this window and has not ended. */
	private async stillFollowed(follow: FollowedGeneration): Promise<boolean> {
		const task = await this.taskStore.update(follow.taskId, current => current).catch(() => undefined);
		if (!task || isBaseHalfGenerationTaskEnded(task) || task.follower !== this.follower) {
			follow.stopped = follow.stopped || !task || task.state === 'stopped';
			await this.deleteParts(follow);
			this.untrack(follow);
			return false;
		}
		return true;
	}

	/** The access a task is asked about with: its provider, in the region its request records. */
	private async accessOfTask(task: IBaseHalfGenerationTask): Promise<IBaseHalfVideoProviderAccess | undefined> {
		if (!task.request) {
			return undefined;
		}
		let catalog: IBaseHalfVideoCatalog;
		try {
			catalog = await this.catalogService.whenReady(BASEHALF_VIDEO_CATALOG_WAIT);
		} catch {
			return undefined;
		}
		const provider = findBaseHalfVideoProvider(catalog, task.request.provider);
		try {
			return provider ? await this.providerSettings.getAccess(provider, task.request.region) : undefined;
		} catch (error) {
			// Credentials that cannot be read now: the task waits, as for a provider not set up here.
			this.logService.info(`[BaseHalf generation] Could not read the credentials to follow a task: ${getErrorMessage(error)}`);
			return undefined;
		}
	}

	// --- undo of the drafts a generation made --------------------------------------------------

	/** The drafts a generation made are one step of the canvas undo stack (generation cards, "Starting", step 5). */
	private pushDraftsUndo(resource: URI, drafts: readonly URI[], info: IBaseHalfGenerationInfo): void {
		const folder = this.workspaceFolderOf(resource);
		const canvas = this.canvasMirrorService.canvasResource(baseHalfParentCanvasFolder({ resource, workspaceFolder: folder, relativePath: this.relativePath(folder, resource) }));
		this.undoRedoService.pushElement(new BaseHalfGeneratedDraftsUndoElement([canvas, ...drafts], drafts, JSON.stringify(info), {
			isGenerating: draft => this.isGenerating(draft),
			read: draft => this.cardStore.read(draft),
			draftOperations: this.draftOperations,
			notificationService: this.notificationService,
			undoRedoService: this.undoRedoService
		}), UndoRedoGroup.None, BASEHALF_CANVAS_UNDO_REDO_SOURCE);
	}

	// --- helpers -------------------------------------------------------------------------------

	private async callProvider<T>(command: string, argument: unknown, parse: (value: unknown) => T | undefined, isSubmit: boolean): Promise<ProviderAnswer<T>> {
		let raw: unknown;
		try {
			raw = await this.commandService.executeCommand(command, argument);
		} catch (error) {
			if (!CommandsRegistry.getCommand(command)) {
				// AI Video never registered the command: nothing was sent.
				return { ok: false, unavailable: true, error: { code: 'network', message: localize('basehalf.video.generation.extensionMissing', "AI Video, which sends the request, is not running.") } };
			}
			// AI Video stopped while it ran the command: for a request, whether it
			// reached the provider is unknown.
			return { ok: false, unavailable: !isSubmit, error: { code: isSubmit ? 'unknownOutcome' : 'network', message: getErrorMessage(error) } };
		}
		return parseProviderAnswer(raw, parse);
	}

	private track(follow: FollowedGeneration): void {
		this.followed.set(follow.taskId, follow);
		this.fireCards(follow);
	}

	private untrack(follow: FollowedGeneration): void {
		follow.ended = true;
		follow.timer?.dispose();
		follow.timer = undefined;
		if (this.followed.get(follow.taskId) === follow) {
			this.followed.delete(follow.taskId);
			this.fireCards(follow);
		}
		follow.preparation.dispose();
	}

	private setPhase(follow: FollowedGeneration, phase: BaseHalfVideoGenerationPhase, fraction?: number): void {
		if (follow.ended || (follow.phase === phase && follow.fraction === fraction)) {
			return;
		}
		follow.phase = phase;
		follow.fraction = fraction;
		this.fireCards(follow);
	}

	private fireCards(follow: FollowedGeneration): void {
		const paths = this.taskStore.get(follow.taskId)?.cards.map(card => card.path) ?? follow.paths;
		follow.paths = paths;
		for (const path of paths) {
			this._onDidChangeProgress.fire(this.resourceOf(follow.folder, path));
		}
	}

	private fireTask(taskId: string, task: IBaseHalfGenerationTask): void {
		const folder = this.taskStore.folderOf(taskId) ?? this.followed.get(taskId)?.folder;
		if (folder) {
			for (const card of task.cards) {
				this._onDidChangeProgress.fire(this.resourceOf(folder, card.path));
			}
		}
	}

	private targetsOf(follow: FollowedGeneration): readonly string[] {
		const task = this.taskStore.get(follow.taskId);
		return task ? task.cards.map((_card, index) => this.taskStore.partFile(task, index).fsPath) : [];
	}

	/** The partial downloads of the cards that wait and whose files were not received in full. */
	private async deleteUnreceivedParts(follow: FollowedGeneration): Promise<void> {
		const task = this.taskStore.get(follow.taskId);
		if (task && this.taskStore.folderOf(task.id)) {
			for (const [index, card] of task.cards.entries()) {
				if (card.state === 'waiting' && !card.landing) {
					await this.deleteQuietly(this.taskStore.partFile(task, index));
				}
			}
		}
	}

	private async deleteParts(follow: FollowedGeneration): Promise<void> {
		const task = this.taskStore.get(follow.taskId);
		if (task) {
			await this.deletePartsOf(task);
		}
	}

	private async deletePartsOf(task: IBaseHalfGenerationTask): Promise<void> {
		if (!this.taskStore.folderOf(task.id)) {
			return;
		}
		for (let index = 0; index < task.cards.length; index++) {
			await this.deleteQuietly(this.taskStore.partFile(task, index));
		}
	}

	private async deleteDraftQuietly(draft: URI): Promise<void> {
		try {
			await this.draftOperations.delete(draft);
		} catch (error) {
			this.logService.warn(`[BaseHalf generation] The draft ${draft.toString()} could not be removed: ${getErrorMessage(error)}`);
		}
	}

	private async deleteQuietly(resource: URI): Promise<void> {
		try {
			await this.fileService.del(resource, { useTrash: false });
		} catch {
			// Already gone.
		}
	}

	private throwIfStopped(follow: FollowedGeneration): void {
		if (follow.stopped) {
			throw stoppedBeforeStartError();
		}
	}

	private placementServices() {
		return { fileService: this.fileService, canvasMirrorService: this.canvasMirrorService, logService: this.logService };
	}

	private locate(resource: URI): { readonly folder: URI; readonly path: string } | undefined {
		const folder = this.workspaceContextService.getWorkspaceFolder(resource)?.uri;
		const path = folder ? this.uriIdentityService.extUri.relativePath(folder, resource) : undefined;
		return folder && path ? { folder, path } : undefined;
	}

	private workspaceFolderOf(resource: URI): URI {
		const folder = this.workspaceContextService.getWorkspaceFolder(resource)?.uri;
		if (!folder) {
			throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.outsideWorkspace', "{0} is not in an open folder.", basename(resource)));
		}
		return folder;
	}

	private resourceOf(folder: URI, path: string): URI {
		return URI.joinPath(folder, ...path.split('/'));
	}

	private relativePath(folder: URI, resource: URI): string {
		return this.uriIdentityService.extUri.relativePath(folder, resource) ?? basename(resource);
	}
}

/** What the drafts a generation made need to be undone and done again. */
interface IDraftsUndoServices {
	isGenerating(draft: URI): boolean;
	read(draft: URI): Promise<IBaseHalfGenerationCardSnapshot>;
	readonly draftOperations: IBaseHalfDraftOperations;
	readonly notificationService: INotificationService;
	readonly undoRedoService: IUndoRedoService;
}

/**
 * Undo removes the drafts a generation made and redo brings them back, as
 * one step (generation cards, "Moving, renaming, copying, and undo"). Both
 * refuse while a draft generates and when its card information changed
 * since, and keep the step. A generation itself is not undone.
 */
class BaseHalfGeneratedDraftsUndoElement implements IWorkspaceUndoRedoElement {
	readonly type = UndoRedoElementType.Workspace;
	readonly label = localize('basehalf.video.generation.undoDrafts', "Generate");
	readonly code = 'basehalf.generation.drafts';
	private snapshots: readonly IBaseHalfDraftSnapshot[] | undefined;

	constructor(
		readonly resources: readonly URI[],
		private readonly drafts: readonly URI[],
		private readonly info: string,
		private readonly services: IDraftsUndoServices
	) { }

	async undo(): Promise<void> {
		const refusal = await this.refusal();
		if (refusal) {
			this.services.notificationService.info(refusal);
			const copy = new BaseHalfGeneratedDraftsUndoElement(this.resources, this.drafts, this.info, this.services);
			this.services.undoRedoService.pushElement(copy, UndoRedoGroup.None, BASEHALF_CANVAS_UNDO_REDO_SOURCE);
			return;
		}
		const snapshots: IBaseHalfDraftSnapshot[] = [];
		for (const draft of this.drafts) {
			snapshots.push(await this.services.draftOperations.delete(draft));
		}
		this.snapshots = snapshots;
	}

	async redo(): Promise<void> {
		for (const snapshot of this.snapshots ?? []) {
			try {
				await this.services.draftOperations.restore(snapshot);
			} catch (error) {
				this.services.notificationService.info(getErrorMessage(error));
			}
		}
	}

	private async refusal(): Promise<string | undefined> {
		for (const draft of this.drafts) {
			if (this.services.isGenerating(draft)) {
				return localize('basehalf.video.generation.undoGenerating', "{0} is generating. Stop it first.", basename(draft));
			}
			const snapshot = await this.services.read(draft).catch(() => undefined);
			if (!snapshot || snapshot.hasFile || snapshot.made || JSON.stringify(snapshot.info) !== this.info) {
				return localize('basehalf.video.generation.undoChanged', "{0} changed since this step.", basename(draft));
			}
		}
		return undefined;
	}
}

/** The text a text input adds to the prompt: its head, without a note's front matter. */
export async function readBaseHalfVideoTextInput(fileService: IFileService, file: URI): Promise<string> {
	const text = (await fileService.readFile(file, { length: TEXT_INPUT_READ_BYTES })).value.toString();
	const extension = extname(file).toLowerCase();
	return extension === '.md' || extension === '.markdown' ? stripBaseHalfMarkdownFrontMatter(text) : text;
}

function sourceOfOutput(output: BaseHalfVideoOutput): LandingSource {
	if (hasKey(output, { refused: true })) {
		return { kind: 'refused', reason: output.refused };
	}
	if (hasKey(output, { written: true })) {
		return { kind: 'written', path: output.written };
	}
	return { kind: 'download', url: output.url };
}

// --- provider answers ----------------------------------------------------------------------------

function parseProviderAnswer<T>(raw: unknown, parse: (value: unknown) => T | undefined): ProviderAnswer<T> {
	if (isRecord(raw)) {
		if (raw.ok === true) {
			const value = parse(raw.value);
			if (value !== undefined) {
				return { ok: true, value };
			}
		} else if (raw.ok === false && isRecord(raw.error)
			&& PROVIDER_ERROR_CODES.has(raw.error.code as BaseHalfVideoProviderErrorCode)
			&& typeof raw.error.message === 'string') {
			const status = raw.error.status;
			return {
				ok: false,
				error: {
					code: raw.error.code as BaseHalfVideoProviderErrorCode,
					message: raw.error.message,
					...(typeof status === 'number' && Number.isInteger(status) ? { status } : {})
				}
			};
		}
	}
	return { ok: false, error: { code: 'invalidResponse', message: localize('basehalf.video.generation.unreadableAnswer', "AI Video answered in a form BaseHalf cannot read.") } };
}

function parseSubmitResult(value: unknown): IBaseHalfVideoSubmitResult | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	if (typeof value.remoteId === 'string') {
		const remoteId = value.remoteId.trim();
		// The task id goes into the task record: one line, as long as the record allows.
		return remoteId && remoteId.length <= 256 && plainDetail(remoteId, []) === remoteId ? { remoteId } : undefined;
	}
	const outputs = parseOutputs(value.outputs);
	return outputs ? { outputs } : undefined;
}

function parseOutputs(value: unknown): readonly BaseHalfVideoOutput[] | undefined {
	if (!Array.isArray(value) || value.length > 16) {
		return undefined;
	}
	const outputs: BaseHalfVideoOutput[] = [];
	for (const output of value) {
		if (!isRecord(output)) {
			return undefined;
		}
		if (typeof output.url === 'string' && output.url) {
			outputs.push({ url: output.url });
		} else if (typeof output.written === 'string' && typeof output.size === 'number' && (output.format === 'png' || output.format === 'jpeg' || output.format === 'webp' || output.format === 'mp4')) {
			outputs.push({ written: output.written, size: output.size, format: output.format });
		} else if (typeof output.refused === 'string') {
			outputs.push({ refused: output.refused });
		} else {
			return undefined;
		}
	}
	return outputs;
}

function parseDownloadResult(value: unknown): IBaseHalfVideoDownloadResult | undefined {
	if (!isRecord(value) || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 0) {
		return undefined;
	}
	const format = value.format === 'png' || value.format === 'jpeg' || value.format === 'webp' || value.format === 'mp4' ? value.format : undefined;
	return { size: value.size, ...(format ? { format } : {}) };
}

function parsePollState(value: unknown): BaseHalfVideoPollState | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	switch (value.state) {
		case 'pending':
		case 'running': {
			const fraction = typeof value.fraction === 'number' && Number.isFinite(value.fraction) ? Math.min(1, Math.max(0, value.fraction)) : undefined;
			return fraction !== undefined ? { state: value.state, fraction } : { state: value.state };
		}
		case 'succeeded': {
			const outputs = value.outputs === undefined ? undefined : parseOutputs(value.outputs);
			if (value.outputs !== undefined && !outputs) {
				return undefined;
			}
			return {
				state: 'succeeded',
				...(typeof value.videoUrl === 'string' && value.videoUrl ? { videoUrl: value.videoUrl } : {}),
				...(outputs ? { outputs } : {})
			};
		}
		case 'failed':
		case 'cancelled':
			return { state: value.state, message: typeof value.message === 'string' ? value.message : '' };
		default:
			return undefined;
	}
}

function parseAnything(value: unknown): unknown {
	return value ?? null;
}

// --- messages ------------------------------------------------------------------------------------

/** The message of a generation whose request may have reached the provider without an answer. */
export function unknownOutcomeMessage(): string {
	return localize('basehalf.video.generation.unknownOutcome', "The request may have reached the provider, but no answer came back. Check the provider's console before generating again: a second request may be charged again.");
}

/** The message of a `submitting` task of a provider with tasks, found after BaseHalf closed. */
export function orphanedSubmissionMessage(): string {
	return localize('basehalf.video.generation.orphanedSubmission', "BaseHalf closed while the request was on its way to the provider. Check the provider's console before generating again: a second request may be charged again.");
}

/** The message of a `submitting` task of a provider that answers at once, found after BaseHalf closed. */
export function closedWhileAnsweringMessage(): string {
	return localize('basehalf.video.generation.closedWhileAnswering', "BaseHalf closed while the provider was making the files. They may have been made and charged, but BaseHalf could not receive them. Check the provider's console.");
}

function cardDeletedMessage(): string {
	return localize('basehalf.video.generation.cardDeleted', "The card was deleted.");
}

function closedWhileSavingMessage(): string {
	return localize('basehalf.video.generation.closedWhileSaving', "BaseHalf closed while it saved this file, and the file is not there. Check the provider's console.");
}

function tooLongMessage(kind: BaseHalfGenerationKind): string {
	return kind === 'image'
		? localize('basehalf.video.generation.tooLongImage', "The provider did not finish the image within two hours.")
		: localize('basehalf.video.generation.tooLong', "The provider did not finish the video within two hours.");
}

function notAcceptedMessage(kind: BaseHalfGenerationKind, detail: string): string {
	return kind === 'image'
		? localize('basehalf.video.generation.notImage', "The provider's file is not a PNG, JPEG, or WebP image of at most 64 MiB: {0}", detail)
		: localize('basehalf.video.generation.notVideo', "The provider's file is not an MP4 video of at most 512 MiB: {0}", detail);
}

function submitFailureMessage(answer: Extract<ProviderAnswer<unknown>, { ok: false }>, secrets: readonly string[]): string {
	const error = answer.error;
	const detail = errorDetail(error, secrets);
	if (answer.unavailable) {
		return localize('basehalf.video.generation.notSent', "Nothing was sent to the provider: {0}", detail);
	}
	switch (error.code) {
		case 'auth':
			return localize('basehalf.video.generation.refusedKey', "The provider refused the credentials: {0}", detail);
		case 'rejected':
			return localize('basehalf.video.generation.rejected', "The provider refused the request: {0}", detail);
		case 'rateLimited':
			return localize('basehalf.video.generation.rateLimited', "The provider has too many requests right now. Wait a moment and generate again: {0}", detail);
		case 'balance':
			return localize('basehalf.video.generation.balance', "The provider says the account has no balance left: {0}", detail);
		case 'network':
			return localize('basehalf.video.generation.network', "BaseHalf could not reach the provider, and nothing was sent: {0}", detail);
		case 'notFound':
			return localize('basehalf.video.generation.endpointNotFound', "The provider does not answer this request at its endpoint. Check the endpoint in Providers: {0}", detail);
		case 'unknownProvider':
			return localize('basehalf.video.generation.unknownProvider', "AI Video does not know this provider, and nothing was sent: {0}", detail);
		default:
			return detail ? `${unknownOutcomeMessage()} (${detail})` : unknownOutcomeMessage();
	}
}

function saveFailedMessage(kind: BaseHalfGenerationKind, error: unknown): string {
	return kind === 'image'
		? localize('basehalf.video.generation.saveFailedImage', "BaseHalf could not save the image in the workspace: {0}", plainDetail(getErrorMessage(error), []))
		: localize('basehalf.video.generation.saveFailed', "BaseHalf could not save the video in the workspace: {0}", plainDetail(getErrorMessage(error), []));
}

function missingInputMessage(path: string): string {
	return localize('basehalf.video.generation.inputMissing', "{0} is missing. Connect it again or remove its connection.", inputName(path));
}

function generatingError(): BaseHalfVideoGenerationError {
	return new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'generating' }));
}

function stoppedBeforeStartError(): BaseHalfVideoGenerationError {
	return new BaseHalfVideoGenerationError(localize('basehalf.video.generation.stoppedBeforeStart', "The generation was stopped before it started."));
}

function inputName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1) || path;
}

function errorDetail(error: IBaseHalfVideoProviderError, secrets: readonly string[]): string {
	const detail = plainDetail(error.message, secrets);
	if (detail) {
		return detail;
	}
	return error.status !== undefined ? `HTTP ${error.status}` : error.code;
}

/** Plain text of at most 1,000 characters, without line breaks, markup, or a credential value. */
function plainDetail(message: string, secrets: readonly string[]): string {
	let text = message;
	for (const secret of secrets) {
		if (secret.length >= 4) {
			text = text.split(secret).join('***');
		}
	}
	text = text.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	return text.length > 1000 ? `${text.slice(0, 999)}…` : text;
}

function toGenerationError(error: unknown): BaseHalfVideoGenerationError {
	if (error instanceof BaseHalfVideoGenerationError) {
		return error;
	}
	return new BaseHalfVideoGenerationError(localize('basehalf.video.generation.startFailed', "BaseHalf could not start the generation: {0}", plainDetail(getErrorMessage(error), [])));
}

// --- small helpers -------------------------------------------------------------------------------

function throwIfCancelled(token: CancellationToken): void {
	if (token.isCancellationRequested) {
		throw stoppedBeforeStartError();
	}
}

function isMoveConflict(error: unknown): boolean {
	return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_MOVE_CONFLICT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Draws an image to a PNG data URL in the window, on white: providers take
 * PNG, JPEG, and WebP only, and some refuse transparency. A vector image is
 * drawn at least {@link RASTER_VECTOR_SIDE} pixels on its long side.
 */
export async function rasterizeBaseHalfVideoImage(bytes: VSBuffer, mimeType: string): Promise<string> {
	const targetWindow = mainWindow;
	const blob = new Blob([bytes.buffer.slice()], { type: mimeType });
	const url = URL.createObjectURL(blob);
	try {
		const image = new targetWindow.Image();
		image.src = url;
		await image.decode();
		let width = image.naturalWidth;
		let height = image.naturalHeight;
		if (!width || !height) {
			width = RASTER_VECTOR_SIDE;
			height = RASTER_VECTOR_SIDE;
		}
		const vector = mimeType === 'image/svg+xml';
		const longSide = Math.max(width, height);
		const scale = Math.min(RASTER_MAX_SIDE / longSide, vector ? Math.max(1, RASTER_VECTOR_SIDE / longSide) : 1);
		const canvas = targetWindow.document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(width * scale));
		canvas.height = Math.max(1, Math.round(height * scale));
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('No 2D canvas context.');
		}
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('The image could not be encoded as PNG.')), 'image/png'));
		return `data:image/png;base64,${encodeBase64(VSBuffer.wrap(new Uint8Array(await png.arrayBuffer())))}`;
	} finally {
		URL.revokeObjectURL(url);
	}
}

registerSingleton(IBaseHalfVideoGenerationService, new SyncDescriptor(BaseHalfVideoGenerationService, [undefined], true));
