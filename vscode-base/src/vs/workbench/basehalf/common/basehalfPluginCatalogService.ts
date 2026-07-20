/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { disposableTimeout } from '../../../base/common/async.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { listenStream, ReadableStream } from '../../../base/common/stream.js';
import { IExtensionManagementService } from '../../../platform/extensionManagement/common/extensionManagement.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { IRequestService, isSuccess, readHeader } from '../../../platform/request/common/request.js';
import { IStorageService, StorageScope } from '../../../platform/storage/common/storage.js';
import { BASEHALF_CURATED_PLUGINS, IBaseHalfPluginCatalogSignature, IBaseHalfPluginCompatibility, IBaseHalfRemotePluginCatalog, IBaseHalfResolvedPlugin, isBaseHalfRemotePluginVersionCompatible, parseBaseHalfPluginCatalogIndex, parseBaseHalfPluginCatalogSignature, parseBaseHalfRemotePluginCatalog, resolveBaseHalfPluginCatalog, resolveBaseHalfPluginCatalogIndexResource } from './basehalfPluginCatalog.js';
import { IBaseHalfPluginAdmissionService, IBaseHalfVerifiedPluginAdmission } from './basehalfPluginAdmissionService.js';
import { verifyBaseHalfPluginCatalogSignature } from './basehalfPluginCatalogSecurity.js';
import { IBaseHalfPluginStateStore } from './basehalfPluginStateStore.js';

const CACHE_CATALOG_KEY = 'basehalf.plugins.catalog.raw';
const CACHE_SIGNATURE_KEY = 'basehalf.plugins.catalog.signature';
const HIGHEST_SEQUENCE_KEY = 'basehalf.plugins.catalog.highestSequence';
const HIGHEST_FINGERPRINT_KEY = 'basehalf.plugins.catalog.highestFingerprint';
const CATALOG_STATE_KEY = 'basehalf.plugins.catalog.state.v1';
const REQUEST_TIMEOUT_MS = 10_000;
const INDEX_MAX_BYTES = 64 * 1024;
const SIGNATURE_MAX_BYTES = 16 * 1024;
const CATALOG_MAX_BYTES = 5 * 1024 * 1024;

export type BaseHalfPluginCatalogSource = 'bundled' | 'cache' | 'remote';

export interface IBaseHalfPluginCatalogSnapshot {
	readonly plugins: readonly IBaseHalfResolvedPlugin[];
	readonly source: BaseHalfPluginCatalogSource;
	readonly sequence?: number;
	readonly generatedAt?: string;
	readonly error?: string;
}

export const IBaseHalfPluginCatalogService = createDecorator<IBaseHalfPluginCatalogService>('basehalfPluginCatalogService');

export interface IBaseHalfPluginCatalogService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<IBaseHalfPluginCatalogSnapshot>;
	getSnapshot(): Promise<IBaseHalfPluginCatalogSnapshot>;
	refresh(): Promise<IBaseHalfPluginCatalogSnapshot>;
}

interface IBaseHalfPersistedPluginCatalogState {
	readonly schemaVersion: 1;
	readonly sequence: number;
	readonly fingerprint?: string;
	readonly rawCatalog?: string;
	readonly rawSignature?: string;
}

export class BaseHalfPluginCatalogService extends Disposable implements IBaseHalfPluginCatalogService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<IBaseHalfPluginCatalogSnapshot>());
	readonly onDidChange = this._onDidChange.event;
	private remoteCatalog: IBaseHalfRemotePluginCatalog | undefined;
	private source: BaseHalfPluginCatalogSource = 'bundled';
	private lastError: string | undefined;
	private targetPlatform: string | undefined;
	private acceptedSequence = 0;
	private acceptedFingerprint: string | undefined;
	private readonly initializePromise: Promise<void>;
	private refreshTail: Promise<void> = Promise.resolve();

	constructor(
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@ILogService private readonly logService: ILogService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService,
		@IBaseHalfPluginStateStore private readonly pluginStateStore: IBaseHalfPluginStateStore
	) {
		super();
		this.initializePromise = this.initialize();
		this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, CATALOG_STATE_KEY, this._store)(() => {
			void this.initializePromise.then(() => this.synchronizePersistedState());
		}));
	}

	async getSnapshot(): Promise<IBaseHalfPluginCatalogSnapshot> {
		await this.initializePromise;
		return this.snapshot();
	}

	refresh(): Promise<IBaseHalfPluginCatalogSnapshot> {
		const result = this.refreshTail.then(() => this.refreshOnce());
		this.refreshTail = result.then(() => undefined, () => undefined);
		return result;
	}

	private async refreshOnce(): Promise<IBaseHalfPluginCatalogSnapshot> {
		await this.initializePromise;
		const config = this.productService.basehalfPlugins;
		if (!config?.catalogIndexUrl || !config.publicKeys.length) {
			return this.snapshot();
		}
		try {
			const indexBytes = await this.requestBytes(config.catalogIndexUrl, 'basehalfPluginCatalogService.index', INDEX_MAX_BYTES);
			const rawIndex = decodeUtf8(indexBytes, 'plugin catalog index');
			const index = parseBaseHalfPluginCatalogIndex(JSON.parse(rawIndex));
			const catalogUrl = resolveBaseHalfPluginCatalogIndexResource(config.catalogIndexUrl, index.catalogPath);
			const signatureUrl = resolveBaseHalfPluginCatalogIndexResource(config.catalogIndexUrl, index.signaturePath);
			const [catalogBytes, signatureBytes] = await Promise.all([
				this.requestBytes(catalogUrl.href, 'basehalfPluginCatalogService.catalog', CATALOG_MAX_BYTES),
				this.requestBytes(signatureUrl.href, 'basehalfPluginCatalogService.signature', SIGNATURE_MAX_BYTES)
			]);
			const rawCatalog = decodeUtf8(catalogBytes, 'plugin catalog');
			const rawSignature = decodeUtf8(signatureBytes, 'plugin catalog signature');
			const signature = parseBaseHalfPluginCatalogSignature(JSON.parse(rawSignature));
			if (!await verifyBaseHalfPluginCatalogSignature(catalogBytes, signature, config.publicKeys)) {
				throw new Error('Plugin catalog signature verification failed.');
			}
			const catalog = parseBaseHalfRemotePluginCatalog(JSON.parse(rawCatalog), BASEHALF_CURATED_PLUGINS.map(plugin => plugin.extensionId));
			if (catalog.sequence !== index.sequence) {
				throw new Error(`Plugin catalog sequence ${catalog.sequence} does not match index sequence ${index.sequence}.`);
			}
			const fingerprint = await catalogFingerprint(catalogBytes);
			const persisted = await this.commitCatalogState({
				schemaVersion: 1,
				sequence: catalog.sequence,
				fingerprint,
				rawCatalog,
				rawSignature
			});
			const accepted = await this.catalogFromPersistedState(persisted);
			if (!accepted) {
				throw new Error('The verified catalog state does not contain a usable catalog.');
			}
			this.acceptCatalogSequence(accepted.catalog.sequence, accepted.fingerprint);
			this.remoteCatalog = accepted.catalog;
			await this.updateRuntimeAdmission(accepted.catalog);
			this.source = accepted.catalog.sequence === catalog.sequence ? 'remote' : 'cache';
			this.lastError = undefined;
		} catch (error) {
			this.lastError = getErrorMessage(error);
			this.logService.warn(`BaseHalf plugin catalog refresh failed: ${this.lastError}`);
		}
		const snapshot = this.snapshot();
		this._onDidChange.fire(snapshot);
		return snapshot;
	}

	private async initialize(): Promise<void> {
		try {
			this.targetPlatform = String(await this.extensionManagementService.getTargetPlatform());
		} catch (error) {
			this.logService.warn(`BaseHalf plugin target platform detection failed: ${getErrorMessage(error)}`);
		}
		await this.restoreCache();
	}

	private async restoreCache(): Promise<void> {
		const config = this.productService.basehalfPlugins;
		if (!config?.publicKeys.length) {
			return;
		}
		try {
			let persisted = parsePersistedCatalogState(await this.pluginStateStore.read(CATALOG_STATE_KEY));
			if (!persisted) {
				persisted = await this.migrateLegacyCatalogState();
			}
			if (!persisted) {
				return;
			}
			this.acceptCatalogSequence(persisted.sequence, persisted.fingerprint);
			const accepted = await this.catalogFromPersistedState(persisted);
			if (accepted) {
				this.acceptCatalogSequence(accepted.catalog.sequence, accepted.fingerprint);
				this.remoteCatalog = accepted.catalog;
				await this.updateRuntimeAdmission(accepted.catalog);
				this.source = 'cache';
			}
		} catch (error) {
			this.logService.warn(`BaseHalf cached plugin catalog was ignored: ${getErrorMessage(error)}`);
		}
	}

	private async migrateLegacyCatalogState(): Promise<IBaseHalfPersistedPluginCatalogState | undefined> {
		const rawCatalog = this.storageService.get(CACHE_CATALOG_KEY, StorageScope.APPLICATION);
		const rawSignature = this.storageService.get(CACHE_SIGNATURE_KEY, StorageScope.APPLICATION);
		const highestSequence = this.storageService.getNumber(HIGHEST_SEQUENCE_KEY, StorageScope.APPLICATION, 0);
		const highestFingerprint = this.storageService.get(HIGHEST_FINGERPRINT_KEY, StorageScope.APPLICATION);
		let floorState: IBaseHalfPersistedPluginCatalogState | undefined;
		if (highestSequence > 0) {
			const validHighestFingerprint = highestFingerprint !== undefined && /^[a-f0-9]{64}$/.test(highestFingerprint)
				? highestFingerprint
				: undefined;
			if (highestFingerprint !== undefined && !validHighestFingerprint) {
				this.logService.warn('BaseHalf ignored an invalid legacy plugin catalog fingerprint while preserving its sequence floor.');
			}
			floorState = {
				schemaVersion: 1,
				sequence: highestSequence,
				fingerprint: validHighestFingerprint
			};
		}
		let cacheState: IBaseHalfPersistedPluginCatalogState | undefined;
		if (rawCatalog && rawSignature) {
			try {
				const bytes = new TextEncoder().encode(rawCatalog);
				const catalog = parseBaseHalfRemotePluginCatalog(JSON.parse(rawCatalog), BASEHALF_CURATED_PLUGINS.map(plugin => plugin.extensionId));
				cacheState = {
					schemaVersion: 1,
					sequence: catalog.sequence,
					fingerprint: await catalogFingerprint(bytes),
					rawCatalog,
					rawSignature
				};
				await this.catalogFromPersistedState(cacheState);
			} catch (error) {
				if (!floorState) {
					throw error;
				}
				cacheState = undefined;
				this.logService.warn(`BaseHalf legacy plugin catalog cache was ignored while preserving its sequence floor: ${getErrorMessage(error)}`);
			}
		}
		let legacyState = cacheState ?? floorState;
		if (floorState && cacheState) {
			if (cacheState.sequence < floorState.sequence) {
				legacyState = floorState;
			} else if (cacheState.sequence === floorState.sequence) {
				try {
					validateBaseHalfCatalogSequence(cacheState.sequence, cacheState.fingerprint ?? '', floorState.sequence, floorState.fingerprint);
					legacyState = mergePersistedCatalogState(floorState, cacheState);
				} catch (error) {
					legacyState = floorState;
					this.logService.warn(`BaseHalf legacy plugin catalog cache conflicted with its sequence floor and was ignored: ${getErrorMessage(error)}`);
				}
			}
		}
		if (!legacyState) {
			return undefined;
		}
		return this.commitCatalogState(legacyState);
	}

	private async synchronizePersistedState(): Promise<void> {
		try {
			const persisted = parsePersistedCatalogState(await this.pluginStateStore.read(CATALOG_STATE_KEY));
			if (!persisted) {
				return;
			}
			validateBaseHalfCatalogSequence(persisted.sequence, persisted.fingerprint ?? '', this.acceptedSequence, this.acceptedFingerprint);
			if (persisted.sequence === this.acceptedSequence
				&& persisted.fingerprint === this.acceptedFingerprint
				&& this.remoteCatalog?.sequence === persisted.sequence) {
				return;
			}
			const accepted = await this.catalogFromPersistedState(persisted);
			if (!accepted) {
				return;
			}
			this.acceptCatalogSequence(accepted.catalog.sequence, accepted.fingerprint);
			this.remoteCatalog = accepted.catalog;
			await this.updateRuntimeAdmission(accepted.catalog);
			this.source = 'cache';
			this.lastError = undefined;
			this._onDidChange.fire(this.snapshot());
		} catch (error) {
			this.logService.warn(`BaseHalf plugin catalog state synchronization failed: ${getErrorMessage(error)}`);
		}
	}

	private async commitCatalogState(candidate: IBaseHalfPersistedPluginCatalogState): Promise<IBaseHalfPersistedPluginCatalogState> {
		validateBaseHalfCatalogSequence(candidate.sequence, candidate.fingerprint ?? '', this.acceptedSequence, this.acceptedFingerprint);
		let expected = await this.pluginStateStore.read(CATALOG_STATE_KEY);
		for (let attempt = 0; attempt < 20; attempt++) {
			validateBaseHalfCatalogSequence(candidate.sequence, candidate.fingerprint ?? '', this.acceptedSequence, this.acceptedFingerprint);
			const current = parsePersistedCatalogState(expected);
			if (current) {
				validateBaseHalfCatalogSequence(candidate.sequence, candidate.fingerprint ?? '', current.sequence, current.fingerprint);
				if (current.sequence === candidate.sequence && current.fingerprint === candidate.fingerprint && current.rawCatalog && current.rawSignature) {
					return current;
				}
			}
			const next = mergePersistedCatalogState(current, candidate);
			validateBaseHalfCatalogSequence(next.sequence, next.fingerprint ?? '', this.acceptedSequence, this.acceptedFingerprint);
			const serialized = JSON.stringify(next);
			const result = await this.pluginStateStore.compareAndSwap(CATALOG_STATE_KEY, expected, serialized);
			if (result.swapped) {
				return next;
			}
			expected = result.current;
		}
		throw new Error('Plugin catalog state changed repeatedly. Try again.');
	}

	private async catalogFromPersistedState(state: IBaseHalfPersistedPluginCatalogState): Promise<{ readonly catalog: IBaseHalfRemotePluginCatalog; readonly fingerprint: string } | undefined> {
		if (!state.rawCatalog || !state.rawSignature) {
			return undefined;
		}
		const config = this.productService.basehalfPlugins;
		if (!config?.publicKeys.length) {
			return undefined;
		}
		const bytes = new TextEncoder().encode(state.rawCatalog);
		const signature: IBaseHalfPluginCatalogSignature = parseBaseHalfPluginCatalogSignature(JSON.parse(state.rawSignature));
		if (!await verifyBaseHalfPluginCatalogSignature(bytes, signature, config.publicKeys)) {
			throw new Error('Cached plugin catalog signature verification failed.');
		}
		const catalog = parseBaseHalfRemotePluginCatalog(JSON.parse(state.rawCatalog), BASEHALF_CURATED_PLUGINS.map(plugin => plugin.extensionId));
		const fingerprint = await catalogFingerprint(bytes);
		if (catalog.sequence !== state.sequence || (state.fingerprint && fingerprint !== state.fingerprint)) {
			throw new Error('Cached plugin catalog state does not match its verified payload.');
		}
		return { catalog, fingerprint };
	}

	private async updateRuntimeAdmission(catalog: IBaseHalfRemotePluginCatalog): Promise<void> {
		this.pluginAdmissionService.replaceVerifiedPlugins(baseHalfVerifiedPluginAdmissions(catalog, this.compatibility()));
		await this.pluginAdmissionService.reverifyVerifiedInstalls();
	}

	private acceptCatalogSequence(sequence: number, fingerprint: string | undefined): void {
		validateBaseHalfCatalogSequence(sequence, fingerprint ?? '', this.acceptedSequence, this.acceptedFingerprint);
		this.acceptedSequence = sequence;
		this.acceptedFingerprint = fingerprint;
	}

	private snapshot(): IBaseHalfPluginCatalogSnapshot {
		const plugins = resolveBaseHalfPluginCatalog(BASEHALF_CURATED_PLUGINS, this.remoteCatalog, this.compatibility());
		return {
			plugins,
			source: this.source,
			sequence: this.remoteCatalog?.sequence,
			generatedAt: this.remoteCatalog?.generatedAt,
			error: this.lastError
		};
	}

	private compatibility(): IBaseHalfPluginCompatibility {
		return {
			basehalf: this.productService.basehalfVersion ?? '0.0.0',
			vscode: this.productService.version,
			targetPlatform: this.targetPlatform ?? 'undefined'
		};
	}

	private async requestBytes(url: string, callSite: string, maximumBytes: number): Promise<Uint8Array> {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
			throw new Error('Plugin catalog endpoints must use HTTPS. HTTP is allowed only for loopback tests.');
		}
		const cancellation = new CancellationTokenSource();
		const timeout = disposableTimeout(() => cancellation.cancel(), REQUEST_TIMEOUT_MS);
		try {
			const context = await this.requestService.request({ type: 'GET', url, callSite }, cancellation.token);
			if (!isSuccess(context)) {
				throw new Error(`Plugin catalog server returned ${context.res.statusCode}.`);
			}
			const contentLength = readHeader(context.res.headers, 'content-length');
			if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
				throw new Error(`Plugin catalog response exceeds ${maximumBytes} bytes.`);
			}
			return (await readLimitedBuffer(context.stream, maximumBytes, cancellation)).buffer;
		} finally {
			timeout.dispose();
			cancellation.dispose();
		}
	}
}

export function baseHalfVerifiedPluginAdmissions(
	catalog: IBaseHalfRemotePluginCatalog,
	compatibility: IBaseHalfPluginCompatibility
): readonly IBaseHalfVerifiedPluginAdmission[] {
	return catalog.plugins.map(plugin => ({
		extensionId: plugin.extensionId,
		// Withdrawal stops new installs in the management service, but an
		// already-installed signed build remains trusted. Security removals
		// use VS Code's extension-control manifest instead.
		versions: plugin.versions
			.filter(version => isBaseHalfRemotePluginVersionCompatible(version, compatibility))
			.map(version => ({
				version: version.version,
				sha256: version.sha256,
				installedContentSha256: version.installedContentSha256
			}))
	})).filter(plugin => plugin.versions.length > 0);
}

function readLimitedBuffer(stream: ReadableStream<VSBuffer>, maximumBytes: number, cancellation: CancellationTokenSource): Promise<VSBuffer> {
	return new Promise((resolve, reject) => {
		const chunks: VSBuffer[] = [];
		let size = 0;
		let settled = false;
		listenStream(stream, {
			onData: chunk => {
				if (settled) {
					return;
				}
				size += chunk.byteLength;
				if (size > maximumBytes) {
					settled = true;
					cancellation.cancel();
					reject(new Error(`Plugin catalog response exceeds ${maximumBytes} bytes.`));
					return;
				}
				chunks.push(chunk);
			},
			onError: error => {
				if (!settled) {
					settled = true;
					reject(error);
				}
			},
			onEnd: () => {
				if (!settled) {
					settled = true;
					resolve(VSBuffer.concat(chunks, size));
				}
			}
		});
	});
}

export function validateBaseHalfCatalogSequence(sequence: number, fingerprint: string, highestSequence: number, highestFingerprint: string | undefined): void {
	if (sequence < highestSequence) {
		throw new Error(`Plugin catalog sequence ${sequence} is older than the verified sequence ${highestSequence}.`);
	}
	if (sequence === highestSequence && highestFingerprint && fingerprint !== highestFingerprint) {
		throw new Error(`Plugin catalog sequence ${sequence} was already verified with different content.`);
	}
}

function parsePersistedCatalogState(raw: string | undefined): IBaseHalfPersistedPluginCatalogState | undefined {
	if (raw === undefined) {
		return undefined;
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error('The persisted plugin catalog state is not valid JSON.');
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('The persisted plugin catalog state is invalid.');
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.schemaVersion !== 1
		|| !Number.isSafeInteger(candidate.sequence)
		|| (candidate.sequence as number) <= 0
		|| (candidate.fingerprint !== undefined && (typeof candidate.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.fingerprint)))
		|| (candidate.rawCatalog !== undefined && typeof candidate.rawCatalog !== 'string')
		|| (candidate.rawSignature !== undefined && typeof candidate.rawSignature !== 'string')
		|| (candidate.rawCatalog === undefined) !== (candidate.rawSignature === undefined)) {
		throw new Error('The persisted plugin catalog state is invalid.');
	}
	return {
		schemaVersion: 1,
		sequence: candidate.sequence as number,
		fingerprint: candidate.fingerprint as string | undefined,
		rawCatalog: candidate.rawCatalog as string | undefined,
		rawSignature: candidate.rawSignature as string | undefined
	};
}

function mergePersistedCatalogState(
	current: IBaseHalfPersistedPluginCatalogState | undefined,
	candidate: IBaseHalfPersistedPluginCatalogState
): IBaseHalfPersistedPluginCatalogState {
	if (!current || candidate.sequence > current.sequence) {
		return candidate;
	}
	const fingerprint = current.fingerprint ?? candidate.fingerprint;
	const candidatePayloadMatches = !!candidate.rawCatalog
		&& !!candidate.rawSignature
		&& (!fingerprint || candidate.fingerprint === fingerprint);
	return {
		schemaVersion: 1,
		sequence: current.sequence,
		fingerprint,
		rawCatalog: current.rawCatalog ?? (candidatePayloadMatches ? candidate.rawCatalog : undefined),
		rawSignature: current.rawSignature ?? (candidatePayloadMatches ? candidate.rawSignature : undefined)
	};
}

async function catalogFingerprint(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}

function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new Error(`The ${label} is not valid UTF-8.`);
	}
}

registerSingleton(IBaseHalfPluginCatalogService, BaseHalfPluginCatalogService, InstantiationType.Delayed);
