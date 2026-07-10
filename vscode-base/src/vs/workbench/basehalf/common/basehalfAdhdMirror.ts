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
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink } from './basehalfMirrorTree.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from './basehalfWorkspaceMutation.js';

export const IBaseHalfAdhdMirrorService = createDecorator<IBaseHalfAdhdMirrorService>('baseHalfAdhdMirrorService');

const ADHD_YAML_MAX_BYTES = 128 * 1024;
const ADHD_PATCH_MAX_ATTEMPTS = 3;

interface IBaseHalfAdhdAbsentReadState {
	readonly exists: false;
	readonly adhd: null;
}

interface IBaseHalfAdhdExistingReadState {
	readonly exists: true;
	readonly adhd: IBaseHalfAdhdFile | null;
	readonly contents: VSBuffer;
}

type IBaseHalfAdhdReadState = IBaseHalfAdhdAbsentReadState | IBaseHalfAdhdExistingReadState;

export interface IBaseHalfAdhdMirrorService {
	readonly _serviceBrand: undefined;

	readAdhd(file: IBaseHalfWorkspaceResource): Promise<IBaseHalfAdhdFile | null>;
	setAdhd(file: IBaseHalfWorkspaceResource, fields: Pick<IBaseHalfAdhdFile, 'highlight_keywords' | 'read_paragraphs'>, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfAdhdFile | null>;
	addKeyword(file: IBaseHalfWorkspaceResource, keyword: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfAdhdFile>;
	removeKeyword(file: IBaseHalfWorkspaceResource, keyword: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfAdhdFile | null>;
	markRead(file: IBaseHalfWorkspaceResource, start: number, end: number, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfAdhdFile>;
	markUnread(file: IBaseHalfWorkspaceResource, start: number, end: number, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfAdhdFile | null>;
	/** Structural path identity operations. They do not require the old user
	 * file to still exist and retire mirrors to canonical tombstones with exact
	 * byte preconditions instead of unguarded unlink. */
	retireAdhd(file: IBaseHalfWorkspaceResource, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	relocateAdhd(source: IBaseHalfWorkspaceResource, target: IBaseHalfWorkspaceResource, options?: { readonly sameResourceIdentity?: boolean }, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
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
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator
	) { }

	async readAdhd(file: IBaseHalfWorkspaceResource): Promise<IBaseHalfAdhdFile | null> {
		return (await this.readAdhdStateAt(file.workspaceFolder, this.adhdResource(file), file.relativePath)).adhd;
	}

	setAdhd(file: IBaseHalfWorkspaceResource, fields: Pick<IBaseHalfAdhdFile, 'highlight_keywords' | 'read_paragraphs'>, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfAdhdFile | null> {
		const keywords = dedupeBaseHalfAdhdKeywords(fields.highlight_keywords ?? []);
		const ranges = normalizeBaseHalfAdhdRanges(fields.read_paragraphs ?? []);
		return this.patchAdhd(file, () => buildBaseHalfAdhdFile(file.relativePath, keywords, ranges), lease);
	}

	addKeyword(file: IBaseHalfWorkspaceResource, keyword: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfAdhdFile> {
		const trimmed = keyword.trim();
		if (trimmed.length === 0) {
			throw new Error('ADHD keyword cannot be empty');
		}

		return this.patchAdhd(file, current => {
			const existing = current?.highlight_keywords ?? [];
			const nextKeywords = existing.some(value => value.toLowerCase() === trimmed.toLowerCase()) ? existing : [...existing, trimmed];
			return buildBaseHalfAdhdFile(file.relativePath, nextKeywords, current?.read_paragraphs);
		}, lease).then(result => result ?? buildBaseHalfAdhdFile(file.relativePath, [trimmed], undefined));
	}

	removeKeyword(file: IBaseHalfWorkspaceResource, keyword: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfAdhdFile | null> {
		return this.patchAdhd(file, current => {
			if (!current) {
				return null;
			}
			const kept = (current.highlight_keywords ?? []).filter(value => value !== keyword);
			return buildBaseHalfAdhdFile(file.relativePath, kept, current.read_paragraphs);
		}, lease);
	}

	markRead(file: IBaseHalfWorkspaceResource, start: number, end: number, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfAdhdFile> {
		return this.patchAdhd(file, current => buildBaseHalfAdhdFile(
			file.relativePath,
			current?.highlight_keywords,
			mergeBaseHalfAdhdRange(current?.read_paragraphs ?? [], start, end)
		), lease).then(result => result ?? buildBaseHalfAdhdFile(file.relativePath, undefined, [[start, end]]));
	}

	markUnread(file: IBaseHalfWorkspaceResource, start: number, end: number, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfAdhdFile | null> {
		return this.patchAdhd(file, current => {
			if (!current) {
				return null;
			}
			return buildBaseHalfAdhdFile(
				file.relativePath,
				current.highlight_keywords,
				subtractBaseHalfAdhdRange(current.read_paragraphs ?? [], start, end)
			);
		}, lease);
	}

	retireAdhd(file: IBaseHalfWorkspaceResource, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		return this.runStructuralMutation(file.workspaceFolder, lease, () => this.retireAdhdLocked(file));
	}

	relocateAdhd(source: IBaseHalfWorkspaceResource, target: IBaseHalfWorkspaceResource, options: { readonly sameResourceIdentity?: boolean } = {}, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		if (source.workspaceFolder.toString() !== target.workspaceFolder.toString()) {
			return Promise.reject(new Error('ADHD mirror relocation cannot cross workspaces.'));
		}
		if (source.relativePath === target.relativePath) {
			return Promise.resolve();
		}
		return this.runStructuralMutation(source.workspaceFolder, lease, () => {
			const sourceResource = this.adhdResource(source);
			const targetResource = this.adhdResource(target);
			if (options.sameResourceIdentity) {
				return this.mutex.runExclusive(sourceResource.toString(), () => this.renameAdhdIdentityLocked(source, target));
			}
			const [first, second] = [sourceResource, targetResource].sort((a, b) => a.toString().localeCompare(b.toString()));
			return this.mutex.runExclusive(first.toString(), () =>
				this.mutex.runExclusive(second.toString(), () => this.relocateAdhdLocked(source, target))
			);
		});
	}

	adhdResource(file: IBaseHalfWorkspaceResource): URI {
		return URI.joinPath(file.workspaceFolder, '.bh', 'mirror', ...mirrorPathSegments(file.relativePath), 'adhd.yaml');
	}

	private runStructuralMutation<T>(workspaceFolder: URI, lease: IBaseHalfWorkspaceMutationLease | undefined, task: () => Promise<T>): Promise<T> {
		if (lease) {
			this.workspaceMutationCoordinator.assertLease(lease, workspaceFolder);
			return task();
		}
		return this.workspaceMutationCoordinator.runExclusive(workspaceFolder, task);
	}

	private async retireAdhdLocked(file: IBaseHalfWorkspaceResource): Promise<void> {
		const resource = this.adhdResource(file);
		await this.mutex.runExclusive(resource.toString(), async () => {
			for (let attempt = 0; attempt < ADHD_PATCH_MAX_ATTEMPTS; attempt++) {
				const read = await this.readAdhdStateAt(file.workspaceFolder, resource, file.relativePath);
				if (!read.exists) {
					return;
				}
				try {
					await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, file.workspaceFolder, resource);
					await baseHalfCommitMirrorFile(
						this.fileService,
						resource,
						VSBuffer.fromString(serializeAdhdFile(buildBaseHalfAdhdFile(file.relativePath, undefined, undefined))),
						read.contents
					);
					return;
				} catch (error) {
					if (!isAdhdPatchConflict(error) || attempt === ADHD_PATCH_MAX_ATTEMPTS - 1) {
						throw error;
					}
				}
			}
		});
	}

	private async relocateAdhdLocked(source: IBaseHalfWorkspaceResource, target: IBaseHalfWorkspaceResource): Promise<void> {
		const sourceResource = this.adhdResource(source);
		const targetResource = this.adhdResource(target);
		for (let attempt = 0; attempt < ADHD_PATCH_MAX_ATTEMPTS; attempt++) {
			const sourceRead = await this.readAdhdStateAt(source.workspaceFolder, sourceResource, source.relativePath);
			if (!sourceRead.exists || sourceRead.adhd === null) {
				return;
			}
			const targetRead = await this.readAdhdStateAt(target.workspaceFolder, targetResource, target.relativePath);
			const relocated = buildBaseHalfAdhdFile(
				target.relativePath,
				sourceRead.adhd.highlight_keywords,
				sourceRead.adhd.read_paragraphs
			);
			const relocatedContents = VSBuffer.fromString(serializeAdhdFile(relocated));
			const sourceTombstoneContents = VSBuffer.fromString(serializeAdhdFile(buildBaseHalfAdhdFile(source.relativePath, undefined, undefined)));
			let targetCommitted = false;
			let sourceWritten: VSBuffer | undefined;
			try {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, target.workspaceFolder, targetResource);
				await this.fileService.createFolder(dirname(targetResource));
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, target.workspaceFolder, targetResource);
				await baseHalfCommitMirrorFile(
					this.fileService,
					targetResource,
					relocatedContents,
					targetRead.exists ? targetRead.contents : null
				);
				targetCommitted = true;
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, source.workspaceFolder, sourceResource);
				await baseHalfCommitMirrorFile(
					this.fileService,
					sourceResource,
					sourceTombstoneContents,
					sourceRead.contents
				);
				sourceWritten = sourceTombstoneContents;
			} catch (error) {
				if (targetCommitted) {
					try {
						// Restore only while the destination is still exactly our write.
						// A concurrent external destination edit wins and makes the
						// relocation fail closed instead of being overwritten on retry.
						await this.restoreAdhdState(target.workspaceFolder, targetResource, target.relativePath, relocatedContents, targetRead);
					} catch (rollbackError) {
						throw new AggregateError([error, rollbackError], 'ADHD relocation and conditional destination compensation both failed');
					}
				}
				if (!isAdhdPatchConflict(error) || attempt === ADHD_PATCH_MAX_ATTEMPTS - 1) {
					throw error;
				}
				continue;
			}

			try {
				await this.assertAdhdStateContents(target.workspaceFolder, targetResource, target.relativePath, relocatedContents);
			} catch (error) {
				// The destination changed after its commit. Preserve that external
				// latest state, conditionally restore the authored source, and fail
				// closed instead of reporting a successful relocation that lost it.
				try {
					await this.restoreAdhdState(source.workspaceFolder, sourceResource, source.relativePath, sourceWritten!, sourceRead);
				} catch (rollbackError) {
					throw new AggregateError(
						[error, rollbackError],
						'ADHD relocation destination changed and source compensation failed'
					);
				}
				throw error;
			}

			try {
				await this.assertAdhdStateContents(source.workspaceFolder, sourceResource, source.relativePath, sourceWritten!);
				return;
			} catch (error) {
				// A source identity recreated after retirement wins. Undo only our
				// still-current destination write and leave both external states intact.
				try {
					await this.restoreAdhdState(target.workspaceFolder, targetResource, target.relativePath, relocatedContents, targetRead);
				} catch (rollbackError) {
					throw new AggregateError(
						[error, rollbackError],
						'ADHD relocation source changed and destination compensation failed'
					);
				}
				throw error;
			}
		}
	}

	private async restoreAdhdState(workspaceFolder: URI, resource: URI, relativePath: string, written: VSBuffer, original: IBaseHalfAdhdReadState): Promise<void> {
		const restored = original.exists
			? original.contents
			: VSBuffer.fromString(serializeAdhdFile(buildBaseHalfAdhdFile(relativePath, undefined, undefined)));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		await this.fileService.createFolder(dirname(resource));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		await baseHalfCommitMirrorFile(this.fileService, resource, restored, written);
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
	}

	private async assertAdhdStateContents(workspaceFolder: URI, resource: URI, relativePath: string, expected: VSBuffer): Promise<void> {
		const current = await this.readAdhdStateAt(workspaceFolder, resource, relativePath);
		if (!current.exists || !current.contents.equals(expected)) {
			throw new FileOperationError(`ADHD state changed after relocation commit: ${resource.toString()}`, FileOperationResult.FILE_MODIFIED_SINCE);
		}
	}

	private async renameAdhdIdentityLocked(source: IBaseHalfWorkspaceResource, target: IBaseHalfWorkspaceResource): Promise<void> {
		const resource = this.adhdResource(source);
		for (let attempt = 0; attempt < ADHD_PATCH_MAX_ATTEMPTS; attempt++) {
			let read: IBaseHalfAdhdReadState;
			try {
				read = await this.readAdhdStateAt(source.workspaceFolder, resource, source.relativePath);
			} catch (error) {
				if (!(error instanceof BaseHalfAdhdMirrorCorrupt)) {
					throw error;
				}
				// A retry after the one-file case-only commit sees target-path YAML
				// through the same case-insensitive resource. Accept only a fully valid
				// target identity; unrelated corruption must remain fail-closed.
				try {
					const targetRead = await this.readAdhdStateAt(target.workspaceFolder, resource, target.relativePath);
					if (targetRead.exists) {
						return;
					}
				} catch {
					// Re-throw the source-identity corruption below.
				}
				throw error;
			}
			if (!read.exists) {
				return;
			}
			// Materialized empty ADHD files are CAS tombstones. They still carry a
			// logical path and must adopt the target casing or every later read at the
			// new identity reports a corrupt mirror.
			const renamed = buildBaseHalfAdhdFile(
				target.relativePath,
				read.adhd?.highlight_keywords,
				read.adhd?.read_paragraphs
			);
			try {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, source.workspaceFolder, resource);
				await baseHalfCommitMirrorFile(this.fileService, resource, VSBuffer.fromString(serializeAdhdFile(renamed)), read.contents);
				return;
			} catch (error) {
				if (!isAdhdPatchConflict(error) || attempt === ADHD_PATCH_MAX_ATTEMPTS - 1) {
					throw error;
				}
			}
		}
	}

	private patchAdhd(
		file: IBaseHalfWorkspaceResource,
		patch: (current: IBaseHalfAdhdFile | null) => IBaseHalfAdhdFile | null,
		lease?: IBaseHalfWorkspaceMutationLease
	): Promise<IBaseHalfAdhdFile | null> {
		if (lease) {
			this.workspaceMutationCoordinator.assertLease(lease, file.workspaceFolder);
			return this.patchAdhdLocked(file, patch);
		}
		return this.workspaceMutationCoordinator.runExclusive(file.workspaceFolder, () => this.patchAdhdLocked(file, patch));
	}

	private patchAdhdLocked(
		file: IBaseHalfWorkspaceResource,
		patch: (current: IBaseHalfAdhdFile | null) => IBaseHalfAdhdFile | null
	): Promise<IBaseHalfAdhdFile | null> {
		const resource = this.adhdResource(file);
		return this.mutex.runExclusive(resource.toString(), async () => {
			const stat = await this.fileService.stat(file.resource);
			if (!stat.isFile) {
				throw new Error(`Cannot write ADHD state for a path whose kind changed: ${file.relativePath}`);
			}

			for (let attempt = 0; attempt < ADHD_PATCH_MAX_ATTEMPTS; attempt++) {
				const read = await this.readAdhdStateAt(file.workspaceFolder, resource, file.relativePath);
				const updated = patch(read.adhd);
				const next = updated && !isBaseHalfAdhdEmpty(updated) ? updated : null;
				if (next === null && read.adhd === null) {
					return null;
				}

				const serialized = serializeAdhdFile(next ?? buildBaseHalfAdhdFile(file.relativePath, undefined, undefined));
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, file.workspaceFolder, resource);
				await this.fileService.createFolder(dirname(resource));
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, file.workspaceFolder, resource);
				try {
					const contents = VSBuffer.fromString(serialized);
					await baseHalfCommitMirrorFile(this.fileService, resource, contents, read.exists ? read.contents : null);
					return next;
				} catch (error) {
					if (!isAdhdPatchConflict(error) || attempt === ADHD_PATCH_MAX_ATTEMPTS - 1) {
						throw error;
					}
				}
			}

			throw new Error(`Unable to update ${resource.toString()} after ${ADHD_PATCH_MAX_ATTEMPTS} attempts`);
		});
	}

	private async readAdhdStateAt(workspaceFolder: URI, resource: URI, relativePath: string): Promise<IBaseHalfAdhdReadState> {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		let content;
		try {
			content = await this.fileService.readFile(resource, {
				limits: { size: ADHD_YAML_MAX_BYTES },
				atomic: true
			});
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
				return { exists: false, adhd: null };
			}

			throw error;
		}
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);

		const parsed = parseAdhdYaml(content.value.toString(), resource);
		if (parsed === null) {
			return { exists: true, adhd: null, contents: content.value };
		}

		const adhd = normalizeAdhdFile(parsed, resource, relativePath);
		return {
			exists: true,
			adhd: isBaseHalfAdhdEmpty(adhd) ? null : adhd,
			contents: content.value
		};
	}
}

function isAdhdPatchConflict(error: unknown): boolean {
	return error instanceof FileOperationError && (
		error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE
		|| error.fileOperationResult === FileOperationResult.FILE_MOVE_CONFLICT
		|| error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND
	);
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
