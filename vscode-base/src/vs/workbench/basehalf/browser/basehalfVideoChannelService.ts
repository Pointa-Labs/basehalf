/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Queue } from '../../../base/common/async.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IBaseHalfModelCredentialStore } from '../common/basehalfModelCredentialStore.js';
import {
	BASEHALF_VIDEO_CHANNEL_MAX_CHANNELS,
	BASEHALF_VIDEO_CHANNELS_STORAGE_KEY,
	BASEHALF_VIDEO_LAST_USED_STORAGE_KEY,
	BASEHALF_VIDEO_PROVIDERS_COMMAND_ID,
	BaseHalfVideoChannelError,
	baseHalfVideoChannelDefaultName,
	baseHalfVideoChannelKeyAddress,
	createBaseHalfVideoChannelId,
	normalizeBaseHalfVideoChannelEndpoint,
	normalizeBaseHalfVideoChannelKey,
	normalizeBaseHalfVideoChannelModels,
	normalizeBaseHalfVideoChannelName,
	parseBaseHalfVideoChannels,
	serializeBaseHalfVideoChannels
} from '../common/basehalfVideoChannels.js';
import {
	IBaseHalfVideoChannel,
	IBaseHalfVideoChannelPatch,
	IBaseHalfVideoChannelService,
	IBaseHalfVideoModelChoice
} from '../common/basehalfVideoGeneration.js';
import { BaseHalfVideoProviderKind, IBaseHalfVideoGenerationSettings, normalizeBaseHalfVideoGenerationSettings } from '../common/basehalfVideoNode.js';
import { getBaseHalfVideoProviderPreset } from '../common/basehalfVideoProviders.js';

/**
 * The video providers the user set up on this computer (D58). Channel records
 * live in application storage, shared by every window; keys live only in the
 * encrypted credential store and are read only by the generation service when
 * it sends a request. The page learns whether a key is set from the record.
 */
export class BaseHalfVideoChannelService extends Disposable implements IBaseHalfVideoChannelService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly mutations = this._register(new Queue<void>());
	private channelsRaw: string | undefined;
	private channels: readonly IBaseHalfVideoChannel[];
	private lastUsedRaw: string | undefined;
	private lastUsed: IBaseHalfVideoGenerationSettings | undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IBaseHalfModelCredentialStore private readonly credentialStore: IBaseHalfModelCredentialStore,
		@ICommandService private readonly commandService: ICommandService
	) {
		super();
		this.channelsRaw = this.storageService.get(BASEHALF_VIDEO_CHANNELS_STORAGE_KEY, StorageScope.APPLICATION);
		this.channels = parseBaseHalfVideoChannels(this.channelsRaw);
		this.lastUsedRaw = this.storageService.get(BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, StorageScope.APPLICATION);
		this.lastUsed = parseLastUsed(this.lastUsedRaw);

		const listeners = this._register(new DisposableStore());
		// Another window changed the channels, or this one did: read them again
		// only when the stored text differs from what this window knows.
		this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, BASEHALF_VIDEO_CHANNELS_STORAGE_KEY, listeners)(() => {
			const raw = this.storageService.get(BASEHALF_VIDEO_CHANNELS_STORAGE_KEY, StorageScope.APPLICATION);
			if (raw !== this.channelsRaw) {
				this.channelsRaw = raw;
				this.channels = parseBaseHalfVideoChannels(raw);
				this._onDidChange.fire();
			}
		}));
		this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, listeners)(() => {
			const raw = this.storageService.get(BASEHALF_VIDEO_LAST_USED_STORAGE_KEY, StorageScope.APPLICATION);
			if (raw !== this.lastUsedRaw) {
				this.lastUsedRaw = raw;
				this.lastUsed = parseLastUsed(raw);
			}
		}));
	}

	getChannels(): readonly IBaseHalfVideoChannel[] {
		return this.channels;
	}

	getChannel(id: string): IBaseHalfVideoChannel | undefined {
		return this.channels.find(channel => channel.id === id);
	}

	resolve(choice: { readonly channel?: string; readonly model?: string }): IBaseHalfVideoModelChoice | undefined {
		const model = choice.model;
		if (!model) {
			return undefined;
		}
		const named = choice.channel !== undefined ? this.getChannel(choice.channel) : undefined;
		const channel = named?.models.includes(model) ? named : this.channels.find(candidate => candidate.models.includes(model));
		return channel ? Object.freeze({ channel, model }) : undefined;
	}

	addChannel(provider: BaseHalfVideoProviderKind): Promise<IBaseHalfVideoChannel> {
		const preset = getBaseHalfVideoProviderPreset(provider);
		let added: IBaseHalfVideoChannel | undefined;
		return this.mutations.queue(async () => {
			if (this.channels.length >= BASEHALF_VIDEO_CHANNEL_MAX_CHANNELS) {
				throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.tooMany', "BaseHalf keeps at most {0} providers. Remove one you do not use first.", BASEHALF_VIDEO_CHANNEL_MAX_CHANNELS));
			}
			const id = createBaseHalfVideoChannelId(provider, new Set(this.channels.map(channel => channel.id)));
			// A key left at this address by a channel removed long ago must not
			// make the new channel look set up.
			await this.credentialStore.delete(baseHalfVideoChannelKeyAddress(id));
			added = Object.freeze({
				id,
				provider,
				name: baseHalfVideoChannelDefaultName(preset.label, this.channels.map(channel => channel.name)),
				baseUrl: preset.baseUrl,
				models: Object.freeze(preset.models.map(model => model.id)),
				hasKey: false
			});
			this.writeChannels([...this.channels, added]);
		}).then(() => added!);
	}

	updateChannel(id: string, patch: IBaseHalfVideoChannelPatch): Promise<void> {
		return this.mutations.queue(async () => {
			const channel = this.requireChannel(id);
			const next: IBaseHalfVideoChannel = Object.freeze({
				...channel,
				...(patch.name !== undefined ? { name: normalizeBaseHalfVideoChannelName(patch.name) } : {}),
				...(patch.baseUrl !== undefined ? { baseUrl: normalizeBaseHalfVideoChannelEndpoint(patch.baseUrl) } : {}),
				...(patch.models !== undefined ? { models: normalizeBaseHalfVideoChannelModels(patch.models) } : {})
			});
			if (next.name === channel.name && next.baseUrl === channel.baseUrl && sameModels(next.models, channel.models)) {
				return;
			}
			this.replaceChannel(next);
		});
	}

	setKey(id: string, key: string | undefined): Promise<void> {
		return this.mutations.queue(async () => {
			this.requireChannel(id);
			const address = baseHalfVideoChannelKeyAddress(id);
			if (key === undefined) {
				await this.credentialStore.delete(address);
			} else {
				await this.credentialStore.set(address, normalizeBaseHalfVideoChannelKey(key));
			}
			// The channel may have been removed in another window meanwhile.
			const current = this.getChannel(id);
			if (!current) {
				await this.credentialStore.delete(address);
				return;
			}
			if (current.hasKey !== (key !== undefined)) {
				this.replaceChannel(Object.freeze({ ...current, hasKey: key !== undefined }));
			}
		});
	}

	async getKey(id: string): Promise<string | undefined> {
		const channel = this.getChannel(id);
		if (!channel) {
			return undefined;
		}
		const key = await this.credentialStore.get(baseHalfVideoChannelKeyAddress(id));
		if (key === undefined && channel.hasKey) {
			// The credential store lost the key: show the channel as having none.
			await this.mutations.queue(async () => {
				const current = this.getChannel(id);
				if (current?.hasKey) {
					this.replaceChannel(Object.freeze({ ...current, hasKey: false }));
				}
			});
		}
		return key;
	}

	removeChannel(id: string): Promise<void> {
		return this.mutations.queue(async () => {
			if (!this.getChannel(id)) {
				return;
			}
			await this.credentialStore.delete(baseHalfVideoChannelKeyAddress(id));
			this.writeChannels(this.channels.filter(channel => channel.id !== id));
		});
	}

	getLastUsed(): IBaseHalfVideoGenerationSettings | undefined {
		return this.lastUsed;
	}

	setLastUsed(settings: IBaseHalfVideoGenerationSettings): void {
		let normalized: IBaseHalfVideoGenerationSettings;
		try {
			normalized = normalizeBaseHalfVideoGenerationSettings(settings);
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
	}

	async openSettings(): Promise<void> {
		await this.commandService.executeCommand(BASEHALF_VIDEO_PROVIDERS_COMMAND_ID);
	}

	private requireChannel(id: string): IBaseHalfVideoChannel {
		const channel = this.getChannel(id);
		if (!channel) {
			throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.missing', "This provider was removed."));
		}
		return channel;
	}

	private replaceChannel(next: IBaseHalfVideoChannel): void {
		this.writeChannels(this.channels.map(channel => channel.id === next.id ? next : channel));
	}

	private writeChannels(channels: readonly IBaseHalfVideoChannel[]): void {
		const raw = serializeBaseHalfVideoChannels(channels);
		this.channelsRaw = raw;
		this.channels = parseBaseHalfVideoChannels(raw);
		this.storageService.store(BASEHALF_VIDEO_CHANNELS_STORAGE_KEY, raw, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}
}

function parseLastUsed(raw: string | undefined): IBaseHalfVideoGenerationSettings | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		return normalizeBaseHalfVideoGenerationSettings(JSON.parse(raw));
	} catch {
		return undefined;
	}
}

function sameModels(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((model, index) => model === right[index]);
}

registerSingleton(IBaseHalfVideoChannelService, BaseHalfVideoChannelService, InstantiationType.Delayed);
