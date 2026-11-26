/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { decodeBase64 } from '../../../../base/common/buffer.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { hasKey } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { FileOperationResult, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { baseHalfMirrorPathSegments, baseHalfMirrorRoot } from '../../workspace/common/basehalfMirrorTree.js';
import { IBaseHalfWorkspaceMutationLease } from '../../workspace/common/basehalfWorkspaceMutation.js';
import { baseHalfIsDraftInformation, baseHalfReadDraftFacts } from '../common/basehalfGenerationDraft.js';
import { BASEHALF_GENERATION_MAX_FILE_BYTES, baseHalfGenerationExtensionMatchesFormat, baseHalfGenerationFileFormat, baseHalfGenerationFormatExtension, baseHalfGenerationMadeOfTask, baseHalfGenerationNameOrdinal, baseHalfGenerationNameParts, IBaseHalfGenerationTask, isBaseHalfGenerationFileAccepted, landBaseHalfGenerationTask, recordBaseHalfGenerationLanded, recordBaseHalfGenerationLanding, reviveBaseHalfGenerationTask } from '../common/basehalfGenerationInfo.js';
import { BaseHalfVideoOutputFormat, IBaseHalfVideoPlaceRequest, BaseHalfVideoOutput } from '../common/basehalfVideoCatalog.js';
import { BASEHALF_GENERATION_CARD_SIZE, baseHalfParentCanvasFolder, placeBaseHalfCardsBeside } from './basehalfGenerationPlacement.js';
import { FollowedGeneration, BASEHALF_VIDEO_POLL_INTERVAL } from './basehalfGenerationFollowed.js';
import { errorDetail, plainDetail, parseDownloadResult, parsePlaceResult } from './basehalfProviderAnswers.js';
import { receiveFailedMessage, fewerFilesMessage, closedWhileSavingMessage, notAcceptedMessage, placeFailedMessage, lostFileMessage, cardDeletedMessage, recordFailedMessage } from './basehalfVideoGenerationMessages.js';
import type { BaseHalfVideoGenerationService } from './basehalfVideoGenerationService.js';

/** Where the file of one card comes from: an address to download, a file the provider service already wrote, or the provider's refusal of it alone. */
export type LandingSource =
	| { readonly kind: 'download'; readonly url?: string }
	| { readonly kind: 'written'; readonly path: string }
	| { readonly kind: 'refused'; readonly reason: string };

export function sourceOfOutput(output: BaseHalfVideoOutput): LandingSource {
	if (hasKey(output, { refused: true })) {
		return { kind: 'refused', reason: output.refused };
	}
	if (hasKey(output, { written: true })) {
		return { kind: 'written', path: output.written };
	}
	return { kind: 'download', url: output.url };
}

/** A file of an output that could not be downloaded is tried this many times, asking the provider again between tries. */
const DOWNLOAD_ATTEMPTS = 3;

/** The bytes a file's format is read from. */
const FORMAT_HEAD_BYTES = 16;

/** How often the landing of one file tries another name when its name was taken at the last moment. */
const LANDING_ATTEMPTS = 3;

/** How often the landing of one file is tried when something fails before the file is moved. */
const LANDING_TRIES = 3;

/** How long apart those tries are. */
const LANDING_RETRY_DELAY = 5_000;

/** How long landing waits for a move outside BaseHalf that is still being followed, each try. */
const MOVES_SETTLE_WAIT = 10_000;

/** How often `made.yaml` is tried before the card says that the file landed without it. */
const MADE_ATTEMPTS = 3;

/** A file received in full into its partial download, of a format a card of its kind takes. */
interface IReceivedFile {
	readonly part: URI;
	readonly format: BaseHalfVideoOutputFormat;
}

/** How one try of landing a file ended. */
type ILandingOutcome = { readonly kind: 'done' | 'dropped' } | { readonly kind: 'retry'; readonly detail: string };

/** Where a received file goes ({@link BaseHalfVideoGenerationService.placeOf}). */
type IPlace =
	| { readonly kind: 'card'; readonly target: URI }
	| { readonly kind: 'beside'; readonly target: URI }
	| { readonly kind: 'deleted' }
	| { readonly kind: 'wait' };

/**
 * Landing: the files of a generation that succeeded, from the provider's answer to their cards. Each is
 * downloaded or taken where the provider wrote it, checked, placed on its card or beside it, and recorded with
 * what made it; a landing that fails is tried again, and one that a closed window left is recovered.
 *
 * A part of the generation service: it reaches the service's state as `service`.
 */
export class BaseHalfGenerationLanding {
	constructor(private readonly service: BaseHalfVideoGenerationService) { }

	// --- landing -------------------------------------------------------------------------------

	/**
	 * Step 10: each file lands on its card in the order of the outputs. The
	 * record is `landing` from the moment the provider has the files. The
	 * files the provider service wrote with its answer are complete, and their sizes and
	 * SHA-256 go into the record in one write before the first of them lands;
	 * a file downloaded from an address gets its own once it is received in
	 * full. So a window that takes the record over lands them again without a
	 * second download, and asks again for a file received only in part. An
	 * output the provider refused fails its card alone, and the cards that no
	 * output reaches fail as the ones the provider made nothing for.
	 */
	land(follow: FollowedGeneration, sources: readonly LandingSource[] | undefined): Promise<void> {
		const previous = follow.landing ?? Promise.resolve();
		const landing = previous.then(() => this.doLand(follow, sources));
		follow.landing = landing.catch(() => undefined);
		return landing;
	}

	private async doLand(follow: FollowedGeneration, sources: readonly LandingSource[] | undefined): Promise<void> {
		if (follow.stopped) {
			await this.service.deleteParts(follow);
			return;
		}
		if (follow.ended) {
			// Followed by another window now: the files belong to the task, not to this window.
			return;
		}
		this.service.setPhase(follow, 'saving');
		const nowText = new Date(Date.now()).toISOString();
		const task = await this.service.taskStore.update(follow.taskId, current => {
			if (current.state === 'submitting' || current.state === 'running') {
				return landBaseHalfGenerationTask(current);
			}
			// Another window ended it as failed while this one received the files: they land all the same.
			if (current.state === 'failed' && sources !== undefined && !this.service.hasRival(follow.folder, current)) {
				return reviveBaseHalfGenerationTask(current, this.service.follower, nowText, { state: 'landing' });
			}
			return current;
		});
		if (!task || task.state === 'stopped') {
			follow.stopped = true;
			await this.service.deleteParts(follow);
			this.service.untrack(follow);
			return;
		}
		if (task.state !== 'landing' || task.follower !== this.service.follower) {
			this.service.untrack(follow);
			return;
		}
		const prepared = sources ? await this.receiveWritten(follow, sources) : new Map<number, IReceivedFile>();
		let retry = false;
		for (let index = 0; index < task.cards.length; index++) {
			if (follow.stopped || follow.ended) {
				break;
			}
			const card = this.service.taskStore.get(follow.taskId)?.cards[index];
			if (!card || card.state !== 'waiting') {
				continue;
			}
			try {
				const ready = prepared.get(index);
				if (ready) {
					await this.landFile(follow, index, ready.part, ready.format);
					continue;
				}
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
				this.service.logService.error(`[BaseHalf generation] Card ${index + 1} of ${follow.taskId} could not be received: ${getErrorMessage(error)}`);
				await this.service.failCard(follow, index, receiveFailedMessage(follow.kind, error));
			}
		}
		if (follow.stopped) {
			await this.service.deleteParts(follow);
			return;
		}
		if (follow.ended) {
			return;
		}
		if (retry && follow.remoteId && follow.access) {
			// An address may have expired, or a file came only in part: the provider is asked again for what is left.
			this.service.schedulePoll(follow, BASEHALF_VIDEO_POLL_INTERVAL);
			return;
		}
		await this.service.settle(follow);
	}

	/**
	 * The files the provider service wrote with its answer: complete, since it answers only
	 * after it wrote them. Each is checked, and the sizes and SHA-256 of the
	 * ones taken go into the record in one write, before the first of them
	 * lands, so that a reload while they land loses none of them.
	 */
	private async receiveWritten(follow: FollowedGeneration, sources: readonly LandingSource[]): Promise<Map<number, IReceivedFile>> {
		const task = this.service.taskStore.get(follow.taskId);
		const received = new Map<number, IReceivedFile & { readonly size: number; readonly sha256: string }>();
		if (!task) {
			return new Map();
		}
		for (const [index, source] of sources.entries()) {
			const card = task.cards[index];
			if (source?.kind !== 'written' || !card || card.state !== 'waiting' || card.landing) {
				continue;
			}
			const part = this.service.taskStore.partFile(task, index);
			try {
				if (!this.service.uriIdentityService.extUri.isEqual(URI.file(source.path), part)) {
					this.service.logService.warn(`[BaseHalf generation] The provider service wrote ${source.path}, not ${part.fsPath}.`);
				}
				const checked = await this.checkFile(follow, part);
				if (hasKey(checked, { problem: true })) {
					await this.service.deleteQuietly(part);
					await this.service.failCard(follow, index, checked.problem);
					continue;
				}
				received.set(index, { part, format: checked.format, size: (await this.service.fileService.stat(part)).size, sha256: await this.sha256(part) });
			} catch (error) {
				this.service.logService.error(`[BaseHalf generation] Card ${index + 1} of ${follow.taskId} could not be received: ${getErrorMessage(error)}`);
				await this.service.failCard(follow, index, receiveFailedMessage(follow.kind, error));
			}
		}
		if (!received.size) {
			return new Map();
		}
		const marked = await this.service.taskStore.update(follow.taskId, current => {
			let next = current;
			for (const [index, file] of received) {
				if (next.state === 'landing' && next.cards[index]?.state === 'waiting') {
					next = recordBaseHalfGenerationLanding(next, index, { path: next.cards[index].path, size: file.size, sha256: file.sha256 });
				}
			}
			return next;
		});
		return new Map([...received].filter(([index]) => !!marked?.cards[index]?.landing).map(([index, file]) => [index, { part: file.part, format: file.format }]));
	}

	/**
	 * Receives the output of one card into its partial download: downloads it
	 * when it is an address, checks it, and writes its size and SHA-256 into
	 * the record.
	 */
	private async receive(follow: FollowedGeneration, index: number, source: LandingSource | undefined): Promise<IReceivedFile | 'failed' | 'retry'> {
		const task = this.service.taskStore.get(follow.taskId)!;
		const part = this.service.taskStore.partFile(task, index);
		if (!source) {
			await this.service.failCard(follow, index, fewerFilesMessage(follow.kind, task.cards.length));
			return 'failed';
		}
		if (source.kind === 'refused') {
			await this.service.deleteQuietly(part);
			await this.service.failCard(follow, index, localize('basehalf.video.generation.outputRefused', "The provider refused this one: {0}", plainDetail(source.reason, follow.secrets())));
			return 'failed';
		}
		if (source.kind === 'written') {
			if (!this.service.uriIdentityService.extUri.isEqual(URI.file(source.path), part)) {
				this.service.logService.warn(`[BaseHalf generation] The provider service wrote ${source.path}, not ${part.fsPath}.`);
			}
		} else {
			const downloaded = await this.download(follow, index, part, source.url);
			if (downloaded !== 'downloaded') {
				return downloaded;
			}
		}
		const checked = await this.checkFile(follow, part);
		if (hasKey(checked, { problem: true })) {
			await this.service.deleteQuietly(part);
			await this.service.failCard(follow, index, checked.problem);
			return 'failed';
		}
		const size = (await this.service.fileService.stat(part)).size;
		const sha256 = await this.sha256(part);
		const marked = await this.service.taskStore.update(follow.taskId, current => current.state === 'landing' && current.cards[index]?.state === 'waiting'
			? recordBaseHalfGenerationLanding(current, index, { path: current.cards[index].path, size, sha256 })
			: current);
		if (!marked?.cards[index]?.landing) {
			if (this.isDroppedForGood(follow, marked, index)) {
				await this.service.deleteQuietly(part);
			}
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
		await this.service.deleteQuietly(this.service.taskStore.partFile(this.service.taskStore.get(follow.taskId)!, index));
		if (follow.remoteId && follow.access) {
			return 'retry';
		}
		await this.service.failCard(follow, index, closedWhileSavingMessage());
		return 'failed';
	}

	private async download(follow: FollowedGeneration, index: number, part: URI, url: string | undefined): Promise<'downloaded' | 'failed' | 'retry'> {
		if (!follow.access) {
			await this.service.failCard(follow, index, closedWhileSavingMessage());
			return 'failed';
		}
		// The provider service writes only a file that is not there: a download cut short before is gone first.
		await this.service.deleteQuietly(part);
		const answer = await this.service.callProvider(service => service.download({
			...follow.taskRef(),
			...(url !== undefined ? { url } : {}),
			kind: follow.kind,
			targetFsPath: part.fsPath
		}), parseDownloadResult, false);
		if (follow.stopped) {
			await this.service.deleteQuietly(part);
			return 'failed';
		}
		if (follow.ended) {
			// Followed by another window now: what was downloaded stays for it.
			return 'failed';
		}
		if (answer.ok) {
			return 'downloaded';
		}
		await this.service.deleteQuietly(part);
		const detail = errorDetail(answer.error, follow.secrets());
		if (!answer.unavailable && (answer.error.code === 'notVideo' || answer.error.code === 'notImage' || answer.error.code === 'notAudio' || answer.error.code === 'tooLarge')) {
			await this.service.failCard(follow, index, notAcceptedMessage(follow.kind, detail));
			return 'failed';
		}
		const failures = (follow.downloadFailures.get(index) ?? 0) + 1;
		follow.downloadFailures.set(index, failures);
		if (failures >= DOWNLOAD_ATTEMPTS || !follow.remoteId) {
			await this.service.failCard(follow, index, localize('basehalf.video.generation.downloadFailed', "The provider made it, but BaseHalf could not download it. Check the provider's console: {0}", detail));
			return 'failed';
		}
		return 'retry';
	}

	/** Landing, step 1's check: the format and the size the kind takes. Returns the format, or why the file is not taken. */
	private async checkFile(follow: FollowedGeneration, part: URI): Promise<{ readonly format: BaseHalfVideoOutputFormat } | { readonly problem: string }> {
		let size: number;
		let head: Uint8Array;
		try {
			size = (await this.service.fileService.stat(part)).size;
			head = (await this.service.fileService.readFile(part, { length: FORMAT_HEAD_BYTES })).value.buffer;
		} catch (error) {
			return { problem: receiveFailedMessage(follow.kind, error) };
		}
		const format = baseHalfGenerationFileFormat(head, follow.kind);
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
	 * Whether the file of a card is not wanted any more, so that it is removed:
	 * the user stopped the generation, its record is gone, or the card was
	 * released because it is being deleted. A record that another window
	 * follows now, or that another window ended as failed, keeps its files.
	 */
	private isDroppedForGood(follow: FollowedGeneration, task: IBaseHalfGenerationTask | undefined, index: number): boolean {
		if (follow.stopped || !task || task.state === 'stopped') {
			return true;
		}
		const card = task.cards[index];
		return card?.state === 'failed' && !(task.state === 'failed' && card.error === task.error);
	}

	/**
	 * Steps 2 to 6 of landing for one received file. A problem before the
	 * file is moved keeps the file and tries again a few seconds later, and
	 * fails the card only when it keeps coming back; a problem after the move
	 * leaves the file where it is and says so.
	 */
	private async landFile(follow: FollowedGeneration, index: number, part: URI, format: BaseHalfVideoOutputFormat): Promise<void> {
		for (let attempt = 1; ; attempt++) {
			const final = attempt >= LANDING_TRIES;
			const outcome = await this.tryLandFile(follow, index, part, format, final);
			if (outcome.kind !== 'retry') {
				return;
			}
			if (follow.stopped || follow.ended) {
				return;
			}
			if (final) {
				this.service.logService.error(`[BaseHalf generation] Card ${index + 1} of ${follow.taskId} could not be put in place: ${outcome.detail}`);
				await this.service.failCard(follow, index, placeFailedMessage(follow.kind, outcome.detail));
				return;
			}
			await timeout(LANDING_RETRY_DELAY);
		}
	}

	/**
	 * One try of steps 2 to 6, inside the workspace mutation lease, so that no
	 * move or rename of this window runs between deciding the file's place and
	 * moving it there. A move outside BaseHalf that is still being followed
	 * finishes first. Then a draft of another format than the file is renamed
	 * for it; the path is read from the record again; the file's place is
	 * decided ({@link placeOf}); a folder that is gone is made again; the
	 * record says where the file goes; the file is put there without
	 * replacing anything ({@link publish}); and `made.yaml` is written.
	 */
	private async tryLandFile(follow: FollowedGeneration, index: number, part: URI, format: BaseHalfVideoOutputFormat, final: boolean): Promise<ILandingOutcome> {
		await this.service.movedItemsService.whenSettled(follow.folder, MOVES_SETTLE_WAIT);
		try {
			return await this.service.mutationCoordinator.runExclusive(follow.folder, async lease => {
				await this.renameForFormat(follow, index, format, lease);
				for (let attempt = 1; attempt <= LANDING_ATTEMPTS; attempt++) {
					const task = await this.service.taskStore.update(follow.taskId, current => current);
					const card = task?.cards[index];
					if (this.isDroppedForGood(follow, task, index)) {
						await this.service.deleteQuietly(part);
						return { kind: 'dropped' };
					}
					if (!task || !card?.landing || card.state !== 'waiting' || task.state !== 'landing' || task.follower !== this.service.follower || follow.ended) {
						// Followed by another window now: the file stays for it.
						return { kind: 'dropped' };
					}
					const landing = card.landing;
					if (!await this.service.fileService.exists(part)) {
						// Put in place by an earlier try that did not finish: only its record is left to write.
						const placed = this.service.resourceOf(follow.folder, landing.path);
						if (await this.matches(placed, landing.size, landing.sha256)) {
							await this.finishLanding(follow, index, placed);
							return { kind: 'done' };
						}
						await this.service.failCard(follow, index, lostFileMessage());
						return { kind: 'dropped' };
					}
					const place = await this.placeOf(follow, card.path, format, final);
					if (place.kind === 'wait') {
						return { kind: 'retry', detail: 'a move is still being followed' };
					}
					if (place.kind === 'deleted') {
						// The card was deleted while it generated (generation cards, "Deleting"): its file is not landed.
						await this.service.deleteQuietly(part);
						await this.service.failCard(follow, index, cardDeletedMessage());
						return { kind: 'dropped' };
					}
					const parent = dirname(place.target);
					if (!await this.service.fileService.exists(parent)) {
						await this.service.fileService.createFolder(parent);
					}
					const targetPath = this.service.relativePath(follow.folder, place.target);
					const marked = await this.service.taskStore.update(follow.taskId, current => current.state === 'landing' && current.cards[index]?.state === 'waiting'
						? recordBaseHalfGenerationLanding(current, index, { path: targetPath, size: landing.size, sha256: landing.sha256 })
						: current);
					if (marked?.cards[index]?.landing?.path !== targetPath) {
						continue;
					}
					if (!await this.publish(part, place.target)) {
						// The name was taken at the last moment, outside BaseHalf: the file goes beside it.
						continue;
					}
					await this.finishLanding(follow, index, place.target);
					if (place.kind === 'beside') {
						await placeBaseHalfCardsBeside(this.service.placementServices(), baseHalfParentCanvasFolder({ resource: this.service.resourceOf(follow.folder, card.path), workspaceFolder: follow.folder, relativePath: card.path }), card.path,
							[{ path: targetPath, size: BASEHALF_GENERATION_CARD_SIZE[follow.kind] }], { lease });
					}
					return { kind: 'done' };
				}
				return { kind: 'retry', detail: 'every name BaseHalf tried was taken' };
			});
		} catch (error) {
			return { kind: 'retry', detail: plainDetail(getErrorMessage(error), []) };
		}
	}

	/**
	 * Where a received file goes (generation cards, "Landing"): on its card,
	 * the draft at the record's path; beside it, at the next free name with
	 * the extension of the file's format, with its own record, when a file
	 * took the path, or when the draft's card information is not at the path
	 * and BaseHalf cannot tell that it was deleted; or nowhere, when the card
	 * was deleted: its card information is gone and no move is being followed.
	 * While a move is being followed, it waits, except on the last try.
	 */
	private async placeOf(follow: FollowedGeneration, path: string, format: BaseHalfVideoOutputFormat, final: boolean): Promise<IPlace> {
		const folder = follow.folder;
		const resource = this.service.resourceOf(folder, path);
		const facts = await baseHalfReadDraftFacts(this.service.fileService, folder, path);
		const settled = this.service.movedItemsService.isSettled(folder) && !this.service.movedItemsService.isMoving(folder, path);
		if (!facts.itemExists && baseHalfIsDraftInformation(facts)) {
			if (!settled && !final && !await this.service.fileService.exists(dirname(resource))) {
				// Its folder is gone while a move is followed: it may be on its way, and is not made again yet.
				return { kind: 'wait' };
			}
			return { kind: 'card', target: resource };
		}
		if (!facts.itemExists && !settled && !final) {
			return { kind: 'wait' };
		}
		if (!facts.itemExists && settled && await this.mirrorDirectoryGone(folder, path)) {
			return { kind: 'deleted' };
		}
		const parts = baseHalfGenerationNameParts(basename(resource));
		const free = await this.service.cardStore.nextFreeName(dirname(resource), parts.base, baseHalfGenerationFormatExtension(format), baseHalfGenerationNameOrdinal(basename(resource)));
		return { kind: 'beside', target: URI.joinPath(dirname(resource), free) };
	}

	/** Whether nothing of a card's card information is left: its directory under `.bh/mirror/` is not there. */
	private async mirrorDirectoryGone(folder: URI, path: string): Promise<boolean> {
		try {
			await this.service.fileService.stat(URI.joinPath(baseHalfMirrorRoot(folder), ...baseHalfMirrorPathSegments(path)));
			return false;
		} catch (error) {
			return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND;
		}
	}

	/**
	 * Puts a received file at `target` without ever replacing anything there,
	 * and with nothing partial in the card's folder at any moment: the provider service
	 * gives the complete partial download the card's name by a hard link,
	 * which fails when the name is taken, and then removes the partial
	 * download (providers, "Requests"). Resolves `false` when the name is
	 * taken; rejects when the file could not be put in place, so that landing
	 * tries again.
	 */
	private async publish(part: URI, target: URI): Promise<boolean> {
		const request: IBaseHalfVideoPlaceRequest = { from: part.fsPath, to: target.fsPath };
		const answer = await this.service.callProvider(service => service.place(request), parsePlaceResult, false);
		if (answer.ok) {
			return true;
		}
		if (!answer.unavailable && answer.error.code === 'exists') {
			return false;
		}
		throw new Error(errorDetail(answer.error, []));
	}

	/** Landing, step 2: a file of another format than the draft's extension renames the draft to that format's extension, inside the lease that the landing holds. */
	private async renameForFormat(follow: FollowedGeneration, index: number, format: BaseHalfVideoOutputFormat, lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		const card = this.service.taskStore.get(follow.taskId)?.cards[index];
		if (!card || baseHalfGenerationExtensionMatchesFormat(card.path, format)) {
			return;
		}
		const resource = this.service.resourceOf(follow.folder, card.path);
		const snapshot = await this.service.cardStore.read(resource).catch(() => undefined);
		if (!snapshot || snapshot.hasFile || snapshot.made) {
			// Not a draft any more: the file lands beside it under its own format's name.
			return;
		}
		const name = basename(resource);
		const parts = baseHalfGenerationNameParts(name);
		const extension = baseHalfGenerationFormatExtension(format);
		const next = await this.service.cardStore.nextFreeName(dirname(resource), parts.base, extension, baseHalfGenerationNameOrdinal(name));
		try {
			await this.service.draftOperations.move(resource, URI.joinPath(dirname(resource), next), { lease });
		} catch (error) {
			// The file still lands, by what the record and the card information say then.
			this.service.logService.warn(`[BaseHalf generation] ${card.path} could not be renamed to ${next}: ${getErrorMessage(error)}`);
		}
	}

	/**
	 * Landing, step 6: `made.yaml`, then the removal of the card's
	 * `generation.yaml`, since what made the file is its record now (D67); a
	 * file that landed beside its card has none to remove; and the card is
	 * landed. A `made.yaml` that cannot be written leaves the file in place,
	 * and the card says so.
	 */
	private async finishLanding(follow: FollowedGeneration, index: number, target: URI): Promise<void> {
		const task = this.service.taskStore.get(follow.taskId);
		if (!task) {
			return;
		}
		const made = baseHalfGenerationMadeOfTask(task, index, new Date(Date.now()).toISOString());
		let failure: Error | undefined;
		for (let attempt = 1; attempt <= MADE_ATTEMPTS; attempt++) {
			try {
				await this.service.cardStore.writeMade(target, made);
				failure = undefined;
				break;
			} catch (error) {
				// Written before a crash: the record of this generation is there already.
				const existing = await this.service.cardStore.read(target).then(snapshot => snapshot.made, () => undefined);
				if (existing?.id === made.id) {
					failure = undefined;
					break;
				}
				failure = error instanceof Error ? error : new Error(String(error));
			}
		}
		if (failure) {
			this.service.logService.error(`[BaseHalf generation] The record of how ${target.toString()} was made could not be written: ${failure.message}`);
			await this.service.failCard(follow, index, recordFailedMessage(follow.kind, failure));
			return;
		}
		// The draft's prompt and settings were for this generation; the file's record says what made it now. One that stays, as after a crash here, is not read beside a file.
		await this.service.cardStore.removeInfo(target).catch(error => this.service.logService.warn(`[BaseHalf generation] The generation.yaml of ${this.service.relativePath(follow.folder, target)} stays beside its file: ${getErrorMessage(error)}`));
		await this.service.taskStore.update(follow.taskId, current => current.cards[index]?.state === 'waiting' && current.state === 'landing' ? recordBaseHalfGenerationLanded(current, index) : current);
		this.service.fireCards(follow);
	}

	/**
	 * A card whose record says what was being landed (generation cards,
	 * "Landing"): the file at the recorded path with the recorded size and
	 * SHA-256 was put in place before a crash, and only step 6 is left; a
	 * partial download that matches them was received in full and lands now.
	 */
	private async recoverLanding(follow: FollowedGeneration, index: number): Promise<void> {
		const task = this.service.taskStore.get(follow.taskId);
		const card = task?.cards[index];
		const landing = card?.landing;
		if (!task || !card || !landing) {
			return;
		}
		const target = this.service.resourceOf(follow.folder, landing.path);
		const part = this.service.taskStore.partFile(task, index);
		if (await this.matches(target, landing.size, landing.sha256)) {
			await this.service.mutationCoordinator.runExclusive(follow.folder, () => this.finishLanding(follow, index, target));
			return;
		}
		if (await this.matches(part, landing.size, landing.sha256)) {
			const checked = await this.checkFile(follow, part);
			if (hasKey(checked, { format: true })) {
				await this.landFile(follow, index, part, checked.format);
				return;
			}
		}
		await this.service.failCard(follow, index, closedWhileSavingMessage());
	}

	private async matches(resource: URI, size: number, sha256: string): Promise<boolean> {
		try {
			return (await this.service.fileService.stat(resource)).size === size && await this.sha256(resource) === sha256;
		} catch {
			return false;
		}
	}

	/** The SHA-256 of a file in lower-case hex, read where the file is. */
	private async sha256(resource: URI): Promise<string> {
		const checksum = await this.service.checksumService.checksum(resource);
		return [...decodeBase64(checksum).buffer.subarray(0, 32)].map(byte => byte.toString(16).padStart(2, '0')).join('');
	}
}
