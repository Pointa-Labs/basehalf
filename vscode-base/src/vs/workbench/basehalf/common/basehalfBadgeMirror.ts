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
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorResource, baseHalfWalkMirror } from './basehalfMirrorTree.js';

export const IBaseHalfBadgeMirrorService = createDecorator<IBaseHalfBadgeMirrorService>('baseHalfBadgeMirrorService');

const BADGE_YAML_MAX_BYTES = 128 * 1024;
const BADGE_PATCH_MAX_ATTEMPTS = 3;

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

interface IBaseHalfBadgeAbsentReadState {
	readonly exists: false;
	readonly badge: null;
}

interface IBaseHalfBadgeExistingReadState {
	readonly exists: true;
	readonly badge: IBaseHalfBadgeFile | null;
	readonly storedKind?: BaseHalfBadgeKind;
	readonly contents: VSBuffer;
}

type IBaseHalfBadgeReadState = IBaseHalfBadgeAbsentReadState | IBaseHalfBadgeExistingReadState;

/**
 * An opaque, exact-byte observation of one badge file. Graph transactions may
 * inspect the parsed badge, but only the mirror service can use the hidden raw
 * state as a conditional-commit capability.
 */
export interface IBaseHalfBadgeSnapshot {
	readonly badge: IBaseHalfBadgeFile | null;
	readonly materialized: boolean;
	readonly storedKind?: BaseHalfBadgeKind;
}

export interface IBaseHalfBadgeSnapshotCommitOptions {
	/**
	 * Existing badge files normally own their stored node kind, even when they
	 * are logical-empty tombstones and the caller only has a guessed kind. A
	 * structural identity replacement is the exception: the incoming node owns
	 * the destination path and must be allowed to replace the retired target's
	 * kind together with its other identity fields.
	 */
	readonly allowKindChange?: boolean;
}

interface IBaseHalfBadgeSnapshotState {
	readonly resource: URI;
	readonly relativePath: string;
	readonly read: IBaseHalfBadgeReadState;
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

/**
 * The badge FILE layer: maps a workspace node to its `.bh/mirror/<rel>/badge.yaml`
 * and owns parsing, validation, serialization, and per-file write atomicity.
 * Reference-graph SEMANTICS (bidirectional links, orphan lifecycle, rename and
 * delete cascades) live above this in `IBaseHalfBadgeGraphService` — nothing
 * else should write badge files directly.
 */
export interface IBaseHalfBadgeMirrorService {
	readonly _serviceBrand: undefined;

	readBadge(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeFile | null>;
	readBadges(nodes: readonly IBaseHalfBadgeNode[]): Promise<IBaseHalfBadgeReadResult>;
	/** Every materialized badge.yaml in the workspace's mirror tree,
	 *  keyed by workspace-relative path. Corrupt files are collected as
	 *  problems, never thrown — one bad badge must not blank a listing. A
	 *  canonical empty tombstone is logically absent and is not listed. */
	listBadges(workspaceFolder: URI): Promise<IBaseHalfBadgeReadResult>;
	/** Capture the parsed badge together with an opaque exact-byte expectation. */
	readBadgeSnapshot(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeSnapshot>;
	/** Commit exactly once against `expected` (no internal replay). The caller
	 * owns whole-graph retry and compensation. */
	commitBadgeSnapshot(node: IBaseHalfBadgeNode, expected: IBaseHalfBadgeSnapshot, next: IBaseHalfBadgeFile | null, options?: IBaseHalfBadgeSnapshotCommitOptions): Promise<IBaseHalfBadgeSnapshot>;
	/** Verify that the file still has the exact bytes represented by `snapshot`.
	 * Graph transactions use this after all owners commit so an external edit to
	 * an early destination cannot be mistaken for a successful whole-graph move. */
	assertBadgeSnapshotCurrent(node: IBaseHalfBadgeNode, snapshot: IBaseHalfBadgeSnapshot): Promise<void>;
	/** Restore the exact original bytes only while the file still equals this
	 * transaction's `written` snapshot. An originally absent badge is restored
	 * as a logical-empty tombstone; it is never conditionally written and then
	 * unconditionally deleted. */
	restoreBadgeSnapshot(node: IBaseHalfBadgeNode, written: IBaseHalfBadgeSnapshot, original: IBaseHalfBadgeSnapshot): Promise<IBaseHalfBadgeSnapshot>;
	/** Optimistic read-modify-write of one badge.yaml under the file's write
	 *  lock. Existing files use exact-byte guarded atomic replace; absent files
	 *  use provider-exclusive create. Either path replays on an external conflict.
	 *  `update` receives the current badge (or null when absent) and returns the
	 *  next value. Returning null from a materialized badge commits a canonical
	 *  empty tombstone; it never follows a guarded write with an unguarded
	 *  delete. Never-materialized empty badges remain absent. */
	patchBadge(node: IBaseHalfBadgeNode, update: (current: IBaseHalfBadgeFile | null) => IBaseHalfBadgeFile | null): Promise<IBaseHalfBadgeFile | null>;
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
	private readonly snapshotStates = new WeakMap<IBaseHalfBadgeSnapshot, IBaseHalfBadgeSnapshotState>();

	constructor(
		@IFileService private readonly fileService: IFileService
	) { }

	async readBadge(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeFile | null> {
		return this.readBadgeAt(node.workspaceFolder, this.badgeResource(node), node.relativePath);
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
				problems.push(this.toProblem(error, node.relativePath, this.badgeResource(node)));
			}
		}

		return { badges, problems };
	}

	async listBadges(workspaceFolder: URI): Promise<IBaseHalfBadgeReadResult> {
		const badges = new Map<string, IBaseHalfBadgeFile>();
		const problems: IBaseHalfBadgeReadProblem[] = [];
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, 'badge.yaml')) {
			try {
				const badge = await this.readBadgeAt(workspaceFolder, entry.resource, entry.relativePath);
				if (badge) {
					badges.set(badge.path, badge);
				}
			} catch (error) {
				problems.push(this.toProblem(error, entry.relativePath, entry.resource));
			}
		}

		return { badges, problems };
	}

	async readBadgeSnapshot(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeSnapshot> {
		const resource = this.badgeResource(node);
		return this.createSnapshot(resource, node.relativePath, await this.readBadgeStateAt(node.workspaceFolder, resource, node.relativePath));
	}

	commitBadgeSnapshot(node: IBaseHalfBadgeNode, expected: IBaseHalfBadgeSnapshot, next: IBaseHalfBadgeFile | null, options?: IBaseHalfBadgeSnapshotCommitOptions): Promise<IBaseHalfBadgeSnapshot> {
		const resource = this.badgeResource(node);
		return this.mutex.runExclusive(resource.toString(), () => this.commitBadgeSnapshotUnlocked(node, resource, expected, next, options));
	}

	assertBadgeSnapshotCurrent(node: IBaseHalfBadgeNode, snapshot: IBaseHalfBadgeSnapshot): Promise<void> {
		const resource = this.badgeResource(node);
		return this.mutex.runExclusive(resource.toString(), async () => {
			const expected = this.snapshotStateFor(node, resource, snapshot).read;
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
			try {
				const current = await this.fileService.readFile(resource, {
					limits: { size: BADGE_YAML_MAX_BYTES },
					atomic: true
				});
				if (!expected.exists || !current.value.equals(expected.contents)) {
					throw new FileOperationError(`Badge changed after graph commit: ${resource.toString()}`, FileOperationResult.FILE_MODIFIED_SINCE);
				}
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
			} catch (error) {
				if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND && !expected.exists) {
					await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
					return;
				}
				throw error;
			}
		});
	}

	restoreBadgeSnapshot(node: IBaseHalfBadgeNode, written: IBaseHalfBadgeSnapshot, original: IBaseHalfBadgeSnapshot): Promise<IBaseHalfBadgeSnapshot> {
		const resource = this.badgeResource(node);
		return this.mutex.runExclusive(resource.toString(), async () => {
			const writtenState = this.snapshotStateFor(node, resource, written);
			const originalState = this.snapshotStateFor(node, resource, original);
			if (!writtenState.read.exists) {
				throw new Error(`Cannot compensate ${resource.toString()} from a snapshot that was never materialized`);
			}

			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
			await this.fileService.createFolder(dirname(resource));
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
			if (originalState.read.exists) {
				await baseHalfCommitMirrorFile(this.fileService, resource, originalState.read.contents, writtenState.read.contents);
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
				return this.createSnapshot(resource, node.relativePath, originalState.read);
			}

			const storedKind = writtenState.read.storedKind ?? writtenState.read.badge?.kind ?? node.kind;
			const contents = VSBuffer.fromString(serializeBadgeFile({
				path: node.relativePath,
				kind: storedKind,
				references: [],
				referenced_by: []
			}));
			await baseHalfCommitMirrorFile(this.fileService, resource, contents, writtenState.read.contents);
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
			return this.createSnapshot(resource, node.relativePath, {
				exists: true,
				badge: null,
				storedKind,
				contents
			});
		});
	}

	patchBadge(node: IBaseHalfBadgeNode, update: (current: IBaseHalfBadgeFile | null) => IBaseHalfBadgeFile | null): Promise<IBaseHalfBadgeFile | null> {
		const resource = this.badgeResource(node);
		return this.mutex.runExclusive(resource.toString(), async () => {
			for (let attempt = 0; attempt < BADGE_PATCH_MAX_ATTEMPTS; attempt++) {
				const snapshot = this.createSnapshot(resource, node.relativePath, await this.readBadgeStateAt(node.workspaceFolder, resource, node.relativePath));
				const next = update(snapshot.badge);
				if (next === null && snapshot.badge === null) {
					return null;
				}
				try {
					return (await this.commitBadgeSnapshotUnlocked(node, resource, snapshot, next)).badge;
				} catch (error) {
					if (!isBadgePatchConflict(error) || attempt === BADGE_PATCH_MAX_ATTEMPTS - 1) {
						throw error;
					}
				}
			}
			throw new Error(`Unable to update ${resource.toString()} after ${BADGE_PATCH_MAX_ATTEMPTS} attempts`);
		});
	}

	badgeResource(node: IBaseHalfWorkspaceResource): URI {
		return baseHalfMirrorResource(node.workspaceFolder, node.relativePath, 'badge.yaml');
	}

	private async readBadgeAt(workspaceFolder: URI, resource: URI, relativePath: string): Promise<IBaseHalfBadgeFile | null> {
		return (await this.readBadgeStateAt(workspaceFolder, resource, relativePath)).badge;
	}

	private async commitBadgeSnapshotUnlocked(
		node: IBaseHalfBadgeNode,
		resource: URI,
		expected: IBaseHalfBadgeSnapshot,
		updated: IBaseHalfBadgeFile | null,
		options?: IBaseHalfBadgeSnapshotCommitOptions
	): Promise<IBaseHalfBadgeSnapshot> {
		const expectedState = this.snapshotStateFor(node, resource, expected);
		const storedKind = expectedState.read.exists ? expectedState.read.storedKind : undefined;
		const next = updated && storedKind && options?.allowKindChange !== true ? { ...updated, kind: storedKind } : updated;
		const nextKind = next?.kind ?? (options?.allowKindChange === true ? node.kind : storedKind ?? node.kind);
		const serializedBadge = next ?? {
			path: node.relativePath,
			kind: nextKind,
			references: [],
			referenced_by: []
		};
		const contents = VSBuffer.fromString(serializeBadgeFile(serializedBadge));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
		await this.fileService.createFolder(dirname(resource));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
		await baseHalfCommitMirrorFile(
			this.fileService,
			resource,
			contents,
			expectedState.read.exists ? expectedState.read.contents : null
		);
		return this.createSnapshot(resource, node.relativePath, {
			exists: true,
			badge: isEmptyBadge(serializedBadge) ? null : serializedBadge,
			storedKind: nextKind,
			contents
		});
	}

	private createSnapshot(resource: URI, relativePath: string, read: IBaseHalfBadgeReadState): IBaseHalfBadgeSnapshot {
		const snapshot: IBaseHalfBadgeSnapshot = Object.freeze({
			badge: read.badge,
			materialized: read.exists,
			storedKind: read.exists ? read.storedKind : undefined
		});
		this.snapshotStates.set(snapshot, { resource, relativePath, read });
		return snapshot;
	}

	private snapshotStateFor(node: IBaseHalfBadgeNode, resource: URI, snapshot: IBaseHalfBadgeSnapshot): IBaseHalfBadgeSnapshotState {
		const state = this.snapshotStates.get(snapshot);
		if (!state || state.relativePath !== node.relativePath || state.resource.toString() !== resource.toString()) {
			throw new Error(`Badge snapshot does not belong to ${resource.toString()}`);
		}
		return state;
	}

	private async readBadgeStateAt(workspaceFolder: URI, resource: URI, relativePath: string): Promise<IBaseHalfBadgeReadState> {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		let content;
		try {
			content = await this.fileService.readFile(resource, {
				limits: { size: BADGE_YAML_MAX_BYTES },
				atomic: true
			});
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
				return { exists: false, badge: null };
			}

			throw error;
		}
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);

		const parsed = parseBadgeYaml(content.value.toString(), resource);
		if (parsed === null) {
			return { exists: true, badge: null, contents: content.value };
		}

		const badge = normalizeBadgeFile(parsed, resource, relativePath);
		return {
			exists: true,
			badge: isEmptyBadge(badge) ? null : badge,
			storedKind: badge.kind,
			contents: content.value
		};
	}

	private toProblem(error: unknown, relativePath: string, resource: URI): IBaseHalfBadgeReadProblem {
		if (error instanceof BaseHalfBadgeMirrorCorrupt) {
			return { relativePath, resource: error.resource, message: error.reason, corrupt: true };
		}

		return {
			relativePath,
			resource,
			message: error instanceof Error ? error.message : String(error),
			corrupt: false
		};
	}
}

function isBadgePatchConflict(error: unknown): boolean {
	return error instanceof FileOperationError && (
		error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE
		|| error.fileOperationResult === FileOperationResult.FILE_MOVE_CONFLICT
		|| error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND
	);
}

function isEmptyBadge(badge: IBaseHalfBadgeFile): boolean {
	return !badge.description
		&& badge.references.length === 0
		&& badge.referenced_by.length === 0
		&& badge.orphan !== true;
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

function normalizeBadgeFile(value: unknown, resource: URI, expectedPath: string): IBaseHalfBadgeFile {
	const record = asRecord(value, resource, 'badge root must be an object');
	const path = stringField(record, 'path', resource);
	if (path !== expectedPath) {
		throw new BaseHalfBadgeMirrorCorrupt(resource, `path must be "${expectedPath}"`);
	}

	// The kind is trusted from the FILE, not from the caller: a path cannot be
	// both a file and a folder on disk, so the stored kind is authoritative and a
	// caller's guess (e.g. a reference target defaulting to 'file') must not turn
	// a healthy folder badge into a "corrupt" read.
	const kind = stringField(record, 'kind', resource);
	if (kind !== 'file' && kind !== 'folder') {
		throw new BaseHalfBadgeMirrorCorrupt(resource, 'kind must be "file" or "folder"');
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
