/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { YamlMapNode, YamlNode } from '../../../../base/common/yaml.js';
import { localize } from '../../../../nls.js';
import {
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

/**
 * The edit record of a media file (editing media, "The edit record"): how the
 * file at its path was made from its original, which lies beside the record
 * in the file's card information, and the fingerprint of the file as
 * BaseHalf wrote it.
 */

export const BASEHALF_EDIT_RECORD_FILE = 'edit.yaml';

const ORIGINAL_NAME = /^original\.[A-Za-z0-9]{1,16}$/;
const HASH = /^[0-9a-f]{64}$/;
/** The latest time a part of a sound or a video can end at: a day, in milliseconds. */
const MAX_TIME_MS = 24 * 60 * 60 * 1000;
const MAX_PARTS = 10_000;
/** The largest angle a picture is straightened by, either way. */
export const BASEHALF_EDIT_MAX_STRAIGHTEN = 45;

export type BaseHalfMediaKind = 'video' | 'image' | 'sound';

/** A part of the original kept, in seconds of the original. */
export interface IBaseHalfMediaPart {
	readonly start: number;
	readonly end: number;
}

/** The part of a picture kept: its center and its size, in pixels of the original as it was turned and flipped. */
export interface IBaseHalfImageCrop {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** What an editor sets; a field at its default value is left out. */
export interface IBaseHalfMediaChoices {
	/** The parts of the original that the file holds, in order: one for a video, one or more for a sound. */
	readonly keep?: readonly IBaseHalfMediaPart[];
	/** Quarter turns to the left. */
	readonly turn?: 1 | 2 | 3;
	/** Mirrored left to right, after the turn. */
	readonly flip?: boolean;
	/** Degrees, clockwise when positive, after the turn and the flip. */
	readonly straighten?: number;
	readonly crop?: IBaseHalfImageCrop;
}

/** The fingerprint of the edited file as BaseHalf wrote it, as following moved items takes one. */
export interface IBaseHalfEditResult {
	readonly size: number;
	readonly hash: string;
}

export interface IBaseHalfEditRecord extends IBaseHalfMediaChoices {
	/** The name of the original, in the same folder of card information. */
	readonly original: string;
	readonly result: IBaseHalfEditResult;
}

export class BaseHalfEditRecordError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfEditRecordError';
	}
}

/**
 * What an edit did, as the panel of a generated card and Card Detail say it
 * (editing media, "Generation cards"): `Trimmed to 1.0s–4.5s`, `Trimmed to 3
 * parts`, `Cropped to 1600 × 900`, and the rest of what it did after; nothing
 * for choices that are no edit. Times are in tenths, never above the time, as
 * the player shows them.
 */
export function baseHalfEditSummary(choices: IBaseHalfMediaChoices): string | undefined {
	const tenths = (seconds: number) => (Math.floor(seconds * 10 + 1e-5) / 10).toFixed(1);
	const parts: string[] = [];
	if (choices.keep?.length === 1) {
		parts.push(localize('basehalf.mediaEdit.summary.trimmed', "Trimmed to {0}s–{1}s", tenths(choices.keep[0].start), tenths(choices.keep[0].end)));
	} else if (choices.keep && choices.keep.length > 1) {
		parts.push(localize('basehalf.mediaEdit.summary.parts', "Trimmed to {0} parts", choices.keep.length));
	}
	if (choices.turn) {
		parts.push(localize('basehalf.mediaEdit.summary.turned', "Turned"));
	}
	if (choices.flip) {
		parts.push(localize('basehalf.mediaEdit.summary.flipped', "Flipped"));
	}
	if (choices.straighten) {
		parts.push(localize('basehalf.mediaEdit.summary.straightened', "Straightened by {0}°", choices.straighten));
	}
	if (choices.crop) {
		parts.push(localize('basehalf.mediaEdit.summary.cropped', "Cropped to {0} × {1}", choices.crop.width, choices.crop.height));
	}
	return parts.length ? parts.join(' · ') : undefined;
}

/** The name of the original of a file with this extension, given without its dot. */
export function baseHalfEditOriginalName(extension: string): string {
	return `original.${extension}`;
}

export function baseHalfIsEditOriginalName(name: string): boolean {
	return ORIGINAL_NAME.test(name);
}

/** Reads `edit.yaml`. `undefined` when it cannot be read as a whole record; it is then left as it is. */
export function parseBaseHalfEditRecord(text: string): IBaseHalfEditRecord | undefined {
	let root: YamlMapNode | null;
	try {
		const document = baseHalfParseMirrorYaml(text, BASEHALF_EDIT_RECORD_FILE);
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
	const result = baseHalfMirrorYamlMap(baseHalfMirrorYamlProperty(root, 'result'));
	const keepNode = baseHalfMirrorYamlProperty(root, 'keep');
	const keep = keepNode === undefined ? undefined : baseHalfMirrorYamlItems(keepNode)?.map(readPart);
	const crop = baseHalfMirrorYamlMap(baseHalfMirrorYamlProperty(root, 'crop'));
	if ((keepNode !== undefined && (!keep || keep.some(part => part === undefined))) || (baseHalfMirrorYamlProperty(root, 'crop') !== undefined && !crop)) {
		return undefined;
	}
	const number = (map: YamlMapNode | undefined, key: string) => map ? baseHalfMirrorYamlNumber(baseHalfMirrorYamlProperty(map, key)) : undefined;
	const turn = number(root, 'turn');
	const straighten = number(root, 'straighten');
	const flip = baseHalfMirrorYamlBoolean(baseHalfMirrorYamlProperty(root, 'flip'));
	try {
		return normalizeBaseHalfEditRecord({
			original: baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(root, 'original')) ?? '',
			result: { size: number(result, 'size') ?? -1, hash: (result ? baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(result, 'hash')) : undefined) ?? '' },
			...(keep ? { keep: keep as IBaseHalfMediaPart[] } : {}),
			...(turn !== undefined ? { turn: turn as 1 | 2 | 3 } : {}),
			...(flip !== undefined ? { flip } : {}),
			...(straighten !== undefined ? { straighten } : {}),
			...(crop ? { crop: { x: number(crop, 'x') ?? NaN, y: number(crop, 'y') ?? NaN, width: number(crop, 'width') ?? NaN, height: number(crop, 'height') ?? NaN } } : {})
		});
	} catch (error) {
		if (error instanceof BaseHalfEditRecordError) {
			return undefined;
		}
		throw error;
	}
}

function readPart(node: YamlNode): IBaseHalfMediaPart | undefined {
	const map = baseHalfMirrorYamlMap(node);
	const start = map ? baseHalfMirrorYamlNumber(baseHalfMirrorYamlProperty(map, 'start')) : undefined;
	const end = map ? baseHalfMirrorYamlNumber(baseHalfMirrorYamlProperty(map, 'end')) : undefined;
	return start !== undefined && end !== undefined ? { start, end } : undefined;
}

/** Writes `edit.yaml`. */
export function serializeBaseHalfEditRecord(value: IBaseHalfEditRecord): string {
	const record = normalizeBaseHalfEditRecord(value);
	const lines = [
		`original: ${baseHalfMirrorYamlQuote(record.original)}`,
		'result:',
		`  size: ${record.result.size}`,
		`  hash: ${baseHalfMirrorYamlQuote(record.result.hash)}`
	];
	if (record.keep) {
		lines.push('keep:', ...record.keep.flatMap(part => [`  - start: ${part.start}`, `    end: ${part.end}`]));
	}
	if (record.turn) {
		lines.push(`turn: ${record.turn}`);
	}
	if (record.flip) {
		lines.push('flip: true');
	}
	if (record.straighten) {
		lines.push(`straighten: ${record.straighten}`);
	}
	if (record.crop) {
		lines.push('crop:', `  x: ${record.crop.x}`, `  y: ${record.crop.y}`, `  width: ${record.crop.width}`, `  height: ${record.crop.height}`);
	}
	return `${lines.join('\n')}\n`;
}

/** Validates a record and rounds it as it is written. Throws a {@link BaseHalfEditRecordError} with the field. */
export function normalizeBaseHalfEditRecord(value: IBaseHalfEditRecord): IBaseHalfEditRecord {
	if (!baseHalfIsEditOriginalName(value.original)) {
		throw new BaseHalfEditRecordError('original must name the original beside the record.');
	}
	if (!Number.isInteger(value.result.size) || value.result.size < 0 || !HASH.test(value.result.hash)) {
		throw new BaseHalfEditRecordError('result must have the size and the SHA-256 of the edited file.');
	}
	return Object.freeze({
		original: value.original,
		result: Object.freeze({ size: value.result.size, hash: value.result.hash }),
		...normalizeBaseHalfMediaChoices(value)
	});
}

/** Validates choices, rounds them as a record holds them, and leaves out every field at its default. */
export function normalizeBaseHalfMediaChoices(value: IBaseHalfMediaChoices): IBaseHalfMediaChoices {
	const choices: { -readonly [K in keyof IBaseHalfMediaChoices]: IBaseHalfMediaChoices[K] } = {};
	if (value.keep !== undefined) {
		if (value.keep.length === 0 || value.keep.length > MAX_PARTS) {
			throw new BaseHalfEditRecordError(`keep must hold 1 to ${MAX_PARTS} parts.`);
		}
		let previousEnd = 0;
		choices.keep = Object.freeze(value.keep.map(part => {
			const start = Math.round(part.start * 1000);
			const end = Math.round(part.end * 1000);
			if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || end <= start || end > MAX_TIME_MS) {
				throw new BaseHalfEditRecordError('keep must hold parts in order, each from a start to a later end.');
			}
			previousEnd = end;
			return Object.freeze({ start: start / 1000, end: end / 1000 });
		}));
	}
	if (value.turn !== undefined) {
		const turn = ((value.turn % 4) + 4) % 4;
		if (!Number.isInteger(value.turn)) {
			throw new BaseHalfEditRecordError('turn must be a whole number of quarter turns.');
		}
		if (turn) {
			choices.turn = turn as 1 | 2 | 3;
		}
	}
	if (value.flip) {
		choices.flip = true;
	}
	if (value.straighten !== undefined) {
		const straighten = Math.round(value.straighten * 10) / 10;
		if (!Number.isFinite(straighten) || Math.abs(straighten) > BASEHALF_EDIT_MAX_STRAIGHTEN) {
			throw new BaseHalfEditRecordError(`straighten must be from -${BASEHALF_EDIT_MAX_STRAIGHTEN} to ${BASEHALF_EDIT_MAX_STRAIGHTEN} degrees.`);
		}
		if (straighten) {
			choices.straighten = straighten;
		}
	}
	if (value.crop !== undefined) {
		const { x, y, width, height } = value.crop;
		if (![x, y].every(Number.isFinite) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
			throw new BaseHalfEditRecordError('crop must have a center and a size of whole pixels.');
		}
		choices.crop = Object.freeze({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, width, height });
	}
	return Object.freeze(choices);
}
