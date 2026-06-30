/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { dirname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { parse as parseYaml, YamlNode, YamlParseError, YamlScalarNode } from '../../../base/common/yaml.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import {
	IBaseHalfAdhdFile,
	IBaseHalfAdhdLineRange,
	buildBaseHalfAdhdFile,
	dedupeBaseHalfAdhdKeywords,
	isBaseHalfAdhdEmpty,
	mergeBaseHalfAdhdRange,
	normalizeBaseHalfAdhdRanges,
	subtractBaseHalfAdhdRange
} from './basehalfAdhd.js';
import { IBaseHalfWorkspaceResource } from './basehalfCanvasNavigation.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';

export const IBaseHalfAdhdMirrorService = createDecorator<IBaseHalfAdhdMirrorService>('baseHalfAdhdMirrorService');

const ADHD_YAML_MAX_BYTES = 128 * 1024;

export interface IBaseHalfAdhdMirrorService {
	readonly _serviceBrand: undefined;

	readAdhd(file: IBaseHalfWorkspaceResource): Promise<IBaseHalfAdhdFile | null>;
	setAdhd(file: IBaseHalfWorkspaceResource, fields: Pick<IBaseHalfAdhdFile, 'highlight_keywords' | 'read_paragraphs'>): Promise<IBaseHalfAdhdFile | null>;
	addKeyword(file: IBaseHalfWorkspaceResource, keyword: string): Promise<IBaseHalfAdhdFile>;
	removeKeyword(file: IBaseHalfWorkspaceResource, keyword: string): Promise<IBaseHalfAdhdFile | null>;
	markRead(file: IBaseHalfWorkspaceResource, start: number, end: number): Promise<IBaseHalfAdhdFile>;
	markUnread(file: IBaseHalfWorkspaceResource, start: number, end: number): Promise<IBaseHalfAdhdFile | null>;
	adhdResource(file: IBaseHalfWorkspaceResource): URI;
}

export class BaseHalfAdhdMirrorCorrupt extends Error {
	override readonly name = 'BaseHalfAdhdMirrorCorrupt';

	constructor(
		readonly resource: URI,
		readonly reason: string,
		options?: { cause?: unknown }
	) {
		super(`Corrupt adhd.yaml at ${resource.toString()}: ${reason}`, options);
	}
}

export class BaseHalfAdhdMirrorService implements IBaseHalfAdhdMirrorService {
	declare readonly _serviceBrand: undefined;
	private readonly mutex = createKeyedMutex();

	constructor(
		@IFileService private readonly fileService: IFileService
	) { }

	async readAdhd(file: IBaseHalfWorkspaceResource): Promise<IBaseHalfAdhdFile | null> {
		const resource = this.adhdResource(file);
		let raw: string;
		try {
			raw = (await this.fileService.readFile(resource, {
				limits: { size: ADHD_YAML_MAX_BYTES }
			})).value.toString();
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return null;
			}

			throw error;
		}

		const parsed = parseAdhdYaml(raw, resource);
		if (parsed === null) {
			return null;
		}

		return normalizeAdhdFile(parsed, resource, file.relativePath);
	}

	setAdhd(file: IBaseHalfWorkspaceResource, fields: Pick<IBaseHalfAdhdFile, 'highlight_keywords' | 'read_paragraphs'>): Promise<IBaseHalfAdhdFile | null> {
		const keywords = dedupeBaseHalfAdhdKeywords(fields.highlight_keywords ?? []);
		const ranges = normalizeBaseHalfAdhdRanges(fields.read_paragraphs ?? []);
		return this.patchAdhd(file, () => buildBaseHalfAdhdFile(file.relativePath, keywords, ranges));
	}

	addKeyword(file: IBaseHalfWorkspaceResource, keyword: string): Promise<IBaseHalfAdhdFile> {
		const trimmed = keyword.trim();
		if (trimmed.length === 0) {
			throw new Error('ADHD keyword cannot be empty');
		}

		return this.patchAdhd(file, current => {
			const existing = current?.highlight_keywords ?? [];
			const nextKeywords = existing.some(value => value.toLowerCase() === trimmed.toLowerCase()) ? existing : [...existing, trimmed];
			return buildBaseHalfAdhdFile(file.relativePath, nextKeywords, current?.read_paragraphs);
		}).then(result => result ?? buildBaseHalfAdhdFile(file.relativePath, [trimmed], undefined));
	}

	removeKeyword(file: IBaseHalfWorkspaceResource, keyword: string): Promise<IBaseHalfAdhdFile | null> {
		return this.patchAdhd(file, current => {
			if (!current) {
				return null;
			}
			const kept = (current.highlight_keywords ?? []).filter(value => value !== keyword);
			return buildBaseHalfAdhdFile(file.relativePath, kept, current.read_paragraphs);
		});
	}

	markRead(file: IBaseHalfWorkspaceResource, start: number, end: number): Promise<IBaseHalfAdhdFile> {
		return this.patchAdhd(file, current => buildBaseHalfAdhdFile(
			file.relativePath,
			current?.highlight_keywords,
			mergeBaseHalfAdhdRange(current?.read_paragraphs ?? [], start, end)
		)).then(result => result ?? buildBaseHalfAdhdFile(file.relativePath, undefined, [[start, end]]));
	}

	markUnread(file: IBaseHalfWorkspaceResource, start: number, end: number): Promise<IBaseHalfAdhdFile | null> {
		return this.patchAdhd(file, current => {
			if (!current) {
				return null;
			}
			return buildBaseHalfAdhdFile(
				file.relativePath,
				current.highlight_keywords,
				subtractBaseHalfAdhdRange(current.read_paragraphs ?? [], start, end)
			);
		});
	}

	adhdResource(file: IBaseHalfWorkspaceResource): URI {
		return URI.joinPath(file.workspaceFolder, '.bh', 'mirror', ...mirrorPathSegments(file.relativePath), 'adhd.yaml');
	}

	private patchAdhd(
		file: IBaseHalfWorkspaceResource,
		patch: (current: IBaseHalfAdhdFile | null) => IBaseHalfAdhdFile | null
	): Promise<IBaseHalfAdhdFile | null> {
		const resource = this.adhdResource(file);
		return this.mutex.runExclusive(resource.toString(), async () => {
			const current = await this.readAdhd(file);
			const next = patch(current);
			if (!next || isBaseHalfAdhdEmpty(next)) {
				await this.deleteAdhd(resource);
				return null;
			}

			await this.fileService.createFolder(dirname(resource));
			await this.fileService.writeFile(resource, VSBuffer.fromString(serializeAdhdFile(next)));
			return next;
		});
	}

	private async deleteAdhd(resource: URI): Promise<void> {
		try {
			await this.fileService.del(resource, { useTrash: false });
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return;
			}
			throw error;
		}
	}
}

export function serializeAdhdFile(file: IBaseHalfAdhdFile): string {
	const lines = [
		`path: ${yamlString(file.path)}`,
		'kind: file'
	];

	const keywords = dedupeBaseHalfAdhdKeywords(file.highlight_keywords ?? []);
	if (keywords.length > 0) {
		lines.push('highlight_keywords:');
		for (const keyword of keywords) {
			lines.push(`  - ${yamlString(keyword)}`);
		}
	}

	const ranges = normalizeBaseHalfAdhdRanges(file.read_paragraphs ?? []);
	if (ranges.length > 0) {
		lines.push('read_paragraphs:');
		for (const [start, end] of ranges) {
			lines.push(`  - [${start}, ${end}]`);
		}
	}

	lines.push('');
	return lines.join('\n');
}

function normalizeAdhdFile(value: unknown, resource: URI, expectedPath: string): IBaseHalfAdhdFile {
	const record = asRecord(value, resource, 'adhd root must be an object');
	const path = stringField(record, 'path', resource);
	if (path !== expectedPath) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, `path must be "${expectedPath}"`);
	}

	if (stringField(record, 'kind', resource) !== 'file') {
		throw new BaseHalfAdhdMirrorCorrupt(resource, 'kind must be file');
	}

	const keywords = optionalStringArrayField(record, 'highlight_keywords', resource);
	const ranges = optionalRangeArrayField(record, 'read_paragraphs', resource);
	try {
		return buildBaseHalfAdhdFile(path, keywords, ranges);
	} catch (error) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, error instanceof Error ? error.message : String(error), { cause: error });
	}
}

function parseAdhdYaml(raw: string, resource: URI): Record<string, unknown> | null {
	const errors: YamlParseError[] = [];
	const node = parseYaml(raw, errors);
	if (errors.length > 0) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, errors[0].message);
	}

	if (!node) {
		return null;
	}

	return asRecord(yamlNodeToValue(node), resource, 'adhd root must be an object');
}

function yamlNodeToValue(node: YamlNode): unknown {
	if (node.type === 'map') {
		const value: Record<string, unknown> = {};
		for (const property of node.properties) {
			value[property.key.value] = yamlNodeToValue(property.value);
		}
		return value;
	}

	if (node.type === 'sequence') {
		return node.items.map(item => yamlNodeToValue(item));
	}

	return yamlScalarValue(node);
}

function yamlScalarValue(node: YamlScalarNode): string | number | boolean | null {
	const value = node.value;
	const trimmed = value.trim();
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
		return Number(trimmed);
	}
	if (trimmed === 'true') {
		return true;
	}
	if (trimmed === 'false') {
		return false;
	}
	if (trimmed === 'null' || trimmed === '~') {
		return null;
	}
	return value;
}

function optionalStringArrayField(record: Record<string, unknown>, key: string, resource: URI): readonly string[] {
	const value = record[key];
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, `${key} must be an array`);
	}

	const out: string[] = [];
	for (let i = 0; i < value.length; i++) {
		const item = value[i];
		if (typeof item !== 'string') {
			throw new BaseHalfAdhdMirrorCorrupt(resource, `${key}[${i}] must be a string`);
		}
		out.push(item);
	}
	return out;
}

function optionalRangeArrayField(record: Record<string, unknown>, key: string, resource: URI): readonly IBaseHalfAdhdLineRange[] {
	const value = record[key];
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, `${key} must be an array`);
	}

	return value.map((item, index) => {
		if (!Array.isArray(item) || item.length !== 2) {
			throw new BaseHalfAdhdMirrorCorrupt(resource, `${key}[${index}] must be a [start, end] pair`);
		}
		if (!Number.isInteger(item[0]) || !Number.isInteger(item[1])) {
			throw new BaseHalfAdhdMirrorCorrupt(resource, `${key}[${index}] must contain integers`);
		}
		return [item[0], item[1]] as const;
	});
}

function mirrorPathSegments(relativePath: string): string[] {
	if (!relativePath) {
		return [];
	}

	const segments = relativePath.split('/').filter(Boolean);
	if (segments.some(segment => segment === '.' || segment === '..')) {
		throw new Error(`Invalid BaseHalf mirror relative path: ${relativePath}`);
	}

	return segments;
}

function asRecord(value: unknown, resource: URI, reason: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, reason);
	}

	return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string, resource: URI): string {
	const value = record[key];
	if (typeof value !== 'string') {
		throw new BaseHalfAdhdMirrorCorrupt(resource, `${key} must be a string`);
	}

	return value;
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

registerSingleton(IBaseHalfAdhdMirrorService, BaseHalfAdhdMirrorService, InstantiationType.Delayed);
