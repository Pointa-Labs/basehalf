/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Queue } from '../../../../base/common/async.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IBaseHalfModelCredentialStore } from '../common/basehalfModelCredentialStore.js';
import {
	findBaseHalfVideoRegion,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoGenerationChoice,
	IBaseHalfVideoProviderAccess
} from '../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoProviderSettingsService, IBaseHalfVideoProviderStatus } from '../common/basehalfVideoGeneration.js';
import { normalizeBaseHalfVideoGeneration } from '../common/basehalfVideoNode.js';
import {
	BASEHALF_VIDEO_LAST_USED_STORAGE_KEY,
	BASEHALF_VIDEO_PROVIDERS_COMMAND_ID,
	BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY,
	BaseHalfVideoProviderSettingsError,
	baseHalfVideoProviderSecretAddress,
	IBaseHalfVideoStoredProviderSettings,
	normalizeBaseHalfVideoCredentialValue,
	normalizeBaseHalfVideoEndpoint,
	parseBaseHalfVideoCredentialSecret,
	parseBaseHalfVideoProviderSettings,
	serializeBaseHalfVideoProviderSettings
} from '../common/basehalfVideoProviderSettings.js';

const NO_SETTINGS: IBaseHalfVideoStoredProviderSettings = Object.freeze({ credentials: Object.freeze([]) });

/**
 * The providers the user set up on this computer (D59, video providers,
 * "Credentials, regions, and endpoints"). The region, the endpoint, and the
 * ids of the credentials that are set live in application storage, shared by
 * every window; the credential values live only in the encrypted credential
 * store, one JSON secret per provider, and are read only to send a request.
 */
export class BaseHalfVideoProviderSettingsService extends Disposable implements IBaseHalfVideoProviderSettingsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly mutations = this._register(new Queue<void>());
	private settingsRaw: string | undefined;
	private settings: ReadonlyMap<string, IBaseHalfVideoStoredProviderSettings>;
	private lastUsedRaw: string | undefined;
	private lastUsed: IBaseHalfVideoGenerationChoice | undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IBaseHalfModelCredentialStore private readonly credentialStore: IBaseHalfModelCredentialStore,
		@ICommandService private readonly commandService: ICommandService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.settingsRaw = this.storageService.get(BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY, StorageScope.APPLICATION);
		this.settings = parseBaseHalfVideoProviderSettings(this.settingsRaw);
		this.lastUsedRaw = this.storageService.get(BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, StorageScope.APPLICATION);
		this.lastUsed = parseLastUsed(this.lastUsedRaw);

		const listeners = this._register(new DisposableStore());
		// Another window changed a provider, or this one did: read it again only
		// when the stored text differs from what this window knows.
		this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY, listeners)(() => {
			const raw = this.storageService.get(BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY, StorageScope.APPLICATION);
			if (raw !== this.settingsRaw) {
				this.settingsRaw = raw;
				this.settings = parseBaseHalfVideoProviderSettings(raw);
				this._onDidChange.fire();
			}
		}));
		this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, listeners)(() => {
			const raw = this.storageService.get(BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, StorageScope.APPLICATION);
			if (raw !== this.lastUsedRaw) {
				this.lastUsedRaw = raw;
				this.lastUsed = parseLastUsed(raw);
				this._onDidChange.fire();
			}
		}));
	}

	getStatus(provider: IBaseHalfVideoCatalogProvider): IBaseHalfVideoProviderStatus {
		const stored = this.stored(provider.id);
		const region = findBaseHalfVideoRegion(provider, stored.region);
		const credentials = new Set(provider.credentials.map(credential => credential.id).filter(id => stored.credentials.includes(id)));
		return Object.freeze({
			region,
			setUp: provider.credentials.every(credential => credentials.has(credential.id)),
			endpoint: stored.endpoint ?? region.baseUrl,
			customEndpoint: stored.endpoint !== undefined,
			credentials
		});
	}

	setRegion(provider: IBaseHalfVideoCatalogProvider, regionId: string): Promise<void> {
		return this.mutations.queue(async () => {
			if (!provider.regions.some(region => region.id === regionId)) {
				throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.noRegion', "{0} has no such region.", provider.label));
			}
			const stored = this.stored(provider.id);
			if (regionId !== stored.region) {
				// An endpoint the user entered stays: it is shown with the region.
				this.write(provider.id, { ...stored, region: regionId });
			}
		});
	}

	setEndpoint(provider: IBaseHalfVideoCatalogProvider, endpoint: string): Promise<void> {
		return this.mutations.queue(async () => {
			const stored = this.stored(provider.id);
			const region = findBaseHalfVideoRegion(provider, stored.region);
			const normalized = endpoint.trim() ? normalizeBaseHalfVideoEndpoint(endpoint) : undefined;
			const next = normalized === undefined || normalized === normalizeBaseHalfVideoEndpointQuietly(region.baseUrl) ? undefined : normalized;
			if (next !== stored.endpoint) {
				this.write(provider.id, { ...stored, endpoint: next });
			}
		});
	}

	setCredential(provider: IBaseHalfVideoCatalogProvider, credentialId: string, value: string | undefined): Promise<void> {
		return this.mutations.queue(async () => {
			const credential = provider.credentials.find(candidate => candidate.id === credentialId);
			if (!credential) {
				throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.noCredential', "{0} takes no such value.", provider.label));
			}
			const normalized = value === undefined ? undefined : normalizeBaseHalfVideoCredentialValue(value, credential.label);
			const address = baseHalfVideoProviderSecretAddress(provider.id);
			const values: Record<string, string> = { ...await this.readCredentialValues(address) };
			if (normalized === undefined) {
				delete values[credentialId];
			} else {
				values[credentialId] = normalized;
			}
			// Only the values the provider declares are kept.
			const kept = Object.fromEntries(provider.credentials.flatMap(candidate => values[candidate.id] !== undefined ? [[candidate.id, values[candidate.id]]] : []));
			if (Object.keys(kept).length === 0) {
				await this.credentialStore.delete(address);
			} else {
				await this.credentialStore.set(address, JSON.stringify(kept));
			}
			this.write(provider.id, { ...this.stored(provider.id), credentials: Object.keys(kept) });
		});
	}

	async getAccess(provider: IBaseHalfVideoCatalogProvider, regionId?: string): Promise<IBaseHalfVideoProviderAccess | undefined> {
		let address: string;
		try {
			address = baseHalfVideoProviderSecretAddress(provider.id);
		} catch {
			return undefined;
		}
		const values = await this.readCredentialValues(address);
		const present = provider.credentials.filter(credential => values[credential.id] !== undefined).map(credential => credential.id);
		const stored = this.stored(provider.id);
		if (present.length !== stored.credentials.length || present.some(id => !stored.credentials.includes(id))) {
			// The credential store holds other values than this computer recorded:
			// show what it holds.
			await this.mutations.queue(async () => this.write(provider.id, { ...this.stored(provider.id), credentials: present }));
		}
		if (present.length !== provider.credentials.length) {
			return undefined;
		}
		const status = this.getStatus(provider);
		const region = regionId !== undefined ? provider.regions.find(candidate => candidate.id === regionId) : status.region;
		if (!region) {
			return undefined;
		}
		return Object.freeze({
			provider: provider.id,
			region: region.id,
			// A task of another region is asked about where that region is.
			endpoint: region.id === status.region.id ? status.endpoint : region.baseUrl,
			credentials: Object.freeze(Object.fromEntries(provider.credentials.map(credential => [credential.id, values[credential.id]])))
		});
	}

	getLastUsed(): IBaseHalfVideoGenerationChoice | undefined {
		return this.lastUsed;
	}

	setLastUsed(generation: IBaseHalfVideoGenerationChoice): void {
		let normalized: IBaseHalfVideoGenerationChoice;
		try {
			normalized = normalizeBaseHalfVideoGeneration(generation);
		} catch {
			return;
		}
		const raw = JSON.stringify(normalized);
		if (raw === this.lastUsedRaw) {
			return;
		}
		this.lastUsedRaw = raw;
		this.lastUsed = normalized;
		this.storageService.store(BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, raw, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	async openSettings(providerId?: string): Promise<void> {
		await this.commandService.executeCommand(BASEHALF_VIDEO_PROVIDERS_COMMAND_ID, ...(providerId !== undefined ? [providerId] : []));
	}

	/**
	 * The credential values of a provider as the credential store holds them. A
	 * value that cannot be read, such as one encrypted with a key that this
	 * computer no longer has, counts as not set: the provider shows as not set
	 * up, and Set, Replace, and Remove write over it. Nothing is deleted for it,
	 * so a value that cannot be read for a moment counts again once it can.
	 */
	private async readCredentialValues(address: string): Promise<Readonly<Record<string, string>>> {
		try {
			return parseBaseHalfVideoCredentialSecret(await this.credentialStore.get(address));
		} catch (error) {
			this.logService.warn(`BaseHalf could not read the credentials of a video provider; they count as not set: ${getErrorMessage(error)}`);
			return {};
		}
	}

	private stored(providerId: string): IBaseHalfVideoStoredProviderSettings {
		return this.settings.get(providerId) ?? NO_SETTINGS;
	}

	private write(providerId: string, entry: IBaseHalfVideoStoredProviderSettings): void {
		const next = new Map(this.settings);
		next.set(providerId, Object.freeze({
			...(entry.region !== undefined ? { region: entry.region } : {}),
			...(entry.endpoint !== undefined ? { endpoint: entry.endpoint } : {}),
			credentials: Object.freeze([...entry.credentials].sort())
		}));
		const raw = serializeBaseHalfVideoProviderSettings(next);
		if (raw === this.settingsRaw) {
			return;
		}
		this.settingsRaw = raw;
		this.settings = parseBaseHalfVideoProviderSettings(raw);
		this.storageService.store(BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY, raw, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}
}

function normalizeBaseHalfVideoEndpointQuietly(value: string): string | undefined {
	try {
		return normalizeBaseHalfVideoEndpoint(value);
	} catch {
		return undefined;
	}
}

function parseLastUsed(raw: string | undefined): IBaseHalfVideoGenerationChoice | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		const generation = normalizeBaseHalfVideoGeneration(JSON.parse(raw));
		return generation.model ? generation : undefined;
	} catch {
		return undefined;
	}
}

registerSingleton(IBaseHalfVideoProviderSettingsService, BaseHalfVideoProviderSettingsService, InstantiationType.Delayed);
