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
import { IBaseHalfWorkspaceResource } from './basehalfCanvasNavigation.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';

export const IBaseHalfBadgeMirrorService = createDecorator<IBaseHalfBadgeMirrorService>('baseHalfBadgeMirrorService');

const BADGE_YAML_MAX_BYTES = 128 * 1024;

export type BaseHalfBadgeKind = 'file' | 'folder';

export interface IBaseHalfBadgeNode extends IBaseHalfWorkspaceResource {
	readonly kind: BaseHalfBadgeKind;
}

export interface IBaseHalfBadgeFile {
	readonly path: string;
	readonly kind: BaseHalfBadgeKind;
	readonly description?: string;
	readonly references: readonly string[];
	readonly referenced_by: readonly string[];
	readonly orphan?: boolean;
}

export interface IBaseHalfBadgeReadProblem {
	readonly relativePath: string;
	readonly resource: URI;
	readonly message: string;
	readonly corrupt: boolean;
}

export interface IBaseHalfBadgeReadResult {
	readonly badges: ReadonlyMap<string, IBaseHalfBadgeFile>;
	readonly problems: readonly IBaseHalfBadgeReadProblem[];
}

export interface IBaseHalfBadgeMirrorService {
	readonly _serviceBrand: undefined;

	readBadge(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeFile | null>;
	readBadges(nodes: readonly IBaseHalfBadgeNode[]): Promise<IBaseHalfBadgeReadResult>;
	upsertReference(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode): Promise<void>;
	badgeResource(node: IBaseHalfWorkspaceResource): URI;
}

export class BaseHalfBadgeMirrorCorrupt extends Error {
	override readonly name = 'BaseHalfBadgeMirrorCorrupt';

	constructor(
		readonly resource: URI,
		readonly reason: string,
		options?: { cause?: unknown }
	) {
		super(`Corrupt badge.yaml at ${resource.toString()}: ${reason}`, options);
	}
}

export class BaseHalfBadgeMirrorService implements IBaseHalfBadgeMirrorService {
	declare readonly _serviceBrand: undefined;
	private readonly mutex = createKeyedMutex();

	constructor(
		@IFileService private readonly fileService: IFileService
	) { }

	async readBadge(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeFile | null> {
		const resource = this.badgeResource(node);
		let raw: string;
		try {
			raw = (await this.fileService.readFile(resource, {
				limits: { size: BADGE_YAML_MAX_BYTES }
			})).value.toString();
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return null;
			}

			throw error;
		}

		const parsed = parseBadgeYaml(raw, resource);
		if (parsed === null) {
			return null;
		}

		return normalizeBadgeFile(parsed, resource, node.relativePath, node.kind);
	}

	async readBadges(nodes: readonly IBaseHalfBadgeNode[]): Promise<IBaseHalfBadgeReadResult> {
		const badges = new Map<string, IBaseHalfBadgeFile>();
		const problems: IBaseHalfBadgeReadProblem[] = [];
		for (const node of nodes) {
			try {
				const badge = await this.readBadge(node);
				if (badge) {
					badges.set(badge.path, badge);
				}
			} catch (error) {
				if (error instanceof BaseHalfBadgeMirrorCorrupt) {
					problems.push({
						relativePath: node.relativePath,
						resource: error.resource,
						message: error.reason,
						corrupt: true
					});
				} else {
					problems.push({
						relativePath: node.relativePath,
						resource: this.badgeResource(node),
						message: error instanceof Error ? error.message : String(error),
						corrupt: false
					});
				}
			}
		}

		return { badges, problems };
	}

	async upsertReference(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode): Promise<void> {
		if (source.relativePath === target.relativePath) {
			return;
		}

		await this.updateBadge(source, badge => ({
			...badge,
			references: uniqueStrings([...badge.references, target.relativePath])
		}));
		await this.updateBadge(target, badge => ({
			...badge,
			referenced_by: uniqueStrings([...badge.referenced_by, source.relativePath])
		}));
	}

	badgeResource(node: IBaseHalfWorkspaceResource): URI {
		return URI.joinPath(node.workspaceFolder, '.bh', 'mirror', ...mirrorPathSegments(node.relativePath), 'badge.yaml');
	}

	private updateBadge(node: IBaseHalfBadgeNode, update: (badge: IBaseHalfBadgeFile) => IBaseHalfBadgeFile): Promise<IBaseHalfBadgeFile> {
		const resource = this.badgeResource(node);
		return this.mutex.runExclusive(resource.toString(), async () => {
			const existing = await this.readBadge(node);
			const next = update(existing ?? emptyBadge(node));
			await this.fileService.createFolder(dirname(resource));
			await this.fileService.writeFile(resource, VSBuffer.fromString(serializeBadgeFile(next)));
			return next;
		});
	}
}

function emptyBadge(node: IBaseHalfBadgeNode): IBaseHalfBadgeFile {
	return {
		path: node.relativePath,
		kind: node.kind,
		references: [],
		referenced_by: []
	};
}

function uniqueStrings(values: readonly string[]): string[] {
	const out: string[] = [];
	for (const value of values) {
		if (!out.includes(value)) {
			out.push(value);
		}
	}
	return out;
}

function serializeBadgeFile(badge: IBaseHalfBadgeFile): string {
	const lines = [
		`path: ${yamlString(badge.path)}`,
		`kind: ${badge.kind}`
	];

	if (badge.description) {
		lines.push(`description: ${yamlString(badge.description)}`);
	}

	lines.push('references:');
	if (badge.references.length === 0) {
		lines[lines.length - 1] = 'references: []';
	} else {
		for (const reference of badge.references) {
			lines.push(`  - ${yamlString(reference)}`);
		}
	}

	lines.push('referenced_by:');
	if (badge.referenced_by.length === 0) {
		lines[lines.length - 1] = 'referenced_by: []';
	} else {
		for (const reference of badge.referenced_by) {
			lines.push(`  - ${yamlString(reference)}`);
		}
	}

	if (badge.orphan) {
		lines.push('orphan: true');
	}

	lines.push('');
	return lines.join('\n');
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function normalizeBadgeFile(value: unknown, resource: URI, expectedPath: string, expectedKind: BaseHalfBadgeKind): IBaseHalfBadgeFile {
	const record = asRecord(value, resource, 'badge root must be an object');
	const path = stringField(record, 'path', resource);
	if (path !== expectedPath) {
		throw new BaseHalfBadgeMirrorCorrupt(resource, `path must be "${expectedPath}"`);
	}

	const kind = stringField(record, 'kind', resource);
	if (kind !== expectedKind) {
		throw new BaseHalfBadgeMirrorCorrupt(resource, `kind must be "${expectedKind}"`);
	}

	const description = optionalStringField(record, 'description', resource);
	const references = optionalStringArrayField(record, 'references', resource);
	const referencedBy = optionalStringArrayField(record, 'referenced_by', resource);
	const orphan = optionalBooleanField(record, 'orphan', resource);

	return {
		path,
		kind,
		...(description ? { description } : {}),
		references,
		referenced_by: referencedBy,
		...(orphan === true ? { orphan: true } : {})
	};
}

function parseBadgeYaml(raw: string, resource: URI): Record<string, unknown> | null {
	const errors: YamlParseError[] = [];
	const node = parseYaml(raw, errors);
	if (errors.length > 0) {
		throw new BaseHalfBadgeMirrorCorrupt(resource, errors[0].message);
	}

	if (!node) {
		return null;
	}

	return asRecord(yamlNodeToValue(node), resource, 'badge root must be an object');
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
		throw new BaseHalfBadgeMirrorCorrupt(resource, reason);
	}

	return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string, resource: URI): string {
	const value = record[key];
	if (typeof value !== 'string') {
		throw new BaseHalfBadgeMirrorCorrupt(resource, `${key} must be a string`);
	}

	return value;
}

function optionalStringField(record: Record<string, unknown>, key: string, resource: URI): string | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'string') {
		throw new BaseHalfBadgeMirrorCorrupt(resource, `${key} must be a string`);
	}

	return value;
}

function optionalBooleanField(record: Record<string, unknown>, key: string, resource: URI): boolean | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'boolean') {
		throw new BaseHalfBadgeMirrorCorrupt(resource, `${key} must be a boolean`);
	}

	return value;
}

function optionalStringArrayField(record: Record<string, unknown>, key: string, resource: URI): readonly string[] {
	const value = record[key];
	if (value === undefined) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new BaseHalfBadgeMirrorCorrupt(resource, `${key} must be an array`);
	}

	const out: string[] = [];
	for (let i = 0; i < value.length; i++) {
		const item = value[i];
		if (typeof item !== 'string') {
			throw new BaseHalfBadgeMirrorCorrupt(resource, `${key}[${i}] must be a string`);
		}
		if (!out.includes(item)) {
			out.push(item);
		}
	}

	return out;
}

registerSingleton(IBaseHalfBadgeMirrorService, BaseHalfBadgeMirrorService, InstantiationType.Delayed);
