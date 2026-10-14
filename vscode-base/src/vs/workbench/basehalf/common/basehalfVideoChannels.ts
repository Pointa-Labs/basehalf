/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { BASEHALF_VIDEO_PROVIDER_KINDS, BaseHalfVideoProviderKind } from './basehalfVideoNode.js';
import { IBaseHalfVideoChannel } from './basehalfVideoGeneration.js';

/**
 * The video provider channels the user set up on this computer (D58): how
 * they are stored, and the rules for their names, endpoints, model ids, and
 * keys. Pure: the channel service and the Video Providers page share them.
 * A key is never part of a channel record; it lives in the encrypted
 * credential store under {@link baseHalfVideoChannelKeyAddress}.
 */

/** Opens Settings on the Video Providers page. */
export const BASEHALF_VIDEO_PROVIDERS_COMMAND_ID = 'basehalf.video.providers';

/** The Settings section that holds the Video Providers page. It keeps the place of the former Models & Providers page. */
export const BASEHALF_VIDEO_PROVIDERS_SETTINGS_SECTION_ID = 'basehalf/models';

/** Machine-local channel records, without keys. */
export const BASEHALF_VIDEO_CHANNELS_STORAGE_KEY = 'basehalf.video.channels.v1';
/** The model and settings of the last generation on this computer. */
export const BASEHALF_VIDEO_LAST_USED_STORAGE_KEY = 'basehalf.video.lastUsed.v1';

const CHANNELS_VERSION = 1;

export const BASEHALF_VIDEO_CHANNEL_NAME_MAX_LENGTH = 64;
export const BASEHALF_VIDEO_CHANNEL_ENDPOINT_MAX_LENGTH = 2048;
export const BASEHALF_VIDEO_CHANNEL_MODEL_MAX_LENGTH = 256;
export const BASEHALF_VIDEO_CHANNEL_MAX_MODELS = 100;
export const BASEHALF_VIDEO_CHANNEL_MAX_CHANNELS = 50;
export const BASEHALF_VIDEO_CHANNEL_KEY_MAX_LENGTH = 16 * 1024;

const CHANNEL_ID_PATTERN = /^(?<provider>[a-z]+)-(?<suffix>[a-z0-9]{4})$/;

/** An input a channel cannot take. The message is localized plain text for the page. */
export class BaseHalfVideoChannelError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfVideoChannelError';
	}
}

/**
 * Where the key of a channel is kept in the credential store. The main process
 * admits only credential addresses of this shape (`basehalf.modelServices.<id>.apiKey`).
 */
export function baseHalfVideoChannelKeyAddress(channelId: string): string {
	if (!CHANNEL_ID_PATTERN.test(channelId)) {
		throw new BaseHalfVideoChannelError(`Cannot address the key of the channel '${channelId}'.`);
	}
	return `basehalf.modelServices.video.${channelId}.apiKey`;
}

/** `ark-3f2a`: the preset and four random characters that no other channel uses. */
export function createBaseHalfVideoChannelId(provider: BaseHalfVideoProviderKind, takenIds: ReadonlySet<string>, random: () => number = Math.random): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	for (let attempt = 0; attempt < 1000; attempt++) {
		let suffix = '';
		for (let index = 0; index < 4; index++) {
			suffix += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
		}
		const id = `${provider}-${suffix}`;
		if (!takenIds.has(id)) {
			return id;
		}
	}
	throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.noId', "BaseHalf could not name a new provider. Remove a provider you do not use and try again."));
}

/** The preset's label, numbered when another channel has it: `Volcengine Ark`, `Volcengine Ark 2`. */
export function baseHalfVideoChannelDefaultName(label: string, takenNames: readonly string[]): string {
	const taken = new Set(takenNames.map(name => name.trim().toLocaleLowerCase()));
	if (!taken.has(label.toLocaleLowerCase())) {
		return label;
	}
	for (let number = 2; ; number++) {
		const candidate = `${label} ${number}`;
		if (!taken.has(candidate.toLocaleLowerCase())) {
			return candidate;
		}
	}
}

export function normalizeBaseHalfVideoChannelName(value: string): string {
	const name = value.trim();
	if (!name) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.nameEmpty', "Enter a name for the provider."));
	}
	if (name.length > BASEHALF_VIDEO_CHANNEL_NAME_MAX_LENGTH) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.nameLong', "Use a name of at most {0} characters.", BASEHALF_VIDEO_CHANNEL_NAME_MAX_LENGTH));
	}
	if (hasControlCharacters(name)) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.nameControl', "The name cannot contain line breaks or control characters."));
	}
	return name;
}

/**
 * A complete `https://` address, or `http://` on this computer (a local relay or
 * test server). Without a user name, password, query, or fragment; without a
 * trailing slash.
 */
export function normalizeBaseHalfVideoChannelEndpoint(value: string): string {
	const text = value.trim();
	const invalid = () => new BaseHalfVideoChannelError(localize('basehalf.video.channel.endpointInvalid', "Enter a complete address that starts with https://, such as https://ark.cn-beijing.volces.com/api/v3."));
	if (!text || text.length > BASEHALF_VIDEO_CHANNEL_ENDPOINT_MAX_LENGTH || hasControlCharacters(text) || /\s/.test(text)) {
		throw invalid();
	}
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		throw invalid();
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw invalid();
	}
	if (url.protocol === 'http:' && !isBaseHalfLoopbackHost(url.hostname)) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.endpointHttp', "Use an address that starts with https://. An address with http:// is allowed only on this computer (localhost), because the key would travel unencrypted."));
	}
	if (url.username || url.password) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.endpointCredentials', "Remove the user name and password from the address. The key goes in the API key field."));
	}
	if (url.search || url.hash || text.includes('?') || text.includes('#')) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.endpointQuery', "Remove the part after ? or # from the address."));
	}
	const path = url.pathname.replace(/\/+$/, '');
	return `${url.protocol}//${url.host}${path}`;
}

/** `localhost`, `127.0.0.1` and the rest of 127/8, and `::1`. */
export function isBaseHalfLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[(?<inner>.*)\]$/, '$<inner>');
	return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function normalizeBaseHalfVideoChannelModel(value: string): string {
	const model = value.trim();
	if (!model) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.modelEmpty', "Enter a model id, such as doubao-seedance-2-5-260628."));
	}
	if (model.length > BASEHALF_VIDEO_CHANNEL_MODEL_MAX_LENGTH) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.modelLong', "Use a model id of at most {0} characters.", BASEHALF_VIDEO_CHANNEL_MODEL_MAX_LENGTH));
	}
	if (hasControlCharacters(model)) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.modelControl', "A model id cannot contain line breaks or control characters."));
	}
	return model;
}

/** Model ids in the user's order, each once. */
export function normalizeBaseHalfVideoChannelModels(values: readonly string[]): readonly string[] {
	const models: string[] = [];
	for (const value of values) {
		const model = normalizeBaseHalfVideoChannelModel(value);
		if (!models.includes(model)) {
			models.push(model);
		}
	}
	if (models.length > BASEHALF_VIDEO_CHANNEL_MAX_MODELS) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.modelsMany', "A provider can list at most {0} models.", BASEHALF_VIDEO_CHANNEL_MAX_MODELS));
	}
	return Object.freeze(models);
}

/** A key travels in an HTTP header: visible ASCII characters, without spaces. */
export function normalizeBaseHalfVideoChannelKey(value: string): string {
	const key = value.trim();
	if (!key) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.keyEmpty', "Paste the API key from the provider's console."));
	}
	if (key.length > BASEHALF_VIDEO_CHANNEL_KEY_MAX_LENGTH) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.keyLong', "This key is longer than any provider uses. Check that only the key was pasted."));
	}
	if (!/^[\x21-\x7E]+$/.test(key)) {
		throw new BaseHalfVideoChannelError(localize('basehalf.video.channel.keyCharacters', "A key contains only letters, digits, and symbols, without spaces or line breaks. Check that only the key was pasted."));
	}
	return key;
}

/** The stored record of a channel: everything but the key. */
export interface IBaseHalfStoredVideoChannel {
	readonly id: string;
	readonly provider: BaseHalfVideoProviderKind;
	readonly name: string;
	readonly baseUrl: string;
	readonly models: readonly string[];
	/** Whether a key was stored for the channel. The key itself is in the credential store. */
	readonly hasKey: boolean;
}

/** Reads the stored channels. Entries that are not valid are left out; nothing here throws. */
export function parseBaseHalfVideoChannels(raw: string | undefined): readonly IBaseHalfVideoChannel[] {
	if (!raw) {
		return Object.freeze([]);
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return Object.freeze([]);
	}
	if (!isRecord(value) || value.version !== CHANNELS_VERSION || !Array.isArray(value.channels)) {
		return Object.freeze([]);
	}
	const channels: IBaseHalfVideoChannel[] = [];
	const ids = new Set<string>();
	for (const entry of value.channels) {
		const channel = parseChannel(entry);
		if (channel && !ids.has(channel.id) && channels.length < BASEHALF_VIDEO_CHANNEL_MAX_CHANNELS) {
			ids.add(channel.id);
			channels.push(channel);
		}
	}
	return Object.freeze(channels);
}

export function serializeBaseHalfVideoChannels(channels: readonly IBaseHalfVideoChannel[]): string {
	const stored: IBaseHalfStoredVideoChannel[] = channels.map(channel => ({
		id: channel.id,
		provider: channel.provider,
		name: channel.name,
		baseUrl: channel.baseUrl,
		models: [...channel.models],
		hasKey: channel.hasKey
	}));
	return JSON.stringify({ version: CHANNELS_VERSION, channels: stored });
}

function parseChannel(value: unknown): IBaseHalfVideoChannel | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const { id, provider, name, baseUrl, models, hasKey } = value;
	if (typeof id !== 'string' || !CHANNEL_ID_PATTERN.test(id)
		|| typeof provider !== 'string' || !(BASEHALF_VIDEO_PROVIDER_KINDS as readonly string[]).includes(provider)
		|| !id.startsWith(`${provider}-`)
		|| typeof name !== 'string' || typeof baseUrl !== 'string'
		|| !Array.isArray(models) || !models.every(model => typeof model === 'string')
		|| typeof hasKey !== 'boolean') {
		return undefined;
	}
	try {
		return Object.freeze({
			id,
			provider: provider as BaseHalfVideoProviderKind,
			name: normalizeBaseHalfVideoChannelName(name),
			baseUrl: normalizeBaseHalfVideoChannelEndpoint(baseUrl),
			models: normalizeBaseHalfVideoChannelModels(models),
			hasKey
		});
	} catch {
		return undefined;
	}
}

function hasControlCharacters(value: string): boolean {
	return /[\u0000-\u001F\u007F]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
