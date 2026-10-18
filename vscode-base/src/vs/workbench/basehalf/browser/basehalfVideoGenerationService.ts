/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../base/browser/window.js';
import { disposableTimeout } from '../../../base/common/async.js';
import { encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, dispose, IDisposable } from '../../../base/common/lifecycle.js';
import { ResourceMap, ResourceSet } from '../../../base/common/map.js';
import { Schemas } from '../../../base/common/network.js';
import { dirname, extname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { localize } from '../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../platform/commands/common/commands.js';
import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import {
	BASEHALF_VIDEO_PROVIDER_COMMANDS,
	BaseHalfVideoGenerateBlocker,
	BaseHalfVideoMedia,
	BaseHalfVideoPollState,
	BaseHalfVideoProviderErrorCode,
	baseHalfVideoGenerateBlockerText,
	baseHalfVideoModeOf,
	buildBaseHalfVideoPrompt,
	findBaseHalfVideoModel,
	findBaseHalfVideoProvider,
	getBaseHalfVideoGenerateBlocker,
	IBaseHalfVideoCatalog,
	IBaseHalfVideoGenerationChoice,
	IBaseHalfVideoInputPlanItem,
	IBaseHalfVideoPlannedMedia,
	IBaseHalfVideoProviderAccess,
	IBaseHalfVideoProviderError,
	IBaseHalfVideoSubmitRequest,
	IBaseHalfVideoTaskRef,
	normalizeBaseHalfVideoParams,
	parseBaseHalfVideoCheckResult,
	planBaseHalfVideoInputs,
	stripBaseHalfMarkdownFrontMatter
} from '../common/basehalfVideoCatalog.js';
import {
	BaseHalfVideoGenerationError,
	BaseHalfVideoGenerationPhase,
	IBaseHalfVideoCatalogService,
	IBaseHalfVideoGenerationProgress,
	IBaseHalfVideoGenerationService,
	IBaseHalfVideoNodeSnapshot,
	IBaseHalfVideoNodeStore,
	IBaseHalfVideoProviderSettingsService,
	IBaseHalfVideoResolvedInput
} from '../common/basehalfVideoGeneration.js';
import {
	baseHalfVideoSiblingFields,
	BaseHalfVideoNodeError,
	beginBaseHalfVideoTask,
	completeBaseHalfVideoTask,
	failBaseHalfVideoTask,
	IBaseHalfVideoGenerationRecord,
	IBaseHalfVideoNodeFields,
	IBaseHalfVideoTask,
	isBaseHalfVideoTaskActive,
	recordBaseHalfVideoRemoteId,
	settleOrphanedBaseHalfVideoSubmission,
	stopBaseHalfVideoTask
} from '../common/basehalfVideoNode.js';

/** The first question to the provider comes this long after it accepted the task. */
export const BASEHALF_VIDEO_FIRST_POLL_DELAY = 3_000;
/** Then the provider is asked this often. */
export const BASEHALF_VIDEO_POLL_INTERVAL = 5_000;
/** Network errors while asking are retried for this long in a row. */
export const BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT = 30 * 60_000;
/** A generation that has not ended this long after its start fails. */
export const BASEHALF_VIDEO_TASK_TIME_LIMIT = 2 * 60 * 60_000;
/** A `submitting` task that no window runs fails once it is this old. */
export const BASEHALF_VIDEO_ORPHANED_SUBMISSION_AGE = 2 * 60_000;
/** How long a generation an agent asked for waits for the catalog while it loads. */
export const BASEHALF_VIDEO_CATALOG_WAIT = 30_000;
/** The largest video BaseHalf downloads. */
export const BASEHALF_VIDEO_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
/** The largest image BaseHalf draws to PNG in the window. */
const RASTER_MAX_BYTES = 64 * 1024 * 1024;
/** Downloads that fail for a reason that may pass are tried this many times. */
const DOWNLOAD_ATTEMPTS = 3;
/** Answers to a question about the task that cannot be read end the generation after this many in a row. */
const UNREADABLE_ANSWERS = 3;
/** The head of a text input that is read: enough for front matter and 16 KiB of text. */
const TEXT_INPUT_READ_BYTES = 256 * 1024;
/** The longest side of an image drawn to PNG. */
const RASTER_MAX_SIDE = 4096;
/** A vector image without a useful size is drawn at least this large. */
const RASTER_VECTOR_SIDE = 1024;

const DIRECT_IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' });
const RASTER_IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp' });
const VIDEO_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.webm': 'video/webm' });
const AUDIO_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac' });

const PROVIDER_ERROR_CODES: ReadonlySet<BaseHalfVideoProviderErrorCode> = new Set(['auth', 'rejected', 'rateLimited', 'balance', 'unknownOutcome', 'network', 'invalidResponse', 'notFound', 'notVideo', 'tooLarge', 'unknownProvider']);

/** What the AI Video extension answers to `submit`: the provider's task id. */
export interface IBaseHalfVideoProviderSubmitResult {
	readonly remoteId: string;
}

/** What the AI Video extension answers to `download`: the bytes it wrote. */
export interface IBaseHalfVideoProviderDownloadResult {
	readonly size: number;
}

/** Draws an image that providers do not take (SVG, GIF, AVIF, BMP) to a PNG data URL. */
export type BaseHalfVideoImageRasterizer = (bytes: VSBuffer, mimeType: string) => Promise<string>;

type ProviderAnswer<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: IBaseHalfVideoProviderError; /** AI Video did not answer at all. */ readonly unavailable?: boolean };

interface IPreparedGeneration {
	readonly request: IBaseHalfVideoSubmitRequest;
	readonly record: IBaseHalfVideoGenerationRecord;
	readonly lastUsed: IBaseHalfVideoGenerationChoice;
}

/** One generation this window follows, from Generate or from a file that records it. */
class FollowedGeneration {
	taskId: string | undefined;
	remoteId: string | undefined;
	/** Where the provider is asked, with what, and about which catalog model. */
	access: IBaseHalfVideoProviderAccess | undefined;
	model: string | undefined;
	fraction: number | undefined;
	stopped = false;
	ended = false;
	cancelSent = false;
	transientSince: number | undefined;
	unreadableAnswers = 0;
	downloadFailures = 0;
	timer: IDisposable | undefined;
	readonly preparation = new CancellationTokenSource();

	constructor(
		public resource: URI,
		public phase: BaseHalfVideoGenerationPhase,
		public startedAt: number
	) { }

	taskRef(): IBaseHalfVideoTaskRef {
		return { ...this.access!, model: this.model!, remoteId: this.remoteId! };
	}

	/** The credential values, which no message may hold. */
	secrets(): readonly string[] {
		return this.access ? Object.values(this.access.credentials) : [];
	}
}

/**
 * Runs a Video node's generation from its file to its video (D58, D59, video
 * node specification, "A generation"). Everything before the task is written
 * only reads: the model, mode, and values come from the model catalog, the
 * credentials from the provider settings, and the provider module checks the
 * planned generation with its files first. The task moves through the
 * transitions of `basehalfVideoNode.ts`, written by the node store. Requests
 * go through the AI Video extension's provider commands; a request that may
 * have reached a provider is never sent again.
 */
export class BaseHalfVideoGenerationService extends Disposable implements IBaseHalfVideoGenerationService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeProgress = this._register(new Emitter<URI>());
	readonly onDidChangeProgress = this._onDidChangeProgress.event;

	private readonly followed = new ResourceMap<FollowedGeneration>();
	private readonly resuming = new ResourceSet();
	/** Nodes whose stop is being written: a card that renders meanwhile must not follow them again. */
	private readonly stopping = new ResourceSet();
	private readonly laterChecks = new ResourceMap<IDisposable>();
	private readonly rasterize: BaseHalfVideoImageRasterizer;

	constructor(
		rasterize: BaseHalfVideoImageRasterizer | undefined,
		@IBaseHalfVideoNodeStore private readonly nodeStore: IBaseHalfVideoNodeStore,
		@IBaseHalfVideoCatalogService private readonly catalogService: IBaseHalfVideoCatalogService,
		@IBaseHalfVideoProviderSettingsService private readonly providerSettings: IBaseHalfVideoProviderSettingsService,
		@ICommandService private readonly commandService: ICommandService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.rasterize = rasterize ?? rasterizeBaseHalfVideoImage;
	}

	override dispose(): void {
		for (const follow of this.followed.values()) {
			follow.timer?.dispose();
			follow.preparation.dispose(true);
		}
		this.followed.clear();
		dispose(this.laterChecks.values());
		this.laterChecks.clear();
		super.dispose();
	}

	isGenerating(resource: URI): boolean {
		return this.followed.has(resource);
	}

	getProgress(resource: URI): IBaseHalfVideoGenerationProgress | undefined {
		const follow = this.followed.get(resource);
		if (!follow) {
			return undefined;
		}
		return Object.freeze({
			phase: follow.phase,
			startedAt: follow.startedAt,
			...(follow.fraction !== undefined ? { fraction: follow.fraction } : {})
		});
	}

	// --- starting ------------------------------------------------------------------------------

	async generate(resource: URI): Promise<URI> {
		if (this.followed.has(resource)) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'generating' }));
		}
		const follow = new FollowedGeneration(resource, 'preparing', Date.now());
		this.track(follow);
		try {
			const snapshot = await this.nodeStore.read(resource);
			const prepared = await this.prepare(snapshot, follow.preparation.token);
			this.throwIfStopped(follow);

			// A node with a video never runs again: the generation runs in a new
			// node beside it, with the same prompt, settings, and inputs.
			let target = snapshot.resource;
			if (snapshot.fields.result) {
				target = await this.nodeStore.createSibling(resource, baseHalfVideoSiblingFields(snapshot.fields), snapshot.upstream);
				this.retarget(follow, target);
				this.throwIfStopped(follow);
			}

			const now = Date.now();
			const taskId = createBaseHalfVideoTaskId(now);
			const startedAt = new Date(now).toISOString();
			await this.nodeStore.update(target, fields => beginBaseHalfVideoTask(fields, {
				id: taskId,
				startedAt,
				request: prepared.record
			}));
			follow.taskId = taskId;
			follow.startedAt = now;
			follow.access = accessOf(prepared.request);
			follow.model = prepared.request.model;
			this.providerSettings.setLastUsed(prepared.lastUsed);
			if (follow.stopped) {
				// Stop came while the task was being written.
				await this.writeStopped(follow);
				return target;
			}
			void this.submit(follow, prepared.request).catch(error => this.submitFailedUnexpectedly(follow, error));
			return target;
		} catch (error) {
			this.untrack(follow);
			throw toGenerationError(error);
		}
	}

	/**
	 * Steps 3 and 4: the model of the catalog, the provider's access, the
	 * inputs planned from the mode's slots and read, the request, and the
	 * provider module's check of it with its files. Writes nothing.
	 */
	private async prepare(snapshot: IBaseHalfVideoNodeSnapshot, token: CancellationToken): Promise<IPreparedGeneration> {
		const fields = snapshot.fields;
		const generation = fields.generation;
		const prompt = fields.prompt ?? '';
		const catalog = await this.catalog();
		throwIfCancelled(token);
		const ref = findBaseHalfVideoModel(catalog, generation?.provider, generation?.model);
		const mode = ref ? baseHalfVideoModeOf(ref.model, generation?.mode) : undefined;
		const resolved = ref ? await this.nodeStore.resolveInputs(snapshot) : [];
		throwIfCancelled(token);
		const plan = mode ? planBaseHalfVideoInputs(mode.inputs, resolved) : [];
		const blocker = getBaseHalfVideoGenerateBlocker({
			generating: isBaseHalfVideoTaskActive(fields.task),
			catalog: { kind: 'ready', catalog },
			generation,
			setup: provider => this.providerSettings.getStatus(provider),
			prompt,
			plan
		});
		if (blocker || !ref || !mode) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText(blocker ?? { kind: 'noModel' }));
		}
		const access = await this.providerSettings.getAccess(ref.provider);
		throwIfCancelled(token);
		if (!access) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'notSetUp', provider: ref.provider }));
		}
		const providerModel = ref.model.providerModels[access.region];
		if (!providerModel) {
			const region = ref.provider.regions.find(candidate => candidate.id === access.region) ?? ref.provider.regions[0];
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'region', model: ref.model, region }));
		}
		const params = normalizeBaseHalfVideoParams(ref.model, mode.id, generation?.params);

		const texts: string[] = [];
		const media: { startFrame?: BaseHalfVideoMedia; endFrame?: BaseHalfVideoMedia; source?: BaseHalfVideoMedia; images: BaseHalfVideoMedia[]; videos: BaseHalfVideoMedia[]; audios: BaseHalfVideoMedia[] } = { images: [], videos: [], audios: [] };
		const used: string[] = [];
		for (const [index, item] of plan.entries()) {
			if (item.use === 'unused') {
				continue;
			}
			const input = resolved[index];
			used.push(item.path);
			switch (item.use) {
				case 'text':
					texts.push(await this.readText(input, item));
					break;
				case 'start-frame':
					media.startFrame = await this.prepareMedia(input, item, 'image');
					break;
				case 'end-frame':
					media.endFrame = await this.prepareMedia(input, item, 'image');
					break;
				case 'source':
					media.source = await this.prepareMedia(input, item, 'video');
					break;
				default:
					if (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio') {
						const prepared = await this.prepareMedia(input, item, item.kind);
						(item.kind === 'image' ? media.images : item.kind === 'video' ? media.videos : media.audios).push(prepared);
					}
			}
			throwIfCancelled(token);
		}
		const sentPrompt = buildBaseHalfVideoPrompt(prompt, texts);
		const inputs: IBaseHalfVideoPlannedMedia = Object.freeze({
			...(media.startFrame ? { startFrame: media.startFrame } : {}),
			...(media.endFrame ? { endFrame: media.endFrame } : {}),
			images: Object.freeze(media.images),
			videos: Object.freeze(media.videos),
			audios: Object.freeze(media.audios),
			...(media.source ? { source: media.source } : {})
		});
		if (!sentPrompt && !media.startFrame && !media.endFrame && !media.source && !media.images.length && !media.videos.length && !media.audios.length) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'nothingToSend' }));
		}

		// The provider module checks the planned generation with its files:
		// sizes, lengths, counts, the prompt, and the rules between values.
		const checked = await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.check, {
			provider: ref.provider.id,
			region: access.region,
			model: ref.model.id,
			mode: mode.id,
			params,
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

		const record: IBaseHalfVideoGenerationRecord = {
			provider: ref.provider.id,
			region: access.region,
			model: ref.model.id,
			providerModel,
			mode: mode.id,
			params,
			prompt: sentPrompt,
			inputs: used
		};
		const request: IBaseHalfVideoSubmitRequest = {
			...access,
			model: ref.model.id,
			mode: mode.id,
			params,
			prompt: sentPrompt,
			inputs
		};
		return { request, record, lastUsed: { provider: ref.provider.id, model: ref.model.id, mode: mode.id, params } };
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

	/** An image as a local file of a type providers take, or drawn to PNG; a video or audio as a local file. The provider module measures them. */
	private async prepareMedia(input: IBaseHalfVideoResolvedInput, item: IBaseHalfVideoInputPlanItem, kind: 'image' | 'video' | 'audio'): Promise<BaseHalfVideoMedia> {
		const file = input.file;
		if (!file) {
			throw new BaseHalfVideoGenerationError(missingInputMessage(item.path));
		}
		let size: number;
		try {
			const stat = await this.fileService.stat(file);
			if (stat.isDirectory) {
				throw new Error('directory');
			}
			size = stat.size;
		} catch {
			throw new BaseHalfVideoGenerationError(missingInputMessage(item.path));
		}
		if (file.scheme !== Schemas.file) {
			throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.inputNotLocal', "{0} is not a file on this computer.", inputName(item.path)));
		}
		const extension = extname(file).toLowerCase();
		if (kind === 'image') {
			const direct = DIRECT_IMAGE_TYPES[extension];
			if (direct) {
				return { fsPath: file.fsPath, mimeType: direct };
			}
			if (size > RASTER_MAX_BYTES) {
				throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.imageTooLargeToDraw', "{0} is larger than 64 MiB, which BaseHalf does not draw as a PNG.", inputName(item.path)));
			}
			try {
				const bytes = (await this.fileService.readFile(file)).value;
				return { dataUrl: await this.rasterize(bytes, RASTER_IMAGE_TYPES[extension] ?? 'image/*') };
			} catch (error) {
				this.logService.warn(`[BaseHalf video] Could not draw ${item.path} to PNG: ${getErrorMessage(error)}`);
				throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.imageUnreadable', "BaseHalf could not read the image {0}.", inputName(item.path)));
			}
		}
		const types = kind === 'video' ? VIDEO_TYPES : AUDIO_TYPES;
		return { fsPath: file.fsPath, mimeType: types[extension] ?? 'application/octet-stream' };
	}

	// --- running -------------------------------------------------------------------------------

	/** Step 6: send the request once and record the provider's task id. */
	private async submit(follow: FollowedGeneration, request: IBaseHalfVideoSubmitRequest): Promise<void> {
		this.setPhase(follow, 'submitting');
		const answer = await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.submit, request, parseSubmitResult, true);
		if (answer.ok) {
			follow.remoteId = answer.value.remoteId;
		}
		if (follow.stopped) {
			// The user stopped while the request was on its way: the stop is
			// written; a task the provider made after all is cancelled.
			if (answer.ok) {
				await this.cancelRemote(follow);
			}
			return;
		}
		if (!answer.ok) {
			await this.fail(follow, submitFailureMessage(answer, follow.secrets()));
			return;
		}
		const remoteId = answer.value.remoteId;
		try {
			await this.nodeStore.update(follow.resource, fields => recordBaseHalfVideoRemoteId(fields, follow.taskId!, remoteId));
		} catch (error) {
			if (!follow.stopped) {
				// The node changed while the request was on its way: it was stopped
				// in another window, or the file was replaced. Nobody follows this
				// task, so it is cancelled where the provider allows it.
				this.logService.info(`[BaseHalf video] ${follow.resource.toString()} changed while its request was sent: ${getErrorMessage(error)}`);
				await this.cancelRemote(follow);
				this.untrack(follow);
			}
			return;
		}
		if (follow.stopped || follow.ended) {
			return;
		}
		this.setPhase(follow, 'queued');
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
		this.logService.error(`[BaseHalf video] The request of ${follow.resource.toString()} failed: ${getErrorMessage(error)}`);
		if (!follow.stopped && !follow.ended) {
			await this.fail(follow, `${unknownOutcomeMessage()} (${plainDetail(getErrorMessage(error), follow.secrets())})`);
		}
	}

	/** Something failed while following the task, such as reading the node: ask again later, as after a network error. */
	private async pollFailedUnexpectedly(follow: FollowedGeneration, error: unknown): Promise<void> {
		this.logService.warn(`[BaseHalf video] Following ${follow.resource.toString()} failed: ${getErrorMessage(error)}`);
		if (!follow.stopped && !follow.ended) {
			await this.pollFailed(follow, { ok: false, unavailable: true, error: { code: 'network', message: getErrorMessage(error) } });
		}
	}

	/** Step 7: ask the provider about the task. */
	private async poll(follow: FollowedGeneration): Promise<void> {
		if (follow.stopped || follow.ended) {
			return;
		}
		if (Date.now() - follow.startedAt >= BASEHALF_VIDEO_TASK_TIME_LIMIT) {
			await this.fail(follow, tooLongMessage());
			return;
		}
		if (!await this.isStillCurrent(follow)) {
			this.untrack(follow);
			return;
		}
		const answer = await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.poll, follow.taskRef(), parsePollState, false);
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
				this.setPhase(follow, state.state === 'pending' ? 'queued' : 'generating', state.fraction);
				this.schedulePoll(follow, BASEHALF_VIDEO_POLL_INTERVAL);
				return;
			case 'failed':
				await this.fail(follow, localize('basehalf.video.generation.remoteFailed', "The provider could not make the video: {0}", plainDetail(state.message, follow.secrets())));
				return;
			case 'cancelled':
				await this.fail(follow, localize('basehalf.video.generation.remoteCancelled', "The provider cancelled the generation: {0}", plainDetail(state.message, follow.secrets())));
				return;
			case 'succeeded':
				await this.download(follow, state.videoUrl);
				return;
		}
	}

	private async pollFailed(follow: FollowedGeneration, answer: Extract<ProviderAnswer<unknown>, { ok: false }>): Promise<void> {
		const error = answer.error;
		const detail = errorDetail(error, follow.secrets());
		if (!answer.unavailable) {
			if (error.code === 'auth') {
				await this.fail(follow, localize('basehalf.video.generation.pollRefusedKey', "The provider refused the credentials while BaseHalf asked about the video: {0}", detail));
				return;
			}
			if (error.code === 'notFound') {
				await this.fail(follow, localize('basehalf.video.generation.pollUnknownTask', "The provider does not know this task: {0}", detail));
				return;
			}
			if (error.code === 'rejected' || error.code === 'unknownProvider') {
				await this.fail(follow, localize('basehalf.video.generation.pollRejected', "The provider refused to tell about the video: {0}", detail));
				return;
			}
			if (error.code === 'invalidResponse' && ++follow.unreadableAnswers >= UNREADABLE_ANSWERS) {
				await this.fail(follow, localize('basehalf.video.generation.pollUnreadable', "The provider answers about the video in a form BaseHalf cannot read. Check the provider's console: {0}", detail));
				return;
			}
		}
		// A network error, an overloaded provider, or AI Video restarting: ask
		// again at the next interval, for up to 30 minutes in a row.
		const now = Date.now();
		follow.transientSince ??= now;
		if (now - follow.transientSince >= BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT) {
			await this.fail(follow, localize('basehalf.video.generation.lostContact', "BaseHalf could not reach the provider for 30 minutes. The video may still be made there: check the provider's console. ({0})", detail));
			return;
		}
		this.schedulePoll(follow, BASEHALF_VIDEO_POLL_INTERVAL);
	}

	/** Step 8: download to a `.part` file, then move it into place and write the result. */
	private async download(follow: FollowedGeneration, videoUrl: string | undefined): Promise<void> {
		this.setPhase(follow, 'downloading');
		const snapshot = await this.readCurrent(follow);
		if (!snapshot) {
			this.untrack(follow);
			return;
		}
		const target = this.nodeStore.videoTarget(snapshot, follow.taskId!);
		// Each window downloads to its own file: two windows may follow one task.
		const part = target.with({ path: `${target.path}.${generateUuid().slice(0, 8)}.part` });
		try {
			await this.fileService.createFolder(dirname(target));
		} catch (error) {
			await this.fail(follow, saveFailedMessage(error));
			return;
		}
		const answer = await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.download, {
			...follow.taskRef(),
			...(videoUrl !== undefined ? { videoUrl } : {}),
			targetFsPath: part.fsPath
		}, parseDownloadResult, false);
		if (follow.stopped || follow.ended) {
			await this.deleteQuietly(part);
			return;
		}
		if (!answer.ok) {
			await this.deleteQuietly(part);
			const detail = errorDetail(answer.error, follow.secrets());
			if (!answer.unavailable && (answer.error.code === 'notVideo' || answer.error.code === 'tooLarge')) {
				await this.fail(follow, answer.error.code === 'notVideo'
					? localize('basehalf.video.generation.notVideo', "The provider's file is not an MP4 video: {0}", detail)
					: localize('basehalf.video.generation.tooLarge', "The video is larger than 512 MiB, which BaseHalf does not download: {0}", detail));
				return;
			}
			if (++follow.downloadFailures >= DOWNLOAD_ATTEMPTS) {
				await this.fail(follow, localize('basehalf.video.generation.downloadFailed', "The provider made the video, but BaseHalf could not download it. Check the provider's console: {0}", detail));
				return;
			}
			this.setPhase(follow, 'generating');
			this.schedulePoll(follow, BASEHALF_VIDEO_POLL_INTERVAL);
			return;
		}
		await this.commit(follow, snapshot, part, target);
	}

	/**
	 * Moves the download into place and writes the result, unless the node no
	 * longer runs this task. Of two windows that follow one task, the first
	 * that writes the result wins; the other deletes its download.
	 */
	private async commit(follow: FollowedGeneration, snapshot: IBaseHalfVideoNodeSnapshot, part: URI, target: URI): Promise<void> {
		if (!await this.isStillCurrent(follow)) {
			await this.deleteQuietly(part);
			this.untrack(follow);
			return;
		}
		let placed = false;
		try {
			await this.fileService.move(part, target, false);
			placed = true;
		} catch (error) {
			await this.deleteQuietly(part);
			if (!await this.fileService.exists(target)) {
				await this.fail(follow, saveFailedMessage(error));
				return;
			}
			// Another window already moved its download of this task into place.
		}
		let size: number;
		try {
			size = (await this.fileService.stat(target)).size;
		} catch (error) {
			await this.fail(follow, saveFailedMessage(error));
			return;
		}
		if (size > BASEHALF_VIDEO_MAX_DOWNLOAD_BYTES) {
			if (placed) {
				await this.deleteQuietly(target);
			}
			await this.fail(follow, localize('basehalf.video.generation.tooLarge', "The video is larger than 512 MiB, which BaseHalf does not download: {0}", String(size)));
			return;
		}
		const path = workspaceRelativePath(snapshot, target);
		const completedAt = new Date(Date.now()).toISOString();
		try {
			await this.nodeStore.update(follow.resource, fields => completeBaseHalfVideoTask(fields, follow.taskId!, { kind: 'video', path, size }, completedAt));
		} catch (error) {
			// The node changed meanwhile: it was stopped, or another window wrote
			// the result. Keep the file only when the node now shows it.
			const after = await this.readQuietly(follow.resource);
			const shown = after?.fields.result?.artifact.path === path;
			if (!shown && placed) {
				await this.deleteQuietly(target);
			}
			this.logService.info(`[BaseHalf video] The result of ${follow.resource.toString()} was not written: ${getErrorMessage(error)}`);
		}
		this.untrack(follow);
	}

	// --- ending --------------------------------------------------------------------------------

	async stop(resource: URI): Promise<void> {
		this.stopping.add(resource);
		try {
			await this.doStop(resource);
		} finally {
			this.stopping.delete(resource);
		}
	}

	private async doStop(resource: URI): Promise<void> {
		const follow = this.followed.get(resource);
		if (follow) {
			follow.stopped = true;
			follow.preparation.cancel();
			follow.timer?.dispose();
			this.untrack(follow);
			if (follow.taskId) {
				await this.writeStopped(follow);
				if (follow.remoteId) {
					await this.cancelRemote(follow);
				}
			}
			return;
		}
		// No generation in this window follows the node: stop what its file records.
		const snapshot = await this.readQuietly(resource);
		const task = snapshot?.fields.task;
		if (!task || !isBaseHalfVideoTaskActive(task)) {
			return;
		}
		const endedAt = new Date(Date.now()).toISOString();
		try {
			await this.nodeStore.update(resource, fields => fields.task?.id === task.id && isBaseHalfVideoTaskActive(fields.task)
				? stopBaseHalfVideoTask(fields, task.id, endedAt)
				: fields);
		} catch (error) {
			this.logService.info(`[BaseHalf video] Could not record the stop of ${resource.toString()}: ${getErrorMessage(error)}`);
		}
		if (task.remoteId) {
			try {
				const access = await this.accessOfTask(task);
				if (access) {
					await this.callProvider(BASEHALF_VIDEO_PROVIDER_COMMANDS.cancel, { ...access, model: task.request.model, remoteId: task.remoteId }, parseAnything, false);
				}
			} catch (error) {
				this.logService.info(`[BaseHalf video] Could not ask the provider to cancel ${task.remoteId}: ${getErrorMessage(error)}`);
			}
		}
	}

	private async writeStopped(follow: FollowedGeneration): Promise<void> {
		const endedAt = new Date(Date.now()).toISOString();
		try {
			await this.nodeStore.update(follow.resource, fields => fields.task?.id === follow.taskId && isBaseHalfVideoTaskActive(fields.task)
				? stopBaseHalfVideoTask(fields, follow.taskId!, endedAt)
				: fields);
		} catch (error) {
			this.logService.info(`[BaseHalf video] Could not record the stop of ${follow.resource.toString()}: ${getErrorMessage(error)}`);
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
		if (follow.taskId) {
			const endedAt = new Date(Date.now()).toISOString();
			try {
				await this.nodeStore.update(follow.resource, fields => failBaseHalfVideoTask(fields, follow.taskId!, message, endedAt));
			} catch (error) {
				// The node no longer runs this task: nothing is written.
				this.logService.info(`[BaseHalf video] The failure of ${follow.resource.toString()} was not written: ${getErrorMessage(error)}`);
			}
		}
		this.untrack(follow);
	}

	// --- continuing ----------------------------------------------------------------------------

	resume(resource: URI): void {
		if (this.followed.has(resource) || this.resuming.has(resource) || this.stopping.has(resource)) {
			return;
		}
		this.resuming.add(resource);
		void this.doResume(resource)
			.catch(error => this.logService.warn(`[BaseHalf video] Could not continue the generation of ${resource.toString()}: ${getErrorMessage(error)}`))
			.finally(() => this.resuming.delete(resource));
	}

	private async doResume(resource: URI): Promise<void> {
		const snapshot = await this.readQuietly(resource);
		const task = snapshot?.fields.task;
		if (!snapshot || !task || !isBaseHalfVideoTaskActive(task) || this.followed.has(resource)) {
			return;
		}
		const started = Date.parse(task.startedAt);
		const age = Date.now() - started;
		if (task.state === 'submitting') {
			if (age >= BASEHALF_VIDEO_ORPHANED_SUBMISSION_AGE) {
				// BaseHalf closed while the request was on its way. Whether the
				// provider made a task is unknown, so it is never sent again.
				const endedAt = new Date(Date.now()).toISOString();
				try {
					await this.nodeStore.update(resource, fields => fields.task?.id === task.id ? settleOrphanedBaseHalfVideoSubmission(fields, orphanedSubmissionMessage(), endedAt) : fields);
				} catch (error) {
					this.logService.info(`[BaseHalf video] Could not settle ${resource.toString()}: ${getErrorMessage(error)}`);
				}
			} else {
				// Another window may be sending it right now. Look again when it
				// is old enough to be settled.
				this.checkLater(resource, BASEHALF_VIDEO_ORPHANED_SUBMISSION_AGE - age + 1_000);
			}
			return;
		}
		const access = await this.accessOfTask(task);
		if (this.followed.has(resource)) {
			return;
		}
		if (!access) {
			// The provider is not set up on this computer for this task (the
			// workspace came from another computer, or its credentials were
			// removed). Leave it to the window that can follow it, until it is
			// certainly over.
			if (age >= BASEHALF_VIDEO_TASK_TIME_LIMIT) {
				const endedAt = new Date(Date.now()).toISOString();
				try {
					await this.nodeStore.update(resource, fields => fields.task?.id === task.id && isBaseHalfVideoTaskActive(fields.task) ? failBaseHalfVideoTask(fields, task.id, tooLongMessage(), endedAt) : fields);
				} catch (error) {
					this.logService.info(`[BaseHalf video] Could not settle ${resource.toString()}: ${getErrorMessage(error)}`);
				}
			}
			return;
		}
		const follow = new FollowedGeneration(resource, 'generating', Number.isNaN(started) ? Date.now() : started);
		follow.taskId = task.id;
		follow.remoteId = task.remoteId;
		follow.access = access;
		follow.model = task.request.model;
		this.track(follow);
		this.schedulePoll(follow, BASEHALF_VIDEO_FIRST_POLL_DELAY);
	}

	private checkLater(resource: URI, delay: number): void {
		this.laterChecks.get(resource)?.dispose();
		const timer = disposableTimeout(() => {
			timer.dispose();
			if (this.laterChecks.get(resource) === timer) {
				this.laterChecks.delete(resource);
			}
			this.resume(resource);
		}, delay);
		this.laterChecks.set(resource, timer);
	}

	/** The access a task is asked about with: its provider, in the region its request records. */
	private async accessOfTask(task: IBaseHalfVideoTask): Promise<IBaseHalfVideoProviderAccess | undefined> {
		let catalog: IBaseHalfVideoCatalog;
		try {
			catalog = await this.catalogService.whenReady(BASEHALF_VIDEO_CATALOG_WAIT);
		} catch {
			return undefined;
		}
		const provider = findBaseHalfVideoProvider(catalog, task.request.provider);
		return provider ? this.providerSettings.getAccess(provider, task.request.region) : undefined;
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
		this.followed.set(follow.resource, follow);
		this._onDidChangeProgress.fire(follow.resource);
	}

	private retarget(follow: FollowedGeneration, resource: URI): void {
		const previous = follow.resource;
		this.followed.delete(previous);
		follow.resource = resource;
		this.followed.set(resource, follow);
		this._onDidChangeProgress.fire(previous);
		this._onDidChangeProgress.fire(resource);
	}

	private untrack(follow: FollowedGeneration): void {
		follow.ended = true;
		follow.timer?.dispose();
		follow.timer = undefined;
		if (this.followed.get(follow.resource) === follow) {
			this.followed.delete(follow.resource);
			this._onDidChangeProgress.fire(follow.resource);
		}
		follow.preparation.dispose();
	}

	private setPhase(follow: FollowedGeneration, phase: BaseHalfVideoGenerationPhase, fraction?: number): void {
		if (follow.ended || (follow.phase === phase && follow.fraction === fraction)) {
			return;
		}
		follow.phase = phase;
		follow.fraction = fraction;
		if (this.followed.get(follow.resource) === follow) {
			this._onDidChangeProgress.fire(follow.resource);
		}
	}

	private throwIfStopped(follow: FollowedGeneration): void {
		if (follow.stopped) {
			throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.stoppedBeforeStart', "The generation was stopped before it started."));
		}
	}

	private async readCurrent(follow: FollowedGeneration): Promise<IBaseHalfVideoNodeSnapshot | undefined> {
		const snapshot = await this.readQuietly(follow.resource);
		return snapshot && isCurrentTask(snapshot.fields, follow.taskId) ? snapshot : undefined;
	}

	private async isStillCurrent(follow: FollowedGeneration): Promise<boolean> {
		return (await this.readCurrent(follow)) !== undefined;
	}

	private async readQuietly(resource: URI): Promise<IBaseHalfVideoNodeSnapshot | undefined> {
		try {
			return await this.nodeStore.read(resource);
		} catch {
			return undefined;
		}
	}

	private async deleteQuietly(resource: URI): Promise<void> {
		try {
			await this.fileService.del(resource, { useTrash: false });
		} catch {
			// Already gone.
		}
	}
}

/** The text a text input adds to the prompt: its head, without a note's front matter. */
export async function readBaseHalfVideoTextInput(fileService: IFileService, file: URI): Promise<string> {
	const text = (await fileService.readFile(file, { length: TEXT_INPUT_READ_BYTES })).value.toString();
	const extension = extname(file).toLowerCase();
	return extension === '.md' || extension === '.markdown' ? stripBaseHalfMarkdownFrontMatter(text) : text;
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

function parseSubmitResult(value: unknown): IBaseHalfVideoProviderSubmitResult | undefined {
	if (!isRecord(value) || typeof value.remoteId !== 'string') {
		return undefined;
	}
	const remoteId = value.remoteId.trim();
	// The task id goes into the node's file: one line, as long as the file allows.
	return remoteId && remoteId.length <= 256 && plainDetail(remoteId, []) === remoteId ? { remoteId } : undefined;
}

function parseDownloadResult(value: unknown): IBaseHalfVideoProviderDownloadResult | undefined {
	return isRecord(value) && typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0 ? { size: value.size } : undefined;
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
		case 'succeeded':
			return typeof value.videoUrl === 'string' && value.videoUrl ? { state: 'succeeded', videoUrl: value.videoUrl } : { state: 'succeeded' };
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

/** The message of a `submitting` task found after BaseHalf closed. */
export function orphanedSubmissionMessage(): string {
	return localize('basehalf.video.generation.orphanedSubmission', "BaseHalf closed while the request was on its way to the provider. Check the provider's console before generating again: a second request may be charged again.");
}

function tooLongMessage(): string {
	return localize('basehalf.video.generation.tooLong', "The provider did not finish the video within two hours.");
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
			return localize('basehalf.video.generation.endpointNotFound', "The provider does not answer this request at its endpoint. Check the endpoint in Video Providers: {0}", detail);
		case 'unknownProvider':
			return localize('basehalf.video.generation.unknownProvider', "AI Video does not know this provider, and nothing was sent: {0}", detail);
		default:
			return detail ? `${unknownOutcomeMessage()} (${detail})` : unknownOutcomeMessage();
	}
}

function saveFailedMessage(error: unknown): string {
	return localize('basehalf.video.generation.saveFailed', "BaseHalf could not save the video in the workspace: {0}", plainDetail(getErrorMessage(error), []));
}

function missingInputMessage(path: string): string {
	return localize('basehalf.video.generation.inputMissing', "{0} is missing. Connect it again or remove its connection.", inputName(path));
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
	if (error instanceof BaseHalfVideoNodeError && /already generating/.test(error.message)) {
		return new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'generating' }));
	}
	return new BaseHalfVideoGenerationError(localize('basehalf.video.generation.startFailed', "BaseHalf could not start the generation: {0}", plainDetail(getErrorMessage(error), [])));
}

// --- small helpers -------------------------------------------------------------------------------

/** `20261015T080000-k3f9`: sortable by start time, unique enough per node. */
export function createBaseHalfVideoTaskId(now: number): string {
	const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
	return `${stamp}-${generateUuid().replace(/-/g, '').slice(0, 4)}`;
}

function accessOf(request: IBaseHalfVideoSubmitRequest): IBaseHalfVideoProviderAccess {
	return { provider: request.provider, region: request.region, endpoint: request.endpoint, credentials: request.credentials };
}

function isCurrentTask(fields: IBaseHalfVideoNodeFields, taskId: string | undefined): boolean {
	return taskId !== undefined && fields.task?.id === taskId && isBaseHalfVideoTaskActive(fields.task);
}

/** The target's path relative to the workspace folder of the node, as the store counts it. */
function workspaceRelativePath(snapshot: IBaseHalfVideoNodeSnapshot, target: URI): string {
	const nodePath = snapshot.resource.path;
	const relative = snapshot.path.replace(/^\/+/, '');
	if (!nodePath.endsWith(`/${relative}`) || target.scheme !== snapshot.resource.scheme || target.authority !== snapshot.resource.authority) {
		throw new Error(`Cannot place ${target.toString()} relative to the workspace of ${snapshot.resource.toString()}.`);
	}
	const root = nodePath.slice(0, nodePath.length - relative.length);
	if (!target.path.startsWith(root)) {
		throw new Error(`${target.toString()} is outside the workspace of ${snapshot.resource.toString()}.`);
	}
	return target.path.slice(root.length);
}

function throwIfCancelled(token: CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.stoppedBeforeStart', "The generation was stopped before it started."));
	}
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
