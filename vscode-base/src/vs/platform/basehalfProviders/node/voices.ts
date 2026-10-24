/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isVoiceId, MAX_SAMPLE_ADDRESS_LENGTH } from '../common/basehalfProviderVoices.js';
import { isRecord, unreadable } from './failure.js';
import { isSampleAddress } from './http.js';
import type { CatalogModel, ListedVoice, VoiceParameter, VoicesResult } from '../common/basehalfProviderTypes.js';

/**
 * The voices of a speech model as `voices` answers them (D78; providers,
 * "Voices", "Requests"): what a module's `listVoices` found, made safe to
 * show and to send back.
 */

/** The most voices `voices` answers, and the `limit` a module's `listVoices` is given. */
export const MAX_LISTED_VOICES = 2000;
const MAX_LABEL_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 300;

/** The `voice` parameter of a model, the one of kind `voice`; none for a model that speaks in no voice. */
export function voiceParameterOf(model: CatalogModel): VoiceParameter | undefined {
	return model.parameters.find((parameter): parameter is VoiceParameter => parameter.kind === 'voice');
}

/**
 * The voices a module listed, as `voices` answers them:
 *
 * - a voice whose id is not the id of a voice (`isVoiceId`: 1 to 256
 *   characters, not only spaces, without control characters) is left out, as
 *   is an entry that is not a voice;
 * - a label and a description are plain text on one line, at most 200 and 300
 *   characters; a voice without a label is named by its id;
 * - a sample is kept only at an address that `voicePreview` fetches from for
 *   the call's `endpoint` (`isSampleAddress`: `https://`, or `http://` on
 *   this computer only for an endpoint on this computer), of at most 8,192
 *   characters;
 * - the account's own voices come first, each group in the module's order,
 *   and a voice listed twice is kept once, its first time;
 * - at most {@link MAX_LISTED_VOICES}, with `truncated` when the module said
 *   the provider had more or listed more.
 */
export function keptVoices(listed: unknown, endpoint: URL): VoicesResult {
	if (!isRecord(listed) || !Array.isArray(listed.voices)) {
		throw unreadable('The provider answered voices BaseHalf cannot read.');
	}
	const voices = listed.voices.map(value => keptVoice(value, endpoint)).filter((voice): voice is ListedVoice => voice !== undefined);
	const seen = new Set<string>();
	const unique: ListedVoice[] = [];
	for (const voice of [...voices.filter(voice => voice.own), ...voices.filter(voice => !voice.own)]) {
		if (!seen.has(voice.id)) {
			seen.add(voice.id);
			unique.push(voice);
		}
	}
	const truncated = listed.truncated === true || unique.length > MAX_LISTED_VOICES;
	return { voices: unique.slice(0, MAX_LISTED_VOICES), ...(truncated ? { truncated: true } : {}) };
}

function keptVoice(value: unknown, endpoint: URL): ListedVoice | undefined {
	if (!isRecord(value) || typeof value.id !== 'string' || !isVoiceId(value.id)) {
		return undefined;
	}
	const label = typeof value.label === 'string' ? oneLine(value.label, MAX_LABEL_LENGTH) : '';
	const description = typeof value.description === 'string' ? oneLine(value.description, MAX_DESCRIPTION_LENGTH) : '';
	const sample = typeof value.sample === 'string' && isKeptSample(value.sample, endpoint) ? value.sample : undefined;
	return {
		id: value.id,
		label: label || oneLine(value.id, MAX_LABEL_LENGTH),
		...(description ? { description } : {}),
		own: value.own === true,
		...(sample !== undefined ? { sample } : {})
	};
}

/** Text on one line: control characters and runs of spaces become one space, and at most `max` characters, the last an ellipsis when cut. */
function oneLine(value: string, max: number): string {
	const text = value.replace(/[\s\u0000-\u001F\u007F-\u009F]+/g, ' ').trim();
	const characters = [...text];
	return characters.length > max ? `${characters.slice(0, max - 1).join('').trimEnd()}…` : text;
}

function isKeptSample(value: string, endpoint: URL): boolean {
	if (value.length > MAX_SAMPLE_ADDRESS_LENGTH) {
		return false;
	}
	try {
		return isSampleAddress(new URL(value), endpoint);
	} catch {
		return false;
	}
}
