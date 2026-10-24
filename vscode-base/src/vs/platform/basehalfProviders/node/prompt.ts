/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { ModeId, Params, PlannedMedia, PromptInput, PromptPart } from './types.ts';

/**
 * The names a prompt gives its inputs (D74; providers, "Names in the
 * prompt"). The window sends the prompt as its text and, in place of each
 * mention of a planned input, that input's place in the request. A provider
 * module writes each mention as its model's documentation names that input
 * (`ProviderModule.writePrompt`); a module whose provider documents nothing
 * else writes the shared names below.
 */

/** What the names of a prompt's inputs depend on: the request without its prompt and its access. */
export interface PromptContext {
	readonly model: string;
	readonly mode: ModeId;
	readonly params: Params;
	readonly inputs: PlannedMedia;
}

/** The language names are written in. */
export type PromptLanguage = 'zh' | 'en';

const HAN = /\p{Script=Han}/u;

/** Chinese when the prompt's own text has a Chinese character, English otherwise: the names read as the text around them. */
export function promptLanguage(prompt: readonly PromptPart[]): PromptLanguage {
	return prompt.some(part => typeof part === 'string' && HAN.test(part)) ? 'zh' : 'en';
}

/** The prompt with its text as it is and each mention written by `name`. */
export function writePromptNames(prompt: readonly PromptPart[], name: (input: PromptInput) => string): string {
	return prompt.map(part => typeof part === 'string' ? part : name(part)).join('');
}

/** The number of a reference among the references of its kind in the request, from 1. */
export function referenceNumber(input: PromptInput): number {
	return (input.index ?? 0) + 1;
}

/**
 * The shared names: a reference by its kind and its number among the
 * references of its kind in the request, from 1, as most providers' own
 * documentation numbers them (`Image 2`, `视频1`); a frame and the clip by
 * what they are (`the first frame`, `首帧`).
 */
export function sharedPromptName(input: PromptInput, language: PromptLanguage): string {
	const zh = language === 'zh';
	const number = referenceNumber(input);
	switch (input.input) {
		case 'startFrame': return zh ? '首帧' : 'the first frame';
		case 'endFrame': return zh ? '尾帧' : 'the last frame';
		case 'source': return zh ? '原视频' : 'the source video';
		case 'images': return zh ? `图片${number}` : `Image ${number}`;
		case 'videos': return zh ? `视频${number}` : `Video ${number}`;
		case 'audios': return zh ? `音频${number}` : `Audio ${number}`;
	}
}

/** The prompt with the shared names, in the language of its text. */
export function writeSharedPromptNames(prompt: readonly PromptPart[]): string {
	const language = promptLanguage(prompt);
	return writePromptNames(prompt, input => sharedPromptName(input, language));
}

/** Whether a mention names an input the request sends: a frame or the clip that it has, or a reference within its list. */
export function isPlannedInput(input: PromptInput, inputs: PlannedMedia): boolean {
	switch (input.input) {
		case 'startFrame':
		case 'endFrame':
		case 'source':
			return input.index === undefined && inputs[input.input] !== undefined;
		case 'images':
		case 'videos':
		case 'audios':
			return input.index !== undefined && Number.isSafeInteger(input.index) && input.index >= 0 && input.index < inputs[input.input].length;
	}
}

/** The prompt's text alone, with no mention, as one part; for a prompt that names nothing. */
export function textPrompt(text: string): readonly PromptPart[] {
	return text ? [text] : [];
}
