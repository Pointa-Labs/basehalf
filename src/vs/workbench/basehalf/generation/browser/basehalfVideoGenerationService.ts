/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/
import { disposableTimeout, IntervalTimer } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, dispose, IDisposable } from '../../../../base/common/lifecycle.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { hasKey } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IChecksumService } from '../../../../platform/checksum/common/checksumService.js';
import { IBaseHalfProviderService } from '../../../../platform/basehalfProviders/common/basehalfProviders.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import { IBaseHalfMovedItemsService } from '../../upkeep/common/basehalfMovedItemsService.js';
import { IBaseHalfWorkspaceMutationCoordinator } from '../../workspace/common/basehalfWorkspaceMutation.js';
import { baseHalfGenerationChoice, baseHalfGenerationClaimWinner, baseHalfGenerationInfoOfMade, baseHalfGenerationNameOrdinal, baseHalfGenerationNameParts, BaseHalfGenerationPathKey, baseHalfGenerationTaskCardIndex, baseHalfGenerationTaskNamesCard, createBaseHalfGenerationTask, createBaseHalfGenerationTaskId, failBaseHalfGenerationCard, failBaseHalfGenerationTask, IBaseHalfGenerationInfo, IBaseHalfGenerationTask, isBaseHalfGenerationTaskEnded, isBaseHalfGenerationTaskSettled, isBaseHalfGenerationTaskStale, reviveBaseHalfGenerationTask, runBaseHalfGenerationTask, stopBaseHalfGenerationTask, submitBaseHalfGenerationTask } from '../common/basehalfGenerationInfo.js';
import { BaseHalfVideoImageFormat, BaseHalfVideoModeId, BaseHalfVideoParams, baseHalfVideoRefusedParam, findBaseHalfVideoModel, findBaseHalfVideoProvider, IBaseHalfVideoCatalog, IBaseHalfVideoGenerationChoice, IBaseHalfVideoModelRef, IBaseHalfVideoPlannedMedia, IBaseHalfVideoProviderAccess, IBaseHalfVideoSubmitRequest, baseHalfModelOutputCount, normalizeBaseHalfVideoParams } from '../common/basehalfVideoCatalog.js';
import { baseHalfGenerationMissingFileMessage, BaseHalfVideoGenerationError, BaseHalfVideoGenerationPhase, IBaseHalfGenerateOptions, IBaseHalfGenerationCardSnapshot, IBaseHalfGenerationCardStore, IBaseHalfGenerationTaskStore, IBaseHalfVideoCatalogService, IBaseHalfVideoGenerationProgress, IBaseHalfVideoGenerationService, IBaseHalfVideoProviderSettingsService, IBaseHalfVideoResolvedInput } from '../common/basehalfVideoGeneration.js';
import { BaseHalfDraftUndoElement } from './basehalfDraftUndo.js';
import { createBaseHalfNewVersion } from './basehalfGenerationNewVersion.js';
import { BASEHALF_GENERATION_CARD_SIZE, baseHalfParentCanvasFolder, placeBaseHalfCardsBeside } from './basehalfGenerationPlacement.js';
import { IBaseHalfDraftOperations } from '../../upkeep/common/basehalfDraftOperations.js';
import { FollowedGeneration, type IPreparedGeneration, BASEHALF_VIDEO_CATALOG_WAIT, BASEHALF_VIDEO_FIRST_POLL_DELAY, BASEHALF_VIDEO_TASK_TIME_LIMIT, BASEHALF_VIDEO_POLL_INTERVAL, BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT } from './basehalfGenerationFollowed.js';
import { errorDetail, parseSubmitResult, plainDetail, parsePollState, type ProviderAnswer, parseAnything, parseProviderAnswer } from './basehalfProviderAnswers.js';
import { toGenerationError, generatingError, stoppedBeforeStartError, submitFailureMessage, unknownOutcomeMessage, tooLongMessage, cardDeletedMessage } from './basehalfVideoGenerationMessages.js';
import { BaseHalfVideoImageRasterizer, rasterizeBaseHalfVideoImage } from './basehalfGenerationInputReading.js';
import { BaseHalfGenerationPreparation } from './basehalfGenerationPreparation.js';
import { BaseHalfGenerationLanding, sourceOfOutput } from './basehalfGenerationLanding.js';
import { BaseHalfGenerationTakeover } from './basehalfGenerationTakeover.js';
import { baseHalfVideoGenerateBlockerText, getBaseHalfVideoGenerateBlocker } from '../common/basehalfGenerateBlocker.js';
import { baseHalfVideoModeThatIsUsed, IBaseHalfVideoInputPlanItem } from '../common/basehalfGenerationInputs.js';

/** Answers to a question about the task that cannot be read end the generation after this many in a row. */
const UNREADABLE_ANSWERS = 3;

/** The cards a generation lands on (generation cards, "Starting", step 4). */
interface IPlannedCards {
	/** Workspace-relative paths, in the order of the outputs. */
	readonly paths: readonly string[];
	/** The drafts the generation makes, by name, in its folder. */
	readonly drafts: readonly string[];
}

/**
 * Runs the generations of generation cards (D63, D64, generation cards, "A
 * generation"): from Generate through a task record of this computer to the
 * files on their cards. The steps before the record is `submitting` write
 * nothing but the record and the drafts the generation makes, and a stop
 * there removes both. Requests go through the provider service of the shared
 * process (D75); a request that may have reached a provider is never sent again.
 * One window follows each generation and says every 30 seconds that it is
 * alive; another window takes a generation over only when that has not
 * happened for 90 seconds. Files land inside the workspace mutation lease.
 */
export class BaseHalfVideoGenerationService extends Disposable implements IBaseHalfVideoGenerationService {

	// The parts, one concern each; they reach this object as `service`.
	/** What a generation sends */
	readonly preparation = new BaseHalfGenerationPreparation(this);
	/** A generation's files, from the provider's answer to their cards */
	readonly landing = new BaseHalfGenerationLanding(this);
	/** Following the generations of the task records */
	readonly takeover = new BaseHalfGenerationTakeover(this);

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeProgress = this._register(new Emitter<URI>());
	readonly onDidChangeProgress = this._onDidChangeProgress.event;

	/** This window, as a task record names the window that follows it. */
	readonly follower = `w${generateUuid().replace(/-/g, '')}`;

	readonly followed = new Map<string, FollowedGeneration>();
	readonly heartbeat = this._register(new IntervalTimer());
	readonly laterChecks = new Map<string, IDisposable>();
	readonly rasterize: BaseHalfVideoImageRasterizer;

	constructor(
		rasterize: BaseHalfVideoImageRasterizer | undefined,
		@IBaseHalfGenerationCardStore public readonly cardStore: IBaseHalfGenerationCardStore,
		@IBaseHalfGenerationTaskStore public readonly taskStore: IBaseHalfGenerationTaskStore,
		@IBaseHalfDraftOperations public readonly draftOperations: IBaseHalfDraftOperations,
		@IBaseHalfVideoCatalogService public readonly catalogService: IBaseHalfVideoCatalogService,
		@IBaseHalfVideoProviderSettingsService public readonly providerSettings: IBaseHalfVideoProviderSettingsService,
		@IBaseHalfWorkspaceMutationCoordinator public readonly mutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfMovedItemsService public readonly movedItemsService: IBaseHalfMovedItemsService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IChecksumService public readonly checksumService: IChecksumService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@IBaseHalfProviderService private readonly providerService: IBaseHalfProviderService,
		@IFileService public readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IUriIdentityService public readonly uriIdentityService: IUriIdentityService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService public readonly logService: ILogService
	) {
		super();
		this.rasterize = rasterize ?? rasterizeBaseHalfVideoImage;
		this._register(this.taskStore.onDidChange(() => this.takeover.onDidChangeRecords()));
		// Generations found when the window opens are continued, or settled.
		void this.taskStore.whenReady().then(() => this.takeover.onDidChangeRecords());
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
		if (!task || !located || isBaseHalfGenerationTaskEnded(task)) {
			return false;
		}
		const index = baseHalfGenerationTaskCardIndex(task, located.path, this.pathKey(located.folder));
		return index >= 0 && task.cards[index].state === 'waiting';
	}

	getProgress(resource: URI): IBaseHalfVideoGenerationProgress | undefined {
		const located = this.locate(resource);
		const folderKey = located?.folder.toString();
		const key = located ? this.pathKey(located.folder) : undefined;
		const follow = located && key ? [...this.followed.values()].find(candidate => !candidate.ended && candidate.folder.toString() === folderKey && candidate.paths.some(path => key(path) === key(located.path))) : undefined;
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
		if (!snapshot.hasFile && (snapshot.made || snapshot.madeUnreadable)) {
			// A missing file is not a draft: it never generates.
			throw new BaseHalfVideoGenerationError(baseHalfGenerationMissingFileMessage(basename(resource)));
		}
		if (snapshot.hasFile) {
			// A generated file never changes (D67): a new version of it is a draft beside it, which generates.
			return this.generateNewVersion(snapshot, options);
		}
		const folder = this.workspaceFolderOf(resource);
		// 2. A card that generates does not generate twice.
		await this.taskStore.refresh(folder);
		if (this.isGenerating(resource)) {
			throw generatingError();
		}
		// 3. The model, the provider's setup, and the blockers known without the
		// inputs, of the mode that is used: it follows the inputs (generation
		// cards, "What is connected is sent"), as in the panel; the card keeps its own.
		const catalog = await this.preparation.catalog();
		const info = snapshot.info;
		const ref = findBaseHalfVideoModel(catalog, info.provider, info.model);
		const mode = ref ? baseHalfVideoModeThatIsUsed(ref.model, info.mode, await this.cardStore.resolveInputs(snapshot)) : undefined;
		const blocker = getBaseHalfVideoGenerateBlocker({
			generating: false,
			catalog: { kind: 'ready', catalog },
			generation: baseHalfGenerationChoice(info),
			kind: snapshot.kind,
			setup: provider => this.providerSettings.getStatus(provider),
			prompt: info.prompt,
			...(mode ? { mode } : {})
		});
		if (blocker || !ref || !mode) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText(blocker ?? { kind: 'noModel' }));
		}
		if (options.agent) {
			const refused = baseHalfVideoRefusedParam(ref.model, info.mode, info.params);
			if (refused) {
				throw new BaseHalfVideoGenerationError(refused);
			}
		}
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
		// Said alive from the start, so that a long preparation is not taken for a window that is gone.
		this.takeover.startHeartbeat();
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
			prepared = await this.preparation.prepare(follow, task, snapshot, ref, mode, follow.preparation.token);
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
		void this.submit(follow, prepared.request, prepared.lastUsed).catch(error => this.submitFailedUnexpectedly(follow, error));
		return Object.freeze(planned.paths.map(path => this.resourceOf(folder, path)));
	}

	/**
	 * Step 4: the draft itself, and for a `count` of an image or a music model
	 * above 1, that many cards in all, the further ones named like it with the
	 * next free numbers.
	 */
	private async planCards(snapshot: IBaseHalfGenerationCardSnapshot, ref: IBaseHalfVideoModelRef, modeId: BaseHalfVideoModeId, params: BaseHalfVideoParams): Promise<IPlannedCards> {
		const parent = dirname(snapshot.resource);
		const parentPath = snapshot.path.includes('/') ? snapshot.path.slice(0, snapshot.path.lastIndexOf('/')) : '';
		const parts = baseHalfGenerationNameParts(basename(snapshot.resource));
		const count = baseHalfModelOutputCount(ref.model, modeId, params);
		const drafts: string[] = [];
		let ordinal = 1;
		for (let index = 0; index < count - 1; index++) {
			const next = await this.cardStore.nextFreeName(parent, parts.base, parts.extension, ordinal);
			if (drafts.includes(next)) {
				throw new Error('The same name was chosen twice.');
			}
			drafts.push(next);
			ordinal = baseHalfGenerationNameOrdinal(next) + 1;
		}
		const childPath = (child: string) => parentPath ? `${parentPath}/${child}` : child;
		return { paths: Object.freeze([snapshot.path, ...drafts.map(childPath)]), drafts: Object.freeze(drafts) };
	}

	/**
	 * `basehalf --generate` on a card with its file (generation cards,
	 * "Agents"): makes a new version of it, as New Version does, and
	 * generates that draft. What would stop the generation before it reads the
	 * inputs stops it before the draft is made; a draft whose generation does
	 * not start is removed again, and one that starts is a step of undo, named
	 * New Version.
	 */
	private async generateNewVersion(snapshot: IBaseHalfGenerationCardSnapshot, options: IBaseHalfGenerateOptions): Promise<readonly URI[]> {
		const folder = this.workspaceFolderOf(snapshot.resource);
		const catalog = await this.preparation.catalog();
		if (snapshot.made) {
			const info = baseHalfGenerationInfoOfMade(snapshot.made);
			const blocker = getBaseHalfVideoGenerateBlocker({
				generating: false,
				catalog: { kind: 'ready', catalog },
				generation: baseHalfGenerationChoice(info),
				kind: snapshot.kind,
				setup: provider => this.providerSettings.getStatus(provider),
				prompt: info.prompt
			});
			if (blocker) {
				throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText(blocker));
			}
		}
		let draft: URI;
		try {
			draft = await createBaseHalfNewVersion({ cardStore: this.cardStore, ...this.placementServices() }, snapshot, folder, catalog);
		} catch (error) {
			throw toGenerationError(error);
		}
		let cards: readonly URI[];
		try {
			cards = await this.generate(draft, options);
		} catch (error) {
			await this.deleteDraftQuietly(draft);
			throw error;
		}
		BaseHalfDraftUndoElement.push(localize('basehalf.video.generation.undoNewVersion', "New Version"), 'basehalf.generation.newVersion', [this.canvasResourceOf(draft), draft], { kind: 'made', drafts: [draft] }, this.draftUndoServices())
			.catch(error => this.logService.warn(`[BaseHalf generation] The step of the new version ${draft.toString()} was not kept: ${getErrorMessage(error)}`));
		return cards;
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
		const key = folder ? this.pathKey(folder) : undefined;
		const rivals = this.taskStore.list().filter(other => other.id !== task.id
			&& this.taskStore.folderOf(other.id)?.toString() === folder?.toString()
			&& !isBaseHalfGenerationTaskEnded(other)
			&& !(other.state === 'preparing' && isBaseHalfGenerationTaskStale(other, now))
			&& task.cards.some(card => baseHalfGenerationTaskNamesCard(other, card.path, key)));
		if (rivals.length && baseHalfGenerationClaimWinner([this.taskStore.get(task.id) ?? task, ...rivals])?.id !== task.id) {
			throw generatingError();
		}
	}

	/** A card that generates again leaves the record of its earlier generation that ended without its file. */
	private async removeEndedRecordsOf(task: IBaseHalfGenerationTask): Promise<void> {
		const workspaceFolder = this.taskStore.folderOf(task.id);
		const folder = workspaceFolder?.toString();
		const key = workspaceFolder ? this.pathKey(workspaceFolder) : undefined;
		for (const other of this.taskStore.list()) {
			if (other.id !== task.id && isBaseHalfGenerationTaskEnded(other) && this.taskStore.folderOf(other.id)?.toString() === folder
				&& task.cards.some(card => baseHalfGenerationTaskNamesCard(other, card.path, key))) {
				await this.taskStore.remove(other.id);
			}
		}
	}

	prepareInputMedia(plan: readonly IBaseHalfVideoInputPlanItem[], inputs: readonly IBaseHalfVideoResolvedInput[], imageFormats: readonly BaseHalfVideoImageFormat[], token: CancellationToken = CancellationToken.None): Promise<IBaseHalfVideoPlannedMedia> {
		return this.preparation.prepareInputMedia(plan, inputs, imageFormats, token);
	}

	// --- running -------------------------------------------------------------------------------

	/**
	 * Step 8: send the request once; record the provider's task id, or land
	 * what it answered with. While the request is on its way, another window
	 * may end the record as failed, taking this window for gone: the answer is
	 * taken up all the same (generation cards, "Continuing after a reload or a
	 * restart").
	 */
	private async submit(follow: FollowedGeneration, request: IBaseHalfVideoSubmitRequest, lastUsed: IBaseHalfVideoGenerationChoice): Promise<void> {
		follow.receiving = true;
		try {
			await this.sendAndTakeUp(follow, request, lastUsed);
		} finally {
			follow.receiving = false;
		}
	}

	private async sendAndTakeUp(follow: FollowedGeneration, request: IBaseHalfVideoSubmitRequest, lastUsed: IBaseHalfVideoGenerationChoice): Promise<void> {
		const answer = await this.callProvider(service => service.submit(request), parseSubmitResult, true);
		if (answer.ok && hasKey(answer.value, { remoteId: true })) {
			follow.remoteId = answer.value.remoteId;
		}
		if (follow.stopped || follow.ended) {
			// Stopped by the user, or its record removed, while the request was on
			// its way: a task the provider made after all is cancelled, and files
			// that came with the answer go.
			if (answer.ok && hasKey(answer.value, { remoteId: true })) {
				await this.cancelRemote(follow);
			}
			if (follow.stopped) {
				await this.deleteParts(follow);
			}
			return;
		}
		if (!answer.ok) {
			await this.fail(follow, submitFailureMessage(answer, follow.secrets(), this.preparation.catalogProvider(follow.access?.provider), follow.access));
			return;
		}
		follow.lastUsed = lastUsed;
		if (hasKey(answer.value, { outputs: true })) {
			await this.landing.land(follow, answer.value.outputs.map(sourceOfOutput));
			return;
		}
		const remoteId = answer.value.remoteId;
		const nowText = new Date(Date.now()).toISOString();
		const running = await this.taskStore.update(follow.taskId, task => task.state === 'submitting'
			? runBaseHalfGenerationTask(task, remoteId)
			// Ended as failed by another window while the request was on its way: the provider has the task, so it is followed after all.
			: task.state === 'failed' && !this.hasRival(follow.folder, task)
				? reviveBaseHalfGenerationTask(task, this.follower, nowText, { state: 'running', remoteId })
				: task);
		if (running?.state !== 'running' || running.follower !== this.follower) {
			// The record was stopped or is gone: nobody follows this task, so it
			// is cancelled where the provider allows it.
			this.logService.info(`[BaseHalf generation] ${follow.taskId} changed while its request was sent.`);
			await this.cancelRemote(follow);
			this.untrack(follow);
			return;
		}
		this.schedulePoll(follow, BASEHALF_VIDEO_FIRST_POLL_DELAY);
	}

	schedulePoll(follow: FollowedGeneration, delay: number): void {
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

	/**
	 * Step 9: ask the provider about the task. The two hours a generation may
	 * take count only while the provider still says that it is not done: a
	 * task that finished while no window asked, or while the computer slept,
	 * lands however late it is asked.
	 */
	private async poll(follow: FollowedGeneration): Promise<void> {
		if (follow.stopped || follow.ended) {
			return;
		}
		if (!await this.takeover.stillFollowed(follow)) {
			return;
		}
		// A target is written only as a new file: one an earlier poll left is removed first.
		await this.deleteUnreceivedParts(follow);
		const answer = await this.callProvider(service => service.poll({ ...follow.taskRef(), targets: this.targetsOf(follow) }), parsePollState, false);
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
				if (Date.now() - follow.startedAt >= BASEHALF_VIDEO_TASK_TIME_LIMIT) {
					await this.fail(follow, tooLongMessage(follow.kind));
					return;
				}
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
				await this.landing.land(follow, state.outputs ? state.outputs.map(sourceOfOutput) : [{ kind: 'download', ...(state.videoUrl ? { url: state.videoUrl } : {}) }]);
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
		// A network error, an overloaded provider, or the provider service restarting: ask
		// again at the next interval, for up to 30 minutes in a row.
		const now = Date.now();
		follow.transientSince ??= now;
		if (now - follow.transientSince >= BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT) {
			await this.fail(follow, localize('basehalf.video.generation.lostContact', "BaseHalf could not reach the provider for 30 minutes. The generation may still finish there: check the provider's console. ({0})", detail));
			return;
		}
		this.schedulePoll(follow, BASEHALF_VIDEO_POLL_INTERVAL);
	}

	/**
	 * When every card has landed or failed: the record of a generation that
	 * landed every file is removed; one with a card that got no file stays, so
	 * that the card can say why, unless every such card is gone or, as the
	 * card at `released` is, being deleted.
	 */
	async settle(follow: FollowedGeneration, released?: number): Promise<void> {
		const task = await this.taskStore.update(follow.taskId, current => current);
		if (!task || !isBaseHalfGenerationTaskSettled(task)) {
			return;
		}
		const landed = task.cards.filter(card => card.state === 'landed').length;
		if (landed && follow.lastUsed) {
			// Step 11.
			this.providerSettings.setLastUsed(follow.lastUsed, follow.kind);
		}
		const gone = !await this.keepsRecord(follow.folder, task, released);
		if (gone) {
			await this.taskStore.remove(follow.taskId);
		} else if (!isBaseHalfGenerationTaskEnded(task)) {
			const error = task.cards.find(card => card.error)?.error ?? localize('basehalf.video.generation.notAll', "The provider did not make every file.");
			await this.taskStore.update(follow.taskId, current => failBaseHalfGenerationTask(current, error, new Date(Date.now()).toISOString()));
		}
		await this.deleteParts(follow);
		this.untrack(follow);
	}

	/**
	 * Whether a record that ends without some of its files is still needed: a
	 * card of it that got no file is there, with its file or as a draft, to say
	 * why. A card that landed keeps no record, and neither does the card at
	 * `released`, which is being deleted.
	 */
	private async keepsRecord(folder: URI, task: IBaseHalfGenerationTask, released?: number): Promise<boolean> {
		for (const [index, card] of task.cards.entries()) {
			if (index !== released && card.state !== 'landed' && await this.cardExists(folder, card.path)) {
				return true;
			}
		}
		return false;
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
			const model = record.request.model;
			try {
				const access = follow?.access ?? await this.accessOfTask(record);
				if (access && !follow?.cancelSent) {
					if (follow) {
						follow.cancelSent = true;
					}
					await this.callProvider(service => service.cancel({ ...access, model, remoteId }), parseAnything, false);
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
		if (!located || !task) {
			return;
		}
		if (isBaseHalfGenerationTaskEnded(task)) {
			await this.removeEndedRecordsOfReleased(located.folder, located.path);
			return;
		}
		const index = baseHalfGenerationTaskCardIndex(task, located.path, this.pathKey(located.folder));
		if (index < 0 || task.cards[index].state !== 'waiting') {
			return;
		}
		if (task.cards.length === 1) {
			// Its only card goes: the generation is stopped, and its record goes with the card.
			await this.stop(resource);
			await this.taskStore.remove(task.id, current => current.state === 'stopped');
			return;
		}
		await this.taskStore.update(task.id, current => current.cards[index]?.state === 'waiting' ? failBaseHalfGenerationCard(current, index, cardDeletedMessage()) : current);
		const follow = this.followed.get(task.id);
		if (follow && !follow.landing) {
			await this.settle(follow, index);
		}
	}

	/**
	 * A card is deleted after its generation ended without its file: each
	 * record of this computer that ended so and names it goes with it, once no
	 * other card of the record that got no file is left to say why (generation
	 * cards, "The task record"). Undoing the delete brings the card back as a
	 * draft, without the old error. A record that the window that sent its
	 * request took up again meanwhile is not ended any more, and stays.
	 */
	private async removeEndedRecordsOfReleased(folder: URI, path: string): Promise<void> {
		const key = this.pathKey(folder);
		for (const task of this.taskStore.list()) {
			if (!isBaseHalfGenerationTaskEnded(task) || this.taskStore.folderOf(task.id)?.toString() !== folder.toString()) {
				continue;
			}
			const index = baseHalfGenerationTaskCardIndex(task, path, key);
			if (index >= 0 && !await this.keepsRecord(folder, task, index)) {
				await this.taskStore.remove(task.id, current => isBaseHalfGenerationTaskEnded(current));
			}
		}
	}

	/** Best effort: providers cancel only some tasks, and nothing waits for it. */
	private async cancelRemote(follow: FollowedGeneration): Promise<void> {
		if (follow.cancelSent || !follow.access || !follow.remoteId) {
			return;
		}
		follow.cancelSent = true;
		await this.callProvider(service => service.cancel(follow.taskRef()), parseAnything, false);
	}

	/** Ends the generation as failed. Its partial downloads stay with its record: only a stop or the record's removal takes them. */
	private async fail(follow: FollowedGeneration, message: string): Promise<void> {
		follow.timer?.dispose();
		const endedAt = new Date(Date.now()).toISOString();
		try {
			await this.taskStore.update(follow.taskId, task => task.follower === this.follower ? failBaseHalfGenerationTask(task, message, endedAt) : task);
		} catch (error) {
			this.logService.info(`[BaseHalf generation] The failure of ${follow.taskId} was not written: ${getErrorMessage(error)}`);
		}
		this.untrack(follow);
	}

	async failCard(follow: FollowedGeneration, index: number, message: string): Promise<void> {
		await this.taskStore.update(follow.taskId, task => task.cards[index]?.state === 'waiting' ? failBaseHalfGenerationCard(task, index, message) : task);
		this.fireCards(follow);
	}

	/** The access a task is asked about with: its provider, in the region its request records. */
	async accessOfTask(task: IBaseHalfGenerationTask): Promise<IBaseHalfVideoProviderAccess | undefined> {
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
		// Pushed at once, with what the generation wrote into its drafts: a later change of them is told field by field.
		BaseHalfDraftUndoElement.push(localize('basehalf.video.generation.undoDrafts', "Generate"), 'basehalf.generation.drafts', [this.canvasResourceOf(resource), ...drafts], { kind: 'made', drafts }, this.draftUndoServices(),
			new Map(drafts.map(draft => [draft.toString(), info]))).catch(error => this.logService.warn(`[BaseHalf generation] The step of the drafts ${drafts.map(draft => draft.toString()).join(', ')} was not kept: ${getErrorMessage(error)}`));
	}

	/** The layout of the canvas a card is on, the resource its undo step goes with. */
	private canvasResourceOf(resource: URI): URI {
		const folder = this.workspaceFolderOf(resource);
		return this.canvasMirrorService.canvasResource(baseHalfParentCanvasFolder({ resource, workspaceFolder: folder, relativePath: this.relativePath(folder, resource) }));
	}

	private draftUndoServices() {
		return {
			isGenerating: (draft: URI) => this.isGenerating(draft),
			read: (draft: URI) => this.cardStore.read(draft),
			draftOperations: this.draftOperations,
			notificationService: this.notificationService,
			undoRedoService: this.undoRedoService
		};
	}

	// --- helpers -------------------------------------------------------------------------------

	async callProvider<T>(call: (service: IBaseHalfProviderService) => Promise<unknown>, parse: (value: unknown) => T | undefined, isSubmit: boolean): Promise<ProviderAnswer<T>> {
		let raw: unknown;
		try {
			raw = await call(this.providerService);
		} catch (error) {
			// The call did not reach the provider service of the shared process,
			// or the service stopped while it ran it (D75): for a request,
			// whether it reached the provider is unknown.
			return { ok: false, unavailable: !isSubmit, error: { code: isSubmit ? 'unknownOutcome' : 'network', message: getErrorMessage(error) } };
		}
		return parseProviderAnswer(raw, parse);
	}

	track(follow: FollowedGeneration): void {
		this.followed.set(follow.taskId, follow);
		this.fireCards(follow);
	}

	untrack(follow: FollowedGeneration): void {
		follow.ended = true;
		follow.timer?.dispose();
		follow.timer = undefined;
		if (this.followed.get(follow.taskId) === follow) {
			this.followed.delete(follow.taskId);
			this.fireCards(follow);
		}
		follow.preparation.dispose();
	}

	setPhase(follow: FollowedGeneration, phase: BaseHalfVideoGenerationPhase, fraction?: number): void {
		if (follow.ended || (follow.phase === phase && follow.fraction === fraction)) {
			return;
		}
		follow.phase = phase;
		follow.fraction = fraction;
		this.fireCards(follow);
	}

	fireCards(follow: FollowedGeneration): void {
		const paths = this.taskStore.get(follow.taskId)?.cards.map(card => card.path) ?? follow.paths;
		follow.paths = paths;
		for (const path of paths) {
			this._onDidChangeProgress.fire(this.resourceOf(follow.folder, path));
		}
	}

	fireTask(taskId: string, task: IBaseHalfGenerationTask): void {
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

	async deleteParts(follow: FollowedGeneration): Promise<void> {
		const task = this.taskStore.get(follow.taskId);
		if (task) {
			await this.deletePartsOf(task);
		}
	}

	async deletePartsOf(task: IBaseHalfGenerationTask): Promise<void> {
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

	async deleteQuietly(resource: URI): Promise<void> {
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

	/** How the paths of cards are compared in a workspace folder: without letter case where its volume ignores it. */
	private pathKey(folder: URI): BaseHalfGenerationPathKey {
		return this.uriIdentityService.extUri.ignorePathCasing(folder) ? path => path.toLowerCase() : path => path;
	}

	/** Whether another generation that has not ended lands on one of the task's cards. */
	hasRival(folder: URI, task: IBaseHalfGenerationTask): boolean {
		const key = this.pathKey(folder);
		return this.taskStore.list().some(other => other.id !== task.id
			&& !isBaseHalfGenerationTaskEnded(other)
			&& this.taskStore.folderOf(other.id)?.toString() === folder.toString()
			&& task.cards.some(card => baseHalfGenerationTaskNamesCard(other, card.path, key)));
	}

	placementServices() {
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

	resourceOf(folder: URI, path: string): URI {
		return URI.joinPath(folder, ...path.split('/'));
	}

	relativePath(folder: URI, resource: URI): string {
		return this.uriIdentityService.extUri.relativePath(folder, resource) ?? basename(resource);
	}

	/** `_store`, for the parts. */
	get store() {
		return this._store;
	}
}

registerSingleton(IBaseHalfVideoGenerationService, new SyncDescriptor(BaseHalfVideoGenerationService, [undefined], true));
