/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { dirname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { parse as parseYaml, YamlNode, YamlParseError, YamlScalarNode } from '../../../base/common/yaml.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import {
	IBaseHalfCanvasCard,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasFile,
	IBaseHalfCanvasSize
} from './basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from './basehalfCanvasNavigation.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';

export const IBaseHalfCanvasMirrorService = createDecorator<IBaseHalfCanvasMirrorService>('baseHalfCanvasMirrorService');

const CANVAS_YAML_MAX_BYTES = 512 * 1024;
const CANVAS_ANCHORS = new Set(['north', 'east', 'south', 'west']);

export class BaseHalfCanvasMirrorCorrupt extends Error {
	override readonly name = 'BaseHalfCanvasMirrorCorrupt';

	constructor(
		readonly resource: URI,
		readonly reason: string,
		options?: { cause?: unknown }
	) {
		super(`Corrupt canvas.yaml at ${resource.toString()}: ${reason}`, options);
	}
}

export interface IBaseHalfCanvasMirrorService {
	readonly _serviceBrand: undefined;

	readCanvas(folder: IBaseHalfCanvasFolderState): Promise<IBaseHalfCanvasFile | null>;
	updateCardGeometry(folder: IBaseHalfCanvasFolderState, card: IBaseHalfCanvasCard): Promise<IBaseHalfCanvasFile>;
	upsertCanvasEdge(folder: IBaseHalfCanvasFolderState, edge: IBaseHalfCanvasEdge): Promise<IBaseHalfCanvasFile>;
	canvasResource(folder: IBaseHalfCanvasFolderState): URI;
}

export class BaseHalfCanvasMirrorService implements IBaseHalfCanvasMirrorService {
	declare readonly _serviceBrand: undefined;
	private readonly mutex = createKeyedMutex();

	constructor(
		@IFileService private readonly fileService: IFileService
	) { }

	async readCanvas(folder: IBaseHalfCanvasFolderState): Promise<IBaseHalfCanvasFile | null> {
		const resource = this.canvasResource(folder);
		let raw: string;
		try {
			raw = (await this.fileService.readFile(resource, {
				limits: { size: CANVAS_YAML_MAX_BYTES }
			})).value.toString();
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return null;
			}

			throw error;
		}

		const parsed = parseCanvasYaml(raw, resource);
		if (parsed === null) {
			return null;
		}

		return normalizeCanvasFile(parsed, resource, folder.relativePath);
	}

	updateCardGeometry(folder: IBaseHalfCanvasFolderState, card: IBaseHalfCanvasCard): Promise<IBaseHalfCanvasFile> {
		const resource = this.canvasResource(folder);
		return this.mutex.runExclusive(resource.toString(), async () => {
			const existing = await this.readCanvas(folder);
			const next = upsertCanvasCard(existing ?? { path: folder.relativePath, cards: [], edges: [] }, card);
			await this.fileService.createFolder(dirname(resource));
			await this.fileService.writeFile(resource, VSBuffer.fromString(serializeCanvasFile(next)));
			return next;
		});
	}

	upsertCanvasEdge(folder: IBaseHalfCanvasFolderState, edge: IBaseHalfCanvasEdge): Promise<IBaseHalfCanvasFile> {
		const resource = this.canvasResource(folder);
		return this.mutex.runExclusive(resource.toString(), async () => {
			const existing = await this.readCanvas(folder);
			const next = upsertCanvasEdge(existing ?? { path: folder.relativePath, cards: [], edges: [] }, edge);
			await this.fileService.createFolder(dirname(resource));
			await this.fileService.writeFile(resource, VSBuffer.fromString(serializeCanvasFile(next)));
			return next;
		});
	}

	canvasResource(folder: IBaseHalfCanvasFolderState): URI {
		const segments = folder.relativePath ? folder.relativePath.split('/').filter(Boolean) : [];
		return URI.joinPath(folder.workspaceFolder, '.bh', 'mirror', ...segments, 'canvas.yaml');
	}
}

export function upsertCanvasCard(canvas: IBaseHalfCanvasFile, card: IBaseHalfCanvasCard): IBaseHalfCanvasFile {
	const cards = [...canvas.cards];
	const index = cards.findIndex(existing => existing.path === card.path);
	if (index >= 0) {
		cards[index] = card;
	} else {
		cards.push(card);
	}

	return {
		path: canvas.path,
		...(canvas.size ? { size: canvas.size } : {}),
		cards,
		edges: canvas.edges
	};
}

export function upsertCanvasEdge(canvas: IBaseHalfCanvasFile, edge: IBaseHalfCanvasEdge): IBaseHalfCanvasFile {
	if (edge.from === edge.to) {
		return canvas;
	}

	const edges = [...canvas.edges];
	const index = edges.findIndex(existing => existing.from === edge.from && existing.to === edge.to);
	if (index >= 0) {
		const existing = edges[index];
		edges[index] = {
			...edge,
			...(edge.label !== undefined ? { label: edge.label } : existing.label !== undefined ? { label: existing.label } : {})
		};
	} else {
		edges.push(edge);
	}

	return {
		path: canvas.path,
		...(canvas.size ? { size: canvas.size } : {}),
		cards: canvas.cards,
		edges
	};
}

export function serializeCanvasFile(canvas: IBaseHalfCanvasFile): string {
	const lines = [
		`path: ${yamlString(canvas.path)}`
	];

	if (canvas.size) {
		lines.push(
			'size:',
			`  width: ${formatNumber(canvas.size.width)}`,
			`  height: ${formatNumber(canvas.size.height)}`
		);
	}

	lines.push('cards:');
	if (canvas.cards.length === 0) {
		lines[lines.length - 1] = 'cards: []';
	} else {
		for (const card of canvas.cards) {
			lines.push(
				`  - path: ${yamlString(card.path)}`,
				`    kind: ${card.kind}`,
				`    x: ${formatNumber(card.x)}`,
				`    y: ${formatNumber(card.y)}`,
				`    width: ${formatNumber(card.width)}`,
				`    height: ${formatNumber(card.height)}`
			);
		}
	}

	lines.push('edges:');
	if (canvas.edges.length === 0) {
		lines[lines.length - 1] = 'edges: []';
	} else {
		for (const edge of canvas.edges) {
			lines.push(
				`  - from: ${yamlString(edge.from)}`,
				`    from_anchor: ${edge.from_anchor}`,
				`    to: ${yamlString(edge.to)}`,
				`    to_anchor: ${edge.to_anchor}`
			);
			if (edge.label) {
				lines.push(`    label: ${yamlString(edge.label)}`);
			}
		}
	}

	lines.push('');
	return lines.join('\n');
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function formatNumber(value: number): string {
	return String(Number(value.toFixed(4)));
}

function normalizeCanvasFile(value: unknown, resource: URI, expectedPath: string): IBaseHalfCanvasFile {
	const record = asRecord(value, resource, 'canvas root must be an object');
	const path = stringField(record, 'path', resource);
	if (path !== expectedPath) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `path must be "${expectedPath}"`);
	}

	const size = optionalSize(record.size, resource);
	const cards = arrayField(record, 'cards', resource).map((card, index) => normalizeCanvasCard(card, resource, index));
	const edges = arrayField(record, 'edges', resource).map((edge, index) => normalizeCanvasEdge(edge, resource, index));

	return {
		path,
		...(size ? { size } : {}),
		cards,
		edges
	};
}

function normalizeCanvasCard(value: unknown, resource: URI, index: number): IBaseHalfCanvasCard {
	const record = asRecord(value, resource, `cards[${index}] must be an object`);
	const kind = stringField(record, 'kind', resource);
	if (kind !== 'file' && kind !== 'folder') {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `cards[${index}].kind must be file or folder`);
	}

	return {
		path: stringField(record, 'path', resource),
		kind,
		x: numberField(record, 'x', resource),
		y: numberField(record, 'y', resource),
		width: positiveNumberField(record, 'width', resource),
		height: positiveNumberField(record, 'height', resource)
	};
}

function normalizeCanvasEdge(value: unknown, resource: URI, index: number): IBaseHalfCanvasEdge {
	const record = asRecord(value, resource, `edges[${index}] must be an object`);
	const fromAnchor = anchorField(record, 'from_anchor', resource, index);
	const toAnchor = anchorField(record, 'to_anchor', resource, index);
	const label = typeof record.label === 'string' && record.label.length > 0 ? record.label : undefined;

	return {
		from: stringField(record, 'from', resource),
		from_anchor: fromAnchor,
		to: stringField(record, 'to', resource),
		to_anchor: toAnchor,
		...(label ? { label } : {})
	};
}

function optionalSize(value: unknown, resource: URI): IBaseHalfCanvasSize | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, resource, 'size must be an object');
	return {
		width: positiveNumberField(record, 'width', resource),
		height: positiveNumberField(record, 'height', resource)
	};
}

function asRecord(value: unknown, resource: URI, reason: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, reason);
	}

	return value as Record<string, unknown>;
}

function arrayField(record: Record<string, unknown>, key: string, resource: URI): readonly unknown[] {
	const value = record[key];
	if (value === undefined) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `${key} must be an array`);
	}

	return value;
}

function stringField(record: Record<string, unknown>, key: string, resource: URI): string {
	const value = record[key];
	if (typeof value !== 'string') {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `${key} must be a string`);
	}

	return value;
}

function numberField(record: Record<string, unknown>, key: string, resource: URI): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `${key} must be a finite number`);
	}

	return value;
}

function positiveNumberField(record: Record<string, unknown>, key: string, resource: URI): number {
	const value = numberField(record, key, resource);
	if (value <= 0) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `${key} must be positive`);
	}

	return value;
}

function anchorField(record: Record<string, unknown>, key: string, resource: URI, edgeIndex: number): IBaseHalfCanvasEdge['from_anchor'] {
	const value = stringField(record, key, resource);
	if (!CANVAS_ANCHORS.has(value)) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `edges[${edgeIndex}].${key} must be a canvas anchor`);
	}

	return value as IBaseHalfCanvasEdge['from_anchor'];
}

registerSingleton(IBaseHalfCanvasMirrorService, BaseHalfCanvasMirrorService, InstantiationType.Delayed);

function parseCanvasYaml(raw: string, resource: URI): Record<string, unknown> | null {
	const errors: YamlParseError[] = [];
	const node = parseYaml(raw, errors);
	if (errors.length > 0) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, errors[0].message);
	}

	if (!node) {
		return null;
	}

	return asRecord(yamlNodeToValue(node), resource, 'canvas root must be an object');
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
