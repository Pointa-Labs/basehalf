/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Schemas } from '../../../../base/common/network.js';
import { extname } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { IBaseHalfGenerationRequest, IBaseHalfGenerationTask } from '../common/basehalfGenerationInfo.js';
import { buildBaseHalfPromptParts } from '../common/basehalfGenerationMentions.js';
import { BASEHALF_VIDEO_IMAGE_FORMATS, BaseHalfVideoGenerateBlocker, baseHalfVideoGenerateBlockerText, BaseHalfVideoImageFormat, baseHalfVideoInputProblem, BaseHalfVideoMedia, baseHalfVideoSentParams, findBaseHalfVideoProvider, fitBaseHalfVideoParams, IBaseHalfVideoCatalog, IBaseHalfVideoCatalogMode, IBaseHalfVideoCatalogProvider, IBaseHalfVideoInputPlanItem, IBaseHalfVideoModelRef, IBaseHalfVideoPlannedMedia, IBaseHalfVideoProviderAccess, IBaseHalfVideoSubmitRequest, isBaseHalfSpokenOrSungPrompt, normalizeBaseHalfVideoParams, parseBaseHalfVideoCheckResult, planBaseHalfVideoInputs } from '../common/basehalfVideoCatalog.js';
import { BaseHalfVideoGenerationError, IBaseHalfGenerationCardSnapshot, IBaseHalfVideoResolvedInput } from '../common/basehalfVideoGeneration.js';
import { FollowedGeneration, type IPreparedGeneration, BASEHALF_VIDEO_CATALOG_WAIT } from './basehalfGenerationFollowed.js';
import { errorDetail } from './basehalfProviderAnswers.js';
import { throwIfCancelled, missingInputMessage, inputName } from './basehalfVideoGenerationMessages.js';
import { readBaseHalfVideoTextInput } from './basehalfGenerationInputReading.js';
import type { BaseHalfVideoGenerationService } from './basehalfVideoGenerationService.js';

/** The largest image BaseHalf draws to PNG in the window. */
const RASTER_MAX_BYTES = 64 * 1024 * 1024;

/** How many images drawn to PNG the service keeps, so the panel's checks do not draw them again. */
const DRAWN_IMAGES_KEPT = 16;

const DIRECT_IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' });

const DIRECT_IMAGE_FORMATS: Readonly<Record<string, BaseHalfVideoImageFormat>> = Object.freeze({ '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' });

const RASTER_IMAGE_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp' });

const VIDEO_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.webm': 'video/webm' });

const AUDIO_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac' });

/**
 * What a generation sends: the model and its provider, the prompt with its mentions written as the provider names
 * them, and each input read, checked, and made into what the provider takes. Nothing is sent from here.
 *
 * A part of the generation service: it keeps its own state, and reaches the service's as `service`.
 */
export class BaseHalfGenerationPreparation {
	/** Images drawn to PNG, by file, modification time, and size; the oldest goes first. */
	private readonly drawnImages = new Map<string, string>();

	constructor(private readonly service: BaseHalfVideoGenerationService) { }

	/**
	 * Step 6: the access to the provider, the inputs planned from the mode's
	 * slots and read, the prompt, and the provider module's check of the
	 * planned generation with its files. Writes nothing.
	 */
	async prepare(follow: FollowedGeneration, task: IBaseHalfGenerationTask, snapshot: IBaseHalfGenerationCardSnapshot, ref: IBaseHalfVideoModelRef, mode: IBaseHalfVideoCatalogMode, token: CancellationToken): Promise<IPreparedGeneration> {
		const info = snapshot.info;
		let access: IBaseHalfVideoProviderAccess | undefined;
		try {
			access = await this.service.providerSettings.getAccess(ref.provider);
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
		const resolved = await this.service.cardStore.resolveInputs(snapshot);
		throwIfCancelled(token);
		const plan = planBaseHalfVideoInputs(mode.inputs, resolved);
		const draft = plan.find(item => item.reason === 'draft');
		if (draft) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'draftInput', path: draft.path }));
		}
		// Every input is sent (generation cards, "What is connected is sent"): one that no mode can use stops the generation.
		const unusable = baseHalfVideoInputProblem(ref.model, resolved);
		if (unusable) {
			const name = unusable.path.slice(unusable.path.lastIndexOf('/') + 1) || unusable.path;
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'unusableInput', path: unusable.path, name, reason: unusable.reason }));
		}
		const params = normalizeBaseHalfVideoParams(ref.model, mode.id, info.params);
		// What is sent and recorded: without the values a start frame sets.
		const sent = baseHalfVideoSentParams(ref.model, mode.id, params, plan.some(item => item.use === 'start-frame'));
		const texts = new Map<number, string>();
		const used: string[] = [];
		for (const [index, item] of plan.entries()) {
			if (item.use === 'unused') {
				continue;
			}
			used.push(item.path);
			if (item.use === 'text') {
				texts.set(index, await this.readText(resolved[index], item));
				throwIfCancelled(token);
			}
		}
		// The prompt in parts: each mention as its input's place in the request, which the provider module names (D74);
		// a prompt that is spoken or sung says the text of its notes without their names (D78).
		const prompt = buildBaseHalfPromptParts(info.prompt, plan, (_item, index) => texts.get(index), { spokenOrSung: isBaseHalfSpokenOrSungPrompt(ref.model, mode.id) });
		if (prompt.unconnected !== undefined) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'unconnectedMention', path: prompt.unconnected }));
		}
		const inputs = await this.prepareInputMedia(plan, resolved, mode.limits.imageFormats ?? BASEHALF_VIDEO_IMAGE_FORMATS, token);
		if (prompt.empty && !inputs.startFrame && !inputs.endFrame && !inputs.source && !inputs.images.length && !inputs.videos.length && !inputs.audios.length) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'nothingToSend' }));
		}
		// The provider module checks the planned generation with its files:
		// sizes, lengths, counts, the prompt, and the rules between values.
		const checked = await this.service.callProvider(service => service.check({
			provider: ref.provider.id,
			region: access.region,
			model: ref.model.id,
			mode: mode.id,
			params: sent,
			prompt: prompt.parts,
			inputs,
			// A custom provider's check carries what the user entered, as its access does (D108).
			...(access.custom ? { custom: access.custom } : {})
		}), parseBaseHalfVideoCheckResult, false);
		throwIfCancelled(token);
		if (!checked.ok) {
			throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.checkFailed', "BaseHalf could not check the generation, and nothing was sent: {0}", errorDetail(checked.error, Object.values(access.credentials))));
		}
		const problem = checked.value.problems[0];
		if (problem) {
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText({ kind: 'check', message: problem }));
		}
		// What is sent and recorded is what was checked: a value beyond a range the inputs narrow is fitted to it (D70).
		const fitted = fitBaseHalfVideoParams(ref.model, sent, checked.value.limits);
		// The prompt as the module writes it, which the task record keeps (D74).
		const sentPrompt = checked.value.prompt;
		const record: IBaseHalfGenerationRequest = {
			provider: ref.provider.id,
			region: access.region,
			model: ref.model.id,
			// The id the module would send, where the mode and inputs choose among several.
			providerModel: checked.value.providerModel ?? providerModel,
			mode: mode.id,
			params: fitted,
			// The card's own prompt, with its mentions: the text of its notes stays on this computer.
			prompt: info.prompt,
			inputs: used
		};
		const request: IBaseHalfVideoSubmitRequest = {
			...access,
			model: ref.model.id,
			mode: mode.id,
			params: fitted,
			prompt: prompt.parts,
			inputs,
			targets: task.cards.map((_card, index) => this.service.taskStore.partFile(task, index).fsPath)
		};
		return { access, request, record, sentPrompt, lastUsed: { provider: ref.provider.id, model: ref.model.id, mode: mode.id, params } };
	}

	/** The catalog, waiting while it loads; refuses with the reason it is not there. */
	async catalog(): Promise<IBaseHalfVideoCatalog> {
		try {
			return await this.service.catalogService.whenReady(BASEHALF_VIDEO_CATALOG_WAIT);
		} catch (error) {
			const state = this.service.catalogService.state;
			const blocker: BaseHalfVideoGenerateBlocker = state.kind === 'failed'
				? { kind: 'catalogFailed', message: state.message }
				: state.kind === 'loading'
					? { kind: 'catalogLoading' }
					: { kind: 'catalogFailed', message: getErrorMessage(error) };
			throw new BaseHalfVideoGenerationError(baseHalfVideoGenerateBlockerText(blocker));
		}
	}

	/** A provider of the catalog as this window has it, without waiting for one that loads. */
	catalogProvider(providerId: string | undefined): IBaseHalfVideoCatalogProvider | undefined {
		const state = this.service.catalogService.state;
		return findBaseHalfVideoProvider(state.kind === 'ready' ? state.catalog : undefined, providerId);
	}

	private async readText(input: IBaseHalfVideoResolvedInput, item: IBaseHalfVideoInputPlanItem): Promise<string> {
		const file = input.file;
		if (!file) {
			throw new BaseHalfVideoGenerationError(missingInputMessage(item.path));
		}
		try {
			return await readBaseHalfVideoTextInput(this.service.fileService, file);
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
			const stat = await this.service.fileService.stat(file);
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
				const bytes = (await this.service.fileService.readFile(file)).value;
				const dataUrl = await this.service.rasterize(bytes, direct ?? RASTER_IMAGE_TYPES[extension] ?? 'image/*');
				this.drawnImages.set(key, dataUrl);
				if (this.drawnImages.size > DRAWN_IMAGES_KEPT) {
					this.drawnImages.delete(this.drawnImages.keys().next().value!);
				}
				return { dataUrl };
			} catch (error) {
				this.service.logService.warn(`[BaseHalf generation] Could not draw ${item.path} to PNG: ${getErrorMessage(error)}`);
				throw new BaseHalfVideoGenerationError(localize('basehalf.video.generation.imageUnreadable', "BaseHalf could not read the image {0}.", inputName(item.path)));
			}
		}
		const types = kind === 'video' ? VIDEO_TYPES : AUDIO_TYPES;
		return { fsPath: file.fsPath, mimeType: types[extension] ?? 'application/octet-stream' };
	}
}
