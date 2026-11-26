/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CUSTOM_IMAGE_MAX_BYTES, CUSTOM_IMAGE_SIZES, CUSTOM_PROVIDER_REGION, CUSTOM_VIDEO_FRAME_MAX_BYTES, customVideoSize, describeCustomProvider } from '../common/basehalfCustomProviders.js';
import { measureItems } from './check.js';
import { isRecord, readCommonError, rejected, unknownOutcome, unreadable, type ProviderErrorReading } from './failure.js';
import { DEFAULT_HTTP_OPTIONS, type FormPart, type ProviderHttp } from './http.js';
import { bufferSource, dataUrlOf, describeBytes, measure, plannedItems, readMedia, type MediaFormat, type MediaInspector } from './media.js';
import type { AnsweredAtOnce, ModuleCheckResult, ModulePollState, OutputLocation, ProviderModule } from './module.js';
import type { CatalogModel, CheckRequest, CustomProviderDefinition, OutputFormat, SubmitRequest, TaskRef } from '../common/basehalfProviderTypes.js';

/**
 * The module of a custom provider (D108; providers, "Custom providers"), made
 * for one call from what the user entered. Its models are called in the
 * format of their card type:
 *
 * - images in OpenAI's Image API: JSON at `/images/generations` without
 *   reference images, and a multipart form at `/images/edits` with them, each
 *   image an `image[]` file; the answer holds the images, `b64_json` or `url`;
 * - videos in the video API that relays share: JSON at `/video/generations`,
 *   which answers `task_id`, asked about at `/video/generations/{task_id}`
 *   until its `url`; there is no cancel;
 * - speech in OpenAI's speech API: JSON at `/audio/speech`, which answers the
 *   MP3.
 *
 * The key goes as `Authorization: Bearer`. The module keeps no state.
 */

const TEXT = Object.freeze({
	noModel: (provider: string, id: string) => `${provider} has no model "${id}".`,
	requestTooLarge: (size: string, limit: string) => `The reference images make a request of ${size}; BaseHalf sends at most ${limit}. Use fewer or smaller images.`,
	imagesOnly: (label: string) => `${label} cannot be sent: an image model of a custom provider takes reference images only.`,
	imageFormat: (label: string) => `${label} is not a PNG, JPEG, or WebP image.`,
	noSize: (model: string) => `${model} has no size for these settings.`,
	noImages: (provider: string) => `${provider} accepted the request but answered no images BaseHalf can read.`,
	unreadableImage: (provider: string) => `${provider} answered an image BaseHalf cannot read.`,
	noSound: (provider: string) => `${provider} accepted the request but answered no sound.`,
	noTask: (provider: string) => `${provider} accepted the request but gave no task id BaseHalf can read.`,
	noTaskToAsk: (model: string) => `${model} answers at once: there is no task to ask about.`,
	noVideo: (provider: string) => `${provider} says the video is done but gives no address BaseHalf can read.`,
	unknownStatus: (provider: string, status: string) => `${provider} answered a status BaseHalf does not know: ${status}.`,
	failed: (provider: string) => `${provider} reports that the video failed.`
});

const IMAGE_TYPES: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' });
const EXTENSIONS: Readonly<Partial<Record<MediaFormat, string>>> = Object.freeze({ png: 'png', jpeg: 'jpg', webp: 'webp' });
/** What BaseHalf sends in one request: the format documents no limit of its own for an edit. */
const REQUEST_MAX_BYTES = DEFAULT_HTTP_OPTIONS.maxRequestBytes;

/** The statuses of a video task, in the names of the format and of its earlier versions, and the words other relays use for them. */
const PENDING_STATUSES: ReadonlySet<string> = new Set(['queued', 'pending', 'submitted']);
const RUNNING_STATUSES: ReadonlySet<string> = new Set(['in_progress', 'processing', 'running']);
const SUCCEEDED_STATUSES: ReadonlySet<string> = new Set(['completed', 'succeeded', 'success']);
const FAILED_STATUSES: ReadonlySet<string> = new Set(['failed', 'failure', 'error']);
const CANCELLED_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'canceled']);

function textOf(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** The id that is sent for a model: the service's own, as the user entered it. */
function serviceIdOf(model: CatalogModel): string {
	return model.providerModels[CUSTOM_PROVIDER_REGION];
}

/** The bytes of a form besides its images: the text fields, the prompt, and the boundaries. */
function formOverhead(prompt: string): number {
	return Buffer.byteLength(prompt, 'utf8') + 4096;
}

/** The reference images as `image[]` file parts, in the order of the inputs. */
async function imageParts(request: SubmitRequest): Promise<FormPart[]> {
	const parts: FormPart[] = [];
	for (const item of plannedItems(request.inputs)) {
		if (item.slot !== 'image') {
			throw rejected(TEXT.imagesOnly(item.label));
		}
		const read = await readMedia(item.media, CUSTOM_IMAGE_MAX_BYTES, item.label);
		const { format } = await measure(bufferSource(read.bytes));
		const type = format ? IMAGE_TYPES[format] : undefined;
		if (!format || !type) {
			throw rejected(TEXT.imageFormat(item.label));
		}
		parts.push({ name: 'image[]', file: { bytes: read.bytes, fileName: `image-${item.index + 1}.${EXTENSIONS[format]}`, contentType: type } });
	}
	return parts;
}

/**
 * Reads `{error: {message, type, code}}`, the error of both formats, and the
 * shapes most APIs use. An empty balance refines a 4xx answer only, so that a
 * server error leaves the outcome of a create unknown.
 */
function readError(status: number, body: unknown): ProviderErrorReading | undefined {
	const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
	const message = textOf(error?.message) ?? readCommonError(body)?.message ?? textOf(error?.code);
	if (!message) {
		return undefined;
	}
	if (status >= 400 && status < 500 && status !== 408 && (textOf(error?.type) === 'insufficient_quota' || textOf(error?.code) === 'insufficient_quota')) {
		return { message, code: 'balance' };
	}
	return { message };
}

/** Makes the module of a custom provider from what the user entered, which `parseCustomProviderDefinition` has read. */
export function customProviderModule(definition: CustomProviderDefinition): ProviderModule {
	const entry = describeCustomProvider(definition);
	const models: ReadonlyMap<string, CatalogModel> = new Map(entry.models.map(model => [model.id, model]));
	const provider = definition.label;

	const modelOf = (id: string): CatalogModel => {
		const model = models.get(id);
		if (!model) {
			throw rejected(TEXT.noModel(provider, id));
		}
		return model;
	};

	async function check(request: CheckRequest, media: MediaInspector): Promise<ModuleCheckResult> {
		const model = modelOf(request.model);
		const problems: string[] = [];
		if (model.kind === 'image' && request.inputs.images.length) {
			let size = formOverhead(request.prompt);
			for (const item of await measureItems(request.inputs, media)) {
				size += item.facts.bytes + 256;
			}
			if (size > REQUEST_MAX_BYTES) {
				problems.push(TEXT.requestTooLarge(describeBytes(size), describeBytes(REQUEST_MAX_BYTES)));
			}
		}
		return { problems };
	}

	/** The images of an answer, in its order: base64 files, or addresses. */
	function imagesOf(object: Record<string, unknown>): OutputLocation[] {
		const data = object.data;
		if (!Array.isArray(data) || !data.length) {
			throw unknownOutcome(TEXT.noImages(provider));
		}
		const format: OutputFormat = 'png';
		return data.map((entry): OutputLocation => {
			if (isRecord(entry) && typeof entry.b64_json === 'string' && entry.b64_json) {
				return { bytes: Buffer.from(entry.b64_json, 'base64'), format };
			}
			if (isRecord(entry) && typeof entry.url === 'string' && entry.url) {
				return { url: entry.url };
			}
			return { refused: TEXT.unreadableImage(provider) };
		});
	}

	async function submitImage(model: CatalogModel, request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
		const params = request.params;
		const ratio = String(params.ratio ?? 'adaptive');
		const size = ratio === 'adaptive' ? undefined : CUSTOM_IMAGE_SIZES[ratio];
		if (ratio !== 'adaptive' && !size) {
			// The declarations' checks refuse a value the format does not offer.
			throw rejected(TEXT.noSize(model.label));
		}
		const quality = String(params.quality ?? 'auto');
		// Auto sends nothing, and lets the service choose.
		const fields: Record<string, string | number> = {
			model: serviceIdOf(model),
			prompt: request.prompt,
			n: Number(params.count ?? 1),
			...(size ? { size } : {}),
			...(quality !== 'auto' ? { quality } : {})
		};
		const images = await imageParts(request);
		const answer = images.length
			? await http.create({ method: 'POST', path: '/images/edits', body: { kind: 'form', parts: [...Object.entries(fields).map(([name, value]) => ({ name, value: String(value) })), ...images] } })
			: await http.create({ method: 'POST', path: '/images/generations', body: { kind: 'json', value: fields } });
		return { outputs: imagesOf(answer.object()) };
	}

	async function submitSpeech(model: CatalogModel, request: SubmitRequest, http: ProviderHttp): Promise<AnsweredAtOnce> {
		const answer = await http.create({
			method: 'POST',
			path: '/audio/speech',
			headers: { Accept: 'audio/mpeg' },
			body: {
				kind: 'json',
				value: {
					model: serviceIdOf(model),
					input: request.prompt,
					voice: String(request.params.voice),
					response_format: 'mp3',
					speed: Number(request.params.speed ?? 1)
				}
			}
		});
		if (!answer.body.byteLength) {
			throw unknownOutcome(TEXT.noSound(provider));
		}
		return { outputs: [{ bytes: answer.body, format: 'mp3' }] };
	}

	async function submitVideo(model: CatalogModel, request: SubmitRequest, http: ProviderHttp): Promise<string> {
		const params = request.params;
		const size = customVideoSize(String(params.resolution), String(params.ratio));
		if (!size) {
			throw rejected(TEXT.noSize(model.label));
		}
		let image: string | undefined;
		for (const item of plannedItems(request.inputs)) {
			const read = await readMedia(item.media, CUSTOM_VIDEO_FRAME_MAX_BYTES, item.label);
			const { format } = await measure(bufferSource(read.bytes));
			const type = format ? IMAGE_TYPES[format] : undefined;
			if (item.slot !== 'startFrame' || !type) {
				throw rejected(TEXT.imageFormat(item.label));
			}
			image = dataUrlOf(read, type);
		}
		const answer = await http.create({
			method: 'POST',
			path: '/video/generations',
			body: {
				kind: 'json',
				value: {
					model: serviceIdOf(model),
					prompt: request.prompt,
					duration: Number(params.duration),
					width: size.width,
					height: size.height,
					...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
					...(image ? { image } : {})
				}
			}
		});
		const object = answer.object();
		const data = isRecord(object.data) ? object.data : undefined;
		const id = textOf(object.task_id) ?? textOf(object.id) ?? textOf(data?.task_id) ?? textOf(data?.id);
		if (!id) {
			throw unknownOutcome(TEXT.noTask(provider));
		}
		return id;
	}

	async function submit(request: SubmitRequest, http: ProviderHttp): Promise<string | AnsweredAtOnce> {
		const model = modelOf(request.model);
		switch (model.kind) {
			case 'image': return submitImage(model, request, http);
			case 'audio': return submitSpeech(model, request, http);
			default: return submitVideo(model, request, http);
		}
	}

	async function poll(ref: TaskRef, http: ProviderHttp): Promise<ModulePollState> {
		const model = modelOf(ref.model);
		if (model.kind !== 'video') {
			throw rejected(TEXT.noTaskToAsk(model.label));
		}
		const answer = await http.request({ method: 'GET', path: `/video/generations/${encodeURIComponent(ref.remoteId)}` });
		const object = answer.object();
		// A relay may wrap the task in `data`.
		const task = isRecord(object.data) && object.status === undefined ? object.data : object;
		const status = textOf(task.status)?.toLowerCase() ?? '';
		if (PENDING_STATUSES.has(status)) {
			return { state: 'pending' };
		}
		if (RUNNING_STATUSES.has(status)) {
			return { state: 'running' };
		}
		if (SUCCEEDED_STATUSES.has(status)) {
			const url = textOf(task.url) ?? textOf(task.video_url);
			if (!url) {
				throw unreadable(TEXT.noVideo(provider));
			}
			return { state: 'succeeded', videoUrl: url };
		}
		if (FAILED_STATUSES.has(status) || CANCELLED_STATUSES.has(status)) {
			const error = isRecord(task.error) ? task.error : undefined;
			const message = textOf(error?.message) ?? textOf(task.error) ?? textOf(task.message) ?? textOf(task.fail_reason) ?? TEXT.failed(provider);
			return { state: CANCELLED_STATUSES.has(status) ? 'cancelled' : 'failed', message };
		}
		throw unreadable(TEXT.unknownStatus(provider, status || String(task.status)));
	}

	return Object.freeze({
		describe: () => entry,
		headers: (credentials: Readonly<Record<string, string>>) => ({ Authorization: `Bearer ${credentials.apiKey}` }),
		readError,
		check,
		submit,
		poll,
		// The format offers no cancel.
		cancel: async () => false
	});
}
