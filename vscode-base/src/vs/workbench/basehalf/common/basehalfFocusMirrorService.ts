/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { ResourceMap } from '../../../base/common/map.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IBaseHalfMirrorLinkService } from '../../../platform/basehalf/common/basehalfMirrorLink.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCardDetailState, IBaseHalfWorkspaceResource } from './basehalfCanvasNavigation.js';
import { BaseHalfCardDetailProjection } from './basehalfCardDetail.js';

export const IBaseHalfFocusMirrorService = createDecorator<IBaseHalfFocusMirrorService>('baseHalfFocusMirrorService');

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

	writeFileFocus(file: IBaseHalfCardDetailState, fields: IBaseHalfFileFocusFields): Promise<void>;
	writeFolderFocus(folder: IBaseHalfCanvasFolderState, fields: IBaseHalfFolderFocusFields): Promise<void>;
	focusResource(node: IBaseHalfWorkspaceResource): URI;
	currentFocusResource(workspaceFolder: URI): URI;
	currentFocusTarget(relativePath: string): string;
}

export class BaseHalfFocusMirrorService implements IBaseHalfFocusMirrorService {
	declare readonly _serviceBrand: undefined;

	private readonly pendingByWorkspace = new Map<string, Promise<void>>();
	private readonly lastContentByResource = new ResourceMap<string>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IBaseHalfMirrorLinkService private readonly mirrorLinkService: IBaseHalfMirrorLinkService,
		@ILogService private readonly logService: ILogService
	) { }

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
		const previous = this.pendingByWorkspace.get(workspaceKey) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(async () => {
				const focusResource = this.focusResource(node);
				if (this.lastContentByResource.get(focusResource) !== content) {
					await this.fileService.createFolder(this.uriIdentityService.extUri.dirname(focusResource));
					await this.fileService.writeFile(focusResource, VSBuffer.fromString(content));
					this.lastContentByResource.set(focusResource, content);
				}

				await this.mirrorLinkService.setCurrentFocusSymlink(
					this.currentFocusResource(node.workspaceFolder).fsPath,
					this.currentFocusTarget(node.relativePath)
				);
			});

		this.pendingByWorkspace.set(workspaceKey, next);
		const cleanup = () => {
			if (this.pendingByWorkspace.get(workspaceKey) === next) {
				this.pendingByWorkspace.delete(workspaceKey);
			}
		};
		void next.then(cleanup, cleanup);

		return next.catch(error => {
			this.logService.error(error);
			throw error;
		});
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
