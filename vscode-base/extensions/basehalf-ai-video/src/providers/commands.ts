/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isAbsolute } from 'node:path';
import { cachingInspector, checkCounts, checkLimits, checkParams, checkPrompt, countsOf, measureItems, outputCount, resolveParams } from './check.ts';
import { downloadAddress, downloadFile, MAX_ADDRESS_LENGTH, type DownloadOptions } from './download.ts';
import { isRecord, plainMessage, ProviderFailure, rejected, unknownOutcome, unreadable } from './failure.ts';
import { BoundHttp, parseEndpoint, resolveHttpOptions, type HttpOptions } from './http.ts';
import { createMediaInspector, type MediaInspector } from './media.ts';
import type { ModulePollState, OutputAddress, OutputLocation, ProviderModule, RefusedOutput } from './module.ts';
import { buildCatalog, MAX_OUTPUTS, PROVIDER_MODULES } from './registry.ts';
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
	ModelKind,
	Output,
	OutputFormat,
	Params,
	ParamValue,
	PlannedMedia,
	PollState,
	ProviderAccess,
	ProviderResponse,
	SubmitRequest,
	SubmitResult,
	TaskRef
} from './types.ts';

/**
 * The six provider commands of AI Video (providers, "Requests"). Each
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
const OUTPUT_FORMATS: ReadonlySet<string> = new Set<OutputFormat>(['png', 'jpeg', 'webp', 'mp4']);
const MAX_PROMPT_CHARACTERS = 1024 * 1024;
const MAX_PATH_LENGTH = 4096;

/** What an output the provider refused without a word says, by the kind of the model. */
const REFUSED_WITHOUT_REASON: Readonly<Record<ModelKind, string>> = Object.freeze({
	image: 'The provider refused this image.',
	video: 'The provider refused this video.'
});

interface Resolved {
	readonly module: ProviderModule;
	readonly provider: CatalogProvider;
	readonly region: CatalogRegion;
	readonly model: CatalogModel;
}

/** Where the outputs of a module come from: the answer of a create, or of a poll. */
type OutputSource = 'submit' | 'poll';

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

	/**
	 * Checks the request, sends it once, and answers the provider's task id or,
	 * for a provider that answers with the files, the outputs, each written to
	 * its target where the provider gave the file itself. A model that answers
	 * at once is sent nothing unless the request names a target for every
	 * output it may make.
	 */
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
			const params = resolveParams(resolved.model, request.mode, request.params, countsOf(request.inputs));
			const answersAtOnce = resolved.model.answersAtOnce === true;
			if (answersAtOnce) {
				const named = request.targets?.length ?? 0;
				const needed = outputCount(params);
				if (named < needed) {
					throw rejected(needed === 1
						? `${resolved.model.label} may make 1 file, but the request names none to write it to. AI Video sent nothing.`
						: `${resolved.model.label} may make ${needed} files, but the request names ${named} to write them to. AI Video sent nothing.`);
				}
			}
			http = this.http(resolved.module, request, answersAtOnce);
			const answered = await resolved.module.submit({ ...request, params }, http);
			if (typeof answered === 'string') {
				return { remoteId: taskId(answered) };
			}
			if (!isRecord(answered) || !Array.isArray(answered.outputs)) {
				throw unknownOutcome('The provider accepted the request but gave no task id AI Video can read.');
			}
			return { outputs: await this.keepOutputs(answered.outputs, request.targets, resolved.model, http, secrets, 'submit') };
		}, () => http?.createAnswered === true, () => http?.secretValues);
	}

	/** Asks the provider about a task once; a success with files answered inline writes them to the task's targets. */
	poll(argument: unknown): Promise<ProviderResponse<PollState>> {
		const secrets = secretsOf(argument);
		let http: BoundHttp | undefined;
		return answer(secrets, async () => {
			const ref = parseTaskRef(argument);
			const resolved = this.resolve(ref);
			http = this.http(resolved.module, ref);
			return this.pollState(await resolved.module.poll(ref, http), ref, resolved.model, http, secrets);
		}, undefined, () => http?.secretValues);
	}

	/**
	 * Downloads one output to its target: an image from its address, a video
	 * from its address or, without one, from where the provider module finds
	 * it. Only a file of the model's kind is kept; the answer gives its size and
	 * the format its bytes start like.
	 */
	download(argument: unknown): Promise<ProviderResponse<DownloadResult>> {
		const secrets = secretsOf(argument);
		let http: BoundHttp | undefined;
		return answer(secrets, async () => {
			const request = parseDownloadRequest(argument);
			const resolved = this.resolve(request);
			const kind = request.kind ?? 'video';
			const modelKind = resolved.model.kind ?? 'video';
			if (kind !== modelKind) {
				throw rejected(`${resolved.model.label} makes ${modelKind === 'image' ? 'images' : 'videos'}; AI Video downloads only a file of that kind for it.`);
			}
			const address = kind === 'image' ? request.url : request.url ?? request.videoUrl;
			if (kind === 'image' && address === undefined) {
				throw rejected('AI Video downloads an image only from the address the provider gave.');
			}
			http = this.http(resolved.module, request);
			const location = address !== undefined ? { url: address } : await resolved.module.videoLocation(request, http);
			const file = await downloadFile(http, location, request.targetFsPath, kind, this.options.download);
			return { size: file.size, format: file.format };
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

	/** The HTTP of one command; `answersAtOnce`: its create waits for the files (providers, "Requests"). */
	private http(module: ProviderModule, access: ProviderAccess, answersAtOnce = false): BoundHttp {
		const credentials = access.credentials;
		return new BoundHttp(
			parseEndpoint(access.endpoint),
			() => module.headers(credentials),
			module.readError?.bind(module),
			resolveHttpOptions(this.options.http),
			answersAtOnce
		);
	}

	/** The checks of the declarations, then the module's own, with the id the request would be sent with. */
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
		problems.push(...checkLimits(mode, await measureItems(request.inputs, inspector)));
		const own = await resolved.module.check({ ...request, params: resolveParams(model, mode.id, request.params, counts) }, inspector);
		const all = [...problems, ...own.problems];
		const providerModel = typeof own.providerModel === 'string' && /^\S{1,256}$/.test(own.providerModel) ? { providerModel: own.providerModel } : {};
		return { problems: all, ...providerModel };
	}

	/** A module's state as the contract answers it: progress kept between 0 and 1, messages made plain, and outputs kept. */
	private async pollState(state: ModulePollState, ref: TaskRef, model: CatalogModel, http: BoundHttp, secrets: readonly string[]): Promise<PollState> {
		switch (state.state) {
			case 'pending':
			case 'running':
				return state.fraction !== undefined && Number.isFinite(state.fraction)
					? { state: state.state, fraction: Math.min(1, Math.max(0, state.fraction)) }
					: { state: state.state };
			case 'succeeded': {
				if (state.outputs !== undefined && !Array.isArray(state.outputs)) {
					throw unreadable('The provider answered files AI Video cannot read.');
				}
				const outputs = state.outputs !== undefined ? await this.keepOutputs(state.outputs, ref.targets, model, http, secrets, 'poll') : undefined;
				return { state: 'succeeded', ...(state.videoUrl ? { videoUrl: state.videoUrl } : {}), ...(outputs ? { outputs } : {}) };
			}
			case 'failed':
			case 'cancelled':
				return { state: state.state, message: plainMessage(state.message, [...secrets, ...http.secretValues]) || (state.state === 'failed' ? 'The provider reports that the task failed.' : 'The provider reports that the task was cancelled.') };
			default:
				throw unreadable('The provider module answered a state AI Video does not know.');
		}
	}

	/**
	 * The outputs of a module as the contract answers them (providers,
	 * "Requests"), in the provider's order. Outputs beyond the targets are
	 * dropped, and the log says how many; a file that needs a target when the
	 * request names none fails the command. Each other output is kept on its own
	 * ({@link keepOutput}).
	 */
	private async keepOutputs(answered: readonly unknown[], targets: readonly string[] | undefined, model: CatalogModel, http: BoundHttp, secrets: readonly string[], source: OutputSource): Promise<Output[]> {
		const read = answered.map(readOutputLocation);
		if (read.some(location => location === undefined)) {
			throw source === 'submit'
				? unknownOutcome('The provider accepted the request but answered files AI Video cannot read.')
				: unreadable('The provider answered files AI Video cannot read.');
		}
		let locations = read as OutputLocation[];
		if (targets && locations.length > targets.length) {
			http.options.log.info(`Dropped ${locations.length - targets.length} of ${locations.length} outputs: the request names ${targets.length} ${targets.length === 1 ? 'file' : 'files'} to write them to.`);
			locations = locations.slice(0, targets.length);
		}
		if (!targets && locations.some(needsTarget)) {
			throw source === 'submit'
				? unknownOutcome('The provider answered with the files themselves, but the request names no file to write them to. They may have been made and charged; check the provider\'s console.')
				: rejected('The provider answered with the files themselves, but the request names no file to write them to.');
		}
		const kind = model.kind ?? 'video';
		const outputs: Output[] = [];
		for (const [index, location] of locations.entries()) {
			outputs.push(await this.keepOutput(location, targets?.[index], kind, http, secrets));
		}
		return outputs;
	}

	/**
	 * One output: a refusal stays a refusal with the provider's reason made
	 * plain; an address without headers stays an address; inline bytes, and an
	 * address with headers of its own, which never leave the extension, are
	 * written to the target under the checks of a download. An output that
	 * cannot be kept is answered as refused, with the reason.
	 */
	private async keepOutput(location: OutputLocation, target: string | undefined, kind: ModelKind, http: BoundHttp, secrets: readonly string[]): Promise<Output> {
		const plain = (message: string) => plainMessage(message, [...secrets, ...http.secretValues]) || REFUSED_WITHOUT_REASON[kind];
		if (isRefusal(location)) {
			return { refused: plain(location.refused) };
		}
		if (isAddress(location) && !location.headers) {
			if (location.url.length > MAX_ADDRESS_LENGTH) {
				return { refused: plain(`The provider gave ${kind === 'image' ? 'an image' : 'a video'} address longer than AI Video takes.`) };
			}
			try {
				downloadAddress(location.url, kind);
			} catch (error) {
				return { refused: plain(error instanceof Error ? error.message : String(error)) };
			}
			return { url: location.url };
		}
		try {
			const file = await downloadFile(http, location, target!, kind, this.options.download);
			return { written: target!, size: file.size, format: file.format };
		} catch (error) {
			if (error instanceof ProviderFailure) {
				return { refused: plain(error.message) };
			}
			throw error;
		}
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

/** An output a module answered, when it has one of the shapes of {@link OutputLocation}; a file already written is not one. */
function readOutputLocation(value: unknown): OutputLocation | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const shapes = ['url', 'bytes', 'refused'].filter(key => value[key] !== undefined);
	if (shapes.length !== 1 || value.written !== undefined) {
		return undefined;
	}
	if (typeof value.refused === 'string') {
		return { refused: value.refused };
	}
	if (value.bytes instanceof Uint8Array) {
		if (value.format !== undefined && (typeof value.format !== 'string' || !OUTPUT_FORMATS.has(value.format))) {
			return undefined;
		}
		return { bytes: value.bytes, ...(value.format !== undefined ? { format: value.format as OutputFormat } : {}) };
	}
	if (typeof value.url === 'string') {
		const headers = value.headers;
		if (headers !== undefined && !(isRecord(headers) && Object.values(headers).every(entry => typeof entry === 'string'))) {
			return undefined;
		}
		return { url: value.url, ...(headers !== undefined ? { headers: headers as Record<string, string> } : {}) };
	}
	return undefined;
}

function isRefusal(location: OutputLocation): location is RefusedOutput {
	return typeof (location as Partial<RefusedOutput>).refused === 'string';
}

function isAddress(location: OutputLocation): location is OutputAddress {
	return typeof (location as Partial<OutputAddress>).url === 'string';
}

/** Whether an output is written by the command: bytes, or an address with headers of its own. */
function needsTarget(location: OutputLocation): boolean {
	return isAddress(location) ? location.headers !== undefined : !isRefusal(location);
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
	if (isRecord(value) && typeof value.fsPath === 'string' && value.fsPath.length <= MAX_PATH_LENGTH && typeof value.mimeType === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(value.mimeType) && value.dataUrl === undefined) {
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

/** The new files the outputs of a request are written to: absolute paths ending in `.part`, each named once. */
function parseTargets(value: unknown): readonly string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value) || !value.length || value.length > MAX_OUTPUTS || new Set(value).size !== value.length
		|| !value.every(target => typeof target === 'string' && target.length <= MAX_PATH_LENGTH && isAbsolute(target) && target.endsWith('.part'))) {
		throw rejected(`AI Video writes the outputs of a request only to new .part files, 1 to ${MAX_OUTPUTS} of them, each named once.`);
	}
	return [...value];
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
	return { provider: generation.provider, region: generation.region, model: generation.model, mode: generation.mode, params: generation.params, prompt: generation.prompt, inputs: parsePlannedMedia(generation.inputs) };
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
	const targets = parseTargets(generation.targets);
	return {
		...parseAccess(generation, 'a request'),
		model: generation.model,
		mode: generation.mode,
		params: generation.params,
		prompt: generation.prompt,
		inputs: parsePlannedMedia(generation.inputs),
		...(targets ? { targets } : {})
	};
}

/**
 * A task of a provider. `withoutTask`: the request names an output by its
 * address, so it needs no task id; a provider that answered at once gave none.
 */
export function parseTaskRef(value: unknown, withoutTask = false): TaskRef {
	if (!isRecord(value)) {
		throw cannotRead('a task');
	}
	const remoteId = value.remoteId;
	const noTask = withoutTask && (remoteId === undefined || remoteId === '');
	if (!noTask && (typeof remoteId !== 'string' || !remoteId.trim() || remoteId.length > 256 || /[\u0000- \u007F]/.test(remoteId))) {
		throw rejected('The task id is not one a provider gave.');
	}
	const targets = parseTargets(value.targets);
	return { ...parseAccess(value, 'a task'), model: field(value, 'model', 'a task', 64), remoteId: noTask ? '' : remoteId as string, ...(targets ? { targets } : {}) };
}

/** An address of a download, or undefined when there is none. */
function parseAddress(value: unknown): string | undefined {
	if (value === undefined || value === '') {
		return undefined;
	}
	if (typeof value !== 'string' || value.length > MAX_ADDRESS_LENGTH) {
		throw cannotRead('a download');
	}
	return value;
}

export function parseDownloadRequest(value: unknown): DownloadRequest {
	if (!isRecord(value)) {
		throw cannotRead('a download');
	}
	const url = parseAddress(value.url);
	const videoUrl = parseAddress(value.videoUrl);
	const kind = value.kind;
	if ((kind !== undefined && kind !== 'image' && kind !== 'video') || typeof value.targetFsPath !== 'string' || value.targetFsPath.length > MAX_PATH_LENGTH) {
		throw cannotRead('a download');
	}
	const ref = parseTaskRef(value, url !== undefined || videoUrl !== undefined);
	return {
		...ref,
		targetFsPath: value.targetFsPath,
		...(videoUrl !== undefined ? { videoUrl } : {}),
		...(url !== undefined ? { url } : {}),
		...(kind !== undefined ? { kind: kind as ModelKind } : {})
	};
}
