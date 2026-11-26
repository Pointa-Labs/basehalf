/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Queue } from '../../../../base/common/async.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { CustomProviderDefinitionError, isCustomProviderId, parseCustomProviderDefinition } from '../../../../platform/basehalfProviders/common/basehalfCustomProviders.js';
import type { CustomProviderDefinition } from '../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
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
import { IBaseHalfCustomProviderChange, IBaseHalfCustomProviderEntry, IBaseHalfVideoProviderSettingsService, IBaseHalfVideoProviderStatus } from '../common/basehalfVideoGeneration.js';
import { BASEHALF_GENERATION_KINDS, baseHalfGenerationChoice, BaseHalfGenerationKind, normalizeBaseHalfGenerationInfo } from '../common/basehalfGenerationInfo.js';
import {
	BASEHALF_AUDIO_LAST_USED_STORAGE_KEY,
	BASEHALF_CUSTOM_PROVIDERS_STORAGE_KEY,
	BASEHALF_IMAGE_LAST_USED_STORAGE_KEY,
	BASEHALF_VIDEO_LAST_USED_STORAGE_KEY,
	BASEHALF_VIDEO_PROVIDERS_COMMAND_ID,
	BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY,
	BaseHalfVideoProviderSettingsError,
	baseHalfVideoProviderSecretAddress,
	IBaseHalfVideoStoredProviderSettings,
	normalizeBaseHalfVideoCredentialValue,
	normalizeBaseHalfVideoEndpoint,
	parseBaseHalfCustomProviders,
	parseBaseHalfVideoCredentialSecret,
	parseBaseHalfVideoProviderSettings,
	serializeBaseHalfCustomProviders,
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
	/** The last values used, per kind, as stored and as read. */
	private readonly lastUsed: Record<BaseHalfGenerationKind, { raw: string | undefined; value: IBaseHalfVideoGenerationChoice | undefined }>;
	/** The custom providers the user added (D108), as stored and as read. */
	private customRaw: string | undefined;
	private custom: readonly CustomProviderDefinition[];

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IBaseHalfModelCredentialStore private readonly credentialStore: IBaseHalfModelCredentialStore,
		@ICommandService private readonly commandService: ICommandService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.settingsRaw = this.storageService.get(BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY, StorageScope.APPLICATION);
		this.settings = parseBaseHalfVideoProviderSettings(this.settingsRaw);
		this.lastUsed = { image: this.readLastUsed('image'), video: this.readLastUsed('video'), audio: this.readLastUsed('audio') };
		this.customRaw = this.storageService.get(BASEHALF_CUSTOM_PROVIDERS_STORAGE_KEY, StorageScope.APPLICATION);
		this.custom = parseBaseHalfCustomProviders(this.customRaw);

		const listeners = this._register(new DisposableStore());
		// Another window added, changed, or removed a custom provider.
		this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, BASEHALF_CUSTOM_PROVIDERS_STORAGE_KEY, listeners)(() => {
			const raw = this.storageService.get(BASEHALF_CUSTOM_PROVIDERS_STORAGE_KEY, StorageScope.APPLICATION);
			if (raw !== this.customRaw) {
				this.customRaw = raw;
				this.custom = parseBaseHalfCustomProviders(raw);
				this._onDidChange.fire();
			}
		}));
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
		for (const kind of BASEHALF_GENERATION_KINDS) {
			this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, LAST_USED_STORAGE_KEYS[kind], listeners)(() => {
				const read = this.readLastUsed(kind);
				if (read.raw !== this.lastUsed[kind].raw) {
					this.lastUsed[kind] = read;
					this._onDidChange.fire();
				}
			}));
		}
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
			// Stored values that cannot be read are written anew: the user sets or removes one now.
			const values: Record<string, string> = { ...(await this.readCredentialValues(address) ?? {}) };
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
		if (values === undefined) {
			// Neither used nor deleted, and the record stays as it is: the provider still
			// shows as set up, and values that can be read again work again.
			throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.unreadable', "BaseHalf can't read the credentials of {0} on this computer. Set them again in Providers.", provider.label));
		}
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
		// A call for a custom provider carries what the user entered (D108).
		const custom = isCustomProviderId(provider.id) ? this.custom.find(candidate => candidate.id === provider.id) : undefined;
		if (isCustomProviderId(provider.id) && !custom) {
			return undefined;
		}
		return Object.freeze({
			provider: provider.id,
			region: region.id,
			// A task of another region is asked about where that region is.
			endpoint: region.id === status.region.id ? status.endpoint : region.baseUrl,
			credentials: Object.freeze(Object.fromEntries(provider.credentials.map(credential => [credential.id, values[credential.id]]))),
			...(custom ? { custom } : {})
		});
	}

	get customProviders(): readonly CustomProviderDefinition[] {
		return this.custom;
	}

	async addCustomProvider(entry: IBaseHalfCustomProviderEntry): Promise<string> {
		let added = '';
		await this.mutations.queue(async () => {
			let id: string;
			do {
				id = `custom-${generateUuid().replace(/-/g, '').slice(0, 8)}`;
			} while (this.custom.some(provider => provider.id === id) || this.settings.has(id));
			const definition = readCustomDefinition({ id, label: entry.label, baseUrl: normalizeBaseHalfVideoEndpoint(entry.baseUrl), models: [entry.model] });
			const apiKey = normalizeBaseHalfVideoCredentialValue(entry.apiKey, localize('basehalf.video.providerSettings.customApiKey', "API Key"));
			await this.credentialStore.set(baseHalfVideoProviderSecretAddress(id), JSON.stringify({ apiKey }));
			this.write(id, { credentials: ['apiKey'] });
			this.writeCustom([...this.custom, definition]);
			added = id;
		});
		return added;
	}

	updateCustomProvider(providerId: string, change: IBaseHalfCustomProviderChange): Promise<void> {
		return this.mutations.queue(async () => {
			const current = this.custom.find(provider => provider.id === providerId);
			if (!current) {
				throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.noCustomProvider', "This custom provider was removed."));
			}
			const voices = change.voices !== undefined ? change.voices : current.voices;
			const definition = readCustomDefinition({
				id: current.id,
				label: change.label ?? current.label,
				baseUrl: change.baseUrl !== undefined ? normalizeBaseHalfVideoEndpoint(change.baseUrl) : current.baseUrl,
				models: change.models ?? current.models,
				...(voices?.length ? { voices } : {})
			});
			this.writeCustom(this.custom.map(provider => provider.id === providerId ? definition : provider));
		});
	}

	removeCustomProvider(providerId: string): Promise<void> {
		return this.mutations.queue(async () => {
			if (!this.custom.some(provider => provider.id === providerId)) {
				return;
			}
			await this.credentialStore.delete(baseHalfVideoProviderSecretAddress(providerId));
			const next = new Map(this.settings);
			next.delete(providerId);
			const raw = serializeBaseHalfVideoProviderSettings(next);
			if (raw !== this.settingsRaw) {
				this.settingsRaw = raw;
				this.settings = parseBaseHalfVideoProviderSettings(raw);
				this.storageService.store(BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY, raw, StorageScope.APPLICATION, StorageTarget.MACHINE);
			}
			this.writeCustom(this.custom.filter(provider => provider.id !== providerId));
		});
	}

	private writeCustom(providers: readonly CustomProviderDefinition[]): void {
		const raw = serializeBaseHalfCustomProviders(providers);
		if (raw === this.customRaw) {
			return;
		}
		this.customRaw = raw;
		this.custom = parseBaseHalfCustomProviders(raw);
		this.storageService.store(BASEHALF_CUSTOM_PROVIDERS_STORAGE_KEY, raw, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	getLastUsed(kind: BaseHalfGenerationKind = 'video'): IBaseHalfVideoGenerationChoice | undefined {
		return this.lastUsed[kind].value;
	}

	setLastUsed(generation: IBaseHalfVideoGenerationChoice, kind: BaseHalfGenerationKind = 'video'): void {
		const normalized = normalizeLastUsed(generation);
		if (!normalized) {
			return;
		}
		const raw = JSON.stringify(normalized);
		if (raw === this.lastUsed[kind].raw) {
			return;
		}
		this.lastUsed[kind] = { raw, value: normalized };
		this.storageService.store(LAST_USED_STORAGE_KEYS[kind], raw, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	async openSettings(providerId?: string, kind?: BaseHalfGenerationKind): Promise<void> {
		const args = kind !== undefined ? [providerId, kind] : providerId !== undefined ? [providerId] : [];
		await this.commandService.executeCommand(BASEHALF_VIDEO_PROVIDERS_COMMAND_ID, ...args);
	}

	/**
	 * The credential values of a provider as the credential store holds them,
	 * or nothing when they cannot be read, such as values encrypted with a key
	 * that this computer no longer has, or a keychain that refused for a moment.
	 */
	private async readCredentialValues(address: string): Promise<Readonly<Record<string, string>> | undefined> {
		try {
			return parseBaseHalfVideoCredentialSecret(await this.credentialStore.get(address));
		} catch (error) {
			this.logService.warn(`BaseHalf could not read the credentials of a video provider: ${getErrorMessage(error)}`);
			return undefined;
		}
	}

	private readLastUsed(kind: BaseHalfGenerationKind): { raw: string | undefined; value: IBaseHalfVideoGenerationChoice | undefined } {
		const raw = this.storageService.get(LAST_USED_STORAGE_KEYS[kind], StorageScope.APPLICATION);
		return { raw, value: parseLastUsed(raw) };
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

/** What the user entered for a custom provider, read by the rules a request is held to; the reason in plain words when it breaks one. */
function readCustomDefinition(value: unknown): CustomProviderDefinition {
	try {
		return parseCustomProviderDefinition(value);
	} catch (error) {
		throw new BaseHalfVideoProviderSettingsError(error instanceof CustomProviderDefinitionError ? error.message : getErrorMessage(error));
	}
}

function normalizeBaseHalfVideoEndpointQuietly(value: string): string | undefined {
	try {
		return normalizeBaseHalfVideoEndpoint(value);
	} catch {
		return undefined;
	}
}

/** Where the last values of each kind are stored (providers, "Credentials, regions, and endpoints"). */
const LAST_USED_STORAGE_KEYS: Readonly<Record<BaseHalfGenerationKind, string>> = Object.freeze({
	image: BASEHALF_IMAGE_LAST_USED_STORAGE_KEY,
	video: BASEHALF_VIDEO_LAST_USED_STORAGE_KEY,
	audio: BASEHALF_AUDIO_LAST_USED_STORAGE_KEY
});

function parseLastUsed(raw: string | undefined): IBaseHalfVideoGenerationChoice | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		const generation = normalizeLastUsed(JSON.parse(raw));
		return generation?.model ? generation : undefined;
	} catch {
		return undefined;
	}
}

/** A generation choice that generation information could hold, or `undefined`. */
function normalizeLastUsed(value: unknown): IBaseHalfVideoGenerationChoice | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const { provider, model, mode, params } = value as IBaseHalfVideoGenerationChoice;
	try {
		return baseHalfGenerationChoice(normalizeBaseHalfGenerationInfo({
			prompt: '',
			...(provider !== undefined ? { provider } : {}),
			...(model !== undefined ? { model } : {}),
			...(mode !== undefined ? { mode } : {}),
			...(params !== undefined ? { params } : {})
		}));
	} catch {
		return undefined;
	}
}

registerSingleton(IBaseHalfVideoProviderSettingsService, BaseHalfVideoProviderSettingsService, InstantiationType.Delayed);
