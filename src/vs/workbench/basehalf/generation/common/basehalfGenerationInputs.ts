/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfModelKind, BaseHalfVideoModeId, baseHalfVideoModeOf, IBaseHalfVideoCatalogMode, IBaseHalfVideoCatalogModel, IBaseHalfVideoModeInputs } from './basehalfVideoCatalog.js';
import { localize } from '../../../../nls.js';

// The inputs of a generation card: the kind of each by its file, which of them the mode of a model uses and in what
// order, the problem of one that cannot be sent, and how long the text of an input and a sent prompt may be.

export type BaseHalfVideoInputKind = 'image' | 'video' | 'audio' | 'text' | 'other';

/** One upstream entry of a card, resolved. */
export interface IBaseHalfVideoInputSource {
	/** The upstream entry, workspace-relative. */
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	/** False when the entry names nothing, or a draft, which has no file yet. */
	readonly available: boolean;
	/** The entry names a draft: it is of the draft's kind and unavailable until the draft has its file. */
	readonly draft?: boolean;
}

/** What a generation does with an input: a frame, a reference, the clip of `extend` and `edit`, text for the prompt, or nothing. */
export type BaseHalfVideoInputUse = 'start-frame' | 'end-frame' | 'reference' | 'source' | 'text' | 'unused';

/**
 * Why an input is not used: `missing` names nothing; `draft` names a draft,
 * which has no file yet; `kind` cannot be used, such as a folder or a PDF;
 * `mode` the mode takes no input of its kind; `full` comes after what the
 * mode takes.
 */
export type BaseHalfVideoInputUnusedReason = 'missing' | 'draft' | 'kind' | 'mode' | 'full';

export interface IBaseHalfVideoInputPlanItem {
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	readonly use: BaseHalfVideoInputUse;
	readonly reason?: BaseHalfVideoInputUnusedReason;
}

/**
 * The extensions of the files an input of each kind may be, lower case,
 * without the dot (generation cards, "Inputs"). A sound's are those the
 * window shows as sounds (`BASEHALF_MEDIA_FILE_EXTENSIONS`), and AAC, which
 * a provider may take.
 */
export const BASEHALF_VIDEO_INPUT_EXTENSIONS: Readonly<Record<Exclude<BaseHalfVideoInputKind, 'other'>, readonly string[]>> = Object.freeze({
	image: Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp']),
	video: Object.freeze(['mp4', 'mov', 'm4v', 'webm']),
	audio: Object.freeze(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac']),
	text: Object.freeze(['md', 'markdown', 'txt'])
});

const INPUT_KIND_BY_EXTENSION: ReadonlyMap<string, BaseHalfVideoInputKind> = new Map(
	Object.entries(BASEHALF_VIDEO_INPUT_EXTENSIONS).flatMap(([kind, extensions]) => extensions.map(extension => [extension, kind as BaseHalfVideoInputKind] as const))
);

/** The input kind of a file, by its extension (generation cards, "Inputs"). */
export function baseHalfVideoInputKindOfPath(path: string): BaseHalfVideoInputKind {
	const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
	const dot = name.lastIndexOf('.');
	return INPUT_KIND_BY_EXTENSION.get(dot > 0 ? name.slice(dot + 1) : '') ?? 'other';
}

/**
 * The slots the panel and a generation assume while no model is chosen: a
 * start and an end frame. It is no model's declaration; Generate needs a
 * model of the catalog.
 */
export const BASEHALF_VIDEO_DEFAULT_MODE_INPUTS: IBaseHalfVideoModeInputs = Object.freeze({
	startFrame: 'optional',
	endFrame: 'optional',
	images: Object.freeze({ min: 0, max: 0 }),
	videos: Object.freeze({ min: 0, max: 0 }),
	audios: Object.freeze({ min: 0, max: 0 }),
	source: 'none'
});

/**
 * What an image card assumes while no model is chosen: reference images, as
 * every image model takes, as many as are connected. It is no model's
 * declaration either.
 */
export const BASEHALF_IMAGE_DEFAULT_MODE_INPUTS: IBaseHalfVideoModeInputs = Object.freeze({
	startFrame: 'none',
	endFrame: 'none',
	images: Object.freeze({ min: 0, max: Number.MAX_SAFE_INTEGER }),
	videos: Object.freeze({ min: 0, max: 0 }),
	audios: Object.freeze({ min: 0, max: 0 }),
	source: 'none'
});

/**
 * What an audio card assumes while no model is chosen: references mode, with
 * images and sounds as references, as many as are connected, as an audio
 * model's references are (generation cards, "Inputs"). It is no model's
 * declaration either.
 */
export const BASEHALF_AUDIO_DEFAULT_MODE_INPUTS: IBaseHalfVideoModeInputs = Object.freeze({
	startFrame: 'none',
	endFrame: 'none',
	images: Object.freeze({ min: 0, max: Number.MAX_SAFE_INTEGER }),
	videos: Object.freeze({ min: 0, max: 0 }),
	audios: Object.freeze({ min: 0, max: Number.MAX_SAFE_INTEGER }),
	source: 'none'
});

/**
 * The slots a card of a kind shows its inputs in while it has no model, or
 * its model is not in the catalog (generation cards, "The panel"): an image
 * card and an audio card as references mode does, and a video card as
 * frames mode does.
 */
export function baseHalfDefaultModeInputs(kind: BaseHalfModelKind): IBaseHalfVideoModeInputs {
	return kind === 'image' ? BASEHALF_IMAGE_DEFAULT_MODE_INPUTS : kind === 'audio' ? BASEHALF_AUDIO_DEFAULT_MODE_INPUTS : BASEHALF_VIDEO_DEFAULT_MODE_INPUTS;
}

/** The mode a card of a kind shows while it has no model: References for an image or a sound, Frames for a video. */
export function baseHalfDefaultModeId(kind: BaseHalfModelKind): BaseHalfVideoModeId {
	return kind === 'video' ? 'frames' : 'reference';
}

/**
 * How a generation uses each input, in upstream order, from the slots the
 * mode declares (generation cards, "Inputs"). An image fills the start frame,
 * then the end frame, then the reference images, as far as the mode has
 * them; a video fills the clip, then the reference videos; audio fills the
 * reference audio. Text inputs join the prompt in every mode.
 */
export function planBaseHalfVideoInputs(
	inputs: IBaseHalfVideoModeInputs,
	sources: readonly IBaseHalfVideoInputSource[]
): readonly IBaseHalfVideoInputPlanItem[] {
	const taken = { startFrame: false, endFrame: false, source: false, image: 0, video: 0, audio: 0 };
	const hasStart = inputs.startFrame !== 'none';
	const hasEnd = inputs.endFrame !== 'none';
	const hasSource = inputs.source !== 'none';
	return Object.freeze(sources.map((source): IBaseHalfVideoInputPlanItem => {
		const item = { path: source.path, kind: source.kind };
		const unused = (reason: BaseHalfVideoInputUnusedReason) => Object.freeze({ ...item, use: 'unused' as const, reason });
		const used = (use: BaseHalfVideoInputUse) => Object.freeze({ ...item, use });
		if (!source.available) {
			return unused(source.draft ? 'draft' : 'missing');
		}
		switch (source.kind) {
			case 'text':
				return used('text');
			case 'other':
				return unused('kind');
			case 'image':
				if (hasStart && !taken.startFrame) {
					taken.startFrame = true;
					return used('start-frame');
				}
				if (hasEnd && !taken.endFrame) {
					taken.endFrame = true;
					return used('end-frame');
				}
				if (taken.image < inputs.images.max) {
					taken.image++;
					return used('reference');
				}
				return unused(hasStart || hasEnd || inputs.images.max > 0 ? 'full' : 'mode');
			case 'video':
				if (hasSource && !taken.source) {
					taken.source = true;
					return used('source');
				}
				if (taken.video < inputs.videos.max) {
					taken.video++;
					return used('reference');
				}
				return unused(hasSource || inputs.videos.max > 0 ? 'full' : 'mode');
			case 'audio':
				if (taken.audio < inputs.audios.max) {
					taken.audio++;
					return used('reference');
				}
				return unused(inputs.audios.max > 0 ? 'full' : 'mode');
		}
	}));
}

/**
 * Whether a mode uses every input (generation cards, "What is connected is
 * sent"): none is left over because of its kind or because the mode takes no
 * more of its kind. An input that names nothing, or a draft, counts as of its
 * kind here: it is missing, which says why on its own, not unusable.
 */
export function baseHalfVideoModeUsesEveryInput(inputs: IBaseHalfVideoModeInputs, sources: readonly IBaseHalfVideoInputSource[]): boolean {
	return planBaseHalfVideoInputs(inputs, sources.map(asAvailable)).every(item => item.use !== 'unused');
}

/**
 * The mode a draft's generation uses (generation cards, "What is connected is
 * sent"): the card's own mode when that mode uses every input, and otherwise
 * the first of the model's modes, in the catalog's order, that does. When
 * none does, the card's own mode, whose inputs then keep Generate from
 * running. The model is never changed for the inputs.
 */
export function baseHalfVideoModeThatIsUsed(model: IBaseHalfVideoCatalogModel, modeId: BaseHalfVideoModeId | string | undefined, sources: readonly IBaseHalfVideoInputSource[]): IBaseHalfVideoCatalogMode {
	const own = baseHalfVideoModeOf(model, modeId);
	if (baseHalfVideoModeUsesEveryInput(own.inputs, sources)) {
		return own;
	}
	return model.modes.find(mode => baseHalfVideoModeUsesEveryInput(mode.inputs, sources)) ?? own;
}

/** An input that no mode of a model can use together with the inputs before it. */
export interface IBaseHalfVideoInputProblem {
	/** Its place among the inputs. */
	readonly index: number;
	readonly path: string;
	/** Why, as a refused connection says it: "Seedance 2.5 takes no videos." */
	readonly reason: string;
}

/**
 * The first input that no mode of the model can use together with the inputs
 * before it, and why (generation cards, "What is connected is sent"), or
 * `undefined` when one of the model's modes uses every input. A connection
 * whose source would be such an input is refused with the reason, and a draft
 * whose inputs hold one does not generate.
 */
export function baseHalfVideoInputProblem(model: IBaseHalfVideoCatalogModel, sources: readonly IBaseHalfVideoInputSource[]): IBaseHalfVideoInputProblem | undefined {
	const fits = (count: number) => model.modes.some(mode => baseHalfVideoModeUsesEveryInput(mode.inputs, sources.slice(0, count)));
	if (fits(sources.length)) {
		return undefined;
	}
	for (let index = 0; index < sources.length; index++) {
		if (!fits(index + 1)) {
			const source = sources[index];
			return Object.freeze({ index, path: source.path, reason: inputProblemReason(model, sources.slice(0, index + 1), source) });
		}
	}
	return undefined;
}

function asAvailable(source: IBaseHalfVideoInputSource): IBaseHalfVideoInputSource {
	return source.available ? source : { path: source.path, kind: source.kind, available: true };
}

/** How many inputs of a kind a mode takes, frames and the clip included. */
function modeTakes(inputs: IBaseHalfVideoModeInputs, kind: 'image' | 'video' | 'audio'): number {
	switch (kind) {
		case 'image': return (inputs.startFrame !== 'none' ? 1 : 0) + (inputs.endFrame !== 'none' ? 1 : 0) + inputs.images.max;
		case 'video': return (inputs.source !== 'none' ? 1 : 0) + inputs.videos.max;
		case 'audio': return inputs.audios.max;
	}
}

/** Why no generation card can take the file at `path` as an input: it is neither an image, a video, a sound, nor text. */
export function baseHalfVideoUnusableKindReason(path: string): string {
	return localize('basehalf.video.catalog.input.kind', "An image, video, or audio card cannot use {0}.", path.slice(path.lastIndexOf('/') + 1) || path);
}

/**
 * Why a draft with `model` and the list `upstream` does not take `added`, as
 * one more input or in place of `removed` (D67). Only what the change brings
 * in is refused: an input that a later model cannot use already says so in
 * the panel. Without a model, only a file that is neither an image, a video,
 * a sound, nor text is refused.
 */
export function baseHalfVideoAddedInputRefusal(model: IBaseHalfVideoCatalogModel | undefined, upstream: readonly string[], added: string, removed?: string): string | undefined {
	if (!model) {
		return baseHalfVideoInputKindOfPath(added) === 'other' ? baseHalfVideoUnusableKindReason(added) : undefined;
	}
	const inputs = removed !== undefined && upstream.includes(removed)
		? upstream.map(entry => entry === removed ? added : entry)
		: [...upstream.filter(entry => entry !== added), added];
	const problem = baseHalfVideoInputProblem(model, inputs.map(path => ({ path, kind: baseHalfVideoInputKindOfPath(path), available: true })));
	return problem && problem.path === added ? problem.reason : undefined;
}

function inputProblemReason(model: IBaseHalfVideoCatalogModel, inputs: readonly IBaseHalfVideoInputSource[], source: IBaseHalfVideoInputSource): string {
	const name = source.path.slice(source.path.lastIndexOf('/') + 1) || source.path;
	const kind = source.kind;
	if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
		return baseHalfVideoUnusableKindReason(source.path);
	}
	const most = Math.max(0, ...model.modes.map(mode => modeTakes(mode.inputs, kind)));
	if (most === 0) {
		return kind === 'image'
			? localize('basehalf.video.catalog.input.noImages', "{0} takes no images.", model.label)
			: kind === 'video'
				? localize('basehalf.video.catalog.input.noVideos', "{0} takes no videos.", model.label)
				: localize('basehalf.video.catalog.input.noAudio', "{0} takes no audio.", model.label);
	}
	if (inputs.filter(input => input.kind === kind).length > most) {
		if (kind === 'image') {
			return most === 1
				? localize('basehalf.video.catalog.input.oneImage', "{0} takes one image at most.", model.label)
				: localize('basehalf.video.catalog.input.images', "{0} takes at most {1} images.", model.label, most);
		}
		if (kind === 'video') {
			return most === 1
				? localize('basehalf.video.catalog.input.oneVideo', "{0} takes one video at most.", model.label)
				: localize('basehalf.video.catalog.input.videos', "{0} takes at most {1} videos.", model.label, most);
		}
		return most === 1
			? localize('basehalf.video.catalog.input.oneAudio', "{0} takes one audio file at most.", model.label)
			: localize('basehalf.video.catalog.input.audios', "{0} takes at most {1} audio files.", model.label, most);
	}
	return localize('basehalf.video.catalog.input.together', "{0} cannot use {1} together with the inputs before it.", model.label, name);
}

/** Removes a leading YAML front matter block, which holds a note's metadata, not its text. */
export function stripBaseHalfMarkdownFrontMatter(text: string): string {
	const normalized = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
	const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalized);
	return match ? normalized.slice(match[0].length) : normalized;
}

/** The longest prompt as sent that the window takes from `check`, as the task record keeps it (D74). */
export const BASEHALF_VIDEO_SENT_PROMPT_MAX_LENGTH = 256 * 1024;

/** The longest text one text input adds to the prompt. */
export const BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH = 16 * 1024;
