/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { cachingInspector, checkCounts, checkLimits, checkParams, checkPrompt, countsOf, isPlannedMedia, measureItems, resolveParams } from './check.ts';
import { downloadVideo, type DownloadOptions } from './download.ts';
import { isRecord, plainMessage, ProviderFailure, rejected, unknownOutcome, unreadable } from './failure.ts';
import { BoundHttp, parseEndpoint, resolveHttpOptions, type HttpOptions } from './http.ts';
import { createMediaInspector, type MediaInspector } from './media.ts';
import type { ProviderModule } from './module.ts';
import { buildCatalog, PROVIDER_MODULES } from './registry.ts';
import type {
	CancelResult,
	Catalog,
	CatalogModel,
	CatalogProvider,
	CatalogRegion,
	CheckRequest,
	CheckResult,
	DownloadRequest,
	DownloadResult,
	Media,
	ModeId,
	Params,
	ParamValue,
	PlannedCounts,
	PlannedMedia,
	PollState,
	ProviderAccess,
	ProviderResponse,
	SubmitRequest,
	SubmitResult,
	TaskRef
} from './types.ts';

/**
 * The six provider commands of AI Video (video providers, "Requests"). Each
 * answers `{ok: true, value}` or `{ok: false, error}` and never throws; keeps
 * nothing between calls; validates its payload strictly; and dispatches to the
 * provider module by its id (`unknownProvider` for an id no module has).
 * Messages never carry the credentials: every credential value and every
 * credential header value sent is removed from them.
 */
export interface VideoProviderCommandOptions {
	readonly http?: HttpOptions;
	readonly download?: DownloadOptions;
	/** How inputs are measured; the file system by default. */
	readonly inspector?: () => MediaInspector;
}

const MODE_IDS: ReadonlySet<string> = new Set<ModeId>(['frames', 'reference', 'extend', 'edit']);
const MAX_PROMPT_CHARACTERS = 1024 * 1024;

interface Resolved {
	readonly module: ProviderModule;
	readonly provider: CatalogProvider;
	readonly region: CatalogRegion;
	readonly model: CatalogModel;
}

export class VideoProviderCommands {
	private readonly catalogValue: Catalog;
	private readonly modules: ReadonlyMap<string, ProviderModule>;
	private readonly options: VideoProviderCommandOptions;

	constructor(modules: readonly ProviderModule[] = PROVIDER_MODULES, options: VideoProviderCommandOptions = {}) {
		this.catalogValue = buildCatalog(modules);
		this.modules = new Map(modules.map((module, index) => [this.catalogValue.providers[index].id, module]));
		this.options = options;
	}

	catalog(): ProviderResponse<Catalog> {
		return { ok: true, value: this.catalogValue };
	}

	check(argument: unknown): Promise<ProviderResponse<CheckResult>> {
		return answer([], async () => {
			const request = parseCheckRequest(argument);
			const resolved = this.resolve(request);
			return this.runCheck(resolved, request, cachingInspector((this.options.inspector ?? createMediaInspector)()));
		});
	}

	submit(argument: unknown): Promise<ProviderResponse<SubmitResult>> {
		const secrets = secretsOf(argument);
		let http: BoundHttp | undefined;
		return answer(secrets, async () => {
			const request = parseSubmitRequest(argument);
			const resolved = this.resolve(request);
			const checked = await this.runCheck(resolved, request, cachingInspector((this.options.inspector ?? createMediaInspector)()));
			if (checked.problems.length) {
				throw rejected(checked.problems[0]);
			}
			http = this.http(resolved.module, request);
			const params = resolveParams(resolved.model, request.mode, request.params, countsOf(request.inputs));
			const remoteId = await resolved.module.submit({ ...request, params }, http);
			return { remoteId: taskId(remoteId) };
		}, () => http?.createAnswered === true, () => http?.secretValues);
	}

	poll(argument: unknown): Promise<ProviderResponse<PollState>> {
		const secrets = secretsOf(argument);
		let http: BoundHttp | undefined;
		return answer(secrets, async () => {
			const ref = parseTaskRef(argument);
			const resolved = this.resolve(ref);
			http = this.http(resolved.module, ref);
			return pollState(await resolved.module.poll(ref, http), [...secrets, ...http.secretValues]);
		}, undefined, () => http?.secretValues);
	}

	download(argument: unknown): Promise<ProviderResponse<DownloadResult>> {
		const secrets = secretsOf(argument);
		let http: BoundHttp | undefined;
		return answer(secrets, async () => {
			const request = parseDownloadRequest(argument);
			const resolved = this.resolve(request);
			http = this.http(resolved.module, request);
			const location = request.videoUrl !== undefined ? { url: request.videoUrl } : await resolved.module.videoLocation(request, http);
			return { size: await downloadVideo(http, location, request.targetFsPath, this.options.download) };
		}, undefined, () => http?.secretValues);
	}

	cancel(argument: unknown): Promise<ProviderResponse<CancelResult>> {
		const secrets = secretsOf(argument);
		let http: BoundHttp | undefined;
		return answer(secrets, async () => {
			const ref = parseTaskRef(argument);
			const resolved = this.resolve(ref);
			http = this.http(resolved.module, ref);
			return { cancelled: (await resolved.module.cancel(ref, http)) === true };
		}, undefined, () => http?.secretValues);
	}

	/** The module, the provider's entry, the region, and the model of a request. */
	private resolve(request: { readonly provider: string; readonly region: string; readonly model: string; readonly credentials?: Readonly<Record<string, string>> }): Resolved {
		const module = this.modules.get(request.provider);
		const provider = this.catalogValue.providers.find(entry => entry.id === request.provider);
		if (!module || !provider) {
			throw new ProviderFailure('unknownProvider', `AI Video has no video provider "${request.provider}".`);
		}
		const region = provider.regions.find(entry => entry.id === request.region);
		if (!region) {
			throw rejected(`${provider.label} has no region "${request.region}". Choose its region again in Video Providers.`);
		}
		const model = provider.models.find(entry => entry.id === request.model);
		if (!model) {
			throw rejected(`${provider.label} has no model "${request.model}".`);
		}
		if (request.credentials) {
			for (const credential of provider.credentials) {
				const value = request.credentials[credential.id];
				if (typeof value !== 'string' || !value) {
					throw new ProviderFailure('auth', `${provider.label} needs its ${credential.label}. Set it in Video Providers.`);
				}
				if (!/^[\x21-\x7E]{1,16384}$/.test(value)) {
					throw new ProviderFailure('auth', `The ${credential.label} of ${provider.label} has characters that cannot be sent. Set it again in Video Providers.`);
				}
			}
		}
		return { module, provider, region, model };
	}

	private http(module: ProviderModule, access: ProviderAccess): BoundHttp {
		const credentials = access.credentials;
		return new BoundHttp(
			parseEndpoint(access.endpoint),
			() => module.headers(credentials),
			module.readError?.bind(module),
			resolveHttpOptions(this.options.http)
		);
	}

	/** The checks of the declarations, then the module's own, with the estimate when the parameters are valid. */
	private async runCheck(resolved: Resolved, request: CheckRequest, inspector: MediaInspector): Promise<CheckResult> {
		const { model, region, provider } = resolved;
		const mode = model.modes.find(entry => entry.id === request.mode);
		if (!mode) {
			return { problems: [`${model.label} has no ${request.mode} mode.`] };
		}
		if (model.providerModels[region.id] === undefined) {
			return { problems: [`${provider.label} does not offer ${model.label} in ${region.label}.`] };
		}
		if (mode.regions && !mode.regions.includes(region.id)) {
			const where = provider.regions.filter(candidate => mode.regions?.includes(candidate.id)).map(candidate => candidate.label).join(', ');
			return { problems: [`${model.label} offers ${mode.label} mode only in ${where}. Choose another mode, or another region in Video Providers.`] };
		}
		const counts = countsOf(request.inputs);
		const problems = [
			...checkCounts(model, mode, counts),
			...checkPrompt(model, mode, request.prompt, counts),
		];
		const parameterProblems = checkParams(model, mode, request.params, counts);
		if (parameterProblems.length) {
			return { problems: [...problems, ...parameterProblems] };
		}
		if (isPlannedMedia(request.inputs)) {
			problems.push(...checkLimits(mode, await measureItems(request.inputs, inspector)));
		}
		const own = await resolved.module.check({ ...request, params: resolveParams(model, mode.id, request.params, counts) }, inspector);
		const all = [...problems, ...own.problems];
		// Only a model declared with an estimate answers one, in its region's currency.
		const estimate = model.estimate && own.estimate && own.estimate.currency === region.currency ? { estimate: own.estimate } : {};
		const providerModel = typeof own.providerModel === 'string' && /^\S{1,256}$/.test(own.providerModel) ? { providerModel: own.providerModel } : {};
		return { problems: all, ...estimate, ...providerModel };
	}
}

/** Runs a command and answers its value, or its failure with a plain message. */
async function answer<T>(
	secrets: readonly string[],
	run: () => Promise<T>,
	createAnswered?: () => boolean,
	sentSecrets?: () => Iterable<string> | undefined
): Promise<ProviderResponse<T>> {
	try {
		return { ok: true, value: await run() };
	} catch (error) {
		const hidden = [...secrets, ...(sentSecrets?.() ?? [])];
		if (error instanceof ProviderFailure) {
			return {
				ok: false,
				error: {
					code: error.code,
					message: plainMessage(error.message, hidden) || 'The provider request failed.',
					...(error.status !== undefined ? { status: error.status } : {})
				}
			};
		}
		const detail = plainMessage(error instanceof Error ? error.message : String(error), hidden);
		if (createAnswered?.()) {
			// The provider accepted the request, so a task may exist.
			return { ok: false, error: { code: 'unknownOutcome', message: `The provider accepted the request, but AI Video could not read its answer: ${detail}` } };
		}
		return { ok: false, error: { code: 'rejected', message: `AI Video could not prepare the request: ${detail}` } };
	}
}

/** Every credential value in a payload, so no message can carry one. */
function secretsOf(argument: unknown): string[] {
	if (!isRecord(argument) || !isRecord(argument.credentials)) {
		return [];
	}
	return Object.values(argument.credentials).filter((value): value is string => typeof value === 'string');
}

/** A provider's task id, as a node's file can hold it. */
function taskId(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000- \u007F]/.test(value)) {
		throw unknownOutcome('The provider accepted the request but gave no task id AI Video can read.');
	}
	return value;
}

function pollState(state: PollState, secrets: readonly string[]): PollState {
	switch (state.state) {
		case 'pending':
		case 'running':
			return state.fraction !== undefined && Number.isFinite(state.fraction)
				? { state: state.state, fraction: Math.min(1, Math.max(0, state.fraction)) }
				: { state: state.state };
		case 'succeeded':
			return state.videoUrl ? { state: 'succeeded', videoUrl: state.videoUrl } : { state: 'succeeded' };
		case 'failed':
		case 'cancelled':
			return { state: state.state, message: plainMessage(state.message, secrets) || (state.state === 'failed' ? 'The provider reports that the task failed.' : 'The provider reports that the task was cancelled.') };
		default:
			throw unreadable('The provider module answered a state AI Video does not know.');
	}
}

// --- payloads -----------------------------------------------------------------------------------

function cannotRead(what: string): ProviderFailure {
	return rejected(`AI Video received ${what} it cannot read.`);
}

function field(record: Record<string, unknown>, name: string, what: string, maxLength = 256): string {
	const value = record[name];
	if (typeof value !== 'string' || !value || value.length > maxLength) {
		throw cannotRead(what);
	}
	return value;
}

function parseParams(value: unknown): Params {
	if (!isRecord(value)) {
		throw cannotRead('settings');
	}
	const params: Record<string, ParamValue> = {};
	for (const [name, entry] of Object.entries(value)) {
		if (name.length > 64 || !(typeof entry === 'string' ? entry.length <= 64 * 1024 : typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry)))) {
			throw cannotRead('settings');
		}
		params[name] = entry as ParamValue;
	}
	return params;
}

function parseMedia(value: unknown): Media {
	if (isRecord(value) && typeof value.dataUrl === 'string' && value.dataUrl.startsWith('data:') && value.fsPath === undefined) {
		return { dataUrl: value.dataUrl };
	}
	if (isRecord(value) && typeof value.fsPath === 'string' && value.fsPath.length <= 4096 && typeof value.mimeType === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(value.mimeType) && value.dataUrl === undefined) {
		return { fsPath: value.fsPath, mimeType: value.mimeType };
	}
	throw cannotRead('an input');
}

function parseMediaList(value: unknown): Media[] {
	if (!Array.isArray(value) || value.length > 100) {
		throw cannotRead('inputs');
	}
	return value.map(parseMedia);
}

function parsePlannedMedia(value: Record<string, unknown>): PlannedMedia {
	return {
		...(value.startFrame !== undefined ? { startFrame: parseMedia(value.startFrame) } : {}),
		...(value.endFrame !== undefined ? { endFrame: parseMedia(value.endFrame) } : {}),
		images: parseMediaList(value.images),
		videos: parseMediaList(value.videos),
		audios: parseMediaList(value.audios),
		...(value.source !== undefined ? { source: parseMedia(value.source) } : {})
	};
}

function parsePlannedCounts(value: Record<string, unknown>): PlannedCounts {
	const count = (entry: unknown) => {
		if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 100) {
			throw cannotRead('inputs');
		}
		return entry;
	};
	if (typeof value.startFrame !== 'boolean' || typeof value.endFrame !== 'boolean' || typeof value.source !== 'boolean') {
		throw cannotRead('inputs');
	}
	return { startFrame: value.startFrame, endFrame: value.endFrame, images: count(value.images), videos: count(value.videos), audios: count(value.audios), source: value.source };
}

function parseGeneration(value: unknown, what: string): Record<string, unknown> & { provider: string; region: string; model: string; mode: ModeId; params: Params; prompt: string } {
	if (!isRecord(value)) {
		throw cannotRead(what);
	}
	const mode = value.mode;
	if (typeof mode !== 'string' || !MODE_IDS.has(mode) || typeof value.prompt !== 'string' || value.prompt.length > MAX_PROMPT_CHARACTERS) {
		throw cannotRead(what);
	}
	return {
		...value,
		provider: field(value, 'provider', what, 64),
		region: field(value, 'region', what, 64),
		model: field(value, 'model', what, 64),
		mode: mode as ModeId,
		params: parseParams(value.params),
		prompt: value.prompt
	};
}

export function parseCheckRequest(value: unknown): CheckRequest {
	const generation = parseGeneration(value, 'a check');
	if (!isRecord(generation.inputs)) {
		throw cannotRead('inputs');
	}
	const inputs = Array.isArray(generation.inputs.images) ? parsePlannedMedia(generation.inputs) : parsePlannedCounts(generation.inputs);
	return { provider: generation.provider, region: generation.region, model: generation.model, mode: generation.mode, params: generation.params, prompt: generation.prompt, inputs };
}

function parseAccess(value: Record<string, unknown>, what: string): ProviderAccess {
	if (!isRecord(value.credentials) || Object.values(value.credentials).some(entry => typeof entry !== 'string')) {
		throw cannotRead(what);
	}
	return {
		provider: field(value, 'provider', what, 64),
		region: field(value, 'region', what, 64),
		endpoint: field(value, 'endpoint', what, 2048),
		credentials: { ...value.credentials as Record<string, string> }
	};
}

export function parseSubmitRequest(value: unknown): SubmitRequest {
	const generation = parseGeneration(value, 'a request');
	if (!isRecord(generation.inputs) || !Array.isArray(generation.inputs.images)) {
		throw cannotRead('inputs');
	}
	return {
		...parseAccess(generation, 'a request'),
		model: generation.model,
		mode: generation.mode,
		params: generation.params,
		prompt: generation.prompt,
		inputs: parsePlannedMedia(generation.inputs)
	};
}

export function parseTaskRef(value: unknown): TaskRef {
	if (!isRecord(value)) {
		throw cannotRead('a task');
	}
	const remoteId = value.remoteId;
	if (typeof remoteId !== 'string' || !remoteId.trim() || remoteId.length > 256 || /[\u0000- \u007F]/.test(remoteId)) {
		throw rejected('The task id is not one a provider gave.');
	}
	return { ...parseAccess(value, 'a task'), model: field(value, 'model', 'a task', 64), remoteId };
}

export function parseDownloadRequest(value: unknown): DownloadRequest {
	const ref = parseTaskRef(value);
	const record = value as Record<string, unknown>;
	if (typeof record.targetFsPath !== 'string' || (record.videoUrl !== undefined && (typeof record.videoUrl !== 'string' || record.videoUrl.length > 8192))) {
		throw cannotRead('a download');
	}
	return { ...ref, targetFsPath: record.targetFsPath, ...(typeof record.videoUrl === 'string' && record.videoUrl ? { videoUrl: record.videoUrl } : {}) };
}
