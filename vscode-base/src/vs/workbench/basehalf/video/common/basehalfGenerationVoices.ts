/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { safeIntl } from '../../../../base/common/date.js';
import { Event } from '../../../../base/common/event.js';
import { language } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import type { ListedVoice, VoiceParameter, VoicesResult } from '../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { isVoiceId } from '../../../../platform/basehalfProviders/common/basehalfProviderVoices.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { BaseHalfVideoModeId, baseHalfVideoModeParameters, IBaseHalfVideoCatalogModel, IBaseHalfVideoCatalogProvider } from './basehalfVideoCatalog.js';

/**
 * The voices of speech models (D78; generation cards, "The panel"; providers,
 * "Voices"): the voice of a model, a voice's name, the window's service that
 * lists a provider's voices and plays their samples, and what the voice menu
 * lists. Apart from the service's interface, pure: the panels and the menu
 * draw it, and the tests check it.
 */

/** The most voices a list keeps (providers, "Requests"). */
export const BASEHALF_VOICES_MAX = 2000;

/**
 * The voice of a model that speaks, which its voice button chooses instead of
 * the settings: its parameter of kind `voice`, of those that apply to the
 * mode when one is given.
 */
export function baseHalfVoiceParameter(model: IBaseHalfVideoCatalogModel, modeId?: BaseHalfVideoModeId): VoiceParameter | undefined {
	const parameters = modeId ? baseHalfVideoModeParameters(model, modeId) : model.parameters;
	return parameters.find((parameter): parameter is VoiceParameter => parameter.kind === 'voice');
}

/**
 * A voice's name, as the voice button and the panel of a card with its file
 * say it: the one the catalog gives it, or the provider's last list, or its
 * id when neither has it.
 */
export function baseHalfVoiceLabel(parameter: VoiceParameter | undefined, id: string, list: VoicesResult | undefined): string {
	return parameter?.options.find(option => option.value === id)?.label
		?? list?.voices.find(voice => voice.id === id)?.label
		?? id;
}

// --- The service ---------------------------------------------------------------------------------

/** What this window knows of the voices of a provider in a region. */
export interface IBaseHalfVoices {
	/** The last list the provider answered there, kept for the window. */
	readonly list?: VoicesResult;
	/** A request for the list is on its way. */
	readonly loading: boolean;
	/** Why the last request failed, in plain words; absent once one succeeds. */
	readonly error?: string;
}

/** The sample of a voice that the window fetches or plays. */
export interface IBaseHalfVoiceSample {
	readonly provider: string;
	readonly voice: string;
	readonly sample: string;
	/** `loading` while its bytes come and are decoded; `playing` once it sounds. */
	readonly phase: 'loading' | 'playing';
}

/** The last sample that could not be played, and why. */
export interface IBaseHalfVoiceSampleFailure {
	readonly provider: string;
	readonly voice: string;
	readonly message: string;
}

export const IBaseHalfGenerationVoiceService = createDecorator<IBaseHalfGenerationVoiceService>('baseHalfGenerationVoiceService');

/**
 * The voices of the speech models in this window (D78; providers, "Voices"):
 * it asks the provider service for a provider's voices and the account's,
 * with this computer's access, keeps the last answer per provider and region
 * for the window, and fetches and plays the sample of a voice, one sound at a
 * time with what plays on the canvas.
 */
export interface IBaseHalfGenerationVoiceService {
	readonly _serviceBrand: undefined;

	/** Fires when a list is asked for, arrives, or fails. */
	readonly onDidChangeVoices: Event<void>;
	/** Fires when a sample starts to load, plays, stops, or fails. */
	readonly onDidChangeSample: Event<void>;

	/** What the window knows of the voices of the provider `provider` in the region `region`. */
	voices(provider: string, region: string): IBaseHalfVoices;

	/**
	 * Asks the provider for its voices and the account's, for `model`, in the
	 * region in use, unless a request is on its way already. Resolves when it
	 * has an answer, which {@link voices} then holds.
	 */
	refresh(provider: IBaseHalfVideoCatalogProvider, model: IBaseHalfVideoCatalogModel): Promise<void>;

	/** The sample that loads or plays. */
	readonly sample: IBaseHalfVoiceSample | undefined;
	/** The last sample that could not be played, until another one is asked for. */
	readonly sampleFailure: IBaseHalfVoiceSampleFailure | undefined;

	/**
	 * Fetches the sample of a listed voice through the provider service and
	 * plays it, stopping the one that plays. Its sound comes up and goes down
	 * as a card's does; what plays on the canvas pauses, and a video or a
	 * sound that starts there stops it.
	 */
	playSample(provider: IBaseHalfVideoCatalogProvider, model: IBaseHalfVideoCatalogModel, voice: string, sample: string): Promise<void>;

	/** Stops the sample that loads or plays; its sound goes down first. */
	stopSample(): void;
}

// --- The menu ------------------------------------------------------------------------------------

/** A voice as the voice menu lists it. */
export interface IBaseHalfVoiceMenuVoice {
	/** Unique within the menu. */
	readonly key: string;
	/** The provider's voice id: what the card stores and sends. */
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	/** The address of its sample, where the provider gives one. */
	readonly sample?: string;
	/** It is the card's voice. */
	readonly checked: boolean;
}

export type BaseHalfVoiceMenuRow =
	| { readonly type: 'header'; readonly text: string }
	| { readonly type: 'voice'; readonly voice: IBaseHalfVoiceMenuVoice }
	| { readonly type: 'note'; readonly text: string };

export interface IBaseHalfVoiceMenuInput {
	/** The voice of the card's model. */
	readonly parameter: VoiceParameter;
	/** The card's voice. */
	readonly voice: string;
	/** The provider's voices and the account's, when the menu has a list of them. */
	readonly list?: VoicesResult;
}

/**
 * The rows of the voice menu (generation cards, "The panel"): **Your
 * Voices**, the account's own that the list holds, and **Voices**, the
 * catalog's first and then the others the provider lists, each voice once.
 * A voice of the card that no list names heads Voices by its id; once a list
 * of the account has come, it says that it is not among them. A search keeps
 * the voices whose name or description holds it, spaces left out; the last
 * row says when the provider had more voices than the list holds.
 */
export function baseHalfVoiceMenuRows(input: IBaseHalfVoiceMenuInput, query: string): readonly BaseHalfVoiceMenuRow[] {
	const listed = new Map<string, ListedVoice>();
	for (const voice of input.list?.voices ?? []) {
		if (!listed.has(voice.id)) {
			listed.set(voice.id, voice);
		}
	}
	const seen = new Set<string>();
	const entry = (id: string, label: string, description: string | undefined, sample: string | undefined): IBaseHalfVoiceMenuVoice => Object.freeze({
		key: `voice:${id}`,
		id,
		label,
		...(description ? { description } : {}),
		...(sample ? { sample } : {}),
		checked: id === input.voice
	});
	const voices: IBaseHalfVoiceMenuVoice[] = [];
	if (!input.parameter.options.some(option => option.value === input.voice) && !listed.has(input.voice) && input.voice) {
		// Another account's voice, or one deleted since: it is sent as it is, and the provider says whether it knows it.
		seen.add(input.voice);
		voices.push(entry(input.voice, input.voice, input.list ? localize('basehalf.generation.voices.notListed', "Not among the voices of this account.") : undefined, undefined));
	}
	for (const option of input.parameter.options) {
		if (!seen.has(option.value)) {
			seen.add(option.value);
			const heard = listed.get(option.value);
			voices.push(entry(option.value, option.label, option.description ?? heard?.description, heard?.sample));
		}
	}
	const yours: IBaseHalfVoiceMenuVoice[] = [];
	for (const voice of listed.values()) {
		if (!seen.has(voice.id)) {
			seen.add(voice.id);
			(voice.own ? yours : voices).push(entry(voice.id, voice.label, voice.description, voice.sample));
		}
	}
	const needle = compact(query);
	const matches = (voice: IBaseHalfVoiceMenuVoice) => !needle || compact(voice.label).includes(needle) || compact(voice.description ?? '').includes(needle);
	const rows: BaseHalfVoiceMenuRow[] = [];
	for (const [title, section] of [[localize('basehalf.generation.voices.yours', "Your Voices"), yours], [localize('basehalf.generation.voices.voices', "Voices"), voices]] as const) {
		const found = section.filter(matches);
		if (found.length) {
			rows.push({ type: 'header', text: title });
			rows.push(...found.map(voice => ({ type: 'voice' as const, voice })));
		}
	}
	if (needle && !rows.length) {
		rows.push({ type: 'note', text: localize('basehalf.generation.voices.noMatch', "No voice here has that name or description.") });
	}
	if (input.list?.truncated) {
		rows.push({ type: 'note', text: localize('basehalf.generation.voices.truncated', "Showing the first {0} voices.", baseHalfFormatCount(input.list.voices.length)) });
	}
	return Object.freeze(rows);
}

/** What the line under the search field says, and the action it offers: Set Up, or Try Again. */
export interface IBaseHalfVoiceMenuStatus {
	readonly text: string;
	readonly action?: 'setUp' | 'retry';
}

export interface IBaseHalfVoiceMenuStatusInput {
	/** The provider lists voices for the model. */
	readonly listed: boolean;
	/** Every credential of the provider is set on this computer. */
	readonly setUp: boolean;
	readonly providerLabel: string;
	readonly voices: IBaseHalfVoices;
}

/**
 * The line under the voice menu's search field (generation cards, "The
 * panel"): a provider that is not set up says how to get all of its voices,
 * with Set Up; a list that could not be loaded says why, with Try Again; and
 * the first list says that it loads. A provider that lists no voices has
 * none: the catalog's voices are all of them.
 */
export function baseHalfVoiceMenuStatus(input: IBaseHalfVoiceMenuStatusInput): IBaseHalfVoiceMenuStatus | undefined {
	if (!input.listed) {
		return undefined;
	}
	if (!input.setUp) {
		return Object.freeze({ text: localize('basehalf.generation.voices.setUp', "Set up {0} to choose from all of its voices and your own.", input.providerLabel), action: 'setUp' as const });
	}
	if (input.voices.error !== undefined && !input.voices.loading) {
		return Object.freeze({ text: localize('basehalf.generation.voices.failed', "The voices could not be loaded: {0}", input.voices.error), action: 'retry' as const });
	}
	if (input.voices.loading && !input.voices.list) {
		return Object.freeze({ text: localize('basehalf.generation.voices.loading', "Loading voices…") });
	}
	return undefined;
}

/** A whole number as the window's language writes it, such as `2,000`. */
export function baseHalfFormatCount(value: number): string {
	return safeIntl.NumberFormat(language).value.format(value);
}

// --- Reading what the provider service answers ---------------------------------------------------

/**
 * Reads what `voices` answered, keeping what the menu can show: a voice whose
 * id is the id of a voice by the provider service's rule (`isVoiceId`: 1 to
 * 256 characters, not only spaces, without control characters), each id
 * once, at most {@link BASEHALF_VOICES_MAX}, its name and description as
 * plain text, and its sample only as an `http` or `https` address.
 * `undefined` for an answer that is no list of voices.
 */
export function parseBaseHalfVoicesResult(value: unknown): VoicesResult | undefined {
	if (!isRecord(value) || !Array.isArray(value.voices)) {
		return undefined;
	}
	const voices: ListedVoice[] = [];
	const seen = new Set<string>();
	let truncated = value.truncated === true;
	for (const candidate of value.voices) {
		if (!isRecord(candidate) || typeof candidate.id !== 'string' || !isVoiceId(candidate.id) || seen.has(candidate.id)) {
			continue;
		}
		if (voices.length === BASEHALF_VOICES_MAX) {
			truncated = true;
			break;
		}
		seen.add(candidate.id);
		const label = typeof candidate.label === 'string' ? plainText(candidate.label, 200) : '';
		const description = typeof candidate.description === 'string' ? plainText(candidate.description, 300) : '';
		const sample = typeof candidate.sample === 'string' && isWebAddress(candidate.sample) ? candidate.sample : undefined;
		voices.push(Object.freeze({
			id: candidate.id,
			label: label || candidate.id,
			...(description ? { description } : {}),
			own: candidate.own === true,
			...(sample ? { sample } : {})
		}));
	}
	return Object.freeze({ voices: Object.freeze(voices), ...(truncated ? { truncated: true } : {}) });
}

function compact(text: string): string {
	return text.toLowerCase().replace(/\s+/g, '');
}

/** Plain text of at most `maxLength` characters, on one line, without control characters or markup. */
function plainText(value: string, maxLength: number): string {
	const text = value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function isWebAddress(value: string): boolean {
	if (value.length > 4096) {
		return false;
	}
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:';
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
