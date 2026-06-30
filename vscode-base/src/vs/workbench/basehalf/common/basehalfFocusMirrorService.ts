/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { ResourceMap } from '../../../base/common/map.js';
import { URI } from '../../../base/common/uri.js';
import { parse as parseYaml, YamlNode, YamlParseError, YamlScalarNode } from '../../../base/common/yaml.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IBaseHalfMirrorLinkService } from '../../../platform/basehalf/common/basehalfMirrorLink.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCardDetailState, IBaseHalfWorkspaceResource } from './basehalfCanvasNavigation.js';
import { BaseHalfCardDetailProjection } from './basehalfCardDetail.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';

export const IBaseHalfFocusMirrorService = createDecorator<IBaseHalfFocusMirrorService>('baseHalfFocusMirrorService');

const FOCUS_YAML_MAX_BYTES = 64 * 1024;

export type BaseHalfLinePrecision = 'exact' | 'block_start' | 'estimated';

export interface IBaseHalfFileFocusFields {
	readonly projection?: BaseHalfCardDetailProjection;
	readonly visible_lines?: { readonly start: number };
	readonly visible_blocks?: { readonly start: number };
	readonly cursor?: {
		readonly line: number;
		readonly column: number;
		readonly line_precision?: BaseHalfLinePrecision;
		readonly block?: number;
	};
}

export interface IBaseHalfFolderFocusFields {
	readonly viewport_center: {
		readonly x: number;
		readonly y: number;
	};
	readonly zoom: number;
}

export interface IBaseHalfFocusMirrorService {
	readonly _serviceBrand: undefined;

	readFolderFocus(folder: IBaseHalfCanvasFolderState): Promise<IBaseHalfFolderFocusFields | null>;
	writeFileFocus(file: IBaseHalfCardDetailState, fields: IBaseHalfFileFocusFields): Promise<void>;
	writeFolderFocus(folder: IBaseHalfCanvasFolderState, fields: IBaseHalfFolderFocusFields): Promise<void>;
	focusResource(node: IBaseHalfWorkspaceResource): URI;
	currentFocusResource(workspaceFolder: URI): URI;
	currentFocusTarget(relativePath: string): string;
}

export class BaseHalfFocusMirrorCorrupt extends Error {
	override readonly name = 'BaseHalfFocusMirrorCorrupt';

	constructor(
		readonly resource: URI,
		readonly reason: string,
		options?: { cause?: unknown }
	) {
		super(`Corrupt focus.yaml at ${resource.toString()}: ${reason}`, options);
	}
}

export class BaseHalfFocusMirrorService implements IBaseHalfFocusMirrorService {
	declare readonly _serviceBrand: undefined;

	private readonly mutex = createKeyedMutex();
	private readonly lastContentByResource = new ResourceMap<string>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IBaseHalfMirrorLinkService private readonly mirrorLinkService: IBaseHalfMirrorLinkService,
		@ILogService private readonly logService: ILogService
	) { }

	async readFolderFocus(folder: IBaseHalfCanvasFolderState): Promise<IBaseHalfFolderFocusFields | null> {
		const resource = this.focusResource(folder);
		let raw: string;
		try {
			raw = (await this.fileService.readFile(resource, {
				limits: { size: FOCUS_YAML_MAX_BYTES }
			})).value.toString();
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return null;
			}

			throw error;
		}

		const parsed = parseFocusYaml(raw, resource);
		if (parsed === null) {
			return null;
		}

		return normalizeFolderFocusFile(parsed, resource, folder.relativePath);
	}

	writeFileFocus(file: IBaseHalfCardDetailState, fields: IBaseHalfFileFocusFields): Promise<void> {
		return this.writeFocus(file, serializeFileFocus(file.relativePath, fields));
	}

	writeFolderFocus(folder: IBaseHalfCanvasFolderState, fields: IBaseHalfFolderFocusFields): Promise<void> {
		return this.writeFocus(folder, serializeFolderFocus(folder.relativePath, fields));
	}

	focusResource(node: IBaseHalfWorkspaceResource): URI {
		return URI.joinPath(node.workspaceFolder, '.bh', 'mirror', ...mirrorPathSegments(node.relativePath), 'focus.yaml');
	}

	currentFocusResource(workspaceFolder: URI): URI {
		return URI.joinPath(workspaceFolder, '.bh', 'current_focus.yaml');
	}

	currentFocusTarget(relativePath: string): string {
		const segments = mirrorPathSegments(relativePath);
		return ['mirror', ...segments, 'focus.yaml'].join('/');
	}

	private writeFocus(node: IBaseHalfWorkspaceResource, content: string): Promise<void> {
		const workspaceKey = node.workspaceFolder.toString();
		return this.mutex.runExclusive(workspaceKey, async () => {
			const focusResource = this.focusResource(node);
			if (await this.shouldWriteFocusContent(focusResource, content)) {
				await this.fileService.createFolder(this.uriIdentityService.extUri.dirname(focusResource));
				await this.fileService.writeFile(focusResource, VSBuffer.fromString(content));
				this.lastContentByResource.set(focusResource, content);
			}

			await this.mirrorLinkService.setCurrentFocusSymlink(
				this.currentFocusResource(node.workspaceFolder).fsPath,
				this.currentFocusTarget(node.relativePath)
			);
		}).catch(error => {
			this.logService.error(error);
			throw error;
		});
	}

	private async shouldWriteFocusContent(resource: URI, content: string): Promise<boolean> {
		if (this.lastContentByResource.get(resource) !== content) {
			return true;
		}

		try {
			const current = (await this.fileService.readFile(resource, {
				limits: { size: FOCUS_YAML_MAX_BYTES }
			})).value.toString();
			return current !== content;
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return true;
			}

			throw error;
		}
	}
}

export function serializeFileFocus(path: string, fields: IBaseHalfFileFocusFields): string {
	const lines = [
		`path: ${yamlString(path)}`,
		'kind: file'
	];

	if (fields.projection) {
		lines.push(`projection: ${fields.projection}`);
	}

	if (fields.visible_lines) {
		lines.push(
			'visible_lines:',
			`  start: ${positiveInteger(fields.visible_lines.start)}`
		);
	}

	if (fields.visible_blocks) {
		lines.push(
			'visible_blocks:',
			`  start: ${positiveInteger(fields.visible_blocks.start)}`
		);
	}

	if (fields.cursor) {
		lines.push(
			'cursor:',
			`  line: ${positiveInteger(fields.cursor.line)}`,
			`  column: ${positiveInteger(fields.cursor.column)}`
		);
		if (fields.cursor.line_precision) {
			lines.push(`  line_precision: ${fields.cursor.line_precision}`);
		}
		if (fields.cursor.block !== undefined) {
			lines.push(`  block: ${positiveInteger(fields.cursor.block)}`);
		}
	}

	lines.push('');
	return lines.join('\n');
}

export function serializeFolderFocus(path: string, fields: IBaseHalfFolderFocusFields): string {
	return [
		`path: ${yamlString(path)}`,
		'kind: folder',
		'viewport_center:',
		`  x: ${finiteNumber(fields.viewport_center.x)}`,
		`  y: ${finiteNumber(fields.viewport_center.y)}`,
		`zoom: ${positiveNumber(fields.zoom)}`,
		''
	].join('\n');
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

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function positiveInteger(value: number): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`Expected a positive integer, got ${value}`);
	}

	return value;
}

function positiveNumber(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`Expected a positive number, got ${value}`);
	}

	return Number(value.toFixed(4));
}

function finiteNumber(value: number): number {
	if (!Number.isFinite(value)) {
		throw new Error(`Expected a finite number, got ${value}`);
	}

	return Number(value.toFixed(4));
}

registerSingleton(IBaseHalfFocusMirrorService, BaseHalfFocusMirrorService, InstantiationType.Delayed);

function normalizeFolderFocusFile(value: unknown, resource: URI, expectedPath: string): IBaseHalfFolderFocusFields {
	const record = asRecord(value, resource, 'focus root must be an object');
	if (stringField(record, 'path', resource) !== expectedPath) {
		throw new BaseHalfFocusMirrorCorrupt(resource, `path must be "${expectedPath}"`);
	}
	if (stringField(record, 'kind', resource) !== 'folder') {
		throw new BaseHalfFocusMirrorCorrupt(resource, 'kind must be folder');
	}

	const viewportCenter = asRecord(record.viewport_center, resource, 'viewport_center must be an object');
	return {
		viewport_center: {
			x: finiteNumberField(viewportCenter, 'x', resource),
			y: finiteNumberField(viewportCenter, 'y', resource)
		},
		zoom: positiveNumberField(record, 'zoom', resource)
	};
}

function parseFocusYaml(raw: string, resource: URI): Record<string, unknown> | null {
	const errors: YamlParseError[] = [];
	const node = parseYaml(raw, errors);
	if (errors.length > 0) {
		throw new BaseHalfFocusMirrorCorrupt(resource, errors[0].message);
	}

	if (!node) {
		return null;
	}

	return asRecord(yamlNodeToValue(node), resource, 'focus root must be an object');
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

function asRecord(value: unknown, resource: URI, reason: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new BaseHalfFocusMirrorCorrupt(resource, reason);
	}

	return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string, resource: URI): string {
	const value = record[key];
	if (typeof value !== 'string') {
		throw new BaseHalfFocusMirrorCorrupt(resource, `${key} must be a string`);
	}

	return value;
}

function finiteNumberField(record: Record<string, unknown>, key: string, resource: URI): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new BaseHalfFocusMirrorCorrupt(resource, `${key} must be a finite number`);
	}

	return value;
}

function positiveNumberField(record: Record<string, unknown>, key: string, resource: URI): number {
	const value = finiteNumberField(record, key, resource);
	if (value <= 0) {
		throw new BaseHalfFocusMirrorCorrupt(resource, `${key} must be positive`);
	}

	return value;
}
