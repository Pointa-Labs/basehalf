/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { streamToBuffer } from '../../../base/common/buffer.js';
import { disposableTimeout } from '../../../base/common/async.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IExtensionManagementService } from '../../../platform/extensionManagement/common/extensionManagement.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { IRequestService, isSuccess } from '../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { BASEHALF_CURATED_PLUGINS, IBaseHalfPluginCatalogSignature, IBaseHalfRemotePluginCatalog, IBaseHalfResolvedPlugin, parseBaseHalfPluginCatalogIndex, parseBaseHalfPluginCatalogSignature, parseBaseHalfRemotePluginCatalog, resolveBaseHalfPluginCatalog, resolveBaseHalfPluginCatalogIndexResource } from './basehalfPluginCatalog.js';
import { verifyBaseHalfPluginCatalogSignature } from './basehalfPluginCatalogSecurity.js';

const CACHE_CATALOG_KEY = 'basehalf.plugins.catalog.raw';
const CACHE_SIGNATURE_KEY = 'basehalf.plugins.catalog.signature';
const HIGHEST_SEQUENCE_KEY = 'basehalf.plugins.catalog.highestSequence';
const HIGHEST_FINGERPRINT_KEY = 'basehalf.plugins.catalog.highestFingerprint';
const REQUEST_TIMEOUT_MS = 10_000;

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

export class BaseHalfPluginCatalogService extends Disposable implements IBaseHalfPluginCatalogService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<IBaseHalfPluginCatalogSnapshot>());
	readonly onDidChange = this._onDidChange.event;
	private remoteCatalog: IBaseHalfRemotePluginCatalog | undefined;
	private source: BaseHalfPluginCatalogSource = 'bundled';
	private lastError: string | undefined;
	private targetPlatform: string | undefined;
	private readonly initializePromise: Promise<void>;

	constructor(
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.initializePromise = this.initialize();
	}

	async getSnapshot(): Promise<IBaseHalfPluginCatalogSnapshot> {
		await this.initializePromise;
		return this.snapshot();
	}

	async refresh(): Promise<IBaseHalfPluginCatalogSnapshot> {
		await this.initializePromise;
		const config = this.productService.basehalfPlugins;
		if (!config?.catalogIndexUrl || !config.publicKeys.length) {
			return this.snapshot();
		}
		try {
			const indexBytes = await this.requestBytes(config.catalogIndexUrl, 'basehalfPluginCatalogService.index');
			const rawIndex = decodeUtf8(indexBytes, 'plugin catalog index');
			const index = parseBaseHalfPluginCatalogIndex(JSON.parse(rawIndex));
			const catalogUrl = resolveBaseHalfPluginCatalogIndexResource(config.catalogIndexUrl, index.catalogPath);
			const signatureUrl = resolveBaseHalfPluginCatalogIndexResource(config.catalogIndexUrl, index.signaturePath);
			const [catalogBytes, signatureBytes] = await Promise.all([
				this.requestBytes(catalogUrl.href, 'basehalfPluginCatalogService.catalog'),
				this.requestBytes(signatureUrl.href, 'basehalfPluginCatalogService.signature')
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
			this.rejectSequenceRollback(catalog.sequence, fingerprint);
			this.remoteCatalog = catalog;
			this.source = 'remote';
			this.lastError = undefined;
			this.storageService.store(CACHE_CATALOG_KEY, rawCatalog, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.storageService.store(CACHE_SIGNATURE_KEY, rawSignature, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.storageService.store(HIGHEST_SEQUENCE_KEY, catalog.sequence, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.storageService.store(HIGHEST_FINGERPRINT_KEY, fingerprint, StorageScope.APPLICATION, StorageTarget.MACHINE);
		} catch (error) {
			this.lastError = getErrorMessage(error);
			this.logService.warn(`BaseHalf plugin catalog refresh failed: ${this.lastError}`);
		}
		const snapshot = this.snapshot();
		this._onDidChange.fire(snapshot);
		return snapshot;
	}

	private async initialize(): Promise<void> {
		this.targetPlatform = String(await this.extensionManagementService.getTargetPlatform());
		await this.restoreCache();
	}

	private async restoreCache(): Promise<void> {
		const config = this.productService.basehalfPlugins;
		const rawCatalog = this.storageService.get(CACHE_CATALOG_KEY, StorageScope.APPLICATION);
		const rawSignature = this.storageService.get(CACHE_SIGNATURE_KEY, StorageScope.APPLICATION);
		if (!config?.publicKeys.length || !rawCatalog || !rawSignature) {
			return;
		}
		try {
			const bytes = new TextEncoder().encode(rawCatalog);
			const signature: IBaseHalfPluginCatalogSignature = parseBaseHalfPluginCatalogSignature(JSON.parse(rawSignature));
			if (!await verifyBaseHalfPluginCatalogSignature(bytes, signature, config.publicKeys)) {
				throw new Error('Cached plugin catalog signature verification failed.');
			}
			const catalog = parseBaseHalfRemotePluginCatalog(JSON.parse(rawCatalog), BASEHALF_CURATED_PLUGINS.map(plugin => plugin.extensionId));
			const fingerprint = await catalogFingerprint(bytes);
			this.rejectSequenceRollback(catalog.sequence, fingerprint);
			this.remoteCatalog = catalog;
			this.source = 'cache';
		} catch (error) {
			this.logService.warn(`BaseHalf cached plugin catalog was ignored: ${getErrorMessage(error)}`);
		}
	}

	private rejectSequenceRollback(sequence: number, fingerprint: string): void {
		const highestSequence = this.storageService.getNumber(HIGHEST_SEQUENCE_KEY, StorageScope.APPLICATION, 0);
		const highestFingerprint = this.storageService.get(HIGHEST_FINGERPRINT_KEY, StorageScope.APPLICATION);
		validateBaseHalfCatalogSequence(sequence, fingerprint, highestSequence, highestFingerprint);
	}

	private snapshot(): IBaseHalfPluginCatalogSnapshot {
		const plugins = resolveBaseHalfPluginCatalog(BASEHALF_CURATED_PLUGINS, this.remoteCatalog, {
			basehalf: this.productService.basehalfVersion ?? '0.0.0',
			vscode: this.productService.version,
			targetPlatform: this.targetPlatform ?? 'undefined'
		});
		return {
			plugins,
			source: this.source,
			sequence: this.remoteCatalog?.sequence,
			generatedAt: this.remoteCatalog?.generatedAt,
			error: this.lastError
		};
	}

	private async requestBytes(url: string, callSite: string): Promise<Uint8Array> {
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
			return (await streamToBuffer(context.stream)).buffer;
		} finally {
			timeout.dispose();
			cancellation.dispose();
		}
	}
}

export function validateBaseHalfCatalogSequence(sequence: number, fingerprint: string, highestSequence: number, highestFingerprint: string | undefined): void {
	if (sequence < highestSequence) {
		throw new Error(`Plugin catalog sequence ${sequence} is older than the verified sequence ${highestSequence}.`);
	}
	if (sequence === highestSequence && highestFingerprint && fingerprint !== highestFingerprint) {
		throw new Error(`Plugin catalog sequence ${sequence} was already verified with different content.`);
	}
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
