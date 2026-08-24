/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export const BUNDLED_VIDEO_MODEL_CATALOG_PATH = 'models/video-models.json';
export const OFFICIAL_VIDEO_MODEL_CATALOG_ID = 'pointa.basehalf-ai-video.official-models';
const MAX_BUNDLED_VIDEO_MODEL_CATALOG_BYTES = 512 * 1024;

/**
 * Reads the reviewed catalog as data. The host-owned video-model registry is the
 * sole authority that validates and resolves the capability schema.
 */
export async function loadBundledVideoModelCatalog(extensionRoot: string): Promise<unknown> {
	if (!isAbsolute(extensionRoot)) {
		throw new Error('The AI Video extension root must be an absolute path.');
	}
	const source = await readFile(join(extensionRoot, BUNDLED_VIDEO_MODEL_CATALOG_PATH));
	if (source.byteLength > MAX_BUNDLED_VIDEO_MODEL_CATALOG_BYTES) {
		throw new Error('The bundled video model catalog exceeds the reviewed size limit.');
	}
	return parseBundledVideoModelCatalog(source.toString('utf8'));
}

export function parseBundledVideoModelCatalog(source: string): unknown {
	if (!source.trim()) {
		throw new Error('The bundled video model catalog is empty.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		throw new Error('The bundled video model catalog is not valid JSON.');
	}
	if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.models)) {
		throw new Error('The bundled video model catalog does not use the supported version 1 envelope.');
	}
	return deepFreezeJson(parsed);
}

function deepFreezeJson<T>(value: T): T {
	if (Array.isArray(value)) {
		for (const item of value) {
			deepFreezeJson(item);
		}
		return Object.freeze(value);
	}
	if (isRecord(value)) {
		for (const item of Object.values(value)) {
			deepFreezeJson(item);
		}
		return Object.freeze(value);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
