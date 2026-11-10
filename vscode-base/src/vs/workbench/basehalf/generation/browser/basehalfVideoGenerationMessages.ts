/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { BaseHalfGenerationKind } from '../common/basehalfGenerationInfo.js';
import { plainDetail, type ProviderAnswer, errorDetail } from './basehalfProviderAnswers.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { IBaseHalfVideoCatalogProvider, IBaseHalfVideoProviderAccess, baseHalfVideoRefusedInRegion, baseHalfVideoGenerateBlockerText } from '../common/basehalfVideoCatalog.js';
import { BaseHalfVideoGenerationError } from '../common/basehalfVideoGeneration.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

// What a generation that failed, stopped, or lost something says on its card, and the errors Generate rejects with.

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

/** Receiving a file failed: downloading it, reading it, or checking it. */
export function receiveFailedMessage(kind: BaseHalfGenerationKind, error: unknown): string {
	const detail = plainDetail(getErrorMessage(error), []);
	switch (kind) {
		case 'image': return localize('basehalf.video.generation.receiveFailedImage', "BaseHalf could not receive the image from the provider: {0}", detail);
		case 'video': return localize('basehalf.video.generation.receiveFailed', "BaseHalf could not receive the video from the provider: {0}", detail);
		case 'audio': return localize('basehalf.video.generation.receiveFailedSound', "BaseHalf could not receive the sound from the provider: {0}", detail);
	}
}

/** The file was received, but could not be put into the card's folder, however often it was tried. */
export function placeFailedMessage(kind: BaseHalfGenerationKind, detail: string): string {
	switch (kind) {
		case 'image': return localize('basehalf.video.generation.placeFailedImage', "BaseHalf received the image but could not put it into its folder: {0}", detail);
		case 'video': return localize('basehalf.video.generation.placeFailed', "BaseHalf received the video but could not put it into its folder: {0}", detail);
		case 'audio': return localize('basehalf.video.generation.placeFailedSound', "BaseHalf received the sound but could not put it into its folder: {0}", detail);
	}
}

/** The file is in its folder; the record of how it was made could not be written. */
export function recordFailedMessage(kind: BaseHalfGenerationKind, error: Error): string {
	const detail = plainDetail(error.message, []);
	switch (kind) {
		case 'image': return localize('basehalf.video.generation.recordFailedImage', "The image is in its folder, but BaseHalf could not record how it was made: {0}", detail);
		case 'video': return localize('basehalf.video.generation.recordFailed', "The video is in its folder, but BaseHalf could not record how it was made: {0}", detail);
		case 'audio': return localize('basehalf.video.generation.recordFailedSound', "The sound is in its folder, but BaseHalf could not record how it was made: {0}", detail);
	}
}

/**
 * Why a card of a generation got no file because the provider made fewer
 * than asked (generation cards, "Several images from one generation"): fewer
 * images, or fewer songs, or no file at all for a generation of one.
 */
export function fewerFilesMessage(kind: BaseHalfGenerationKind, cards: number): string {
	if (kind === 'image') {
		return localize('basehalf.video.generation.fewerImages', "The provider made fewer images than asked.");
	}
	return kind === 'audio' && cards > 1
		? localize('basehalf.video.generation.fewerSongs', "The provider made fewer songs than asked.")
		: localize('basehalf.video.generation.noFile', "The provider answered without the file.");
}

/** A received file that is gone before it was put in place. */
export function lostFileMessage(): string {
	return localize('basehalf.video.generation.lostFile', "The file BaseHalf received is gone before it could be put in place. Check the provider's console.");
}

/** Two hours after the start, no window of this computer could ask the provider about the task. */
export function unaskedMessage(): string {
	return localize('basehalf.video.generation.unasked', "BaseHalf could not ask the provider about this generation, because the provider is not set up on this computer. It may have finished there: check the provider's console.");
}

export function cardDeletedMessage(): string {
	return localize('basehalf.video.generation.cardDeleted', "The card was deleted.");
}

export function closedWhileSavingMessage(): string {
	return localize('basehalf.video.generation.closedWhileSaving', "BaseHalf closed while it saved this file, and the file is not there. Check the provider's console.");
}

export function tooLongMessage(kind: BaseHalfGenerationKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.video.generation.tooLongImage', "The provider did not finish the image within two hours.");
		case 'video': return localize('basehalf.video.generation.tooLong', "The provider did not finish the video within two hours.");
		case 'audio': return localize('basehalf.video.generation.tooLongSound', "The provider did not finish the sound within two hours.");
	}
}

export function notAcceptedMessage(kind: BaseHalfGenerationKind, detail: string): string {
	switch (kind) {
		case 'image': return localize('basehalf.video.generation.notImage', "The provider's file is not a PNG, JPEG, or WebP image of at most 64 MiB: {0}", detail);
		case 'video': return localize('basehalf.video.generation.notVideo', "The provider's file is not an MP4 video of at most 512 MiB: {0}", detail);
		case 'audio': return localize('basehalf.video.generation.notAudio', "The provider's file is not an MP3, WAV, FLAC, Ogg, or M4A sound of at most 256 MiB: {0}", detail);
	}
}

/**
 * The words of a request the provider did not take. Credentials that a
 * provider of more than one region refused at its region's own address name
 * that region and the other one (D94).
 */
export function submitFailureMessage(answer: Extract<ProviderAnswer<unknown>, { ok: false }>, secrets: readonly string[], provider: IBaseHalfVideoCatalogProvider | undefined, access: IBaseHalfVideoProviderAccess | undefined): string {
	const error = answer.error;
	const detail = errorDetail(error, secrets);
	if (answer.unavailable) {
		return localize('basehalf.video.generation.notSent', "Nothing was sent to the provider: {0}", detail);
	}
	switch (error.code) {
		case 'auth':
			return (access && baseHalfVideoRefusedInRegion(provider, access, detail))
				?? localize('basehalf.video.generation.refusedKey', "The provider refused the credentials: {0}", detail);
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
			return localize('basehalf.video.generation.unknownProvider', "BaseHalf does not know this provider, and nothing was sent: {0}", detail);
		default:
			return detail ? `${unknownOutcomeMessage()} (${detail})` : unknownOutcomeMessage();
	}
}

export function missingInputMessage(path: string): string {
	return localize('basehalf.video.generation.inputMissing', "{0} is missing. Connect it again or remove its connection.", inputName(path));
}

export function generatingError(): BaseHalfVideoGenerationError {
	return new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'generating' }));
}

export function stoppedBeforeStartError(): BaseHalfVideoGenerationError {
	return new BaseHalfVideoGenerationError(localize('basehalf.video.generation.stoppedBeforeStart', "The generation was stopped before it started."));
}

export function inputName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1) || path;
}

export function toGenerationError(error: unknown): BaseHalfVideoGenerationError {
	if (error instanceof BaseHalfVideoGenerationError) {
		return error;
	}
	return new BaseHalfVideoGenerationError(localize('basehalf.video.generation.startFailed', "BaseHalf could not start the generation: {0}", plainDetail(getErrorMessage(error), [])));
}

export function throwIfCancelled(token: CancellationToken): void {
	if (token.isCancellationRequested) {
		throw stoppedBeforeStartError();
	}
}
