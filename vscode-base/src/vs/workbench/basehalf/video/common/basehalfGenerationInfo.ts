/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { YamlMapNode, YamlNode } from '../../../../base/common/yaml.js';
import { localize } from '../../../../nls.js';
import {
	baseHalfMirrorYamlAbsent,
	baseHalfMirrorYamlBoolean,
	baseHalfMirrorYamlItems,
	baseHalfMirrorYamlMap,
	baseHalfMirrorYamlNumber,
	baseHalfMirrorYamlProperty,
	baseHalfMirrorYamlQuote,
	baseHalfMirrorYamlString,
	baseHalfParseMirrorYaml,
	BaseHalfMirrorYamlUnreadable
} from '../../workspace/common/basehalfMirrorYaml.js';
import {
	BASEHALF_MODEL_KINDS,
	BASEHALF_VIDEO_MODE_IDS,
	BASEHALF_VIDEO_SENT_PROMPT_MAX_LENGTH,
	baseHalfModelFileExtension,
	BaseHalfModelKind,
	BaseHalfVideoModeId,
	BaseHalfVideoOutputFormat,
	BaseHalfVideoParams,
	BaseHalfVideoParamValue,
	IBaseHalfVideoCatalogModel,
	IBaseHalfVideoGenerationChoice
} from './basehalfVideoCatalog.js';

/**
 * The generation information of a card (D63, generation cards): what its next
 * generation uses (`generation.yaml`), the record of the generation that made
 * its file (`made.yaml`), and the task record this computer keeps while a
 * generation runs (`.bh/cache/generation/<task id>.json`). Nothing in this
 * module reads or writes files. Readers never fail because of content; the
 * task transitions are pure and keep every field they do not own.
 */

// --- kinds and names -------------------------------------------------------------------------

/** What a generation card makes: an image, a video, or a sound (D64, D78). A card offers the models of its kind. */
export type BaseHalfGenerationKind = BaseHalfModelKind;

/**
 * The extensions a card of each kind may have, lower case, without the dot.
 * A sound's are those BaseHalf lands a generated sound under and plays.
 */
export const BASEHALF_GENERATION_EXTENSIONS: Readonly<Record<BaseHalfGenerationKind, readonly string[]>> = Object.freeze({
	image: Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']),
	video: Object.freeze(['mp4', 'mov', 'm4v', 'webm']),
	audio: Object.freeze(['mp3', 'wav', 'flac', 'm4a', 'ogg'])
});

/** The kinds of generation cards, in the order the canvas offers them. */
export const BASEHALF_GENERATION_KINDS: readonly BaseHalfGenerationKind[] = BASEHALF_MODEL_KINDS;

/** The card information file that holds what the next generation uses. */
export const BASEHALF_GENERATION_INFO_FILE = 'generation.yaml';
/** The card information file that records what made the card's file. */
export const BASEHALF_GENERATION_MADE_FILE = 'made.yaml';
/** The folder under `.bh/cache/` that holds the task records of this computer. */
export const BASEHALF_GENERATION_TASK_FOLDER = 'generation';

export const BASEHALF_GENERATION_PROMPT_MAX_LENGTH = 64 * 1024;
/** The whole prompt as sent, text inputs included, as a task record keeps it. */
export const BASEHALF_GENERATION_SENT_PROMPT_MAX_LENGTH = BASEHALF_VIDEO_SENT_PROMPT_MAX_LENGTH;
export const BASEHALF_GENERATION_ERROR_MAX_LENGTH = 4 * 1024;
export const BASEHALF_GENERATION_MAX_INPUTS = 64;
/** The most cards one generation lands on. */
export const BASEHALF_GENERATION_MAX_OUTPUTS = 16;
/** `generation.yaml` and `made.yaml` are at most this large. */
export const BASEHALF_GENERATION_FILE_MAX_BYTES = 256 * 1024;

/** How often the window that follows a generation says it is alive. */
export const BASEHALF_GENERATION_HEARTBEAT_MS = 30_000;
/** After how long without a heartbeat another window takes a generation over. */
export const BASEHALF_GENERATION_STALE_MS = 90_000;

const MAX_ID_LENGTH = 128;
const MAX_PROVIDER_MODEL_LENGTH = 256;
const MAX_PATH_LENGTH = 1024;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_PARAMS = 64;
const MAX_PARAM_TEXT_LENGTH = 16 * 1024;
const PARAM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** The extension of a path, lower case and without the dot, or `undefined`. */
export function baseHalfGenerationExtension(path: string): string | undefined {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : undefined;
}

/** The kind of a generation card at `path`, from its extension; `undefined` when it has no generation extension. */
export function baseHalfGenerationKindOfPath(path: string): BaseHalfGenerationKind | undefined {
	const extension = baseHalfGenerationExtension(path);
	return extension ? BASEHALF_GENERATION_KINDS.find(kind => BASEHALF_GENERATION_EXTENSIONS[kind].includes(extension)) : undefined;
}

/** The name a new draft of the kind starts from, before its extension and number: `image`, `video`, or `audio`. */
export function baseHalfGenerationDefaultBaseName(kind: BaseHalfGenerationKind): string {
	return kind;
}

/**
 * The extension of a new draft of a kind (generation cards, "Creating a
 * generation card"): its model's format when the model is of the card's kind,
 * and otherwise `png` for an image, `mp4` for a video, and `mp3` for a sound.
 */
export function baseHalfGenerationDraftExtension(kind: BaseHalfGenerationKind, model?: IBaseHalfVideoCatalogModel): string {
	if (model?.kind === kind) {
		return baseHalfModelFileExtension(model);
	}
	return kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3';
}

/**
 * The extension a draft at `path` of a kind is renamed to when the user
 * chooses `model` (generation cards, "A draft's extension follows its
 * model"): the extension of the format an image or an audio model declares,
 * when the draft's name does not end with it already; `undefined` when the
 * draft keeps its name, as for a video, a model of another kind, or a name
 * that names the format already.
 */
export function baseHalfGenerationDraftRenameExtension(path: string, kind: BaseHalfGenerationKind, model: IBaseHalfVideoCatalogModel): string | undefined {
	if (kind === 'video' || model.kind !== kind || !model.outputFormat || baseHalfGenerationExtensionMatchesFormat(path, model.outputFormat)) {
		return undefined;
	}
	return baseHalfModelFileExtension(model);
}

/**
 * Why a draft cannot take a name: a draft keeps its kind, so its name ends
 * with an extension of that kind (generation cards, "Moving, renaming,
 * copying, and undo").
 */
export function baseHalfGenerationDraftNameRule(kind: BaseHalfGenerationKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.generation.name.imageDraft', "An image card needs a name that ends in .png, .jpg, .jpeg, .webp, .gif, .avif, or .bmp.");
		case 'video': return localize('basehalf.generation.name.videoDraft', "A video card needs a name that ends in .mp4, .mov, .m4v, or .webm.");
		case 'audio': return localize('basehalf.generation.name.audioDraft', "An audio card needs a name that ends in .mp3, .wav, .flac, .m4a, or .ogg.");
	}
}

/**
 * Splits a file name into the base it is numbered from and its extension, the
 * way the canvas numbers what it creates: `shot-3.mp4` is `shot` and `mp4`, so
 * that generating again from `shot-3.mp4` makes the next free `shot-N.mp4`.
 */
export function baseHalfGenerationNameParts(name: string): { readonly base: string; readonly extension: string } {
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot + 1) : '';
	const numbered = /^(.+)-(\d+)$/.exec(stem);
	return { base: numbered ? numbered[1] : stem, extension };
}

/** The number a name carries after its base: `shot-3.mp4` is 3, and `shot.mp4` is 1. */
export function baseHalfGenerationNameOrdinal(name: string): number {
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const numbered = /^(.+)-(\d+)$/.exec(stem);
	return numbered ? Number(numbered[2]) : 1;
}

/** The `ordinal`-th candidate name: `base.ext`, then `base-2.ext`, `base-3.ext`, and so on. */
export function baseHalfGenerationCandidateName(base: string, extension: string, ordinal: number): string {
	const suffix = ordinal <= 1 ? '' : `-${ordinal}`;
	return extension ? `${base}${suffix}.${extension}` : `${base}${suffix}`;
}

/**
 * The first candidate name, from `startOrdinal` on, that `isTaken` does not
 * report as taken. Names are compared as the caller's `isTaken` compares them
 * (a draft's path counts as taken, generation cards). `undefined` after
 * `limit` candidates.
 */
export function baseHalfGenerationNextFreeName(base: string, extension: string, isTaken: (name: string) => boolean, startOrdinal = 1, limit = 1000): string | undefined {
	for (let ordinal = startOrdinal; ordinal < startOrdinal + limit; ordinal++) {
		const candidate = baseHalfGenerationCandidateName(base, extension, ordinal);
		if (!isTaken(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

/** Replaces the extension of the last segment of `path`. */
export function baseHalfGenerationWithExtension(path: string, extension: string): string {
	const slash = path.lastIndexOf('/');
	const name = path.slice(slash + 1);
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	return `${path.slice(0, slash + 1)}${stem}.${extension}`;
}

// --- generated files -------------------------------------------------------------------------

/** The largest file a generation of each kind lands (generation cards, "Landing"). */
export const BASEHALF_GENERATION_MAX_FILE_BYTES: Readonly<Record<BaseHalfGenerationKind, number>> = Object.freeze({
	image: 64 * 1024 * 1024,
	video: 512 * 1024 * 1024,
	audio: 256 * 1024 * 1024
});

/** The formats a generated file of each kind may have. */
const LANDING_FORMATS: Readonly<Record<BaseHalfGenerationKind, readonly BaseHalfVideoOutputFormat[]>> = Object.freeze({
	image: Object.freeze(['png', 'jpeg', 'webp'] as const),
	video: Object.freeze(['mp4'] as const),
	audio: Object.freeze(['mp3', 'wav', 'flac', 'ogg', 'm4a'] as const)
});

/** The extension a generated file of a format takes: `png`, `jpg`, `webp`, `mp4`, `mp3`, `wav`, `flac`, `ogg`, or `m4a`. */
export function baseHalfGenerationFormatExtension(format: BaseHalfVideoOutputFormat): string {
	return format === 'jpeg' ? 'jpg' : format;
}

/** Whether a card's extension already names a format, as `image.jpeg` names JPEG. */
export function baseHalfGenerationExtensionMatchesFormat(path: string, format: BaseHalfVideoOutputFormat): boolean {
	const extension = baseHalfGenerationExtension(path);
	return format === 'jpeg' ? extension === 'jpg' || extension === 'jpeg' : extension === format;
}

/**
 * The format the first bytes of a file start like (providers, "Requests"): a
 * PNG, a JPEG, or a WebP; an ISO media file with its `ftyp` box first, which
 * is an MP4 and, on an audio card, an M4A; an MP3, with an ID3 tag or an MPEG
 * audio frame first; a WAV, a FLAC, or an Ogg; `undefined` otherwise.
 */
export function baseHalfGenerationFileFormat(head: Uint8Array, kind?: BaseHalfGenerationKind): BaseHalfVideoOutputFormat | undefined {
	const ascii = (start: number, end: number) => head.length >= end ? String.fromCharCode(...head.subarray(start, end)) : '';
	if (head.length >= 8 && head[0] === 0x89 && ascii(1, 4) === 'PNG' && head[4] === 0x0D && head[5] === 0x0A && head[6] === 0x1A && head[7] === 0x0A) {
		return 'png';
	}
	if (head.length >= 3 && head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) {
		return 'jpeg';
	}
	if (ascii(0, 4) === 'RIFF') {
		return ascii(8, 12) === 'WEBP' ? 'webp' : ascii(8, 12) === 'WAVE' ? 'wav' : undefined;
	}
	if (ascii(4, 8) === 'ftyp') {
		return kind === 'audio' ? 'm4a' : 'mp4';
	}
	if (ascii(0, 4) === 'fLaC') {
		return 'flac';
	}
	if (ascii(0, 4) === 'OggS') {
		return 'ogg';
	}
	// An MP3 starts with its ID3 tag, or with the sync of an MPEG audio frame whose layer is set: an AAC stream's is not.
	if (ascii(0, 3) === 'ID3' || (head.length >= 2 && head[0] === 0xFF && (head[1] & 0xE0) === 0xE0 && (head[1] & 0x06) !== 0)) {
		return 'mp3';
	}
	return undefined;
}

/**
 * Whether a file of a format and size may land on a card of a kind: a video
 * is an MP4 of at most 512 MiB, an image a PNG, JPEG, or WebP of at most
 * 64 MiB, and a sound an MP3, WAV, FLAC, Ogg, or M4A of at most 256 MiB.
 */
export function isBaseHalfGenerationFileAccepted(kind: BaseHalfGenerationKind, format: BaseHalfVideoOutputFormat | undefined, size: number): boolean {
	return format !== undefined && LANDING_FORMATS[kind].includes(format) && size > 0 && size <= BASEHALF_GENERATION_MAX_FILE_BYTES[kind];
}

// --- generation.yaml -------------------------------------------------------------------------

/** What the next generation of a card uses. Without `model`, none is chosen. */
export interface IBaseHalfGenerationInfo extends IBaseHalfVideoGenerationChoice {
	readonly prompt: string;
}

/** How each value of `params` is read, by the type the model's parameter declares. */
export type BaseHalfGenerationParamType = 'string' | 'number' | 'boolean';

export interface IBaseHalfGenerationInfoRead {
	/** What could be read; an empty prompt and no settings when nothing could. */
	readonly info: IBaseHalfGenerationInfo;
	/**
	 * `false` when the bytes are not YAML at all, such as a file with the
	 * markers of a git conflict. A save then keeps a recovery copy first.
	 */
	readonly readable: boolean;
	/** The fields that had the wrong shape and read as absent. */
	readonly ignored: readonly string[];
}

const EMPTY_INFO: IBaseHalfGenerationInfo = Object.freeze({ prompt: '' });

/**
 * Reads `generation.yaml` field by field: a field with the wrong shape reads as
 * absent and the others are used. `paramType` gives the declared type of a
 * parameter when the catalog knows it; otherwise a plain `true` or `false` is a
 * boolean, a plain decimal number is a number, and anything else is a string.
 */
export function parseBaseHalfGenerationInfo(text: string, paramType?: (name: string) => BaseHalfGenerationParamType | undefined): IBaseHalfGenerationInfoRead {
	let root: YamlMapNode | null;
	try {
		const document = baseHalfParseMirrorYaml(text, 'generation.yaml');
		if (document.unparsed !== undefined) {
			return { info: EMPTY_INFO, readable: false, ignored: [] };
		}
		root = document.root;
	} catch (error) {
		if (error instanceof BaseHalfMirrorYamlUnreadable) {
			return { info: EMPTY_INFO, readable: false, ignored: [] };
		}
		throw error;
	}
	if (!root) {
		return { info: EMPTY_INFO, readable: true, ignored: [] };
	}
	const ignored: string[] = [];
	const read = <T>(key: string, reader: (node: YamlNode) => T | undefined): T | undefined => {
		const node = baseHalfMirrorYamlProperty(root!, key);
		if (baseHalfMirrorYamlAbsent(node)) {
			return undefined;
		}
		const value = reader(node!);
		if (value === undefined) {
			ignored.push(key);
		}
		return value;
	};
	const prompt = read('prompt', node => {
		const value = baseHalfMirrorYamlString(node);
		return value !== undefined && value.length <= BASEHALF_GENERATION_PROMPT_MAX_LENGTH && !value.includes('\u0000') ? value : undefined;
	}) ?? '';
	const provider = read('provider', node => readId(baseHalfMirrorYamlString(node)));
	const model = read('model', node => readId(baseHalfMirrorYamlString(node)));
	const mode = read('mode', node => {
		const value = baseHalfMirrorYamlString(node);
		return BASEHALF_VIDEO_MODE_IDS.includes(value as BaseHalfVideoModeId) ? value as BaseHalfVideoModeId : undefined;
	});
	const params = read('params', node => readParams(node, paramType, ignored));
	return {
		info: Object.freeze({
			prompt,
			...(provider !== undefined ? { provider } : {}),
			...(model !== undefined ? { model } : {}),
			...(mode !== undefined ? { mode } : {}),
			...(params !== undefined ? { params } : {})
		}),
		readable: true,
		ignored: Object.freeze(ignored)
	};
}

/** Writes `generation.yaml`: strings in double quotes, numbers and booleans plain. */
export function serializeBaseHalfGenerationInfo(info: IBaseHalfGenerationInfo): string {
	const value = normalizeBaseHalfGenerationInfo(info);
	const lines = [`prompt: ${baseHalfMirrorYamlQuote(value.prompt)}`];
	if (value.provider !== undefined) {
		lines.push(`provider: ${baseHalfMirrorYamlQuote(value.provider)}`);
	}
	if (value.model !== undefined) {
		lines.push(`model: ${baseHalfMirrorYamlQuote(value.model)}`);
	}
	if (value.mode !== undefined) {
		lines.push(`mode: ${baseHalfMirrorYamlQuote(value.mode)}`);
	}
	if (value.params && Object.keys(value.params).length) {
		lines.push('params:', ...serializeParams(value.params, '  '));
	}
	return `${lines.join('\n')}\n`;
}

/** Validates generation information. Throws a {@link BaseHalfGenerationInfoError} with the field. */
export function normalizeBaseHalfGenerationInfo(value: IBaseHalfGenerationInfo): IBaseHalfGenerationInfo {
	const prompt = promptText(value.prompt, 'prompt', BASEHALF_GENERATION_PROMPT_MAX_LENGTH);
	const provider = value.provider === undefined ? undefined : id(value.provider, 'provider');
	const model = value.model === undefined ? undefined : id(value.model, 'model');
	const mode = value.mode === undefined ? undefined : modeId(value.mode, 'mode');
	const params = value.params === undefined ? undefined : paramValues(value.params, 'params');
	return Object.freeze({
		prompt,
		...(provider !== undefined ? { provider } : {}),
		...(model !== undefined ? { model } : {}),
		...(mode !== undefined ? { mode } : {}),
		...(params !== undefined ? { params } : {})
	});
}

/** The choice of provider, model, mode, and values that generation information holds. */
export function baseHalfGenerationChoice(info: IBaseHalfGenerationInfo): IBaseHalfVideoGenerationChoice {
	return Object.freeze({
		...(info.provider !== undefined ? { provider: info.provider } : {}),
		...(info.model !== undefined ? { model: info.model } : {}),
		...(info.mode !== undefined ? { mode: info.mode } : {}),
		...(info.params !== undefined ? { params: info.params } : {})
	});
}

/** Replaces the prompt. Allowed whether or not the card has its file. */
export function setBaseHalfGenerationPrompt(info: IBaseHalfGenerationInfo, prompt: string): IBaseHalfGenerationInfo {
	const next = promptText(prompt, 'prompt', BASEHALF_GENERATION_PROMPT_MAX_LENGTH);
	return info.prompt === next ? info : Object.freeze({ ...info, prompt: next });
}

/** Replaces the provider, model, mode, and values, keeping the prompt. */
export function setBaseHalfGenerationChoice(info: IBaseHalfGenerationInfo, choice: IBaseHalfVideoGenerationChoice): IBaseHalfGenerationInfo {
	return normalizeBaseHalfGenerationInfo({ prompt: info.prompt, ...choice });
}

/** The fields of `generation.yaml`, in the order BaseHalf writes them. */
export const BASEHALF_GENERATION_INFO_FIELDS = Object.freeze(['prompt', 'provider', 'model', 'mode', 'params'] as const);

export type BaseHalfGenerationInfoField = typeof BASEHALF_GENERATION_INFO_FIELDS[number];

/** Whether two values of a field are the same. No values and empty values are the same. */
export function baseHalfGenerationInfoFieldEquals(field: BaseHalfGenerationInfoField, left: IBaseHalfGenerationInfo, right: IBaseHalfGenerationInfo): boolean {
	if (field !== 'params') {
		return left[field] === right[field];
	}
	const a = left.params ?? {};
	const b = right.params ?? {};
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
}

/** The fields whose values differ between two readings of generation information. */
export function baseHalfGenerationInfoChangedFields(before: IBaseHalfGenerationInfo, after: IBaseHalfGenerationInfo): readonly BaseHalfGenerationInfoField[] {
	return BASEHALF_GENERATION_INFO_FIELDS.filter(field => !baseHalfGenerationInfoFieldEquals(field, before, after));
}

/**
 * The text of `generation.yaml` with the fields that differ between `before`
 * and `after` written into `text`, and every other byte kept: a field that is
 * there is replaced where it stands, a new one is added after the last field,
 * and a removed one goes with its lines (generation cards, "Writing"). So a
 * value an agent wrote meanwhile, a comment, and a field BaseHalf does not
 * know all stay. Text that is not one block mapping of YAML, and no text,
 * is written whole. The result passes the write check of the value grammar:
 * it reads back with the values of `after` in every field it wrote, or this
 * throws a {@link BaseHalfGenerationInfoError} and nothing may be written.
 */
export function writeBaseHalfGenerationInfoFields(text: string | undefined, before: IBaseHalfGenerationInfo, after: IBaseHalfGenerationInfo): string {
	const next = normalizeBaseHalfGenerationInfo(after);
	const fields = baseHalfGenerationInfoChangedFields(before, next);
	const written = text === undefined ? serializeBaseHalfGenerationInfo(next) : fields.length ? patchFields(text, next, fields) : text;
	const check = parseBaseHalfGenerationInfo(written);
	const wrong = check.readable ? (text === undefined ? BASEHALF_GENERATION_INFO_FIELDS : fields).find(field => !baseHalfGenerationInfoFieldEquals(field, check.info, next)) : 'prompt';
	if (wrong !== undefined) {
		throw error(`The write check of generation.yaml failed for ${wrong}.`);
	}
	return written;
}

function patchFields(text: string, next: IBaseHalfGenerationInfo, fields: readonly BaseHalfGenerationInfoField[]): string {
	let root: YamlMapNode | null;
	try {
		const document = baseHalfParseMirrorYaml(text, 'generation.yaml');
		if (document.unparsed !== undefined) {
			return serializeBaseHalfGenerationInfo(next);
		}
		root = document.root;
	} catch (caught) {
		if (caught instanceof BaseHalfMirrorYamlUnreadable) {
			return serializeBaseHalfGenerationInfo(next);
		}
		throw caught;
	}
	if (root && root.style !== 'block') {
		return serializeBaseHalfGenerationInfo(next);
	}
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const edits: { readonly start: number; readonly end: number; readonly text: string }[] = [];
	const added: string[] = [];
	for (const field of fields) {
		const lines = fieldLines(field, next);
		const property = root ? lastProperty(root, field) : undefined;
		if (property) {
			edits.push({ start: lineStart(text, property.key.startOffset), end: lineEndAfter(text, property.value.endOffset), text: lines.map(line => `${line}${eol}`).join('') });
		} else if (lines.length) {
			added.push(...lines);
		}
	}
	if (added.length) {
		const last = root?.properties.at(-1);
		const at = last ? lineEndAfter(text, last.value.endOffset) : text.length;
		const before = at > 0 && text.charAt(at - 1) !== '\n' ? eol : '';
		edits.push({ start: at, end: at, text: `${before}${added.map(line => `${line}${eol}`).join('')}` });
	}
	let result = text;
	for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
		result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
	}
	return result;
}

/** The lines of one field as BaseHalf writes it; none when it has no value. */
function fieldLines(field: BaseHalfGenerationInfoField, info: IBaseHalfGenerationInfo): string[] {
	if (field === 'params') {
		return info.params && Object.keys(info.params).length ? ['params:', ...serializeParams(info.params, '  ')] : [];
	}
	const value = info[field];
	return value === undefined ? [] : [`${field}: ${baseHalfMirrorYamlQuote(value)}`];
}

function lastProperty(map: YamlMapNode, key: string): YamlMapNode['properties'][number] | undefined {
	let found: YamlMapNode['properties'][number] | undefined;
	for (const property of map.properties) {
		if (property.key.value === key) {
			found = property;
		}
	}
	return found;
}

function lineStart(text: string, offset: number): number {
	return text.lastIndexOf('\n', offset - 1) + 1;
}

/** The offset after the line break that ends the line of `offset`, a value that ends with its line break included. */
function lineEndAfter(text: string, offset: number): number {
	let end = Math.min(offset, text.length);
	while (end > 0 && (text.charAt(end - 1) === '\n' || text.charAt(end - 1) === '\r')) {
		end--;
	}
	const newline = text.indexOf('\n', end);
	return newline < 0 ? text.length : newline + 1;
}

// --- made.yaml -------------------------------------------------------------------------------

/** What one generation sent to the provider. */
export interface IBaseHalfGenerationRequest {
	readonly provider: string;
	/** The provider's region the request went to. */
	readonly region: string;
	readonly model: string;
	/** The id sent to the provider in that region. */
	readonly providerModel: string;
	readonly mode: BaseHalfVideoModeId;
	/** Every parameter that applied, with its value or default; optional ones only when set. */
	readonly params: BaseHalfVideoParams;
	/** The card's own prompt as sent. The text of text inputs is not part of it. */
	readonly prompt: string;
	/** The upstream entries the generation used, text inputs among them, in the order they were listed. */
	readonly inputs: readonly string[];
}

/** The record of the generation that made a card's file, in `made.yaml`. */
export interface IBaseHalfGenerationMade extends IBaseHalfGenerationRequest {
	/** Unique to this file: the task id, with `-<n>` for the n-th image or song of several. */
	readonly id: string;
	readonly startedAt: string;
	readonly finishedAt: string;
	/** The provider's task id, when it gave one. */
	readonly remoteId?: string;
	/** Which image or song of how many, for a generation that made several. */
	readonly output?: number;
	readonly outputs?: number;
	/** The `id` of the record of the file this one is a copy of. */
	readonly copyOf?: string;
}

const MADE_STRING_FIELDS = ['id', 'startedAt', 'finishedAt', 'remoteId', 'provider', 'region', 'model', 'providerModel', 'mode', 'prompt', 'copyOf'] as const;

/** Reads `made.yaml`. `undefined` when it cannot be read as a whole record; it is then left as it is. */
export function parseBaseHalfGenerationMade(text: string): IBaseHalfGenerationMade | undefined {
	let root: YamlMapNode | null;
	try {
		const document = baseHalfParseMirrorYaml(text, 'made.yaml');
		if (document.unparsed !== undefined) {
			return undefined;
		}
		root = document.root;
	} catch (error) {
		if (error instanceof BaseHalfMirrorYamlUnreadable) {
			return undefined;
		}
		throw error;
	}
	if (!root) {
		return undefined;
	}
	const strings: Record<string, string | undefined> = {};
	for (const key of MADE_STRING_FIELDS) {
		strings[key] = baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(root, key));
	}
	const inputs = baseHalfMirrorYamlItems(baseHalfMirrorYamlProperty(root, 'inputs'))?.map(item => baseHalfMirrorYamlString(item));
	const paramsNode = baseHalfMirrorYamlProperty(root, 'params');
	const params = baseHalfMirrorYamlAbsent(paramsNode) ? {} : readParams(paramsNode!, undefined, []);
	const output = baseHalfMirrorYamlNumber(baseHalfMirrorYamlProperty(root, 'output'));
	const outputs = baseHalfMirrorYamlNumber(baseHalfMirrorYamlProperty(root, 'outputs'));
	if (!inputs || inputs.some(input => input === undefined) || !params) {
		return undefined;
	}
	try {
		return normalizeBaseHalfGenerationMade({
			id: strings.id!,
			startedAt: strings.startedAt!,
			finishedAt: strings.finishedAt!,
			...(strings.remoteId !== undefined ? { remoteId: strings.remoteId } : {}),
			provider: strings.provider!,
			region: strings.region!,
			model: strings.model!,
			providerModel: strings.providerModel!,
			mode: strings.mode as BaseHalfVideoModeId,
			params,
			prompt: strings.prompt ?? '',
			inputs: inputs as string[],
			...(output !== undefined ? { output } : {}),
			...(outputs !== undefined ? { outputs } : {}),
			...(strings.copyOf !== undefined ? { copyOf: strings.copyOf } : {})
		});
	} catch (error) {
		if (error instanceof BaseHalfGenerationInfoError) {
			return undefined;
		}
		throw error;
	}
}

/** Writes `made.yaml`. */
export function serializeBaseHalfGenerationMade(value: IBaseHalfGenerationMade): string {
	const made = normalizeBaseHalfGenerationMade(value);
	const lines = [
		`id: ${baseHalfMirrorYamlQuote(made.id)}`,
		...(made.copyOf !== undefined ? [`copyOf: ${baseHalfMirrorYamlQuote(made.copyOf)}`] : []),
		`startedAt: ${baseHalfMirrorYamlQuote(made.startedAt)}`,
		`finishedAt: ${baseHalfMirrorYamlQuote(made.finishedAt)}`,
		...(made.remoteId !== undefined ? [`remoteId: ${baseHalfMirrorYamlQuote(made.remoteId)}`] : []),
		...(made.output !== undefined ? [`output: ${made.output}`, `outputs: ${made.outputs}`] : []),
		`provider: ${baseHalfMirrorYamlQuote(made.provider)}`,
		`region: ${baseHalfMirrorYamlQuote(made.region)}`,
		`model: ${baseHalfMirrorYamlQuote(made.model)}`,
		`providerModel: ${baseHalfMirrorYamlQuote(made.providerModel)}`,
		`mode: ${baseHalfMirrorYamlQuote(made.mode)}`
	];
	if (Object.keys(made.params).length) {
		lines.push('params:', ...serializeParams(made.params, '  '));
	} else {
		lines.push('params: {}');
	}
	lines.push(`prompt: ${baseHalfMirrorYamlQuote(made.prompt)}`);
	if (made.inputs.length) {
		lines.push('inputs:', ...made.inputs.map(input => `  - ${baseHalfMirrorYamlQuote(input)}`));
	} else {
		lines.push('inputs: []');
	}
	return `${lines.join('\n')}\n`;
}

/** Validates a record. Throws a {@link BaseHalfGenerationInfoError} with the field. */
export function normalizeBaseHalfGenerationMade(value: IBaseHalfGenerationMade): IBaseHalfGenerationMade {
	const request = normalizeBaseHalfGenerationRequest(value, '');
	const remoteId = value.remoteId === undefined ? undefined : text(value.remoteId, 'remoteId', MAX_PROVIDER_MODEL_LENGTH, false);
	const copyOf = value.copyOf === undefined ? undefined : id(value.copyOf, 'copyOf');
	if ((value.output === undefined) !== (value.outputs === undefined)) {
		throw error('output and outputs are written together.');
	}
	if (value.output !== undefined && value.outputs !== undefined) {
		if (!Number.isInteger(value.outputs) || value.outputs < 2 || value.outputs > BASEHALF_GENERATION_MAX_OUTPUTS || !Number.isInteger(value.output) || value.output < 1 || value.output > value.outputs) {
			throw error('output must be a whole number from 1 to outputs, and outputs from 2 to 16.');
		}
	}
	return Object.freeze({
		id: id(value.id, 'id'),
		...(copyOf !== undefined ? { copyOf } : {}),
		startedAt: timestamp(value.startedAt, 'startedAt'),
		finishedAt: timestamp(value.finishedAt, 'finishedAt'),
		...(remoteId !== undefined ? { remoteId } : {}),
		...(value.output !== undefined ? { output: value.output, outputs: value.outputs } : {}),
		...request
	});
}

/** Validates what a generation sent. Throws a {@link BaseHalfGenerationInfoError} with the field. */
export function normalizeBaseHalfGenerationRequest(value: IBaseHalfGenerationRequest, path = 'request'): IBaseHalfGenerationRequest {
	const at = (field: string) => path ? `${path}.${field}` : field;
	if (!Array.isArray(value.inputs)) {
		throw error(`${at('inputs')} must be a list.`);
	}
	if (value.inputs.length > BASEHALF_GENERATION_MAX_INPUTS) {
		throw error(`${at('inputs')} has more than ${BASEHALF_GENERATION_MAX_INPUTS} entries.`);
	}
	return Object.freeze({
		provider: id(value.provider, at('provider')),
		region: id(value.region, at('region')),
		model: id(value.model, at('model')),
		providerModel: text(value.providerModel, at('providerModel'), MAX_PROVIDER_MODEL_LENGTH, false),
		mode: modeId(value.mode, at('mode')),
		params: paramValues(value.params, at('params')),
		prompt: promptText(value.prompt, at('prompt'), BASEHALF_GENERATION_PROMPT_MAX_LENGTH),
		inputs: Object.freeze(value.inputs.map((input, index) => text(input, `${at('inputs')}[${index}]`, MAX_PATH_LENGTH, false)))
	});
}

/** The record of a copy of a generated file: the same request, a new id, and the id it copies. */
export function baseHalfGenerationMadeCopy(original: IBaseHalfGenerationMade, newId: string): IBaseHalfGenerationMade {
	return normalizeBaseHalfGenerationMade({ ...original, id: newId, copyOf: original.copyOf ?? original.id });
}

/** The parameter a new version leaves out, so that it makes another result (D59's shared name of the seed). */
export const BASEHALF_GENERATION_SEED_PARAM = 'seed';

/**
 * What a new version of a generated file generates (generation cards, "New
 * Version"): the prompt, provider, model, mode, and values that made it,
 * without the seed. The text of its notes is not part of the prompt: the new
 * draft is connected to the same notes, and their text joins its prompt when
 * it generates.
 */
export function baseHalfGenerationInfoOfMade(made: IBaseHalfGenerationMade): IBaseHalfGenerationInfo {
	const params: Record<string, BaseHalfVideoParamValue> = { ...made.params };
	delete params[BASEHALF_GENERATION_SEED_PARAM];
	return normalizeBaseHalfGenerationInfo({ prompt: made.prompt, provider: made.provider, model: made.model, mode: made.mode, params });
}

// --- the task record -------------------------------------------------------------------------

/**
 * `preparing`: the inputs are read and checked; nothing is sent.
 * `submitting`: the request is on its way, or, for a provider that answers at
 * once, waiting for that answer. `running`: the provider has the task.
 * `landing`: the files are being moved into place. `failed` and `stopped`:
 * the generation ended without its files.
 */
export type BaseHalfGenerationTaskState = 'preparing' | 'submitting' | 'running' | 'landing' | 'failed' | 'stopped';

/** What becomes of one card of a generation. */
export type BaseHalfGenerationCardState = 'waiting' | 'landed' | 'failed';

/** The file being moved into place, so that a crash between the move and `made.yaml` finds it again. */
export interface IBaseHalfGenerationLanding {
	/** Workspace-relative path the file is moved to. */
	readonly path: string;
	readonly size: number;
	/** SHA-256 of the file, lower-case hex. */
	readonly sha256: string;
}

/** One card a generation lands on: the card itself, or one per image or song. */
export interface IBaseHalfGenerationTaskCard {
	/** Workspace-relative path of the card. Every move or rename of the card writes its new path here. */
	readonly path: string;
	readonly state: BaseHalfGenerationCardState;
	/** Why this card got no file, when the others did. */
	readonly error?: string;
	readonly landing?: IBaseHalfGenerationLanding;
}

/** What this computer keeps about a generation, in `.bh/cache/generation/<id>.json`. */
export interface IBaseHalfGenerationTask {
	readonly version: 1;
	/** Local identity of the generation; sortable by start time. */
	readonly id: string;
	readonly kind: BaseHalfGenerationKind;
	readonly state: BaseHalfGenerationTaskState;
	readonly startedAt: string;
	readonly endedAt?: string;
	/** The cards the generation lands on, in the order of the provider's outputs. */
	readonly cards: readonly IBaseHalfGenerationTaskCard[];
	/** The window that follows the generation, and when it last said it is alive. */
	readonly follower: string;
	readonly aliveAt: string;
	/** Whether the provider answers the request with the files instead of a task. */
	readonly answersAtOnce?: boolean;
	/** The provider's task id, written as soon as the provider returns it. */
	readonly remoteId?: string;
	/** What was sent, from `submitting` on. */
	readonly request?: IBaseHalfGenerationRequest;
	/** The whole prompt as sent, the text of text inputs included; kept on this computer only. */
	readonly sentPrompt?: string;
	/** Plain text for the cards: why it failed. */
	readonly error?: string;
}

export class BaseHalfGenerationInfoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfGenerationInfoError';
	}
}

export function isBaseHalfGenerationTaskEnded(task: IBaseHalfGenerationTask): boolean {
	return task.state === 'failed' || task.state === 'stopped';
}

/**
 * A new task id, `20261022T080000-1a2b3c4d`: sortable by start time, and
 * unique enough that two windows starting a generation in the same second
 * do not meet. It is the `id` of a `made.yaml` too.
 */
export function createBaseHalfGenerationTaskId(now: number, random: () => string): string {
	const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
	return `${stamp}-${random().replace(/[^0-9a-f]/gi, '').slice(0, 8).toLowerCase()}`;
}

/** Whether no window has said for {@link BASEHALF_GENERATION_STALE_MS} that it follows the task. */
export function isBaseHalfGenerationTaskStale(task: IBaseHalfGenerationTask, now: number): boolean {
	const alive = Date.parse(task.aliveAt);
	return !Number.isFinite(alive) || now - alive >= BASEHALF_GENERATION_STALE_MS;
}

/**
 * How two workspace-relative paths are compared: by the key this returns. On
 * a volume that ignores letter case, `shots/Video.mp4` and `shots/video.mp4`
 * name the same card.
 */
export type BaseHalfGenerationPathKey = (path: string) => string;

const EXACT_PATH: BaseHalfGenerationPathKey = path => path;

/** Whether the task lands on, or landed on, the card at `path`. */
export function baseHalfGenerationTaskNamesCard(task: IBaseHalfGenerationTask, path: string, key: BaseHalfGenerationPathKey = EXACT_PATH): boolean {
	const wanted = key(path);
	return task.cards.some(card => key(card.path) === wanted);
}

/** The index of the card at `path` in the task, or -1. */
export function baseHalfGenerationTaskCardIndex(task: IBaseHalfGenerationTask, path: string, key: BaseHalfGenerationPathKey = EXACT_PATH): number {
	const wanted = key(path);
	return task.cards.findIndex(card => key(card.path) === wanted);
}

/**
 * Of several records that are not ended and name the same card, the one that
 * keeps it: the one that started first, and of two that started at the same
 * moment, the one with the smaller id (generation cards, "Starting", step 5).
 */
export function baseHalfGenerationClaimWinner(tasks: readonly IBaseHalfGenerationTask[]): IBaseHalfGenerationTask | undefined {
	let winner: IBaseHalfGenerationTask | undefined;
	for (const task of tasks) {
		if (isBaseHalfGenerationTaskEnded(task)) {
			continue;
		}
		if (!winner || compareClaims(task, winner) < 0) {
			winner = task;
		}
	}
	return winner;
}

function compareClaims(a: IBaseHalfGenerationTask, b: IBaseHalfGenerationTask): number {
	const started = Date.parse(a.startedAt) - Date.parse(b.startedAt);
	if (started !== 0 && Number.isFinite(started)) {
		return started;
	}
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface ICreateBaseHalfGenerationTaskOptions {
	readonly id: string;
	readonly kind: BaseHalfGenerationKind;
	/** The paths of the cards, in the order of the outputs. */
	readonly cards: readonly string[];
	readonly follower: string;
	readonly now: string;
}

/** A new record in `preparing`, which claims its cards. */
export function createBaseHalfGenerationTask(options: ICreateBaseHalfGenerationTaskOptions): IBaseHalfGenerationTask {
	if (!options.cards.length || options.cards.length > BASEHALF_GENERATION_MAX_OUTPUTS) {
		throw error(`A generation lands on 1 to ${BASEHALF_GENERATION_MAX_OUTPUTS} cards.`);
	}
	return normalizeBaseHalfGenerationTask({
		version: 1,
		id: options.id,
		kind: options.kind,
		state: 'preparing',
		startedAt: options.now,
		cards: options.cards.map(path => ({ path, state: 'waiting' })),
		follower: options.follower,
		aliveAt: options.now
	});
}

/** Records what is sent. The task becomes `submitting`. */
export function submitBaseHalfGenerationTask(task: IBaseHalfGenerationTask, request: IBaseHalfGenerationRequest, sentPrompt: string, answersAtOnce: boolean): IBaseHalfGenerationTask {
	expectState(task, ['preparing']);
	return normalizeBaseHalfGenerationTask({ ...task, state: 'submitting', request, sentPrompt, answersAtOnce });
}

/** Records the provider's task id. The task becomes `running`. */
export function runBaseHalfGenerationTask(task: IBaseHalfGenerationTask, remoteId: string): IBaseHalfGenerationTask {
	expectState(task, ['submitting']);
	return normalizeBaseHalfGenerationTask({ ...task, state: 'running', remoteId });
}

/** The files are there: the task becomes `landing`. */
export function landBaseHalfGenerationTask(task: IBaseHalfGenerationTask): IBaseHalfGenerationTask {
	expectState(task, ['submitting', 'running', 'landing']);
	return task.state === 'landing' ? task : normalizeBaseHalfGenerationTask({ ...task, state: 'landing' });
}

/** Records the file about to be moved onto the card at `index`. */
export function recordBaseHalfGenerationLanding(task: IBaseHalfGenerationTask, index: number, landing: IBaseHalfGenerationLanding): IBaseHalfGenerationTask {
	expectState(task, ['landing']);
	return withCard(task, index, card => ({ ...card, landing }));
}

/**
 * Takes up a generation that another window ended as failed when it took
 * the record over, after this window got the provider's answer all the same
 * (generation cards, "Continuing after a reload or a restart"): the files are
 * in hand, so the task is `landing`; or the provider has the task, so it is
 * `running` again. The cards that the failure ended wait again; a card that
 * landed, or that failed on its own, stays as it is. This window follows it.
 */
export function reviveBaseHalfGenerationTask(task: IBaseHalfGenerationTask, follower: string, now: string, next: { readonly state: 'landing' } | { readonly state: 'running'; readonly remoteId: string }): IBaseHalfGenerationTask {
	expectState(task, ['failed']);
	const { endedAt: _endedAt, error: failure, ...rest } = task;
	return normalizeBaseHalfGenerationTask({
		...rest,
		state: next.state,
		...(next.state === 'running' ? { remoteId: next.remoteId } : {}),
		follower,
		aliveAt: now,
		cards: task.cards.map(card => card.state === 'failed' && card.error === failure ? { path: card.path, state: 'waiting' as const } : card)
	});
}

/** The file of the card at `index` is in place and its record written. */
export function recordBaseHalfGenerationLanded(task: IBaseHalfGenerationTask, index: number): IBaseHalfGenerationTask {
	expectState(task, ['landing']);
	return withCard(task, index, card => ({ path: card.path, state: 'landed' }));
}

/** The card at `index` gets no file, while the others may. */
export function failBaseHalfGenerationCard(task: IBaseHalfGenerationTask, index: number, message: string): IBaseHalfGenerationTask {
	return withCard(task, index, card => ({ path: card.path, state: 'failed', error: clip(message) }));
}

/** Whether every card of the task has landed or failed. */
export function isBaseHalfGenerationTaskSettled(task: IBaseHalfGenerationTask): boolean {
	return task.cards.every(card => card.state !== 'waiting');
}

/** Ends the generation without its files because something failed. Cards that landed stay landed. */
export function failBaseHalfGenerationTask(task: IBaseHalfGenerationTask, message: string, endedAt: string): IBaseHalfGenerationTask {
	if (isBaseHalfGenerationTaskEnded(task)) {
		return task;
	}
	const reason = clip(message);
	return normalizeBaseHalfGenerationTask({
		...task,
		state: 'failed',
		endedAt,
		error: reason,
		cards: task.cards.map(card => card.state === 'waiting' ? { path: card.path, state: 'failed' as const, error: reason } : card)
	});
}

/** Ends the generation because the user stopped it. A file that arrives later is not kept. */
export function stopBaseHalfGenerationTask(task: IBaseHalfGenerationTask, endedAt: string): IBaseHalfGenerationTask {
	if (isBaseHalfGenerationTaskEnded(task)) {
		return task;
	}
	const { error: _error, ...rest } = task;
	return normalizeBaseHalfGenerationTask({
		...rest,
		state: 'stopped',
		endedAt,
		cards: task.cards.map(card => card.state === 'waiting' ? { path: card.path, state: 'failed' as const } : card)
	});
}

/** The window that follows the task says it is alive, or another window takes the task over. */
export function heartbeatBaseHalfGenerationTask(task: IBaseHalfGenerationTask, follower: string, now: string): IBaseHalfGenerationTask {
	return normalizeBaseHalfGenerationTask({ ...task, follower, aliveAt: now });
}

/**
 * Writes the new path of a card, or of every card below a folder, after a move
 * or a rename: `from` and `to` are workspace-relative paths of the card or of
 * its folder. Unchanged when no card is at or below `from`.
 */
export function retargetBaseHalfGenerationTask(task: IBaseHalfGenerationTask, from: string, to: string, key: BaseHalfGenerationPathKey = EXACT_PATH): IBaseHalfGenerationTask {
	const fromKey = key(from);
	const moved = (path: string) => {
		const pathKey = key(path);
		return pathKey === fromKey ? to : pathKey.startsWith(`${fromKey}/`) ? `${to}${path.slice(from.length)}` : undefined;
	};
	let changed = false;
	const cards = task.cards.map(card => {
		const next = moved(card.path);
		// A file that was moved into place before a crash moves with its card, so a takeover still finds it.
		const landing = card.landing ? moved(card.landing.path) : undefined;
		if (next === undefined && landing === undefined) {
			return card;
		}
		changed = true;
		return { ...card, ...(next !== undefined ? { path: next } : {}), ...(card.landing && landing !== undefined ? { landing: { ...card.landing, path: landing } } : {}) };
	});
	return changed ? normalizeBaseHalfGenerationTask({ ...task, cards }) : task;
}

/** The record of the file landed on the card at `index`. */
export function baseHalfGenerationMadeOfTask(task: IBaseHalfGenerationTask, index: number, finishedAt: string): IBaseHalfGenerationMade {
	if (!task.request) {
		throw error('The generation has no request record.');
	}
	const several = task.cards.length > 1;
	return normalizeBaseHalfGenerationMade({
		id: several ? `${task.id}-${index + 1}` : task.id,
		startedAt: task.startedAt,
		finishedAt,
		...(task.remoteId !== undefined ? { remoteId: task.remoteId } : {}),
		...(several ? { output: index + 1, outputs: task.cards.length } : {}),
		...task.request
	});
}

/** Reads a task record. `undefined` when the bytes are not a valid record. */
export function parseBaseHalfGenerationTask(text: string): IBaseHalfGenerationTask | undefined {
	try {
		return normalizeBaseHalfGenerationTask(JSON.parse(text));
	} catch (caught) {
		if (caught instanceof SyntaxError || caught instanceof BaseHalfGenerationInfoError) {
			return undefined;
		}
		throw caught;
	}
}

export function serializeBaseHalfGenerationTask(task: IBaseHalfGenerationTask): string {
	return `${JSON.stringify(normalizeBaseHalfGenerationTask(task), undefined, '\t')}\n`;
}

/** Validates a task record. Throws a {@link BaseHalfGenerationInfoError} with the field. */
export function normalizeBaseHalfGenerationTask(value: unknown): IBaseHalfGenerationTask {
	const candidate = object(value, 'task', ['version', 'id', 'kind', 'state', 'startedAt', 'endedAt', 'cards', 'follower', 'aliveAt', 'answersAtOnce', 'remoteId', 'request', 'sentPrompt', 'error']);
	if (candidate.version !== 1) {
		throw error('task.version must be 1.');
	}
	const kind = candidate.kind as BaseHalfGenerationKind;
	if (!BASEHALF_GENERATION_KINDS.includes(kind)) {
		throw error('task.kind must be image, video, or audio.');
	}
	const state = candidate.state as BaseHalfGenerationTaskState;
	if (!['preparing', 'submitting', 'running', 'landing', 'failed', 'stopped'].includes(state)) {
		throw error('task.state is not a known state.');
	}
	if (!Array.isArray(candidate.cards) || !candidate.cards.length || candidate.cards.length > BASEHALF_GENERATION_MAX_OUTPUTS) {
		throw error(`task.cards must list 1 to ${BASEHALF_GENERATION_MAX_OUTPUTS} cards.`);
	}
	const cards = candidate.cards.map((card, index) => taskCard(card, `task.cards[${index}]`));
	const ended = state === 'failed' || state === 'stopped';
	const endedAt = candidate.endedAt === undefined ? undefined : timestamp(candidate.endedAt, 'task.endedAt');
	if (ended !== (endedAt !== undefined)) {
		throw error('task.endedAt is written exactly when the task has ended.');
	}
	const remoteId = candidate.remoteId === undefined ? undefined : text(candidate.remoteId, 'task.remoteId', MAX_PROVIDER_MODEL_LENGTH, false);
	if (state === 'running' && remoteId === undefined) {
		throw error('task.remoteId is required while the task is running.');
	}
	const request = candidate.request === undefined ? undefined : normalizeBaseHalfGenerationRequest(candidate.request as IBaseHalfGenerationRequest, 'task.request');
	if ((state === 'submitting' || state === 'running' || state === 'landing') && !request) {
		throw error('task.request is required once the request is sent.');
	}
	const sentPrompt = candidate.sentPrompt === undefined ? undefined : promptText(candidate.sentPrompt, 'task.sentPrompt', BASEHALF_GENERATION_SENT_PROMPT_MAX_LENGTH);
	if (candidate.answersAtOnce !== undefined && typeof candidate.answersAtOnce !== 'boolean') {
		throw error('task.answersAtOnce must be true or false.');
	}
	const message = candidate.error === undefined ? undefined : text(candidate.error, 'task.error', BASEHALF_GENERATION_ERROR_MAX_LENGTH, true);
	return Object.freeze({
		version: 1,
		id: id(candidate.id, 'task.id'),
		kind,
		state,
		startedAt: timestamp(candidate.startedAt, 'task.startedAt'),
		...(endedAt !== undefined ? { endedAt } : {}),
		cards: Object.freeze(cards),
		follower: id(candidate.follower, 'task.follower'),
		aliveAt: timestamp(candidate.aliveAt, 'task.aliveAt'),
		...(candidate.answersAtOnce !== undefined ? { answersAtOnce: candidate.answersAtOnce as boolean } : {}),
		...(remoteId !== undefined ? { remoteId } : {}),
		...(request !== undefined ? { request } : {}),
		...(sentPrompt !== undefined ? { sentPrompt } : {}),
		...(message !== undefined ? { error: message } : {})
	});
}

function taskCard(value: unknown, path: string): IBaseHalfGenerationTaskCard {
	const candidate = object(value, path, ['path', 'state', 'error', 'landing']);
	const state = candidate.state;
	if (state !== 'waiting' && state !== 'landed' && state !== 'failed') {
		throw error(`${path}.state must be waiting, landed, or failed.`);
	}
	const message = candidate.error === undefined ? undefined : text(candidate.error, `${path}.error`, BASEHALF_GENERATION_ERROR_MAX_LENGTH, true);
	let landing: IBaseHalfGenerationLanding | undefined;
	if (candidate.landing !== undefined) {
		const raw = object(candidate.landing, `${path}.landing`, ['path', 'size', 'sha256']);
		if (typeof raw.size !== 'number' || !Number.isInteger(raw.size) || raw.size < 0) {
			throw error(`${path}.landing.size must be a whole number of bytes.`);
		}
		if (typeof raw.sha256 !== 'string' || !SHA256_PATTERN.test(raw.sha256)) {
			throw error(`${path}.landing.sha256 must be a SHA-256 in lower-case hex.`);
		}
		landing = Object.freeze({ path: text(raw.path, `${path}.landing.path`, MAX_PATH_LENGTH, false), size: raw.size, sha256: raw.sha256 });
	}
	return Object.freeze({
		path: text(candidate.path, `${path}.path`, MAX_PATH_LENGTH, false),
		state,
		...(message !== undefined ? { error: message } : {}),
		...(landing !== undefined ? { landing } : {})
	});
}

function withCard(task: IBaseHalfGenerationTask, index: number, change: (card: IBaseHalfGenerationTaskCard) => IBaseHalfGenerationTaskCard): IBaseHalfGenerationTask {
	if (index < 0 || index >= task.cards.length) {
		throw error(`The generation has no card ${index + 1}.`);
	}
	const cards = task.cards.map((card, at) => at === index ? change(card) : card);
	return normalizeBaseHalfGenerationTask({ ...task, cards });
}

function expectState(task: IBaseHalfGenerationTask, states: readonly BaseHalfGenerationTaskState[]): void {
	if (!states.includes(task.state)) {
		throw error(`The generation is ${task.state}, not ${states.join(' or ')}.`);
	}
}

function clip(message: string): string {
	const trimmed = message.trim() || 'The generation failed.';
	return trimmed.length > BASEHALF_GENERATION_ERROR_MAX_LENGTH ? `${trimmed.slice(0, BASEHALF_GENERATION_ERROR_MAX_LENGTH - 1)}…` : trimmed;
}

// --- YAML values -----------------------------------------------------------------------------

function readId(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	try {
		return id(value, '');
	} catch {
		return undefined;
	}
}

/** The values of `params`, each by its declared type; a value that cannot be read is skipped and named in `ignored`. */
function readParams(node: YamlNode, paramType: ((name: string) => BaseHalfGenerationParamType | undefined) | undefined, ignored: string[]): BaseHalfVideoParams | undefined {
	const map = baseHalfMirrorYamlMap(node);
	if (!map) {
		return undefined;
	}
	const params: Record<string, BaseHalfVideoParamValue> = {};
	for (const property of map.properties) {
		const name = property.key.value;
		const value = readParam(property.value, paramType?.(name));
		if (!PARAM_NAME_PATTERN.test(name) || value === undefined || Object.keys(params).length >= MAX_PARAMS) {
			ignored.push(`params.${name}`);
			continue;
		}
		params[name] = value;
	}
	return Object.freeze(params);
}

function readParam(node: YamlNode, type: BaseHalfGenerationParamType | undefined): BaseHalfVideoParamValue | undefined {
	if (node.type !== 'scalar' || baseHalfMirrorYamlAbsent(node)) {
		return undefined;
	}
	switch (type) {
		case 'string': {
			const value = baseHalfMirrorYamlString(node);
			return value !== undefined && value.length <= MAX_PARAM_TEXT_LENGTH && !value.includes('\u0000') ? value : undefined;
		}
		case 'number':
			return baseHalfMirrorYamlNumber(node);
		case 'boolean':
			return baseHalfMirrorYamlBoolean(node);
	}
	// Not declared: a quoted scalar is text; a plain one is read by what it looks like.
	if (node.format === 'none') {
		const boolean = baseHalfMirrorYamlBoolean(node);
		if (boolean !== undefined) {
			return boolean;
		}
		const number = baseHalfMirrorYamlNumber(node);
		if (number !== undefined) {
			return number;
		}
	}
	const value = baseHalfMirrorYamlString(node);
	return value !== undefined && value.length <= MAX_PARAM_TEXT_LENGTH && !value.includes('\u0000') ? value : undefined;
}

function serializeParams(params: BaseHalfVideoParams, indent: string): string[] {
	return Object.keys(params).sort().map(name => {
		const value = params[name];
		return `${indent}${name}: ${typeof value === 'string' ? baseHalfMirrorYamlQuote(value) : String(value)}`;
	});
}

// --- field checks ----------------------------------------------------------------------------

function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw error(`${path} must be an object.`);
	}
	const candidate = value as Record<string, unknown>;
	for (const key of Object.keys(candidate)) {
		if (!keys.includes(key)) {
			throw error(`${path}.${key} is not a known field.`);
		}
	}
	return candidate;
}

function text(value: unknown, path: string, maxLength: number, allowLineBreaks: boolean): string {
	if (typeof value !== 'string') {
		throw error(`${path} must be a string.`);
	}
	const trimmed = value.trim();
	if (!trimmed) {
		throw error(`${path} cannot be empty.`);
	}
	if (trimmed.length > maxLength) {
		throw error(`${path} is longer than ${maxLength} characters.`);
	}
	if ((allowLineBreaks ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/ : /[\u0000-\u001F]/).test(trimmed)) {
		throw error(`${path} contains control characters.`);
	}
	return trimmed;
}

function promptText(value: unknown, path: string, maxLength: number): string {
	if (typeof value !== 'string') {
		throw error(`${path} must be a string.`);
	}
	if (value.length > maxLength) {
		throw error(`${path} is longer than ${maxLength} characters.`);
	}
	if (value.includes('\u0000')) {
		throw error(`${path} cannot contain NUL.`);
	}
	return value;
}

function id(value: unknown, path: string): string {
	const result = text(value, path, MAX_ID_LENGTH, false);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
		throw error(`${path} contains unsupported characters.`);
	}
	return result;
}

function modeId(value: unknown, path: string): BaseHalfVideoModeId {
	if (!BASEHALF_VIDEO_MODE_IDS.includes(value as BaseHalfVideoModeId)) {
		throw error(`${path} must be one of ${BASEHALF_VIDEO_MODE_IDS.join(', ')}.`);
	}
	return value as BaseHalfVideoModeId;
}

function paramValues(value: unknown, path: string): BaseHalfVideoParams {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw error(`${path} must be an object.`);
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length > MAX_PARAMS) {
		throw error(`${path} has more than ${MAX_PARAMS} values.`);
	}
	const params: Record<string, BaseHalfVideoParamValue> = {};
	for (const [name, entry] of entries) {
		if (!PARAM_NAME_PATTERN.test(name)) {
			throw error(`${path}.${name} is not a parameter name.`);
		}
		if (typeof entry === 'string') {
			if (entry.length > MAX_PARAM_TEXT_LENGTH || entry.includes('\u0000')) {
				throw error(`${path}.${name} is longer than ${MAX_PARAM_TEXT_LENGTH} characters or contains NUL.`);
			}
		} else if (typeof entry === 'number') {
			if (!Number.isFinite(entry)) {
				throw error(`${path}.${name} must be a finite number.`);
			}
		} else if (typeof entry !== 'boolean') {
			throw error(`${path}.${name} must be text, a number, or true or false.`);
		}
		params[name] = entry;
	}
	return Object.freeze(params);
}

function timestamp(value: unknown, path: string): string {
	const result = text(value, path, MAX_TIMESTAMP_LENGTH, false);
	if (Number.isNaN(Date.parse(result))) {
		throw error(`${path} must be an ISO date and time.`);
	}
	return result;
}

function error(message: string): BaseHalfGenerationInfoError {
	return new BaseHalfGenerationInfoError(message);
}
