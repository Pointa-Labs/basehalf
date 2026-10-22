/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { describeBytes, plannedItems, type MediaFacts, type MediaInspector, type PlannedItem } from './media.ts';
import type { CatalogMode, CatalogModel, CatalogParameter, ImageFormat, Media, ModeId, Params, ParamValue, PlannedMedia } from './types.ts';

/**
 * What every model is checked against before anything is sent, from its
 * declarations (video providers, "Requests"): the inputs a mode takes, the
 * prompt rule, the values of the parameters, and the mode's limits, which the
 * files are measured against. The commands run these before a provider
 * module's own `check`. Every problem is a plain English sentence; the first
 * one blocks Generate.
 */

/** The planned inputs counted, for the rules that count them. */
export interface PlannedCounts {
	readonly startFrame: boolean;
	readonly endFrame: boolean;
	readonly images: number;
	readonly videos: number;
	readonly audios: number;
	readonly source: boolean;
}

/** The planned inputs counted. */
export function countsOf(inputs: PlannedMedia): PlannedCounts {
	return {
		startFrame: inputs.startFrame !== undefined,
		endFrame: inputs.endFrame !== undefined,
		images: inputs.images.length,
		videos: inputs.videos.length,
		audios: inputs.audios.length,
		source: inputs.source !== undefined
	};
}

/** Whether the planned inputs send an image or a video (the prompt rule `withoutMedia`). */
export function sendsVisualMedia(counts: PlannedCounts): boolean {
	return counts.startFrame || counts.endFrame || counts.images > 0 || counts.videos > 0 || counts.source;
}

export function parameterApplies(parameter: CatalogParameter, mode: ModeId): boolean {
	return !parameter.modes || parameter.modes.includes(mode);
}

/** Whether a start frame decides the parameter for these inputs: then nothing is sent for it. */
export function setByStartFrame(parameter: CatalogParameter, counts: PlannedCounts | undefined): boolean {
	return parameter.setByStartFrame === true && counts?.startFrame === true;
}

/**
 * Every parameter that applies to the mode with its value or its default; an
 * optional one only when set, and none that a start frame of the inputs sets.
 */
export function resolveParams(model: CatalogModel, mode: ModeId, params: Params, counts?: PlannedCounts): Record<string, ParamValue> {
	const resolved: Record<string, ParamValue> = {};
	for (const parameter of model.parameters) {
		if (!parameterApplies(parameter, mode) || setByStartFrame(parameter, counts)) {
			continue;
		}
		const value = Object.hasOwn(params, parameter.name) ? params[parameter.name] : parameter.default;
		if (value !== undefined) {
			resolved[parameter.name] = value;
		}
	}
	return resolved;
}

/** How many files a request with these resolved parameters may make: an image model's `count`, otherwise one. */
export function outputCount(params: Params): number {
	const count = params.count;
	return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 1;
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

// --- inputs -------------------------------------------------------------------------------------

/** Missing required inputs and inputs beyond what the mode takes. */
export function checkCounts(model: CatalogModel, mode: CatalogMode, counts: PlannedCounts): string[] {
	const problems: string[] = [];
	const where = `${model.label} in ${mode.label} mode`;
	const frame = (use: CatalogMode['inputs']['startFrame'], planned: boolean, name: string) => {
		if (use === 'required' && !planned) {
			problems.push(`${where} needs ${name}.`);
		} else if (use === 'none' && planned) {
			problems.push(`${where} takes no ${name.replace(/^an? /, '')}.`);
		}
	};
	frame(mode.inputs.startFrame, counts.startFrame, 'a start frame');
	frame(mode.inputs.endFrame, counts.endFrame, 'an end frame');
	if (counts.endFrame && !counts.startFrame && mode.inputs.endFrame !== 'none') {
		problems.push('An end frame needs a start frame.');
	}
	const references = (slot: { readonly min: number; readonly max: number }, planned: number, one: string, many: string) => {
		if (planned < slot.min) {
			problems.push(`${where} needs at least ${plural(slot.min, one, many)}.`);
		} else if (planned > slot.max) {
			problems.push(slot.max === 0
				? `${where} takes no ${many}.`
				: `${where} takes at most ${plural(slot.max, one, many)}; ${planned} are planned.`);
		}
	};
	references(mode.inputs.images, counts.images, 'reference image', 'reference images');
	references(mode.inputs.videos, counts.videos, 'reference video', 'reference videos');
	references(mode.inputs.audios, counts.audios, 'reference audio', 'reference audio clips');
	if (mode.inputs.source === 'required' && !counts.source) {
		problems.push(`${where} needs a video to work on.`);
	} else if (mode.inputs.source === 'none' && counts.source) {
		problems.push(`${where} takes no video to work on.`);
	}
	return problems;
}

/** The prompt rule of the model: present when required, absent when not taken, and not too long. */
export function checkPrompt(model: CatalogModel, mode: CatalogMode, prompt: string, counts: PlannedCounts): string[] {
	const written = prompt.trim().length > 0;
	const takesVisual = mode.inputs.startFrame !== 'none' || mode.inputs.images.max > 0 || mode.inputs.videos.max > 0 || mode.inputs.source !== 'none';
	if (model.prompt.required === 'always' && !written) {
		return [`Write a prompt: ${model.label} needs one.`];
	}
	if (model.prompt.required === 'withoutMedia' && !written && !sendsVisualMedia(counts)) {
		return [takesVisual
			? `Write a prompt or connect an image: ${model.label} needs one or the other.`
			: `Write a prompt: ${model.label} needs one.`];
	}
	if (model.prompt.required === 'never' && written) {
		return [`${model.label} takes no prompt.`];
	}
	const length = [...prompt].length;
	if (length > model.prompt.maxLength) {
		return [`The prompt is ${length} characters long; ${model.label} takes at most ${model.prompt.maxLength}.`];
	}
	return [];
}

// --- parameters ---------------------------------------------------------------------------------

function onStep(value: number, min: number, step: number): boolean {
	const steps = (value - min) / step;
	return Math.abs(steps - Math.round(steps)) < 1e-9;
}

function rangeText(parameter: { readonly min: number; readonly max: number; readonly unit?: 'seconds'; readonly auto?: { readonly label: string } }): string {
	const unit = parameter.unit === 'seconds' ? ' seconds' : '';
	return `between ${parameter.min} and ${parameter.max}${unit}${parameter.auto ? `, or ${parameter.auto.label}` : ''}`;
}

/** One value against its declaration, or the problem with it. */
export function checkParameterValue(model: CatalogModel, parameter: CatalogParameter, value: ParamValue): string | undefined {
	switch (parameter.kind) {
		case 'choice':
			return parameter.options.some(option => option.value === value)
				? undefined
				: `${parameter.label} cannot be ${String(value)} for ${model.label}; choose ${parameter.options.map(option => option.label).join(', ')}.`;
		case 'integer':
		case 'number': {
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				return `${parameter.label} must be a number.`;
			}
			if (parameter.auto && value === parameter.auto.value) {
				return undefined;
			}
			if (parameter.kind === 'integer' && !Number.isInteger(value)) {
				return `${parameter.label} must be a whole number.`;
			}
			if (value < parameter.min || value > parameter.max) {
				return `${parameter.label} must be ${rangeText(parameter)}.`;
			}
			return onStep(value, parameter.min, parameter.step) ? undefined : `${parameter.label} must be a step of ${parameter.step} from ${parameter.min}.`;
		}
		case 'boolean':
			return typeof value === 'boolean' ? undefined : `${parameter.label} must be on or off.`;
		case 'text':
			if (typeof value !== 'string') {
				return `${parameter.label} must be text.`;
			}
			return [...value].length > parameter.maxLength ? `${parameter.label} is ${[...value].length} characters long; ${model.label} takes at most ${parameter.maxLength}.` : undefined;
	}
}

/** Unknown parameters, parameters of another mode, and values the declarations do not allow; a value a start frame sets is left out, not checked. */
export function checkParams(model: CatalogModel, mode: CatalogMode, params: Params, counts?: PlannedCounts): string[] {
	const problems: string[] = [];
	const declared = new Map(model.parameters.map(parameter => [parameter.name, parameter]));
	for (const name of Object.keys(params)) {
		const parameter = declared.get(name);
		if (!parameter) {
			problems.push(`${model.label} has no setting named "${name}".`);
		} else if (!parameterApplies(parameter, mode.id)) {
			problems.push(`${parameter.label} does not apply in ${mode.label} mode.`);
		}
	}
	for (const parameter of model.parameters) {
		if (!parameterApplies(parameter, mode.id) || setByStartFrame(parameter, counts)) {
			continue;
		}
		const value = Object.hasOwn(params, parameter.name) ? params[parameter.name] : parameter.default;
		if (value === undefined) {
			if (!parameter.optional) {
				problems.push(`${parameter.label} has no value.`);
			}
			continue;
		}
		const problem = checkParameterValue(model, parameter, value);
		if (problem) {
			problems.push(problem);
		}
	}
	return problems;
}

// --- files --------------------------------------------------------------------------------------

/** A planned input with what its header says. */
export interface MeasuredItem extends PlannedItem {
	readonly kind: 'image' | 'video' | 'audio';
	readonly facts: MediaFacts;
}

export function itemKind(item: PlannedItem): 'image' | 'video' | 'audio' {
	return item.slot === 'video' || item.slot === 'source' ? 'video' : item.slot === 'audio' ? 'audio' : 'image';
}

/** Measures every planned input once. */
export async function measureItems(inputs: PlannedMedia, inspector: MediaInspector): Promise<MeasuredItem[]> {
	const measured: MeasuredItem[] = [];
	for (const item of plannedItems(inputs)) {
		measured.push({ ...item, kind: itemKind(item), facts: await inspector.inspect(item.media) });
	}
	return measured;
}

const IMAGE_FORMATS: ReadonlySet<string> = new Set(['png', 'jpeg', 'webp', 'gif']);
/** The image formats of a mode that declares none. */
const DEFAULT_IMAGE_FORMATS: readonly ImageFormat[] = Object.freeze(['png', 'jpeg', 'webp']);
const IMAGE_FORMAT_NAMES: Readonly<Record<string, string>> = Object.freeze({ png: 'PNG', jpeg: 'JPEG', webp: 'WebP', gif: 'GIF' });
const VIDEO_FORMATS: ReadonlySet<string> = new Set(['mp4', 'mov']);
const AUDIO_FORMATS: ReadonlySet<string> = new Set(['wav', 'mp3', 'm4a']);

function seconds(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The mode's limits (sizes, lengths, bytes) checked against measured inputs, naming each file and the limit. */
export function checkLimits(mode: CatalogMode, items: readonly MeasuredItem[]): string[] {
	const problems: string[] = [];
	const limits = mode.limits;
	let videoSeconds = 0;
	let audioSeconds = 0;
	for (const item of items) {
		const { facts } = item;
		if (item.kind === 'image') {
			if (!facts.format || !IMAGE_FORMATS.has(facts.format) || !facts.width || !facts.height) {
				problems.push(`${item.label} is not an image AI Video can read (PNG, JPEG, WebP, or GIF).`);
				continue;
			}
			const formats = limits.imageFormats ?? DEFAULT_IMAGE_FORMATS;
			if (!formats.includes(facts.format as ImageFormat)) {
				const names = formats.map(format => IMAGE_FORMAT_NAMES[format]);
				const list = names.length > 2 ? `${names.slice(0, -1).join(', ')}, or ${names[names.length - 1]}` : names.join(' or ');
				problems.push(`${item.label} is a ${IMAGE_FORMAT_NAMES[facts.format]} image; this mode takes ${list} images.`);
				continue;
			}
			if (limits.imageMaxBytes !== undefined && facts.bytes > limits.imageMaxBytes) {
				problems.push(`${item.label} is ${describeBytes(facts.bytes)}; an image may be at most ${describeBytes(limits.imageMaxBytes)}.`);
			}
			const short = Math.min(facts.width, facts.height);
			const long = Math.max(facts.width, facts.height);
			if ((limits.imageMinSide !== undefined && short < limits.imageMinSide) || (limits.imageMaxSide !== undefined && long > limits.imageMaxSide)) {
				const range = limits.imageMinSide !== undefined && limits.imageMaxSide !== undefined
					? `between ${limits.imageMinSide} and ${limits.imageMaxSide} px`
					: limits.imageMinSide !== undefined ? `at least ${limits.imageMinSide} px` : `at most ${limits.imageMaxSide} px`;
				problems.push(`${item.label} is ${facts.width} × ${facts.height} px; each side must be ${range}.`);
			}
			const aspect = facts.width / facts.height;
			if (limits.imageAspect && (aspect < limits.imageAspect[0] - 1e-9 || aspect > limits.imageAspect[1] + 1e-9)) {
				problems.push(`${item.label} has an aspect ratio (width to height) of ${aspect.toFixed(2)}; it must be between ${limits.imageAspect[0]} and ${limits.imageAspect[1]}.`);
			}
			continue;
		}
		const video = item.kind === 'video';
		const range = video ? limits.videoSeconds : limits.audioSeconds;
		const maxBytes = video ? limits.videoMaxBytes : limits.audioMaxBytes;
		const total = video ? limits.videoTotalSeconds : limits.audioTotalSeconds;
		const formats = video ? VIDEO_FORMATS : AUDIO_FORMATS;
		const kind = video ? 'a video' : 'audio';
		if (maxBytes !== undefined && facts.bytes > maxBytes) {
			problems.push(`${item.label} is ${describeBytes(facts.bytes)}; ${video ? 'a video' : 'an audio clip'} may be at most ${describeBytes(maxBytes)}.`);
		}
		if (range || total !== undefined) {
			if (!facts.format || !formats.has(facts.format) || facts.seconds === undefined) {
				problems.push(`${item.label} is not ${kind} whose length AI Video can read (${video ? 'MP4 or MOV' : 'WAV, MP3, or M4A'}).`);
				continue;
			}
			if (range && (facts.seconds < range[0] - 0.05 || facts.seconds > range[1] + 0.05)) {
				problems.push(`${item.label} is ${seconds(facts.seconds)} seconds long; ${video ? 'a video' : 'an audio clip'} must be ${range[0]} to ${range[1]} seconds.`);
			}
		}
		if (facts.seconds !== undefined) {
			if (video) {
				videoSeconds += facts.seconds;
			} else {
				audioSeconds += facts.seconds;
			}
		}
	}
	if (limits.videoTotalSeconds !== undefined && videoSeconds > limits.videoTotalSeconds + 0.05) {
		problems.push(`The videos are ${seconds(videoSeconds)} seconds long together; at most ${limits.videoTotalSeconds} seconds are allowed.`);
	}
	if (limits.audioTotalSeconds !== undefined && audioSeconds > limits.audioTotalSeconds + 0.05) {
		problems.push(`The audio clips are ${seconds(audioSeconds)} seconds long together; at most ${limits.audioTotalSeconds} seconds are allowed.`);
	}
	return problems;
}

/** An inspector that measures each input once, so the commands and the module share the reads. */
export function cachingInspector(inspector: MediaInspector): MediaInspector {
	const seen = new Map<Media, Promise<MediaFacts>>();
	return {
		inspect(media) {
			let facts = seen.get(media);
			if (!facts) {
				facts = inspector.inspect(media);
				seen.set(media, facts);
			}
			return facts;
		}
	};
}
