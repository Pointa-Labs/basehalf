/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { dirname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { YamlMapNode, YamlNode } from '../../../base/common/yaml.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import {
	BASEHALF_ADHD_LINE_BASE,
	IBaseHalfAdhdFile,
	IBaseHalfAdhdLineRange,
	buildBaseHalfAdhdFile,
	convertBaseHalfAdhdLegacyRanges,
	dedupeBaseHalfAdhdKeywords,
	isBaseHalfAdhdEmpty,
	mergeBaseHalfAdhdRange,
	normalizeBaseHalfAdhdRanges,
	subtractBaseHalfAdhdRange
} from './basehalfAdhd.js';
import { IBaseHalfWorkspaceResource } from './basehalfCanvasNavigation.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';
import { baseHalfMarkdownFrontmatterLineCount } from './basehalfMarkdownProjection.js';
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfPreserveMirrorBytes, IBaseHalfMirrorPreservedEvent } from './basehalfMirrorRecovery.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink } from './basehalfMirrorTree.js';
import {
	baseHalfMirrorPathNamesNode,
	BaseHalfMirrorWriteRejected,
	baseHalfMirrorYamlAbsent,
	baseHalfMirrorYamlItems,
	baseHalfMirrorYamlNumber,
	baseHalfMirrorYamlProperty,
	baseHalfMirrorYamlQuote,
	baseHalfMirrorYamlString,
	BaseHalfMirrorYamlUnreadable,
	baseHalfParseMirrorYaml,
	IBaseHalfMirrorYamlDocument
} from './basehalfMirrorYaml.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from './basehalfWorkspaceMutation.js';

export const IBaseHalfAdhdMirrorService = createDecorator<IBaseHalfAdhdMirrorService>('baseHalfAdhdMirrorService');

const ADHD_YAML_MAX_BYTES = 128 * 1024;
const ADHD_PATCH_MAX_ATTEMPTS = 3;
/** Frontmatter is recognized only within the first 64 KiB of a document. */
const DOCUMENT_FRONTMATTER_WINDOW_BYTES = 64 * 1024;
const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true });

interface IBaseHalfAdhdAbsentReadState {
	readonly exists: false;
	readonly adhd: null;
}

interface IBaseHalfAdhdExistingReadState {
	readonly exists: true;
	/** The file as stored. When `legacy`, its ranges are absolute file lines. */
	readonly adhd: IBaseHalfAdhdFile | null;
	/** The file has read ranges and no `line_base` (written by an earlier release). */
	readonly legacy: boolean;
	readonly contents: VSBuffer;
	/** Why `contents` could not be read. The file then reads as one without
	 * reading aids, and a write keeps `contents` as a recovery copy. */
	readonly unreadable?: string;
}

type IBaseHalfAdhdReadState = IBaseHalfAdhdAbsentReadState | IBaseHalfAdhdExistingReadState;

/** What an ADHD reader or writer knows about the annotated document. */
export interface IBaseHalfAdhdDocumentOptions {
	/**
	 * The document's current frontmatter line count (its open text model when
	 * one is loaded). It converts an `adhd.yaml` without `line_base`. When
	 * omitted, the document is read from disk.
	 */
	readonly frontmatterLines?: number;
}

/**
 * Reading aids of one file (`.bh/mirror/<file>/adhd.yaml`). Read ranges are
 * body-relative (`line_base: body`): they count from the first body line
 * after the recognized frontmatter, so upstream edits, agent frontmatter
 * edits, and undo never shift them. A file without `line_base` holds
 * absolute lines from earlier releases: readers convert it by subtracting the
 * document's current frontmatter line count, and every write stores the
 * converted, body-relative ranges.
 */
export interface IBaseHalfAdhdMirrorService {
	readonly _serviceBrand: undefined;

	/** Fires after a reading-aid write replaced a file whose content could not be read. */
	readonly onDidPreserveUnreadableAdhd: Event<IBaseHalfMirrorPreservedEvent>;

	/** The file with body-relative ranges (converted when it has no
	 * `line_base`), or `null` when it is absent or its content cannot be read.
	 * Reads and writes reject only when the file system refuses them; a write
	 * over content that could not be read keeps it as a recovery copy first
	 * (mirror file resilience, "Annotation files"). */
	readAdhd(file: IBaseHalfWorkspaceResource, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile | null>;
	/** `fields.read_paragraphs` are body-relative. */
	setAdhd(file: IBaseHalfWorkspaceResource, fields: Pick<IBaseHalfAdhdFile, 'highlight_keywords' | 'read_paragraphs'>, lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile | null>;
	addKeyword(file: IBaseHalfWorkspaceResource, keyword: string, lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile>;
	removeKeyword(file: IBaseHalfWorkspaceResource, keyword: string, lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile | null>;
	/** `start` and `end` are body-relative lines. */
	markRead(file: IBaseHalfWorkspaceResource, start: number, end: number, lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile>;
	/** `start` and `end` are body-relative lines. */
	markUnread(file: IBaseHalfWorkspaceResource, start: number, end: number, lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile | null>;
	/**
	 * Persists the conversion of an `adhd.yaml` without `line_base`, using the
	 * frontmatter line count the document has now. A reference operation calls
	 * this before it changes that count. Returns whether it wrote: a missing
	 * file, one that already has `line_base`, or one without read ranges is
	 * left unchanged.
	 */
	persistBodyLineBase(file: IBaseHalfWorkspaceResource, frontmatterLines: number, lease?: IBaseHalfWorkspaceMutationLease): Promise<boolean>;
	/** Structural path identity operations. They do not require the old user
	 * file to still exist and retire mirrors to canonical tombstones with exact
	 * byte preconditions instead of unguarded unlink. An `adhd.yaml` that cannot
	 * be read is left in place, byte for byte, and never rejects them (mirror
	 * file resilience, "Structural operations"). */
	retireAdhd(file: IBaseHalfWorkspaceResource, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	relocateAdhd(source: IBaseHalfWorkspaceResource, target: IBaseHalfWorkspaceResource, options?: { readonly sameResourceIdentity?: boolean }, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	adhdResource(file: IBaseHalfWorkspaceResource): URI;
}

class BaseHalfAdhdMirrorCorrupt extends Error {
	override readonly name = 'BaseHalfAdhdMirrorCorrupt';

	constructor(
		readonly resource: URI,
		readonly reason: string,
		options?: { cause?: unknown }
	) {
		super(`Corrupt adhd.yaml at ${resource.toString()}: ${reason}`, options);
	}
}

export class BaseHalfAdhdMirrorService extends Disposable implements IBaseHalfAdhdMirrorService {
	declare readonly _serviceBrand: undefined;
	private readonly mutex = createKeyedMutex();

	private readonly _onDidPreserveUnreadableAdhd = this._register(new Emitter<IBaseHalfMirrorPreservedEvent>());
	readonly onDidPreserveUnreadableAdhd = this._onDidPreserveUnreadableAdhd.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	async readAdhd(file: IBaseHalfWorkspaceResource, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile | null> {
		const read = await this.readAdhdStateAt(file.workspaceFolder, this.adhdResource(file), file.relativePath);
		return this.bodyRelative(file, read, options);
	}

	setAdhd(file: IBaseHalfWorkspaceResource, fields: Pick<IBaseHalfAdhdFile, 'highlight_keywords' | 'read_paragraphs'>, lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile | null> {
		const keywords = dedupeBaseHalfAdhdKeywords(fields.highlight_keywords ?? []);
		const ranges = normalizeBaseHalfAdhdRanges(fields.read_paragraphs ?? []);
		return this.patchAdhd(file, () => buildBaseHalfAdhdFile(file.relativePath, keywords, ranges), lease, options);
	}

	addKeyword(file: IBaseHalfWorkspaceResource, keyword: string, lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile> {
		const trimmed = keyword.trim();
		if (trimmed.length === 0) {
			throw new Error('ADHD keyword cannot be empty');
		}

		return this.patchAdhd(file, current => {
			const existing = current?.highlight_keywords ?? [];
			const nextKeywords = existing.some(value => value.toLowerCase() === trimmed.toLowerCase()) ? existing : [...existing, trimmed];
			return buildBaseHalfAdhdFile(file.relativePath, nextKeywords, current?.read_paragraphs);
		}, lease, options).then(result => result ?? buildBaseHalfAdhdFile(file.relativePath, [trimmed], undefined));
	}

	removeKeyword(file: IBaseHalfWorkspaceResource, keyword: string, lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile | null> {
		return this.patchAdhd(file, current => {
			if (!current) {
				return null;
			}
			const kept = (current.highlight_keywords ?? []).filter(value => value !== keyword);
			return buildBaseHalfAdhdFile(file.relativePath, kept, current.read_paragraphs);
		}, lease, options);
	}

	markRead(file: IBaseHalfWorkspaceResource, start: number, end: number, lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile> {
		return this.patchAdhd(file, current => buildBaseHalfAdhdFile(
			file.relativePath,
			current?.highlight_keywords,
			mergeBaseHalfAdhdRange(current?.read_paragraphs ?? [], start, end)
		), lease, options).then(result => result ?? buildBaseHalfAdhdFile(file.relativePath, undefined, [[start, end]]));
	}

	markUnread(file: IBaseHalfWorkspaceResource, start: number, end: number, lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfAdhdDocumentOptions): Promise<IBaseHalfAdhdFile | null> {
		return this.patchAdhd(file, current => {
			if (!current) {
				return null;
			}
			return buildBaseHalfAdhdFile(
				file.relativePath,
				current.highlight_keywords,
				subtractBaseHalfAdhdRange(current.read_paragraphs ?? [], start, end)
			);
		}, lease, options);
	}

	persistBodyLineBase(file: IBaseHalfWorkspaceResource, frontmatterLines: number, lease?: IBaseHalfWorkspaceMutationLease): Promise<boolean> {
		const task = () => {
			const resource = this.adhdResource(file);
			return this.mutex.runExclusive(resource.toString(), async () => {
				for (let attempt = 0; attempt < ADHD_PATCH_MAX_ATTEMPTS; attempt++) {
					const read = await this.readAdhdStateAt(file.workspaceFolder, resource, file.relativePath);
					if (!read.exists || !read.legacy || !read.adhd) {
						return false;
					}
					const converted = convertLegacyFile(file.relativePath, read.adhd, frontmatterLines);
					try {
						await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, file.workspaceFolder, resource);
						await baseHalfCommitMirrorFile(this.fileService, resource, encodeAdhdFile(converted, resource), read.contents);
						return true;
					} catch (error) {
						if (!isAdhdPatchConflict(error) || attempt === ADHD_PATCH_MAX_ATTEMPTS - 1) {
							throw error;
						}
					}
				}
				return false;
			});
		};
		if (lease) {
			this.workspaceMutationCoordinator.assertLease(lease, file.workspaceFolder);
			return task();
		}
		return this.workspaceMutationCoordinator.runExclusive(file.workspaceFolder, task);
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
				if (!read.exists || this.leftInPlace(resource, read)) {
					return;
				}
				try {
					await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, file.workspaceFolder, resource);
					await baseHalfCommitMirrorFile(
						this.fileService,
						resource,
						encodeAdhdFile(buildBaseHalfAdhdFile(file.relativePath, undefined, undefined), resource),
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
			if (!sourceRead.exists || this.leftInPlace(sourceResource, sourceRead) || sourceRead.adhd === null) {
				return;
			}
			const targetRead = await this.readAdhdStateAt(target.workspaceFolder, targetResource, target.relativePath);
			// The moved document is at the target path now: a file without
			// `line_base` is converted against its frontmatter there.
			const moved = await this.bodyRelative(target, sourceRead, undefined);
			const relocated = buildBaseHalfAdhdFile(
				target.relativePath,
				moved?.highlight_keywords,
				moved?.read_paragraphs
			);
			const relocatedContents = encodeAdhdFile(relocated, targetResource);
			const sourceTombstoneContents = encodeAdhdFile(buildBaseHalfAdhdFile(source.relativePath, undefined, undefined), sourceResource);
			let targetCommitted = false;
			let sourceWritten: VSBuffer | undefined;
			try {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, target.workspaceFolder, targetResource);
				await this.fileService.createFolder(dirname(targetResource));
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, target.workspaceFolder, targetResource);
				if (targetRead.exists && targetRead.unreadable !== undefined) {
					// The incoming reading aids replace bytes that could not be
					// read: keep those bytes as a recovery copy first.
					const recoveryCopy = await baseHalfPreserveMirrorBytes(this.fileService, target.workspaceFolder, targetResource, targetRead.contents);
					this.logService.warn(`[BaseHalf] kept unreadable reading aids of ${target.relativePath} at ${recoveryCopy.toString()} before replacing them: ${targetRead.unreadable}`);
				}
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
				await this.assertAdhdStateContents(target.workspaceFolder, targetResource, relocatedContents);
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
				await this.assertAdhdStateContents(source.workspaceFolder, sourceResource, sourceWritten!);
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
			: encodeAdhdFile(buildBaseHalfAdhdFile(relativePath, undefined, undefined), resource);
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		await this.fileService.createFolder(dirname(resource));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		await baseHalfCommitMirrorFile(this.fileService, resource, restored, written);
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
	}

	private async assertAdhdStateContents(workspaceFolder: URI, resource: URI, expected: VSBuffer): Promise<void> {
		const current = await this.readAdhdBytesAt(workspaceFolder, resource);
		if (!current?.equals(expected)) {
			throw new FileOperationError(`ADHD state changed after relocation commit: ${resource.toString()}`, FileOperationResult.FILE_MODIFIED_SINCE);
		}
	}

	private async renameAdhdIdentityLocked(source: IBaseHalfWorkspaceResource, target: IBaseHalfWorkspaceResource): Promise<void> {
		const resource = this.adhdResource(source);
		for (let attempt = 0; attempt < ADHD_PATCH_MAX_ATTEMPTS; attempt++) {
			const read = await this.readAdhdStateAt(source.workspaceFolder, resource, source.relativePath);
			if (!read.exists) {
				return;
			}
			if (read.unreadable !== undefined) {
				// A retry after the one-file case-only commit sees target-path
				// YAML through the same case-insensitive resource: that rename
				// is already done. Any other file that cannot be read stays.
				try {
					adhdReadStateOf(read.contents, resource, target.relativePath);
				} catch {
					this.leftInPlace(resource, read);
				}
				return;
			}
			// Materialized empty ADHD files are CAS tombstones. They still carry a
			// logical path and must adopt the target casing or every later read at the
			// new identity reports a corrupt mirror.
			const current = await this.bodyRelative(target, read, undefined);
			const renamed = buildBaseHalfAdhdFile(
				target.relativePath,
				current?.highlight_keywords,
				current?.read_paragraphs
			);
			try {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, source.workspaceFolder, resource);
				await baseHalfCommitMirrorFile(this.fileService, resource, encodeAdhdFile(renamed, resource), read.contents);
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
		lease: IBaseHalfWorkspaceMutationLease | undefined,
		options: IBaseHalfAdhdDocumentOptions | undefined
	): Promise<IBaseHalfAdhdFile | null> {
		if (lease) {
			this.workspaceMutationCoordinator.assertLease(lease, file.workspaceFolder);
			return this.patchAdhdLocked(file, patch, options);
		}
		return this.workspaceMutationCoordinator.runExclusive(file.workspaceFolder, () => this.patchAdhdLocked(file, patch, options));
	}

	/** The body-relative form of a read: a file without `line_base` is
	 * converted against the document's current frontmatter line count. */
	private async bodyRelative(file: IBaseHalfWorkspaceResource, read: IBaseHalfAdhdReadState, options: IBaseHalfAdhdDocumentOptions | undefined): Promise<IBaseHalfAdhdFile | null> {
		if (!read.exists || !read.legacy || !read.adhd) {
			return read.adhd;
		}
		const frontmatterLines = options?.frontmatterLines ?? await this.documentFrontmatterLines(file);
		return convertLegacyFile(file.relativePath, read.adhd, frontmatterLines);
	}

	/** The frontmatter line count of the document on disk (0 when it cannot be read). */
	private async documentFrontmatterLines(file: IBaseHalfWorkspaceResource): Promise<number> {
		try {
			const content = await this.fileService.readFile(file.resource, { length: DOCUMENT_FRONTMATTER_WINDOW_BYTES });
			return baseHalfMarkdownFrontmatterLineCount(utf8Decoder.decode(content.value.buffer));
		} catch {
			return 0;
		}
	}

	private patchAdhdLocked(
		file: IBaseHalfWorkspaceResource,
		patch: (current: IBaseHalfAdhdFile | null) => IBaseHalfAdhdFile | null,
		options: IBaseHalfAdhdDocumentOptions | undefined
	): Promise<IBaseHalfAdhdFile | null> {
		const resource = this.adhdResource(file);
		return this.mutex.runExclusive(resource.toString(), async () => {
			const stat = await this.fileService.stat(file.resource);
			if (!stat.isFile) {
				throw new Error(`Cannot write ADHD state for a path whose kind changed: ${file.relativePath}`);
			}

			for (let attempt = 0; attempt < ADHD_PATCH_MAX_ATTEMPTS; attempt++) {
				const read = await this.readAdhdStateAt(file.workspaceFolder, resource, file.relativePath);
				// Every write stores body-relative ranges.
				const updated = patch(await this.bodyRelative(file, read, options));
				const next = updated && !isBaseHalfAdhdEmpty(updated) ? updated : null;
				if (next === null && read.adhd === null) {
					return null;
				}

				const contents = encodeAdhdFile(next ?? buildBaseHalfAdhdFile(file.relativePath, undefined, undefined), resource);
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, file.workspaceFolder, resource);
				await this.fileService.createFolder(dirname(resource));
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, file.workspaceFolder, resource);
				try {
					// Bytes that could not be read are kept before a write the
					// user asked for replaces them.
					const preserved = read.exists && read.unreadable !== undefined
						? { reason: read.unreadable, recoveryCopy: await baseHalfPreserveMirrorBytes(this.fileService, file.workspaceFolder, resource, read.contents) }
						: undefined;
					await baseHalfCommitMirrorFile(this.fileService, resource, contents, read.exists ? read.contents : null);
					if (preserved) {
						this._onDidPreserveUnreadableAdhd.fire({ workspaceFolder: file.workspaceFolder, relativePath: file.relativePath, ...preserved });
					}
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

	/**
	 * Bytes that cannot be read as the reading aids of `relativePath` come back
	 * as a file without reading aids whose `unreadable` holds the cause, so a
	 * content failure never rejects a read, a write, a move, or a delete.
	 */
	private async readAdhdStateAt(workspaceFolder: URI, resource: URI, relativePath: string): Promise<IBaseHalfAdhdReadState> {
		const contents = await this.readAdhdBytesAt(workspaceFolder, resource);
		if (contents === null) {
			return { exists: false, adhd: null };
		}
		try {
			return adhdReadStateOf(contents, resource, relativePath);
		} catch (error) {
			if (!(error instanceof BaseHalfAdhdMirrorCorrupt)) {
				throw error;
			}
			return { exists: true, adhd: null, legacy: false, contents, unreadable: error.reason };
		}
	}

	/** Whether `read` could not be read. Such a file stays where it is, byte for byte. */
	private leftInPlace(resource: URI, read: IBaseHalfAdhdReadState): boolean {
		if (!read.exists || read.unreadable === undefined) {
			return false;
		}
		this.logService.warn(`[BaseHalf] left reading aids that cannot be read in place: ${resource.toString()}: ${read.unreadable}`);
		return true;
	}

	/** The stored bytes, or `null` when the file does not exist. */
	private async readAdhdBytesAt(workspaceFolder: URI, resource: URI): Promise<VSBuffer | null> {
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
				return null;
			}

			throw error;
		}
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		return content.value;
	}
}

/** The read state of stored bytes; throws when they are not the reading aids of `relativePath`. */
function adhdReadStateOf(contents: VSBuffer, resource: URI, relativePath: string): IBaseHalfAdhdExistingReadState {
	const parsed = parseAdhdYaml(contents.toString(), resource);
	if (parsed === null) {
		return { exists: true, adhd: null, legacy: false, contents };
	}

	const { adhd, legacy } = normalizeAdhdFile(parsed, resource, relativePath);
	return {
		exists: true,
		adhd: isBaseHalfAdhdEmpty(adhd) ? null : adhd,
		legacy: legacy && !isBaseHalfAdhdEmpty(adhd),
		contents
	};
}

/**
 * The bytes of an `adhd.yaml` after the write check: the reader must accept
 * them and return what was serialized, or nothing is written (mirror file
 * resilience, "Write check").
 */
function encodeAdhdFile(file: IBaseHalfAdhdFile, resource: URI): VSBuffer {
	const text = serializeAdhdFile(file);
	let readBack: string;
	try {
		const root = parseAdhdYaml(text, resource);
		readBack = root === null ? '' : serializeAdhdFile(normalizeAdhdFile(root, resource, file.path).adhd);
	} catch (error) {
		if (!(error instanceof BaseHalfAdhdMirrorCorrupt)) {
			throw error;
		}
		throw new BaseHalfMirrorWriteRejected(resource, error.reason);
	}
	if (readBack !== text) {
		throw new BaseHalfMirrorWriteRejected(resource, 'the reading aids changed when they were read back');
	}
	return VSBuffer.fromString(text);
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
		`path: ${baseHalfMirrorYamlQuote(file.path)}`,
		'kind: file'
	];

	const ranges = normalizeBaseHalfAdhdRanges(file.read_paragraphs ?? []);
	if (ranges.length > 0) {
		lines.push(`line_base: ${BASEHALF_ADHD_LINE_BASE}`);
	}

	const keywords = dedupeBaseHalfAdhdKeywords(file.highlight_keywords ?? []);
	if (keywords.length > 0) {
		lines.push('highlight_keywords:');
		for (const keyword of keywords) {
			lines.push(`  - ${baseHalfMirrorYamlQuote(keyword)}`);
		}
	}

	if (ranges.length > 0) {
		lines.push('read_paragraphs:');
		for (const [start, end] of ranges) {
			lines.push(`  - [${start}, ${end}]`);
		}
	}

	lines.push('');
	return lines.join('\n');
}

/** A stored file and whether its ranges are absolute (no `line_base`). */
function normalizeAdhdFile(root: YamlMapNode, resource: URI, expectedPath: string): { readonly adhd: IBaseHalfAdhdFile; readonly legacy: boolean } {
	if (!baseHalfMirrorPathNamesNode(stringField(root, 'path', resource), expectedPath)) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, `path must be "${expectedPath}"`);
	}
	// A path that differs only in case or normalization is this node's.
	const path = expectedPath;

	if (stringField(root, 'kind', resource) !== 'file') {
		throw new BaseHalfAdhdMirrorCorrupt(resource, 'kind must be file');
	}

	const lineBaseNode = baseHalfMirrorYamlProperty(root, 'line_base');
	const hasLineBase = !baseHalfMirrorYamlAbsent(lineBaseNode);
	if (hasLineBase && baseHalfMirrorYamlString(lineBaseNode) !== BASEHALF_ADHD_LINE_BASE) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, `line_base must be ${BASEHALF_ADHD_LINE_BASE}`);
	}

	const keywords = optionalStringArrayField(root, 'highlight_keywords', resource);
	const ranges = optionalRangeArrayField(root, 'read_paragraphs', resource);
	try {
		const adhd = buildBaseHalfAdhdFile(path, keywords, ranges);
		return { adhd, legacy: !hasLineBase && (adhd.read_paragraphs?.length ?? 0) > 0 };
	} catch (error) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, error instanceof Error ? error.message : String(error), { cause: error });
	}
}

/** The body-relative form of a file whose ranges are absolute file lines. */
function convertLegacyFile(path: string, file: IBaseHalfAdhdFile, frontmatterLines: number): IBaseHalfAdhdFile {
	return buildBaseHalfAdhdFile(path, file.highlight_keywords, convertBaseHalfAdhdLegacyRanges(file.read_paragraphs ?? [], frontmatterLines));
}

function parseAdhdYaml(raw: string, resource: URI): YamlMapNode | null {
	let document: IBaseHalfMirrorYamlDocument;
	try {
		document = baseHalfParseMirrorYaml(raw, 'adhd');
	} catch (error) {
		if (error instanceof BaseHalfMirrorYamlUnreadable) {
			throw new BaseHalfAdhdMirrorCorrupt(resource, error.reason, { cause: error });
		}
		throw error;
	}
	if (document.unparsed) {
		// Reading aids after that line would be lost on the next write.
		throw new BaseHalfAdhdMirrorCorrupt(resource, document.unparsed);
	}
	return document.root;
}

function optionalStringArrayField(root: YamlMapNode, key: string, resource: URI): readonly string[] {
	const items = listField(root, key, resource);
	return items.map((item, index) => {
		const value = baseHalfMirrorYamlString(item);
		if (value === undefined) {
			throw new BaseHalfAdhdMirrorCorrupt(resource, `${key}[${index}] must be a string`);
		}
		return value;
	});
}

function optionalRangeArrayField(root: YamlMapNode, key: string, resource: URI): readonly IBaseHalfAdhdLineRange[] {
	const items = listField(root, key, resource);
	return items.map((item, index) => {
		const pair = item.type === 'sequence' ? item.items : undefined;
		if (pair?.length !== 2) {
			throw new BaseHalfAdhdMirrorCorrupt(resource, `${key}[${index}] must be a [start, end] pair`);
		}
		const start = baseHalfMirrorYamlNumber(pair[0]);
		const end = baseHalfMirrorYamlNumber(pair[1]);
		if (start === undefined || end === undefined || !Number.isInteger(start) || !Number.isInteger(end)) {
			throw new BaseHalfAdhdMirrorCorrupt(resource, `${key}[${index}] must contain integers`);
		}
		return [start, end] as const;
	});
}

function listField(root: YamlMapNode, key: string, resource: URI): readonly YamlNode[] {
	const items = baseHalfMirrorYamlItems(baseHalfMirrorYamlProperty(root, key));
	if (!items) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, `${key} must be an array`);
	}
	return items;
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

function stringField(root: YamlMapNode, key: string, resource: URI): string {
	const value = baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(root, key));
	if (value === undefined) {
		throw new BaseHalfAdhdMirrorCorrupt(resource, `${key} must be a string`);
	}

	return value;
}

registerSingleton(IBaseHalfAdhdMirrorService, BaseHalfAdhdMirrorService, InstantiationType.Delayed);
