/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { StringSHA1 } from '../../../../base/common/hash.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * Where covers are kept, below the application's data folder (PDFs and
 * books, "How a cover is made"): never in a workspace.
 */
export const BASEHALF_DOCUMENT_COVER_CACHE_FOLDER = 'CachedCovers';

/** Changes when covers are made differently, so that every cover is made again. */
const COVER_FORMAT = 1;

/** Why a document has no picture on its card. */
export type BaseHalfDocumentCoverProblem = 'locked' | 'protected' | 'unreadable' | 'tooLarge' | 'noPicture';

/** What is kept of the cover of one version of a file, beside its picture. */
export interface IBaseHalfDocumentCoverEntry {
	/** The version of the file the cover was made from, and how. */
	readonly version: string;
	/** The width and the height of the picture kept beside the entry; none without a picture. */
	readonly picture?: { readonly width: number; readonly height: number };
	readonly title?: string;
	readonly authors?: readonly string[];
	readonly problem?: BaseHalfDocumentCoverProblem;
}

const PROBLEMS = new Set<BaseHalfDocumentCoverProblem>(['locked', 'protected', 'unreadable', 'tooLarge', 'noPicture']);

/** The name of the entry of a file in the cache, the same for every version of it. */
export function baseHalfDocumentCoverKey(resource: URI): string {
	const sha = new StringSHA1();
	sha.update(resource.toString());
	return sha.digest();
}

/** The version an entry records: the file's, and the way covers are made. */
export function baseHalfDocumentCoverVersion(fileVersion: string): string {
	return `${COVER_FORMAT}:${fileVersion}`;
}

export function serializeBaseHalfDocumentCoverEntry(entry: IBaseHalfDocumentCoverEntry): string {
	return `${JSON.stringify(entry)}\n`;
}

/** An entry as it was written, or undefined for anything else: such an entry is made again. */
export function parseBaseHalfDocumentCoverEntry(raw: string): IBaseHalfDocumentCoverEntry | undefined {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return undefined;
	}
	const entry = value as Partial<Record<keyof IBaseHalfDocumentCoverEntry, unknown>> | null;
	if (!entry || typeof entry !== 'object' || typeof entry.version !== 'string') {
		return undefined;
	}
	const picture = entry.picture as Partial<Record<'width' | 'height', unknown>> | undefined;
	if (picture !== undefined && !(typeof picture === 'object' && picture !== null && isPositive(picture.width) && isPositive(picture.height))) {
		return undefined;
	}
	if (entry.title !== undefined && typeof entry.title !== 'string'
		|| entry.authors !== undefined && !(Array.isArray(entry.authors) && entry.authors.every(author => typeof author === 'string'))
		|| entry.problem !== undefined && !PROBLEMS.has(entry.problem as BaseHalfDocumentCoverProblem)) {
		return undefined;
	}
	return {
		version: entry.version,
		...(picture ? { picture: { width: picture.width as number, height: picture.height as number } } : {}),
		...(typeof entry.title === 'string' ? { title: entry.title } : {}),
		...(Array.isArray(entry.authors) ? { authors: entry.authors as string[] } : {}),
		...(entry.problem ? { problem: entry.problem as BaseHalfDocumentCoverProblem } : {})
	};
}

function isPositive(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
